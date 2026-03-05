import React, { useState, useEffect, useMemo } from 'react';
import { X, Trash2, Save, Search, Replace } from 'lucide-react';
import { VALID_ACCOUNT_TYPES, GeneralRateType } from '../../types/netsuite.js';
import { ORPHAN_ROOT_ID, getDescendantIds, buildChildrenMap } from '../../services/coa-modeling.js';

const INPUT_CLASS = 'w-full px-3 py-2 border border-ocean-30 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ocean-120 focus:border-transparent transition-shadow';
const READONLY_CLASS = 'px-3 py-2 bg-ocean-10 border border-ocean-30 rounded-lg text-sm text-ocean-150';

const RATE_OPTIONS = [GeneralRateType.Current, GeneralRateType.Average, GeneralRateType.Historical];

function Field({ label, required, children }) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-medium text-ocean-150 mb-1">
        {label}{required && <span className="text-rose ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

/**
 * Drawer direito para edicao de contas. Copy-on-open local state.
 * Suporta edicao individual e bulk.
 *
 * @param {{
 *   account: Object|null,
 *   allAccounts: Object[],
 *   issues: string[],
 *   selectedIds: Set<string>,
 *   onSave: (updated: Object) => void,
 *   onBulkSave: (patch: Object, ids: Set<string>) => void,
 *   onBulkFindReplace: (search: string, replace: string, ids: Set<string>) => void,
 *   onClose: () => void,
 *   onDelete: (id: string) => void,
 * }} props
 */
export default function CoaAccountDrawer({
  account,
  allAccounts,
  issues,
  selectedIds,
  onSave,
  onBulkSave,
  onBulkFindReplace,
  onClose,
  onDelete,
}) {
  const [form, setForm] = useState({});
  const [parentSearch, setParentSearch] = useState('');
  const [showParentDropdown, setShowParentDropdown] = useState(false);

  // Bulk state
  const [bulkType, setBulkType] = useState('');
  const [bulkPosting, setBulkPosting] = useState('');
  const [bulkParentId, setBulkParentId] = useState('');
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');

  const isOpen = account !== null;
  const isBulk = selectedIds.size > 1;
  const isImmutable = account?._action === 'update';
  const isRoot = account && !account.parentClientAccountId;

  // Copy-on-open
  useEffect(() => {
    if (account) {
      setForm({ ...account });
      setParentSearch('');
      setShowParentDropdown(false);
      // Reset bulk state
      setBulkType('');
      setBulkPosting('');
      setBulkParentId('');
      setFindText('');
      setReplaceText('');
    }
  }, [account?.clientAccountId]);

  // Filtrar contas validas como pai (excluir self, descendentes, orphan root)
  const parentOptions = useMemo(() => {
    if (!account || !allAccounts) return [];
    const childrenMap = buildChildrenMap(allAccounts);
    const descendants = getDescendantIds(account.clientAccountId, childrenMap);
    const lower = parentSearch.toLowerCase();

    return allAccounts.filter((a) => {
      if (a._isOrphanRoot) return false;
      if (a.clientAccountId === account.clientAccountId) return false;
      if (descendants.has(a.clientAccountId)) return false;
      if (lower) {
        return a.code.toLowerCase().includes(lower) || a.name.toLowerCase().includes(lower);
      }
      return true;
    }).slice(0, 50); // limitar para performance
  }, [account?.clientAccountId, allAccounts, parentSearch]);

  function handleChange(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    onSave(form);
  }

  function handleSelectParent(parentId) {
    handleChange('parentClientAccountId', parentId);
    setShowParentDropdown(false);
    setParentSearch('');
  }

  function handleBulkApply() {
    const patch = {};
    if (bulkType) patch.type = bulkType;
    if (bulkPosting === 'true') patch.isPosting = true;
    if (bulkPosting === 'false') patch.isPosting = false;
    if (bulkParentId) patch.parentClientAccountId = bulkParentId === '_null_' ? null : bulkParentId;
    if (Object.keys(patch).length > 0) {
      onBulkSave(patch, selectedIds);
    }
  }

  function handleBulkFindReplace() {
    if (findText) {
      onBulkFindReplace(findText, replaceText, selectedIds);
    }
  }

  const parentAccount = useMemo(() => {
    if (!form.parentClientAccountId) return null;
    return allAccounts.find((a) => a.clientAccountId === form.parentClientAccountId);
  }, [form.parentClientAccountId, allAccounts]);

  const nameLen = (form.name || '').length;
  const nameTooLong = nameLen > 60;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/20 z-40 transition-opacity duration-200 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 h-full w-[400px] max-w-[90vw] bg-white shadow-2xl z-50
          transform transition-transform duration-250 ease-out
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
        `}
      >
        {account && (
          <>
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-ocean-30 px-5 py-4 flex items-center justify-between z-10">
              <div>
                <h3 className="text-sm font-semibold text-ocean-180">
                  {isBulk ? `Edicao em massa (${selectedIds.size})` : 'Editar Conta'}
                </h3>
                <p className="text-xs text-ocean-60 mt-0.5 truncate max-w-[280px]">
                  {isBulk ? 'Alteracoes aplicadas a todas selecionadas' : `${form.code} — ${form.name}`}
                </p>
              </div>
              <button onClick={onClose} className="p-1 hover:bg-ocean-10 rounded">
                <X className="w-4 h-4 text-ocean-150" />
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto p-5 space-y-1" style={{ height: 'calc(100% - 130px)' }}>
              {/* Issues banner */}
              {issues && issues.length > 0 && !isBulk && (
                <div className="bg-red-50 border border-rose/20 rounded-lg p-3 mb-3">
                  <p className="text-xs font-medium text-rose mb-1">Problemas:</p>
                  <ul className="text-xs text-rose space-y-0.5">
                    {issues.map((issue, i) => (
                      <li key={i}>• {issue}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Single account edit */}
              {!isBulk && (
                <>
                  <Field label="Codigo" required>
                    {isImmutable ? (
                      <div className={READONLY_CLASS}>{form.code}</div>
                    ) : (
                      <input
                        type="text"
                        value={form.code || ''}
                        onChange={(e) => handleChange('code', e.target.value)}
                        className={INPUT_CLASS}
                      />
                    )}
                  </Field>

                  <Field label="Nome" required>
                    <input
                      type="text"
                      value={form.name || ''}
                      onChange={(e) => handleChange('name', e.target.value)}
                      className={`${INPUT_CLASS} ${nameTooLong ? 'border-rose focus:ring-rose' : ''}`}
                    />
                    <div className={`text-[10px] mt-0.5 text-right ${nameTooLong ? 'text-rose font-medium' : 'text-ocean-60'}`}>
                      {nameLen}/60
                    </div>
                  </Field>

                  <Field label="Tipo">
                    {isImmutable ? (
                      <div className={READONLY_CLASS}>{form.type}</div>
                    ) : (
                      <select
                        value={form.type || ''}
                        onChange={(e) => handleChange('type', e.target.value)}
                        className={INPUT_CLASS}
                      >
                        <option value="">Selecionar...</option>
                        {VALID_ACCOUNT_TYPES.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    )}
                  </Field>

                  <Field label="Analitica (recebe lancamentos)">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.isPosting ?? true}
                        onChange={(e) => handleChange('isPosting', e.target.checked)}
                        className="w-4 h-4 rounded border-ocean-30 text-ocean-120 focus:ring-ocean-120"
                      />
                      <span className="text-sm text-ocean-150">
                        {form.isPosting ? 'Sim — conta analitica' : 'Nao — conta sintetica (grupo)'}
                      </span>
                    </label>
                  </Field>

                  <Field label="Taxa de Cambio">
                    <select
                      value={form.generalRateType || 'Current'}
                      onChange={(e) => handleChange('generalRateType', e.target.value)}
                      className={INPUT_CLASS}
                    >
                      {RATE_OPTIONS.map((rt) => (
                        <option key={rt} value={rt}>{rt}</option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Conta Pai">
                    <div className="relative">
                      {/* Current parent display */}
                      {form.parentClientAccountId && form.parentClientAccountId !== ORPHAN_ROOT_ID && parentAccount && (
                        <div className="flex items-center gap-2 mb-1 px-2 py-1 bg-ocean-10 rounded text-xs text-ocean-150">
                          <span className="font-mono">{parentAccount.code}</span>
                          <span className="truncate">{parentAccount.name}</span>
                          <button
                            onClick={() => handleChange('parentClientAccountId', null)}
                            className="ml-auto text-ocean-60 hover:text-rose"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      )}

                      {!form.parentClientAccountId && (
                        <p className="text-xs text-ocean-60 mb-1">Conta raiz (sem pai)</p>
                      )}

                      {form.parentClientAccountId === ORPHAN_ROOT_ID && (
                        <p className="text-xs text-golden mb-1">Orfao — selecione um pai</p>
                      )}

                      {/* Search input */}
                      <div className="relative">
                        <Search className="absolute left-2 top-2.5 w-3.5 h-3.5 text-ocean-60" />
                        <input
                          type="text"
                          placeholder="Buscar conta pai..."
                          value={parentSearch}
                          onChange={(e) => { setParentSearch(e.target.value); setShowParentDropdown(true); }}
                          onFocus={() => setShowParentDropdown(true)}
                          className={`${INPUT_CLASS} pl-7`}
                        />
                      </div>

                      {/* Dropdown */}
                      {showParentDropdown && (
                        <div className="absolute z-20 w-full mt-1 bg-white border border-ocean-30 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                          <button
                            onClick={() => handleSelectParent(null)}
                            className="w-full text-left px-3 py-2 text-xs text-ocean-150 hover:bg-ocean-10 border-b border-ocean-30/30"
                          >
                            Sem pai (conta raiz)
                          </button>
                          {parentOptions.map((a) => (
                            <button
                              key={a.clientAccountId}
                              onClick={() => handleSelectParent(a.clientAccountId)}
                              className="w-full text-left px-3 py-1.5 text-xs hover:bg-ocean-10 flex items-center gap-2"
                            >
                              <span className="font-mono text-ocean-60 flex-shrink-0">{a.code}</span>
                              <span className="truncate text-ocean-180">{a.name}</span>
                            </button>
                          ))}
                          {parentOptions.length === 0 && (
                            <p className="px-3 py-2 text-xs text-ocean-60">Nenhuma conta encontrada</p>
                          )}
                        </div>
                      )}
                    </div>
                  </Field>

                  {/* Action for existing accounts */}
                  {account._action && (
                    <Field label="Acao no NetSuite">
                      <select
                        value={form._action || 'skip'}
                        onChange={(e) => handleChange('_action', e.target.value)}
                        className={INPUT_CLASS}
                      >
                        <option value="skip">Pular</option>
                        <option value="update">Atualizar</option>
                        <option value="create">Criar</option>
                      </select>
                    </Field>
                  )}
                </>
              )}

              {/* Bulk edit section */}
              {isBulk && (
                <>
                  <div className="bg-ocean-10 rounded-lg p-3 mb-3">
                    <p className="text-xs text-ocean-150 font-medium">
                      {selectedIds.size} contas selecionadas
                    </p>
                    <p className="text-[10px] text-ocean-60 mt-0.5">
                      Apenas campos preenchidos serao alterados.
                    </p>
                  </div>

                  <Field label="Tipo (bulk)">
                    <select
                      value={bulkType}
                      onChange={(e) => setBulkType(e.target.value)}
                      className={INPUT_CLASS}
                    >
                      <option value="">Manter atual</option>
                      {VALID_ACCOUNT_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Analitica (bulk)">
                    <select
                      value={bulkPosting}
                      onChange={(e) => setBulkPosting(e.target.value)}
                      className={INPUT_CLASS}
                    >
                      <option value="">Manter atual</option>
                      <option value="true">Sim — analitica</option>
                      <option value="false">Nao — sintetica</option>
                    </select>
                  </Field>

                  <Field label="Conta Pai (bulk)">
                    <select
                      value={bulkParentId}
                      onChange={(e) => setBulkParentId(e.target.value)}
                      className={INPUT_CLASS}
                    >
                      <option value="">Manter atual</option>
                      <option value="_null_">Sem pai (raiz)</option>
                      {allAccounts
                        .filter((a) => !a._isOrphanRoot && !selectedIds.has(a.clientAccountId))
                        .slice(0, 100)
                        .map((a) => (
                          <option key={a.clientAccountId} value={a.clientAccountId}>
                            {a.code} — {a.name}
                          </option>
                        ))
                      }
                    </select>
                  </Field>

                  <button
                    onClick={handleBulkApply}
                    disabled={!bulkType && !bulkPosting && !bulkParentId}
                    className="w-full py-2 px-3 bg-ocean-120 text-white text-sm rounded-lg hover:bg-ocean-150 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mb-4"
                  >
                    Aplicar alteracoes
                  </button>

                  {/* Find/Replace */}
                  <div className="border-t border-ocean-30 pt-3">
                    <p className="text-xs font-medium text-ocean-150 mb-2 flex items-center gap-1">
                      <Replace className="w-3 h-3" />
                      Buscar e Substituir no Nome
                    </p>
                    <Field label="Buscar">
                      <input
                        type="text"
                        value={findText}
                        onChange={(e) => setFindText(e.target.value)}
                        placeholder="Texto a buscar..."
                        className={INPUT_CLASS}
                      />
                    </Field>
                    <Field label="Substituir por">
                      <input
                        type="text"
                        value={replaceText}
                        onChange={(e) => setReplaceText(e.target.value)}
                        placeholder="Texto de substituicao (vazio = remover)"
                        className={INPUT_CLASS}
                      />
                    </Field>
                    <button
                      onClick={handleBulkFindReplace}
                      disabled={!findText}
                      className="w-full py-2 px-3 bg-ocean-120 text-white text-sm rounded-lg hover:bg-ocean-150 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Substituir nas {selectedIds.size} contas
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 bg-white border-t border-ocean-30 px-5 py-3 flex items-center justify-between">
              {!isBulk && !isRoot && !account._isOrphanRoot && (
                <button
                  onClick={() => onDelete(account.clientAccountId)}
                  className="flex items-center gap-1 text-xs text-rose hover:text-rose/80 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  Excluir
                </button>
              )}
              {(isBulk || isRoot || account._isOrphanRoot) && <span />}

              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 text-xs text-ocean-150 hover:bg-ocean-10 rounded-lg transition-colors"
                >
                  {isBulk ? 'Fechar' : 'Cancelar'}
                </button>
                {!isBulk && (
                  <button
                    onClick={handleSave}
                    className="flex items-center gap-1 px-3 py-1.5 bg-ocean-120 text-white text-xs rounded-lg hover:bg-ocean-150 transition-colors"
                  >
                    <Save className="w-3 h-3" />
                    Salvar
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
