/**
 * D1510 (#3761, deck v2 A17) — HQ's read of deck generation, mounted at
 * /api/admin/deck-generation. The HQ dashboard page that draws it is B10's
 * (#3786); this is the Worker read it needs.
 *
 *   GET /api/admin/deck-generation?days=30
 *     → { ceiling: { ceiling_microusd, spent_today_microusd, percent, paused },
 *         alert_thresholds: [50, 80], days,
 *         accept_rates: [{ element, model, model_label, proposals, decided, accepted, accepted_all,
 *                          discarded, regenerated, accept_rate, first_result_seconds }] }
 *
 * The ceiling is the owner's `DECK_DAILY_CEILING_MICROUSD`: null when it is not
 * set ("Not set"), never a guessed figure. A figure that cannot be read is
 * null, never 0. Only counts are returned: no founder, deck title or words.
 * An HQ administrator only (`requireHqAdmin`).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireHqAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { modelById } from '../services/ai/catalogue';
import { ACCEPT_WINDOW_MAX_DAYS, ALERT_THRESHOLDS, acceptRates, ceilingState, type AcceptRate } from '../services/decks/observability';

const r = new Hono<{ Bindings: Env }>();

r.get('/', async (c) => {
  await requireHqAdmin(c);
  const q = c.req.query('days');
  const days = q == null || q === '' ? 30 : Number(q);
  if (!Number.isInteger(days) || days < 1 || days > ACCEPT_WINDOW_MAX_DAYS) {
    return refuse(c, 400, { code: 'invalid_days', message: `days is a whole number from 1 to ${ACCEPT_WINDOW_MAX_DAYS}.` });
  }
  const ceiling = await ceilingState(c.env);
  let rates: AcceptRate[] | null;
  try { rates = await acceptRates(c.env, days); } catch (e) {
    console.warn('[admin_deck_generation] accept rates unreadable', (e as Error)?.message);
    rates = null;
  }
  return c.json({
    ceiling,
    alert_thresholds: [...ALERT_THRESHOLDS],
    days,
    accept_rates: rates == null ? null : rates.map((x) => ({ ...x, model_label: x.model ? (modelById(x.model)?.name ?? x.model) : 'No model · free' })),
  });
});

export const mount: RouteMount = { path: '/api/admin/deck-generation', router: r };
export default r;
