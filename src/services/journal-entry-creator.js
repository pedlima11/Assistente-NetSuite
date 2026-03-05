import { sendToBackground } from '../utils/api-client.js';
import { MessageType } from '../types/messages.js';

/**
 * Busca todas as contas no NetSuite via SuiteQL (mais confiavel que REST filter).
 * Retorna lista flat para dropdowns e mapa por numero para lookups.
 * @param {string} subsidiaryId
 * @returns {Promise<{list: Array, map: Record<string, any>}>}
 */
export async function fetchNetSuiteAccounts(subsidiaryId) {
  const list = [];
  let offset = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const sql = `SELECT a.id, a.acctnumber, a.accountsearchdisplayname AS acctname, a.description, a.issummary FROM account a INNER JOIN AccountSubsidiaryMap asm ON asm.account = a.id WHERE asm.subsidiary = ${subsidiaryId} ORDER BY a.acctnumber`;
    const result = await sendToBackground({
      type: 'SUITEQL_QUERY',
      sql,
      limit: pageSize,
      offset,
    });

    if (result && result.error) {
      throw new Error(result.error);
    }

    const items = result && result.items ? result.items : [];

    if (items.length > 0) {
      for (const item of items) {
        list.push({
          id: String(item.id),
          number: String(item.acctnumber || '').trim(),
          name: item.acctname || '',
          description: item.description || '',
          isSummary: item.issummary === 'T',
        });
      }
      offset += items.length;
      hasMore = result.hasMore === true;
    } else {
      hasMore = false;
    }
  }

  // Mapa por number para lookup rapido
  const map = {};
  for (const acct of list) {
    if (acct.number) {
      map[acct.number] = acct;
    }
  }

  return { list, map };
}

/**
 * Normaliza string para comparacao fuzzy
 * Remove acentos, pontuacao, espacos extras, converte para minusculo
 */
function normalize(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calcula score de similaridade simples entre duas strings normalizadas
 * Retorna valor entre 0 e 1
 */
function similarityScore(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;

  // Verifica se uma contem a outra
  if (a.includes(b) || b.includes(a)) return 0.8;

  // Conta palavras em comum
  const wordsA = a.split(' ').filter(Boolean);
  const wordsB = new Set(b.split(' ').filter(Boolean));
  const common = wordsA.filter((w) => wordsB.has(w)).length;
  const total = Math.max(wordsA.length, wordsB.size);

  return total > 0 ? common / total : 0;
}

/**
 * Sugere a melhor conta NetSuite para cada saldo do arquivo.
 * Estrategia: (1) match exato por numero, (2) match por nome (fuzzy).
 * Retorna balances com campo nsAccountId sugerido (editavel pelo usuario).
 *
 * @param {Array<{number: string, name: string, debit: number, credit: number}>} balances
 * @param {{list: Array, map: Record<string, any>}} nsAccounts
 * @returns {Array<{number: string, name: string, debit: number, credit: number, nsAccountId: string, nsAccountLabel: string, matchType: string}>}
 */
export function suggestAccountMapping(balances, nsAccounts) {
  const detailAccounts = nsAccounts.list.filter((a) => !a.isSummary);

  return balances.map((balance) => {
    // Estrategia 1: match exato por numero
    const exactMatch = nsAccounts.map[balance.number];
    if (exactMatch && !exactMatch.isSummary) {
      return {
        ...balance,
        nsAccountId: exactMatch.id,
        nsAccountLabel: `${exactMatch.number} - ${exactMatch.name}`,
        matchType: 'exact',
      };
    }

    // Estrategia 2: match por nome e descricao (fuzzy)
    const normalizedName = normalize(balance.name);
    let bestMatch = null;
    let bestScore = 0;

    for (const acct of detailAccounts) {
      const nameScore = similarityScore(normalizedName, normalize(acct.name));
      const descScore = acct.description ? similarityScore(normalizedName, normalize(acct.description)) : 0;
      const score = Math.max(nameScore, descScore);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = acct;
      }
    }

    if (bestMatch && bestScore >= 0.5) {
      return {
        ...balance,
        nsAccountId: bestMatch.id,
        nsAccountLabel: `${bestMatch.number} - ${bestMatch.name}`,
        matchType: 'fuzzy',
      };
    }

    // Sem match
    return {
      ...balance,
      nsAccountId: '',
      nsAccountLabel: '',
      matchType: 'none',
    };
  });
}

/**
 * Define saldos iniciais criando um Journal Entry via RESTlet.
 *
 * O campo openingBalance no registro account e somente-leitura apos criacao.
 * A forma correta para contas ja existentes e criar um Journal Entry contra
 * a conta "Saldo Inicial" (Opening Balance Equity).
 *
 * @param {Array} mappedBalances - [{nsAccountId, debit, credit, number, name}]
 * @param {string} trandate - Data do saldo inicial (YYYY-MM-DD)
 * @param {string} subsidiaryId - ID da subsidiary
 * @param {Function} onProgress - Callback (current, total, account)
 * @returns {Promise<{success: boolean, updated: number, journalEntryId: string, errors: Array}>}
 */
export async function setOpeningBalances(mappedBalances, trandate, subsidiaryId, onProgress) {
  // Filtrar contas validas (com ID e saldo > 0)
  const validBalances = mappedBalances.filter((b) => {
    const hasBalance = (b.debit || 0) > 0 || (b.credit || 0) > 0;
    return b.nsAccountId && hasBalance;
  });

  console.log(`[setOpeningBalances] ${validBalances.length}/${mappedBalances.length} contas validas, trandate: ${trandate}, subsidiary: ${subsidiaryId}`);

  if (validBalances.length === 0) {
    return { success: false, updated: 0, errors: [{ index: 0, account: 'N/A', error: 'Nenhuma conta com saldo valido para importar' }] };
  }

  const balancesPayload = validBalances.map((b) => ({
    accountId: b.nsAccountId,
    debit: b.debit || 0,
    credit: b.credit || 0,
  }));

  if (onProgress) onProgress(0, validBalances.length, validBalances[0]);

  try {
    const result = await sendToBackground({
      type: MessageType.SET_OPENING_BALANCES,
      balances: balancesPayload,
      tranDate: trandate,
      subsidiaryId,
    });

    console.log('[setOpeningBalances] Result:', JSON.stringify(result));

    if (onProgress) onProgress(validBalances.length, validBalances.length, validBalances[validBalances.length - 1]);

    const errors = (result.errors || []).map((err) => {
      const original = validBalances.find((b) => b.nsAccountId === err.accountId);
      return {
        index: err.index,
        account: original ? `${original.number} - ${original.name}` : (err.accountId || 'N/A'),
        error: err.error,
      };
    });

    return {
      success: result.success,
      updated: result.linesCreated || result.updated || 0,
      journalEntryId: result.journalEntryId || null,
      errors,
    };
  } catch (err) {
    console.error('[setOpeningBalances] Error:', err.message);
    return {
      success: false,
      updated: 0,
      errors: [{ index: 0, account: 'N/A', error: err.message }],
    };
  }
}
