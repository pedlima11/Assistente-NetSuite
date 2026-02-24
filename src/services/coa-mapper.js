import { AccountType } from '../types/netsuite.js';
import { ProgressStore } from '../utils/progress-store.js';
import { sendToBackground } from '../utils/chrome-messaging.js';
import { MessageType } from '../types/messages.js';

/**
 * Regras de mapeamento de codigo contabil brasileiro para AccountType do NetSuite
 */
const MAPPING_RULES = [
  { pattern: /^1\.1\.1/, type: AccountType.Bank },
  { pattern: /^1\.1\.2/, type: AccountType.AcctRec },
  { pattern: /^1\.1/,   type: AccountType.OthCurrAsset },
  { pattern: /^1\.2/,   type: AccountType.FixedAsset },
  { pattern: /^1/,      type: AccountType.OthAsset },
  { pattern: /^2\.1\.1/, type: AccountType.AcctPay },
  { pattern: /^2\.1/,   type: AccountType.OthCurrLiab },
  { pattern: /^2\.2/,   type: AccountType.LongTermLiab },
  { pattern: /^2/,      type: AccountType.OthCurrLiab },
  { pattern: /^3/,      type: AccountType.Equity },
  { pattern: /^4/,      type: AccountType.Income },
  { pattern: /^5/,      type: AccountType.COGS },
  { pattern: /^6/,      type: AccountType.Expense },
];

export class ChartOfAccountsMapper {
  /**
   * Aplica regras de mapeamento por codigo contabil
   * Contas que ja possuem type definido pela Claude API sao mantidas
   * @param {Object[]} accounts
   * @returns {Object[]}
   */
  static mapAccounts(accounts) {
    return accounts.map((account) => {
      if (account.type) return account;

      const rule = MAPPING_RULES.find((r) => r.pattern.test(account.number));
      return {
        ...account,
        type: rule ? rule.type : AccountType.OthAsset,
      };
    });
  }

  /**
   * Ordena contas topologicamente — pais antes de filhos
   * @param {Object[]} accounts
   * @returns {Object[]}
   */
  static topologicalSort(accounts) {
    const accountMap = new Map();
    accounts.forEach((acc) => accountMap.set(acc.number, acc));

    const sorted = [];
    const visited = new Set();

    function visit(account) {
      if (visited.has(account.number)) return;

      // Se tem pai, visitar o pai primeiro
      if (account.parent && accountMap.has(account.parent)) {
        visit(accountMap.get(account.parent));
      }

      visited.add(account.number);
      sorted.push(account);
    }

    accounts.forEach((acc) => visit(acc));
    return sorted;
  }

  /**
   * Valida a lista de contas
   * @param {Object[]} accounts
   * @returns {{ valid: boolean, errors: string[] }}
   */
  static validate(accounts) {
    const errors = [];
    const numbers = new Set(accounts.map((a) => a.number));

    for (const account of accounts) {
      // Verificar pai orfao
      if (account.parent && !numbers.has(account.parent)) {
        errors.push(`Conta ${account.number} (${account.name}): pai "${account.parent}" nao encontrado`);
      }

      // Verificar tipo mapeado
      if (!account.type) {
        errors.push(`Conta ${account.number} (${account.name}): tipo nao mapeado`);
      }

      // Verificar numero duplicado
      const duplicates = accounts.filter((a) => a.number === account.number);
      if (duplicates.length > 1) {
        errors.push(`Conta ${account.number}: numero duplicado`);
      }
    }

    // Verificar ciclos
    const hasCycle = ChartOfAccountsMapper._detectCycle(accounts);
    if (hasCycle) {
      errors.push('Detectado ciclo na hierarquia de contas');
    }

    return { valid: errors.length === 0, errors: [...new Set(errors)] };
  }

  /**
   * Detecta ciclos na hierarquia de contas
   * @param {Object[]} accounts
   * @returns {boolean}
   */
  static _detectCycle(accounts) {
    const accountMap = new Map();
    accounts.forEach((acc) => accountMap.set(acc.number, acc));

    for (const account of accounts) {
      const visited = new Set();
      let current = account;

      while (current && current.parent) {
        if (visited.has(current.number)) return true;
        visited.add(current.number);
        current = accountMap.get(current.parent);
      }
    }

    return false;
  }

  /**
   * Cria contas em lote no NetSuite, sequencialmente na ordem topologica
   * Salva checkpoint apos cada conta criada
   * @param {Object[]} accounts - Contas ja ordenadas topologicamente
   * @param {string} subsidiaryId
   * @param {Function} onProgress - Callback (createdCount, total, currentAccount)
   * @returns {Promise<{success: boolean, created: number, errors: Object[]}>}
   */
  static async createAccountsBatch(accounts, subsidiaryId, onProgress) {
    // Carregar checkpoint existente
    let progress = await ProgressStore.load();

    if (!progress || progress.subsidiaryId !== subsidiaryId) {
      progress = {
        subsidiaryId,
        totalAccounts: accounts.length,
        createdAccounts: 0,
        accountIdMap: {},
        lastCreatedIndex: -1,
        errors: [],
      };
    }

    const startIndex = progress.lastCreatedIndex + 1;

    for (let i = startIndex; i < accounts.length; i++) {
      const account = accounts[i];

      // Resolver parent para internalId
      let parentInternalId = null;
      if (account.parent && progress.accountIdMap[account.parent]) {
        parentInternalId = progress.accountIdMap[account.parent];
      }

      try {
        const result = await sendToBackground({
          type: MessageType.NETSUITE_API_REQUEST,
          method: 'POST',
          endpoint: '/account',
          body: {
            acctName: account.name,
            acctNumber: account.number,
            acctType: account.type,
            subsidiary: { items: [{ id: subsidiaryId }] },
            ...(parentInternalId ? { parent: { id: parentInternalId } } : {}),
          },
        });

        // Salvar internalId no mapa
        if (result && result.internalId) {
          progress.accountIdMap[account.number] = result.internalId;
        }

        progress.createdAccounts++;
        progress.lastCreatedIndex = i;

        // Salvar checkpoint
        await ProgressStore.save(progress);

        if (onProgress) {
          onProgress(progress.createdAccounts, accounts.length, account);
        }
      } catch (error) {
        progress.errors.push({
          index: i,
          account: `${account.number} - ${account.name}`,
          error: error.message,
        });

        progress.lastCreatedIndex = i;
        await ProgressStore.save(progress);

        if (onProgress) {
          onProgress(progress.createdAccounts, accounts.length, account);
        }
      }
    }

    return {
      success: progress.errors.length === 0,
      created: progress.createdAccounts,
      errors: progress.errors,
    };
  }
}
