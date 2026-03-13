/**
 * Normalizador de itens SPED C170.
 *
 * Funcao pura que converte um rawItem (extraido pelo sped-parser)
 * em um item normalizado compativel com o tax-rule-generator.
 *
 * Classificacao:
 *   - accepted: item valido, entra na acumulacao de regras
 *   - warning: item aceito mas com dados incompletos (NCM, municipio)
 *   - rejected: item descartado (sem CFOP, sem participante, sem dado fiscal)
 */

import { codMunToUF } from '../parsers/sped-parser.js';
import { normalizeCnpj } from '../../shared/tax-rule-core.js';

/**
 * Valida cClassTrib: nao-vazio, nao "0", nao zeros repetidos.
 * cClassTrib valido e um codigo numerico de 6 digitos (ex: "410014").
 */
function isValidCClassTrib(raw) {
  const s = String(raw ?? '').trim();
  if (!s || /^0+$/.test(s)) return false;
  return true;
}

/**
 * Separa ORIG + CST do campo CST_ICMS do SPED (3 digitos).
 * Ex: '090' → { orig: '0', cst: '90' }
 *     '190' → { orig: '1', cst: '90' }
 *     '60'  → { orig: '', cst: '60' }  (já é CST puro, ex: vindo de XML)
 */
function splitOrigCst(raw) {
  if (!raw) return { orig: '', cst: '' };
  const s = raw.trim();
  if (s.length === 3) return { orig: s[0], cst: s.slice(1) };
  return { orig: '', cst: s };
}

// CSTs de PIS/COFINS validos para entrada (credito)
const PIS_COFINS_ENTRY_CST = new Set([
  '50', '51', '52', '53', '54', '55', '56',
  '60', '61', '62', '63', '64', '65', '66', '67',
  '70', '71', '72', '73', '74', '75',
  '98', '99',
]);

/**
 * Normaliza um item C170 bruto em item fiscal padronizado.
 *
 * @param {Object} rawItem - Item bruto do C170 (do sped-parser)
 * @param {Object} docCtx - Contexto do C100 pai
 * @param {Object} lookups - { participants: Map, catalogItems: Map, companyInfo }
 * @param {Object} [options]
 * @param {boolean} [options.requireNcm=false] - Se true, itens sem NCM sao rejeitados
 * @returns {{ item: Object|null, status: 'accepted'|'warning'|'rejected', reason?: string, warnings?: string[] }}
 */
