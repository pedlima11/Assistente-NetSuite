/**
 * Mapeamento automatico de colunas do arquivo para campos NetSuite Item.
 * Campos suportados: itemId, incomeAccount, assetAccount, cogsAccount, costingMethod.
 */

const FIELD_MAPPINGS = [
  {
    nsField: 'itemId',
    label: 'Nome do Item (ID unico)',
    heuristics: ['nome', 'nome item', 'nome do item', 'nome produto', 'produto', 'descricao', 'descrição', 'item name', 'product name', 'codigo', 'código', 'cod', 'sku', 'item id', 'item code', 'ref', 'referencia', 'referência', 'cod item', 'codigo item', 'código item', 'cod produto', 'codigo produto'],
    priority: 1,
  },
  {
    nsField: 'displayName',
    label: 'Nome de Exibicao',
    heuristics: ['display name', 'nome exibicao', 'nome de exibicao', 'nome exibição', 'nome de exibição', 'displayname'],
    priority: 2,
  },
  {
    nsField: 'ncmCode',
    label: 'NCM',
    heuristics: ['ncm', 'codigo ncm', 'código ncm', 'ncm code', 'ncm sh', 'ncm/sh', 'classificacao fiscal', 'classificação fiscal'],
    priority: 3,
  },
  {
    nsField: 'cestCode',
    label: 'CEST',
    heuristics: ['cest', 'codigo cest', 'código cest', 'cest code'],
    priority: 4,
  },
  {
    nsField: 'itemOriginId',
    label: 'Origem',
    heuristics: ['origem', 'origin', 'origem item', 'item origin', 'origem produto'],
    priority: 5,
  },
  {
    nsField: 'ipiFramingCode',
    label: 'Tributacao IPI',
    heuristics: ['ipi', 'enquadramento ipi', 'tributacao ipi', 'tributação ipi', 'ipi framing', 'enquadramento legal ipi', 'ipi legal'],
    priority: 6,
  },
  {
    nsField: 'incomeAccountName',
    label: 'Conta de Receita',
    heuristics: ['conta receita', 'conta de receita', 'income account', 'receita'],
    priority: 7,
  },
  {
    nsField: 'assetAccountName',
    label: 'Conta de Ativo',
    heuristics: ['conta ativo', 'conta de ativo', 'asset account', 'ativo'],
    priority: 8,
  },
  {
    nsField: 'cogsAccountName',
    label: 'Conta CMV',
    heuristics: ['conta cmv', 'custo mercadoria', 'cogs', 'custo mercadorias vendidas', 'conta cpv', 'cmv', 'cpv'],
    priority: 9,
  },
  {
    nsField: 'costingMethod',
    label: 'Metodo de Custeio',
    heuristics: ['custeio', 'costing', 'metodo custeio', 'método custeio', 'costing method', 'metodo de custeio', 'método de custeio'],
    priority: 10,
  },
  {
    nsField: 'spedEfdType',
    label: 'Tipo SPED EFD',
    heuristics: ['sped efd', 'tipo sped', 'sped efd type', 'tipo item sped', 'tipo efd', 'sped'],
    priority: 11,
  },
  {
    nsField: 'expenseAccountName',
    label: 'Conta de Despesa',
    heuristics: ['conta despesa', 'conta de despesa', 'expense account', 'despesa'],
    priority: 12,
  },
  {
    nsField: 'efdNatureIncome',
    label: 'Natureza do Rendimento (REINF)',
    heuristics: ['natureza rendimento', 'natureza do rendimento', 'reinf', 'efd reinf', 'nature income'],
    priority: 13,
  },
];

/**
 * Normaliza string removendo acentos, underscores, hifens e pontos.
 */
