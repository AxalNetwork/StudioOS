/**
 * Competitor prices on stated terms — `/api/competitor-prices` (D7723, #7723).
 *
 *   GET  /proposals?analysis=<id>   the pricing hints one analysis holds, as unsaved
 *                                   proposals with each competitor's fetched pages;
 *                                   only the member who ran the analysis; writes nothing
 *   POST /                          save a price: a confirmed hint or one added by hand
 *   POST /:uid/withdraw             withdraw a price: clears its amount and link, says why
 *   GET  /?competitor=&project=     the current prices for one competitor
 *   GET  /series?competitor=&product=&plan=&project=   the dated series of one plan
 *
 * Owner answer A: a venture's prices are read by `canReadBoard` and written by
 * `canWrite`; with no `project` the routes cover the caller's own unattached
 * prices only. No route edits or deletes a price (services/competitorPrices.ts).
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { isSupportSession } from '../services/companyAccess';
import type { RouteMount } from '../util/routeRegistry';
import {
  PriceError, listProposals, readCurrent, readScope, readSeries, saveObservation, withdrawObservation,
} from '../services/competitorPrices';

const competitorPrices = new Hono<{ Bindings: Env }>();
type C = Context<{ Bindings: Env }>;

async function signedIn(c: C): Promise<User | null> {
  try { return (await requireAuth(c)) as User; } catch { return null; }
}
const unauthorized = (c: C) => refuse(c, 401, { code: 'unauthorized', message: 'Sign in to read or record competitor prices.' });

async function body(c: C): Promise<Record<string, unknown>> {
  const b = await c.req.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? b as Record<string, unknown> : {};
}

function failed(c: C, e: unknown, sentence: string) {
  if (e instanceof PriceError) return refuse(c, e.status, { code: e.code, message: e.sentence, extra: e.extra });
  return refuse(c, 503, { code: 'competitor_prices_unavailable', message: sentence, raw: e });
}

competitorPrices.get('/proposals', async (c) => {
  const user = await signedIn(c);
  if (!user) return unauthorized(c);
  try {
    const out = await listProposals(c.env.DB, Number(user.id), c.req.query('analysis'));
    return c.json({ ...out, saved: false });
  } catch (e) { return failed(c, e, 'The analysis’s pricing hints could not be read. Nothing was saved.'); }
});

competitorPrices.get('/series', async (c) => {
  const user = await signedIn(c);
  if (!user) return unauthorized(c);
  try {
    const scope = await readScope(c.env.DB, user, c.req.query('project'));
    const series = await readSeries(c.env.DB, user, scope, c.req.query('competitor'), c.req.query('product'), c.req.query('plan'));
    return c.json({ project_id: scope.projectId, series });
  } catch (e) { return failed(c, e, 'The price history could not be read.'); }
});

competitorPrices.get('/', async (c) => {
  const user = await signedIn(c);
  if (!user) return unauthorized(c);
  try {
    const scope = await readScope(c.env.DB, user, c.req.query('project'));
    const current = await readCurrent(c.env.DB, user, scope, c.req.query('competitor'));
    return c.json({ project_id: scope.projectId, current });
  } catch (e) { return failed(c, e, 'The competitor’s prices could not be read.'); }
});

competitorPrices.post('/', async (c) => {
  const user = await signedIn(c);
  if (!user) return unauthorized(c);
  if (await isSupportSession(c)) return refuse(c, 403, { code: 'support_session', message: 'A support session cannot record prices.' });
  try {
    const price = await saveObservation({ db: c.env.DB, user }, await body(c));
    return c.json({ price }, 201);
  } catch (e) { return failed(c, e, 'The price could not be saved. Nothing was written.'); }
});

competitorPrices.post('/:uid/withdraw', async (c) => {
  const user = await signedIn(c);
  if (!user) return unauthorized(c);
  if (await isSupportSession(c)) return refuse(c, 403, { code: 'support_session', message: 'A support session cannot withdraw prices.' });
  try {
    const b = await body(c);
    const price = await withdrawObservation({ db: c.env.DB, user }, c.req.param('uid'), b.reason);
    return c.json({ price });
  } catch (e) { return failed(c, e, 'The price could not be withdrawn. Nothing changed.'); }
});

export const mount: RouteMount = { path: '/api/competitor-prices', router: competitorPrices };
export default competitorPrices;
