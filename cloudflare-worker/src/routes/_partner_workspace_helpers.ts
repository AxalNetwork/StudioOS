/**
 * Shared by the three partner workspace routers — Pipeline, Delivery, Offers.
 *
 * WHAT BELONGS HERE: ownership checks, and every derived value that two zones
 * must agree on. The second is the reason this file exists rather than three
 * copies of the same twenty lines.
 *
 * THE DERIVATION RULE these routers follow, stated once:
 *
 *   A value that is a JUDGEMENT (health, over-cap, published) or that TWO
 *   SURFACES MUST AGREE ON (utilisation, days stalled) is computed in the
 *   worker and arrives as a value plus a `_note` when it is null. Anything that
 *   is presentation of a value already on the row — colouring a bar, "18d ago",
 *   counting rows for a stat strip — stays in the page.
 *
 * The Delivery · Health canvas is explicit about the second half: its
 * utilisation column is "a read of the retainer record on Pipeline · Retainers
 * — the same number, not a second one computed from a different source",
 * because "two pages disagreeing about the same client's utilization is worse
 * than either number". `utilisationFor` below is that one source. Both routers
 * import it; neither recomputes it.
 *
 * AND THE HALF THAT MATTERS MORE: every one of these returns NULL with a
 * reason rather than a plausible zero. A retainer with no hours sold has no
 * utilisation; an engagement with nothing recorded has no health. Rendering
 * either as 0% or "on track" would be the store's silence dressed as a finding,
 * which is what `frontend/test/partner_delivery_stores.test.mjs` bans at the
 * schema level and what these functions enforce at the read.
 */
import type { Env, User } from '../types';
import { isAdmin, isPartner } from './_t13t14t15_helpers';

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

/**
 * The engagement, if it belongs to this partner. Otherwise a throw that becomes
 * a 404.
 *
 * NOT 403. A non-owner must not learn the row exists — the same reasoning
 * `needs.ts` records for invoices, where "a non-party cannot confirm the
 * engagement exists". `mapError` turns any message that is not one of the auth
 * sentences into a 400, so the caller raises the Response itself.
 */
