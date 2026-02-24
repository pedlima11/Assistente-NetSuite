# CLAUDE.md — NetSuite Setup Assistant

## Visão Geral do Projeto

Chrome Extension (Manifest V3 + React + TypeScript) que automatiza implantação do NetSuite. O usuário anexa arquivos financeiros (.xlsx), o plugin extrai dados via Claude API, cria a filial e configura o plano de contas automaticamente.

**Escopo atual:** Criação de filial + plano de contas a partir de Balanço Patrimonial / Balancete.

---

## Stack

- **Frontend:** React 18 + TypeScript + Tailwind CSS
- **Build:** Vite (com output multi-entry para Manifest V3)
- **Roteamento:** MemoryRouter (não BrowserRouter — Chrome Extension não tem URL real)
- **Parse Excel:** SheetJS (`xlsx`) — roda no side panel, não no service worker
- **Autenticação NetSuite:** OAuth 1.0 com `oauth-1.0a` + `crypto-js` (HMAC-SHA256)
- **LLM:** Claude API via service worker (nunca direto do side panel)
- **Persistência:** `chrome.storage.local`

---

## Regras Críticas de Arquitetura

### 1. CORS — Todas as chamadas de API passam pelo Service Worker

Componentes React **nunca fazem fetch direto**. O fluxo obrigatório é:

```
React Component → chrome.runtime.sendMessage({ type, payload })
    → Service Worker → fetch para Claude API / NetSuite API
    → Retorna via sendResponse
```

### 2. Parse de arquivos acontece no Side Panel

Objetos `File`/`Blob` não são JSON-serializáveis e não podem cruzar `chrome.runtime.sendMessage`. Portanto:

```
Side Panel: File → excel-parser (SheetJS) → JSON (ParsedData)
    → sendMessage({ type: 'STRUCTURE_DATA', data: parsedJSON })
    → Service Worker: recebe JSON → Claude API → structured data
```

**Nunca enviar o objeto `File` para o service worker.**

### 3. Ordem de execução no NetSuite

```
1. Criar Subsidiary → obter internalId
2. Criar Accounts com o subsidiaryId
```

Contas **nunca** devem ser criadas sem a subsidiary existir.

### 4. Hierarquia de contas — Topological Sort + Mapa de IDs

- Ordenar topologicamente (pais antes de filhos) antes de criar
- Manter mapa `{ accountNumber → internalId }` durante criação
- Usar o mapa para resolver o campo `parent` das contas filhas
- Criação é **estritamente sequencial** (uma conta por vez)

### 5. Service Worker Lifecycle (MV3)

Service workers são encerrados após ~30s de inatividade. Para operações longas:

- Processar em chunks (ex: 10 contas por vez)
- Salvar checkpoint em `chrome.storage.local` após cada conta
- Usar `chrome.alarms` para keep-alive
- Retomar do último checkpoint se reiniciar

---

## Estrutura do Projeto

```
netsuite-setup-assistant/
├── manifest.json
├── sidepanel.html
├── vite.config.ts
├── src/
│   ├── background/
│   │   └── service-worker.ts       # Único ponto de saída para APIs externas
│   ├── sidepanel/
│   │   ├── main.tsx
│   │   ├── App.tsx                 # MemoryRouter com rotas
│   │   ├── pages/
│   │   │   ├── Settings.tsx        # Credenciais NetSuite + Claude API key
│   │   │   ├── Upload.tsx          # Drag & drop + processamento
│   │   │   ├── Review.tsx          # Preview editável (filial + contas)
│   │   │   └── Status.tsx          # Progresso + retomada
│   │   └── components/
│   │       ├── FileUploader.tsx
│   │       ├── SubsidiaryPreview.tsx
│   │       └── ChartOfAccountsPreview.tsx
│   ├── services/
│   │   ├── claude-parser.ts        # Envia JSON (não File) para Claude via SW
│   │   ├── netsuite-api.ts         # Client REST genérico
│   │   ├── subsidiary-creator.ts   # POST /subsidiary
│   │   └── coa-mapper.ts           # Topological sort + batch creation
│   ├── parsers/
│   │   └── excel-parser.ts         # Roda NO SIDE PANEL (acesso ao File)
│   ├── types/
│   │   ├── subsidiary.ts
│   │   ├── account.ts
│   │   ├── netsuite.ts             # Enum AccountType completo
│   │   └── messages.ts             # Union types das mensagens Chrome runtime
│   └── utils/
│       ├── netsuite-auth.ts        # OAuth 1.0 header generator
│       ├── chrome-messaging.ts     # sendToBackground<T>() helper
│       ├── progress-store.ts       # Persistência de progresso
│       └── file-reader.ts
```

