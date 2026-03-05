/**
 * MappingFunnel — funil visual do pipeline de mapeamento.
 *
 * 5 etapas baseadas apenas em stats e rules[].
 */

export default function MappingFunnel({ stats, rules, determinations }) {
  if (!stats) return null;

  const totalRules = stats.totalRules || rules.length;
  const cleanRules = rules.filter(r => {
    const hasConflict = r.conflicts && r.conflicts.length > 0;
    return !hasConflict;
  }).length;
  const conflictRules = totalRules - cleanRules;

  const unresolvedDets = determinations.filter(d => d._unresolvedParam).length;
  const resolvedDets = determinations.length - unresolvedDets;
  const exportable = rules.filter(r => {
    const hasConflict = r.conflicts && r.conflicts.length > 0;
    const ruleDets = determinations.filter(d => d.ruleExternalId === r.externalId);
    const hasUnresolved = ruleDets.some(d => d._unresolvedParam);
    return !hasConflict && !hasUnresolved;
  }).length;

  const stages = [
    { label: 'Regras Geradas', value: totalRules, max: totalRules },
    { label: 'Regras Limpas', value: cleanRules, max: totalRules },
    { label: 'Determinacoes', value: determinations.length, max: determinations.length },
    { label: 'Params Resolvidos', value: resolvedDets, max: determinations.length },
    { label: 'Exportaveis', value: exportable, max: totalRules },
  ];

  const maxVal = Math.max(...stages.map(s => s.max), 1);

  return (
    <div className="flex-1 bg-ocean-10 rounded-lg p-4 flex flex-col justify-center gap-3">
      {stages.map((stage, i) => {
        const pct = stage.max > 0 ? Math.round((stage.value / stage.max) * 100) : 0;
        const widthPct = Math.max(8, (stage.value / maxVal) * 100);

        // Gradient: pine (bom) → golden → rose (problemas)
        const color = pct >= 90 ? 'bg-pine' : pct >= 70 ? 'bg-golden' : 'bg-rose';

        return (
          <div key={i}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-ocean-150 font-medium">{stage.label}</span>
              <span className="text-xs font-bold text-ocean-180">{stage.value}</span>
            </div>
            <div className="h-5 bg-ocean-30 rounded-md overflow-hidden">
              <div
                className={`h-full ${color} rounded-md transition-all duration-500 flex items-center justify-end pr-1.5`}
                style={{ width: `${widthPct}%` }}
              >
                <span className="text-[9px] font-bold text-white/90">{pct}%</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
