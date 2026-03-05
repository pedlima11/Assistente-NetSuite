import React from 'react';
import { Plus, CheckCircle, XCircle, Loader2, AlertCircle, Building2 } from 'lucide-react';

const STATUS_STYLES = {
  draft: 'border-ocean-30 bg-white',
  ready: 'border-pine/40 bg-green-50',
  creating: 'border-ocean-120 bg-ocean-10 animate-pulse',
  created: 'border-pine bg-green-50',
  error: 'border-rose bg-red-50',
  existing: 'border-ocean-60/40 bg-ocean-10',
};

const STATUS_LABELS = {
  draft: 'Rascunho',
  ready: 'Pronto',
  creating: 'Criando...',
  created: 'Criado',
  error: 'Erro',
  existing: 'NetSuite',
};

function StatusBadge({ status }) {
  const colors = {
    draft: 'text-ocean-60 bg-ocean-30',
    ready: 'text-pine bg-green-100',
    creating: 'text-ocean-120 bg-ocean-30',
    created: 'text-pine bg-green-100',
    error: 'text-rose bg-red-100',
    existing: 'text-ocean-120 bg-ocean-30',
  };

  const icons = {
    draft: <AlertCircle className="w-3 h-3" />,
    ready: <CheckCircle className="w-3 h-3" />,
    creating: <Loader2 className="w-3 h-3 animate-spin" />,
    created: <CheckCircle className="w-3 h-3" />,
    error: <XCircle className="w-3 h-3" />,
    existing: <Building2 className="w-3 h-3" />,
  };

  return (
    <span className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium whitespace-nowrap ${colors[status]}`}>
      {icons[status]}
      {STATUS_LABELS[status]}
    </span>
  );
}

/**
 * Compact card for a subsidiary node in the org chart tree.
 * @param {{ node: Object, isSelected: boolean, hasErrors: boolean, onSelect: () => void, onAddChild: () => void }} props
 */
export default function SubsidiaryNodeCard({ node, isSelected, hasErrors, onSelect, onAddChild }) {
  const isExisting = node._isExisting;
  const canAddChild = node.status !== 'creating' && node.status !== 'error';
  const cnpjDisplay = node.cnpj
    ? node.cnpj.replace(/\D/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
    : '';

  return (
    <div
      onClick={onSelect}
      className={`
        h-full rounded-lg border-2 px-2 py-1.5 cursor-pointer transition-all duration-150 overflow-hidden
        ${STATUS_STYLES[node.status] || STATUS_STYLES.draft}
        ${isSelected ? 'ring-2 ring-ocean-120 shadow-md scale-[1.02]' : 'hover:shadow-sm'}
        ${hasErrors && node.status === 'draft' ? 'border-golden' : ''}
        ${isExisting ? 'opacity-80' : ''}
      `}
    >
      <div className="flex items-start justify-between gap-0.5">
        <div className="min-w-0 flex-1">
          <p className={`text-xs font-semibold truncate leading-tight ${isExisting ? 'text-ocean-150' : 'text-ocean-180'}`}>
            {node.name || 'Nova Filial'}
          </p>
          {cnpjDisplay ? (
            <p className="text-[10px] text-ocean-60 truncate mt-0.5">{cnpjDisplay}</p>
          ) : isExisting ? (
            <p className="text-[10px] text-ocean-60/50 mt-0.5">ID: {node.netsuiteInternalId}</p>
          ) : (
            <p className="text-[10px] text-ocean-60/50 italic mt-0.5">Sem CNPJ</p>
          )}
        </div>
        <StatusBadge status={node.status} />
      </div>

      <div className="flex items-center justify-between mt-1">
        <span className="text-[10px] text-ocean-60">
          {node.state || '—'}
        </span>
        {canAddChild && (
          <button
            onClick={(e) => { e.stopPropagation(); onAddChild(); }}
            className="flex items-center gap-0.5 text-[10px] text-ocean-120 hover:text-ocean-150 transition-colors"
          >
            <Plus className="w-2.5 h-2.5" />
            Filial
          </button>
        )}
      </div>
    </div>
  );
}
