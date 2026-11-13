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
 *   PBKDF2-HMAC-SHA256, 100,000 iterations, salt = "axal-studioos-wellbeing-v1",
 *   secret = AXAL_ENCRYPTION_SECRET || JWT_SECRET. Worker missing the
 *   secret raises at first encrypt/decrypt — never silently no-ops.
 *
 * Iteration count: 100,000 is the Workers runtime cap on PBKDF2; values
 * above that throw `NotSupportedError: PBKDF2 failed: iterations exceeds
 * the maximum allowed`. The 200,000 LEGACY constant is retained as a
 * best-effort decrypt fallback — it only succeeds in isolates that had
 * cached a 200k key before the runtime cap tightened, or if Cloudflare
 * later raises the cap. Under the current cap, legacy 200k ciphertext is
 * effectively unreadable; we accept this for wellbeing/OAuth-token rows
 * (re-auth or re-enter). Do NOT rely on it for DD report bytes — if any
 * 200k DD reports exist they need a one-time migration in an environment
 * that can still derive at 200k. New encrypts always use 100,000.
 *
 * Per-isolate key cache: the derived CryptoKey is cached on a module
 * map keyed by `secret|iterations` so PBKDF2 only runs once per isolate
 * lifetime per variant (Workers reuse isolates across requests).
 */

const SALT = new TextEncoder().encode('axal-studioos-wellbeing-v1');
const ITERATIONS = 100_000;
const ITERATIONS_LEGACY = 200_000;
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

// Task #71 follow-up — sanitize a WebCrypto error message into a short
// URL-safe slug we can append to the bucket reason without leaking the
// secret itself or producing a giant query string. Strips quoted values
// (which could echo back parts of the input) and clamps to 60 chars.
function sanitizeCryptoError(e: unknown): string {
  const raw = String((e as any)?.name || '') + ':' + String((e as any)?.message || e || 'unknown');
  return raw
    .replace(/['"]/g, '')
    .replace(/[^a-zA-Z0-9._:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'unknown';
}

async function deriveKey(secret: string, iterations: number = ITERATIONS): Promise<CryptoKey> {
  const cacheKey = `${iterations}|${secret}`;
  const cached = keyCache.get(cacheKey);
  if (cached) return cached;
  const promise = (async () => {
    let baseKey: CryptoKey;
    try {
      baseKey = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'PBKDF2' },
        false,
        ['deriveKey'],
      );
    } catch (e) {
      // Tag with step so routes/calendar.ts::bucketCallbackFailure can
      // surface `encrypt:importkey:<slug>` instead of a generic `encrypt`.
      throw new Error(`cryptoBox:encrypt:importkey:${sanitizeCryptoError(e)}`);
    }
    try {
      return await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: SALT, iterations, hash: 'SHA-256' },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    } catch (e) {
      throw new Error(`cryptoBox:encrypt:derive:${sanitizeCryptoError(e)}`);
    }
  })();
  // Don't cache a rejected promise — next call should retry and re-surface.
  promise.catch(() => keyCache.delete(cacheKey));
  keyCache.set(cacheKey, promise);
  return promise;
}

// Try AES-GCM decrypt with the current-iteration key, then fall back to the
// legacy 200k key. Used by decryptString/decryptBytes so older ciphertext
// (written by isolates whose PBKDF2 cache predated the runtime's 100k cap)
// remains readable. Returns the plaintext bytes or throws the last error.
async function decryptWithFallback(
  secret: string,
  iv: Uint8Array,
  ct: Uint8Array,
): Promise<ArrayBuffer> {
  let lastErr: unknown;
  for (const iter of [ITERATIONS, ITERATIONS_LEGACY]) {
    try {
      const key = await deriveKey(secret, iter);
      return await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
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
  // getSecret() throws `cryptoBox:secret_missing ...` on its own; deriveKey()
  // throws `cryptoBox:encrypt:{importkey|derive}:<slug>`. Only the final
  // AES-GCM encrypt step needs an explicit wrapper here.
  const key = await deriveKey(getSecret(env));
  let ct: Uint8Array;
  try {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    ct = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)),
    );
    const out = new Uint8Array(iv.length + ct.length);
    out.set(iv, 0);
    out.set(ct, iv.length);
    return b64encode(out);
  } catch (e) {
    // If getSecret/deriveKey already prefixed, don't double-wrap.
    const msg = String((e as any)?.message || e);
    if (msg.startsWith('cryptoBox:')) throw e;
    throw new Error(`cryptoBox:encrypt:aesgcm:${sanitizeCryptoError(e)}`);
  }
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
    const bytes = b64decode(blob);
    if (bytes.length < IV_BYTES + 16) return null;
    const iv = bytes.slice(0, IV_BYTES);
    const ct = bytes.slice(IV_BYTES);
    const pt = await decryptWithFallback(secret, iv, ct);
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
  const secret = getSecret(env);
  const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  if (bytes.length < IV_BYTES + 16) throw new Error('decryptBytes: payload too short');
  const iv = bytes.slice(0, IV_BYTES);
  const ct = bytes.slice(IV_BYTES);
  const pt = await decryptWithFallback(secret, iv, ct);
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
