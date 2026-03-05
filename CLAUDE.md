# CLAUDE.md — NetSuite Setup Assistant

## Visao Geral

Web app (Express + React) que acelera implantacao do NetSuite para empresas brasileiras. O usuario importa arquivos financeiros (.xlsx, .xls, .csv), a app extrai e estrutura dados via Claude API, e cria registros no NetSuite automaticamente.

**Features atuais:** Plano de Contas, DRE, Balanco, Saldos Iniciais, Regras Fiscais, Clientes, Fornecedores, Itens.

---

## Stack

- **Frontend:** React 18 + JavaScript (JSDoc) + Tailwind CSS
- **Backend:** Express.js (Node.js)
- **Build:** Vite (single-entry, proxy `/api` para Express em dev)
- **Roteamento:** BrowserRouter (react-router-dom v6)
- **Parse Excel:** SheetJS (`xlsx`) — roda no frontend (browser)
- **Autenticacao NetSuite:** OAuth 1.0 com `oauth-1.0a` + `crypto-js` (HMAC-SHA256), signing no server
- **LLM:** Claude Sonnet 4 via server (nunca direto do frontend)
- **Persistencia:** `server/data/credentials.json` (credenciais) + `localStorage` (progresso de batch)

---

## Regras Criticas de Arquitetura

### 1. Todas as chamadas de API passam pelo Express server

Componentes React **nunca fazem fetch direto** para APIs externas. O fluxo obrigatorio:

```
React Component → sendToBackground({ type, payload })
    → fetch('/api/message', { body: JSON.stringify(msg) })
    → Express server (server/routes/api.js) → handleMessage()
    → fetch para Claude API / NetSuite REST / RESTlet / SuiteQL
    → HTTP response JSON
```

`sendToBackground()` em `src/utils/api-client.js` encapsula o transporte HTTP. Todos os services usam essa funcao.

### 2. Parse de arquivos acontece no frontend

Objetos `File` nao sao JSON-serializaveis e nao podem ser enviados ao server via POST. Portanto:

```
Browser: File → excel-parser (SheetJS) → JSON puro
    → sendToBackground({ type: 'STRUCTURE_DATA', data: parsedJSON })
    → Server: recebe JSON → Claude API → structured data
```

**Nunca enviar o objeto `File` para o server.**

### 3. Ordem de execucao no NetSuite

```
1. Criar Subsidiary → obter internalId
2. Criar Accounts com o subsidiaryId
```

Contas **nunca** devem ser criadas sem a subsidiary existir.

### 4. Hierarquia de contas — Topological Sort + Mapa de IDs

- Ordenar topologicamente (pais antes de filhos) antes de criar
- Manter mapa `{ accountNumber → internalId }` durante criacao
- Usar o mapa para resolver o campo `parent` das contas filhas
- Criacao é **estritamente sequencial** (uma conta por vez)

### 5. OAuth 1.0 — Detalhes criticos

- Signing acontece no server (`server/routes/api.js` importa `src/utils/netsuite-auth.js`)
- **Realm deve ser UPPERCASE** (ex: `TD3066446`, nao `td3066446`)
- Headers obrigatorios para REST API: `Accept-Language: en` + `Content-Language: en`
- URL assinada **sem** query parameters (query params separados para OAuth)

---

## Estrutura do Projeto

