/**
 * Rule Alerts — funcao pura que gera alertas para uma regra fiscal.
 *
 * Usada por:
 *   - List view (RuleCard) para alertas inline
 *   - Studio (FiscalReviewStudio buildIssues) para backlog
 *
 * NAO depende de React, i18n ou DOM. Apenas dados.
 *
 * @module rule-alerts
 */

/**
 * Gera array de alertas para uma regra e suas determinacoes.
 *
 * @param {Object} rule - Regra fiscal (com conflicts, hasConflict, _passiveTaxes, etc.)
 * @param {Object[]} ruleDets - Determinacoes desta regra
 * @returns {Array<{ reason: string, meta: Object, ruleId: string }>}
 */
export function buildRuleAlerts(rule, ruleDets) {
  const alerts = [];

  // 1. Conflitos existentes (de conflicts[])
  if (rule.conflicts && rule.conflicts.length > 0) {
    for (const c of rule.conflicts) {
      const isRate = c.conflictType === 'rate';
      const reason = isRate ? 'RATE_CONFLICT' : 'STRUCTURAL_CONFLICT';

      const meta = {
        taxType: c.taxType,
        conflictType: c.conflictType,
        signatures: c.signatures,
        detail: c.detail,
      };

      // Extrair dados para interpolacao do translateWarning
      if (isRate) {
        meta.aliqA = c.signatures?.[0]?.aliq ?? '';
        meta.aliqB = c.signatures?.[1]?.aliq ?? '';
      } else {
        meta.withST = c.detail?.withST ?? c.detail?.passive ?? '';
        meta.withoutST = c.detail?.withoutST ?? c.detail?.active ?? '';
      }

      alerts.push({ reason, meta, ruleId: rule.externalId });
    }
  }

  // 2. Multi-assinatura sem conflicts explicitos
  if (rule.hasConflict && (!rule.conflicts || rule.conflicts.length === 0)) {
    alerts.push({
      reason: 'MULTI_SIGNATURE',
      meta: { confidence: rule.confidenceScore },
      ruleId: rule.externalId,
    });
  }

  // 3. Confianca baixa (< 70%)
  if (rule.confidenceScore != null && rule.confidenceScore < 70 &&
      // Evitar duplicar com MULTI_SIGNATURE se ja foi emitido
      !(rule.hasConflict && (!rule.conflicts || rule.conflicts.length === 0))) {
    alerts.push({
      reason: 'LOW_CONFIDENCE',
      meta: { confidence: rule.confidenceScore },
      ruleId: rule.externalId,
    });
  }

  // 4. Parametros nao resolvidos em determinacoes
  if (ruleDets) {
    for (const det of ruleDets) {
      if (!det._unresolvedParam) continue;

      let reason;
      if (det._unresolvedReason === 'no_suggestion') {
        reason = 'PARAMTYPE_NO_SUGGESTION';
      } else if (det._unresolvedReason === 'no_env_match') {
        reason = 'PARAMTYPE_NO_ENV_MATCH';
      } else {
        reason = 'PARAMTYPE_MISSING';
      }

      alerts.push({
        reason,
        meta: {
          taxType: det.codigoImposto,
          suggestedParam: det._suggestedParam || '',
          cst: det._cst,
        },
        ruleId: rule.externalId,
        detExternalId: det.externalId,
      });
    }
  }

  // 5. ST upstream (passivo CST 60)
  if (rule._passiveTaxes && rule._passiveTaxes.some(t => t._stUpstream)) {
    alerts.push({
      reason: 'PASSIVE_TAX_INFO',
      meta: { cst: '60' },
      ruleId: rule.externalId,
    });
  }

  // 6. Reducao de base inferida
  if (rule._reducaoBCStats) {
    alerts.push({
      reason: 'REDUCAO_INFERRED',
      meta: {
        mean: rule._reducaoBCStats.mean,
        confidence: rule._reducaoBCStats.confidence,
      },
      ruleId: rule.externalId,
    });
  }

  return alerts;
}
