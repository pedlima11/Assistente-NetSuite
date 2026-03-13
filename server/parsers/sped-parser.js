/**
 * Parser event-based de arquivos SPED EFD ICMS/IPI.
 *
 * Leitura via fs.createReadStream + readline — memoria constante.
 * Emite callbacks por registro, sem reter documents/items em memoria.
 *
 * Registros processados: 0000, 0150, 0200, C100, C170.
 * Todos os demais sao ignorados.
 */

import {
  codMunToUF,
  extractRegisterType,
  splitLine,
  REJECTED_COD_SIT,
  buildAcceptedCodSit,
  createSpedReader,
  validateCompanyInfo,
  detectSpedFileType,
} from './sped-common.js';

// Re-export para manter compatibilidade com imports existentes
export { codMunToUF };

// Registros que nos interessam
const RELEVANT_REGISTERS = new Set(['0000', '0150', '0200', 'C100', 'C170']);

/**
 * Parser event-based de SPED EFD.
 *
 * @param {string} filePath - Caminho do arquivo .txt
 * @param {Object} options
 * @param {boolean} [options.includeComplementary=false] - Incluir COD_SIT 06, 07
 * @param {boolean} [options.includeSpecialRegime=false] - Incluir COD_SIT 08
 * @param {Object} callbacks
 * @param {Function} callbacks.onCompanyInfo - (info: { cnpj, uf, nome, codMun }) => void
 * @param {Function} callbacks.onParticipant - (codPart, data: { cnpj, codMun, nome }) => void
 * @param {Function} callbacks.onCatalogItem - (codItem, data: { ncm, descr }) => void
 * @param {Function} callbacks.onDocumentStart - (docCtx: { codPart, codSit, codMod, numDoc, serie, dtDoc, chvNfe }) => void
 * @param {Function} callbacks.onItem - (rawItem, docCtx, lookups) => void
 * @param {Function} [callbacks.onProgress] - (lineCount, bytesRead, totalBytes) => void
 * @returns {Promise<{ rawStats: Object }>}
 */
