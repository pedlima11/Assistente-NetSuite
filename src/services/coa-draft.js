/**
 * Persistencia de rascunho do modelador de Plano de Contas.
 * Salva em localStorage com schema versioning e hash de validacao.
 */

import { hashRawAccounts } from './coa-modeling.js';

const DRAFT_KEY = 'coaDraft';
const DRAFT_SCHEMA_VERSION = 1;

export const COADraft = {
  /**
   * Salva rascunho do modelador.
   * @param {Object} state
   * @param {Object[]} state.workingAccounts
   * @param {Set<string>} state.expandedIds
   * @param {Set<string>} state.selectedIds
   * @param {Object[]} state.rawAccounts - para gerar hash de validacao
   */
  save(state) {
    const draft = {
      schemaVersion: DRAFT_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      rawHash: hashRawAccounts(state.rawAccounts),
      workingAccounts: state.workingAccounts,
      uiState: {
        expandedIds: [...state.expandedIds],
        selectedIds: [...state.selectedIds],
      },
    };
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      return true;
    } catch (e) {
      console.warn('Falha ao salvar rascunho COA:', e.message);
      return false;
    }
  },

  /**
   * Carrega rascunho se valido (schema + hash batem).
   * @param {Object[]} rawAccounts - raw accounts atual para validar hash
   * @returns {{ workingAccounts: Object[], expandedIds: Set<string>, selectedIds: Set<string> } | null}
   */
  load(rawAccounts) {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;

      const draft = JSON.parse(raw);

      // Validar schema version
      if (draft.schemaVersion !== DRAFT_SCHEMA_VERSION) {
        console.warn('Draft schema incompativel, descartando');
        COADraft.clear();
        return null;
      }

      // Validar hash do raw (arquivo mudou?)
      const currentHash = hashRawAccounts(rawAccounts);
      if (draft.rawHash !== currentHash) {
        console.warn('Draft rawHash nao bate (arquivo diferente), descartando');
        COADraft.clear();
        return null;
      }

      // Validar integridade minima
      if (!Array.isArray(draft.workingAccounts) || draft.workingAccounts.length === 0) {
        COADraft.clear();
        return null;
      }

      return {
        workingAccounts: draft.workingAccounts,
        expandedIds: new Set(draft.uiState?.expandedIds || []),
        selectedIds: new Set(draft.uiState?.selectedIds || []),
      };
    } catch (e) {
      console.warn('Erro ao carregar rascunho COA:', e.message);
      COADraft.clear();
      return null;
    }
  },

  clear() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // ignore
    }
  },
};
