import React from 'react';
import { GripVertical } from 'lucide-react';
import { getRuleColor } from '../../utils/rule-colors.js';

/**
 * Linha draggable de um item C170.
 * Mostra CFOP, NCM, descricao, valor, chips de impostos e chip de regra colorido.
 *
 * @param {{ item: Object, allRuleIds: string[], ruleNameMap: Map, onDragStart: Function, onDragEnd: Function }} props
 */
export default function InvoiceItemRow({ item, allRuleIds, ruleNameMap, onDragStart, onDragEnd }) {
  const color = getRuleColor(item.assignedRuleId, allRuleIds);
  const ruleName = item.assignedRuleId
    ? (ruleNameMap.get(item.assignedRuleId) || item.assignedRuleId.slice(0, 8))
    : 'Sem regra';

  function handleDragStart(e) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'item', ids: [item._itemId] }));
    onDragStart?.({ type: 'item', ids: [item._itemId] });
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      className="flex items-center gap-2 px-3 py-1.5 bg-white border-b border-ocean-10 hover:bg-ocean-5 cursor-grab active:cursor-grabbing group"
      style={{ contentVisibility: 'auto' }}
    >
      {/* Grip */}
      <GripVertical className="w-3 h-3 text-ocean-30 group-hover:text-ocean-60 flex-shrink-0" />

      {/* CFOP */}
      <span className="text-xs font-mono text-ocean-150 w-10 flex-shrink-0">{item.cfop}</span>

      {/* NCM */}
      <span className="text-xs font-mono text-ocean-100 w-20 flex-shrink-0 truncate">{item.ncm || '—'}</span>

      {/* Descricao */}
      <span className="text-xs text-ocean-150 flex-1 truncate" title={item.descrCompl}>
        {item.descrCompl || item.codItem || '—'}
      </span>

      {/* Valor */}
      <span className="text-xs text-ocean-150 w-20 text-right flex-shrink-0">
        {item.vlItem != null ? `R$ ${Number(item.vlItem).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
      </span>

      {/* Tax chips (compactos) */}
      <div className="flex gap-0.5 flex-shrink-0">
        {(item.taxes || []).slice(0, 3).map((t, i) => (
          <span key={i} className="text-[10px] px-1 py-0.5 rounded bg-ocean-10 text-ocean-100 whitespace-nowrap">
            {t.type} {t.cst}/{t.aliq != null ? `${Number(t.aliq)}%` : ''}
          </span>
        ))}
        {(item.taxes || []).length > 3 && (
          <span className="text-[10px] px-1 py-0.5 text-ocean-60">+{item.taxes.length - 3}</span>
        )}
      </div>

      {/* Rule chip */}
      <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 ${color.bg} ${color.text}`}>
        {ruleName}
      </span>
    </div>
  );
}
