/**
 * D1537 (#3786, deck v2 B10) — HQ › Decks › Grid health and Funnel, the reads.
 *
 *   GET /api/admin/ai/deck-grid?days=30
 *     → { days, rows: [{ element, kind, model, model_label, steps, done, failed, error_rate,
 *                        p95_seconds, p95_target_seconds, p95_over_target, cost_microusd,
 *                        fallbacks, drift, eval_score }],
 *         budget: { window_days, target_success, finished, failed, success_rate,
 *                   budget_failures, used_fraction, last_hour_failed, last_hour_fraction, alerting } }
 *   GET /api/admin/ai/deck-grid/funnel?days=30
 *     → { days, generations, quote_conversion, accept_rates, first_share, retention_4w }
 *
 * The figures are `services/decks/gridHealth.ts`'s. A figure that cannot be
 * read is null, never 0; each KPI fails on its own. Counts and ids only. An
 * HQ administrator only (`requireHqAdmin`), so a branch is refused. The model
 * kill switch is #4251's (`/api/admin/ai/element-models`).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireHqAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { modelById } from '../services/ai/catalogue';
import { WINDOW_MAX_DAYS, errorBudget, funnelKpis, gridMetrics } from '../services/decks/gridHealth';

const r = new Hono<{ Bindings: Env }>();

function daysOf(c: any): number | Response {
  const q = c.req.query('days');
  const days = q == null || q === '' ? 30 : Number(q);
  if (!Number.isInteger(days) || days < 1 || days > WINDOW_MAX_DAYS) {
    return refuse(c, 400, { code: 'invalid_days', message: `days is a whole number from 1 to ${WINDOW_MAX_DAYS}.` });
  }
  return days;
}

r.get('/', async (c) => {
  await requireHqAdmin(c);
  const days = daysOf(c);
  if (days instanceof Response) return days;
  let grid: Awaited<ReturnType<typeof gridMetrics>> | null = null;
  let budget: Awaited<ReturnType<typeof errorBudget>> | null = null;
  try { grid = await gridMetrics(c.env, days); } catch { console.warn('[admin_deck_grid] metrics unreadable'); }
  try { budget = await errorBudget(c.env); } catch { console.warn('[admin_deck_grid] budget unreadable'); }
  return c.json({ days, rows: grid ? grid.rows : null, budget });
});

r.get('/funnel', async (c) => {
  await requireHqAdmin(c);
  const days = daysOf(c);
  if (days instanceof Response) return days;
  const k = await funnelKpis(c.env, days);
  const accept = k.accept_rates == null ? null
    : k.accept_rates.map((x) => ({ ...x, model_label: x.model ? (modelById(x.model)?.name ?? x.model) : 'No model · free' }));
  return c.json({ ...k, accept_rates: accept });
});

export const mount: RouteMount = { path: '/api/admin/ai/deck-grid', router: r };
export default r;
