import { sendToBackground } from '../utils/chrome-messaging.js';
import { MessageType } from '../types/messages.js';

const PROMPT_TEMPLATE = `Você é um especialista em contabilidade brasileira e NetSuite.
Recebeu dados extraídos de um arquivo financeiro (balanço patrimonial ou balancete).

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
      "number": "1.0.0.0",
      "name": "ATIVO",
      "type": "OthAsset",
      "parent": null,
      "level": 0
    }
  ]
}

Regras:
- Mapeie TODAS as contas do arquivo
- Use os AccountTypes do NetSuite: Bank, AcctRec, OthCurrAsset, FixedAsset, OthAsset, AcctPay, OthCurrLiab, LongTermLiab, Equity, Income, COGS, Expense, DeferRevenue, DeferExpense, UnbilledRec
- Mantenha a hierarquia: campo parent = number da conta pai
- Se não conseguir extrair dados da empresa, preencha subsidiary com null nos campos ausentes
- Não invente dados — use apenas o que está no arquivo

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
3.x.x.x → Equity
4.x.x.x → Income
5.x.x.x → COGS
6.x.x.x → Expense`;

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

  if (!response || !response.subsidiary || !response.accounts) {
    throw new Error('Claude API retornou dados invalidos');
  }

  return {
    subsidiary: response.subsidiary,
    accounts: response.accounts,
  };
}
