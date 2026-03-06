import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Trash2, Save, Building2 } from 'lucide-react';

/**
 * Resolve an i18n error entry (string key or { key, params } object).
 */
function resolveError(e, t) {
  if (typeof e === 'string') return t(e);
  return t(e.key, e.params);
}

/**
 * Sliding drawer from the right for editing a subsidiary node.
 * Uses local state (copy-on-open) so edits can be cancelled.
 * For existing nodes (_isExisting), shows read-only info.
 */
export default function SubsidiaryDrawer({ node, lookupData, existingSubsidiaries, validationErrors, onSave, onClose, onDelete }) {
  const { t } = useTranslation('subsidiary');
  const [form, setForm] = useState({});
  const isOpen = node !== null;
  const isRoot = node?.parentClientNodeId === null;
  const isChildOfExisting = !isRoot && node?.parentClientNodeId?.startsWith('existing-');
  const needsParentSelect = isRoot || isChildOfExisting;
  const isExisting = node?._isExisting;

  // Copy node data into local form when node changes
  useEffect(() => {
    if (node) {
      setForm({ ...node });
    }
  }, [node?.clientNodeId]);

  function handleChange(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    onSave(form);
    onClose();
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/20 z-40 transition-opacity duration-200 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div
        className={`fixed top-0 right-0 h-full w-[400px] max-w-[90vw] bg-white shadow-2xl z-50
          transform transition-transform duration-250 ease-out
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
        `}
      >
        {node && (
          <>
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-ocean-30 px-5 py-4 flex items-center justify-between z-10">
              <div>
                <h3 className="text-sm font-semibold text-ocean-180">
                  {isExisting ? t('drawer.existingTitle') : isRoot ? t('drawer.rootTitle') : t('drawer.defaultTitle')}
                </h3>
                <p className="text-xs text-ocean-60 mt-0.5">
                  {form.name || t('drawer.noName')}
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-1 rounded hover:bg-ocean-30 transition-colors"
              >
                <X className="w-5 h-5 text-ocean-60" />
              </button>
            </div>

            {/* Read-only view for existing nodes */}
            {isExisting ? (
              <div className="p-5 space-y-4" style={{ height: 'calc(100% - 70px)' }}>
                <div className="bg-ocean-10 border border-ocean-30 rounded-lg p-4 flex items-start gap-3">
                  <Building2 className="w-5 h-5 text-ocean-120 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-ocean-180">{t('drawer.existsInNetsuite')}</p>
                    <p className="text-xs text-ocean-60 mt-1">{t('drawer.cannotEditHere')}</p>
                  </div>
                </div>

                <Field label={t('fields.businessName')}>
                  <div className={READONLY_CLASS}>{node.name || '—'}</div>
                </Field>

                {node.cnpj && (
                  <Field label={t('fields.cnpj')}>
                    <div className={READONLY_CLASS}>{node.cnpj}</div>
                  </Field>
                )}

                <Field label={t('fields.internalId')}>
                  <div className={READONLY_CLASS}>{node.netsuiteInternalId}</div>
                </Field>

                <div className="pt-4 mt-4 border-t border-ocean-30">
                  <button
                    onClick={onClose}
                    className="w-full px-4 py-2 text-sm text-ocean-150 border border-ocean-30 rounded-lg hover:bg-ocean-10 transition-colors"
                  >
                    {t('drawer.close')}
                  </button>
                </div>
              </div>
            ) : (
            <>
            {/* Editable form body */}
            <div className="overflow-y-auto p-5 space-y-4" style={{ height: 'calc(100% - 130px)' }}>
              {/* Validation errors banner */}
              {validationErrors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-xs font-medium text-rose mb-1">{t('drawer.pendingFields')}</p>
                  {validationErrors.map((e, i) => (
                    <p key={i} className="text-xs text-rose">{resolveError(e, t)}</p>
                  ))}
                </div>
              )}

              {/* Razao Social */}
              <Field label={t('fields.businessName')} required>
                <input
                  type="text"
                  value={form.name || ''}
                  onChange={(e) => handleChange('name', e.target.value)}
                  placeholder={t('placeholders.businessName')}
                  className={INPUT_CLASS}
                />
              </Field>

              {/* CNPJ */}
              <Field label={t('fields.cnpj')}>
                <input
                  type="text"
                  value={form.cnpj || ''}
                  onChange={(e) => handleChange('cnpj', e.target.value)}
                  placeholder={t('placeholders.cnpjFormat')}
                  className={INPUT_CLASS}
                />
              </Field>

              {/* IE */}
              <Field label={t('fields.stateRegistration')}>
                <input
                  type="text"
                  value={form.ie || ''}
                  onChange={(e) => handleChange('ie', e.target.value)}
                  className={INPUT_CLASS}
                />
              </Field>

              {/* Parent subsidiary (NetSuite) — for root or child of existing node */}
              {needsParentSelect && (
                <Field label={t('fields.parentSubsidiary')} required>
                  {existingSubsidiaries?.length > 0 ? (
                    <select
                      value={form.parent || ''}
                      onChange={(e) => handleChange('parent', e.target.value)}
                      className={INPUT_CLASS}
                    >
                      <option value="">{t('placeholders.select')}</option>
                      {existingSubsidiaries.map((s) => (
                        <option key={s.id} value={s.id}>{s.name} (ID: {s.id})</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={form.parent || ''}
                      onChange={(e) => handleChange('parent', e.target.value)}
                      placeholder={t('placeholders.parentId')}
                      className={INPUT_CLASS}
                    />
                  )}
                </Field>
              )}

              {/* Non-root with new parent: show parent name read-only */}
              {!needsParentSelect && !isRoot && (
                <Field label={t('fields.parentInTree')}>
                  <div className="px-3 py-2 bg-ocean-10 border border-ocean-30 rounded-lg text-sm text-ocean-150">
                    {t('fields.treeDefinedPosition')}
                  </div>
                </Field>
              )}

              <div className="border-t border-ocean-30 pt-4 mt-4">
                <p className="text-xs font-semibold text-ocean-150 uppercase tracking-wide mb-3">{t('sections.fiscal')}</p>

                {/* Moeda */}
                <Field label={t('fields.currency')} required>
                  {lookupData?.currencies?.length > 0 ? (
                    <select
                      value={form.currency || ''}
                      onChange={(e) => handleChange('currency', e.target.value)}
                      className={INPUT_CLASS}
                    >
                      <option value="">{t('placeholders.select')}</option>
                      {lookupData.currencies.map((c) => (
                        <option key={c.id} value={c.id}>{c.name} ({c.symbol})</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={form.currency || ''}
                      onChange={(e) => handleChange('currency', e.target.value)}
                      placeholder={t('placeholders.currencyId')}
                      className={INPUT_CLASS}
                    />
                  )}
                </Field>

                {/* Calendario fiscal impostos */}
                <Field label={t('fields.taxCalendarTax')} required>
                  {lookupData?.taxFiscalCalendars?.length > 0 ? (
                    <select
                      value={form.taxfiscalcalendar || ''}
                      onChange={(e) => handleChange('taxfiscalcalendar', e.target.value)}
                      className={INPUT_CLASS}
                    >
                      <option value="">{t('placeholders.select')}</option>
                      {lookupData.taxFiscalCalendars.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={form.taxfiscalcalendar || ''}
                      onChange={(e) => handleChange('taxfiscalcalendar', e.target.value)}
                      placeholder={t('placeholders.calendarId')}
                      className={INPUT_CLASS}
                    />
                  )}
                </Field>

                {/* Calendario fiscal */}
                <Field label={t('fields.taxCalendar')} required>
                  {lookupData?.fiscalCalendars?.length > 0 ? (
                    <select
                      value={form.fiscalcalendar || ''}
                      onChange={(e) => handleChange('fiscalcalendar', e.target.value)}
                      className={INPUT_CLASS}
                    >
                      <option value="">{t('placeholders.select')}</option>
                      {lookupData.fiscalCalendars.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={form.fiscalcalendar || ''}
                      onChange={(e) => handleChange('fiscalcalendar', e.target.value)}
                      placeholder={t('placeholders.calendarId')}
                      className={INPUT_CLASS}
                    />
                  )}
                </Field>
              </div>

              <div className="border-t border-ocean-30 pt-4 mt-4">
                <p className="text-xs font-semibold text-ocean-150 uppercase tracking-wide mb-3">{t('sections.address')}</p>

                {/* Rua */}
                <Field label={t('fields.street')}>
                  <input
                    type="text"
                    value={form.address || ''}
                    onChange={(e) => handleChange('address', e.target.value)}
                    className={INPUT_CLASS}
                  />
                </Field>

                {/* Numero */}
                <Field label={t('fields.number')} required>
                  <input
                    type="text"
                    value={form.addressNumber || ''}
                    onChange={(e) => handleChange('addressNumber', e.target.value)}
                    placeholder={t('placeholders.numberExample')}
                    className={INPUT_CLASS}
                  />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  {/* Estado */}
                  <Field label={t('fields.state')} required>
                    {lookupData?.brStates?.length > 0 ? (
                      <select
                        value={form.state || ''}
                        onChange={(e) => handleChange('state', e.target.value)}
                        className={INPUT_CLASS}
                      >
                        <option value="">{t('placeholders.stateUF')}</option>
                        {lookupData.brStates.map((s) => (
                          <option key={s.id} value={s.id}>{s.id} - {s.name}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={form.state || ''}
                        onChange={(e) => handleChange('state', e.target.value)}
                        placeholder={t('placeholders.stateFallback')}
                        className={INPUT_CLASS}
                      />
                    )}
                  </Field>

                  {/* CEP */}
                  <Field label={t('fields.zipCode')}>
                    <input
                      type="text"
                      value={form.zipCode || ''}
                      onChange={(e) => handleChange('zipCode', e.target.value)}
                      placeholder={t('placeholders.zipFormat')}
                      className={INPUT_CLASS}
                    />
                  </Field>
                </div>

                {/* Cidade */}
                <Field label={t('fields.city')} required>
                  {lookupData?.brCities?.length > 0 ? (
                    <select
                      value={form.brCityId || ''}
                      onChange={(e) => handleChange('brCityId', e.target.value)}
                      className={INPUT_CLASS}
                    >
                      <option value="">{t('placeholders.select')}</option>
                      {lookupData.brCities.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={form.brCityId || ''}
                      onChange={(e) => handleChange('brCityId', e.target.value)}
                      placeholder={t('placeholders.cityId')}
                      className={INPUT_CLASS}
                    />
                  )}
                </Field>
              </div>
            </div>

            {/* Footer actions */}
            <div className="sticky bottom-0 bg-white border-t border-ocean-30 px-5 py-3 flex items-center gap-2">
              {!isRoot && (
                <button
                  onClick={() => { onDelete(node.clientNodeId); onClose(); }}
                  className="p-2 text-rose hover:bg-red-50 rounded-lg transition-colors"
                  title={t('drawer.deleteTitle')}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <div className="flex-1" />
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-ocean-150 border border-ocean-30 rounded-lg hover:bg-ocean-10 transition-colors"
              >
                {t('drawer.cancel')}
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 text-sm font-medium text-white bg-ocean-120 rounded-lg hover:bg-ocean-150 transition-colors flex items-center gap-1.5"
              >
                <Save className="w-4 h-4" />
                {t('drawer.save')}
              </button>
            </div>
            </>
            )}
          </>
        )}
      </div>
    </>
  );
}

const INPUT_CLASS = 'w-full px-3 py-2 border border-ocean-30 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ocean-120 focus:border-transparent transition-shadow';
const READONLY_CLASS = 'px-3 py-2 bg-ocean-10 border border-ocean-30 rounded-lg text-sm text-ocean-150';

function Field({ label, required, children }) {
  return (
    <div className="mb-1">
      <label className="block text-xs font-medium text-ocean-150 mb-1">
        {label}
        {required && <span className="text-rose ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
