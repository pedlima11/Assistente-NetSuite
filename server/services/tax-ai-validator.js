/**
 * AI Validator (pos-IA).
 *
 * Responsabilidades:
 * 1. Rebaixar severity "error" para "warning" (IA nao pode emitir error)
 * 2. Recalcular allowedValues do schema (_aiSuggestedValues para auditoria)
 * 3. Rejeitar patches sem evidence ou com selectedValue invalido
 * 4. Truncar alem de 150 issues / 80 patches / 3 patches por regra
 * 5. Marcar tudo da IA com requiresUserApproval = true
 * 6. Recalcular risk
 */

const MAX_ISSUES = 150;
const MAX_PATCHES = 80;
const MAX_PATCHES_PER_RULE = 3;

const VALID_TAX_CODES = new Set([
  'ICMS_BR', 'ICMS_ST_BR', 'IPI_BR', 'PIS_BR', 'COFINS_BR', 'ISS_BR',
  'CBS_2026_BR', 'IBS_2026_BR', 'IS_2026_BR',
]);

const VALID_SEVERITIES = new Set(['warning', 'info']);

/**
 * Valida e normaliza o output bruto da IA.
 *
 * @param {Object} rawOutput - { issues[], proposedChanges[], explanations? }
 * @param {Object[]} rules
 * @param {Object[]} determinations
 * @param {string} contextHash
 * @param {Object[]} auditEvents - Array mutavel para logar eventos
 * @returns {{ issues: Object[], proposedChanges: Object[] }}
 */
export function validateAIOutput(rawOutput, rules, determinations, contextHash, auditEvents) {
  const ts = new Date().toISOString();

  if (!rawOutput || typeof rawOutput !== 'object') {
    auditEvents.push({
      eventType: 'REJECT_AI_OUTPUT',
      source: 'validator',
      actor: 'system',
      reason: 'AI output is not a valid object',
      contextHash,
      ts,
    });
    return { issues: [], proposedChanges: [] };
  }

  // Indexar entidades validas
  const ruleIds = new Set(rules.map(r => r.externalId));
  const detIds = new Set(determinations.map(d => d.externalId));

  // ── Validar issues ──────────────────────────────────────────────────────
  const rawIssues = Array.isArray(rawOutput.issues) ? rawOutput.issues : [];
  const validIssues = [];

  for (const issue of rawIssues) {
    if (!issue || typeof issue !== 'object') continue;

    // Rebaixar error → warning
    if (issue.severity === 'error') {
      auditEvents.push({
        eventType: 'DOWNGRADE_SEVERITY',
        source: 'validator',
        actor: 'system',
        ruleExternalId: issue.ruleExternalId || null,
        field: issue.field || null,
        oldValue: 'error',
        newValue: 'warning',
        reason: 'IA emitiu error — rebaixado para warning',
        contextHash,
        ts,
      });
      issue.severity = 'warning';
    }

    // Validar severity
    if (!VALID_SEVERITIES.has(issue.severity)) {
      issue.severity = 'info';
    }

    // Validar referencia a regra existente
    if (issue.ruleExternalId && !ruleIds.has(issue.ruleExternalId)) {
      continue; // Regra inexistente, descartar
    }

    // Validar campos obrigatorios
    if (!issue.id || !issue.message) continue;

    issue.requiresUserApproval = true;
    issue.sourceType = issue.sourceType || 'heuristic';
    validIssues.push(issue);
  }

  // Truncar issues
  if (validIssues.length > MAX_ISSUES) {
    auditEvents.push({
      eventType: 'TRUNCATE_OUTPUT',
      source: 'validator',
      actor: 'system',
      field: 'issues',
      oldValue: validIssues.length,
      newValue: MAX_ISSUES,
      reason: `Truncado de ${validIssues.length} para ${MAX_ISSUES} issues`,
      contextHash,
      ts,
    });
  }
  const finalIssues = validIssues.slice(0, MAX_ISSUES);

  // ── Validar proposedChanges ─────────────────────────────────────────────
  const rawPatches = Array.isArray(rawOutput.proposedChanges) ? rawOutput.proposedChanges : [];
  const validPatches = [];
  const patchCountByRule = new Map();

  for (const patch of rawPatches) {
    if (!patch || typeof patch !== 'object') continue;

    // Campos obrigatorios
    if (!patch.id || !patch.ruleExternalId || !patch.field) continue;

    // Referencia a regra existente
    if (!ruleIds.has(patch.ruleExternalId)) continue;

    // Referencia a determinacao existente (se especificada)
    if (patch.determinationExternalId && !detIds.has(patch.determinationExternalId)) continue;

    // Evidence obrigatoria
    if (!patch.evidence || typeof patch.evidence !== 'object') {
      auditEvents.push({
        eventType: 'REJECT_PATCH_VALIDATOR',
        source: 'validator',
        actor: 'system',
        ruleExternalId: patch.ruleExternalId,
        determinationExternalId: patch.determinationExternalId || null,
        field: patch.field,
        reason: 'Patch rejeitado: sem evidence',
        contextHash,
        ts,
      });
      continue;
    }

    // Validar selectedValue contra schema (recalcular allowedValues)
    const allowedValues = getAllowedValues(patch.field, patch.ruleExternalId, rules, determinations);
    if (allowedValues && patch.selectedValue) {
      if (!allowedValues.includes(patch.selectedValue)) {
        auditEvents.push({
          eventType: 'REJECT_PATCH_VALIDATOR',
          source: 'validator',
          actor: 'system',
          ruleExternalId: patch.ruleExternalId,
          determinationExternalId: patch.determinationExternalId || null,
          field: patch.field,
          oldValue: patch.selectedValue,
          reason: `selectedValue "${patch.selectedValue}" nao esta em allowedValues`,
          contextHash,
          ts,
        });
        continue;
      }
    }

    // Max 3 patches por regra
    const ruleCount = patchCountByRule.get(patch.ruleExternalId) || 0;
    if (ruleCount >= MAX_PATCHES_PER_RULE) continue;
    patchCountByRule.set(patch.ruleExternalId, ruleCount + 1);

    // Recalcular risk
    patch.risk = calculateRisk(patch, rules, determinations);
    patch.requiresUserApproval = true;
    validPatches.push(patch);
  }

  // Truncar patches
  if (validPatches.length > MAX_PATCHES) {
    auditEvents.push({
      eventType: 'TRUNCATE_OUTPUT',
      source: 'validator',
      actor: 'system',
      field: 'proposedChanges',
      oldValue: validPatches.length,
      newValue: MAX_PATCHES,
      reason: `Truncado de ${validPatches.length} para ${MAX_PATCHES} patches`,
      contextHash,
      ts,
    });
  }
  const finalPatches = validPatches.slice(0, MAX_PATCHES);

  return {
    issues: finalIssues,
    proposedChanges: finalPatches,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Recalcula allowedValues para um campo a partir do schema.
 * Retorna null se o campo nao tem restricao de enum.
 */
function getAllowedValues(field, ruleExternalId, rules, determinations) {
  if (field === 'codigoImposto') {
    return [...VALID_TAX_CODES];
  }
  // Para outros campos, sem restricao de enum estrita
  return null;
}

/**
 * Recalcula risk baseado no impacto do patch.
 */
function calculateRisk(patch, rules, determinations) {
  // Mudanca em codigoImposto ou aliquota → high
  if (patch.field === 'codigoImposto' || patch.field === 'aliquota') {
    return 'high';
  }
  // Mudanca em tipoParametro → medium
  if (patch.field === 'tipoParametro') {
    return 'medium';
  }
  return 'medium';
}
