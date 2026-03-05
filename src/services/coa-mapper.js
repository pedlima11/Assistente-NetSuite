import { AccountType, GeneralRateType, ACCOUNT_TYPE_TO_RATE_TYPE } from '../types/netsuite.js';
import { ProgressStore } from '../utils/progress-store.js';
import { sendToBackground } from '../utils/api-client.js';
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
   * Aplica regras de mapeamento por codigo contabil.
   * Contas que ja possuem type definido pela Claude API sao mantidas.
   * Tambem atribui isSummary e generalRateType automaticamente.
   * @param {Object[]} accounts
   * @returns {Object[]}
   */
  static mapAccounts(accounts) {
    // Primeiro passo: mapear AccountType
    const mapped = accounts.map((account) => {
      const type = account.type
        ? account.type
        : (MAPPING_RULES.find((r) => r.pattern.test(account.number))?.type || AccountType.OthAsset);

      return {
        ...account,
        type,
      };
    });

    // Segundo passo: detectar contas consolidadoras (summary)
    // Uma conta e consolidadora se tem filhos na lista
    const parentNumbers = new Set(
      mapped.filter((a) => a.parent).map((a) => a.parent)
    );

    // Terceiro passo: atribuir isSummary e generalRateType
    return mapped.map((account) => {
      // isSummary: se a conta tem filhos OU se ja veio marcada pela Claude
      const isSummary = account.isSummary === true || parentNumbers.has(account.number);

      // generalRateType: baseado no AccountType (CPC 02 / IAS 21)
      const generalRateType = account.generalRateType
        || ACCOUNT_TYPE_TO_RATE_TYPE[account.type]
        || GeneralRateType.Current;

      return {
        ...account,
        isSummary,
        generalRateType,
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
  static validate(accounts, existingAccountNumbers = new Set()) {
    const errors = [];
    const warnings = [];
    const numbers = new Set(accounts.map((a) => a.number));
    const parentNumbers = new Set(
      accounts.filter((a) => a.parent).map((a) => a.parent)
    );

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

      // Verificar nome > 60 caracteres (limite NetSuite)
      if (account.name && account.name.length > 60) {
        errors.push(`Conta ${account.number}: nome tem ${account.name.length} chars (max 60)`);
      }

      // Verificar conta ja existente no NetSuite
      if (existingAccountNumbers.has(account.number) && account._action !== 'skip' && account._action !== 'update') {
        warnings.push(`Conta ${account.number} (${account.name}): ja existe no NetSuite`);
      }

      // Aviso: conta tem filhos mas nao esta marcada como summary
      if (parentNumbers.has(account.number) && !account.isSummary) {
        warnings.push(`Conta ${account.number} (${account.name}): tem filhos mas nao esta marcada como consolidadora`);
      }

      // Aviso: conta marcada como summary mas nao tem filhos
      if (account.isSummary && !parentNumbers.has(account.number)) {
        warnings.push(`Conta ${account.number} (${account.name}): marcada como consolidadora mas nao tem filhos`);
      }

      // Aviso: generalRateType inconsistente com o tipo da conta
      if (account.generalRateType) {
        const expectedRate = ACCOUNT_TYPE_TO_RATE_TYPE[account.type];
        if (expectedRate && account.generalRateType !== expectedRate) {
          warnings.push(`Conta ${account.number} (${account.name}): generalRateType "${account.generalRateType}" difere do padrao "${expectedRate}" para tipo ${account.type}`);
        }
      }
    }

    // Verificar ciclos
    const hasCycle = ChartOfAccountsMapper._detectCycle(accounts);
    if (hasCycle) {
      errors.push('Detectado ciclo na hierarquia de contas');
    }

    return { valid: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
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
   * Cria/atualiza contas em lote no NetSuite, sequencialmente na ordem topologica.
   * Salva checkpoint apos cada conta. Respeita _action: 'skip' | 'update' | 'create'.
   * Usa isValidCheckpoint para decidir se retoma ou comeca do zero.
   * @param {Object[]} accounts - Contas ja ordenadas topologicamente
   * @param {string} subsidiaryId
   * @param {string} importKey - hash do shape do COA (computeImportKey)
   * @param {Function} onProgress - Callback (createdCount, total, currentAccount)
   * @param {Object} existingAccountsMap - { acctnumber: { id, acctnumber, acctname } }
   * @returns {Promise<{success: boolean, created: number, updated: number, skipped: number, errors: Object[], done: number, total: number}>}
   */
  static async createAccountsBatch(accounts, subsidiaryId, importKey, onProgress, existingAccountsMap = {}) {
    // Carregar checkpoint existente — validacao central
    let progress = await ProgressStore.load();
    const sid = String(subsidiaryId);

    if (!ProgressStore.isValidCheckpoint(progress, { subsidiaryId: sid, importKey })) {
      progress = ProgressStore.makeFresh({ subsidiaryId: sid, importKey, totalAccounts: accounts.length });
    }

    const startIndex = progress.lastCreatedIndex + 1;

    for (let i = startIndex; i < accounts.length; i++) {
      const account = accounts[i];
      const action = account._action || 'create';

      // Pular contas marcadas como skip
      if (action === 'skip') {
        // Se a conta existe no NetSuite, registrar o ID no mapa para resolver parents
        const existing = existingAccountsMap[account.number];
        if (existing) {
          progress.accountIdMap[account.number] = existing.id;
        }
        progress.skippedAccounts = (progress.skippedAccounts || 0) + 1;
        progress.lastCreatedIndex = i;
        await ProgressStore.save(progress);
        if (onProgress) onProgress(progress.createdAccounts + (progress.updatedAccounts || 0), accounts.length, account);
        continue;
      }

      // Resolver parent para internalId
      let parentInternalId = null;
      if (account.parent && progress.accountIdMap[account.parent]) {
        parentInternalId = progress.accountIdMap[account.parent];
      }

      try {
        const body = {
          acctName: account.name,
          acctNumber: account.number,
          acctType: account.type,
          subsidiary: { items: [{ id: subsidiaryId }] },
          ...(parentInternalId ? { parent: { id: parentInternalId } } : {}),
        };

        // Conta consolidadora: nao recebe lancamentos diretos
        if (account.isSummary) {
          body.isSummary = true;
        }

        // Tipo de taxa geral para conversao cambial (multi-moeda)
        if (account.generalRateType) {
          body.generalRateType = account.generalRateType;
        }

        let result;
        if (action === 'update') {
          // Atualizar conta existente via PATCH
          const existing = existingAccountsMap[account.number];
          if (!existing) {
            throw new Error('Conta marcada para update mas nao encontrada no NetSuite');
          }
          result = await sendToBackground({
            type: MessageType.NETSUITE_API_REQUEST,
            method: 'PATCH',
            endpoint: `/account/${existing.id}`,
            body,
          });
          progress.accountIdMap[account.number] = existing.id;
          progress.updatedAccounts = (progress.updatedAccounts || 0) + 1;
        } else {
          // Criar nova conta via POST
          result = await sendToBackground({
            type: MessageType.NETSUITE_API_REQUEST,
            method: 'POST',
            endpoint: '/account',
            body,
          });
          if (result && result.internalId) {
            progress.accountIdMap[account.number] = result.internalId;
          }
          progress.createdAccounts++;
        }

        progress.lastCreatedIndex = i;
        await ProgressStore.save(progress);

        if (onProgress) {
          onProgress(progress.createdAccounts + (progress.updatedAccounts || 0), accounts.length, account);
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
          onProgress(progress.createdAccounts + (progress.updatedAccounts || 0), accounts.length, account);
        }
      }
    }

    return {
      success: progress.errors.length === 0,
      created: progress.createdAccounts,
      updated: progress.updatedAccounts,
      skipped: progress.skippedAccounts,
      errors: progress.errors,
      done: progress.lastCreatedIndex + 1,
      total: progress.totalAccounts,
    };
  }
}
