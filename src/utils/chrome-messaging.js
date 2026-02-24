/**
 * Envia mensagem para o service worker (background) e retorna a resposta
 * @param {Object} message - Mensagem com type e payload
 * @returns {Promise<any>}
 */
export function sendToBackground(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response && response.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response);
    });
  });
}
