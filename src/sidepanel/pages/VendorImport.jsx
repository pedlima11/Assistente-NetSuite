import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Loader2, Download, Truck,
  Trash2, AlertTriangle, CheckCircle, AlertCircle, Upload,
} from 'lucide-react';
import { parseExcelFile } from '../../parsers/excel-parser.js';
import { autoMapColumns, transformCustomers, getAvailableFields, validateDocument } from '../../services/customer-mapper.js';
import { sendToBackground } from '../../utils/api-client.js';

const ACCEPTED_EXTENSIONS = ['.csv', '.xls', '.xlsx'];

// ── Etapa 1: Upload + Config ────────────────────────────────────────────────

function StepUpload({ file, setFile, config, setConfig, onProcess, processing, subsidiaries, subsLoading }) {
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
        onClick={() => document.getElementById('vendor-file-input').click()}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          dragOver ? 'border-ocean-120 bg-ocean-10' : 'border-ocean-30 hover:border-ocean-120'
        }`}
      >
        <input
          id="vendor-file-input"
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

function StepReview({ vendors, setVendors, onBack, onImport }) {
  const totalPF = vendors.filter((v) => v.isPerson).length;
  const totalPJ = vendors.filter((v) => !v.isPerson).length;
  const withErrors = vendors.filter((v) => v._errors.length > 0).length;

  function handleRemove(idx) {
    setVendors((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleEdit(idx, field, value) {
    setVendors((prev) => prev.map((v, i) => {
      if (i !== idx) return v;
      const updated = { ...v, [field]: value };
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
        updated._errors = (v._errors || []).filter((e) => !e.includes('invalido'));
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
          <strong>{vendors.length}</strong> fornecedores
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

      {/* Cards */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {vendors.map((vend, idx) => (
          <div
            key={idx}
            className={`bg-white rounded-lg border p-3 text-xs ${
              vend._errors.length > 0 ? 'border-red-300' : 'border-ocean-30'
            }`}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-ocean-60">#{vend._rowIndex}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  vend.isPerson ? 'bg-ocean-10 text-ocean-120' : 'bg-ocean-10 text-ocean-150'
                }`}>
                  {vend.isPerson ? 'PF' : 'PJ'}
                </span>
              </div>
              <button onClick={() => handleRemove(idx)} className="text-rose hover:text-rose">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {vend._errors.length > 0 && (
              <div className="text-rose text-xs mb-2 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {vend._errors.join(', ')}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-ocean-60 mb-0.5">Razao Social</label>
                <input
                  value={vend.companyName || ''}
                  onChange={(e) => handleEdit(idx, 'companyName', e.target.value)}
                  className="w-full px-2 py-1 border border-ocean-30 rounded text-xs focus:outline-none focus:ring-1 focus:ring-ocean-120"
                />
              </div>
              <div>
                <label className="block text-ocean-60 mb-0.5">CNPJ/CPF</label>
                <input
                  value={vend.custentity_brl_entity_t_fed_tax_reg || ''}
                  onChange={(e) => handleEdit(idx, 'custentity_brl_entity_t_fed_tax_reg', e.target.value)}
                  className={`w-full px-2 py-1 border rounded text-xs focus:outline-none focus:ring-1 focus:ring-ocean-120 ${
                    vend._docInvalid ? 'border-red-400 bg-red-50' : 'border-ocean-30'
                  }`}
                />
              </div>
              <div>
                <label className="block text-ocean-60 mb-0.5">Email</label>
                <input
                  value={vend.email || ''}
                  onChange={(e) => handleEdit(idx, 'email', e.target.value)}
                  className="w-full px-2 py-1 border border-ocean-30 rounded text-xs focus:outline-none focus:ring-1 focus:ring-ocean-120"
                />
              </div>
              <div>
                <label className="block text-ocean-60 mb-0.5">Telefone</label>
                <input
                  value={vend.phone || ''}
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
          disabled={vendors.length === 0}
          className="flex-1 py-2 bg-ocean-120 text-white text-sm font-medium rounded-md hover:bg-ocean-150 disabled:opacity-50 flex items-center justify-center gap-1"
        >
          Importar
        </button>
      </div>
    </div>
  );
}

// ── Etapa 3: Importacao ──────────────────────────────────────────────────────

function StepImport({ vendors, onBack }) {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const totalPF = vendors.filter((v) => v.isPerson).length;
  const totalPJ = vendors.filter((v) => !v.isPerson).length;

  async function handleImport() {
    setImporting(true);
    try {
      const cleanVendors = vendors.map((v) => {
        const clean = { ...v };
        delete clean._rowIndex;
        delete clean._errors;
        delete clean._docInvalid;
        delete clean.entityStatusId;
        return clean;
      });

      const res = await sendToBackground({
        type: 'CREATE_VENDORS',
        data: {
          vendors: cleanVendors,
          subsidiaryId: vendors[0]?.subsidiaryId,
        },
      });
      setResult(res);
    } catch (err) {
      setResult({ success: false, vendorsCreated: 0, errors: [{ name: 'Erro geral', error: err.message }] });
    } finally {
      setImporting(false);
    }
  }

  function handleExportCSV() {
    const fields = ['companyName', 'custentity_brl_entity_t_fed_tax_reg', 'isPerson', 'email', 'phone', 'entityId',
      'custentity_brl_entity_t_state_tx_reg', 'custentity_brl_entity_t_municip_tx_reg', 'addr1', 'city', 'state', 'zip'];
    const labels = ['Razao Social', 'CNPJ/CPF', 'PF/PJ', 'Email', 'Telefone', 'Codigo',
      'Inscricao Estadual', 'Inscricao Municipal', 'Endereco', 'Cidade', 'UF', 'CEP'];

    const rows = vendors.map((v) =>
      fields.map((f) => {
        if (f === 'isPerson') return v.isPerson ? 'PF' : 'PJ';
        return (v[f] || '').toString().replace(/;/g, ',');
      })
    );

    const csv = [labels.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fornecedores_import.csv';
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
            <p className="text-lg font-bold text-ocean-180">{vendors.length}</p>
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
              {result.vendorsCreated || 0} fornecedores criados
              {result.errors?.length > 0 && ` | ${result.errors.length} erros`}
            </span>
          </div>

          {result.errors?.length > 0 && (
            <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
              {result.errors.slice(0, 15).map((err, i) => (
                <div key={i} className="text-xs text-rose bg-red-100 px-2 py-1 rounded">
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
            className="w-full py-2 bg-pine text-white text-sm font-medium rounded-md hover:bg-pine disabled:opacity-50 flex items-center justify-center gap-2"
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

export default function VendorImport() {
  const navigate = useNavigate();
  const [step, setStep] = useState('upload');

  const [subsidiaries, setSubsidiaries] = useState([]);
  const [subsLoading, setSubsLoading] = useState(false);

  const [file, setFile] = useState(null);
  const [config, setConfig] = useState({
    subsidiaryId: '',
    subsidiaryName: '',
    currencyId: '',
  });
  const [processing, setProcessing] = useState(false);

  const [vendors, setVendors] = useState([]);
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
      setVendors(mapped);
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
          <Truck className="w-5 h-5 text-ocean-150" />
          <h2 className="text-base font-medium text-ocean-180">Importar Fornecedores</h2>
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
        />
      )}

      {step === 'review' && (
        <StepReview
          vendors={vendors}
          setVendors={setVendors}
          onBack={() => setStep('upload')}
          onImport={() => setStep('import')}
        />
      )}

      {step === 'import' && (
        <StepImport
          vendors={vendors}
          onBack={() => setStep('review')}
        />
      )}
    </div>
  );
}
