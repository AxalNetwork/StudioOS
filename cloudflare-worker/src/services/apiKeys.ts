/**
 * D841 (#2464) — member API keys for https://axal.vc/mcp and the supported
 * /api routes (plan: documentation/architecture/MCP_API_PLATFORM.md §3, §4).
 *
 * A key is `axk_<key_id>_<secret>`:
 *   - key_id: 12 characters of [a-z0-9], public, the lookup;
 *   - secret: 32 random bytes as base64url (43 characters).
 * Only the key_id and the SHA-256 of the secret are stored (migration 523). A
 * secret carries 256 bits of entropy, so a plain SHA-256 is the right hash: a
 * slow password hash buys nothing against a value nobody can guess, and costs
 * every call. The comparison is constant-time.
 *
 * A KEY IS NEVER TRUSTED ON ITS OWN, exactly as an OAuth grant is not
 * (mcp/grants.ts): `verifyKey` re-reads the user (active, no deletion request,
 * no "sign out everywhere" after the key was made), and every tool call
 * re-checks each company against the app's own access rules.
 *
 * NO ESCALATION. A key's scopes must be ones the creator could grant, and its
 * companies must be ventures the creator owns — the same rule OAuth consent
 * uses (`grantableCompanies`).
 *
 * THE SECRET LEAVES THIS FILE ONCE: `createKey`'s return value, which the
 * create and rotate routes put in their 201 body. Nothing here logs it, and no
 * read returns it.
 */
import type { Env, User } from '../types';
import { SCOPES } from '../mcp/oauth';
import { grantableCompanies } from '../mcp/grants';

export const KEY_PREFIX = 'axk_';
export const KEY_ID_LENGTH = 12;
export const SECRET_BYTES = 32;
/** Live (not revoked, not expired) keys a member may hold at once. */
export const MAX_LIVE_KEYS = 25;
export const MAX_EXPIRY_DAYS = 365;
/** What each scope lets a key do, for the keys page. A scope with `write: true` changes data. */
export const SCOPE_LABELS: Readonly<Record<string, { label: string; write: boolean }>> = Object.freeze({
  'validate:read': { label: 'Read Validate data', write: false },
  'validate:write': { label: 'Add interviews and propose placements in Validate', write: true },
  'build:read': { label: 'Read Build progress', write: false },
  'raise:read': { label: 'Read Raise data', write: false },
  'connectors:read': { label: 'Read connection status', write: false },
});
export const scopeOptions = () => keyScopes().map((name) => ({ name, label: SCOPE_LABELS[name]?.label ?? name, write: SCOPE_LABELS[name]?.write ?? true }));

/** The scopes a key may carry: the MCP server's own (read at call time, so a later import cycle cannot leave it undefined). */
export const keyScopes = (): readonly string[] => SCOPES;

const KEY_RE = /^axk_([a-z0-9]{12})_([A-Za-z0-9_-]{43})$/;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export const apiKeysEnabled = (env: Env) => (env as unknown as Record<string, unknown>).API_KEYS_ENABLED === 'true';

/** True when a bearer looks like an Axal key (no lookup, no secret check). */
export const looksLikeKey = (bearer: string | null | undefined) => typeof bearer === 'string' && bearer.startsWith(KEY_PREFIX);

export interface KeyRow {
  uid: string; user_id: number; key_id: string; secret_sha256: string; name: string;
  scopes_json: string; companies_json: string; monthly_limit_microusd: number | null; rate_per_minute: number;
  last_used_at: string | null; expires_at: string | null; revoked_at: string | null; revoked_reason: string | null;
  replaced_by_uid: string | null; created_at: string; updated_at: string;
}

/** What a read may return: never the hash, never any part of the secret. */
export interface KeyView {
  uid: string; name: string; key_id: string; prefix: string; scopes: string[];
  /** `still_owned` is false when the member no longer owns that company: the key can no longer reach it. */
  companies: Array<{ id: number; name: string | null; still_owned: boolean }>;
  created_at: string; last_used_at: string | null; expires_at: string | null; revoked_at: string | null;
  revoked_reason: string | null; monthly_limit_microusd: number | null; rate_per_minute: number;
}

/** A refusal sentence this file wrote, with its code; never provider or SQLite text (D278). */
export class KeyInputError extends Error {
  code: string;
  sentence: string;
  constructor(code: string, sentence: string) { super(sentence); this.code = code; this.sentence = sentence; }
}

