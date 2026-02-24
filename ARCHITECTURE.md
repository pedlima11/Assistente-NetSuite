# NetSuite Setup Assistant — Plano de Arquitetura (Chrome Extension)

## Objetivo

Plugin Chrome Extension (Manifest V3 + React + TypeScript) que automatiza a implantação do NetSuite. O usuário anexa arquivos financeiros e o plugin extrai dados, cria filial e configura plano de contas automaticamente.

**Escopo inicial:** Criação de filial + plano de contas a partir de Balanço Patrimonial e Balancete. Demais importações (NFs, SPEDs, DRE) serão implementadas depois.

---

## Decisões de Arquitetura

| Decisão | Escolha | Justificativa |
|---------|---------|---------------|
| Frontend | Chrome Extension + React + TypeScript | Side Panel com Vite build |
| UI Mode | Side Panel (não popup) | Side panel persiste enquanto o usuário navega. Popup fecha ao perder foco — inviável para fluxos longos |
| Integração NetSuite | SuiteTalk REST API | API oficial, robusta, cria registros programaticamente |
| Autenticação | OAuth 1.0 (Token-Based Auth) | Único método TBA suportado pelo NetSuite. Sem expiração de token, sem redirect flow |
| Parsing de arquivos | Claude API | Mais fácil — estrutura JSON a partir de dados financeiros sem parsers manuais complexos |
| Automação | Totalmente automático | Extrai, mapeia e cria — apenas confirmação final do usuário |

---

## Arquitetura — Pontos Críticos

### 1. CORS: Todas as chamadas de API passam pelo Service Worker

Chrome Extensions só permitem requests cross-origin a partir do background service worker. Os componentes React no side panel **NÃO fazem fetch direto**. O fluxo é:

```
React Component → chrome.runtime.sendMessage({ type, payload })
    → Service Worker recebe → faz fetch para Claude API / NetSuite API
    → Retorna resposta via sendResponse / chrome.runtime.onMessage
```

O service worker é o único ponto de saída para APIs externas.

### 2. Parse de arquivos acontece no Side Panel (não no Service Worker)

Objetos `File`/`Blob` **não são JSON-serializáveis** e não podem ser enviados via `chrome.runtime.sendMessage`. Portanto:

- **SheetJS (excel-parser)** roda no contexto do side panel, onde tem acesso ao DOM e ao objeto `File`
- O side panel extrai os dados para JSON e **envia apenas o JSON** ao service worker
- O service worker recebe dados já parseados e os encaminha para a Claude API

```
Side Panel: File → excel-parser → JSON (ParsedData)
    → chrome.runtime.sendMessage({ type: 'STRUCTURE_DATA', data: parsedJSON })
    → Service Worker: recebe JSON → Claude API → retorna structured data
```

### 3. Segurança da Claude API Key

A API key da Anthropic fica em `chrome.storage.local`. Para uso corporativo interno isso é aceitável. Se for distribuir publicamente, será necessário um backend proxy (ex: Cloudflare Worker) para não expor a key.

### 4. Ordem de execução: Subsidiary ANTES de Accounts

No NetSuite, accounts são vinculadas a uma subsidiary. O orchestrator deve garantir:

```
1. Criar subsidiary → obter internalId
2. Criar accounts vinculadas ao subsidiary internalId
```

Nunca criar accounts sem a subsidiary existir.

### 5. Hierarquia de contas: Topological Sort + Mapa de IDs

Contas pai devem ser criadas antes das filhas. O `coa-mapper` deve:

1. Ordenar topologicamente antes de disparar criações em lote (pais antes de filhos)
2. Manter um mapa `{ accountNumber → internalId }` à medida que cada conta é criada
3. Usar o mapa para resolver o campo `parent` (internalId) das contas filhas

```
1.0.0.0 Ativo (pai)        → criar primeiro  → salvar { "1.0.0.0": "12345" }
1.1.0.0 Ativo Circulante   → criar segundo   → parent: mapa["1.0.0.0"] = "12345"
1.1.1.0 Caixa              → criar terceiro   → parent: mapa["1.1.0.0"] = "12346"
```

