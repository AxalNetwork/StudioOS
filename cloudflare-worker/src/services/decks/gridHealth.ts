/**
 * D1537 (#3786, deck v2 B10) — the Grid's health for HQ: the elements × models
 * metrics, the error budget with its alert, and the adoption KPIs (§5.9.6).
 *
 *   gridMetrics(env, days)    per element and model, from the run steps
 *                             (`deck_area_batch_steps`): steps, failures and the
 *                             error rate, p95 seconds against its target (text
 *                             ≤ 5 s, image ≤ 10 s), cost, fallbacks, and a drift
 *                             flag (a routed model the catalogue no longer holds,
 *                             or no longer serves). The eval score is not
 *                             recorded anywhere yet, so it reads not recorded.
 *   errorBudget(env, now)     99% of batches succeed over 28 days: the budget is
 *                             1% of the window's finished batches, and the read
 *                             says how much of it the window and the last hour used.
 *   noteErrorBudgetAlert      the hourly check: when the last hour burned a quarter
 *                             of the budget or more, each active HQ admin is told
 *                             once for that hour (`job_idempotency`, as D1510's
 *                             ceiling alerts are).
 *   funnelKpis(env, days)     decks with at least 3 area generations; quote
 *                             conversion by price band; the accept rate per
 *                             element and model (D1510's); time from a venture's
 *                             first deck to its first share; 4-week retention.
 *
 * Counts and ids only: no founder, deck title or words. A figure that cannot be
 * read, or has nothing to count, is null, never 0. Every statement is bound.
 */
import type { Env } from '../../types';
import { modelById } from '../ai/catalogue';
import { acceptRates } from './observability';

export const WINDOW_MAX_DAYS = 90;
/** §5.9.6: p95 targets on Balanced, in seconds, by step kind. */
export const P95_TARGET_SECONDS: Record<string, number> = { text: 5, image: 10 };
/** §5.9.6: 99% of batches succeed over 28 days. */
export const BUDGET = { success_pct: 99, window_days: 28, alert_fraction_per_hour: 0.25 } as const;
/** The quote bands, in microdollars: the lower bound of each, with its label. */
export const PRICE_BANDS = [
  { from: 0, label: 'Under $0.10' },
  { from: 100_000, label: '$0.10 to $0.50' },
  { from: 500_000, label: '$0.50 to $2' },
  { from: 2_000_000, label: '$2 and over' },
] as const;

const clampDays = (days: unknown, dflt = 30) => {
  const n = Math.floor(Number(days));
  return Number.isFinite(n) && n >= 1 ? Math.min(WINDOW_MAX_DAYS, n) : dflt;
};

/** The p-th percentile (0–100) of `xs`, nearest rank; null when there is nothing. */
export function percentile(xs: number[], p: number): number | null {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * v.length));
  return v[rank - 1];
}

/** True when the catalogue no longer holds the model, or no longer marks it as served. */
export function drifted(modelId: string | null): boolean {
  if (!modelId) return false;
  const m = modelById(modelId);
  return !m || (m.status !== 'ga' && m.status !== 'partner');
}

export interface GridRow {
  element: string; kind: string; model: string | null; model_label: string;
  steps: number; done: number; failed: number; error_rate: number | null;
  p95_seconds: number | null; p95_target_seconds: number | null; p95_over_target: boolean | null;
  cost_microusd: number; fallbacks: number; drift: boolean;
  eval_score: { available: false; reason: 'not_recorded' };
}

