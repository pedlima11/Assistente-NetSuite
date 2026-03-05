/**
 * Funcoes canonicas para IDs estaveis, hashing e normalizacao.
 *
 * PURO JS — sem import de crypto, sem dependencias de browser ou Node.
 * Importado pelo frontend (tax-rule-generator.js) e backend (sped-rule-accumulator.js).
 */

import { classifyCFOP } from './tax-rule-core.js';

// ── Hash deterministico (FNV-1a double-pass, 16 hex chars) ──────────────────

/**
 * Hash sincrono, browser+Node, sem crypto.
 * FNV-1a double-pass produz 16 hex chars (64 bits efetivos).
 *
 * @param {string} str
 * @returns {string} 16 hex chars
 */
export function deterministicHash(str) {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ (c + i), 0x01000193);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

// ── Stable IDs com deteccao de colisao ──────────────────────────────────────

/**
 * Gera ID estavel a partir de uma chave canonica.
 * Detecta colisao e resolve com sufixo deterministico (#1, #2...).
 * Mesma sequencia de insercao → mesmos IDs.
 *
 * @param {string} canonicalKey
 * @param {Set<string>} usedIds - Set compartilhado durante toda a geracao
 * @returns {string} 16 hex chars
 */
export function stableIdWithCollisionCheck(canonicalKey, usedIds) {
  let id = deterministicHash(canonicalKey);
  let suffix = 0;
  while (usedIds.has(id)) {
    suffix++;
    id = deterministicHash(canonicalKey + '#' + suffix);
  }
  usedIds.add(id);
  return id;
}

/**
 * Gera ID estavel para uma determinacao (linha de imposto).
 * Normaliza tipoParametro e aliquota para evitar colisoes espurias.
 *
 * @param {string} ruleCanonicalKey - Chave canonica da regra pai
 * @param {string} taxCode - Ex: 'ICMS_BR'
 * @param {string} tipoParametro - Ex: 'CST 00 - Tributado integralmente'
 * @param {string} cst - Ex: '00'
 * @param {number|string} aliq - Ex: 18 ou '18.0000'
 * @param {Set<string>} usedIds
 * @returns {string}
 */
export function stableDetId(ruleCanonicalKey, taxCode, tipoParametro, cst, aliq, usedIds) {
  const normTipo = (tipoParametro || '').trim().replace(/\s+/g, ' ');
  const normAliq = parseFloat(aliq || 0).toFixed(4);
  const key = [ruleCanonicalKey, taxCode, normTipo, cst || '', normAliq].join(':');
  return stableIdWithCollisionCheck(key, usedIds);
}

// ── Canonical Rule Key (para externalId, intra-source) ──────────────────────

/**
 * Gera chave canonica para uma regra.
 * Identica para SPED e XML quando os campos semanticos coincidem.
 * NAO e chave cross-source — para isso usar canonicalMatchKey.
 *
 * @param {Object} meta - { cfop, emitUF, destUF, regimeEmissor, lobEmissor }
 * @param {Object} config - { regimeDestinatario, lobDestinatario }
 * @param {boolean} isException
 * @param {string} [taxSignature] - Assinatura fiscal (para excecoes)
 * @param {string} [ncm] - NCM (para excecoes por NCM)
 * @returns {string}
 */
export function canonicalRuleKey(meta, config, isException, taxSignature, ncm) {
  const cfop = (meta.cfop || '').replace(/\./g, '');
  if (!/^\d{4}$/.test(cfop)) {
    return ['invalid', cfop, isException ? 'exc' : 'gen'].join('|');
  }

  const emitUF = (meta.emitUF || '').toUpperCase().trim();
  const destUF = (meta.destUF || '').toUpperCase().trim();
  const regimeEmissor = (meta.regimeEmissor || 'unknown').trim();
  const regimeDest = (config.regimeDestinatario || 'unknown').trim();
  const lobEmissor = (meta.lobEmissor || '').trim();
  const lobDest = (config.lobDestinatario || '').trim();

  const parts = [cfop, emitUF, destUF, regimeEmissor, regimeDest, lobEmissor, lobDest];
  if (isException) {
    parts.push('exc', taxSignature || '', ncm || '');
  }
  return parts.join('|');
}

// ── Canonical Match Key (cross-source, para comparacao SPED vs XML) ─────────

/**
 * Gera chave para comparacao cross-source (SPED vs XML).
 * Usa operationType/direction da regra se ja existir, evitando
 * divergencia caso classifyCFOP mude no futuro.
 *
 * @param {Object} meta - { cfop, emitUF, destUF, operationType?, direction? }
 * @returns {string}
 */
export function canonicalMatchKey(meta) {
  const cfop = (meta.cfop || '').replace(/\./g, '');

  if (!/^\d{4}$/.test(cfop)) {
    return ['invalid', cfop, 'unknown', 'unknown', 'Outros', 'unknown'].join('|');
  }

  const operationType = meta.operationType || classifyCFOP(cfop).operationType;
  const first = parseInt(cfop[0], 10);
  const direction = meta.direction || ([1, 2, 3].includes(first) ? 'entrada' : 'saida');

  const emitUF = (meta.emitUF || '').toUpperCase().trim();
  const destUF = (meta.destUF || '').toUpperCase().trim();

  return [cfop, emitUF, destUF, operationType, direction].join('|');
}

// ── Canonicalize (normalizacao deterministico para cache/hash) ───────────────

const ARRAY_SORT_KEY = 'key';
const SORT_OVERRIDES = {
  rules: 'externalId',
  determinations: 'externalId',
  issues: 'id',
  proposedChanges: 'id',
};
const EXCLUDED_FIELDS = new Set(['sampleDocs', 'firstSeen', 'lastSeen', '_timestamp']);

/**
 * Normaliza um objeto para forma canonica deterministica.
 * - Strings: trim
 * - Numbers: toFixed(4)
 * - Arrays: sorted por chave especifica (SORT_OVERRIDES ou 'key')
 * - Objects: chaves sorted alfabeticamente
 * - Campos em EXCLUDED_FIELDS: removidos
 *
 * @param {*} obj
 * @param {string|null} parentKey - Nome do campo pai (para resolver sort key)
 * @returns {*}
 */
export function canonicalize(obj, parentKey) {
  if (obj === null || obj === undefined) return null;
  if (typeof obj === 'number') return parseFloat(obj.toFixed(4));
  if (typeof obj === 'string') return obj.trim();
  if (typeof obj === 'boolean') return obj;

  if (Array.isArray(obj)) {
    const items = obj.map((item) => canonicalize(item, parentKey));
    const sortKey = SORT_OVERRIDES[parentKey] || ARRAY_SORT_KEY;
    if (items.length > 0 && items[0] && typeof items[0] === 'object' && sortKey in items[0]) {
      items.sort((a, b) => String(a[sortKey] || '').localeCompare(String(b[sortKey] || '')));
    }
    return items;
  }

  const sortedKeys = Object.keys(obj).sort();
  const result = {};
  for (const key of sortedKeys) {
    if (EXCLUDED_FIELDS.has(key)) continue;
    result[key] = canonicalize(obj[key], key);
  }
  return result;
}
