import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Loader2, ArrowLeft, Trash2 } from 'lucide-react';
import { setOpeningBalances } from '../../services/journal-entry-creator.js';

export default function BalanceStatus() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState('idle'); // idle | updating | done
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [currentAccount, setCurrentAccount] = useState('');
  const [result, setResult] = useState(null); // { updated, errors }
  const [debugLog, setDebugLog] = useState([]);
  const startedRef = useRef(false);

  function addLog(msg) {
    console.log('[Balance Import]', msg);
    setDebugLog((prev) => [...prev, `${new Date().toLocaleTimeString()} - ${msg}`]);
  }

  const startCreation = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    const raw = sessionStorage.getItem('balanceData');
    if (!raw) {
      navigate('/balance-upload');
      return;
    }

    const { mappedBalances, unmappedCount, trandate, subsidiaryId } = JSON.parse(raw);

    try {
      setPhase('updating');
      addLog(`Criando Journal Entry de saldo inicial: ${mappedBalances.length} contas, data ${trandate}, subsidiary ${subsidiaryId}`);
      if (unmappedCount > 0) {
        addLog(`${unmappedCount} contas sem mapeamento serao ignoradas`);
      }

      const res = await setOpeningBalances(mappedBalances, trandate, subsidiaryId, (current, total, account) => {
        setProgress({ current, total });
        setCurrentAccount(`${account.number} - ${account.name}`);
      });

      setResult(res);
      if (res.journalEntryId) {
        addLog(`Journal Entry criado: ID ${res.journalEntryId}`);
      }
      addLog(`Finalizado: ${res.updated} contas lancadas, ${res.errors.length} erros`);
      setPhase('done');
    } catch (err) {
      addLog(`ERRO: ${err.message}`);
      setError(err.message);
      setPhase('done');
    }
  }, [navigate]);

  useEffect(() => {
    startCreation();
  }, [startCreation]);

  function handleReset() {
    sessionStorage.removeItem('balanceData');
    navigate('/balance-upload');
  }

  const progressPercent = progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium text-ocean-180">
          {phase === 'done' ? 'Resultado' : 'Definindo Saldos Iniciais'}
        </h2>
        {phase === 'done' && (
          <div className="flex gap-2">
            <button
              onClick={handleReset}
              className="text-sm text-ocean-150 hover:text-ocean-180 flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              Limpar
            </button>
            <button
              onClick={() => navigate('/')}
              className="text-sm text-ocean-150 hover:text-ocean-180 flex items-center gap-1"
            >
              <ArrowLeft className="w-3 h-3" />
              Inicio
            </button>
          </div>
        )}
      </div>

      {/* Progress */}
      <div className="bg-white rounded-lg border border-ocean-30 p-3">
        <div className="flex items-center gap-3 mb-2">
          {phase === 'updating' ? (
            <Loader2 className="w-5 h-5 text-ocean-120 animate-spin flex-shrink-0" />
          ) : phase === 'done' ? (
            error || (result && result.errors.length > 0) ? (
              <XCircle className="w-5 h-5 text-rose flex-shrink-0" />
            ) : (
              <CheckCircle className="w-5 h-5 text-pine flex-shrink-0" />
            )
          ) : (
            <div className="w-5 h-5 rounded-full border-2 border-ocean-30 flex-shrink-0" />
          )}
          <div className="flex-1">
            <p className="text-sm font-medium text-ocean-180">
              Saldos Iniciais ({progress.current}/{progress.total})
            </p>
            {currentAccount && phase === 'updating' && (
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
      {result && result.errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <h4 className="text-sm font-medium text-rose mb-2">
            Erros ({result.errors.length})
          </h4>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {result.errors.map((err, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <XCircle className="w-3 h-3 text-rose mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-rose font-medium">{err.account}</p>
                  <p className="text-rose break-all">{err.error}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* General error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <XCircle className="w-4 h-4 text-rose" />
            <span className="text-sm font-medium text-rose">Erro</span>
          </div>
          <p className="text-sm text-rose">{error}</p>
        </div>
      )}

      {/* Success */}
      {phase === 'done' && !error && result && result.errors.length === 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
          <CheckCircle className="w-8 h-8 text-pine mx-auto mb-2" />
          <p className="text-sm font-medium text-pine">Saldos iniciais definidos com sucesso!</p>
          <p className="text-xs text-pine mt-1">
            Journal Entry criado com {result.updated} linhas
            {result.journalEntryId && ` (ID: ${result.journalEntryId})`}
          </p>
        </div>
      )}

      {/* Debug log */}
      {debugLog.length > 0 && (
        <details className="bg-neutral border border-ocean-30 rounded-lg p-3">
          <summary className="text-xs text-ocean-150 cursor-pointer">
            Log de debug ({debugLog.length})
          </summary>
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
