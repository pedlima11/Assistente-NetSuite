import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  ChevronDown, ChevronUp, Search, RotateCcw, Save, Hash,
  List, Expand, Shrink,
} from 'lucide-react';
import CoaTreeRow from './CoaTreeRow.jsx';
import CoaProblemsPanel from './CoaProblemsPanel.jsx';
import CoaAccountDrawer from './CoaAccountDrawer.jsx';
import {
  initWorkingAccounts,
  buildAccountMap,
  buildChildrenMap,
  buildCodeIndex,
  flattenVisibleTree,
  moveAccount,
  isDropValid,
  autoFixPostingParents,
  bulkFindReplace,
  bulkPatch,
  normalizeCodes,
  exportToImportFormat,
  computeDefaultExpanded,
  searchAccounts,
  hashRawAccounts,
  recalcLevels,
  refreshModifiedFlags,
  suggestCodeForParent,
  ORPHAN_ROOT_ID,
} from '../../services/coa-modeling.js';
import { validateAllAccounts, computeAccountStatus } from '../../services/coa-validation.js';
import { COADraft } from '../../services/coa-draft.js';

/**
 * Orquestrador principal do modelador de Plano de Contas.
 * Gerencia state, wiring entre paineis, DnD, toolbar, e upward callback.
 *
 * @param {{
 *   rawAccounts: Object[],
 *   existingAccounts: Map<string, Object>,
 *   onAccountsReady: (exportedAccounts: Object[], isValid: boolean) => void,
 * }} props
 */
