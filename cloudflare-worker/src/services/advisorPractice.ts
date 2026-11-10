/**
 * #4715 (D4715) — what more than one advisor route module needs: the advisor
 * and booking rows with their DTOs and the booking's offer, the engagement row
 * and its owned-record loader, the caller's advisor (`myAdvisor`,
 * `requireMyAdvisor`), the money helpers (`advisorMoney`, `parsePriceCents`),
 * the validation refusal and the list page sizes. These sat in
 * routes/advisors.ts; it and the route modules split out of it (advisors_*.ts)
 * import them from here, so there is still one implementation of each.
 */
import { actingAdvisor, mayActAsAdvisor, ADVISOR_LICENCE_REQUIRED } from '../services/advisorAccess';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { refuse } from '../util/refusal';
import { AdvisorValidationError, wholeCents } from '../services/advisorLimits';
import { ensureAdvisorStoresSchema } from '../services/advisorStoresSchema';

/** #4714 (D4714): a Practice list page. Totals are always over the whole set. */
export const PRACTICE_PAGE = 400;

/** #4689: the most rows one page of each Expertise list returns (the caps they had). */
export const SERVICES_PAGE = 200;
export const PROOF_PAGE = 200;
export const THINKING_PAGE = 100;

export type AdvisorRow = {
  id: number; uid: string; user_id: number | null;
  display_name: string; email: string | null; bio: string | null;
  expertise_json: string; sectors_json: string;
  linkedin_url: string | null; hourly_rate_usd: number | null;
  is_active: number; created_at: string; updated_at: string;
  // Migration 202. All nullable: each is a fact only the advisor holds, and an
  // unset one must read as absent rather than as an empty answer.
  headline?: string | null; stages_json?: string | null;
  languages_json?: string | null; country?: string | null;
  timezone?: string | null; availability_note?: string | null;
  headshot_url?: string | null;
};
export type BookingRow = {
  id: number; uid: string; slot_id: number; advisor_id: number;
  founder_user_id: number; topic: string | null; notes: string | null;
  status: string; cancel_reason: string | null;
  // Migration 205. Declared here because `bookingDto` returns them: the two
  // were on the row and off the type, so nothing complained when the DTO
  // dropped them for a year.
  amount_cents: number | null; billing_state: string;
  created_at: string; updated_at: string;
  session_type_id?: number | null; booking_link_id?: number | null;
  offer_json?: string | null;
  // #4702: the advisor's answer, kept apart from what happened to the session.
  advisor_decision?: 'accepted' | 'declined' | null; advisor_decided_at?: string | null;
  cancelled_by?: 'advisor' | 'client' | 'admin' | 'system' | null;
};
/**
 * D4715 (#4715) — the offer a booking is made on, copied from its session type
 * at booking time so a later rename, length change or reprice of the type does
 * not rewrite what was booked. `pricing` uses the session-type editor's own
 * modes: `free` (a free intro), `included`, `price` (with `price_cents`) and
 * `unset`.
 */
export type BookingOffer = {
  session_type_id: number; name: string; duration_minutes: number | null;
  pricing: 'free' | 'included' | 'price' | 'unset'; price_cents: number | null;
  cadence_note: string | null;
};
export function readOffer(raw: string | null | undefined): BookingOffer | null {
  if (!raw) return null;
  try { const o = JSON.parse(raw); return o && typeof o === 'object' && typeof o.name === 'string' ? o : null; } catch { return null; }
}

/**
 * The booking as BOTH parties may see it. Deliberately no money — see
 * `advisorMoney` below for the two columns that are the advisor's alone.
 */
export function bookingDto(b: BookingRow, extras: any = {}): any {
  return {
    id: b.id, uid: b.uid, slot_id: b.slot_id, advisor_id: b.advisor_id,
    founder_user_id: b.founder_user_id,
    topic: b.topic, notes: b.notes, questions: b.notes, client_message: b.notes, status: b.status,
    cancel_reason: b.cancel_reason,
    session_type_id: b.session_type_id ?? null, booking_link_id: b.booking_link_id ?? null,
    // D4715: the terms the booking was made on, as copied then (null before the copy existed).
    offer: readOffer(b.offer_json),
    created_at: b.created_at, updated_at: b.updated_at,
    ...extras,
  };
}

