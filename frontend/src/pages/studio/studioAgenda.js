/**
 * D4620 (#4620) — what Studio makes of the agenda it is handed.
 *
 * Three things the role homes each did their own way, and got wrong in
 * different ways:
 *
 *   1. COVERAGE. `GET /calendar/events` answers 200 with `sources[]`, one
 *      `{ kind, ok, error }` per kind it was asked to read. A 200 is not
 *      complete coverage: `calendarCoverage` says which of the kinds a widget
 *      RELEVANTLY depends on failed, and ignores the rest, so one unconfigured
 *      source does not invalidate every widget.
 *   2. IDENTITY. An advisor booking is the booking row (`id: 17`) and its
 *      calendar copy (`id: 'advisor_booking:17'`, `source_id: 17`). Comparing
 *      the raw ids showed one appointment twice. `agendaKey` is the event KIND
 *      plus the normalized source id, so the two are one and a different kind
 *      that shares the number stays apart. An item with no source id has no
 *      key and is never merged: two unknowns are not known to be one.
 *   3. POLICY. Cancelled and no-show items are history. The full Calendar
 *      keeps them (struck through, with their reason); Studio shows what is
 *      still ahead. `isActiveStatus` is the one place that says which.
 *
 * Pure functions: no React, no fetch, no clock except the `now` they are given.
 */

/** Statuses that make an item history rather than something ahead. */
export const INACTIVE_STATUSES = Object.freeze(['cancelled', 'canceled', 'no_show', 'declined', 'rejected', 'expired']);

/** An item with no status is active: nothing recorded says otherwise. */
export function isActiveStatus(status) {
  if (status === null || status === undefined || status === '') return true;
  return !INACTIVE_STATUSES.includes(String(status).trim().toLowerCase());
}

/** Calendar kinds each Studio agenda depends on. Anything else a source reports is not its concern. */
export const ADVISOR_AGENDA_KINDS = Object.freeze(['advisor_booking']);
export const INVESTOR_AGENDA_KINDS = Object.freeze([
  'investor_meeting', 'ic_meeting', 'event_ticket', 'event_hosted', 'deal_closing', 'round_close', 'nda_expiry', 'manual', 'calendly_event',
  'external_google', 'external_microsoft',
]);

const asArray = (value) => (Array.isArray(value) ? value : null);

/**
 * The events a calendar answer carries, in whichever shape it came: the
 * worker's `{ items, sources }`, an older `{ events }`, or a bare array.
 */
export function calendarItems(response) {
  if (Array.isArray(response)) return response;
  return asArray(response?.items) || asArray(response?.events) || [];
}

/**
 * Whether a calendar answer covers the kinds a widget depends on.
 *
 *   ready       every relevant source answered (or the answer names none, as
 *               the dev backend's bare list does; nothing is claimed)
 *   partial     at least one relevant source failed, at least one answered
 *   unreadable  every relevant source the answer names failed
 *
 * `failed` lists `{ kind, error }`; a source reported `not_configured` is in
 * it, with that error, because "not read here" is still not "nothing there".
 * A relevant kind the answer does not mention is not guessed at.
 */
export function calendarCoverage(response, relevantKinds) {
  const items = calendarItems(response);
  const sources = asArray(response?.sources);
  if (!sources) return { state: 'ready', items, failed: [] };
  const relevant = new Set(relevantKinds);
  const named = sources.filter((s) => s && relevant.has(s.kind));
  const failed = named.filter((s) => s.ok === false).map((s) => ({ kind: s.kind, error: s.error || 'unreadable' }));
  if (!failed.length) return { state: 'ready', items, failed };
  return { state: failed.length === named.length ? 'unreadable' : 'partial', items, failed };
}

/** A numeric id and its string are one id; anything blank is none. */
function normalizedId(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return /^\d+$/.test(text) ? String(Number(text)) : text;
}

/**
 * `kind` + `:` + source id, or null when either is unknown. A calendar id
 * `advisor_booking:17` yields source id `17` when `source_id` is not given.
 */
export function agendaKey(item, fallbackKind = null) {
  const kind = String(item?.kind || item?.type || fallbackKind || '').trim();
  if (!kind) return null;
  let id = normalizedId(item?.source_id ?? item?.booking_id);
  if (id === null) {
    const raw = item?.id;
    const prefix = `${kind}:`;
    id = typeof raw === 'string' && raw.startsWith(prefix) ? normalizedId(raw.slice(prefix.length)) : normalizedId(raw);
  }
  return id === null ? null : `${kind}:${id}`;
}

/** When an item happens, across the shapes the agenda mixes. Null when it names no time. */
export function agendaStart(item) {
  return item?.scheduled_start || item?.slot_starts_at || item?.start_at || item?.starts_at || item?.start || item?.date || null;
}

const atMillis = (value) => {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
};

/**
 * Items of several inputs as one list: one entry per `agendaKey`, the FIRST
 * input winning (so pass the richer source first), items with no key kept.
 */
export function mergeAgenda(inputs) {
  const seen = new Set();
  const out = [];
  for (const { items, kind } of inputs) {
    for (const item of items) {
      const key = agendaKey(item, kind);
      if (key !== null) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      out.push(item);
    }
  }
  return out;
}

/**
 * The active items starting in [now, until], soonest first. An item with no
 * readable time is left out: it cannot be placed, and is not invented a time.
 * `until` null means no upper bound.
 */
export function upcomingActive(items, { now = new Date(), until = null, limit = null } = {}) {
  const from = now.getTime();
  const to = until ? until.getTime() : Infinity;
  const picked = items
    .filter((item) => isActiveStatus(item?.status))
    .map((item) => ({ item, at: atMillis(agendaStart(item)) }))
    .filter(({ at }) => at !== null && at >= from && at <= to)
    .sort((a, b) => a.at - b.at)
    .map(({ item }) => item);
  return limit === null ? picked : picked.slice(0, limit);
}
