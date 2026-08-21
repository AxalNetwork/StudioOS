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
import { enqueueJob } from '../services/queue';
import { Listings, Matches, LiquidityEvents } from '../models/liquidity';
import { computeNetProceeds, rofrStatus } from '../services/secondaryProceeds';
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
  } else if (user.role === 'partner' || user.role === 'investor') {
    // Investment partners / investors may broker secondaries; allowed by role.
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
  if (!['admin', 'partner', 'investor'].includes(user.role)) {
    return c.json({ error: 'Admins/partners/investors only' }, 403);
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
  if (!['admin', 'partner', 'investor'].includes(user.role)) {
    return c.json({ error: 'Admins/partners/investors only' }, 403);
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

  // Build queue #123 — REMOVED: a mock credit to limited_partners.returns.
  //
  // This block used to split the sale price equally across every LP row
  // belonging to the seller and add it to `returns`, described as "mock
  // real settlement". The write was not mock. `limited_partners.returns`
  // is read by routes/funds.ts (the /lp-portal performance rollup) to
  // compute the DPI and TVPI that real LPs are shown:
  //
  //     tvpi = (invested + returns + distributions) / invested
  //     dpi  = (returns + distributions) / invested
  //
  // So a simulated exit permanently inflated real LP-facing performance
  // figures — and did it by splitting proceeds across unrelated funds,
  // which the comment further down this same handler correctly calls
  // dangerous. The endpoint already tells the operator to run
  // POST /api/funds/distributions/execute with an explicit fund_id;
  // that remains the ONLY path that credits an LP ledger.
  //
  // Consequence, and it is the correct one: until a real distribution is
  // executed against the right fund, DPI stays where it was. An honest
  // zero beats a fabricated multiple in an LP report.

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
    // Secondary-exit settlement is simulated: we record the event and credit
    // mock LP returns, but no real funds move. Surfaced so the UI can label it.
    simulated: true,
    settlement: 'simulation',
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
  if (!['admin', 'partner', 'investor'].includes(user.role)) {
    return c.json({ error: 'Admins/partners/investors only' }, 403);
  }
  const items = await LiquidityEvents.listRecent(c.env, 100);
  return c.json({ ok: true, items });
});

// ---------------------------------------------------------------------------
// Proceeds + ROFR — the two questions a seller actually has
//
//   "What do I take home?"  -> computeNetProceeds
//   "Am I allowed to sell?" -> rofrStatus
//
// Both engines live in services/secondaryProceeds.ts and are covered by
// test/secondaryProceeds.test.ts. These routes are the only way to reach
// them.
//
// ACCESS: listing owner or admin, and nothing wider. A proceeds
// breakdown states the seller's cost basis and their net take; a broker
// arranging the sale has no business reading either. The marketplace
// and matching endpoints above stay open to partners/investors because
// they carry the asking price only.
//
// UNITS: this file's contract is integer cents, and the engines work in
// dollars. Rather than leak a second unit into the API, cents are
// converted on the way in and the engine's dollar output is converted
// back to cents on the way out. Every field crossing the wire is
// therefore `_cents`. The engine rounds to 2dp before we multiply by
// 100, so the round trip is exact.
// ---------------------------------------------------------------------------

let rofrSchemaReady = false;
async function ensureRofrSchema(env: Env): Promise<void> {
  if (rofrSchemaReady) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS secondary_rofr_notices (
       listing_id        INTEGER PRIMARY KEY REFERENCES secondary_listings(id) ON DELETE CASCADE,
       notice_date       TEXT,
       window_days       INTEGER NOT NULL DEFAULT 30,
       shares_offered    REAL NOT NULL DEFAULT 0,
       company_elected   REAL NOT NULL DEFAULT 0,
       investors_elected REAL NOT NULL DEFAULT 0,
       waived            INTEGER NOT NULL DEFAULT 0,
       notes             TEXT,
       created_by        INTEGER REFERENCES users(id),
       created_at        TEXT NOT NULL DEFAULT (datetime('now')),
       updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
  ).run();
  rofrSchemaReady = true;
}

/** The listing, if this user is allowed to see its private side. 404 either way. */
async function ownedListingOr404(c: any, id: number) {
  const user = await requireAuth(c);
  const listing: any = await c.env.DB.prepare(
    `SELECT * FROM secondary_listings WHERE id = ?`,
  ).bind(id).first();
  // Same 404 for "no such listing" and "not yours" — a different status
  // would confirm the listing exists to someone who cannot read it.
  if (!listing) return { listing: null, user };
  if (user.role !== 'admin' && listing.user_id !== user.id) return { listing: null, user };
  return { listing, user };
}

const centsToDollars = (cents: number) => Math.round(Number(cents) || 0) / 100;
const dollarsToCents = (dollars: number) => Math.round((Number(dollars) || 0) * 100);

// POST /api/liquidity/listings/:id/proceeds — model the seller's net wire.
//
// A calculator, not stored state: fee terms are negotiated per sale and
// a seller wants to try several. Nothing is written.
liquidity.post('/listings/:id/proceeds', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid listing id' }, 400);
  const { listing } = await ownedListingOr404(c, id);
  if (!listing) return c.json({ error: 'Listing not found' }, 404);

  const body: any = await c.req.json().catch(() => ({}));
  // Default to the asking price, but let the seller model a different
  // number — the point of the tool is answering "what if they offer X".
  const grossCents = body?.gross_cents != null
    ? Math.max(0, Math.round(Number(body.gross_cents) || 0))
    : Number(listing.asking_price_cents) || 0;

  const result = computeNetProceeds({
    gross: centsToDollars(grossCents),
    costBasis: body?.cost_basis_cents == null ? null : centsToDollars(body.cost_basis_cents),
    transferFeePct: body?.transfer_fee_pct ?? null,
    flatFees: body?.flat_fees_cents == null ? 0 : centsToDollars(body.flat_fees_cents),
    carryPct: body?.carry_pct ?? null,
    withholdingPct: body?.withholding_pct ?? null,
  });

  return c.json({
    ok: true,
    listing_id: id,
    gross_cents: dollarsToCents(result.gross),
    net_cents: dollarsToCents(result.net),
    gain_cents: result.gain === null ? null : dollarsToCents(result.gain),
    net_ratio: result.net_ratio,
    multiple: result.multiple,
    lines: result.lines.map((l) => ({
      key: l.key,
      label: l.label,
      amount_cents: dollarsToCents(l.amount),
      balance_cents: dollarsToCents(l.balance),
      note: l.note ?? null,
    })),
    warnings: result.warnings,
  });
});