A criação é **estritamente sequencial** (uma conta por vez) para respeitar a dependência hierárquica e os rate limits da API do NetSuite.

### 6. Service Worker pode ser terminado pelo Chrome

Manifest V3 service workers são encerrados após ~30s de inatividade ou ~5min de execução contínua. Para operações longas (batch de contas):

- Processar em **chunks menores** (ex: 10 contas por vez)
- Persistir progresso em `chrome.storage.local` após cada chunk
- Usar `chrome.alarms` para keep-alive durante a execução
- Se o service worker reiniciar, retomar do último checkpoint

### 7. Persistência de progresso e retomada

O estado da criação é salvo em `chrome.storage.local` a cada conta criada:

```json
{
  "batchProgress": {
    "subsidiaryId": "12345",
    "totalAccounts": 150,
    "createdAccounts": 87,
    "accountIdMap": { "1.0.0.0": "12345", "1.1.0.0": "12346" },
    "lastCreatedIndex": 86,
    "errors": [{ "index": 42, "account": "1.1.3.0", "error": "INVALID_TYPE" }]
  }
}
```

Se o processo for interrompido (service worker morto, browser fechado), o usuário pode retomar a partir da página /status.

---

## Estrutura do Projeto

```
netsuite-setup-assistant/
├── manifest.json                     # Manifest V3 com sidePanel
├── sidepanel.html                    # Entry HTML do side panel
├── vite.config.ts
├── package.json
├── tsconfig.json
├── public/
│   └── icons/
├── src/
│   ├── background/
│   │   └── service-worker.ts         # Proxy de API calls (Claude + NetSuite)
│   │
│   ├── sidepanel/
│   │   ├── main.tsx                  # React entry point
│   │   ├── App.tsx                   # MemoryRouter (não BrowserRouter)
│   │   ├── pages/
│   │   │   ├── Settings.tsx          # Config credenciais (uma vez)
│   │   │   ├── Upload.tsx            # Drag & drop de arquivos
│   │   │   ├── Review.tsx            # Preview filial + plano de contas
│   │   │   └── Status.tsx            # Progresso de criação (com retomada)
│   │   └── components/
│   │       ├── FileUploader.tsx
│   │       ├── SubsidiaryPreview.tsx
│   │       └── ChartOfAccountsPreview.tsx
│   │
│   ├── services/
│   │   ├── claude-parser.ts          # Chamadas à Claude API (via service worker)
│   │   ├── netsuite-api.ts           # Client REST genérico (via service worker)
│   │   ├── subsidiary-creator.ts     # Lógica de criação de filial
│   │   └── coa-mapper.ts             # Mapeamento + topological sort + batch creation
│   │
│   ├── parsers/
│   │   └── excel-parser.ts           # Parse no SIDE PANEL (acesso a File/DOM)
│   │
│   ├── types/
│   │   ├── subsidiary.ts
│   │   ├── account.ts
│   │   ├── netsuite.ts
│   │   └── messages.ts               # Tipos de mensagens Chrome runtime
│   │
│   └── utils/
│       ├── netsuite-auth.ts           # OAuth 1.0 HMAC-SHA256 header generator
│       ├── chrome-messaging.ts        # Helper para sendMessage/onMessage
│       ├── progress-store.ts          # Persistência de progresso em chrome.storage.local
│       └── file-reader.ts
```

---

## Plano de Implementação — Ordem dos Arquivos

### Fase 1: Infraestrutura (arquivos 1-6)

