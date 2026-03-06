import { Router } from 'express';
import { unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import multer from 'multer';
import { generateAuthHeader } from '../../src/utils/netsuite-auth.js';
import { parseSpedStream } from '../parsers/sped-parser.js';
import { parseSpedContribStream } from '../parsers/sped-contrib-parser.js';
import { normalizeItem } from '../services/sped-tax-normalizer.js';
import { normalizeContribItem } from '../services/sped-contrib-normalizer.js';
import { RuleAccumulator } from '../services/sped-rule-accumulator.js';
import { mergeResults } from '../services/sped-merge.js';
import { validateBlockM } from '../services/sped-block-m-validator.js';
import { normalizeCnpj } from '../../shared/tax-rule-core.js';
import { buildStats } from '../services/tax-stats-builder.js';
import { preValidate, prioritizeForAI } from '../services/tax-pre-validator.js';
import { analyzeTaxRules, getAuditLog } from '../services/tax-ai-analyzer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const router = Router();

// --- Extrair credenciais do request (stateless — nunca persiste no server) ---

function extractCredentials(message) {
  const c = message?._credentials;
  if (!c) {
    const err = new Error('Credenciais nao fornecidas. Va em Configuracoes e preencha os dados.');
    err.status = 400;
    throw err;
  }
  const required = ['netsuiteAccountId', 'consumerKey', 'consumerSecret', 'tokenId', 'tokenSecret'];
  for (const key of required) {
    if (!c[key] || typeof c[key] !== 'string') {
      const err = new Error(`Campo de credencial ausente ou invalido: ${key}`);
      err.status = 400;
      throw err;
    }
  }
  return c;
}

// --- Helpers ---

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Chama Claude API com os dados financeiros.
 * Inclui retry automatico para erros transitorios (429, 529, 503).
 */
async function callClaudeAPI(apiKey, prompt, financialData) {
  let rows = financialData.rows;
  let rowsJson = JSON.stringify(rows);
  const MAX_CHARS = 600000;

  if (rowsJson.length > MAX_CHARS) {
    console.warn(`Payload muito grande (${(rowsJson.length / 1024).toFixed(0)}KB, ${rows.length} linhas). Truncando...`);
    const ratio = MAX_CHARS / rowsJson.length;
    const maxRows = Math.floor(rows.length * ratio * 0.9);
    rows = rows.slice(0, maxRows);
    rowsJson = JSON.stringify(rows);
    console.warn(`Truncado para ${rows.length} linhas (${(rowsJson.length / 1024).toFixed(0)}KB)`);
  }

  const userMessage = `${prompt}\n\nDados do arquivo financeiro (${rows.length} linhas):\n${rowsJson}`;

  const MAX_RETRIES = 3;
  const RETRYABLE_STATUS = [429, 503, 529];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 16384,
        messages: [
          {
            role: 'user',
            content: userMessage,
          },
        ],
      }),
    });

    // --- Etapa 1: capturar body como texto ---
    const contentType = response.headers.get('content-type') || '';
    const raw = await response.text();

    // --- Etapa 2: parsear JSON (ou falhar descritivamente) ---
    let result = null;
    if (contentType.includes('application/json')) {
      try {
        result = JSON.parse(raw);
      } catch (e) {
        throw new Error(`Claude API respondeu JSON invalido (HTTP ${response.status}). Body: ${raw.slice(0, 300)}`);
      }
    } else {
      throw new Error(`Claude API respondeu content-type inesperado (${contentType}) (HTTP ${response.status}). Body: ${raw.slice(0, 300)}`);
    }

    // --- Etapa 3: tratar non-2xx com retry ou erro upstream ---
    if (!response.ok) {
      if (RETRYABLE_STATUS.includes(response.status) && attempt < MAX_RETRIES) {
        const waitMs = Math.min(1000 * Math.pow(2, attempt), 10000);
        console.warn(`Claude API ${response.status} — retentando em ${waitMs}ms (tentativa ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(waitMs);
        continue;
      }

      const upstreamMsg =
        result?.error?.message ||
        result?.message ||
        (typeof result?.error === 'string' ? result.error : null) ||
        `HTTP ${response.status}`;
      const err = new Error(`Claude API erro upstream: ${upstreamMsg}`);
      err.upstreamStatus = response.status;
      throw err;
    }

    // --- Etapa 4: validar content (JSON 200 ok) ---
    if (!Array.isArray(result.content) || result.content.length === 0) {
      throw new Error(`Claude API retornou sem content (stop_reason: ${result.stop_reason || 'unknown'})`);
    }

    const textBlock = result.content.find(b => b?.type === 'text' && typeof b.text === 'string' && b.text.trim().length > 0);
    if (!textBlock) {
      const types = result.content.map(b => b?.type).filter(Boolean).join(', ') || 'unknown';
      throw new Error(`Claude API retornou blocos sem texto (tipos: ${types})`);
    }

    const truncated = result.stop_reason === 'max_tokens';
    const text = textBlock.text;

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Claude API nao retornou JSON valido');
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (truncated) {
        console.warn('Resposta truncada mas JSON parseado com sucesso — pode estar incompleto');
      }
      return parsed;
    } catch (parseError) {
      let fixed = jsonMatch[0];
      const lastComma = fixed.lastIndexOf(',');
      if (lastComma > -1) {
        fixed = fixed.substring(0, lastComma);
      }
      const openBrackets = (fixed.match(/\[/g) || []).length - (fixed.match(/\]/g) || []).length;
      const openBraces = (fixed.match(/\{/g) || []).length - (fixed.match(/\}/g) || []).length;
      for (let i = 0; i < openBrackets; i++) fixed += ']';
      for (let i = 0; i < openBraces; i++) fixed += '}';

      try {
        const repaired = JSON.parse(fixed);
        console.warn(`JSON reparado — resposta ${truncated ? 'truncada' : 'com erro'}, recuperadas ${repaired.balances?.length || 0} contas`);
        return repaired;
      } catch {
        throw new Error(truncated
          ? 'Resposta da Claude foi cortada e nao foi possivel reparar o JSON. Tente com menos contas.'
          : `JSON invalido da Claude: ${parseError.message}`);
      }
    }
  }

  throw new Error('Claude API: todas as tentativas falharam');
}

/**
 * Executa request na NetSuite REST API
 */
async function callNetSuiteAPI(credentials, method, endpoint, body = null) {
  const accountSlug = credentials.netsuiteAccountId.toLowerCase().replace(/_/g, '-');
  const baseUrl = `https://${accountSlug}.suitetalk.api.netsuite.com/services/rest/record/v1`;
  const url = `${baseUrl}${endpoint}`;

  const authHeader = generateAuthHeader(method, url, {
    accountId: credentials.netsuiteAccountId,
    consumerKey: credentials.consumerKey,
    consumerSecret: credentials.consumerSecret,
    tokenId: credentials.tokenId,
    tokenSecret: credentials.tokenSecret,
  });

  const options = {
    method,
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
      'Content-Language': 'en',
      'Accept-Language': 'en',
      Accept: 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  console.log(`[NetSuite API] ${method} ${url}`, body ? JSON.stringify(body).substring(0, 500) : '(no body)');

  const response = await fetch(url, options);

  const text = await response.text();
  console.log(`[NetSuite API] Response: ${response.status} ${response.statusText}`, text ? text.substring(0, 500) : '(empty body)');

  if (!response.ok) {
    throw new Error(`NetSuite API error ${response.status}: ${text}`);
  }

  const location = response.headers.get('Location');
  let internalId = null;
  if (location) {
    const idMatch = location.match(/\/(\d+)$/);
    internalId = idMatch ? idMatch[1] : null;
  }

  if (!text || text.trim() === '') {
    return { success: true, internalId, location };
  }

  try {
    const data = JSON.parse(text);
    return { ...data, internalId: internalId || data.id || data.internalId };
  } catch {
    return { success: true, internalId, location, rawResponse: text };
  }
}

/**
 * Executa request em um RESTlet do NetSuite
 */
async function callRestlet(credentials, method, restletUrl, body = null) {
  const authHeader = generateAuthHeader(method, restletUrl, {
    accountId: credentials.netsuiteAccountId,
    consumerKey: credentials.consumerKey,
    consumerSecret: credentials.consumerSecret,
    tokenId: credentials.tokenId,
    tokenSecret: credentials.tokenSecret,
  });

  const options = {
    method,
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(restletUrl, options);

  const text = await response.text();
  if (!text || text.trim() === '') {
    if (!response.ok) {
      throw new Error(`RESTlet error ${response.status}`);
    }
    return { success: false, error: 'RESTlet retornou resposta vazia. Verifique o script no NetSuite.', emptyResponse: true };
  }

  const data = JSON.parse(text);

  if (!response.ok) {
    throw new Error(`RESTlet error ${response.status}: ${data.error || data.message || text}`);
  }

  return data;
}

/**
 * Executa query SuiteQL no NetSuite
 */
async function callSuiteQL(credentials, sql, limit = 1000, offset = 0) {
  const accountSlug = credentials.netsuiteAccountId.toLowerCase().replace(/_/g, '-');
  const url = `https://${accountSlug}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=${limit}&offset=${offset}`;

  const authHeader = generateAuthHeader('POST', url, {
    accountId: credentials.netsuiteAccountId,
    consumerKey: credentials.consumerKey,
    consumerSecret: credentials.consumerSecret,
    tokenId: credentials.tokenId,
    tokenSecret: credentials.tokenSecret,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Prefer: 'transient',
    },
    body: JSON.stringify({ q: sql }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`SuiteQL error ${response.status}: ${errorText}`);
  }

  return response.json();
}

// --- Message Router (mesmo switch/case do service-worker.js) ---

async function handleMessage(message) {
  // Credenciais vem do request (localStorage do browser), nunca do server
  // extractCredentials() so e chamado nos cases que precisam de NetSuite
  // Para STRUCTURE_DATA, so precisa de claudeApiKey

  switch (message.type) {
    case 'STRUCTURE_DATA': {
      const claudeKey = message._credentials?.claudeApiKey;
      if (!claudeKey) {
        throw new Error('API key da Claude nao configurada');
      }
      const result = await callClaudeAPI(
        claudeKey,
        message.data.prompt,
        message.data.financialData
      );
      return result;
    }

    case 'NETSUITE_API_REQUEST': {
      const credentials = extractCredentials(message);
      return callNetSuiteAPI(credentials, message.method, message.endpoint, message.body);
    }

    case 'FETCH_LOOKUP_DATA': {
      const credentials = extractCredentials(message);
      if (!credentials.restletUrl) {
        throw new Error('URL do RESTlet nao configurada');
      }
      return callRestlet(credentials, 'GET', credentials.restletUrl);
    }

    case 'TAX_DISCOVERY': {
      const credentials = extractCredentials(message);
      if (!credentials.restletUrl) {
        throw new Error('URL do RESTlet nao configurada');
      }
      const action = message.action || 'taxDiscovery';
      const discoveryUrl = credentials.restletUrl + '&action=' + action;
      return callRestlet(credentials, 'GET', discoveryUrl);
    }

    case 'CREATE_TAX_RULES': {
      const credentials = extractCredentials(message);
      if (!credentials.restletUrl) {
        throw new Error('URL do RESTlet nao configurada. Va em Configuracoes e preencha a URL do RESTlet.');
      }
      return callRestlet(credentials, 'POST', credentials.restletUrl, {
        action: 'createFTERules',
        rules: message.data.rules,
        determinations: message.data.determinations,
      });
    }

    case 'CREATE_CUSTOMERS': {
      const credentials = extractCredentials(message);
      if (!credentials.restletUrl) {
        throw new Error('URL do RESTlet nao configurada. Va em Configuracoes e preencha a URL do RESTlet.');
      }
      return callRestlet(credentials, 'POST', credentials.restletUrl, {
        action: 'createCustomers',
        customers: message.data.customers,
        subsidiaryId: message.data.subsidiaryId,
      });
    }

    case 'CUSTOMER_LOOKUP_DATA': {
      const credentials = extractCredentials(message);
      if (!credentials.restletUrl) {
        throw new Error('URL do RESTlet nao configurada.');
      }
      const custLookupUrl = credentials.restletUrl + '&action=customerLookup';
      return callRestlet(credentials, 'GET', custLookupUrl);
    }

    case 'CREATE_VENDORS': {
      const credentials = extractCredentials(message);
      if (!credentials.restletUrl) {
        throw new Error('URL do RESTlet nao configurada. Va em Configuracoes e preencha a URL do RESTlet.');
      }
      return callRestlet(credentials, 'POST', credentials.restletUrl, {
        action: 'createVendors',
        vendors: message.data.vendors,
        subsidiaryId: message.data.subsidiaryId,
      });
    }

    case 'ITEM_LOOKUP_DATA': {
      const credentials = extractCredentials(message);
      if (!credentials.restletUrl) {
        throw new Error('URL do RESTlet nao configurada.');
      }
      const subIdParam = message.data?.subsidiaryId ? '&subsidiaryId=' + encodeURIComponent(message.data.subsidiaryId) : '';
      const itemTypeParam = message.data?.itemType ? '&itemType=' + encodeURIComponent(message.data.itemType) : '';
      const itemLookupUrl = credentials.restletUrl + '&action=itemLookup' + subIdParam + itemTypeParam;
      return callRestlet(credentials, 'GET', itemLookupUrl);
    }

    case 'SEARCH_NCM': {
      const credentials = extractCredentials(message);
      if (!credentials.restletUrl) {
        throw new Error('URL do RESTlet nao configurada.');
      }
      const ncmQuery = encodeURIComponent(message.data.query || '');
      const ncmUrl = credentials.restletUrl + '&action=searchNCM&query=' + ncmQuery;
      return callRestlet(credentials, 'GET', ncmUrl);
    }

    case 'BATCH_SEARCH_NCM': {
      const credentials = extractCredentials(message);
      if (!credentials.restletUrl) {
        throw new Error('URL do RESTlet nao configurada.');
      }
      const ncmCodes = (message.data.codes || []).join(',');
      const batchNcmUrl = credentials.restletUrl + '&action=batchSearchNCM&codes=' + encodeURIComponent(ncmCodes);
      return callRestlet(credentials, 'GET', batchNcmUrl);
    }

    case 'CREATE_ITEMS': {
      const credentials = extractCredentials(message);
      if (!credentials.restletUrl) {
        throw new Error('URL do RESTlet nao configurada. Va em Configuracoes e preencha a URL do RESTlet.');
      }
      return callRestlet(credentials, 'POST', credentials.restletUrl, {
        action: 'createItems',
        items: message.data.items,
        itemType: message.data.itemType,
        subsidiaryId: message.data.subsidiaryId,
        globalConfig: message.data.globalConfig,
      });
    }

    case 'CREATE_SUBSIDIARY': {
      const credentials = extractCredentials(message);
      if (!credentials.restletUrl) {
        throw new Error('URL do RESTlet nao configurada. Va em Configuracoes e preencha a URL do RESTlet.');
      }
      const data = message.data;
      const payload = {
        name: data.name,
        parent: data.parent || null,
        country: 'BR',
        currency: data.currency || null,
        taxfiscalcalendar: data.taxfiscalcalendar || null,
        fiscalcalendar: data.fiscalcalendar || null,
        languagelocale: data.languagelocale || 'en_US',
        cnpj: data.cnpj,
        ie: data.ie,
        address: data.address,
        addressNumber: data.addressNumber,
        state: data.state,
        zipCode: data.zipCode,
        brCityId: data.brCityId || null,
        customFields: data.customFields || {},
      };
      const cleanPayload = JSON.parse(JSON.stringify(payload));
      const result = await callRestlet(credentials, 'POST', credentials.restletUrl, cleanPayload);
      if (!result.success) {
        throw new Error(result.error || 'Erro ao criar subsidiary via RESTlet');
      }
      return result;
    }

    case 'CREATE_ACCOUNTS': {
      const credentials = extractCredentials(message);
      return callNetSuiteAPI(credentials, 'POST', '/account', message.body);
    }

    case 'SUITEQL_QUERY': {
      const credentials = extractCredentials(message);
      return callSuiteQL(credentials, message.sql, message.limit || 1000, message.offset || 0);
    }

    case 'SET_OPENING_BALANCES': {
      const credentials = extractCredentials(message);
      if (!credentials.restletUrl) {
        throw new Error('URL do RESTlet nao configurada');
      }
      const balancesPayload = {
        action: 'setOpeningBalances',
        balances: message.balances,
        tranDate: message.tranDate,
        subsidiaryId: message.subsidiaryId,
      };
      return callRestlet(credentials, 'POST', credentials.restletUrl, balancesPayload);
    }

    case 'ANALYZE_TAX_RULES': {
      const { rules, determinations, config } = message;
      if (!rules || !determinations) {
        throw new Error('ANALYZE_TAX_RULES requer rules e determinations');
      }

      // Camada 3: Stats
      const stats = buildStats(rules, determinations);

      // Camada 4: Pre-validador
      const preResult = preValidate(rules, determinations, config || {});

      // Camada 4b: Priorizar/truncar para IA
      const prioritized = prioritizeForAI(
        preResult.rules, preResult.determinations,
        preResult.constraintErrors
      );

      // Camada 5: AI Reviewer
      const apiKey = message._credentials?.claudeApiKey || null;
      const result = await analyzeTaxRules({
        rules: prioritized.rules,
        determinations: prioritized.determinations,
        stats,
        autoApplies: preResult.autoApplies,
        constraintErrors: preResult.constraintErrors,
        config: { ...config, totalItems: stats.totalRules },
        apiKey,
      });

      // Retornar regras originais (nao truncadas) + resultados da analise
      return {
        rules: preResult.rules,
        determinations: preResult.determinations,
        autoApplies: result.autoApplies,
        constraintErrors: result.constraintErrors,
        aiIssues: result.aiIssues,
        aiPatches: result.aiPatches,
        auditSummary: result.auditSummary,
        stats,
        contextHash: result.contextHash,
        skippedAI: result.skippedAI || null,
        fromCache: result.fromCache || false,
      };
    }

    case 'RESOLVE_TAX_CONFLICT': {
      // Placeholder para resolucao de conflitos sob demanda
      // IA recebe conflito + clusterAnalysis + schema
      throw new Error('RESOLVE_TAX_CONFLICT: nao implementado ainda');
    }

    default:
      throw new Error(`Tipo de mensagem desconhecido: ${message.type}`);
  }
}

// --- Rota principal ---

router.post('/message', async (req, res) => {
  try {
    const result = await handleMessage(req.body);
    res.json(result);
  } catch (error) {
    // Status semantico baseado na falha
    let status = error.status || 500;
    if (error.upstreamStatus === 429) status = 429;
    else if (error.upstreamStatus >= 500) status = 502;
    else if (error.message?.includes('upstream')) status = 502;

    console.error(`[/api/message] ${error.message}`);
    res.status(status).json({ error: error.message });
  }
});

// --- Rota de auditoria ---

router.get('/tax-audit/:contextHash', (req, res) => {
  const log = getAuditLog(req.params.contextHash);
  if (!log) {
    return res.status(404).json({ error: 'Log de auditoria nao encontrado' });
  }
  res.json(log);
});

// ── SPED EFD — Job-based async processing ─────────────────────────────────

const spedJobs = new Map();

// Limpar jobs antigos a cada 5 minutos
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of spedJobs) {
    if (now - job.createdAt > 10 * 60 * 1000) {
      spedJobs.delete(id);
    }
  }
}, 5 * 60 * 1000);

const spedUpload = multer({
  dest: resolve(__dirname, '..', 'data', 'tmp'),
  limits: { files: 10, fileSize: 500 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (file.originalname.toLowerCase().endsWith('.txt')) {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos .txt sao aceitos'));
    }
  },
});

function generateJobId() {
  return randomBytes(12).toString('hex');
}

/**
 * Processa job SPED em background.
 */
async function processSpedJob(jobId, files, options) {
  const job = spedJobs.get(jobId);
  if (!job) return;

  try {
    job.progress = { phase: 'validating', percent: 0, detail: 'Validando arquivos...' };

    // Validar CNPJ igual entre arquivos
    let mainCnpj = null;
    let mainCompanyInfo = null;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      job.progress = {
        phase: 'validating',
        percent: Math.round((i / files.length) * 10),
        detail: `Validando arquivo ${i + 1}/${files.length}...`,
      };

      // Ler apenas o 0000 para validar CNPJ
      let companyInfo = null;
      await parseSpedStream(file.path, options, {
        onCompanyInfo(info) { companyInfo = info; },
      });

      if (!companyInfo || !companyInfo.cnpj) {
        throw new Error(`Arquivo ${file.originalname}: nao contem registro 0000 ou CNPJ vazio`);
      }

      const fileCnpj = normalizeCnpj(companyInfo.cnpj);

      if (mainCnpj === null) {
        mainCnpj = fileCnpj;
        mainCompanyInfo = companyInfo;
      } else if (fileCnpj !== mainCnpj) {
        throw new Error(
          `CNPJ divergente entre arquivos: ${mainCnpj} vs ${fileCnpj} (${file.originalname}). ` +
          'Todos os arquivos devem ser da mesma empresa.'
        );
      }
    }

    // NCM NetSuite lookup (opcional — enriquece NCM do SPED com cadastro NS)
    let nsNcmMap = null;
    if (options.useNcmNetSuite && options._credentials?.netsuiteAccountId) {
      try {
        job.progress = { phase: 'ncm_lookup', percent: 8, detail: 'Buscando NCMs no NetSuite...' };
        const credentials = options._credentials;
        nsNcmMap = new Map();
        let offset = 0;
        const pageSize = 1000;
        let hasMore = true;
        while (hasMore) {
          const sql = `SELECT itemid, custitem_ncm_code FROM item WHERE custitem_ncm_code IS NOT NULL FETCH FIRST ${pageSize} ROWS ONLY`;
          const result = await callSuiteQL(credentials, sql, pageSize, offset);
          const items = result?.items || [];
          for (const row of items) {
            if (row.itemid && row.custitem_ncm_code) {
              nsNcmMap.set(String(row.itemid).trim(), String(row.custitem_ncm_code).replace(/\./g, '').trim());
            }
          }
          hasMore = items.length === pageSize;
          offset += pageSize;
          if (offset > 50000) break; // safety cap
        }
      } catch (err) {
        // Graceful: se falhar, segue sem NCM do NetSuite
        nsNcmMap = null;
        if (!job.result) {
          job.progress = { phase: 'ncm_lookup', percent: 9, detail: `NCM lookup falhou: ${err.message}. Seguindo com SPED...` };
        }
      }
    }

    // Criar accumulator
    const accumulator = new RuleAccumulator({
      subsidiaryName: options.subsidiaryName || '',
      regimeDestinatario: options.regimeDestinatario || 'Lucro Real',
      lobDestinatario: options.lobDestinatario || 'Venda de Mercadorias',
      validoAPartirDe: options.validoAPartirDe || '',
      subsidiaryCnpj: mainCnpj,
      nsParamTypes: options.nsParamTypes || null,
    });

    // Processar cada arquivo
    const allRawStats = [];
    let totalFilesProcessed = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileProgress = (phase, percent, detail) => {
        const overallPercent = 10 + Math.round(((i + percent / 100) / files.length) * 85);
        job.progress = { phase, percent: overallPercent, detail };
      };

      fileProgress('parsing', 0, `Processando ${file.originalname}...`);

      const { rawStats } = await parseSpedStream(file.path, options, {
        onItem(rawItem, docCtx, lookups) {
          const result = normalizeItem(rawItem, docCtx, lookups, {
            requireNcm: options.requireNcm || false,
            nsNcmMap: nsNcmMap || null,
          });

          if (result.status === 'rejected') {
            accumulator.trackRejection(result.reason);
          } else if (result.status === 'warning') {
            accumulator.addWarningItem(result.item, result.warnings);
          } else {
            accumulator.addItem(result.item);
          }
        },
        onProgress(lineCount, bytesRead, totalBytes) {
          const pct = totalBytes > 0 ? Math.round((bytesRead / totalBytes) * 100) : 0;
          fileProgress('parsing', pct, `${file.originalname}: ${lineCount.toLocaleString()} linhas...`);
        },
      });

      allRawStats.push({ file: file.originalname, ...rawStats });
      totalFilesProcessed++;
    }

    // Finalizar
    job.progress = { phase: 'finalizing', percent: 95, detail: 'Finalizando items...' };

    const result = accumulator.finalize();

    job.result = {
      items: result.items || [],
      needsReview: result.needsReview || [],
      stats: {
        ...result.stats,
        needsReviewCount: result.needsReview?.length || 0,
        needsReviewByReason: result.needsReviewByReason || {},
      },
      qualityStats: result.qualityStats,
      rawStats: allRawStats,
      companyInfo: mainCompanyInfo,
      warnings: result.warnings || [],
    };

    job.status = 'done';
    job.progress = { phase: 'done', percent: 100, detail: 'Concluido' };
  } catch (err) {
    job.status = 'error';
    job.error = err.message;
    job.progress = { phase: 'error', percent: 0, detail: err.message };
  } finally {
    // Limpar arquivos temporarios
    for (const file of files) {
      try { unlinkSync(file.path); } catch { /* ignore */ }
    }
  }
}

