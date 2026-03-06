/**
 * Pure validation functions for subsidiary nodes.
 * No React dependency — can be used anywhere.
 * Returns i18n keys instead of hardcoded strings.
 * Consumers resolve keys via t() at render time.
 *
 * Error format: string (simple key) | { key: string, params: object } (interpolated)
 */

/**
 * Validates a single node. Returns i18n error keys.
 * @param {Object} node
 * @param {Object[]} allNodes
 * @returns {(string | { key: string, params: object })[]}
 */
export function validateNode(node, allNodes) {
  if (node._isExisting) return [];
  const errors = [];

  if (!node.name?.trim()) {
    errors.push('validation.nameRequired');
  }

  // CNPJ: if provided, must be 14 digits
  if (node.cnpj) {
    const digits = node.cnpj.replace(/\D/g, '');
    if (digits.length !== 14) {
      errors.push('validation.cnpjDigits');
    }
    // Uniqueness
    const dupe = allNodes.find(
      (n) => n.clientNodeId !== node.clientNodeId && n.cnpj && n.cnpj.replace(/\D/g, '') === digits
    );
    if (dupe) {
      errors.push({ key: 'validation.cnpjDuplicate', params: { name: dupe.name || '' } });
    }
  }

  const isRoot = node.parentClientNodeId === null;

  // A node is "effectively root" if its parent is null OR its parent is an existing node
  const parentNode = allNodes.find((n) => n.clientNodeId === node.parentClientNodeId);
  const isEffectiveRoot = isRoot || (parentNode && parentNode._isExisting);

  // Effective root must have a NetSuite parent subsidiary selected
  if (isEffectiveRoot && !node.parent) {
    errors.push('validation.parentRequired');
  }

  if (!node.currency) errors.push('validation.currencyRequired');
  if (!node.fiscalcalendar) errors.push('validation.fiscalCalendarRequired');
  if (!node.taxfiscalcalendar) errors.push('validation.taxCalendarRequired');
  if (!node.addressNumber) errors.push('validation.addressNumberRequired');
  if (!node.brCityId) errors.push('validation.cityRequired');
  if (!node.state) errors.push('validation.stateRequired');

  return errors;
}

/**
 * Validates the entire tree.
 * @param {Object[]} nodes
 * @returns {{ valid: boolean, nodeErrors: Map<string, (string | { key: string, params: object })[]> }}
 */
export function validateTree(nodes) {
  const nodeErrors = new Map();

  // Only validate non-existing (new) nodes
  const newNodes = nodes.filter((n) => !n._isExisting);

  if (newNodes.length === 0) {
    return { valid: true, nodeErrors };
  }

  // Check single root among new nodes (nodes whose parent is null or points to an existing node)
  const newRoots = newNodes.filter((n) => {
    if (n.parentClientNodeId === null) return true;
    // If parent is an existing node, this is effectively a root of the new subtree
    const parent = nodes.find((p) => p.clientNodeId === n.parentClientNodeId);
    return parent && parent._isExisting;
  });
  if (newRoots.length === 0) {
    nodeErrors.set('_global', ['validation.noRootFound']);
  }

  // Check all parents exist (in full nodes list, including existing)
  const nodeIds = new Set(nodes.map((n) => n.clientNodeId));
  for (const node of newNodes) {
    if (node.parentClientNodeId !== null && !nodeIds.has(node.parentClientNodeId)) {
      const existing = nodeErrors.get(node.clientNodeId) || [];
      existing.push('validation.parentNotFound');
      nodeErrors.set(node.clientNodeId, existing);
    }
  }

  // Validate each new node
  for (const node of newNodes) {
    const errors = validateNode(node, nodes);
    if (errors.length > 0) {
      const existing = nodeErrors.get(node.clientNodeId) || [];
      nodeErrors.set(node.clientNodeId, [...existing, ...errors]);
    }
  }

  const valid = nodeErrors.size === 0;
  return { valid, nodeErrors };
}

/**
 * Computes the status for a node based on validation.
 * Only changes draft ↔ ready. Does not touch creating/created/error.
 * @param {Object} node
 * @param {string[]} errors
 * @returns {'draft'|'ready'|'creating'|'created'|'error'}
 */
export function computeNodeStatus(node, errors) {
  if (node._isExisting || node.status === 'existing') return 'existing';
  if (node.status === 'creating' || node.status === 'created' || node.status === 'error') {
    return node.status;
  }
  return errors.length === 0 ? 'ready' : 'draft';
}
