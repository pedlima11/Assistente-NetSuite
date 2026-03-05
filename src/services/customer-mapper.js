/**
 * Mapeamento automatico de colunas do arquivo para campos NetSuite Customer.
 * Usa heuristicas por nome de coluna (substring match normalizado).
 */

const FIELD_MAPPINGS = [
  {
    nsField: 'companyName',
    label: 'Razao Social',
    heuristics: ['razao social', 'razão social', 'nome fantasia', 'company', 'empresa', 'razao', 'razão'],
    priority: 1,
  },
  {
    nsField: 'customerName',
    label: 'Nome do Cliente',
    heuristics: ['nome cliente', 'nome do cliente', 'nome completo', 'nome'],
    priority: 2,
  },
  {
    nsField: 'tipoPessoa',
    label: 'Tipo Pessoa',
    heuristics: ['tipo pessoa', 'tipo', 'pf pj', 'pf/pj'],
    priority: 3,
  },
  {
    nsField: 'entityId',
    label: 'Codigo do Cliente',
    heuristics: ['codigo cliente', 'código cliente', 'cod cliente', 'customer code', 'id cliente', 'codigo', 'código', 'cod'],
    priority: 4,
  },
  {
    nsField: 'custentity_brl_entity_t_fed_tax_reg',
    label: 'CNPJ/CPF',
    heuristics: ['cnpj/cpf', 'cpf/cnpj', 'cpf cnpj', 'cnpj', 'cpf', 'documento', 'federal'],
    priority: 5,
  },
  {
    nsField: 'email',
    label: 'Email',
    heuristics: ['email', 'e-mail', 'correio eletronico'],
    priority: 6,
  },
  {
    nsField: 'phone',
    label: 'Telefone',
    heuristics: ['telefone', 'phone', 'fone', 'celular', 'tel'],
    priority: 7,
  },
  {
    nsField: 'custentity_brl_entity_t_state_tx_reg',
    label: 'Inscricao Estadual',
    heuristics: ['inscricao estadual', 'inscrição estadual', 'insc estadual', 'ie'],
    priority: 8,
  },
  {
    nsField: 'custentity_brl_entity_t_municip_tx_reg',
    label: 'Inscricao Municipal',
    heuristics: ['inscricao municipal', 'inscrição municipal', 'insc municipal', 'im'],
    priority: 9,
  },
  {
    nsField: 'addr1',
    label: 'Endereco',
    heuristics: ['endereco', 'endereço', 'logradouro', 'rua', 'address'],
    priority: 10,
  },
  {
    nsField: 'city',
    label: 'Cidade',
    heuristics: ['cidade', 'city', 'municipio', 'município'],
    priority: 11,
  },
  {
    nsField: 'state',
    label: 'Estado/UF',
    heuristics: ['estado', 'uf', 'state'],
    priority: 12,
  },
  {
    nsField: 'zip',
    label: 'CEP',
    heuristics: ['cep', 'zip', 'codigo postal', 'código postal'],
    priority: 13,
  },
  {
    nsField: 'nomeContato',
    label: 'Nome do Contato',
    heuristics: ['nome contato', 'contato', 'contact'],
    priority: 14,
  },
];

/**
 * Normaliza string removendo acentos, underscores, hifens e pontos,
 * convertendo para lowercase.
 */
function normalize(str) {
  return (str || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\-\.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Auto-detecta mapeamento de colunas do arquivo para campos NetSuite.
 * @param {string[]} headers - Cabecalhos do arquivo
 * @returns {Object} { colIndex: { nsField, label } } para colunas mapeadas
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

      const matched = fieldDef.heuristics.some((h) => header.includes(h));
      if (matched) {
        mapping[i] = { nsField: fieldDef.nsField, label: fieldDef.label };
        usedFields.add(fieldDef.nsField);
        break;
      }
    }
  }

  return mapping;
}

/**
 * Detecta se o documento e CPF (pessoa fisica) ou CNPJ (pessoa juridica).
 * @param {string} doc
 * @returns {boolean} true = PF (CPF), false = PJ (CNPJ ou desconhecido)
 */
export function detectIsPerson(doc) {
  const digits = (doc || '').replace(/\D/g, '');
  return digits.length === 11;
}

/**
 * Formata CNPJ/CPF no padrao aceito pelo NetSuite.
 * CPF (11 digitos): 000.000.000-00
 * CNPJ (14 digitos): 00.000.000/0000-00
 * Se nao tiver 11 ou 14 digitos, retorna como esta.
 */
function formatDocument(doc) {
  const digits = (doc || '').replace(/\D/g, '');
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return doc;
}

/**
 * Valida CPF (11 digitos) pelos digitos verificadores.
 */
function isValidCPF(cpf) {
  const digits = cpf.replace(/\D/g, '');
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(digits[i]) * (10 - i);
  let check = 11 - (sum % 11);
  if (check >= 10) check = 0;
  if (parseInt(digits[9]) !== check) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(digits[i]) * (11 - i);
  check = 11 - (sum % 11);
  if (check >= 10) check = 0;
  if (parseInt(digits[10]) !== check) return false;

  return true;
}

