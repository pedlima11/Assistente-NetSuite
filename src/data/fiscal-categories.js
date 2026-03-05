/**
 * Fiscal Item Categories — classificacao intermediaria entre NCM e NAT_BC_CRED.
 *
 * Cada categoria mapeia para um NAT_BC_CRED default (Tabela 4.3.7).
 * O consultor pode sobrescrever via configuracao por cliente.
 *
 * Usado pelo sped-contrib-normalizer para resolver NAT_BC_CRED
 * quando o registro SPED nao fornece explicitamente.
 */

// ── Categorias fiscais ──────────────────────────────────────────────────────

export const FISCAL_CATEGORIES = {
  REV:    { code: 'REV',    label: 'Revenda',                           natDefault: '01' },
  IN_B:   { code: 'IN_B',   label: 'Insumo - Bens',                     natDefault: '02' },
  IN_S:   { code: 'IN_S',   label: 'Insumo - Serviços',                 natDefault: '03' },
  ENE:    { code: 'ENE',    label: 'Energia',                            natDefault: '04' },
  ALG_P:  { code: 'ALG_P',  label: 'Aluguéis de prédios',               natDefault: '05' },
  ALG_M:  { code: 'ALG_M',  label: 'Aluguéis de máquinas/equipamentos', natDefault: '06' },
  FRT:    { code: 'FRT',    label: 'Frete / Armazenagem',               natDefault: '07' },
  FA_DEP: { code: 'FA_DEP', label: 'Ativo Imobilizado — Depreciação',   natDefault: '09' },
  FA_AMO: { code: 'FA_AMO', label: 'Ativo Imobilizado — Amortização',   natDefault: '10' },
  OTH:    { code: 'OTH',    label: 'Outros / Não classificado',         natDefault: null },
};

// ── Mapeamento default: category → NAT_BC_CRED ─────────────────────────────

export const DEFAULT_CATEGORY_TO_NAT = Object.fromEntries(
  Object.values(FISCAL_CATEGORIES)
    .filter(c => c.natDefault != null)
    .map(c => [c.code, c.natDefault])
);

// ── Sugestao automatica: classifyCFOP().itemCategory → fiscalCategory ───────
// Usado como heuristica inicial; consultor valida na UI.

export const ITEM_CATEGORY_TO_FISCAL = {
  'Mercadoria':                  'REV',
  'Mercadoria Industrializacao': 'IN_B',
  'Servico Transporte':          'FRT',
  'Servico':                     'IN_S',
  'Energia/Comunicacao':         'ENE',
  'Ativo Fixo':                  'FA_DEP',
  'Material Uso/Consumo':        'IN_B',
  'Mercadoria ST':               'REV',
  'Outros':                      'OTH',
};

// ── CSTs de credito PIS/COFINS ──────────────────────────────────────────────
// Set configuravel — default: 50-66.
// Internamente tratado como Set<string> (nunca range).

const DEFAULT_CREDIT_CST_LIST = [
  '50', '51', '52', '53', '54', '55', '56',
  '60', '61', '62', '63', '64', '65', '66',
];

/**
 * Verifica se um CST de PIS/COFINS eh CST de credito.
 *
 * @param {string} cst
 * @param {Set<string>|string[]} [customList] - Lista custom de CSTs de credito (sobrescreve default)
 * @returns {boolean}
 */
export function isPisCofinsCreditCst(cst, customList) {
  if (!cst) return false;
  const s = String(cst).trim();
  if (customList) {
    const set = customList instanceof Set ? customList : new Set(customList);
    return set.has(s);
  }
  return DEFAULT_CREDIT_CST_SET.has(s);
}

const DEFAULT_CREDIT_CST_SET = new Set(DEFAULT_CREDIT_CST_LIST);

/**
 * Retorna a lista default de CSTs de credito como array (para persistencia/UI).
 * @returns {string[]}
 */
export function getDefaultCreditCstList() {
  return [...DEFAULT_CREDIT_CST_LIST];
}

/**
 * Sugere fiscalCategory a partir do itemCategory do classifyCFOP().
 *
 * @param {string} itemCategory - Valor de classifyCFOP().itemCategory
 * @returns {string|null} Codigo da fiscalCategory sugerida, ou null se nao mapeado
 */
export function suggestFiscalCategory(itemCategory) {
  return ITEM_CATEGORY_TO_FISCAL[itemCategory] || null;
}

/**
 * Resolve NAT_BC_CRED a partir de fiscalCategory + config do cliente.
 *
 * @param {string} fiscalCategory - Ex: 'REV', 'IN_B'
 * @param {Object} [categoryToNat] - Mapeamento custom do cliente (sobrescreve default)
 * @returns {{ nat: string|null, natMissing: boolean, natSource: string }}
 */
export function resolveNatFromCategory(fiscalCategory, categoryToNat) {
  if (!fiscalCategory) {
    return { nat: null, natMissing: true, natSource: 'missing' };
  }

  const mapping = categoryToNat || DEFAULT_CATEGORY_TO_NAT;
  const nat = mapping[fiscalCategory] ?? null;

  if (nat) {
    return { nat, natMissing: false, natSource: 'category_mapping' };
  }

  return { nat: null, natMissing: true, natSource: 'missing' };
}
