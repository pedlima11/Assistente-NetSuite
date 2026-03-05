import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Loader2, Download, Users,
  Trash2, AlertTriangle, CheckCircle, AlertCircle, Upload,
} from 'lucide-react';
import { parseExcelFile } from '../../parsers/excel-parser.js';
import { autoMapColumns, transformCustomers, getAvailableFields, validateDocument } from '../../services/customer-mapper.js';
import { sendToBackground } from '../../utils/api-client.js';

const ACCEPTED_EXTENSIONS = ['.csv', '.xls', '.xlsx'];

// ── Etapa 1: Upload + Config ────────────────────────────────────────────────

function StepUpload({ file, setFile, config, setConfig, onProcess, processing, subsidiaries, subsLoading, entityStatuses }) {
  const [dragOver, setDragOver] = useState(false);
  const [fileError, setFileError] = useState('');

  function validateFile(f) {
    const ext = '.' + f.name.split('.').pop().toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      return 'Formato invalido. Use .csv, .xls ou .xlsx';
    }
    if (f.size > 50 * 1024 * 1024) {
      return 'Arquivo excede 50MB';
    }
    return null;
  }

  function handleFile(f) {
    const err = validateFile(f);
    if (err) {
      setFileError(err);
      return;
    }
    setFileError('');
    setFile(f);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => document.getElementById('customer-file-input').click()}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          dragOver ? 'border-ocean-120 bg-ocean-10' : 'border-ocean-30 hover:border-ocean-120'
        }`}
      >
        <input
          id="customer-file-input"
          type="file"
          accept=".csv,.xls,.xlsx"
          className="hidden"
          onChange={(e) => { if (e.target.files[0]) handleFile(e.target.files[0]); }}
        />
        <Upload className="w-8 h-8 text-ocean-60 mx-auto mb-2" />
        <p className="text-sm text-ocean-150">
          {file ? file.name : 'Arraste um arquivo CSV ou Excel'}
        </p>
        {file && (
          <p className="text-xs text-ocean-60 mt-1">
            {(file.size / 1024).toFixed(1)} KB
            <button
              onClick={(e) => { e.stopPropagation(); setFile(null); }}
              className="ml-2 text-rose hover:text-rose"
            >
              Remover
            </button>
          </p>
        )}
        {fileError && (
          <p className="text-xs text-rose mt-1">{fileError}</p>
        )}
      </div>

      {/* Config */}
      <div className="bg-white rounded-lg border border-ocean-30 p-4 space-y-3">
        <h3 className="text-sm font-medium text-ocean-150 uppercase tracking-wide">Configuracao</h3>

        <div>
          <label className="block text-sm text-ocean-150 mb-1">Subsidiaria</label>
          {subsLoading ? (
            <div className="flex items-center gap-2 px-3 py-2 border border-ocean-30 rounded-md text-sm text-ocean-60">
              <Loader2 className="w-3 h-3 animate-spin" />
              Carregando subsidiarias...
            </div>
          ) : subsidiaries.length > 0 ? (
            <select
              value={config.subsidiaryId}
              onChange={(e) => {
                const selected = subsidiaries.find((s) => s.id === e.target.value);
                setConfig((c) => ({
                  ...c,
                  subsidiaryId: e.target.value,
                  subsidiaryName: selected?.name || '',
                  currencyId: selected?.currencyId || c.currencyId,
                }));
              }}
              className="w-full px-3 py-2 border border-ocean-30 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ocean-120 focus:border-transparent"
            >
              <option value="">Selecione uma subsidiaria</option>
              {subsidiaries.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={config.subsidiaryName}
              onChange={(e) => setConfig((c) => ({ ...c, subsidiaryName: e.target.value }))}
              placeholder="Nome da subsidiaria no NetSuite"
              className="w-full px-3 py-2 border border-ocean-30 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ocean-120 focus:border-transparent"
            />
          )}
        </div>

        <div>
          <label className="block text-sm text-ocean-150 mb-1">Status do Cliente</label>
          {entityStatuses.length > 0 ? (
            <select
              value={config.entityStatusId}
              onChange={(e) => setConfig((c) => ({ ...c, entityStatusId: e.target.value }))}
              className="w-full px-3 py-2 border border-ocean-30 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ocean-120 focus:border-transparent"
            >
              <option value="">Selecione um status</option>
              {entityStatuses.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={config.entityStatusLabel}
              onChange={(e) => setConfig((c) => ({ ...c, entityStatusLabel: e.target.value }))}
              placeholder="Ex: Cliente - Closed Won"
              className="w-full px-3 py-2 border border-ocean-30 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ocean-120 focus:border-transparent"
            />
          )}
        </div>
      </div>

      {/* Processar */}
      <button
        onClick={onProcess}
        disabled={!file || !config.subsidiaryId || processing}
        className="w-full py-2 bg-ocean-120 text-white text-sm font-medium rounded-md hover:bg-ocean-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {processing ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Processando...
          </>
        ) : (
          'Processar Arquivo'
        )}
      </button>
    </div>
  );
}

// ── Etapa 2: Revisao ────────────────────────────────────────────────────────

function StepReview({ customers, setCustomers, columnMapping, headers, onBack, onImport }) {
  const totalPF = customers.filter((c) => c.isPerson).length;
  const totalPJ = customers.filter((c) => !c.isPerson).length;
  const withErrors = customers.filter((c) => c._errors.length > 0).length;

  function handleRemove(idx) {
    setCustomers((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleEdit(idx, field, value) {
    setCustomers((prev) => prev.map((c, i) => {
      if (i !== idx) return c;
      const updated = { ...c, [field]: value };
      if (field === 'custentity_brl_entity_t_fed_tax_reg') {
        const digits = (value || '').replace(/\D/g, '');
        updated.isPerson = digits.length === 11;
        if (updated.isPerson && updated.companyName) {
          const parts = updated.companyName.trim().split(/\s+/);
          updated.firstName = parts[0];
          updated.lastName = parts.slice(1).join(' ') || parts[0];
        }
        // Re-validar documento
        const docVal = validateDocument(value);
        updated._errors = (c._errors || []).filter((e) => !e.includes('invalido'));
        updated._docInvalid = false;
        if (value && !docVal.valid) {
          updated._errors.push(docVal.type
            ? `${docVal.type} invalido: ${value}`
            : `Documento invalido: ${value}`);
          updated._docInvalid = true;
        }
      }
      return updated;
    }));
  }

  return (
    <div className="space-y-3">
      {/* Stats */}
      <div className="bg-white rounded-lg border border-ocean-30 p-3 flex items-center justify-between text-xs">
        <span className="text-ocean-150">
          <strong>{customers.length}</strong> clientes
        </span>
        <span className="text-ocean-120">{totalPJ} PJ</span>
        <span className="text-ocean-120">{totalPF} PF</span>
        {withErrors > 0 && (
          <span className="text-rose flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            {withErrors} com erro
          </span>
        )}
      </div>

      {/* Tabela */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {customers.map((cust, idx) => (
          <div
            key={idx}
            className={`bg-white rounded-lg border p-3 text-xs ${
              cust._errors.length > 0 ? 'border-red-300' : 'border-ocean-30'
            }`}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-ocean-60">#{cust._rowIndex}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  cust.isPerson ? 'bg-ocean-10 text-ocean-120' : 'bg-ocean-10 text-ocean-150'
                }`}>
                  {cust.isPerson ? 'PF' : 'PJ'}
                </span>
              </div>
              <button onClick={() => handleRemove(idx)} className="text-rose hover:text-rose">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {cust._errors.length > 0 && (
              <div className="text-rose text-xs mb-2 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {cust._errors.join(', ')}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-ocean-60 mb-0.5">Razao Social</label>
                <input
                  value={cust.companyName || ''}
                  onChange={(e) => handleEdit(idx, 'companyName', e.target.value)}
                  className="w-full px-2 py-1 border border-ocean-30 rounded text-xs focus:outline-none focus:ring-1 focus:ring-ocean-120"
                />
              </div>
              <div>
                <label className="block text-ocean-60 mb-0.5">CNPJ/CPF</label>
                <input
                  value={cust.custentity_brl_entity_t_fed_tax_reg || ''}
                  onChange={(e) => handleEdit(idx, 'custentity_brl_entity_t_fed_tax_reg', e.target.value)}
                  className={`w-full px-2 py-1 border rounded text-xs focus:outline-none focus:ring-1 focus:ring-ocean-120 ${
                    cust._docInvalid ? 'border-red-400 bg-red-50' : 'border-ocean-30'
                  }`}
                />
              </div>
              <div>
                <label className="block text-ocean-60 mb-0.5">Email</label>
                <input
                  value={cust.email || ''}
                  onChange={(e) => handleEdit(idx, 'email', e.target.value)}
                  className="w-full px-2 py-1 border border-ocean-30 rounded text-xs focus:outline-none focus:ring-1 focus:ring-ocean-120"
                />
              </div>
              <div>
                <label className="block text-ocean-60 mb-0.5">Telefone</label>
                <input
                  value={cust.phone || ''}
                  onChange={(e) => handleEdit(idx, 'phone', e.target.value)}
                  className="w-full px-2 py-1 border border-ocean-30 rounded text-xs focus:outline-none focus:ring-1 focus:ring-ocean-120"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Botoes */}
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          className="flex-1 py-2 border border-ocean-30 text-ocean-150 text-sm rounded-md hover:bg-ocean-10 flex items-center justify-center gap-1"
        >
          Voltar
        </button>
        <button
          onClick={onImport}
          disabled={customers.length === 0}
          className="flex-1 py-2 bg-ocean-120 text-white text-sm font-medium rounded-md hover:bg-ocean-150 disabled:opacity-50 flex items-center justify-center gap-1"
        >
          Importar
        </button>
      </div>
    </div>
  );
}

