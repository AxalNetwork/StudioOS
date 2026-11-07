/**
 * The one thing the hypothesis board could never answer: what it used to say.
 *
 * A claim's verdict is `verdictFor(evidenceFor(links, interviews))` — derived on
 * every request, stored nowhere. That is deliberate and stays true: storing the
 * current verdict would be a second answer to a question the interviews already
 * answer, and the two part company the first time an interview is edited. What
 * was missing is the OTHER kind of store, an append-only record of what the
 * derived value has BEEN, which is what `/validate/verdict`'s `As of last week`
 * and `Changed this month` and `/validate/hypotheses`' `Recently moved` are
 * asking for. Migration 255 is that store; this file is its writer and reader.
 *
 * WRITTEN ON READ, WHICH IS A DEPARTURE WORTH STATING PLAINLY. The plan for this
 * said to instrument the evidence-write path instead. There is no such path —
 * singular. `evidenceFor` reads `hypothesis_pain_links` AND every interview's
 * `icp_fit` AND which pain groups each interview's `pains_json` resolves to
 * through `pain_group_aliases`. So a verdict moves on a link insert, a link
 * delete, an ICP-fit patch, a newly logged interview, an edited pains blob and a
 * pain-tag re-grouping — six writers across three route files today, and the
 * failure mode of missing one is SILENT: that path produces no history, and a
 * history with a hole in it looks exactly like a history without one.
 *
 * So it follows `trust_score_snapshots` instead, which solved the same problem
 * the same way: pull-based, idempotent, written only by the read that needs it
 * (`recordAndCompareScore`, called only by `GET /trust/me`). The cost is stated
 * rather than hidden — a board nobody opens records nothing, so `since` is
 * returned and the page says when the history starts.
 *
 * IT IS NOT `seedObligations`, and the difference is the whole reason this is
 * acceptable on a read. That one performs an unconditional UPDATE plus one
 * upsert per obligation definition on every call. This performs ONE SELECT, and
 * writes only when a recomputed pair differs from the last row — zero statements
 * in the steady state, which is almost every request.
 */
import type { Env } from '../types';
import { bindingKey } from '../util/schemaBootstrap';

/**
 * Migration 255's table, bootstrapped at runtime like its siblings.
 *
 * Keyed on the binding rather than a module-level boolean, for the reason #203
 * found and D95 recorded: a module is instantiated once per ISOLATE, not once
 * per database, so a `let ready = false` lets the first database to bootstrap
 * mark the job done for every other database the same isolate goes on to serve.
 */
const READY = new WeakMap<object, boolean>();

export async function ensureVerdictHistorySchema(env: Env): Promise<boolean> {
  const key = bindingKey(env);
  if (READY.get(key)) return true;
  try {
    await env.DB.exec(
      'CREATE TABLE IF NOT EXISTS hypothesis_verdict_history ('
      + 'id INTEGER PRIMARY KEY AUTOINCREMENT, '
      + 'project_id INTEGER NOT NULL, '
      + 'hypothesis_id INTEGER NOT NULL, '
      + 'verdict TEXT, '
      + 'lane TEXT NOT NULL, '
      + "observed_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    await env.DB.exec(
      'CREATE INDEX IF NOT EXISTS idx_hypothesis_verdict_history_project'
      + ' ON hypothesis_verdict_history(project_id, observed_at)',
    );
    await env.DB.exec(
      'CREATE INDEX IF NOT EXISTS idx_hypothesis_verdict_history_claim'
      + ' ON hypothesis_verdict_history(hypothesis_id, id)',
    );
    // Cached only on success. A failed bootstrap remembered as ready is how a
    // table that never got created stays missing for the life of the isolate.
    READY.set(key, true);
    return true;
  } catch (e) {
    console.error('[verdictHistory] ensureVerdictHistorySchema:', (e as Error).message);
    return false;
  }
}

/** One claim's state, as the board just computed it. */
export type VerdictState = {
  hypothesis_id: number;
  verdict: string | null;
  lane: string;
};

/** One recorded observation. */
export type VerdictObservation = VerdictState & { id: number; observed_at: string };

