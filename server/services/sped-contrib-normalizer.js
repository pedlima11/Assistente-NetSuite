/**
 * Normalizador de itens SPED EFD Contribuicoes.
 *
 * Converte rawItems do sped-contrib-parser em itens normalizados
 * compativeis com o tax-rule-generator / sped-rule-accumulator.
 *
 * Produz APENAS taxes PIS/COFINS (source='contrib').
 *
 * NAT_BC_CRED policy:
 *   1. Explicito no SPED (A170, C181/C185, C191/C195, F100) → usar direto
 *   2. Nao explicito (C170) → lookup fiscalCategory → categoryToNat → NAT
 *   3. Sem resolucao → natMissing: true → revisao manual
 *
 * Nunca infere NAT por CFOP. Nunca chuta NAT.
 */

import { codMunToUF } from '../parsers/sped-common.js';
import { normalizeCnpj } from '../../shared/tax-rule-core.js';
import {
  resolveNatFromCategory,
  suggestFiscalCategory,
  isPisCofinsCreditCst,
} from '../../src/data/fiscal-categories.js';
import { classifyCFOP } from '../../shared/tax-rule-core.js';

/**
 * Normaliza um item do SPED Contribuicoes em item fiscal padronizado.
 *
 * @param {Object} rawItem - Item bruto do parser (A170/C170/C181/C185/C191/C195/F100)
 * @param {Object} docCtx - Contexto do documento pai (A100/C100/F100 fabricado)
 * @param {Object} lookups - { participants, catalogItems, companyInfo }
 * @param {Object} meta - { sourceDetail, docKey, docKeyQuality }
 * @param {Object} [options]
 * @param {Object} [options.categoryToNat] - Mapeamento custom categoria→NAT
 * @param {Set<string>|string[]} [options.creditCstList] - CSTs de credito custom
 * @param {Map<string,string>} [options.itemCategories] - codItem → fiscalCategory
 * @returns {{ item: Object|null, status: 'accepted'|'warning'|'rejected', reason?: string, warnings?: string[] }}
 */