// ── Etapa 3: Importacao ──────────────────────────────────────────────────────

function StepImport({ customers, onBack }) {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const totalPF = customers.filter((c) => c.isPerson).length;
  const totalPJ = customers.filter((c) => !c.isPerson).length;

  async function handleImport() {
    setImporting(true);
    try {
      const cleanCustomers = customers.map((c) => {
        const clean = { ...c };
        delete clean._rowIndex;
        delete clean._errors;
        return clean;
      });

      const res = await sendToBackground({
        type: 'CREATE_CUSTOMERS',
        data: {
          customers: cleanCustomers,
          subsidiaryId: customers[0]?.subsidiaryId,
        },
      });
      setResult(res);
    } catch (err) {
      setResult({ success: false, customersCreated: 0, errors: [{ name: 'Erro geral', error: err.message }] });
    } finally {
      setImporting(false);
    }
  }

  function handleExportCSV() {
    const fields = ['companyName', 'custentity_brl_entity_t_fed_tax_reg', 'isPerson', 'email', 'phone', 'entityId',
      'custentity_brl_entity_t_state_tx_reg', 'custentity_brl_entity_t_municip_tx_reg', 'addr1', 'city', 'state', 'zip'];
    const labels = ['Razao Social', 'CNPJ/CPF', 'PF/PJ', 'Email', 'Telefone', 'Codigo',
      'Inscricao Estadual', 'Inscricao Municipal', 'Endereco', 'Cidade', 'UF', 'CEP'];

    const rows = customers.map((c) =>
      fields.map((f) => {
        if (f === 'isPerson') return c.isPerson ? 'PF' : 'PJ';
        return (c[f] || '').toString().replace(/;/g, ',');
      })
    );

    const csv = [labels.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'clientes_import.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  return (
    <div className="space-y-4">
      {/* Resumo */}
      <div className="bg-white rounded-lg border border-ocean-30 p-4">
        <h3 className="text-sm font-medium text-ocean-150 mb-3">Resumo da Importacao</h3>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-ocean-10 rounded-lg p-3">
            <p className="text-lg font-bold text-ocean-180">{customers.length}</p>
            <p className="text-[10px] text-ocean-60">Total</p>
          </div>
          <div className="bg-ocean-10 rounded-lg p-3">
            <p className="text-lg font-bold text-ocean-150">{totalPJ}</p>
            <p className="text-[10px] text-ocean-60">PJ</p>
          </div>
          <div className="bg-ocean-10 rounded-lg p-3">
            <p className="text-lg font-bold text-ocean-120">{totalPF}</p>
            <p className="text-[10px] text-ocean-60">PF</p>
          </div>
        </div>
      </div>

      {/* Resultado */}
      {result && (
        <div className={`rounded-lg border p-4 ${
          result.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
        }`}>
          <div className="flex items-center gap-2 mb-2">
            {result.success ? (
              <CheckCircle className="w-5 h-5 text-pine" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose" />
            )}
            <span className={`text-sm font-medium ${result.success ? 'text-pine' : 'text-rose'}`}>
              {result.customersCreated || 0} clientes criados
              {result.errors?.length > 0 && ` | ${result.errors.length} erros`}
            </span>
          </div>

          {result.errors?.length > 0 && (
            <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
              {result.errors.slice(0, 15).map((err, i) => (
                <div key={i} className="text-xs text-rose bg-red-50 px-2 py-1 rounded">
                  <strong>{err.name || 'Linha ' + err.rowIndex}:</strong> {err.error}
                </div>
              ))}
              {result.errors.length > 15 && (
                <p className="text-xs text-rose">...e mais {result.errors.length - 15} erros</p>
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
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Importando...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Importar para NetSuite
              </>
            )}
          </button>
        )}

        <button
          onClick={handleExportCSV}
          className="w-full py-2 border border-ocean-30 text-ocean-150 text-sm rounded-md hover:bg-ocean-10 flex items-center justify-center gap-2"
        >
          <Download className="w-4 h-4" />
          Exportar CSV
        </button>

        <button
          onClick={onBack}
          className="w-full py-2 text-ocean-60 text-sm hover:text-ocean-150"
        >
          Voltar
        </button>
      </div>
    </div>
  );
}

// ── Componente Principal ─────────────────────────────────────────────────────

export default function CustomerImport() {
  const navigate = useNavigate();
  const [step, setStep] = useState('upload');

  const [subsidiaries, setSubsidiaries] = useState([]);
  const [subsLoading, setSubsLoading] = useState(false);
  const [entityStatuses, setEntityStatuses] = useState([]);

  const [file, setFile] = useState(null);
  const [config, setConfig] = useState({
    subsidiaryId: '',
    subsidiaryName: '',
    currencyId: '',
    entityStatusId: '',
    entityStatusLabel: 'Cliente - Closed Won',
  });
  const [processing, setProcessing] = useState(false);

  const [customers, setCustomers] = useState([]);
  const [columnMapping, setColumnMapping] = useState({});
  const [headers, setHeaders] = useState([]);

  useEffect(() => {
    async function fetchLookups() {
      setSubsLoading(true);
      try {
        const data = await sendToBackground({ type: 'FETCH_LOOKUP_DATA' });
        if (data?.subsidiaries?.length > 0) {
          setSubsidiaries(data.subsidiaries);
        }
      } catch {
        // fallback: campo texto
      } finally {
        setSubsLoading(false);
      }

      try {
        const custData = await sendToBackground({ type: 'CUSTOMER_LOOKUP_DATA' });
        if (custData?.entityStatuses?.length > 0) {
          setEntityStatuses(custData.entityStatuses);
          const defaultStatus = custData.entityStatuses.find((s) =>
            s.name.toLowerCase().includes('closed won') || s.name.toLowerCase().includes('cliente')
          );
          if (defaultStatus) {
            setConfig((c) => ({ ...c, entityStatusId: defaultStatus.id }));
          }
        }
      } catch {
        // fallback: campo texto
      }
    }
    fetchLookups();
  }, []);

  async function handleProcess() {
    setProcessing(true);
    try {
      const parsed = await parseExcelFile(file);
      const fileHeaders = parsed.headers[0] || [];
      const dataRows = parsed.rows.slice(1);

      const mapping = autoMapColumns(fileHeaders);
      setColumnMapping(mapping);
      setHeaders(fileHeaders);

      const mapped = transformCustomers(fileHeaders, dataRows, mapping, config);
      setCustomers(mapped);
      setStep('review');
    } catch (err) {
      alert('Erro ao processar arquivo: ' + err.message);
    } finally {
      setProcessing(false);
    }
  }

  const stepLabels = {
    upload: '1. Upload',
    review: '2. Revisao',
    import: '3. Importar',
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-ocean-150" />
          <h2 className="text-base font-medium text-ocean-180">Importar Clientes</h2>
        </div>
        <button
          onClick={() => navigate('/')}
          className="text-sm text-ocean-150 hover:text-ocean-180 flex items-center gap-1"
        >
          <ArrowLeft className="w-3 h-3" />
          Inicio
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
          file={file}
          setFile={setFile}
          config={config}
          setConfig={setConfig}
          onProcess={handleProcess}
          processing={processing}
          subsidiaries={subsidiaries}
          subsLoading={subsLoading}
          entityStatuses={entityStatuses}
        />
      )}

      {step === 'review' && (
        <StepReview
          customers={customers}
          setCustomers={setCustomers}
          columnMapping={columnMapping}
          headers={headers}
          onBack={() => setStep('upload')}
          onImport={() => setStep('import')}
        />
      )}

      {step === 'import' && (
        <StepImport
          customers={customers}
          onBack={() => setStep('review')}
        />
      )}
    </div>
  );
}
