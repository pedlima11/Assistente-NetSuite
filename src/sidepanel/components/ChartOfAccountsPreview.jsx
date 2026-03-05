import React, { useState } from 'react';
import { List, Filter, AlertTriangle } from 'lucide-react';
import { VALID_ACCOUNT_TYPES, GeneralRateType } from '../../types/netsuite.js';

const RATE_TYPE_OPTIONS = Object.values(GeneralRateType);

const RATE_TYPE_LABELS = {
  [GeneralRateType.Current]: 'Current',
  [GeneralRateType.Average]: 'Average',
  [GeneralRateType.Historical]: 'Historical',
};

/**
 * Preview editavel do plano de contas com filtro por tipo
 * @param {{ accounts: Object[], onChange: (updated: Object[]) => void, existingAccounts: Map? }} props
 */
export default function ChartOfAccountsPreview({ accounts, onChange, existingAccounts }) {
  const [filterType, setFilterType] = useState('');
  const [filterSummary, setFilterSummary] = useState('');

  const filtered = accounts.filter((a) => {
    if (filterType && a.type !== filterType) return false;
    if (filterSummary === 'summary' && !a.isSummary) return false;
    if (filterSummary === 'detail' && a.isSummary) return false;
    return true;
  });

  function handleAccountChange(index, field, value) {
    const realIndex = accounts.indexOf(filtered[index]);

    const updated = [...accounts];
    updated[realIndex] = { ...updated[realIndex], [field]: value };
    onChange(updated);
  }

  function handleNumberChange(index, newNumber) {
    const realIndex = accounts.indexOf(filtered[index]);
    const oldNumber = accounts[realIndex].number;

    const updated = accounts.map((acc, i) => {
      if (i === realIndex) return { ...acc, number: newNumber };
      if (acc.parent === oldNumber) return { ...acc, parent: newNumber };
      return acc;
    });
    onChange(updated);
  }

  const hasExisting = existingAccounts && existingAccounts.size > 0;

  // Tipos unicos presentes nas contas
  const presentTypes = [...new Set(accounts.map((a) => a.type))].sort();

  // Contadores
  const summaryCount = accounts.filter((a) => a.isSummary).length;
  const detailCount = accounts.length - summaryCount;

  return (
    <div className="bg-white rounded-lg border border-ocean-30 p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <List className="w-5 h-5 text-ocean-120" />
          <h3 className="text-base font-medium text-ocean-180">
            Plano de Contas ({accounts.length} contas)
          </h3>
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-ocean-60" />
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="text-sm border border-ocean-30 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ocean-120"
          >
            <option value="">Tipo: Todos</option>
            {presentTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select
            value={filterSummary}
            onChange={(e) => setFilterSummary(e.target.value)}
            className="text-sm border border-ocean-30 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ocean-120"
          >
            <option value="">Todas</option>
            <option value="summary">Consolidadoras ({summaryCount})</option>
            <option value="detail">Analiticas ({detailCount})</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ocean-150 border-b-2 border-ocean-30">
              <th className="pb-2 pr-4 whitespace-nowrap" style={{ width: '120px' }}>Codigo</th>
              <th className="pb-2 pr-4" style={{ minWidth: '250px' }}>Nome</th>
              <th className="pb-2 pr-4 whitespace-nowrap" style={{ width: '140px' }}>Tipo</th>
              <th className="pb-2 pr-4 whitespace-nowrap text-center" style={{ width: '80px' }}>Consol.</th>
              <th className="pb-2 pr-4 whitespace-nowrap" style={{ width: '120px' }}>Taxa</th>
              <th className="pb-2 pr-4 whitespace-nowrap" style={{ width: '100px' }}>Pai</th>
              {hasExisting && (
                <th className="pb-2 whitespace-nowrap" style={{ width: '110px' }}>Acao</th>
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.map((account, i) => {
              const isExisting = hasExisting && existingAccounts.has(account.number);
              const nameLen = (account.name || '').length;
              const nameTooLong = nameLen > 60;

              return (
                <tr
                  key={i}
                  className={`border-b border-ocean-30/30 hover:bg-ocean-10 ${
                    account.isSummary ? 'bg-ocean-10/50 font-medium' : ''
                  }`}
                >
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-1">
                      {isExisting && (
                        <AlertTriangle className="w-3.5 h-3.5 text-golden flex-shrink-0" title="Conta ja existe no NetSuite" />
                      )}
                      <input
                        type="text"
                        value={account.number}
                        onChange={(e) => handleNumberChange(i, e.target.value)}
                        className="w-full px-2 py-1 border border-transparent hover:border-ocean-30 rounded text-sm font-mono focus:outline-none focus:border-ocean-120"
                      />
                    </div>
                  </td>
                  <td className="py-2 pr-4">
                    <input
                      type="text"
                      value={account.name}
                      onChange={(e) => handleAccountChange(i, 'name', e.target.value)}
                      className={`w-full px-2 py-1 border rounded text-sm focus:outline-none ${
                        nameTooLong
                          ? 'border-rose focus:border-rose'
                          : 'border-transparent hover:border-ocean-30 focus:border-ocean-120'
                      }`}
                    />
                    {nameTooLong && (
                      <span className="text-xs text-rose">{nameLen}/60</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <select
                      value={account.type}
                      onChange={(e) => handleAccountChange(i, 'type', e.target.value)}
                      className="w-full text-sm border border-ocean-30 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ocean-120"
                    >
                      {VALID_ACCOUNT_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-4 text-center">
                    <input
                      type="checkbox"
                      checked={!!account.isSummary}
                      onChange={(e) => handleAccountChange(i, 'isSummary', e.target.checked)}
                      className="w-4 h-4 rounded border-ocean-30 text-ocean-120 focus:ring-ocean-120"
                      title={account.isSummary ? 'Consolidadora (nao recebe lancamentos)' : 'Analitica (recebe lancamentos)'}
                    />
                  </td>
                  <td className="py-2 pr-4">
                    <select
                      value={account.generalRateType || 'Current'}
                      onChange={(e) => handleAccountChange(i, 'generalRateType', e.target.value)}
                      className="w-full text-sm border border-ocean-30 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ocean-120"
                    >
                      {RATE_TYPE_OPTIONS.map((rt) => (
                        <option key={rt} value={rt}>{RATE_TYPE_LABELS[rt]}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-4">
                    <input
                      type="text"
                      value={account.parent || ''}
                      onChange={(e) => handleAccountChange(i, 'parent', e.target.value)}
                      className="w-full px-2 py-1 border border-transparent hover:border-ocean-30 rounded text-sm font-mono focus:outline-none focus:border-ocean-120"
                    />
                  </td>
                  {hasExisting && (
                    <td className="py-2">
                      {isExisting ? (
                        <select
                          value={account._action || 'skip'}
                          onChange={(e) => handleAccountChange(i, '_action', e.target.value)}
                          className="w-full text-xs border border-ocean-30 rounded px-1 py-1 focus:outline-none focus:ring-1 focus:ring-ocean-120"
                        >
                          <option value="skip">Pular</option>
                          <option value="update">Atualizar</option>
                          <option value="create">Criar</option>
                        </select>
                      ) : (
                        <span className="text-xs text-ocean-60 px-1">Criar</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <p className="text-center text-sm text-ocean-60 py-6">
          Nenhuma conta {filterType ? `do tipo ${filterType}` : ''} {filterSummary ? `(${filterSummary})` : ''}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-4 text-xs text-ocean-60">
        <span>Consol. = Conta consolidadora (summary)</span>
        <span>Taxa = generalRateType (cambio)</span>
      </div>
    </div>
  );
}
