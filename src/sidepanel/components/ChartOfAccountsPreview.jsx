import React, { useState } from 'react';
import { List, Filter } from 'lucide-react';
import { VALID_ACCOUNT_TYPES } from '../../types/netsuite.js';

/**
 * Preview editavel do plano de contas com filtro por tipo
 * @param {{ accounts: Object[], onChange: (updated: Object[]) => void }} props
 */
export default function ChartOfAccountsPreview({ accounts, onChange }) {
  const [filterType, setFilterType] = useState('');

  const filtered = filterType
    ? accounts.filter((a) => a.type === filterType)
    : accounts;

  function handleAccountChange(index, field, value) {
    const realIndex = filterType
      ? accounts.indexOf(filtered[index])
      : index;

    const updated = [...accounts];
    updated[realIndex] = { ...updated[realIndex], [field]: value };
    onChange(updated);
  }

  // Tipos unicos presentes nas contas
  const presentTypes = [...new Set(accounts.map((a) => a.type))].sort();

  return (
    <div className="bg-white rounded-lg border border-ocean-30 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <List className="w-5 h-5 text-ocean-120" />
          <h3 className="text-sm font-medium text-ocean-180">
            Plano de Contas ({accounts.length} contas)
          </h3>
        </div>

        <div className="flex items-center gap-1">
          <Filter className="w-3 h-3 text-ocean-60" />
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="text-xs border border-ocean-30 rounded px-1 py-0.5 focus:outline-none"
          >
            <option value="">Todos</option>
            {presentTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-ocean-150 border-b border-ocean-30/50">
              <th className="pb-2 pr-2">Codigo</th>
              <th className="pb-2 pr-2">Nome</th>
              <th className="pb-2 pr-2">Tipo NetSuite</th>
              <th className="pb-2">Pai</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((account, i) => (
              <tr key={account.number} className="border-b border-ocean-30/50 hover:bg-ocean-10">
                <td className="py-1.5 pr-2 font-mono text-ocean-150">
                  {account.number}
                </td>
                <td className="py-1.5 pr-2">
                  <input
                    type="text"
                    value={account.name}
                    onChange={(e) => handleAccountChange(i, 'name', e.target.value)}
                    className="w-full px-1 py-0.5 border border-transparent hover:border-ocean-30 rounded text-xs focus:outline-none focus:border-ocean-120"
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <select
                    value={account.type}
                    onChange={(e) => handleAccountChange(i, 'type', e.target.value)}
                    className="text-xs border border-ocean-30 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-ocean-120"
                  >
                    {VALID_ACCOUNT_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </td>
                <td className="py-1.5 font-mono text-ocean-60 text-xs">
                  {account.parent || '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <p className="text-center text-sm text-ocean-60 py-4">
          Nenhuma conta {filterType ? `do tipo ${filterType}` : ''}
        </p>
      )}
    </div>
  );
}
