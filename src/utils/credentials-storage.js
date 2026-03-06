const STORAGE_KEY = 'ns_credentials_v1';

export function loadCredentials() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveCredentials(credentials) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials));
}

export function clearCredentials() {
  localStorage.removeItem(STORAGE_KEY);
}
