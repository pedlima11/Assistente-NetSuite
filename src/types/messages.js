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
