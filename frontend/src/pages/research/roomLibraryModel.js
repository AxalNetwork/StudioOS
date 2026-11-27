/**
 * D6913 (#6913, canvas `Investor Research v2 Data Room to Library`, RS-13, RS-14 and RS-16): the words and rules of a
 * data-room file in an investor's Library, over D6869's routes (`lib/api/roomLibrary.js`). Pure, so every sentence is
 * testable; `RoomLibrary.jsx` and `LibraryZone.jsx` draw them.
 *
 * A Library row added from a room is a reference, not a copy: it is read only, it is opened in the room (its download
 * answers 409 `open_in_room`), and it lapses the moment the grant stops reaching the file. The Worker decides every
 * state here (`room`, `lost_reason`, `in_ask`, `from_rooms`); nothing is recomputed.
 */

const NR = 'Not recorded';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dayWords(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
}

/** RS-14: the Source filter beside the kind filters. `rooms` is D6869's From data rooms. */
export const SOURCES = Object.freeze([
  { key: '', label: 'All sources' },
  { key: 'ours', label: 'Ours' },
  { key: 'clients', label: 'Shared by clients' },
  { key: 'rooms', label: 'From data rooms' },
]);
export function sourceKeyOf(d) {
  if (d?.room) return 'rooms';
  return d?.source === 'client' ? 'clients' : 'ours';
}
export function bySource(items, key) {
  if (!key) return items || [];
  return (items || []).filter((d) => sourceKeyOf(d) === key);
}

/** RS-16: why a reference no longer reaches its file, one reason in its own words. */
export const LAPSE_REASONS = Object.freeze({
  revoked: 'The founder ended your access to this room.',
  expired: 'Your access to this room expired.',
  removed: 'The founder removed this file from the room.',
  moved: 'This file is no longer in the folders your access opens.',
  nda_lapsed: 'The NDA for this room is no longer active.',
  library_off: 'The founder no longer lets investors keep this room’s files in their Library.',
});
export const SOURCE_GONE = 'Source no longer available';
/** A file behind an NDA that lapsed is never named, as the room's own log does not name it. */
export const NAMELESS = 'A file behind the NDA';

/** The row's room facts, or null for a row that did not come from a room. */
export function roomOf(d) {
  const r = d?.room;
  if (!r) return null;
  const lost = Boolean(r.lost_at);
  const reason = lost ? (r.lost_reason || null) : null;
  return {
    chip: `From ${r.project_name || 'a'} data room`,
    projectUid: lost ? null : r.project_uid || null,
    added: dayWords(r.added_at),
    lost,
    reason,
    reasonWords: lost ? (LAPSE_REASONS[reason] || SOURCE_GONE) : null,
    nameless: lost && reason === 'nda_lapsed',
  };
}

/** The title a Library row shows: a lapsed NDA file is nameless everywhere. */
export function rowTitle(d) {
  const r = roomOf(d);
  return r?.nameless ? NAMELESS : (d?.title || NR);
}

/** RS-16: a lapsed reference is out of Ask, whatever its index state read before. */
export function roomAnswerability(d) {
  const r = roomOf(d);
  if (!r) return null;
  if (r.lost) return { label: 'Not answerable', tone: 'neutral', glyph: '⊘', why: SOURCE_GONE };
  return null;
}

/** RS-14 header: "N answerable in Ask · M not answerable", room rows counted (the Worker's own counts). */
export function answerableLine(payload) {
  const a = Number(payload?.answerable);
  const n = Number(payload?.not_answerable);
  if (!Number.isFinite(a) || !Number.isFinite(n)) return null;
  return `${a} answerable in Ask · ${n} not answerable`;
}

/** RS-13: the room's own state for one of its files: in the caller's Library (with its row), or not yet. */
export function fileLibraryState(fileUid, read) {
  if (!read || read.state !== 'ready') return { state: read?.state || 'loading' };
  const hit = (read.items || []).find((i) => i.file_uid === fileUid);
  if (hit) return { state: 'added', documentUid: hit.document_uid, added: dayWords(hit.added_at) };
  return { state: read.allowed ? 'addable' : 'off' };
}

export const LIBRARY_OFF = 'The founder has not allowed Library copies of this room’s files.';
export const COST_LINE = 'Indexing: no charge. Each Ask answer is charged as today.';

/** RS-13 confirm sheet: what is added, from which room, the access and its end, read only, and the cost line. */
export function confirmLines({ file, room }) {
  const ends = dayWords(room?.grant?.expires_at);
  return [
    ['File', file?.name || NR],
    ['From', `${room?.project?.name || NR} data room`],
    ['Access', ends ? `Your access, until ${ends}` : 'Your access, with no end date recorded'],
    ['In your Library', 'Read-only. It is opened in the room, and it leaves your Library when your access to it ends.'],
    ['Cost', COST_LINE],
  ];
}

/** One sentence for each refusal D6869's routes send; anything else is the generic line. */
const REFUSALS = {
  library_off: LIBRARY_OFF,
  nda_required: 'This file is behind the NDA. Sign it in the room first.',
  already_added: 'This file is already in your Library.',
  file_not_found: 'That file is not one your access opens.',
  room_not_found: 'This room is not open to you.',
  investor_only: 'Only an investor with access to the room adds its files to their Library.',
  support_session: 'A support session cannot add to someone’s Library.',
};
export function libraryError(e) {
  const code = e?.data?.error || e?.data?.code || e?.code || null;
  return (code && REFUSALS[code]) || 'Nothing was added. Try again.';
}

/**
 * D6913 part 3 (RS-15): how long the room stays open to this file, from the Worker's `room.access`. A grant with no
 * end reads "No expiry set"; a reference with no live grant (lapsed, or read without one) has no access line at all.
 */
export function accessWords(d) {
  const a = d?.room?.access;
  if (!a) return null;
  const until = dayWords(a.until);
  return until ? `Available until ${until}` : 'No expiry set';
}

/**
 * RS-15: an Ask source that is a room file. The citation names a document; the Library row with that uid says whether
 * it came from a room. Null for any other source, and for one no longer in the Library (its room is not known).
 */
export function citationRoom(ct, items) {
  const uid = ct?.document_uid;
  if (!uid) return null;
  const d = (items || []).find((x) => x?.uid === uid);
  const r = roomOf(d);
  if (!r) return null;
  return { ...r, title: rowTitle(d), access: accessWords(d), inAsk: r.lost ? 'Not answerable' : (d.in_ask ? 'Yes' : 'No') };
}

/** RS-15 lapsed: the passage is withheld once the room no longer reaches its file; the answer keeps its own text. */
export function withheldPassage(answeredAt) {
  const day = dayWords(answeredAt);
  return `The passage is no longer shown. The answer keeps its text as it was given${day ? ` on ${day}` : ''}.`;
}
