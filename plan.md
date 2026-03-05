# Plano: Importação de Saldos Contábeis (Opening Balances)

## Objetivo
Extrair saldos de arquivos financeiros (balancete ou balanço patrimonial .xlsx) e criar um **Journal Entry de abertura** no NetSuite via API, vinculado à subsidiary.

## Decisões de Design

- **Fonte**: Balancete (.xlsx com débito/crédito/saldo) OU Balanço Patrimonial (.xlsx com saldo único)
- **Destino**: Journal Entry via REST API (`POST /journalentry`)
- **Período**: Único (opening balance com data definida pelo usuário)
- **Regra**: Somente contas analíticas (`isSummary: false`) recebem saldo
- **Conta de contrapartida**: Opening Balance Equity (obrigatória para balancear o JE)

## Fluxo do Usuário

```
1. Home → "Saldos Contábeis" (novo botão)
2. Upload → Seleciona .xlsx (balancete ou balanço)
3. Claude API → Extrai contas + saldos (debit/credit)
4. Review → Preview editável: contas, saldos, data do lançamento
5. Selecionar subsidiary existente (contas já devem existir)
6. Status → Cria Journal Entry no NetSuite via REST API
```

## Arquivos a Criar/Modificar

### 1. Novo: `src/services/balance-parser.js`
Prompt específico para Claude API extrair saldos:
- Input: dados brutos do Excel (mesma lógica do claude-parser.js)
- Output: `{ accounts: [{ number, name, debit, credit }], referenceDate }`
- A Claude identifica colunas de débito/crédito/saldo automaticamente
- Para balanço: saldo positivo em ativo = débito, em passivo/PL = crédito

### 2. Novo: `src/services/journal-entry-creator.js`
Serviço para criar o Journal Entry de abertura:
- Recebe: lista de saldos, subsidiaryId, data, accountIdMap
- Monta payload REST API com linhas de débito e crédito
- Calcula diferença e adiciona linha de Opening Balance Equity
- Validação: total débitos = total créditos

### 3. Novo: `src/sidepanel/pages/BalanceUpload.jsx`
Página dedicada para upload de saldos:
- Upload do arquivo .xlsx
- Seleção da subsidiary existente (obrigatório — contas precisam existir)
- Date picker para data do lançamento de abertura
- Mapeia contas do arquivo para contas existentes no NetSuite (por acctNumber)
- Preview dos saldos (tabela editável)
- Botão "Criar Lançamento de Abertura"

### 4. Novo: `src/sidepanel/pages/BalanceStatus.jsx`
Página de progresso da criação do Journal Entry:
- Mostra progresso: resolvendo contas → criando JE
- Resultado: ID do Journal Entry criado
- Erros: contas não encontradas, saldo desbalanceado

### 5. Modificar: `src/types/messages.js`
Adicionar:
- `CREATE_JOURNAL_ENTRY` — novo tipo de mensagem

### 6. Modificar: `src/background/service-worker.js`
Adicionar handler para `CREATE_JOURNAL_ENTRY`:
- Chama REST API `POST /journalentry`
- Monta payload com linhas de débito/crédito

### 7. Modificar: `src/sidepanel/pages/Home.jsx`
Adicionar botão "Saldos Contábeis" no grid da home

### 8. Modificar: `src/sidepanel/App.jsx`
Adicionar rotas:
- `/balance-upload` → BalanceUpload
- `/balance-status` → BalanceStatus

## Estrutura do Journal Entry (REST API)

```json
POST /services/rest/record/v1/journalentry
{
  "subsidiary": { "id": "123" },
  "trandate": "2025-01-01",
  "memo": "Opening Balances - Automated Import",
  "approved": true,
  "line": {
    "items": [
      {
        "account": { "id": "456" },
        "debit": 150000.00,
        "memo": "1.1.1.001 - Caixa Geral"
      },
      {
        "account": { "id": "789" },
        "credit": 100000.00,
        "memo": "2.1.1.001 - Fornecedores"
      },
      {
        "account": { "id": "999" },
        "credit": 50000.00,
        "memo": "Opening Balance Equity (ajuste)"
      }
    ]
  }
}
```

## Resolução de Contas (acctNumber → internalId)

Antes de criar o JE, precisamos resolver os IDs das contas:
1. Buscar todas as contas da subsidiary via REST API (`GET /account?q=subsidiary IS {id}`)
2. Criar mapa `{ acctNumber → internalId }`
3. Fazer match entre contas do arquivo e contas do NetSuite
4. Reportar contas não encontradas como warnings

## Validações

- Total débitos DEVE ser igual ao total créditos (diferença vai para OBE)
- Contas `isSummary: true` não recebem lançamento
- Contas com saldo zero são ignoradas
- Data do lançamento deve estar num período aberto no NetSuite
- Subsidiary deve existir e ter contas já criadas

## Ordem de Implementação

1. `src/types/messages.js` — novo MessageType
2. `src/services/balance-parser.js` — prompt Claude para extrair saldos
3. `src/services/journal-entry-creator.js` — lógica de criação do JE
4. `src/background/service-worker.js` — handler CREATE_JOURNAL_ENTRY
5. `src/sidepanel/pages/BalanceUpload.jsx` — UI de upload + preview
6. `src/sidepanel/pages/BalanceStatus.jsx` — UI de progresso
7. `src/sidepanel/pages/Home.jsx` — novo botão
8. `src/sidepanel/App.jsx` — novas rotas
