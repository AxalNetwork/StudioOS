/**
 * D1256 (#3279) — the scorecard's three jobs (#2428 § Jobs).
 *
 *   · NIGHTLY: the listed ventures and those already scored are recomputed,
 *     the longest unscored first, a bounded batch a night. `scoreVenture`
 *     writes a scope only when what it rests on changed, so a quiet venture
 *     writes nothing.
 *   · AFTER A CONNECTOR SYNC: a venture whose people's connector synced after
 *     its latest scorecard row is recomputed with trigger `sync`. Each provider
 *     stamps `integrations.last_synced_at` when its sync ends; this sweep reads
 *     that stamp, so no provider's code changes and none is missed.
 *   · QUARTERLY: the fairness check for HQ (bias guard 9). Each scope's mean
 *     value and confidence by stage, sector, solo or team, and connector use,
 *     aggregates only. A cell of fewer than five ventures is suppressed. A
 *     group whose mean differs from all ventures' by more than the gap opens a
 *     model review, which the run lists.
 *
 * The jobs run with no person behind them: rows carry no actor, and the audit
 * names `system:nightly` or `system:sync`. Logs carry counts only.
 */
import type { Env } from '../../types';
import { SCOPE_ORDER, VENTURE_MODEL_V1 } from './model';
import { scoreVenture } from './store';

export const NIGHTLY_LIMIT = 50;
export const SYNC_LIMIT = 20;
/** Fewer ventures than this in a cell and its figures are not shown. */
export const FAIRNESS_MIN_CELL = 5;
/** A group's mean value this many points from all ventures', or confidence this far, opens a model review. */
export const FAIRNESS_GAP = { value: 15, confidence: 0.2 } as const;

export const JOB_STATEMENTS = {
  nightly: `SELECT p.id FROM projects p
     WHERE p.deleted_at IS NULL
       AND (EXISTS (SELECT 1 FROM deals d WHERE d.project_id = p.id)
            OR EXISTS (SELECT 1 FROM venture_scorecards s WHERE s.project_id = p.id))
     ORDER BY COALESCE((SELECT MAX(s.computed_at) FROM venture_scorecards s WHERE s.project_id = p.id AND s.scope <> 'pmf'), '') ASC, p.id ASC
     LIMIT ?`,
  synced: `WITH people(project_id, user_id) AS (
       SELECT p.id, u.id FROM projects p JOIN users u ON u.founder_id = p.founder_id
        WHERE p.founder_id IS NOT NULL AND p.deleted_at IS NULL
       UNION
       SELECT pm.project_id, pm.user_id FROM project_members pm WHERE pm.status = 'accepted' AND pm.removed_at IS NULL
     ),
     synced(project_id, at) AS (
       SELECT people.project_id, MAX(datetime(i.last_synced_at)) FROM people
         JOIN integrations i ON i.user_id = people.user_id
        WHERE i.last_synced_at IS NOT NULL AND i.status = 'active'
        GROUP BY people.project_id
     )
     SELECT synced.project_id AS id FROM synced
      WHERE EXISTS (SELECT 1 FROM venture_scorecards s WHERE s.project_id = synced.project_id)
        AND synced.at > COALESCE((SELECT MAX(datetime(s.computed_at)) FROM venture_scorecards s
                                   WHERE s.project_id = synced.project_id AND s.scope <> 'pmf'), '')
      ORDER BY synced.at ASC LIMIT ?`,
  fairnessRows: `WITH latest AS (
       SELECT s.project_id, s.scope, s.value, s.confidence, s.state FROM venture_scorecards s
        WHERE s.id = (SELECT MAX(x.id) FROM venture_scorecards x WHERE x.project_id = s.project_id AND x.scope = s.scope)
     ),
     team AS (
       SELECT p.id AS project_id,
              (SELECT COUNT(*) FROM users u WHERE p.founder_id IS NOT NULL AND u.founder_id = p.founder_id AND u.is_active = 1)
            + (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id AND pm.status = 'accepted' AND pm.removed_at IS NULL
                 AND pm.role <> 'advisor') AS people,
              EXISTS (SELECT 1 FROM integrations i
                       WHERE i.status = 'active' AND i.user_id IN (
                         SELECT u.id FROM users u WHERE p.founder_id IS NOT NULL AND u.founder_id = p.founder_id
                         UNION SELECT pm.user_id FROM project_members pm WHERE pm.project_id = p.id AND pm.status = 'accepted'
                       )) AS connected
         FROM projects p WHERE p.deleted_at IS NULL
     )
     SELECT l.project_id, l.scope, l.value, l.confidence, l.state,
            COALESCE(p.lifecycle_stage, '') AS stage, COALESCE(p.sector, '') AS sector,
            t.people, t.connected
       FROM latest l JOIN projects p ON p.id = l.project_id AND p.deleted_at IS NULL
       JOIN team t ON t.project_id = l.project_id`,
  saveFairness: `INSERT OR IGNORE INTO venture_score_fairness (quarter, model_version, aggregate_json, computed_at) VALUES (?, ?, ?, ?)`,
  latestFairness: 'SELECT quarter, model_version, aggregate_json, computed_at FROM venture_score_fairness ORDER BY quarter DESC LIMIT 1',
} as const;

