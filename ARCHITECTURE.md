# ARCHITECTURE.md — Decisoes Arquiteturais

## Por que Web App (e nao Chrome Extension)

O projeto comecou como Chrome Extension (Manifest V3) com Side Panel. A migracao para web app resolveu:

| Problema da Extension | Solucao na Web App |
|---|---|
| Service Worker morre apos ~30s de inatividade | Express server persiste indefinidamente |
| `chrome.storage.local` limitado e assincrono | Arquivo JSON no server + localStorage no browser |
| CORS restrito ao background script | Server faz todas as chamadas externas sem restricao |
| Distribuicao via Chrome Web Store | `npm start` em qualquer maquina |
| Side Panel com ~400px de largura | Layout responsivo full-width |
| `chrome.alarms` para keep-alive | Desnecessario |

A interface de mensagens foi preservada: `sendToBackground(msg)` continua sendo a funcao que os services chamam. O transporte mudou de `chrome.runtime.sendMessage` para `fetch('/api/message')`, mas o contrato (type + payload → response) é identico.

---

## Fluxo de Comunicacao

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (React)                                                │
│                                                                 │
│  Component → Service (claude-parser, coa-mapper, etc.)          │
│           → sendToBackground({ type, ...payload })              │
│           → fetch('/api/message', POST body)                    │
│                          │                                      │
└──────────────────────────┼──────────────────────────────────────┘
                           │ HTTP
