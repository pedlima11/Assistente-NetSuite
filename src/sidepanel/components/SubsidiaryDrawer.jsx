import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Trash2, Save, Building2, MapPin, Landmark, Briefcase } from 'lucide-react';

/**
 * Map validation error keys to their corresponding form field.
 */
const ERROR_TO_FIELD = {
  'validation.nameRequired': 'name',
  'validation.cnpjDigits': 'cnpj',
  'validation.cnpjDuplicate': 'cnpj',
  'validation.parentRequired': 'parent',
  'validation.currencyRequired': 'currency',
  'validation.fiscalCalendarRequired': 'fiscalcalendar',
  'validation.taxCalendarRequired': 'taxfiscalcalendar',
  'validation.addressNumberRequired': 'addressNumber',
  'validation.cityRequired': 'brCityId',
  'validation.stateRequired': 'state',
};

/** Required fields for progress calculation */
const REQUIRED_FIELDS = ['name', 'parent', 'currency', 'taxfiscalcalendar', 'fiscalcalendar', 'addressNumber', 'state', 'brCityId'];

/**
 * Resolve an i18n error entry (string key or { key, params } object).
 */
function resolveError(e, t) {
  if (typeof e === 'string') return t(e);
  return t(e.key, e.params);
}

/** Extract error key string from error entry */
function errorKey(e) {
  return typeof e === 'string' ? e : e.key;
}

