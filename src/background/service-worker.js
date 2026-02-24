import { generateAuthHeader } from '../utils/netsuite-auth.js';

const CREDENTIALS_KEY = 'appCredentials';
const KEEP_ALIVE_ALARM = 'keepAlive';

// --- Helpers ---

/**
 * Carrega credenciais do chrome.storage.local
 * @returns {Promise<Object|null>}
 */
async function getCredentials() {
  return new Promise((resolve) => {
    chrome.storage.local.get(CREDENTIALS_KEY, (result) => {
      resolve(result[CREDENTIALS_KEY] || null);
    });
  });
}

/**
 * Salva credenciais no chrome.storage.local
 * @param {Object} credentials
 * @returns {Promise<void>}
 */
async function saveCredentials(credentials) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [CREDENTIALS_KEY]: credentials }, resolve);
  });
}

/**
 * Chama Claude API com os dados financeiros
 * @param {string} apiKey
 * @param {string} prompt
 * @param {Object} financialData
 * @returns {Promise<Object>}
 */
async function callClaudeAPI(apiKey, prompt, financialData) {
  // Enviar dados de forma compacta para nao estourar o contexto
  const userMessage = `${prompt}\n\nDados do arquivo financeiro:\n${JSON.stringify(financialData.rows)}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
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

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error ${response.status}: ${errorText}`);
  }

  const result = await response.json();

  // Verificar se a resposta foi cortada
  if (result.stop_reason === 'max_tokens') {
    throw new Error('Resposta da Claude foi cortada — arquivo muito grande. Tente com menos contas.');
  }

  const text = result.content[0].text;

  // Extrair JSON da resposta (pode vir envolto em markdown ```json ... ```)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Claude API nao retornou JSON valido');
  }

  // Tentar parse, e se falhar, tentar reparar JSON truncado
  try {
    return JSON.parse(jsonMatch[0]);
  } catch (parseError) {
    // Tentar reparar: fechar arrays e objetos abertos
    let fixed = jsonMatch[0];
    // Remover ultima entrada incompleta (ate a ultima virgula)
    const lastComma = fixed.lastIndexOf(',');
    if (lastComma > -1) {
      fixed = fixed.substring(0, lastComma);
    }
    // Fechar brackets abertos
    const openBrackets = (fixed.match(/\[/g) || []).length - (fixed.match(/\]/g) || []).length;
    const openBraces = (fixed.match(/\{/g) || []).length - (fixed.match(/\}/g) || []).length;
    for (let i = 0; i < openBrackets; i++) fixed += ']';
    for (let i = 0; i < openBraces; i++) fixed += '}';

    try {
      return JSON.parse(fixed);
    } catch {
      throw new Error(`JSON invalido da Claude: ${parseError.message}`);
    }
  }
}

/**
 * Executa request na NetSuite API
 * @param {Object} credentials
 * @param {string} method
 * @param {string} endpoint
 * @param {Object|null} body
 * @returns {Promise<Object>}
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
      Accept: 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`NetSuite API error ${response.status}: ${errorText}`);
  }

  // Extrair Location header (NetSuite retorna internalId na URL)
  const location = response.headers.get('Location');
  let internalId = null;
  if (location) {
    const idMatch = location.match(/\/(\d+)$/);
    internalId = idMatch ? idMatch[1] : null;
  }

  // Respostas sem body (204, ou body vazio)
  const text = await response.text();
  if (!text || text.trim() === '') {
    return { success: true, internalId, location };
  }

  // Tentar parsear como JSON
  try {
    const data = JSON.parse(text);
    return { ...data, internalId: internalId || data.id || data.internalId };
  } catch {
    return { success: true, internalId, location, rawResponse: text };
  }
}

/**
 * Executa request em um RESTlet do NetSuite
 * @param {Object} credentials
 * @param {string} method
 * @param {string} restletUrl - URL completa do RESTlet deployment
 * @param {Object|null} body
 * @returns {Promise<Object>}
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
    return { success: true };
  }

  const data = JSON.parse(text);

  if (!response.ok) {
    throw new Error(`RESTlet error ${response.status}: ${data.error || data.message || text}`);
  }

  return data;
}

// --- Keep-alive ---

function startKeepAlive() {
  chrome.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 0.4 });
}

function stopKeepAlive() {
  chrome.alarms.clear(KEEP_ALIVE_ALARM);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEP_ALIVE_ALARM) {
    // Manter service worker vivo
  }
});

// --- Abre side panel ao clicar no icone ---

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// --- Message Router ---

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ error: error.message }));

  // Retornar true para manter sendResponse ativo (async)
  return true;
});

/**
 * Roteia mensagens por tipo
 * @param {Object} message
 * @returns {Promise<Object>}
 */
async function handleMessage(message) {
  const credentials = await getCredentials();

  switch (message.type) {
    case 'SAVE_CREDENTIALS': {
      await saveCredentials(message.data);
      return { success: true };
    }

    case 'GET_CREDENTIALS': {
      return credentials || {};
    }

    case 'STRUCTURE_DATA': {
      if (!credentials || !credentials.claudeApiKey) {
        throw new Error('API key da Claude nao configurada');
      }
      startKeepAlive();
      try {
        const result = await callClaudeAPI(
          credentials.claudeApiKey,
          message.data.prompt,
          message.data.financialData
        );
        return result;
      } finally {
        stopKeepAlive();
      }
    }

    case 'NETSUITE_API_REQUEST': {
      if (!credentials || !credentials.netsuiteAccountId) {
        throw new Error('Credenciais NetSuite nao configuradas');
      }
      return callNetSuiteAPI(credentials, message.method, message.endpoint, message.body);
    }

    case 'FETCH_LOOKUP_DATA': {
      if (!credentials || !credentials.restletUrl) {
        throw new Error('URL do RESTlet nao configurada');
      }
      return callRestlet(credentials, 'GET', credentials.restletUrl);
    }

    case 'CREATE_SUBSIDIARY': {
      // Subsidiary nao pode ser criada via REST API — usar RESTlet
      if (!credentials || !credentials.netsuiteAccountId) {
        throw new Error('Credenciais NetSuite nao configuradas');
      }
      if (!credentials.restletUrl) {
        throw new Error('URL do RESTlet nao configurada. Va em Configuracoes e preencha a URL do RESTlet.');
      }
      startKeepAlive();
      try {
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
      } finally {
        stopKeepAlive();
      }
    }

    case 'CREATE_ACCOUNTS': {
      // A criacao sequencial de contas e gerenciada pelo side panel
      // via multiplas chamadas NETSUITE_API_REQUEST
      // Este handler e para criacao individual se necessario
      if (!credentials || !credentials.netsuiteAccountId) {
        throw new Error('Credenciais NetSuite nao configuradas');
      }
      return callNetSuiteAPI(credentials, 'POST', '/account', message.body);
    }

    default:
      throw new Error(`Tipo de mensagem desconhecido: ${message.type}`);
  }
}
