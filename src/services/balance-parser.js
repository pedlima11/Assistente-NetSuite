import { sendToBackground } from '../utils/api-client.js';
import { MessageType } from '../types/messages.js';

const BALANCE_PROMPT = `Você é um especialista em contabilidade brasileira.
Recebeu dados extraídos de um arquivo financeiro (balancete ou balanço patrimonial).

Sua tarefa é extrair os SALDOS de cada conta contábil.

Retorne APENAS um JSON válido com a seguinte estrutura:

{
  "referenceDate": "2025-01-01",
  "balances": [
    {
      "number": "1.1.1.001",
      "name": "Caixa Geral",
      "debit": 150000.00,
      "credit": 0
    },
    {
      "number": "2.1.1.001",
      "name": "Fornecedores",
      "debit": 0,
      "credit": 85000.00
    }
  ]
}

Regras OBRIGATÓRIAS:
- Extraia TODAS as contas que possuem saldo (valor diferente de zero)
- Ignore contas com saldo zero ou sem valor
- Ignore contas consolidadoras/totalizadoras (contas-pai que apenas somam subcontas)
- Mantenha apenas contas ANALÍTICAS (nível mais baixo, folhas da hierarquia)
- O campo "number" deve ser o código contábil exato como aparece no arquivo
- O campo "name" deve ser o nome da conta como aparece no arquivo

REGRAS DE DÉBITO/CRÉDITO:
Para BALANCETE (arquivo com colunas de débito e crédito separadas):
  - Use os valores das colunas "Débito" e "Crédito" diretamente
  - Se houver coluna "Saldo" única: contas de Ativo (1.x) e Despesa (5.x, 6.x) → débito; Passivo (2.x), PL (3.x) e Receita (4.x) → crédito

Para BALANÇO PATRIMONIAL (arquivo com saldo único por conta):
  - Ativo (1.x.x.x): saldo positivo → debit, saldo negativo → credit (retificadora)
  - Passivo (2.x.x.x): saldo positivo → credit, saldo negativo → debit (retificadora)
  - Patrimônio Líquido (3.x.x.x): saldo positivo → credit, saldo negativo → debit (prejuízo)
  - Receitas (4.x.x.x): saldo positivo → credit
  - Custos/Despesas (5.x, 6.x): saldo positivo → debit

VALORES:
- Sempre use valores ABSOLUTOS (positivos) nos campos debit e credit
- Nunca coloque valor no debit E no credit da mesma conta — apenas um dos dois
- Se o valor for zero em ambos, não inclua a conta
- Converta formatos brasileiros: "1.234.567,89" → 1234567.89

DATA DE REFERÊNCIA:
- Extraia a data de referência do arquivo (data do balancete/balanço)
- Formato: YYYY-MM-DD
- Se não encontrar data, use null

Não invente dados — use apenas o que está no arquivo.`;

/**
 * Envia dados financeiros para Claude API e retorna saldos estruturados
 * @param {import('../parsers/excel-parser.js').ParsedData} rawData
 * @returns {Promise<{referenceDate: string|null, balances: Array<{number: string, name: string, debit: number, credit: number}>}>}
 */
export async function extractBalances(rawData) {
  const response = await sendToBackground({
    type: MessageType.STRUCTURE_DATA,
    data: {
      prompt: BALANCE_PROMPT,
      financialData: rawData,
    },
  });

  if (!response || !response.balances || !Array.isArray(response.balances)) {
    throw new Error('Claude API nao retornou saldos validos');
  }

  // Normalizar valores
  const balances = response.balances
    .map((b) => ({
      number: String(b.number || '').trim(),
      name: String(b.name || '').trim(),
      debit: Math.abs(Number(b.debit) || 0),
      credit: Math.abs(Number(b.credit) || 0),
    }))
    .filter((b) => b.number && (b.debit > 0 || b.credit > 0));

  return {
    referenceDate: response.referenceDate || null,
    balances,
  };
}
