/**
 * Task #33 — Column-level AES-256-GCM cipher with per-column AAD scoping
 * + deterministic HMAC index for lookup-required columns.
 *
 * Design (independent from the legacy `cryptoBox.ts`):
 *   - Master key:   `env.KEK_PII` (preferred) or `env.JWT_SECRET` (fallback).
 *     KEK_PII MUST be ≥32 bytes; in production a missing KEK_PII throws
 *     at first encrypt call (see `getKey`). Wellbeing rows continue to use
 *     `cryptoBox.ts` (different namespace, different ciphertext format).
 *   - Algorithm:    AES-256-GCM, 12-byte random nonce, 16-byte tag.
 *   - AAD:          UTF-8 bytes of `${table}:${column}:${rowId}`.
 *                   Binding the ciphertext to its row prevents an attacker
 *                   with raw-SQL access from cut-and-pasting one user's
 *                   encrypted SSN onto another user's row — the GCM tag
 *                   verification fails when the AAD doesn't match.
 *   - Storage:      base64-url string. Layout: `v1.<b64(nonce||ct||tag)>`.
 *                   The `v1.` prefix lets us rotate the algorithm later
 *                   without ambiguous decoding of legacy rows.
 *   - HMAC index:   SHA-256 HMAC over a normalised value, hex-encoded,
 *                   keyed off a domain-separated subkey of KEK_PII. Used
 *                   for equality lookups (e.g. find user by email_hash)
 *                   without ever decrypting the row. Deterministic — never
 *                   reuse for confidentiality.
 *
 * NOT FOR:
 *   - Wellbeing data (continue using `cryptoBox.ts`).
 *   - Anything where the search predicate isn't an exact-equality compare
 *     (range queries on encrypted columns are unsupported by design).
 */
import type { Env } from '../types';

type CipherEnv = Pick<Env, 'KEK_PII' | 'JWT_SECRET' | 'ENVIRONMENT' | 'STUDIOOS_ENV'>;

const VERSION_TAG = 'v1';
const NONCE_BYTES = 12;
const HKDF_INFO_AEAD = new TextEncoder().encode('axal-column-cipher-aead-v1');
const HKDF_INFO_INDEX = new TextEncoder().encode('axal-column-cipher-index-v1');
const HKDF_SALT = new TextEncoder().encode('axal-studioos-pii-v1');

const aeadKeyCache = new Map<string, Promise<CryptoKey>>();
const indexKeyCache = new Map<string, Promise<CryptoKey>>();

function getMasterSecret(env: CipherEnv): string {
  const explicit = env.KEK_PII || '';
  if (explicit) {
    if (new TextEncoder().encode(explicit).byteLength < 32) {
      throw new Error('KEK_PII must be at least 32 bytes');
    }
    return explicit;
  }
  const envName = (env.STUDIOOS_ENV || env.ENVIRONMENT || 'dev').toLowerCase();
  if (envName === 'production' || envName === 'prod') {
    throw new Error('KEK_PII is required in production for column-level encryption');
  }
  // Dev/preview: fall back to JWT_SECRET so local iteration works without
  // a separately-provisioned secret. Wrong-key reads will simply return null.
  const fallback = env.JWT_SECRET || '';
  if (!fallback) {
    throw new Error('Neither KEK_PII nor JWT_SECRET is set — cannot derive column cipher key');
  }
  return fallback;
}

async function deriveAeadKey(secret: string): Promise<CryptoKey> {
  const cached = aeadKeyCache.get(secret);
  if (cached) return cached;
  const promise = (async () => {
    const ikm = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: HKDF_INFO_AEAD },
      ikm,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  })();
  aeadKeyCache.set(secret, promise);
  return promise;
}

async function deriveIndexKey(secret: string): Promise<CryptoKey> {
  const cached = indexKeyCache.get(secret);
  if (cached) return cached;
  const promise = (async () => {
    const ikm = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: HKDF_INFO_INDEX },
      ikm,
      { name: 'HMAC', hash: 'SHA-256', length: 256 },
      false,
      ['sign'],
    );
  })();
  indexKeyCache.set(secret, promise);
  return promise;
}

function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64decode(s: string): Uint8Array {
  let pad = s.replace(/-/g, '+').replace(/_/g, '/');
  while (pad.length % 4) pad += '=';
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function buildAad(table: string, column: string, rowId: string | number): Uint8Array {
  return new TextEncoder().encode(`${table}:${column}:${rowId}`);
}

/**
 * Encrypt a string for a specific (table, column, rowId) tuple. Returns the
 * versioned, base64-url-encoded ciphertext. Pass an empty rowId only when
 * the row's identity is genuinely unknown at write time (rare — prefer
 * writing the row first and re-encrypting once the id is known).
 */
export async function encryptColumn(
  env: CipherEnv,
  table: string,
  column: string,
  rowId: string | number,
  plaintext: string,
): Promise<string> {
  const key = await deriveAeadKey(getMasterSecret(env));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: buildAad(table, column, rowId) },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce, 0);
  out.set(ct, nonce.length);
  return `${VERSION_TAG}.${b64encode(out)}`;
}

/**
 * Decrypt. Returns null on tampering / wrong-key / malformed input — never
 * throws so a single bad row can't crash a list endpoint. Caller treats
 * null as "value unavailable" and decides whether to surface it.
 */
export async function decryptColumn(
  env: CipherEnv,
  table: string,
  column: string,
  rowId: string | number,
  blob: string | null | undefined,
): Promise<string | null> {
  if (!blob) return null;
  if (!blob.startsWith(`${VERSION_TAG}.`)) return null;
  try {
    const key = await deriveAeadKey(getMasterSecret(env));
    const bytes = b64decode(blob.slice(VERSION_TAG.length + 1));
    if (bytes.length < NONCE_BYTES + 16) return null;
    const nonce = bytes.slice(0, NONCE_BYTES);
    const ct = bytes.slice(NONCE_BYTES);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: buildAad(table, column, rowId) },
      key,
      ct,
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

/**
 * Deterministic HMAC index for equality lookups on encrypted columns.
 * Normalises whitespace + casing so `"Foo@Bar.com "` and `"foo@bar.com"`
 * collide (the only sensible behaviour for email/phone search). For
 * truly case-sensitive identifiers, pre-normalise yourself and pass the
 * raw value as-is.
 *
 * Hex-encoded SHA-256 → 64 chars. Use a `*_index` column with a UNIQUE
 * INDEX so the lookup remains fast and the equality semantics are
 * enforced at the database level.
 */
export async function indexHmac(
  env: CipherEnv,
  table: string,
  column: string,
  value: string,
): Promise<string> {
  const key = await deriveIndexKey(getMasterSecret(env));
  // Domain-separate by `${table}:${column}` so the same plaintext in two
  // different columns produces two different hashes. Otherwise two
  // unrelated tables both indexing emails would leak set-equality across
  // them via the index column alone.
  const normalised = value.trim().toLowerCase();
  const data = new TextEncoder().encode(`${table}:${column}:${normalised}`);
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Last-N helper used for displaying e.g. `••••1234` next to an encrypted
 * SSN/tax-id without decrypting on every list render. Stored in a separate
 * plaintext `*_last4` column at write time.
 */
export function last4(s: string): string {
  const digits = s.replace(/\D+/g, '');
  if (digits.length <= 4) return digits;
  return digits.slice(-4);
}
