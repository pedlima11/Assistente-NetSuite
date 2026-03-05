/**
 * Parser de XML NF-e (Nota Fiscal Eletronica).
 *
 * Roda no browser — File/Blob nao sao JSON-serializaveis
 * e nao podem ser enviados ao backend.
 *
 * Usa DOMParser nativo do browser (sem dependencias externas).
 */

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extrai texto de um elemento XML, retorna '' se nao existir.
 * Suporta path simples: 'emit/enderEmit/UF'
 */
function getText(parent, path) {
  if (!parent) return '';
  const parts = path.split('/');
  let el = parent;
  for (const part of parts) {
    el = el.getElementsByTagName(part)[0];
    if (!el) return '';
  }
  return (el.textContent || '').trim();
}

/**
 * Formata cidade no padrao "Cidade - UF" usado pelo template 160.
 */
function formatCity(cityName, uf) {
  if (!cityName) return '';
  return `${cityName} - ${uf}`;
}

// ── Tags ICMS ───────────────────────────────────────────────────────────────
// O XML NF-e usa tags diferentes por CST: ICMS00, ICMS10, ICMS20, etc.
// Precisamos detectar qual tag esta presente e extrair CST + aliquota.
const ICMS_TAGS = [
  'ICMS00', 'ICMS02', 'ICMS10', 'ICMS15', 'ICMS20', 'ICMS30',
  'ICMS40', 'ICMS41', 'ICMS50', 'ICMS51', 'ICMS60', 'ICMS61',
  'ICMS70', 'ICMS90',
  'ICMSSN101', 'ICMSSN102', 'ICMSSN201', 'ICMSSN202', 'ICMSSN500', 'ICMSSN900',
  'ICMSOutraUF', 'ICMSST',
];

/**
 * Extrai dados de ICMS de um elemento <imposto>.
 * Retorna { cst, aliq, bc, valor, orig, hasST, stAliq, stBC, stValor }
 */
function extractICMS(impostoEl) {
  const icmsEl = impostoEl.getElementsByTagName('ICMS')[0];
  if (!icmsEl) return null;

  // Encontrar qual tag ICMS esta presente
  for (const tag of ICMS_TAGS) {
    const el = icmsEl.getElementsByTagName(tag)[0];
    if (!el) continue;

    const cst = getText(el, 'CST') || getText(el, 'CSOSN') || '';
    const orig = getText(el, 'orig') || '0';

    // CSTs passivos: aliq no XML pode vir preenchida informativamente.
    // Zerar para evitar contaminacao de signatures. Preservar em info*.
    const PASSIVE_XML_CST = new Set(['60', '40', '41', '50', '500']);
    const isPassive = PASSIVE_XML_CST.has(cst);
    const rawAliq = parseFloat(getText(el, 'pICMS')) || 0;
    const rawBc = parseFloat(getText(el, 'vBC')) || 0;
    const rawValor = parseFloat(getText(el, 'vICMS')) || 0;
    const hasInfoValues = isPassive && (rawAliq > 0 || rawBc > 0 || rawValor > 0);

    const result = {
      type: 'ICMS',
      cst,
      aliq: isPassive ? 0 : rawAliq,
      bc: isPassive ? 0 : rawBc,
      valor: isPassive ? 0 : rawValor,
      orig,
      ...(hasInfoValues ? { infoAliq: rawAliq, infoBc: rawBc, infoValor: rawValor } : {}),
    };

    // ST dentro do mesmo grupo (CST 10, 30, 70, 201, 202, 203)
    // CST 60/500 = ST cobrada anteriormente — campos ST sao informativos.
    // aliqSt sozinha nao e evidencia. Exigir bc>0 ou valor>0.
    const isStPrevCollected = cst === '60' || cst === '500';
    const stBC = parseFloat(getText(el, 'vBCST')) || 0;
    const stAliq = parseFloat(getText(el, 'pICMSST')) || 0;
    const stValor = parseFloat(getText(el, 'vICMSST')) || 0;
    const hasMonetarySt = stBC > 0 || stValor > 0;
    if (!isStPrevCollected && hasMonetarySt) {
      result.hasST = true;
      result.stAliq = stAliq;
      result.stBC = stBC;
      result.stValor = stValor;
    }

    // Reducao de base
    const pRedBC = parseFloat(getText(el, 'pRedBC'));
    if (pRedBC) {
      result.reducaoBC = pRedBC;
    }

    // DIFAL (pode vir no ICMSUFDest)
    const difal = impostoEl.getElementsByTagName('ICMSUFDest')[0];
    if (difal) {
      result.difal = {
        aliqInterestadual: parseFloat(getText(difal, 'pICMSInter')) || 0,
        aliqInterna: parseFloat(getText(difal, 'pICMSInterPart')) || 0,
        aliqFCP: parseFloat(getText(difal, 'pFCPUFDest')) || 0,
        valorFCPDest: parseFloat(getText(difal, 'vFCPUFDest')) || 0,
        valorICMSDest: parseFloat(getText(difal, 'vICMSUFDest')) || 0,
        valorICMSOrig: parseFloat(getText(difal, 'vICMSUFRemet')) || 0,
      };
    }

    return result;
  }

  return null;
}