function randomKeyId(): string {
  // Rejection sampling keeps every character equally likely (252 = 7 × 36).
  let out = '';
  while (out.length < KEY_ID_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    for (const b of bytes) {
      if (b < 252 && out.length < KEY_ID_LENGTH) out += ALPHABET[b % 36];
    }
  }
  return out;
}

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(value: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Equal-length strings compared in time independent of where they differ. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** SQLite's `datetime('now')` text as epoch milliseconds (UTC), or NaN. */
const sqlMs = (s: string | null) => (s ? Date.parse(`${s.replace(' ', 'T')}${/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z'}`) : NaN);
const sqlNow = (now: Date) => now.toISOString().slice(0, 19).replace('T', ' ');

function parseJsonArray(raw: string): unknown[] {
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
}

export function rowScopes(row: Pick<KeyRow, 'scopes_json'>): string[] {
  return parseJsonArray(row.scopes_json).filter((s): s is string => typeof s === 'string' && keyScopes().includes(s));
}
export function rowCompanies(row: Pick<KeyRow, 'companies_json'>): number[] {
  return parseJsonArray(row.companies_json).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0);
}

export function isLive(row: Pick<KeyRow, 'revoked_at' | 'expires_at'>, now = new Date()): boolean {
  if (row.revoked_at) return false;
  if (row.expires_at && !(sqlMs(row.expires_at) > now.getTime())) return false;
  return true;
}

export function viewOf(row: KeyRow, companyNames: Map<number, string | null> = new Map()): KeyView {
  return {
    uid: row.uid, name: row.name, key_id: row.key_id, prefix: `${KEY_PREFIX}${row.key_id}`,
    scopes: rowScopes(row),
    companies: rowCompanies(row).map((id) => ({ id, name: companyNames.get(id) ?? null, still_owned: companyNames.has(id) })),
    created_at: row.created_at, last_used_at: row.last_used_at, expires_at: row.expires_at,
    revoked_at: row.revoked_at, revoked_reason: row.revoked_reason,
    monthly_limit_microusd: row.monthly_limit_microusd, rate_per_minute: row.rate_per_minute,
  };
}

export interface CreateInput {
  name: unknown; scopes: unknown; companies: unknown;
  expires_in_days?: unknown; monthly_limit_microusd?: unknown;
}

/** Validate a create request against what this user may grant. Throws KeyInputError. */
export async function checkCreateInput(env: Env, user: User, input: CreateInput) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length < 1 || name.length > 60) throw new KeyInputError('invalid_name', 'Give the key a name of 1 to 60 characters.');
  if (!Array.isArray(input.scopes) || input.scopes.length === 0) throw new KeyInputError('invalid_scopes', 'Choose at least one permission.');
  const scopes = [...new Set(input.scopes)];
  if (!scopes.every((s) => typeof s === 'string' && keyScopes().includes(s))) {
    throw new KeyInputError('invalid_scopes', 'One of those permissions cannot be given to a key.');
  }
  if (!Array.isArray(input.companies) || input.companies.length === 0) throw new KeyInputError('invalid_companies', 'Choose at least one company.');
  const companies = [...new Set(input.companies.map(Number))];
  const grantable = new Map((await grantableCompanies(env, user)).map((c) => [c.id, c.name]));
  if (!companies.every((id) => Number.isSafeInteger(id) && grantable.has(id))) {
    throw new KeyInputError('invalid_companies', 'A key can only reach companies you own.');
  }
  let expiresInDays: number | null = null;
  if (input.expires_in_days !== undefined && input.expires_in_days !== null) {
    const n = Number(input.expires_in_days);
    if (!Number.isSafeInteger(n) || n < 1 || n > MAX_EXPIRY_DAYS) throw new KeyInputError('invalid_expiry', `Choose an expiry of 1 to ${MAX_EXPIRY_DAYS} days, or none.`);
    expiresInDays = n;
  }
  let limit: number | null = null;
  if (input.monthly_limit_microusd !== undefined && input.monthly_limit_microusd !== null) {
    const n = input.monthly_limit_microusd;
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1) throw new KeyInputError('invalid_limit', 'A monthly limit must be a positive whole amount.');
    limit = n;
  }
  return { name, scopes: scopes as string[], companies, expiresInDays, limit, grantable };
}

export async function liveKeyCount(env: Env, userId: number, now = new Date()): Promise<number> {
  const r = await env.DB.prepare('SELECT revoked_at, expires_at FROM member_api_keys WHERE user_id = ? AND revoked_at IS NULL')
    .bind(userId).all<Pick<KeyRow, 'revoked_at' | 'expires_at'>>();
  return (r.results || []).filter((row) => isLive(row, now)).length;
}