async function recomputeEach(env: Env, ids: number[], trigger: 'nightly' | 'sync', today: string) {
  let scored = 0, failed = 0;
  for (const id of ids) {
    try { await scoreVenture(env, id, { actorId: null, trigger, today }); scored++; }
    catch { failed++; }
  }
  return { ventures: ids.length, scored, failed };
}

export async function nightlyRecompute(env: Env, now = new Date(), limit = NIGHTLY_LIMIT) {
  const rows = await env.DB.prepare(JOB_STATEMENTS.nightly).bind(limit).all<{ id: number }>();
  return recomputeEach(env, (rows.results || []).map((r) => Number(r.id)), 'nightly', now.toISOString().slice(0, 10));
}

export async function syncRecompute(env: Env, now = new Date(), limit = SYNC_LIMIT) {
  const rows = await env.DB.prepare(JOB_STATEMENTS.synced).bind(limit).all<{ id: number }>();
  return recomputeEach(env, (rows.results || []).map((r) => Number(r.id)), 'sync', now.toISOString().slice(0, 10));
}

export function quarterOf(d: Date): string {
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

/** The quarter just ended, for a run on the first day of the next. */
export function previousQuarter(d: Date): string {
  const back = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 3, 1));
  return quarterOf(back);
}

type Row = { project_id: number; scope: string; value: number | null; confidence: number; state: string | null;
  stage: string; sector: string; people: number; connected: number };

const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);

/** The aggregate, from the latest row of each scope per venture. Nothing personal: groups and figures over groups. */
export function aggregate(rows: readonly Row[]) {
  const dims: Record<string, (r: Row) => string> = {
    stage: (r) => r.stage || 'Not recorded',
    sector: (r) => r.sector || 'Not recorded',
    team: (r) => (Number(r.people) > 1 ? 'Team' : 'Solo'),
    connectors: (r) => (Number(r.connected) ? 'Uses a connector' : 'No connector'),
  };
  const cell = (rs: Row[]) => {
    const ventures = new Set(rs.map((r) => r.project_id)).size;
    if (ventures < FAIRNESS_MIN_CELL) return { ventures, suppressed: true, scored: null, value: null, confidence: null };
    const scored = rs.filter((r) => r.value != null);
    return { ventures, suppressed: false, scored: scored.length, value: mean(scored.map((r) => Number(r.value))),
      confidence: mean(rs.map((r) => Number(r.confidence))) };
  };
  const scopes: Record<string, unknown> = {};
  const gaps: Array<{ scope: string; dimension: string; group: string; value_gap: number | null; confidence_gap: number | null }> = [];
  for (const scope of SCOPE_ORDER) {
    const rs = rows.filter((r) => r.scope === scope);
    const all = cell(rs);
    const byDim: Record<string, Record<string, ReturnType<typeof cell>>> = {};
    for (const [dim, keyOf] of Object.entries(dims)) {
      const groups = new Map<string, Row[]>();
      for (const r of rs) groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), r]);
      byDim[dim] = {};
      for (const [g, grs] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const c = cell(grs);
        byDim[dim][g] = c;
        if (c.suppressed || all.suppressed) continue;
        const vg = c.value != null && all.value != null ? Math.round((c.value - all.value) * 100) / 100 : null;
        const cg = c.confidence != null && all.confidence != null ? Math.round((c.confidence - all.confidence) * 100) / 100 : null;
        if ((vg != null && Math.abs(vg) > FAIRNESS_GAP.value) || (cg != null && Math.abs(cg) > FAIRNESS_GAP.confidence)) {
          gaps.push({ scope, dimension: dim, group: g, value_gap: vg, confidence_gap: cg });
        }
      }
    }
    scopes[scope] = { all, by: byDim };
  }
  return {
    model: VENTURE_MODEL_V1.version, min_cell: FAIRNESS_MIN_CELL, gap: FAIRNESS_GAP,
    studio: 'One studio per deployment: each branch runs its own check over its own ventures.',
    scopes, gaps, opens_review: gaps.length > 0,
  };
}

/** Computes the fairness check and keeps it once per quarter. A second run in the quarter writes nothing. */
export async function runFairness(env: Env, now = new Date(), quarter = previousQuarter(now)) {
  const rows = await env.DB.prepare(JOB_STATEMENTS.fairnessRows).all<Row>();
  const agg = aggregate(rows.results || []);
  const out = await env.DB.prepare(JOB_STATEMENTS.saveFairness).bind(quarter, VENTURE_MODEL_V1.version, JSON.stringify(agg), now.toISOString()).run();
  return { quarter, written: Number(out?.meta?.changes ?? 0) === 1, gaps: agg.gaps.length };
}

export async function latestFairness(env: Env) {
  const row = await env.DB.prepare(JOB_STATEMENTS.latestFairness).first<{ quarter: string; model_version: string; aggregate_json: string; computed_at: string }>();
  return row ? { quarter: row.quarter, model: row.model_version, computed_at: row.computed_at, aggregate: JSON.parse(row.aggregate_json) } : null;
}

/** First day of January, April, July and October. */
export function isQuarterStart(d: Date): boolean {
  return d.getUTCDate() === 1 && d.getUTCMonth() % 3 === 0;
}
