/**
 * Merge SPED Fiscal + Contribuicoes.
 *
 * Combina regras ICMS/IPI do Fiscal com PIS/COFINS do Contribuicoes
 * por contextSignature em dois passes:
 *   Pass 1: Match preciso (com fiscalCategory)
 *   Pass 2: Match fallback (sem fiscalCategory)
 *
 * Sem match: PIS/COFINS do Fiscal vira fiscal_fallback.
 * Contrib sem match no Fiscal: regras standalone PIS/COFINS-only.
 */

import { classifyCFOP, normalizeCnpj } from '../../shared/tax-rule-core.js';

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
 * Merge resultados do Fiscal e Contribuicoes.
 *
 * @param {Object} fiscalResult - { rules, determinations, stats, qualityStats, ... }
 * @param {Object} contribResult - { rules, determinations, stats, qualityStats, ... }
 * @param {Object} [options]
 * @returns {{ rules, determinations, stats, mergeStats, warnings }}
 */
export function mergeResults(fiscalResult, contribResult, options = {}) {
  const warnings = [];

  // ── Validacao basica ────────────────────────────────────────────────────

  if (fiscalResult.companyInfo && contribResult.companyInfo) {
    const fiscalCnpj = normalizeCnpj(fiscalResult.companyInfo.cnpj);
    const contribCnpj = normalizeCnpj(contribResult.companyInfo.cnpj);
    if (fiscalCnpj && contribCnpj && fiscalCnpj !== contribCnpj) {
      warnings.push(`CNPJ divergente: Fiscal=${fiscalCnpj}, Contrib=${contribCnpj}`);
    }
  }

  // ── Indexar regras por signature ────────────────────────────────────────

  // Fiscal: indexar por signature base
  const fiscalRulesBySig = new Map();
  for (const rule of fiscalResult.rules) {
    const sig = contextSignature(rule);
    if (!fiscalRulesBySig.has(sig)) fiscalRulesBySig.set(sig, []);
    fiscalRulesBySig.get(sig).push(rule);
  }

  // Fiscal: indexar determinacoes por ruleExternalId
  const fiscalDetsByRule = new Map();
  for (const det of fiscalResult.determinations) {
    if (!fiscalDetsByRule.has(det.ruleExternalId)) {
      fiscalDetsByRule.set(det.ruleExternalId, []);
    }
    fiscalDetsByRule.get(det.ruleExternalId).push(det);
  }

  // Contrib: indexar determinacoes por ruleExternalId
  const contribDetsByRule = new Map();
  for (const det of contribResult.determinations) {
    if (!contribDetsByRule.has(det.ruleExternalId)) {
      contribDetsByRule.set(det.ruleExternalId, []);
    }
    contribDetsByRule.get(det.ruleExternalId).push(det);
  }

  // ── Merge ───────────────────────────────────────────────────────────────

  const mergedRules = [];
  const mergedDets = [];
  const matchedContribRuleIds = new Set();
  let mergeMatchCount = 0;
  let fallbackCount = 0;
  let standaloneContribCount = 0;

  // Para cada regra Fiscal: remover PIS/COFINS e injetar do Contrib
  for (const fiscalRule of fiscalResult.rules) {
    mergedRules.push(fiscalRule);

    const fiscalDets = fiscalDetsByRule.get(fiscalRule.externalId) || [];

    // Separar dets: ICMS/IPI (manter) vs PIS/COFINS (substituir)
    const nonPisCofins = [];
    const pisCofins = [];
    for (const det of fiscalDets) {
      if (det.codigoImposto === 'PIS_BR' || det.codigoImposto === 'COFINS_BR') {
        pisCofins.push(det);
      } else {
        nonPisCofins.push(det);
      }
    }

    // Manter ICMS/IPI/CBS/IBS/IS
    for (const det of nonPisCofins) {
      det._mergeSource = 'fiscal';
      mergedDets.push(det);
    }

    // Tentar match com Contrib
    const sig = contextSignature(fiscalRule);
    let matched = false;

    // Pass 1: match preciso (iterar contrib rules e checar se signature match)
    for (const contribRule of contribResult.rules) {
      if (matchedContribRuleIds.has(contribRule.externalId)) continue;
      const contribSig = contextSignature(contribRule);
      if (contribSig === sig) {
        // Match found
        const contribDets = contribDetsByRule.get(contribRule.externalId) || [];
        for (const det of contribDets) {
          det.ruleExternalId = fiscalRule.externalId;
          det._mergeSource = 'contrib';
          mergedDets.push(det);
        }
        matchedContribRuleIds.add(contribRule.externalId);
        matched = true;
        mergeMatchCount++;
        break;
      }
    }

    if (!matched) {
      // Manter PIS/COFINS Fiscal como fallback
      for (const det of pisCofins) {
        det._mergeSource = 'fiscal_fallback';
        mergedDets.push(det);
      }
      if (pisCofins.length > 0) fallbackCount++;
    }
  }

  // Contrib rules sem match → standalone PIS/COFINS-only
  for (const contribRule of contribResult.rules) {
    if (matchedContribRuleIds.has(contribRule.externalId)) continue;

    // Verificar se tem CFOP invalido → standalone/needs_review
    const cfopRaw = (contribRule.cfop || '').replace(/\./g, '');
    if (!cfopRaw || !/^\d{4}$/.test(cfopRaw)) {
      contribRule._needsReview = true;
    }

    contribRule._standaloneContrib = true;
    mergedRules.push(contribRule);

    const contribDets = contribDetsByRule.get(contribRule.externalId) || [];
    for (const det of contribDets) {
      det._mergeSource = 'contrib';
      mergedDets.push(det);
    }
    standaloneContribCount++;
  }

  // ── Stats ───────────────────────────────────────────────────────────────

  return {
    rules: mergedRules,
    determinations: mergedDets,
    stats: {
      totalRules: mergedRules.length,
      totalDeterminations: mergedDets.length,
      fiscalRules: fiscalResult.rules.length,
      contribRules: contribResult.rules.length,
      genericRules: mergedRules.filter(r => !r._isException).length,
      exceptionRules: mergedRules.filter(r => r._isException).length,
    },
    mergeStats: {
      mergeMatches: mergeMatchCount,
      fiscalFallbacks: fallbackCount,
      standaloneContrib: standaloneContribCount,
    },
    companyInfo: fiscalResult.companyInfo || contribResult.companyInfo,
    warnings,
  };
}
