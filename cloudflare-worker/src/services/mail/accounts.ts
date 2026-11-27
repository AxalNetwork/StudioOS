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
 *
 * #4654 — ONE STATE PER MAILBOX. `lifecycle_rev` (migration 202611071555) counts the
 * member's own changes to the connection; a provider operation reads the row, calls
 * the provider and writes back only while the revision is the one it read, so a
 * completion that arrives after a disconnect or a reconnect changes nothing, whether
 * it succeeded or failed. A connection completing later is applied only if it was
 * STARTED after the last disconnect and not before the connection already on the row.
 * A member has one row per provider and normalized address (a unique index), and a
 * connect creates or updates it in one statement's worth of state, never a
 * read-then-write.
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
  lifecycle_rev: number; connect_started_at: string | null; disconnected_at: string | null;
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

/** A connection that lost to a newer one, or that was started before the member disconnected the mailbox. */
export class ConnectionSuperseded extends Error {
  reason: 'newer' | 'disconnected';
  constructor(reason: 'newer' | 'disconnected') {
    super(reason === 'newer' ? 'A newer connection for this mailbox replaced this one.' : 'This mailbox was disconnected after this connection was started.');
    this.reason = reason;
  }
  get sentence(): string {
    return this.reason === 'newer'
      ? 'A newer connection for this mailbox replaced this one. Nothing changed.'
      : 'This mailbox was disconnected after you started connecting it. Connect it again to use it.';
  }
}

type NewAccount = { provider: Provider; address: string; display_name: string | null; scopes: string; can_read: boolean; creds: Creds };

/**
 * Connects a mailbox. The same provider and address again is the same row (one per member, provider and normalized
 * address), and an explicitly started connection may reactivate a disconnected one. `startedAt` is when THIS connection
 * began (an OAuth connect: when its state was issued; any other: when the request began): a connection started before the
 * member's last disconnect, or before the one already on the row, is refused with `ConnectionSuperseded` and changes nothing.
 */
