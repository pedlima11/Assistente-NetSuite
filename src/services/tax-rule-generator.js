/**
 * Motor de normalizacao de items fiscais.
 *
 * Recebe itens parseados dos XMLs de NF-e e retorna items normalizados + stats.
 * NAO gera regras nem determinacoes — essas sao criadas pelo usuario na UI.
 *
 * Funcoes de classificacao compartilhadas com o backend
 * ficam em shared/tax-rule-core.js.
 */

import {
  classifyCFOP,
  makeRuleKey,
  makeTaxSignature,
  formatCFOP,
} from '../../shared/tax-rule-core.js';

// Re-export for any code that imports these from here
export { makeRuleKey, makeTaxSignature };

// ── Motor principal ─────────────────────────────────────────────────────────

/**
 * Normaliza items parseados e computa stats basicos.
 *
 * @param {Object[]} parsedItems - Itens retornados pelo nfe-parser
 * @param {Object} config - Configuracao do usuario
 * @returns {{ items: Object[], stats: Object }}
 */
export function generateTaxRules(parsedItems, config) {
  if (!parsedItems || parsedItems.length === 0) {
    return { items: [], stats: { totalItems: 0, totalGroups: 0 } };
  }

  const effectiveConfig = { ...config, source: config.source || 'xml' };

  // ── Normalizar items ──────────────────────────────────────────────────────
  const groupKeys = new Set();
  const cfopSet = new Set();
  const ncmSet = new Set();
  const ufSet = new Set();
  const unknownTypes = new Set();

  let itemSeq = 0;
  const items = [];

  for (const item of parsedItems) {
    if (!item.cfop) continue;

    const key = makeRuleKey(item, effectiveConfig);
    groupKeys.add(key);

    cfopSet.add(formatCFOP(item.cfop));
    if (item.ncm) ncmSet.add(item.ncm);
    if (item.emitUF) ufSet.add(item.emitUF);
    if (item.destUF) ufSet.add(item.destUF);

    // Track unknown tax types
    for (const t of (item.taxes || [])) {
      const { direction } = classifyCFOP(item.cfop);
      if (!t.type) unknownTypes.add('_empty');
    }

    items.push({
      _itemId: `item-${itemSeq++}`,
      assignedRuleId: null,
      nfeKey: item.nfeKey,
      nNF: item.nfeNumber || item.nNF,
      dtDoc: item.dhEmi || item.dtDoc,
      serie: item.series || item.serie || '',
      emitCNPJ: item.emitCNPJ,
      emitUF: item.emitUF,
      emitName: item.emitName || '',
      destUF: item.destUF,
      cfop: item.cfop,
      ncm: item.ncm,
      vlItem: item.vlItem,
      codItem: item.itemCode || item.codItem || '',
      descrCompl: item.itemDesc || item.descrCompl || '',
      // Campos de servico (NFS-e)
      sourceType: item.sourceType || 'nfe',
      documentModel: item.documentModel || 'NFE',
      cfopSource: item.cfopSource || 'xml',
      cListServ: item.cListServ || '',
      cnae: item.cnae || '',
      cMunFG: item.cMunFG || '',
      issRetido: item.issRetido || false,
      taxes: (item.taxes || []).map(t => ({
        type: t.type, cst: t.cst, aliq: t.aliq, bc: t.bc, valor: t.valor,
        cClassTrib: t.cClassTrib || '',
        retention: t.retention || false,
        role: t.role || 'main',
        cMunFG: t.cMunFG || '',
      })),
      source: effectiveConfig.source || 'xml',
    });
  }

  return {
    items,
    stats: {
      totalItems: items.length,
      totalGroups: groupKeys.size,
      uniqueCFOPs: cfopSet.size,
      uniqueNCMs: ncmSet.size,
      uniqueUFs: ufSet.size,
      unknownTypes: unknownTypes.size > 0 ? [...unknownTypes] : [],
    },
  };
}
