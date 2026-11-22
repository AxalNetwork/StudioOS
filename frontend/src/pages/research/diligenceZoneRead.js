/**
 * D6269 (#6269): what `/research/diligence` shows, worked out from
 * `GET /api/research/diligence` (D6267, D6266) and drawn to the Investor
 * Research v2 Rooms canvas (IRV-02, IRV-05, IRV-06). Pure: no React, so the
 * page and a plain `node --test` read the same answers.
 *
 * The tiles, the chips, the rows and the export all come from here, so no
 * figure on the page is worked out twice. A measured 0 is a figure; a failed
 * read is never a 0 (`requests: null` with `requests_unreadable`).
 */

/** Days before expiry that a room is marked expiring soon (IRV-01: "expires within 14 days"). */
export const EXPIRING_SOON_DAYS = 14;

const DAY_MS = 86400000;

/** A stored time as milliseconds, or null. A bare `YYYY-MM-DD HH:MM:SS` is UTC, as D1 writes it. */
export function stampMs(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s) ? `${s.replace(' ', 'T')}Z` : s;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** "26 Nov 2026"; an unparsable stamp is shown as stored, never dropped. */
export function dayWord(v) {
  const t = stampMs(v);
  if (t == null) return v == null || v === '' ? null : String(v);
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * The expiry cell: `{ kind: 'none' }` for no end date, or the date with
 * `soon` ("in 12 days", "today") when it falls within EXPIRING_SOON_DAYS.
 */
export function expiryMark(expiresAt, now) {
  if (expiresAt == null || expiresAt === '') return { kind: 'none', word: 'No end date' };
  const t = stampMs(expiresAt);
  if (t == null) return { kind: 'date', word: String(expiresAt), soon: null };
  // Calendar days in UTC, so a room expiring this evening reads "today", not "in 1 day".
  const days = Math.floor(t / DAY_MS) - Math.floor(now / DAY_MS);
  const soon = days <= EXPIRING_SOON_DAYS
    ? (days <= 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`)
    : null;
  return { kind: 'date', word: dayWord(expiresAt), soon };
}

/** The NDA with the founder, in the canvas's words (IRV-02 `nda()`); an unknown status is Not recorded. */
export function ndaWord(nda) {
  const status = nda && typeof nda === 'object' ? nda.status : undefined;
  if (status === 'on_file') return { kind: 'on_file', word: 'NDA signed', until: nda.valid_until ? dayWord(nda.valid_until) : null };
  if (status === 'out_for_signature') return { kind: 'out_for_signature', word: 'NDA out for signature' };
  if (status === 'none') return { kind: 'none', word: 'No NDA' };
  return { kind: 'not_recorded', word: 'Not recorded' };
}

// `Number(null)` is 0, so an absent figure is checked before it is converted: missing is never 0.
const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** The three counts of a room, kept apart: open to you, in the room, behind an NDA. */
export function roomCounts(r) {
  const open = n(r?.file_open);
  const total = n(r?.file_total);
  const behind = n(r?.withheld_behind_nda) ?? (open != null && total != null ? total - open : null);
  return { open, total, behind };
}

/** The deal stage cell for the export: the stage words, "None", or "Unavailable" when the join failed. */
export function dealStageText(r, stageWord) {
  if (!Array.isArray(r?.deals)) return 'Unavailable';
  const list = r.deals.filter((d) => d && d.id != null);
  return list.length ? list.map((d) => stageWord(d.stage)).join('; ') : 'None';
}

/**
 * The request list, or null when it could not be read. An absent field on an
 * older Worker reads as unreadable too: nothing here turns a missing list into
 * "no requests".
 */
export function requestList(data) {
  if (!data || data.requests_unreadable === true || !Array.isArray(data.requests)) return null;
  return data.requests.filter((q) => q && (q.state === 'open' || q.state === 'declined'));
}

/** The three tiles (IRV-02). `requestsOpen` is null when the request read failed. */
export function tiles(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const requests = requestList(data);
  return {
    granted: n(data?.granted_count) ?? items.length,
    partlyStaged: n(data?.partial_count) ?? items.filter((r) => (roomCounts(r).behind || 0) > 0).length,
    requestsOpen: requests == null ? null : requests.filter((q) => q.state === 'open').length,
  };
}

/**
 * The chips (D6269): each selects a real state. `all` and `partial` select
 * rooms; `requested` and `declined` select requests, so a room list is not
 * shown under them and the Requests block is.
 */
export const FILTERS = Object.freeze(['all', 'partial', 'requested', 'declined']);

export function chipCounts(data) {
  const t = tiles(data);
  const requests = requestList(data);
  return {
    partial: t.partlyStaged,
    requested: t.requestsOpen ?? undefined,
    declined: requests == null ? undefined : requests.filter((q) => q.state === 'declined').length,
  };
}

/** What a filter shows: the rooms (or null for none) and the requests (or null for none, [] for an empty list). */
export function view(data, filter) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const requests = requestList(data);
  const f = FILTERS.includes(filter) ? filter : 'all';
  const rooms = f === 'requested' || f === 'declined'
    ? null
    : f === 'partial' ? items.filter((r) => (roomCounts(r).behind || 0) > 0) : items;
  let reqs;
  if (f === 'partial') reqs = undefined;
  else if (requests == null) reqs = null;
  else if (f === 'requested') reqs = requests.filter((q) => q.state === 'open');
  else if (f === 'declined') reqs = requests.filter((q) => q.state === 'declined');
  else reqs = requests;
  return { filter: f, rooms, requests: reqs };
}

/** The export (D6269): every column the row shows, each a value or its state word, never a made-up 0. */
export const EXPORT_HEADER = Object.freeze([
  'Company', 'Open to you', 'In the room', 'Behind an NDA', 'NDA with founder', 'NDA valid until',
  'Deal stage', 'Granted', 'You last opened', 'Access expires',
]);

export function exportCells(r, stageWord) {
  const c = roomCounts(r);
  const nda = ndaWord(r?.nda);
  return [
    r?.project_name ?? 'Not recorded',
    c.open ?? 'Not recorded',
    c.total ?? 'Not recorded',
    c.behind ?? 'Not recorded',
    nda.word,
    nda.kind === 'on_file' ? (r.nda.valid_until ?? 'No end date') : '',
    dealStageText(r, stageWord),
    r?.created_at ?? 'Not recorded',
    r?.last_opened_at ?? 'Never opened',
    r?.expires_at ?? 'No end date',
  ];
}
