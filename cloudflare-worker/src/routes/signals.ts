/**
 * Signals — the ranked list and its sources. Mounted at /api/signals.
 *
 * Surfaces the ranked, filtered founder-actionable signals derived from PUBLIC
 * company data. This is NOT a markets/trading API — there are no price or quote
 * endpoints here by design. See services/signals/* for the engine, ranking and
 * source-adapter layer, and sql/migrations/136_signals.sql for the schema.
 *
 * Endpoints:
 *   GET  /                 → ranked + filtered signal cards (list view);
 *                            503 `signals_unreadable` when the store cannot be
 *                            read (D7173) — never the example set
 *   GET  /sources          → source registry (confidence transparency)
 *
 * D670 retired the /signals page, and with it `/filters`, `/kpis`, `/meta`,
 * `/:id` and the admin's manual `POST /refresh`. Research's founder desk and
 * market directory read the two that remain; the nightly cron still refreshes
 * the data (index.ts).
 *
 * Access: any authenticated Axal member (founder / advisor / partner /
 * investor / admin) can read signals.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import type { SignalFilters } from '../services/signals/types';
import { SOURCE_REGISTRY } from '../services/signals/sources';
import { getRankedSignals, getIngestHealth, SignalsUnreadableError } from '../services/signals/engine';
import { refuse } from '../util/refusal';

const r = new Hono<{ Bindings: Env }>();

function readMode(c: any): 'founder' | 'advisor' {
  return c.req.query('mode') === 'advisor' ? 'advisor' : 'founder';
}

/**
 * The list, or the D7173 refusal: a failed read answers 503
 * `signals_unreadable` — never the example set, and never cached (the engine
 * throws before its KV write). Exported for the test that drives it.
 */
export async function rankedSignalsResponse(c: any, filters: SignalFilters): Promise<Response> {
  try {
    return c.json(await getRankedSignals(c.env, filters));
  } catch (e) {
    if (e instanceof SignalsUnreadableError) {
      return refuse(c, 503, {
        code: 'signals_unreadable',
        message: 'The signals could not be read. That is not a sign there are none. Try again.',
        raw: e.raw,
      });
    }
    throw e;
  }
}

// GET /api/signals — ranked, filtered list.
r.get('/', async (c) => {
  try {
    await requireAuth(c);
    const q = c.req.query.bind(c.req);
    const filters: SignalFilters = {
      region: q('region') || undefined,
      country: q('country') || undefined,
      sector: q('sector') || undefined,
      industry: q('industry') || undefined,
      niche: q('niche') || undefined,
      market_cap_band: q('market_cap_band') || undefined,
      employee_band: q('employee_band') || undefined,
      customer_type: q('customer_type') || undefined,
      maturity_stage: q('maturity_stage') || undefined,
      type: q('type') || undefined,
      q: q('q') || undefined,
      mode: readMode(c),
      limit: q('limit') ? Number(q('limit')) : undefined,
    };
    return await rankedSignalsResponse(c, filters);
  } catch (e) {
    return mapError(c, e);
  }
});

// GET /api/signals/sources — source registry (why a signal is credible) plus
// the recent ingest-run history, so the transparency modal can show which
// sources actually answered on the last refresh rather than implying all did.
r.get('/sources', async (c) => {
  try {
    await requireAuth(c);
    const health = await getIngestHealth(c.env);
    return c.json({ sources: SOURCE_REGISTRY, health });
  } catch (e) {
    return mapError(c, e);
  }
});

export default r;
