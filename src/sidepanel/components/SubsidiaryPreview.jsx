import React, { useEffect } from 'react';
import { Building2 } from 'lucide-react';

/**
 * Normaliza texto para comparacao (remove acentos, lowercase)
 */
function normalize(str) {
  return (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/**
 * Preview editavel dos dados da filial com dropdowns para campos de referencia
 * @param {{ subsidiary: Object, onChange: (updated: Object) => void, lookupData: Object }} props
 */
export default function SubsidiaryPreview({ subsidiary, onChange, lookupData }) {
  // Auto-match: quando lookupData carrega, tentar casar campos texto com IDs
  useEffect(() => {
    if (!lookupData) return;
    const updates = {};

    // Auto-match cidade: subsidiary.city (texto) → brCityId (ID)
    if (!subsidiary.brCityId && subsidiary.city && lookupData.brCities?.length > 0) {
      const cityNorm = normalize(subsidiary.city);
      const match = lookupData.brCities.find((c) => normalize(c.name) === cityNorm);
      if (match) {
        updates.brCityId = match.id;
      }
    }

    // Auto-match estado: subsidiary.state pode ja ser UF (SP) ou nome completo (Sao Paulo)
    if (subsidiary.state && lookupData.brStates?.length > 0) {
      const stateNorm = normalize(subsidiary.state);
      // Se ja e uma UF valida (2 chars), manter
      const isUF = lookupData.brStates.some((s) => s.id === subsidiary.state.toUpperCase());
      if (!isUF) {
        // Tentar casar por nome
        const match = lookupData.brStates.find((s) => normalize(s.name) === stateNorm);
        if (match) {
          updates.state = match.id;
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      onChange({ ...subsidiary, ...updates });
    }
  }, [lookupData]); // so roda quando lookupData carrega

  function handleFieldChange(key, value) {
    onChange({ ...subsidiary, [key]: value });
  }

  return (
    <div className="bg-white rounded-lg border border-ocean-30 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Building2 className="w-5 h-5 text-ocean-120" />
        <h3 className="text-sm font-medium text-ocean-180">Dados da Filial</h3>
      </div>

      <div className="space-y-2">
        {/* Nome */}
        <Field label="Razao Social" required>
          <input
            type="text"
            value={subsidiary.name || ''}
            onChange={(e) => handleFieldChange('name', e.target.value)}
            className="input-field"
          />
        </Field>

        {/* CNPJ */}
        <Field label="CNPJ">
          <input
            type="text"
            value={subsidiary.cnpj || ''}
            onChange={(e) => handleFieldChange('cnpj', e.target.value)}
            className="input-field"
          />
        </Field>

        {/* IE */}
        <Field label="Inscricao Estadual">
          <input
            type="text"
            value={subsidiary.ie || ''}
            onChange={(e) => handleFieldChange('ie', e.target.value)}
            className="input-field"
          />
        </Field>

        {/* Subsidiary pai */}
        <Field label="Subsidiary Pai" required>
          {lookupData?.subsidiaries?.length > 0 ? (
            <select
              value={subsidiary.parent || ''}
              onChange={(e) => handleFieldChange('parent', e.target.value)}
              className="input-field"
            >
              <option value="">Selecione...</option>
              {lookupData.subsidiaries.map((s) => (
                <option key={s.id} value={s.id}>{s.name} (ID: {s.id})</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={subsidiary.parent || ''}
              onChange={(e) => handleFieldChange('parent', e.target.value)}
              placeholder="ID da empresa-mae"
              className="input-field"
            />
          )}
        </Field>

        {/* Moeda */}
        <Field label="Moeda" required>
          {lookupData?.currencies?.length > 0 ? (
            <select
              value={subsidiary.currency || ''}
              onChange={(e) => handleFieldChange('currency', e.target.value)}
              className="input-field"
            >
              <option value="">Selecione...</option>
              {lookupData.currencies.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.symbol}) - ID: {c.id}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={subsidiary.currency || ''}
              onChange={(e) => handleFieldChange('currency', e.target.value)}
              placeholder="ID da moeda BRL"
              className="input-field"
            />
          )}
        </Field>

        {/* Calendario fiscal de impostos */}
        <Field label="Cal. Fiscal Imp." required>
          {lookupData?.taxFiscalCalendars?.length > 0 ? (
            <select
              value={subsidiary.taxfiscalcalendar || ''}
              onChange={(e) => handleFieldChange('taxfiscalcalendar', e.target.value)}
              className="input-field"
            >
              <option value="">Selecione...</option>
              {lookupData.taxFiscalCalendars.map((c) => (
                <option key={c.id} value={c.id}>{c.name} (ID: {c.id})</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={subsidiary.taxfiscalcalendar || ''}
              onChange={(e) => handleFieldChange('taxfiscalcalendar', e.target.value)}
              placeholder="ID do calendario"
              className="input-field"
            />
          )}
        </Field>

        {/* Calendario fiscal */}
        <Field label="Cal. Fiscal" required>
          {lookupData?.fiscalCalendars?.length > 0 ? (
            <select
              value={subsidiary.fiscalcalendar || ''}
              onChange={(e) => handleFieldChange('fiscalcalendar', e.target.value)}
              className="input-field"
            >
              <option value="">Selecione...</option>
              {lookupData.fiscalCalendars.map((c) => (
                <option key={c.id} value={c.id}>{c.name} (ID: {c.id})</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={subsidiary.fiscalcalendar || ''}
              onChange={(e) => handleFieldChange('fiscalcalendar', e.target.value)}
              placeholder="ID do calendario"
              className="input-field"
            />
          )}
        </Field>

        {/* Endereco */}
        <Field label="Endereco (Rua)">
          <input
            type="text"
            value={subsidiary.address || ''}
            onChange={(e) => handleFieldChange('address', e.target.value)}
            className="input-field"
          />
        </Field>

        {/* Numero */}
        <Field label="Numero" required>
          <input
            type="text"
            value={subsidiary.addressNumber || ''}
            onChange={(e) => handleFieldChange('addressNumber', e.target.value)}
            placeholder="Ex: 123"
            className="input-field"
          />
        </Field>

        {/* Cidade do Brasil */}
        <Field label="Cidade Brasil" required>
          {lookupData?.brCities?.length > 0 ? (
            <select
              value={subsidiary.brCityId || ''}
              onChange={(e) => handleFieldChange('brCityId', e.target.value)}
              className="input-field"
            >
              <option value="">Selecione...</option>
              {lookupData.brCities.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={subsidiary.brCityId || ''}
              onChange={(e) => handleFieldChange('brCityId', e.target.value)}
              placeholder="ID da cidade"
              className="input-field"
            />
          )}
        </Field>

        {/* Estado */}
        <Field label="Estado (UF)" required>
          {lookupData?.brStates?.length > 0 ? (
            <select
              value={subsidiary.state || ''}
              onChange={(e) => handleFieldChange('state', e.target.value)}
              className="input-field"
            >
              <option value="">Selecione...</option>
              {lookupData.brStates.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.id})</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={subsidiary.state || ''}
              onChange={(e) => handleFieldChange('state', e.target.value)}
              placeholder="Ex: SP"
              className="input-field"
            />
          )}
        </Field>

        {/* CEP */}
        <Field label="CEP">
          <input
            type="text"
            value={subsidiary.zipCode || ''}
            onChange={(e) => handleFieldChange('zipCode', e.target.value)}
            className="input-field"
          />
        </Field>
      </div>

      <style>{`
        .input-field {
          width: 100%;
          padding: 4px 8px;
          border: 1px solid #E7F2F5;
          border-radius: 4px;
          font-size: 0.875rem;
          outline: none;
        }
        .input-field:focus {
          border-color: #36677D;
          box-shadow: 0 0 0 1px #36677D;
        }
      `}</style>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <div className="flex items-start gap-2">
      <label className="text-xs text-ocean-150 w-28 flex-shrink-0 pt-1.5">
        {label}
        {required && <span className="text-rose ml-0.5">*</span>}
      </label>
      <div className="flex-1">{children}</div>
    </div>
  );
}