```
netsuite-setup-assistant/
├── index.html                          # Entry point unico
├── package.json                        # v2.0.0 — Express + React
├── vite.config.js                      # Proxy /api → localhost:3001
├── server/
│   ├── index.js                        # Express server (port 3001)
│   ├── routes/
│   │   └── api.js                      # Message router (27 tipos) + helpers API
│   ├── services/
│   │   ├── tax-stats-builder.js        # Stats Builder (Camada 3)
│   │   ├── tax-pre-validator.js        # Pre-Validador (Camada 4) — unica fonte de error
│   │   ├── tax-ai-analyzer.js          # AI Reviewer (Camada 5) — Claude temp=0 + cache SHA-256
│   │   └── tax-ai-validator.js         # Validador pos-IA — trunca/recalcula/rebaixa
│   └── data/
│       ├── credentials.json            # Credenciais persistidas (substitui chrome.storage)
│       ├── tax-ai-cache/               # Cache de analises IA (SHA-256, 90 dias TTL)
│       └── tax-audit-logs/             # Logs de auditoria por contextHash
├── src/
│   ├── sidepanel/
│   │   ├── main.jsx                    # React entry point
│   │   ├── App.jsx                     # BrowserRouter com 11 rotas
│   │   ├── index.css                   # Tailwind
│   │   ├── pages/
│   │   │   ├── Home.jsx                # Menu principal (9 features)
│   │   │   ├── Settings.jsx            # Credenciais NetSuite + Claude + RESTlet URL
│   │   │   ├── Upload.jsx              # Upload + parse + Claude structuring
│   │   │   ├── Review.jsx              # Preview editavel (filial + contas)
│   │   │   ├── Status.jsx              # Progresso de criacao com retomada
│   │   │   ├── BalanceUpload.jsx       # Saldos iniciais — upload + mapeamento
│   │   │   ├── BalanceStatus.jsx       # Saldos iniciais — progresso PATCH
│   │   │   ├── TaxRules.jsx            # Regras fiscais — wizard 3 steps
│   │   │   ├── CustomerImport.jsx      # Importacao de clientes
│   │   │   ├── VendorImport.jsx        # Importacao de fornecedores
│   │   │   └── ItemImport.jsx          # Importacao de itens
│   │   └── components/
│   │       ├── FileUploader.jsx        # Upload single file (.xlsx/.xls/.csv)
│   │       ├── XmlFileUploader.jsx     # Upload multiplos (.xml)
│   │       ├── SubsidiaryPreview.jsx   # Formulario editavel da filial
│   │       └── ChartOfAccountsPreview.jsx  # Tabela editavel de contas
│   ├── services/
│   │   ├── claude-parser.js            # Prompt + chamada Claude via server
│   │   ├── coa-mapper.js              # Topological sort + batch creation + mapping
│   │   ├── subsidiary-creator.js       # Criacao de subsidiary via RESTlet
│   │   ├── journal-entry-creator.js    # Saldos iniciais (PATCH openingBalance)
│   │   ├── balance-parser.js           # Extracao de saldos via Claude
│   │   ├── tax-rule-generator.js       # Geracao de regras FTE a partir de NF-e
│   │   ├── tax-rule-exporter.js        # Export regras para XLSX/CSV/NetSuite
│   │   ├── customer-mapper.js          # Mapeamento de clientes
│   │   └── item-mapper.js             # Mapeamento de itens
│   ├── parsers/
│   │   ├── excel-parser.js            # SheetJS — roda no browser
│   │   └── nfe-parser.js             # Parse NF-e XML
│   ├── types/
│   │   ├── account.js                 # JSDoc types para Account
│   │   ├── netsuite.js               # AccountType enum + GeneralRateType
│   │   └── messages.js               # MessageType constants (27 tipos)
│   ├── utils/
│   │   ├── api-client.js             # sendToBackground() via HTTP fetch
│   │   ├── netsuite-auth.js          # OAuth 1.0 header generator (HMAC-SHA256)
│   │   └── progress-store.js         # Persistencia de progresso (localStorage)
│   └── data/
│       └── tax-reference.js          # TAX_CODES, PARAM_TYPES, CST mappings, CFOP classifier
├── shared/
│   ├── canonical.js                   # canonicalize, deterministicHash, stableId, stableDetId (PURO JS, browser+Node)
│   └── tax-rule-core.js              # classifyCFOP, resolveParamType, findBestNSMatchSafe, CST_TO_PARAM_TYPE
├── suitescripts/
│   └── rl_create_subsidiary.js       # RESTlet — multi-action (subsidiary, tax, customer, vendor, item)
└── Docs_aux/                          # Documentacao auxiliar
```

---

## Comunicacao Frontend ↔ Server

### `sendToBackground(message)` — `src/utils/api-client.js`

```js
// Toda comunicacao passa por aqui
sendToBackground({ type: 'NETSUITE_API_REQUEST', method: 'POST', endpoint: '/account', body: {...} })
// Internamente: fetch('/api/message', { body: JSON.stringify(msg) })
```

### 27 Message Types — `src/types/messages.js`