/**
 * Extrai dados de PIS de um elemento <imposto>.
 */
function extractPIS(impostoEl) {
  const pisEl = impostoEl.getElementsByTagName('PIS')[0];
  if (!pisEl) return null;

  // Variantes: PISAliq, PISQtde, PISNT, PISOutr
  const variants = ['PISAliq', 'PISQtde', 'PISNT', 'PISOutr'];
  for (const variant of variants) {
    const el = pisEl.getElementsByTagName(variant)[0];
    if (!el) continue;
    return {
      type: 'PIS',
      cst: getText(el, 'CST') || '',
      aliq: parseFloat(getText(el, 'pPIS')) || 0,
      bc: parseFloat(getText(el, 'vBC')) || 0,
      valor: parseFloat(getText(el, 'vPIS')) || 0,
    };
  }
  return null;
}

/**
 * Extrai dados de COFINS de um elemento <imposto>.
 */
function extractCOFINS(impostoEl) {
  const cofinsEl = impostoEl.getElementsByTagName('COFINS')[0];
  if (!cofinsEl) return null;

  const variants = ['COFINSAliq', 'COFINSQtde', 'COFINSNT', 'COFINSOutr'];
  for (const variant of variants) {
    const el = cofinsEl.getElementsByTagName(variant)[0];
    if (!el) continue;
    return {
      type: 'COFINS',
      cst: getText(el, 'CST') || '',
      aliq: parseFloat(getText(el, 'pCOFINS')) || 0,
      bc: parseFloat(getText(el, 'vBC')) || 0,
      valor: parseFloat(getText(el, 'vCOFINS')) || 0,
    };
  }
  return null;
}

/**
 * Extrai dados de IPI de um elemento <imposto>.
 */
function extractIPI(impostoEl) {
  const ipiEl = impostoEl.getElementsByTagName('IPI')[0];
  if (!ipiEl) return null;

  // Variantes: IPITrib, IPINT
  const variants = ['IPITrib', 'IPINT'];
  for (const variant of variants) {
    const el = ipiEl.getElementsByTagName(variant)[0];
    if (!el) continue;
    return {
      type: 'IPI',
      cst: getText(el, 'CST') || '',
      aliq: parseFloat(getText(el, 'pIPI')) || 0,
      bc: parseFloat(getText(el, 'vBC')) || 0,
      valor: parseFloat(getText(el, 'vIPI')) || 0,
    };
  }
  return null;
}

/**
 * Extrai dados de ISSQN de um elemento <imposto>.
 */
function extractISS(impostoEl) {
  const issEl = impostoEl.getElementsByTagName('ISSQN')[0];
  if (!issEl) return null;

  return {
    type: 'ISS',
    cst: '',
    aliq: parseFloat(getText(issEl, 'vAliq')) || 0,
    bc: parseFloat(getText(issEl, 'vBC')) || 0,
    valor: parseFloat(getText(issEl, 'vISSQN')) || 0,
    cListServ: getText(issEl, 'cListServ'),
    cMunFG: getText(issEl, 'cMunFG'),
  };
}

