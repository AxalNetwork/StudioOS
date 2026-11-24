/** D4704 part 3 (#4704): recorded billing and immutable settlement snapshots; no provider calls. */
import type { Env, User } from '../types';
import { nowIso } from '../routes/_t13t14t15_helpers';
import { type BookingRow, ownEngagement, advisorMoney, bookingDto, parsePriceCents } from './advisorPractice';
import { cutCents, takeRate } from './advisorMoney';
import { practiceRefusal } from './practiceRefusal';
const BILLING_STATES = ['unpriced', 'billed', 'collected', 'written_off'];
/**
 * #5316 (D5316): the states this route accepts. `included` is not a value of the
 * `billing_state` column (205's CHECK cannot take a fifth one): it is recorded
 * in `included_at` / `included_by_user_id` / `included_engagement_id`, and every
 * advisor read reports it as `billing_state: 'included'`.
 */
const WRITABLE_BILLING_STATES = [...BILLING_STATES, 'included'];

async function billingEngagement(env: Env, advisorId: number, id: number) {
  const row = await ownEngagement(env, advisorId, id);
  if (!row) return practiceRefusal({ detail: 'Engagement not found' }, 404);
  return row;
}
export async function recordBilling(env: Env, user: User, advisorId: number, row: BookingRow & {
  platform_cut_cents: number | null; take_rate_bps: number | null;
}, body: Record<string, any>) {

    const includedAt = row.included_at ?? null;

    // #5316 (D5316): INCLUDED IN AN ENGAGEMENT, a recorded state of its own.
    if (body.billing_state != null && !WRITABLE_BILLING_STATES.includes(String(body.billing_state).trim())) {
      return practiceRefusal({ detail: 'billing_state must be one of: unpriced, billed, collected, written_off, included' }, 400);
    }
    if (body.billing_state != null && String(body.billing_state).trim() === 'included') {
      // No price: the engagement's fee covers the session, so there is no figure
      // for a billed, collected or outstanding total to count.
      if ('amount_cents' in body && parsePriceCents(body.amount_cents) != null) {
        return practiceRefusal({ detail: 'A session included in an engagement has no price of its own.', code: 'included_has_no_price' }, 400);
      }
      // A priced line keeps its stamped amount, rate and cut (#4713): including
      // it would restate them. Clear the price first (a settled one cannot be).
      if (row.amount_cents != null || row.billing_state !== 'unpriced') {
        return practiceRefusal({
          detail: 'This session has a price. Clear it first; a session included in an engagement is not billed.',
          code: 'priced_line',
        }, 409);
      }
      let engagementId: number | null = includedAt ? (row.included_engagement_id ?? null) : null;
      if ('engagement_id' in body) {
        engagementId = body.engagement_id == null || body.engagement_id === ''
          ? null
          : (await billingEngagement(env, advisorId, Number(body.engagement_id))).id;
      }
      // The first record stands (when, and who); naming an engagement updates the link only.
      const now = nowIso();
      const res: any = await env.DB.prepare(
        `UPDATE advisor_bookings
            SET included_at = ?, included_by_user_id = ?, included_engagement_id = ?, updated_at = ?
          WHERE id = ? AND billing_state = 'unpriced' AND amount_cents IS NULL AND included_at IS ?`
      ).bind(
        includedAt ?? now, includedAt ? (row.included_by_user_id ?? null) : Number(user.id), engagementId, now,
        row.id, includedAt,
      ).run();
      if (Number(res?.meta?.changes ?? 0) !== 1) {
        return practiceRefusal({ detail: 'This session changed while you were editing it. Reload and try again.', code: 'booking_changed' }, 409);
      }
      const fresh = await env.DB.prepare('SELECT * FROM advisor_bookings WHERE id = ?')
        .bind(row.id).first<BookingRow & { amount_cents: number | null; billing_state: string }>();
      return (bookingDto(fresh!, advisorMoney(fresh!)));
    }
    // Leaving the included state is said out loud: a bare amount on an included
    // session is refused rather than read as "it is billed now".
    if (includedAt && body.billing_state == null) {
      return practiceRefusal({
        detail: 'This session is recorded as included in an engagement. Send billing_state to change that.',
        code: 'included_line',
      }, 409);
    }

    const stored = row.amount_cents == null ? null : Number(row.amount_cents);
    const amount_cents = 'amount_cents' in body ? parsePriceCents(body.amount_cents) : stored;

    let billing_state = body.billing_state == null
      ? row.billing_state
      : String(body.billing_state).trim();
    if (!BILLING_STATES.includes(billing_state)) {
      return practiceRefusal({ detail: 'billing_state must be one of: unpriced, billed, collected, written_off' }, 400);
    }
    // A session with no amount cannot be billed, collected or written off —
    // there is no figure for any of those words to refer to. Rejecting rather
    // than silently coercing to 0, which would assert the session was free.
    if (amount_cents == null && billing_state !== 'unpriced') {
      return practiceRefusal({ detail: 'Set amount_cents before recording a billing state' }, 400);
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
      return practiceRefusal({ detail: 'reprice must be true or false' }, 400);
    }
    if ((pricing && stored != null) && !repricing) {
      return practiceRefusal({
        detail: 'This session already has a price. Send reprice: true to change it on purpose.',
        code: 'reprice_required',
      }, 409);
    }
    if (repricing && !('amount_cents' in body)) {
      return practiceRefusal({ detail: 'reprice needs the new amount_cents' }, 400);
    }
    if ((pricing || repricing) && stored != null
      && (row.billing_state === 'collected' || row.billing_state === 'written_off')) {
      // Money was taken, or the line was closed: a price change would restate
      // a settled figure. Refused rather than allowed with a flag.
      return practiceRefusal({
        detail: 'This session is already settled, so its price cannot be changed.',
        code: 'settled_price',
      }, 409);
    }

    let cut: number | null;
    let bps: number | null;
    if (amount_cents == null) {
      cut = null; bps = null;
    } else if (pricing || repricing) {
      const rate = await takeRate(env);
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
    // #5316 (D5316): any other state clears an included record, in the same
    // UPDATE, and the compare includes it.
    const update = env.DB.prepare(
      `UPDATE advisor_bookings
          SET amount_cents = ?, billing_state = ?,
              platform_cut_cents = ?, take_rate_bps = ?,
              included_at = NULL, included_by_user_id = NULL, included_engagement_id = NULL, updated_at = ?
        WHERE id = ? AND billing_state = ? AND amount_cents IS ? AND included_at IS ?`
    ).bind(
      amount_cents, billing_state, cut, bps, nowIso(),
      row.id, row.billing_state, stored, includedAt,
    );
    const writes = [update];
    if (audited) {
      writes.push(env.DB.prepare(
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
    const [res] = await env.DB.batch(writes);
    if (Number((res as any)?.meta?.changes ?? 0) !== 1) {
      return practiceRefusal({
        detail: 'This session changed while you were editing it. Reload and try again.',
        code: 'booking_changed',
      }, 409);
    }
    const fresh = await env.DB.prepare('SELECT * FROM advisor_bookings WHERE id = ?')
      .bind(row.id).first<BookingRow & { amount_cents: number | null; billing_state: string }>();
    return (bookingDto(fresh!, advisorMoney(fresh!)));
}