export async function gridMetrics(env: Env, days?: number): Promise<{ days: number; rows: GridRow[] }> {
  const window = clampDays(days);
  const rows = await env.DB.prepare(
    `SELECT s.element AS element, s.kind AS kind, COALESCE(s.model_used, s.model) AS model, s.state AS state,
            s.charged_microusd AS charged, s.fallback_used AS fallback,
            CASE WHEN s.started_at IS NOT NULL AND s.ended_at IS NOT NULL
                 THEN (julianday(s.ended_at) - julianday(s.started_at)) * 86400.0 END AS seconds
       FROM deck_area_batch_steps s JOIN deck_area_batches b ON b.uid = s.batch_uid
      WHERE datetime(b.created_at) >= datetime('now', ?) AND s.state IN ('done', 'failed')`,
  ).bind(`-${window} days`).all<{ element: string; kind: string; model: string | null; state: string; charged: number; fallback: number; seconds: number | null }>();
  const groups = new Map<string, GridRow & { _secs: number[] }>();
  for (const r of rows.results || []) {
    const key = `${r.element}\u0000${r.kind}\u0000${r.model ?? ''}`;
    let g = groups.get(key);
    if (!g) {
      const target = P95_TARGET_SECONDS[r.kind] ?? null;
      g = {
        element: r.element, kind: r.kind, model: r.model ?? null,
        model_label: r.model ? (modelById(r.model)?.name ?? r.model) : 'No model · free',
        steps: 0, done: 0, failed: 0, error_rate: null, p95_seconds: null, p95_target_seconds: target, p95_over_target: null,
        cost_microusd: 0, fallbacks: 0, drift: drifted(r.model ?? null), eval_score: { available: false, reason: 'not_recorded' }, _secs: [],
      };
      groups.set(key, g);
    }
    g.steps += 1;
    if (r.state === 'done') { g.done += 1; if (r.seconds != null) g._secs.push(Number(r.seconds)); }
    if (r.state === 'failed') g.failed += 1;
    g.cost_microusd += Number(r.charged) || 0;
    if (Number(r.fallback) === 1) g.fallbacks += 1;
  }
  const out = [...groups.values()].map(({ _secs, ...g }) => {
    const p95 = percentile(_secs, 95);
    const rounded = p95 == null ? null : Math.round(p95 * 10) / 10;
    return {
      ...g, error_rate: g.steps ? g.failed / g.steps : null, p95_seconds: rounded,
      p95_over_target: rounded == null || g.p95_target_seconds == null ? null : rounded > g.p95_target_seconds,
    };
  });
  out.sort((a, z) => a.element.localeCompare(z.element) || (a.model || '').localeCompare(z.model || ''));
  return { days: window, rows: out };
}

export interface Budget {
  window_days: number; target_success: number;
  finished: number; failed: number; success_rate: number | null;
  budget_failures: number | null; used_fraction: number | null;
  last_hour_failed: number; last_hour_fraction: number | null; alerting: boolean;
}

/** A batch counts once it has finished: done or failed. A cancelled batch is the founder's choice, not a failure. */
export async function errorBudget(env: Env, now: Date = new Date()): Promise<Budget> {
  const iso = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19);
  const since = iso(new Date(now.getTime() - BUDGET.window_days * 86_400_000));
  const hour = iso(new Date(now.getTime() - 3_600_000));
  const at = iso(now);
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS finished,
            SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN state = 'failed' AND datetime(COALESCE(settled_at, created_at)) >= datetime(?) THEN 1 ELSE 0 END) AS last_hour
       FROM deck_area_batches
      WHERE state IN ('done', 'failed') AND datetime(COALESCE(settled_at, created_at)) >= datetime(?)
        AND datetime(COALESCE(settled_at, created_at)) <= datetime(?)`,
  ).bind(hour, since, at).first<{ finished: number; failed: number | null; last_hour: number | null }>();
  const finished = Number(row?.finished) || 0;
  const failed = Number(row?.failed) || 0;
  const lastHour = Number(row?.last_hour) || 0;
  // In whole percent, so the budget is exact: 1% of 400 batches is 4, not 3.9999….
  const budget = finished ? (finished * (100 - BUDGET.success_pct)) / 100 : null;
  const usedFraction = budget ? failed / budget : null;
  const hourFraction = budget ? lastHour / budget : null;
  return {
    window_days: BUDGET.window_days, target_success: BUDGET.success_pct / 100,
    finished, failed, success_rate: finished ? (finished - failed) / finished : null,
    budget_failures: budget == null ? null : Math.round(budget * 100) / 100,
    used_fraction: usedFraction, last_hour_failed: lastHour, last_hour_fraction: hourFraction,
    alerting: lastHour > 0 && hourFraction != null && hourFraction >= BUDGET.alert_fraction_per_hour,
  };
}

/** The hourly check. Tells each active HQ admin once per UTC hour; returns whether it sent. Never throws into the cron. */
export async function noteErrorBudgetAlert(env: Env, now: Date = new Date()): Promise<boolean> {
  try {
    const b = await errorBudget(env, now);
    if (!b.alerting) return false;
    const hour = now.toISOString().slice(0, 13);
    const claim = await env.DB.prepare('INSERT OR IGNORE INTO job_idempotency (idempotency_key) VALUES (?)').bind(`deck-error-budget:${hour}`).run();
    if (Number(claim.meta?.changes) !== 1) return false;
    const admins = await env.DB.prepare(`SELECT id FROM users WHERE role = 'admin' AND is_active = 1`).all<{ id: number }>();
    const { notify } = await import('../notify');
    const pct = Math.round((b.last_hour_fraction ?? 0) * 100);
    for (const a of admins.results || []) {
      await notify(env, {
        userId: Number(a.id), type: 'deck_error_budget_alert', category: 'system', channels: ['in_app', 'email'],
        title: `Deck generation burned ${pct}% of its error budget in the last hour`,
        body: `${b.last_hour_failed} of the last 28 days' batches failed in the last hour, against a budget of ${b.budget_failures} failed batches (99% must succeed).`,
        link: '/admin/platform/decks/grid',
        payload: { hour, last_hour_failed: b.last_hour_failed, budget_failures: b.budget_failures, finished: b.finished },
      });
    }
    return true;
  } catch {
    console.warn('[deck-grid] error budget check unreadable');
    return false;
  }
}

