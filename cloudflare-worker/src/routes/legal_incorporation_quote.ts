/**
 * D4357 (#4357) — `GET /api/legal/incorporation/itemised-quote`: the
 * Incorporate quote line by line, read on the review step before the founder
 * confirms.
 *
 *   GET /api/legal/incorporation/itemised-quote?jurisdiction_id=us_de_ccorp
 *       → { jurisdiction_id, label, lines: [{ key, label, amount_cents | null, currency, interval,
 *            optional, paid, source, source_url, checked_on }], total: { amount_cents | null, currency, complete, unknown } }
 *
 * The lines come from `services/incorporationQuote.ts` `quoteOf`: the state
 * filing fee from its reviewed table, Axal VC's service fee from the catalog
 * price the order charges (`resolveIncorporationPrice`), the registered agent
 * and any optional add-ons from the catalog. A fee that is not known is null,
 * never 0. It reads only; who: anyone signed in, as the one-price quote.
 * Mounted before `legal.ts`.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import legal, { JURISDICTIONS, resolveIncorporationPrice, resolveRegisteredAgentOffer } from './legal';
import type { RouteMount } from '../util/routeRegistry';
import { addOnsOf, catalogOrNone, productOfPrice, quoteOf } from '../services/incorporationQuote';

const legalIncorporationQuote = new Hono<{ Bindings: Env }>();

legalIncorporationQuote.get('/incorporation/itemised-quote', async (c) => {
  await requireAuth(c);
  const jurisdictionId = String(c.req.query('jurisdiction_id') || '');
  const j = JURISDICTIONS.find((x) => x.id === jurisdictionId);
  if (!j) return c.json({ error: 'unknown_jurisdiction', message: 'That jurisdiction cannot be formed here.' }, 400);
  const [price, agent, products] = await Promise.all([
    resolveIncorporationPrice(c.env, j.id).catch(() => null),
    resolveRegisteredAgentOffer(c.env),
    catalogOrNone(c.env),
  ]);
  const quote = quoteOf({
    jurisdictionId: j.id,
    service: price ? { amount_cents: price.amountCents, currency: price.currency, synced_at: productOfPrice(products, price.priceId)?.synced_at ?? null } : null,
    agent: agent ? { amount_cents: agent.amount_cents, currency: agent.currency, interval: agent.interval, name: agent.product_name, synced_at: productOfPrice(products, agent.price_id)?.synced_at ?? null } : null,
    addOns: addOnsOf(products),
  });
  return c.json({ jurisdiction_id: j.id, label: j.label, ...quote });
});

export default legalIncorporationQuote;

export const mount: RouteMount = { path: '/api/legal', router: legalIncorporationQuote, before: [legal] };
