/**
 * Motor puro para modelagem interativa do Plano de Contas.
 * Sem dependencias de React — apenas logica de arvore, IDs, DnD, export.
 *
 * Importado por CoaModeler.jsx (frontend).
 */

import { ChartOfAccountsMapper } from './coa-mapper.js';
import { AccountType, ACCOUNT_TYPE_TO_RATE_TYPE, GeneralRateType } from '../types/netsuite.js';

// ── Hash deterministico (FNV-1a, inline para evitar dep de tax-rule-core) ────

/**
 * FNV-1a double-pass, 16 hex chars. Puro JS, browser+Node.
 * @param {string} str
 * @returns {string}
 */
function fnv1aHash(str) {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ (c + i), 0x01000193);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/**
 * Gera ID estavel com deteccao de colisao.
 * @param {string} key
 * @param {Set<string>} usedIds
 * @returns {string}
 */
function stableId(key, usedIds) {
  let id = fnv1aHash(key);
  let suffix = 0;
  while (usedIds.has(id)) {
    suffix++;
    id = fnv1aHash(key + '#' + suffix);
  }
  usedIds.add(id);
  return id;
}

// ── ID deterministico para contas ────────────────────────────────────────────

/**
 * @param {number} sourceRowIndex
 * @param {string} code
 * @param {string} name
 * @param {Set<string>} usedIds
 * @returns {string}
 */
function generateAccountId(sourceRowIndex, code, name, usedIds) {
  const key = `${sourceRowIndex}|${code || ''}|${name || ''}`;
  return 'acct-' + stableId(key, usedIds);
}

// ── Normalize code para sorting ──────────────────────────────────────────────

/**
 * Normaliza codigo para sorting deterministico.
 * "1.01.02" → "001001002", "3" → "003"
 * @param {string} code
 * @returns {string}
 */
export function normalizeCode(code) {
  if (!code || typeof code !== 'string') return '';
  return code
    .split(/[.\-]/)
    .map((seg) => seg.replace(/\D/g, '').padStart(3, '0'))
    .join('');
}

/**
 * Sort key para ordenar filhos deterministicamente.
 * @param {string} code
 * @param {number} sourceRowIndex
 * @returns {string}
 */
export function sortKey(code, sourceRowIndex) {
  const norm = normalizeCode(code);
  return norm || ('ZZZ' + String(sourceRowIndex).padStart(6, '0'));
}

// ── Inferencia deterministica de pai (plano BR) ─────────────────────────────

/**
 * Tenta inferir o pai pelo prefixo do codigo.
 * "1.01.02" → tenta "1.01" → tenta "1"
 * @param {string} code
 * @param {Map<string, string>} codeToId - code → clientAccountId
 * @returns {string|null} clientAccountId do pai ou null
 */
export function inferParent(code, codeToId) {
  if (!code || typeof code !== 'string') return null;
  const parts = code.split(/[.\-]/);
  for (let len = parts.length - 1; len >= 1; len--) {
    const prefix = parts.slice(0, len).join('.');
    if (codeToId.has(prefix)) return codeToId.get(prefix);
  }
  return null;
}

// ── Orphan root virtual node ─────────────────────────────────────────────────

export const ORPHAN_ROOT_ID = '__orphans__';

function createOrphanRoot() {
  return {
    clientAccountId: ORPHAN_ROOT_ID,
    code: '',
    name: 'ORFAOS',
    type: '',
    isPosting: false,
    parentClientAccountId: null,
    level: 0,
    sourceRowIndex: -1,
    status: 'OK',
    issues: [],
    _isOrphanRoot: true,
  };
}

/**
 * Determina se uma conta e raiz real (nao orfao).
 * Raiz real: level 0 no raw, ou codigo de 1 digito, ou parent era null no raw.
 * @param {Object} rawAccount
 * @returns {boolean}
 */
function isRealRoot(rawAccount) {
  if (rawAccount.level === 0) return true;
  if (rawAccount.parent === null || rawAccount.parent === undefined) return true;
  if (/^\d$/.test(rawAccount.number)) return true;
  return false;
}

// ── Init working accounts ────────────────────────────────────────────────────