export async function saveAccount(env: Env, user: User, a: NewAccount, startedAt: string = now()): Promise<AccountView> {
  const find = () => env.DB.prepare('SELECT * FROM mail_accounts WHERE user_id = ? AND provider = ? AND lower(address) = lower(?)').bind(user.id, a.provider, a.address).first<AccountRow>();
  let existing = await find();
  if (!existing) {
    const uid = crypto.randomUUID().replace(/-/g, '');
    const inserted = await env.DB.prepare(
      `INSERT OR IGNORE INTO mail_accounts (uid, user_id, provider, address, display_name, scopes, can_read, credentials, lifecycle_rev, connect_started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    ).bind(uid, user.id, a.provider, a.address, a.display_name, a.scopes, a.can_read ? 1 : 0, await seal(env, uid, a.creds), startedAt).run();
    if ((inserted.meta?.changes ?? 0) === 1) return accountView((await env.DB.prepare('SELECT * FROM mail_accounts WHERE uid = ?').bind(uid).first<AccountRow>())!);
    // A concurrent connect created the row first: this one is an update of it.
    existing = await find();
    if (!existing) throw new Error('Mailbox could not be saved');
  }
  const sealed = await seal(env, existing.uid, a.creds);
  const updated = await env.DB.prepare(
    `UPDATE mail_accounts
        SET display_name = ?, status = 'active', scopes = ?, can_read = ?, credentials = ?, last_error = NULL,
            lifecycle_rev = lifecycle_rev + 1, connect_started_at = ?
      WHERE id = ? AND user_id = ?
        AND (connect_started_at IS NULL OR connect_started_at <= ?)
        AND (disconnected_at IS NULL OR disconnected_at < ?)`,
  ).bind(a.display_name, a.scopes, a.can_read ? 1 : 0, sealed, startedAt, existing.id, user.id, startedAt, startedAt).run();
  const row = (await env.DB.prepare('SELECT * FROM mail_accounts WHERE id = ?').bind(existing.id).first<AccountRow>())!;
  if ((updated.meta?.changes ?? 0) !== 1) {
    throw new ConnectionSuperseded(row.disconnected_at && row.disconnected_at >= startedAt ? 'disconnected' : 'newer');
  }
  return accountView(row);
}

/**
 * A provider operation that worked: rotated credentials sealed again, the error cleared. Applied only while the row is
 * the one the operation read (same `lifecycle_rev`, not revoked): after a disconnect or a reconnect it changes nothing,
 * and says so (`false`). It never reactivates a mailbox the member disconnected.
 */
export async function markUsed(env: Env, row: AccountRow, rotated?: Creds): Promise<boolean> {
  const r = rotated
    ? await env.DB.prepare("UPDATE mail_accounts SET credentials = ?, status = 'active', last_used_at = ?, last_error = NULL WHERE id = ? AND lifecycle_rev = ? AND status <> 'revoked'")
      .bind(await seal(env, row.uid, rotated), now(), row.id, row.lifecycle_rev).run()
    : await env.DB.prepare("UPDATE mail_accounts SET status = 'active', last_used_at = ?, last_error = NULL WHERE id = ? AND lifecycle_rev = ? AND status <> 'revoked'")
      .bind(now(), row.id, row.lifecycle_rev).run();
  return (r.meta?.changes ?? 0) === 1;
}

/** The provider asked for a new connection: `expired`, with the sentence the member reads. Guarded like `markUsed`. */
export async function markExpired(env: Env, row: AccountRow, sentence: string): Promise<boolean> {
  const r = await env.DB.prepare("UPDATE mail_accounts SET status = 'expired', last_error = ? WHERE id = ? AND lifecycle_rev = ? AND status <> 'revoked'")
    .bind(sentence, row.id, row.lifecycle_rev).run();
  return (r.meta?.changes ?? 0) === 1;
}

export async function markError(env: Env, row: AccountRow, sentence: string): Promise<boolean> {
  const r = await env.DB.prepare("UPDATE mail_accounts SET last_error = ? WHERE id = ? AND lifecycle_rev = ? AND status <> 'revoked'")
    .bind(sentence, row.id, row.lifecycle_rev).run();
  return (r.meta?.changes ?? 0) === 1;
}

/**
 * Forgets the credentials: the member's explicit disconnect. The row stays `revoked`, so its sent rows still name the
 * address, and the revision moves so every operation already in flight is stale. True when this call disconnected it. A
 * disconnect that began before a newer connection was saved (the revision moved) does not undo that newer connection.
 */
export async function forget(env: Env, row: AccountRow): Promise<boolean> {
  const r = await env.DB.prepare(
    "UPDATE mail_accounts SET credentials = NULL, status = 'revoked', lifecycle_rev = lifecycle_rev + 1, disconnected_at = ? WHERE id = ? AND lifecycle_rev = ? AND status <> 'revoked'",
  ).bind(now(), row.id, row.lifecycle_rev).run();
  return (r.meta?.changes ?? 0) === 1;
}

/** The row as persisted now, whatever its state. */
export async function persisted(env: Env, row: AccountRow): Promise<AccountRow> {
  return (await env.DB.prepare('SELECT * FROM mail_accounts WHERE id = ?').bind(row.id).first<AccountRow>()) ?? row;
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
  await env.DB.prepare('INSERT INTO mail_nonces (nonce_hash, user_id, kind, provider, expires_at, issued_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(await sha256(nonce), user.id, kind, provider, expires, now()).run();
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

/** Spends an OAuth state: the member and provider it was issued for, and when the connect STARTED (#4654), once, or null. */
export async function spendOauthState(env: Env, state: unknown): Promise<{ user_id: number; provider: string; issued_at: string | null } | null> {
  if (typeof state !== 'string' || state.length < 20 || state.length > 100) return null;
  return await env.DB.prepare(
    "UPDATE mail_nonces SET used_at = ? WHERE nonce_hash = ? AND kind = 'oauth' AND used_at IS NULL AND expires_at > ? RETURNING user_id, provider, issued_at",
  ).bind(now(), await sha256(state), now()).first<{ user_id: number; provider: string; issued_at: string | null }>();
}
