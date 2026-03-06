import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, Loader2, Building2, Plus, List } from 'lucide-react';
import SubsidiaryBuilder from '../components/SubsidiaryBuilder.jsx';
import CoaModeler from '../components/CoaModeler.jsx';
import { sendToBackground } from '../../utils/api-client.js';
import { MessageType } from '../../types/messages.js';
import { computeImportKey } from '../../utils/progress-store.js';

export default function Review() {
  const { t } = useTranslation('review');
  const navigate = useNavigate();
  const [initialSubsidiary, setInitialSubsidiary] = useState(null);
  const [subsidiaryNodes, setSubsidiaryNodes] = useState([]);
  const [nodesValid, setNodesValid] = useState(false);
  const [rawAccounts, setRawAccounts] = useState([]);
  const [exportedAccounts, setExportedAccounts] = useState([]);
  const [coaReady, setCoaReady] = useState(false);

  // Subsidiary mode: 'create' (nova) ou 'existing' (selecionar existente)
  const [mode, setMode] = useState('create');
  const [existingSubsidiaries, setExistingSubsidiaries] = useState([]);
  const [selectedSubsidiaryId, setSelectedSubsidiaryId] = useState('');
  const [loadingSubs, setLoadingSubs] = useState(false);
  const [lookupData, setLookupData] = useState(null);
  const [loadingLookup, setLoadingLookup] = useState(true);
  const [existingAccounts, setExistingAccounts] = useState(new Map());

  // Flag: modo subsidiary-only (sem plano de contas)
  const [subsidiaryOnly, setSubsidiaryOnly] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem('reviewData');
    const isSubsidiaryOnly = sessionStorage.getItem('subsidiaryOnly') === 'true';

    if (!raw && isSubsidiaryOnly) {
      setSubsidiaryOnly(true);
      setInitialSubsidiary({ name: '', cnpj: '', ie: '', address: '', addressNumber: '', city: '', state: '', zipCode: '' });
      setRawAccounts([]);
    } else if (!raw) {
      navigate('/upload');
      return;
    } else {
      try {
        const data = JSON.parse(raw);
        setInitialSubsidiary(data.subsidiary);
        setRawAccounts(data.accounts || []);
      } catch {
        navigate('/upload');
        return;
      }
    }

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

      // Buscar contas existentes no NetSuite
      try {
        const acctResult = await sendToBackground({
          type: 'SUITEQL_QUERY',
          sql: `SELECT id, acctnumber, acctname FROM account WHERE isinactive = 'F'`,
          limit: 5000,
        });
        if (acctResult?.items?.length > 0) {
          const map = new Map();
          acctResult.items.forEach((r) => {
            if (r.acctnumber) map.set(r.acctnumber, r);
          });
          setExistingAccounts(map);
        }
      } catch (acctErr) {
        console.warn('Nao foi possivel buscar contas existentes:', acctErr.message);
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

  const handleAccountsReady = useCallback((accts, isValid) => {
    setExportedAccounts(accts);
    setCoaReady(isValid);
  }, []);

  function handleNodesChange(nodes, isValid) {
    setSubsidiaryNodes(nodes);
    setNodesValid(isValid);
  }

  function handleProceed() {
    if (mode === 'existing' && !selectedSubsidiaryId) {
      alert(t('selectSubsidiaryFirst'));
      return;
    }
    setShowConfirm(true);
  }

  function handleConfirmCreate() {
    const existingAccountsObj = Object.fromEntries(existingAccounts);
    const importKey = exportedAccounts.length > 0 ? computeImportKey(exportedAccounts) : '';
    sessionStorage.setItem('createData', JSON.stringify({
      subsidiaryNodes: mode === 'create' ? subsidiaryNodes : null,
      accounts: exportedAccounts,
      subsidiaryId: mode === 'existing' ? selectedSubsidiaryId : null,
      createSubsidiary: mode === 'create',
      existingAccounts: existingAccountsObj,
      importKey,
    }));
    sessionStorage.removeItem('subsidiaryOnly');
    navigate('/status');
  }

  // Contagem de acoes para o modal de confirmacao
  const confirmCounts = React.useMemo(() => {
    const toCreate = exportedAccounts.filter((a) => !a._action || a._action === 'create').length;
    const toUpdate = exportedAccounts.filter((a) => a._action === 'update').length;
    const toSkip = exportedAccounts.filter((a) => a._action === 'skip').length;
    return { toCreate, toUpdate, toSkip };
  }, [exportedAccounts]);

  if (!initialSubsidiary) return null;

  const hasAccounts = rawAccounts.length > 0;
  const createDisabled = mode === 'create'
    ? (!nodesValid || (hasAccounts && !coaReady))
    : (!selectedSubsidiaryId || loadingSubs || (hasAccounts && !coaReady));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium text-ocean-180">{t('title')}</h2>
        <button
          onClick={() => navigate(subsidiaryOnly ? '/' : '/upload')}
          className="text-sm text-ocean-150 hover:text-ocean-180 flex items-center gap-1"
        >
          <ArrowLeft className="w-3 h-3" />
          {t('back')}
        </button>
      </div>

      {/* Modo de subsidiary — toggle Criar Nova / Usar Existente */}
      {!subsidiaryOnly && (
        <div className="bg-white rounded-lg border border-ocean-30 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="w-5 h-5 text-ocean-120" />
            <h3 className="text-sm font-medium text-ocean-180">{t('subsidiary')}</h3>
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
              {t('createNew')}
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
              {t('useExisting')}
            </button>
          </div>

          {mode === 'existing' && (
            <>
              {loadingSubs ? (
                <div className="flex items-center gap-2 text-sm text-ocean-150">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('loadingSubsidiaries')}
                </div>
              ) : existingSubsidiaries.length === 0 ? (
                <p className="text-sm text-rose">{t('noSubsidiaryFound')}</p>
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
        </div>
      )}

      {/* Visual Subsidiary Builder — modo criar */}
      {mode === 'create' && (
        loadingLookup ? (
          <div className="flex items-center gap-2 text-sm text-ocean-150 bg-white rounded-lg border border-ocean-30 p-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t('loadingNetSuiteData')}
          </div>
        ) : (
          <>
            {lookupError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-rose">
                <strong>{t('errorLoadingLists')}</strong> {lookupError}
              </div>
            )}
            <SubsidiaryBuilder
              initialSubsidiary={initialSubsidiary}
              lookupData={lookupData}
              onNodesChange={handleNodesChange}
            />
          </>
        )
      )}

      {rawAccounts.length > 0 && (
        <CoaModeler
          rawAccounts={rawAccounts}
          existingAccounts={existingAccounts}
          onAccountsReady={handleAccountsReady}
        />
      )}

      <button
        onClick={handleProceed}
        disabled={createDisabled}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-pine text-white rounded-md text-sm font-medium hover:bg-ocean-180 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <ArrowRight className="w-4 h-4" />
        {mode === 'create'
          ? (hasAccounts ? t('createSubsidiariesAndAccounts') : t('createSubsidiaries'))
          : t('createAccountsInNetSuite')}
      </button>

      {/* Modal de confirmacao pre-criacao */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg border border-ocean-30 p-5 max-w-sm w-full mx-4 shadow-lg">
            <h3 className="text-sm font-medium text-ocean-180 mb-3">{t('confirmImport')}</h3>

            <div className="space-y-2 text-sm text-ocean-150 mb-4">
              <p className="font-medium text-ocean-180">
                {mode === 'create' ? t('createNewSubsidiary') : t('existingSubsidiary', { id: selectedSubsidiaryId })}
              </p>

              {hasAccounts && (
                <div className="space-y-1 text-xs">
                  {confirmCounts.toCreate > 0 && (
                    <p className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-pine flex-shrink-0" />
                      {t('accountsToCreate', { count: confirmCounts.toCreate })}
                    </p>
                  )}
                  {confirmCounts.toUpdate > 0 && (
                    <p className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-golden flex-shrink-0" />
                      {t('accountsToUpdate', { count: confirmCounts.toUpdate })}
                    </p>
                  )}
                  {confirmCounts.toSkip > 0 && (
                    <p className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-ocean-60 flex-shrink-0" />
                      {t('accountsToSkip', { count: confirmCounts.toSkip })}
                    </p>
                  )}
                </div>
              )}

              {!hasAccounts && (
                <p className="text-xs text-ocean-60">{t('subsidiaryOnlyMode')}</p>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 px-3 py-2 text-sm border border-ocean-30 rounded-md text-ocean-150 hover:bg-ocean-10"
              >
                {t('back')}
              </button>
              <button
                onClick={handleConfirmCreate}
                className="flex-1 px-3 py-2 text-sm bg-pine text-white rounded-md font-medium hover:bg-ocean-180"
              >
                {t('confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