/**
 * Converte rawAccounts (saida Claude) em workingAccounts com IDs deterministicos,
 * inferencia de pai, e zona de quarentena para orfaos.
 *
 * @param {Object[]} rawAccounts - [{number, name, type, parent, level, isSummary}]
 * @param {Map<string, Object>} [existingAccounts] - Map<acctnumber, {id, acctnumber, acctname}>
 * @returns {Object[]} workingAccounts
 */
export function initWorkingAccounts(rawAccounts, existingAccounts) {
  const usedIds = new Set();
  const codeToId = new Map();

  // Passo 1: gerar IDs deterministicos e montar indice code → id
  const accounts = rawAccounts.map((raw, idx) => {
    const id = generateAccountId(idx, raw.number, raw.name, usedIds);
    codeToId.set(raw.number, id);

    // Detectar _action para contas existentes no NetSuite
    let action;
    if (existingAccounts && existingAccounts.has(raw.number)) {
      action = 'skip';
    }

    const code = raw.number || '';
    const name = raw.name || '';
    const type = raw.type || '';
    const isPosting = raw.isSummary === true ? false : true;
    const generalRateType = raw.generalRateType
      || ACCOUNT_TYPE_TO_RATE_TYPE[raw.type]
      || GeneralRateType.Current;

    return {
      clientAccountId: id,
      code,
      name,
      type,
      isPosting,
      parentClientAccountId: null, // resolvido no passo 2
      level: raw.level ?? 0,
      sourceRowIndex: idx,
      generalRateType,
      status: 'OK',
      issues: [],
      _rawParent: raw.parent || null, // guardar referencia original para resolucao
      _action: action,
      _modified: false,
      _originalSnapshot: { code, name, type, isPosting, generalRateType },
    };
  });

  // Passo 2: resolver parentClientAccountId
  // Prioridade: (1) raw.parent se bate com code, (2) inferencia por prefixo
  for (const acct of accounts) {
    if (acct._rawParent && codeToId.has(acct._rawParent)) {
      acct.parentClientAccountId = codeToId.get(acct._rawParent);
    } else {
      const inferred = inferParent(acct.code, codeToId);
      if (inferred && inferred !== acct.clientAccountId) {
        acct.parentClientAccountId = inferred;
      }
    }
    delete acct._rawParent;
  }

  // Passo 2b: salvar parent original para rastreio de _modified
  for (const acct of accounts) {
    acct._originalParentId = acct.parentClientAccountId;
  }

  // Passo 3: detectar orfaos e mover para zona de quarentena
  const hasOrphans = accounts.some((a) => {
    if (a.parentClientAccountId !== null) return false;
    // Raiz real? Verificar no rawAccounts original
    const raw = rawAccounts[a.sourceRowIndex];
    return !isRealRoot(raw);
  });

  if (hasOrphans) {
    for (const acct of accounts) {
      if (acct.parentClientAccountId === null) {
        const raw = rawAccounts[acct.sourceRowIndex];
        if (!isRealRoot(raw)) {
          acct.parentClientAccountId = ORPHAN_ROOT_ID;
        }
      }
    }
    // Inserir no virtual ORFAOS no inicio
    accounts.unshift(createOrphanRoot());
  }

  // Passo 4: recalcular levels
  return recalcLevels(accounts);
}

// ── Build maps ───────────────────────────────────────────────────────────────

/**
 * @param {Object[]} accounts
 * @returns {Map<string, Object>}
 */
export function buildAccountMap(accounts) {
  const map = new Map();
  for (const a of accounts) {
    map.set(a.clientAccountId, a);
  }
  return map;
}

/**
 * @param {Object[]} accounts
 * @returns {Map<string, string>} code → clientAccountId
 */
export function buildCodeIndex(accounts) {
  const map = new Map();
  for (const a of accounts) {
    if (a.code && !a._isOrphanRoot) {
      map.set(a.code, a.clientAccountId);
    }
  }
  return map;
}

/**
 * @param {Object[]} accounts
 * @returns {Map<string, string[]>} parentClientAccountId → [childId, ...] (sorted by sortKey)
 */
