import React, { useState, useMemo, useRef, useCallback } from 'react';
import InvoiceFilterBar from './InvoiceFilterBar.jsx';
import InvoiceDocumentRow from './InvoiceDocumentRow.jsx';
import RuleBoxSidebar from './RuleBoxSidebar.jsx';
import { groupItemsByDocument, recalcAffectedRules, buildEvidenceGroups } from '../../../shared/item-grouping.js';
import { CANONICAL_TAX_TYPE, resolveParamType, classifyCFOP } from '../../../shared/tax-rule-core.js';

/** Mapa tipo canonico → NetSuite tax code ID */
const TAX_TYPE_TO_CODE = {
  ICMS: 'ICMS_BR', ICMS_ST: 'ICMS_ST_BR', ICMS_DIFAL: 'ICMS_DIFAL_BR',
  FCP: 'FCP_BR', FCP_ST: 'FCP_ST_BR',
  IPI: 'IPI_BR', PIS: 'PIS_BR', COFINS: 'COFINS_BR',
  ISS: 'ISS_BR', CBS: 'CBS_2026_BR', IBS: 'IBS_2026_BR', IS: 'IS_2026_BR',
};

/**
 * Agrega impostos de um conjunto de itens por tipo canonico.
 * @param {Set<string>|string[]} itemIds
 * @param {Map<string, Object>} itemById
 * @returns {Map<string, Map<string, { count: number, aliqSum: number, cClassTribCounts: Map }>>}
 */
function aggregateTaxes(itemIds, itemById) {
  const taxAgg = new Map();
  for (const id of itemIds) {
    const item = itemById.get(id);
    if (!item?.taxes) continue;
    for (const t of item.taxes) {
      const ct = CANONICAL_TAX_TYPE[t.type] || (t.type || '').toUpperCase();
      if (!TAX_TYPE_TO_CODE[ct]) continue;
      if (!taxAgg.has(ct)) taxAgg.set(ct, new Map());
      const cstMap = taxAgg.get(ct);
      const cst = t.cst || '_none';
      if (!cstMap.has(cst)) cstMap.set(cst, { count: 0, aliqSum: 0, cClassTribCounts: new Map() });
      const e = cstMap.get(cst);
      e.count++;
      e.aliqSum += t.aliq || 0;
      if (t.cClassTrib) {
        e.cClassTribCounts.set(t.cClassTrib, (e.cClassTribCounts.get(t.cClassTrib) || 0) + 1);
      }
    }
  }
  return taxAgg;
}

/**
 * Converte taxAgg (de aggregateTaxes) em array de determinacoes.
 * @param {Map} taxAgg
 * @param {string} ruleId
 * @param {string} direction
 * @param {string} [validoAPartirDe]
 * @returns {Object[]}
 */