export function normalizeContribItem(rawItem, docCtx, lookups, meta, options = {}) {
  const warnings = [];

  // ── Resolver participante ───────────────────────────────────────────────

  const participant = lookups.participants.get(docCtx.codPart);
  if (!participant && docCtx.blockType !== 'F') {
    return { item: null, status: 'rejected', reason: 'noParticipant' };
  }

  // ── Resolver NCM via catalogo ───────────────────────────────────────────

  const catalogItem = rawItem.codItem ? lookups.catalogItems.get(rawItem.codItem) : null;
  const ncm = catalogItem?.ncm || '';

  // ── Resolver CFOP ───────────────────────────────────────────────────────

  const cfop = rawItem.cfop || '';

  // ── Extrair taxes PIS/COFINS ────────────────────────────────────────────

  const taxes = [];

  // Resolver NAT_BC_CRED
  const natResult = resolveNat(rawItem, lookups, options);

  // PIS
  if (rawItem.cstPis) {
    taxes.push({
      type: 'PIS',
      cst: rawItem.cstPis,
      aliq: rawItem.aliqPis || 0,
      bc: rawItem.vlBcPis || 0,
      valor: rawItem.vlPis || 0,
      natBcCred: natResult.nat || '',
      natMissing: natResult.natMissing,
      natSource: natResult.natSource,
      fiscalCategoryUsed: natResult.fiscalCategoryUsed,
      source: 'contrib',
      sourceDetail: meta.sourceDetail,
      docKeyQuality: meta.docKeyQuality,
    });
  }

  // COFINS
  if (rawItem.cstCofins) {
    taxes.push({
      type: 'COFINS',
      cst: rawItem.cstCofins,
      aliq: rawItem.aliqCofins || 0,
      bc: rawItem.vlBcCofins || 0,
      valor: rawItem.vlCofins || 0,
      natBcCred: natResult.nat || '',
      natMissing: natResult.natMissing,
      natSource: natResult.natSource,
      fiscalCategoryUsed: natResult.fiscalCategoryUsed,
      source: 'contrib',
      sourceDetail: meta.sourceDetail,
      docKeyQuality: meta.docKeyQuality,
    });
  }

  // Sem nenhum imposto = item sem dado fiscal
  if (taxes.length === 0) {
    return { item: null, status: 'rejected', reason: 'noTaxData' };
  }

  // ── Warnings ────────────────────────────────────────────────────────────

  if (natResult.natMissing) {
    // Verificar se algum tax eh CST de credito (bloqueia export)
    const hasCredit = taxes.some(t =>
      isPisCofinsCreditCst(t.cst, options.creditCstList)
    );
    if (hasCredit) {
      warnings.push('natMissingCredit');
    } else {
      warnings.push('natMissing');
    }
  }

  if (!ncm) warnings.push('noNcm');

  const partUF = participant ? codMunToUF(participant.codMun) : '';
  if (!partUF && docCtx.blockType !== 'F') warnings.push('noMunicipality');

  const partCnpj = participant ? normalizeCnpj(participant.cnpj) : '';
  if (!partCnpj && docCtx.blockType !== 'F') warnings.push('noCnpj');

  // ── Montar item normalizado ─────────────────────────────────────────────

  const companyInfo = lookups.companyInfo || {};

  const item = {
    source: 'contrib',
    nfeKey: docCtx.chvNfe || `${docCtx.numDoc}-${docCtx.serie}`,
    nNF: docCtx.numDoc,
    emitCNPJ: partCnpj,
    emitCRT: null,
    emitUF: partUF,
    emitCity: '',
    destCNPJ: normalizeCnpj(companyInfo.cnpj),
    destUF: companyInfo.uf || '',
    destCity: '',
    cfop,
    ncm,
    cClassTrib: '',
    documentModel: docCtx.codMod,
    documentStatus: docCtx.codSit,
    dtDoc: docCtx.dtDoc,
    dhEmi: docCtx.dtDoc,
    taxes,
    codItem: rawItem.codItem || '',
    descrCompl: rawItem.descrCompl || '',
    vlItem: rawItem.vlItem || 0,
    _registerType: rawItem._registerType,
    _docKey: meta.docKey,
    _docKeyQuality: meta.docKeyQuality,
    _sourceDetail: meta.sourceDetail,
  };

  const status = warnings.length > 0 ? 'warning' : 'accepted';
  return { item, status, warnings: warnings.length > 0 ? warnings : undefined };
}

/**
 * Resolve NAT_BC_CRED para um rawItem.
 *
 * Prioridade:
 *   1. Explicito no rawItem.natBcCred (A170, C181/C185, C191/C195, F100)
 *   2. fiscalCategory do item (via options.itemCategories) → categoryToNat
 *   3. Sugestao via classifyCFOP (se CFOP disponivel)
 *   4. natMissing: true
 *
 * @returns {{ nat: string|null, natMissing: boolean, natSource: string, fiscalCategoryUsed: string|null }}
 */
function resolveNat(rawItem, lookups, options) {
  // 1. Explicito no SPED
  if (rawItem.natBcCred) {
    return {
      nat: rawItem.natBcCred,
      natMissing: false,
      natSource: 'explicit_sped',
      fiscalCategoryUsed: null,
    };
  }

  // 2. Lookup por fiscalCategory configurada para o item
  if (options.itemCategories && rawItem.codItem) {
    const category = options.itemCategories.get(rawItem.codItem);
    if (category) {
      const result = resolveNatFromCategory(category, options.categoryToNat);
      return {
        ...result,
        fiscalCategoryUsed: category,
      };
    }
  }

  // 3. Sugestao via classifyCFOP (se CFOP disponivel) — apenas como sugestao automatica
  if (rawItem.cfop) {
    const { itemCategory } = classifyCFOP(rawItem.cfop);
    const suggestedCategory = suggestFiscalCategory(itemCategory);
    if (suggestedCategory) {
      const result = resolveNatFromCategory(suggestedCategory, options.categoryToNat);
      if (!result.natMissing) {
        return {
          ...result,
          natSource: 'category_mapping',
          fiscalCategoryUsed: suggestedCategory,
        };
      }
    }
  }

  // 4. Sem resolucao
  return {
    nat: null,
    natMissing: true,
    natSource: 'missing',
    fiscalCategoryUsed: null,
  };
}
