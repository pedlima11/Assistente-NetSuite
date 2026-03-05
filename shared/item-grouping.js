/**
 * Item Grouping — funcoes puras para agrupar items por documento,
 * recalcular stats de regras apos reassignment,
 * e computar evidence groups para a sidebar.
 *
 * Roda em browser + Node. Sem dependencias externas (exceto tax-rule-core).
 *
 * @module item-grouping
 */

import { classifyCFOP, normalizeCFOP, getActiveIcmsTax, CANONICAL_TAX_TYPE } from './tax-rule-core.js';

/**
 * Agrupa items[] flat em documentos (por nfeKey / nNF).
 *
 * @param {Object[]} items
 * @returns {Object[]} documents sorted by dtDoc DESC
 */
export function groupItemsByDocument(items) {
  const docMap = new Map();

  for (const item of items) {
    const docKey = item.nfeKey || item.nNF || item._itemId;
    if (!docMap.has(docKey)) {
      docMap.set(docKey, {
        docKey,
        nNF: item.nNF || '',
        nfeKey: item.nfeKey || '',
        dtDoc: item.dtDoc || '',
        emitCNPJ: item.emitCNPJ || '',
        emitName: item.emitName || '',
        emitUF: item.emitUF || '',
        items: [],
        itemCount: 0,
        totalValue: 0,
      });
    }
    const doc = docMap.get(docKey);
    doc.items.push(item);
    doc.itemCount++;
    doc.totalValue += item.vlItem || 0;
  }

  // Calcular assignedRuleIds e isDivergent
  const docs = [...docMap.values()];
  for (const doc of docs) {
    const ruleIds = new Set();
    for (const item of doc.items) {
      if (item.assignedRuleId) ruleIds.add(item.assignedRuleId);
    }
    doc.assignedRuleIds = ruleIds;
    doc.isDivergent = ruleIds.size > 1;
  }

  // Ordenar por data DESC
  docs.sort((a, b) => {
    if (a.dtDoc && b.dtDoc) return b.dtDoc.localeCompare(a.dtDoc);
    return 0;
  });

  return docs;
}

/**
 * Recalcula stats de DUAS regras afetadas (source + target).
 * O(items dessas 2 regras), NAO O(todos items).
 *
 * @param {Object[]} items - todos items
 * @param {Object|null} sourceRule - regra que perdeu item (pode ser null se vem de "sem regra")
 * @param {Object|null} targetRule - regra que ganhou item (pode ser null se vai para "sem regra")
 * @returns {{ source: Object|null, target: Object|null }}
 */
export function recalcAffectedRules(items, sourceRule, targetRule) {
  const result = { source: null, target: null };

  if (sourceRule) {
    result.source = recalcSingleRule(items, sourceRule);
  }
  if (targetRule) {
    result.target = recalcSingleRule(items, targetRule);
  }

  return result;
}

/**
 * Recalcula stats de uma unica regra a partir dos items atuais.
 *
 * @param {Object[]} allItems
 * @param {Object} rule
 * @returns {Object} regra com stats atualizados
 */
function recalcSingleRule(allItems, rule) {
  let itemCount = 0;
  let totalValue = 0;

  for (const item of allItems) {
    if (item.assignedRuleId === rule.externalId) {
      itemCount++;
      totalValue += item.vlItem || 0;
    }
  }

  return {
    ...rule,
    _nfeCount: itemCount,
    _totalValue: totalValue,
    ruleStats: {
      ...rule.ruleStats,
      items: itemCount,
    },
    evidence: {
      ...rule.evidence,
      itemCount,
      totalValue,
    },
  };
}

// ── Evidence Groups ─────────────────────────────────────────────────────────

/**
 * Agrupa items por rota fiscal (chave identica a makeRuleKey)
 * e computa resumo ICMS (nivel 1) em single-pass.
 *
 * NAO armazena items[]. Apenas itemIds (Set) + contadores + CST/aliq aggregados.
 * Breakdown por NCM (nivel 2) e computado lazy via computeNcmBreakdown().
 *
 * @param {Object[]} items - items normalizados (sem _rejected)
 * @returns {Object[]} groups sorted por itemCount DESC
 */
