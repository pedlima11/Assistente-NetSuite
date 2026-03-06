/**
 * Validacao pura para o modelador de Plano de Contas.
 * Sem dependencias de React — funcoes puras, testavel isoladamente.
 *
 * Retorna chaves i18n (namespace 'coa') em vez de strings hardcoded.
 * Mensagens com valores dinamicos usam { key, params }.
 * Consumers resolve via t(e) ou t(e.key, e.params) at render time.
 */

import { ORPHAN_ROOT_ID, buildAccountMap, buildChildrenMap, normalizeCode } from './coa-modeling.js';
import { VALID_ACCOUNT_TYPES } from '../types/netsuite.js';

// ── Regras de prefixo BR para tipo de conta ──────────────────────────────────

const BR_CODE_TYPE_MAP = [
  { prefix: '1', label: 'Ativo', types: ['Bank', 'AcctRec', 'OthCurrAsset', 'FixedAsset', 'OthAsset'] },
  { prefix: '2', label: 'Passivo', types: ['AcctPay', 'OthCurrLiab', 'LongTermLiab'] },
  { prefix: '3', label: 'Patrimonio Liquido', types: ['Equity'] },
  { prefix: '4', label: 'Receita', types: ['Income', 'DeferRevenue'] },
  { prefix: '5', label: 'Custos', types: ['COGS'] },
  { prefix: '6', label: 'Despesas', types: ['Expense', 'DeferExpense'] },
];

/**
 * Verifica se o tipo NetSuite nao corresponde ao grupo contabil brasileiro.
 * Retorna null se ok, ou um objeto i18n se suspeito.
 * @param {string} code
 * @param {string} type
 * @returns {null | { key: string, params: object }}
 */
function checkSuspiciousType(code, type) {
  if (!code || !type) return null;
  const firstDigit = code.replace(/\D/g, '')[0];
  if (!firstDigit) return null;
  const rule = BR_CODE_TYPE_MAP.find((r) => r.prefix === firstDigit);
  if (!rule) return null;
  if (rule.types.includes(type)) return null;
  return { key: 'val.typeSuspicious', params: { code, prefix: rule.prefix, group: rule.label, type, expected: rule.types.join(', ') } };
}

/**
 * Verifica se o nivel da conta (profundidade na arvore) e inconsistente
 * com a quantidade de segmentos do codigo.
 * @param {string} code
 * @param {number} level
 * @returns {null | { key: string, params: object }}
 */
export function checkLevelCodeMismatch(code, level) {
  if (!code || typeof code !== 'string') return null;
  const segments = code.split(/[.\-]/).filter(Boolean);
  if (segments.length <= 1) return null;
  const expectedLevel = segments.length - 1;
  if (level === expectedLevel) return null;
  return { key: 'val.levelMismatch', params: { code, segments: segments.length, expected: expectedLevel, actual: level } };
}

// ── Detectar ciclos ──────────────────────────────────────────────────────────

/**
 * Detecta IDs de contas envolvidas em ciclos.
 * @param {Object[]} accounts
 * @param {Map<string, Object>} accountMap
 * @returns {Set<string>}
 */
export function detectCycles(accounts, accountMap) {
  const cycleIds = new Set();
  for (const acct of accounts) {
    if (acct._isOrphanRoot) continue;
    const visited = new Set();
    let current = acct;
    while (current && current.parentClientAccountId) {
      if (visited.has(current.clientAccountId)) {
        for (const id of visited) cycleIds.add(id);
        break;
      }
      visited.add(current.clientAccountId);
      current = accountMap.get(current.parentClientAccountId);
    }
  }
  return cycleIds;
}

// ── Validacao completa ───────────────────────────────────────────────────────

/**
 * Valida todas as contas. Retorna erros e warnings por conta + buckets agregados.
 * Errors/warnings sao chaves i18n (string ou { key, params }).
 *
 * @param {Object[]} accounts
 * @returns {{
 *   accountErrors: Map<string, (string | { key: string, params: object })[]>,
 *   accountWarnings: Map<string, (string | { key: string, params: object })[]>,
 *   errorBuckets: { orphans: string[], duplicateCodes: string[], cycles: string[], postingWithChildren: string[], missingFields: string[], nameTooLong: string[] },
 *   warningBuckets: { duplicateNames: string[], levelCodeMismatch: string[], typeSuspicious: string[], codeFormat: string[], tooManyRoots: boolean, immutableChanged: string[], modified: string[] },
 *   hasBlockingErrors: boolean,
 *   errorCount: number,
 *   warningCount: number,
 * }}
 */
