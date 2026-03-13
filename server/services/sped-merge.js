/**
 * Merge SPED Fiscal + Contribuicoes no nivel de item.
 *
 * Combina items ICMS/IPI do Fiscal com PIS/COFINS do Contribuicoes
 * por match em 2 camadas (codItem → numItem), ambas com disciplina de unicidade.
 *
 * Motor agnostico: nao sugere, nao infere. Le os dois arquivos e mostra
 * como as notas foram escrituradas, para o usuario decidir.
 */

import { classifyCFOP } from '../../shared/tax-rule-core.js';

/**
 * Gera contextSignature para uma regra.
 *
 * @param {Object} rule
 * @param {Object} [options]
 * @param {string} [options.fiscalCategory] - Incluir fiscalCategory na signature
 * @returns {string}
 */
export function contextSignature(rule, options = {}) {
  const cfopRaw = (rule.cfop || '').replace(/\./g, '');

  // Defesa contra CFOP invalido
  if (!cfopRaw || !/^\d{4}$/.test(cfopRaw)) {
    return `UNKNOWN|${rule.ufEmissor || ''}|${rule.ufDestinatario || ''}|UNKNOWN|UNKNOWN`;
  }

  const { direction } = classifyCFOP(cfopRaw);
  const { operationType } = classifyCFOP(cfopRaw);

  const parts = [
    direction,
    rule.ufEmissor || '',
    rule.ufDestinatario || '',
    cfopRaw,
    operationType,
  ];

  if (options.fiscalCategory) {
    parts.push(options.fiscalCategory);
  }

  return parts.join('|');
}

/**
 * Merge itens SPED Fiscal + Contribuicoes no nivel de item.
 *
 * Estrategia de match em 2 camadas (dentro do mesmo documento/nfeKey):
 *   1. nfeKey + codItem (produto, univoco) → _mergeSource: 'matched_coditem'
 *   2. nfeKey + numItem (sequencial, univoco) → _mergeSource: 'matched_numitem'
 *      Ambiguo (>1 candidato em qualquer camada) → nao casa, contabiliza ambiguousSkips.
 *
 * Consolidados (C181/C185/C191/C195) sem codItem/numItem → sempre standalone.
 * A170/F100 sem match fiscal → standalone (NAO entram na geracao de regras de
 * entrada de mercadoria — ficam em visao auxiliar para o usuario decidir).
 *
 * Quando match:
 *   - Preserva ICMS/IPI/CBS/IBS/IS do fiscal
 *   - Substitui PIS/COFINS pelo contrib (com natBcCred)
 *
 * @param {Object[]} fiscalItems
 * @param {Object[]} contribItems
 * @returns {{ items: Object[], mergeStats: Object }}
 */
export function mergeItems(fiscalItems, contribItems) {
  const matchableContrib = [];
  const standaloneContrib = [];

  for (const ci of contribItems) {
    if (!ci.codItem && !ci.numItem) {
      standaloneContrib.push({ ...ci, _mergeSource: 'contrib_standalone' });
      continue;
    }
    matchableContrib.push(ci);
  }

  const contribByDoc = new Map();
  for (const ci of matchableContrib) {
    if (!contribByDoc.has(ci.nfeKey)) contribByDoc.set(ci.nfeKey, []);
    contribByDoc.get(ci.nfeKey).push(ci);
  }

  const mergedItems = [];
  let matchesByCodItem = 0;
  let matchesByNumItem = 0;
  let ambiguousSkips = 0;
  let fiscalFallbacks = 0;

  for (const fi of fiscalItems) {
    const docContribs = contribByDoc.get(fi.nfeKey);

    if (docContribs && docContribs.length > 0) {
      let matchIdx = -1;
      let matchType = '';
      let wasAmbiguous = false;

      // Layer 1: codItem — so se univoco
      if (fi.codItem) {
        const codCandidates = docContribs.filter(ci => ci.codItem === fi.codItem);
        if (codCandidates.length === 1) {
          matchIdx = docContribs.indexOf(codCandidates[0]);
          matchType = 'matched_coditem';
        } else if (codCandidates.length > 1) {
          wasAmbiguous = true;
        }
      }

      // Layer 2: numItem — so se univoco
      if (matchIdx < 0 && fi.numItem) {
        const candidates = docContribs.filter(ci => ci.numItem === fi.numItem);
        if (candidates.length === 1) {
          matchIdx = docContribs.indexOf(candidates[0]);
          matchType = 'matched_numitem';
        } else if (candidates.length > 1) {
          wasAmbiguous = true;
        }
      }

      // Max 1 ambiguous skip por item fiscal
      if (matchIdx < 0 && wasAmbiguous) ambiguousSkips++;

      if (matchIdx >= 0) {
        const ci = docContribs.splice(matchIdx, 1)[0];
        if (docContribs.length === 0) contribByDoc.delete(fi.nfeKey);

        const nonPisCofins = fi.taxes.filter(t => t.type !== 'PIS' && t.type !== 'COFINS');
        const contribPisCofins = ci.taxes.filter(t => t.type === 'PIS' || t.type === 'COFINS');

        mergedItems.push({
          ...fi,
          taxes: [...nonPisCofins, ...contribPisCofins],
          _mergeSource: matchType,
        });
        if (matchType === 'matched_coditem') matchesByCodItem++;
        else matchesByNumItem++;
        continue;
      }
    }

    // Sem match → manter PIS/COFINS fiscal como fallback
    const hasPisCofins = fi.taxes.some(t => t.type === 'PIS' || t.type === 'COFINS');
    mergedItems.push({
      ...fi,
      _mergeSource: hasPisCofins ? 'fiscal_fallback' : 'fiscal_only',
    });
    if (hasPisCofins) fiscalFallbacks++;
  }

  // Contrib matchable restante → standalone
  for (const remaining of contribByDoc.values()) {
    for (const ci of remaining) {
      standaloneContrib.push({ ...ci, _mergeSource: 'contrib_standalone' });
    }
  }

  return {
    items: [...mergedItems, ...standaloneContrib],
    mergeStats: {
      mergeMatches: matchesByCodItem + matchesByNumItem,
      matchesByCodItem,
      matchesByNumItem,
      ambiguousSkips,
      fiscalFallbacks,
      standaloneContrib: standaloneContrib.length,
    },
  };
}
