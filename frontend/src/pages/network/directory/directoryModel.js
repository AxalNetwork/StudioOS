/**
 * D9025 (#9025): the words and the address state of the shared Network directory (D7676, NPD-01 to NPD-03),
 * pure so a test can hold them. The People page (#9025) and the Organizations directory (#9071) both read
 * `/api/network/directory/entries`, so both keep their search and page in the address the same way.
 *
 * THE ADDRESS. `q` is the search as typed and `c` is the trail of cursors that reached the page on screen,
 * joined by `.` (a cursor is base64, which never holds a dot). Page 1 has no `c`; page n holds n − 1 cursors,
 * so Previous drops the last one and a copied link reopens the same page. Nothing else goes in the address:
 * the directory has no facet filters yet (#7674), so there is no filter to keep.
 *
 * COUNTS. A total is the server's `total` for the whole filter, never the rows in hand, and an unknown total
 * reads "Counting…" while it loads and "Unavailable" when the read failed, never 0.
 */

/** A shared directory page holds 50 (D7676; the Worker's own ceiling, `services/networkDirectory.ts` PAGE_MAX). */
export const PAGE_SIZE = 50;

const CURSOR_SEP = '.';

/** `{ q, stack }` from a search string or URLSearchParams. A malformed trail reads as page 1. */
export function readListState(search) {
  const p = search instanceof URLSearchParams ? search : new URLSearchParams(search || '');
  const q = String(p.get('q') || '').trim();
  const raw = String(p.get('c') || '');
  const stack = raw ? raw.split(CURSOR_SEP).filter((s) => /^[A-Za-z0-9+/=_-]+$/.test(s)) : [];
  return { q, stack };
}

/** The search string for `{ q, stack }`, `?`-prefixed, or '' for the bare list. */
export function writeListState({ q = '', stack = [] } = {}) {
  const p = new URLSearchParams();
  const term = String(q || '').trim();
  if (term) p.set('q', term);
  if (stack.length) p.set('c', stack.join(CURSOR_SEP));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** The cursor the page on screen was read with: the last of the trail, or none for page 1. */
export const cursorOf = (stack) => (stack.length ? stack[stack.length - 1] : null);

/** 1-based page number of a trail. */
export const pageOf = (stack) => stack.length + 1;

const fmt = (n) => Number(n).toLocaleString('en-US');

/** "1–50 of 137": rows shown on this page, and the server's total. */
export function rangeLabel(page, shown, total) {
  if (!shown) return `0 of ${fmt(total)}`;
  const from = (page - 1) * PAGE_SIZE + 1;
  return `${fmt(from)}–${fmt(from + shown - 1)} of ${fmt(total)}`;
}

/**
 * The status line over the results. `total` null with `state` loading reads "Counting…"; a failed read
 * reads "Unavailable". A known total is the server's.
 */
export function totalLine({ state, total, q, noun = ['person', 'people'] }) {
  if (state === 'loading' || (state !== 'error' && (total === null || total === undefined))) return 'Counting…';
  if (state === 'error') return `Unavailable · the ${noun[1]} could not be counted`;
  const word = Number(total) === 1 ? noun[0] : noun[1];
  return q ? `${fmt(total)} ${word} match “${q}”` : `${fmt(total)} ${word} in the shared directory`;
}

/** The three affiliation statuses as the Worker sends them, in the canvas's order, with their words. */
export const AFFILIATION_STATUS = Object.freeze({
  current: { glyph: '●', word: 'Current' },
  former: { glyph: '○', word: 'Former' },
  unknown: { glyph: '?', word: 'Status not recorded' },
});

/** Affiliations grouped current, former, status not recorded (D7680 NPO-03); nothing is assumed current. */
export function groupAffiliations(affiliations = []) {
  const out = { current: [], former: [], unknown: [] };
  for (const a of affiliations || []) (out[a?.current] || out.unknown).push(a);
  return out;
}

/** "2017–2021", "from 2022-03", "to 2024-06", or null when the source gave no dates. */
export function dateSpan(a) {
  const s = a?.start_date || null;
  const e = a?.end_date || null;
  if (s && e) return `${s}–${e}`;
  if (s) return `from ${s}`;
  if (e) return `to ${e}`;
  return null;
}

/** "Partner, Fernhill · Venture Partner, Saltmarsh" from the current affiliations a person entry carries. */
export function currentLine(affiliations = [], side = 'organization') {
  return (affiliations || [])
    .filter((a) => a?.current === 'current' && a?.[side]?.name)
    .map((a) => (a.title ? `${a.title}, ${a[side].name}` : a[side].name))
    .join(' · ');
}

/** Sectors and stages as one focus line, or null when neither is recorded. */
export function focusLine(entry) {
  const sectors = Array.isArray(entry?.sectors) ? entry.sectors.filter(Boolean) : [];
  const stages = Array.isArray(entry?.stages) ? entry.stages.filter(Boolean) : [];
  if (!sectors.length && !stages.length) return null;
  return [sectors.join(', '), stages.join(', ')].filter(Boolean).join(' · ');
}

/** The verification state in words. A sourced claim is not a verified identity. */
export function verificationWord(v) {
  if (v === 'verified') return 'Verified by a steward';
  if (v === 'reviewed') return 'Reviewed by a steward, not verified';
  return 'Sourced, not verified';
}

/** YYYY-MM-DD from a stored stamp, or null. */
export const day = (stamp) => (stamp ? String(stamp).slice(0, 10) : null);

/** The same words for a private, unpublished, removed or unknown id (NPD-11): nothing reveals a record exists. */
export const NOT_AVAILABLE = 'This person is not available to you.';

/** A support session's own refusal, in plain words (the Worker's code `support_session_refused`). */
export const SUPPORT_REFUSED = 'A support session cannot read or change this member’s private relationship.';

/**
 * The sentence for a failed overlay call. A refusal the Worker answered is said in its own plain words;
 * anything else is a read or save that did not go through, and says so without claiming what is stored.
 */
export function overlayFailure(err, action = 'read') {
  if (err?.status === 403 && err?.code === 'support_session_refused') return { kind: 'refused', text: SUPPORT_REFUSED };
  if (err?.status === 404) return { kind: 'refused', text: NOT_AVAILABLE };
  if (err?.code === 'note_too_long') return { kind: 'field', text: 'A note is at most 2,000 characters.' };
  if (action === 'read') return { kind: 'unavailable', text: 'Your private record could not be read.' };
  return { kind: 'unavailable', text: 'That change was not saved. Nothing was changed; try again.' };
}

/** A failed entry read: a 404 (or a refused uid) is "not available"; anything else is a read that failed. */
export function entryFailure(err) {
  if (err?.status === 404 || err?.status === 400) return { kind: 'not_available', text: NOT_AVAILABLE };
  return { kind: 'unavailable', text: 'This person could not be read.' };
}

/** The link a copied person carries: the person only, never the list's filters or private context (NPD-11). */
export const personLink = (origin, uid) => `${origin || ''}/network/people/${encodeURIComponent(uid)}`;
