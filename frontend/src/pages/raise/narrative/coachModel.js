/**
 * D1558 (#3805, deck v2 C10) — the words of "Deck ready to send" and the
 * narrative coach (`NarrativeCoach.jsx`). Pure.
 */
export const COACH_OPTION = 'review:narrative-coach';
export const COACH_LABEL = 'Coach against the deck';
export const COACH_NOTE = 'Eadwyn reads this version against your current deck and names where the deck tells it less well, with a proposal for each. Nothing is changed.';
export const COACH_EMPTY = 'The deck tells this version well. Nothing to change.';
export const READY_UNREADABLE = 'Whether the deck is ready could not be read. This is not a claim that it is.';

/** The item's heading: ready, how many to fix, or what is not known. */
export function readyHead(status, data) {
  if (status === 'error') return 'Deck ready to send';
  if (!data) return 'Deck ready to send';
  if (data.state === 'ready') return 'Deck ready to send ✓';
  return data.label || 'Deck ready to send';
}

/** "Open card 3 · Traction", for a finding that names a card. */
export const findingLink = (f) => `Open card ${Number(f?.card_index) + 1}${f?.card_title ? ` · ${f.card_title}` : ''}`;

/** How many of the coach's findings were left out, or null. */
export function droppedLine(dropped) {
  const n = Array.isArray(dropped) ? dropped.length : 0;
  return n ? `${n} finding${n === 1 ? ' was' : 's were'} left out: ${n === 1 ? 'it' : 'they'} named a figure, a card or area not on the deck, or something else that could not be checked.` : null;
}

/** What a failed run says. */
export function coachFailure(e) {
  if (e?.data?.code === 'no_deck') return 'There is no deck to coach against yet. Build one first. Nothing was run.';
  if (e?.data?.code === 'nothing_to_read') return 'This version has no words yet. Write a section first. Nothing was run.';
  return e?.data?.detail || e?.data?.message || 'The coach could not run. Nothing was charged. Try again.';
}
