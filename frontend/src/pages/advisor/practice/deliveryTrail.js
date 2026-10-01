/**
 * Practice · Delivery — the derivations, apart from the page that draws them.
 *
 * WHY A SEPARATE MODULE, the same reason as `opportunityLog.js` and
 * `engagementBoard.js`: importing the page pulls React and a `.css` through its
 * component tree, which the test loader cannot resolve. Everything here is pure
 * and imports nothing.
 *
 * THE ONE THING THIS MODULE DOES DIFFERENTLY FROM `engagementBoard.js`, and it
 * is a real distinction rather than an inconsistency. That module formats stored
 * CALENDAR DAYS — a term end an advisor typed as `2026-11-04` — and parses them
 * out of the string on purpose, because `new Date('2026-11-04')` is midnight UTC
 * and would render "Nov 3" for every reader west of Greenwich. The stamps here
 * are INSTANTS: `sent_at` and `opened_at` are written by `nowIso()` at the
 * moment something happened. An instant genuinely has a local day, and the
 * reader's is the right one, so these go through the browser's own formatter.
 * Using the string-slice approach here would report the UTC day to someone who
 * sent a deliverable at 11pm local and is being told it went out tomorrow.
 */

/** `not_started` | `sent` | `opened` — the three the endpoint derives. */
export const STATE_LABEL = {
  not_started: 'Not started',
  sent: 'Sent',
  opened: 'Opened',
};
/** `Not started` is the alarming one on this artboard — its row is red-tinted. */
export const STATE_TONE = {
  not_started: 'danger',
  sent: 'neutral',
  opened: 'ok',
};

/**
 * An instant as a short local day — "Aug 20".
 *
 * Returns null rather than "Invalid Date" for anything unparseable, so every
 * caller has to decide what an absent date says instead of printing a
 * placeholder that looks like a value.
 */
export function shortMoment(value) {
  if (!value) return null;
  const t = Date.parse(String(value));
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Whole days from an instant to now, or null. Negative clamps to 0. */
export function daysSince(value, nowMs) {
  if (!value) return null;
  const t = Date.parse(String(value));
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 86400000));
}

/**
 * The version chip on a row — "v4", or the advisor's own label where they wrote
 * one ("v2 draft", which is the artboard's).
 *
 * The NUMBER is the order and the LABEL is the name; migration 239's header
 * argues why they are separate columns. This renders the name and falls back to
 * the order, so a version always has something to be called.
 */
export function versionTag(version) {
  if (!version) return null;
  const label = String(version.label || '').trim();
  return label || `v${version.version}`;
}

/** "4 versions" / "1 version" — the count beside a row. */
export function versionCountLabel(n) {
  const count = Number(n || 0);
  return `${count} ${count === 1 ? 'version' : 'versions'}`;
}

/**
 * The right-hand line under the version count: when the latest version went out.
 *
 * "Not sent" is a real state here and the artboard's own red row — a work
 * product whose latest version has never been sent is a draft, not a delivery.
 */
export function sentLine(latest) {
  if (!latest) return 'No version recorded';
  const day = shortMoment(latest.sent_at);
  return day ? `Sent ${day}` : 'Not sent';
}

/**
 * The cyan seam line — what happened after it went out.
 *
 * THE ARTBOARD'S SHARPEST ROW IS THE UNREAD ONE ("Not opened in 4 days"), and
 * that is the whole reason this zone has an open receipt at all. So the seam
 * reports the wait in days when a sent version has not been read, the day it
 * was read when it has, and NOTHING for a draft — a work product that never
 * went out has no seam to report, and inventing one would put a reassuring line
 * under the row the advisor most needs to act on.
 */
export function seamLine(item, nowMs) {
  const latest = item?.latest_version;
  if (!latest || !latest.sent_at) return null;
  if (latest.opened_at) {
    const day = shortMoment(latest.opened_at);
    return day ? `Opened ${day}` : 'Opened';
  }
  const days = daysSince(latest.sent_at, nowMs);
  if (days == null) return 'Sent, not opened';
  if (days === 0) return 'Sent today, not opened yet';
  return `Not opened in ${days} ${days === 1 ? 'day' : 'days'}`;
}

/**
 * The median, rendered.
 *
 * Hours under a day read as hours, above it as days, and NULL reads as nothing
 * at all — never "0 h", which would say a deliverable was opened the instant it
 * was sent (D56/D68). The endpoint returns null before the first open for
 * exactly that reason.
 */
export function medianLabel(hours) {
  if (hours == null) return null;
  const n = Number(hours);
  if (!Number.isFinite(n)) return null;
  if (n < 48) return `${Math.round(n)} h`;
  const days = n / 24;
  return `${days % 1 === 0 ? days : days.toFixed(1)} d`;
}

/**
 * WHICH ROWS A CHIP SHOWS IS NOT IN HERE, and the omission is deliberate. It
 * lived here for one draft, as a `visibleItems(items, filter)`, and
 * `profile_zone_filters.test.mjs` failed the page for it: a chip declared live
 * in `advisorZoneFilters.js` must be named by the page that mounts the chip row,
 * because a predicate one import away lets a chip be declared live over a page
 * that cannot serve it. `EngagementsZone` narrows in the page for the same
 * reason. So the split is: this module derives and formats, the page decides
 * what a chip shows — and `DeliveryZone.jsx` carries the argument about the
 * canvas's `Draft` chip where the code that resolves it lives.
 */

/**
 * Who a nudge would actually reach, and who it would miss.
 *
 * A bulk action over a mixed set that delivers to some rows and skips the rest
 * is worse than no button, so the page reports both halves before it sends
 * anything. `missed` is only ever non-empty for a work product whose engagement
 * was unlinked AFTER a send — the store refuses the send otherwise — which is
 * the one case the send rule cannot prevent and therefore the one the page has
 * to say out loud.
 */
export function nudgeTargets(items) {
  const unopened = (items || []).filter((i) => i.state === 'sent');
  return {
    reachable: unopened.filter((i) => i.client_user_email),
    missed: unopened.filter((i) => !i.client_user_email),
  };
}

/** The default nudge body, which the advisor can edit before it is sent. */
export function nudgeBody(item) {
  const tag = versionTag(item?.latest_version);
  const day = shortMoment(item?.latest_version?.sent_at);
  return `Following up on ${item?.title || 'the work product'}${tag ? ` (${tag})` : ''}`
    + `${day ? `, sent ${day}` : ''}. Let me know if you would like to talk it through.`;
}
