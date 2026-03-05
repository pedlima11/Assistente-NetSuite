import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Loader2, RotateCcw, ArrowLeft, Trash2, Building2 } from 'lucide-react';
import { sendToBackground } from '../../utils/api-client.js';
import { ProgressStore, computeImportKey } from '../../utils/progress-store.js';
import { ChartOfAccountsMapper } from '../../services/coa-mapper.js';
import { MessageType } from '../../types/messages.js';

export default function Status() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState('idle');
  const [subsidiaryResults, setSubsidiaryResults] = useState([]); // [{name, status, internalId, error}]
  const [accountsProgress, setAccountsProgress] = useState({ created: 0, total: 0 });
  const [errors, setErrors] = useState([]);
  const [currentAccount, setCurrentAccount] = useState('');
  const [resuming, setResuming] = useState(false);
  const [debugLog, setDebugLog] = useState([]);
  const creationStartedRef = React.useRef(false);

  function addLog(msg) {
    console.log('[NetSuite Assistant]', msg);
    setDebugLog((prev) => [...prev, `${new Date().toLocaleTimeString()} - ${msg}`]);
  }

  /**
   * Creates multiple subsidiaries in depth order, mapping clientNodeId → netsuiteInternalId.
   * @param {Object[]} nodes - subsidiary nodes array
   * @returns {{ idMap: Map<string, string>, rootInternalId: string|null }}
   */
  async function createSubsidiaryNodes(nodes) {
    // Filter out existing nodes — only create new ones
    const newNodes = nodes.filter((n) => !n._isExisting);
    if (newNodes.length === 0) throw new Error('Nenhuma filial nova para criar');

    const idMap = new Map();

    // Compute depth for each new node
    const depthMap = new Map();
    function computeDepth(nodeId, depth) {
      depthMap.set(nodeId, depth);
      newNodes.filter((n) => n.parentClientNodeId === nodeId)
        .forEach((child) => computeDepth(child.clientNodeId, depth + 1));
    }

    // Find roots among new nodes (parentClientNodeId is null or points to an existing node)
    const newRoots = newNodes.filter((n) => {
      if (n.parentClientNodeId === null) return true;
      return n.parentClientNodeId.startsWith('existing-');
    });
    if (newRoots.length === 0) throw new Error('Nenhum no raiz encontrado na arvore de subsidiaries');
    newRoots.forEach((root) => computeDepth(root.clientNodeId, 0));

    // Sort by depth ascending
    const sorted = [...newNodes].sort((a, b) => depthMap.get(a.clientNodeId) - depthMap.get(b.clientNodeId));

    // Initialize results display
    setSubsidiaryResults(sorted.map((n) => ({
      name: n.name || 'Sem nome',
      status: 'pending',
      internalId: null,
      error: null,
    })));

    // Create sequentially
    const blockedParents = new Set();

    for (let i = 0; i < sorted.length; i++) {
      const node = sorted[i];

      // Check if parent was blocked
      if (node.parentClientNodeId && blockedParents.has(node.parentClientNodeId)) {
        blockedParents.add(node.clientNodeId);
        updateSubsidiaryResult(i, { status: 'blocked', error: 'Pai nao foi criado' });
        addLog(`Pulando ${node.name}: pai nao foi criado`);
        continue;
      }

      // Resolve parent ID
      let parentId;
      if (node.parentClientNodeId === null) {
        parentId = node.parent; // NetSuite ID from dropdown (root's parent in NS)
      } else if (node.parentClientNodeId.startsWith('existing-')) {
        // Parent is an existing NS subsidiary — extract the NS internal ID
        parentId = node.parentClientNodeId.replace('existing-', '');
      } else {
        parentId = idMap.get(node.parentClientNodeId);
        if (!parentId) {
          blockedParents.add(node.clientNodeId);
          updateSubsidiaryResult(i, { status: 'error', error: 'ID do pai nao encontrado' });
          addLog(`Erro: pai de ${node.name} nao tem ID`);
          continue;
        }
      }

      updateSubsidiaryResult(i, { status: 'creating' });
      addLog(`Criando filial ${i + 1}/${sorted.length}: ${node.name}`);

      try {
        // Clean payload — only send fields the RESTlet expects
        const cleanData = {
          name: node.name,
          cnpj: node.cnpj,
          ie: node.ie,
          currency: node.currency,
          fiscalcalendar: node.fiscalcalendar,
          taxfiscalcalendar: node.taxfiscalcalendar,
          address: node.address,
          addressNumber: node.addressNumber,
          brCityId: node.brCityId,
          state: node.state,
          zipCode: node.zipCode,
          parent: parentId,
        };

        const result = await sendToBackground({
          type: MessageType.CREATE_SUBSIDIARY,
          data: cleanData,
        });

        if (!result.success || !result.internalId) {
          throw new Error(result.error || 'Sem internalId na resposta');
        }

        idMap.set(node.clientNodeId, result.internalId);
        updateSubsidiaryResult(i, { status: 'created', internalId: result.internalId });
        addLog(`Filial criada: ${node.name} → ID ${result.internalId}`);
      } catch (err) {
        blockedParents.add(node.clientNodeId);
        updateSubsidiaryResult(i, { status: 'error', error: err.message });
        addLog(`ERRO criando ${node.name}: ${err.message}`);
        setErrors((prev) => [...prev, { account: `Filial: ${node.name}`, error: err.message }]);
      }
    }

    return {
      idMap,
      rootInternalId: idMap.get(newRoots[0].clientNodeId) || null,
    };
  }

  function updateSubsidiaryResult(index, updates) {
    setSubsidiaryResults((prev) => prev.map((r, i) => i === index ? { ...r, ...updates } : r));
  }

  const startCreation = useCallback(async () => {
    const raw = sessionStorage.getItem('createData');
    if (!raw) {
      navigate('/review');
      return;
    }

    const {
      subsidiaryNodes,
      subsidiary, // backward compat: old single-node format
      accounts,
      subsidiaryId,
      createSubsidiary,
      existingAccounts: existingAccountsObj,
      importKey: savedImportKey,
    } = JSON.parse(raw);
    const existingAccountsMap = existingAccountsObj || {};
    const importKey = savedImportKey || (accounts?.length > 0 ? computeImportKey(accounts) : '');

    const existingProgress = await ProgressStore.load();

    try {
      let effectiveSubsidiaryId = subsidiaryId;

      // ── Phase 1: Resolve subsidiary ──────────────────────────────────
      // Try resume first: check if valid checkpoint exists for this import.
      // For "create" mode, subsidiaryId in createData is null — checkpoint has the real ID.
      let isResuming = false;

      if (existingProgress && importKey) {
        // Try matching with createData's subsidiaryId (existing mode)
        const sidFromData = String(effectiveSubsidiaryId || '');
        // Try matching with checkpoint's own subsidiaryId (create mode — real ID only in checkpoint)
        const sidFromCheckpoint = String(existingProgress.subsidiaryId || '');

        const matchesData = sidFromData && ProgressStore.isValidCheckpoint(existingProgress, { subsidiaryId: sidFromData, importKey });
        const matchesCheckpoint = !matchesData && sidFromCheckpoint && ProgressStore.isValidCheckpoint(existingProgress, { subsidiaryId: sidFromCheckpoint, importKey });

        if (matchesData || matchesCheckpoint) {
          effectiveSubsidiaryId = existingProgress.subsidiaryId;
          setSubsidiaryResults([{ name: 'Retomada', status: 'created', internalId: effectiveSubsidiaryId, error: null }]);
          setResuming(true);
          isResuming = true;
          addLog(`Retomando com subsidiary: ${effectiveSubsidiaryId}`);
        } else {
          await ProgressStore.clear();
          addLog('Checkpoint anterior descartado (import diferente ou corrompido)');
        }
      } else if (existingProgress) {
        await ProgressStore.clear();
      }

      // Subsidiary creation — only if NOT resuming
      if (!isResuming) {
        if (createSubsidiary && subsidiaryNodes && subsidiaryNodes.length > 0) {
          // Multi-node creation (SubsidiaryBuilder format)
          setPhase('subsidiary');

          const { rootInternalId } = await createSubsidiaryNodes(subsidiaryNodes);
          effectiveSubsidiaryId = rootInternalId;

          if (effectiveSubsidiaryId) {
            addLog(`Subsidiaries criadas. Raiz ID: ${effectiveSubsidiaryId}`);
          } else {
            throw new Error('Falha ao criar subsidiary raiz');
          }
        } else if (createSubsidiary && subsidiary) {
          // Legacy single subsidiary creation (backward compat)
          setPhase('subsidiary');
          setSubsidiaryResults([{ name: subsidiary.name, status: 'creating', internalId: null, error: null }]);
          addLog(`Criando subsidiary via RESTlet: ${subsidiary.name}`);

          const result = await sendToBackground({
            type: MessageType.CREATE_SUBSIDIARY,
            data: subsidiary,
          });

          addLog(`Resposta RESTlet: ${JSON.stringify(result)}`);

          if (!result.success || !result.internalId) {
            throw new Error(result.error || `Falha ao criar subsidiary. Resposta: ${JSON.stringify(result)}`);
          }

          effectiveSubsidiaryId = result.internalId;
          setSubsidiaryResults([{ name: subsidiary.name, status: 'created', internalId: effectiveSubsidiaryId, error: null }]);
          addLog(`Subsidiary criada com sucesso! ID: ${effectiveSubsidiaryId}`);
        } else if (effectiveSubsidiaryId) {
          // Use existing subsidiary
          setSubsidiaryResults([{ name: 'Existente', status: 'created', internalId: effectiveSubsidiaryId, error: null }]);
          addLog(`Usando subsidiary existente: ${effectiveSubsidiaryId}`);
        } else {
          throw new Error('Nenhuma subsidiary definida. Volte para a tela de revisao.');
        }
      }

      // ── Phase 2: Create accounts ──────────────────────────────────────
      // No stub save — checkpoint is created inside createAccountsBatch via makeFresh
      if (accounts && accounts.length > 0) {
        setPhase('accounts');
        const sorted = ChartOfAccountsMapper.topologicalSort(accounts);
        setAccountsProgress({ created: 0, total: sorted.length });
        addLog(`Criando ${sorted.length} contas vinculadas a subsidiary ${effectiveSubsidiaryId}...`);

        const batchResult = await ChartOfAccountsMapper.createAccountsBatch(
          sorted,
          effectiveSubsidiaryId,
          importKey,
          (created, total, account) => {
            setAccountsProgress({ created, total });
            setCurrentAccount(`${account.number} - ${account.name}`);
          },
          existingAccountsMap
        );

        addLog(`Finalizado: ${batchResult.created} criadas, ${batchResult.updated} atualizadas, ${batchResult.skipped} puladas, ${batchResult.errors.length} erros`);
        setErrors((prev) => [...prev, ...batchResult.errors]);

        if (batchResult.success) {
          await ProgressStore.clear();
        }
      } else {
        addLog('Modo subsidiary-only: sem contas para criar');
        await ProgressStore.clear();
      }

      setPhase('done');
    } catch (error) {
      addLog(`ERRO: ${error.message}`);
      setErrors((prev) => [...prev, { account: 'Geral', error: error.message }]);
      setPhase('done');
    }
  }, [navigate]);

  useEffect(() => {
    if (creationStartedRef.current) return;
    creationStartedRef.current = true;
    startCreation();
  }, [startCreation]);

  async function handleReset() {
    await ProgressStore.clear();
    sessionStorage.removeItem('createData');
    navigate('/upload');
  }

  function isRetryable(errorMsg) {
    const msg = (errorMsg || '').toLowerCase();
    if (msg.includes('duplicate') && msg.includes('code')) return false;
    if (msg.includes('immutable')) return false;
    if (msg.includes('invalid type')) return false;
    if (msg.includes('already exist')) return false;
    return true;
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

      // Atualizar checkpoint para que retomada nao reprocesse esta conta
      if (progress && progress.accountIdMap && result.internalId) {
        progress.accountIdMap[account.number] = result.internalId;
        progress.errors = progress.errors.filter((e) => e.index !== errorItem.index);
        progress.createdAccounts++;
        await ProgressStore.save(progress);
      }
    } catch (err) {
      addLog(`Retry falhou: ${err.message}`);
      setErrors((prev) => [...prev, { ...errorItem, error: err.message, retryCount: (errorItem.retryCount || 0) + 1 }]);
    }
  }

  async function handleRetryAll() {
    const retryable = errors.filter((e) => e.index !== undefined && isRetryable(e.error) && (e.retryCount || 0) < 2);
    if (retryable.length === 0) {
      addLog('Nenhum erro retentavel');
      return;
    }
    addLog(`Retry em lote: ${retryable.length} itens`);
    for (const err of retryable) {
      await handleRetry(err);
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  const progressPercent = accountsProgress.total > 0
    ? Math.round((accountsProgress.created / accountsProgress.total) * 100)
    : 0;

  const totalSubsCreated = subsidiaryResults.filter((r) => r.status === 'created').length;
  const totalSubs = subsidiaryResults.length;

  return (
    <div className="max-w-3xl space-y-4">
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
                onClick={() => navigate(accountsProgress.total > 0 ? '/upload' : '/')}
                className="text-sm text-ocean-150 hover:text-ocean-180 flex items-center gap-1"
              >
                <ArrowLeft className="w-3 h-3" />
                {accountsProgress.total > 0 ? 'Nova Importacao' : 'Voltar ao Inicio'}
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

      {/* Subsidiary status — multi-node list */}
      <div className="bg-white rounded-lg border border-ocean-30 p-3">
        <div className="flex items-center gap-2 mb-2">
          <Building2 className="w-4 h-4 text-ocean-120" />
          <p className="text-sm font-medium text-ocean-180">
            Subsidiaries {totalSubs > 0 && `(${totalSubsCreated}/${totalSubs})`}
          </p>
          {phase === 'subsidiary' && (
            <Loader2 className="w-4 h-4 text-ocean-120 animate-spin" />
          )}
        </div>

        {subsidiaryResults.length > 0 && (
          <div className="space-y-1.5">
            {subsidiaryResults.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                {r.status === 'creating' && <Loader2 className="w-3.5 h-3.5 text-ocean-120 animate-spin flex-shrink-0" />}
                {r.status === 'created' && <CheckCircle className="w-3.5 h-3.5 text-pine flex-shrink-0" />}
                {r.status === 'error' && <XCircle className="w-3.5 h-3.5 text-rose flex-shrink-0" />}
                {r.status === 'blocked' && <XCircle className="w-3.5 h-3.5 text-ocean-60 flex-shrink-0" />}
                {r.status === 'pending' && <div className="w-3.5 h-3.5 rounded-full border-2 border-ocean-30 flex-shrink-0" />}

                <span className={`flex-1 truncate ${
                  r.status === 'error' ? 'text-rose' :
                  r.status === 'blocked' ? 'text-ocean-60' :
                  'text-ocean-180'
                }`}>
                  {r.name}
                </span>

                {r.internalId && (
                  <span className="text-ocean-60">ID: {r.internalId}</span>
                )}
                {r.error && (
                  <span className="text-rose truncate max-w-[200px]" title={r.error}>{r.error}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {subsidiaryResults.length === 0 && phase !== 'subsidiary' && (
          <p className="text-xs text-ocean-60">Aguardando...</p>
        )}
      </div>

      {/* Accounts progress */}
      {accountsProgress.total > 0 && (
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
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-rose">
              Erros ({errors.length})
            </h4>
            {phase === 'done' && errors.some((e) => e.index !== undefined && isRetryable(e.error) && (e.retryCount || 0) < 2) && (
              <button
                onClick={handleRetryAll}
                className="text-xs text-ocean-150 hover:text-ocean-180 flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                Retry todos
              </button>
            )}
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {errors.map((err, i) => {
              const canRetry = err.index !== undefined && isRetryable(err.error) && (err.retryCount || 0) < 2;
              return (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <XCircle className="w-3 h-3 text-rose mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-rose font-medium">{err.account}</p>
                    <p className="text-rose break-all">{err.error}</p>
                    {err.retryCount >= 2 && (
                      <p className="text-ocean-60 text-[10px]">Max retries atingido</p>
                    )}
                    {err.index !== undefined && !isRetryable(err.error) && (
                      <p className="text-ocean-60 text-[10px]">Erro permanente — nao retentavel</p>
                    )}
                  </div>
                  {canRetry && (
                    <button
                      onClick={() => handleRetry(err)}
                      className="flex items-center gap-1 text-rose hover:text-rose flex-shrink-0"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Retry</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Final result */}
      {phase === 'done' && errors.length === 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
          <CheckCircle className="w-8 h-8 text-pine mx-auto mb-2" />
          <p className="text-sm font-medium text-pine">Tudo criado com sucesso!</p>
          <p className="text-xs text-pine mt-1">
            {totalSubs > 1 && `${totalSubsCreated} subsidiaries`}
            {totalSubs === 1 && 'Subsidiary'}
            {accountsProgress.total > 0 && ` + ${accountsProgress.created} contas`}
            {' criadas no NetSuite'}
          </p>
        </div>
      )}

      {/* Acoes pos-erro: retomar criacao ou voltar para revisao */}
      {phase === 'done' && errors.length > 0 && (
        <div className="flex gap-2">
          {accountsProgress.created < accountsProgress.total && (
            <button
              onClick={() => { creationStartedRef.current = false; startCreation(); }}
              className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-sm border border-ocean-120 text-ocean-120 rounded-md hover:bg-ocean-10"
            >
              <RotateCcw className="w-3 h-3" />
              Retomar Criacao
            </button>
          )}
          <button
            onClick={() => navigate('/review')}
            className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-sm border border-ocean-30 text-ocean-150 rounded-md hover:bg-ocean-10"
          >
            <ArrowLeft className="w-3 h-3" />
            Voltar para Revisao
          </button>
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
