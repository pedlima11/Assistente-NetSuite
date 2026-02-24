import { AccountType } from './netsuite.js';

/**
 * @typedef {Object} Account
 * @property {string} number - Codigo contabil (ex: 1.1.0.0)
 * @property {string} name - Nome da conta
 * @property {string} type - Valor do AccountType
 * @property {string|null} parent - Numero da conta pai
 * @property {number} level - Nivel hierarquico (0 = raiz)
 * @property {string|null} subsidiaryId - InternalId da subsidiary no NetSuite
 */

/**
 * Cria um objeto Account com valores padrao
 * @returns {Account}
 */
export function createAccountTemplate() {
  return {
    number: '',
    name: '',
    type: AccountType.OthAsset,
    parent: null,
    level: 0,
    subsidiaryId: null,
  };
}
