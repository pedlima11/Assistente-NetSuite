import OAuth from 'oauth-1.0a';
import CryptoJS from 'crypto-js';

/**
 * Gera header OAuth 1.0 para autenticacao no NetSuite
 * @param {string} method - GET, POST, DELETE
 * @param {string} url - URL completa da requisicao
 * @param {Object} credentials
 * @param {string} credentials.accountId
 * @param {string} credentials.consumerKey
 * @param {string} credentials.consumerSecret
 * @param {string} credentials.tokenId
 * @param {string} credentials.tokenSecret
 * @returns {string} Header Authorization
 */
export function generateAuthHeader(method, url, credentials) {
  const oauth = new OAuth({
    consumer: {
      key: credentials.consumerKey,
      secret: credentials.consumerSecret,
    },
    signature_method: 'HMAC-SHA256',
    hash_function(baseString, key) {
      return CryptoJS.HmacSHA256(baseString, key).toString(CryptoJS.enc.Base64);
    },
    realm: credentials.accountId.toUpperCase().replace(/-/g, '_'),
  });

  const token = {
    key: credentials.tokenId,
    secret: credentials.tokenSecret,
  };

  const requestData = {
    url,
    method: method.toUpperCase(),
  };

  const authHeader = oauth.toHeader(oauth.authorize(requestData, token));
  return authHeader.Authorization;
}