export type VerdictHistoryCoverage = {
  status: 'complete' | 'partial' | 'unavailable';
  /** Oldest instant in the newest contiguous slice returned to the caller. */
  since: string | null;
  /** Oldest observation recorded for the project, even when the middle is omitted. */
  recorded_since: string | null;
  through: string | null;
  limit: number;
  boundaries: string[];
};

export type VerdictHistoryOptions = {
  /** Current claims whose latest and requested boundary states must be retained. */
  claimIds?: number[];
  /** Exact as-of instants the caller needs, bounded below. */
  boundaries?: Date[];
};

const HISTORY_LIMIT = 2000;
const BOUNDARY_LIMIT = 4;
const CLAIM_LIMIT = 2000;

const unavailableCoverage = (): VerdictHistoryCoverage => ({
  status: 'unavailable', since: null, recorded_since: null, through: null,
  limit: HISTORY_LIMIT, boundaries: [],
});

const sqlInstant = (d: Date): string => d.toISOString().replace('T', ' ').slice(0, 19);

type StoredObservation = VerdictObservation;

/** One state per requested claim at or before a temporal boundary. */
async function boundaryRows(env: Env, projectId: number, claimIds: number[], at: string): Promise<StoredObservation[]> {
  if (!claimIds.length) return [];
  const res = await env.DB.prepare(
    `WITH wanted(id) AS (
       SELECT CAST(value AS INTEGER) FROM json_each(?)
     ), ranked AS (
       SELECT h.id, h.hypothesis_id, h.verdict, h.lane, h.observed_at,
              ROW_NUMBER() OVER (PARTITION BY h.hypothesis_id ORDER BY h.observed_at DESC, h.id DESC) AS rn
         FROM hypothesis_verdict_history h
         JOIN wanted w ON w.id = h.hypothesis_id
        WHERE h.project_id = ? AND h.observed_at <= ?
     )
     SELECT id, hypothesis_id, verdict, lane, observed_at
       FROM ranked WHERE rn = 1 ORDER BY observed_at, id
      LIMIT 2000`,
  ).bind(JSON.stringify(claimIds), projectId, at).all<StoredObservation>();
  return res.results || [];
}

/** One state per requested claim immediately before a retained `(time, id)`. */
async function predecessorRows(
  env: Env, projectId: number, claimIds: number[], observedAt: string, rowId: number,
): Promise<StoredObservation[]> {
  if (!claimIds.length) return [];
  const res = await env.DB.prepare(
    `WITH wanted(id) AS (
       SELECT CAST(value AS INTEGER) FROM json_each(?)
     ), ranked AS (
       SELECT h.id, h.hypothesis_id, h.verdict, h.lane, h.observed_at,
              ROW_NUMBER() OVER (PARTITION BY h.hypothesis_id ORDER BY h.observed_at DESC, h.id DESC) AS rn
         FROM hypothesis_verdict_history h
         JOIN wanted w ON w.id = h.hypothesis_id
        WHERE h.project_id = ?
          AND (h.observed_at < ? OR (h.observed_at = ? AND h.id < ?))
     )
     SELECT id, hypothesis_id, verdict, lane, observed_at
       FROM ranked WHERE rn = 1 ORDER BY observed_at, id
      LIMIT 2000`,
  ).bind(JSON.stringify(claimIds), projectId, observedAt, observedAt, rowId).all<StoredObservation>();
  return res.results || [];
}

/**
 * How many contiguous recent observations a single board read carries back.
 *
 * A Worker materialises the whole response in memory, and a board is read on
 * every visit to two zones. Written as a literal inside the statement rather
 * than interpolated: `scripts/check-sql-prepare.mjs` refuses any `${…}` in a
 * `DB.prepare` template, and it is right to — a constant reads the same as a
 * variable at the point the query text is built. Changes are rare per claim, so
 * 2000 is several years of a busy board and still bounded. D4629 may add one
 * predecessor/latest/boundary state per requested claim; those inputs and
 * every materialised query are capped separately above.
 */

/**
 * Record the claims whose `{verdict, lane}` differs from their last observation.
 *
 * Returns the number of rows written, which is 0 on almost every call — that is
 * the point, and it is what makes this safe to run from a read.
 */