/**
 * Sliding drawer from the right for editing a subsidiary node.
 * Features: inline validation per field, progress bar, section headers with counters.
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

  // Map field → error messages
  const fieldErrors = useMemo(() => {
    const map = {};
    for (const err of validationErrors) {
      const key = errorKey(err);
      const field = ERROR_TO_FIELD[key];
      if (field) {
        if (!map[field]) map[field] = [];
        map[field].push(resolveError(err, t));
      }
    }
    return map;
  }, [validationErrors, t]);

  // Progress: count required fields that have a value in form
  const progress = useMemo(() => {
    // For nodes that need parent select, 'parent' is required
    // For others, skip 'parent' from required list
    const fields = needsParentSelect ? REQUIRED_FIELDS : REQUIRED_FIELDS.filter((f) => f !== 'parent');
    const filled = fields.filter((f) => {
      const val = form[f];
      return val !== undefined && val !== null && String(val).trim() !== '';
    });
    return { filled: filled.length, total: fields.length };
  }, [form, needsParentSelect]);

  const progressPct = progress.total > 0 ? Math.round((progress.filled / progress.total) * 100) : 0;
  // Use full class names so Tailwind can detect them at build time
  const progressBarClass = progressPct < 35 ? 'bg-rose' : progressPct < 70 ? 'bg-golden' : 'bg-pine';
  const progressTextClass = progressPct < 35 ? 'text-rose' : progressPct < 70 ? 'text-golden' : 'text-pine';

  // Section counters
  const companySectionFields = needsParentSelect ? ['name', 'parent'] : ['name'];
  const fiscalSectionFields = ['currency', 'taxfiscalcalendar', 'fiscalcalendar'];
  const addressSectionFields = ['addressNumber', 'state', 'brCityId'];

  function countFilled(fields) {
    return fields.filter((f) => {
      const val = form[f];
      return val !== undefined && val !== null && String(val).trim() !== '';
    }).length;
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
            <div className="sticky top-0 bg-white border-b border-ocean-30 px-5 py-4 z-10">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-ocean-180">
                    {isExisting ? t('drawer.existingTitle') : isRoot ? t('drawer.rootTitle') : t('drawer.defaultTitle')}
                  </h3>
                  <p className="text-xs text-ocean-60 mt-0.5">
                    {isExisting ? (form.name || t('drawer.noName')) : t('drawer.subtitle')}
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="p-1 rounded hover:bg-ocean-30 transition-colors"
                >
                  <X className="w-5 h-5 text-ocean-60" />
                </button>
              </div>

              {/* Progress bar (only for editable nodes) */}
              {!isExisting && (
                <div className="flex items-center gap-2.5">
                  <div className="flex-1 h-1 bg-ocean-20 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ease-out ${progressBarClass}`}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <span className={`text-[11px] font-semibold min-w-[28px] text-right ${progressTextClass}`}>
                    {progress.filled}/{progress.total}
                  </span>
                </div>
              )}
            </div>

            {/* Read-only view for existing nodes */}
            {isExisting ? (
              <div className="p-5 space-y-4" style={{ height: 'calc(100% - 90px)' }}>
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
            <div className="overflow-y-auto" style={{ height: 'calc(100% - 130px)' }}>

              {/* === SECTION: Dados da Empresa === */}
              <div className="px-5 py-4 border-b border-ocean-30">
                <SectionHeader
                  icon={<Briefcase className="w-3.5 h-3.5" />}
                  iconClass="bg-ocean-20 text-ocean-120"
                  label={t('sections.company')}
                  filled={countFilled(companySectionFields)}
                  total={companySectionFields.length}
                />

                {/* Razao Social */}
                <Field label={t('fields.businessName')} required errors={fieldErrors.name}>
                  <input
                    type="text"
                    value={form.name || ''}
                    onChange={(e) => handleChange('name', e.target.value)}
                    placeholder={t('placeholders.businessName')}
                    className={inputClass(fieldErrors.name)}
                  />
                </Field>

                {/* CNPJ */}
                <Field label={t('fields.cnpj')} errors={fieldErrors.cnpj}>
                  <input
                    type="text"
                    value={form.cnpj || ''}
                    onChange={(e) => handleChange('cnpj', e.target.value)}
                    placeholder={t('placeholders.cnpjFormat')}
                    className={inputClass(fieldErrors.cnpj)}
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

                {/* Parent subsidiary (NetSuite) */}
                {needsParentSelect && (
                  <Field label={t('fields.parentSubsidiary')} required errors={fieldErrors.parent}>
                    {existingSubsidiaries?.length > 0 ? (
                      <select
                        value={form.parent || ''}
                        onChange={(e) => handleChange('parent', e.target.value)}
                        className={selectClass(fieldErrors.parent)}
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
                        className={inputClass(fieldErrors.parent)}
                      />
                    )}
                  </Field>
                )}

                {/* Non-root with new parent */}
                {!needsParentSelect && !isRoot && (
                  <Field label={t('fields.parentInTree')}>
                    <div className="px-3 py-2 bg-ocean-10 border border-ocean-30 rounded-lg text-sm text-ocean-150">
                      {t('fields.treeDefinedPosition')}
                    </div>
                  </Field>
                )}
              </div>

              {/* === SECTION: Fiscal === */}
              <div className="px-5 py-4 border-b border-ocean-30">
                <SectionHeader
                  icon={<Landmark className="w-3.5 h-3.5" />}
                  iconClass="bg-green-50 text-green-700"
                  label={t('sections.fiscal')}
                  filled={countFilled(fiscalSectionFields)}
                  total={fiscalSectionFields.length}
                />

                {/* Moeda */}
                <Field label={t('fields.currency')} required errors={fieldErrors.currency}>
                  {lookupData?.currencies?.length > 0 ? (
                    <select
                      value={form.currency || ''}
                      onChange={(e) => handleChange('currency', e.target.value)}
                      className={selectClass(fieldErrors.currency)}
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
                      className={inputClass(fieldErrors.currency)}
                    />
                  )}
                </Field>

                {/* Calendario fiscal impostos */}
                <Field label={t('fields.taxCalendarTax')} required errors={fieldErrors.taxfiscalcalendar}>
                  {lookupData?.taxFiscalCalendars?.length > 0 ? (
                    <select
                      value={form.taxfiscalcalendar || ''}
                      onChange={(e) => handleChange('taxfiscalcalendar', e.target.value)}
                      className={selectClass(fieldErrors.taxfiscalcalendar)}
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
                      className={inputClass(fieldErrors.taxfiscalcalendar)}
                    />
                  )}
                </Field>

                {/* Calendario fiscal */}
                <Field label={t('fields.taxCalendar')} required errors={fieldErrors.fiscalcalendar}>
                  {lookupData?.fiscalCalendars?.length > 0 ? (
                    <select
                      value={form.fiscalcalendar || ''}
                      onChange={(e) => handleChange('fiscalcalendar', e.target.value)}
                      className={selectClass(fieldErrors.fiscalcalendar)}
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
                      className={inputClass(fieldErrors.fiscalcalendar)}
                    />
                  )}
                </Field>
              </div>

              {/* === SECTION: Endereco === */}
              <div className="px-5 py-4">
                <SectionHeader
                  icon={<MapPin className="w-3.5 h-3.5" />}
                  iconClass="bg-orange-50 text-orange-700"
                  label={t('sections.address')}
                  filled={countFilled(addressSectionFields)}
                  total={addressSectionFields.length}
                />

                {/* Rua */}
                <Field label={t('fields.street')}>
                  <input
                    type="text"
                    value={form.address || ''}
                    onChange={(e) => handleChange('address', e.target.value)}
                    className={INPUT_CLASS}
                  />
                </Field>

                {/* Numero + CEP */}
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t('fields.number')} required errors={fieldErrors.addressNumber}>
                    <input
                      type="text"
                      value={form.addressNumber || ''}
                      onChange={(e) => handleChange('addressNumber', e.target.value)}
                      placeholder={t('placeholders.numberExample')}
                      className={inputClass(fieldErrors.addressNumber)}
                    />
                  </Field>

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

                {/* Estado + Cidade */}
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t('fields.state')} required errors={fieldErrors.state}>
                    {lookupData?.brStates?.length > 0 ? (
                      <select
                        value={form.state || ''}
                        onChange={(e) => handleChange('state', e.target.value)}
                        className={selectClass(fieldErrors.state)}
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
                        className={inputClass(fieldErrors.state)}
                      />
                    )}
                  </Field>

                  <Field label={t('fields.city')} required errors={fieldErrors.brCityId}>
                    {lookupData?.brCities?.length > 0 ? (
                      <select
                        value={form.brCityId || ''}
                        onChange={(e) => handleChange('brCityId', e.target.value)}
                        className={selectClass(fieldErrors.brCityId)}
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
                        className={inputClass(fieldErrors.brCityId)}
                      />
                    )}
                  </Field>
                </div>
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

