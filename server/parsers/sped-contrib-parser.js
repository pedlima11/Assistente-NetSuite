/**
 * Parser event-based de arquivos SPED EFD Contribuicoes (PIS/COFINS).
 *
 * Leitura via fs.createReadStream + readline — memoria constante.
 * Emite callbacks por registro, sem reter documents/items em memoria
 * (exceto consolidados bufferizados para dedup).
 *
 * Fase 1 MVP — Registros processados:
 *   0000 (info empresa — layout diferente do Fiscal)
 *   0150 (participantes)
 *   0200 (catalogo de itens)
 *   A100 (cabecalho servicos — apenas contexto)
 *   A170 (itens servicos — NAT_BC_CRED em field[6])
 *   C100 (cabecalho documentos mercadorias — apenas contexto)
 *   C170 (itens mercadorias — 37 campos com ICMS+IPI+PIS+COFINS, sem NAT_BC_CRED)
 *   C181 (PIS consolidado — NAT em field[2])
 *   C185 (COFINS consolidado — NAT em field[2])
 *   C191 (PIS aquisicao — NAT em field[2])
 *   C195 (COFINS aquisicao — NAT em field[2])
 *   F100 (outros creditos — NAT em field[15])
 *   M100/M105 (apuracao PIS — leitura para validacao)
 *   M500/M505 (apuracao COFINS — leitura para validacao)
 */

import {
  extractRegisterType,
  splitLine,
  REJECTED_COD_SIT,
  buildAcceptedCodSit,
  createSpedReader,
  detectSpedFileType,
} from './sped-common.js';

// Registros relevantes para Contribuicoes
const RELEVANT_REGISTERS = new Set([
  '0000', '0150', '0200',
  'A100', 'A170',
  'C100', 'C170', 'C181', 'C185', 'C191', 'C195',
  'F100',
  'M100', 'M105', 'M500', 'M505',
]);

/**
 * Monta docKey robusto para dedup item-level vs consolidado.
 * Se faltar campo essencial, retorna { key, quality: 'LOW' }.
 *
 * @param {string} cnpjDeclarante
 * @param {Object} docCtx
 * @returns {{ key: string, quality: 'HIGH'|'LOW' }}
 */
function buildDocKey(cnpjDeclarante, docCtx) {
  const parts = [
    cnpjDeclarante || '',
    docCtx.dtDoc || '',
    docCtx.codMod || '',
    docCtx.serie || '',
    docCtx.numDoc || '',
    docCtx.codPart || '',
  ];

  const missing = parts.some(p => !p);
  return {
    key: parts.join('|'),
    quality: missing ? 'LOW' : 'HIGH',
  };
}

/**
 * Verifica se um item C170 tem dados PIS/COFINS reais
 * (CST preenchido E (valor > 0 OU base > 0)).
 */
function hasRealPisCofinsData(rawItem) {
  const hasPis = rawItem.cstPis !== '' &&
    (rawItem.vlPis > 0 || rawItem.vlBcPis > 0);
  const hasCofins = rawItem.cstCofins !== '' &&
    (rawItem.vlCofins > 0 || rawItem.vlBcCofins > 0);
  return hasPis || hasCofins;
}

/**
 * Parser event-based de SPED EFD Contribuicoes.
 *
 * @param {string} filePath - Caminho do arquivo .txt
 * @param {Object} options
 * @param {boolean} [options.includeComplementary=false]
 * @param {boolean} [options.includeSpecialRegime=false]
 * @param {boolean} [options.includeServices=true] - Processar bloco A (servicos)
 * @param {boolean} [options.includeOtherCredits=true] - Processar bloco F (F100)
 * @param {Object} callbacks
 * @param {Function} callbacks.onCompanyInfo
 * @param {Function} callbacks.onParticipant
 * @param {Function} callbacks.onCatalogItem
 * @param {Function} callbacks.onDocumentStart
 * @param {Function} callbacks.onItem - (rawItem, docCtx, lookups, meta) => void
 *   meta: { sourceDetail: 'item_level'|'consolidated', docKey, docKeyQuality }
 * @param {Function} [callbacks.onBlockM] - (record) => void — M100/M105/M500/M505
 * @param {Function} [callbacks.onProgress]
 * @returns {Promise<{ rawStats: Object, companyInfo: Object, blockM: Object }>}
 */
