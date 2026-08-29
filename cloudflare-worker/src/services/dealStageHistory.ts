/**
 * Deal Flow — append-only stage history.
 *
 * `deals.stage_changed_at` records only the CURRENT stage's entry time. That
 * is enough to colour a card by how long it has been sitting, and not enough
 * for any question an investment committee actually asks: of the deals that
 * entered screening this quarter, how many advanced? How long does a deal
 * really spend in diligence? Both need the transitions, and the transitions
 * were being overwritten.
 *
 * One row per move fixes that going forward. It cannot fix it backwards —
 * there is no way to reconstruct moves nobody recorded — so
 * `stageRecordingStartedAt` exists and the analytics endpoint reports it
 * rather than presenting a partial history as a complete one.
 *
 * Canonical migration: 176_deal_pass_taxonomy.sql.
 */
import type { Env } from '../types';

const READY = new WeakMap<object, boolean>();

/**
 * `REFERENCES users(id)` is dropped from the bootstrap DDL: SQLite refuses to
 * ALTER a column with a foreign-key clause onto an existing table except as
 * nullable-with-NULL-default, and the constraint buys nothing here that the
 * migration does not already establish on a fresh database. The CHECK is
 * kept — it is the part that stops an off-taxonomy value reaching the column
 * if a future caller ever bypasses the route's validation.
 */
const PASS_COLUMNS: Array<[string, string]> = [
  [
    'pass_reason',
    `TEXT CHECK (pass_reason IS NULL OR pass_reason IN ('early','valuation','thesis','team','competitive'))`,
  ],
  ['pass_note', 'TEXT'],
  ['passed_at', 'TEXT'],
  ['passed_by_user_id', 'INTEGER'],
];

const STAGE_EVENTS_DDL = `
CREATE TABLE IF NOT EXISTS deal_stage_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_id       INTEGER NOT NULL,
    from_stage    TEXT,
    to_stage      TEXT NOT NULL,
    kind          TEXT NOT NULL DEFAULT 'set' CHECK (kind IN ('advance','pass','set')),
    days_in_from  INTEGER,
    actor_user_id INTEGER,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
)`;

async function passColumnsPresent(env: Env): Promise<boolean> {
  const info = await env.DB.prepare(`PRAGMA table_info(deals)`).all<{ name: string }>();
  const have = new Set((info.results || []).map((r) => r.name));
  return PASS_COLUMNS.every(([col]) => have.has(col));
}

/**
 * Lazy schema bootstrap, same caching rules as services/fundGpSchema.ts:
 * cached per isolate ONLY on success, so a failed ALTER is never remembered as
 * "ready" — otherwise every later request in that isolate skips the PRAGMA and
 * dies with a raw `no such column` that mapError echoes to the client as a 400.
 */
export async function ensureDealPassSchema(env: Env): Promise<boolean> {
  const key = env.DB as unknown as object;
  if (READY.get(key)) return true;
  try {
    const info = await env.DB.prepare(`PRAGMA table_info(deals)`).all<{ name: string }>();
    const have = new Set((info.results || []).map((r) => r.name));
    let altered = false;
    for (const [col, ddl] of PASS_COLUMNS) {
      if (have.has(col)) continue;
      altered = true;
      // The column is KNOWN absent here, so a failure is a real bootstrap
      // failure. Still swallowed so one bad column cannot abort the others;
      // readiness is re-verified below.
      try { await env.DB.prepare(`ALTER TABLE deals ADD COLUMN ${col} ${ddl}`).run(); }
      catch (e) { console.warn('[dealStageHistory] ALTER failed for column', col, e); }
    }
    try {
      await env.DB.prepare(STAGE_EVENTS_DDL).run();
      await env.DB.prepare(
        `CREATE INDEX IF NOT EXISTS idx_deal_stage_events_deal ON deal_stage_events(deal_id, created_at)`,
      ).run();
      await env.DB.prepare(
        `CREATE INDEX IF NOT EXISTS idx_deal_stage_events_to ON deal_stage_events(to_stage, created_at)`,
      ).run();
    } catch (e) { console.warn('[dealStageHistory] deal_stage_events bootstrap failed', e); }

    const ok = altered ? await passColumnsPresent(env) : true;
    if (ok) READY.set(key, true);
    else console.warn('[dealStageHistory] pass columns still missing after bootstrap');
    return ok;
  } catch (e) {
    console.warn('[dealStageHistory] bootstrap failed', e);
    return false;
  }
}

/** SQLite `datetime('now')` yields 'YYYY-MM-DD HH:MM:SS' UTC — parse it as UTC. */
function normTs(s: any): number | null {
  if (!s) return null;
  const raw = String(s);
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z';
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

export function daysBetween(fromTs: any, now = Date.now()): number | null {
  const ref = normTs(fromTs);
  if (ref === null) return null;
  const d = Math.floor((now - ref) / 86_400_000);
  return d > 0 ? d : 0;
}

export interface StageEventInput {
  dealId: number;
  /** The stage the deal is leaving. NULL only when it was never recorded. */
  fromStage: string | null;
  /**
   * The deal's `stage_changed_at` AS IT READS BEFORE the update — the update
   * that accompanies this event overwrites it, so a caller that writes first
   * and records second measures zero days for every transition. Callers read
   * the row, call this, then update.
   */
  fromStageChangedAt: string | null;
  toStage: string;
  kind: 'advance' | 'pass' | 'set';
  actorUserId: number | null;
}

/**
 * Append one transition. Best-effort by design: a deal that moved but whose
 * history row failed to write is a lesser failure than a move rejected because
 * its bookkeeping failed, and the caller has already told the founder.
 * Returns whether the row landed so tests can assert on it.
 */
export async function recordStageEvent(sql: any, ev: StageEventInput): Promise<boolean> {
  try {
    const days = ev.fromStage ? daysBetween(ev.fromStageChangedAt) : null;
    await sql`
      INSERT INTO deal_stage_events (deal_id, from_stage, to_stage, kind, days_in_from, actor_user_id)
      VALUES (${ev.dealId}, ${ev.fromStage}, ${ev.toStage}, ${ev.kind}, ${days}, ${ev.actorUserId})`;
    return true;
  } catch (e) {
    console.warn('[dealStageHistory] stage event not recorded', e);
    return false;
  }
}

/**
 * When this table started collecting, or null if it never has. Every analytics
 * answer derived from stage history is scoped by this: reporting a conversion
 * rate without saying the history only goes back three weeks is how a partial
 * dataset gets read as a complete one.
 */
export async function stageRecordingStartedAt(sql: any): Promise<string | null> {
  try {
    const rows = await sql`SELECT MIN(created_at) AS started FROM deal_stage_events`;
    return (rows?.[0] as any)?.started ?? null;
  } catch {
    return null;
  }
}
