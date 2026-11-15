/**
 * #6192 — how one deal note's byline reads, and how the notes list pages. Pure.
 *
 * A note's author is You, the colleague's name (`author_name`, sent by the
 * Worker only for a note your firm shares), or "Your firm" when that account
 * has no name. "edited <date>" appears only when the note was changed after it
 * was written (`updated_at` later than `created_at`).
 */

export const NOTES_PAGE = 25;
export const NOTE_FILTER_ALL = '';

const day = (iso) => String(iso || '').slice(0, 10);

export function noteAuthor(note, userId) {
  if (Number(note?.author_user_id) === Number(userId)) return 'You';
  const name = String(note?.author_name ?? '').trim();
  return name || 'Your firm';
}

/** `null` when the note was never changed after it was written. */
export function noteEdited(note) {
  const c = String(note?.created_at || '');
  const u = String(note?.updated_at || '');
  if (!c || !u || u <= c) return null;
  return `edited ${day(u)}`;
}

/** The note's byline: date · author · tag · edited. */
export function noteByline(note, userId) {
  return [day(note?.created_at) || 'Date not recorded', noteAuthor(note, userId), note?.tag || '', noteEdited(note) || '']
    .filter(Boolean).join(' · ');
}

/** True while loaded rows are fewer than the (filtered) total. */
export function notesHaveMore(items, total) {
  return Number.isFinite(Number(total)) && (items?.length || 0) < Number(total);
}
