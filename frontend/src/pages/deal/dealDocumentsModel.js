/**
 * D6186 (#6186) — the Documents tab for everyone who is not the deal's investor: the venture's founder, an
 * Admin and an Operating Partner. Pure, so `frontend/test/deal_documents_6186.test.mjs` holds each rule.
 *
 * WHAT EACH VIEWER GETS.
 *  - The founder (own deal): the deal paper they are party to; a card for their data room with its counts and
 *    a link to Raise › Data room; the investors' pending access requests with a link to where they decide
 *    them; and how many times the room was opened this week, with a link to the Activity tab, which names
 *    who opened what (the data room is the venture's, so the deal's room is its project's room).
 *  - An Admin: every envelope on the deal, the documents list, and a plain line that the founder's data room
 *    opens to staff only through an audited support read (`data_room.ts` refuses an admin elsewhere).
 *  - An Operating Partner: the envelopes they are party to, the documents list (behind the venture's NDA, as
 *    for an investor, D4631), and a line that the data room is not open to them (DL15: Never).
 *
 * A DOCUMENT ROW never stands without an action or a reason. No route serves a `documents` row's text
 * (`legal.ts` `safeDoc` redacts it on purpose), so a row has no Open; it says why. A row sent through e-sign
 * (`in_paper`) points to the Deal paper card, where a fully signed envelope downloads.
 */

export const ROOM_HOME = '/raise/data-room';

/** A tab of the founder's Data room tool, for this venture. */
export function roomHref(tab, projectId) {
  const path = tab ? `${ROOM_HOME}/${tab}` : ROOM_HOME;
  return projectId != null ? `${path}?project_id=${encodeURIComponent(String(projectId))}` : path;
}

/** Who reads this tab: 'founder', 'admin' (a Super Admin reads as one) or 'partner'; null for anyone else. */
export function documentsViewer(viewer) {
  if (viewer === 'founder' || viewer === 'partner') return viewer;
  if (viewer === 'admin' || viewer === 'super') return 'admin';
  return null;
}

/** What the Deal paper card says it lists, by viewer. */
export const PAPER_SCOPE = Object.freeze({
  founder: 'The envelopes on this deal that you are party to.',
  admin: 'Every envelope sent on this deal.',
  partner: 'The envelopes on this deal that you are party to.',
});
export const PAPER_NONE = Object.freeze({
  founder: 'No envelope on this deal has been sent to you yet.',
  admin: 'No envelope has been sent on this deal yet.',
  partner: 'No envelope on this deal has been sent to you yet.',
});

/** The staff line about the founder's data room. */
export const ROOM_LINE = Object.freeze({
  admin: 'The founder’s data room opens to staff only through an audited support read. The founder is told, with your reason.',
  partner: 'The founder’s data room is not open to an Operating Partner. Investors reach it by the founder’s grant.',
});

export const IN_PAPER_REASON = 'Sent through e-sign. Open it from Deal paper.';
export const NO_FILE_REASON = 'Kept as a record without a file. The platform does not serve its text, so there is nothing to open.';
export const DOCS_NONE = 'No document is recorded for this venture.';
export const DOCS_NDA = 'The documents are shared under the venture’s NDA. Sign it to see them.';

const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, (x) => x.toUpperCase());
const STATUS = { draft: 'Draft', generated: 'Generated', sent: 'Sent', signed: 'Signed' };

/** One row: its title, kind and status in words, and the reason it cannot be opened (there is no Open). */
export function documentRow(d) {
  return {
    id: d.id,
    title: String(d.title || 'Untitled document'),
    kind: titleCase(d.doc_type) || 'Other',
    status: STATUS[d.status] || 'Not recorded',
    reason: d.in_paper === true ? IN_PAPER_REASON : NO_FILE_REASON,
    inPaper: d.in_paper === true,
  };
}

export const documentRows = (docs) => (Array.isArray(docs) ? docs.map(documentRow) : []);

const count = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);

/**
 * The founder's room card, from `GET /api/data-room/:projectUid` (the owner's read): files, folders, the grants
 * that are live, and opens this week. A count the read did not carry is null, drawn as Not recorded, never 0.
 */
export function roomCounts(room) {
  if (!room || typeof room !== 'object') return null;
  const grants = Array.isArray(room.grants) ? room.grants : null;
  return {
    files: Array.isArray(room.files) ? room.files.length : null,
    folders: Array.isArray(room.folders) ? room.folders.length : null,
    granted: grants ? grants.filter((g) => g?.status === 'active').length : null,
    opened: count(room.week?.opened),
  };
}

/** The founder's pending access requests, from `GET /api/data-room/:projectUid/requests`. */
export function pendingRequests(data) {
  if (!data || typeof data !== 'object') return null;
  if (count(data.open) != null) return count(data.open);
  return Array.isArray(data.requests) ? data.requests.filter((q) => q?.state === 'open').length : null;
}

export const shown = (n) => (n == null ? 'Not recorded' : String(n));
export const plural = (n, one, many) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** The requests card's line: what waits, and where the founder decides it. */
export function requestsLine(n) {
  if (n == null) return null;
  if (n === 0) return 'No investor is waiting for access.';
  return `${plural(n, 'investor is', 'investors are')} waiting for your answer.`;
}