export function buildEvidenceGroups(items) {
  const groupMap = new Map();

  for (const item of items) {
    if (!item.cfop) continue;

    const cfop = item.cfopNormalized || normalizeCFOP(item.cfop);
    const { direction, operationType } = classifyCFOP(cfop);
    const emitUF = (item.emitUF || '').toUpperCase();
    const destUF = (item.destUF || '').toUpperCase();
    const key = [direction, emitUF, destUF, cfop, operationType].join('|');

    if (!groupMap.has(key)) {
      groupMap.set(key, {
        groupKey: key,
        cfop, direction, operationType, emitUF, destUF,
        itemIds: new Set(),
        itemCount: 0,
        totalValue: 0,
        _ncmSet: new Set(),
        _cstMap: new Map(), // cst → { count, totalValue, rates: Map<aliq, count> }
      });
    }

    const g = groupMap.get(key);
    g.itemIds.add(item._itemId);
    g.itemCount++;
    g.totalValue += item.vlItem || 0;
    if (item.ncm) g._ncmSet.add(item.ncm);

    // Nivel 1: ICMS resumo (sem NCM)
    const icms = getActiveIcmsTax(item.taxes);
    const cst = icms?.cst || '_none';
    if (!g._cstMap.has(cst)) {
      g._cstMap.set(cst, { count: 0, totalValue: 0, rates: new Map() });
    }
    const entry = g._cstMap.get(cst);
    entry.count++;
    entry.totalValue += item.vlItem || 0;
    const aliq = icms?.aliq || 0;
    entry.rates.set(aliq, (entry.rates.get(aliq) || 0) + 1);
  }

  // Finalizar: converter _cstMap → icmsEvidence
  const groups = [...groupMap.values()].map(g => {
    const cstGroups = [...g._cstMap.entries()].map(([cst, d]) => ({
      cst,
      count: d.count,
      totalValue: d.totalValue,
      rates: [...d.rates.entries()]
        .map(([aliq, count]) => ({ aliq, count }))
        .sort((a, b) => b.count - a.count),
      isConsistent: d.rates.size === 1,
    })).sort((a, b) => b.count - a.count);

    return {
      groupKey: g.groupKey,
      cfop: g.cfop, direction: g.direction, operationType: g.operationType,
      emitUF: g.emitUF, destUF: g.destUF,
      itemIds: g.itemIds,
      itemCount: g.itemCount,
      totalValue: g.totalValue,
      ncmCount: g._ncmSet.size,
      icmsEvidence: {
        cstGroups,
        isConsistent: cstGroups.every(c => c.isConsistent),
      },
    };
  });

  groups.sort((a, b) => b.itemCount - a.itemCount);
  return groups;
}

/**
 * Nivel 2 (lazy): breakdown por NCM para um grupo expandido.
 * Chamado sob demanda na UI quando usuario expande o grupo.
 *
 * Retorna detalhamento por tipo de imposto (ICMS, IPI, PIS, COFINS, etc.)
 * em vez de apenas ICMS, para que a UI mostre exatamente qual imposto
 * tem CST divergente.
 *
 * @param {Set<string>} groupItemIds
 * @param {Map<string, Object>} itemById - indice _itemId → item
 * @returns {{ ncmGroups: Object[], isConsistent: boolean }}
 */
export function computeNcmBreakdown(groupItemIds, itemById) {
  const ncmMap = new Map();

  for (const id of groupItemIds) {
    const item = itemById.get(id);
    if (!item) continue;

    const ncm = item.ncm || '_sem_ncm';
    if (!ncmMap.has(ncm)) {
      ncmMap.set(ncm, { taxTypeMap: new Map(), itemCount: 0, totalValue: 0 });
    }
    const n = ncmMap.get(ncm);
    n.itemCount++;
    n.totalValue += item.vlItem || 0;

    // Agrupar por tipo de imposto canônico
    for (const tax of (item.taxes || [])) {
      const taxType = CANONICAL_TAX_TYPE[tax.type] || (tax.type || '').toUpperCase();
      if (!taxType) continue;

      if (!n.taxTypeMap.has(taxType)) {
        n.taxTypeMap.set(taxType, new Map()); // cst → { count, rates: Map<aliq, count> }
      }
      const cstMap = n.taxTypeMap.get(taxType);
      const cst = tax.cst || '_none';
      if (!cstMap.has(cst)) {
        cstMap.set(cst, { count: 0, rates: new Map() });
      }
      const entry = cstMap.get(cst);
      entry.count++;
      const aliq = tax.aliq || 0;
      entry.rates.set(aliq, (entry.rates.get(aliq) || 0) + 1);
    }
  }

  const ncmGroups = [...ncmMap.entries()]
    .map(([ncm, data]) => {
      // Converter taxTypeMap → taxTypes[]
      const taxTypes = [...data.taxTypeMap.entries()].map(([taxType, cstMap]) => {
        const cstGroups = [...cstMap.entries()].map(([cst, d]) => ({
          cst,
          count: d.count,
          rates: [...d.rates.entries()]
            .map(([aliq, count]) => ({ aliq, count }))
            .sort((a, b) => b.count - a.count),
          isConsistent: d.rates.size === 1,
        })).sort((a, b) => b.count - a.count);

        return {
          taxType,
          cstGroups,
          isConsistent: cstGroups.length === 1 && cstGroups[0].isConsistent,
        };
      }).sort((a, b) => a.taxType.localeCompare(b.taxType));

      return {
        ncm,
        itemCount: data.itemCount,
        totalValue: data.totalValue,
        taxTypes,
        isConsistent: taxTypes.every(t => t.isConsistent),
      };
    })
    .sort((a, b) => b.itemCount - a.itemCount);

  return { ncmGroups, isConsistent: ncmGroups.every(n => n.isConsistent) };
}