function normalize(str) {
  return (str || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\-\.\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extrai somente digitos de uma string.
 */
function extractDigits(str) {
  return (str || '').toString().replace(/\D/g, '');
}

/**
 * Auto-detecta mapeamento de colunas do arquivo para campos NetSuite Item.
 * @param {string[]} headers
 * @returns {Object} { colIndex: { nsField, label } }
 */
export function autoMapColumns(headers) {
  const mapping = {};
  const usedFields = new Set();
  const normalizedHeaders = headers.map(normalize);
  const sorted = [...FIELD_MAPPINGS].sort((a, b) => a.priority - b.priority);

  for (const fieldDef of sorted) {
    for (let i = 0; i < normalizedHeaders.length; i++) {
      if (mapping[i] !== undefined) continue;
      if (usedFields.has(fieldDef.nsField)) break;
      const header = normalizedHeaders[i];
      if (!header) continue;
      if (fieldDef.heuristics.some((h) => header.includes(h))) {
        mapping[i] = { nsField: fieldDef.nsField, label: fieldDef.label };
        usedFields.add(fieldDef.nsField);
        break;
      }
    }
  }

  return mapping;
}

/**
 * Transforma linhas do arquivo em objetos item.
 * @param {string[]} headers
 * @param {any[][]} dataRows
 * @param {Object} columnMapping
 * @returns {Object[]}
 */
export function transformItems(headers, dataRows, columnMapping) {
  // Normalizar costingMethod do arquivo
  const COSTING_ALIASES = {
    'media': 'AVG', 'média': 'AVG', 'medio': 'AVG', 'médio': 'AVG',
    'average': 'AVG', 'avg': 'AVG', 'media ponderada': 'AVG',
    'fifo': 'FIFO', 'peps': 'FIFO', 'primeiro que entra': 'FIFO',
    'lifo': 'LIFO', 'ueps': 'LIFO', 'ultimo que entra': 'LIFO',
    'standard': 'STANDARD', 'padrao': 'STANDARD', 'padrão': 'STANDARD', 'custo padrao': 'STANDARD',
  };

  return dataRows
    .filter((row) => row.some((cell) => cell !== '' && cell != null))
    .map((row, index) => {
      const item = { _rowIndex: index + 2, _errors: [] };

      for (const [colIdx, fieldInfo] of Object.entries(columnMapping)) {
        const val = row[colIdx];
        if (fieldInfo && val !== undefined && val !== '' && val != null) {
          item[fieldInfo.nsField] = String(val).trim();
        }
      }

      if (!item.itemId) {
        item._errors.push('Nome do item obrigatorio');
      }

      // Truncar itemId em 60 caracteres
      if (item.itemId && item.itemId.length > 60) {
        item.itemId = item.itemId.substring(0, 60);
      }

      // Normalizar costingMethod
      if (item.costingMethod) {
        const norm = normalize(item.costingMethod);
        item.costingMethod = COSTING_ALIASES[norm] || item.costingMethod.toUpperCase();
      }

      return item;
    });
}

/**
 * Valida contas contabeis vindas do arquivo contra lista do NetSuite.
 * @param {Object[]} items
 * @param {Object[]} netsuiteAccounts - [{id, acctNumber, acctName}]
 * @returns {Object[]}
 */
export function validateAccountsFromFile(items, netsuiteAccounts) {
  const accountFields = ['incomeAccountName', 'assetAccountName', 'cogsAccountName', 'expenseAccountName'];
  const idFields = {
    incomeAccountName: 'incomeAccountId',
    assetAccountName: 'assetAccountId',
    cogsAccountName: 'cogsAccountId',
    expenseAccountName: 'expenseAccountId',
  };

  return items.map((item) => {
    const updated = { ...item, _accountErrors: [...(item._accountErrors || [])] };

    for (const field of accountFields) {
      if (!item[field]) continue;

      const value = item[field].toString().trim();
      const normalizedValue = normalize(value);
      const valueDigits = extractDigits(value);
      const dashParts = value.split(/\s*[-–]\s*/);
      const numPart = dashParts[0] ? dashParts[0].trim() : '';
      const numPartDigits = extractDigits(numPart);

      const match = netsuiteAccounts.find((acct) => {
        const acctNum = (acct.acctNumber || '').toString().trim();
        const acctFullName = (acct.acctName || '').toString().trim();
        const acctShortName = acctFullName.includes(' : ')
          ? acctFullName.split(' : ').pop().trim()
          : acctFullName;
        const acctNumDigits = extractDigits(acctNum);
        const acctFullNorm = normalize(acctFullName);
        const acctShortNorm = normalize(acctShortName);

        if (acctNum && acctNum === value) return true;
        if (valueDigits && acctNumDigits && acctNumDigits === valueDigits) return true;
        if (numPart && acctNum && acctNum === numPart) return true;
        if (numPartDigits && acctNumDigits && acctNumDigits === numPartDigits && numPartDigits.length >= 3) return true;
        if (acctShortNorm && acctShortNorm === normalizedValue) return true;
        if (acctFullNorm && acctFullNorm === normalizedValue) return true;
        if (normalizedValue.length >= 4 && (acctShortNorm.includes(normalizedValue) || acctFullNorm.includes(normalizedValue))) return true;
        if (acctShortNorm.length >= 4 && normalizedValue.includes(acctShortNorm)) return true;
        return false;
      });

      if (match) {
        updated[idFields[field]] = match.id;
        updated['_' + field + '_valid'] = true;
        updated['_' + field + '_display'] = (match.acctNumber || '') + ' - ' + (match.acctName || '');
      } else {
        updated['_' + field + '_valid'] = false;
        updated._accountErrors.push('Conta "' + value + '" nao encontrada no NetSuite');
      }
    }

    return updated;
  });
}

/**
 * Tipos de item disponiveis no NetSuite.
 */
export const ITEM_TYPES = [
  { value: 'inventoryitem', label: 'Item de Estoque', group: 'Estoque' },
  { value: 'noninventorysaleitem', label: 'Item Sem Estoque - Venda', group: 'Sem Estoque' },
  { value: 'noninventorypurchaseitem', label: 'Item Sem Estoque - Compra', group: 'Sem Estoque' },
  { value: 'noninventoryresaleitem', label: 'Item Sem Estoque - Revenda', group: 'Sem Estoque' },
  { value: 'serviceitem', label: 'Servico - Venda', group: 'Servico' },
  { value: 'servicepurchaseitem', label: 'Servico - Compra', group: 'Servico' },
  { value: 'serviceresaleitem', label: 'Servico - Revenda', group: 'Servico' },
];

/** Estoque: income + asset + cogs + costing */
export const INVENTORY_TYPES = ['inventoryitem'];
/** Venda pura: so income */
export const SALE_TYPES = ['noninventorysaleitem', 'serviceitem'];
/** Compra pura: so expense */
export const PURCHASE_TYPES = ['noninventorypurchaseitem', 'servicepurchaseitem'];
/** Revenda: income + expense */
export const RESALE_TYPES = ['noninventoryresaleitem', 'serviceresaleitem'];
/** Todos os tipos de servico (para condicionar REINF) */
export const SERVICE_TYPES = ['serviceitem', 'servicepurchaseitem', 'serviceresaleitem'];

/**
 * Retorna quais campos contabeis se aplicam ao tipo de item.
 * @param {string} itemType
 */
export function getApplicableFields(itemType) {
  const isInventory = INVENTORY_TYPES.includes(itemType);
  const isSale = SALE_TYPES.includes(itemType);
  const isPurchase = PURCHASE_TYPES.includes(itemType);
  const isResale = RESALE_TYPES.includes(itemType);
  const isService = SERVICE_TYPES.includes(itemType);
  return {
    incomeAccount: isInventory || isSale || isResale,
    expenseAccount: isPurchase || isResale,
    assetAccount: isInventory,
    cogsAccount: isInventory,
    costingMethod: isInventory,
    reinf: isService,
  };
}

/**
 * Contas aplicaveis por tipo de item.
 * @param {string} [itemType]
 */
export function getRequiredAccounts(itemType) {
  const f = getApplicableFields(itemType || 'inventoryitem');
  return {
    incomeAccount: f.incomeAccount,
    assetAccount: f.assetAccount,
    cogsAccount: f.cogsAccount,
    expenseAccount: f.expenseAccount,
  };
}

/**
 * Metodos de custeio disponiveis no NetSuite.
 */
export const COSTING_METHODS = [
  { value: 'AVG', label: 'Media Ponderada' },
  { value: 'FIFO', label: 'FIFO (Primeiro que Entra)' },
  { value: 'LIFO', label: 'LIFO (Ultimo que Entra)' },
  { value: 'STANDARD', label: 'Custo Padrao' },
];
