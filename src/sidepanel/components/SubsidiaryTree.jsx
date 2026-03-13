import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { computeTreeLayout, CARD_W, CARD_H } from './subsidiary-tree-layout.js';
import SubsidiaryNodeCard from './SubsidiaryNodeCard.jsx';

/**
 * Tree visualization with draggable node cards and dynamic SVG connectors.
 * Dragging repositions nodes visually without changing the hierarchy.
 */
export default function SubsidiaryTree({ nodes, nodeErrors, selectedNodeId, onSelectNode, onAddChild }) {
  const { t } = useTranslation('subsidiary');

  // Base layout from algorithm
  const layout = useMemo(() => computeTreeLayout(nodes), [nodes]);

  // Drag offsets: nodeId → { dx, dy } (persisted across renders while nodes don't change)
  const [offsets, setOffsets] = useState({});

  // Reset offsets when node list changes structurally (add/remove)
  const nodeIdsKey = nodes.map((n) => n.clientNodeId).join(',');
  const prevKeyRef = useRef(nodeIdsKey);
  useEffect(() => {
    if (prevKeyRef.current !== nodeIdsKey) {
      setOffsets({});
      prevKeyRef.current = nodeIdsKey;
    }
  }, [nodeIdsKey]);

  // Drag state
  const dragRef = useRef(null); // { nodeId, startX, startY, origDx, origDy }

  const handlePointerDown = useCallback((e, nodeId) => {
    // Don't drag from buttons
    if (e.target.closest('button')) return;
    e.preventDefault();
    const off = offsets[nodeId] || { dx: 0, dy: 0 };
    dragRef.current = {
      nodeId,
      startX: e.clientX,
      startY: e.clientY,
      origDx: off.dx,
      origDy: off.dy,
      moved: false,
    };
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  }, [offsets]);

  const handlePointerMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = d.origDx + (e.clientX - d.startX);
    const dy = d.origDy + (e.clientY - d.startY);
    if (Math.abs(e.clientX - d.startX) > 3 || Math.abs(e.clientY - d.startY) > 3) {
      d.moved = true;
    }
    setOffsets((prev) => ({ ...prev, [d.nodeId]: { dx, dy } }));
  }, []);

  const handlePointerUp = useCallback(() => {
    const d = dragRef.current;
    if (d && !d.moved) {
      // Treat as click → select node
      onSelectNode(d.nodeId);
    }
    dragRef.current = null;
    document.removeEventListener('pointermove', handlePointerMove);
    document.removeEventListener('pointerup', handlePointerUp);
  }, [onSelectNode, handlePointerMove]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-ocean-60">
        {t('tree.empty')}
      </div>
    );
  }

  // Positioned nodes with drag offset applied
  const positioned = layout.positionedNodes.map(({ node, x, y }) => {
    const off = offsets[node.clientNodeId] || { dx: 0, dy: 0 };
    return { node, x: x + off.dx, y: y + off.dy };
  });

  // Build position map for connector drawing
  const posMap = {};
  for (const { node, x, y } of positioned) {
    posMap[node.clientNodeId] = { x, y };
  }

  // Compute bounding box
  let maxX = 0, maxY = 0;
  for (const { x, y } of positioned) {
    if (x + CARD_W > maxX) maxX = x + CARD_W;
    if (y + CARD_H > maxY) maxY = y + CARD_H;
  }
  const canvasW = Math.max(maxX + 20, 400);
  const canvasH = Math.max(maxY + 20, 200);

  // Build connector paths
  const nodeIdSet = new Set(nodes.map((n) => n.clientNodeId));
  const paths = [];
  for (const node of nodes) {
    if (!node.parentClientNodeId || !nodeIdSet.has(node.parentClientNodeId)) continue;
    const parentPos = posMap[node.parentClientNodeId];
    const childPos = posMap[node.clientNodeId];
    if (!parentPos || !childPos) continue;

    const px = parentPos.x + CARD_W / 2;
    const py = parentPos.y + CARD_H;
    const cx = childPos.x + CARD_W / 2;
    const cy = childPos.y;
    const midY = py + (cy - py) / 2;
    const isDraft = !node._isExisting && node.status === 'draft';

    paths.push(
      <path
        key={`line-${node.clientNodeId}`}
        d={`M ${px} ${py} L ${px} ${midY} L ${cx} ${midY} L ${cx} ${cy}`}
        stroke="#94BFCE"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={isDraft ? '6 3' : undefined}
      />
    );
  }

  return (
    <div className="overflow-auto bg-ocean-10 rounded-lg border border-ocean-30 p-3 relative">
      <div style={{ position: 'relative', width: canvasW, height: canvasH, minWidth: canvasW }}>
        {/* SVG connector layer */}
        <svg
          width={canvasW}
          height={canvasH}
          style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 0 }}
        >
          {paths}
        </svg>

        {/* Node cards */}
        {positioned.map(({ node, x, y }) => {
          const isBeingDragged = dragRef.current?.nodeId === node.clientNodeId;
          return (
            <div
              key={node.clientNodeId}
              style={{
                position: 'absolute',
                left: x,
                top: y,
                width: CARD_W,
                height: CARD_H,
                zIndex: isBeingDragged ? 10 : 1,
                cursor: 'grab',
                touchAction: 'none',
                userSelect: 'none',
                transition: isBeingDragged ? 'none' : 'filter 0.15s',
                filter: isBeingDragged ? 'drop-shadow(0 6px 16px rgba(19,33,44,0.15))' : undefined,
                transform: isBeingDragged ? 'scale(1.03)' : undefined,
              }}
              onPointerDown={(e) => handlePointerDown(e, node.clientNodeId)}
            >
              <SubsidiaryNodeCard
                node={node}
                isSelected={node.clientNodeId === selectedNodeId}
                hasErrors={(nodeErrors.get(node.clientNodeId) || []).length > 0}
                onSelect={() => {}} // handled by pointerup
                onAddChild={() => onAddChild(node.clientNodeId)}
              />
            </div>
          );
        })}
      </div>

      {/* Drag hint */}
      <div className="absolute bottom-2 right-3 flex items-center gap-1 text-[10px] text-ocean-60 opacity-60 pointer-events-none select-none">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M8 2v12M2 8h12M5 3l3-2 3 2M5 13l3 2 3-2M3 5L1 8l2 3M13 5l2 3-2 3" />
        </svg>
        {t('tree.dragHint')}
      </div>
    </div>
  );
}