export async function recordVerdictChanges(
  env: Env,
  projectId: number,
  states: VerdictState[],
): Promise<number> {
  if (!states.length) return 0;
  if (!(await ensureVerdictHistorySchema(env))) return 0;

  // The latest row per claim, in one query. Joining on MAX(id) rather than
  // MAX(observed_at): two observations can share a second, and `id` is the only
  // total order this table has.
  const latest = await env.DB.prepare(
    `SELECT h.hypothesis_id, h.verdict, h.lane
       FROM hypothesis_verdict_history h
       JOIN (SELECT hypothesis_id, MAX(id) AS id
               FROM hypothesis_verdict_history
              WHERE project_id = ?
              GROUP BY hypothesis_id) m ON m.id = h.id`,
  ).bind(projectId).all<{ hypothesis_id: number; verdict: string | null; lane: string }>()
    .catch(() => ({ results: [] as any[] }));

  const last = new Map<number, { verdict: string | null; lane: string }>();
  for (const r of latest.results || []) {
    last.set(Number(r.hypothesis_id), { verdict: r.verdict ?? null, lane: String(r.lane) });
  }

  let written = 0;
  for (const s of states) {
    const prev = last.get(s.hypothesis_id);
    // A claim with no row yet is a change — its first observation. Comparing
    // `verdict` with `??  null` on both sides so a stored NULL and a computed
    // `undefined` are the same "we did not know yet" rather than a difference
    // that writes a row on every read.
    const same = prev
      && (prev.verdict ?? null) === (s.verdict ?? null)
      && prev.lane === s.lane;
    if (same) continue;
    await env.DB.prepare(
      `INSERT INTO hypothesis_verdict_history (project_id, hypothesis_id, verdict, lane)
       VALUES (?, ?, ?, ?)`,
    ).bind(projectId, s.hypothesis_id, s.verdict ?? null, s.lane).run().catch(() => null);
    written += 1;
  }
  return written;
}

/**
 * Every observation this project has on record, oldest first, plus when the
 * record starts.
 *
 * `since` is null when nothing has ever been observed, and the page must say so
 * rather than drawing an empty "changed this month" as if it were an answer —
 * the same rule `/build/this-week` follows for its own un-backfilled log.
 */
export async function loadVerdictHistory(
  env: Env,
  projectId: number,
  options: VerdictHistoryOptions = {},
): Promise<{ byClaim: Map<number, VerdictObservation[]>; since: string | null; coverage: VerdictHistoryCoverage }> {
  const byClaim = new Map<number, VerdictObservation[]>();
  if (!(await ensureVerdictHistorySchema(env))) return { byClaim, since: null, coverage: unavailableCoverage() };

  const ids = [...new Set((options.claimIds || []).filter((id) => Number.isSafeInteger(id) && id > 0))];
  const wanted = ids.slice(0, CLAIM_LIMIT);
  const boundaries = [...new Set((options.boundaries || [])
    .filter((d) => d instanceof Date && !Number.isNaN(d.getTime()))
    .map(sqlInstant))].slice(0, BOUNDARY_LIMIT);

  try {
    // D4629: newest temporal slice, with one look-ahead row solely to report
    // truncation. The outer order restores the oldest-first contract consumed
    // by observationAt/changedWithin. `id` breaks same-second ties.
    const recent = await env.DB.prepare(
      `SELECT id, hypothesis_id, verdict, lane, observed_at FROM (
         SELECT id, hypothesis_id, verdict, lane, observed_at
           FROM hypothesis_verdict_history
          WHERE project_id = ?
          ORDER BY observed_at DESC, id DESC
          LIMIT 2001
       ) ORDER BY observed_at, id`,
    ).bind(projectId).all<StoredObservation>();
    const fetched = recent.results || [];
    const truncated = fetched.length > HISTORY_LIMIT;
    const slice = truncated ? fetched.slice(fetched.length - HISTORY_LIMIT) : fetched;
    const firstRecorded = await env.DB.prepare(
      `SELECT observed_at FROM hypothesis_verdict_history
        WHERE project_id = ? ORDER BY observed_at, id LIMIT 1`,
    ).bind(projectId).first<{ observed_at: string }>();

    const merged = new Map<number, StoredObservation>();
    for (const row of slice) merged.set(Number(row.id), row);

    // Keep the state immediately before the retained slice. Without it, a
    // change on the first retained row looks like a claim's first observation.
    if (truncated && wanted.length && slice.length) {
      const oldest = slice[0];
      const prior = await predecessorRows(env, projectId, wanted, String(oldest.observed_at), Number(oldest.id));
      for (const row of prior) merged.set(Number(row.id), row);
    }

    // A quiet claim can fall outside a busy project's newest slice. Retain its
    // latest state, and the exact state at each requested as-of boundary.
    for (const at of ['9999-12-31 23:59:59', ...boundaries]) {
      for (const row of await boundaryRows(env, projectId, wanted, at)) merged.set(Number(row.id), row);
    }

    const ordered = [...merged.values()].sort((a, b) =>
      String(a.observed_at).localeCompare(String(b.observed_at)) || Number(a.id) - Number(b.id));
    for (const r of ordered) {
      const claimId = Number(r.hypothesis_id);
      if (!byClaim.has(claimId)) byClaim.set(claimId, []);
      byClaim.get(claimId)!.push({
        id: Number(r.id), hypothesis_id: claimId, verdict: r.verdict ?? null,
        lane: String(r.lane), observed_at: String(r.observed_at),
      });
    }

    const since = slice.length ? String(slice[0].observed_at) : null;
    const coverage: VerdictHistoryCoverage = {
      status: truncated || ids.length > CLAIM_LIMIT || (options.boundaries || []).length > BOUNDARY_LIMIT ? 'partial' : 'complete',
      since,
      recorded_since: firstRecorded?.observed_at ? String(firstRecorded.observed_at) : null,
      through: slice.length ? String(slice[slice.length - 1].observed_at) : null,
      limit: HISTORY_LIMIT,
      boundaries,
    };
    return { byClaim, since, coverage };
  } catch (e) {
    console.error('[verdictHistory] loadVerdictHistory:', (e as Error).message);
    return { byClaim, since: null, coverage: unavailableCoverage() };
  }
}

