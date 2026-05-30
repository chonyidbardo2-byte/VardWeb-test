/*
 * _crypto.js — AES-256-GCM client-side encryption
 *
 * All password fields are encrypted here before being sent to Supabase.
 * Supabase never sees plaintext. The master key lives only in .env,
 * injected at runtime by serve.mjs as window.ENCRYPTION_CONFIG.key.
 *
 * Storage format: base64(IV) + ":" + base64(ciphertext)
 * IV is a fresh random 96-bit nonce per encryption (NIST recommended for GCM).
 */

async function getKey() {
  const b64 = window.ENCRYPTION_CONFIG?.key || '';
  if (!b64) throw new Error('ENCRYPTION_KEY not configured in .env');
  const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/* Encrypt plaintext → "base64(IV):base64(ciphertext)" */
export async function encrypt(plaintext) {
  if (!plaintext) return '';
  const key = await getKey();
  const iv  = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV
  const enc = new TextEncoder();
  const ct  = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  const b64iv = btoa(String.fromCharCode(...iv));
  const b64ct = btoa(String.fromCharCode(...new Uint8Array(ct)));
  return `${b64iv}:${b64ct}`;
}

/* Decrypt "base64(IV):base64(ciphertext)" → plaintext */
export async function decrypt(encryptedString) {
  if (!encryptedString || !encryptedString.includes(':')) return encryptedString || '';
  const key = await getKey();
  const [b64iv, b64ct] = encryptedString.split(':');
  const iv = Uint8Array.from(atob(b64iv), c => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(b64ct), c => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

/*
 * Encrypted CSV export — uses a separate user-chosen passphrase,
 * derived to a key via PBKDF2. Downloaded as .enc file.
 */
async function deriveKey(passphrase, salt) {
  const enc  = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

/* Encrypts a CSV string with a passphrase → base64 blob (salt:iv:ct) */
export async function encryptExport(csvString, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await deriveKey(passphrase, salt);
  const ct   = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(csvString));
  const join = s => btoa(String.fromCharCode(...s));
  return `${join(salt)}:${join(iv)}:${join(new Uint8Array(ct))}`;
}

/* Decrypts a base64 blob (salt:iv:ct) with a passphrase → CSV string */
export async function decryptExport(encString, passphrase) {
  const parts = encString.split(':');
  if (parts.length !== 3) throw new Error('Invalid export format');
  const parse = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const [salt, iv, ct] = parts.map(parse);
  const key = await deriveKey(passphrase, salt);
  const pt  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

/* Helper: trigger browser download of a text blob */
export function downloadBlob(content, filename, mime = 'application/octet-stream') {
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([content], { type: mime })),
    download: filename,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}
