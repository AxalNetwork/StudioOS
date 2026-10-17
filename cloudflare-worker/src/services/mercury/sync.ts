/**
 * D710 (#1775) decision 8 — the read-only sync, hourly and from HQ only.
 *
 *  - `syncAllMercuryEntityConnections` runs from the every-minute cron at
 *    minute 17, gated on `hqCadences`; on a branch it does nothing. It syncs
 *    `active` connections only: a connection turned `error` by a 401 or 403
 *    waits until a Super Admin replaces its token.
 *  - One run at a time per connection: a `running` run younger than ten
 *    minutes makes another answer `sync_in_progress`.
 *  - The first sync of an account reads from 1 January of the previous year.
 *    Later ones read from a watermark: the earlier of the latest stored
 *    creation date minus ten days and the oldest pending line's date.
 *    UNVERIFIED: that Mercury's `start` filter is on the creation date.
 *  - Pages are read oldest first, at most 2,000 lines per connection per run.
 *    A run that stops at the cap records `partial`; the next run continues
 *    from the watermark, so nothing is skipped.
 *  - A run row holds ids, counts and a code, never a body (`D684.md:272`).
 *  - The matchers run after each sync.
 */
import type { Env } from '../../types';
import { branchOf } from '../../util/branch';
import { listAccounts, listTransactions, MercuryClientError, type MercuryFetch } from './client';
import { parseAccounts, parseTransactions } from './parse';
import {
  connectionById, decryptToken, liveConnections, markConnection, registryRows, upsertAccounts, upsertTransaction,
  type AccountRow, type ConnectionRow,
} from './store';
import { proposeMatches, type MatchDeps } from './match';

export const RUN_CAP = 2000;
export const PAGE_SIZE = 500;
export const RUNNING_STALE_MINUTES = 10;
export const WATERMARK_BACK_DAYS = 10;

export type SyncTrigger = 'cron' | 'connect' | 'manual';
export type SyncOutcome =
  | { status: 'ok' | 'partial'; run_id: number; accounts: number; seen: number; stored: number; refused: number }
  | { status: 'error'; run_id: number | null; code: string }
  | { status: 'sync_in_progress' };

export interface SyncDeps { fetcher?: MercuryFetch; match?: Partial<MatchDeps>; now?: Date }

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Where an account's next read starts (decision 8). */
export async function watermarkFor(env: Env, account: Pick<AccountRow, 'id'>, now: Date): Promise<string> {
  const r = await env.DB.prepare(
    `SELECT MAX(created_on) AS latest,
            MIN(CASE WHEN posted_on IS NULL THEN created_on END) AS oldest_pending
       FROM mercury_transactions WHERE account_id = ?`,
  ).bind(account.id).first<{ latest: string | null; oldest_pending: string | null }>();
  if (!r?.latest) return `${now.getUTCFullYear() - 1}-01-01`;
  const back = new Date(`${r.latest}T00:00:00Z`);
  back.setUTCDate(back.getUTCDate() - WATERMARK_BACK_DAYS);
  const fromLatest = day(back);
  return r.oldest_pending && r.oldest_pending < fromLatest ? r.oldest_pending : fromLatest;
}

async function startRun(env: Env, conn: ConnectionRow, trigger: SyncTrigger): Promise<number | null> {
  const busy = await env.DB.prepare(
    `SELECT 1 AS busy FROM mercury_sync_runs
      WHERE connection_id = ? AND status = 'running' AND started_at > datetime('now', ?)`,
  ).bind(conn.id, `-${RUNNING_STALE_MINUTES} minutes`).first<{ busy: number }>();
  if (busy) return null;
  const r = await env.DB.prepare(
    "INSERT INTO mercury_sync_runs (connection_id, trigger, status) VALUES (?, ?, 'running')",
  ).bind(conn.id, trigger).run();
  return Number(r.meta?.last_row_id);
}

