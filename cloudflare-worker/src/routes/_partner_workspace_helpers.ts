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
  unopenedDeliverables: number;
  utilisation: Utilisation;
}

export interface Health {
  health: 'on_track' | 'at_risk' | 'blocked' | null;
  health_note: string | null;
  health_reasons: string[];
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

  const hasSignal = i.milestones.length > 0
    || i.openBlockers.length > 0
    || i.unopenedDeliverables > 0
    || i.utilisation.utilisation_pct !== null;

  if (!hasSignal) {
    return {
      health: null,
      health_note: 'Nothing is recorded against this engagement yet — no milestone, blocker, deliverable or retainer. That is silence rather than good news, so it is not rated.',
      health_reasons: [],
    };
  }

  if (overdue) reasons.push(`${overdue} milestone${overdue === 1 ? '' : 's'} past due`);
  if (clientBlockers) reasons.push(`${clientBlockers} open blocker${clientBlockers === 1 ? '' : 's'} on the client's side`);
  if (ourBlockers) reasons.push(`${ourBlockers} open blocker${ourBlockers === 1 ? '' : 's'} on ours`);
  if (i.unopenedDeliverables) {
    reasons.push(`${i.unopenedDeliverables} deliverable${i.unopenedDeliverables === 1 ? '' : 's'} sent and not opened`);
  }
  const u = i.utilisation.utilisation_pct;
  if (u !== null && u < 60) reasons.push(`${u}% of retained hours used`);
  if (u !== null && u > 100) reasons.push(`${u}% of retained hours used — over scope`);

  if (i.openBlockers.length > 0) {
    return { health: 'blocked', health_note: null, health_reasons: reasons };
  }
  if (overdue > 0 || i.unopenedDeliverables > 0 || (u !== null && (u < 60 || u > 100))) {
    return { health: 'at_risk', health_note: null, health_reasons: reasons };
  }
  return {
    health: 'on_track',
    health_note: null,
    health_reasons: reasons.length ? reasons : ['Nothing overdue, blocked or unopened.'],
  };
}