/**
 * Extrai dados do Imposto Seletivo (IS) de um elemento <imposto>.
 * Grupo XML definido pela NT 2025.002 (versao vigente no Portal NF-e).
 */
function extractIS(impostoEl) {
  // Tentar variantes de tag: ImpSelet, impSelet, IMPSELET
  const tagCandidates = ['ImpSelet', 'impSelet', 'IMPSELET'];
  let isEl = null;
  for (const tag of tagCandidates) {
    isEl = impostoEl.getElementsByTagName(tag)[0];
    if (isEl) break;
  }
  if (!isEl) return null;

  return {
    type: 'IS',
    cst: getText(isEl, 'CST') || '',
    aliq: parseFloat(getText(isEl, 'pIS')) || parseFloat(getText(isEl, 'pImpSelet')) || 0,
    bc: parseFloat(getText(isEl, 'vBC')) || 0,
    valor: parseFloat(getText(isEl, 'vIS')) || parseFloat(getText(isEl, 'vImpSelet')) || 0,
  };
}

/**
 * Extrai dados de IBS e CBS de um elemento <imposto>.
 * Grupo XML definido pela NT 2025.002 (versao vigente no Portal NF-e).
 * Retorna array com ate 2 objetos (um CBS, um IBS), ou array vazio.
 */
function extractIBSCBS(impostoEl) {
  // Tentar variantes de tag: IBSCBS, IBSCBSTrib, ibscbs
  const tagCandidates = ['IBSCBS', 'IBSCBSTrib', 'ibscbs'];
  let ibscbsEl = null;
  for (const tag of tagCandidates) {
    ibscbsEl = impostoEl.getElementsByTagName(tag)[0];
    if (ibscbsEl) break;
  }

  // Fallback: procurar variantes internas se grupo externo nao encontrado
  if (!ibscbsEl) {
    const innerCandidates = ['IBSCBSAliq', 'IBSCBSNT', 'IBSCBSOutr'];
    for (const tag of innerCandidates) {
      ibscbsEl = impostoEl.getElementsByTagName(tag)[0];
      if (ibscbsEl) break;
    }
  }
  if (!ibscbsEl) return [];

  const cClassTrib = getText(ibscbsEl, 'cClassTrib') || '';
  const cstCBS = getText(ibscbsEl, 'CSTCBS') || getText(ibscbsEl, 'CST') || '';
  const cstIBS = getText(ibscbsEl, 'CSTIBS') || cstCBS;

  const result = [];

  // CBS (federal)
  const aliqCBS = parseFloat(getText(ibscbsEl, 'pCBS')) || 0;
  const vlCBS = parseFloat(getText(ibscbsEl, 'vCBS')) || 0;
  const bcCBS = parseFloat(getText(ibscbsEl, 'vBCCBS')) || parseFloat(getText(ibscbsEl, 'vBC')) || 0;
  if (aliqCBS || vlCBS || cClassTrib) {
    result.push({
      type: 'CBS',
      cst: cstCBS,
      cClassTrib,
      aliq: aliqCBS,
      bc: bcCBS,
      valor: vlCBS,
    });
  }

  // IBS (estadual/municipal)
  const aliqIBS = parseFloat(getText(ibscbsEl, 'pIBS')) || 0;
  const vlIBS = parseFloat(getText(ibscbsEl, 'vIBS')) || 0;
  const bcIBS = parseFloat(getText(ibscbsEl, 'vBCIBS')) || parseFloat(getText(ibscbsEl, 'vBC')) || 0;
  if (aliqIBS || vlIBS || cClassTrib) {
    result.push({
      type: 'IBS',
      cst: cstIBS,
      cClassTrib,
      aliq: aliqIBS,
      bc: bcIBS,
      valor: vlIBS,
    });
  }

  return result;
}

// ── Parser principal ────────────────────────────────────────────────────────

/**
 * Extrai todos os itens fiscais de um documento XML NF-e parseado.
 * @param {Document} xmlDoc - Documento XML parseado pelo DOMParser
 * @returns {Object[]} Array de itens com todos os campos fiscais
 */