// ===== Styles =====

const INPUT_CLASS = 'w-full px-3 py-2 border border-ocean-30 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ocean-120 focus:border-transparent transition-shadow';
const INPUT_ERROR_CLASS = 'w-full px-3 py-2 border border-rose rounded-lg text-sm bg-red-50/30 focus:outline-none focus:ring-2 focus:ring-rose/30 focus:border-rose transition-shadow';
const READONLY_CLASS = 'px-3 py-2 bg-ocean-10 border border-ocean-30 rounded-lg text-sm text-ocean-150';

function inputClass(errors) {
  return errors?.length ? INPUT_ERROR_CLASS : INPUT_CLASS;
}
function selectClass(errors) {
  return errors?.length ? INPUT_ERROR_CLASS : INPUT_CLASS;
}

// ===== Sub-components =====

function SectionHeader({ icon, iconClass, label, filled, total }) {
  const isComplete = filled === total;
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className={`w-6 h-6 rounded-md flex items-center justify-center ${iconClass}`}>
        {icon}
      </div>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ocean-150">
        {label}
      </span>
      <span className={`ml-auto text-[10px] font-medium ${isComplete ? 'text-pine' : 'text-ocean-60'}`}>
        {filled} / {total}
      </span>
    </div>
  );
}

function Field({ label, required, errors, children }) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-medium text-ocean-150 mb-1">
        {label}
        {required && <span className="text-rose ml-0.5">*</span>}
      </label>
      {children}
      {errors?.map((msg, i) => (
        <p key={i} className="flex items-center gap-1 mt-1 text-[11px] text-rose font-medium">
          <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="5.5" stroke="currentColor" />
            <path d="M6 3.5v3M6 8.5h.01" stroke="currentColor" strokeLinecap="round" />
          </svg>
          {msg}
        </p>
      ))}
    </div>
  );
}
