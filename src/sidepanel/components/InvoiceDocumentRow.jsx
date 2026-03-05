import React, { useState } from 'react';
import { ChevronDown, ChevronRight, GripVertical, AlertTriangle } from 'lucide-react';
import InvoiceItemRow from './InvoiceItemRow.jsx';
import { getRuleColor } from '../../utils/rule-colors.js';

/**
 * Linha expandivel de um documento (C100 / NF-e).
 * Header: grip + chevron + NF numero + fornecedor + UF + valor + count + chips de regras.
 * Expandido: lista de InvoiceItemRow.
 *
 * Draggable como NF inteira — se divergente, o container mostra dialog de confirmacao.
 */
export default function InvoiceDocumentRow({ doc, allRuleIds, ruleNameMap, onDragStart, onDragEnd, onReassignItems }) {
  const [expanded, setExpanded] = useState(false);

  const ruleIds = [...(doc.assignedRuleIds || [])];
  const Chevron = expanded ? ChevronDown : ChevronRight;

  function handleDocDragStart(e) {
    e.dataTransfer.effectAllowed = 'move';
    const itemIds = doc.items.map(i => i._itemId);
    e.dataTransfer.setData('text/plain', JSON.stringify({
      type: 'document',
      ids: itemIds,
      isDivergent: doc.isDivergent,
      docKey: doc.docKey,
    }));
    onDragStart?.({
      type: 'document',
      ids: itemIds,
      isDivergent: doc.isDivergent,
      docKey: doc.docKey,
    });
  }

  return (
    <div
      className="border border-ocean-20 rounded-lg overflow-hidden"
      style={{ contentVisibility: 'auto' }}
    >
      {/* Header */}
      <div
        draggable
        onDragStart={handleDocDragStart}
        onDragEnd={onDragEnd}
        className="flex items-center gap-2 px-3 py-2 bg-ocean-5 hover:bg-ocean-10 cursor-grab active:cursor-grabbing"
      >
        <GripVertical className="w-3.5 h-3.5 text-ocean-30 hover:text-ocean-60 flex-shrink-0" />

        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className="flex-shrink-0"
          draggable={false}
        >
          <Chevron className="w-4 h-4 text-ocean-100" />
        </button>

        {/* NF number */}
        <span className="text-xs font-medium text-ocean-180 w-16 flex-shrink-0">
          NF {doc.nNF || '—'}
        </span>

        {/* Fornecedor */}
        <span className="text-xs text-ocean-150 flex-1 truncate" title={doc.emitName}>
          {doc.emitName || doc.emitCNPJ || '—'}
        </span>

        {/* UF */}
        <span className="text-xs text-ocean-100 w-6 flex-shrink-0 text-center">
          {doc.emitUF || '—'}
        </span>

        {/* Valor total */}
        <span className="text-xs text-ocean-150 w-24 text-right flex-shrink-0">
          R$ {Number(doc.totalValue || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>

        {/* Item count */}
        <span className="text-xs text-ocean-60 w-12 text-right flex-shrink-0">
          {doc.itemCount} {doc.itemCount === 1 ? 'item' : 'itens'}
        </span>

        {/* Rule chips */}
        <div className="flex gap-0.5 flex-shrink-0">
          {ruleIds.map(rId => {
            const c = getRuleColor(rId, allRuleIds);
            return (
              <span key={rId} className={`w-2.5 h-2.5 rounded-full ${c.dot}`} title={ruleNameMap.get(rId) || rId} />
            );
          })}
        </div>

        {/* Divergent warning */}
        {doc.isDivergent && (
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" title="Itens em regras diferentes" />
        )}
      </div>

      {/* Items */}
      {expanded && (
        <div className="border-t border-ocean-20">
          {doc.items.map(item => (
            <InvoiceItemRow
              key={item._itemId}
              item={item}
              allRuleIds={allRuleIds}
              ruleNameMap={ruleNameMap}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          ))}
        </div>
      )}
    </div>
  );
}
