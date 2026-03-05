/**
 * Tipos de mensagens para comunicacao entre side panel e service worker
 */
export const MessageType = Object.freeze({
  STRUCTURE_DATA: 'STRUCTURE_DATA',
  CREATE_SUBSIDIARY: 'CREATE_SUBSIDIARY',
  CREATE_ACCOUNTS: 'CREATE_ACCOUNTS',
  CLAUDE_API_REQUEST: 'CLAUDE_API_REQUEST',
  NETSUITE_API_REQUEST: 'NETSUITE_API_REQUEST',
  GET_CREDENTIALS: 'GET_CREDENTIALS',
  SAVE_CREDENTIALS: 'SAVE_CREDENTIALS',
  GET_PROGRESS: 'GET_PROGRESS',
  ACCOUNT_CREATED: 'ACCOUNT_CREATED',
  FETCH_LOOKUP_DATA: 'FETCH_LOOKUP_DATA',
  TAX_DISCOVERY: 'TAX_DISCOVERY',
  CREATE_TAX_RULES: 'CREATE_TAX_RULES',
  CREATE_CUSTOMERS: 'CREATE_CUSTOMERS',
  CUSTOMER_LOOKUP_DATA: 'CUSTOMER_LOOKUP_DATA',
  CREATE_VENDORS: 'CREATE_VENDORS',
  ITEM_LOOKUP_DATA: 'ITEM_LOOKUP_DATA',
  SEARCH_NCM: 'SEARCH_NCM',
  BATCH_SEARCH_NCM: 'BATCH_SEARCH_NCM',
  CREATE_ITEMS: 'CREATE_ITEMS',
  SET_OPENING_BALANCES: 'SET_OPENING_BALANCES',
  ANALYZE_TAX_RULES: 'ANALYZE_TAX_RULES',
  RESOLVE_TAX_CONFLICT: 'RESOLVE_TAX_CONFLICT',
});

/**
 * @typedef {Object} StructureDataMessage
 * @property {'STRUCTURE_DATA'} type
 * @property {Object} data - Dados JSON pre-parseados do Excel
 */

/**
 * @typedef {Object} CreateSubsidiaryMessage
 * @property {'CREATE_SUBSIDIARY'} type
 * @property {import('./subsidiary.js').Subsidiary} data
 */

/**
 * @typedef {Object} CreateAccountsMessage
 * @property {'CREATE_ACCOUNTS'} type
 * @property {import('./account.js').Account[]} accounts
 * @property {string} subsidiaryId
 */
