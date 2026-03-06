import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { computeTreeLayout, CARD_W, CARD_H } from './subsidiary-tree-layout.js';
import SubsidiaryNodeCard from './SubsidiaryNodeCard.jsx';

/**
 * SVG tree visualization with connector lines and node cards.
 * @param {{
 *   nodes: Object[],
 *   nodeErrors: Map<string, string[]>,
 *   selectedNodeId: string|null,
 *   onSelectNode: (id: string) => void,
 *   onAddChild: (parentId: string) => void,
 * }} props
 */
export default function SubsidiaryTree({ nodes, nodeErrors, selectedNodeId, onSelectNode, onAddChild }) {
  const { t } = useTranslation('subsidiary');
  const layout = useMemo(() => computeTreeLayout(nodes), [nodes]);

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-ocean-60">
        {t('tree.empty')}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto bg-ocean-10 rounded-lg border border-ocean-30 p-3">
      <svg
        width={layout.width}
        height={layout.height}
        className="min-w-full"
        style={{ minWidth: layout.width }}
      >
        {/* Connector lines */}
        {layout.lines.map((line, i) => (
          <path
            key={i}
            d={line.path}
            stroke="#94BFCE"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* Node cards via foreignObject */}
        {layout.positionedNodes.map(({ node, x, y }) => (
          <foreignObject
            key={node.clientNodeId}
            x={x}
            y={y}
            width={CARD_W}
            height={CARD_H}
          >
            <SubsidiaryNodeCard
              node={node}
              isSelected={node.clientNodeId === selectedNodeId}
              hasErrors={(nodeErrors.get(node.clientNodeId) || []).length > 0}
              onSelect={() => onSelectNode(node.clientNodeId)}
              onAddChild={() => onAddChild(node.clientNodeId)}
            />
          </foreignObject>
        ))}
      </svg>
    </div>
  );
}