| # | Arquivo | O que implementar |
|---|---------|-------------------|
| 1 | `src/types/subsidiary.ts` | Interface `Subsidiary` com campos: name, cnpj, ie, address, city, state, zipCode, taxRegime, cnae |
| 2 | `src/types/account.ts` | Interface `Account` com campos: number, name, type (NetSuite AccountType enum), parent, level, subsidiaryId |
| 3 | `src/types/netsuite.ts` | Enum `AccountType` completo: `Bank, AcctRec, OthCurrAsset, FixedAsset, OthAsset, AcctPay, OthCurrLiab, LongTermLiab, Equity, Income, COGS, Expense, DeferRevenue, DeferExpense, UnbilledRec`. Tipos de resposta da API |
| 4 | `src/types/messages.ts` | Union type das mensagens Chrome runtime: `StructureDataMessage` (recebe JSON pré-parseado, não File), `CreateSubsidiaryMessage`, `CreateAccountsMessage`, `ApiResponseMessage` |
| 5 | `src/utils/chrome-messaging.ts` | Helper `sendToBackground<T>(message): Promise<T>` que encapsula `chrome.runtime.sendMessage` com tipagem |
| 6 | `src/utils/progress-store.ts` | Classe `ProgressStore`: `save(progress)`, `load(): Progress | null`, `clear()`, `hasIncomplete(): boolean`. Persiste em `chrome.storage.local` |

### Fase 2: Autenticação + Client REST (arquivos 7-8)

| # | Arquivo | O que implementar |
|---|---------|-------------------|
| 7 | `src/utils/netsuite-auth.ts` | Função `generateAuthHeader(method, url, credentials): string` — gera OAuth 1.0 header com HMAC-SHA256 usando `oauth-1.0a` + `crypto-js`. Credentials: accountId, consumerKey, consumerSecret, tokenId, tokenSecret |
| 8 | `src/services/netsuite-api.ts` | Classe `NetSuiteClient` com métodos: `get(endpoint)`, `post(endpoint, body)`, `delete(endpoint)`. Usa `generateAuthHeader` para cada request. Base URL: `https://{accountId}.suitetalk.api.netsuite.com/services/rest/record/v1/`. **Importante:** Validar nomes de campo contra o metadata-catalog real (`GET /record/v1/metadata-catalog/subsidiary` e `/account`) antes de hardcodar payloads |

### Fase 3: Parser + Mapeador (arquivos 9-11)

| # | Arquivo | O que implementar |
|---|---------|-------------------|
| 9 | `src/parsers/excel-parser.ts` | Função `parseExcelFile(file: File): Promise<ParsedData>` — **roda no side panel** (não no service worker). Usa SheetJS para ler .xlsx/.xls. Extrai: headers, dados por linha, identifica tipo de arquivo (balanço vs balancete) pelo conteúdo. Retorna JSON estruturado pronto para enviar ao service worker |
| 10 | `src/services/claude-parser.ts` | Função `structureFinancialData(rawData: ParsedData): Promise<{ subsidiary: Subsidiary, accounts: Account[] }>` — envia dados JSON pré-processados (não File) à Claude API via service worker. Prompt template define o schema JSON esperado. O prompt instrui a Claude a: extrair dados da empresa, mapear cada conta para AccountType do NetSuite, resolver ambiguidades de classificação |
| 11 | `src/services/coa-mapper.ts` | Classe `ChartOfAccountsMapper`: (a) `mapAccounts(accounts)` — aplica regras de mapeamento por código, (b) `topologicalSort(accounts)` — ordena contas para criação hierárquica, (c) `validate(accounts)` — verifica: sem ciclos, sem órfãos, todos os tipos mapeados |

### Fase 4: Criação no NetSuite (arquivos 12-13)

| # | Arquivo | O que implementar |
|---|---------|-------------------|
| 12 | `src/services/subsidiary-creator.ts` | Função `createSubsidiary(client: NetSuiteClient, data: Subsidiary): Promise<{ internalId: string }>` — POST /record/v1/subsidiary com payload mapeado. **Antes de hardcodar campos, consultar metadata-catalog para nomes corretos** (ex: federalIdNumber, state1TaxNumber, mainAddress). Retry com backoff em caso de 429/500 |
| 13 | Extensão do `coa-mapper.ts` | Função `createAccountsBatch(client, accounts, subsidiaryId, onProgress): Promise<BatchResult>` — cria contas **sequencialmente** na ordem topológica. Mantém mapa `{ accountNumber → internalId }` para resolver parents. Após cada conta criada: salva checkpoint via `ProgressStore`. Processa em chunks com keep-alive. Emite progresso via callback. Log de erros com retry individual |

### Fase 5: Service Worker (arquivo 14)

