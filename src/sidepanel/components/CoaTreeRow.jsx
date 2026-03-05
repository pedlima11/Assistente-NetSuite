import React, { useRef, useState, useCallback } from 'react';
import { ChevronRight, ChevronDown, AlertTriangle, Circle, GripVertical, Pencil } from 'lucide-react';
import { ORPHAN_ROOT_ID } from '../../services/coa-modeling.js';

const STATUS_DOT = {
  OK: 'bg-pine',
  WARN: 'bg-golden',
  ERROR: 'bg-rose',
};

const STATUS_BG = {
  OK: '',
  WARN: 'bg-yellow-50/30',
  ERROR: 'bg-red-50/30',
};

/**
 * Uma linha no indented tree list do modelador de Plano de Contas.
 *
 * @param {{
 *   account: Object,
 *   depth: number,
 *   isExpanded: boolean,
 *   isSelected: boolean,
 *   isMultiSelected: boolean,
 *   hasChildren: boolean,
 *   status: 'OK'|'WARN'|'ERROR',
 *   isSearchMatch: boolean,
 *   onToggleExpand: () => void,
 *   onSelect: (e: MouseEvent) => void,
 *   onDragStart: (id: string) => void,
 *   onDragOver: (id: string, position: 'before'|'into'|'after', e: DragEvent) => void,
 *   onDrop: (id: string, position: 'before'|'into'|'after') => void,
 *   onDragEnd: () => void,
 *   dropIndicator: 'before'|'into'|'after'|null,
 * }} props
 */
export default function CoaTreeRow({
  account,
  depth,
  isExpanded,
  isSelected,
  isMultiSelected,
  hasChildren,
  status,
  isSearchMatch,
  onToggleExpand,
  onSelect,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  dropIndicator,
}) {
  const rowRef = useRef(null);
  const isOrphanRoot = account._isOrphanRoot;

  const handleDragStart = useCallback((e) => {
    if (isOrphanRoot) { e.preventDefault(); return; }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', account.clientAccountId);
    onDragStart(account.clientAccountId);
  }, [account.clientAccountId, isOrphanRoot, onDragStart]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = rowRef.current?.getBoundingClientRect();
    if (!rect) return;
    const y = e.clientY - rect.top;
    const ratio = y / rect.height;
    let position;
    if (isOrphanRoot) {
      position = 'into';
    } else if (ratio < 0.25) {
      position = 'before';
    } else if (ratio > 0.75) {
      position = 'after';
    } else {
      position = 'into';
    }
    onDragOver(account.clientAccountId, position, e);
  }, [account.clientAccountId, isOrphanRoot, onDragOver]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const rect = rowRef.current?.getBoundingClientRect();
    if (!rect) return;
    const y = e.clientY - rect.top;
    const ratio = y / rect.height;
    let position;
    if (isOrphanRoot) {
      position = 'into';
    } else if (ratio < 0.25) {
      position = 'before';
    } else if (ratio > 0.75) {
      position = 'after';
    } else {
      position = 'into';
    }
    onDrop(account.clientAccountId, position);
  }, [account.clientAccountId, isOrphanRoot, onDrop]);

  const selected = isSelected || isMultiSelected;
  const indent = depth * 20;

  // Orphan root has special styling
  if (isOrphanRoot) {
    return (
      <div
        ref={rowRef}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={`
          flex items-center gap-2 py-1.5 px-2 rounded-md cursor-pointer select-none
          bg-yellow-50 border border-golden/30
          ${dropIndicator === 'into' ? 'ring-2 ring-golden ring-dashed' : ''}
        `}
        style={{ paddingLeft: indent + 8, contentVisibility: 'auto', containIntrinsicHeight: '36px' }}
        onClick={onToggleExpand}
      >
        {isExpanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-golden flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-golden flex-shrink-0" />
        )}
        <AlertTriangle className="w-3.5 h-3.5 text-golden flex-shrink-0" />
        <span className="text-sm font-medium text-golden">
          ORFAOS
          {hasChildren && <span className="text-xs font-normal ml-1 text-golden/70">({account._orphanCount || ''})</span>}
        </span>
      </div>
    );
  }

  return (
    <div
      ref={rowRef}
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragEnd={onDragEnd}
      className={`
        relative flex items-center gap-1.5 py-1 px-2 rounded-md cursor-pointer select-none
        transition-colors duration-100
        ${STATUS_BG[status] || ''}
        ${selected ? 'ring-2 ring-ocean-120 bg-ocean-10/70' : 'hover:bg-ocean-10/40'}
        ${isSearchMatch ? 'bg-yellow-100/50' : ''}
        ${account._action === 'skip' ? 'opacity-50' : ''}
      `}
      style={{ paddingLeft: indent + 8, contentVisibility: 'auto', containIntrinsicHeight: '36px' }}
      onClick={onSelect}
    >
      {/* Drop indicators */}
      {dropIndicator === 'before' && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-ocean-120 z-10" />
      )}
      {dropIndicator === 'after' && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-ocean-120 z-10" />
      )}
      {dropIndicator === 'into' && (
        <div className="absolute inset-0 border-2 border-dashed border-ocean-120 rounded-md z-10 pointer-events-none" />
      )}

      {/* Drag handle */}
      <GripVertical className="w-3 h-3 text-ocean-60/40 flex-shrink-0 cursor-grab active:cursor-grabbing" />

      {/* Expand/collapse chevron */}
      {hasChildren ? (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
          className="flex-shrink-0 p-0.5 hover:bg-ocean-30 rounded"
        >
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-ocean-150" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-ocean-150" />
          )}
        </button>
      ) : (
        <span className="w-4.5 flex-shrink-0" />
      )}

      {/* Status dot */}
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[status] || STATUS_DOT.OK}`} />

      {/* Code */}
      <span className="text-xs font-mono text-ocean-60 flex-shrink-0 min-w-[60px]">
        {account.code}
      </span>

      {/* Name */}
      <span className="text-sm text-ocean-180 truncate flex-1 min-w-0">
        {account.name}
      </span>

      {/* Type badge */}
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-ocean-30/50 text-ocean-150 flex-shrink-0">
        {account.type || '—'}
      </span>

      {/* Posting indicator */}
      <span
        title={account.isPosting ? 'Analitica' : 'Sintetica'}
        className="flex-shrink-0"
      >
        {account.isPosting ? (
          <Circle className="w-3 h-3 text-pine fill-pine" />
        ) : (
          <Circle className="w-3 h-3 text-ocean-60" />
        )}
      </span>

      {/* Modified indicator */}
      {account._modified && (
        <Pencil className="w-3 h-3 text-ocean-120 flex-shrink-0" title="Conta alterada pelo usuario" />
      )}

      {/* Action badge for existing accounts */}
      {account._action && (
        <span className={`text-[9px] px-1 py-0.5 rounded font-medium flex-shrink-0 ${
          account._action === 'skip' ? 'bg-ocean-30 text-ocean-150' :
          account._action === 'update' ? 'bg-yellow-100 text-golden' :
          'bg-green-100 text-pine'
        }`}>
          {account._action === 'skip' ? 'Pular' : account._action === 'update' ? 'Atualizar' : 'Criar'}
        </span>
      )}
    </div>
  );
}