/** Mint a key. The returned `secret` is the only copy that will ever exist. */
export async function createKey(env: Env, userId: number, spec: {
  name: string; scopes: string[]; companies: number[]; expiresInDays: number | null; limit: number | null; ratePerMinute?: number;
}, now = new Date()): Promise<{ row: KeyRow; secret: string }> {
  const keyId = randomKeyId();
  const secretPart = base64url(crypto.getRandomValues(new Uint8Array(SECRET_BYTES)));
  const secret = `${KEY_PREFIX}${keyId}_${secretPart}`;
  const uid = crypto.randomUUID();
  const created = sqlNow(now);
  const expires = spec.expiresInDays ? sqlNow(new Date(now.getTime() + spec.expiresInDays * 86_400_000)) : null;
  await env.DB.prepare(`INSERT INTO member_api_keys (uid, user_id, key_id, secret_sha256, name, scopes_json, companies_json,
      monthly_limit_microusd, rate_per_minute, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(uid, userId, keyId, await sha256Hex(secretPart), spec.name, JSON.stringify(spec.scopes), JSON.stringify(spec.companies),
      spec.limit, spec.ratePerMinute ?? 60, expires, created, created).run();
  const row = await env.DB.prepare('SELECT * FROM member_api_keys WHERE uid = ?').bind(uid).first<KeyRow>();
  if (!row) throw new Error('API key unreadable');
  return { row, secret };
}

export async function listKeys(env: Env, userId: number): Promise<KeyRow[]> {
  const r = await env.DB.prepare('SELECT * FROM member_api_keys WHERE user_id = ? ORDER BY created_at DESC, uid')
    .bind(userId).all<KeyRow>();
  return r.results || [];
}

export async function ownKey(env: Env, userId: number, uid: string): Promise<KeyRow | null> {
  if (typeof uid !== 'string' || uid.length > 64) return null;
  return env.DB.prepare('SELECT * FROM member_api_keys WHERE uid = ? AND user_id = ?').bind(uid, userId).first<KeyRow>();
}

/** Change a live key's name or its monthly AI token cap. Scopes and companies never change: rotate or create instead. */
export async function updateKey(env: Env, userId: number, uid: string, input: { name?: unknown; monthly_limit_microusd?: unknown }, now = new Date()): Promise<KeyRow | null> {
  const row = await ownKey(env, userId, uid);
  if (!row || !isLive(row, now)) return null;
  let name = row.name;
  if (input.name !== undefined) {
    name = typeof input.name === 'string' ? input.name.trim() : '';
    if (name.length < 1 || name.length > 60) throw new KeyInputError('invalid_name', 'Give the key a name of 1 to 60 characters.');
  }
  let limit = row.monthly_limit_microusd;
  if (input.monthly_limit_microusd !== undefined) {
    const n = input.monthly_limit_microusd;
    if (n !== null && (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1)) throw new KeyInputError('invalid_limit', 'A monthly limit must be a positive whole amount, or none.');
    limit = n as number | null;
  }
  const at = sqlNow(now);
  await env.DB.prepare('UPDATE member_api_keys SET name = ?, monthly_limit_microusd = ?, updated_at = ? WHERE uid = ? AND user_id = ? AND revoked_at IS NULL')
    .bind(name, limit, at, uid, userId).run();
  return ownKey(env, userId, uid);
}

/** Revoke one key now. A key already revoked stays as it was. */
export async function revokeKey(env: Env, userId: number, uid: string, now = new Date()): Promise<KeyRow | null> {
  const at = sqlNow(now);
  await env.DB.prepare(`UPDATE member_api_keys SET revoked_at = ?, revoked_reason = 'revoked', updated_at = ?
    WHERE uid = ? AND user_id = ? AND revoked_at IS NULL`).bind(at, at, uid, userId).run();
  return ownKey(env, userId, uid);
}

/**
 * Replace a live key with a new one carrying the same name, scopes, companies,
 * limit and remaining expiry window, and revoke the old one in the same batch.
 */
export async function rotateKey(env: Env, user: User, uid: string, now = new Date()) {
  const old = await ownKey(env, user.id, uid);
  if (!old || !isLive(old, now)) return null;
  // Re-check what the creator may still grant: a key never outlives its owner's access.
  const grantable = new Set((await grantableCompanies(env, user)).map((c) => c.id));
  const companies = rowCompanies(old).filter((id) => grantable.has(id));
  if (companies.length === 0) throw new KeyInputError('invalid_companies', 'You no longer own any company this key could reach.');
  const daysLeft = old.expires_at ? Math.max(1, Math.ceil((sqlMs(old.expires_at) - now.getTime()) / 86_400_000)) : null;
  const keyId = randomKeyId();
  const secretPart = base64url(crypto.getRandomValues(new Uint8Array(SECRET_BYTES)));
  const newUid = crypto.randomUUID();
  const at = sqlNow(now);
  const expires = daysLeft ? sqlNow(new Date(now.getTime() + daysLeft * 86_400_000)) : null;
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE member_api_keys SET revoked_at = ?, revoked_reason = 'rotated', replaced_by_uid = ?, updated_at = ?
      WHERE uid = ? AND user_id = ? AND revoked_at IS NULL`).bind(at, newUid, at, old.uid, user.id),
    env.DB.prepare(`INSERT INTO member_api_keys (uid, user_id, key_id, secret_sha256, name, scopes_json, companies_json,
        monthly_limit_microusd, rate_per_minute, expires_at, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS
        (SELECT 1 FROM member_api_keys WHERE uid = ? AND revoked_reason = 'rotated' AND replaced_by_uid = ?)`)
      .bind(newUid, user.id, keyId, await sha256Hex(secretPart), old.name, JSON.stringify(rowScopes(old)), JSON.stringify(companies),
        old.monthly_limit_microusd, old.rate_per_minute, expires, at, at, old.uid, newUid),
  ]);
  if (!results[0]?.meta?.changes || !results[1]?.meta?.changes) return null; // lost a race with a revoke or another rotate
  const row = await ownKey(env, user.id, newUid);
  const replaced = await ownKey(env, user.id, old.uid);
  if (!row || !replaced) throw new Error('API key unreadable');
  return { row, secret: `${KEY_PREFIX}${keyId}_${secretPart}`, replaced };
}

