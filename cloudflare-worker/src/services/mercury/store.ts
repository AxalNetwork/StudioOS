/**
 * D710 (#1775) decision 3 — the entity connections and what their sync stores.
 *
 * ONE LIVE CONNECTION PER AXAL ENTITY, keyed by `AxalEntityKey`, not an
 * `integrations` row: four organizations shared by several admins must keep
 * syncing when a person leaves (D710.md records the departure from D649 and
 * D650, for fund administration only).
 *
 * THE TOKEN is `v1.` ciphertext from `encryptColumn(env,
 * 'mercury_entity_connections', 'credentials_enc', uid, …)`: the KEK_PII
 * cipher `integrations/secrets.ts` uses, with the AAD bound to this table and
 * row. Replacing a token keeps the row and its uid; a connect after a
 * disconnect makes a new row.
 *
 * THE REGISTRY CHECK reads only the entity key and the clear last four of
 * #1773's `entity_bank_accounts`. It never decrypts a number and never calls
 * `payInstructionsFor`. Until that table exists, a connect answers 503
 * `bank_registry_unavailable` and stores nothing.
 *
 * Only `routes/admin_mercury.ts`, `services/mercury/*` and `index.ts`'s cron
 * block import this file (decision 11; `mercury_read_only_d710.test.mjs`).
 */
import type { Env, User } from '../../types';
import { decryptColumn, encryptColumn } from '../columnCipher';
import { AXAL_ENTITIES, type AxalEntityKey } from '../legalDocFormat';
import type { ParsedAccount, ParsedTransaction } from './parse';

export const ENTITY_KEYS: readonly AxalEntityKey[] = Object.freeze(['holdings', 'management', 'gp', 'fund']);
export const isEntityKey = (k: string): k is AxalEntityKey => (ENTITY_KEYS as readonly string[]).includes(k);

const TABLE = 'mercury_entity_connections';
const COLUMN = 'credentials_enc';

export interface ConnectionRow {
  id: number;
  uid: string;
  entity_key: AxalEntityKey;
  status: 'active' | 'error' | 'disconnected';
  credentials_enc: string | null;
  token_preview: string | null;
  mercury_org_name: string | null;
  connected_by: number;
  connected_at: string;
  disconnected_at: string | null;
  last_synced_at: string | null;
  last_sync_requested_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
}