export async function parseSpedStream(filePath, options = {}, callbacks = {}) {
  const acceptedCodSit = buildAcceptedCodSit(options);

  const { rl, encoding, totalBytes } = await createSpedReader(filePath);

  const rawStats = {
    totalLines: 0,
    processedLines: 0,
    documentsRead: 0,
    documentsAccepted: 0,
    documentsRejectedByStatus: 0,
    skippedByCodSit: {},
  };

  // Contexto do documento C100 atual
  let currentDoc = null;
  let bytesRead = 0;

  // Lookups construidos durante o parsing
  const participants = new Map();
  const catalogItems = new Map();
  let companyInfo = null;

  const lookups = { participants, catalogItems, companyInfo: null };

  for await (const line of rl) {
    rawStats.totalLines++;
    bytesRead += Buffer.byteLength(line, encoding) + 1; // +1 for newline

    // Early filtering — extrair tipo sem split completo
    const regType = extractRegisterType(line);
    if (!RELEVANT_REGISTERS.has(regType)) continue;

    rawStats.processedLines++;
    const fields = splitLine(line);

    switch (regType) {
      case '0000': {
        // Detectar tipo de arquivo para rejeitar SPED Contribuicoes no slot errado
        const fileType = detectSpedFileType(fields);
        if (fileType === 'contrib') {
          throw new Error(
            'TIPO_ARQUIVO_INCORRETO: Arquivo SPED Contribuicoes (EFD PIS/COFINS) enviado como Fiscal. ' +
            'Envie este arquivo no campo "SPED Contribuicoes".'
          );
        }

        // |0000|COD_VER|COD_FIN|DT_INI|DT_FIN|NOME|CNPJ|CPF|UF|IE|COD_MUN|...
        companyInfo = {
          cnpj: (fields[6] || '').trim(),
          uf: (fields[8] || '').trim(),
          nome: (fields[5] || '').trim(),
          codMun: (fields[10] || '').trim(),
          dtIni: (fields[3] || '').trim(),
          dtFin: (fields[4] || '').trim(),
        };
        // Validar e corrigir campos do 0000
        const validation = validateCompanyInfo(companyInfo);
        if (validation.fixedUf) {
          companyInfo.uf = validation.fixedUf;
        }
        if (validation.warnings.length > 0) {
          for (const w of validation.warnings) {
            console.warn(`[SPED 0000] ${w}`);
          }
        }
        companyInfo._validationWarnings = validation.warnings;

        lookups.companyInfo = companyInfo;
        if (callbacks.onCompanyInfo) callbacks.onCompanyInfo(companyInfo);
        break;
      }

      case '0150': {
        // |0150|COD_PART|NOME|COD_PAIS|CNPJ|CPF|IE|COD_MUN|SUFRAMA|END|NUM|COMPL|BAIRRO|
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

      case '0200': {
        // |0200|COD_ITEM|DESCR_ITEM|COD_BARRA|COD_ANT_ITEM|UNID_INV|TIPO_ITEM|COD_NCM|...
        const codItem = (fields[1] || '').trim();
        const data = {
          ncm: (fields[7] || '').trim(),
          descr: (fields[2] || '').trim(),
        };
        catalogItems.set(codItem, data);
        if (callbacks.onCatalogItem) callbacks.onCatalogItem(codItem, data);
        break;
      }

      case 'C100': {
        // |C100|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|NUM_DOC|CHV_NFE|DT_DOC|DT_E_S|...
        currentDoc = null; // Reset

        const indOper = (fields[1] || '').trim();
        const codSit = (fields[5] || '').trim();

        rawStats.documentsRead++;

        // Filtrar apenas entradas
        if (indOper !== '0') break;

        // Filtrar COD_SIT
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

        currentDoc = {
          codPart: (fields[3] || '').trim(),
          codSit,
          codMod: (fields[4] || '').trim(),
          serie: (fields[6] || '').trim(),
          numDoc: (fields[7] || '').trim(),
          chvNfe: (fields[8] || '').trim(),
          dtDoc: (fields[9] || '').trim(),
        };

        if (callbacks.onDocumentStart) callbacks.onDocumentStart(currentDoc);
        break;
      }

      case 'C170': {
        // Somente processar se ha um C100 ativo (entrada aceita)
        if (!currentDoc) break;

        // Layout C170 (posicoes 1-based no guia, 0-based em fields[]):
        // 01=REG  02=NUM_ITEM  03=COD_ITEM  04=DESCR_COMPL  05=QTD
        // 06=UNID  07=VL_ITEM  08=VL_DESC  09=IND_MOV
        // 10=CST_ICMS  11=CFOP  12=COD_NAT  13=VL_BC_ICMS
        // 14=ALIQ_ICMS  15=VL_ICMS  16=VL_BC_ICMS_ST
        // 17=ALIQ_ST  18=VL_ICMS_ST  19=IND_APUR  20=CST_IPI
        // 21=COD_ENQ  22=VL_BC_IPI  23=ALIQ_IPI  24=VL_IPI
        // 25=CST_PIS  26=VL_BC_PIS  27=ALIQ_PIS(%)  28=QUANT_BC_PIS
        // 29=VL_PIS  30=CST_COFINS  31=VL_BC_COFINS  32=ALIQ_COFINS(%)
        // 33=QUANT_BC_COFINS  34=VL_COFINS  35=COD_CTA

        const rawItem = {
          _rawLine: line,
          numItem: (fields[1] || '').trim(),
          codItem: (fields[2] || '').trim(),
          descrCompl: (fields[3] || '').trim(),
          vlItem: parseFloat(fields[6]) || 0,
          // ICMS (fields 9-14)
          cstIcms: (fields[9] || '').trim(),
          cfop: (fields[10] || '').trim(),
          vlBcIcms: parseFloat(fields[12]) || 0,
          aliqIcms: parseFloat(fields[13]) || 0,
          vlIcms: parseFloat(fields[14]) || 0,
          // ICMS ST (fields 15-17)
          vlBcIcmsSt: parseFloat(fields[15]) || 0,
          aliqSt: parseFloat(fields[16]) || 0,
          vlIcmsSt: parseFloat(fields[17]) || 0,
          // IPI (fields 19, 21-23)
          cstIpi: (fields[19] || '').trim(),
          vlBcIpi: parseFloat(fields[21]) || 0,
          aliqIpi: parseFloat(fields[22]) || 0,
          vlIpi: parseFloat(fields[23]) || 0,
          // PIS (fields 24-28) — QUANT_BC_PIS em 27, VL_PIS em 28
          cstPis: (fields[24] || '').trim(),
          vlBcPis: parseFloat(fields[25]) || 0,
          aliqPis: parseFloat(fields[26]) || 0,
          vlPis: parseFloat(fields[28]) || 0,
          // COFINS (fields 29-33) — QUANT_BC_COFINS em 32, VL_COFINS em 33
          cstCofins: (fields[29] || '').trim(),
          vlBcCofins: parseFloat(fields[30]) || 0,
          aliqCofins: parseFloat(fields[31]) || 0,
          vlCofins: parseFloat(fields[33]) || 0,
          // Reforma tributaria CBS/IBS/IS.
          // C170 estendido: apos campo 35 (COD_CTA = fields[34]), ha 3 campos
          // adicionais (fields[35-37]) antes dos campos da reforma.
          // Posicoes baseadas no leiaute C170 com reforma:
          //   38=cClassTrib  39=CST_CBS  40=ALIQ_CBS  41=VL_BC_CBS  42=VL_CBS
          //   43=CST_IBS  44=ALIQ_IBS  45=VL_BC_IBS  46=VL_IBS
          //   47=CST_IS  48=ALIQ_IS  49=VL_BC_IS  50=VL_IS
          cClassTrib: (fields[38] || '').trim(),
          cstCbs: (fields[39] || '').trim(),
          aliqCbs: parseFloat(fields[40]) || 0,
          vlBcCbs: parseFloat(fields[41]) || 0,
          vlCbs: parseFloat(fields[42]) || 0,
          cstIbs: (fields[43] || '').trim(),
          aliqIbs: parseFloat(fields[44]) || 0,
          vlBcIbs: parseFloat(fields[45]) || 0,
          vlIbs: parseFloat(fields[46]) || 0,
          cstIs: (fields[47] || '').trim(),
          aliqIs: parseFloat(fields[48]) || 0,
          vlBcIs: parseFloat(fields[49]) || 0,
          vlIs: parseFloat(fields[50]) || 0,
        };

        if (callbacks.onItem) callbacks.onItem(rawItem, currentDoc, lookups);
        break;
      }
    }

    // Progresso a cada 5000 linhas
    if (rawStats.totalLines % 5000 === 0 && callbacks.onProgress) {
      callbacks.onProgress(rawStats.totalLines, bytesRead, totalBytes);
    }
  }

  // Progresso final
  if (callbacks.onProgress) {
    callbacks.onProgress(rawStats.totalLines, bytesRead, totalBytes);
  }

  return { rawStats, companyInfo };
}
