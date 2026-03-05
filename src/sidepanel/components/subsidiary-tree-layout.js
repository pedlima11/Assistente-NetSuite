/**
 * Pure function: computes tree layout positions for subsidiary nodes.
 * Returns positioned nodes with x,y coordinates and SVG connector lines.
 */

const CARD_W = 150;
const CARD_H = 70;
const H_GAP = 16;
const V_GAP = 40;
const PADDING = 20;

/**
 * @param {Array<{clientNodeId: string, parentClientNodeId: string|null}>} nodes
 * @returns {{ positionedNodes: Array<{node: Object, x: number, y: number}>, lines: Array<{path: string}>, width: number, height: number }}
 */
export function computeTreeLayout(nodes) {
  if (nodes.length === 0) {
    return { positionedNodes: [], lines: [], width: 0, height: 0 };
  }

  // Build adjacency map: parentId → children[]
  const childrenMap = new Map();
  const nodeIdSet = new Set(nodes.map((n) => n.clientNodeId));
  const roots = [];

  for (const node of nodes) {
    // A root is any node whose parent is null OR whose parent isn't in the node list
    if (node.parentClientNodeId === null || !nodeIdSet.has(node.parentClientNodeId)) {
      roots.push(node);
    } else {
      const siblings = childrenMap.get(node.parentClientNodeId) || [];
      siblings.push(node);
      childrenMap.set(node.parentClientNodeId, siblings);
    }
  }

  if (roots.length === 0) {
    roots.push(nodes[0]);
  }

  // If multiple roots, pick the one with the most descendants as primary root
  // and attach the others as siblings (forest → single virtual layout)
  // Sort roots: most descendants first, so the "real" parent company leads
  function countDescendants(nodeId) {
    const children = childrenMap.get(nodeId) || [];
    let count = children.length;
    for (const child of children) {
      count += countDescendants(child.clientNodeId);
    }
    return count;
  }
  roots.sort((a, b) => countDescendants(b.clientNodeId) - countDescendants(a.clientNodeId));

  // Pass 1: compute subtree widths (post-order)
  const widthMap = new Map();

  function computeWidth(nodeId) {
    const children = childrenMap.get(nodeId) || [];
    if (children.length === 0) {
      widthMap.set(nodeId, CARD_W);
      return CARD_W;
    }
    let totalWidth = 0;
    for (const child of children) {
      totalWidth += computeWidth(child.clientNodeId);
    }
    totalWidth += H_GAP * (children.length - 1);
    const w = Math.max(CARD_W, totalWidth);
    widthMap.set(nodeId, w);
    return w;
  }

  // Compute widths for each root tree
  for (const root of roots) {
    computeWidth(root.clientNodeId);
  }

  // Pass 2: assign x,y positions (pre-order)
  const positionedNodes = [];
  const nodePositions = new Map(); // nodeId → {x, y}

  function positionNode(node, centerX, depth) {
    const x = centerX - CARD_W / 2;
    const y = PADDING + depth * (CARD_H + V_GAP);
    positionedNodes.push({ node, x, y });
    nodePositions.set(node.clientNodeId, { x: centerX, y });

    const children = childrenMap.get(node.clientNodeId) || [];
    if (children.length === 0) return;

    // Distribute children centered under this node
    let totalChildrenWidth = 0;
    for (const child of children) {
      totalChildrenWidth += widthMap.get(child.clientNodeId);
    }
    totalChildrenWidth += H_GAP * (children.length - 1);

    let startX = centerX - totalChildrenWidth / 2;
    for (const child of children) {
      const childWidth = widthMap.get(child.clientNodeId);
      const childCenterX = startX + childWidth / 2;
      positionNode(child, childCenterX, depth + 1);
      startX += childWidth + H_GAP;
    }
  }

  // Layout each root tree side by side
  let offsetX = PADDING;
  for (const root of roots) {
    const rootWidth = widthMap.get(root.clientNodeId);
    const rootCenterX = offsetX + rootWidth / 2;
    positionNode(root, rootCenterX, 0);
    offsetX += rootWidth + H_GAP;
  }

  // Pass 3: compute connector lines (elbow paths)
  const lines = [];
  for (const node of nodes) {
    if (node.parentClientNodeId === null || !nodeIdSet.has(node.parentClientNodeId)) continue;
    const parentPos = nodePositions.get(node.parentClientNodeId);
    const childPos = nodePositions.get(node.clientNodeId);
    if (!parentPos || !childPos) continue;

    const px = parentPos.x;
    const py = parentPos.y + CARD_H;
    const cx = childPos.x;
    const cy = childPos.y;
    const midY = py + V_GAP / 2;

    lines.push({
      path: `M ${px} ${py} L ${px} ${midY} L ${cx} ${midY} L ${cx} ${cy}`,
    });
  }

  // Compute bounding box
  let maxX = 0;
  let maxY = 0;
  for (const { x, y } of positionedNodes) {
    maxX = Math.max(maxX, x + CARD_W);
    maxY = Math.max(maxY, y + CARD_H);
  }

  return {
    positionedNodes,
    lines,
    width: maxX + PADDING,
    height: maxY + PADDING,
  };
}

export { CARD_W, CARD_H };