---

## Tipos Principais

### AccountType (NetSuite enum)

```typescript
enum AccountType {
  Bank = 'Bank',
  AcctRec = 'AcctRec',
  OthCurrAsset = 'OthCurrAsset',
  FixedAsset = 'FixedAsset',
  OthAsset = 'OthAsset',
  AcctPay = 'AcctPay',
  OthCurrLiab = 'OthCurrLiab',
  LongTermLiab = 'LongTermLiab',
  Equity = 'Equity',
  Income = 'Income',
  COGS = 'COGS',
  Expense = 'Expense',
  DeferRevenue = 'DeferRevenue',
  DeferExpense = 'DeferExpense',
  UnbilledRec = 'UnbilledRec',
}
```

### Mensagens Chrome Runtime

```typescript
type AppMessage =
  | { type: 'STRUCTURE_DATA'; data: ParsedData }
  | { type: 'CREATE_SUBSIDIARY'; data: Subsidiary }
  | { type: 'CREATE_ACCOUNTS'; accounts: Account[]; subsidiaryId: string }
```

---

## Mapeamento de Contas (Regras Brasil → NetSuite)

```
1.x.x.x    → OthAsset        (Ativo — default)
  1.1.x.x  → OthCurrAsset    (Ativo Circulante)
    1.1.1.x → Bank            (Caixa/Bancos)
    1.1.2.x → AcctRec         (Contas a Receber)
  1.2.x.x  → FixedAsset      (Ativo Não Circulante)
2.x.x.x    → OthCurrLiab     (Passivo — default)
  2.1.x.x  → OthCurrLiab     (Passivo Circulante)
    2.1.1.x → AcctPay         (Fornecedores)
  2.2.x.x  → LongTermLiab    (Passivo Não Circulante)
3.x.x.x    → Equity
4.x.x.x    → Income
5.x.x.x    → COGS
6.x.x.x    → Expense
```

A Claude API resolve contas que não seguem o padrão numérico.

---

## Checkpoint de Progresso (chrome.storage.local)

```typescript
interface BatchProgress {
  subsidiaryId: string;
  totalAccounts: number;
  createdAccounts: number;
  accountIdMap: Record<string, string>;  // { accountNumber → internalId }
  lastCreatedIndex: number;
  errors: Array<{ index: number; account: string; error: string }>;
}
```

---

## Validação Obrigatória — Antes de Implementar subsidiary-creator.ts

Consultar o metadata-catalog do NetSuite para confirmar nomes reais de campos:

```
GET /services/rest/record/v1/metadata-catalog/subsidiary
GET /services/rest/record/v1/metadata-catalog/account
```

Campos a confirmar:
- Subsidiary: `federalIdNumber` (CNPJ), `state1TaxNumber` (IE), `mainAddress`, `currency`
- Account: `acctNumber`, `acctName`, `acctType`, `parent`, `subsidiary`
- Verificar se BRL existe como moeda no ambiente antes de criar a subsidiary

---

## Variáveis de Configuração (chrome.storage.local)

```typescript
interface AppCredentials {
  netsuiteAccountId: string;
  consumerKey: string;
  consumerSecret: string;
  tokenId: string;
  tokenSecret: string;
  claudeApiKey: string;
}
```

Salvas em `/settings`. Nunca hardcodar credenciais no código.

---

## Prompt Template — Claude API

O prompt em `claude-parser.ts` deve instruir a Claude a retornar **apenas JSON válido** com a estrutura:

```json
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
```

Regras do prompt: mapear TODAS as contas, usar AccountTypes do NetSuite, manter hierarquia (parent = number da conta pai), não inventar dados.

---

## Ordem de Implementação

1. **Fase 1 — Tipos e utilitários:** `types/`, `utils/chrome-messaging.ts`, `utils/progress-store.ts`
2. **Fase 2 — Auth + Client REST:** `utils/netsuite-auth.ts`, `services/netsuite-api.ts`
3. **Fase 3 — Parsers:** `parsers/excel-parser.ts`, `services/claude-parser.ts`, `services/coa-mapper.ts`
4. **Fase 4 — Criação NetSuite:** `services/subsidiary-creator.ts` + batch em `coa-mapper.ts`
5. **Fase 5 — Service Worker:** `background/service-worker.ts`
6. **Fase 6 — UI React:** páginas e componentes

---

## Fora do Escopo Atual

- Parse de NF-e XML (`nf-parser.ts`)
- Parse de SPED (`sped-parser.ts`)
- Parse de DRE (`dre-parser.ts`)
- Criação de regras fiscais (`fiscal-rules-creator.ts`)
- Suporte a PDF/OCR
- Backend proxy para Claude API key (distribuição pública)