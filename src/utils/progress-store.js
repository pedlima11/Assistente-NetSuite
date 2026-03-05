import { deterministicHash } from '../../shared/canonical.js';

const STORAGE_KEY = 'batchProgress';
const CHECKPOINT_VERSION = 1;

const isPlainObject = (o) =>
  o && typeof o === 'object' && !Array.isArray(o) && Object.getPrototypeOf(o) === Object.prototype;

/**
 * @typedef {Object} BatchProgress
 * @property {number} checkpointVersion
 * @property {string} subsidiaryId
 * @property {string} importKey - hash deterministico do shape do COA
 * @property {number} totalAccounts
 * @property {number} createdAccounts
 * @property {number} updatedAccounts
 * @property {number} skippedAccounts
 * @property {Object<string, string>} accountIdMap - { accountNumber: internalId }
 * @property {number} lastCreatedIndex - >= -1
 * @property {Array<{index: number, account: string, error: string}>} errors
 * @property {string} startedAt - ISO string
 */

/**
 * Gera importKey deterministico a partir do shape do COA.
 * NAO inclui subsidiaryId (validado separadamente em isValidCheckpoint).
 * @param {Object[]} accounts
 * @returns {string} 16 hex chars
 */
export function computeImportKey(accounts) {
  const shapes = accounts
    .map((a) => ({
      n: String(a.number || ''),
      p: String(a.parent || ''),
      t: String(a.type || ''),
      post: !!a.isPosting,
      act: String(a._action || ''),
      name: String(a.name || ''),
    }))
    .sort((x, y) => x.n.localeCompare(y.n));
  return deterministicHash(JSON.stringify(shapes));
}

export class ProgressStore {
  /**
   * Salva progresso no localStorage
   * @param {BatchProgress} progress
   * @returns {Promise<void>}
   */
  static async save(progress) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  }

  /**
   * Carrega progresso do localStorage
   * @returns {Promise<BatchProgress|null>}
   */
  static async load() {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  }

  /**
   * Limpa progresso salvo
   * @returns {Promise<void>}
   */
  static async clear() {
    localStorage.removeItem(STORAGE_KEY);
  }

  /**
   * Valida se um checkpoint e estruturalmente completo e corresponde ao import atual.
   * @param {BatchProgress|null} progress
   * @param {{ subsidiaryId: string, importKey: string }} ctx
   * @returns {boolean}
   */
  static isValidCheckpoint(progress, { subsidiaryId, importKey }) {
    if (!progress || !isPlainObject(progress)) return false;
    if (progress.checkpointVersion !== CHECKPOINT_VERSION) return false;
    if (String(progress.subsidiaryId) !== String(subsidiaryId)) return false;
    if (progress.importKey !== importKey) return false;
    if (!Array.isArray(progress.errors)) return false;
    if (!Number.isFinite(progress.lastCreatedIndex) || progress.lastCreatedIndex < -1) return false;
    if (!isPlainObject(progress.accountIdMap)) return false;
    if (!Number.isFinite(progress.totalAccounts) || progress.totalAccounts < 0) return false;
    if (!Number.isFinite(progress.createdAccounts) || progress.createdAccounts < 0) return false;
    if (!Number.isFinite(progress.updatedAccounts) || progress.updatedAccounts < 0) return false;
    if (!Number.isFinite(progress.skippedAccounts) || progress.skippedAccounts < 0) return false;
    return true;
  }

  /**
   * Cria checkpoint novo com todos os campos inicializados.
   * @param {{ subsidiaryId: string, importKey: string, totalAccounts: number }} opts
   * @returns {BatchProgress}
   */
  static makeFresh({ subsidiaryId, importKey, totalAccounts }) {
    return {
      checkpointVersion: CHECKPOINT_VERSION,
      subsidiaryId: String(subsidiaryId),
      importKey,
      totalAccounts,
      createdAccounts: 0,
      updatedAccounts: 0,
      skippedAccounts: 0,
      accountIdMap: {},
      lastCreatedIndex: -1,
      errors: [],
      startedAt: new Date().toISOString(),
    };
  }

  /**
   * Verifica se existe operacao incompleta para o import atual.
   * Requer contexto — nao retorna true para checkpoints de outros imports.
   * @param {{ subsidiaryId: string, importKey: string }} ctx
   * @returns {Promise<boolean>}
   */
  static async hasIncomplete({ subsidiaryId, importKey }) {
    const p = await this.load();
    if (!this.isValidCheckpoint(p, { subsidiaryId, importKey })) return false;
    return (p.lastCreatedIndex + 1) < p.totalAccounts;
  }
}
