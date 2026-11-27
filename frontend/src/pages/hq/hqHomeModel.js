/**
 * D8727 (#8727) — HQ home's words and rules, pure for the Node test.
 *
 * HQ home makes two reads: the overview (`GET /api/admin/hq/overview`) and the
 * escalation board on its own (`GET /api/admin/escalations?status=open`). Each
 * keeps its own state, so a pending read is never drawn as a failure and a
 * failure of one never costs the other's cards. This file holds what those
 * states say: the escalation card's headline, each row's due line, the
 * subsidiary names joined from the overview, and the literal status
 * announcements of board SHQ20 of
 * `design/incoming/Studio Home HQ Super Admin Page.dc.html`.
 *
 * Nothing here prints a server reason string: both routes' reasons name a
 * table and a migration, which is not copy for the person on duty.
 */
import { parseStamp } from '../../ui/parseStamp.js';

/** Escalations still reading after this long show the slow line (SHQ05B). */
export const ESCALATIONS_SLOW_MS = 8000;
/** A read with no answer after this long counts as failed (SHQ05, D8727). */
export const ESCALATIONS_DEADLINE_MS = 20000;

/** HQ's own sentence while Work is off (⚑ Q1, option A): no issue number. */
export const HQ_WORK_OFF = 'Work is not switched on for HQ yet. Tasks assigned to you on a Team will be listed here once it is.';

/** The literal announcements of SHQ20. One polite region for the page; a failed retry is an alert in the card. */
export const ANNOUNCE = Object.freeze({
  coldLoad: 'Loading HQ home.',
  slow: 'Escalations are taking longer than usual. The rest of the page has loaded.',
  slowOverviewPending: 'Escalations are taking longer than usual.',
  failed: 'Escalations could not be read.',
  retrying: 'Reading escalations again.',
  retryFailed: 'Escalations still could not be read.',
  overviewFailed: 'The HQ overview could not be read. Escalations are unaffected.',
  overviewFailedToo: 'The HQ overview could not be read.',
});

const plural = (n, one, many) => (n === 1 ? one : many);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

/** "09:14 UTC" for a time in ms, or null. */
export function clockUtc(ms) {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** "24 Nov 10:12" for a stored stamp (D1's zone-less stamps read as UTC), or null. */
export function stampLabel(value) {
  const ms = parseStamp(value);
  if (ms === null) return null;
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "15 h past due", "due in 5 h 46 min", or null when there is no due time or no clock. */
export function dueDistance(dueAt, now) {
  const due = parseStamp(dueAt);
  if (due === null || !Number.isFinite(now)) return null;
  const minutes = Math.round(Math.abs(due - now) / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes / 60);
  const span = days >= 2 ? `${days} d` : hours >= 1 ? `${hours} h${due > now && minutes % 60 ? ` ${minutes % 60} min` : ''}` : `${minutes} min`;
  return due <= now ? `${span} past due` : `due in ${span}`;
}

/** "Seat increase" for `seat_increase`. */
export const kindLabel = (kind) => {
  const s = String(kind || '').replace(/_/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : 'Escalation';
};

/**
 * Subsidiary name by branch code, joined from the overview: a branch row names
 * its licence, and the licence carries the brand. With no overview the map is
 * empty and a row shows its code alone (SHQ06D), never a guessed name.
 */
export function namesByCode(overview) {
  const out = new Map();
  if (!overview || typeof overview !== 'object') return out;
  const brand = new Map((overview.licences || []).map((l) => [l.uid, l.brand_name]));
  for (const b of overview.branches || []) {
    const name = b?.code && brand.get(b.licence_uid);
    if (name) out.set(b.code, name);
  }
  return out;
}

/** How many open escalations are past their SLA. */
export const pastCount = (items) => (items || []).filter((e) => e?.sla === 'past').length;

/** The card's count, in its heading row: "2 open · 1 past SLA", "0 open", "at least 100 open". */
export function escalationCount(items, complete = true) {
  const n = (items || []).length;
  const past = pastCount(items);
  const open = complete === false ? `at least ${n} open` : `${n} open`;
  return past ? `${open} · ${past} past SLA` : open;
}

/** The section's line beside "What needs my attention?": "2 escalations, 1 past SLA". */
export function attentionLine(read) {
  if (!read || read.phase !== 'ok') return '';
  const n = read.items.length;
  if (!n) return 'Nothing is waiting on HQ';
  const past = pastCount(read.items);
  const count = `${read.complete === false ? 'At least ' : ''}${n} ${plural(n, 'escalation', 'escalations')}`;
  return past ? `${count}, ${past} past SLA` : count;
}

/** What a successful retry announces (SHQ06B). */
export function retrySucceeded(items) {
  const n = (items || []).length;
  if (!n) return 'Escalations read. Nothing is waiting on HQ.';
  const past = pastCount(items);
  return `Escalations read. ${n} waiting on HQ${past ? `, ${past} past SLA` : ''}.`;
}

/**
 * What one answer of the escalation board means. Only a successful read with a
 * list is a value; `available: false`, a missing list or a thrown error is a
 * failure, and an empty list after a successful read is the all-clear.
 */
export function escalationOutcome(res) {
  if (!res || typeof res !== 'object' || res.available === false || !Array.isArray(res.items)) return { phase: 'failed' };
  return { phase: 'ok', items: res.items, complete: res.complete !== false };
}

/** The state an escalation read starts in, before its first answer. */
export const READING = Object.freeze({ phase: 'reading', retry: false, slow: false, items: [], complete: true, readAt: null, tries: [] });
