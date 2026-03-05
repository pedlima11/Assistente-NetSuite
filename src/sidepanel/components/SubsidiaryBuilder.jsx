import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Building2, AlertTriangle } from 'lucide-react';
import SubsidiaryTree from './SubsidiaryTree.jsx';
import SubsidiaryDrawer from './SubsidiaryDrawer.jsx';
import { validateTree, computeNodeStatus } from './subsidiary-validation.js';

/**
 * Normaliza texto para comparacao (remove acentos, lowercase).
 */
function normalize(str) {
  return (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/**
 * Auto-match city/state text to IDs using lookupData.
 */
function autoMatchLookup(node, lookupData) {
  if (node._isExisting) return node;
  const updates = {};

  if (!node.brCityId && node.city && lookupData.brCities?.length > 0) {
    const cityNorm = normalize(node.city);
    const match = lookupData.brCities.find((c) => normalize(c.name) === cityNorm);
    if (match) updates.brCityId = match.id;
  }

  if (node.state && lookupData.brStates?.length > 0) {
    const stateNorm = normalize(node.state);
    const isUF = lookupData.brStates.some((s) => s.id === node.state.toUpperCase());
    if (!isUF) {
      const match = lookupData.brStates.find((s) => normalize(s.name) === stateNorm);
      if (match) updates.state = match.id;
    }
  }

  return Object.keys(updates).length > 0 ? { ...node, ...updates } : node;
}

/**
 * Converts existing NetSuite subsidiaries into tree nodes with _isExisting flag.
 * @param {Array<{id: string, name: string, cnpj: string, parent: string|null}>} subs
 * @returns {Object[]}
 */
function convertExistingSubs(subs) {
  return subs.map((s) => ({
    clientNodeId: `existing-${s.id}`,
    parentClientNodeId: s.parent ? `existing-${s.parent}` : null,
    name: s.name || '',
    cnpj: s.cnpj || '',
    ie: '',
    currency: '',
    fiscalcalendar: '',
    taxfiscalcalendar: '',
    address: '',
    addressNumber: '',
    brCityId: '',
    state: '',
    zipCode: '',
    parent: '',
    status: 'existing',
    _isExisting: true,
    netsuiteInternalId: s.id,
    errorMessage: null,
  }));
}

/**
 * Creates a blank subsidiary node.
 */
function createBlankNode(parentClientNodeId, inheritFrom) {
  return {
    clientNodeId: crypto.randomUUID(),
    parentClientNodeId,
    name: '',
    cnpj: '',
    ie: '',
    currency: inheritFrom?.currency || '',
    fiscalcalendar: inheritFrom?.fiscalcalendar || '',
    taxfiscalcalendar: inheritFrom?.taxfiscalcalendar || '',
    address: '',
    addressNumber: '',
    brCityId: '',
    state: '',
    zipCode: '',
    parent: '',
    status: 'draft',
    _isExisting: false,
    netsuiteInternalId: null,
    errorMessage: null,
  };
}

/**
 * Creates a node seeded from initial subsidiary data (from Claude parse).
 */
function createNodeFromSubsidiary(sub, parentClientNodeId) {
  return {
    clientNodeId: crypto.randomUUID(),
    parentClientNodeId: parentClientNodeId || null,
    name: sub.name || '',
    cnpj: sub.cnpj || '',
    ie: sub.ie || '',
    currency: sub.currency || '',
    fiscalcalendar: sub.fiscalcalendar || '',
    taxfiscalcalendar: sub.taxfiscalcalendar || '',
    address: sub.address || '',
    addressNumber: sub.addressNumber || '',
    brCityId: sub.brCityId || '',
    state: sub.state || '',
    zipCode: sub.zipCode || '',
    parent: sub.parent || '',
    status: 'draft',
    _isExisting: false,
    netsuiteInternalId: null,
    errorMessage: null,
  };
}

/**
 * Visual Subsidiary Builder — orchestrator component.
 * Shows existing NetSuite subsidiaries as a read-only tree, and allows
 * adding new nodes that will be created.
 *
 * @param {{
 *   initialSubsidiary: Object|null,
 *   lookupData: Object|null,
 *   onNodesChange: (nodes: Object[], isValid: boolean) => void,
 * }} props
 */
export default function SubsidiaryBuilder({ initialSubsidiary, lookupData, onNodesChange }) {
  // newNodes: only user-created nodes (editable)
  const [newNodes, setNewNodes] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const initializedRef = useRef(false);

  // Convert existing subsidiaries from lookupData into read-only tree nodes
  const existingNodes = useMemo(() => {
    if (!lookupData?.subsidiaries?.length) return [];
    return convertExistingSubs(lookupData.subsidiaries);
  }, [lookupData?.subsidiaries]);

  // When lookupData arrives for the first time, seed the initial new node
  useEffect(() => {
    if (initializedRef.current) return;
    if (!lookupData?.subsidiaries) return;
    initializedRef.current = true;

    // If we have initial subsidiary data (from Claude parse), attach it to an existing parent
    if (initialSubsidiary && initialSubsidiary.name) {
      // Try to find the parent by matching initialSubsidiary.parent (NS ID)
      const parentNsId = initialSubsidiary.parent;
      const parentClientNodeId = parentNsId ? `existing-${parentNsId}` : null;
      const seedNode = createNodeFromSubsidiary(initialSubsidiary, parentClientNodeId);
      setNewNodes([seedNode]);
    }
    // No initial data — user will add nodes manually via "+ Filial" on existing nodes
  }, [lookupData?.subsidiaries, initialSubsidiary]);

  // Combined tree: existing (read-only) + new (editable)
  const allNodes = useMemo(() => [...existingNodes, ...newNodes], [existingNodes, newNodes]);

  // Validation on new nodes, but pass allNodes so parent refs to existing nodes resolve
  const { valid, nodeErrors } = useMemo(() => {
    if (newNodes.length === 0) return { valid: true, nodeErrors: new Map() };
    return validateTree(allNodes);
  }, [allNodes]);

  // Compute statuses for new nodes based on validation
  const newNodesWithStatus = useMemo(() => {
    return newNodes.map((node) => {
      const errors = nodeErrors.get(node.clientNodeId) || [];
      const newStatus = computeNodeStatus(node, errors);
      return newStatus !== node.status ? { ...node, status: newStatus } : node;
    });
  }, [newNodes, nodeErrors]);

  // Sync computed statuses back
  useEffect(() => {
    const hasChanges = newNodesWithStatus.some((n, i) => n.status !== newNodes[i]?.status);
    if (hasChanges) {
      setNewNodes(newNodesWithStatus);
    }
  }, [newNodesWithStatus]);

  // Propagate to parent — only new nodes are relevant for creation
  useEffect(() => {
    const isValid = newNodes.length === 0 || valid;
    onNodesChange(newNodes, isValid);
  }, [newNodes, valid]);

  // Auto-match city/state when lookupData arrives
  useEffect(() => {
    if (!lookupData) return;
    setNewNodes((prev) => {
      if (prev.length === 0) return prev;
      const updated = prev.map((node) => autoMatchLookup(node, lookupData));
      const hasChanges = updated.some((n, i) => n !== prev[i]);
      return hasChanges ? updated : prev;
    });
  }, [lookupData]);

  const handleAddChild = useCallback((parentClientNodeId) => {
    // Parent can be either existing or new
    const parentNode = allNodes.find((n) => n.clientNodeId === parentClientNodeId);
    const newNode = createBlankNode(parentClientNodeId, parentNode);
    // If parent is an existing NS subsidiary, auto-fill the parent field with its NS internal ID
    if (parentNode?._isExisting && parentNode.netsuiteInternalId) {
      newNode.parent = String(parentNode.netsuiteInternalId);
    }
    setNewNodes((prev) => [...prev, newNode]);
    setSelectedNodeId(newNode.clientNodeId);
  }, [allNodes]);

  const handleUpdateNode = useCallback((updatedNode) => {
    setNewNodes((prev) => prev.map((n) =>
      n.clientNodeId === updatedNode.clientNodeId ? { ...updatedNode, status: 'draft' } : n
    ));
  }, []);

  const handleDeleteNode = useCallback((clientNodeId) => {
    // Only delete new nodes (existing nodes can't be deleted)
    const allCurrent = [...existingNodes, ...newNodes];
    const toDelete = new Set();
    function collect(id) {
      toDelete.add(id);
      allCurrent.filter((n) => n.parentClientNodeId === id).forEach((child) => {
        // Only collect new nodes for deletion (don't delete existing)
        if (!child._isExisting) collect(child.clientNodeId);
      });
    }
    collect(clientNodeId);
    setNewNodes((prev) => prev.filter((n) => !toDelete.has(n.clientNodeId)));
    if (toDelete.has(selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [existingNodes, newNodes, selectedNodeId]);

  const selectedNode = allNodes.find((n) => n.clientNodeId === selectedNodeId) || null;
  const globalErrors = nodeErrors.get('_global') || [];
  const newCount = newNodes.length;

  return (
    <div className="bg-white rounded-lg border border-ocean-30 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-ocean-120" />
          <h3 className="text-sm font-semibold text-ocean-180">Estrutura Societaria</h3>
        </div>
        <div className="flex items-center gap-3">
          {existingNodes.length > 0 && (
            <span className="text-xs text-ocean-60">
              {existingNodes.length} existente{existingNodes.length !== 1 ? 's' : ''}
            </span>
          )}
          {newCount > 0 && (
            <span className="text-xs text-ocean-120 font-medium">
              {newCount} nova{newCount !== 1 ? 's' : ''}
            </span>
          )}
          {newCount > 0 && (
            valid ? (
              <span className="text-xs text-pine font-medium">Validado</span>
            ) : (
              <span className="text-xs text-golden font-medium">Incompleto</span>
            )
          )}
        </div>
      </div>

      {/* Global errors */}
      {globalErrors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-rose flex-shrink-0 mt-0.5" />
          <div>
            {globalErrors.map((e, i) => (
              <p key={i} className="text-xs text-rose">{e}</p>
            ))}
          </div>
        </div>
      )}

      {/* Hint */}
      <p className="text-xs text-ocean-60 mb-3">
        {existingNodes.length > 0
          ? 'Filiais cinza ja existem no NetSuite. Clique em "+ Filial" para adicionar novas.'
          : 'Clique em uma filial para editar. Use "+ Filial" para adicionar subsidiarias filhas.'
        }
      </p>

      {/* Tree — shows both existing and new nodes */}
      <SubsidiaryTree
        nodes={allNodes}
        nodeErrors={nodeErrors}
        selectedNodeId={selectedNodeId}
        onSelectNode={setSelectedNodeId}
        onAddChild={handleAddChild}
      />

      {/* Drawer */}
      <SubsidiaryDrawer
        node={selectedNode}
        lookupData={lookupData}
        existingSubsidiaries={lookupData?.subsidiaries}
        validationErrors={selectedNode ? (nodeErrors.get(selectedNode.clientNodeId) || []) : []}
        onSave={handleUpdateNode}
        onClose={() => setSelectedNodeId(null)}
        onDelete={handleDeleteNode}
      />
    </div>
  );
}
