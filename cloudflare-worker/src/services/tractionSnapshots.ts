/**
 * The one place that knows where a deal's traction lives.
 *
 * TWO TABLES SHARED ONE NAME AND THE WORKER USED BOTH. Production's
 * `metrics_snapshots` is a DEAL metrics table — `deal_id, snapshot_date,
 * key_metrics, traction_score, ai_review, created_by` plus ten named metric
 * columns — and `routes/pipeline.ts` creates exactly that shape at runtime, so it
 * is the one that exists. `services/queueWorker.ts` instead read and wrote a
 * GENERIC METRIC SERIES (`scope, scope_id, metric_name, value, captured_at,
 * extra`), which is `sql/historical/infrastructure.sql`'s shape and nothing has
 * built from `historical/` since the migration ledger became the build path.
 *
 * The collision was invisible until `check-sqlite-columns.mjs` stopped unioning
 * `historical/` into its harvest: before that the two shapes merged into one
 * 17-column set that satisfied both.
 *
 * WHAT IT COST. Three queue jobs threw `no such column`, and the sharpest was not
 * the one the task was filed about:
 *
 *   · `traction_review` died on its first SELECT, so the AI never ran and no
 *     review was ever written.
 *   · `metrics_aggregation` died on its INSERT.
 *   · `liquidity_valuation` died reading a momentum that was never written — and
 *     it dies BEFORE `Listings.updateValuation`, so a secondary listing's
 *     `ai_valuation_cents` stayed NULL and `LiquidityPage.jsx` rendered
 *     "— pending" for it forever. A founder lists a subsidiary for sale and the
 *     valuation never arrives.
 *
 * NO NEW TABLE, which is the part worth reading twice. Both shapes turned out to
 * have homes that already exist:
 *
 *   · The per-deal AI review goes in `metrics_snapshots.ai_review`, a TEXT column
 *     that has existed since the baseline with NO WRITER AND NO READER anywhere.
 *     This is its writer. The momentum rides inside that JSON.
 *   · The global counter goes in `system_metrics` (`metric_name, value, labels`),
 *     which is the generic named series this repo already has — `meter()` in
 *     `queueWorker.ts` writes to it on every job, and `analyticsReports.ts` reads
 *     it in five places.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH: `traction_score`. That column is a 0-100
 * RULE-BASED score computed by `pipeline.ts` from users/revenue/engagement/growth,
 * and `POST /pipeline/decision-gate/review` branches on it at 70 and 40.
 * `aiTractionReview` returns momentum on 0-10. Writing one into the other is
 * exactly the instrument-mixing the `ai_scoring` job's own comment refuses —
 * "correcting the names would have started mixing the two instruments instead" —
 * and it would make every AI momentum read as "iterate" at a gate that decides
 * whether a venture spins out.
 */
import type { Env } from '../types';

/** One `(metric, value, when)` triple, the shape `aiTractionReview` prompts on. */
export type MetricPoint = { metric_name: string; value: number; captured_at: string };

/**
 * The ten named metric columns, in the order a reader would want them.
 *
 * A LITERAL LIST, NOT `SELECT *`, and not a loop over `PRAGMA table_info`. The
 * prompt these feed is a list of `name=value` lines, so the column set IS the
 * question being asked — adding one should be a deliberate edit here rather than
 * something a schema change does silently. `check-sqlite-columns.mjs` verifies
 * every name against the real table, which is what makes the list safe to write
 * out.
 */
export const TRACTION_METRIC_COLUMNS = [
  'arr', 'cac', 'ltv', 'monthly_churn_pct', 'new_users',
  'net_burn', 'cash_balance', 'headcount', 'nrr_pct', 'paying_accounts',
] as const;

type SnapshotRow = {
  id: number;
  snapshot_date: string | null;
  key_metrics: string | null;
  ai_review: string | null;
} & Partial<Record<(typeof TRACTION_METRIC_COLUMNS)[number], number | null>>;

/**
 * Flatten snapshot rows into metric points.
 *
 * ONE ROW BECOMES UP TO TEN POINTS, plus whatever `key_metrics` carries. That is
 * the join between the table that exists and the AI worker's interface, and it
 * belongs here rather than in `aiTractionReview`: the worker should know what a
 * metric point is and nothing about which columns a deal snapshot has.
 *
 * NULL IS SKIPPED, NEVER ZEROED. A metric nobody entered is not a metric that is
 * zero, and a prompt fed `net_burn=0` for an unrecorded burn would be handed a
 * fact about the venture that nobody stated. This is the absent-is-not-empty rule
 * in the one place where it reaches a model.
 */
