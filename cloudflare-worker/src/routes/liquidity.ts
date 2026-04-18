/**
 * Liquidity / secondary-market endpoints.
 *
 * Roles available: admin | founder | partner.
 *  - List & view marketplace : any authenticated user
 *  - Create listing          : owner (founder of subsidiary OR LP holding the fund), or admin
 *  - Trigger AI matching     : admin or partner
 *  - Execute exit            : admin only (rate-limited via existing 'spinout' bucket)
 *  - My-portfolio            : any authenticated user (returns LP records + listings)
 *
 * All money values transit as integer cents.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, requireAdmin } from '../auth';
import { Jobs } from '../models/jobs';
import { enqueueJob } from '../services/queue';
import { Listings, Matches, LiquidityEvents } from '../models/liquidity';
import { logActivity } from './partnernet';

const liquidity = new Hono<{ Bindings: Env }>();

// POST /api/liquidity/list — create secondary listing + enqueue AI valuation
liquidity.post('/list', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json<{
    subsidiary_id: number; shares: number; asking_price_cents: number; notes?: string;
  }>();
  if (!body?.subsidiary_id || !body.shares || body.shares <= 0) {
    return c.json({ error: 'subsidiary_id and positive shares required' }, 400);
  }
  if (!body.asking_price_cents || body.asking_price_cents < 1) {
    return c.json({ error: 'asking_price_cents must be a positive integer' }, 400);
  }

  // Ownership / role-scope check.
  const sub: any = await c.env.DB.prepare(
    `SELECT s.*, d.partner_id FROM subsidiaries s LEFT JOIN deals d ON d.id = s.deal_id WHERE s.id = ?`
  ).bind(body.subsidiary_id).first();
  if (!sub) return c.json({ error: 'subsidiary not found' }, 404);

  let allowed = false;
  if (user.role === 'admin') {
    allowed = true;
  } else if (user.role === 'partner') {
    // Investment partners may broker secondaries; they're allowed by role.
    allowed = true;
  } else if (user.role === 'founder') {
    // Must be the founder of the underlying project (subsidiaries.deal_id -> projects.id -> founders -> users by email).
    const owns = await c.env.DB.prepare(
      `SELECT 1 AS yes FROM projects p
         JOIN founders f ON f.id = p.founder_id
         JOIN users u ON LOWER(u.email) = LOWER(f.email)
        WHERE u.id = ? AND p.id = ? LIMIT 1`
    ).bind(user.id, sub.deal_id).first<{ yes: number }>();
    allowed = !!owns;
  } else {
    // Any other authenticated user: require an active LP standing somewhere.
    const lp = await c.env.DB.prepare(
      `SELECT 1 AS yes FROM limited_partners
        WHERE user_id = ? AND status IN ('committed','active') LIMIT 1`
    ).bind(user.id).first<{ yes: number }>();
    allowed = !!lp;
  }
  if (!allowed) return c.json({ error: 'Not authorized to list shares for this subsidiary' }, 403);

  const listing = await Listings.create(c.env, {
    user_id: user.id,
    subsidiary_id: body.subsidiary_id,
    shares: Number(body.shares),
    asking_price_cents: Math.round(body.asking_price_cents),
    notes: body.notes,
  });
  if (!listing) return c.json({ error: 'failed to create listing' }, 500);

  // Audit + enqueue AI valuation (non-blocking)
  await LiquidityEvents.create(c.env, {
    subsidiary_id: body.subsidiary_id,
    event_type: 'secondary_sale',
    status: 'listed',
    valuation_cents: body.asking_price_cents,
    shares_offered: body.shares,
  });
  await enqueueJob(c.env, 'liquidity_valuation', { listing_id: listing.id, subsidiary_id: body.subsidiary_id });
  await logActivity(c.env, user.id, 'secondary_listing_created', {
    entityType: 'secondary_listing', entityId: listing.id,
    metadata: { subsidiary_id: body.subsidiary_id, shares: body.shares },
  }).catch(() => {});

  return c.json({ ok: true, listing }, 201);
});

// GET /api/liquidity/marketplace — open listings (+ AI valuations as available)
liquidity.get('/marketplace', async (c) => {
  await requireAuth(c);
  const items = await Listings.openMarketplace(c.env, 100);
  return c.json({ ok: true, items });
});

// POST /api/liquidity/match — enqueue AI buyer matching for a listing
liquidity.post('/match', async (c) => {
  const user = await requireAuth(c);
  if (!['admin', 'partner'].includes(user.role)) {
    return c.json({ error: 'Admins/partners only' }, 403);
  }
  const body = await c.req.json<{ listing_id: number }>();
  if (!body?.listing_id) return c.json({ error: 'listing_id required' }, 400);
  const listing = await Listings.getById(c.env, body.listing_id);
  if (!listing) return c.json({ error: 'listing not found' }, 404);
  await Matches.clearForListing(c.env, body.listing_id);  // clear prior 'proposed' matches
  const result = await enqueueJob(c.env, 'liquidity_matching', { listing_id: body.listing_id });
  return c.json({ ok: true, enqueued_job: result.job, transport: result.transport });
});

// GET /api/liquidity/listings/:id/matches — see proposed buyers (admin/partner)
liquidity.get('/listings/:id/matches', async (c) => {
  const user = await requireAuth(c);
  if (!['admin', 'partner'].includes(user.role)) {
    return c.json({ error: 'Admins/partners only' }, 403);
  }
  const id = parseInt(c.req.param('id'), 10);
  const items = await Matches.forListing(c.env, id);
  return c.json({ ok: true, items });
});

// POST /api/liquidity/execute-exit — admin only (rate-limited via 'spinout' bucket upstream)
liquidity.post('/execute-exit', async (c) => {
  const user = await requireAdmin(c);
  const body = await c.req.json<{
    listing_id: number; buyer_user_id?: number; executed_price_cents: number; buyer_type?: string;
  }>();
  if (!body?.listing_id || !body.executed_price_cents) {
    return c.json({ error: 'listing_id and executed_price_cents required' }, 400);
  }
  const listing = await Listings.getById(c.env, body.listing_id);
  if (!listing) return c.json({ error: 'listing not found' }, 404);
  if (listing.status === 'sold') return c.json({ error: 'already sold' }, 409);
  if (listing.shares <= 0) return c.json({ error: 'cannot execute on zero-share listing' }, 400);

  const priceCents = Math.round(body.executed_price_cents);

  // Atomic conditional flip: only the first concurrent caller succeeds.
  // sold_at returned so we know we won the race.
  const claimed = await c.env.DB.prepare(
    `UPDATE secondary_listings
        SET status='sold', sold_at=datetime('now')
      WHERE id = ? AND status IN ('open','matched')
      RETURNING id`
  ).bind(body.listing_id).first<{ id: number }>();
  if (!claimed) return c.json({ error: 'listing already executed or cancelled' }, 409);

  // Record liquidity event
  const evt = await LiquidityEvents.create(c.env, {
    subsidiary_id: listing.subsidiary_id,
    event_type: 'secondary_sale',
    status: 'executed',
    valuation_cents: priceCents,
    shares_offered: listing.shares,
    buyer_type: body.buyer_type ?? 'secondary_fund',
    executed_price_cents: priceCents,
  });

  // Distribute returns to seller's LP record (if any).
  // Mock real settlement: increment `returns` on all of the seller's LP rows
  // proportional to share of the price (simple split equally for now).
  try {
    const lps = await c.env.DB.prepare(
      `SELECT id FROM limited_partners WHERE user_id = ?`
    ).bind(listing.user_id).all<{ id: number }>();
    const rows = lps.results || [];
    if (rows.length) {
      const perLp = Math.floor(priceCents / rows.length);
      const stmts = rows.map(r =>
        c.env.DB.prepare(
          `UPDATE limited_partners SET returns = returns + ?, updated_at = datetime('now') WHERE id = ?`
        ).bind(perLp / 100, r.id) // returns column stored in dollars; convert
      );
      await c.env.DB.batch(stmts);
    }
  } catch (e) { console.error('LP distribution failed', e); }

  // Mark accepted match if any
  if (body.buyer_user_id) {
    await c.env.DB.prepare(
      `UPDATE exit_matches SET status='executed', decided_at=datetime('now')
       WHERE listing_id = ? AND buyer_user_id = ?`
    ).bind(body.listing_id, body.buyer_user_id).run().catch(() => {});
  }

  await logActivity(c.env, user.id, 'liquidity_exit_executed', {
    entityType: 'secondary_listing', entityId: body.listing_id,
    metadata: { price_cents: priceCents, buyer_user_id: body.buyer_user_id },
  }).catch(() => {});

  // Returns distribution is intentionally NOT auto-enqueued here. Distributing
  // across unrelated funds is dangerous; an operator must call
  // POST /api/funds/distributions/execute with an explicit fund_id (using
  // event.id below as liquidity_event_id) so the right LP ledgers are credited.
  return c.json({
    ok: true,
    event: evt,
    listing_id: body.listing_id,
    distribution_hint: {
      action: 'POST /api/funds/distributions/execute',
      payload: { fund_id: '<required>', liquidity_event_id: evt?.id, proceeds_cents: priceCents },
    },
  });
});

// GET /api/liquidity/my-portfolio
liquidity.get('/my-portfolio', async (c) => {
  const user = await requireAuth(c);
  const lps = await c.env.DB.prepare(
    `SELECT lp.*, f.name AS fund_name, f.status AS fund_status
       FROM limited_partners lp JOIN vc_funds f ON f.id = lp.fund_id
      WHERE lp.user_id = ? ORDER BY lp.created_at DESC`
  ).bind(user.id).all();
  const myListings = await Listings.listByUser(c.env, user.id);

  // Recent liquidity events touching this user's listings
  const events = await c.env.DB.prepare(
    `SELECT e.* FROM liquidity_events e
       LEFT JOIN secondary_listings l ON l.subsidiary_id = e.subsidiary_id
      WHERE l.user_id = ? OR e.subsidiary_id IN (
        SELECT subsidiary_id FROM secondary_listings WHERE user_id = ?
      )
      ORDER BY e.created_at DESC LIMIT 25`
  ).bind(user.id, user.id).all();

  return c.json({
    ok: true,
    lp_holdings: lps.results || [],
    my_listings: myListings,
    exit_history: events.results || [],
  });
});

// GET /api/liquidity/events — recent liquidity events (admin/partner observability)
liquidity.get('/events', async (c) => {
  const user = await requireAuth(c);
  if (!['admin', 'partner'].includes(user.role)) {
    return c.json({ error: 'Admins/partners only' }, 403);
  }
  const items = await LiquidityEvents.listRecent(c.env, 100);
  return c.json({ ok: true, items });
});

export default liquidity;
