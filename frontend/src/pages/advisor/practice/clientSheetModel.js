/**
 * #4831 (D4831 part 2): the Practice Client Sheet (Practice v2 canvas, PX-04),
 * as pure derivations over the reads the sheet makes.
 *
 * ONE CLIENT IS ONE ACCOUNT. Every source is joined to the client by their
 * user id, never by a name:
 *   · engagements by `founder_user_id`;
 *   · bookings and deliverables by `client_user_id`;
 *   · grants by `granted_by_user_id`;
 *   · access log rows by the project uid of one of those grants.
 * Two clients can share a name. A sheet that matched by name would mix them.
 *
 * EACH SOURCE IS READ ON ITS OWN, and `null` means that read failed. Every
 * function here keeps that `null` distinct from an empty list, so an unread
 * source never shows as "none".
 */

import { SIGNED_LANES, LANE_LABEL, longDay } from './engagementBoard.js';

/** The seven tabs, in canvas order (PX-04). */
export const CLIENT_TABS = ['Overview', 'Engagements', 'Sessions', 'Delivery', 'Agreements', 'Access', 'Notes'];

const LIVE = new Set(['pending', 'confirmed']);
const HELD = new Set(['pending', 'confirmed', 'completed']);

/** This client's rows from one source, or `null` when the source was not read. */
export function mine(rows, id, key) {
  if (!Array.isArray(rows)) return null;
  return rows.filter((r) => id != null && r?.[key] === id);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthYear(value) {
  const m = /^(\d{4})-(\d{2})/.exec(String(value || ''));
  const month = m && MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${m[1]}` : null;
}

/**
 * "Active client · since Aug 2026". Active means an engagement under
 * contract. A client with sessions but no contract is "Client". One whose only
 * engagements ended is "Former client". The date is the earliest recorded
 * start: a signed term, or else a booking.
 */
export function relationshipLine(engagements, bookings) {
  if (engagements == null && bookings == null) return 'Relationship could not be read';
  const engs = engagements || [];
  const held = (bookings || []).filter((b) => HELD.has(b.status));
  const status = engs.some((e) => SIGNED_LANES.has(e.lane)) ? 'Active client'
    : engs.length && engs.every((e) => e.lane === 'ended') ? 'Former client'
      : 'Client';
  const starts = [...engs.map((e) => e.started_at), ...held.map((b) => b.slot_starts_at || b.created_at)]
    .filter(Boolean).map(String).sort();
  const since = monthYear(starts[0]);
  return since ? `${status} · since ${since}` : status;
}

/** The engagement under contract, the renewal-due one first. */
export function activeEngagement(engagements) {
  if (!Array.isArray(engagements)) return null;
  const signed = engagements.filter((e) => SIGNED_LANES.has(e.lane));
  return signed.find((e) => e.lane === 'renewal_due') || signed[0] || null;
}

/** The next pending or confirmed session after `now`, earliest first. */
export function nextSession(bookings, now) {
  if (!Array.isArray(bookings)) return null;
  return bookings
    .filter((b) => LIVE.has(b.status) && b.slot_starts_at && Date.parse(b.slot_starts_at) > now)
    .sort((a, b) => String(a.slot_starts_at).localeCompare(String(b.slot_starts_at)))[0] || null;
}

/**
 * The latest version actually sent to THIS client, from each version's own
 * recipient (#4684). Work sent to someone else under a relinked engagement is
 * theirs, not this client's.
 */
export function lastDelivery(deliverables, id) {
  if (!Array.isArray(deliverables)) return null;
  let best = null;
  for (const d of deliverables) {
    for (const v of d.versions || []) {
      if (v.sent_at && v.recipient_user_id === id && (!best || String(v.sent_at) > String(best.version.sent_at))) {
        best = { title: d.title, version: v };
      }
    }
  }
  return best;
}

/** The delivery line: "Q4 memo v3 · accepted 7 Nov 2026". */
export function deliveryLine(last) {
  if (!last) return null;
  const v = last.version;
  const [verb, at] = v.signed_off_at ? ['accepted', v.signed_off_at] : v.opened_at ? ['opened', v.opened_at] : ['sent', v.sent_at];
  return `${last.title} v${v.version} · ${verb} ${longDay(at) || 'date not recorded'}`;
}

/**
 * Recorded outstanding: sessions billed and not yet collected, with the sum of
 * their recorded amounts. A billed session with no amount is counted and named
 * as such, never added as $0.
 */
export function outstanding(bookings) {
  if (!Array.isArray(bookings)) return null;
  const billed = bookings.filter((b) => b.billing_state === 'billed');
  const priced = billed.filter((b) => b.amount_cents != null);
  return {
    count: billed.length,
    cents: priced.reduce((n, b) => n + Number(b.amount_cents), 0),
    unpriced: billed.length - priced.length,
  };
}

export function outstandingLine(o, money) {
  if (!o) return null;
  if (o.count === 0) return 'Nothing billed and uncollected';
  const sessions = `${o.count} ${o.count === 1 ? 'session' : 'sessions'} billed`;
  const gap = o.unpriced ? ` · ${o.unpriced} without an amount` : '';
  return `${money(o.cents)} · ${sessions}${gap}`;
}

/**
 * The last three recorded events across the client's sources, newest first:
 * a version sent to them, opened or accepted by them, or a session completed.
 */
export function recentActivity(bookings, deliverables, id, limit = 3) {
  const out = [];
  for (const d of deliverables || []) {
    for (const v of d.versions || []) {
      if (v.recipient_user_id !== id) continue;
      if (v.signed_off_at) out.push({ at: v.signed_off_at, text: `${d.title} v${v.version} accepted` });
      if (v.opened_at) out.push({ at: v.opened_at, text: `${d.title} v${v.version} opened` });
      if (v.sent_at) out.push({ at: v.sent_at, text: `${d.title} v${v.version} sent` });
    }
  }
  for (const b of bookings || []) {
    if (b.status === 'completed') out.push({ at: b.slot_starts_at || b.updated_at, text: `Session completed · ${b.topic || 'Session'}` });
  }
  return out.filter((x) => x.at).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, limit);
}

/** The engagement row's one-line summary in the Engagements tab. */
export function engagementSummary(e) {
  return `${LANE_LABEL[e?.lane] || 'Lane not recorded'}${e?.scope_label ? ` · ${e.scope_label}` : ''}`;
}

/**
 * The records this client opened to the advisor, and the access log rows on
 * them. The log is joined by project uid through the client's own grants.
 * `null` when either read failed.
 */
export function clientAccess(grants, log, id) {
  const own = mine(grants, id, 'granted_by_user_id');
  if (own == null) return null;
  const projects = new Set(own.map((g) => g.project_uid));
  return {
    grants: own,
    log: Array.isArray(log) ? log.filter((r) => projects.has(r.project_uid)) : null,
  };
}

/** What one grant opens, in words. */
export function grantScope(g) {
  const parts = [g.scope_project && 'the company record', g.scope_data_room && 'the data room', g.scope_sessions && 'their sessions with other advisors'].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Scope not recorded';
}
