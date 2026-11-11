/**
 * #4715 (D4715) — Money: what a session was worth, the take rate, payouts, earnings and tax (migrations 205 and 241).
 *
 * Split out of routes/advisors.ts, which mounts it at the place these routes
 * held there (`advisors.route('/', …)`), so the paths and their order under
 * /api/advisors and /api/mentors are unchanged. Shared rows, checks and money
 * helpers come from services/advisorPractice.ts.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { type TierUser } from '../middleware/requireTier';
import { mapError, nowIso, newUid, jload, trimOrNull } from './_t13t14t15_helpers';
import { PAYOUT_GATE, cutCents, derivePayoutState, settlementMode, takeRate } from '../services/advisorMoney';
import { earningsOf, ledgerAggregate, type LedgerLine } from '../services/practiceReporting';
// D4704: the aggregate moved to services/practiceReporting.ts; re-exported for its importers.
export { ledgerAggregate, type LedgerLine };
import { PayoutAccountNotReady, SettlementDisabled, chargeSession, FeeSnapshotMissing, connectLink, ensurePayoutAccount, loadPayoutAccount, refreshAccount } from '../services/advisorConnect';
import { ensurePaymentsCustomer } from './payments';
import {
  type BookingRow, advisorMoney, bookingDto, parsePriceCents, requireMyAdvisor,
} from '../services/advisorPractice';

const advisors = new Hono<{ Bindings: Env }>();


// ---------------------------------------------------------------------------
// 205 — What a session was worth. Recording only; no money moves.
// ---------------------------------------------------------------------------
const BILLING_STATES = ['unpriced', 'billed', 'collected', 'written_off'];

/**
 * Price a session, or record what happened to that money.
 *
 * WHAT THIS IS NOT. No invoice is issued, no payment provider is called, no
 * obligation is created on Axal, and nothing is owed to anyone as a result of
 * this write. `billing_state` is the advisor's own note about their own
 * arrangement with their own client — see migration 205's header. Naming it
 * `billing_state` rather than `payment_status` is deliberate for that reason.
 *
 * ONLY THE ADVISOR ON THE BOOKING MAY WRITE IT. Not the founder, and not an
 * admin: what an advisor charged is theirs to state. An admin who needs to
 * correct it has the same route available under impersonation, which leaves an
 * audit trail — that is the difference between fixing a record and quietly
 * changing someone's books.
 */
advisors.patch('/me/bookings/:id/billing', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const row = await c.env.DB.prepare('SELECT * FROM advisor_bookings WHERE id = ?')
      .bind(Number(c.req.param('id'))).first<BookingRow & {
        amount_cents: number | null; billing_state: string;
        platform_cut_cents: number | null; take_rate_bps: number | null;
      }>();
    if (!row || row.advisor_id !== m.id) return c.json({ detail: 'Booking not found' }, 404);
    const body = await c.req.json().catch(() => ({} as any));

    const stored = row.amount_cents == null ? null : Number(row.amount_cents);
    const amount_cents = 'amount_cents' in body ? parsePriceCents(body.amount_cents) : stored;

    let billing_state = body.billing_state == null
      ? row.billing_state
      : String(body.billing_state).trim();
    if (!BILLING_STATES.includes(billing_state)) {
      return c.json({ detail: 'billing_state must be one of: unpriced, billed, collected, written_off' }, 400);
    }
    // A session with no amount cannot be billed, collected or written off —
    // there is no figure for any of those words to refer to. Rejecting rather
    // than silently coercing to 0, which would assert the session was free.
    if (amount_cents == null && billing_state !== 'unpriced') {
      return c.json({ detail: 'Set amount_cents before recording a billing state' }, 400);
    }
    // Naming an amount without saying anything about it means the session now
    // has a price and nothing has happened to it yet.
    if (amount_cents != null && billing_state === 'unpriced' && body.billing_state == null) {
      billing_state = 'billed';
    }

    // #4679 — THE PRICE, THE RATE AND THE CUT ARE A SNAPSHOT, AND A STATUS
    // UPDATE DOES NOT TOUCH THEM.
    //
    // This route used to re-stamp `platform_cut_cents` and `take_rate_bps` from
    // today's setting on every call, so marking a line 15%-priced as collected
    // after the operator moved the rate to 12% rewrote history. Now the
    // snapshot is written in exactly two cases, both a price decision:
    //   * the line had no price and now has one (first pricing), and
    //   * the advisor said `reprice: true` (explicit repricing).
    // Anything else keeps the stored amount, rate and cut as they are.
    const pricing = amount_cents !== stored;
    const repricing = body.reprice === true;
    if (body.reprice != null && typeof body.reprice !== 'boolean') {
      return c.json({ detail: 'reprice must be true or false' }, 400);
    }
    if ((pricing && stored != null) && !repricing) {
      return c.json({
        detail: 'This session already has a price. Send reprice: true to change it on purpose.',
        code: 'reprice_required',
      }, 409);
    }
    if (repricing && !('amount_cents' in body)) {
      return c.json({ detail: 'reprice needs the new amount_cents' }, 400);
    }
    if ((pricing || repricing) && stored != null
      && (row.billing_state === 'collected' || row.billing_state === 'written_off')) {
      // Money was taken, or the line was closed: a price change would restate
      // a settled figure. Refused rather than allowed with a flag.
      return c.json({
        detail: 'This session is already settled, so its price cannot be changed.',
        code: 'settled_price',
      }, 409);
    }

    let cut: number | null;
    let bps: number | null;
    if (amount_cents == null) {
      cut = null; bps = null;
    } else if (pricing || repricing) {
      const rate = await takeRate(c.env);
      cut = cutCents(amount_cents, rate.bps);
      bps = rate.bps;
    } else {
      cut = row.platform_cut_cents == null ? null : Number(row.platform_cut_cents);
      bps = row.take_rate_bps == null ? null : Number(row.take_rate_bps);
    }

    // COMPARE-AND-SWAP on the state this request read: an edit that lands
    // between the read and the write is a 409, not a silent overwrite.
    //
    // #4713 (D4713): a change of an amount already priced is written to
    // `advisor_booking_price_events` with who did it (and the admin behind an
    // impersonation) and the amount, rate and cut before and after. It runs in
    // the same batch, after the guarded update, and inserts only if that update
    // changed the row, so a refused or raced write leaves no event.
    const audited = (pricing || repricing) && stored != null && amount_cents !== stored;
    const update = c.env.DB.prepare(
      `UPDATE advisor_bookings
          SET amount_cents = ?, billing_state = ?,
              platform_cut_cents = ?, take_rate_bps = ?, updated_at = ?
        WHERE id = ? AND billing_state = ? AND amount_cents IS ?`
    ).bind(
      amount_cents, billing_state, cut, bps, nowIso(),
      row.id, row.billing_state, stored,
    );
    const writes = [update];
    if (audited) {
      writes.push(c.env.DB.prepare(
        `INSERT INTO advisor_booking_price_events
           (booking_id, actor_user_id, impersonated_by, from_amount_cents, to_amount_cents, from_take_rate_bps, to_take_rate_bps, from_cut_cents, to_cut_cents)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE changes() = 1`
      ).bind(
        row.id, Number(user.id), (user as any).impersonated_by ? Number((user as any).impersonated_by) : null,
        stored, amount_cents,
        row.take_rate_bps == null ? null : Number(row.take_rate_bps), bps,
        row.platform_cut_cents == null ? null : Number(row.platform_cut_cents), cut,
      ));
    }
    const [res] = await c.env.DB.batch(writes);
    if (Number((res as any)?.meta?.changes ?? 0) !== 1) {
      return c.json({
        detail: 'This session changed while you were editing it. Reload and try again.',
        code: 'booking_changed',
      }, 409);
    }
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_bookings WHERE id = ?')
      .bind(row.id).first<BookingRow & { amount_cents: number | null; billing_state: string }>();
    return c.json(bookingDto(fresh!, advisorMoney(fresh!)));
  } catch (e) { return mapError(c, e); }
});