function buildDetsFromAgg(taxAgg, ruleId, direction, validoAPartirDe) {
  const dets = [];
  for (const [ct, cstMap] of taxAgg) {
    const [cst, data] = [...cstMap.entries()].sort((a, b) => b[1].count - a[1].count)[0];
    if (cst === '_none' && data.aliqSum === 0) continue;
    const avgAliq = Math.round((data.aliqSum / data.count) * 100) / 100;
    let dominantCClassTrib = null;
    if (data.cClassTribCounts.size > 0) {
      dominantCClassTrib = [...data.cClassTribCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
    dets.push({
      externalId: `det-${ruleId}-${ct.toLowerCase()}`,
      ruleExternalId: ruleId,
      codigoImposto: TAX_TYPE_TO_CODE[ct],
      aliquota: avgAliq,
      tipoParametro: resolveParamType(ct, cst, direction, dominantCClassTrib) || '',
      valorParametro: '',
      valorAbatimento: '',
      validoAPartirDe: validoAPartirDe || '',
      cst,
    });
  }
  return dets;
}

/**
 * Container principal da view "Lista".
 * Grid: documentos a esquerda, sidebar de evidencia/regras a direita.
 * Orquestra DnD, filtros e reassignment de items entre regras.
 */
export default function InvoiceExplorer({ items, setItems, rules, setRules, determinations, setDeterminations, paramTypeOptions, config }) {
  const [filters, setFilters] = useState({
    cfop: '', uf: '', fornecedor: '', ncm: '', dateFrom: '', dateTo: '',
  });
  const [dropTargetRuleId, setDropTargetRuleId] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null); // { itemIds, targetRuleId, docKey }
  const dragRef = useRef(null);

  // Ordered rule IDs for color mapping
  const allRuleIds = useMemo(() => rules.map(r => r.externalId), [rules]);

  // Rule name map
  const ruleNameMap = useMemo(() => {
    const m = new Map();
    for (const r of rules) m.set(r.externalId, r.name || `CFOP ${r.cfop}`);
    return m;
  }, [rules]);

  // Index: _itemId → item (O(1) lookup for materialization)
  const itemById = useMemo(() => new Map(items.map(i => [i._itemId, i])), [items]);

  // Active items (non-rejected)
  const activeItems = useMemo(() => items.filter(i => !i._rejected), [items]);

  // Evidence groups (client-side, single-pass)
  const groups = useMemo(() => buildEvidenceGroups(activeItems), [activeItems]);

  // Group items into documents
  const allDocs = useMemo(() => groupItemsByDocument(activeItems), [activeItems]);

  // Filter documents
  const filteredDocs = useMemo(() => {
    return allDocs.filter(doc => {
      if (filters.cfop && !doc.items.some(i => String(i.cfop).startsWith(filters.cfop))) return false;
      if (filters.uf && doc.emitUF !== filters.uf) return false;
      if (filters.fornecedor) {
        const q = filters.fornecedor.toLowerCase();
        const matchName = (doc.emitName || '').toLowerCase().includes(q);
        const matchCnpj = (doc.emitCNPJ || '').includes(filters.fornecedor);
        if (!matchName && !matchCnpj) return false;
      }
      if (filters.ncm && !doc.items.some(i => (i.ncm || '').startsWith(filters.ncm))) return false;
      if (filters.dateFrom && doc.dtDoc && doc.dtDoc < filters.dateFrom) return false;
      if (filters.dateTo && doc.dtDoc && doc.dtDoc > filters.dateTo) return false;
      return true;
    });
  }, [allDocs, filters]);

  // ── Reassignment logic ──

  const reassignItems = useCallback((itemIds, targetRuleId) => {
    // Target null = unassign
    const effectiveTargetId = targetRuleId === '__unassigned__' ? null : targetRuleId;

    // Find source rule (from first item)
    const firstItem = items.find(i => i._itemId === itemIds[0]);
    const sourceRuleId = firstItem?.assignedRuleId || null;

    if (sourceRuleId === effectiveTargetId) return; // noop

    // Update items
    const newItems = items.map(item =>
      itemIds.includes(item._itemId) ? { ...item, assignedRuleId: effectiveTargetId } : item
    );
    setItems(newItems);

    // Incremental recalc of only 2 affected rules
    const sourceRule = sourceRuleId ? rules.find(r => r.externalId === sourceRuleId) : null;
    const targetRule = effectiveTargetId ? rules.find(r => r.externalId === effectiveTargetId) : null;
    const { source, target } = recalcAffectedRules(newItems, sourceRule, targetRule);

    setRules(prev => prev.map(r => {
      if (source && r.externalId === sourceRuleId) return source;
      if (target && r.externalId === effectiveTargetId) return target;
      return r;
    }));
  }, [items, rules, setItems, setRules]);

  const createRuleFromItems = useCallback((itemIds) => {
    const affectedItems = itemIds.map(id => itemById.get(id)).filter(Boolean);
    if (affectedItems.length === 0) return;

    const cfop = affectedItems[0].cfop || '';
    const emitUF = affectedItems[0].emitUF || '';
    const destUF = affectedItems[0].destUF || '';

    const newRuleId = `rule-new-${Date.now()}`;
    const newRule = {
      externalId: newRuleId,
      name: `Nova regra — CFOP ${cfop}`,
      cfop,
      ufEmissor: emitUF,
      ufDestinatario: destUF,
      regimeEmissor: config?.regimeEmissor || '',
      regimeDestinatario: config?.regimeDestinatario || '',
      lobEmissor: config?.lobEmissor || '',
      lobDestinatario: config?.lobDestinatario || '',
      subsidiaryName: config?.subsidiaryName || '',
      validoAPartirDe: config?.validoAPartirDe || '',
      _nfeCount: affectedItems.length,
      _totalValue: affectedItems.reduce((s, i) => s + (i.vlItem || 0), 0),
    };

    setRules(prev => [...prev, newRule]);

    // Reassign items to new rule
    const sourceRuleId = affectedItems[0].assignedRuleId;
    const newItems = items.map(item =>
      itemIds.includes(item._itemId) ? { ...item, assignedRuleId: newRuleId } : item
    );
    setItems(newItems);

    // Recalc source rule
    if (sourceRuleId) {
      const sourceRule = rules.find(r => r.externalId === sourceRuleId);
      if (sourceRule) {
        const { source } = recalcAffectedRules(newItems, sourceRule, null);
        if (source) {
          setRules(prev => prev.map(r => r.externalId === sourceRuleId ? source : r));
        }
      }
    }
  }, [items, itemById, rules, setItems, setRules]);

  // ── Rule management handlers ──

  // Check if rule already exists for this group (prevent duplicates)
  const existingRuleKeys = useMemo(() => {
    const keys = new Set();
    for (const r of rules) keys.add(`${r.cfop}|${r.ufEmissor}|${r.ufDestinatario}`);
    return keys;
  }, [rules]);

  const createRuleFromGroup = useCallback((group) => {
    // Prevent duplicate rules for same CFOP + route
    const groupKey = `${group.cfop}|${group.emitUF}|${group.destUF}`;
    if (existingRuleKeys.has(groupKey)) return;

    const newRuleId = `rule-grp-${Date.now()}`;
    const direction = group.direction === 'saida' ? 'saida' : 'entrada';

    // Build descriptive name: "Venda de Produto de PR para SP"
    const cfopInfo = classifyCFOP(Number(group.cfop) || 0);
    const isService = (cfopInfo.itemCategory || '').toLowerCase().includes('servico');
    const typeLabel = isService ? 'Servico' : 'Produto';
    const opLabel = group.operationType || cfopInfo.operationType || 'Operacao';
    const ruleName = `${opLabel} de ${typeLabel} de ${group.emitUF} para ${group.destUF}`;

    const newRule = {
      externalId: newRuleId,
      name: ruleName,
      cfop: group.cfop,
      ufEmissor: group.emitUF,
      ufDestinatario: group.destUF,
      direction: group.direction,
      operationType: group.operationType,
      regimeEmissor: config?.regimeEmissor || '',
      regimeDestinatario: config?.regimeDestinatario || '',
      lobEmissor: config?.lobEmissor || '',
      lobDestinatario: config?.lobDestinatario || '',
      subsidiaryName: config?.subsidiaryName || '',
      validoAPartirDe: config?.validoAPartirDe || '',
      _nfeCount: group.itemCount,
      _totalValue: group.totalValue,
    };

    // Aggregate taxes and create determinations
    const taxAgg = aggregateTaxes(group.itemIds, itemById);
    const newDets = buildDetsFromAgg(taxAgg, newRuleId, direction, config?.validoAPartirDe);
    setDeterminations(prev => [...prev, ...newDets]);

    setRules(prev => [...prev, newRule]);

    // Assign all group items to new rule
    const idSet = group.itemIds;
    const newItems = items.map(item =>
      idSet.has(item._itemId) ? { ...item, assignedRuleId: newRuleId } : item
    );
    setItems(newItems);
  }, [items, itemById, config, existingRuleKeys, setItems, setRules, setDeterminations]);

  // Batch: create rules for ALL pending evidence groups in one state update
  const createAllRulesFromGroups = useCallback(() => {
    const pendingGroups = groups.filter(g => !existingRuleKeys.has(`${g.cfop}|${g.emitUF}|${g.destUF}`));
    if (pendingGroups.length === 0) return;

    const allNewRules = [];
    const allNewDets = [];
    const itemAssignments = new Map(); // _itemId → ruleId

    for (const group of pendingGroups) {
      const newRuleId = `rule-grp-${Date.now()}-${allNewRules.length}`;
      const direction = group.direction === 'saida' ? 'saida' : 'entrada';

      const cfopInfo = classifyCFOP(Number(group.cfop) || 0);
      const isService = (cfopInfo.itemCategory || '').toLowerCase().includes('servico');
      const typeLabel = isService ? 'Servico' : 'Produto';
      const opLabel = group.operationType || cfopInfo.operationType || 'Operacao';
      const ruleName = `${opLabel} de ${typeLabel} de ${group.emitUF} para ${group.destUF}`;

      allNewRules.push({
        externalId: newRuleId,
        name: ruleName,
        cfop: group.cfop,
        ufEmissor: group.emitUF,
        ufDestinatario: group.destUF,
        direction: group.direction,
        operationType: group.operationType,
        regimeEmissor: config?.regimeEmissor || '',
        regimeDestinatario: config?.regimeDestinatario || '',
        lobEmissor: config?.lobEmissor || '',
        lobDestinatario: config?.lobDestinatario || '',
        subsidiaryName: config?.subsidiaryName || '',
        validoAPartirDe: config?.validoAPartirDe || '',
        _nfeCount: group.itemCount,
        _totalValue: group.totalValue,
      });

      // Aggregate taxes and create determinations
      const taxAgg = aggregateTaxes(group.itemIds, itemById);
      const groupDets = buildDetsFromAgg(taxAgg, newRuleId, direction, config?.validoAPartirDe);
      allNewDets.push(...groupDets);

      // Assign items
      for (const id of group.itemIds) {
        if (!itemAssignments.has(id)) itemAssignments.set(id, newRuleId);
      }
    }

    // Single state update for all
    setRules(prev => [...prev, ...allNewRules]);
    setDeterminations(prev => [...prev, ...allNewDets]);
    setItems(prev => prev.map(item =>
      itemAssignments.has(item._itemId) ? { ...item, assignedRuleId: itemAssignments.get(item._itemId) } : item
    ));
  }, [groups, existingRuleKeys, items, itemById, config, setItems, setRules, setDeterminations]);

  const removeRule = useCallback((ruleId) => {
    // Cascade: find exception children
    const childIds = rules
      .filter(r => r._isException && r.parent === ruleId)
      .map(r => r.externalId);
    const allIdsToRemove = new Set([ruleId, ...childIds]);

    // Unassign all items from parent + exceptions
    const newItems = items.map(item =>
      allIdsToRemove.has(item.assignedRuleId) ? { ...item, assignedRuleId: null } : item
    );
    setItems(newItems);
    setRules(prev => prev.filter(r => !allIdsToRemove.has(r.externalId)));
    setDeterminations(prev => prev.filter(d => !allIdsToRemove.has(d.ruleExternalId)));
  }, [items, rules, setItems, setRules, setDeterminations]);

  // ── Exception handlers ──

  const createExceptionFromNcm = useCallback((parentRuleId, ncm, ncmItemIds) => {
    const parentRule = rules.find(r => r.externalId === parentRuleId);
    if (!parentRule) return;

    const exceptionId = `rule-exc-${Date.now()}`;
    const direction = parentRule.direction === 'saida' ? 'saida' : 'entrada';

    // Compute total value for exception
    let totalValue = 0;
    for (const id of ncmItemIds) {
      const item = itemById.get(id);
      if (item) totalValue += item.vlItem || 0;
    }

    const exceptionRule = {
      externalId: exceptionId,
      name: `${parentRule.name} — NCM ${ncm === '_sem_ncm' ? '(sem NCM)' : ncm}`,
      cfop: parentRule.cfop,
      ufEmissor: parentRule.ufEmissor,
      ufDestinatario: parentRule.ufDestinatario,
      direction: parentRule.direction,
      operationType: parentRule.operationType,
      regimeEmissor: parentRule.regimeEmissor,
      regimeDestinatario: parentRule.regimeDestinatario,
      lobEmissor: parentRule.lobEmissor,
      lobDestinatario: parentRule.lobDestinatario,
      subsidiaryName: parentRule.subsidiaryName,
      validoAPartirDe: parentRule.validoAPartirDe,
      ncm: ncm === '_sem_ncm' ? '' : ncm,
      parent: parentRuleId,
      _isException: true,
      _nfeCount: ncmItemIds.size || ncmItemIds.length,
      _totalValue: totalValue,
    };

    // Auto-suggest determinations from NCM sub-group
    const taxAgg = aggregateTaxes(ncmItemIds, itemById);
    const newDets = buildDetsFromAgg(taxAgg, exceptionId, direction, config?.validoAPartirDe);

    setRules(prev => [...prev, exceptionRule]);
    setDeterminations(prev => [...prev, ...newDets]);

    // Reassign items from parent to exception
    const idSet = ncmItemIds instanceof Set ? ncmItemIds : new Set(ncmItemIds);
    setItems(prev => prev.map(item =>
      idSet.has(item._itemId) ? { ...item, assignedRuleId: exceptionId } : item
    ));
  }, [items, itemById, rules, config, setItems, setRules, setDeterminations]);

  const removeException = useCallback((exceptionId, parentRuleId) => {
    // Move items back to parent
    setItems(prev => prev.map(item =>
      item.assignedRuleId === exceptionId
        ? { ...item, assignedRuleId: parentRuleId }
        : item
    ));
    // Remove exception rule + its dets
    setRules(prev => prev.filter(r => r.externalId !== exceptionId));
    setDeterminations(prev => prev.filter(d => d.ruleExternalId !== exceptionId));
  }, [setItems, setRules, setDeterminations]);

  const updateRuleName = useCallback((ruleId, name) => {
    setRules(prev => prev.map(r => r.externalId === ruleId ? { ...r, name } : r));
  }, [setRules]);

  // ── Determination handlers ──

  const updateDet = useCallback((detId, field, value) => {
    setDeterminations(prev => prev.map(d => d.externalId === detId ? { ...d, [field]: value } : d));
  }, [setDeterminations]);

  const removeDet = useCallback((detId) => {
    setDeterminations(prev => prev.filter(d => d.externalId !== detId));
  }, [setDeterminations]);

  const addDet = useCallback((ruleExtId) => {
    setDeterminations(prev => [...prev, {
      externalId: `det-${ruleExtId}-${Date.now()}`,
      ruleExternalId: ruleExtId,
      codigoImposto: 'ICMS_BR',
      aliquota: 0,
      tipoParametro: '',
      valorParametro: '',
      valorAbatimento: '',
      validoAPartirDe: config?.validoAPartirDe || '',
      cst: '',
    }]);
  }, [setDeterminations, config]);

  // ── DnD handlers ──

  function handleDragStart(info) {
    dragRef.current = info;
  }

  function handleDragEnd() {
    dragRef.current = null;
    setDropTargetRuleId(null);
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const ruleId = e.currentTarget.dataset.ruleId;
    if (ruleId && ruleId !== dropTargetRuleId) {
      setDropTargetRuleId(ruleId);
    }
  }

  function handleDragLeave(e) {
    // Only clear if leaving the element (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDropTargetRuleId(null);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDropTargetRuleId(null);

    const targetRuleId = e.currentTarget.dataset.ruleId;
    if (!targetRuleId) return;

    let data;
    try {
      data = JSON.parse(e.dataTransfer.getData('text/plain'));
    } catch {
      return;
    }

    if (!data || !data.ids || data.ids.length === 0) return;

    if (targetRuleId === '__new__') {
      createRuleFromItems(data.ids);
      return;
    }

    // Document drag with divergent items — show confirmation
    if (data.type === 'document' && data.isDivergent) {
      setConfirmDialog({ itemIds: data.ids, targetRuleId, docKey: data.docKey });
      return;
    }

    reassignItems(data.ids, targetRuleId);
  }

  // ── Confirm dialog handlers ──

  function handleConfirmAll() {
    if (!confirmDialog) return;
    reassignItems(confirmDialog.itemIds, confirmDialog.targetRuleId);
    setConfirmDialog(null);
  }

  function handleConfirmSameRule() {
    if (!confirmDialog) return;
    // Only move items that share the same rule as the majority
    const ruleCount = new Map();
    for (const id of confirmDialog.itemIds) {
      const item = itemById.get(id);
      if (item?.assignedRuleId) {
        ruleCount.set(item.assignedRuleId, (ruleCount.get(item.assignedRuleId) || 0) + 1);
      }
    }
    // Find the most common rule
    let majorityRule = null;
    let maxCount = 0;
    for (const [rId, count] of ruleCount) {
      if (count > maxCount) { majorityRule = rId; maxCount = count; }
    }

    if (majorityRule) {
      const filteredIds = confirmDialog.itemIds.filter(id => {
        const item = itemById.get(id);
        return item?.assignedRuleId === majorityRule;
      });
      reassignItems(filteredIds, confirmDialog.targetRuleId);
    }
    setConfirmDialog(null);
  }

  function handleConfirmCancel() {
    setConfirmDialog(null);
  }

  return (
    <div className="space-y-3">
      {/* Filters */}
      <InvoiceFilterBar
        filters={filters}
        setFilters={setFilters}
        totalCount={allDocs.length}
        filteredCount={filteredDocs.length}
      />

      {/* Main grid: documents + sidebar */}
      <div className="grid grid-cols-[1fr_480px] gap-4">
        {/* Document list */}
        <div className="space-y-1.5 max-h-[calc(100vh-280px)] overflow-y-auto">
          {filteredDocs.length === 0 ? (
            <div className="text-center py-8 text-sm text-ocean-60">
              {allDocs.length === 0 ? 'Nenhum item encontrado' : 'Nenhum documento corresponde aos filtros'}
            </div>
          ) : (
            filteredDocs.map(doc => (
              <InvoiceDocumentRow
                key={doc.docKey}
                doc={doc}
                allRuleIds={allRuleIds}
                ruleNameMap={ruleNameMap}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onReassignItems={reassignItems}
              />
            ))
          )}
        </div>

        {/* Evidence + rule sidebar */}
        <RuleBoxSidebar
          rules={rules}
          allRuleIds={allRuleIds}
          items={items}
          groups={groups}
          itemById={itemById}
          determinations={determinations}
          dropTargetRuleId={dropTargetRuleId}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onCreateRuleFromGroup={createRuleFromGroup}
          onCreateAllRules={createAllRulesFromGroups}
          onRemoveRule={removeRule}
          onUpdateRuleName={updateRuleName}
          onUpdateDet={updateDet}
          onRemoveDet={removeDet}
          onAddDet={addDet}
          onCreateException={createExceptionFromNcm}
          onRemoveException={removeException}
          paramTypeOptions={paramTypeOptions}
        />
      </div>

      {/* Confirm dialog for divergent NF drag */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-lg shadow-xl p-5 max-w-sm space-y-3">
            <h4 className="text-sm font-medium text-ocean-180">Mover nota inteira?</h4>
            <p className="text-xs text-ocean-100">
              Esta NF possui itens atribuidos a regras diferentes. O que deseja fazer?
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={handleConfirmAll}
                className="px-3 py-2 text-xs font-medium bg-ocean-120 text-white rounded-md hover:bg-ocean-150 transition-colors"
              >
                Mover todos os itens
              </button>
              <button
                onClick={handleConfirmSameRule}
                className="px-3 py-2 text-xs font-medium border border-ocean-30 text-ocean-150 rounded-md hover:bg-ocean-10 transition-colors"
              >
                Mover apenas itens da regra majoritaria
              </button>
              <button
                onClick={handleConfirmCancel}
                className="px-3 py-2 text-xs text-ocean-100 hover:text-ocean-150 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