export function buildChildrenMap(accounts) {
  const map = new Map();
  for (const a of accounts) {
    const pid = a.parentClientAccountId;
    if (pid !== null) {
      if (!map.has(pid)) map.set(pid, []);
      map.get(pid).push(a.clientAccountId);
    }
  }
  // Sort children deterministicamente
  const accountMap = buildAccountMap(accounts);
  for (const [, children] of map) {
    children.sort((a, b) => {
      const aa = accountMap.get(a);
      const bb = accountMap.get(b);
      return sortKey(aa?.code, aa?.sourceRowIndex).localeCompare(
        sortKey(bb?.code, bb?.sourceRowIndex)
      );
    });
  }
  return map;
}

// ── Descendants (para validacao de DnD) ──────────────────────────────────────

/**
 * Coleta todos descendentes de um no via DFS.
 * @param {string} id
 * @param {Map<string, string[]>} childrenMap
 * @returns {Set<string>}
 */
export function getDescendantIds(id, childrenMap) {
  const result = new Set();
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop();
    const children = childrenMap.get(current);
    if (children) {
      for (const cid of children) {
        if (!result.has(cid)) {
          result.add(cid);
          stack.push(cid);
        }
      }
    }
  }
  return result;
}

// ── DnD validation ───────────────────────────────────────────────────────────

/**
 * Verifica se um drop e valido.
 * @param {string} draggedId
 * @param {string|null} targetParentId - novo pai proposto
 * @param {Map<string, Object>} accountMap
 * @param {Map<string, string[]>} childrenMap
 * @returns {boolean}
 */
export function isDropValid(draggedId, targetParentId, accountMap, childrenMap) {
  if (!draggedId || draggedId === ORPHAN_ROOT_ID) return false;
  if (draggedId === targetParentId) return false;
  if (targetParentId === null) return true; // mover para raiz e sempre ok

  const target = accountMap.get(targetParentId);
  if (!target) return false;
  if (target._action === 'skip') return false;

  // Bloquear ciclo: target nao pode ser descendente do dragged
  const descendants = getDescendantIds(draggedId, childrenMap);
  if (descendants.has(targetParentId)) return false;

  return true;
}

// ── Recalc levels ────────────────────────────────────────────────────────────

/**
 * Recalcula level de todas contas baseado na arvore real.
 * @param {Object[]} accounts
 * @returns {Object[]}
 */
export function recalcLevels(accounts) {
  const accountMap = buildAccountMap(accounts);
  const visited = new Set();

  function getLevel(id) {
    if (visited.has(id)) return 0; // protecao contra ciclo
    visited.add(id);
    const acct = accountMap.get(id);
    if (!acct || !acct.parentClientAccountId) return 0;
    if (acct.parentClientAccountId === ORPHAN_ROOT_ID) return 1;
    return 1 + getLevel(acct.parentClientAccountId);
  }

  return accounts.map((a) => {
    visited.clear();
    const level = getLevel(a.clientAccountId);
    return level !== a.level ? { ...a, level } : a;
  });
}

// ── Mark modified ────────────────────────────────────────────────────────────

/**
 * Compara campos editaveis com o snapshot original e marca _modified.
 * @param {Object} account
 * @returns {Object}
 */
export function checkModified(account) {
  if (!account._originalSnapshot || account._isOrphanRoot) return account;
  const snap = account._originalSnapshot;
  const isModified = (
    account.code !== snap.code ||
    account.name !== snap.name ||
    account.type !== snap.type ||
    account.isPosting !== snap.isPosting ||
    account.generalRateType !== snap.generalRateType ||
    account.parentClientAccountId !== account._originalParentId
  );
  return isModified !== account._modified ? { ...account, _modified: isModified } : account;
}

/**
 * Atualiza _modified em todas contas.
 * @param {Object[]} accounts
 * @returns {Object[]}
 */
export function refreshModifiedFlags(accounts) {
  return accounts.map(checkModified);
}

// ── Suggest code for level ───────────────────────────────────────────────────

/**
 * Dado um novo pai, sugere um codigo para a conta movida.
 * Pega o codigo do pai e adiciona um segmento.
 * Ex: pai "1.01", filhos existentes ["1.01.01", "1.01.02"] → sugere "1.01.03"
 *
 * @param {string} parentCode - codigo do novo pai
 * @param {Map<string, string[]>} childrenMap
 * @param {Map<string, Object>} accountMap
 * @param {string} newParentId
 * @returns {string|null} codigo sugerido ou null se nao conseguir
 */
