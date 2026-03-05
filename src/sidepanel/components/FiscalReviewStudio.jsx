/**
 * Fiscal Review Studio — container principal.
 *
 * View alternativa do Step 2 (Review) com layout 3 colunas:
 *   Backlog (20%) | Canvas (50%) | Evidence (30%)
 * + Command Bar no topo.
 */
import { useState, useMemo } from 'react';
import MappingCommandBar from './MappingCommandBar.jsx';
import BacklogPanel from './BacklogPanel.jsx';
import RouteFlowCanvas from './RouteFlowCanvas.jsx';
import MappingFunnel from './MappingFunnel.jsx';
import EvidencePanel from './EvidencePanel.jsx';
import { translateWarning } from '../../utils/warning-translator.js';
import { buildRuleAlerts } from '../../utils/rule-alerts.js';

// ── Build Issues ────────────────────────────────────────────────────────────

// Mapa de reason → bucket type para o backlog
const REASON_TO_BUCKET = {
  RATE_CONFLICT: 'RATE_CONFLICT',
  STRUCTURAL_CONFLICT: 'STRUCTURAL_CONFLICT',
  MULTI_SIGNATURE: 'RATE_CONFLICT',
  LOW_CONFIDENCE: 'RATE_CONFLICT',
  PARAMTYPE_MISSING: 'PARAM_MISSING',
  PARAMTYPE_NO_SUGGESTION: 'PARAM_MISSING',
  PARAMTYPE_NO_ENV_MATCH: 'PARAM_MISSING',
  PASSIVE_TAX_INFO: 'NEEDS_REVIEW',
  REDUCAO_INFERRED: 'NEEDS_REVIEW',
};

/**
 * Constroi array unificado de issues usando buildRuleAlerts (fonte unica).
 *
 * @param {Object[]} rules
 * @param {Object[]} determinations
 * @param {Object[]} needsReview
 * @param {Object|null} analysis - resultado do ANALYZE_TAX_RULES
 * @returns {Object[]} issues
 */
