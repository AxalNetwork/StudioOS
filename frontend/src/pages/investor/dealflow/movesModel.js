/**
 * D1241 (#3254, part 5 of #2423) — the rules of DLS6 (New for you) and DLS10
 * (the stage-move dialogs), kept pure so a test reads them without a page.
 *
 * Every change opens a dialog or leaves an undo toast:
 *   - a move forward to Screening or Diligence is immediate, with Undo;
 *   - a move back opens "Move back" (it keeps its history);
 *   - a move to Commit opens "Move to Commit" (it does not open a vote);
 *   - Closing follows a commitment: the Worker refuses it without one
 *     (`closing_needs_commitment`) and the card stays where it was;
 *   - Passed is reached only through the pass, with one of the five reasons.
 * The pass is the investor's alone: the round stays open for everyone else.
 */
import { PASS_TAXONOMY } from '../../../lib/dealFlow.js';
import { BOARD_STAGES, ENTERED_WORD, shortDayOf } from './flowModel';

const order = (s) => BOARD_STAGES.indexOf(s);

/** How a move from `from` to `to` is made: `pass`, `back`, `commit` or `direct`. */
export function moveKind(from, to) {
  if (to === 'passed') return 'pass';
  // Passed sits outside the board's order, so a move off it is never a move back.
  if (order(to) >= 0 && order(to) < order(from)) return 'back';
  if (to === 'commit') return 'commit';
  return 'direct';
}

/** The five reasons, in the Worker's order (`dealPassTaxonomy.ts`), each with the canvas's sub-line. */
const PASS_SUB = Object.freeze({
  early: 'The venture needs more proof before you invest.',
  valuation: 'The price or terms do not work for you.',
  thesis: 'Sector, stage, region or ticket is outside your thesis.',
  team: 'The team is not the right fit for this venture.',
  competitive: 'The market or a rival worries you.',
});
export const PASS_REASONS = Object.freeze(PASS_TAXONOMY.map((r) => ({ key: r.key, label: r.label, sub: PASS_SUB[r.key] || r.hint })));

export const PASS_NOTE_BOX = 'This is your pass. The round stays open for other investors. The studio sees that you passed, not your note.';
export const PASS_INVITED_LINE = 'The studio that invited you is told you passed.';
export const MOVE_BACK_LINE = 'It keeps its history.';
export const COMMIT_LINE = 'This does not open a vote. Open one on the deal page when you are ready.';

const tomorrow = (now = new Date()) => new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);

/**
 * The pass's body, or the sentence that stops it. A reason is required; a
 * date to come back must be after today; a note is optional.
 */
export function passBody({ reason, revisit = 'next_round', revisitAt = '', note = '', viaKey = null }, now = new Date()) {
  if (!PASS_REASONS.some((r) => r.key === reason)) return { error: 'Choose why you are passing.' };
  if (revisit === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(revisitAt) || revisitAt < tomorrow(now))) return { error: 'Choose a date after today.' };
  const body = { reason, revisit };
  if (revisit === 'date') body.revisit_at = revisitAt;
  if (note.trim()) body.note = note.trim();
  if (viaKey) body.via_key = viaKey;
  return { body };
}

// ---------------------------------------------------------------- New for you (DLS6)

/** The intro line, with its count; never "0 new". */
export function inboxIntro(n) {
  const head = n === 1 ? '1 new, newest first.' : `${n} new, newest first.`;
  return `${head} Ventures already in Mine are not listed. Nothing is added until you press Add to my deal flow. Not for me hides a row and asks for an optional reason.`;
}

/** The chip a row carries: how it would enter the flow. */
export const inboxChip = (item) => ENTERED_WORD[item?.entered_via] || 'Not recorded';

/** The line under the name: what brought it here, in the item's own facts. */
export function inboxLine(item = {}) {
  const day = shortDayOf(item.at);
  switch (item.source) {
    case 'invitation': return item.message ? `The studio: “${item.message}”` : 'The studio invited you to this round.';
    case 'room': return `You joined this room${day ? ` on ${day}` : ''} and asked to be invited. The studio decides.`;
    case 'commitment': return 'You have a commitment on this round.';
    case 'introduction': return 'The founder accepted your introduction.';
    case 'syndicate': return 'A syndicate is open on this round.';
    case 'watchlist': return day ? `Converted on ${day}.` : 'A venture on your watchlist opened a round.';
    default: return null;
  }
}

/**
 * What a row offers. An invitation requested waits on the studio, so it only
 * opens (where the investor may read it); every other row offers Add, Pass and
 * Not for me, and Open where DEAL's rule holds.
 */
export function inboxActions(item = {}) {
  if (item.source === 'room') return { add: false, pass: false, dismiss: false, open: !!item.can_open };
  return { add: true, pass: true, dismiss: true, open: !!item.can_open };
}

const SOURCE_WORD = Object.freeze({
  invitation: 'invitations', room: 'invitations you asked for', commitment: 'commitments', introduction: 'introductions',
  syndicate: 'open syndicates', watchlist: 'your watchlist',
});

/** The ways in that could not be read, in words; the rest still list. */
export function unreadSources(sources = {}) {
  return Object.entries(sources || {}).filter(([k, v]) => SOURCE_WORD[k] && v && v.unreadable).map(([k]) => SOURCE_WORD[k]);
}

/** Matches to the thesis, when the read says none are recorded: the reason, never "no matches". */
export const thesisLine = (sources = {}) => (sources?.thesis && sources.thesis.recorded === false
  ? (sources.thesis.reason || 'Matches to your thesis are not recorded yet.') : null);