export function suggestCodeForParent(parentCode, childrenMap, accountMap, newParentId) {
  if (!parentCode) return null;
  const siblings = (childrenMap.get(newParentId) || [])
    .map((id) => accountMap.get(id))
    .filter(Boolean);

  // Encontrar o maior ultimo segmento entre irmaos
  let maxSuffix = 0;
  for (const sib of siblings) {
    const parts = sib.code.split(/[.\-]/);
    const last = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(last) && last > maxSuffix) maxSuffix = last;
  }

  const nextSuffix = String(maxSuffix + 1).padStart(2, '0');
  return `${parentCode}.${nextSuffix}`;
}

// ── Flatten visible tree (para render do indented list) ──────────────────────

/**
 * Retorna lista plana de contas visiveis na arvore (DFS pre-order),
 * respeitando expandedIds.
 *
 * @param {Object[]} accounts
 * @param {Map<string, string[]>} childrenMap
 * @param {Set<string>} expandedIds
 * @returns {{ account: Object, depth: number, hasChildren: boolean }[]}
 */
export function flattenVisibleTree(accounts, childrenMap, expandedIds) {
  const accountMap = buildAccountMap(accounts);
  const result = [];

  // Encontrar raizes (sem pai ou pai = null)
  const roots = accounts
    .filter((a) => a.parentClientAccountId === null)
    .sort((a, b) => {
      // Orphan root always first if it has children
      if (a._isOrphanRoot) return -1;
      if (b._isOrphanRoot) return 1;
      return sortKey(a.code, a.sourceRowIndex).localeCompare(
        sortKey(b.code, b.sourceRowIndex)
      );
    });

  function walk(id, depth) {
    const acct = accountMap.get(id);
    if (!acct) return;

    // Skip orphan root if it has no children
    if (acct._isOrphanRoot && (!childrenMap.has(ORPHAN_ROOT_ID) || childrenMap.get(ORPHAN_ROOT_ID).length === 0)) {
      return;
    }

    const children = childrenMap.get(id) || [];
    result.push({ account: acct, depth, hasChildren: children.length > 0 });

    // Orphan root is always expanded
    if (acct._isOrphanRoot || expandedIds.has(id)) {
      for (const cid of children) {
        walk(cid, depth + 1);
      }
    }
  }

  for (const root of roots) {
    walk(root.clientAccountId, 0);
  }

  return result;
}

// ── Move account (DnD result) ────────────────────────────────────────────────

/**
 * Move uma conta para um novo pai. Retorna novo array de accounts.
 * @param {Object[]} accounts
 * @param {string} draggedId
 * @param {string|null} newParentId
 * @returns {Object[]}
 */
export function moveAccount(accounts, draggedId, newParentId) {
  const updated = accounts.map((a) => {
    if (a.clientAccountId === draggedId) {
      return { ...a, parentClientAccountId: newParentId, _modified: true };
    }
    return a;
  });
  return recalcLevels(updated);
}

// ── Auto-fix: converter pais analiticas em sinteticas ────────────────────────

/**
 * @param {Object[]} accounts
 * @param {Map<string, string[]>} childrenMap
 * @returns {Object[]}
 */
export function autoFixPostingParents(accounts, childrenMap) {
  return accounts.map((a) => {
    if (a.isPosting && childrenMap.has(a.clientAccountId) && childrenMap.get(a.clientAccountId).length > 0) {
      return { ...a, isPosting: false };
    }
    return a;
  });
}

// ── Bulk find/replace ────────────────────────────────────────────────────────

/**
 * @param {Object[]} accounts
 * @param {Set<string>} selectedIds
 * @param {string} search
 * @param {string} replace
 * @returns {Object[]}
 */
export function bulkFindReplace(accounts, selectedIds, search, replace) {
  if (!search) return accounts;
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'gi');
  return accounts.map((a) => {
    if (!selectedIds.has(a.clientAccountId)) return a;
    const newName = a.name.replace(regex, replace);
    return newName !== a.name ? { ...a, name: newName } : a;
  });
}

// ── Bulk patch ───────────────────────────────────────────────────────────────

/**
 * Aplica um patch parcial a multiplas contas.
 * @param {Object[]} accounts
 * @param {Set<string>} selectedIds
 * @param {Object} patch - campos a aplicar (ex: {type: 'Bank', isPosting: false})
 * @returns {Object[]}
 */
