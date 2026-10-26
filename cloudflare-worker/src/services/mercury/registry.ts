/** D1184: stored Mercury facts for the bank registry. No provider call or credential read. */
import type { Env } from '../../types';
import type { ConsoleAccount } from '../entityBankAccounts';

type Refusal = { status: 400 | 404 | 409 | 503; code: string; sentence: string };

/** A strict ledger gate, before any Mercury SELECT. No request text is recorded. */
export async function auditRegistryRead(env: Env, actorId: number, sourceCheck = false): Promise<boolean> {
  try {
    const result = await env.DB.prepare(
      'INSERT INTO admin_audit_log (admin_user_id, action, filters_json) VALUES (?, ?, ?)',
    ).bind(actorId, sourceCheck ? 'bank_accounts_mercury_source_read' : 'bank_accounts_mercury_read', JSON.stringify({ source_check: sourceCheck })).run();
    return result.success && result.meta?.changes === 1;
  } catch { return false; }
}

const money = (value: number | null, readAt: string | null) => value === null
  ? { cents: null, reason: readAt ? 'unreadable' : 'not_recorded' }
  : Number.isSafeInteger(value) ? { cents: value, reason: null } : { cents: null, reason: 'unreadable' };

export const absentMercury = (reason: 'unmatched' | 'ambiguous' | 'unreadable') => ({
  account_uid: null, current: { cents: null, reason }, available: { cents: null, reason }, read_at: null, reason,
});

type StoredAccount = {
  uid: string; entity_key: string; last_four: string;
  current_cents: number | null; available_cents: number | null; balance_read_at: string | null;
};

/** Join by entity and ending, never by a cached registered flag or by ending alone. */
export async function registryMercury(env: Env, accounts: ConsoleAccount[]) {
  if (!accounts.length) return [];
  const result = await env.DB.prepare(
    `SELECT a.uid, a.entity_key, a.last_four, a.current_cents, a.available_cents, a.balance_read_at
       FROM mercury_accounts a JOIN mercury_entity_connections c ON c.id = a.connection_id AND c.entity_key = a.entity_key
       WHERE a.entity_key IN (SELECT value FROM json_each(?))`,
  ).bind(JSON.stringify([...new Set(accounts.map(a => a.entity_key))])).all<StoredAccount>();
  if (!result.success) throw new Error('mercury_unreadable');
  return accounts.map(account => {
    const matches = (result.results || []).filter(a => a.entity_key === account.entity_key && a.last_four === account.account_last4);
    if (matches.length !== 1) return absentMercury(matches.length ? 'ambiguous' : 'unmatched');
    const a = matches[0];
    return { account_uid: a.uid, current: money(a.current_cents, a.balance_read_at), available: money(a.available_cents, a.balance_read_at), read_at: a.balance_read_at, reason: null };
  });
}

/** An optional source is a stored account UID, never a provider id or a claimed ending. */
export async function checkRegistrySource(
  env: Env, uid: unknown, entity: string, last4: string, kind: string, actorId: number,
): Promise<Refusal | null> {
  if (typeof uid !== 'string' || !/^[a-f0-9]{32}$/.test(uid)) {
    return { status: 400, code: 'mercury_account_invalid', sentence: 'Choose a Mercury account from this entity.' };
  }
  if (!await auditRegistryRead(env, actorId, true)) return { status: 503, code: 'audit_unavailable', sentence: 'This read could not be recorded. Try again.' };
  try {
    const account = await env.DB.prepare(
      `SELECT a.entity_key, a.last_four, a.kind FROM mercury_accounts a
         JOIN mercury_entity_connections c ON c.id = a.connection_id AND c.entity_key = a.entity_key
         WHERE a.uid = ?`,
    ).bind(uid).first<{ entity_key: string; last_four: string; kind: string }>();
    if (!account) return { status: 404, code: 'mercury_account_not_found', sentence: 'The Mercury account could not be found. Read the accounts again.' };
    if (account.entity_key !== entity) return { status: 409, code: 'mercury_entity_mismatch', sentence: 'Choose a Mercury account held by this entity.' };
    if (account.last_four !== last4) return { status: 409, code: 'mercury_last_four_mismatch', sentence: 'The account number must end in the same four digits as the selected Mercury account.' };
    if (account.kind !== kind) return { status: 409, code: 'mercury_kind_mismatch', sentence: 'The account kind must match the selected Mercury account.' };
    return null;
  } catch { return { status: 503, code: 'mercury_unreadable', sentence: 'The Mercury account could not be read. Try again.' }; }
}
