import { AccountType, GeneralRateType } from './netsuite.js';

/**
 * @typedef {Object} Account
 * @property {string} number - Codigo contabil (ex: 1.1.0.0)
 * @property {string} name - Nome da conta
 * @property {string} type - Valor do AccountType
 * @property {string|null} parent - Numero da conta pai
 * @property {number} level - Nivel hierarquico (0 = raiz)
 * @property {string|null} subsidiaryId - InternalId da subsidiary no NetSuite
 * @property {boolean} isSummary - Conta consolidadora (nao recebe lancamentos diretos)
 * @property {string} generalRateType - Tipo de taxa geral para conversao cambial (Current/Average/Historical)
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
    isSummary: false,
    generalRateType: GeneralRateType.Current,
  };
}
