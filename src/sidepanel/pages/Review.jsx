import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, AlertTriangle, Loader2, Building2, Plus, List } from 'lucide-react';
import SubsidiaryPreview from '../components/SubsidiaryPreview.jsx';
import ChartOfAccountsPreview from '../components/ChartOfAccountsPreview.jsx';
import { ChartOfAccountsMapper } from '../../services/coa-mapper.js';
import { sendToBackground } from '../../utils/chrome-messaging.js';
import { MessageType } from '../../types/messages.js';

export default function Review() {
  const navigate = useNavigate();
  const [subsidiary, setSubsidiary] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [validationErrors, setValidationErrors] = useState([]);

  // Subsidiary mode: 'create' (nova) ou 'existing' (selecionar existente)
  const [mode, setMode] = useState('create');
  const [existingSubsidiaries, setExistingSubsidiaries] = useState([]);
  const [selectedSubsidiaryId, setSelectedSubsidiaryId] = useState('');
  const [loadingSubs, setLoadingSubs] = useState(false);
  const [lookupData, setLookupData] = useState(null);
  const [loadingLookup, setLoadingLookup] = useState(true);

  useEffect(() => {
    const raw = sessionStorage.getItem('reviewData');
    if (!raw) {
      navigate('/upload');
      return;
    }

    try {
      const data = JSON.parse(raw);
      setSubsidiary(data.subsidiary);

      const mapped = ChartOfAccountsMapper.mapAccounts(data.accounts);
      const sorted = ChartOfAccountsMapper.topologicalSort(mapped);
      setAccounts(sorted);
    } catch {
      navigate('/upload');
    }

    // Carregar dados de referencia do NetSuite via RESTlet
    fetchLookupData();
  }, [navigate]);

  const [lookupError, setLookupError] = useState(null);

  async function fetchLookupData() {
    setLoadingLookup(true);
    setLookupError(null);
    try {
      const data = await sendToBackground({ type: 'FETCH_LOOKUP_DATA' });
      console.log('lookupData recebido:', JSON.stringify(data));
      setLookupData(data);
      if (data.subsidiaries) {
        setExistingSubsidiaries(data.subsidiaries);
        if (data.subsidiaries.length > 0) {
          setSelectedSubsidiaryId(data.subsidiaries[0].id);
        }
      }
    } catch (err) {
      console.error('Erro ao carregar dados de referencia:', err);
      setLookupError(err.message);
    } finally {
      setLoadingLookup(false);
    }
  }

  async function loadSubsidiaries() {
    setLoadingSubs(true);
    try {
      const result = await sendToBackground({
        type: MessageType.NETSUITE_API_REQUEST,
        method: 'GET',
        endpoint: '/subsidiary',
      });

      if (result && result.items) {
        setExistingSubsidiaries(result.items);
        if (result.items.length > 0) {
          setSelectedSubsidiaryId(result.items[0].id);
        }
      } else if (result && result.id) {
        setExistingSubsidiaries([result]);
        setSelectedSubsidiaryId(result.id);
      }
    } catch (err) {
      console.error('Erro ao carregar subsidiaries:', err);
    } finally {
      setLoadingSubs(false);
    }
  }

  function handleModeChange(newMode) {
    setMode(newMode);
    if (newMode === 'existing' && existingSubsidiaries.length === 0) {
      loadSubsidiaries();
    }
  }

  useEffect(() => {
    if (accounts.length > 0) {
      const result = ChartOfAccountsMapper.validate(accounts);
      setValidationErrors(result.errors);
    }
  }, [accounts]);

  function handleCreateInNetSuite() {
    if (mode === 'existing' && !selectedSubsidiaryId) {
      alert('Selecione uma subsidiary antes de continuar');
      return;
    }

    sessionStorage.setItem('createData', JSON.stringify({
      subsidiary,
      accounts,
      subsidiaryId: mode === 'existing' ? selectedSubsidiaryId : null,
      createSubsidiary: mode === 'create',
    }));
    navigate('/status');
  }

  if (!subsidiary) return null;

  return (
    <div className="max-w-md mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium text-ocean-180">Revisao dos Dados</h2>
        <button
          onClick={() => navigate('/upload')}
          className="text-sm text-ocean-150 hover:text-ocean-180 flex items-center gap-1"
        >
          <ArrowLeft className="w-3 h-3" />
          Voltar
        </button>
      </div>

      {/* Modo de subsidiary */}
      <div className="bg-white rounded-lg border border-ocean-30 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Building2 className="w-5 h-5 text-ocean-120" />
          <h3 className="text-sm font-medium text-ocean-180">Subsidiary</h3>
        </div>

        <div className="flex gap-2 mb-3">
          <button
            onClick={() => handleModeChange('create')}
            className={`flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              mode === 'create'
                ? 'bg-ocean-120 text-white'
                : 'bg-ocean-10 text-ocean-150 hover:bg-ocean-30'
            }`}
          >
            <Plus className="w-3 h-3" />
            Criar Nova
          </button>
          <button
            onClick={() => handleModeChange('existing')}
            className={`flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              mode === 'existing'
                ? 'bg-ocean-120 text-white'
                : 'bg-ocean-10 text-ocean-150 hover:bg-ocean-30'
            }`}
          >
            <List className="w-3 h-3" />
            Usar Existente
          </button>
        </div>

        {mode === 'existing' && (
          <>
            {loadingSubs ? (
              <div className="flex items-center gap-2 text-sm text-ocean-150">
                <Loader2 className="w-4 h-4 animate-spin" />
                Carregando subsidiaries...
              </div>
            ) : existingSubsidiaries.length === 0 ? (
              <p className="text-sm text-rose">
                Nenhuma subsidiary encontrada.
              </p>
            ) : (
              <select
                value={selectedSubsidiaryId}
                onChange={(e) => setSelectedSubsidiaryId(e.target.value)}
                className="w-full px-3 py-2 border border-ocean-30 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ocean-120"
              >
                {existingSubsidiaries.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.id} - {sub.name || 'Subsidiary'}
                  </option>
                ))}
              </select>
            )}
          </>
        )}

        {mode === 'create' && (
          <p className="text-xs text-ocean-150">
            Sera criada via RESTlet. Verifique se a URL do RESTlet esta configurada em Configuracoes.
          </p>
        )}
      </div>

      {/* Preview da subsidiary (editavel) - so mostra no modo criar */}
      {mode === 'create' && (
        loadingLookup ? (
          <div className="flex items-center gap-2 text-sm text-ocean-150 bg-white rounded-lg border border-ocean-30 p-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            Carregando dados do NetSuite...
          </div>
        ) : (
          <>
            {lookupError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-rose">
                <strong>Erro ao carregar listas:</strong> {lookupError}
              </div>
            )}
            {lookupData && (
              <div className="bg-ocean-10 border border-ocean-30 rounded-lg p-2 text-xs text-ocean-120">
                Listas: Subs={lookupData.subsidiaries?.length || 0}, Moedas={lookupData.currencies?.length || 0}, CalFisc={lookupData.fiscalCalendars?.length || 0}, Cidades={lookupData.brCities?.length || 0}, Estados={lookupData.brStates?.length || 0}
              </div>
            )}
            <SubsidiaryPreview subsidiary={subsidiary} onChange={setSubsidiary} lookupData={lookupData} />
          </>
        )
      )}

      <ChartOfAccountsPreview accounts={accounts} onChange={setAccounts} />

      {validationErrors.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-golden" />
            <span className="text-sm font-medium text-golden">Avisos de Validacao</span>
          </div>
          <ul className="text-xs text-golden space-y-1">
            {validationErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      <button
        onClick={handleCreateInNetSuite}
        disabled={mode === 'existing' && (!selectedSubsidiaryId || loadingSubs)}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-pine text-white rounded-md text-sm font-medium hover:bg-ocean-180 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <ArrowRight className="w-4 h-4" />
        {mode === 'create' ? 'Criar Subsidiary + Contas' : 'Criar Contas no NetSuite'}
      </button>
    </div>
  );
}