export default function CoaModeler({ rawAccounts, existingAccounts, onAccountsReady }) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [workingAccounts, setWorkingAccounts] = useState([]);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [activeFilter, setActiveFilter] = useState(null);
  const [drawerAccountId, setDrawerAccountId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [draftSaved, setDraftSaved] = useState(false);

  // DnD state (refs to avoid re-render during drag)
  const draggedIdRef = useRef(null);
  const [dropTarget, setDropTarget] = useState({ id: null, position: null });
  const expandTimerRef = useRef(null);

  const initializedRef = useRef(false);

  // ── Init ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (initializedRef.current || !rawAccounts || rawAccounts.length === 0) return;
    initializedRef.current = true;

    // Try loading draft
    const draft = COADraft.load(rawAccounts);
    if (draft) {
      setWorkingAccounts(draft.workingAccounts);
      setExpandedIds(draft.expandedIds);
      setSelectedIds(draft.selectedIds);
    } else {
      const initial = initWorkingAccounts(rawAccounts, existingAccounts);
      setWorkingAccounts(initial);
      setExpandedIds(computeDefaultExpanded(initial));
    }
  }, [rawAccounts, existingAccounts]);

  // ── Derived state (useMemo) ────────────────────────────────────────────────
  const accountMap = useMemo(() => buildAccountMap(workingAccounts), [workingAccounts]);
  const childrenMap = useMemo(() => buildChildrenMap(workingAccounts), [workingAccounts]);

  const validationResult = useMemo(() => validateAllAccounts(workingAccounts), [workingAccounts]);

  // Compute statuses and sync back
  const accountsWithStatus = useMemo(() => {
    const { accountErrors, accountWarnings } = validationResult;
    return workingAccounts.map((a) => {
      if (a._isOrphanRoot) {
        // Update orphan count
        const orphanChildren = childrenMap.get(ORPHAN_ROOT_ID) || [];
        return { ...a, _orphanCount: orphanChildren.length };
      }
      const errors = accountErrors.get(a.clientAccountId) || [];
      const warnings = accountWarnings.get(a.clientAccountId) || [];
      const newStatus = computeAccountStatus(errors, warnings);
      const issues = [...errors, ...warnings];
      if (newStatus !== a.status || issues.length !== a.issues.length) {
        return { ...a, status: newStatus, issues };
      }
      return a;
    });
  }, [workingAccounts, validationResult, childrenMap]);

  // Sync statuses back to state (only if changed)
  useEffect(() => {
    const hasChanges = accountsWithStatus.some((a, i) =>
      a.status !== workingAccounts[i]?.status || a.issues !== workingAccounts[i]?.issues
    );
    if (hasChanges) {
      setWorkingAccounts(accountsWithStatus);
    }
  }, [accountsWithStatus]);

  // Search
  const { matchIds: searchMatchIds, expandIds: searchExpandIds } = useMemo(
    () => searchAccounts(workingAccounts, searchQuery, accountMap),
    [workingAccounts, searchQuery, accountMap]
  );

  // Auto-expand search results
  useEffect(() => {
    if (searchExpandIds.size > 0) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        for (const id of searchExpandIds) next.add(id);
        return next;
      });
    }
  }, [searchExpandIds]);

  // Filter highlights (from problems panel)
  const filterHighlights = useMemo(() => {
    if (!activeFilter || !validationResult) return new Set();
    const { errorBuckets, warningBuckets } = validationResult;
    const bucket = errorBuckets[activeFilter] || warningBuckets[activeFilter];
    if (Array.isArray(bucket)) return new Set(bucket);
    return new Set();
  }, [activeFilter, validationResult]);

  // Effective expanded = user expanded + search expanded
  const effectiveExpanded = useMemo(() => {
    if (searchQuery.length >= 2) {
      const merged = new Set(expandedIds);
      for (const id of searchExpandIds) merged.add(id);
      return merged;
    }
    return expandedIds;
  }, [expandedIds, searchExpandIds, searchQuery]);

  // Visible tree (flat list for render)
  const visibleTree = useMemo(
    () => flattenVisibleTree(workingAccounts, childrenMap, effectiveExpanded),
    [workingAccounts, childrenMap, effectiveExpanded]
  );

  // Drawer account
  const drawerAccount = useMemo(
    () => drawerAccountId ? accountMap.get(drawerAccountId) || null : null,
    [drawerAccountId, accountMap]
  );
  const drawerIssues = useMemo(() => {
    if (!drawerAccountId) return [];
    const errors = validationResult.accountErrors.get(drawerAccountId) || [];
    const warnings = validationResult.accountWarnings.get(drawerAccountId) || [];
    return [...errors, ...warnings];
  }, [drawerAccountId, validationResult]);

  // Stats
  const realAccountCount = workingAccounts.filter((a) => !a._isOrphanRoot).length;

  // ── Upward callback ────────────────────────────────────────────────────────
  useEffect(() => {
    if (workingAccounts.length === 0) return;
    const exported = exportToImportFormat(workingAccounts);
    const isValid = !validationResult.hasBlockingErrors;
    onAccountsReady(exported, isValid);
  }, [workingAccounts, validationResult.hasBlockingErrors, onAccountsReady]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleSelect = useCallback((e, accountId) => {
    if (e.ctrlKey || e.metaKey) {
      // Toggle multi-select
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(accountId)) {
          next.delete(accountId);
        } else {
          next.add(accountId);
        }
        return next;
      });
    } else {
      // Single select
      setSelectedIds(new Set([accountId]));
      setDrawerAccountId(accountId);
    }
  }, []);

  const handleToggleExpand = useCallback((accountId) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
      }
      return next;
    });
  }, []);

  // DnD handlers
  const handleDragStart = useCallback((id) => {
    draggedIdRef.current = id;
  }, []);

  const handleDragOver = useCallback((targetId, position, e) => {
    if (!draggedIdRef.current) return;
    if (draggedIdRef.current === targetId && position === 'into') return;

    setDropTarget({ id: targetId, position });

    // Auto-expand on hover (600ms)
    if (!effectiveExpanded.has(targetId) && childrenMap.has(targetId)) {
      if (expandTimerRef.current?.id !== targetId) {
        clearTimeout(expandTimerRef.current?.timer);
        expandTimerRef.current = {
          id: targetId,
          timer: setTimeout(() => {
            setExpandedIds((prev) => new Set([...prev, targetId]));
          }, 600),
        };
      }
    }
  }, [effectiveExpanded, childrenMap]);

  const handleDrop = useCallback((targetId, position) => {
    const draggedId = draggedIdRef.current;
    if (!draggedId || draggedId === targetId) {
      setDropTarget({ id: null, position: null });
      draggedIdRef.current = null;
      return;
    }

    const target = accountMap.get(targetId);
    let newParentId;

    if (position === 'into') {
      newParentId = targetId;
    } else {
      // before/after: same parent as target
      newParentId = target?.parentClientAccountId || null;
    }

    // Validate
    if (isDropValid(draggedId, newParentId, accountMap, childrenMap)) {
      setWorkingAccounts((prev) => {
        let result = moveAccount(prev, draggedId, newParentId);

        // Check level-code mismatch after move
        const movedAcct = result.find((a) => a.clientAccountId === draggedId);
        const newParent = newParentId ? accountMap.get(newParentId) : null;

        if (movedAcct && newParent && newParent.code) {
          const movedCodeSegments = movedAcct.code?.split(/[.\-]/).filter(Boolean).length || 0;
          const parentCodeSegments = newParent.code.split(/[.\-]/).filter(Boolean).length || 0;
          const expectedSegments = parentCodeSegments + 1;

          if (movedCodeSegments > 0 && movedCodeSegments !== expectedSegments) {
            const currentChildrenMap = buildChildrenMap(result);
            const currentAccountMap = buildAccountMap(result);
            const suggested = suggestCodeForParent(newParent.code, currentChildrenMap, currentAccountMap, newParentId);

            if (suggested && window.confirm(
              `O codigo "${movedAcct.code}" tem ${movedCodeSegments} segmento${movedCodeSegments !== 1 ? 's' : ''}, ` +
              `mas o novo pai "${newParent.code}" espera ${expectedSegments} segmento${expectedSegments !== 1 ? 's' : ''}.\n\n` +
              `Deseja alterar o codigo para "${suggested}"?`
            )) {
              result = result.map((a) =>
                a.clientAccountId === draggedId ? { ...a, code: suggested } : a
              );
            }
          }
        }

        return refreshModifiedFlags(result);
      });
    }

    setDropTarget({ id: null, position: null });
    draggedIdRef.current = null;
    clearTimeout(expandTimerRef.current?.timer);
    expandTimerRef.current = null;
  }, [accountMap, childrenMap]);

  const handleDragEnd = useCallback(() => {
    setDropTarget({ id: null, position: null });
    draggedIdRef.current = null;
    clearTimeout(expandTimerRef.current?.timer);
    expandTimerRef.current = null;
  }, []);

  // Drawer handlers
  const handleDrawerSave = useCallback((updated) => {
    setWorkingAccounts((prev) => {
      const result = prev.map((a) =>
        a.clientAccountId === updated.clientAccountId ? { ...a, ...updated } : a
      );
      return refreshModifiedFlags(recalcLevels(result));
    });
    setDrawerAccountId(null);
  }, []);

  const handleBulkSave = useCallback((patch, ids) => {
    setWorkingAccounts((prev) => refreshModifiedFlags(recalcLevels(bulkPatch(prev, ids, patch))));
  }, []);

  const handleBulkFindReplace = useCallback((search, replace, ids) => {
    setWorkingAccounts((prev) => refreshModifiedFlags(bulkFindReplace(prev, ids, search, replace)));
  }, []);

  const handleDelete = useCallback((id) => {
    setWorkingAccounts((prev) => {
      // Collect subtree
      const toDelete = new Set();
      function collect(nodeId) {
        toDelete.add(nodeId);
        const children = childrenMap.get(nodeId);
        if (children) children.forEach(collect);
      }
      collect(id);
      return prev.filter((a) => !toDelete.has(a.clientAccountId));
    });
    setDrawerAccountId(null);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, [childrenMap]);

  // Toolbar handlers
  const handleExpandAll = useCallback(() => {
    setExpandedIds(new Set(workingAccounts.map((a) => a.clientAccountId)));
  }, [workingAccounts]);

  const handleCollapseAll = useCallback(() => {
    setExpandedIds(new Set());
  }, []);

  const handleReset = useCallback(() => {
    if (!window.confirm('Restaurar plano de contas original? Todas as alteracoes serao perdidas.')) return;
    const initial = initWorkingAccounts(rawAccounts, existingAccounts);
    setWorkingAccounts(initial);
    setExpandedIds(computeDefaultExpanded(initial));
    setSelectedIds(new Set());
    setDrawerAccountId(null);
    setActiveFilter(null);
    setSearchQuery('');
    COADraft.clear();
  }, [rawAccounts, existingAccounts]);

  const handleNormalizeCodes = useCallback(() => {
    if (!window.confirm('Normalizar codigos? Remove caracteres nao-numericos exceto ponto.')) return;
    setWorkingAccounts((prev) => refreshModifiedFlags(normalizeCodes(prev)));
  }, []);

  const handleSaveDraft = useCallback(() => {
    COADraft.save({
      workingAccounts,
      expandedIds,
      selectedIds,
      rawAccounts,
    });
    setDraftSaved(true);
    setTimeout(() => setDraftSaved(false), 2000);
  }, [workingAccounts, expandedIds, selectedIds, rawAccounts]);

  const handleAutoFixPostingParents = useCallback(() => {
    setWorkingAccounts((prev) => refreshModifiedFlags(autoFixPostingParents(prev, buildChildrenMap(prev))));
  }, []);

  const handleFilterChange = useCallback((filter) => {
    setActiveFilter(filter);
    // Auto-expand filtered accounts' ancestors
    if (filter && validationResult) {
      const bucket =
        validationResult.errorBuckets[filter] || validationResult.warningBuckets[filter];
      if (Array.isArray(bucket) && bucket.length > 0) {
        setExpandedIds((prev) => {
          const next = new Set(prev);
          for (const id of bucket) {
            let parentId = accountMap.get(id)?.parentClientAccountId;
            while (parentId) {
              next.add(parentId);
              parentId = accountMap.get(parentId)?.parentClientAccountId;
            }
          }
          return next;
        });
      }
    }
  }, [validationResult, accountMap]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="bg-white rounded-lg border border-ocean-30">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-ocean-30 flex-wrap">
        <List className="w-4 h-4 text-ocean-120 flex-shrink-0" />
        <span className="text-sm font-medium text-ocean-180">
          Plano de Contas
        </span>
        <span className="text-xs text-ocean-60">
          ({realAccountCount} contas
          {validationResult.errorCount > 0 && (
            <span className="text-rose"> · {validationResult.errorCount} erro{validationResult.errorCount !== 1 ? 's' : ''}</span>
          )}
          {validationResult.warningCount > 0 && (
            <span className="text-golden"> · {validationResult.warningCount} aviso{validationResult.warningCount !== 1 ? 's' : ''}</span>
          )}
          )
        </span>

        <div className="flex-1" />

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-1.5 w-3.5 h-3.5 text-ocean-60" />
          <input
            type="text"
            placeholder="Buscar..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-7 pr-2 py-1 text-xs border border-ocean-30 rounded focus:outline-none focus:ring-1 focus:ring-ocean-120 w-40"
          />
        </div>

        {/* Action buttons */}
        <button onClick={handleExpandAll} title="Expandir tudo" className="p-1 hover:bg-ocean-10 rounded">
          <Expand className="w-3.5 h-3.5 text-ocean-150" />
        </button>
        <button onClick={handleCollapseAll} title="Recolher tudo" className="p-1 hover:bg-ocean-10 rounded">
          <Shrink className="w-3.5 h-3.5 text-ocean-150" />
        </button>
        <button onClick={handleNormalizeCodes} title="Normalizar codigos" className="p-1 hover:bg-ocean-10 rounded">
          <Hash className="w-3.5 h-3.5 text-ocean-150" />
        </button>
        <button onClick={handleReset} title="Restaurar original" className="p-1 hover:bg-ocean-10 rounded">
          <RotateCcw className="w-3.5 h-3.5 text-ocean-150" />
        </button>
        <button
          onClick={handleSaveDraft}
          title="Salvar rascunho"
          className={`p-1 rounded transition-colors ${draftSaved ? 'bg-green-100' : 'hover:bg-ocean-10'}`}
        >
          <Save className={`w-3.5 h-3.5 ${draftSaved ? 'text-pine' : 'text-ocean-150'}`} />
        </button>
      </div>

      {/* Main layout: problems panel + tree */}
      <div className="flex" style={{ minHeight: 400 }}>
        {/* Problems panel (left) */}
        <div className="w-[220px] flex-shrink-0 border-r border-ocean-30 p-3 overflow-y-auto" style={{ maxHeight: 600 }}>
          <CoaProblemsPanel
            validationResult={validationResult}
            activeFilter={activeFilter}
            onFilterChange={handleFilterChange}
            onAutoFixPostingParents={handleAutoFixPostingParents}
          />
        </div>

        {/* Tree (center) */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5" style={{ maxHeight: 600 }}>
          {visibleTree.length === 0 && (
            <div className="text-center py-8 text-sm text-ocean-60">
              Nenhuma conta encontrada
            </div>
          )}

          {visibleTree.map(({ account, depth, hasChildren }) => {
            const id = account.clientAccountId;
            const isSearchHighlight = searchQuery.length >= 2 && searchMatchIds.has(id);
            const isFilterHighlight = filterHighlights.has(id);

            return (
              <CoaTreeRow
                key={id}
                account={account}
                depth={depth}
                isExpanded={effectiveExpanded.has(id) || account._isOrphanRoot}
                isSelected={selectedIds.size <= 1 && selectedIds.has(id)}
                isMultiSelected={selectedIds.size > 1 && selectedIds.has(id)}
                hasChildren={hasChildren}
                status={account.status || 'OK'}
                isSearchMatch={isSearchHighlight || isFilterHighlight}
                onToggleExpand={() => handleToggleExpand(id)}
                onSelect={(e) => handleSelect(e, id)}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
                dropIndicator={dropTarget.id === id ? dropTarget.position : null}
              />
            );
          })}
        </div>
      </div>

      {/* Drawer */}
      <CoaAccountDrawer
        account={drawerAccount}
        allAccounts={workingAccounts}
        issues={drawerIssues}
        selectedIds={selectedIds}
        onSave={handleDrawerSave}
        onBulkSave={handleBulkSave}
        onBulkFindReplace={handleBulkFindReplace}
        onClose={() => setDrawerAccountId(null)}
        onDelete={handleDelete}
      />
    </div>
  );
}
