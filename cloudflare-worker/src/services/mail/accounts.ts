/**
 * D1340 (#3548) — the member's own mailboxes (migration 647).
 *
 * CREDENTIALS ARE SEALED, NEVER SHOWN. `credentials` is `encryptColumn` (the
 * EIN helper, `../columnCipher.ts`) with its AAD bound to the row's uid, so a
 * blob moved to another row does not open. `accountView` is the only shape a
 * client sees, and it has no credentials field. Nothing here logs.
 *
 * Every read is the member's own row: another member's uid is not found.
 * A disconnect empties `credentials` and marks the row `revoked`; the row and
 * its `mail_sent` rows stay.
 */
import type { Env, User } from '../../types';
import { decryptColumn, encryptColumn } from '../columnCipher';
import type { Provider } from './adapters';
import type { Creds } from './adapters/types';

const TABLE = 'mail_accounts';
const COLUMN = 'credentials';

export type AccountRow = {
  id: number; uid: string; user_id: number; provider: Provider; address: string; display_name: string | null;
  status: 'active' | 'expired' | 'revoked'; scopes: string | null; can_read: number; credentials: string | null;
  created_at: string; last_used_at: string | null; last_error: string | null;
};

export function accountView(r: AccountRow) {
  return {
    uid: r.uid, provider: r.provider, address: r.address, display_name: r.display_name, status: r.status,
    scopes: r.scopes ? r.scopes.split(/\s+/).filter(Boolean) : [], can_read: r.can_read === 1,
    created_at: r.created_at, last_used_at: r.last_used_at, last_error: r.last_error,
  };
}
export type AccountView = ReturnType<typeof accountView>;

const UID = /^[a-f0-9]{32}$/;
const now = () => new Date().toISOString();

export async function listAccounts(env: Env, user: User): Promise<AccountView[]> {
  const rows = await env.DB.prepare(
    "SELECT * FROM mail_accounts WHERE user_id = ? AND status <> 'revoked' ORDER BY created_at, id",
  ).bind(user.id).all<AccountRow>();
  return (rows.results || []).map(accountView);
}

/** The member's own account, or null: another member's uid reads exactly as one that does not exist. */
export async function accountOf(env: Env, user: User, uid: unknown): Promise<AccountRow | null> {
  if (typeof uid !== 'string' || !UID.test(uid)) return null;
  return await env.DB.prepare("SELECT * FROM mail_accounts WHERE uid = ? AND user_id = ? AND status <> 'revoked'")
    .bind(uid, user.id).first<AccountRow>();
}

export async function openCreds(env: Env, row: AccountRow): Promise<Creds | null> {
  const plain = await decryptColumn(env, TABLE, COLUMN, row.uid, row.credentials);
  if (!plain) return null;
  try { return JSON.parse(plain) as Creds; } catch { return null; }
}

const seal = (env: Env, uid: string, creds: Creds) => encryptColumn(env, TABLE, COLUMN, uid, JSON.stringify(creds));