| Tipo | Destino | Descricao |
|------|---------|-----------|
| `SAVE_CREDENTIALS` | Arquivo JSON | Salvar credenciais |
| `GET_CREDENTIALS` | Arquivo JSON | Carregar credenciais |
| `STRUCTURE_DATA` | Claude API | Estruturar dados financeiros via LLM |
| `NETSUITE_API_REQUEST` | REST API | Qualquer request REST (GET/POST/PATCH/DELETE) |
| `CREATE_SUBSIDIARY` | RESTlet | Criar filial |
| `CREATE_ACCOUNTS` | REST API | Criar conta contabil |
| `SUITEQL_QUERY` | SuiteQL | Query SQL no NetSuite |
| `FETCH_LOOKUP_DATA` | RESTlet | Buscar dados de referencia |
| `TAX_DISCOVERY` | RESTlet | Descobrir opcoes FTE |
| `CREATE_TAX_RULES` | RESTlet | Criar regras + determinacoes FTE |
| `CREATE_CUSTOMERS` | RESTlet | Criar clientes em lote |
| `CUSTOMER_LOOKUP_DATA` | RESTlet | Buscar dados de clientes |
| `CREATE_VENDORS` | RESTlet | Criar fornecedores em lote |
| `ITEM_LOOKUP_DATA` | RESTlet | Buscar dados de itens |
| `SEARCH_NCM` | RESTlet | Buscar NCM por query |
| `BATCH_SEARCH_NCM` | RESTlet | Buscar NCMs em lote |
| `CREATE_ITEMS` | RESTlet | Criar itens em lote |
| `SET_OPENING_BALANCES` | RESTlet | Definir saldos iniciais via record.submitFields |
| `ANALYZE_TAX_RULES` | Server (pipeline) | Stats → Pre-Validador → AI Reviewer pipeline |
| `RESOLVE_TAX_CONFLICT` | Server (IA) | Resolver conflito especifico via IA |

### 3 Canais NetSuite

| Canal | URL | Quando usar |
|-------|-----|-------------|
| **REST API** | `https://{account}.suitetalk.api.netsuite.com/services/rest/record/v1/*` | CRUD unitario (accounts) |
| **RESTlet** | URL configuravel em Settings | Operacoes bulk e customizadas (subsidiary, tax rules, customers, vendors, items, opening balances) |
| **SuiteQL** | `https://{account}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql` | Queries de leitura (listar contas, buscar IDs) |

---

## Tipos Principais

### AccountType (NetSuite enum) — `src/types/netsuite.js`

```js
const AccountType = {
  Bank: 'Bank', AcctRec: 'AcctRec', OthCurrAsset: 'OthCurrAsset',
  FixedAsset: 'FixedAsset', OthAsset: 'OthAsset', AcctPay: 'AcctPay',
  OthCurrLiab: 'OthCurrLiab', LongTermLiab: 'LongTermLiab', Equity: 'Equity',
  Income: 'Income', COGS: 'COGS', Expense: 'Expense',
  DeferRevenue: 'DeferRevenue', DeferExpense: 'DeferExpense', UnbilledRec: 'UnbilledRec',
};
```

### Mapeamento de Contas (Brasil → NetSuite)

```
1.x.x.x    → OthAsset        (Ativo — default)
  1.1.x.x  → OthCurrAsset    (Ativo Circulante)
    1.1.1.x → Bank            (Caixa/Bancos)
    1.1.2.x → AcctRec         (Contas a Receber)
  1.2.x.x  → FixedAsset      (Ativo Nao Circulante)
2.x.x.x    → OthCurrLiab     (Passivo — default)
  2.1.x.x  → OthCurrLiab     (Passivo Circulante)
    2.1.1.x → AcctPay         (Fornecedores)
  2.2.x.x  → LongTermLiab    (Passivo Nao Circulante)
3.x.x.x    → Equity
4.x.x.x    → Income
5.x.x.x    → COGS
6.x.x.x    → Expense
```

A Claude API resolve contas que nao seguem o padrao numerico.

---

## Credenciais — `server/data/credentials.json`

```js
{
  netsuiteAccountId: string,   // ex: "TD3066446"
  consumerKey: string,
  consumerSecret: string,
  tokenId: string,
  tokenSecret: string,
  claudeApiKey: string,        // sk-ant-...
  restletUrl: string,          // URL do RESTlet customizado
}
```

Configuradas via `/settings`. Nunca hardcodar no codigo.

---

## Scripts

```bash
npm run dev          # Concurrently: Express (watch) + Vite dev server
npm run dev:server   # Apenas Express com --watch
npm run dev:client   # Apenas Vite
npm run build        # Vite build → /dist
npm start            # Express serve /dist + /api (producao)
```

---

## Prompt Template — Claude API

O prompt em `claude-parser.js` instrui a Claude a retornar **apenas JSON valido**:

```json
{
  "subsidiary": {
    "name": "razao social",
    "cnpj": "XX.XXX.XXX/XXXX-XX",
    "ie": "inscricao estadual",
    "address": "endereco completo",
    "city": "cidade",
    "state": "UF",
    "zipCode": "CEP",
    "taxRegime": "Lucro Real | Lucro Presumido | Simples Nacional",
    "cnae": "codigo CNAE"
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

Regras: mapear TODAS as contas, usar AccountTypes do NetSuite, manter hierarquia (parent = number da conta pai), nao inventar dados.

---

## Saldos Iniciais — Journal Entry via RESTlet

Saldos de abertura sao definidos criando um **Journal Entry** via RESTlet.

**IMPORTANTE:** O campo `openingBalance` no registro `account` e **somente-leitura apos criacao**:
- REST API PATCH retorna 204 mas ignora silenciosamente o campo
- SuiteScript `record.submitFields` retorna erro de permissao
- O campo so pode ser setado durante `record.create` (criacao da conta)

**Fluxo:** `journal-entry-creator.js` → `setOpeningBalances()` → `SET_OPENING_BALANCES` message → RESTlet action `setOpeningBalances` → cria `JOURNAL_ENTRY` com linhas debit/credit por conta + contrapartida na conta "Saldo Inicial" (Opening Balance Equity, auto-detectada por nome).

A conta de contrapartida e encontrada automaticamente via SuiteQL (nome contendo "Saldo Inicial" ou "Opening Balance").

---

## Regras Fiscais (FTE) — Arquitetura 6 Camadas

```
CAMADA 1: PARSE — nfe-parser.js (XML) / SPED EFD (server upload)
CAMADA 2: MOTOR DETERMINISTICO — tax-rule-generator.js (IDs estaveis via FNV-1a hash)
CAMADA 3: STATS BUILDER — server/services/tax-stats-builder.js
CAMADA 4: PRE-VALIDADOR — server/services/tax-pre-validator.js (unica fonte de severity "error")
CAMADA 5: AI REVIEWER — server/services/tax-ai-analyzer.js (Claude temp=0, warning/info apenas)
CAMADA 6: UI REVIEW — TaxRules.jsx (toggle IA, banner unresolved, bloqueio criacao)
```

### IDs Estaveis (shared/canonical.js)

- `deterministicHash()` — FNV-1a double-pass, 16 hex chars, puro JS (browser+Node)
- `stableIdWithCollisionCheck()` — hash + deteccao de colisao com sufixo deterministico
- `stableDetId()` — hash de [ruleKey, taxCode, paramType, cst, aliq]
- `canonicalRuleKey()` — chave intra-source para externalId
- `canonicalMatchKey()` — chave cross-source para comparacao SPED vs XML
- `canonicalize()` — normalizacao deterministica de objetos para cache hash

### Pre-Validador (Camada 4)

6 constraint checks (unica fonte de error). 3 cenarios de auto-apply:
1. null + unico valor valido → preencher
2. CST formato errado + CSOSN dominante (>=95%) → corrigir
3. tipoParametro null + CST_TO_PARAM_TYPE match univoco → preencher

### AI Reviewer (Camada 5)

- Modelo: Claude Sonnet 4, temperature=0, max_tokens=4096
- Cache SHA-256 com TTL 90 dias em `server/data/tax-ai-cache/`
- PII: CNPJ → `sup-{hash8}`, NF-e key → `doc-{hash8}`
- Threshold: skip IA se < 50 items ou sem API key
- Validador pos-IA: rebaixa error→warning, trunca 150 issues / 80 patches / 3 por regra
- Audit logs em `server/data/tax-audit-logs/{contextHash}.json`
- Endpoint: `GET /api/tax-audit/:contextHash`

### Resolucao de tipoParametro

- `resolveParamType()` — lookup CST_TO_PARAM_TYPE, retorna null se nao encontrado
- `findBestNSMatchSafe()` — match tipado contra nsParamTypes reais do NetSuite
  - Retorna `{ value, matched, matchType }` (exact/normalized/cClassTrib/cst_prefix/partial/none)
- Determinacoes nao resolvidas: `_unresolvedParam: true`, `_suggestedParam`, `_paramMatch`
- UI bloqueia criacao por padrao; checkbox avancado permite skip explicito

### Dados de Referencia

`src/data/tax-reference.js`: TAX_CODES, PARAM_TYPES, CST_TO_PARAM_TYPE, CFOP classifier.
`shared/tax-rule-core.js`: classifyCFOP, resolveParamType, findBestNSMatchSafe, makeTaxSignature.

---

## Validacao de Campos — metadata-catalog

Antes de criar payloads para records novos, consultar:

```
GET /services/rest/record/v1/metadata-catalog/subsidiary
GET /services/rest/record/v1/metadata-catalog/account
```

Usar header `Accept: application/schema+json` para obter campos com tipos.
