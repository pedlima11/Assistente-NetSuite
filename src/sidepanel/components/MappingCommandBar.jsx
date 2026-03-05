/**
 * Command Bar — 4 KPI cards no topo do Fiscal Review Studio.
 *
 * Coverage | Risco | Top Rota | Top CFOP
 */

function formatBRL(value) {
  if (!value && value !== 0) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(value);
}

function CoverageCard({ geoStats }) {
  const coverage = geoStats?.coverageByValue;
  if (coverage === null || coverage === undefined) {
    return (
      <div className="flex-1 bg-ocean-10 rounded-lg p-3">
        <div className="text-[10px] font-medium text-ocean-60 uppercase tracking-wide">Coverage</div>
        <div className="text-sm text-ocean-120 mt-1">Sem dados de valor</div>
      </div>
    );
  }

  const pct = Math.round(coverage * 100);
  const color = pct >= 90 ? 'bg-pine' : pct >= 70 ? 'bg-golden' : 'bg-rose';

  return (
    <div className="flex-1 bg-ocean-10 rounded-lg p-3">
      <div className="text-[10px] font-medium text-ocean-60 uppercase tracking-wide">Coverage</div>
      <div className="text-xl font-bold text-ocean-180 mt-0.5">{pct}%</div>
      <div className="h-1.5 bg-ocean-30 rounded-full mt-1.5 overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-700`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {geoStats.totalValue > 0 && (
        <div className="text-[10px] text-ocean-60 mt-1">{formatBRL(geoStats.totalValue)} total</div>
      )}
    </div>
  );
}

function RiskCard({ issues }) {
  const errorCount = issues.filter(i => i.severity === 'ERROR').length;
  const warnCount = issues.filter(i => i.severity === 'WARN').length;
  const color = errorCount > 5 ? 'text-rose' : errorCount > 0 ? 'text-golden' : 'text-pine';

  return (
    <div className="flex-1 bg-ocean-10 rounded-lg p-3">
      <div className="text-[10px] font-medium text-ocean-60 uppercase tracking-wide">Risco</div>
      <div className={`text-xl font-bold mt-0.5 ${color}`}>{errorCount + warnCount}</div>
      <div className="text-[10px] text-ocean-60 mt-1">
        {errorCount > 0 && <span className="text-rose">{errorCount} erros</span>}
        {errorCount > 0 && warnCount > 0 && ' · '}
        {warnCount > 0 && <span className="text-golden">{warnCount} avisos</span>}
        {errorCount === 0 && warnCount === 0 && <span className="text-pine">Sem pendencias</span>}
      </div>
    </div>
  );
}

function TopRouteCard({ geoStats, onRouteClick }) {
  if (!geoStats?.routeMetrics) return null;

  const routes = Object.entries(geoStats.routeMetrics)
    .sort((a, b) => b[1].totalValue - a[1].totalValue);

  if (routes.length === 0) return null;

  const [topKey, topData] = routes[0];

  return (
    <button
      onClick={() => onRouteClick(topKey)}
      className="flex-1 bg-ocean-10 rounded-lg p-3 text-left hover:bg-ocean-30 transition"
    >
      <div className="text-[10px] font-medium text-ocean-60 uppercase tracking-wide">Top Rota</div>
      <div className="text-sm font-bold text-ocean-180 mt-0.5">{topKey}</div>
      <div className="text-[10px] text-ocean-60 mt-1">
        {formatBRL(topData.totalValue)} · {topData.totalRules} regras
      </div>
    </button>
  );
}

function TopCFOPCard({ stats }) {
  const cfopStats = stats?.cfopStats;
  if (!cfopStats || cfopStats.length === 0) return null;

  const sorted = [...cfopStats].sort((a, b) => b.count - a.count);
  const top = sorted[0];

  return (
    <div className="flex-1 bg-ocean-10 rounded-lg p-3">
      <div className="text-[10px] font-medium text-ocean-60 uppercase tracking-wide">Top CFOP</div>
      <div className="text-sm font-bold text-ocean-180 mt-0.5">{top.key}</div>
      <div className="text-[10px] text-ocean-60 mt-1">
        {top.count} regras · {top.itemCount} ops
      </div>
    </div>
  );
}

export default function MappingCommandBar({ stats, geoStats, issues, onRouteClick }) {
  return (
    <div className="flex gap-2">
      <CoverageCard geoStats={geoStats} />
      <RiskCard issues={issues} />
      <TopRouteCard geoStats={geoStats} onRouteClick={onRouteClick} />
      <TopCFOPCard stats={stats} />
    </div>
  );
}