/** Whether every transition since `at` is present in the contiguous slice. */
export function historyChangesAvailable(coverage: VerdictHistoryCoverage, at: Date): boolean {
  if (coverage.status === 'unavailable') return false;
  // A complete recorded history may itself have begun inside the requested
  // window; its first row is not counted as a change, and every later pair is
  // still available. Only a truncated middle creates an unknown transition.
  if (coverage.status === 'complete') return coverage.since != null;
  const start = parseObserved(coverage.since);
  return !!(start && start.getTime() <= at.getTime());
}

// ---------------------------------------------------------------------------
// D690 decision 16 — the three rules FVW's views read, ported from
// `frontend/src/lib/verdictHistory.js` with their rules, so the module read
// answers `Recently moved`, `As of last week` and `Changed this month` itself.
// ---------------------------------------------------------------------------

/** "Recently moved", in days: FVW's window (`frontend/src/lib/verdictHistory.js`). */
export const RECENTLY_MOVED_DAYS = 14;

/** SQLite's `datetime('now')` is UTC with a space. Parse, never compare raw. */
export function parseObserved(value: unknown): Date | null {
  if (!value) return null;
  const s = String(value);
  const iso = s.includes('T') ? s : `${s.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The observation in force at `at`, or null when the record starts later. */
export function observationAt<T extends { observed_at: string }>(history: T[] | null | undefined, at: Date): T | null {
  let found: T | null = null;
  for (const o of history || []) {
    const when = parseObserved(o.observed_at);
    if (!when || when.getTime() > at.getTime()) continue;
    found = o; // oldest first, so the last match wins
  }
  return found;
}

/**
 * True when `field` changed between two adjacent observations and the later
 * one is on or after `since`. The first observation is the claim appearing
 * on the record, never a change.
 */
export function changedWithin(history: VerdictObservation[] | null | undefined, since: Date, field: 'verdict' | 'lane'): boolean {
  const h = history || [];
  for (let i = 1; i < h.length; i += 1) {
    if ((h[i][field] ?? null) === (h[i - 1][field] ?? null)) continue;
    const when = parseObserved(h[i].observed_at);
    if (when && when.getTime() >= since.getTime()) return true;
  }
  return false;
}