| # | Arquivo | O que implementar |
|---|---------|-------------------|
| 14 | `src/background/service-worker.ts` | Listener `chrome.runtime.onMessage` que roteia por type: `STRUCTURE_DATA` → chama claude-parser (recebe JSON, não File), `CREATE_SUBSIDIARY` → chama subsidiary-creator, `CREATE_ACCOUNTS` → chama coa-mapper batch. Todos os fetch para APIs externas acontecem aqui. Implementa keep-alive via `chrome.alarms` durante operações longas. Retorna resultados via sendResponse |

### Fase 6: UI React (arquivos 15-21)

| # | Arquivo | O que implementar |
|---|---------|-------------------|
| 15 | `src/sidepanel/main.tsx` | ReactDOM.createRoot + renderiza App |
| 16 | `src/sidepanel/App.tsx` | **MemoryRouter** (não BrowserRouter — Chrome Extension não tem URL real) com rotas: /settings, /upload, /review, /status |
| 17 | `src/sidepanel/pages/Settings.tsx` | Formulário para credenciais NetSuite (Account ID, Consumer Key/Secret, Token ID/Secret) + API key da Claude. Salva em chrome.storage.local. Validação com request de teste |
| 18 | `src/sidepanel/components/FileUploader.tsx` | Drag & drop zone. Aceita .xlsx, .xls. Mostra lista de arquivos com ícone e nome. Botão "Processar". **O parse do Excel acontece aqui** (no contexto do side panel, não no service worker) |
| 19 | `src/sidepanel/pages/Upload.tsx` | Página com FileUploader. Ao processar: chama `parseExcelFile` localmente → envia JSON resultante ao service worker para estruturação via Claude → ao completar, navega para /review com dados |
| 20 | `src/sidepanel/pages/Review.tsx` | Duas seções: (a) SubsidiaryPreview — formulário editável com dados da filial, (b) ChartOfAccountsPreview — tabela com código, nome, tipo NetSuite, conta pai. Filtro por tipo. Edição inline de classificação. Botão "Criar no NetSuite" |
| 21 | `src/sidepanel/pages/Status.tsx` | Barra de progresso geral. Lista de itens: filial criada, progresso das contas (X de Y). Log de erros expansível com botão retry individual. **Ao abrir, verifica `ProgressStore` para retomar operação incompleta.** Estado final: sucesso ou parcial com detalhes |

---

## Manifest V3 — Configuração do Side Panel

```json
{
  "manifest_version": 3,
  "name": "NetSuite Setup Assistant",
  "version": "1.0.0",
  "description": "Automatiza a implantação do NetSuite a partir de arquivos financeiros",
  "permissions": [
    "sidePanel",
    "storage",
    "alarms"
  ],
  "host_permissions": [
    "https://*.suitetalk.api.netsuite.com/*",
    "https://api.anthropic.com/*"
  ],
  "background": {
    "service_worker": "src/background/service-worker.ts",
    "type": "module"
  },
  "side_panel": {
    "default_path": "sidepanel.html"
  },
  "action": {
    "default_title": "NetSuite Setup Assistant",
    "default_icon": {
      "16": "public/icons/icon16.png",
      "48": "public/icons/icon48.png",
      "128": "public/icons/icon128.png"
    }
  },
  "icons": {
    "16": "public/icons/icon16.png",
    "48": "public/icons/icon48.png",
    "128": "public/icons/icon128.png"
  }
}
```

> **Nota:** O service worker abre o side panel ao clicar no ícone da extensão via `chrome.sidePanel.open()` no listener de `chrome.action.onClicked`.

---

## Mapeamento de Contas — Regras

```
Código Contábil  →  Account Type NetSuite
─────────────────────────────────────────
1.x.x.x          →  OthAsset (default)
  1.1.x.x         →  OthCurrAsset (circulante)
    1.1.1.x        →  Bank (caixa/bancos)
    1.1.2.x        →  AcctRec (contas a receber)
  1.2.x.x         →  FixedAsset (não circulante)
2.x.x.x          →  OthCurrLiab (default)
  2.1.x.x         →  OthCurrLiab (circulante)
    2.1.1.x        →  AcctPay (fornecedores)
  2.2.x.x         →  LongTermLiab (não circulante)
3.x.x.x          →  Equity
4.x.x.x          →  Income
5.x.x.x          →  COGS (custos)
6.x.x.x          →  Expense (despesas)
```