export function bulkPatch(accounts, selectedIds, patch) {
  return accounts.map((a) => {
    if (!selectedIds.has(a.clientAccountId)) return a;
    return { ...a, ...patch };
  });
}

// ── Normalize codes ──────────────────────────────────────────────────────────

/**
 * Remove caracteres nao-numericos exceto ponto, limpa mascaras inconsistentes.
 * @param {Object[]} accounts
 * @returns {Object[]}
 */
export function normalizeCodes(accounts) {
  return accounts.map((a) => {
    if (a._isOrphanRoot) return a;
    const cleaned = a.code.replace(/[^\d.]/g, '').replace(/\.{2,}/g, '.').replace(/^\./, '').replace(/\.$/, '');
    return cleaned !== a.code ? { ...a, code: cleaned } : a;
  });
}

// ── Export to import format ──────────────────────────────────────────────────

/**
 * Converte workingAccounts de volta para o shape que Status.jsx/coa-mapper.js esperam.
 * Chama ChartOfAccountsMapper.mapAccounts() para garantir compatibilidade total.
 *
 * Shape de saida: { number, name, type, parent(code), level, isSummary, generalRateType, _action }
 *
 * @param {Object[]} workingAccounts
 * @returns {Object[]}
 */
export function exportToImportFormat(workingAccounts) {
  const codeMap = new Map();
  for (const a of workingAccounts) {
    if (!a._isOrphanRoot) {
      codeMap.set(a.clientAccountId, a.code);
    }
  }

  const raw = workingAccounts
    .filter((a) => !a._isOrphanRoot)
    .map((a) => ({
      number: a.code,
      name: a.name,
      type: a.type,
      parent: a.parentClientAccountId ? (codeMap.get(a.parentClientAccountId) || null) : null,
      level: a.level,
      isSummary: !a.isPosting,
      generalRateType: a.generalRateType,
      ...(a._action ? { _action: a._action } : {}),
    }));

  // Rodar pela mesma pipeline que Review.jsx usava para garantir
  // type fallback, isSummary baseado em filhos, generalRateType default
  return ChartOfAccountsMapper.mapAccounts(raw);
}

// ── Compute default expanded ─────────────────────────────────────────────────

/**
 * Retorna set de IDs expandidos por default (level 0 e 1).
 * @param {Object[]} accounts
 * @returns {Set<string>}
 */
export function computeDefaultExpanded(accounts) {
  const ids = new Set();
  for (const a of accounts) {
    if (a.level <= 1 || a._isOrphanRoot) {
      ids.add(a.clientAccountId);
    }
  }
  return ids;
}

// ── Search / filter ──────────────────────────────────────────────────────────

/**
 * Dado um termo de busca, retorna os IDs que batem e os IDs que devem ser expandidos
 * para mostrar os resultados.
 *
 * @param {Object[]} accounts
 * @param {string} query
 * @param {Map<string, Object>} accountMap
 * @returns {{ matchIds: Set<string>, expandIds: Set<string> }}
 */
export function searchAccounts(accounts, query, accountMap) {
  if (!query || query.length < 2) return { matchIds: new Set(), expandIds: new Set() };

  const lower = query.toLowerCase();
  const matchIds = new Set();
  const expandIds = new Set();

  for (const a of accounts) {
    if (a._isOrphanRoot) continue;
    const matchCode = a.code.toLowerCase().includes(lower);
    const matchName = a.name.toLowerCase().includes(lower);
    if (matchCode || matchName) {
      matchIds.add(a.clientAccountId);
      // Expandir todos ancestrais
      let parentId = a.parentClientAccountId;
      while (parentId) {
        expandIds.add(parentId);
        const parent = accountMap.get(parentId);
        parentId = parent?.parentClientAccountId || null;
      }
    }
  }

  return { matchIds, expandIds };
}

/**
 * Hash para comparar rawAccounts (usado no draft).
 * @param {Object[]} rawAccounts
 * @returns {string}
 */
export function hashRawAccounts(rawAccounts) {
  const str = JSON.stringify(rawAccounts.map((a, i) => `${i}|${a.number}|${a.name}`));
  return fnv1aHash(str);
}