/**
 * The founder pays for a session the advisor has priced.
 *
 * THE MISSING MIDDLE OF A STATE MACHINE THAT WAS BUILT FROM BOTH ENDS. The
 * PATCH above writes `billing_state = 'billed'` and stamps `amount_cents`,
 * `platform_cut_cents` and `take_rate_bps`; `markSessionCharged` in
 * `services/advisorConnect.ts` writes `'collected'` when Stripe's webhook says
 * the money arrived. Nothing wrote the transition between them, which is why
 * `chargeSession` was an exported function with no caller anywhere in the worker
 * — only its own test file referenced it. This route is that caller. D81.
 *
 * CLIENT-FACING, AND DELIBERATELY NOT UNDER `/me`. Everything under `/me` in
 * this file is the advisor reading or editing their own practice; `/bookings/:id/*`
 * is the family the founder acts on (`confirm`, `cancel`, `complete`, `review`).
 * Paying is the founder's act, so it belongs in the second family. An advisor
 * cannot charge a client from here, and neither can an admin: the only caller
 * who passes the ownership check is the person whose money it is.
 *
 * IT RETURNS 503 IN EVERY ENVIRONMENT TODAY, and that is the point rather than a
 * defect. `settlementMode()` answers `'none'` until `ADVISOR_CHARGING_ENABLED`
 * is exactly `'1'` AND a Stripe key is present, and that variable is set
 * nowhere. What changes is that the flag is now SUFFICIENT: before this route
 * existed, flipping it would have told advisors settlement was live — the value
 * is reported as `settlement:` by seven OTHER handlers in this file — while
 * nothing on any path could take a payment. D75, D81.
 *
 * THE SETTLEMENT CHECK IS FIRST AMONG THE NON-AUTH GUARDS, AND THAT ORDERING IS
 * LOAD-BEARING. `chargeSession` throws `SettlementDisabled` on its own, so the
 * route would refuse either way — but it throws AFTER this handler would have
 * called `ensurePaymentsCustomer`, which creates a Stripe customer and writes
 * `users.stripe_customer_id`. Checking here means a charge that cannot succeed
 * leaves no customer behind, no `held_unpaid` on the slot, and no D1 write of
 * any kind. The `catch` below still maps `SettlementDisabled`, because a guard
 * a caller can reorder is not a guard.
 */
/**
 * D4703 (#4703): the booking statuses a founder may pay. The cancellation-fee
 * policy is that there is none: `cancelled` and `no_show` are not payable.
 * A fee would be a new policy, and it would be added here by name.
 */
export const BOOKING_PAYABLE_STATUSES: readonly string[] = Object.freeze(['pending', 'confirmed', 'completed']);