export type VerifyFailure = 'invalid_key' | 'revoked_key' | 'expired_key';
type UserRow = Pick<User, 'id' | 'role' | 'founder_id' | 'spinout_lab_active'> & {
  email: string | null; is_active: number | null; jwt_min_iat: number | null; deletion_requested_at: string | null;
};

/**
 * Resolve a bearer to its live key and account, or say why not. Unknown ids,
 * wrong secrets and malformed values all answer `invalid_key`, so the answer
 * never tells a caller whether an id exists. A revoked or expired key is
 * reported as such only after its secret matched: only the holder learns it.
 */
export async function verifyKey(env: Env, bearer: string, now = new Date()):
  Promise<{ ok: true; key: KeyRow; user: UserRow } | { ok: false; reason: VerifyFailure }> {
  const m = KEY_RE.exec(bearer || '');
  if (!m) return { ok: false, reason: 'invalid_key' };
  const row = await env.DB.prepare('SELECT * FROM member_api_keys WHERE key_id = ?').bind(m[1]).first<KeyRow>();
  // Hash even on a miss, so a miss and a mismatch cost the same.
  const presented = await sha256Hex(m[2]);
  if (!row || !constantTimeEqual(presented, row.secret_sha256)) return { ok: false, reason: 'invalid_key' };
  if (row.revoked_at) return { ok: false, reason: 'revoked_key' };
  if (!isLive(row, now)) return { ok: false, reason: 'expired_key' };
  const user = await env.DB.prepare('SELECT id, role, founder_id, spinout_lab_active, email, is_active, jwt_min_iat, deletion_requested_at FROM users WHERE id = ?')
    .bind(row.user_id).first<UserRow>();
  if (!user || user.is_active === 0 || user.deletion_requested_at) return { ok: false, reason: 'revoked_key' };
  // "Sign out everywhere" ends every key made before it, as it ends OAuth grants.
  const createdSec = Math.floor(sqlMs(row.created_at) / 1000);
  if (user.jwt_min_iat != null && Number(user.jwt_min_iat) > createdSec) return { ok: false, reason: 'revoked_key' };
  return { ok: true, key: row, user };
}

/** Record a use, at most once a minute per key, so a busy key costs one write a minute. */
export async function touchLastUsed(env: Env, uid: string, now = new Date()): Promise<void> {
  const at = sqlNow(now);
  try {
    await env.DB.prepare(`UPDATE member_api_keys SET last_used_at = ?
      WHERE uid = ? AND (last_used_at IS NULL OR datetime(last_used_at) <= datetime(?, '-60 seconds'))`).bind(at, uid, at).run();
  } catch (e) {
    console.warn('[apiKeys] last-used write failed', (e as Error)?.message);
  }
}
