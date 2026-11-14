/**
 * D5791 (#5791) — the attached walkthrough on an investor's share link: its
 * words and what the viewer draws from the Worker's answer
 * (`routes/deck_share_walkthrough.ts`). Pure: no network, no React.
 *
 * The Worker sends the maker's newest take of each card the link sends, each
 * naming its card by uid. The viewer places each take on the card the investor
 * sees, in the link's own order (a variant's included), and numbers the cards
 * as the page does.
 */
import { CAPTIONS_NOT_RECORDED, clock, cueAt } from './walkthroughModel.js';

export { CAPTIONS_NOT_RECORDED, clock, cueAt };

export const WATCH = 'Watch the walkthrough';
export const WALKTHROUGH_TITLE = 'The founder\'s walkthrough';
export const HIDE = 'Hide the walkthrough';
export const UNREADABLE = 'The walkthrough could not be read.';
export const TRY_AGAIN = 'Try again';
export const PLAY_FAILED = 'This card\'s take could not be played.';
export const PREVIOUS = 'Previous card';
export const NEXT = 'Next card';

/**
 * The read's answer as the viewer draws it: `none` (nothing attached, or no
 * take of a card this link sends) draws nothing; `ok` carries the takes.
 */
export function walkthroughState(reply) {
  const takes = Array.isArray(reply?.takes) ? reply.takes.filter((t) => t && typeof t.uid === 'string' && typeof t.card_uid === 'string') : [];
  if (reply?.attached !== true || !takes.length) return { status: 'none', takes: [] };
  return { status: 'ok', takes };
}

/**
 * A failed read: HQ's switch off draws nothing (the investor cannot act on
 * it); anything else says the walkthrough could not be read.
 */
export const readProblem = (e) => (e?.code === 'not_switched_on' ? 'off' : 'unreadable');

/**
 * The takes in the order the investor sees the cards, each with its card's
 * place on the page (1-based) and its label. A take whose card is not on the
 * page is left out.
 */
export function playlist(takes, slides) {
  const list = Array.isArray(slides) ? slides : [];
  const byUid = new Map((Array.isArray(takes) ? takes : []).map((t) => [t?.card_uid, t]));
  const out = [];
  list.forEach((s, i) => {
    const take = s && typeof s.uid === 'string' ? byUid.get(s.uid) : null;
    if (!take) return;
    const title = typeof s.title === 'string' ? s.title.trim() : '';
    out.push({ take, index: i + 1, label: `Card ${i + 1}${title ? ` · ${title}` : ''}` });
  });
  return out;
}

/** The line under the entry: "3 cards · 4:12". */
export function summaryLine(items) {
  const n = Array.isArray(items) ? items.length : 0;
  const ms = (items || []).reduce((sum, it) => sum + (Number(it?.take?.duration_ms) || 0), 0);
  return `${n} ${n === 1 ? 'card' : 'cards'} · ${clock(ms)}`;
}

/** The caption under the take at `ms`, or the line for captions not recorded. */
export function captionLine(take, ms) {
  if (!Array.isArray(take?.captions)) return CAPTIONS_NOT_RECORDED;
  return cueAt(take.captions, ms) || '';
}
