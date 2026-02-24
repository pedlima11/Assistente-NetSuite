const STORAGE_KEY = 'batchProgress';

/**
 * @typedef {Object} BatchProgress
 * @property {string} subsidiaryId
 * @property {number} totalAccounts
 * @property {number} createdAccounts
 * @property {Object<string, string>} accountIdMap - { accountNumber: internalId }
 * @property {number} lastCreatedIndex
 * @property {Array<{index: number, account: string, error: string}>} errors
 */

export class ProgressStore {
  /**
   * Salva progresso no chrome.storage.local
   * @param {BatchProgress} progress
   * @returns {Promise<void>}
   */
  static async save(progress) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: progress }, resolve);
    });
  }

  /**
   * Carrega progresso do chrome.storage.local
   * @returns {Promise<BatchProgress|null>}
   */
  static async load() {
    return new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        resolve(result[STORAGE_KEY] || null);
      });
    });
  }

  /**
   * Limpa progresso salvo
   * @returns {Promise<void>}
   */
  static async clear() {
    return new Promise((resolve) => {
      chrome.storage.local.remove(STORAGE_KEY, resolve);
    });
  }

  /**
   * Verifica se existe operacao incompleta
   * @returns {Promise<boolean>}
   */
  static async hasIncomplete() {
    const progress = await this.load();
    if (!progress) return false;
    return progress.createdAccounts < progress.totalAccounts;
  }
}
