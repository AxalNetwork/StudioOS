/**
 * D6257 (#6257) — the investor Network's Introductions and Organizations
 * boards (NW3, NW3.1, NW4, NW4.1, NW8.1 of the Network v2 Investor canvas,
 * D6256), as pure functions the page and its two sheets read.
 *
 * Nothing here reads or writes: each function takes what a read already
 * returned and says what the board draws. A value no read returns is `null`,
 * which the page draws as Not recorded; a read that failed is `unreadable`,
 * which the page draws as Unavailable with Try again. Neither is ever 0.
 */
import { COLD_AFTER_DAYS } from '../../lib/networkBook';

/** The curated-match views NW3 draws, in its order. `stalled` is the route's lazily written `expired`. */
export const MATCH_VIEWS = Object.freeze([
  { key: 'pending', label: 'Awaiting your decision' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'declined', label: 'Declined' },
  { key: 'stalled', label: 'Stalled' },
]);

const matchKey = (prop) => {
  const status = String(prop?.status || '').toLowerCase();
  return status === 'expired' ? 'stalled' : status;
};

/** The propositions in one view, and how many each view holds. */
export function matchGroups(propositions) {
  const rows = Array.isArray(propositions) ? propositions : [];
  const counts = Object.fromEntries(MATCH_VIEWS.map((v) => [v.key, 0]));
  for (const prop of rows) if (prop && counts[matchKey(prop)] !== undefined) counts[matchKey(prop)] += 1;
  return { counts, total: rows.length, rowsFor: (view) => rows.filter((prop) => matchKey(prop) === view) };
}

/** "Awaiting your decision · 4", "Stalled · 2 expired". */
export function matchViewLabel(view, count) {
  const label = MATCH_VIEWS.find((v) => v.key === view)?.label || view;
  return view === 'stalled' ? `${label} · ${count} expired` : `${label} · ${count}`;
}

/** The latest of the people's last touches, or null when none is recorded. */
export function latestTouch(people) {
  let best = null;
  for (const person of people || []) {
    const at = person?.lastTouch;
    if (at && Number.isFinite(Date.parse(at)) && (!best || Date.parse(at) > Date.parse(best))) best = at;
  }
  return best;
}

/** Whole days since a stamp, or null. */
export function daysSince(at, now = Date.now()) {
  if (!at) return null;
  const t = Date.parse(String(at).replace(' ', 'T'));
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86400000));
}

/** Going cold is a recorded touch older than the window. No touch is unknown, never cold. */
export const isCold = (at, now = Date.now()) => {
  const days = daysSince(at, now);
  return days !== null && days > COLD_AFTER_DAYS;
};

/**
 * The open reminders on an organization's ties. `reminders` is the read:
 * `null` while loading, `'unreadable'` when it failed, else the rows. The
 * answer is `null` (loading), `'unreadable'`, or the open rows.
 */
export function openRemindersFor(relationshipIds, reminders) {
  if (reminders === 'unreadable') return 'unreadable';
  if (!Array.isArray(reminders)) return null;
  const ids = new Set([...(relationshipIds || [])].map(Number));
  return reminders.filter((r) => !r?.done && ids.has(Number(r?.relationship_id)));
}

/** The directory search: a case-blind match on the organization's name only. */
export function searchOrganizations(orgs, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return orgs || [];
  return (orgs || []).filter((org) => String(org?.name || '').toLowerCase().includes(q));
}

/** Where an organization's name came from: the person's own account (a linked profile), or the relationship alone. */
export const nameSource = (org) => (org?.profileId ? 'their account' : 'name on the relationship · profile not confirmed');

/**
 * NW3.1: what the request sheet draws once "who knows them" is read.
 *   pick    — teammates who share know them: choose one.
 *   ask     — none does, and the investor has a founder or startup on Axal to name: an ask can be used.
 *   no_ask  — none does, and nothing nameable: an ask cannot be used here.
 */
export function requestBranch({ people, askTargets }) {
  if (Array.isArray(people) && people.length > 0) return 'pick';
  return Array.isArray(askTargets) && askTargets.length > 0 ? 'ask' : 'no_ask';
}

/** What the who-knows search asks about, by the segment chosen. A person is a LinkedIn URL or an email (D1356). */
export const SEARCH_KINDS = Object.freeze([
  { key: 'person', label: 'Person', field: 'LinkedIn URL or email' },
  { key: 'company', label: 'Company', field: 'Company name' },
  { key: 'fund', label: 'Fund', field: 'Fund name' },
]);

/** The query the who-knows read takes, or null when the field is empty. */
export function searchQuery(kind, value) {
  const v = String(value || '').trim();
  if (!v || !SEARCH_KINDS.some((k) => k.key === kind)) return null;
  return { [kind]: v };
}

/** "1 received · 4 sent · no credit is used": the From your team line, from the log's own rows. */
export function teamLine(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const received = list.filter((x) => x.side !== 'sent').length;
  const sent = list.filter((x) => x.side === 'sent').length;
  return { received, sent, line: `${received} received · ${sent} sent · no credit is used` };
}