export function metricPointsFrom(rows: SnapshotRow[]): MetricPoint[] {
  const out: MetricPoint[] = [];
  for (const r of rows) {
    const when = String(r.snapshot_date || '');
    for (const col of TRACTION_METRIC_COLUMNS) {
      const v = r[col];
      if (v == null) continue;
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      out.push({ metric_name: col, value: n, captured_at: when });
    }
    // `key_metrics` is free-form JSON the founder's own form writes
    // (`users`, `revenue`/`mrr`, `engagement`/`retention`, `growth`). Numbers in
    // it are points too; anything non-numeric is skipped rather than coerced,
    // because `NaN` in a prompt line is worse than a missing line.
    if (r.key_metrics) {
      let km: any = null;
      try { km = JSON.parse(r.key_metrics); } catch { km = null; }
      if (km && typeof km === 'object' && !Array.isArray(km)) {
        for (const [k, v] of Object.entries(km)) {
          // EMPTINESS IS CHECKED BEFORE `Number()`, NOT AFTER, and the first draft
          // of this loop got it wrong: `Number(null)` is 0 and `Number('')` is 0,
          // both of which are `Number.isFinite`, so a key the founder left blank
          // reached the prompt as `growth=0` — a fact about the venture nobody
          // stated, in the same function whose docblock forbids exactly that. Its
          // own test caught it.
          if (v == null || v === '' || typeof v === 'boolean') continue;
          const n = Number(v);
          if (!Number.isFinite(n)) continue;
          out.push({ metric_name: k, value: n, captured_at: when });
        }
      }
    }
  }
  return out;
}

/**
 * The most recent snapshots for a deal, newest first.
 *
 * `deal_id` IS A `projects.id`, misnamed but consistently so: `pipeline.ts`'s
 * decision-gate handler looks the same value up as `SELECT * FROM projects WHERE
 * id = ?` before querying `metrics_snapshots WHERE deal_id = ?`. The
 * `traction_review` payload carries it as `project_id`, and they are the same
 * number.
 */
export async function recentSnapshots(env: Env, projectId: number, limit = 30): Promise<SnapshotRow[]> {
  // THE COLUMN LIST IS WRITTEN OUT, not interpolated from
  // `TRACTION_METRIC_COLUMNS`. Joining the array into the SQL is provably safe —
  // it is a literal `as const` — but `check-sql-prepare` is right to flag any
  // `${}` inside `prepare()` and an argued exception is a worse outcome than
  // twelve words of SQL. `traction_snapshots.test.ts` asserts this SELECT names
  // exactly the ten columns the array holds, so the two cannot drift.
  const res = await env.DB.prepare(
    `SELECT id, snapshot_date, key_metrics, ai_review,
            arr, cac, ltv, monthly_churn_pct, new_users,
            net_burn, cash_balance, headcount, nrr_pct, paying_accounts
       FROM metrics_snapshots WHERE deal_id = ?
      ORDER BY snapshot_date DESC, id DESC LIMIT ?`,
  ).bind(projectId, limit).all<SnapshotRow>();
  return res.results || [];
}

/** What `aiTractionReview` produced, as it is stored. */
export type StoredReview = {
  momentum: number;
  trend: string;
  summary: string;
  /** When the review was written, so a reader can tell a stale one. */
  reviewed_at: string;
  /** How many metric points the review was based on — 0 means it saw nothing. */
  points: number;
};

/**
 * Record a review against the snapshot it reviewed.
 *
 * AN UPDATE, NOT AN INSERT, and that is the design. A new row would be a snapshot
 * with all ten metrics NULL, which pollutes the very series the next review reads
 * and would drag `pipeline.ts`'s "latest snapshot" reads onto a row carrying no
 * metrics. A review is an annotation on a measurement, so it lands on the
 * measurement.
 *
 * IDEMPOTENT BY CONSTRUCTION, which matters because this handler gets re-run:
 * `Jobs.markFailed` puts the same row back to `pending`, and the CF Queue
 * consumer deletes its idempotency claim in the failure branch on purpose. A
 * retry overwrites one column on one row. There is nothing to double.
 *
 * Returns false when the deal has no snapshot to annotate — the caller decides
 * whether that is worth saying, and it is never an error: a venture nobody has
 * recorded metrics for has nothing to review.
 */
export async function recordReview(
  env: Env,
  snapshotId: number,
  review: StoredReview,
): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE metrics_snapshots SET ai_review = ? WHERE id = ?`,
  ).bind(JSON.stringify(review), snapshotId).run();
  return Number(res.meta?.changes ?? 0) > 0;
}

/**
 * The momentum a review recorded, or null.
 *
 * OUT OF THE JSON IN JS, never with `json_extract` in the SQL. Two reasons: the
 * stored shape is this module's own and a SELECT elsewhere would be a second
 * place that knows it, and a row whose `ai_review` is not valid JSON must read as
 * "no momentum" rather than throwing — the caller is a valuation, and a
 * valuation that dies on a malformed annotation is how a listing came to show
 * "— pending" forever in the first place.
 */
export async function latestMomentum(env: Env, projectId: number): Promise<number | null> {
  const row = await env.DB.prepare(
    `SELECT ai_review FROM metrics_snapshots
      WHERE deal_id = ? AND ai_review IS NOT NULL
      ORDER BY snapshot_date DESC, id DESC LIMIT 1`,
  ).bind(projectId).first<{ ai_review: string | null }>().catch(() => null);
  if (!row?.ai_review) return null;
  try {
    const parsed = JSON.parse(row.ai_review);
    const n = Number(parsed?.momentum);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