function extractItems(xmlDoc) {
  const items = [];

  // Pode ter multiplas NFe no mesmo arquivo (lote)
  const nfeList = xmlDoc.getElementsByTagName('NFe');
  const nfeCount = nfeList.length || 1;

  for (let n = 0; n < nfeCount; n++) {
    const nfe = nfeList[n] || xmlDoc;
    const infNFe = nfe.getElementsByTagName('infNFe')[0];
    if (!infNFe) continue;

    // Chave de acesso (atributo Id da infNFe)
    const nfeKey = (infNFe.getAttribute('Id') || '').replace('NFe', '');

    // Header da NF-e
    const header = {
      nfeKey,
      nfeNumber: getText(infNFe, 'ide/nNF'),
      series: getText(infNFe, 'ide/serie'),
      dhEmi: getText(infNFe, 'ide/dhEmi'),
      natOp: getText(infNFe, 'ide/natOp'),
      finNFe: getText(infNFe, 'ide/finNFe'),
      tpNF: getText(infNFe, 'ide/tpNF'),
      // Emitente
      emitCNPJ: getText(infNFe, 'emit/CNPJ') || getText(infNFe, 'emit/CPF'),
      emitCRT: getText(infNFe, 'emit/CRT'),
      emitUF: getText(infNFe, 'emit/enderEmit/UF'),
      emitCity: formatCity(getText(infNFe, 'emit/enderEmit/xMun'), getText(infNFe, 'emit/enderEmit/UF')),
      emitName: getText(infNFe, 'emit/xNome'),
      emitCodMun: getText(infNFe, 'emit/enderEmit/cMun'),
      // Destinatario
      destCNPJ: getText(infNFe, 'dest/CNPJ') || getText(infNFe, 'dest/CPF'),
      destUF: getText(infNFe, 'dest/enderDest/UF'),
      destCity: formatCity(getText(infNFe, 'dest/enderDest/xMun'), getText(infNFe, 'dest/enderDest/UF')),
      destCodMun: getText(infNFe, 'dest/enderDest/cMun'),
    };

    // Itens (<det>)
    const detList = infNFe.getElementsByTagName('det');
    for (let i = 0; i < detList.length; i++) {
      const det = detList[i];
      const prod = det.getElementsByTagName('prod')[0];
      const imposto = det.getElementsByTagName('imposto')[0];

      if (!prod || !imposto) continue;

      // Impostos
      const taxes = [];
      const icms = extractICMS(imposto);
      if (icms) {
        taxes.push(icms);
        // ST como registro separado se presente
        if (icms.hasST) {
          taxes.push({
            type: 'ICMSST',
            cst: icms.cst,
            aliq: icms.stAliq,
            bc: icms.stBC,
            valor: icms.stValor,
          });
        }
        // DIFAL como registro separado se presente
        if (icms.difal) {
          taxes.push({
            type: 'ICMSDIFAL',
            cst: icms.cst,
            aliq: icms.difal.aliqInterestadual,
            bc: 0,
            valor: icms.difal.valorICMSDest,
          });
          if (icms.difal.aliqFCP) {
            taxes.push({
              type: 'FCP',
              cst: '',
              aliq: icms.difal.aliqFCP,
              bc: 0,
              valor: icms.difal.valorFCPDest,
            });
          }
        }
      }

      const pis = extractPIS(imposto);
      if (pis) taxes.push(pis);

      const cofins = extractCOFINS(imposto);
      if (cofins) taxes.push(cofins);

      const ipi = extractIPI(imposto);
      if (ipi) taxes.push(ipi);

      const iss = extractISS(imposto);
      if (iss) taxes.push(iss);

      // Reforma tributaria: IS (Imposto Seletivo) + IBS/CBS
      const is = extractIS(imposto);
      if (is) taxes.push(is);

      const ibscbs = extractIBSCBS(imposto);
      if (ibscbs.length > 0) taxes.push(...ibscbs);

      // Extrair cClassTrib do nivel do item (pode vir no prod ou nos impostos)
      const cClassTrib = getText(prod, 'cClassTrib')
        || ibscbs.find(t => t.cClassTrib)?.cClassTrib
        || '';

      items.push({
        ...header,
        nItem: det.getAttribute('nItem') || String(i + 1),
        // Produto
        cfop: getText(prod, 'CFOP'),
        ncm: getText(prod, 'NCM'),
        cest: getText(prod, 'CEST'),
        cClassTrib,
        itemDesc: getText(prod, 'xProd'),
        itemCode: getText(prod, 'cProd'),
        vlItem: parseFloat(getText(prod, 'vProd')) || 0,
        // Raw snippet para Evidence Panel (serializado do <det>)
        _rawSnippet: new XMLSerializer().serializeToString(det),
        // Impostos
        taxes,
      });
    }
  }

  return items;
}

