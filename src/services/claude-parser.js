import { sendToBackground } from '../utils/api-client.js';
import { MessageType } from '../types/messages.js';

const PROMPT_TEMPLATE = `Você é um especialista em contabilidade brasileira e NetSuite.
Recebeu dados extraídos de um arquivo financeiro (balanço patrimonial, balancete ou DRE).

Retorne APENAS um JSON válido com a seguinte estrutura:

{
  "subsidiary": {
    "name": "razão social",
    "cnpj": "XX.XXX.XXX/XXXX-XX",
    "ie": "inscrição estadual",
    "address": "endereço completo",
    "city": "cidade",
    "state": "UF",
    "zipCode": "CEP",
    "taxRegime": "Lucro Real | Lucro Presumido | Simples Nacional",
    "cnae": "código CNAE"
  },
  "accounts": [
    {
      "number": "1",
      "name": "ATIVO",
      "type": "OthAsset",
      "parent": null,
      "level": 0,
      "isSummary": true
    },
    {
      "number": "1.1",
      "name": "ATIVO CIRCULANTE",
      "type": "OthCurrAsset",
      "parent": "1",
      "level": 1,
      "isSummary": true
    },
    {
      "number": "1.1.1.001",
      "name": "Caixa Geral",
      "type": "Bank",
      "parent": "1.1.1",
      "level": 3,
      "isSummary": false
    }
  ]
}

Regras OBRIGATÓRIAS:
- Mapeie TODAS as contas do arquivo, sem exceção
- Use os AccountTypes do NetSuite: Bank, AcctRec, OthCurrAsset, FixedAsset, OthAsset, AcctPay, OthCurrLiab, LongTermLiab, Equity, Income, COGS, Expense, DeferRevenue, DeferExpense, UnbilledRec
- Mantenha a hierarquia: campo parent = number da conta pai
- Se não conseguir extrair dados da empresa, preencha subsidiary com null nos campos ausentes
- Não invente dados — use apenas o que está no arquivo

CONTAS CONSOLIDADORAS (isSummary):
- Defina "isSummary": true para contas que são AGRUPADORES/TOTALIZADORES (não recebem lançamentos diretos)
- Contas consolidadoras são normalmente: grupos de contas, títulos, categorias (ex: "ATIVO", "ATIVO CIRCULANTE", "CAIXA E EQUIVALENTES")
- Contas analíticas que recebem lançamentos têm "isSummary": false (ex: "Caixa Geral", "Banco Itaú c/c 12345")
- REGRA PRÁTICA: se a conta tem subcontas no arquivo, ela é summary=true. Se é a conta de menor nível (folha), é summary=false
- Em caso de dúvida, marque como summary=true se o nome é genérico/categoria, e false se é específico

Mapeamento de referência (código contábil → AccountType):
1.x.x.x → OthAsset (Ativo — default)
  1.1.x.x → OthCurrAsset (Ativo Circulante)
    1.1.1.x → Bank (Caixa/Bancos)
    1.1.2.x → AcctRec (Contas a Receber)
  1.2.x.x → FixedAsset (Ativo Não Circulante)
2.x.x.x → OthCurrLiab (Passivo — default)
  2.1.x.x → OthCurrLiab (Passivo Circulante)
    2.1.1.x → AcctPay (Fornecedores)
  2.2.x.x → LongTermLiab (Passivo Não Circulante)
3.x.x.x → Equity (Patrimônio Líquido)
4.x.x.x → Income (Receitas / DRE)
5.x.x.x → COGS (Custos / DRE)
6.x.x.x → Expense (Despesas / DRE)

OBSERVAÇÕES PARA DRE:
- Contas 4.x = Receitas → Income
- Contas 5.x = Custos das Mercadorias Vendidas → COGS
- Contas 6.x = Despesas Operacionais → Expense
- Receitas/Despesas financeiras podem ser 4.x ou 6.x dependendo do plano
- DeferRevenue = Receitas diferidas (ex: adiantamento de clientes)
- DeferExpense = Despesas antecipadas (ex: seguros a apropriar)`;

/**
 * Envia dados financeiros pre-processados para Claude API via service worker
 * e retorna dados estruturados (subsidiary + accounts)
 * @param {import('../parsers/excel-parser.js').ParsedData} rawData
 * @returns {Promise<{subsidiary: Object, accounts: Object[]}>}
 */
export async function structureFinancialData(rawData) {
  const response = await sendToBackground({
    type: MessageType.STRUCTURE_DATA,
    data: {
      prompt: PROMPT_TEMPLATE,
      financialData: rawData,
    },
  });

  if (!response || !Array.isArray(response.accounts)) {
    throw new Error('Claude API retornou dados invalidos — campo "accounts" ausente ou nao e array');
  }

  // subsidiary pode ser null se os dados da empresa nao estao no arquivo
  const subsidiary = response.subsidiary || {
    name: null, cnpj: null, ie: null, address: null,
    city: null, state: null, zipCode: null, taxRegime: null, cnae: null,
  };

  return {
    subsidiary,
    accounts: response.accounts,
  };
}
