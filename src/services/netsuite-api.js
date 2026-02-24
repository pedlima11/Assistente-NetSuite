import { generateAuthHeader } from '../utils/netsuite-auth.js';

/**
 * Client REST para NetSuite SuiteTalk API
 * Todas as chamadas passam pelo service worker (CORS)
 */
export class NetSuiteClient {
  /**
   * @param {Object} credentials
   * @param {string} credentials.accountId
   * @param {string} credentials.consumerKey
   * @param {string} credentials.consumerSecret
   * @param {string} credentials.tokenId
   * @param {string} credentials.tokenSecret
   */
  constructor(credentials) {
    this.credentials = credentials;
    // Formato: https://{accountId}.suitetalk.api.netsuite.com/services/rest/record/v1/
    const accountSlug = credentials.accountId.toLowerCase().replace(/_/g, '-');
    this.baseUrl = `https://${accountSlug}.suitetalk.api.netsuite.com/services/rest/record/v1`;
  }

  /**
   * Monta URL completa
   * @param {string} endpoint - ex: /subsidiary, /account
   * @returns {string}
   */
  _buildUrl(endpoint) {
    return `${this.baseUrl}${endpoint}`;
  }

  /**
   * Executa request com auth OAuth 1.0
   * @param {string} method
   * @param {string} endpoint
   * @param {Object|null} body
   * @returns {Promise<Object>}
   */
  async _request(method, endpoint, body = null) {
    const url = this._buildUrl(endpoint);
    const authHeader = generateAuthHeader(method, url, this.credentials);

    const options = {
      method,
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        Prefer: 'respond-async, transient',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { message: errorText };
      }
      throw new Error(
        `NetSuite API error ${response.status}: ${errorData.message || errorText}`
      );
    }

    // 204 No Content (ex: DELETE)
    if (response.status === 204) {
      return { success: true };
    }

    // Alguns POST retornam 204 com Location header
    const location = response.headers.get('Location');
    if (location) {
      const idMatch = location.match(/\/(\d+)$/);
      return {
        success: true,
        internalId: idMatch ? idMatch[1] : null,
        location,
      };
    }

    return response.json();
  }

  /**
   * GET request
   * @param {string} endpoint
   * @returns {Promise<Object>}
   */
  async get(endpoint) {
    return this._request('GET', endpoint);
  }

  /**
   * POST request
   * @param {string} endpoint
   * @param {Object} body
   * @returns {Promise<Object>}
   */
  async post(endpoint, body) {
    return this._request('POST', endpoint, body);
  }

  /**
   * DELETE request
   * @param {string} endpoint
   * @returns {Promise<Object>}
   */
  async delete(endpoint) {
    return this._request('DELETE', endpoint);
  }
}
