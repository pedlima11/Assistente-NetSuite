/**
 * Algoritmos compartilhados de assinatura e estatisticas de regras fiscais.
 *
 * FONTE UNICA — ambos os motores (SPED e XML) CHAMAM estas funcoes.
 * Nenhum motor faz filter/map/join inline para assinaturas.
 * Nenhum motor constroi sigMap inline — sempre addToSigMap().
 *
 * Importado por:
 *   - server/services/sped-rule-accumulator.js
 *   - src/services/tax-rule-generator.js
 */

import { isPassiveTax, makeTaxSignature, CANONICAL_TAX_TYPE } from './tax-rule-core.js';
import { THRESHOLDS } from './rule-thresholds.js';

// ── Active Signature ────────────────────────────────────────────────────────

/**
 * FONTE UNICA de assinatura ativa. Ambos os motores CHAMAM esta funcao.
 * Filtra passivos, gera makeTaxSignature normalizado, sort deterministico.
 *
 * @param {Object[]} taxes - Array de impostos do item
 * @returns {string} Ex: "COFINS:01:7.6000||ICMS:00:18.0000||PIS:01:1.6500"
 */
export function buildActiveSignature(taxes) {
  return taxes
    .filter(t => !isPassiveTax(t))
    .map(t => makeTaxSignature(t))
    .sort()
    .join('||');
}

// ── Key Taxes Signature (para clusters com menos ruido) ─────────────────────

/** Impostos que geram excecoes reais — ICMS + IPI apenas (sem ICMS_ST) */
const KEY_TAX_TYPES = new Set(['ICMS', 'IPI']);

/**
 * Assinatura apenas por key taxes (ICMS + IPI) — menos ruido para clusters.
 * ICMS_ST NAO incluido (geraria excesso de excecoes).
 *
 * @param {Object[]} taxes
 * @returns {string}
 */
export function buildKeyTaxesSignature(taxes) {
  return taxes
    .filter(t => {
      const ct = CANONICAL_TAX_TYPE[t.type] || t.type;
      return !isPassiveTax(t) && KEY_TAX_TYPES.has(ct);
    })
    .map(t => makeTaxSignature(t))
    .sort()
    .join('||');
}

// ── sigMap accumulation ─────────────────────────────────────────────────────

const NCM_CAP = 500;

/**
 * Acumula item no sigMap. FONTE UNICA de acumulacao — impede divergencia SPED/XML.
 *
 * Contrato:
 * - taxes: snapshot dos impostos ativos do PRIMEIRO item visto (para UI)
 * - totalValue: soma de vlItem (nunca base, nunca valor de imposto)
 * - ncms: Set com cap NCM_CAP, flag ncmsCapped se atingido
 *
 * @param {Map<string, Object>} sigMap
 * @param {string} signature - resultado de buildActiveSignature(taxes)
 * @param {Object} item - { taxes: Object[], vlItem: number, ncm: string }
 */
export function addToSigMap(sigMap, signature, item) {
  if (!sigMap.has(signature)) {
    const activeTaxes = item.taxes.filter(t => !isPassiveTax(t));
    const passiveTaxes = item.taxes.filter(t => isPassiveTax(t));
    sigMap.set(signature, {
      count: 0,
      taxes: activeTaxes,
      passiveTaxes,
      ncms: new Set(),
      ncmsCapped: false,
      totalValue: 0,
    });
  }
  const entry = sigMap.get(signature);
  entry.count++;
  entry.totalValue += item.vlItem || 0;
  if (item.ncm) {
    if (entry.ncms.size < NCM_CAP) {
      entry.ncms.add(item.ncm);
    } else {
      entry.ncmsCapped = true;
    }
  }
}

// ── Signature Summary ───────────────────────────────────────────────────────

/**
 * Gera resumo de distribuicao de assinaturas.
 * sigMap DEVE ter sido construido com buildActiveSignature() como chave.
 *
 * @param {Map<string, Object>} sigMap
 * @param {string} mainSig - assinatura principal (determinada pelo motor)
 * @returns {Array<{ signature, count, percent, totalValue, taxes, ncmCount, isMain }>}
 */
export function buildSignatureSummary(sigMap, mainSig) {
  const limit = THRESHOLDS.SIGNATURE_SUMMARY_LIMIT;
  const totalItems = [...sigMap.values()].reduce((s, e) => s + e.count, 0);
  return [...sigMap.entries()]
    .map(([sig, data]) => ({
      signature: sig,
      count: data.count,
      percent: totalItems > 0 ? parseFloat(((data.count / totalItems) * 100).toFixed(1)) : 0,
      totalValue: parseFloat((data.totalValue || 0).toFixed(2)),
      taxes: (data.taxes || []).map(t => ({ type: t.type, cst: t.cst, aliq: t.aliq })),
      ncmCount: data.ncms instanceof Set ? data.ncms.size : (data.ncms?.length || 0),
      isMain: sig === mainSig,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// ── NCM Clusters ────────────────────────────────────────────────────────────

/**
 * Gera clusters NCM com distribuicao de assinaturas.
 * NAO deve ser chamado em regras filhas (_isException === true).
 *
 * Internamente chama buildActiveSignature ou buildKeyTaxesSignature
 * conforme clusterMode — nenhum callback externo.
 *
 * @param {Map<string, Array<{ taxes: Object[], vlItem: number }>>} ncmItems
 * @param {'full'|'keyTaxes'} [clusterMode='keyTaxes']
 * @returns {Array<{ ncm, itemCount, totalValue, dominantSignature, dominantPercent, hasConflict }>}
 */
export function buildNcmClusters(ncmItems, clusterMode = 'keyTaxes') {
  const limit = THRESHOLDS.NCM_CLUSTERS_LIMIT;
  const minItems = THRESHOLDS.NCM_CLUSTER_MIN_ITEMS;
  const sigFn = clusterMode === 'keyTaxes' ? buildKeyTaxesSignature : buildActiveSignature;
  const clusters = [];

  for (const [ncm, items] of ncmItems) {
    if (ncm === '_sem_ncm') continue;
    if (items.length < minItems) continue;

    const sigCounts = new Map();
    let totalValue = 0;
    for (const { taxes, vlItem } of items) {
      totalValue += vlItem || 0;
      const sig = sigFn(taxes);
      sigCounts.set(sig, (sigCounts.get(sig) || 0) + 1);
    }
    const sorted = [...sigCounts.entries()].sort((a, b) => b[1] - a[1]);
    const dominantCount = sorted[0]?.[1] || 0;

    clusters.push({
      ncm,
      itemCount: items.length,
      totalValue: parseFloat(totalValue.toFixed(2)),
      dominantSignature: sorted[0]?.[0] || '',
      dominantPercent: items.length > 0
        ? parseFloat(((dominantCount / items.length) * 100).toFixed(1))
        : 0,
      hasConflict: sorted.length > 1
        && sorted[1][1] >= items.length * THRESHOLDS.NCM_EXCEPTION_MIN_PERCENT,
    });
  }
  return clusters.sort((a, b) => b.itemCount - a.itemCount).slice(0, limit);
}

// ── Rule Metrics ────────────────────────────────────────────────────────────

/**
 * Calcula metricas de confianca a partir do signatureSummary.
 *
 * @param {Array} signatureSummary - resultado de buildSignatureSummary()
 * @returns {{ confidenceScore: number, hasConflict: boolean }}
 */
export function computeRuleMetrics(signatureSummary) {
  const mainSig = signatureSummary?.find(s => s.isMain);
  return {
    confidenceScore: mainSig ? mainSig.percent : 0,
    hasConflict: (signatureSummary?.length || 0) > 1,
  };
}