/** Connects a mailbox: the same address and provider again replaces the old credentials on the same row. */
export async function saveAccount(env: Env, user: User, a: { provider: Provider; address: string; display_name: string | null; scopes: string; can_read: boolean; creds: Creds }): Promise<AccountView> {
  const existing = await env.DB.prepare('SELECT uid FROM mail_accounts WHERE user_id = ? AND provider = ? AND lower(address) = lower(?)')
    .bind(user.id, a.provider, a.address).first<{ uid: string }>();
  const uid = existing?.uid ?? crypto.randomUUID().replace(/-/g, '');
  const sealed = await seal(env, uid, a.creds);
  if (existing) {
    await env.DB.prepare(
      "UPDATE mail_accounts SET display_name = ?, status = 'active', scopes = ?, can_read = ?, credentials = ?, last_error = NULL WHERE uid = ? AND user_id = ?",
    ).bind(a.display_name, a.scopes, a.can_read ? 1 : 0, sealed, uid, user.id).run();
  } else {
    await env.DB.prepare(
      'INSERT INTO mail_accounts (uid, user_id, provider, address, display_name, scopes, can_read, credentials) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(uid, user.id, a.provider, a.address, a.display_name, a.scopes, a.can_read ? 1 : 0, sealed).run();
  }
  return accountView((await env.DB.prepare('SELECT * FROM mail_accounts WHERE uid = ?').bind(uid).first<AccountRow>())!);
}

/** A use that worked: rotated credentials sealed again, the error cleared. */
export async function markUsed(env: Env, row: AccountRow, rotated?: Creds): Promise<void> {
  if (rotated) {
    await env.DB.prepare("UPDATE mail_accounts SET credentials = ?, status = 'active', last_used_at = ?, last_error = NULL WHERE id = ?")
      .bind(await seal(env, row.uid, rotated), now(), row.id).run();
  } else {
    await env.DB.prepare("UPDATE mail_accounts SET status = 'active', last_used_at = ?, last_error = NULL WHERE id = ?").bind(now(), row.id).run();
  }
}

/** The provider asked for a new connection: `expired`, with the sentence the member reads. */
export async function markExpired(env: Env, row: AccountRow, sentence: string): Promise<void> {
  await env.DB.prepare("UPDATE mail_accounts SET status = 'expired', last_error = ? WHERE id = ?").bind(sentence, row.id).run();
}

export async function markError(env: Env, row: AccountRow, sentence: string): Promise<void> {
  await env.DB.prepare('UPDATE mail_accounts SET last_error = ? WHERE id = ?').bind(sentence, row.id).run();
}

/** Forgets the credentials. The row stays `revoked`, so its sent rows still name the address. */
export async function forget(env: Env, row: AccountRow): Promise<void> {
  await env.DB.prepare("UPDATE mail_accounts SET credentials = NULL, status = 'revoked' WHERE id = ?").bind(row.id).run();
}

// ---------------------------------------------------------------- nonces

const NONCE_MINUTES = { send: 5, oauth: 10 } as const;

async function sha256(v: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A fresh one-use nonce; only its hash is stored. */
export async function issueNonce(env: Env, user: User, kind: 'send' | 'oauth', provider: string | null = null): Promise<{ nonce: string; expires_at: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const expires = new Date(Date.now() + NONCE_MINUTES[kind] * 60000).toISOString();
  await env.DB.prepare('DELETE FROM mail_nonces WHERE user_id = ? AND (expires_at < ? OR used_at IS NOT NULL)').bind(user.id, now()).run();
  await env.DB.prepare('INSERT INTO mail_nonces (nonce_hash, user_id, kind, provider, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256(nonce), user.id, kind, provider, expires).run();
  return { nonce, expires_at: expires };
}

/** Spends the member's own unexpired send nonce. True exactly once. */
export async function spendSendNonce(env: Env, user: User, nonce: unknown): Promise<boolean> {
  if (typeof nonce !== 'string' || nonce.length < 20 || nonce.length > 100) return false;
  const r = await env.DB.prepare(
    "UPDATE mail_nonces SET used_at = ? WHERE nonce_hash = ? AND user_id = ? AND kind = 'send' AND used_at IS NULL AND expires_at > ?",
  ).bind(now(), await sha256(nonce), user.id, now()).run();
  return (r.meta?.changes ?? 0) === 1;
}

/** Spends an OAuth state: the member and provider it was issued for, once, or null. */
export async function spendOauthState(env: Env, state: unknown): Promise<{ user_id: number; provider: string } | null> {
  if (typeof state !== 'string' || state.length < 20 || state.length > 100) return null;
  return await env.DB.prepare(
    "UPDATE mail_nonces SET used_at = ? WHERE nonce_hash = ? AND kind = 'oauth' AND used_at IS NULL AND expires_at > ? RETURNING user_id, provider",
  ).bind(now(), await sha256(state), now()).first<{ user_id: number; provider: string }>();
}
