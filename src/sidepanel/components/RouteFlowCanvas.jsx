/**
 * RouteFlowCanvas — Sankey simplificado sem d3.
 *
 * Coluna esquerda: UFs origem (ordenados por valor)
 * Coluna direita: UFs destino (ordenados por valor)
 * Faixas SVG conectando origem → destino com espessura proporcional.
 */
import { useMemo, useState } from 'react';

const STATUS_COLORS = {
  clean: '#86B596',   // pine
  partial: '#E2C06B', // golden
  pending: '#FF8675', // rose
};

const FADED_OPACITY = 0.15;
const COLUMN_WIDTH = 60;
const GAP = 4;
const PADDING_TOP = 10;
const PADDING_BOTTOM = 10;

function formatCompact(value) {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}k`;
  return `${value}`;
}

export default function RouteFlowCanvas({
  geoStats,
  selectedRoute,
  highlightedRoutes,
  onRouteClick,
}) {
  const [hovered, setHovered] = useState(null);

  const layout = useMemo(() => {
    if (!geoStats?.routeMetrics) return null;

    const routes = Object.entries(geoStats.routeMetrics);
    if (routes.length === 0) return null;

    // Agregar por UF origem e destino
    const emitAgg = {};
    const destAgg = {};

    for (const [key, data] of routes) {
      const [emit, dest] = key.split('->');
      emitAgg[emit] = (emitAgg[emit] || 0) + data.totalValue;
      destAgg[dest] = (destAgg[dest] || 0) + data.totalValue;
    }

    const sortedEmit = Object.entries(emitAgg).sort((a, b) => b[1] - a[1]);
    const sortedDest = Object.entries(destAgg).sort((a, b) => b[1] - a[1]);

    const maxEmitTotal = sortedEmit.reduce((s, [, v]) => s + v, 0);
    const maxDestTotal = sortedDest.reduce((s, [, v]) => s + v, 0);
    const maxTotal = Math.max(maxEmitTotal, maxDestTotal, 1);

    const canvasHeight = 400;
    const usableHeight = canvasHeight - PADDING_TOP - PADDING_BOTTOM;

    // Posicionar UFs na coluna esquerda
    const emitPositions = {};
    let emitY = PADDING_TOP;
    for (const [uf, value] of sortedEmit) {
      const h = Math.max(16, (value / maxTotal) * usableHeight);
      emitPositions[uf] = { y: emitY, height: h, value };
      emitY += h + GAP;
    }

    // Posicionar UFs na coluna direita
    const destPositions = {};
    let destY = PADDING_TOP;
    for (const [uf, value] of sortedDest) {
      const h = Math.max(16, (value / maxTotal) * usableHeight);
      destPositions[uf] = { y: destY, height: h, value };
      destY += h + GAP;
    }

    const totalHeight = Math.max(emitY, destY) + PADDING_BOTTOM;

    // Calcular faixas (bands) para cada rota
    // Rastrear offset acumulado dentro de cada UF
    const emitOffsets = {};
    const destOffsets = {};
    for (const uf of Object.keys(emitPositions)) emitOffsets[uf] = 0;
    for (const uf of Object.keys(destPositions)) destOffsets[uf] = 0;

    const bands = [];
    // Ordenar rotas por valor para posicionamento mais estetico
    const sortedRoutes = routes.sort((a, b) => b[1].totalValue - a[1].totalValue);

    for (const [key, data] of sortedRoutes) {
      const [emit, dest] = key.split('->');
      const emitPos = emitPositions[emit];
      const destPos = destPositions[dest];
      if (!emitPos || !destPos) continue;

      // Espessura proporcional ao valor dentro do UF
      const emitRatio = emitPos.value > 0 ? data.totalValue / emitPos.value : 0;
      const destRatio = destPos.value > 0 ? data.totalValue / destPos.value : 0;
      const emitH = emitRatio * emitPos.height;
      const destH = destRatio * destPos.height;

      const band = {
        key,
        emit, dest,
        x1: COLUMN_WIDTH,
        y1: emitPos.y + emitOffsets[emit],
        h1: emitH,
        x2: 0, // set after knowing total width
        y2: destPos.y + destOffsets[dest],
        h2: destH,
        data,
      };

      emitOffsets[emit] += emitH;
      destOffsets[dest] += destH;

      bands.push(band);
    }

    return { emitPositions, destPositions, bands, totalHeight, sortedEmit, sortedDest };
  }, [geoStats]);

  if (!layout) {
    return (
      <div className="flex-1 bg-ocean-10 rounded-lg flex items-center justify-center">
        <span className="text-xs text-ocean-60">Sem dados geograficos</span>
      </div>
    );
  }

  const svgWidth = 500;
  const leftX = 0;
  const rightX = svgWidth - COLUMN_WIDTH;
  const bandLeftX = COLUMN_WIDTH + 2;
  const bandRightX = rightX - 2;

  return (
    <div className="flex-1 bg-ocean-10 rounded-lg overflow-auto p-2">
      <svg
        width="100%"
        viewBox={`0 0 ${svgWidth} ${layout.totalHeight}`}
        className="select-none"
      >
        {/* Colunas UF esquerda */}
        {layout.sortedEmit.map(([uf]) => {
          const pos = layout.emitPositions[uf];
          return (
            <g key={`emit-${uf}`}>
              <rect
                x={leftX} y={pos.y}
                width={COLUMN_WIDTH} height={pos.height}
                rx={4}
                fill="#264759"
                opacity={0.9}
              />
              <text
                x={leftX + COLUMN_WIDTH / 2}
                y={pos.y + pos.height / 2}
                textAnchor="middle" dominantBaseline="central"
                fill="white" fontSize={pos.height > 20 ? 11 : 8} fontWeight="600"
              >{uf}</text>
            </g>
          );
        })}

        {/* Colunas UF direita */}
        {layout.sortedDest.map(([uf]) => {
          const pos = layout.destPositions[uf];
          return (
            <g key={`dest-${uf}`}>
              <rect
                x={rightX} y={pos.y}
                width={COLUMN_WIDTH} height={pos.height}
                rx={4}
                fill="#264759"
                opacity={0.9}
              />
              <text
                x={rightX + COLUMN_WIDTH / 2}
                y={pos.y + pos.height / 2}
                textAnchor="middle" dominantBaseline="central"
                fill="white" fontSize={pos.height > 20 ? 11 : 8} fontWeight="600"
              >{uf}</text>
            </g>
          );
        })}

        {/* Faixas (bands) */}
        {layout.bands.map(band => {
          const color = STATUS_COLORS[band.data.status] || STATUS_COLORS.partial;
          const isSelected = selectedRoute === band.key;
          const isHighlighted = highlightedRoutes ? highlightedRoutes.has(band.key) : true;
          const isHovered = hovered === band.key;

          let opacity = 0.6;
          if (selectedRoute && !isSelected) opacity = FADED_OPACITY;
          else if (highlightedRoutes && !isHighlighted) opacity = FADED_OPACITY;
          if (isHovered) opacity = 0.85;
          if (isSelected) opacity = 0.9;

          // Polygon: trapezoid de esquerda para direita
          const points = [
            `${bandLeftX},${band.y1}`,
            `${bandRightX},${band.y2}`,
            `${bandRightX},${band.y2 + band.h2}`,
            `${bandLeftX},${band.y1 + band.h1}`,
          ].join(' ');

          return (
            <g key={band.key}>
              <polygon
                points={points}
                fill={color}
                opacity={opacity}
                stroke={isSelected ? '#13212C' : 'none'}
                strokeWidth={isSelected ? 1.5 : 0}
                className="cursor-pointer transition-opacity duration-200"
                onClick={() => onRouteClick(band.key)}
                onMouseEnter={() => setHovered(band.key)}
                onMouseLeave={() => setHovered(null)}
              />
              {/* Tooltip nativo */}
              {isHovered && (
                <title>{`${band.key}\n${formatCompact(band.data.totalValue)} · ${band.data.totalOps} ops · ${band.data.totalRules} regras\nStatus: ${band.data.status}`}</title>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
