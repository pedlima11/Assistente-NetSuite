/**
 * EvidencePanel — coluna direita (30%) com 3 tabs:
 *   Tab 1: Resumo (regra ou bucket)
 *   Tab 2: Samples (ate 10 amostras)
 *   Tab 3: Raw (XML ou SPED)
 */
import { useState, useMemo } from 'react';
import RawXmlViewer from './RawXmlViewer.jsx';
import RawSpedViewer from './RawSpedViewer.jsx';

function formatBRL(value) {
  if (!value && value !== 0) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(value);
}

// ── Tab Resumo ──────────────────────────────────────────────────────────────

// ── Issue Warning Card ───────────────────────────────────────────────────────

function IssueWarningCard({ issue, onRuleClick }) {
  const w = issue.warning;
  if (!w) return null;

  const severityColor = w.severity === 'ERROR' ? 'border-rose bg-rose/5'
    : w.severity === 'WARN' ? 'border-golden bg-golden/5'
    : 'border-ocean-120 bg-ocean-10';

  const severityIcon = w.severity === 'ERROR' ? '✕' : w.severity === 'WARN' ? '⚠' : 'ℹ';

  return (
    <div className={`rounded-md border-l-3 p-2.5 ${severityColor} mb-2`}>
      <div className="flex items-start gap-1.5">
        <span className="text-xs mt-px">{severityIcon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-ocean-180 leading-tight">{w.title}</div>

          {w.happened && (
            <div className="mt-1.5">
              <div className="text-[9px] font-medium text-ocean-60 uppercase tracking-wide">O que aconteceu</div>
              <div className="text-[11px] text-ocean-150 mt-0.5 leading-snug">{w.happened}</div>
            </div>
          )}

          {w.impact && (
            <div className="mt-1.5">
              <div className="text-[9px] font-medium text-ocean-60 uppercase tracking-wide">Impacto</div>
              <div className="text-[11px] text-ocean-150 mt-0.5 leading-snug">{w.impact}</div>
            </div>
          )}

          {w.action && (
            <div className="mt-1.5">
              <div className="text-[9px] font-medium text-ocean-60 uppercase tracking-wide">O que fazer</div>
              <div className="text-[11px] text-ocean-150 mt-0.5 leading-snug">{w.action}</div>
            </div>
          )}

          {issue.ruleExternalId && onRuleClick && (
            <button
              onClick={() => onRuleClick(issue.ruleExternalId)}
              className="mt-2 text-[10px] text-ocean-120 hover:text-ocean-180 underline"
            >Ver regra</button>
          )}

          {/* Detalhes tecnicos — escondidos por padrao */}
          {issue.meta && (
            <details className="mt-2">
              <summary className="text-[9px] text-ocean-60 cursor-pointer hover:text-ocean-120">
                Detalhes tecnicos
              </summary>
              <div className="mt-1 text-[10px] text-ocean-60 font-mono bg-white/60 rounded p-1.5 space-y-0.5">
                {issue.meta.routeKey && <div>Rota: {issue.meta.routeKey}</div>}
                {issue.meta.cfop && <div>CFOP: {issue.meta.cfop}</div>}
                {issue.meta.taxType && <div>Imposto: {issue.meta.taxType}</div>}
                {issue.meta.conflictType && <div>Tipo conflito: {issue.meta.conflictType}</div>}
                {issue.meta.cst && <div>CST: {issue.meta.cst}</div>}
                {issue.meta.taxCode && <div>Codigo: {issue.meta.taxCode}</div>}
                {issue.meta.signatures && (
                  <div>Signatures: {issue.meta.signatures.map(s =>
                    `CST ${s.cst}/${s.aliq}% (${s.percent}%)`
                  ).join(', ')}</div>
                )}
                {issue.meta.value > 0 && <div>Valor: {formatBRL(issue.meta.value)}</div>}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tab Resumo ──────────────────────────────────────────────────────────────

function TabResumo({ rule, determinations, issues, selectedBucket, filteredRules, onRuleClick }) {
  // Se bucket selecionado: listar issues com layout leigo
  if (selectedBucket && !rule) {
    const bucketIssues = issues.filter(i => i.type === selectedBucket);

    return (
      <div className="space-y-1">
        <div className="text-xs font-medium text-ocean-150 mb-2">
          {bucketIssues.length} {bucketIssues.length === 1 ? 'pendencia' : 'pendencias'}
        </div>
        {bucketIssues.slice(0, 15).map(issue => (
          <IssueWarningCard key={issue.id} issue={issue} onRuleClick={onRuleClick} />
        ))}
        {bucketIssues.length > 15 && (
          <div className="text-[10px] text-ocean-60 text-center py-1">
            +{bucketIssues.length - 15} mais
          </div>
        )}
      </div>
    );
  }

  // Se regra selecionada: mostrar detalhes
  if (rule) {
    const ruleDets = determinations.filter(d => d.ruleExternalId === rule.externalId);
    const ruleIssues = issues.filter(i => i.ruleExternalId === rule.externalId);

    return (
      <div className="space-y-3">
        <div>
          <div className="text-xs font-bold text-ocean-180">{rule.name}</div>
          <div className="text-[10px] text-ocean-60 mt-0.5">
            {rule._routeKey} · CFOP {rule.cfop}
          </div>
        </div>

        {/* Metricas */}
        <div className="grid grid-cols-2 gap-1.5">
          <div className="bg-white rounded p-1.5">
            <div className="text-[9px] text-ocean-60">Valor</div>
            <div className="text-xs font-bold text-ocean-180">{formatBRL(rule._totalValue)}</div>
          </div>
          <div className="bg-white rounded p-1.5">
            <div className="text-[9px] text-ocean-60">Operacoes</div>
            <div className="text-xs font-bold text-ocean-180">{rule._nfeCount}</div>
          </div>
          <div className="bg-white rounded p-1.5">
            <div className="text-[9px] text-ocean-60">Suppliers</div>
            <div className="text-xs font-bold text-ocean-180">{rule.evidence?.uniqueSuppliers || 0}</div>
          </div>
          <div className="bg-white rounded p-1.5">
            <div className="text-[9px] text-ocean-60">Periodo</div>
            <div className="text-[10px] text-ocean-180">
              {rule.evidence?.firstSeen || '?'} — {rule.evidence?.lastSeen || '?'}
            </div>
          </div>
        </div>

        {/* Determinacoes */}
        <div>
          <div className="text-[10px] font-medium text-ocean-150 mb-1">
            Determinacoes ({ruleDets.length})
          </div>
          {ruleDets.map(det => (
            <div key={det.externalId} className="bg-white rounded p-1.5 mb-1 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="font-medium text-ocean-180">{det.codigoImposto}</span>
                <span className="text-ocean-120">{det.aliquota}%</span>
              </div>
              <div className="text-ocean-60 mt-0.5">
                CST {det._cst} · {det.tipoParametro || <span className="text-rose">param pendente</span>}
              </div>
            </div>
          ))}
        </div>

        {/* Conflitos — com tipo classificado */}
        {rule.conflicts && rule.conflicts.length > 0 && (
          <div>
            <div className="text-[10px] font-medium text-rose mb-1">Conflitos</div>
            {rule.conflicts.map((c, i) => (
              <div key={i} className="bg-white rounded p-1.5 mb-1 text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-ocean-180">{c.taxType}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                    c.conflictType === 'structural'
                      ? 'bg-golden/15 text-golden'
                      : 'bg-rose/15 text-rose'
                  }`}>
                    {c.conflictType === 'structural' ? 'estrutural' : 'aliquota'}
                  </span>
                </div>
                {c.conflictType === 'structural' && c.detail ? (
                  <div className="text-ocean-60 mt-0.5">
                    {c.detail.withST} com ST · {c.detail.withoutST} sem ST
                  </div>
                ) : c.signatures ? (
                  c.signatures.map((s, j) => (
                    <div key={j} className="flex items-center gap-1 mt-0.5">
                      <div
                        className="h-1.5 bg-ocean-120 rounded-full"
                        style={{ width: `${s.percent}%`, minWidth: '4px', maxWidth: '100px' }}
                      />
                      <span className="text-ocean-60">CST {s.cst} / {s.aliq}% — {s.percent}%</span>
                    </div>
                  ))
                ) : null}
              </div>
            ))}
          </div>
        )}

        {/* Issues da regra — layout leigo */}
        {ruleIssues.length > 0 && (
          <div>
            <div className="text-[10px] font-medium text-ocean-150 mb-1">
              Pendencias ({ruleIssues.length})
            </div>
            {ruleIssues.map(issue => (
              <IssueWarningCard key={issue.id} issue={issue} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Se rota selecionada mas sem regra especifica
  if (filteredRules && filteredRules.length > 0) {
    return (
      <div className="space-y-2">
        <div className="text-xs font-medium text-ocean-150">
          {filteredRules.length} regras nesta rota
        </div>
        {filteredRules.map(r => (
          <button
            key={r.externalId}
            onClick={() => onRuleClick(r.externalId)}
            className="w-full text-left text-xs bg-white rounded-md p-2 hover:bg-ocean-30 transition"
          >
            <div className="font-medium text-ocean-180 truncate">{r.name}</div>
            <div className="text-ocean-60 mt-0.5">
              {formatBRL(r._totalValue)} · {r._nfeCount} ops
              {r.conflicts?.length > 0 && <span className="text-rose ml-1">⚡ conflito</span>}
            </div>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-full text-xs text-ocean-60">
      Selecione uma rota, regra ou bucket
    </div>
  );
}

// ── Tab Samples ─────────────────────────────────────────────────────────────

function TabSamples({ rule, onViewRaw }) {
  if (!rule) {
    return <div className="text-xs text-ocean-60 p-2">Selecione uma regra</div>;
  }

  const samples = rule.evidence?.sampleDocs || [];
  if (samples.length === 0) {
    return <div className="text-xs text-ocean-60 p-2">Sem amostras disponíveis</div>;
  }

  return (
    <div className="overflow-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-ocean-60 border-b border-ocean-30">
            <th className="text-left py-1 px-1">Doc</th>
            <th className="text-left py-1 px-1">CFOP</th>
            <th className="text-left py-1 px-1">NCM</th>
            <th className="text-right py-1 px-1">Valor</th>
            <th className="py-1 px-1"></th>
          </tr>
        </thead>
        <tbody>
          {samples.map((s, i) => {
            const sample = typeof s === 'string' ? { id: s } : s;
            return (
              <tr key={i} className="border-b border-ocean-10 hover:bg-ocean-30/50">
                <td className="py-1 px-1 text-ocean-180 truncate max-w-[80px]">{sample.id}</td>
                <td className="py-1 px-1 text-ocean-120">{sample.cfop || '—'}</td>
                <td className="py-1 px-1 text-ocean-120">{sample.ncm || '—'}</td>
                <td className="py-1 px-1 text-ocean-120 text-right">
                  {sample.vlItem ? formatBRL(sample.vlItem) : '—'}
                </td>
                <td className="py-1 px-1">
                  {sample.rawSnippet && (
                    <button
                      onClick={() => onViewRaw(sample)}
                      className="text-[9px] text-ocean-120 hover:text-ocean-180 underline"
                    >Raw</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Tab Raw ─────────────────────────────────────────────────────────────────

function TabRaw({ sample }) {
  if (!sample) {
    return <div className="text-xs text-ocean-60 p-2">Clique "Raw" em um sample</div>;
  }

  if (sample.source === 'SPED') {
    return <RawSpedViewer line={sample.rawSnippet} />;
  }

  return <RawXmlViewer snippet={sample.rawSnippet} />;
}

// ── Evidence Panel ──────────────────────────────────────────────────────────

export default function EvidencePanel({
  rules, determinations,
  selectedRule, selectedRoute, selectedBucket,
  filteredRules, filteredIssues, issues,
  onRuleClick, originalFiles,
}) {
  const [activeTab, setActiveTab] = useState('resumo');
  const [rawSample, setRawSample] = useState(null);

  const rule = useMemo(() => {
    if (!selectedRule) return null;
    return rules.find(r => r.externalId === selectedRule) || null;
  }, [rules, selectedRule]);

  const handleViewRaw = (sample) => {
    setRawSample(sample);
    setActiveTab('raw');
  };

  const tabs = [
    { key: 'resumo', label: 'Resumo' },
    { key: 'samples', label: 'Samples' },
    { key: 'raw', label: 'Raw' },
  ];

  return (
    <div className="bg-ocean-10 rounded-lg flex flex-col min-h-0 overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-ocean-30 px-2 pt-1.5">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`text-[11px] px-2.5 py-1.5 border-b-2 transition ${
              activeTab === tab.key
                ? 'border-ocean-120 text-ocean-180 font-medium'
                : 'border-transparent text-ocean-60 hover:text-ocean-120'
            }`}
          >{tab.label}</button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-2">
        {activeTab === 'resumo' && (
          <TabResumo
            rule={rule}
            determinations={determinations}
            issues={issues}
            selectedBucket={selectedBucket}
            filteredRules={filteredRules}
            onRuleClick={onRuleClick}
          />
        )}
        {activeTab === 'samples' && (
          <TabSamples
            rule={rule}
            onViewRaw={handleViewRaw}
          />
        )}
        {activeTab === 'raw' && (
          <TabRaw sample={rawSample} />
        )}
      </div>
    </div>
  );
}