// GET /api/liquidity/listings/:id/rofr — where the right stands today.
liquidity.get('/listings/:id/rofr', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid listing id' }, 400);
  const { listing } = await ownedListingOr404(c, id);
  if (!listing) return c.json({ error: 'Listing not found' }, 404);

  await ensureRofrSchema(c.env);
  const notice: any = await c.env.DB.prepare(
    `SELECT * FROM secondary_rofr_notices WHERE listing_id = ?`,
  ).bind(id).first();

  const today = new Date().toISOString().slice(0, 10);
  // No notice on file still gets a status, and that status is
  // 'not_started' / not clear to transfer. Returning nothing here would
  // leave the UI to invent a default, and the safe default is the one
  // the engine already encodes.
  const status = rofrStatus({
    notice_date: notice?.notice_date ?? null,
    window_days: notice?.window_days ?? null,
    shares_offered: Number(notice?.shares_offered ?? listing.shares ?? 0),
    company_elected: notice?.company_elected ?? 0,
    investors_elected: notice?.investors_elected ?? 0,
    waived: !!notice?.waived,
  }, today);

  return c.json({ ok: true, listing_id: id, as_of: today, notice: notice || null, status });
});

// PUT /api/liquidity/listings/:id/rofr — serve a notice, record elections
// or a waiver. Upsert: one live notice per listing.
liquidity.put('/listings/:id/rofr', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid listing id' }, 400);
  const { listing, user } = await ownedListingOr404(c, id);
  if (!listing) return c.json({ error: 'Listing not found' }, 404);

  const body: any = await c.req.json().catch(() => ({}));
  const noticeDate = body?.notice_date ? String(body.notice_date).slice(0, 10) : null;
  if (noticeDate && Number.isNaN(Date.parse(noticeDate))) {
    return c.json({ error: 'notice_date must be an ISO date (YYYY-MM-DD)' }, 400);
  }
  const windowDays = Math.max(1, Math.round(Number(body?.window_days) || 30));
  const offered = Math.max(0, Number(body?.shares_offered) || Number(listing.shares) || 0);
  const companyElected = Math.max(0, Number(body?.company_elected) || 0);
  const investorsElected = Math.max(0, Number(body?.investors_elected) || 0);
  // Elections are what the company and investors actually signed for. A
  // total above the offered block is a data-entry error, and silently
  // clamping it would hide the mistake behind a plausible number.
  if (companyElected + investorsElected > offered) {
    return c.json({
      error: `Elections total ${companyElected + investorsElected} shares but only ${offered} were offered`,
    }, 400);
  }

  await ensureRofrSchema(c.env);
  await c.env.DB.prepare(
    `INSERT INTO secondary_rofr_notices
       (listing_id, notice_date, window_days, shares_offered, company_elected,
        investors_elected, waived, notes, created_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(listing_id) DO UPDATE SET
       notice_date = excluded.notice_date,
       window_days = excluded.window_days,
       shares_offered = excluded.shares_offered,
       company_elected = excluded.company_elected,
       investors_elected = excluded.investors_elected,
       waived = excluded.waived,
       notes = excluded.notes,
       updated_at = datetime('now')`,
  ).bind(
    id, noticeDate, windowDays, offered, companyElected, investorsElected,
    body?.waived ? 1 : 0, body?.notes ? String(body.notes).slice(0, 2000) : null, user.id,
  ).run();

  const today = new Date().toISOString().slice(0, 10);
  const status = rofrStatus({
    notice_date: noticeDate, window_days: windowDays, shares_offered: offered,
    company_elected: companyElected, investors_elected: investorsElected,
    waived: !!body?.waived,
  }, today);

  await logActivity(c.env, user.id, 'secondary_rofr_updated', {
    entityType: 'secondary_listing', entityId: id,
    metadata: { state: status.state, clear_to_transfer: status.clear_to_transfer },
  }).catch(() => {});

  return c.json({ ok: true, listing_id: id, as_of: today, status });
});

export default liquidity;
