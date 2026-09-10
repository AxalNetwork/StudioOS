/**
 * HQ · Revenue — the money rails, and the token P&L (Admin · Super canvas, H5).
 *
 * SUPER ADMIN ONLY.
 *
 *   GET /summary      one payload for the Revenue page
 *
 * WHAT THIS ENDPOINT IS FOR. The artboard draws five zones over three
 * revenue streams. Checking each against the database before writing this
 * changed what it could honestly be: two zones are real, one is half real,
 * and two have no store at all. The payload says which is which per zone
 * rather than returning a number for everything and letting the page guess.
 *
 *   By stream
 *     Licence fees   REAL. `territory_licences` carries `annual_fee_cents`,
 *                    `currency` and `status`, so the quarterly share of the
 *                    active annual fees is exactly what the canvas describes.
 *     Subscriptions  NOT RECORDED. `account_subscriptions` has a plan and a
 *                    status and NO amount, and `/api/admin/billing/ltv` reads
 *                    charges from the Stripe API per customer — there is no
 *                    local charge ledger to total a quarter from.
 *     Token margin   HALF. The COST is real (`ai_usage_logs.est_cost_usd`).
 *                    What was billed for tokens is stored nowhere, so the
 *                    margin cannot be derived, only the cost reported.
 *
 *   Token P&L by subsidiary   U1. Nothing ties inference spend to a licence.
 *   Statements and Stripe     No subsidiary-statement store exists at all.
 *   Promo budget              `promo_codes` has discounts and redemption caps.
 *                             There is no budget or per-subsidiary allocation.
 *
 * NO TOTAL IS SUMMED ACROSS CURRENCIES. Licence fees are denominated per
 * licence (`territory_licences.currency`, EUR by default) and `est_cost_usd`
 * is USD by its own name. Adding them would produce a headline figure that
 * is wrong by whatever the rate happens to be, presented to the precision of
 * a cent. Each currency is reported in its own bucket and the page shows
 * them apart.
 *
 * NO STRIPE CALL. Open disputes are real but live in the Stripe API, behind
 * `GET /api/admin/billing/disputes`. Fanning out to Stripe from a page-load
 * endpoint would make the whole payload as slow and as failure-prone as the
 * slowest external call; the page reads that endpoint separately so one
 * unreadable zone does not take the other four down with it.
 *
 * Mounted at /api/admin/revenue BEFORE the catch-all /api/admin in index.ts.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin } from '../auth';
import { DERIVED_UNAVAILABLE } from './licence';

const r = new Hono<{ Bindings: Env }>();

/** The calendar quarter `now` falls in, as ISO dates and a label. */
export function quarterOf(now: Date): { start: string; end: string; label: string } {
  const y = now.getUTCFullYear();
  const q = Math.floor(now.getUTCMonth() / 3);           // 0-3
  const start = new Date(Date.UTC(y, q * 3, 1));
  const end = new Date(Date.UTC(y, q * 3 + 3, 1));       // exclusive
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), label: `Q${q + 1} ${y}` };
}

