/**
 * BacklogPanel — coluna esquerda (20%) com buckets de issues agrupados por tipo.
 */

const BUCKET_CONFIG = {
  RATE_CONFLICT: { label: 'Imposto diferente na mesma op.', icon: '⚡', color: 'border-rose' },
  STRUCTURAL_CONFLICT: { label: 'Variacao estrutural', icon: '△', color: 'border-golden' },
  PARAM_MISSING: { label: 'Falta config. NetSuite', icon: '⊘', color: 'border-rose' },
  NEEDS_REVIEW: { label: 'Revisao manual', icon: '⚑', color: 'border-ocean-120' },
  CONSTRAINT: { label: 'Erro de validacao', icon: '✕', color: 'border-rose' },
};

function formatCompact(value) {
  if (!value) return '';
  if (value >= 1e6) return `R$ ${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `R$ ${(value / 1e3).toFixed(0)}k`;
  return `R$ ${value.toFixed(0)}`;
}

export default function BacklogPanel({ issues, selectedBucket, onBucketClick }) {
  // Agrupar por tipo
  const buckets = {};
  for (const issue of issues) {
    if (!buckets[issue.type]) {
      buckets[issue.type] = { count: 0, errorCount: 0, totalValue: 0 };
    }
    const b = buckets[issue.type];
    b.count++;
    if (issue.severity === 'ERROR') b.errorCount++;
    b.totalValue += issue.meta?.value || 0;
  }

  // Ordenar: errors primeiro, depois por valor
  const sortedTypes = Object.keys(buckets).sort((a, b) => {
    const ae = buckets[a].errorCount;
    const be = buckets[b].errorCount;
    if (ae !== be) return be - ae;
    return buckets[b].totalValue - buckets[a].totalValue;
  });

  if (sortedTypes.length === 0) {
    return (
      <div className="bg-ocean-10 rounded-lg p-4 flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-2xl mb-1">✓</div>
          <div className="text-xs text-pine font-medium">Sem pendencias</div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-ocean-10 rounded-lg p-2 overflow-y-auto flex flex-col gap-1.5">
      <div className="text-[10px] font-medium text-ocean-60 uppercase tracking-wide px-1">
        Backlog ({issues.length})
      </div>

      {sortedTypes.map(type => {
        const bucket = buckets[type];
        const config = BUCKET_CONFIG[type] || { label: type, icon: '?', color: 'border-ocean-60' };
        const isSelected = selectedBucket === type;

        return (
          <button
            key={type}
            onClick={() => onBucketClick(type)}
            className={`w-full text-left rounded-md p-2.5 border-l-3 transition ${config.color} ${
              isSelected
                ? 'bg-white shadow-sm'
                : 'bg-white/50 hover:bg-white'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ocean-180">
                {config.icon} {config.label}
              </span>
              <span className={`text-xs font-bold ${bucket.errorCount > 0 ? 'text-rose' : 'text-golden'}`}>
                {bucket.count}
              </span>
            </div>
            {bucket.totalValue > 0 && (
              <div className="text-[10px] text-ocean-60 mt-0.5">
                {formatCompact(bucket.totalValue)}
              </div>
            )}
            {bucket.errorCount > 0 && bucket.errorCount < bucket.count && (
              <div className="text-[10px] text-rose mt-0.5">
                {bucket.errorCount} erros
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
