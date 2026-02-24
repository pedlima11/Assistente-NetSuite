/**
 * @typedef {Object} Subsidiary
 * @property {string} name - Razao social
 * @property {string|null} cnpj - XX.XXX.XXX/XXXX-XX
 * @property {string|null} ie - Inscricao estadual
 * @property {string|null} address - Endereco completo
 * @property {string|null} city - Cidade
 * @property {string|null} state - UF
 * @property {string|null} zipCode - CEP
 * @property {string|null} taxRegime - Lucro Real | Lucro Presumido | Simples Nacional
 * @property {string|null} cnae - Codigo CNAE
 */

/**
 * Cria um objeto Subsidiary com valores padrao
 * @returns {Subsidiary}
 */
export function createSubsidiaryTemplate() {
  return {
    name: '',
    cnpj: null,
    ie: null,
    address: null,
    city: null,
    state: null,
    zipCode: null,
    taxRegime: null,
    cnae: null,
  };
}