A Claude API resolve contas ambíguas que não seguem o padrão numérico.

---

## Dependências (package.json)

```json
{
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0",
    "xlsx": "^0.18.5",
    "oauth-1.0a": "^2.2.6",
    "crypto-js": "^4.2.0",
    "lucide-react": "^0.400.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@types/crypto-js": "^4.2.1",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.3",
    "vite": "^5.4.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0"
  }
}
```

> **Nota sobre SheetJS:** A biblioteca `xlsx` mudou seu modelo de licenciamento. A versão community no npm pode ter limitações. Verificar se cobre as necessidades ou considerar `exceljs` como alternativa.

---

## Prompt Template para Claude API (claude-parser.ts)

```
Você é um especialista em contabilidade brasileira e NetSuite.
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
```

---

## Fluxo de Execução (Orchestrator)

```
1. Usuário clica no ícone da extensão
   └─ Service worker abre side panel via chrome.sidePanel.open()
   └─ Verifica credenciais em chrome.storage.local
   └─ Se não configurado → redireciona para /settings

2. /upload → usuário arrasta .xlsx
   └─ FileUploader valida tipo/tamanho
   └─ Clica "Processar"
   └─ excel-parser roda NO SIDE PANEL (acesso a File)
   └─ Dados JSON extraídos → sendToBackground({ type: 'STRUCTURE_DATA', data: parsedJSON })
   └─ Service Worker: encaminha JSON para Claude API → retorna { subsidiary, accounts }

3. /review → exibe dados extraídos
   └─ SubsidiaryPreview: formulário editável
   └─ ChartOfAccountsPreview: tabela com edição inline
   └─ Usuário revisa e clica "Criar no NetSuite"

4. /status → execução sequencial com checkpoints
   └─ Verifica ProgressStore — se há operação incompleta, oferece retomar
   └─ Step 1: sendToBackground({ type: 'CREATE_SUBSIDIARY', data })
   │          → subsidiary-creator → retorna { internalId }
   │          → salva checkpoint
   └─ Step 2: sendToBackground({ type: 'CREATE_ACCOUNTS', accounts, subsidiaryId })
              → coa-mapper.topologicalSort → createAccountsBatch (sequencial)
              → mantém mapa { accountNumber → internalId } para resolver parents
              → salva checkpoint a cada conta criada
              → emite progresso por conta
              → retorna BatchResult com sucessos/erros

5. Dashboard final: filial criada, X/Y contas criadas, erros (se houver)
   └─ Retry individual para contas com erro
   └─ ProgressStore.clear() ao completar com sucesso
```

---

## Validação de campos da API (passo obrigatório antes da Fase 4)

Antes de implementar `subsidiary-creator.ts` e o batch de contas, fazer uma chamada ao metadata-catalog do NetSuite para confirmar os nomes reais dos campos:

```
GET /services/rest/record/v1/metadata-catalog/subsidiary
GET /services/rest/record/v1/metadata-catalog/account
```

Campos a validar:
- Subsidiary: `federalIdNumber` (CNPJ?), `state1TaxNumber` (IE?), `mainAddress`, `country`, `currency`
- Account: `acctNumber`, `acctName`, `acctType`, `parent`, `subsidiary`

> **Nota:** O campo `currency` da subsidiary requer que BRL já exista como registro de moeda no NetSuite. Verificar antes de criar.

---

## Expansão Futura (não implementar agora)

- `src/parsers/nf-parser.ts` — Parse NF-e XML para extrair dados fiscais (CFOP, NCM, CST)
- `src/parsers/sped-parser.ts` — Parse SPED texto (registros 0000, 0150, 0500)
- `src/parsers/dre-parser.ts` — Parse DRE para contas de resultado
- `src/services/fiscal-rules-creator.ts` — Criação de regras fiscais baseadas em NFs
- Suporte a PDF via OCR
- Backend proxy para Claude API key (distribuição pública)
