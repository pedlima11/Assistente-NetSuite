/**
 * Substitui chrome-messaging.js — mesma interface, transporte via fetch.
 * Todos os callers continuam usando sendToBackground(message) sem mudança.
 *
 * @param {Object} message - Mensagem com type e payload (mesmo formato do service worker)
 * @returns {Promise<any>}
 */
export function sendToBackground(message) {
  return fetch('/api/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  })
    .then(async (res) => {
      if (!res.ok) {
        const ct = res.headers.get('content-type') || '';
        let msg = `HTTP ${res.status}`;

        if (ct.includes('application/json')) {
          const parsed = await res.json().catch(() => null);
          msg = parsed?.error || parsed?.message || msg;
        } else {
          const text = await res.text();
          msg = text || msg;
        }
        throw new Error(msg);
      }
      return res.json();
    })
    .then((data) => {
      if (data && data.error && data.success === false) {
        throw new Error(data.error);
      }
      return data;
    });
}
