import { sendToBackground } from '../utils/chrome-messaging.js';
import { MessageType } from '../types/messages.js';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/**
 * Aguarda com backoff exponencial
 * @param {number} attempt
 * @returns {Promise<void>}
 */
function wait(attempt) {
  const delay = BASE_DELAY_MS * Math.pow(2, attempt);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Cria subsidiary no NetSuite via service worker
 * Inclui retry com backoff exponencial para erros 429/500
 *
 * IMPORTANTE: Antes de usar em producao, validar nomes de campos
 * contra metadata-catalog:
 *   GET /services/rest/record/v1/metadata-catalog/subsidiary
 *
 * @param {import('../types/subsidiary.js').Subsidiary} data
 * @returns {Promise<{internalId: string}>}
 */
export async function createSubsidiary(data) {
  const payload = {
    name: data.name,
    // Campos a confirmar via metadata-catalog:
    federalIdNumber: data.cnpj,
    state1TaxNumber: data.ie,
    mainAddress: {
      addr1: data.address,
      city: data.city,
      state: data.state,
      zip: data.zipCode,
      country: { id: 'BR' },
    },
    currency: { id: 'BRL' },
  };

  // Remover campos null/undefined do payload
  const cleanPayload = JSON.parse(JSON.stringify(payload));

  let lastError = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await sendToBackground({
        type: MessageType.NETSUITE_API_REQUEST,
        method: 'POST',
        endpoint: '/subsidiary',
        body: cleanPayload,
      });

      if (!result || !result.internalId) {
        throw new Error('Resposta sem internalId');
      }

      return { internalId: result.internalId };
    } catch (error) {
      lastError = error;

      // Retry apenas em erros de rate limit ou servidor
      const isRetryable =
        error.message.includes('429') ||
        error.message.includes('500') ||
        error.message.includes('503');

      if (isRetryable && attempt < MAX_RETRIES - 1) {
        await wait(attempt);
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}