// 1. Upload e start
router.post('/parse-sped/start', spedUpload.array('files'), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const jobId = generateJobId();
    const options = JSON.parse(req.body.options || '{}');

    spedJobs.set(jobId, {
      status: 'processing',
      createdAt: Date.now(),
      progress: { phase: 'starting', percent: 0, detail: 'Iniciando...' },
      result: null,
      error: null,
    });

    // Processar em background (nao bloqueia resposta)
    processSpedJob(jobId, req.files, options).catch(err => {
      const job = spedJobs.get(jobId);
      if (job) {
        job.status = 'error';
        job.error = err.message;
      }
    });

    res.json({ jobId });
  } catch (error) {
    // Limpar arquivos em caso de erro
    if (req.files) {
      for (const file of req.files) {
        try { unlinkSync(file.path); } catch { /* ignore */ }
      }
    }
    res.status(500).json({ error: error.message });
  }
});

// 2. Progresso via SSE (EventSource)
router.get('/parse-sped/events/:jobId', (req, res) => {
  const job = spedJobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job nao encontrado' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let lastProgressJson = '';

  const interval = setInterval(() => {
    const j = spedJobs.get(req.params.jobId);
    if (!j) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: 'Job expirou' })}\n\n`);
      clearInterval(interval);
      res.end();
      return;
    }

    // Enviar progresso se mudou
    const progressJson = JSON.stringify(j.progress);
    if (progressJson !== lastProgressJson) {
      res.write(`event: progress\ndata: ${progressJson}\n\n`);
      lastProgressJson = progressJson;
    }

    if (j.status === 'done') {
      res.write(`event: done\ndata: ${JSON.stringify({ summary: j.result.stats })}\n\n`);
      clearInterval(interval);
      res.end();
    } else if (j.status === 'error') {
      res.write(`event: error\ndata: ${JSON.stringify({ message: j.error })}\n\n`);
      clearInterval(interval);
      res.end();
    }
  }, 300);

  req.on('close', () => clearInterval(interval));
});

// 3. Resultado completo
router.get('/parse-sped/result/:jobId', (req, res) => {
  const job = spedJobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job nao encontrado' });
  }
  if (job.status === 'error') {
    return res.status(500).json({ error: job.error });
  }
  if (job.status !== 'done') {
    return res.status(202).json({ status: 'processing', progress: job.progress });
  }

  res.json(job.result);
  spedJobs.delete(req.params.jobId); // limpar apos entrega
});

// ── SPED Contribuicoes — standalone + merged ────────────────────────────

/**
 * Processa SPED Contribuicoes standalone.
 */
async function processSpedContribJob(jobId, files, options) {
  const job = spedJobs.get(jobId);
  if (!job) return;

  try {
    job.progress = { phase: 'validating', percent: 0, detail: 'Validando arquivos Contribuicoes...' };

    let mainCnpj = null;
    let mainCompanyInfo = null;
    let allBlockM = { m100: [], m105: [], m500: [], m505: [] };

    // Validar CNPJ
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      let companyInfo = null;
      await parseSpedContribStream(file.path, options, {
        onCompanyInfo(info) { companyInfo = info; },
      });

      if (!companyInfo || !companyInfo.cnpj) {
        throw new Error(`Arquivo ${file.originalname}: nao contem registro 0000 ou CNPJ vazio`);
      }

      const fileCnpj = normalizeCnpj(companyInfo.cnpj);
      if (mainCnpj === null) {
        mainCnpj = fileCnpj;
        mainCompanyInfo = companyInfo;
      } else if (fileCnpj !== mainCnpj) {
        throw new Error(`CNPJ divergente: ${mainCnpj} vs ${fileCnpj} (${file.originalname}).`);
      }
    }

    const accumulator = new RuleAccumulator({
      subsidiaryName: options.subsidiaryName || '',
      regimeDestinatario: options.regimeDestinatario || 'Lucro Real',
      lobDestinatario: options.lobDestinatario || 'Venda de Mercadorias',
      validoAPartirDe: options.validoAPartirDe || '',
      subsidiaryCnpj: mainCnpj,
      nsParamTypes: options.nsParamTypes || null,
      contribMode: true,
    });

    const allRawStats = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileProgress = (phase, percent, detail) => {
        const overallPercent = 10 + Math.round(((i + percent / 100) / files.length) * 85);
        job.progress = { phase, percent: overallPercent, detail };
      };

      fileProgress('parsing', 0, `Processando ${file.originalname}...`);

      const { rawStats, blockM } = await parseSpedContribStream(file.path, options, {
        onItem(rawItem, docCtx, lookups, meta) {
          const result = normalizeContribItem(rawItem, docCtx, lookups, meta, {
            categoryToNat: options.categoryToNat || null,
            creditCstList: options.creditCstList || null,
            itemCategories: options.itemCategories ? new Map(Object.entries(options.itemCategories)) : null,
          });

          if (result.status === 'rejected') {
            accumulator.trackRejection(result.reason);
          } else if (result.status === 'warning') {
            accumulator.addWarningItem(result.item, result.warnings);
          } else {
            accumulator.addItem(result.item);
          }
        },
        onProgress(lineCount, bytesRead, totalBytes) {
          const pct = totalBytes > 0 ? Math.round((bytesRead / totalBytes) * 100) : 0;
          fileProgress('parsing', pct, `${file.originalname}: ${lineCount.toLocaleString()} linhas...`);
        },
      });

      allRawStats.push({ file: file.originalname, ...rawStats });

      // Acumular Block M de todos os arquivos
      if (blockM) {
        allBlockM.m100.push(...(blockM.m100 || []));
        allBlockM.m105.push(...(blockM.m105 || []));
        allBlockM.m500.push(...(blockM.m500 || []));
        allBlockM.m505.push(...(blockM.m505 || []));
      }
    }

    job.progress = { phase: 'finalizing', percent: 95, detail: 'Finalizando items PIS/COFINS...' };

    const result = accumulator.finalize();

    // Validacao Bloco M (determinations vazias por ora — contrib mode futuro)
    const blockMValidation = validateBlockM([], allBlockM);

    job.result = {
      items: result.items || [],
      needsReview: result.needsReview || [],
      stats: {
        ...result.stats,
        needsReviewCount: result.needsReview?.length || 0,
        needsReviewByReason: result.needsReviewByReason || {},
      },
      qualityStats: result.qualityStats,
      rawStats: allRawStats,
      companyInfo: mainCompanyInfo,
      blockMValidation,
      warnings: result.warnings || [],
      source: 'contrib',
    };

    job.status = 'done';
    job.progress = { phase: 'done', percent: 100, detail: 'Concluido' };
  } catch (err) {
    job.status = 'error';
    job.error = err.message;
    job.progress = { phase: 'error', percent: 0, detail: err.message };
  } finally {
    for (const file of files) {
      try { unlinkSync(file.path); } catch { /* ignore */ }
    }
  }
}

/**
 * Processa SPED Fiscal + Contribuicoes merged.
 */
async function processSpedMergedJob(jobId, fiscalFiles, contribFiles, options) {
  const job = spedJobs.get(jobId);
  if (!job) return;

  try {
    // NCM NetSuite lookup (opcional)
    let nsNcmMap = null;
    if (options.useNcmNetSuite && options._credentials?.netsuiteAccountId) {
      try {
        job.progress = { phase: 'ncm_lookup', percent: 0, detail: 'Buscando NCMs no NetSuite...' };
        const credentials = options._credentials;
        nsNcmMap = new Map();
        let offset = 0;
        const pageSize = 1000;
        let hasMore = true;
        while (hasMore) {
          const sql = `SELECT itemid, custitem_ncm_code FROM item WHERE custitem_ncm_code IS NOT NULL FETCH FIRST ${pageSize} ROWS ONLY`;
          const result = await callSuiteQL(credentials, sql, pageSize, offset);
          const items = result?.items || [];
          for (const row of items) {
            if (row.itemid && row.custitem_ncm_code) {
              nsNcmMap.set(String(row.itemid).trim(), String(row.custitem_ncm_code).replace(/\./g, '').trim());
            }
          }
          hasMore = items.length === pageSize;
          offset += pageSize;
          if (offset > 50000) break;
        }
      } catch {
        nsNcmMap = null;
      }
    }

    // Fase 1: Fiscal
    job.progress = { phase: 'fiscal', percent: 0, detail: 'Processando SPED Fiscal...' };

    const fiscalAccum = new RuleAccumulator({
      subsidiaryName: options.subsidiaryName || '',
      regimeDestinatario: options.regimeDestinatario || 'Lucro Real',
      lobDestinatario: options.lobDestinatario || 'Venda de Mercadorias',
      validoAPartirDe: options.validoAPartirDe || '',
      subsidiaryCnpj: options.subsidiaryCnpj || '',
      nsParamTypes: options.nsParamTypes || null,
    });

    let fiscalCompanyInfo = null;
    const fiscalRawStats = [];

    for (let i = 0; i < fiscalFiles.length; i++) {
      const file = fiscalFiles[i];
      const pct = Math.round((i / fiscalFiles.length) * 30);
      job.progress = { phase: 'fiscal', percent: pct, detail: `Fiscal: ${file.originalname}...` };

      const { rawStats, companyInfo } = await parseSpedStream(file.path, options, {
        onItem(rawItem, docCtx, lookups) {
          const result = normalizeItem(rawItem, docCtx, lookups, { requireNcm: options.requireNcm || false, nsNcmMap: nsNcmMap || null });
          if (result.status === 'rejected') fiscalAccum.trackRejection(result.reason);
          else if (result.status === 'warning') fiscalAccum.addWarningItem(result.item, result.warnings);
          else fiscalAccum.addItem(result.item);
        },
      });

      fiscalRawStats.push({ file: file.originalname, ...rawStats });
      if (companyInfo && !fiscalCompanyInfo) fiscalCompanyInfo = companyInfo;
    }

    const fiscalResult = fiscalAccum.finalize();
    fiscalResult.companyInfo = fiscalCompanyInfo;

    // Fase 2: Contribuicoes
    job.progress = { phase: 'contrib', percent: 35, detail: 'Processando SPED Contribuicoes...' };

    const contribAccum = new RuleAccumulator({
      subsidiaryName: options.subsidiaryName || '',
      regimeDestinatario: options.regimeDestinatario || 'Lucro Real',
      lobDestinatario: options.lobDestinatario || 'Venda de Mercadorias',
      validoAPartirDe: options.validoAPartirDe || '',
      subsidiaryCnpj: options.subsidiaryCnpj || '',
      nsParamTypes: options.nsParamTypes || null,
      contribMode: true,
    });

    let contribCompanyInfo = null;
    let allBlockM = { m100: [], m105: [], m500: [], m505: [] };
    const contribRawStats = [];

    for (let i = 0; i < contribFiles.length; i++) {
      const file = contribFiles[i];
      const pct = 35 + Math.round((i / contribFiles.length) * 30);
      job.progress = { phase: 'contrib', percent: pct, detail: `Contrib: ${file.originalname}...` };

      const { rawStats, companyInfo, blockM } = await parseSpedContribStream(file.path, options, {
        onItem(rawItem, docCtx, lookups, meta) {
          const result = normalizeContribItem(rawItem, docCtx, lookups, meta, {
            categoryToNat: options.categoryToNat || null,
            creditCstList: options.creditCstList || null,
            itemCategories: options.itemCategories ? new Map(Object.entries(options.itemCategories)) : null,
          });
          if (result.status === 'rejected') contribAccum.trackRejection(result.reason);
          else if (result.status === 'warning') contribAccum.addWarningItem(result.item, result.warnings);
          else contribAccum.addItem(result.item);
        },
      });

      contribRawStats.push({ file: file.originalname, ...rawStats });
      if (companyInfo && !contribCompanyInfo) contribCompanyInfo = companyInfo;
      if (blockM) {
        allBlockM.m100.push(...(blockM.m100 || []));
        allBlockM.m105.push(...(blockM.m105 || []));
        allBlockM.m500.push(...(blockM.m500 || []));
        allBlockM.m505.push(...(blockM.m505 || []));
      }
    }

    const contribResult = contribAccum.finalize();
    contribResult.companyInfo = contribCompanyInfo;

    // Fase 3: Merge
    job.progress = { phase: 'merge', percent: 70, detail: 'Mesclando Fiscal + Contribuicoes...' };

    const merged = mergeResults(fiscalResult, contribResult, options);

    // Fase 4: Block M validation (determinations vazias — contrib mode futuro)
    job.progress = { phase: 'blockM', percent: 85, detail: 'Validando contra Bloco M...' };

    const blockMValidation = validateBlockM([], allBlockM);

    job.progress = { phase: 'finalizing', percent: 95, detail: 'Gerando resultado final...' };

    job.result = {
      items: [...(fiscalResult.items || []), ...(contribResult.items || [])],
      stats: merged.stats,
      mergeStats: merged.mergeStats,
      qualityStats: {
        fiscal: fiscalResult.qualityStats,
        contrib: contribResult.qualityStats,
      },
      rawStats: { fiscal: fiscalRawStats, contrib: contribRawStats },
      companyInfo: merged.companyInfo,
      blockMValidation,
      warnings: [...(fiscalResult.warnings || []), ...(contribResult.warnings || []), ...(merged.warnings || [])],
      source: 'merged',
    };

    job.status = 'done';
    job.progress = { phase: 'done', percent: 100, detail: 'Concluido' };
  } catch (err) {
    job.status = 'error';
    job.error = err.message;
    job.progress = { phase: 'error', percent: 0, detail: err.message };
  } finally {
    for (const file of [...fiscalFiles, ...contribFiles]) {
      try { unlinkSync(file.path); } catch { /* ignore */ }
    }
  }
}

// Contrib standalone endpoints
router.post('/parse-sped-contrib/start', spedUpload.array('files'), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const jobId = generateJobId();
    const options = JSON.parse(req.body.options || '{}');

    spedJobs.set(jobId, {
      status: 'processing',
      createdAt: Date.now(),
      progress: { phase: 'starting', percent: 0, detail: 'Iniciando...' },
      result: null,
      error: null,
    });

    processSpedContribJob(jobId, req.files, options).catch(err => {
      const job = spedJobs.get(jobId);
      if (job) { job.status = 'error'; job.error = err.message; }
    });

    res.json({ jobId });
  } catch (error) {
    if (req.files) {
      for (const file of req.files) { try { unlinkSync(file.path); } catch { /* ignore */ } }
    }
    res.status(500).json({ error: error.message });
  }
});

router.get('/parse-sped-contrib/events/:jobId', (req, res) => {
  const job = spedJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job nao encontrado' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let lastProgressJson = '';
  const interval = setInterval(() => {
    const j = spedJobs.get(req.params.jobId);
    if (!j) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: 'Job expirou' })}\n\n`);
      clearInterval(interval); res.end(); return;
    }
    const progressJson = JSON.stringify(j.progress);
    if (progressJson !== lastProgressJson) {
      res.write(`event: progress\ndata: ${progressJson}\n\n`);
      lastProgressJson = progressJson;
    }
    if (j.status === 'done') {
      res.write(`event: done\ndata: ${JSON.stringify({ summary: j.result.stats })}\n\n`);
      clearInterval(interval); res.end();
    } else if (j.status === 'error') {
      res.write(`event: error\ndata: ${JSON.stringify({ message: j.error })}\n\n`);
      clearInterval(interval); res.end();
    }
  }, 300);
  req.on('close', () => clearInterval(interval));
});

