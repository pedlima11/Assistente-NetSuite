import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { sendToBackground } from '../../utils/api-client.js';
import { Settings as SettingsIcon, Save, CheckCircle, AlertCircle, ArrowLeft, Search, Loader2 } from 'lucide-react';

export default function Settings() {
  const navigate = useNavigate();
  const [credentials, setCredentials] = useState({
    netsuiteAccountId: '',
    consumerKey: '',
    consumerSecret: '',
    tokenId: '',
    tokenSecret: '',
    claudeApiKey: '',
    restletUrl: '',
  });
  const [status, setStatus] = useState(null); // 'saving' | 'saved' | 'error'
  const [errorMsg, setErrorMsg] = useState('');
  const [discoveryStatus, setDiscoveryStatus] = useState(null); // 'loading' | 'done' | 'error'
  const [discoveryResult, setDiscoveryResult] = useState(null);

  useEffect(() => {
    loadCredentials();
  }, []);

  async function loadCredentials() {
    try {
      const saved = await sendToBackground({ type: 'GET_CREDENTIALS' });
      if (saved && saved.netsuiteAccountId) {
        setCredentials(saved);
      }
    } catch {
      // Sem credenciais salvas
    }
  }

  function handleChange(field, value) {
    setCredentials((prev) => ({ ...prev, [field]: value }));
    setStatus(null);
  }

  async function handleSave(e) {
    e.preventDefault();
    setStatus('saving');
    setErrorMsg('');

    try {
      // Validar campos obrigatorios
      const required = ['netsuiteAccountId', 'consumerKey', 'consumerSecret', 'tokenId', 'tokenSecret', 'claudeApiKey'];
      const missing = required.filter((f) => !credentials[f].trim());
      if (missing.length > 0) {
        throw new Error(`Campos obrigatorios: ${missing.join(', ')}`);
      }

      await sendToBackground({ type: 'SAVE_CREDENTIALS', data: credentials });
      setStatus('saved');

      // Navegar para home apos salvar
      setTimeout(() => navigate('/'), 1000);
    } catch (error) {
      setStatus('error');
      setErrorMsg(error.message);
    }
  }

  async function handleTaxDiscovery(action = 'taxDiscovery') {
    setDiscoveryStatus('loading');
    setDiscoveryResult(null);
    try {
      const result = await sendToBackground({ type: 'TAX_DISCOVERY', action });
      if (result.error) throw new Error(result.error);
      setDiscoveryResult(result);
      setDiscoveryStatus('done');
    } catch (err) {
      setDiscoveryStatus('error');
      setErrorMsg(err.message);
    }
  }

  const fields = [
    { key: 'netsuiteAccountId', label: 'Account ID', placeholder: 'TSTDRV1234567' },
    { key: 'consumerKey', label: 'Consumer Key', placeholder: '' },
    { key: 'consumerSecret', label: 'Consumer Secret', placeholder: '', type: 'password' },
    { key: 'tokenId', label: 'Token ID', placeholder: '' },
    { key: 'tokenSecret', label: 'Token Secret', placeholder: '', type: 'password' },
    { key: 'claudeApiKey', label: 'Claude API Key', placeholder: 'sk-ant-...', type: 'password' },
  ];

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SettingsIcon className="w-5 h-5 text-ocean-150" />
          <h2 className="text-base font-medium text-ocean-180">Configuracoes</h2>
        </div>
        <button
          onClick={() => navigate('/')}
          className="text-sm text-ocean-150 hover:text-ocean-180 flex items-center gap-1"
        >
          <ArrowLeft className="w-3 h-3" />
          Inicio
        </button>
      </div>

      <form onSubmit={handleSave} className="space-y-4">
        <div className="bg-white rounded-lg border border-ocean-30 p-4">
          <h3 className="text-sm font-medium text-ocean-150 uppercase tracking-wide mb-4">NetSuite OAuth 1.0</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {fields.slice(0, 5).map((field) => (
              <div key={field.key}>
                <label className="block text-sm text-ocean-150 mb-1">{field.label}</label>
                <input
                  type={field.type || 'text'}
                  value={credentials[field.key]}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="w-full px-3 py-2 border border-ocean-30 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ocean-120 focus:border-transparent"
                />
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-lg border border-ocean-30 p-4">
            <h3 className="text-sm font-medium text-ocean-150 uppercase tracking-wide mb-4">Claude API</h3>
            <div>
              <label className="block text-sm text-ocean-150 mb-1">API Key</label>
              <input
                type="password"
                value={credentials.claudeApiKey}
                onChange={(e) => handleChange('claudeApiKey', e.target.value)}
                placeholder="sk-ant-..."
                className="w-full px-3 py-2 border border-ocean-30 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ocean-120 focus:border-transparent"
              />
            </div>
          </div>

          <div className="bg-white rounded-lg border border-ocean-30 p-4">
            <h3 className="text-sm font-medium text-ocean-150 uppercase tracking-wide mb-4">RESTlet (Opcional)</h3>
            <div>
              <label className="block text-sm text-ocean-150 mb-1">URL do RESTlet</label>
              <input
                type="text"
                value={credentials.restletUrl}
                onChange={(e) => handleChange('restletUrl', e.target.value)}
                placeholder="https://...restlets.api.netsuite.com/..."
                className="w-full px-3 py-2 border border-ocean-30 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ocean-120 focus:border-transparent"
              />
              <p className="text-xs text-ocean-60 mt-1">
                Necessario para criar subsidiaries.
              </p>
            </div>
          </div>
        </div>

        {status === 'error' && (
          <div className="flex items-center gap-2 text-rose text-sm">
            <AlertCircle className="w-4 h-4" />
            <span>{errorMsg}</span>
          </div>
        )}

        {status === 'saved' && (
          <div className="flex items-center gap-2 text-pine text-sm">
            <CheckCircle className="w-4 h-4" />
            <span>Credenciais salvas com sucesso</span>
          </div>
        )}

        <button
          type="submit"
          disabled={status === 'saving'}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-ocean-120 text-white rounded-md text-sm font-medium hover:bg-ocean-150 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Save className="w-4 h-4" />
          {status === 'saving' ? 'Salvando...' : 'Salvar e Continuar'}
        </button>
      </form>

      {/* Tax Discovery */}
      <div className="mt-4 bg-white rounded-lg border border-ocean-30 p-4 space-y-3">
        <h3 className="text-sm font-medium text-ocean-150 uppercase tracking-wide">Tax Discovery</h3>
        <p className="text-xs text-ocean-60">Consulta registros fiscais configurados no NetSuite.</p>
        <div className="flex gap-2">
          <button
            onClick={() => handleTaxDiscovery('taxDiscovery')}
            disabled={discoveryStatus === 'loading' || !credentials.restletUrl}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-ocean-150 text-white rounded-md text-xs font-medium hover:bg-ocean-180 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {discoveryStatus === 'loading' ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Search className="w-3 h-3" />
            )}
            Geral
          </button>
          <button
            onClick={() => handleTaxDiscovery('taxDiscoveryFTE')}
            disabled={discoveryStatus === 'loading' || !credentials.restletUrl}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-ocean-120 text-white rounded-md text-xs font-medium hover:bg-ocean-180 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {discoveryStatus === 'loading' ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Search className="w-3 h-3" />
            )}
            FTE (Conteudo)
          </button>
        </div>

        {discoveryStatus === 'error' && (
          <div className="flex items-center gap-2 text-rose text-sm">
            <AlertCircle className="w-4 h-4" />
            <span>{errorMsg}</span>
          </div>
        )}

        {discoveryResult && discoveryResult._summary && (
          <div className="space-y-2">
            <div className="bg-ocean-10 rounded p-3 text-xs space-y-1">
              <p className="font-medium text-ocean-180">Resumo:</p>
              {Object.entries(discoveryResult._summary).map(([key, count]) => (
                <p key={key} className="text-ocean-150">
                  {key}: <span className="font-medium text-ocean-180">{count}</span>
                </p>
              ))}
            </div>
            <details className="text-xs">
              <summary className="cursor-pointer text-ocean-120 hover:text-ocean-180 font-medium">
                Ver JSON completo
              </summary>
              <pre className="mt-2 bg-gray-50 rounded p-2 overflow-auto max-h-96 text-ocean-150 whitespace-pre-wrap break-words">
                {JSON.stringify(discoveryResult, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