┌──────────────────────────┼──────────────────────────────────────┐
│  Express Server          │                                      │
│                          ▼                                      │
│  router.post('/message') → handleMessage(req.body)              │
│                          │                                      │
│              ┌───────────┼───────────┐                          │
│              │           │           │                          │
│              ▼           ▼           ▼                          │
│         Claude API   REST API    RESTlet     SuiteQL            │
│         (Anthropic)  (NetSuite)  (NetSuite)  (NetSuite)         │
│                                                                 │
│  OAuth 1.0 signing acontece aqui (netsuite-auth.js)             │
│  Credenciais lidas de server/data/credentials.json              │
└─────────────────────────────────────────────────────────────────┘
```

### Vite Dev Server (desenvolvimento)

```
Browser :5173 → Vite (HMR + React)
         /api/* → proxy para localhost:3001 (Express)
```

### Producao

```
Browser → Express :3001
          /api/* → handleMessage()
          /*     → serve /dist/index.html (SPA fallback)
```

---

## 3 Canais NetSuite

O server usa 3 canais diferentes para comunicar com o NetSuite, cada um com caracteristicas proprias:

### REST API — `callNetSuiteAPI()`

```
URL: https://{account}.suitetalk.api.netsuite.com/services/rest/record/v1/{record}
```

- CRUD unitario em records padrao (account, subsidiary, etc.)
- Usado para: criar contas individuais (`POST /account`), PATCH openingBalance, GET metadata
- Headers obrigatorios: `Accept-Language: en`, `Content-Language: en`
- Retorna `Location` header com internalId em POST

### RESTlet — `callRestlet()`

```
URL: configuravel em Settings (credentials.restletUrl)
```

- Script SuiteScript customizado que roda no NetSuite (`suitescripts/rl_create_subsidiary.js`)
- Multi-action via campo `action` no body/query
- Usado para: operacoes bulk (customers, vendors, items), subsidiary creation, tax rules
- Actions disponiveis: `createSubsidiary`, `createFTERules`, `createCustomers`, `createVendors`, `createItems`, `searchNCM`, `batchSearchNCM`, `taxDiscovery`, `customerLookup`, `itemLookup`

### SuiteQL — `callSuiteQL()`

```
URL: https://{account}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql
```

- Queries SQL-like para leitura de dados
- Usado para: listar contas existentes, buscar IDs, validacoes pre-criacao
- Paginacao via `limit` e `offset` (default 1000)
- Header: `Prefer: transient`
- URL completa (com query params) é assinada no OAuth

---

## OAuth 1.0 — Token-Based Authentication

```
src/utils/netsuite-auth.js → generateAuthHeader(method, url, credentials)
```

- Algoritmo: HMAC-SHA256
- Sem refresh token, sem expiracao
- **Realm DEVE ser uppercase** (ex: `TD3066446`)
- URL assinada sem query parameters — query params sao passados separadamente ao OAuth
- Shared entre REST API, RESTlet e SuiteQL — mesma funcao de signing

---

## Persistencia

| Dado | Onde | Formato |
|------|------|---------|
| Credenciais OAuth + API keys | `server/data/credentials.json` | JSON file |
| Progresso de batch (COA) | `localStorage` (browser) | JSON via ProgressStore |
| Dados de review (subsidiary + accounts) | `sessionStorage` (browser) | JSON temporario |
| Dados de upload (parsed Excel) | State React (em memoria) | Objetos JS |

---

## Fluxos de Execucao

### Plano de Contas (COA)

```
Home → Upload
  → parseExcelFile() [browser, SheetJS]
  → STRUCTURE_DATA → Claude API → { subsidiary, accounts }
  → sessionStorage.setItem('reviewData', ...)
  → Review
    → usuario edita campos
    → CREATE_SUBSIDIARY → RESTlet → { subsidiaryId }
    → batchCreateAccounts()
      → topologicalSort() (pais antes de filhos)
      → para cada conta: CREATE_ACCOUNTS → REST API POST /account
      → mapa { accountNumber → internalId } para resolver parents
      → checkpoint em localStorage a cada conta
  → Status (progresso + erros + retry)
```

### Saldos Iniciais

```
Home → BalanceUpload
  → parseExcelFile() [browser, SheetJS]
  → STRUCTURE_DATA → Claude API → { balances, referenceDate }
  → SUITEQL_QUERY → buscar contas existentes no NetSuite
  → suggestAccountMapping() [fuzzy match nome/numero]
  → usuario revisa mapeamento
  → BalanceStatus
    → setOpeningBalances()
      → para cada conta: NETSUITE_API_REQUEST PATCH /account/{id}
        → body: { openingBalance, tranDate }
```

### Regras Fiscais

```
Home → TaxRules (wizard 3 steps)
  Step 1: Upload XMLs NF-e + config (subsidiary, regimes, LOBs)
    → parseNFeFiles() [browser, DOMParser]
    → generateTaxRules(items, config) → rules + determinations
  Step 2: Review regras (editavel)
  Step 3: Export
    → CREATE_TAX_RULES → RESTlet → cria regras FTE no NetSuite
    → ou exportar XLSX/CSV
```

### Clientes / Fornecedores / Itens

```
Home → CustomerImport / VendorImport / ItemImport
  → parseExcelFile() [browser]
  → mapeamento de colunas
  → CREATE_CUSTOMERS / CREATE_VENDORS / CREATE_ITEMS → RESTlet (bulk)
```

---

## RESTlet — `suitescripts/rl_create_subsidiary.js`

Script SuiteScript 2.x deployado no NetSuite. Funciona como API gateway customizada:

- **GET**: `action` via query param → retorna dados de lookup
- **POST**: `action` no body → cria registros

O RESTlet é necessario porque a REST API padrao nao suporta certas operacoes (ex: criar subsidiary com campos BR customizados, criar regras FTE em bulk).

---

## Dependencias Principais

```json
{
  "express": "^4.21.0",       // Server HTTP
  "cors": "^2.8.5",           // CORS middleware
  "react": "^18.3.1",         // UI
  "react-router-dom": "^6.26.0", // Rotas
  "xlsx": "^0.18.5",          // Parse Excel (SheetJS)
  "oauth-1.0a": "^2.2.6",    // OAuth 1.0 signing
  "crypto-js": "^4.2.0",     // HMAC-SHA256
  "lucide-react": "^0.400.0", // Icones
  "concurrently": "^9.0.0"   // Dev: server + client paralelo
}
```

---

## Convencoes

- JavaScript puro com JSDoc para tipos (nao TypeScript)
- Componentes React como funcoes com hooks
- Imports com extensao `.js` / `.jsx` explicita
- Sem CSS modules — Tailwind utility classes
- Cores customizadas: `ocean-10` a `ocean-180`, `rose`, `emerald`
- Sem testes unitarios no momento (validacao manual)