router.get('/parse-sped-contrib/result/:jobId', (req, res) => {
  const job = spedJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job nao encontrado' });
  if (job.status === 'error') return res.status(500).json({ error: job.error });
  if (job.status !== 'done') return res.status(202).json({ status: 'processing', progress: job.progress });
  res.json(job.result);
  spedJobs.delete(req.params.jobId);
});

// Merged endpoints
router.post('/parse-sped-merged/start', spedUpload.fields([
  { name: 'fiscalFiles', maxCount: 10 },
  { name: 'contribFiles', maxCount: 10 },
]), async (req, res) => {
  try {
    const fiscalFiles = req.files?.fiscalFiles || [];
    const contribFiles = req.files?.contribFiles || [];

    if (fiscalFiles.length === 0 && contribFiles.length === 0) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const jobId = generateJobId();
    const options = JSON.parse(req.body.options || '{}');

    spedJobs.set(jobId, {
      status: 'processing',
      createdAt: Date.now(),
      progress: { phase: 'starting', percent: 0, detail: 'Iniciando merge...' },
      result: null,
      error: null,
    });

    processSpedMergedJob(jobId, fiscalFiles, contribFiles, options).catch(err => {
      const job = spedJobs.get(jobId);
      if (job) { job.status = 'error'; job.error = err.message; }
    });

    res.json({ jobId });
  } catch (error) {
    const allFiles = [...(req.files?.fiscalFiles || []), ...(req.files?.contribFiles || [])];
    for (const file of allFiles) { try { unlinkSync(file.path); } catch { /* ignore */ } }
    res.status(500).json({ error: error.message });
  }
});