export function newUid(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** `••••` and the token's last four: the only part of a token any response carries. */
export function tokenPreview(token: string): string {
  return `••••${token.slice(-4)}`;
}

export function encryptToken(env: Env, uid: string, token: string): Promise<string> {
  return encryptColumn(env, TABLE, COLUMN, uid, token);
}

export function decryptToken(env: Env, row: Pick<ConnectionRow, 'uid' | 'credentials_enc'>): Promise<string | null> {
  return decryptColumn(env, TABLE, COLUMN, row.uid, row.credentials_enc);
}

export async function liveConnection(env: Env, entityKey: AxalEntityKey): Promise<ConnectionRow | null> {
  return await env.DB.prepare(
    "SELECT * FROM mercury_entity_connections WHERE entity_key = ? AND status <> 'disconnected'",
  ).bind(entityKey).first<ConnectionRow>() ?? null;
}

export async function connectionById(env: Env, id: number): Promise<ConnectionRow | null> {
  return await env.DB.prepare('SELECT * FROM mercury_entity_connections WHERE id = ?').bind(id).first<ConnectionRow>() ?? null;
}

export async function liveConnections(env: Env): Promise<ConnectionRow[]> {
  const r = await env.DB.prepare(
    "SELECT * FROM mercury_entity_connections WHERE status <> 'disconnected' ORDER BY id",
  ).all<ConnectionRow>();
  return r.results || [];
}

/** True when the organization's legal name is not the entity's own (a flag, never a refusal). */
export function orgNameDiffers(entityKey: AxalEntityKey, orgName: string | null): boolean {
  if (!orgName) return false;
  const norm = (s: string) => s.replace(/[.,]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return norm(orgName) !== norm(AXAL_ENTITIES[entityKey].name);
}

/**
 * #1773's registry, by entity and clear last four only. Null when the table
 * does not exist yet (`bank_registry_unavailable`).
 */
export async function registryRows(env: Env): Promise<Array<{ entity_key: string; last_four: string }> | null> {
  const exists = await env.DB.prepare(
    "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'entity_bank_accounts'",
  ).first<{ ok: number }>();
  if (!exists) return null;
  const r = await env.DB.prepare(
    "SELECT entity_key, account_last4 AS last_four FROM entity_bank_accounts WHERE status = 'active'",
  ).all<{ entity_key: string; last_four: string }>();
  return r.results || [];
}

export type RegistryCheck =
  | { ok: true; registered: Set<string> }
  | { ok: false; code: 'mercury_entity_mismatch' | 'mercury_account_taken' };

/**
 * Decision 3: the token's checking and savings accounts against the
 * registry. Every account must not belong to another entity, at least one must
 * be this entity's, and none may already be stored for another entity.
 * `registered` holds the Mercury ids the registry names for this entity.
 */
export async function checkAgainstRegistry(
  env: Env,
  entityKey: AxalEntityKey,
  accounts: ParsedAccount[],
  registry: Array<{ entity_key: string; last_four: string }>,
): Promise<RegistryCheck> {
  const mine = new Set(registry.filter((r) => r.entity_key === entityKey).map((r) => r.last_four));
  const others = new Set(registry.filter((r) => r.entity_key !== entityKey).map((r) => r.last_four));
  if (accounts.some((a) => others.has(a.last_four))) return { ok: false, code: 'mercury_entity_mismatch' };
  const registered = new Set(accounts.filter((a) => mine.has(a.last_four)).map((a) => a.mercury_account_id));
  if (!registered.size) return { ok: false, code: 'mercury_entity_mismatch' };
  for (const a of accounts) {
    const stored = await env.DB.prepare('SELECT entity_key FROM mercury_accounts WHERE mercury_account_id = ?')
      .bind(a.mercury_account_id).first<{ entity_key: string }>();
    if (stored && stored.entity_key !== entityKey) return { ok: false, code: 'mercury_account_taken' };
  }
  return { ok: true, registered };
}

/** Insert a new live connection (a connect), or replace the live one's token. */
export async function saveConnection(
  env: Env,
  user: User,
  entityKey: AxalEntityKey,
  token: string,
  orgName: string | null,
): Promise<{ row: ConnectionRow; replaced: boolean }> {
  const live = await liveConnection(env, entityKey);
  if (live) {
    const enc = await encryptToken(env, live.uid, token);
    await env.DB.prepare(
      `UPDATE mercury_entity_connections
          SET credentials_enc = ?, token_preview = ?, mercury_org_name = ?, status = 'active',
              last_error = NULL, last_error_at = NULL, updated_at = datetime('now')
        WHERE id = ? AND status <> 'disconnected'`,
    ).bind(enc, tokenPreview(token), orgName, live.id).run();
    return { row: (await connectionById(env, live.id))!, replaced: true };
  }
  const uid = newUid();
  const enc = await encryptToken(env, uid, token);
  await env.DB.prepare(
    `INSERT INTO mercury_entity_connections (uid, entity_key, status, credentials_enc, token_preview, mercury_org_name, connected_by)
     VALUES (?, ?, 'active', ?, ?, ?, ?)`,
  ).bind(uid, entityKey, enc, tokenPreview(token), orgName, user.id).run();
  const row = await env.DB.prepare('SELECT * FROM mercury_entity_connections WHERE uid = ?').bind(uid).first<ConnectionRow>();
  return { row: row!, replaced: false };
}

/** Erase the token and keep every account and transaction. */
export async function disconnect(env: Env, user: User, conn: ConnectionRow, reason: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE mercury_entity_connections
        SET status = 'disconnected', credentials_enc = NULL, disconnected_by = ?, disconnected_at = datetime('now'),
            disconnect_reason = ?, updated_at = datetime('now')
      WHERE id = ? AND status <> 'disconnected'`,
  ).bind(user.id, reason, conn.id).run();
}

export async function markConnection(env: Env, conn: Pick<ConnectionRow, 'id'>, outcome: { status?: 'active' | 'error'; error?: string | null; synced?: boolean }): Promise<void> {
  await env.DB.prepare(
    `UPDATE mercury_entity_connections
        SET status = CASE WHEN status = 'disconnected' THEN status ELSE COALESCE(?, status) END,
            last_error = ?, last_error_at = CASE WHEN ? IS NULL THEN last_error_at ELSE datetime('now') END,
            last_synced_at = CASE WHEN ? = 1 THEN datetime('now') ELSE last_synced_at END,
            updated_at = datetime('now')
      WHERE id = ?`,
  ).bind(outcome.status ?? null, outcome.error ?? null, outcome.error ?? null, outcome.synced ? 1 : 0, conn.id).run();
}

export interface AccountRow {
  id: number; uid: string; mercury_account_id: string; connection_id: number; entity_key: AxalEntityKey;
  kind: 'checking' | 'savings'; last_four: string; nickname: string | null; status: string | null; registered: number;
  current_cents: number | null; available_cents: number | null; balance_read_at: string | null;
}

/**
 * Store the connection's accounts. An account of this entity under a
 * disconnected row moves to this connection. `registered` is recomputed when
 * the registry is readable, and kept otherwise.
 */
export async function upsertAccounts(env: Env, conn: ConnectionRow, accounts: ParsedAccount[], registered: Set<string> | null): Promise<AccountRow[]> {
  const today = new Date().toISOString().slice(0, 10);
  for (const a of accounts) {
    const reg = registered == null ? null : registered.has(a.mercury_account_id) ? 1 : 0;
    await env.DB.prepare(
      `INSERT INTO mercury_accounts (uid, mercury_account_id, connection_id, entity_key, kind, last_four, nickname, status, registered,
                                     current_cents, available_cents, balance_read_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 0), ?, ?, datetime('now'))
       ON CONFLICT(mercury_account_id) DO UPDATE SET
         connection_id = excluded.connection_id, kind = excluded.kind, last_four = excluded.last_four,
         nickname = excluded.nickname, status = excluded.status,
         registered = COALESCE(?, mercury_accounts.registered),
         current_cents = excluded.current_cents, available_cents = excluded.available_cents,
         balance_read_at = excluded.balance_read_at, updated_at = datetime('now')
       WHERE mercury_accounts.entity_key = excluded.entity_key`,
    ).bind(newUid(), a.mercury_account_id, conn.id, conn.entity_key, a.kind, a.last_four, a.nickname, a.status, reg,
      a.current_cents, a.available_cents, reg).run();
    // One snapshot per account per UTC day; the day's latest read replaces it.
    // Only for an account this connection holds (another entity's is untouched above).
    const held = await env.DB.prepare('SELECT id FROM mercury_accounts WHERE mercury_account_id = ? AND connection_id = ?')
      .bind(a.mercury_account_id, conn.id).first<{ id: number }>();
    if (!held) continue;
    await env.DB.prepare(
      `INSERT INTO mercury_balance_snapshots (account_id, as_of_date, current_cents, available_cents) VALUES (?, ?, ?, ?)
       ON CONFLICT(account_id, as_of_date) DO UPDATE SET
         current_cents = excluded.current_cents, available_cents = excluded.available_cents, read_at = datetime('now')`,
    ).bind(held.id, today, a.current_cents, a.available_cents).run();
  }
  const r = await env.DB.prepare('SELECT * FROM mercury_accounts WHERE connection_id = ? ORDER BY id').bind(conn.id).all<AccountRow>();
  return r.results || [];
}

/** Statuses after which a matched line no longer stands (UNVERIFIED values). */
export const VOIDED_STATUSES = ['cancelled', 'failed'];

/**
 * Upsert one line on Mercury's id, so a pending line that posts is updated in
 * place. A matched line whose amount changes, or that is cancelled or fails,
 * turns its proposed or confirmed match `needs_review` (decision 9).
 */
export async function upsertTransaction(env: Env, account: Pick<AccountRow, 'id'>, t: ParsedTransaction): Promise<'inserted' | 'updated' | 'unchanged'> {
  const prior = await env.DB.prepare(
    'SELECT id, amount_cents, status, posted_on, created_on, counterparty_name, memo, kind FROM mercury_transactions WHERE mercury_transaction_id = ?',
  ).bind(t.mercury_transaction_id).first<any>();
  if (!prior) {
    await env.DB.prepare(
      `INSERT INTO mercury_transactions (uid, mercury_transaction_id, account_id, amount_cents, currency, created_on, posted_on,
                                         counterparty_name, memo, status, kind)
       VALUES (?, ?, ?, ?, 'usd', ?, ?, ?, ?, ?, ?)`,
    ).bind(newUid(), t.mercury_transaction_id, account.id, t.amount_cents, t.created_on, t.posted_on,
      t.counterparty_name, t.memo, t.status, t.kind).run();
    return 'inserted';
  }
  const same = Number(prior.amount_cents) === t.amount_cents && prior.status === t.status && prior.posted_on === t.posted_on
    && prior.created_on === t.created_on && prior.counterparty_name === t.counterparty_name && prior.memo === t.memo && prior.kind === t.kind;
  if (same) return 'unchanged';
  await env.DB.prepare(
    `UPDATE mercury_transactions
        SET amount_cents = ?, created_on = ?, posted_on = ?, counterparty_name = ?, memo = ?, status = ?, kind = ?, updated_at = datetime('now')
      WHERE id = ?`,
  ).bind(t.amount_cents, t.created_on, t.posted_on, t.counterparty_name, t.memo, t.status, t.kind, prior.id).run();
  const voided = t.status != null && VOIDED_STATUSES.includes(t.status.toLowerCase());
  if (Number(prior.amount_cents) !== t.amount_cents || voided) {
    await env.DB.prepare(
      `UPDATE mercury_matches SET state = 'needs_review', updated_at = datetime('now')
        WHERE transaction_id = ? AND state IN ('proposed', 'confirmed')`,
    ).bind(prior.id).run();
  }
  return 'updated';
}
