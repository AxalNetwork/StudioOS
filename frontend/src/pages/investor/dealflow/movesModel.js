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
import { PASS_TAXONOMY, dayWithYear, passReasonLabel } from '../../../lib/dealFlow.js';
import { BOARD_STAGES, ENTERED_WORD, STAGE_WORD, shortDayOf } from './flowModel';

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
/**
 * D5914 (DE14): Move to diligence, in what the Worker does. `PATCH /api/deals/flow/:dealId`
 * (or the add, for a deal not yet in the flow) moves the firm's own row and records the move;
 * it opens no diligence case and tells nobody, so the canvas's "opens a diligence checklist"
 * is not said here.
 */
export const MOVE_DILIGENCE_LINE = 'It leaves Screening and moves to Diligence in your deal flow, with its history kept. It does not open a diligence case: open one on the deal’s Diligence tab. The founder is not notified.';

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
  return `${head} Ventures already in Mine are not listed. A pass whose date to come back has arrived is the one exception. Nothing is added until you press Add to my deal flow. Not for me hides a row and asks for an optional reason.`;
}

/** The chip a row carries: how it would enter the flow. */
export const inboxChip = (item) => (item?.source === 'revisit' ? 'Back from your pass' : ENTERED_WORD[item?.entered_via] || 'Not recorded');

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
    // D6148: the firm's own pass, back on the date it chose.
    case 'revisit': {
      const passed = dayWithYear(item.return?.passed_at);
      const on = dayWithYear(item.return?.revisit_at);
      return `You passed${passed ? ` on ${passed}` : ''} (${passReasonLabel(item.return?.reason)}) and asked to see it again${on ? ` on ${on}` : ''}.`;
    }
    case 'thesis': return thesisReasonsLine(item.reasons);
    default: return null;
  }
}

/** D6147: a thesis match's criteria in words, in the fit's order (D1239's four). */
const REASON_WORD = Object.freeze({ sector: 'sector', stage: 'stage', region: 'market region', ticket: 'minimum check within your ticket' });
const listWords = (w) => (w.length < 2 ? w.join('') : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`);
/** "Matches your thesis: sector and minimum check within your ticket." The top reasons are the matching criteria, at most three. */
export function thesisReasonsLine(reasons) {
  const words = (Array.isArray(reasons) ? reasons : []).map((r) => REASON_WORD[r]).filter(Boolean).slice(0, 3);
  return words.length ? `Matches your thesis: ${listWords(words)}.` : 'Matches your thesis.';
}

/**
 * What a row offers. An invitation requested waits on the studio, so it only
 * opens (where the investor may read it); every other row offers Add, Pass and
 * Not for me, and Open where DEAL's rule holds.
 */
export function inboxActions(item = {}) {
  if (item.source === 'room') return { add: false, pass: false, dismiss: false, open: !!item.can_open };
  // D6148: a return is already in the flow, at Passed: it moves back to Screening, or Not for me hides it.
  if (item.source === 'revisit') return { add: false, pass: false, reopen: true, dismiss: true, open: !!item.can_open };
  return { add: true, pass: true, dismiss: true, open: !!item.can_open };
}

const SOURCE_WORD = Object.freeze({
  invitation: 'invitations', room: 'invitations you asked for', commitment: 'commitments', introduction: 'introductions',
  syndicate: 'open syndicates', watchlist: 'your watchlist', revisit: 'passes due back', thesis: 'matches to your thesis',
});

/** The ways in that could not be read, in words; the rest still list. */
export function unreadSources(sources = {}) {
  return Object.entries(sources || {}).filter(([k, v]) => SOURCE_WORD[k] && v && v.unreadable).map(([k]) => SOURCE_WORD[k]);
}

/** D6148: Next round is not detected; the read says so, and so does the page. */
export const nextRoundLine = (sources = {}) => (sources?.next_round && sources.next_round.detected === false
  ? (sources.next_round.reason || 'A new round on a venture you passed is not detected.') : null);

/** #6146: describe only the event's recorded fields; actor/time are rendered separately. */
export function flowEventSentence(event, enteredVia) {
  const stage = (key) => STAGE_WORD[key] || 'Not recorded';
  switch (event?.kind) {
    case 'entered': return `Entered at ${stage(event.to)} · ${ENTERED_WORD[enteredVia] || 'Not recorded'}.`;
    case 'moved': return `Moved from ${stage(event.from)} to ${stage(event.to)}.`;
    case 'passed': return `Passed · ${PASS_REASONS.find((r) => r.key === event.reason)?.label || 'Reason: Not recorded'}.`;
    case 'owner': return 'Owner changed.';
    case 'note': return 'Note changed.';
    default: return `Recorded change: ${event?.kind || 'Not recorded'}.`;
  }
}

/** The current row's return rule is not historical event data. Never attach it to an old pass. */
export function currentReturnLine(pass) {
  if (!pass) return null;
  if (pass.revisit === 'next_round') return 'Current pass · returns next round.';
  if (pass.revisit === 'date' && pass.revisit_at) return `Current pass · return date: ${pass.revisit_at}.`;
  return 'Current pass · return date: Not recorded.';
}
/**
 * D6147 — the thesis source's line, from its one `{ recorded, reason }` shape:
 *   - not recorded (no thesis set): its reason, with the way to set it;
 *   - unreadable: nothing here, `unreadSources` names it;
 *   - recorded: the cap, when there were more High-fit matches than are listed.
 * Never "no matches" for a source that could not say.
 */
export const thesisLine = (sources = {}) => {
  const t = sources?.thesis;
  if (!t || t.unreadable) return null;
  if (t.recorded === false) return t.reason || 'Matches to your thesis are not recorded yet.';
  if (t.recorded === true && t.more && t.cap) return `Only the newest ${t.cap} matches to your thesis are listed. Each is a High fit.`;
  return null;
};
/** Whether the line offers Set your thesis: the read says no thesis is set. */
export const thesisNeedsSetting = (sources = {}) => sources?.thesis?.recorded === false && sources.thesis.thesis_set === false;
