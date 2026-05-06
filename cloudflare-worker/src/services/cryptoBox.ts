/**
 * T11 — Symmetric encryption helper for at-rest values like wellbeing
 * pulse answers. Mirrors the *purpose* of the Python services/crypto_box.py
 * (PBKDF2 → key derivation, encrypt/decrypt of short strings) but uses
 * AES-GCM via WebCrypto since the Workers runtime has no Fernet.
 *
 * Compatibility: ciphertext is NOT interchangeable with the FastAPI
 * Fernet ciphertext. That is intentional — wellbeing data lives only in
 * D1 (production) and SQLite (local dev). The Python and TS sides never
 * read each other's rows.
 *
 * Storage format per ciphertext blob (base64-url):
 *   bytes[0..12]   — 96-bit random IV
 *   bytes[12..]    — AES-GCM ciphertext + 128-bit auth tag
 *
 * Key derivation:
 *   PBKDF2-HMAC-SHA256, 200,000 iterations, salt = "axal-studioos-wellbeing-v1",
 *   secret = AXAL_ENCRYPTION_SECRET || JWT_SECRET. Worker missing the
 *   secret raises at first encrypt/decrypt — never silently no-ops.
 *
 * Per-isolate key cache: the derived CryptoKey is cached on a module
 * map keyed by the secret string so PBKDF2 only runs once per isolate
 * lifetime (Workers reuse isolates across requests).
 */

const SALT = new TextEncoder().encode('axal-studioos-wellbeing-v1');
const ITERATIONS = 200_000;
const IV_BYTES = 12;

const keyCache = new Map<string, Promise<CryptoKey>>();

function getSecret(env: { AXAL_ENCRYPTION_SECRET?: string; JWT_SECRET?: string }): string {
  const s = env.AXAL_ENCRYPTION_SECRET || env.JWT_SECRET || '';
  if (!s) {
    throw new Error('AXAL_ENCRYPTION_SECRET (or JWT_SECRET) must be set to encrypt wellbeing data');
  }
  return s;
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const cached = keyCache.get(secret);
  if (cached) return cached;
  const promise = (async () => {
    const baseKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'PBKDF2' },
      false,
      ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: SALT, iterations: ITERATIONS, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  })();
  keyCache.set(secret, promise);
  return promise;
}

function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encryptString(
  env: { AXAL_ENCRYPTION_SECRET?: string; JWT_SECRET?: string },
  plaintext: string,
): Promise<string> {
  const key = await deriveKey(getSecret(env));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return b64encode(out);
}

export async function decryptString(
  env: { AXAL_ENCRYPTION_SECRET?: string; JWT_SECRET?: string },
  blob: string | null | undefined,
): Promise<string | null> {
  if (!blob) return null;
  // Surface missing-secret misconfiguration explicitly — otherwise a
  // misconfigured worker would silently return null for every encrypted
  // row and the bug would only show up as "wellbeing data looks empty"
  // in the UI. Caller (the route handler) can map this to a 500.
  const secret = getSecret(env);
  try {
    const key = await deriveKey(secret);
    const bytes = b64decode(blob);
    if (bytes.length < IV_BYTES + 16) return null;
    const iv = bytes.slice(0, IV_BYTES);
    const ct = bytes.slice(IV_BYTES);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch {
    // Wrong key, tampered ciphertext, or malformed input — never crash a
    // read; the row is simply unreadable. Caller treats null as missing.
    return null;
  }
}

/** Decrypt a string that was originally an integer (1..5 wellbeing answer). */
export async function decryptInt(
  env: { AXAL_ENCRYPTION_SECRET?: string; JWT_SECRET?: string },
  blob: string | null | undefined,
): Promise<number | null> {
  const s = await decryptString(env, blob);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
