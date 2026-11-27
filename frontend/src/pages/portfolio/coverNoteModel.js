/**
 * D6888 (#6888): the pure half of Eadwyn's covering-note proposal in the statement sheet (D6217 PF-13a, PF-13h).
 *
 * The Worker drafts it on `POST /api/research/drafts` (surface `portfolio/statement`, the quarter-end as `scope_key`)
 * from the statement's own page 1 and page 2 figures for that date, and keeps nothing. This file holds the card's
 * words and what each answer from that route reads as. When Eadwyn is off, or cannot answer, the card says so in the
 * canvas's words, because the statement is complete without a note.
 */
import { guardRefusal } from '../../workspaces/draftCheck';

export const COVER_NOTE_SURFACE = 'portfolio/statement';
export const COVER_NOTE_OPTION = 'draft:statement-cover-note';
export const COVER_NOTE_TASK = 'Task · covering note for this statement';
export const COVER_NOTE_RUN = 'Propose a covering note';
export const COVER_NOTE_PROPOSAL = 'Proposal · not in the PDF';
export const COVER_NOTE_CITE = 'From page 1 (summary, coverage, at cost) and page 2 (Funded after). No forecast; no figure that is not on the statement.';
export const COVER_NOTE_FOOT = 'Copy puts the note on your clipboard for your own email. It goes into the PDF only if you tick “Include as a cover note”, and then it is marked as your own words.';
export const COVER_NOTE_OFF = 'Eadwyn is unavailable. The statement does not need it.';
export const COVER_NOTE_OFF_HINT = 'Write your own note in your email.';
export const COVER_NOTE_NO_BOOK = 'No position is recorded on or before this date, so there is no statement to cover.';
export const COVER_NOTE_COPY_FAILED = 'Copy is unavailable. Select the note and copy it.';

/**
 * What a refused or failed run reads as: `{ kind, text, link }`.
 *   nothing  409 `nothing_to_draft`: the date holds no book (or is not a completed quarter-end).
 *   withheld the guard withheld the draft, or could not check it: the guard's own words.
 *   budget   402: the allowance's own sentence.
 *   off      everything else (`assist_off`, `ai_paused`, `draft_unavailable`, a failed request): Eadwyn is off or
 *            unavailable, and the statement does not need it.
 */
export function coverNoteNotice(e) {
  if (e?.code === 'nothing_to_draft') return { kind: 'nothing', text: COVER_NOTE_NO_BOOK, link: null };
  const guard = guardRefusal(e);
  if (guard?.message) return { kind: 'withheld', text: guard.message, link: guard.link || null };
  if (e?.status === 402 && typeof e?.message === 'string' && e.message.trim()) return { kind: 'budget', text: e.message.trim(), link: null };
  return { kind: 'off', text: COVER_NOTE_OFF, link: null };
}