advisors.post('/bookings/:id/pay', async (c) => {
  try {
    const user = await requireAuth(c);
    const row = await c.env.DB.prepare('SELECT * FROM advisor_bookings WHERE id = ?')
      .bind(Number(c.req.param('id'))).first<BookingRow>();
    // 404 ON SOMEONE ELSE'S BOOKING, NEVER 403. A 403 distinguishes "exists but
    // is not yours" from "does not exist", which is an enumeration oracle over
    // other people's sessions. The two answers are deliberately identical.
    if (!row || row.founder_user_id !== user.id) {
      return c.json({ detail: 'Booking not found' }, 404);
    }

    // D4703 (#4703): A CANCELLED SESSION IS NOT PAYABLE. There is no
    // cancellation-fee policy, so a booking that was cancelled or missed owes
    // nothing, whatever price was recorded on it before. Checked before
    // anything else so the answer is the same whether charging is on or off.
    if (!BOOKING_PAYABLE_STATUSES.includes(row.status)) {
      return c.json({
        detail: row.status === 'cancelled'
          ? 'This session was cancelled, so there is nothing to pay. No cancellation fee applies.'
          : 'This session did not take place, so there is nothing to pay.',
        status: row.status,
      }, 409);
    }

    const mode = settlementMode(c.env);
    if (mode === 'none') {
      return c.json({
        detail: 'Advisory charging is not switched on, so this session cannot be paid here yet.',
        settlement: mode,
      }, 503);
    }

    // THE BILLING STATE DECIDES, AND EACH REFUSAL NAMES WHOSE MOVE IT IS.
    // Collapsing these into one "cannot pay" would leave a founder unable to
    // tell "your advisor has not priced it" from "you already paid".
    if (row.billing_state === 'collected') {
      return c.json({ detail: 'This session is already paid.', billing_state: row.billing_state }, 409);
    }
    if (row.billing_state === 'written_off') {
      return c.json({ detail: 'This session was written off, so there is nothing to pay.' }, 409);
    }
    if (row.billing_state !== 'billed') {
      // `unpriced` lands here, and so would any state a later migration adds:
      // an unrecognised state is not a licence to charge.
      return c.json({ detail: 'Your advisor has not priced this session yet.' }, 409);
    }

    // A PRICE OF NULL OR ZERO IS NOT A FREE SESSION. `chargeSession` refuses it
    // too; this says which of its three refusals applied before a Stripe call.
    const gross = row.amount_cents == null ? null : Number(row.amount_cents);
    if (gross == null || !Number.isFinite(gross) || gross <= 0) {
      return c.json({ detail: 'This session has no amount to charge.' }, 409);
    }

    const account = await loadPayoutAccount(c.env, row.advisor_id);
    const state = derivePayoutState(account);
    if (!account || state !== 'verified') {
      // MIGRATION 240'S `held_unpaid` FINALLY HAS A WRITER. That column was
      // created to record "a slot taken by a booking that could not be charged",
      // and until now nothing ever set it — `markSessionCharged` only
      // transitions OUT of it. Scoped to `not_applicable` so a slot already
      // charged or refunded by another booking on the same capacity is never
      // walked backwards, and best-effort because the founder's answer does not
      // depend on the bookkeeping succeeding.
      try {
        await c.env.DB.prepare(
          `UPDATE advisor_office_hour_slots
              SET payment_state = 'held_unpaid'
            WHERE id = ? AND payment_state = 'not_applicable'`,
        ).bind(row.slot_id).run();
      } catch (e: any) {
        console.warn('[advisors] held_unpaid write failed:', String(e?.message || e));
      }
      // The gate sentence comes from `PAYOUT_GATE`, which exists so the worker
      // and the page cannot word the same state differently.
      return c.json({
        detail: 'This advisor cannot take payment yet.',
        payout_state: state,
        gate: PAYOUT_GATE[state] ?? null,
      }, 409);
    }

    // #4679 — refused BEFORE a Stripe customer is created: a line with no
    // stored fee cannot be charged, and finding that out after a side effect
    // is the ordering mistake the guards above exist to avoid.
    if ((row as any).take_rate_bps == null || (row as any).platform_cut_cents == null) {
      return c.json({
        detail: 'This session has no recorded fee, so it cannot be charged yet. Your advisor needs to confirm its price.',
        code: 'fee_snapshot_missing',
      }, 409);
    }

    const customerId = await ensurePaymentsCustomer(c.env, user as TierUser);
    const intent = await chargeSession(c.env, {
      account,
      bookingUid: row.uid,
      bookingId: row.id,
      advisorId: row.advisor_id,
      // THE BOOKING'S OWN STORED PRICE, never a recomputation. The advisor may
      // have discounted this one session below the catalogue, and 241 stamped
      // the cut against this figure; charging anything else would divide a
      // number the ledger does not hold.
      amountCents: gross,
      // #4679 — THE FEE IS THE LINE'S OWN SNAPSHOT, not today's setting.
      feeSnapshot: {
        bps: (row as any).take_rate_bps == null ? null : Number((row as any).take_rate_bps),
        cutCents: (row as any).platform_cut_cents == null ? null : Number((row as any).platform_cut_cents),
      },
      description: row.topic ? `Advisory session · ${row.topic}` : 'Advisory session',
      customerId,
    });

    // NO `payment_intent_id` IS STORED, and that is a decision rather than an
    // omission. `advisor_bookings` has no column for one and adding it is a
    // migration; nothing needs it, because `markSessionCharged` finds the
    // booking by `metadata.booking_uid` and `chargeSession`'s idempotency key
    // is derived from that same uid, so the intent is recoverable from Stripe
    // without a second copy here. D81 records it as a possible follow-up.
    return c.json({
      booking_uid: row.uid,
      client_secret: intent.client_secret,
      payment_intent_id: intent.payment_intent_id,
      amount_cents: gross,
      application_fee_cents: intent.application_fee_cents,
      take_rate_bps: intent.take_rate_bps,
      settlement: intent.mode,
    });
  } catch (e: any) {
    // The service's own refusals, mapped rather than surfaced as 500s. Both are
    // reachable even with the checks above, because the service is the authority
    // and a race between the two reads is exactly what it guards against.
    if (e instanceof SettlementDisabled) {
      // THE MODE COMES OFF THE THROWER, not from a literal and not from a second
      // `settlementMode()` read. `advisor_connect_leg.test.ts` forbids hard-coding
      // the mode anywhere in this file — a constant would keep reporting the same
      // word after the flag flips — and that guard caught the first draft of this
      // line. Note it scans the whole file as text, so it objects to the forbidden
      // pair appearing even in a comment; that is why this one describes it
      // instead of quoting it. Re-reading the env here would be wrong in a
      // different way: it could answer `test` about a refusal that happened
      // because the answer was `none`. `e.mode` is what the service decided.
      return c.json({
        detail: 'Advisory charging is not switched on, so this session cannot be paid here yet.',
        settlement: e.mode,
      }, 503);
    }
    if (e instanceof FeeSnapshotMissing) {
      return c.json({
        detail: 'This session has no recorded fee, so it cannot be charged yet. Your advisor needs to confirm its price.',
        code: 'fee_snapshot_missing',
      }, 409);
    }
    if (e instanceof PayoutAccountNotReady) {
      return c.json({
        detail: 'This advisor cannot take payment yet.',
        payout_state: e.state,
        gate: PAYOUT_GATE[e.state] ?? null,
      }, 409);
    }
    return mapError(c, e);
  }
});

/**
 * Earnings, rolled up from the bookings themselves.
 *
 * Every figure here is a SUM over rows an advisor entered, in cents, with no
 * estimate anywhere. `unpriced_count` is reported rather than hidden: an
 * earnings total that quietly ignored the sessions nobody has priced would be
 * a smaller number presented as a complete one. D4704: the figures are
 * `earningsOf(ledgerAggregate(...))`, the ledger's own definition.
 */
