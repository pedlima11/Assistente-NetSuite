import React from 'react';
import { Search, X } from 'lucide-react';

/**
 * Barra de filtros para a view "Notas".
 * Filtros: CFOP, UF emissor, fornecedor (nome/CNPJ), NCM, data range.
 *
 * @param {{ filters, setFilters, totalCount: number, filteredCount: number }} props
 */
export default function InvoiceFilterBar({ filters, setFilters, totalCount, filteredCount }) {
  const hasFilters = filters.cfop || filters.uf || filters.fornecedor || filters.ncm || filters.dateFrom || filters.dateTo;

  function update(field, value) {
    setFilters(prev => ({ ...prev, [field]: value }));
  }

  function clearAll() {
    setFilters({ cfop: '', uf: '', fornecedor: '', ncm: '', dateFrom: '', dateTo: '' });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {/* CFOP */}
        <input
          type="text"
          value={filters.cfop}
          onChange={e => update('cfop', e.target.value)}
          placeholder="CFOP"
          className="w-20 px-2 py-1 text-xs border border-ocean-30 rounded-md focus:outline-none focus:ring-1 focus:ring-ocean-120"
        />

        {/* UF */}
        <input
          type="text"
          value={filters.uf}
          onChange={e => update('uf', e.target.value.toUpperCase().slice(0, 2))}
          placeholder="UF"
          className="w-14 px-2 py-1 text-xs border border-ocean-30 rounded-md focus:outline-none focus:ring-1 focus:ring-ocean-120"
          maxLength={2}
        />

        {/* Fornecedor */}
        <div className="relative flex-1 min-w-[120px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-ocean-60" />
          <input
            type="text"
            value={filters.fornecedor}
            onChange={e => update('fornecedor', e.target.value)}
            placeholder="Fornecedor"
            className="w-full pl-6 pr-2 py-1 text-xs border border-ocean-30 rounded-md focus:outline-none focus:ring-1 focus:ring-ocean-120"
          />
        </div>

        {/* NCM */}
        <input
          type="text"
          value={filters.ncm}
          onChange={e => update('ncm', e.target.value)}
          placeholder="NCM"
          className="w-24 px-2 py-1 text-xs border border-ocean-30 rounded-md focus:outline-none focus:ring-1 focus:ring-ocean-120"
        />

        {/* Date range */}
        <input
          type="date"
          value={filters.dateFrom}
          onChange={e => update('dateFrom', e.target.value)}
          className="px-2 py-1 text-xs border border-ocean-30 rounded-md focus:outline-none focus:ring-1 focus:ring-ocean-120"
        />
        <span className="text-xs text-ocean-60 self-center">a</span>
        <input
          type="date"
          value={filters.dateTo}
          onChange={e => update('dateTo', e.target.value)}
          className="px-2 py-1 text-xs border border-ocean-30 rounded-md focus:outline-none focus:ring-1 focus:ring-ocean-120"
        />
      </div>

      {/* Badge + clear */}
      {hasFilters && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-ocean-100">
            {filteredCount} de {totalCount} documentos
          </span>
          <button
            onClick={clearAll}
            className="text-xs text-ocean-120 hover:text-ocean-180 flex items-center gap-0.5"
          >
            <X className="w-3 h-3" />
            Limpar filtros
          </button>
        </div>
      )}
    </div>
  );
}