export function validateAllAccounts(accounts) {
  const accountMap = buildAccountMap(accounts);
  const childrenMap = buildChildrenMap(accounts);
  const realAccounts = accounts.filter((a) => !a._isOrphanRoot);

  const accountErrors = new Map();
  const accountWarnings = new Map();

  const errorBuckets = {
    orphans: [],
    duplicateCodes: [],
    cycles: [],
    postingWithChildren: [],
    missingFields: [],
    nameTooLong: [],
  };

  const warningBuckets = {
    duplicateNames: [],
    levelCodeMismatch: [],
    typeSuspicious: [],
    codeFormat: [],
    tooManyRoots: false,
    immutableChanged: [],
    modified: [],
  };

  function addError(id, msg) {
    if (!accountErrors.has(id)) accountErrors.set(id, []);
    accountErrors.get(id).push(msg);
  }

  function addWarning(id, msg) {
    if (!accountWarnings.has(id)) accountWarnings.set(id, []);
    accountWarnings.get(id).push(msg);
  }

  // Codigos duplicados
  const codeCounts = new Map();
  for (const a of realAccounts) {
    if (a.code) {
      codeCounts.set(a.code, (codeCounts.get(a.code) || 0) + 1);
    }
  }

  // Ciclos
  const cycleIds = detectCycles(realAccounts, accountMap);

  // Nomes duplicados por pai
  const namesByParent = new Map();
  for (const a of realAccounts) {
    const key = `${a.parentClientAccountId || 'ROOT'}|${a.name.toLowerCase().trim()}`;
    if (!namesByParent.has(key)) namesByParent.set(key, []);
    namesByParent.get(key).push(a.clientAccountId);
  }

  // Raizes
  const roots = realAccounts.filter((a) => a.parentClientAccountId === null);

  // Validar cada conta
  for (const acct of realAccounts) {
    const id = acct.clientAccountId;

    // ERRO: campos obrigatorios
    if (!acct.code || !acct.code.trim()) {
      addError(id, 'val.codeRequired');
      errorBuckets.missingFields.push(id);
    }
    if (!acct.name || !acct.name.trim()) {
      addError(id, 'val.nameRequired');
      if (!errorBuckets.missingFields.includes(id)) {
        errorBuckets.missingFields.push(id);
      }
    }

    // ERRO: nome > 60 chars
    if (acct.name && acct.name.length > 60) {
      addError(id, { key: 'val.nameTooLong', params: { len: acct.name.length } });
      errorBuckets.nameTooLong.push(id);
    }

    // ERRO: codigo duplicado
    if (acct.code && codeCounts.get(acct.code) > 1) {
      addError(id, { key: 'val.codeDuplicate', params: { code: acct.code } });
      if (!errorBuckets.duplicateCodes.includes(id)) {
        errorBuckets.duplicateCodes.push(id);
      }
    }

    // ERRO: pai nao encontrado (exceto orfaos na quarentena)
    if (acct.parentClientAccountId && acct.parentClientAccountId !== ORPHAN_ROOT_ID) {
      if (!accountMap.has(acct.parentClientAccountId)) {
        addError(id, 'val.parentNotFound');
        errorBuckets.orphans.push(id);
      }
    }

    // ERRO: orfao na quarentena (conta que esta no bucket ORFAOS)
    if (acct.parentClientAccountId === ORPHAN_ROOT_ID) {
      addError(id, 'val.orphan');
      errorBuckets.orphans.push(id);
    }

    // ERRO: ciclo
    if (cycleIds.has(id)) {
      addError(id, 'val.cycle');
      errorBuckets.cycles.push(id);
    }

    // ERRO: analitica com filhos
    const children = childrenMap.get(id);
    if (acct.isPosting && children && children.length > 0) {
      addError(id, 'val.postingWithChildren');
      errorBuckets.postingWithChildren.push(id);
    }

    // WARNING: nome duplicado sob mesmo pai
    const nameKey = `${acct.parentClientAccountId || 'ROOT'}|${acct.name.toLowerCase().trim()}`;
    const sameNameSiblings = namesByParent.get(nameKey);
    if (sameNameSiblings && sameNameSiblings.length > 1) {
      addWarning(id, 'val.duplicateName');
      if (!warningBuckets.duplicateNames.includes(id)) {
        warningBuckets.duplicateNames.push(id);
      }
    }

    // WARNING: tipo suspeito (nao bate com grupo contabil BR)
    const typeMsg = checkSuspiciousType(acct.code, acct.type);
    if (typeMsg) {
      addWarning(id, typeMsg);
      warningBuckets.typeSuspicious.push(id);
    }

    // WARNING: nivel da arvore inconsistente com segmentos do codigo
    const levelMsg = checkLevelCodeMismatch(acct.code, acct.level);
    if (levelMsg) {
      addWarning(id, levelMsg);
      warningBuckets.levelCodeMismatch.push(id);
    }

    // WARNING: formato de codigo
    if (acct.code && !/^\d+(\.\d+)*$/.test(acct.code)) {
      addWarning(id, 'val.codeFormat');
      warningBuckets.codeFormat.push(id);
    }

    // WARNING: campo imutavel alterado em conta com _action=update
    if (acct._action === 'update') {
      warningBuckets.immutableChanged.push(id);
      addWarning(id, 'val.immutableChanged');
    }

    // WARNING: conta modificada pelo usuario (sinalizar visualmente)
    if (acct._modified) {
      warningBuckets.modified.push(id);
    }
  }

  // WARNING: muitas raizes
  if (roots.length > 10) {
    warningBuckets.tooManyRoots = true;
  }

  // Contar totais
  let errorCount = 0;
  for (const errs of accountErrors.values()) errorCount += errs.length;
  let warningCount = 0;
  for (const warns of accountWarnings.values()) warningCount += warns.length;

  const hasBlockingErrors = errorCount > 0;

  return {
    accountErrors,
    accountWarnings,
    errorBuckets,
    warningBuckets,
    hasBlockingErrors,
    errorCount,
    warningCount,
  };
}

// ── Compute account status ───────────────────────────────────────────────────

/**
 * @param {string[]} errors
 * @param {string[]} warnings
 * @returns {'OK' | 'WARN' | 'ERROR'}
 */
export function computeAccountStatus(errors, warnings) {
  if (errors && errors.length > 0) return 'ERROR';
  if (warnings && warnings.length > 0) return 'WARN';
  return 'OK';
}
