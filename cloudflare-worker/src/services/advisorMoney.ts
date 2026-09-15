/**
 * The advisory take rate and the arithmetic that divides a line by it.
 *
 * ONE PLACE, because a rate is the kind of number that gets copied. It is read
 * by the earnings roll-up, by the per-line stamp on `PATCH /me/bookings/:id/
 * billing`, by the tax summary, by the admin form that changes it, and — once
 * PR5b lands — by the Stripe `application_fee_amount`. Five call sites
 * multiplying their own literal is five chances for a quarter to disagree with
 * itself, and the one that disagrees is the one nobody checks.
 *
 * NOTHING HERE CHARGES ANYBODY. Migration 241's header says it at length; the
 * short version is that this computes what a charge WOULD take. The advisory
 * service leg is PR5b, wired to test keys with production charging behind a
 * flag routed through `util/paymentMode.ts`. Until then `settlementMode()`
 * below answers `'none'`, and every surface that renders a cut says so rather
 * than letting a number imply a receipt. D75.
 *
 * BASIS POINTS. 1500 is 15%. Integers, so `gross - cut = net` closes exactly
 * with no residue in any total (`scripts/check-money-cents.mjs` exists because
 * the float half of this schema kept growing).
 */
import type { Env } from '../types';
import { isProductionEnv } from '../util/paymentMode';

/**
 * The key in `platform_settings`. Exported because the admin route and the
 * tests must name the same string, and a typo in one of them is a silent
 * fallback to the default rather than an error.
 */
export const TAKE_RATE_KEY = 'advisor_take_rate_bps';

/**
 * What the rate is when the setting cannot be read.
 *
 * 1500 bps = 15%, which is NOT a number from a canvas fixture: it is
 * `DEFAULT_APPLICATION_FEE_PCT` in `services/wellbeing/bookings.ts`, the
 * platform's shipped default application fee for its other paid-session
 * product. Migration 241 seeds the same value, so this constant and the row
 * agree on a fresh database and the fallback is not a different policy.
 */
export const DEFAULT_TAKE_RATE_BPS = 1500;

/**
 * The ceiling an operator may set, and the reason there is one.
 *
 * `services/wellbeing/bookings.ts` clamps its own fee to 0–50% and falls back
 * to the default outside that range. The same bound applies here for the same
 * reason: a rate above half of gross is far more likely to be a typo — 50
 * entered where 5000 bps was meant — than a policy, and a typo that ships
 * takes real money from real advisors before anyone notices.
 */
export const MAX_TAKE_RATE_BPS = 5000;

export interface TakeRate {
  bps: number;
  /** Where this number came from, so a caller can say rather than imply. */
  source: 'setting' | 'default';
  /** When an operator last changed it, or null if it is still the seed. */
  updated_at: string | null;
  updated_by: string | null;
}

/**
 * Read the current rate.
 *
 * A FAILED READ FALLS BACK AND SAYS SO. It does not throw: an earnings page
 * that cannot render because a settings row is missing is worse than one that
 * renders at the documented default and names it. `source` is what lets the
 * caller tell the two apart, which is the same distinction 240's `configured`
 * flag draws for availability rules.
 */
export async function takeRate(env: Env): Promise<TakeRate> {
  try {
    const row = await env.DB.prepare(
      'SELECT value, updated_at, updated_by FROM platform_settings WHERE key = ?',
    ).bind(TAKE_RATE_KEY).first<{ value: string; updated_at: string | null; updated_by: string | null }>();
    // PARSED FROM A NON-EMPTY DIGIT STRING, not handed to `Number`.
    //
    // `Number('')` is 0 and `Number('  ')` is 0, so a blank value in this row
    // would have become a 0% take rate reported as a deliberate SETTING — the
    // platform charging nothing, on the strength of a column somebody emptied.
    // That is the D56/D68 failure in its purest form, and this test caught it:
    // every other bad value (`'15.5'`, `'-1'`, `'5001'`, `'banana'`) was
    // already refused, and only the empty one slipped through as a number.
    const text = String(row?.value ?? '').trim();
    const parsed = /^\d+$/.test(text) ? Number(text) : NaN;
    if (row && Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_TAKE_RATE_BPS) {
      return {
        bps: parsed,
        source: 'setting',
        updated_at: row.updated_at ?? null,
        updated_by: row.updated_by ?? null,
      };
    }
  } catch {
    // Fall through. The table may not exist yet on a database that has not
    // taken 241, which is exactly when a default is the right answer.
  }
  return { bps: DEFAULT_TAKE_RATE_BPS, source: 'default', updated_at: null, updated_by: null };
}

/**
 * The platform's cut of one line, in integer cents.
 *
 * FLOOR, NOT ROUND, and the difference is not pedantry. A rounded cut can come
 * out above the stated percentage — 15.0002% of a gross that divides badly —
 * and a fee the terms do not describe is a fee somebody can dispute. Rounding
 * down can only ever favour the advisor, and the residue is under one cent per
 * line at every rate.
 *
 * A gross that is absent or nonsensical returns **null**, never 0: "no price
 * was set" and "the cut on this line is nothing" are different facts, and a
 * zero here would put the second in front of a reader who is owed the first
 * (D56/D68).
 */
