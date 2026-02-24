import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { sendToBackground } from '../../utils/chrome-messaging.js';
import { Settings as SettingsIcon, Save, CheckCircle, AlertCircle, ArrowLeft } from 'lucide-react';

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

  const fields = [
    { key: 'netsuiteAccountId', label: 'Account ID', placeholder: 'TSTDRV1234567' },
    { key: 'consumerKey', label: 'Consumer Key', placeholder: '' },
    { key: 'consumerSecret', label: 'Consumer Secret', placeholder: '', type: 'password' },
    { key: 'tokenId', label: 'Token ID', placeholder: '' },
    { key: 'tokenSecret', label: 'Token Secret', placeholder: '', type: 'password' },
    { key: 'claudeApiKey', label: 'Claude API Key', placeholder: 'sk-ant-...', type: 'password' },
  ];

  return (
    <div className="max-w-md mx-auto">
      <div className="flex items-center justify-between mb-4">
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

      <form onSubmit={handleSave} className="space-y-3">
        <div className="bg-white rounded-lg border border-ocean-30 p-4 space-y-3">
          <h3 className="text-sm font-medium text-ocean-150 uppercase tracking-wide">NetSuite OAuth 1.0</h3>
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

        <div className="bg-white rounded-lg border border-ocean-30 p-4 space-y-3">
          <h3 className="text-sm font-medium text-ocean-150 uppercase tracking-wide">Claude API</h3>
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

        <div className="bg-white rounded-lg border border-ocean-30 p-4 space-y-3">
          <h3 className="text-sm font-medium text-ocean-150 uppercase tracking-wide">RESTlet (Opcional)</h3>
          <div>
            <label className="block text-sm text-ocean-150 mb-1">URL do RESTlet (criar subsidiary)</label>
            <input
              type="text"
              value={credentials.restletUrl}
              onChange={(e) => handleChange('restletUrl', e.target.value)}
              placeholder="https://td3052334.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=XXX&deploy=1"
              className="w-full px-3 py-2 border border-ocean-30 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ocean-120 focus:border-transparent"
            />
            <p className="text-xs text-ocean-60 mt-1">
              Necessario para criar subsidiaries. Veja suitescripts/rl_create_subsidiary.js
            </p>
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
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-ocean-120 text-white rounded-md text-sm font-medium hover:bg-ocean-180 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Save className="w-4 h-4" />
          {status === 'saving' ? 'Salvando...' : 'Salvar e Continuar'}
        </button>
      </form>
    </div>
  );
}