advisors.get('/me/earnings', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    // 241 — CARRIED HERE TOO, not only on the ledger, because this is the
    // payload the shipped Earnings page reads and that page said in so many
    // words that Axal "does not take a cut". A rate now exists; the page has
    // to be able to state it rather than deny it, and it needs the number and
    // the settlement mode in the same response to say both halves at once.
    const rate = await takeRate(c.env);
    // D4704: the same aggregate as the ledger and the annual summary, over all
    // time, so this overview and the ledger beside it cannot classify one
    // booking two ways (services/practiceReporting.ts).
    const agg = await ledgerAggregate(c.env, m.id, null, null, rate.bps);
    return c.json({
      currency: 'USD',
      take_rate: { bps: rate.bps, source: rate.source, updated_at: rate.updated_at },
      ...earningsOf(agg),
      // 241 — COMPUTED, NOT WRITTEN AS A LITERAL. This answered a hard-coded
      // 'none' before there was a take rate to be wrong about. It still
      // answers 'none' today, and it will keep answering it until PR5b's flag
      // flips — the difference is that turning settlement on is now one change
      // in `services/advisorMoney.ts` rather than a search for every surface
      // that promised it was off.
      settlement: settlementMode(c.env),
    });
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// 241 — the money model: a configurable take rate, the payout account that
// gates charging, the payout ledger, and the tax-year totals.
//
// NOTHING BELOW MOVES MONEY. Every figure is what a charge WOULD take,
// computed from a rate an operator sets and stamped per line when a price is
// recorded. `settlement` says which of the three modes is live, and while it
// says 'none' no surface may render any of this as a receipt. D75.
// ---------------------------------------------------------------------------

/** One row of D4's "By client · Q3" table, reconciling by construction. */
function clientLineDto(r: {
  client_name: string | null; client_user_id: number | null;
  sessions: number; gross_cents: number; cut_cents: number; unpriced: number;
  retainer_cents?: number | null; engagement_shape?: string | null;
}): any {
  return {
    client_user_id: r.client_user_id,
    // NAMED OR NOT RECORDED, never "Unknown". A booking whose user row is
    // gone still carries its money, and inventing a name for it would be a
    // claim about who paid.
    client_name: r.client_name,
    sessions: r.sessions,
    gross_cents: r.gross_cents,
    cut_cents: r.cut_cents,
    net_cents: r.gross_cents - r.cut_cents,
    // Carried per row rather than only in the total, because a client whose
    // sessions are mostly unpriced has a row that understates them and the
    // reader needs to see which one that is.
    unpriced_sessions: r.unpriced,
    // D4's Retainer column. NOT from `advisor_bookings` — migration 238's
    // header says so in as many words: "The reader is PR5/Earnings, whose
    // per-client table carries a `retainer` figure … That figure cannot come
    // from `advisor_bookings.amount_cents` … the cycle amount has to live
    // here or nowhere." So it is the engagement's own `amount_cents`, and
    // NULL means "no retainer recorded", never zero — an equity engagement is
    // the ordinary case of a row with no cents.
    retainer_cents: r.retainer_cents ?? null,
    // Which of 238's four shapes this client bills under, so the table can
    // say why a column is empty rather than leaving a gap.
    engagement_shape: r.engagement_shape ?? null,
  };
}

/**
 * The Earnings ledger: by client, with the cut as its own column.
 *
 * THE TOTAL IS THE SUM OF THE LINE CUTS, not the rate applied to the gross
 * total — D4's own note says *"The cut is charged per line, not netted at the
 * bottom"*, and the two arithmetics differ by up to a cent per line. A table
 * whose rows do not add up to its total is the most corrosive thing a ledger
 * can do, so `ledgerAggregate` is the only thing that adds here (#4702).
 *
 * PERIOD IS A HALF-OPEN INTERVAL on `created_at`. Absent means everything,
 * which is what "All time" asks for; the three other views pass explicit
 * bounds so the server never has to guess what quarter the reader meant.
 */
advisors.get('/me/ledger', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const from = trimOrNull(c.req.query('from'), 32);
    const until = trimOrNull(c.req.query('until'), 32);
    const rate = await takeRate(c.env);

    // #4702 (D4702): THE POPULATION IS ALL OF IT. The ledger read the 2,000
    // newest bookings and summed those, so the 2,001st session silently
    // dropped out of every total while the page still said "all time". The
    // totals, the clients and the annual summary now come from ONE aggregate
    // in the database over every booking in the window (`ledgerAggregate`), and
    // the response says how complete each part is (`completeness`).
    const agg = await ledgerAggregate(c.env, m.id, from, until, rate.bps);

    // THE RETAINER COLUMN COMES FROM THE ENGAGEMENT, NOT THE BOOKING — 238's
    // header is explicit that it "cannot come from `advisor_bookings.
    // amount_cents` … the cycle amount has to live here or nowhere". It is the
    // CONTRACT's value per cycle, not revenue earned in the window (sessions
    // priced in the window are the gross); and only an engagement in effect at
    // some point in the window counts, so a Q3 table does not show a retainer
    // that ended in Q1.
    //
    // Tolerated, not required: an advisor whose engagement table cannot be
    // read still gets their session ledger, with the retainer column reading
    // as absent rather than the page failing.
    let engagements: Array<{
      founder_user_id: number | null; client_name: string | null;
      shape: string; amount_cents: number | null;
    }> = [];
    let engagementsComplete = true;
    let engagementsRead = true;
    try {
      const er = await c.env.DB.prepare(
        `SELECT founder_user_id, client_name, shape, amount_cents
           FROM advisor_engagements
          WHERE advisor_id = ? AND lane IN ('signed', 'renewal_due', 'ended')
            AND (? IS NULL OR started_at IS NULL OR datetime(started_at) < datetime(?))
            AND (? IS NULL OR (lane != 'ended' AND ended_at IS NULL) OR (ended_at IS NOT NULL AND datetime(ended_at) >= datetime(?)))
          ORDER BY id LIMIT 501`
      ).bind(m.id, until, until, from, from).all<any>();
      const rows = er.results || [];
      engagementsComplete = rows.length <= 500;
      engagements = rows.slice(0, 500);
    } catch { engagements = []; engagementsRead = false; }

    const byClient = new Map<string, {
      client_name: string | null; client_user_id: number | null;
      sessions: number; gross_cents: number; cut_cents: number; unpriced: number;
      retainer_cents: number | null; engagement_shape: string | null;
    }>();
    const blank = (name: string | null, id: number | null) => ({
      client_name: name, client_user_id: id,
      sessions: 0, gross_cents: 0, cut_cents: 0, unpriced: 0,
      retainer_cents: null as number | null, engagement_shape: null as string | null,
    });
    for (const r of agg.clients) {
      const key = r.client_user_id == null ? 'none' : String(r.client_user_id);
      byClient.set(key, {
        ...blank(r.client_name ?? null, r.client_user_id ?? null),
        sessions: r.sessions, gross_cents: r.gross_cents, cut_cents: r.cut_cents, unpriced: r.unpriced,
      });
    }

    // Fold the engagements in, creating a row for a client who has a contract
    // and no priced session in this window — otherwise a retainer-only client
    // is invisible on the page that is supposed to show what the practice
    // earns. An engagement with no user id is keyed by name, which is 238's
    // own rule for a client who is not on the platform.
    let equityClients = 0;
    for (const e of engagements) {
      if (e.shape === 'equity') equityClients += 1;
      const key = e.founder_user_id == null
        ? `name:${String(e.client_name || '').toLowerCase()}`
        : String(e.founder_user_id);
      if (!byClient.has(key)) {
        byClient.set(key, blank(e.client_name ?? null, e.founder_user_id ?? null));
      }
      const g = byClient.get(key)!;
      if (!g.client_name) g.client_name = e.client_name ?? null;
      g.engagement_shape = g.engagement_shape || e.shape;
      // ONLY A RETAINER HAS A RETAINER FIGURE. A sprint's or a per-call
      // engagement's `amount_cents` is a different thing, and putting it in a
      // column headed "Retainer" would mislabel it; an equity engagement has
      // no cents at all, which is the ordinary case 238 names.
      if (e.shape === 'retainer' && e.amount_cents != null) {
        g.retainer_cents = (g.retainer_cents ?? 0) + Number(e.amount_cents);
      }
    }

    // #4679 merged with #4702: WHAT HAPPENED TO THE MONEY, one total per state,
    // read from the same aggregate as `totals` (`ledgerAggregate` sums each state
    // in the database over every booking in the window, with no row cap). Only
    // `collected` is money the advisor was paid, so only that is ever labelled
    // "received". A line is in exactly one of unpriced, billed, collected or
    // written_off; a voided session (cancelled or missed, never collected) is in
    // none and is counted on its own.
    // Refund rows are read on their own and tolerated: a collected charge on a
    // cancelled or missed session is owed back (open) or was refunded (resolved
    // by an operator). Nothing here moves money. One refund row per booking, as
    // before; the window is the booking's, as for every other figure here.
    const refundByBooking = new Map<number, { cents: number; resolved: boolean }>();
    // #5305: an unreadable refund store is null below, never "0 owed".
    let refundsRead = false;
    try {
      const rr = await c.env.DB.prepare(
        `SELECT r.booking_id AS booking_id, r.amount_cents AS amount_cents, r.resolved_at AS resolved_at
           FROM advisory_refunds_due r
           JOIN advisor_bookings b ON b.id = r.booking_id
          WHERE b.advisor_id = ?
            AND (? IS NULL OR datetime(b.created_at) >= datetime(?))
            AND (? IS NULL OR datetime(b.created_at) < datetime(?))`
      ).bind(m.id, from, from, until, until).all<{ booking_id: number; amount_cents: number | null; resolved_at: string | null }>();
      for (const r of rr.results || []) {
        if (r.amount_cents != null) {
          refundByBooking.set(Number(r.booking_id), {
            cents: Number(r.amount_cents), resolved: r.resolved_at != null,
          });
        }
      }
      refundsRead = true;
    } catch { /* table absent or unreadable: no refund figure, never a guess */ }
    const refundsFor = (resolved: boolean) => [...refundByBooking.values()].filter((r) => r.resolved === resolved);
    // PAID OUT is the provider paying the advisor, which is a separate event
    // from collecting. Read from the payout ledger in the same window; null
    // (never 0) when it could not be read.
    let paidOutCents: number | null = null;
    // #4834 (D4834): how many paid rows the sum covers, so the page draws a
    // "Paid out" figure only over payouts that were actually recorded, and
    // never a $0 card over an empty payout table. Null with the sum when unread.
    let paidOutCount: number | null = null;
    try {
      const po = await c.env.DB.prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS cents, COUNT(*) AS n
           FROM advisor_payouts
          WHERE advisor_id = ? AND state = 'paid'
            AND (? IS NULL OR datetime(COALESCE(paid_at, scheduled_for, created_at)) >= datetime(?))
            AND (? IS NULL OR datetime(COALESCE(paid_at, scheduled_for, created_at)) < datetime(?))`
      ).bind(m.id, from, from, until, until).first<{ cents: number; n: number }>();
      paidOutCents = Number(po?.cents ?? 0);
      paidOutCount = Number(po?.n ?? 0);
    } catch { paidOutCents = null; paidOutCount = null; }

    // #4834 (D4834): THE RECORDS BEHIND THE TOTALS, one per booking, so the
    // Practice v2 ledger (PX-07) can show each line's own price, billing state,
    // rate and fee. Same population as `ledgerAggregate` (a cancelled or missed
    // session counts only if collected), newest first, capped and saying so.
    //
    // THE RATE AND THE FEE ARE THE LINE'S OWN, AS STORED. A line priced before
    // migration 241 stamped them carries NULL, and it is sent as NULL: the
    // aggregate fills that gap with today's rate for its totals, which is a
    // different fact from a rate fixed when the line was priced, so `unfrozen`
    // counts those lines and the page says so. Tolerated: an unread list leaves
    // the totals standing (`lines.read: false`).
    const LINES_CAP = 200;
    let lines: {
      read: boolean; listed: number; total: number | null; complete: boolean | null;
      unfrozen: number | null; items: any[];
      other: { records: number; gross_cents: number; fee_cents: number; net_cents: number } | null;
    } = { read: false, listed: 0, total: null, complete: null, unfrozen: null, items: [], other: null };
    try {
      const lr = await c.env.DB.prepare(
        `SELECT b.id AS id, b.founder_user_id AS client_user_id, u.name AS client_name,
                b.topic AS topic, b.status AS status, b.created_at AS created_at,
                s.starts_at AS session_at,
                b.amount_cents AS amount_cents, b.billing_state AS billing_state,
                b.take_rate_bps AS take_rate_bps, b.platform_cut_cents AS platform_cut_cents
           FROM advisor_bookings b
           LEFT JOIN users u ON u.id = b.founder_user_id
           LEFT JOIN advisor_office_hour_slots s ON s.id = b.slot_id
          WHERE b.advisor_id = ?
            AND (? IS NULL OR datetime(b.created_at) >= datetime(?))
            AND (? IS NULL OR datetime(b.created_at) < datetime(?))
            AND NOT (b.status IN ('cancelled', 'no_show') AND COALESCE(b.billing_state, '') != 'collected')
          ORDER BY b.created_at DESC, b.id DESC
          LIMIT ?`
      ).bind(m.id, from, from, until, until, LINES_CAP + 1).all<any>();
      const un = await c.env.DB.prepare(
        `SELECT COUNT(*) AS n
           FROM advisor_bookings b
          WHERE b.advisor_id = ?
            AND (? IS NULL OR datetime(b.created_at) >= datetime(?))
            AND (? IS NULL OR datetime(b.created_at) < datetime(?))
            AND NOT (b.status IN ('cancelled', 'no_show') AND COALESCE(b.billing_state, '') != 'collected')
            AND b.amount_cents IS NOT NULL AND b.platform_cut_cents IS NULL`
      ).bind(m.id, from, from, until, until).first<{ n: number }>();
      const rows = lr.results || [];
      // #4702's rule for a capped list: the records past the cap are not lost,
      // they are one summed row, with the aggregate's own fee expression, so
      // the listed records plus this row add to the totals.
      let other: { records: number; gross_cents: number; fee_cents: number; net_cents: number } | null = null;
      if (rows.length > LINES_CAP) {
        const o = await c.env.DB.prepare(
          `SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS gross,
                  COALESCE(SUM(CASE WHEN amount_cents IS NULL THEN 0
                                    WHEN platform_cut_cents IS NOT NULL THEN platform_cut_cents
                                    ELSE CAST((amount_cents * COALESCE(take_rate_bps, ?)) / 10000 AS INTEGER) END), 0) AS cut
             FROM (SELECT b.amount_cents AS amount_cents, b.platform_cut_cents AS platform_cut_cents,
                          b.take_rate_bps AS take_rate_bps
                     FROM advisor_bookings b
                    WHERE b.advisor_id = ?
                      AND (? IS NULL OR datetime(b.created_at) >= datetime(?))
                      AND (? IS NULL OR datetime(b.created_at) < datetime(?))
                      AND NOT (b.status IN ('cancelled', 'no_show') AND COALESCE(b.billing_state, '') != 'collected')
                    ORDER BY b.created_at DESC, b.id DESC
                    LIMIT -1 OFFSET ?)`
        ).bind(rate.bps, m.id, from, from, until, until, LINES_CAP).first<{ n: number; gross: number; cut: number }>();
        const g = Number(o?.gross ?? 0); const cu = Number(o?.cut ?? 0);
        other = { records: Number(o?.n ?? 0), gross_cents: g, fee_cents: cu, net_cents: g - cu };
      }
      const items = rows.slice(0, LINES_CAP).map((r: any) => {
        const amount = r.amount_cents == null ? null : Number(r.amount_cents);
        const fee = r.platform_cut_cents == null ? null : Number(r.platform_cut_cents);
        const state = amount == null ? 'unpriced' : String(r.billing_state || 'billed');
        return {
          id: Number(r.id),
          client_user_id: r.client_user_id == null ? null : Number(r.client_user_id),
          client_name: r.client_name ?? null,
          topic: r.topic ?? null,
          status: r.status ?? null,
          session_at: r.session_at ?? null,
          created_at: r.created_at ?? null,
          amount_cents: amount,
          billing_state: state,
          // Collected is recorded as the line's whole price: there is no
          // separate collected amount in the store. Null when not collected.
          collected_cents: state === 'collected' ? amount : null,
          take_rate_bps: r.take_rate_bps == null ? null : Number(r.take_rate_bps),
          platform_fee_cents: fee,
          net_cents: amount != null && fee != null ? amount - fee : null,
        };
      });
      lines = {
        read: true,
        listed: items.length,
        total: agg.totals.sessions,
        complete: rows.length <= LINES_CAP,
        unfrozen: Number(un?.n ?? 0),
        items,
        other,
      };
    } catch { /* tolerated: `lines.read` stays false and the totals stand */ }
    const states = {
      billed: agg.states.billed,
      collected: agg.states.collected,
      written_off: agg.states.written_off,
      unpriced: { sessions: agg.states.unpriced },
      refunds_owed: refundsRead ? {
        sessions: refundsFor(false).length,
        amount_cents: refundsFor(false).reduce((n, r) => n + r.cents, 0),
      } : null,
      refunded: refundsRead ? {
        sessions: refundsFor(true).length,
        amount_cents: refundsFor(true).reduce((n, r) => n + r.cents, 0),
      } : null,
      paid_out_cents: paidOutCents,
      paid_out_count: paidOutCount,
      void_sessions: agg.voidSessions,
    };
    const clients = [...byClient.values()]
      .sort((a, b) => b.gross_cents - a.gross_cents)
      .map(clientLineDto);
    const top = clients[0];
    const totals = agg.totals;

    return c.json({
      currency: 'USD',
      from: from ?? null,
      until: until ?? null,
      clients,
      // Clients past the cap are not listed one by one, but they are not lost:
      // this row is their sum, so `clients` + `clients_other` = `totals`.
      clients_other: agg.other,
      totals: {
        gross_cents: totals.gross_cents,
        cut_cents: totals.cut_cents,
        net_cents: totals.net_cents,
        sessions: totals.sessions,
        priced_sessions: totals.priced,
        // Surfaced, never subtracted from view: a total that quietly skipped
        // the sessions nobody priced would be a smaller number presented as a
        // complete one.
        unpriced_sessions: totals.unpriced,
        // The money actually received: collected lines only, net of the cut.
        received_cents: states.collected.net_cents,
      },
      // #4702: what the figures cover, said in the payload so no surface has to
      // guess. Totals always cover every booking in the window; the client list
      // is capped and says so.
      completeness: {
        basis: 'Every booking created in the window, summed in the database. No row cap applies to the totals.',
        sessions: totals.sessions,
        clients: { listed: agg.clients.length, total: agg.clientsTotal, complete: agg.clientsTotal <= agg.clients.length },
        engagements: { read: engagementsRead, complete: engagementsComplete },
      },
      states,
      lines,
      // NULL WHEN THERE IS NOTHING TO CONCENTRATE. A share of zero gross is
      // not 0% — it is a question with no answer, and 0% reads as "well
      // spread", which is the opposite of what an empty quarter means.
      concentration: top && totals.gross_cents > 0
        ? { client_name: top.client_name, pct: Math.round((top.gross_cents / totals.gross_cents) * 100) }
        : null,
      take_rate: { bps: rate.bps, source: rate.source, updated_at: rate.updated_at },
      // D4's cut note says a client billing in equity is absent from a cash
      // table. Counted rather than asserted: "someone is missing from this
      // table" is a claim about the reader's own book, and the page says it
      // only when there is one.
      equity_clients: equityClients,
      settlement: settlementMode(c.env),
    });
  } catch (e) { return mapError(c, e); }
});

/**
 * 242 — the advisor's own note about one period.
 *
 * THE FOUR KEYS ARE THE FOUR CHIPS, and nothing else is storable. A key the
 * page cannot ask for is a row nobody will ever read back, and validating
 * here rather than trusting the client is what keeps the table's one-note-
 * per-period index meaningful.
 *
 * `all` and a year are deliberately in the set even though D4 draws quarters:
 * the chip row offers "Year to date" and "All time", and a note written under
 * one of those is as real as one written under a quarter.
 */
// #4834 (D4834): the Practice v2 period selector (PX-07) adds a calendar
// MONTH, `2026-11`, beside the quarter and the year. A custom range has no key
// and therefore no note: a note is the advisor's word on a named period.
const PERIOD_KEY = /^(\d{4}-Q[1-4]|\d{4}-(0[1-9]|1[0-2])|\d{4}|all)$/;

advisors.get('/me/period-notes/:key', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const key = String(c.req.param('key') || '');
    if (!PERIOD_KEY.test(key)) return c.json({ detail: 'period must be YYYY-MM, YYYY-Qn, YYYY or all' }, 400);
    const row = await c.env.DB.prepare(
      'SELECT * FROM advisor_period_notes WHERE advisor_id = ? AND period_key = ?'
    ).bind(m.id, key).first<any>();
    // ABSENT IS A 200 WITH `note: null`, not a 404. "You have not written one"
    // is the ordinary case and the card renders it; a 404 would make the page
    // treat a normal state as a failure.
    return c.json({
      period_key: key,
      note: row ? {
        uid: row.uid, body: row.body, source: row.source,
        figures: jload<any>(row.figures_json, null),
        updated_at: row.updated_at,
      } : null,
    });
  } catch (e) { return mapError(c, e); }
});

advisors.put('/me/period-notes/:key', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const key = String(c.req.param('key') || '');
    if (!PERIOD_KEY.test(key)) return c.json({ detail: 'period must be YYYY-MM, YYYY-Qn, YYYY or all' }, 400);
    const body = await c.req.json().catch(() => ({} as any));
    // #4679 — A NOTE IS FILED AGAINST THE PERIOD IT WAS WRITTEN FOR. The page
    // names that period in the body; if it is not the period in the URL (a
    // slow response from an earlier quarter saved after the reader moved on),
    // nothing is written. Absent is allowed so older clients keep working.
    if (body.period_key != null && String(body.period_key) !== key) {
      return c.json({
        detail: `This note was written for ${String(body.period_key).slice(0, 16)}, not ${key}. Nothing was saved.`,
        code: 'period_mismatch',
      }, 409);
    }
    const text = trimOrNull(body.body, 8000);
    if (!text) return c.json({ detail: 'A note needs some text. Use DELETE to remove one.' }, 400);
    const source = ['advisor', 'ai', 'edited'].includes(String(body.source))
      ? String(body.source) : 'advisor';
    // THE FIGURES ARE STAMPED WITH THE NOTE, not re-read later. A narrative
    // says "gross is $18,450"; if a session is priced tomorrow the table moves
    // and the sentence does not. Storing what was true when it was written is
    // what lets the page say so instead of showing two numbers and no reason.
    const figures = body.figures && typeof body.figures === 'object'
      ? JSON.stringify(body.figures).slice(0, 4000) : null;
    const now = nowIso();
    await c.env.DB.prepare(
      `INSERT INTO advisor_period_notes (uid, advisor_id, period_key, body, source, figures_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(advisor_id, period_key) DO UPDATE SET
         body = excluded.body, source = excluded.source,
         figures_json = excluded.figures_json, updated_at = excluded.updated_at`
    ).bind(newUid(), m.id, key, text, source, figures, now, now).run();
    const row = await c.env.DB.prepare(
      'SELECT * FROM advisor_period_notes WHERE advisor_id = ? AND period_key = ?'
    ).bind(m.id, key).first<any>();
    return c.json({
      period_key: key,
      note: {
        uid: row.uid, body: row.body, source: row.source,
        figures: jload<any>(row.figures_json, null), updated_at: row.updated_at,
      },
    });
  } catch (e) { return mapError(c, e); }
});

advisors.delete('/me/period-notes/:key', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const key = String(c.req.param('key') || '');
    if (!PERIOD_KEY.test(key)) return c.json({ detail: 'period must be YYYY-MM, YYYY-Qn, YYYY or all' }, 400);
    await c.env.DB.prepare(
      'DELETE FROM advisor_period_notes WHERE advisor_id = ? AND period_key = ?'
    ).bind(m.id, key).run();
    // Idempotent: discarding a note that was never written is not an error,
    // and answering 404 would make Discard fail on the ordinary second click.
    return c.json({ period_key: key, note: null });
  } catch (e) { return mapError(c, e); }
});

/**
 * The payout account and the gate it implies.
 *
 * ALWAYS ANSWERS, even for an advisor who has never started one — `pending`
 * with its gate sentence is a true statement about an account nobody has set
 * up, and a 404 here would make the card unrenderable rather than informative.
 * `started` is what distinguishes the two.
 */
advisors.get('/me/payout-account', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const row = await c.env.DB.prepare(
      'SELECT * FROM advisor_payout_accounts WHERE advisor_id = ?'
    ).bind(m.id).first<any>();
    const state = derivePayoutState(row);
    return c.json({
      started: !!row,
      state,
      gate: PAYOUT_GATE[state],
      provider: row?.provider ?? 'stripe',
      // The account id is NOT returned. It identifies a Stripe account and
      // nothing on the page needs it; the onboarding route in PR5b hands back
      // a link instead.
      charges_enabled: !!row?.charges_enabled,
      payouts_enabled: !!row?.payouts_enabled,
      blocked_reason: row?.blocked_reason ?? null,
      // Null means never asked, which is different from asked and refused.
      last_checked_at: row?.last_checked_at ?? null,
      settlement: settlementMode(c.env),
    });
  } catch (e) { return mapError(c, e); }
});

/**
 * Start or resume Connect onboarding, and hand back the URL to visit.
 *
 * NOT GATED ON THE CHARGING FLAG, deliberately. Connecting an account moves
 * no money, and an advisor verifying while advisory charging is off is
 * exactly how the platform gets ready to switch it on. What it does need is a
 * Stripe key, and the absence of one is an explicit 503 rather than a
 * simulated link — `util/paymentMode.ts`'s rule, which this route inherits
 * through the service.
 */
advisors.post('/me/payout-account/connect', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    if (!c.env.STRIPE_SECRET_KEY) {
      return c.json({ detail: 'Payouts are not configured on this environment.' }, 503);
    }
    const account = await ensurePayoutAccount(c.env, m.id, newUid());
    const link = await connectLink(c.env, account, (user as any).email || '', '/practice/earnings');
    return c.json({
      url: link.url,
      // SAID ON THE WAY IN, because an advisor who has just been asked to
      // verify a payout account will reasonably assume it is about to be
      // used. While settlement is 'none' it is not.
      settlement: settlementMode(c.env),
      note: settlementMode(c.env) === 'none'
        ? 'Connecting an account does not start any charging. Nothing is taken through Axal today.'
        : null,
    });
  } catch (e) { return mapError(c, e); }
});

/**
 * Ask the provider what the account can do now, and write the answer back.
 *
 * A FAILED REFRESH IS A 200 THAT SAYS SO. The card must render either way,
 * and "we could not ask" is not "blocked": the previous state and its
 * `last_checked_at` stay put so a reader can tell a fresh answer from a stale
 * one.
 */
advisors.post('/me/payout-account/refresh', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const account = await loadPayoutAccount(c.env, m.id);
    if (!account) {
      return c.json({ refreshed: false, state: 'pending', reason: 'not_started', started: false });
    }
    const res = await refreshAccount(c.env, account);
    return c.json({
      ...res,
      started: true,
      gate: PAYOUT_GATE[res.state] || null,
      settlement: settlementMode(c.env),
    });
  } catch (e) { return mapError(c, e); }
});

/** D4's payout history — date, amount, state. Newest first. */
advisors.get('/me/payouts', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const rows = await c.env.DB.prepare(
      `SELECT uid, amount_cents, currency, state, scheduled_for, paid_at,
              failure_reason, created_at
         FROM advisor_payouts WHERE advisor_id = ?
        ORDER BY COALESCE(paid_at, scheduled_for, created_at) DESC LIMIT 200`
    ).bind(m.id).all<any>();
    return c.json({
      items: (rows.results || []).map((r) => ({
        uid: r.uid,
        amount_cents: r.amount_cents,
        currency: r.currency,
        state: r.state,
        // Two different kinds of time, kept apart: `scheduled_for` is a
        // banking DAY and `paid_at` is the INSTANT it settled. A page that
        // formatted the first as a timestamp would move "Sep 1" for every
        // reader west of Greenwich.
        scheduled_for: r.scheduled_for,
        paid_at: r.paid_at,
        failure_reason: r.failure_reason,
      })),
      settlement: settlementMode(c.env),
    });
  } catch (e) { return mapError(c, e); }
});

/**
 * Tax-year totals.
 *
 * WHAT THIS IS, said in the payload rather than left to a component: a summary
 * of what THIS PLATFORM RECORDED in a calendar year. It is not an IRS Form
 * 1099, it is not issued by anyone, and it is not tax advice — `document`
 * carries that so no surface can render the number without the sentence, and
 * so a future CSV export inherits it.
 *
 * The year is the caller's calendar year over `created_at`, which is UTC.
 * Stated in `basis` rather than assumed, because an advisor near a year
 * boundary will otherwise wonder which side a late-December session fell.
 */
advisors.get('/me/tax-summary', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const raw = Number(c.req.query('year'));
    const year = Number.isInteger(raw) && raw >= 2000 && raw <= 2999
      ? raw
      : Number(nowIso().slice(0, 4));
    const rate = await takeRate(c.env);
    // #4702: the same aggregate the ledger uses, over the same population, so the
    // annual summary equals the ledger for the same window.
    const agg = await ledgerAggregate(c.env, m.id, `${year}-01-01T00:00:00.000Z`, `${year + 1}-01-01T00:00:00.000Z`, rate.bps);
    const totals = agg.totals;
    return c.json({
      year,
      currency: 'USD',
      gross_cents: totals.gross_cents,
      platform_cut_cents: totals.cut_cents,
      net_cents: totals.net_cents,
      sessions: totals.sessions,
      priced_sessions: totals.priced,
      unpriced_sessions: totals.unpriced,
      clients: agg.pricedClients,
      completeness: { basis: 'Every booking created in the year, summed in the database. No row cap applies.', sessions: totals.sessions },
      basis: 'Calendar year in UTC, by the date each session was booked.',
      document: {
        is_tax_form: false,
        note: 'A summary of what this platform recorded. It is not an IRS Form 1099, '
          + 'no tax document is issued by Axal, and this is not tax advice. '
          + 'Sessions with no price recorded are counted separately and are not in these totals.',
      },
      settlement: settlementMode(c.env),
    });
  } catch (e) { return mapError(c, e); }
});

export default advisors;
