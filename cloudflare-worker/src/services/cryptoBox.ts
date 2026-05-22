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

// Task #71 — describe each candidate secret's state so the error pinpoints
// which env var to fix without guessing. `absent` = the binding is missing
// entirely; `empty` = the binding is set but resolves to an empty / whitespace-
// only string (most common cause of a partly-finished `wrangler secret put`).
function describeSecret(v: string | undefined): 'absent' | 'empty' | 'ok' {
  if (v === undefined || v === null) return 'absent';
  if (String(v).trim().length === 0) return 'empty';
  return 'ok';
}

function getSecret(env: { AXAL_ENCRYPTION_SECRET?: string; JWT_SECRET?: string }): string {
  // IMPORTANT: do NOT trim the returned value — `deriveKey()` uses it as
  // PBKDF2 input, so trimming would change every derived key and silently
  // break decryption of every existing ciphertext (wellbeing answers, DD
  // report blobs, provider OAuth keys, calendar refresh tokens, DocuSign
  // tokens). We only use trimmed copies to *detect* whitespace-only secrets
  // (e.g. accidentally pasted as a newline from `wrangler secret put`) and
  // skip past them in the fallback chain; the original untrimmed value is
  // what we hand to WebCrypto.
  const axalRaw = env.AXAL_ENCRYPTION_SECRET;
  const jwtRaw = env.JWT_SECRET;
  const axalUsable = (axalRaw || '').trim().length > 0;
  const jwtUsable = (jwtRaw || '').trim().length > 0;
  if (axalUsable) return axalRaw as string;
  if (jwtUsable) return jwtRaw as string;
  // Message prefix `cryptoBox:secret_missing` is matched by the OAuth
  // callback bucket in routes/calendar.ts::bucketCallbackFailure to surface
  // a `secret_missing` reason code on the user-facing toast.
  const a = describeSecret(axalRaw);
  const j = describeSecret(jwtRaw);
  throw new Error(`cryptoBox:secret_missing AXAL_ENCRYPTION_SECRET=${a} JWT_SECRET=${j}`);
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

/**
 * Encrypt arbitrary binary data (e.g. a generated PDF report) before
 * writing to R2. Output: 12-byte IV || AES-GCM ciphertext+tag (raw
 * bytes, NOT base64). Companion to {@link decryptBytes}. Used by the
 * DD report writer so report artifacts are never stored as plaintext
 * in object storage.
 */
export async function encryptBytes(
  env: { AXAL_ENCRYPTION_SECRET?: string; JWT_SECRET?: string },
  plaintext: ArrayBuffer | Uint8Array,
): Promise<Uint8Array> {
  const key = await deriveKey(getSecret(env));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ptBytes = plaintext instanceof Uint8Array ? plaintext : new Uint8Array(plaintext);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, ptBytes),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return out;
}

export async function decryptBytes(
  env: { AXAL_ENCRYPTION_SECRET?: string; JWT_SECRET?: string },
  blob: ArrayBuffer | Uint8Array,
): Promise<Uint8Array> {
  const key = await deriveKey(getSecret(env));
  const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  if (bytes.length < IV_BYTES + 16) throw new Error('decryptBytes: payload too short');
  const iv = bytes.slice(0, IV_BYTES);
  const ct = bytes.slice(IV_BYTES);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new Uint8Array(pt);
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