/**
 * Migration 205's two columns, for the advisor's own reads only.
 *
 * THE BUG THIS EXISTS TO FIX. Migration 205 added `amount_cents` and
 * `billing_state` to `advisor_bookings`, and `PATCH /me/bookings/:id/billing`
 * named them in its own response — but `bookingDto`, which every LIST goes
 * through, is a whitelist and never did. `GET /me/bookings` selects `b.*`, so
 * both columns arrived at the DTO and were dropped on the way out.
 *
 * `pages/advisor/practice/SessionsZone.jsx` is the page built specifically to
 * show that money. With both fields undefined it rendered "Not recorded" on
 * every row including priced ones, an empty state pill, "Set a price" where it
 * should have said "Change", and an unpriced count that disagreed with
 * Earnings — and, worst, its editor opened blank over a stored price and
 * overwrote it on save. A whitelist that silently drops a column is
 * indistinguishable from a column nobody ever wrote.
 *
 * WHY THIS IS A SEPARATE FUNCTION RATHER THAN TWO MORE LINES IN `bookingDto`.
 * Three of the five DTO call sites answer the FOUNDER or either party:
 * `POST /slots/:id/book` replies to the founder who just booked,
 * `GET /bookings/me` is the founder's own list, and `transition()` answers
 * whichever side moved the booking. Migration 205's header is explicit that
 * `billing_state` is "the advisor's own bookkeeping note about their own
 * arrangement" — no invoice is issued and Axal takes no position on
 * collection — so `written_off` reaching the client would disclose that their
 * advisor gave up collecting from them. Restoring the field to the shared DTO
 * would have fixed a display bug by opening a leak, which is why the fix is
 * scoped to the audience instead. Call this from advisor-authenticated reads;
 * never from a founder-facing one.
 *
 * `billing_state` has a NOT NULL DEFAULT, so `?? 'unpriced'` only covers a row
 * read through a path that did not select it. `amount_cents` is genuinely
 * nullable and stays null — zero is a price an advisor may actually mean.
 */
export function advisorMoney(b: Partial<BookingRow>): {
  amount_cents: number | null; billing_state: string;
  platform_cut_cents: number | null; take_rate_bps: number | null; net_cents: number | null;
} {
  const gross = b.amount_cents ?? null;
  // 241 — THE STORED CUT, NOT A RECOMPUTED ONE. `platform_cut_cents` is what
  // this line was actually divided by, stamped when the price was set. A null
  // cut on a priced line means "recorded before 241", which is a different
  // fact from a cut of nothing, and `net_cents` stays null with it rather than
  // reporting gross as if the advisor kept all of it (D56/D68).
  const cut = (b as any).platform_cut_cents ?? null;
  return {
    amount_cents: gross,
    billing_state: b.billing_state ?? 'unpriced',
    platform_cut_cents: cut,
    take_rate_bps: (b as any).take_rate_bps ?? null,
    net_cents: gross != null && cut != null ? gross - cut : null,
  };
}
/** #4715: the policy's eligibility and ownership checks (services/advisorAccess.ts). */
export async function myAdvisor(env: Env, user: User): Promise<AdvisorRow | null> {
  return actingAdvisor<AdvisorRow & { user_id: number | null }>(env, user);
}

/**
 * D4674: a value over its limit, an unsupported currency or a malformed price is
 * a 400 that names the field. `null` when the error is not one of those.
 */
export function validationRefusal(c: any, e: unknown) {
  if (!(e instanceof AdvisorValidationError)) return null;
  return refuse(c, 400, { code: e.code, message: e.sentence });
}

/** D4674: the revision a client read (`updated_at`), or null when it sent none. */
export const sentRevision = (body: any): string | null =>
  typeof body?.revision === 'string' && body.revision ? body.revision : null;
