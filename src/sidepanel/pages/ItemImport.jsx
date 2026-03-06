import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Loader2, Download, Package,
  Trash2, AlertTriangle, CheckCircle, AlertCircle, Upload,
} from 'lucide-react';
import { parseExcelFile } from '../../parsers/excel-parser.js';
import {
  autoMapColumns, transformItems, validateAccountsFromFile,
  ITEM_TYPES, getRequiredAccounts, getApplicableFields, COSTING_METHODS as FALLBACK_COSTING_METHODS,
} from '../../services/item-mapper.js';
import { sendToBackground } from '../../utils/api-client.js';

const ACCEPTED_EXTENSIONS = ['.csv', '.xls', '.xlsx'];

// ── Etapa 1: Upload + Config ─────────────────────────────────────────────────

function StepUpload({
  file, setFile, config, setConfig, onProcess, processing,
  subsidiaries, subsLoading, lookupLoading, lookupError,
}) {
  const { t } = useTranslation('item');
  const [dragOver, setDragOver] = useState(false);
  const [fileError, setFileError] = useState('');

  function validateFile(f) {
    const ext = '.' + f.name.split('.').pop().toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) return t('upload.invalidFormat');
    if (f.size > 50 * 1024 * 1024) return t('upload.fileTooLarge');
    return null;
  }

  function handleFile(f) {
    const err = validateFile(f);
    if (err) { setFileError(err); return; }
    setFileError('');
    setFile(f);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  const canProcess = file && config.subsidiaryId && config.itemType && !processing;

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          dragOver ? 'border-ocean-120 bg-ocean-10' : 'border-ocean-30 hover:border-ocean-60'
        }`}
        onClick={() => document.getElementById('item-file-input').click()}
      >
        <Upload className="w-8 h-8 mx-auto mb-2 text-ocean-60" />
        <p className="text-sm text-ocean-150 font-medium">
          {file ? file.name : t('upload.dragOrSelect')}
        </p>
        <p className="text-xs text-ocean-60 mt-1">{t('upload.fileTypes')}</p>
        <input
          id="item-file-input"
          type="file"
          accept=".csv,.xls,.xlsx"
          className="hidden"
          onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])}
        />
      </div>
      {fileError && <p className="text-xs text-rose">{fileError}</p>}

      {/* Subsidiaria */}
      <div>
        <label className="block text-sm text-ocean-150 mb-1 font-medium">{t('upload.subsidiaryLabel')}</label>
        <select
          value={config.subsidiaryId}
          onChange={(e) => setConfig((c) => ({ ...c, subsidiaryId: e.target.value }))}
          disabled={subsLoading}
          className="w-full px-3 py-2 border border-ocean-30 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-ocean-120"
        >
          <option value="">{subsLoading ? t('upload.loadingPlaceholder') : t('upload.selectPlaceholder')}</option>
          {subsidiaries.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {lookupLoading && (
        <div className="flex items-center gap-2 text-xs text-ocean-60">
          <Loader2 className="w-3 h-3 animate-spin" /> {t('upload.loadingNetsuite')}
        </div>
      )}
      {lookupError && (
        <p className="text-xs text-rose">{lookupError}</p>
      )}

      {/* Tipo de item */}
      <div>
        <label className="block text-sm text-ocean-150 mb-1 font-medium">{t('upload.itemTypeLabel')}</label>
        <select
          value={config.itemType}
          onChange={(e) => setConfig((c) => ({ ...c, itemType: e.target.value }))}
          className="w-full px-3 py-2 border border-ocean-30 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-ocean-120"
        >
          <option value="">{t('upload.selectPlaceholder')}</option>
          {ITEM_TYPES.map((type) => (
            <option key={type.value} value={type.value}>{type.label}</option>
          ))}
        </select>
      </div>

      {/* Processar */}
      <button
        onClick={onProcess}
        disabled={!canProcess}
        className="w-full py-2 bg-ocean-120 text-white text-sm font-medium rounded-md hover:bg-ocean-150 disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {processing ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> {t('upload.processing')}</>
        ) : (
          t('upload.processFile')
        )}
      </button>
    </div>
  );
}

// ── Etapa 2: Revisao ─────────────────────────────────────────────────────────

function StepReview({
  items, setItems, config, accounts, fallbackConfig, setFallbackConfig,
  ncmCodes, cestCodes, itemOrigins, ipiFramingCodes, spedEfdTypes,
  costingMethods, efdNatureIncomes,
  onBack, onImport,
}) {
  const { t } = useTranslation('item');
  const applicable = getApplicableFields(config.itemType);
  const withErrors = items.filter((it) =>
    it._errors.length > 0 || (it._accountErrors && it._accountErrors.length > 0)
  ).length;

  function handleRemove(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleEdit(idx, field, value) {
    setItems((prev) => prev.map((it, i) => (i !== idx ? it : { ...it, [field]: value })));
  }

  function handleAccountOverride(idx, accountField, accountId) {
    setItems((prev) => prev.map((it, i) => {
      if (i !== idx) return it;
      const nameField = accountField.replace('Id', 'Name');
      const acct = accounts.find((a) => a.id === accountId);
      const updated = { ...it };
      updated[accountField] = accountId;
      updated['_' + nameField + '_valid'] = true;
      updated['_' + nameField + '_display'] = acct ? acct.acctNumber + ' - ' + acct.acctName : '';
      updated._accountErrors = (updated._accountErrors || []).filter(
        (e) => !e.includes(it[nameField] || '')
      );
      return updated;
    }));
  }

  const selectedType = ITEM_TYPES.find((tp) => tp.value === config.itemType);

  return (
    <div className="space-y-3">
      {/* Resumo */}
      <div className="bg-ocean-10 rounded-lg p-3 text-xs text-ocean-150 space-y-1">
        <p><strong>{t('review.type')}:</strong> {selectedType?.label || config.itemType}</p>
        <p><strong>{t('review.subsidiary')}:</strong> {config.subsidiaryId}</p>
      </div>

      {/* Contas nao carregaram */}
      {accounts.length === 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <div className="flex items-center gap-1 text-rose text-xs font-medium">
            <AlertCircle className="w-3.5 h-3.5" /> {t('review.accountsNotLoaded')}
          </div>
        </div>
      )}

      {/* Valores padrao — contas + custeio */}
      <div className="bg-white rounded-lg border border-ocean-30 p-4 space-y-3">
        <h3 className="text-sm font-medium text-ocean-150 uppercase tracking-wide">
          {t('review.defaults')}
        </h3>

        {applicable.incomeAccount && (
          <div>
            <label className="block text-xs text-ocean-150 mb-1">{t('review.incomeAccount')}</label>
            <select
              value={fallbackConfig.incomeAccountId}
              onChange={(e) => setFallbackConfig((c) => ({ ...c, incomeAccountId: e.target.value }))}
              className="w-full px-2 py-1.5 border border-ocean-30 rounded text-xs focus:outline-none focus:ring-1 focus:ring-ocean-120"
            >
              <option value="">{t('upload.selectPlaceholder')}</option>
              {(() => {
                const filtered = accounts.filter((a) => a.acctType === 'Income' || a.acctType === 'OthIncome');
                return (filtered.length > 0 ? filtered : accounts).map((a) => (
                  <option key={a.id} value={a.id}>{a.acctNumber} - {a.acctName}</option>
                ));
              })()}
            </select>
          </div>
        )}

        {applicable.assetAccount && (
          <div>
            <label className="block text-xs text-ocean-150 mb-1">{t('review.assetAccount')}</label>
            <select
              value={fallbackConfig.assetAccountId}
              onChange={(e) => setFallbackConfig((c) => ({ ...c, assetAccountId: e.target.value }))}
              className="w-full px-2 py-1.5 border border-ocean-30 rounded text-xs focus:outline-none focus:ring-1 focus:ring-ocean-120"
            >
              <option value="">{t('upload.selectPlaceholder')}</option>
              {(() => {
                const filtered = accounts.filter((a) => ['OthCurrAsset', 'OthAsset', 'FixedAsset'].includes(a.acctType));
                return (filtered.length > 0 ? filtered : accounts).map((a) => (
                  <option key={a.id} value={a.id}>{a.acctNumber} - {a.acctName}</option>
                ));
              })()}
            </select>
          </div>
        )}

        {applicable.cogsAccount && (
          <div>
            <label className="block text-xs text-ocean-150 mb-1">{t('review.cogsAccount')}</label>
            <select
              value={fallbackConfig.cogsAccountId}
              onChange={(e) => setFallbackConfig((c) => ({ ...c, cogsAccountId: e.target.value }))}
              className="w-full px-2 py-1.5 border border-ocean-30 rounded text-xs focus:outline-none focus:ring-1 focus:ring-ocean-120"
            >
              <option value="">{t('upload.selectPlaceholder')}</option>
              {(() => {
                const filtered = accounts.filter((a) => a.acctType === 'COGS');
                return (filtered.length > 0 ? filtered : accounts).map((a) => (
                  <option key={a.id} value={a.id}>{a.acctNumber} - {a.acctName}</option>
                ));
              })()}
            </select>
          </div>
        )}

        {applicable.expenseAccount && (
          <div>
            <label className="block text-xs text-ocean-150 mb-1">{t('review.expenseAccount')}</label>
            <select
              value={fallbackConfig.expenseAccountId}
              onChange={(e) => setFallbackConfig((c) => ({ ...c, expenseAccountId: e.target.value }))}
              className="w-full px-2 py-1.5 border border-ocean-30 rounded text-xs focus:outline-none focus:ring-1 focus:ring-ocean-120"
            >
              <option value="">{t('upload.selectPlaceholder')}</option>
              {(() => {
                const filtered = accounts.filter((a) => a.acctType === 'Expense');
                return (filtered.length > 0 ? filtered : accounts).map((a) => (
                  <option key={a.id} value={a.id}>{a.acctNumber} - {a.acctName}</option>
                ));
              })()}
            </select>
          </div>
        )}

        {applicable.costingMethod && (
          <div>
            <label className="block text-xs text-ocean-150 mb-1">{t('review.costingMethod')}</label>
            <select
              value={fallbackConfig.costingMethod}
              onChange={(e) => setFallbackConfig((c) => ({ ...c, costingMethod: e.target.value }))}
              className="w-full px-2 py-1.5 border border-ocean-30 rounded text-xs focus:outline-none focus:ring-1 focus:ring-ocean-120"
            >
              <option value="">{t('upload.selectPlaceholder')}</option>
              {(costingMethods.length > 0
                ? costingMethods.map((m) => ({ value: m.id, label: m.name }))
                : FALLBACK_COSTING_METHODS
              ).map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
        )}

        {applicable.reinf && efdNatureIncomes.length > 0 && (
          <div>
            <label className="block text-xs text-ocean-150 mb-1">{t('review.reinfNature')}</label>
            <select
              value={fallbackConfig.efdNatureIncomeId}
              onChange={(e) => setFallbackConfig((c) => ({ ...c, efdNatureIncomeId: e.target.value }))}
              className="w-full px-2 py-1.5 border border-ocean-30 rounded text-xs focus:outline-none focus:ring-1 focus:ring-ocean-120"
            >
              <option value="">{t('upload.selectPlaceholder')}</option>
              {efdNatureIncomes.map((n) => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
            </select>
          </div>
        )}

      </div>

      {/* Stats */}
      <div className="bg-white rounded-lg border border-ocean-30 p-3 flex items-center justify-between text-xs">
        <span className="text-ocean-150"><strong>{items.length}</strong> {t('review.items')}</span>
        {withErrors > 0 && (
          <span className="text-rose flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> {withErrors} {t('review.withIssues')}
          </span>
        )}
      </div>

      {/* Cards */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {items.map((item, idx) => {
          const hasErrors = item._errors.length > 0 || (item._accountErrors && item._accountErrors.length > 0);
          return (
            <div
              key={idx}
              className={`bg-white rounded-lg border p-3 text-xs ${hasErrors ? 'border-amber-300' : 'border-ocean-30'}`}
            >
              <div className="flex items-start justify-between mb-2">
                <span className="text-ocean-60">#{item._rowIndex}</span>
                <button onClick={() => handleRemove(idx)} className="text-rose hover:text-rose">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {item._errors.length > 0 && (
                <div className="text-rose text-xs mb-2 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {item._errors.join(', ')}
                </div>
              )}

              {/* itemId */}
              <div>
                <label className="block text-ocean-60 mb-0.5">{t('review.itemName')}</label>
                <input
                  value={item.itemId || ''}
                  onChange={(e) => handleEdit(idx, 'itemId', e.target.value)}
                  maxLength={60}
                  className="w-full px-2 py-1 border border-ocean-30 rounded text-xs focus:outline-none focus:ring-1 focus:ring-ocean-120"
                />
                <span className="text-xs text-ocean-60">{(item.itemId || '').length}/60</span>
              </div>

              {/* displayName */}
              <div className="mt-1.5">
                <label className="block text-ocean-60 mb-0.5">{t('review.displayName')}</label>
                <input
                  value={item.displayName || ''}
                  onChange={(e) => handleEdit(idx, 'displayName', e.target.value)}
                  maxLength={200}
                  placeholder={t('review.displayNamePlaceholder')}
                  className="w-full px-2 py-1 border border-ocean-30 rounded text-xs focus:outline-none focus:ring-1 focus:ring-ocean-120"
                />
              </div>

              {/* Campos fiscais por item */}
              <div className="mt-2 pt-2 border-t border-ocean-20 space-y-1.5">
                <p className="text-xs text-ocean-60 font-medium">{t('review.taxData')}</p>

                {/* NCM */}
                <div>
                  <label className="block text-ocean-60 mb-0.5 text-xs">{t('review.ncm')}</label>
                  <select
                    value={item.ncmCodeId || ''}
                    onChange={(e) => handleEdit(idx, 'ncmCodeId', e.target.value)}
                    className="w-full px-2 py-1 border border-ocean-30 rounded text-xs focus:outline-none focus:ring-1 focus:ring-ocean-120"
                  >
                    <option value="">{item.ncmCode || t('review.selectNcm')}</option>
                    {ncmCodes.map((n) => (
                      <option key={n.id} value={n.id}>{n.name}</option>
                    ))}
                  </select>
                </div>

                {/* CEST */}
                <div>
                  <label className="text-ocean-60 mb-0.5 text-xs flex items-center gap-1">
                    CEST
                    {item.cestCode && (
                      item._cestCode_valid ? <CheckCircle className="w-3 h-3 text-green-500" /> : <AlertCircle className="w-3 h-3 text-rose" />
                    )}
                  </label>
                  {item.cestCode && item._cestCode_valid ? (
                    <p className="text-xs text-pine bg-green-50 px-2 py-1 rounded">{item._cestCode_display}</p>
                  ) : (
                    <select
                      value={item.cestCodeId || ''}
                      onChange={(e) => {
                        handleEdit(idx, 'cestCodeId', e.target.value);
                        if (e.target.value) {
                          const found = cestCodes.find((c) => c.id === e.target.value);
                          handleEdit(idx, '_cestCode_valid', true);
                          handleEdit(idx, '_cestCode_display', found?.name || '');
                        }
                      }}
                      className={`w-full px-2 py-1 border rounded text-xs focus:outline-none focus:ring-1 focus:ring-ocean-120 ${
                        item.cestCode && item._cestCode_valid === false ? 'border-red-300 bg-red-50' : 'border-ocean-30'
                      }`}
                    >
                      <option value="">{item.cestCode || t('review.selectCest')}</option>
                      {cestCodes.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Origem */}
                <div>
                  <label className="block text-ocean-60 mb-0.5 text-xs">{t('review.origin')}</label>
                  <select
                    value={item.itemOriginId || ''}
                    onChange={(e) => handleEdit(idx, 'itemOriginId', e.target.value)}
                    className="w-full px-2 py-1 border border-ocean-30 rounded text-xs focus:outline-none focus:ring-1 focus:ring-ocean-120"
                  >
                    <option value="">{t('review.selectOrigin')}</option>
                    {itemOrigins.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </div>

                {/* Tributacao IPI */}
                <div>
                  <label className="block text-ocean-60 mb-0.5 text-xs">{t('review.ipiTaxation')}</label>
                  <select
                    value={item.ipiFramingCodeId || ''}
                    onChange={(e) => handleEdit(idx, 'ipiFramingCodeId', e.target.value)}
                    className="w-full px-2 py-1 border border-ocean-30 rounded text-xs focus:outline-none focus:ring-1 focus:ring-ocean-120"
                  >
                    <option value="">{item.ipiFramingCode || t('review.selectIpi')}</option>
                    {ipiFramingCodes.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </div>

                {/* Tipo SPED EFD */}
                <div>
                  <label className="text-ocean-60 mb-0.5 text-xs flex items-center gap-1">
                    {t('review.spedEfdType')}
                    {item.spedEfdType && (
                      item._spedEfdType_valid ? <CheckCircle className="w-3 h-3 text-green-500" /> : <AlertCircle className="w-3 h-3 text-rose" />
                    )}
                  </label>
                  {item.spedEfdType && item._spedEfdType_valid ? (
                    <p className="text-xs text-pine bg-green-50 px-2 py-1 rounded">{item._spedEfdType_display}</p>
                  ) : (
                    <select
                      value={item.spedEfdTypeId || ''}
                      onChange={(e) => {
                        handleEdit(idx, 'spedEfdTypeId', e.target.value);
                        if (e.target.value) {
                          const found = spedEfdTypes.find((s) => s.id === e.target.value);
                          handleEdit(idx, '_spedEfdType_valid', true);
                          handleEdit(idx, '_spedEfdType_display', found?.name || '');
                        }
                      }}
                      className={`w-full px-2 py-1 border rounded text-xs focus:outline-none focus:ring-1 focus:ring-ocean-120 ${
                        item.spedEfdType && item._spedEfdType_valid === false ? 'border-red-300 bg-red-50' : 'border-ocean-30'
                      }`}
                    >
                      <option value="">{item.spedEfdType || t('review.selectSped')}</option>
                      {spedEfdTypes.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {/* costingMethod per-item */}
              {applicable.costingMethod && item.costingMethod && (
                <div className="mt-1.5">
                  <label className="block text-ocean-60 mb-0.5">{t('review.costing')}</label>
                  <select
                    value={item.costingMethod || ''}
                    onChange={(e) => handleEdit(idx, 'costingMethod', e.target.value)}
                    className="w-full px-2 py-1 border border-ocean-30 rounded text-xs focus:outline-none focus:ring-1 focus:ring-ocean-120"
                  >
                    {(costingMethods.length > 0
                      ? costingMethods.map((m) => ({ value: m.id, label: m.name }))
                      : FALLBACK_COSTING_METHODS
                    ).map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* REINF per-item */}
              {applicable.reinf && efdNatureIncomes.length > 0 && (
                <div className="mt-1.5">
                  <label className="block text-ocean-60 mb-0.5">{t('review.reinfPerItem')}</label>
                  <select
                    value={item.efdNatureIncomeId || ''}
                    onChange={(e) => handleEdit(idx, 'efdNatureIncomeId', e.target.value)}
                    className="w-full px-2 py-1 border border-ocean-30 rounded text-xs focus:outline-none focus:ring-1 focus:ring-ocean-120"
                  >
                    <option value="">{t('upload.selectPlaceholder')}</option>
                    {efdNatureIncomes.map((n) => (
                      <option key={n.id} value={n.id}>{n.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Contas do arquivo */}
              {(() => {
                const fields = [];
                if (applicable.incomeAccount) fields.push('incomeAccountName');
                if (applicable.assetAccount) fields.push('assetAccountName');
                if (applicable.cogsAccount) fields.push('cogsAccountName');
                if (applicable.expenseAccount) fields.push('expenseAccountName');
                return fields;
              })().map((field) => {
                if (!item[field]) return null;
                const isValid = item['_' + field + '_valid'] === true;
                const display = item['_' + field + '_display'] || item[field];
                const idField = field.replace('Name', 'Id');
                const labelMap = {
                  incomeAccountName: t('review.accountIncome'),
                  assetAccountName: t('review.accountAsset'),
                  cogsAccountName: t('review.accountCogs'),
                  expenseAccountName: t('review.accountExpense'),
                };
                return (
                  <div key={field} className="mt-1.5">
                    <label className="text-ocean-60 mb-0.5 flex items-center gap-1 text-xs">
                      {labelMap[field]}
                      {isValid ? (
                        <CheckCircle className="w-3 h-3 text-green-500" />
                      ) : (
                        <AlertCircle className="w-3 h-3 text-rose" />
                      )}
                    </label>
                    {isValid ? (
                      <p className="text-xs text-pine bg-green-50 px-2 py-1 rounded">{display}</p>
                    ) : accounts.length > 0 ? (
                      <select
                        value={item[idField] || fallbackConfig[idField] || ''}
                        onChange={(e) => handleAccountOverride(idx, idField, e.target.value)}
                        className="w-full px-2 py-1 border border-red-300 rounded text-xs bg-red-50 focus:outline-none focus:ring-1 focus:ring-ocean-120"
                      >
                        <option value="">{t('review.selectAccount', { name: item[field] })}</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>{a.acctNumber} - {a.acctName}</option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-xs text-rose bg-red-50 px-2 py-1 rounded">
                        {t('review.accountsNotLoadedInline', { name: item[field] })}
                      </p>
                    )}
                  </div>
                );
              })}

              {item._accountErrors && item._accountErrors.length > 0 && (
                <div className="text-amber-600 text-xs mt-1 flex items-start gap-1">
                  <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                  <span>{item._accountErrors.join('; ')}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Botoes */}
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          className="flex-1 py-2 border border-ocean-30 text-ocean-150 text-sm rounded-md hover:bg-ocean-10 flex items-center justify-center gap-1"
        >
          {t('review.back')}
        </button>
        <button
          onClick={onImport}
          disabled={items.length === 0}
          className="flex-1 py-2 bg-ocean-120 text-white text-sm font-medium rounded-md hover:bg-ocean-150 disabled:opacity-50 flex items-center justify-center gap-1"
        >
          {t('review.import')}
        </button>
      </div>
    </div>
  );
}

// ── Etapa 3: Importacao ──────────────────────────────────────────────────────

function StepImport({ items, config, fallbackConfig, onBack }) {
  const { t } = useTranslation('item');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const selectedType = ITEM_TYPES.find((tp) => tp.value === config.itemType);

  async function handleImport() {
    setImporting(true);
    const applicable = getApplicableFields(config.itemType);
    try {
      const cleanItems = items.map((it) => {
        const clean = { ...it };
        // Preencher contas faltantes com fallback
        const acctFields = ['incomeAccountId', 'assetAccountId', 'cogsAccountId', 'expenseAccountId'];
        acctFields.forEach((f) => {
          if (!clean[f] && fallbackConfig[f]) clean[f] = fallbackConfig[f];
        });
        // Preencher costingMethod com fallback
        if (!clean.costingMethod && fallbackConfig.costingMethod) {
          clean.costingMethod = fallbackConfig.costingMethod;
        }
        // REINF — so aplicar fallback se tipo suporta
        if (applicable.reinf && !clean.efdNatureIncomeId && fallbackConfig.efdNatureIncomeId) {
          clean.efdNatureIncomeId = fallbackConfig.efdNatureIncomeId;
        }
        // Limpar campos nao aplicaveis ao tipo
        if (!applicable.reinf) {
          delete clean.efdNatureIncomeId;
        }
        // Remover campos internos
        Object.keys(clean).forEach((k) => { if (k.startsWith('_')) delete clean[k]; });
        // Remover nomes textuais (enviar so IDs)
        delete clean.incomeAccountName;
        delete clean.assetAccountName;
        delete clean.cogsAccountName;
        delete clean.expenseAccountName;
        delete clean.efdNatureIncome;
        delete clean.ncmCode;
        delete clean.cestCode;
        delete clean.ipiFramingCode;
        delete clean.spedEfdType;
        return clean;
      });

      const res = await sendToBackground({
        type: 'CREATE_ITEMS',
        data: {
          items: cleanItems,
          itemType: config.itemType,
          subsidiaryId: config.subsidiaryId,
          globalConfig: {
            incomeAccountId: fallbackConfig.incomeAccountId || '',
            assetAccountId: fallbackConfig.assetAccountId || '',
            cogsAccountId: fallbackConfig.cogsAccountId || '',
            expenseAccountId: fallbackConfig.expenseAccountId || '',
            costingMethod: fallbackConfig.costingMethod || '',
            efdNatureIncomeId: fallbackConfig.efdNatureIncomeId || '',
          },
        },
      });
      setResult(res);
    } catch (err) {
      setResult({ success: false, itemsCreated: 0, errors: [{ name: t('import.generalError'), error: err.message }] });
    } finally {
      setImporting(false);
    }
  }

  function handleExportCSV() {
    const fields = ['itemId', 'costingMethod'];
    const labels = ['Nome', 'Custeio'];
    const rows = items.map((it) => fields.map((f) => (it[f] || '').toString().replace(/;/g, ',')));
    const csv = [labels.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'itens_import.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  return (
    <div className="space-y-4">
      {/* Resumo */}
      <div className="bg-white rounded-lg border border-ocean-30 p-4">
        <h3 className="text-sm font-medium text-ocean-150 mb-3">{t('import.summary')}</h3>
        <div className="grid grid-cols-2 gap-3 text-center">
          <div className="bg-ocean-10 rounded-lg p-3">
            <p className="text-lg font-bold text-ocean-180">{items.length}</p>
            <p className="text-xs text-ocean-60">{t('import.totalItems')}</p>
          </div>
          <div className="bg-ocean-10 rounded-lg p-3">
            <p className="text-xs font-bold text-ocean-150">{selectedType?.label || config.itemType}</p>
            <p className="text-xs text-ocean-60">{t('import.type')}</p>
          </div>
        </div>
      </div>

      {/* Resultado */}
      {result && (
        <div className={`rounded-lg border p-4 ${result.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <div className="flex items-center gap-2 mb-2">
            {result.success ? (
              <CheckCircle className="w-5 h-5 text-pine" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose" />
            )}
            <span className={`text-sm font-medium ${result.success ? 'text-pine' : 'text-rose'}`}>
              {result.itemsCreated || 0} {t('import.itemsCreated')}
              {result.errors?.length > 0 && ` | ${result.errors.length} ${t('import.errors')}`}
            </span>
          </div>
          <p className="text-xs text-gray-400 mb-1">
            {result.scriptVersion ? t('import.scriptVersion', { version: result.scriptVersion }) : t('import.noScriptVersion')}
          </p>

          {result.created?.length > 0 && (
            <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
              {result.created.map((c, i) => (
                <div key={i} className={`text-xs px-2 py-1 rounded ${c.warnings ? 'text-yellow-700 bg-yellow-50' : 'text-pine bg-green-100'}`}>
                  <strong>ID {c.id}</strong> — {c.name} ({c.type})
                  {c.warnings && (
                    <div className="text-xs mt-0.5 text-yellow-600">{c.warnings.join('; ')}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {result.errors?.length > 0 && (
            <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
              {result.errors.slice(0, 15).map((err, i) => (
                <div key={i} className="text-xs text-rose bg-red-100 px-2 py-1 rounded">
                  <strong>{err.name || 'Item'}:</strong> {err.error}
                </div>
              ))}
              {result.errors.length > 15 && (
                <p className="text-xs text-rose">{t('import.andMore', { count: result.errors.length - 15 })}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Botoes */}
      <div className="space-y-2">
        {!result && (
          <button
            onClick={handleImport}
            disabled={importing}
            className="w-full py-2 bg-pine text-white text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {importing ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> {t('import.importing')}</>
            ) : (
              <><Upload className="w-4 h-4" /> {t('import.importToNetsuite')}</>
            )}
          </button>
        )}
        <button
          onClick={handleExportCSV}
          className="w-full py-2 border border-ocean-30 text-ocean-150 text-sm rounded-md hover:bg-ocean-10 flex items-center justify-center gap-2"
        >
          <Download className="w-4 h-4" /> {t('import.exportCsv')}
        </button>
        <button onClick={onBack} className="w-full py-2 text-ocean-60 text-sm hover:text-ocean-150">
          {t('import.back')}
        </button>
      </div>
    </div>
  );
}

// ── Componente Principal ─────────────────────────────────────────────────────

export default function ItemImport() {
  const navigate = useNavigate();
  const { t } = useTranslation('item');
  const [step, setStep] = useState('upload');

  const [subsidiaries, setSubsidiaries] = useState([]);
  const [subsLoading, setSubsLoading] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [itemOrigins, setItemOrigins] = useState([]);
  const [ipiFramingCodes, setIpiFramingCodes] = useState([]);
  const [ncmCodes, setNcmCodes] = useState([]);
  const [cestCodes, setCestCodes] = useState([]);
  const [spedEfdTypes, setSpedEfdTypes] = useState([]);
  const [costingMethods, setCostingMethods] = useState([]);
  const [efdNatureIncomes, setEfdNatureIncomes] = useState([]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');

  const [file, setFile] = useState(null);
  const [config, setConfig] = useState({ subsidiaryId: '', itemType: '' });
  const [fallbackConfig, setFallbackConfig] = useState({
    incomeAccountId: '',
    assetAccountId: '',
    cogsAccountId: '',
    expenseAccountId: '',
    costingMethod: '',
    efdNatureIncomeId: '',
  });
  const [processing, setProcessing] = useState(false);
  const [items, setItems] = useState([]);

  // Carregar subsidiarias ao montar
  useEffect(() => {
    async function fetchSubs() {
      setSubsLoading(true);
      try {
        const data = await sendToBackground({ type: 'FETCH_LOOKUP_DATA' });
        if (data?.subsidiaries?.length > 0) setSubsidiaries(data.subsidiaries);
      } catch (e) {
        console.error('[ItemImport] Erro ao carregar subsidiarias:', e);
      } finally { setSubsLoading(false); }
    }
    fetchSubs();
  }, []);

  // Carregar contas quando subsidiaria ou tipo de item muda
  useEffect(() => {
    if (!config.subsidiaryId) return;
    async function fetchAccounts() {
      setLookupLoading(true);
      setLookupError('');
      try {
        const data = await sendToBackground({
          type: 'ITEM_LOOKUP_DATA',
          data: { subsidiaryId: config.subsidiaryId, itemType: config.itemType },
        });
        if (data) {
          setAccounts(data.accounts || []);
          setItemOrigins(data.itemOrigins || []);
          setIpiFramingCodes(data.ipiFramingCodes || []);
          setNcmCodes(data.ncmCodes || []);
          setCestCodes(data.cestCodes || []);
          setSpedEfdTypes(data.spedEfdTypes || []);
          if (data.costingMethods?.length > 0) setCostingMethods(data.costingMethods);
          if (data.efdNatureIncomes?.length > 0) {
            setEfdNatureIncomes(data.efdNatureIncomes);
          } else {
            setEfdNatureIncomes([]);
          }
          if ((data.accounts || []).length === 0) {
            setLookupError(t('review.accountsNotLoaded'));
          }
          // Auto-preencher contas sugeridas da subsidiary
          if (data.suggestedAccounts && Object.keys(data.suggestedAccounts).length > 0) {
            setFallbackConfig((prev) => {
              const updated = { ...prev };
              ['incomeAccountId', 'assetAccountId', 'cogsAccountId', 'expenseAccountId'].forEach((field) => {
                if (!prev[field] && data.suggestedAccounts[field]) {
                  updated[field] = data.suggestedAccounts[field];
                }
              });
              return updated;
            });
          }
        } else {
          setLookupError('Resposta vazia do NetSuite.');
        }
      } catch (e) {
        setLookupError('Erro ao conectar: ' + (e.message || String(e)));
      } finally { setLookupLoading(false); }
    }
    fetchAccounts();
  }, [config.subsidiaryId, config.itemType]);

  async function handleProcess() {
    setProcessing(true);
    try {
      // Carregar dados frescos
      let freshAccounts = accounts;
      let freshNcmCodes = ncmCodes;
      let freshItemOrigins = itemOrigins;
      let freshIpiFramingCodes = ipiFramingCodes;
      let freshCestCodes = cestCodes;
      let freshSpedEfdTypes = spedEfdTypes;
      let freshCostingMethods = costingMethods;
      let freshEfdNatureIncomes = efdNatureIncomes;
      try {
        const data = await sendToBackground({
          type: 'ITEM_LOOKUP_DATA',
          data: { subsidiaryId: config.subsidiaryId, itemType: config.itemType },
        });
        if (data?.accounts) {
          freshAccounts = data.accounts;
          setAccounts(data.accounts);
        }
        if (data?.ncmCodes) { freshNcmCodes = data.ncmCodes; setNcmCodes(data.ncmCodes); }
        if (data?.itemOrigins) { freshItemOrigins = data.itemOrigins; setItemOrigins(data.itemOrigins); }
        if (data?.ipiFramingCodes) { freshIpiFramingCodes = data.ipiFramingCodes; setIpiFramingCodes(data.ipiFramingCodes); }
        if (data?.cestCodes) { freshCestCodes = data.cestCodes; setCestCodes(data.cestCodes); }
        if (data?.spedEfdTypes) { freshSpedEfdTypes = data.spedEfdTypes; setSpedEfdTypes(data.spedEfdTypes); }
        if (data?.costingMethods?.length > 0) {
          freshCostingMethods = data.costingMethods;
          setCostingMethods(data.costingMethods);
        }
        if (data?.efdNatureIncomes?.length > 0) {
          freshEfdNatureIncomes = data.efdNatureIncomes;
          setEfdNatureIncomes(data.efdNatureIncomes);
        }
        console.log('[ItemImport] costingMethods:', freshCostingMethods.length, freshCostingMethods);
      } catch (e) {
        console.error('[ItemImport] Erro ao carregar dados:', e);
      }

      const parsed = await parseExcelFile(file);
      const fileHeaders = parsed.headers[0] || [];
      const dataRows = parsed.rows.slice(1);

      const mapping = autoMapColumns(fileHeaders);
      console.log('[ItemImport] Column mapping:', mapping);

      let mapped = transformItems(fileHeaders, dataRows, mapping);

      if (freshAccounts.length > 0) {
        mapped = validateAccountsFromFile(mapped, freshAccounts);
      }

      // Auto-match campos fiscais do arquivo contra lookups do NetSuite
      mapped = mapped.map((item) => {
        const updated = { ...item };
        // NCM — buscar por codigo no nome
        if (item.ncmCode && freshNcmCodes.length > 0) {
          const ncmNorm = (item.ncmCode || '').replace(/[.\-\s]/g, '');
          const match = freshNcmCodes.find((n) => {
            const nNorm = (n.name || '').replace(/[.\-\s]/g, '');
            return nNorm === ncmNorm || nNorm.startsWith(ncmNorm) || ncmNorm.startsWith(nNorm);
          });
          if (match) updated.ncmCodeId = match.id;
        }
        // CEST — formatar para mascara XX.XXX.XX e comparar
        if (item.cestCode && freshCestCodes.length > 0) {
          const cestDigits = (item.cestCode || '').replace(/\D/g, '');
          // Formatar para XX.XXX.XX se tiver 7 digitos
          const cestFormatted = cestDigits.length === 7
            ? cestDigits.slice(0, 2) + '.' + cestDigits.slice(2, 5) + '.' + cestDigits.slice(5, 7)
            : null;
          const match = freshCestCodes.find((c) => {
            const cNorm = (c.name || '').replace(/\D/g, '');
            if (cestDigits && cNorm === cestDigits) return true;
            if (cestFormatted && (c.name || '').trim() === cestFormatted) return true;
            if (cNorm && cestDigits && (cNorm.startsWith(cestDigits) || cestDigits.startsWith(cNorm))) return true;
            return false;
          });
          if (match) {
            updated.cestCodeId = match.id;
            updated._cestCode_valid = true;
            updated._cestCode_display = match.name;
          } else {
            updated._cestCode_valid = false;
          }
        }
        // Origem — buscar pelo texto
        if (item.itemOriginId && freshItemOrigins.length > 0 && !parseInt(item.itemOriginId)) {
          const oriNorm = (item.itemOriginId || '').toLowerCase().trim();
          const match = freshItemOrigins.find((o) => (o.name || '').toLowerCase().includes(oriNorm) || oriNorm.includes((o.name || '').toLowerCase()));
          if (match) updated.itemOriginId = match.id;
        }
        // IPI — buscar pelo texto
        if (item.ipiFramingCode && freshIpiFramingCodes.length > 0) {
          const ipiNorm = (item.ipiFramingCode || '').toLowerCase().trim();
          const match = freshIpiFramingCodes.find((f) => (f.name || '').toLowerCase().includes(ipiNorm) || ipiNorm.includes((f.name || '').toLowerCase()));
          if (match) updated.ipiFramingCodeId = match.id;
        }
        // SPED EFD Type — buscar pelo texto
        if (item.spedEfdType && freshSpedEfdTypes.length > 0) {
          const spedNorm = (item.spedEfdType || '').toLowerCase().trim();
          const match = freshSpedEfdTypes.find((s) => {
            const sNorm = (s.name || '').toLowerCase().trim();
            return sNorm === spedNorm || sNorm.includes(spedNorm) || spedNorm.includes(sNorm);
          });
          if (match) {
            updated.spedEfdTypeId = match.id;
            updated._spedEfdType_valid = true;
            updated._spedEfdType_display = match.name;
          } else {
            updated._spedEfdType_valid = false;
          }
        }
        // EFD REINF — Natureza do Rendimento
        if (item.efdNatureIncome && freshEfdNatureIncomes.length > 0) {
          const norm = (item.efdNatureIncome || '').toLowerCase().trim();
          const match = freshEfdNatureIncomes.find((n) => {
            const nName = (n.name || '').toLowerCase().trim();
            return nName === norm || nName.includes(norm) || norm.includes(nName);
          });
          if (match) { updated.efdNatureIncomeId = match.id; }
        }
        // Costing Method — converter valor do arquivo para ID real do NetSuite
        if (item.costingMethod && freshCostingMethods.length > 0) {
          const cmVal = (item.costingMethod || '').toUpperCase().trim();
          const CM_KEYWORDS = {
            'AVG': ['média', 'media', 'average', 'avg'],
            'FIFO': ['peps', 'fifo', 'primeiro'],
            'LIFO': ['ueps', 'lifo', 'último', 'ultimo'],
            'STANDARD': ['padrão', 'padrao', 'standard', 'padr'],
            'GROUPAVG': ['grupo', 'group', 'média do grupo', 'media do grupo'],
          };
          let cmMatch = freshCostingMethods.find((m) => m.id.toUpperCase() === cmVal);
          if (!cmMatch) {
            cmMatch = freshCostingMethods.find((m) => (m.name || '').toUpperCase() === cmVal);
          }
          if (!cmMatch) {
            const keywords = CM_KEYWORDS[cmVal] || [cmVal.toLowerCase()];
            cmMatch = freshCostingMethods.find((m) => {
              const mName = (m.name || '').toLowerCase();
              const mId = (m.id || '').toLowerCase();
              return keywords.some((kw) => mName.includes(kw) || mId.includes(kw));
            });
          }
          console.log('[ItemImport] costing match:', cmVal, '→', cmMatch?.id || 'passthrough');
          if (cmMatch) {
            updated.costingMethod = cmMatch.id;
          }
        }
        return updated;
      });

      setItems(mapped);
      setStep('review');
    } catch (err) {
      alert(t('import.errorProcessing', { message: err.message }));
    } finally {
      setProcessing(false);
    }
  }

  const stepLabels = { upload: t('steps.upload'), review: t('steps.review'), import: t('steps.import') };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="w-5 h-5 text-ocean-150" />
          <h2 className="text-base font-medium text-ocean-180">{t('title')}</h2>
        </div>
        <button
          onClick={() => navigate('/')}
          className="text-sm text-ocean-150 hover:text-ocean-180 flex items-center gap-1"
        >
          <ArrowLeft className="w-3 h-3" /> {t('home')}
        </button>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1">
        {Object.entries(stepLabels).map(([key, label], i) => (
          <React.Fragment key={key}>
            {i > 0 && <div className="flex-shrink-0 w-4 h-px bg-ocean-30" />}
            <span className={`text-xs px-2 py-1 rounded-full ${
              step === key
                ? 'bg-ocean-120 text-white'
                : Object.keys(stepLabels).indexOf(step) > i
                  ? 'bg-pine text-white'
                  : 'bg-ocean-10 text-ocean-60'
            }`}>
              {label}
            </span>
          </React.Fragment>
        ))}
      </div>

      {/* Content */}
      {step === 'upload' && (
        <StepUpload
          file={file} setFile={setFile}
          config={config} setConfig={setConfig}
          onProcess={handleProcess} processing={processing}
          subsidiaries={subsidiaries} subsLoading={subsLoading}
          lookupLoading={lookupLoading} lookupError={lookupError}
        />
      )}

      {step === 'review' && (
        <StepReview
          items={items} setItems={setItems}
          config={config} accounts={accounts}
          ncmCodes={ncmCodes} cestCodes={cestCodes}
          itemOrigins={itemOrigins} ipiFramingCodes={ipiFramingCodes}
          spedEfdTypes={spedEfdTypes}
          costingMethods={costingMethods}
          efdNatureIncomes={efdNatureIncomes}
          fallbackConfig={fallbackConfig} setFallbackConfig={setFallbackConfig}
          onBack={() => setStep('upload')}
          onImport={() => setStep('import')}
        />
      )}

      {step === 'import' && (
        <StepImport
          items={items} config={config}
          fallbackConfig={fallbackConfig}
          onBack={() => setStep('review')}
        />
      )}
    </div>
  );
}
