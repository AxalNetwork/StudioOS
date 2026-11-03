/**
 * D1576 (#3823, deck v2 E3) — animation and transitions: what a card and its
 * areas store, and the one order they play in.
 *
 *   an area's entrance   `block.entrance = { effect, order? }`: fade, rise,
 *                        zoom or wipe; `order` (1–24) puts it earlier or later,
 *                        otherwise areas come in reading order (top to bottom,
 *                        then start to end).
 *   a card's transition  `card.transition`: fade, push or wipe; none when
 *                        absent.
 *
 * `entranceSequence(card)` is the order: Present reveals one area per step
 * in it (`frontend/.../motionModel.js` mirrors it, and the test holds the two
 * equal), and the PowerPoint writer (`pptxEditable.ts`) writes one click
 * effect per area in the same order, so Present and the PPTX play the same
 * sequence. Present honours `prefers-reduced-motion`: the same steps, each
 * area appearing at once with no movement, and no transition.
 *
 * Pure: imports nothing, so `slideModel.ts` reads it without a cycle.
 */

export const ENTRANCES = Object.freeze(['fade', 'rise', 'zoom', 'wipe'] as const);
export type Entrance = typeof ENTRANCES[number];
export const TRANSITIONS = Object.freeze(['fade', 'push', 'wipe'] as const);
export type Transition = typeof TRANSITIONS[number];
/** The order an author may give, 1 to this. */
export const ORDER_MAX = 24;
/** How long one entrance or transition takes, in Present and in the PowerPoint. */
export const MOTION_MS = 500;

/** An area's entrance as stored, or null for none or anything malformed. */
export function entranceOf(v: unknown): { effect: Entrance; order?: number } | null {
  const e = v as any;
  if (!e || typeof e !== 'object' || !(ENTRANCES as readonly string[]).includes(e.effect)) return null;
  const out: { effect: Entrance; order?: number } = { effect: e.effect };
  if (Number.isInteger(e.order) && e.order >= 1 && e.order <= ORDER_MAX) out.order = e.order;
  return out;
}

/** A card's transition as stored, or null for none. */
export const transitionOf = (v: unknown): Transition | null => ((TRANSITIONS as readonly string[]).includes(v as string) ? v as Transition : null);

/** What a save refuses (never trims): an entrance or transition that is not one of the list. */
export function motionProblems(card: any, label: string): string[] {
  const out: string[] = [];
  if (card?.transition != null && !transitionOf(card.transition)) out.push(`${label}: the transition must be fade, push or wipe.`);
  for (const b of Array.isArray(card?.blocks) ? card.blocks : []) {
    if (b?.entrance == null) continue;
    if (!entranceOf(b.entrance)) out.push(`${label}: an entrance must be fade, rise, zoom or wipe.`);
    else if (b.entrance.order != null && entranceOf(b.entrance)!.order == null) out.push(`${label}: an entrance's order is a whole number from 1 to ${ORDER_MAX}.`);
  }
  return out;
}

/**
 * The ids of a card's areas that enter, in the order they play: by `order`
 * first (an area without one after every area with one), then reading order.
 */
export function entranceSequence(card: any): string[] {
  const blocks = (Array.isArray(card?.blocks) ? card.blocks : [])
    .map((b: any, i: number) => ({ b, i, e: entranceOf(b?.entrance) }))
    .filter((x: any) => x.e && typeof x.b?.id === 'string' && x.b.grid);
  return blocks.sort((a: any, z: any) => ((a.e.order ?? ORDER_MAX + 1) - (z.e.order ?? ORDER_MAX + 1))
    || (a.b.grid.r1 - z.b.grid.r1) || (a.b.grid.c1 - z.b.grid.c1) || (a.i - z.i)).map((x: any) => x.b.id);
}
