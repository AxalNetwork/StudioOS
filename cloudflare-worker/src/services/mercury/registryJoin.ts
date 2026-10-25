/**
 * D1184 (#3113, part 3 of #2389) — the Bank accounts registry beside Mercury.
 *
 * THE JOIN IS ENTITY AND LAST FOUR, as `checkAgainstRegistry` joins at
 * connect (D710 decision 3): a registry account and a Mercury account are the
 * same account when they belong to the same Axal entity and end in the same
 * four digits. No number is decrypted and no account number is read; the
 * registry gives its clear last four and Mercury's store gives its own.
 *
 * WHAT A MATCH CARRIES is what Fund admin shows: Current, Available and when
 * they were read (`balance_read_at`). A balance Mercury did not give is null
 * with its reason, never 0. An account with no match, or with two Mercury
 * accounts that end alike, says so in a sentence.
 *
 * Reading this is a Mercury read: the caller writes its `mercury_accounts_read`
 * audit row first (`access.ts`, decision 7) and calls nothing here when it
 * could not.
 */
import type { Env } from '../../types';
import { AXAL_ENTITIES, type AxalEntityKey } from '../legalDocFormat';

type StoredAccount = {
  uid: string; entity_key: AxalEntityKey; kind: string; last_four: string;
  current_cents: number | null; available_cents: number | null; balance_read_at: string | null; connection_status: string | null;
};

export type MercuryJoin =
  | {
    state: 'matched'; uid: string; kind: string; connected: boolean;
    current_cents: number | null; available_cents: number | null; as_of: string | null;
    /** Why a null balance is null; absent when both were read. */
    reason?: string;
  }
  | { state: 'not_matched' | 'ambiguous' | 'unreadable'; reason: string };

const nameOf = (key: string) => AXAL_ENTITIES[key as AxalEntityKey]?.name ?? key;
export const NOT_READ_YET = 'Mercury has not given this balance yet. It is read at the next sync.';
export const JOIN_UNREADABLE = 'The Mercury accounts could not be read. Try again in a moment.';

async function storedAccounts(env: Env): Promise<StoredAccount[]> {
  const r = await env.DB.prepare(
    `SELECT a.uid, a.entity_key, a.kind, a.last_four, a.current_cents, a.available_cents, a.balance_read_at, c.status AS connection_status
       FROM mercury_accounts a LEFT JOIN mercury_entity_connections c ON c.id = a.connection_id
      ORDER BY a.id`,
  ).all<StoredAccount>();
  return r.results || [];
}

/** The Mercury account each registry account joins to, keyed by the registry uid. */
export async function mercuryForRegistry(
  env: Env,
  accounts: ReadonlyArray<{ uid: string; entity_key: string; account_last4: string }>,
): Promise<Map<string, MercuryJoin>> {
  const out = new Map<string, MercuryJoin>();
  let stored: StoredAccount[];
  try {
    stored = await storedAccounts(env);
  } catch {
    for (const a of accounts) out.set(a.uid, { state: 'unreadable', reason: JOIN_UNREADABLE });
    return out;
  }
  for (const a of accounts) {
    const same = stored.filter((m) => m.entity_key === a.entity_key && m.last_four === a.account_last4);
    if (same.length > 1) {
      out.set(a.uid, { state: 'ambiguous', reason: `${same.length} Mercury accounts of ${nameOf(a.entity_key)} end in ${a.account_last4}, so none is shown.` });
      continue;
    }
    const m = same[0];
    if (!m) {
      const known = stored.some((s) => s.entity_key === a.entity_key);
      out.set(a.uid, {
        state: 'not_matched',
        reason: known
          ? `No Mercury account of ${nameOf(a.entity_key)} ends in ${a.account_last4}.`
          : `${nameOf(a.entity_key)} has no Mercury account on record, so no balance is shown.`,
      });
      continue;
    }
    const missing = m.current_cents == null || m.available_cents == null;
    out.set(a.uid, {
      state: 'matched', uid: m.uid, kind: m.kind,
      connected: Boolean(m.connection_status && m.connection_status !== 'disconnected'),
      current_cents: m.current_cents ?? null, available_cents: m.available_cents ?? null, as_of: m.balance_read_at ?? null,
      ...(missing ? { reason: NOT_READ_YET } : {}),
    });
  }
  return out;
}

/** One stored Mercury account by its uid, for the add check; null when there is none. */
export async function mercuryAccountByUid(env: Env, uid: string): Promise<{ uid: string; entity_key: string; last_four: string } | null> {
  return await env.DB.prepare('SELECT uid, entity_key, last_four FROM mercury_accounts WHERE uid = ?')
    .bind(uid).first<{ uid: string; entity_key: string; last_four: string }>() ?? null;
}