r.get('/summary', async (c) => {
  await requireSuperAdmin(c);
  const env = c.env;
  const quarter = quarterOf(new Date());

  // ── Licence fees ──────────────────────────────────────────────────────
  // Per currency, never added together. `status = 'active'` only: a
  // suspended licence holds its territory but bills nothing, so it belongs
  // in the count of what is NOT contributing rather than in the total.
  let licenceFees: unknown;
  try {
    const rows = await env.DB.prepare(
      `SELECT currency, COUNT(*) AS licences, SUM(annual_fee_cents) AS annual_cents
         FROM territory_licences
        WHERE status = 'active' AND annual_fee_cents IS NOT NULL
        GROUP BY currency`,
    ).all<{ currency: string; licences: number; annual_cents: number }>();
    const suspended = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM territory_licences WHERE status = 'suspended'",
    ).first<{ n: number }>();
    const missingFee = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM territory_licences WHERE status = 'active' AND annual_fee_cents IS NULL",
    ).first<{ n: number }>();
    licenceFees = {
      available: true,
      // A quarter of each active annual fee. NOT pro-rated for a licence
      // that started mid-quarter — the contract bills annually and the
      // canvas asks for "the quarterly share of N active annual fees", so
      // this says which it is rather than implying a proration it does not do.
      basis: 'One quarter of each active annual fee, not pro-rated for a mid-quarter start.',
      by_currency: (rows.results || []).map((row) => ({
        currency: String(row.currency || 'EUR'),
        licences: Number(row.licences) || 0,
        annual_cents: Number(row.annual_cents) || 0,
        quarter_cents: Math.round((Number(row.annual_cents) || 0) / 4),
      })),
      suspended_licences: Number(suspended?.n) || 0,
      // Not folded into the figure above and not silently dropped: an active
      // licence with no fee recorded is a gap in the ledger, and a total
      // that quietly excludes it reads as complete when it is not.
      active_without_fee: Number(missingFee?.n) || 0,
    };
  } catch {
    licenceFees = { available: false, reason: 'The territory licence ledger could not be read.' };
  }

  // ── Token cost ────────────────────────────────────────────────────────
  // The cost side only. `est_cost_usd` is what the inference cost; nothing
  // records what was charged for it, so no margin is derived here.
  let tokenCost: unknown;
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS calls, SUM(est_cost_usd) AS usd
         FROM ai_usage_logs
        WHERE created_at >= ? AND created_at < ?`,
    ).bind(quarter.start, quarter.end).first<{ calls: number; usd: number }>();
    tokenCost = {
      available: true,
      currency: 'USD',
      calls: Number(row?.calls) || 0,
      cost_usd: Number(row?.usd) || 0,
      // The half that does not exist, named rather than estimated.
      billed_available: false,
      billed_reason:
        'What the platform charged for tokens is not stored anywhere: `ai_usage_logs` records the '
        + 'cost of each call and no table records the price. The margin the canvas draws is the '
        + 'difference between the two, so it is not shown rather than shown as the cost alone.',
    };
  } catch {
    tokenCost = { available: false, reason: 'The AI usage log could not be read.' };
  }

  // ── Promotions ────────────────────────────────────────────────────────
  // What `promo_codes` actually holds, which is not a budget. Reported as
  // itself rather than dressed up as the "promo budget left" the canvas
  // draws: HQ allocating a spend ceiling per subsidiary does not exist.
  let promos: unknown;
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS codes, SUM(times_redeemed) AS redemptions
         FROM promo_codes WHERE active = 1`,
    ).first<{ codes: number; redemptions: number }>();
    promos = {
      available: true,
      active_codes: Number(row?.codes) || 0,
      redemptions: Number(row?.redemptions) || 0,
      budget_available: false,
      budget_reason:
        'There is no promotional budget in the product. `promo_codes` carries a discount and an '
        + 'optional redemption cap per code; nothing allocates a spend ceiling, and nothing '
        + 'attributes a code to a subsidiary, so neither "budget left" nor a per-subsidiary '
        + 'split has a source.',
    };
  } catch {
    promos = { available: false, reason: 'The promotion codes table could not be read.' };
  }

  return c.json({
    quarter,
    licence_fees: licenceFees,
    token_cost: tokenCost,
    promos,

    // Subscriptions. Not a read that failed — a figure the platform cannot
    // produce, which is a different thing and says so.
    subscriptions_available: false,
    subscriptions_reason:
      'Subscription revenue is not totalled anywhere in the database. `account_subscriptions` '
      + 'records a plan and a status but no amount, and the lifetime-value endpoint reads charges '
      + 'from the Stripe API one customer at a time. A quarter figure would mean walking every '
      + 'customer in Stripe on page load.',

    // Statements between HQ and each subsidiary.
    statements_available: false,
    statements_reason:
      'No subsidiary statement store exists. `engagement_invoices` bills an engagement, not a '
      + 'licensee, so what each subsidiary owes HQ this quarter has never been recorded.',

    // Open disputes are real, and deliberately not fetched here.
    disputes_endpoint: '/api/admin/billing/disputes',

    // Token P&L by subsidiary, and every other per-subsidiary figure.
    ...DERIVED_UNAVAILABLE,
  });
});

export default r;
