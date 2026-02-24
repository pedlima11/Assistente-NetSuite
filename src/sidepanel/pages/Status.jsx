import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Loader2, RotateCcw, ArrowLeft, Trash2 } from 'lucide-react';
import { sendToBackground } from '../../utils/chrome-messaging.js';
import { ProgressStore } from '../../utils/progress-store.js';
import { ChartOfAccountsMapper } from '../../services/coa-mapper.js';
import { MessageType } from '../../types/messages.js';

export default function Status() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState('idle');
  const [subsidiaryResult, setSubsidiaryResult] = useState(null);
  const [accountsProgress, setAccountsProgress] = useState({ created: 0, total: 0 });
  const [errors, setErrors] = useState([]);
  const [currentAccount, setCurrentAccount] = useState('');
  const [resuming, setResuming] = useState(false);
  const [debugLog, setDebugLog] = useState([]);

  function addLog(msg) {
    console.log('[NetSuite Assistant]', msg);
    setDebugLog((prev) => [...prev, `${new Date().toLocaleTimeString()} - ${msg}`]);
  }

  const startCreation = useCallback(async () => {
    const raw = sessionStorage.getItem('createData');
    if (!raw) {
      navigate('/review');
      return;
    }

    const { subsidiary, accounts, subsidiaryId, createSubsidiary } = JSON.parse(raw);

    // Verificar checkpoint existente
    const existingProgress = await ProgressStore.load();

    try {
      let effectiveSubsidiaryId = subsidiaryId;

      // Retomar operacao incompleta
      if (existingProgress && existingProgress.subsidiaryId) {
        effectiveSubsidiaryId = existingProgress.subsidiaryId;
        setSubsidiaryResult({ internalId: effectiveSubsidiaryId });
        setResuming(true);
        addLog(`Retomando com subsidiary: ${effectiveSubsidiaryId}`);
      }
      // Criar nova subsidiary via RESTlet
      else if (createSubsidiary) {
        await ProgressStore.clear();
        setPhase('subsidiary');
        addLog(`Criando subsidiary via RESTlet: ${subsidiary.name}`);
        addLog(`Payload: address=${subsidiary.address || '(vazio)'}, num=${subsidiary.addressNumber || '(vazio)'}, city=${subsidiary.brCityId || '(vazio)'}, state=${subsidiary.state || '(vazio)'}`);

        const result = await sendToBackground({
          type: MessageType.CREATE_SUBSIDIARY,
          data: subsidiary,
        });

        addLog(`Resposta RESTlet: ${JSON.stringify(result)}`);

        if (!result.success || !result.internalId) {
          throw new Error(
            result.error || `Falha ao criar subsidiary. Resposta: ${JSON.stringify(result)}`
          );
        }

        effectiveSubsidiaryId = result.internalId;
        setSubsidiaryResult({ internalId: effectiveSubsidiaryId, name: subsidiary.name });
        addLog(`Subsidiary criada com sucesso! ID: ${effectiveSubsidiaryId}`);
      }
      // Usar subsidiary existente
      else if (effectiveSubsidiaryId) {
        await ProgressStore.clear();
        setSubsidiaryResult({ internalId: effectiveSubsidiaryId });
        addLog(`Usando subsidiary existente: ${effectiveSubsidiaryId}`);
      } else {
        throw new Error('Nenhuma subsidiary definida. Volte para a tela de revisao.');
      }

      // Criar contas vinculadas a subsidiary
      setPhase('accounts');
      const sorted = ChartOfAccountsMapper.topologicalSort(accounts);
      setAccountsProgress({ created: 0, total: sorted.length });
      addLog(`Criando ${sorted.length} contas vinculadas a subsidiary ${effectiveSubsidiaryId}...`);

      const batchResult = await ChartOfAccountsMapper.createAccountsBatch(
        sorted,
        effectiveSubsidiaryId,
        (created, total, account) => {
          setAccountsProgress({ created, total });
          setCurrentAccount(`${account.number} - ${account.name}`);
        }
      );

      addLog(`Finalizado: ${batchResult.created} criadas, ${batchResult.errors.length} erros`);
      setErrors(batchResult.errors);
      setPhase('done');

      if (batchResult.success) {
        await ProgressStore.clear();
      }
    } catch (error) {
      addLog(`ERRO: ${error.message}`);
      setErrors((prev) => [...prev, { account: 'Geral', error: error.message }]);
      setPhase('done');
    }
  }, [navigate]);

  useEffect(() => {
    startCreation();
  }, [startCreation]);

  async function handleReset() {
    await ProgressStore.clear();
    sessionStorage.removeItem('createData');
    navigate('/upload');
  }

  async function handleRetry(errorItem) {
    setErrors((prev) => prev.filter((e) => e !== errorItem));

    try {
      const raw = sessionStorage.getItem('createData');
      if (!raw) return;

      const { accounts, subsidiaryId: savedSubId } = JSON.parse(raw);
      const account = accounts[errorItem.index];
      if (!account) return;

      const progress = await ProgressStore.load();
      const subId = progress?.subsidiaryId || savedSubId;

      let parentInternalId = null;
      if (account.parent && progress?.accountIdMap?.[account.parent]) {
        parentInternalId = progress.accountIdMap[account.parent];
      }

      const result = await sendToBackground({
        type: MessageType.NETSUITE_API_REQUEST,
        method: 'POST',
        endpoint: '/account',
        body: {
          acctName: account.name,
          acctNumber: account.number,
          acctType: account.type,
          subsidiary: { items: [{ id: subId }] },
          ...(parentInternalId ? { parent: { id: parentInternalId } } : {}),
        },
      });

      addLog(`Retry OK: ${account.number} -> ID ${result.internalId}`);
      setAccountsProgress((prev) => ({ ...prev, created: prev.created + 1 }));
    } catch (err) {
      addLog(`Retry falhou: ${err.message}`);
      setErrors((prev) => [...prev, { ...errorItem, error: err.message }]);
    }
  }

  const progressPercent = accountsProgress.total > 0
    ? Math.round((accountsProgress.created / accountsProgress.total) * 100)
    : 0;

  return (
    <div className="max-w-md mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium text-ocean-180">
          {phase === 'done' ? 'Resultado' : 'Criando no NetSuite'}
        </h2>
        <div className="flex gap-2">
          {phase === 'done' && (
            <>
              <button
                onClick={handleReset}
                className="text-sm text-ocean-150 hover:text-ocean-180 flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" />
                Limpar
              </button>
              <button
                onClick={() => navigate('/upload')}
                className="text-sm text-ocean-150 hover:text-ocean-180 flex items-center gap-1"
              >
                <ArrowLeft className="w-3 h-3" />
                Nova Importacao
              </button>
            </>
          )}
        </div>
      </div>

      {resuming && (
        <div className="bg-ocean-10 border border-ocean-30 rounded-lg p-3 text-sm text-ocean-120">
          Retomando operacao incompleta...
        </div>
      )}

      {/* Subsidiary status */}
      <div className="bg-white rounded-lg border border-ocean-30 p-3 flex items-center gap-3">
        {phase === 'subsidiary' ? (
          <Loader2 className="w-5 h-5 text-ocean-120 animate-spin flex-shrink-0" />
        ) : subsidiaryResult ? (
          <CheckCircle className="w-5 h-5 text-pine flex-shrink-0" />
        ) : (
          <div className="w-5 h-5 rounded-full border-2 border-ocean-30 flex-shrink-0" />
        )}
        <div>
          <p className="text-sm font-medium text-ocean-180">Subsidiary</p>
          {phase === 'subsidiary' && (
            <p className="text-xs text-ocean-120">Criando via RESTlet...</p>
          )}
          {subsidiaryResult && (
            <p className="text-xs text-ocean-60">
              ID: {subsidiaryResult.internalId}
              {subsidiaryResult.name && ` — ${subsidiaryResult.name}`}
            </p>
          )}
        </div>
      </div>

      {/* Accounts progress */}
      <div className="bg-white rounded-lg border border-ocean-30 p-3">
        <div className="flex items-center gap-3 mb-2">
          {phase === 'accounts' ? (
            <Loader2 className="w-5 h-5 text-ocean-120 animate-spin flex-shrink-0" />
          ) : phase === 'done' ? (
            errors.length === 0 ? (
              <CheckCircle className="w-5 h-5 text-pine flex-shrink-0" />
            ) : (
              <XCircle className="w-5 h-5 text-rose flex-shrink-0" />
            )
          ) : (
            <div className="w-5 h-5 rounded-full border-2 border-ocean-30 flex-shrink-0" />
          )}
          <div className="flex-1">
            <p className="text-sm font-medium text-ocean-180">
              Plano de Contas ({accountsProgress.created}/{accountsProgress.total})
            </p>
            {currentAccount && phase === 'accounts' && (
              <p className="text-xs text-ocean-60 truncate">{currentAccount}</p>
            )}
          </div>
          <span className="text-sm font-medium text-ocean-150">{progressPercent}%</span>
        </div>

        <div className="w-full bg-ocean-30 rounded-full h-2">
          <div
            className="bg-ocean-120 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <h4 className="text-sm font-medium text-rose mb-2">
            Erros ({errors.length})
          </h4>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {errors.map((err, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <XCircle className="w-3 h-3 text-rose mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-rose font-medium">{err.account}</p>
                  <p className="text-rose break-all">{err.error}</p>
                </div>
                {err.index !== undefined && (
                  <button
                    onClick={() => handleRetry(err)}
                    className="flex items-center gap-1 text-rose hover:text-rose flex-shrink-0"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Retry</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Final result */}
      {phase === 'done' && errors.length === 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
          <CheckCircle className="w-8 h-8 text-pine mx-auto mb-2" />
          <p className="text-sm font-medium text-pine">Tudo criado com sucesso!</p>
          <p className="text-xs text-pine mt-1">
            Subsidiary + {accountsProgress.created} contas criadas no NetSuite
          </p>
        </div>
      )}

      {/* Debug log */}
      {debugLog.length > 0 && (
        <details className="bg-neutral border border-ocean-30 rounded-lg p-3">
          <summary className="text-xs text-ocean-150 cursor-pointer">Log de debug ({debugLog.length})</summary>
          <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
            {debugLog.map((log, i) => (
              <p key={i} className="text-xs font-mono text-ocean-150 break-all">{log}</p>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