router.get('/parse-sped-merged/events/:jobId', (req, res) => {
  const job = spedJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job nao encontrado' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let lastProgressJson = '';
  const interval = setInterval(() => {
    const j = spedJobs.get(req.params.jobId);
    if (!j) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: 'Job expirou' })}\n\n`);
      clearInterval(interval); res.end(); return;
    }
    const progressJson = JSON.stringify(j.progress);
    if (progressJson !== lastProgressJson) {
      res.write(`event: progress\ndata: ${progressJson}\n\n`);
      lastProgressJson = progressJson;
    }
    if (j.status === 'done') {
      res.write(`event: done\ndata: ${JSON.stringify({ summary: j.result.stats })}\n\n`);
      clearInterval(interval); res.end();
    } else if (j.status === 'error') {
      res.write(`event: error\ndata: ${JSON.stringify({ message: j.error })}\n\n`);
      clearInterval(interval); res.end();
    }
  }, 300);
  req.on('close', () => clearInterval(interval));
});

router.get('/parse-sped-merged/result/:jobId', (req, res) => {
  const job = spedJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job nao encontrado' });
  if (job.status === 'error') return res.status(500).json({ error: job.error });
  if (job.status !== 'done') return res.status(202).json({ status: 'processing', progress: job.progress });
  res.json(job.result);
  spedJobs.delete(req.params.jobId);
});
