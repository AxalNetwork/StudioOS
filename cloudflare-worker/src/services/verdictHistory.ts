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
export type VerdictObservation = VerdictState & { observed_at: string };

/**
 * How many observations a single board read will carry back per project.
 *
 * A Worker materialises the whole response in memory, and a board is read on
 * every visit to two zones. Written as a literal inside the statement rather
 * than interpolated: `scripts/check-sql-prepare.mjs` refuses any `${…}` in a
 * `DB.prepare` template, and it is right to — a constant reads the same as a
 * variable at the point the query text is built. Changes are rare per claim, so
 * 2000 is several years of a busy board and still bounded.
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
): Promise<{ byClaim: Map<number, VerdictObservation[]>; since: string | null }> {
  const byClaim = new Map<number, VerdictObservation[]>();
  if (!(await ensureVerdictHistorySchema(env))) return { byClaim, since: null };

  const res = await env.DB.prepare(
    `SELECT hypothesis_id, verdict, lane, observed_at
       FROM hypothesis_verdict_history
      WHERE project_id = ?
      ORDER BY id
      LIMIT 2000`,
  ).bind(projectId).all<VerdictObservation>().catch(() => ({ results: [] as VerdictObservation[] }));

  let since: string | null = null;
  for (const r of res.results || []) {
    const id = Number(r.hypothesis_id);
    if (!byClaim.has(id)) byClaim.set(id, []);
    byClaim.get(id)!.push({
      hypothesis_id: id,
      verdict: r.verdict ?? null,
      lane: String(r.lane),
      observed_at: String(r.observed_at),
    });
    if (since === null || String(r.observed_at) < since) since = String(r.observed_at);
  }
  return { byClaim, since };
}