/**
 * Valida CNPJ (14 digitos) pelos digitos verificadores.
 */
function isValidCNPJ(cnpj) {
  const digits = cnpj.replace(/\D/g, '');
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(digits[i]) * weights1[i];
  let check = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  if (parseInt(digits[12]) !== check) return false;

  sum = 0;
  for (let i = 0; i < 13; i++) sum += parseInt(digits[i]) * weights2[i];
  check = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  if (parseInt(digits[13]) !== check) return false;

  return true;
}

/**
 * Valida documento (CPF ou CNPJ) pelos digitos verificadores.
 * Retorna { valid, type } onde type = 'CPF' | 'CNPJ' | null
 */
export function validateDocument(doc) {
  if (!doc) return { valid: false, type: null };
  const digits = doc.replace(/\D/g, '');
  if (digits.length === 11) return { valid: isValidCPF(doc), type: 'CPF' };
  if (digits.length === 14) return { valid: isValidCNPJ(doc), type: 'CNPJ' };
  return { valid: false, type: null };
}

/**
 * Detecta isPerson a partir do campo tipo_pessoa (PF/PJ).
 * Retorna null se nao conseguir determinar.
 */
function detectIsPersonFromTipo(tipoPessoa) {
  if (!tipoPessoa) return null;
  const val = tipoPessoa.toString().trim().toUpperCase();
  if (val === 'PF' || val === 'PESSOA FISICA' || val === 'PESSOA FÍSICA' || val === 'FISICA' || val === 'INDIVIDUAL') return true;
  if (val === 'PJ' || val === 'PESSOA JURIDICA' || val === 'PESSOA JURÍDICA' || val === 'JURIDICA' || val === 'COMPANY') return false;
  return null;
}

/**
 * Retorna a lista de campos disponiveis para mapeamento.
 * Usado pelo UI para exibir opcoes no dropdown de mapeamento.
 */
export function getAvailableFields() {
  return FIELD_MAPPINGS.map((f) => ({ nsField: f.nsField, label: f.label }));
}

/**
 * Transforma linhas do arquivo em objetos customer prontos para o NetSuite.
 * @param {string[]} headers - Cabecalhos do arquivo
 * @param {any[][]} dataRows - Linhas de dados (sem header)
 * @param {Object} columnMapping - { colIndex: { nsField, label } }
 * @param {Object} config - { subsidiaryId, entityStatusId, currencyId }
 * @returns {Object[]} Array de customer objects
 */
export function transformCustomers(headers, dataRows, columnMapping, config) {
  return dataRows
    .filter((row) => row.some((cell) => cell !== '' && cell != null))
    .map((row, index) => {
      const customer = {
        _rowIndex: index + 2,
        _errors: [],
      };

      for (const [colIdx, fieldInfo] of Object.entries(columnMapping)) {
        const val = row[colIdx];
        if (fieldInfo && val !== undefined && val !== '' && val != null) {
          customer[fieldInfo.nsField] = String(val).trim();
        }
      }

      // Validar e formatar CNPJ/CPF
      if (customer.custentity_brl_entity_t_fed_tax_reg) {
        const docValidation = validateDocument(customer.custentity_brl_entity_t_fed_tax_reg);
        if (docValidation.valid) {
          customer.custentity_brl_entity_t_fed_tax_reg =
            formatDocument(customer.custentity_brl_entity_t_fed_tax_reg);
        } else {
          const raw = customer.custentity_brl_entity_t_fed_tax_reg;
          customer._errors.push(docValidation.type
            ? `${docValidation.type} invalido: ${raw}`
            : `Documento invalido (${raw.replace(/\D/g, '').length} digitos): ${raw}`);
          customer._docInvalid = true;
          delete customer.custentity_brl_entity_t_fed_tax_reg;
        }
      }

      // Fallback: se companyName vazio, usar customerName
      if (!customer.companyName && customer.customerName) {
        customer.companyName = customer.customerName;
      }

      if (!customer.companyName) {
        customer._errors.push('Nome da empresa obrigatorio');
      }

      // Determinar isPerson: prioridade para tipo_pessoa, fallback para CPF/CNPJ
      const tipoResult = detectIsPersonFromTipo(customer.tipoPessoa);
      if (tipoResult !== null) {
        customer.isPerson = tipoResult;
      } else {
        const doc = customer.custentity_brl_entity_t_fed_tax_reg;
        customer.isPerson = detectIsPerson(doc);
      }

      // Se PF, split nome em firstName/lastName
      if (customer.isPerson && customer.companyName) {
        const parts = customer.companyName.trim().split(/\s+/);
        customer.firstName = parts[0];
        customer.lastName = parts.slice(1).join(' ') || parts[0];
      }

      // Limpar campos auxiliares que nao vao pro NetSuite
      delete customer.customerName;
      delete customer.tipoPessoa;

      customer.subsidiaryId = config.subsidiaryId;
      customer.entityStatusId = config.entityStatusId;
      customer.currencyId = config.currencyId;

      return customer;
    });
}
