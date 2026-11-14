/**
 * D1576 (#3823, deck v2 E3) — entrances and transitions, the browser half.
 * Pure: no React, no network.
 *
 *   ENTRANCES / TRANSITIONS   the Worker's lists (`services/decks/motion.ts`),
 *                             with their words; `motion_d1576` holds them equal
 *   entranceOf, transitionOf  the Worker's readers, mirrored
 *   entranceSequence          the order areas enter: by `order`, then reading
 *                             order — the order the PowerPoint's clicks play
 *   presentStep               Present's keys over a card's entrances: next
 *                             reveals the next area, then moves to the next
 *                             card; prev hides the last, then goes back to the
 *                             previous card with all of its areas shown
 *   areaMotion                one area's state at a step: hidden, or shown
 *                             with its entrance animation (none under reduced
 *                             motion: the same steps, no movement)
 *   transitionMotion          the card's transition as it comes up (none under
 *                             reduced motion)
 *   MOTION_CSS                the keyframes Present draws them with
 */

export const ENTRANCES = Object.freeze(['fade', 'rise', 'zoom', 'wipe']);
export const TRANSITIONS = Object.freeze(['fade', 'push', 'wipe']);
export const ORDER_MAX = 24;
export const MOTION_MS = 500;

export const ENTRANCE_WORDS = Object.freeze({ fade: 'Fade in', rise: 'Rise', zoom: 'Zoom', wipe: 'Wipe' });
export const TRANSITION_WORDS = Object.freeze({ fade: 'Fade', push: 'Push', wipe: 'Wipe' });
export const NO_ENTRANCE = 'None';
export const NO_TRANSITION = 'None';
export const ENTRANCE_TITLE = 'Entrance';
export const TRANSITION_TITLE = 'Transition';
/** pd3: why the control is there, under it. */
export const ENTRANCE_LINE = 'Plays in Present and in the PowerPoint, one area per click, in order. Reduced motion shows each at once.';
export const TRANSITION_LINE = 'How this card comes up in Present and in the PowerPoint. Reduced motion skips it.';

export function entranceOf(v) {
  if (!v || typeof v !== 'object' || !ENTRANCES.includes(v.effect)) return null;
  const out = { effect: v.effect };
  if (Number.isInteger(v.order) && v.order >= 1 && v.order <= ORDER_MAX) out.order = v.order;
  return out;
}

export const transitionOf = (v) => (TRANSITIONS.includes(v) ? v : null);

/** The ids of the card's areas that enter, in the order they play (the Worker's `entranceSequence`). */
export function entranceSequence(card) {
  const blocks = (Array.isArray(card?.blocks) ? card.blocks : [])
    .map((b, i) => ({ b, i, e: entranceOf(b?.entrance) }))
    .filter((x) => x.e && typeof x.b?.id === 'string' && x.b.grid);
  return blocks.sort((a, z) => ((a.e.order ?? ORDER_MAX + 1) - (z.e.order ?? ORDER_MAX + 1))
    || (a.b.grid.r1 - z.b.grid.r1) || (a.b.grid.c1 - z.b.grid.c1) || (a.i - z.i)).map((x) => x.b.id);
}

/**
 * Present's position after a key: `{ card, shown }`, where `shown` is how many
 * of the card's entrances have played. `cards` are Present's cards.
 */
export function presentStep(at, step, cards) {
  const n = Array.isArray(cards) ? cards.length : 0;
  if (!n) return { card: 0, shown: 0 };
  const i = Math.max(0, Math.min(n - 1, Number(at?.card) || 0));
  const steps = (k) => entranceSequence(cards[k]).length;
  const shown = Math.max(0, Math.min(steps(i), Number(at?.shown) || 0));
  if (step === 'next') {
    if (shown < steps(i)) return { card: i, shown: shown + 1 };
    return i < n - 1 ? { card: i + 1, shown: 0 } : { card: i, shown };
  }
  if (step === 'prev') {
    if (shown > 0) return { card: i, shown: shown - 1 };
    return i > 0 ? { card: i - 1, shown: steps(i - 1) } : { card: i, shown: 0 };
  }
  if (step === 'first') return { card: 0, shown: 0 };
  if (step === 'last') return { card: n - 1, shown: 0 };
  return { card: i, shown };
}

/**
 * One area at a step: `{ hidden: true }` before its turn; after it,
 * `{ hidden: false, animation }`, the animation only on the step that
 * revealed it and never under reduced motion. An area with no entrance is
 * always shown.
 */
export function areaMotion(card, blockId, shown, reduced) {
  const seq = entranceSequence(card);
  const k = seq.indexOf(blockId);
  if (k < 0) return { hidden: false, animation: null };
  if (k >= shown) return { hidden: true, animation: null };
  if (reduced || k !== shown - 1) return { hidden: false, animation: null };
  const b = (card.blocks || []).find((x) => x.id === blockId);
  return { hidden: false, animation: `deck-in-${entranceOf(b?.entrance).effect} ${MOTION_MS}ms ease-out both` };
}

/** The card's transition as it comes up; null for none and under reduced motion. */
export function transitionMotion(card, reduced) {
  const t = transitionOf(card?.transition);
  return t && !reduced ? `deck-tr-${t} ${MOTION_MS}ms ease-out both` : null;
}

/** The block's entrance after a choice in BlockTools: null clears it. */
export function withEntrance(block, effect, order) {
  if (!ENTRANCES.includes(effect)) return { entrance: null };
  const e = { effect };
  const o = Number(order);
  if (Number.isInteger(o) && o >= 1 && o <= ORDER_MAX) e.order = o;
  return { entrance: e };
}

export const MOTION_CSS = [
  '@keyframes deck-in-fade{from{opacity:0}to{opacity:1}}',
  '@keyframes deck-in-rise{from{opacity:0;transform:translateY(10%)}to{opacity:1;transform:none}}',
  '@keyframes deck-in-zoom{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}',
  '@keyframes deck-in-wipe{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}',
  '@keyframes deck-tr-fade{from{opacity:0}to{opacity:1}}',
  '@keyframes deck-tr-push{from{transform:translateY(100%)}to{transform:none}}',
  '@keyframes deck-tr-wipe{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}',
].join('');