export function normalizeItem(rawItem, docCtx, lookups, options = {}) {
  const { requireNcm = false, nsNcmMap = null } = options;
  const warnings = [];

  // ── Validacao basica ──────────────────────────────────────────────────────

  if (!rawItem.cfop) {
    return { item: null, status: 'rejected', reason: 'noCfop' };
  }

  // Resolver participante
  const participant = lookups.participants.get(docCtx.codPart);
  if (!participant) {
    return { item: null, status: 'rejected', reason: 'noParticipant' };
  }

  // Resolver NCM: prioridade NetSuite > SPED 0200
  const catalogItem = lookups.catalogItems.get(rawItem.codItem);
  const spedNcm = catalogItem?.ncm || '';
  const codItemTrimmed = (rawItem.codItem || '').trim();
  const nsNcm = nsNcmMap?.get(codItemTrimmed) || '';
  const ncm = nsNcm || spedNcm;

  if (!ncm) {
    if (requireNcm) {
      return { item: null, status: 'rejected', reason: 'noNcm' };
    }
    warnings.push('noNcm');
  } else if (/^0+$/.test(ncm)) {
    warnings.push('invalidNcm');
  }

  // CST_ICMS ausente: campo obrigatorio no C170 para documentos regulares
  if (!rawItem.cstIcms) {
    warnings.push('noIcmsCst');
  }

  // ── Extrair impostos ──────────────────────────────────────────────────────

  const taxes = [];

  // ICMS: CST preenchido (mesmo com valores zero — CST 40/41/50/60 sao significativos)
  // No SPED, CST_ICMS = ORIG (1 dig) + CST (2 dig). Ex: 090 = orig=0, cst=90
  const icmsOrigCst = splitOrigCst(rawItem.cstIcms);

  // CSTs passivos: nao tem aliquota ativa, valores no SPED sao informativos.
  // 60 = ST cobrada anteriormente, 40 = isento, 41 = nao tributada, 50 = suspensao.
  // Zerar aliq/bc/valor para evitar contaminacao de signatures/conflitos.
  // Preservar originais em info* para rastreabilidade do consultor.
  const PASSIVE_ICMS_CST = new Set(['60', '40', '41', '50']);

  if (rawItem.cstIcms) {
    const cst = icmsOrigCst.cst; // splitOrigCst ja retorna 2 chars
    const isPassive = PASSIVE_ICMS_CST.has(cst);
    const aliqVal = Number(rawItem.aliqIcms) || 0;
    const bcVal = Number(rawItem.vlBcIcms) || 0;
    const valorVal = Number(rawItem.vlIcms) || 0;
    const hasInfoValues = isPassive && (aliqVal > 0 || bcVal > 0 || valorVal > 0);

    const icmsTax = {
      type: 'ICMS',
      orig: icmsOrigCst.orig,
      cst,
      rawCst: rawItem.cstIcms,
      aliq: isPassive ? 0 : aliqVal,
      bc: isPassive ? 0 : bcVal,
      valor: isPassive ? 0 : valorVal,
      ...(hasInfoValues ? { infoAliq: aliqVal, infoBc: bcVal, infoValor: valorVal } : {}),
    };

    // Reducao BC inferida (CST 20/51): SPED C170 nao tem pRedBC.
    // Inferir pela relacao base/valor do item.
    const vlItemNum = Number(rawItem.vlItem) || 0;
    if ((cst === '20' || cst === '51') && vlItemNum > 0 && bcVal > 0) {
      const basePercent = bcVal / vlItemNum;
      if (basePercent < 0.99) {
        icmsTax._reducaoBC = parseFloat(((1 - basePercent) * 100).toFixed(2));
        icmsTax._reducaoSource = 'inferred_from_base';
      }
    }

    taxes.push(icmsTax);
  }

  // ICMS ST: so criar se houver evidencia monetaria real E o CST nao
  // indicar ST ja cobrada anteriormente.
  // CST 60 = "ICMS cobrado anteriormente por ST" — campos ST sao informativos,
  // nao representam nova cobranca. aliqSt sozinha nao e evidencia monetaria.
  const isStPreviouslyCollected = icmsOrigCst.cst === '60';
  const vlBcSt = Number(rawItem.vlBcIcmsSt || 0);
  const vlIcmsSt = Number(rawItem.vlIcmsSt || 0);
  const aliqSt = Number(rawItem.aliqSt || 0);
  const hasMonetaryStEvidence = vlBcSt > 0 || vlIcmsSt > 0;

  if (!isStPreviouslyCollected && hasMonetaryStEvidence) {
    // ST ativo: CST != 60 com evidencia monetaria
    taxes.push({
      type: 'ICMS_ST',
      orig: icmsOrigCst.orig,
      cst: icmsOrigCst.cst,
      rawCst: rawItem.cstIcms || '',
      aliq: aliqSt,
      bc: vlBcSt,
      valor: vlIcmsSt,
    });
  } else if (isStPreviouslyCollected && (vlIcmsSt > 0 || (vlBcSt > 0 && aliqSt > 0))) {
    // ST upstream passivo (CST 60): ST ja cobrada anteriormente pelo fornecedor.
    // Informativo — NAO gera determinacao ativa, NAO entra na active signature.
    taxes.push({
      type: 'ICMS_ST',
      orig: icmsOrigCst.orig,
      cst: '60',
      rawCst: rawItem.cstIcms || '',
      aliq: aliqSt,
      bc: vlBcSt,
      valor: vlIcmsSt,
      _passive: true,
      _stUpstream: true,
      _infoOnly: true,
    });
  }

  // IPI: CST preenchido (mesmo com aliq=0 — CST importa)
  if (rawItem.cstIpi) {
    taxes.push({
      type: 'IPI',
      cst: rawItem.cstIpi,
      aliq: rawItem.aliqIpi,
      bc: rawItem.vlBcIpi,
      valor: rawItem.vlIpi,
    });
  }

  // PIS: CST preenchido e dentro do range de entrada
  if (rawItem.cstPis && PIS_COFINS_ENTRY_CST.has(rawItem.cstPis)) {
    taxes.push({
      type: 'PIS',
      cst: rawItem.cstPis,
      aliq: rawItem.aliqPis,
      bc: rawItem.vlBcPis,
      valor: rawItem.vlPis,
    });
  }

  // COFINS: CST preenchido e dentro do range de entrada
  if (rawItem.cstCofins && PIS_COFINS_ENTRY_CST.has(rawItem.cstCofins)) {
    taxes.push({
      type: 'COFINS',
      cst: rawItem.cstCofins,
      aliq: rawItem.aliqCofins,
      bc: rawItem.vlBcCofins,
      valor: rawItem.vlCofins,
    });
  }

  // Reforma tributaria: CBS (se tiver dados reais)
  const validCClassTrib = isValidCClassTrib(rawItem.cClassTrib);
  const hasCbsData = !!rawItem.cstCbs || rawItem.aliqCbs > 0 || rawItem.vlCbs > 0;
  if (hasCbsData || validCClassTrib) {
    taxes.push({
      type: 'CBS',
      cst: rawItem.cstCbs || '',
      cClassTrib: validCClassTrib ? String(rawItem.cClassTrib).trim() : '',
      aliq: rawItem.aliqCbs || 0,
      bc: rawItem.vlBcCbs || 0,
      valor: rawItem.vlCbs || 0,
    });
  }

  // Reforma tributaria: IBS (se tiver dados reais)
  const hasIbsData = !!rawItem.cstIbs || rawItem.aliqIbs > 0 || rawItem.vlIbs > 0;
  if (hasIbsData || validCClassTrib) {
    // Evitar duplicar se so tem cClassTrib e CBS ja foi adicionado
    if (hasIbsData || !hasCbsData) {
      taxes.push({
        type: 'IBS',
        cst: rawItem.cstIbs || '',
        cClassTrib: validCClassTrib ? String(rawItem.cClassTrib).trim() : '',
        aliq: rawItem.aliqIbs || 0,
        bc: rawItem.vlBcIbs || 0,
        valor: rawItem.vlIbs || 0,
      });
    }
  }

  // Reforma tributaria: IS - Imposto Seletivo (se tiver dados)
  if (rawItem.cstIs || rawItem.aliqIs || rawItem.vlIs) {
    taxes.push({
      type: 'IS',
      cst: rawItem.cstIs || '',
      aliq: rawItem.aliqIs || 0,
      bc: rawItem.vlBcIs || 0,
      valor: rawItem.vlIs || 0,
    });
  }

  // Sem nenhum imposto extraido = item sem dado fiscal
  if (taxes.length === 0) {
    return { item: null, status: 'rejected', reason: 'noTaxData' };
  }

  // ── UF do participante ────────────────────────────────────────────────────

  const partUF = codMunToUF(participant.codMun);
  if (!partUF) {
    warnings.push('noMunicipality');
  }

  const partCnpj = normalizeCnpj(participant.cnpj);
  if (!partCnpj) {
    warnings.push('noCnpj');
  }

  // ── Montar item normalizado ───────────────────────────────────────────────

  const companyInfo = lookups.companyInfo || {};

  const item = {
    source: 'sped',
    nfeKey: docCtx.chvNfe || `${docCtx.numDoc}-${docCtx.serie}`,
    nNF: docCtx.numDoc,
    // Emissor = fornecedor (SPED entrada: quem emitiu a NF)
    emitCNPJ: partCnpj,
    emitCRT: null,  // SPED nao fornece CRT do fornecedor
    emitUF: partUF,
    emitCity: '',  // SPED nao fornece nome da cidade, apenas COD_MUN
    emitName: participant.nome || '',
    // Destinatario = empresa declarante
    destCNPJ: normalizeCnpj(companyInfo.cnpj),
    destUF: companyInfo.uf || '',
    destCity: '',
    // Dados fiscais
    cfop: rawItem.cfop,
    ncm,
    cClassTrib: rawItem.cClassTrib || '',
    documentModel: docCtx.codMod,
    documentStatus: docCtx.codSit,
    dtDoc: docCtx.dtDoc,
    dhEmi: docCtx.dtDoc,
    taxes,
    // Dados do item original para rastreabilidade
    codItem: rawItem.codItem,
    numItem: rawItem.numItem || '',
    descrCompl: rawItem.descrCompl,
    vlItem: rawItem.vlItem,
    _rawLine: rawItem._rawLine || null,
  };

  const status = warnings.length > 0 ? 'warning' : 'accepted';

  return { item, status, warnings: warnings.length > 0 ? warnings : undefined };
}