async function finishRun(env: Env, runId: number, status: 'ok' | 'partial' | 'error',
  counts: { accounts: number; seen: number; stored: number; refused: number }, code: string | null): Promise<void> {
  await env.DB.prepare(
    `UPDATE mercury_sync_runs
        SET status = ?, finished_at = datetime('now'), accounts_seen = ?, transactions_seen = ?,
            transactions_stored = ?, refused_count = ?, error_code = ?
      WHERE id = ?`,
  ).bind(status, counts.accounts, counts.seen, counts.stored, counts.refused, code, runId).run();
}

/** One connection's sync. Never throws: a failure is the run's code. */
export async function syncConnection(env: Env, connectionId: number, trigger: SyncTrigger, deps: SyncDeps = {}): Promise<SyncOutcome> {
  const conn = await connectionById(env, connectionId);
  if (!conn || conn.status === 'disconnected') return { status: 'error', run_id: null, code: 'not_connected' };
  const runId = await startRun(env, conn, trigger);
  if (runId == null) return { status: 'sync_in_progress' };
  const counts = { accounts: 0, seen: 0, stored: 0, refused: 0 };
  const now = deps.now ?? new Date();
  try {
    const token = await decryptToken(env, conn);
    if (!token) {
      // A token that does not decrypt stops only its own connection.
      await markConnection(env, conn, { status: 'error', error: 'token_unreadable' });
      await finishRun(env, runId, 'error', counts, 'token_unreadable');
      return { status: 'error', run_id: runId, code: 'token_unreadable' };
    }
    const parsed = parseAccounts(await listAccounts(token, deps.fetcher));
    counts.accounts = parsed.accounts.length;
    const registry = await registryRows(env).catch(() => null);
    const mine = registry == null ? null
      : new Set(parsed.accounts.filter((a) => registry.some((r) => r.entity_key === conn.entity_key && r.last_four === a.last_four)).map((a) => a.mercury_account_id));
    const accounts = await upsertAccounts(env, conn, parsed.accounts, mine);
    let partial = false;
    for (const account of accounts) {
      if (partial) break;
      const start = await watermarkFor(env, account, now);
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const room = RUN_CAP - counts.seen;
        if (room <= 0) { partial = true; break; }
        const page = parseTransactions(await listTransactions(token, account.mercury_account_id,
          { start, limit: Math.min(PAGE_SIZE, room), offset }, deps.fetcher));
        counts.refused += page.refused;
        for (const t of page.transactions) {
          counts.seen += 1;
          if ((await upsertTransaction(env, account, t)) !== 'unchanged') counts.stored += 1;
        }
        const got = page.transactions.length + page.refused;
        if (got < Math.min(PAGE_SIZE, room)) break;
        if (counts.seen >= RUN_CAP) { partial = true; break; }
      }
    }
    const status = partial ? 'partial' : 'ok';
    await finishRun(env, runId, status, counts, null);
    await markConnection(env, conn, { status: 'active', error: null, synced: true });
    await proposeMatches(env, deps.match);
    return { status, run_id: runId, ...counts };
  } catch (e) {
    const code = e instanceof MercuryClientError ? e.code : 'sync_failed';
    // 401/403: the connection turns `error` and the cron skips it until a
    // Super Admin replaces the token. 429 and a timeout keep it active.
    await markConnection(env, conn, { status: code === 'unauthorized' ? 'error' : 'active', error: code });
    await finishRun(env, runId, 'error', counts, code);
    if (!(e instanceof MercuryClientError)) console.error('[mercury] sync failed', conn.entity_key, (e as Error)?.name);
    return { status: 'error', run_id: runId, code };
  }
}

/** The hourly sweep. HQ only: on a branch it does nothing. */
export async function syncAllMercuryEntityConnections(env: Env, deps: SyncDeps = {}): Promise<{ scanned: number; ok: number; failed: number }> {
  const out = { scanned: 0, ok: 0, failed: 0 };
  if (branchOf(env)) return out;
  for (const conn of await liveConnections(env)) {
    if (conn.status !== 'active') continue;
    out.scanned += 1;
    const r = await syncConnection(env, conn.id, 'cron', deps);
    if (r.status === 'ok' || r.status === 'partial') out.ok += 1; else out.failed += 1;
  }
  return out;
}