// ── API publica ─────────────────────────────────────────────────────────────

/**
 * Faz parse de um unico arquivo XML de NF-e.
 * @param {File} file - Objeto File do browser
 * @returns {Promise<{ fileName: string, items: Object[], errors: string[] }>}
 */
export async function parseNFeFile(file) {
  const errors = [];

  try {
    const text = await file.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(text, 'application/xml');

    // Verificar erros de parsing
    const parseError = xmlDoc.getElementsByTagName('parsererror')[0];
    if (parseError) {
      return {
        fileName: file.name,
        items: [],
        errors: [`XML invalido: ${parseError.textContent.substring(0, 200)}`],
      };
    }

    // Verificar se eh uma NF-e
    const hasNFe = xmlDoc.getElementsByTagName('NFe').length > 0
      || xmlDoc.getElementsByTagName('infNFe').length > 0;

    if (!hasNFe) {
      // Pode ser um nfeProc (NF-e com protocolo de autorizacao)
      const nfeProc = xmlDoc.getElementsByTagName('nfeProc')[0];
      if (!nfeProc) {
        return {
          fileName: file.name,
          items: [],
          errors: ['Arquivo nao parece ser uma NF-e valida (tag NFe ou infNFe nao encontrada)'],
        };
      }
    }

    const items = extractItems(xmlDoc);

    if (items.length === 0) {
      errors.push('Nenhum item (<det>) encontrado na NF-e');
    }

    return {
      fileName: file.name,
      items,
      errors,
    };
  } catch (e) {
    return {
      fileName: file.name,
      items: [],
      errors: [`Erro ao processar ${file.name}: ${e.message}`],
    };
  }
}

/**
 * Faz parse de multiplos arquivos XML de NF-e.
 * @param {File[]} files - Array de objetos File
 * @param {Object} [options]
 * @param {Function} [options.onProgress] - (current, total, fileName) => void
 * @param {Function} [options.shouldCancel] - () => boolean — se retornar true, aborta
 * @returns {Promise<{ items: Object[], stats: Object, errors: Object[], cancelled?: boolean }>}
 */
export async function parseNFeFiles(files, { onProgress, shouldCancel } = {}) {
  const allItems = [];
  const allErrors = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < files.length; i++) {
    if (shouldCancel && shouldCancel()) {
      return {
        items: allItems,
        stats: buildStats(files.length, successCount, failCount, allItems),
        errors: allErrors,
        cancelled: true,
      };
    }

    if (onProgress) onProgress(i + 1, files.length, files[i].name);

    // Yield ao event loop a cada arquivo para manter browser responsivo
    await new Promise(r => setTimeout(r, 0));

    const result = await parseNFeFile(files[i]);

    if (result.items.length > 0) {
      allItems.push(...result.items);
      successCount++;
    }

    if (result.errors.length > 0) {
      allErrors.push({ fileName: result.fileName, errors: result.errors });
      if (result.items.length === 0) failCount++;
    }
  }

  return {
    items: allItems,
    stats: buildStats(files.length, successCount, failCount, allItems),
    errors: allErrors,
  };
}

function buildStats(totalFiles, successCount, failCount, allItems) {
  return {
    totalFiles,
    successFiles: successCount,
    failedFiles: failCount,
    totalItems: allItems.length,
    uniqueCFOPs: [...new Set(allItems.map(i => i.cfop))].length,
    uniqueNCMs: [...new Set(allItems.map(i => i.ncm).filter(Boolean))].length,
    uniqueUFs: [...new Set([
      ...allItems.map(i => i.emitUF),
      ...allItems.map(i => i.destUF),
    ].filter(Boolean))].length,
  };
}