export async function parseSpedContribStream(filePath, options = {}, callbacks = {}) {
  const {
    includeServices = true,
    includeOtherCredits = true,
  } = options;

  const acceptedCodSit = buildAcceptedCodSit(options);
  const { rl, encoding, totalBytes } = await createSpedReader(filePath);

  const rawStats = {
    totalLines: 0,
    processedLines: 0,
    documentsRead: 0,
    documentsAccepted: 0,
    documentsRejectedByStatus: 0,
    skippedByCodSit: {},
    itemLevelItems: 0,
    consolidatedItems: 0,
    consolidatedSuppressed: 0,
    f100Items: 0,
    blockMRecords: 0,
  };

  // Bloco M acumulado para validacao
  const blockM = {
    m100: [],  // PIS apuracao
    m105: [],  // PIS detalhamento por NAT
    m500: [],  // COFINS apuracao
    m505: [],  // COFINS detalhamento por NAT
  };

  // Contextos ativos
  let currentDocA = null;  // A100 ativo
  let currentDocC = null;  // C100 ativo
  let bytesRead = 0;
  let cnpjDeclarante = '';

  // Lookups construidos durante parsing
  const participants = new Map();
  const catalogItems = new Map();
  let companyInfo = null;
  const lookups = { participants, catalogItems, companyInfo: null };

  // Dedup: rastreia quais docKeys tem item-level real
  const docHasItemLevel = new Map();  // docKey → boolean

  // Buffer de consolidados para emissao posterior (dedup)
  const consolidatedBuffer = [];  // { rawItem, docCtx, docKey, docKeyQuality }

  for await (const line of rl) {
    rawStats.totalLines++;
    bytesRead += Buffer.byteLength(line, encoding) + 1;

    const regType = extractRegisterType(line);
    if (!RELEVANT_REGISTERS.has(regType)) continue;

    rawStats.processedLines++;
    const fields = splitLine(line);

    switch (regType) {
      // ── 0000: Info empresa (layout Contribuicoes) ───────────────────────
      case '0000': {
        // Detectar tipo de arquivo para rejeitar SPED Fiscal no slot errado
        const fileType = detectSpedFileType(fields);
        if (fileType === 'fiscal') {
          throw new Error(
            'TIPO_ARQUIVO_INCORRETO: Arquivo SPED Fiscal (EFD ICMS/IPI) enviado como Contribuicoes. ' +
            'Envie este arquivo no campo "SPED Fiscal".'
          );
        }
        if (fileType === 'unknown') {
          rawStats._fileTypeWarning = 'Tipo de arquivo SPED nao identificado no registro 0000. Continuando como Contribuicoes.';
        }

        // |0000|COD_VER|TIPO_ESCRIT|IND_SIT_ESP|NUM_REC_ANTERIOR|
        //       DT_INI|DT_FIN|NOME|CNPJ|UF|COD_MUN|...
        // Diferenca critica: CNPJ=field[8], UF=field[9], COD_MUN=field[11]
        companyInfo = {
          cnpj: (fields[8] || '').trim(),
          uf: (fields[9] || '').trim(),
          nome: (fields[7] || '').trim(),
          codMun: (fields[11] || '').trim(),
          dtIni: (fields[5] || '').trim(),
          dtFin: (fields[6] || '').trim(),
          tipoEscrit: (fields[2] || '').trim(),
        };
        cnpjDeclarante = companyInfo.cnpj;
        lookups.companyInfo = companyInfo;
        if (callbacks.onCompanyInfo) callbacks.onCompanyInfo(companyInfo);
        break;
      }

      // ── 0150: Participantes (mesmo layout do Fiscal) ────────────────────
      case '0150': {
        const codPart = (fields[1] || '').trim();
        const data = {
          cnpj: (fields[4] || '').trim(),
          codMun: (fields[7] || '').trim(),
          nome: (fields[2] || '').trim(),
        };
        participants.set(codPart, data);
        if (callbacks.onParticipant) callbacks.onParticipant(codPart, data);
        break;
      }

      // ── 0200: Catalogo de itens (mesmo layout do Fiscal) ────────────────
      case '0200': {
        const codItem = (fields[1] || '').trim();
        const data = {
          ncm: (fields[7] || '').trim(),
          descr: (fields[2] || '').trim(),
        };
        catalogItems.set(codItem, data);
        if (callbacks.onCatalogItem) callbacks.onCatalogItem(codItem, data);
        break;
      }

      // ── A100: Cabecalho documento servicos ──────────────────────────────
      case 'A100': {
        currentDocA = null;
        if (!includeServices) break;

        // |A100|IND_OPER|IND_EMIT|COD_PART|COD_SIT|SER|SUB|NUM_DOC|
        //       CHV_NFSE|DT_DOC|DT_EXE_SERV|VL_DOC|...
        const indOper = (fields[1] || '').trim();
        const codSit = (fields[4] || '').trim();

        rawStats.documentsRead++;

        // Apenas entradas
        if (indOper !== '0') break;

        if (REJECTED_COD_SIT.has(codSit)) {
          rawStats.documentsRejectedByStatus++;
          rawStats.skippedByCodSit[codSit] = (rawStats.skippedByCodSit[codSit] || 0) + 1;
          break;
        }
        if (!acceptedCodSit.has(codSit)) {
          rawStats.skippedByCodSit[codSit] = (rawStats.skippedByCodSit[codSit] || 0) + 1;
          break;
        }

        rawStats.documentsAccepted++;

        currentDocA = {
          codPart: (fields[3] || '').trim(),
          codSit,
          codMod: 'A',  // Servicos
          serie: (fields[5] || '').trim(),
          numDoc: (fields[7] || '').trim(),
          chvNfe: (fields[8] || '').trim(),
          dtDoc: (fields[9] || '').trim(),
          blockType: 'A',
        };

        if (callbacks.onDocumentStart) callbacks.onDocumentStart(currentDocA);
        break;
      }

      // ── A170: Itens servicos — NAT_BC_CRED em field[6] ─────────────────
      case 'A170': {
        if (!currentDocA) break;

        // |A170|NUM_ITEM|COD_ITEM|DESCR_COMPL|VL_ITEM|VL_DESC|
        //       NAT_BC_CRED|IND_ORIG_CRED|CST_PIS|VL_BC_PIS|ALIQ_PIS|
        //       VL_PIS|CST_COFINS|VL_BC_COFINS|ALIQ_COFINS|VL_COFINS|
        //       COD_CTA|COD_CCUS
        const rawItem = {
          numItem: (fields[1] || '').trim(),
          codItem: (fields[2] || '').trim(),
          descrCompl: (fields[3] || '').trim(),
          vlItem: parseFloat(fields[4]) || 0,
          natBcCred: (fields[6] || '').trim(),
          cstPis: (fields[8] || '').trim(),
          vlBcPis: parseFloat(fields[9]) || 0,
          aliqPis: parseFloat(fields[10]) || 0,
          vlPis: parseFloat(fields[11]) || 0,
          cstCofins: (fields[12] || '').trim(),
          vlBcCofins: parseFloat(fields[13]) || 0,
          aliqCofins: parseFloat(fields[14]) || 0,
          vlCofins: parseFloat(fields[15]) || 0,
          _registerType: 'A170',
        };

        rawStats.itemLevelItems++;

        const dk = buildDocKey(cnpjDeclarante, currentDocA);

        if (callbacks.onItem) {
          callbacks.onItem(rawItem, currentDocA, lookups, {
            sourceDetail: 'item_level',
            docKey: dk.key,
            docKeyQuality: dk.quality,
          });
        }
        break;
      }

      // ── C100: Cabecalho documento mercadorias ───────────────────────────
      case 'C100': {
        currentDocC = null;

        // |C100|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|NUM_DOC|
        //       CHV_NFE|DT_DOC|DT_E_S|VL_DOC|...
        const indOper = (fields[1] || '').trim();
        const codSit = (fields[5] || '').trim();

        rawStats.documentsRead++;

        if (indOper !== '0') break;

        if (REJECTED_COD_SIT.has(codSit)) {
          rawStats.documentsRejectedByStatus++;
          rawStats.skippedByCodSit[codSit] = (rawStats.skippedByCodSit[codSit] || 0) + 1;
          break;
        }
        if (!acceptedCodSit.has(codSit)) {
          rawStats.skippedByCodSit[codSit] = (rawStats.skippedByCodSit[codSit] || 0) + 1;
          break;
        }

        rawStats.documentsAccepted++;

        currentDocC = {
          codPart: (fields[3] || '').trim(),
          codSit,
          codMod: (fields[4] || '').trim(),
          serie: (fields[6] || '').trim(),
          numDoc: (fields[7] || '').trim(),
          chvNfe: (fields[8] || '').trim(),
          dtDoc: (fields[9] || '').trim(),
          blockType: 'C',
        };

        if (callbacks.onDocumentStart) callbacks.onDocumentStart(currentDocC);
        break;
      }

      // ── C170: Itens mercadorias (sem NAT_BC_CRED, 37 campos) ──────────
      case 'C170': {
        if (!currentDocC) break;

        // Layout C170 EFD Contribuicoes — 37 campos (1-based), inclui ICMS+IPI:
        // 01=REG  02=NUM_ITEM  03=COD_ITEM  04=DESCR_COMPL  05=QTD  06=UNID
        // 07=VL_ITEM  08=VL_DESC  09=IND_MOV
        // 10=CST_ICMS  11=CFOP  12=COD_NAT  13=VL_BC_ICMS  14=ALIQ_ICMS
        // 15=VL_ICMS  16=VL_BC_ICMS_ST  17=ALIQ_ST  18=VL_ICMS_ST
        // 19=IND_APUR  20=CST_IPI  21=COD_ENQ  22=VL_BC_IPI  23=ALIQ_IPI  24=VL_IPI
        // 25=CST_PIS  26=VL_BC_PIS  27=ALIQ_PIS(%)  28=QUANT_BC_PIS
        // 29=ALIQ_PIS_QUANT  30=VL_PIS
        // 31=CST_COFINS  32=VL_BC_COFINS  33=ALIQ_COFINS(%)  34=QUANT_BC_COFINS
        // 35=ALIQ_COFINS_QUANT  36=VL_COFINS  37=COD_CTA
        // Fonte: Guia Pratico EFD-Contribuicoes RFB + VRI Consulting
        const rawItem = {
          numItem: (fields[1] || '').trim(),
          codItem: (fields[2] || '').trim(),
          descrCompl: (fields[3] || '').trim(),
          vlItem: parseFloat(fields[6]) || 0,
          cfop: (fields[10] || '').trim(),
          cstPis: (fields[24] || '').trim(),
          vlBcPis: parseFloat(fields[25]) || 0,
          aliqPis: parseFloat(fields[26]) || 0,
          vlPis: parseFloat(fields[29]) || 0,
          cstCofins: (fields[30] || '').trim(),
          vlBcCofins: parseFloat(fields[31]) || 0,
          aliqCofins: parseFloat(fields[32]) || 0,
          vlCofins: parseFloat(fields[35]) || 0,
          natBcCred: '',  // C170 nao tem NAT_BC_CRED
          _registerType: 'C170',
        };

        const dk = buildDocKey(cnpjDeclarante, currentDocC);

        // Marcar docKey como tendo item-level se tem dados reais
        if (dk.quality === 'HIGH' && hasRealPisCofinsData(rawItem)) {
          docHasItemLevel.set(dk.key, true);
        }

        rawStats.itemLevelItems++;

        if (callbacks.onItem) {
          callbacks.onItem(rawItem, currentDocC, lookups, {
            sourceDetail: 'item_level',
            docKey: dk.key,
            docKeyQuality: dk.quality,
          });
        }
        break;
      }

      // ── C181: PIS consolidado — NAT_BC_CRED em field[2] ────────────────
      case 'C181': {
        if (!currentDocC) break;

        // |C181|CST_PIS|COD_NAT_BC|VL_ITEM|VL_BC_PIS|ALIQ_PIS|VL_PIS|
        //       COD_CTA
        const rawItem = {
          codItem: '',
          descrCompl: '',
          vlItem: parseFloat(fields[3]) || 0,
          natBcCred: (fields[2] || '').trim(),
          cstPis: (fields[1] || '').trim(),
          vlBcPis: parseFloat(fields[4]) || 0,
          aliqPis: parseFloat(fields[5]) || 0,
          vlPis: parseFloat(fields[6]) || 0,
          cstCofins: '',
          vlBcCofins: 0,
          aliqCofins: 0,
          vlCofins: 0,
          _registerType: 'C181',
          _taxType: 'PIS',
        };

        const dk = buildDocKey(cnpjDeclarante, currentDocC);

        // Bufferizar consolidado para dedup
        consolidatedBuffer.push({
          rawItem, docCtx: currentDocC, docKey: dk.key, docKeyQuality: dk.quality,
        });
        break;
      }

      // ── C185: COFINS consolidado — NAT_BC_CRED em field[2] ─────────────
      case 'C185': {
        if (!currentDocC) break;

        // |C185|CST_COFINS|COD_NAT_BC|VL_ITEM|VL_BC_COFINS|ALIQ_COFINS|VL_COFINS|
        //       COD_CTA
        const rawItem = {
          codItem: '',
          descrCompl: '',
          vlItem: parseFloat(fields[3]) || 0,
          natBcCred: (fields[2] || '').trim(),
          cstPis: '',
          vlBcPis: 0,
          aliqPis: 0,
          vlPis: 0,
          cstCofins: (fields[1] || '').trim(),
          vlBcCofins: parseFloat(fields[4]) || 0,
          aliqCofins: parseFloat(fields[5]) || 0,
          vlCofins: parseFloat(fields[6]) || 0,
          _registerType: 'C185',
          _taxType: 'COFINS',
        };

        const dk = buildDocKey(cnpjDeclarante, currentDocC);

        consolidatedBuffer.push({
          rawItem, docCtx: currentDocC, docKey: dk.key, docKeyQuality: dk.quality,
        });
        break;
      }

      // ── C191: PIS aquisicao — NAT_BC_CRED em field[2] ──────────────────
      case 'C191': {
        if (!currentDocC) break;

        // |C191|CST_PIS|COD_NAT_BC|VL_ITEM|VL_BC_PIS|ALIQ_PIS|VL_PIS|
        //       COD_CTA
        const rawItem = {
          codItem: '',
          descrCompl: '',
          vlItem: parseFloat(fields[3]) || 0,
          natBcCred: (fields[2] || '').trim(),
          cstPis: (fields[1] || '').trim(),
          vlBcPis: parseFloat(fields[4]) || 0,
          aliqPis: parseFloat(fields[5]) || 0,
          vlPis: parseFloat(fields[6]) || 0,
          cstCofins: '',
          vlBcCofins: 0,
          aliqCofins: 0,
          vlCofins: 0,
          _registerType: 'C191',
          _taxType: 'PIS',
        };

        const dk = buildDocKey(cnpjDeclarante, currentDocC);

        consolidatedBuffer.push({
          rawItem, docCtx: currentDocC, docKey: dk.key, docKeyQuality: dk.quality,
        });
        break;
      }

      // ── C195: COFINS aquisicao — NAT_BC_CRED em field[2] ───────────────
      case 'C195': {
        if (!currentDocC) break;

        // |C195|CST_COFINS|COD_NAT_BC|VL_ITEM|VL_BC_COFINS|ALIQ_COFINS|VL_COFINS|
        //       COD_CTA
        const rawItem = {
          codItem: '',
          descrCompl: '',
          vlItem: parseFloat(fields[3]) || 0,
          natBcCred: (fields[2] || '').trim(),
          cstPis: '',
          vlBcPis: 0,
          aliqPis: 0,
          vlPis: 0,
          cstCofins: (fields[1] || '').trim(),
          vlBcCofins: parseFloat(fields[4]) || 0,
          aliqCofins: parseFloat(fields[5]) || 0,
          vlCofins: parseFloat(fields[6]) || 0,
          _registerType: 'C195',
          _taxType: 'COFINS',
        };

        const dk = buildDocKey(cnpjDeclarante, currentDocC);

        consolidatedBuffer.push({
          rawItem, docCtx: currentDocC, docKey: dk.key, docKeyQuality: dk.quality,
        });
        break;
      }

      // ── F100: Outros creditos — NAT_BC_CRED em field[15] ───────────────
      case 'F100': {
        if (!includeOtherCredits) break;

        // |F100|IND_OPER|COD_PART|COD_ITEM|DT_OPER|VL_OPER|
        //       CST_PIS|VL_BC_PIS|ALIQ_PIS|VL_PIS|
        //       CST_COFINS|VL_BC_COFINS|ALIQ_COFINS|VL_COFINS|
        //       NAT_BC_CRED|IND_ORIG_CRED|COD_CTA|COD_CCUS|DESC_DOC_OPER
        const indOper = (fields[1] || '').trim();
        if (indOper !== '0') break;  // Apenas entradas

        const rawItem = {
          codItem: (fields[3] || '').trim(),
          descrCompl: (fields[18] || '').trim(),  // DESC_DOC_OPER
          vlItem: parseFloat(fields[5]) || 0,
          natBcCred: (fields[14] || '').trim(),
          cstPis: (fields[6] || '').trim(),
          vlBcPis: parseFloat(fields[7]) || 0,
          aliqPis: parseFloat(fields[8]) || 0,
          vlPis: parseFloat(fields[9]) || 0,
          cstCofins: (fields[10] || '').trim(),
          vlBcCofins: parseFloat(fields[11]) || 0,
          aliqCofins: parseFloat(fields[12]) || 0,
          vlCofins: parseFloat(fields[13]) || 0,
          _registerType: 'F100',
        };

        // F100 gera docKey com quality LOW (sem numDoc/serie/modelo)
        const f100DocCtx = {
          codPart: (fields[2] || '').trim(),
          codSit: '00',
          codMod: 'F',
          serie: '',
          numDoc: '',
          chvNfe: '',
          dtDoc: (fields[4] || '').trim(),
          blockType: 'F',
        };

        rawStats.f100Items++;

        const dk = buildDocKey(cnpjDeclarante, f100DocCtx);

        if (callbacks.onItem) {
          callbacks.onItem(rawItem, f100DocCtx, lookups, {
            sourceDetail: 'item_level',
            docKey: dk.key,
            docKeyQuality: dk.quality,
          });
        }
        break;
      }

      // ── M100: Apuracao PIS ──────────────────────────────────────────────
      case 'M100': {
        // |M100|COD_CRED|IND_CRED_ORI|VL_BC_PIS|ALIQ_PIS|QUANT_BC_PIS|
        //       ALIQ_PIS_QUANT|VL_CRED|VL_AJUS_ACRES|VL_AJUS_REDUC|
        //       VL_CRED_DIF|VL_CRED_DISP|IND_DESC_CRED|VL_CRED_DESC|
        //       SLD_CRED
        const record = {
          type: 'M100',
          codCred: (fields[1] || '').trim(),
          vlBcPis: parseFloat(fields[3]) || 0,
          aliqPis: parseFloat(fields[4]) || 0,
          vlCred: parseFloat(fields[7]) || 0,
          vlCredDisp: parseFloat(fields[11]) || 0,
          vlCredDesc: parseFloat(fields[13]) || 0,
          sldCred: parseFloat(fields[14]) || 0,
        };
        blockM.m100.push(record);
        rawStats.blockMRecords++;
        if (callbacks.onBlockM) callbacks.onBlockM(record);
        break;
      }

      // ── M105: Detalhamento PIS por NAT ──────────────────────────────────
      case 'M105': {
        // |M105|NAT_BC_CRED|IND_CRED_ORI|VL_BC_PIS_TOT|
        //       VL_BC_PIS_NC|VL_BC_PIS_CUM|VL_BC_PIS_REC
        const record = {
          type: 'M105',
          natBcCred: (fields[1] || '').trim(),
          vlBcPisTot: parseFloat(fields[3]) || 0,
          vlBcPisNc: parseFloat(fields[4]) || 0,
          vlBcPisCum: parseFloat(fields[5]) || 0,
        };
        blockM.m105.push(record);
        rawStats.blockMRecords++;
        if (callbacks.onBlockM) callbacks.onBlockM(record);
        break;
      }

      // ── M500: Apuracao COFINS ───────────────────────────────────────────
      case 'M500': {
        // |M500|COD_CRED|IND_CRED_ORI|VL_BC_COFINS|ALIQ_COFINS|
        //       QUANT_BC_COFINS|ALIQ_COFINS_QUANT|VL_CRED|VL_AJUS_ACRES|
        //       VL_AJUS_REDUC|VL_CRED_DIF|VL_CRED_DISP|IND_DESC_CRED|
        //       VL_CRED_DESC|SLD_CRED
        const record = {
          type: 'M500',
          codCred: (fields[1] || '').trim(),
          vlBcCofins: parseFloat(fields[3]) || 0,
          aliqCofins: parseFloat(fields[4]) || 0,
          vlCred: parseFloat(fields[7]) || 0,
          vlCredDisp: parseFloat(fields[11]) || 0,
          vlCredDesc: parseFloat(fields[13]) || 0,
          sldCred: parseFloat(fields[14]) || 0,
        };
        blockM.m500.push(record);
        rawStats.blockMRecords++;
        if (callbacks.onBlockM) callbacks.onBlockM(record);
        break;
      }

      // ── M505: Detalhamento COFINS por NAT ───────────────────────────────
      case 'M505': {
        // |M505|NAT_BC_CRED|IND_CRED_ORI|VL_BC_COFINS_TOT|
        //       VL_BC_COFINS_NC|VL_BC_COFINS_CUM|VL_BC_COFINS_REC
        const record = {
          type: 'M505',
          natBcCred: (fields[1] || '').trim(),
          vlBcCofinsTot: parseFloat(fields[3]) || 0,
          vlBcCofinsNc: parseFloat(fields[4]) || 0,
          vlBcCofinsCum: parseFloat(fields[5]) || 0,
        };
        blockM.m505.push(record);
        rawStats.blockMRecords++;
        if (callbacks.onBlockM) callbacks.onBlockM(record);
        break;
      }
    }

    // Progresso a cada 5000 linhas
    if (rawStats.totalLines % 5000 === 0 && callbacks.onProgress) {
      callbacks.onProgress(rawStats.totalLines, bytesRead, totalBytes);
    }
  }

  // ── Emissao de consolidados (dedup) ─────────────────────────────────────

  for (const entry of consolidatedBuffer) {
    const { rawItem, docCtx, docKey, docKeyQuality } = entry;

    // docKeyQuality LOW → sempre emitir (nao participa do dedup)
    // docKeyQuality HIGH → so emitir se docKey NAO tem item-level
    if (docKeyQuality === 'HIGH' && docHasItemLevel.get(docKey)) {
      rawStats.consolidatedSuppressed++;
      continue;
    }

    rawStats.consolidatedItems++;

    if (callbacks.onItem) {
      callbacks.onItem(rawItem, docCtx, lookups, {
        sourceDetail: 'consolidated',
        docKey,
        docKeyQuality,
      });
    }
  }

  // Progresso final
  if (callbacks.onProgress) {
    callbacks.onProgress(rawStats.totalLines, bytesRead, totalBytes);
  }

  return { rawStats, companyInfo, blockM };
}