export function cutCents(grossCents: number | null | undefined, bps: number): number | null {
  if (grossCents == null) return null;
  const g = Number(grossCents);
  if (!Number.isFinite(g) || g < 0) return null;
  const rate = Number.isFinite(bps) && bps >= 0 ? Math.min(bps, MAX_TAKE_RATE_BPS) : DEFAULT_TAKE_RATE_BPS;
  return Math.floor((Math.trunc(g) * Math.trunc(rate)) / 10_000);
}

/**
 * Gross, cut and net for one line, as a set that reconciles by construction.
 *
 * Returned together rather than computed separately by each caller, because
 * `net` derived anywhere but here is `gross - cut` re-implemented, and the
 * re-implementation is where a rounding choice quietly differs.
 */
export function splitLine(grossCents: number | null | undefined, bps: number): {
  gross_cents: number | null; cut_cents: number | null; net_cents: number | null;
} {
  const cut = cutCents(grossCents, bps);
  if (cut == null || grossCents == null) {
    return { gross_cents: null, cut_cents: null, net_cents: null };
  }
  const gross = Math.trunc(Number(grossCents));
  return { gross_cents: gross, cut_cents: cut, net_cents: gross - cut };
}

/**
 * Sum a set of lines into a total that reconciles with them.
 *
 * THE TOTAL IS THE SUM OF THE LINE CUTS, not the rate applied to the gross
 * total, and D4 states the rule in its own note: *"The cut is charged per
 * line, not netted at the bottom."* Those two arithmetics differ by up to one
 * cent per line, so a page showing both would show a table that does not add
 * up — which is the single most corrosive thing a ledger can do.
 *
 * Lines with no price contribute to neither total and are counted separately,
 * so a reader can see that a quarter's figure covers fewer sessions than the
 * quarter held.
 */
export function totalLines(
  lines: Array<{ amount_cents: number | null; take_rate_bps?: number | null }>,
  fallbackBps: number,
): { gross_cents: number; cut_cents: number; net_cents: number; priced: number; unpriced: number } {
  let gross = 0; let cut = 0; let priced = 0; let unpriced = 0;
  for (const line of lines) {
    // THE LINE'S OWN RATE WINS. A historical line stamped at 15% must stay at
    // 15% after an operator moves the setting to 12%, or last quarter restates
    // itself every time someone touches a form (migration 241's header).
    const bps = line.take_rate_bps != null ? Number(line.take_rate_bps) : fallbackBps;
    const split = splitLine(line.amount_cents, bps);
    if (split.gross_cents == null || split.cut_cents == null) { unpriced++; continue; }
    gross += split.gross_cents;
    cut += split.cut_cents;
    priced++;
  }
  return { gross_cents: gross, cut_cents: cut, net_cents: gross - cut, priced, unpriced };
}

/**
 * What actually happens to the money, said in one word the page can render.
 *
 * `'none'` is what `GET /me/earnings` has always answered and it stays true
 * until PR5b's flag flips. It is computed rather than written as a literal in
 * each route so that turning settlement on is one change here, not a search
 * for every surface that promised it was off.
 *
 * The two inputs are deliberately the ones `util/paymentMode.ts` already owns:
 * a settlement claim must never rest on a second, looser reading of whether
 * this is production.
 */
export function settlementMode(env: Env): 'none' | 'test' | 'live' {
  // ADVISORY CHARGING IS OFF, FULL STOP, until PR5b. The expression below is
  // the shape it will take — a live settlement requires production AND a key
  // AND the flag — and it is written out rather than returned as a bare
  // constant so the reader can see what the flag will govern.
  const enabled = String((env as any).ADVISOR_CHARGING_ENABLED || '') === '1';
  if (!enabled) return 'none';
  if (!(env as any).STRIPE_SECRET_KEY) return 'none';
  return isProductionEnv(env) ? 'live' : 'test';
}

/**
 * D4's three payout states and the gate each one implies, verbatim from the
 * artboard. Held here rather than in a component so the worker and the page
 * cannot describe the same state differently — the gate sentence is what an
 * advisor reads to understand why a paid slot is or is not bookable.
 */
export const PAYOUT_GATE: Record<string, string> = {
  verified: 'Paid sessions bookable and chargeable.',
  pending: 'Bookable, held uncharged until verification clears.',
  blocked: 'Paid slots hidden from your profile. Free intro calls still bookable.',
};

/**
 * The state an account is in, derived from what the provider last told us.
 *
 * DERIVED HERE, STORED THERE. `advisor_payout_accounts.state` is written from
 * this so a page can render when the provider cannot be reached, and
 * `last_checked_at` is how a reader tells a fresh answer from a stale one.
 * An account nobody has started is `pending`, not `blocked`: not yet asked is
 * not refused.
 */
export function derivePayoutState(row: {
  charges_enabled?: number | null; payouts_enabled?: number | null; blocked_reason?: string | null;
} | null | undefined): 'pending' | 'verified' | 'blocked' {
  if (!row) return 'pending';
  if (row.blocked_reason) return 'blocked';
  return row.charges_enabled && row.payouts_enabled ? 'verified' : 'pending';
}