function buildIssues(rules, determinations, needsReview, analysis) {
  const issues = [];
  let issueId = 0;

  // Indexar determinacoes por ruleExternalId
  const detsByRule = new Map();
  for (const det of determinations) {
    if (!detsByRule.has(det.ruleExternalId)) detsByRule.set(det.ruleExternalId, []);
    detsByRule.get(det.ruleExternalId).push(det);
  }

  // 1. Alertas de regras via buildRuleAlerts (fonte unica)
  for (const rule of rules) {
    const ruleDets = detsByRule.get(rule.externalId) || [];
    const alerts = buildRuleAlerts(rule, ruleDets);

    for (const alert of alerts) {
      const warning = translateWarning(alert.reason, alert.meta);
      const bucket = REASON_TO_BUCKET[alert.reason] || 'NEEDS_REVIEW';

      issues.push({
        id: `issue-${issueId++}`,
        type: bucket,
        severity: warning.severity,
        scope: alert.detExternalId ? 'DETERMINATION' : 'RULE',
        ruleExternalId: alert.ruleId,
        detExternalId: alert.detExternalId || null,
        meta: {
          routeKey: rule._routeKey,
          cfop: rule.cfop,
          value: rule._totalValue || 0,
          taxType: alert.meta.taxType,
          conflictType: alert.meta.conflictType,
          signatures: alert.meta.signatures,
          detail: alert.meta.detail,
          taxCode: alert.meta.taxType,
          cst: alert.meta.cst,
        },
        warning,
        label: warning.title,
      });
    }
  }

  // 2. Needs review (de SPED) — itens rejeitados/parciais, nao ligados a regras
  if (needsReview && needsReview.items) {
    for (const nr of needsReview.items) {
      const warning = translateWarning(nr.reason || 'NEEDS_REVIEW', {
        cfop: nr.item?.cfop,
      });

      issues.push({
        id: `issue-${issueId++}`,
        type: 'NEEDS_REVIEW',
        severity: warning.severity,
        scope: 'ITEM',
        ruleExternalId: nr.item?.ruleExternalId || null,
        meta: {
          routeKey: null,
          cfop: nr.item?.cfop,
          value: nr.vlItem || 0,
          reason: nr.reason,
        },
        sample: nr.item?._rawLine ? { source: 'SPED', raw: nr.item._rawLine } : null,
        warning,
        label: warning.title,
      });
    }
  }

  // 3. Constraint errors (de pre-validator)
  if (analysis && analysis.constraintErrors) {
    for (const err of analysis.constraintErrors) {
      const warning = translateWarning('CONSTRAINT_ERROR', {
        message: err.message || 'Erro de validacao',
      });

      issues.push({
        id: `issue-${issueId++}`,
        type: 'CONSTRAINT',
        severity: err.severity === 'error' ? 'ERROR' : 'WARN',
        scope: err.ruleId ? 'RULE' : 'JOB',
        ruleExternalId: err.ruleId || null,
        detExternalId: err.detId || null,
        meta: {
          routeKey: null,
          value: 0,
        },
        warning,
        label: warning.title,
      });
    }
  }

  return issues;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function FiscalReviewStudio({
  rules, setRules,
  determinations, setDeterminations,
  stats, analysis,
  paramTypeOptions, onApplyPatch,
  needsReview, originalFiles,
}) {
  const [selectedBucket, setSelectedBucket] = useState(null);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [selectedRule, setSelectedRule] = useState(null);
  const [canvasMode, setCanvasMode] = useState('sankey');

  const issues = useMemo(
    () => buildIssues(rules, determinations, needsReview, analysis),
    [rules, determinations, needsReview, analysis],
  );

  const geoStats = stats?.geoStats;

  // Filtrar regras por rota selecionada
  const filteredRules = useMemo(() => {
    if (!selectedRoute) return null;
    return rules.filter(r => r._routeKey === selectedRoute);
  }, [rules, selectedRoute]);

  // Filtrar issues por bucket selecionado
  const filteredIssues = useMemo(() => {
    if (!selectedBucket) return issues;
    return issues.filter(i => i.type === selectedBucket);
  }, [issues, selectedBucket]);

  // Rotas afetadas pelo bucket selecionado
  const highlightedRoutes = useMemo(() => {
    if (!selectedBucket) return null;
    const routes = new Set();
    for (const issue of filteredIssues) {
      if (issue.meta?.routeKey) routes.add(issue.meta.routeKey);
    }
    return routes;
  }, [selectedBucket, filteredIssues]);

  const handleBucketClick = (type) => {
    setSelectedBucket(prev => prev === type ? null : type);
    setSelectedRoute(null);
    setSelectedRule(null);
  };

  const handleRouteClick = (routeKey) => {
    setSelectedRoute(prev => prev === routeKey ? null : routeKey);
    setSelectedBucket(null);
    setSelectedRule(null);
  };

  const handleRuleClick = (externalId) => {
    setSelectedRule(prev => prev === externalId ? null : externalId);
  };

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      {/* Command Bar */}
      <MappingCommandBar
        stats={stats}
        geoStats={geoStats}
        issues={issues}
        onRouteClick={handleRouteClick}
      />

      {/* 3-column layout */}
      <div className="grid grid-cols-[240px_1fr_360px] gap-3 flex-1 min-h-0">
        {/* Backlog */}
        <BacklogPanel
          issues={issues}
          selectedBucket={selectedBucket}
          onBucketClick={handleBucketClick}
        />

        {/* Canvas */}
        <div className="flex flex-col min-h-0">
          <div className="flex items-center gap-1 mb-2">
            <button
              onClick={() => setCanvasMode('sankey')}
              className={`text-xs px-2.5 py-1 rounded-md transition ${
                canvasMode === 'sankey'
                  ? 'bg-ocean-150 text-white font-medium'
                  : 'bg-ocean-10 text-ocean-60 hover:bg-ocean-30'
              }`}
            >Fluxo</button>
            <button
              onClick={() => setCanvasMode('funnel')}
              className={`text-xs px-2.5 py-1 rounded-md transition ${
                canvasMode === 'funnel'
                  ? 'bg-ocean-150 text-white font-medium'
                  : 'bg-ocean-10 text-ocean-60 hover:bg-ocean-30'
              }`}
            >Funil</button>
          </div>

          {canvasMode === 'sankey' ? (
            <RouteFlowCanvas
              geoStats={geoStats}
              selectedRoute={selectedRoute}
              highlightedRoutes={highlightedRoutes}
              onRouteClick={handleRouteClick}
            />
          ) : (
            <MappingFunnel
              stats={stats}
              rules={rules}
              determinations={determinations}
            />
          )}
        </div>

        {/* Evidence */}
        <EvidencePanel
          rules={rules}
          determinations={determinations}
          selectedRule={selectedRule}
          selectedRoute={selectedRoute}
          selectedBucket={selectedBucket}
          filteredRules={filteredRules}
          filteredIssues={filteredIssues}
          issues={issues}
          onRuleClick={handleRuleClick}
          originalFiles={originalFiles}
        />
      </div>
    </div>
  );
}