// ===========================================================================
// The advisor's own stores — migrations 203–206.
//
// EVERY READ IS SCOPED ON THE SIGNED-IN USER, never on a path parameter. The
// pattern is the one `routes/partnernet.ts:224` and `routes/introductions.ts:226`
// already use: resolve the caller's own row first, then filter by its id. An
// advisor cannot name someone else's practice because there is nowhere to put
// the name.
//
// NO MONEY MOVES THROUGH ANY OF THIS. Services carry a price and bookings carry
// an amount because an advisor needs to write down what they charge and what
// they were paid. Nothing here calls a payment provider, issues an invoice, or
// creates an obligation on Axal — see the header of migration 205.
// ===========================================================================

/** #5363: an eligible account that owns no advisor row. Our sentence, a fixed code. */
export const ADVISOR_PROFILE_MISSING = {
  code: 'advisor_profile_missing',
  message: 'No advisor profile attached to your account',
} as const;

/**
 * The caller's own advisor row, or a thrown coded refusal.
 *
 * Also the single door every store endpoint below goes through, which is where
 * the lazy schema bootstrap belongs — one call site rather than nine, and it
 * short-circuits on a database that already has the schema. See
 * `services/advisorStoresSchema.ts` for why a bootstrap is required at all.
 *
 * #5363: TWO REFUSALS, TOLD APART. An account that is not eligible
 * (`mayActAsAdvisor` false: no Advisor licence today, or one revoked, and not
 * an admin) gets the same 403 `advisor_licence_required` that `GET`/`POST
 * /me` answer, so the page can say "needs the Advisor licence" instead of a
 * generic failure. An eligible account with no row of its own keeps today's
 * 400 under the fixed code `advisor_profile_missing`. Both are thrown as a
 * Response, which `mapError` passes through untouched; neither carries
 * exception text. Who passes is D4715's policy, unchanged.
 */
export async function requireMyAdvisor(c: Context<{ Bindings: Env }>, user: User): Promise<AdvisorRow> {
  if (!mayActAsAdvisor(user)) throw refuse(c, 403, ADVISOR_LICENCE_REQUIRED);
  await ensureAdvisorStoresSchema(c.env);
  const m = await myAdvisor(c.env, user);
  if (!m) throw refuse(c, 400, ADVISOR_PROFILE_MISSING);
  return m;
}

/**
 * Parse a price into integer cents, or throw.
 *
 * Takes `price_cents` only — deliberately NOT a dollars field. A route that
 * accepted both would need a rule for which wins when a caller sends both, and
 * every rounding decision that followed would be invisible at the boundary.
 * One unit, named after the column it lands in.
 */
export function parsePriceCents(v: unknown): number | null {
  return wholeCents(v);
}

export type EngagementRow = {
  id: number; uid: string; advisor_id: number;
  founder_user_id: number | null; client_name: string;
  lane: string; shape: string;
  scope_label: string | null; scope_includes: string | null; scope_excludes: string | null;
  amount_cents: number | null;
  proposed_at: string | null; started_at: string | null;
  term_ends_at: string | null; ended_at: string | null;
  cycles: number; outcome: string | null; renewal_note: string | null;
  created_at: string; updated_at: string;
};

/**
 * One engagement of the caller's own, or a thrown 404.
 *
 * NOT 403, and not "check the id then load it": the row is loaded by id and
 * the advisor is compared afterwards, so an engagement belonging to another
 * advisor is indistinguishable from one that does not exist. `mapError` passes
 * a thrown Response through untouched, which is why this can answer 404 from
 * inside a helper at all.
 */
export async function requireOwnEngagement(
  c: Context<{ Bindings: Env }>, advisorId: number, id: number,
): Promise<EngagementRow> {
  const row = await c.env.DB.prepare('SELECT * FROM advisor_engagements WHERE id = ?')
    .bind(id).first<EngagementRow>();
  if (!row || row.advisor_id !== advisorId) {
    throw c.json({ detail: 'Engagement not found' }, 404);
  }
  return row;
}