export async function requireOwnEngagement(
  env: Env, partnerId: number, engagementId: number,
): Promise<{ id: number; uid: string; partner_id: number; founder_id: number; status: string; price: number }> {
  const row = await env.DB.prepare(
    `SELECT id, uid, partner_id, founder_id, status, price
       FROM engagements WHERE id = ?`,
  ).bind(engagementId).first<any>();
  if (!row || Number(row.partner_id) !== Number(partnerId)) {
    throw new Response(JSON.stringify({ detail: 'Engagement not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    });
  }
  return row;
}

/** The quote, if it belongs to this partner. Same 404-not-403 reasoning. */
export async function requireOwnQuote(
  env: Env, partnerId: number, quoteId: number,
): Promise<{ id: number; uid: string; partner_id: number; need_id: number; status: string; price: number }> {
  const row = await env.DB.prepare(
    `SELECT id, uid, partner_id, need_id, status, price FROM quotes WHERE id = ?`,
  ).bind(quoteId).first<any>();
  if (!row || Number(row.partner_id) !== Number(partnerId)) {
    throw new Response(JSON.stringify({ detail: 'Quote not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    });
  }
  return row;
}

/** Partner or admin, before any of the above is worth doing. */
export function requirePartnerRole(user: User): void {
  if (!isPartner(user) && !isAdmin(user)) throw new Error('Forbidden');
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * An amount of money, or a sentence saying why it is not one.
 *
 * Rejects 12.5 as firmly as it rejects 'free'. A cents column that accepts a
 * fraction has a name promising exactness and a value that does not deliver it,
 * which is the whole argument `check-money-cents.mjs` makes about the type.
 */
export function parseCents(v: unknown, field: string): { cents: number | null } | { error: string } {
  if (v === null || v === undefined || v === '') return { cents: null };
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    return { error: `${field} must be a whole number of cents` };
  }
  if (!Number.isInteger(v)) return { error: `${field} must be whole cents, not a fraction` };
  if (v < 0) return { error: `${field} cannot be negative` };
  return { cents: v };
}

/** Non-negative hours, or a sentence. `null` clears; `0` is a real claim. */
export function parseHours(v: unknown, field: string): { hours: number | null } | { error: string } {
  if (v === null || v === undefined || v === '') return { hours: null };
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    return { error: `${field} must be a number of hours, zero or more` };
  }
  return { hours: v };
}

/**
 * A period label, checked against the cadence it will be compared under.
 *
 * `retainer_usage.period` and `engagement_hours.period` are free TEXT. Without
 * this a monthly retainer accumulates a quarterly usage row and utilisation
 * silently divides one period's hours by another's allowance.
 */
export function parsePeriod(v: unknown, cadence: 'monthly' | 'quarterly'): { period: string } | { error: string } {
  const s = String(v ?? '').trim();
  const ok = cadence === 'quarterly' ? /^\d{4}-Q[1-4]$/.test(s) : /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
  if (!ok) {
    return { error: cadence === 'quarterly'
      ? 'Period must look like 2026-Q3 for a quarterly retainer'
      : 'Period must look like 2026-09 for a monthly retainer' };
  }
  return { period: s };
}

/**
 * Merge a PATCH body over a row.
 *
 * An ABSENT key leaves the column alone; an EXPLICIT null clears it. The
 * distinction is the whole point of a PATCH and it is why this is a helper
 * rather than an object spread — `{...row, ...body}` cannot tell "not sent"
 * from "sent as null", so it silently makes every PATCH a PUT.
 *
 * Returns plain values for a literal UPDATE with the full column list bound:
 * `check-sql-prepare.mjs` fails a new `${}` inside `DB.prepare`, so a dynamic
 * SET clause is not available here.
 */
export function mergePatch<T extends Record<string, unknown>>(
  row: T, body: Record<string, unknown>, fields: Array<keyof T & string>,
): T {
  const out = { ...row };
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(body, f)) {
      (out as Record<string, unknown>)[f] = body[f] === '' ? null : body[f];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Derived values — the one source for each
// ---------------------------------------------------------------------------

/** Whole days between two ISO-ish timestamps, or null if either is unusable. */
export function daysBetween(fromIso: string | null | undefined, toIso?: string): number | null {
  if (!fromIso) return null;
  const a = Date.parse(String(fromIso).replace(' ', 'T'));
  const b = toIso ? Date.parse(String(toIso).replace(' ', 'T')) : Date.now();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.floor((b - a) / 86_400_000);
}

export interface Utilisation {
  utilisation_pct: number | null;
  utilisation_note: string | null;
  hours_used: number | null;
  retained_hours: number | null;
}

/**
 * Utilisation for one retainer in one period — the ONE computation of it.
 *
 * Called by `GET /pipeline/retainers` and by `GET /delivery/health`, which is
 * the point: the Health canvas seam-marks this figure as a read rather than a
 * recalculation, and a second implementation is how the two pages come to
 * disagree about the same client.
 *
 * TWO DIFFERENT NULLS, and they are not the same fact:
 *   · no `retained_hours` — the retainer is not sold by the hour, so it HAS no
 *     utilisation. Not a gap; a different shape of deal.
 *   · `retained_hours` set but no usage row for the period — nobody has logged
 *     the hours yet. A gap, and one somebody can close.
 * Both return null. Neither returns 0%, which would say the client used none.
 */
export function utilisationFor(
  retainer: { retained_hours: number | null } | null,
  usageRow: { hours_used: number } | null | undefined,
): Utilisation {
  if (!retainer) {
    return {
      utilisation_pct: null,
      utilisation_note: 'No retainer is recorded against this engagement, so there is no retained scope to measure against.',
      hours_used: null,
      retained_hours: null,
    };
  }
  const retained = retainer.retained_hours;
  if (retained === null || retained === undefined || Number(retained) <= 0) {
    return {
      utilisation_pct: null,
      utilisation_note: 'This retainer is not sold by the hour, so it has no utilisation — a different shape of deal rather than a missing figure.',
      hours_used: usageRow ? Number(usageRow.hours_used) : null,
      retained_hours: null,
    };
  }
  if (!usageRow) {
    return {
      utilisation_pct: null,
      utilisation_note: 'No hours have been logged for this period yet. That is not the same as none being used.',
      hours_used: null,
      retained_hours: Number(retained),
    };
  }
  const used = Number(usageRow.hours_used);
  return {
    utilisation_pct: Math.round((used / Number(retained)) * 100),
    utilisation_note: null,
    hours_used: used,
    retained_hours: Number(retained),
  };
}

export interface HealthInputs {
  milestones: Array<{ due_at: string | null; completed_at: string | null }>;
  openBlockers: Array<{ side: string }>;
  /**
   * Sent deliverables with no recorded open — or NULL when read tracking is not
   * available (#4690). Null is not zero: "we cannot see opens" and "every
   * client opened everything" are opposite statements, and neither is
   * "the client did not read it".
   */
  unopenedDeliverables: number | null;
  /** Sent deliverables, whether or not anyone can see them being read. */
  sentDeliverables?: number;
  /** Whether an open can be observed at all. Absent means it cannot. */
  readTracking?: ReadTracking;
  utilisation: Utilisation;
  /**
   * Blockers that were raised and cleared. They do NOT affect the rating — a
   * blocker that is gone says nothing about health now — but they DO count as
   * something having been recorded, which is a different question and the one
   * `hasSignal` below asks.
   *
   * Without this the two record types were treated inconsistently: a COMPLETED
   * milestone counted as a signal (so the engagement was rated) while a CLEARED
   * blocker did not (so it fell back to "nothing recorded"), which is false —
   * something was recorded, and somebody dealt with it.
   */
  clearedBlockers?: number;
}

export interface Health {
  health: 'on_track' | 'at_risk' | 'blocked' | null;
  health_note: string | null;
  health_reasons: string[];
  /**
   * Inputs the judgement did NOT use because they could not be observed (#4690),
   * each with the reason. Additive: a reader can see what was left out rather
   * than infer it from a rating that reads complete.
   */
  health_unavailable_inputs: Array<{ input: string; reason: string }>;
}

/**
 * Engagement health — a judgement, computed here, never stored.
 *
 * `frontend/test/partner_delivery_stores.test.mjs` bans a `health` column for
 * the reason this function embodies: it is a read over five tables, and a
 * stored copy would be a second source of truth that disagrees with them the
 * first time one moves.
 *
 * THE CASE THAT MATTERS MOST IS THE EMPTY ONE. An engagement with no milestone,
 * no blocker, no deliverable and no retainer returns `null` — not `'on_track'`.
 * Green-because-nothing-is-recorded is exactly the failure the zone's old
 * no-store card warned about: "a pill computed from status alone would rate
 * every live engagement identically and call it a judgement". Silence is not
 * good news, and the reasons array says which signals were available so the
 * pill can be explained rather than asserted.
 */
export function healthFor(i: HealthInputs): Health {
  const reasons: string[] = [];
  const overdue = i.milestones.filter(
    (m) => !m.completed_at && m.due_at && (daysBetween(m.due_at) ?? -1) > 0,
  ).length;
  const clientBlockers = i.openBlockers.filter((b) => b.side === 'client').length;
  const ourBlockers = i.openBlockers.length - clientBlockers;

  // "Has anything ever been recorded here" — NOT "is anything currently
  // wrong". A completed milestone and a cleared blocker both count: somebody
  // is running this engagement, and the honest answer is a rating rather than
  // the not-rated card, which means "we have nothing at all to go on".
  //
  // READ TRACKING (#4690). Where opens cannot be observed, "sent and not
  // opened" is not a fact about the client, so it is neither a reason nor a
  // risk. That the deliverable was SENT is still a recorded fact and still a
  // signal that somebody is running this engagement.
  const readsObservable = Boolean(i.readTracking?.available) && i.unopenedDeliverables !== null;
  const unopened = readsObservable ? Number(i.unopenedDeliverables) : 0;
  const unavailable: Array<{ input: string; reason: string }> = [];
  if (!readsObservable) {
    unavailable.push({
      input: 'deliverable_reads',
      reason: i.readTracking?.reason || READ_TRACKING_UNAVAILABLE_REASON,
    });
  }
  const hasSignal = i.milestones.length > 0
    || i.openBlockers.length > 0
    || (i.clearedBlockers ?? 0) > 0
    || (i.sentDeliverables ?? 0) > 0
    || unopened > 0
    || i.utilisation.utilisation_pct !== null;

  if (!hasSignal) {
    return {
      health: null,
      health_note: 'Nothing is recorded against this engagement yet — no milestone, blocker, deliverable or retainer. Silence is not good news, so it is not rated.',
      health_reasons: [],
      health_unavailable_inputs: unavailable,
    };
  }

  if (overdue) reasons.push(`${overdue} milestone${overdue === 1 ? '' : 's'} past due`);
  if (clientBlockers) reasons.push(`${clientBlockers} open blocker${clientBlockers === 1 ? '' : 's'} on the client's side`);
  if (ourBlockers) reasons.push(`${ourBlockers} open blocker${ourBlockers === 1 ? '' : 's'} on ours`);
  if (unopened) {
    reasons.push(`${unopened} deliverable${unopened === 1 ? '' : 's'} sent and not opened`);
  }
  const u = i.utilisation.utilisation_pct;
  if (u !== null && u < 60) reasons.push(`${u}% of retained hours used`);
  if (u !== null && u > 100) reasons.push(`${u}% of retained hours used — over scope`);

  if (i.openBlockers.length > 0) {
    return { health: 'blocked', health_note: null, health_reasons: reasons, health_unavailable_inputs: unavailable };
  }
  if (overdue > 0 || unopened > 0 || (u !== null && (u < 60 || u > 100))) {
    return { health: 'at_risk', health_note: null, health_reasons: reasons, health_unavailable_inputs: unavailable };
  }
  return {
    health: 'on_track',
    health_note: null,
    health_reasons: reasons.length
      ? reasons
      : [readsObservable ? 'Nothing overdue, blocked or unopened.' : 'Nothing overdue or blocked.'],
    health_unavailable_inputs: unavailable,
  };
}

// ---------------------------------------------------------------------------
// Read tracking — can an open be observed at all? (#4690)
// ---------------------------------------------------------------------------

export interface ReadTracking {
  available: boolean;
  /** Why not, in the repo's honesty vocabulary. Null when available. */
  reason: string | null;
}

export const READ_TRACKING_UNAVAILABLE_REASON =
  'Not recorded: nothing in this product records that a client opened a deliverable or read a report, so a deliverable sent and not opened says nothing about the client.';

/**
 * Whether this build instruments deliverable opens. `engagement_deliverables.
 * opened_at` is the client's to set (migration 208:160) and no client-side
 * surface writes it. Flip this only together with that surface; until then
 * availability is inferred from the data, below.
 */
export const DELIVERABLE_READ_INSTRUMENTED = false;

/**
 * ONE answer to "can we see opens?", used by Deliverables, Health, the Board
 * and the report draft. Available when the build is instrumented, or when any
 * deliverable in the book carries an `opened_at` — a recorded open is proof the
 * instrument exists. Otherwise every sent deliverable would read "unopened", a
 * claim about the CLIENT that is really a claim about OUR missing instrument.
 */
export function readTrackingFor(
  deliverables: Array<{ opened_at?: string | null }>,
  instrumented: boolean = DELIVERABLE_READ_INSTRUMENTED,
): ReadTracking {
  const proven = deliverables.some((d) => Boolean(d.opened_at));
  return instrumented || proven
    ? { available: true, reason: null }
    : { available: false, reason: READ_TRACKING_UNAVAILABLE_REASON };
}

/** Sent and not opened — or NULL when opens cannot be observed. Never 0 by default. */
export function unopenedCountFor(
  deliverables: Array<{ sent_at?: string | null; opened_at?: string | null }>,
  tracking: ReadTracking,
): number | null {
  if (!tracking.available) return null;
  return deliverables.filter((d) => d.sent_at && !d.opened_at).length;
}

/** One deliverable's read state; `not_recorded` when opens cannot be observed. */
export function readStateFor(
  d: { sent_at?: string | null; opened_at?: string | null },
  tracking: ReadTracking,
): 'not_sent' | 'opened' | 'unopened' | 'not_recorded' {
  if (!d.sent_at) return 'not_sent';
  if (d.opened_at) return 'opened';
  return tracking.available ? 'unopened' : 'not_recorded';
}

// ---------------------------------------------------------------------------
// Retainers — the ONE projection Delivery and Pipeline both call (#4690)
// ---------------------------------------------------------------------------

/**
 * MONTHS PER CADENCE. The single normalisation rule: a recurring amount is
 * stated per its cadence, and "monthly" is that amount divided by the months in
 * the cadence. Monthly 1, quarterly 3, and the longer cadences a contract can
 * name. A cadence not in this table has NO monthly figure (null), because
 * guessing would put an invented number in a revenue total.
 *
 * Only monthly and quarterly can be written today (`CADENCES` in
 * partner_pipeline.ts), and only those have a usage period label; the rest are
 * here so a row from any source normalises by the same rule.
 */
export const CADENCE_MONTHS: Readonly<Record<string, number>> = Object.freeze({
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
  yearly: 12,
});

/** Months in a cadence, or null for a cadence this rule does not know. */
export function cadenceMonths(cadence: string | null | undefined): number | null {
  const m = CADENCE_MONTHS[String(cadence ?? '').trim().toLowerCase()];
  return m === undefined ? null : m;
}

/**
 * The usage period a retainer is measured in RIGHT NOW: `2026-11` for a monthly
 * one, `2026-Q4` for a quarterly one. Utilisation compares the hours logged in
 * THIS period with the hours sold for the SAME period, so the period follows
 * the retainer's cadence — never the calendar month of whoever is looking.
 */
export function retainerPeriodFor(cadence: string | null | undefined, now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  if (String(cadence ?? '').toLowerCase() === 'quarterly') return `${y}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
  return `${y}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * THE ACTIVE-RETAINER PREDICATE. A retainer counts toward current recurring
 * revenue and current utilisation unless it has ended. `ended_at` unset: active.
 * `ended_at` in the future: still active today (a scheduled end). `ended_at` now
 * or past, or a value that is not a date: ended — an unreadable end date must
 * not keep money on the books.
 */
export function isRetainerActive(
  retainer: { ended_at?: string | null } | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!retainer) return false;
  const raw = retainer.ended_at;
  if (raw === null || raw === undefined || String(raw).trim() === '') return true;
  const t = Date.parse(String(raw).trim().replace(' ', 'T'));
  if (!Number.isFinite(t)) return false;
  return t > now.getTime();
}

/**
 * The recorded amount, per month. `amount_cents` is the contract amount PER
 * CADENCE; this divides it to a month. Null when no amount is recorded or the
 * cadence is unknown — null is "cannot state", never a zero.
 */
export function monthlyAmountCents(
  retainer: { cadence?: string | null; amount_cents?: number | null } | null | undefined,
): number | null {
  if (!retainer || retainer.amount_cents === null || retainer.amount_cents === undefined) return null;
  const months = cadenceMonths(retainer.cadence);
  if (months === null) return null;
  return Math.round(Number(retainer.amount_cents) / months);
}

/**
 * CURRENT recurring revenue of one retainer, per month: the normalised amount
 * if the retainer is active, otherwise null (an ended retainer contributes
 * nothing to what is recurring now). Sum these; skip the nulls.
 */
export function currentMonthlyCents(
  retainer: { cadence?: string | null; amount_cents?: number | null; ended_at?: string | null } | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!isRetainerActive(retainer, now)) return null;
  return monthlyAmountCents(retainer);
}

export interface RetainerRow {
  retainer_id?: number | null;
  retainer_uid?: string | null;
  shape?: string | null;
  cadence?: string | null;
  amount_cents?: number | null;
  retained_hours?: number | null;
  renews_at?: string | null;
  ended_at?: string | null;
}

export interface RetainerProjection extends Utilisation {
  /** Null when the engagement has no retainer. */
  retainer: {
    id: number; uid: string | null; shape: string | null; cadence: string | null;
    amount_cents: number | null; retained_hours: number | null;
    renews_at: string | null; ended_at: string | null; days_to_renewal: number | null;
    /** The active-retainer predicate's answer. */
    active: boolean;
    /** The recorded amount normalised to a month, regardless of active. */
    monthly_amount_cents: number | null;
    /** What counts toward CURRENT recurring revenue: monthly if active, else null. */
    current_monthly_cents: number | null;
  } | null;
  /** The period utilisation was measured in, by cadence. Null with no retainer. */
  current_period: string | null;
  usage: Array<{ period: string; hours_used: number; note: string | null }>;
}

/**
 * THE FULL RETAINER PROJECTION — cadence, current period, usage, retained
 * hours, recurring amount, monthly normalisation — computed once. Pipeline
 * · Retainers and Delivery · Health/Board both call this, so a monthly and a
 * quarterly retainer show the same utilisation on both pages for the same
 * inputs, and an ended one is excluded from both.
 *
 * An ENDED retainer has no current utilisation (the hours it sold are not
 * being sold now): `utilisation_pct` is null with a note, and the usage that
 * was logged is still returned. Without that, an old retainer left at 20% would
 * rate its engagement at risk for ever.
 */
export function retainerProjection(
  row: RetainerRow | null | undefined,
  usageRows: Array<{ period: string; hours_used: number | string; note?: string | null }>,
  now: Date = new Date(),
): RetainerProjection {
  if (!row || !row.retainer_id) {
    return { retainer: null, current_period: null, usage: [], ...utilisationFor(null, null) };
  }
  const usage = (usageRows || []).map((u) => ({
    period: String(u.period), hours_used: Number(u.hours_used), note: u.note ?? null,
  }));
  const period = retainerPeriodFor(row.cadence, now);
  const retainedHours = row.retained_hours === null || row.retained_hours === undefined
    ? null : Number(row.retained_hours);
  const active = isRetainerActive(row, now);
  const thisPeriod = usage.find((u) => u.period === period) || null;
  const measured = utilisationFor({ retained_hours: retainedHours }, thisPeriod);
  const util: Utilisation = active ? measured : {
    ...measured,
    utilisation_pct: null,
    utilisation_note: 'This retainer has ended, so it has no current utilisation to measure.',
  };
  return {
    retainer: {
      id: Number(row.retainer_id),
      uid: row.retainer_uid ?? null,
      shape: row.shape ?? null,
      cadence: row.cadence ?? null,
      amount_cents: row.amount_cents === null || row.amount_cents === undefined ? null : Number(row.amount_cents),
      retained_hours: retainedHours,
      renews_at: row.renews_at ?? null,
      ended_at: row.ended_at ?? null,
      days_to_renewal: row.renews_at ? -(daysBetween(row.renews_at) ?? 0) : null,
      active,
      monthly_amount_cents: monthlyAmountCents(row),
      current_monthly_cents: currentMonthlyCents(row, now),
    },
    current_period: period,
    usage,
    ...util,
  };
}

// ---------------------------------------------------------------------------
// Capacity time basis (#4690)
// ---------------------------------------------------------------------------

/**
 * THE TIME BASIS. Hours are LOGGED per calendar month (`YYYY-MM`); a cap is
 * STATED per week (`weekly_hours`). They are different units over different
 * periods and are never compared as written. The cap is scaled to the period
 * the hours cover: weekly_hours × days in the month ÷ 7. Rounded to 2 places
 * HERE, so the figure the page shows is the figure the comparison used.
 */
export function daysInPeriod(period: string): number | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(period));
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
}

export function periodCapHours(weeklyHours: number | null, period: string): number | null {
  const days = daysInPeriod(period);
  if (weeklyHours === null || weeklyHours === undefined || days === null) return null;
  return Math.round(Number(weeklyHours) * days / 7 * 100) / 100;
}

// ---------------------------------------------------------------------------
// Seat state — one definition for Board, Health and Capacity (#4690)
// ---------------------------------------------------------------------------

export interface SeatState<S> {
  /** `active` while ANY seat is unrevoked; `revoked` when seats exist and all are; `none`. */
  state: 'active' | 'revoked' | 'none';
  /**
   * Structural, never stored: an engagement that ever granted a seat IS
   * embedded, and stays embedded after the last revocation (the board keeps it
   * struck through). No seat row: a project.
   */
  mode: 'embedded' | 'project';
  has_active_seats: boolean;
  active_count: number;
  revoked_count: number;
  total: number;
  /** The seat the row is ABOUT: newest active, else newest revoked, else null. */
  lead: S | null;
  /** Null while any seat is active; else when the newest seat was revoked. */
  revoked_at: string | null;
}

type SeatLike = { granted_at?: string | null; revoked_at?: string | null; id?: number | null };

const seatNewest = (a: SeatLike, b: SeatLike) => {
  const ga = String(a.granted_at ?? ''), gb = String(b.granted_at ?? '');
  if (ga !== gb) return ga < gb ? 1 : -1;
  return Number(b.id ?? 0) - Number(a.id ?? 0);
};

/**
 * Derive an engagement's seat state from ALL its seats — the whole collection,
 * in any order. A single selected row cannot say: the newest seat may be the
 * revoked one while an older seat is still open (partial revocation), and a
 * seat with no scope is still a seat (the scope is optional). Regranting after
 * revocation adds an unrevoked row, so the state returns to `active`.
 * Retainer cadence has no bearing on it.
 */
export function seatStateFor<S extends SeatLike>(seats: S[]): SeatState<S> {
  const all = [...(seats || [])].sort(seatNewest);
  const active = all.filter((s) => !s.revoked_at);
  const revoked = all.filter((s) => s.revoked_at);
  const state = active.length ? 'active' : (revoked.length ? 'revoked' : 'none');
  return {
    state,
    mode: all.length ? 'embedded' : 'project',
    has_active_seats: active.length > 0,
    active_count: active.length,
    revoked_count: revoked.length,
    total: all.length,
    lead: active[0] ?? revoked[0] ?? null,
    revoked_at: active.length ? null : (revoked[0]?.revoked_at ?? null),
  };
}

/** Group any rows carrying `engagement_id` by it. */
export function groupByEngagement<T extends { engagement_id: number | string }>(rows: T[]): Map<number, T[]> {
  const m = new Map<number, T[]>();
  for (const r of rows) {
    const k = Number(r.engagement_id);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return m;
}

/**
 * The calendar months (`YYYY-MM`) a usage period covers: a month is itself, a
 * quarter `2026-Q4` is its three. Hours are logged by month, retained hours are
 * sold by the retainer's period, and this is how the two are brought to one
 * period before they are compared (#4690).
 */
export function periodMonths(period: string): string[] {
  const q = /^(\d{4})-Q([1-4])$/.exec(String(period));
  if (q) {
    const first = (Number(q[2]) - 1) * 3 + 1;
    return [0, 1, 2].map((i) => `${q[1]}-${String(first + i).padStart(2, '0')}`);
  }
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(period)) ? [String(period)] : [];
}