const median = (xs: number[]) => percentile(xs, 50);
const rate = (n: number, of: number) => (of ? n / of : null);

export async function funnelKpis(env: Env, days?: number, now: Date = new Date()) {
  const window = clampDays(days);
  const since = `-${window} days`;
  const read = async <T>(f: () => Promise<T>): Promise<T | null> => { try { return await f(); } catch { console.warn('[deck-grid] a KPI could not be read'); return null; } };

  const generations = await read(async () => {
    const r = await env.DB.prepare(
      `SELECT COUNT(*) AS decks, SUM(CASE WHEN n >= 3 THEN 1 ELSE 0 END) AS three_plus
         FROM (SELECT deck_id, COUNT(*) AS n FROM deck_area_proposals WHERE datetime(created_at) >= datetime('now', ?) GROUP BY deck_id)`,
    ).bind(since).first<{ decks: number; three_plus: number | null }>();
    const decks = Number(r?.decks) || 0;
    const three = Number(r?.three_plus) || 0;
    return { decks_generating: decks, decks_three_plus: three, rate: rate(three, decks) };
  });

  const quotes = await read(async () => {
    const rows = await env.DB.prepare(
      `SELECT hold_microusd AS hold, used_at IS NOT NULL AS used FROM deck_run_quotes WHERE datetime(created_at) >= datetime('now', ?)`,
    ).bind(since).all<{ hold: number; used: number }>();
    const bands = PRICE_BANDS.map((b) => ({ label: b.label, from_microusd: b.from, shown: 0, confirmed: 0, conversion: null as number | null }));
    for (const q of rows.results || []) {
      let i = PRICE_BANDS.length - 1;
      while (i > 0 && Number(q.hold) < PRICE_BANDS[i].from) i -= 1;
      bands[i].shown += 1;
      if (Number(q.used)) bands[i].confirmed += 1;
    }
    for (const b of bands) b.conversion = rate(b.confirmed, b.shown);
    return bands;
  });

  const accept = await read(() => acceptRates(env, window));

  const firstShare = await read(async () => {
    const rows = await env.DB.prepare(
      `SELECT (julianday(s.first_share) - julianday(d.first_deck)) * 24.0 AS hours
         FROM (SELECT project_id, MIN(created_at) AS first_deck FROM pitch_decks GROUP BY project_id) d
         JOIN (SELECT pd.project_id AS project_id, MIN(t.created_at) AS first_share
                 FROM pitch_deck_share_tokens t JOIN pitch_decks pd ON pd.id = t.deck_id GROUP BY pd.project_id) s
           ON s.project_id = d.project_id
        WHERE datetime(d.first_deck) >= datetime('now', ?)`,
    ).bind(since).all<{ hours: number }>();
    const hours = (rows.results || []).map((r) => Number(r.hours)).filter((h) => Number.isFinite(h) && h >= 0);
    const m = median(hours);
    return { ventures: hours.length, median_hours: m == null ? null : Math.round(m * 10) / 10 };
  });

  // 4-week retention: ventures whose first area generation was 28 to 56 days ago, and of them those that generated again 28 days or more after it.
  const retention = await read(async () => {
    const iso = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
    const r = await env.DB.prepare(
      `SELECT COUNT(*) AS cohort,
              SUM(CASE WHEN EXISTS (SELECT 1 FROM deck_area_batches b2 WHERE b2.project_id = f.project_id
                                      AND julianday(b2.created_at) >= julianday(f.first_at) + 28) THEN 1 ELSE 0 END) AS retained
         FROM (SELECT project_id, MIN(created_at) AS first_at FROM deck_area_batches GROUP BY project_id) f
        WHERE datetime(f.first_at) >= datetime(?) AND datetime(f.first_at) < datetime(?)`,
    ).bind(iso(now.getTime() - 56 * 86_400_000), iso(now.getTime() - 28 * 86_400_000)).first<{ cohort: number; retained: number | null }>();
    const cohort = Number(r?.cohort) || 0;
    const retained = Number(r?.retained) || 0;
    return { cohort, retained, rate: rate(retained, cohort) };
  });

  return { days: window, generations, quote_conversion: quotes, accept_rates: accept, first_share: firstShare, retention_4w: retention };
}
