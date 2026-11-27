/**
 * D1553 (#3800, deck v2 C5) — Remix: four layouts for one card, chosen from
 * The Grid's structures (`structures.ts`, D1499), and the remove-a-block
 * reflow (pd5).
 *
 * Deterministic and model-free: it runs no model, holds nothing and charges
 * nothing, so it works with AI paused (pd9e "Still works"). The same input
 * always answers the same four options.
 *
 * EVERY OPTION KEEPS THE CARD'S EVIDENCE. A layout moves blocks; it never
 * drops one, invents one or changes what one says. Each option holds exactly
 * the card's blocks, with the same content, bindings and values: only their
 * `grid` changes (`sameEvidence`). A structure that cannot hold every block
 * is not offered.
 *
 * HOW A CARD FITS A STRUCTURE.
 *   - Each evidence block (a metric, chart, graphic, image, video, audio,
 *     link, or a text block bound to a source) takes an area of its own.
 *   - The card's plain words (its heading and unbound text) may share one
 *     area, stacked by rows, the heading on top, when the structure has fewer
 *     areas than blocks.
 *   - A heading goes to the structure's title area when it has one.
 *   - Big number's metric area takes the first metric; a chart-first split
 *     puts the chart in its main area.
 *   - Areas left over are removed with the same reflow as "remove a block",
 *     so no option keeps an empty area.
 *
 * `removeBlock(card, id)` is pd5's "Remove a block · the rest reflows inside
 * the grid", exported so the one-click run (AUTO-4) can drop an empty or
 * unsupported area with no UI: the block and its area go, and the areas in the
 * same row band share the band's columns (else the areas in the same column
 * stack share its rows). The card becomes `custom`.
 */
import { GRID_COLS, GRID_ROWS, type Grid } from './slideModel';
import { CUSTOM, STRUCTURES, areasOf, areasProblem, structureOf, type Area, type Structure } from './structures';

export const REMIX_OPTIONS = 4;

/** The structures Remix offers, in the order it prefers them. Team, Timeline band, Overlay and Appendix table are for their own cards. */
export const REMIX_ORDER = ['hero_3', 'split_7_5', 'big_number', 'two_by_two', 'thirds', 'halves', 'quarters', 'split_5_7', 'sidebar_4_8', 'sidebar_8_4', 'z_pattern', 'title_body', 'full'] as const;

type Block = { id: string; kind: string; grid: Grid; style?: string; binding?: unknown; label?: string | null; value?: string | null; [k: string]: unknown };
type Card = { blocks?: Block[]; structure?: string; areas?: Area[]; layout?: string; [k: string]: unknown };
export type RemixOption = { structure: string; label: string; line: string; card: Card };

const isWords = (b: Block) => b.kind === 'text' && !b.binding;
const isHeading = (b: Block) => b.kind === 'text' && b.style === 'heading';
const readingOrder = (x: Block, y: Block) => x.grid.r1 - y.grid.r1 || x.grid.c1 - y.grid.c1;
const contains = (outer: Grid, inner: Grid) => outer.c1 <= inner.c1 && inner.c2 <= outer.c2 && outer.r1 <= inner.r1 && inner.r2 <= outer.r2;
const rangeOf = (g: Grid): Grid => ({ c1: g.c1, c2: g.c2, r1: g.r1, r2: g.r2 });
const blocksOf = (card: Card): Block[] => (Array.isArray(card?.blocks) ? card.blocks.filter((b) => b && typeof b.id === 'string' && b.grid) : []);

/** The card's blocks without their placement: what a layout must keep. */
export function evidenceOf(card: Card): string[] {
  return blocksOf(card).map(({ grid: _g, ...rest }) => JSON.stringify(rest, Object.keys(rest).sort())).sort();
}
/** True when two cards hold the same blocks, saying the same things, wherever they sit. */
export const sameEvidence = (a: Card, b: Card) => JSON.stringify(evidenceOf(a)) === JSON.stringify(evidenceOf(b));

/** Split `n` whole units of [lo, hi] into `k` contiguous ranges, the remainder to the first. */
function split(lo: number, hi: number, k: number): Array<[number, number]> {
  const n = hi - lo + 1;
  const base = Math.floor(n / k);
  let extra = n % k;
  const out: Array<[number, number]> = [];
  let at = lo;
  for (let i = 0; i < k; i++) {
    const w = base + (extra-- > 0 ? 1 : 0);
    out.push([at, at + w - 1]);
    at += w;
  }
  return out;
}

/**
 * Remove one area and give its cells to its neighbours: the areas in the same
 * row band (same rows) share the band's columns, in column order; else the
 * areas in the same column stack (same columns) share its rows. Returns the
 * new areas (reading order renumbered) and how each kept area's range moved.
 */
export function reflowWithout(areas: readonly Area[], id: string): { areas: Area[]; moved: Map<string, { from: Grid; to: Grid }> } {
  const gone = areas.find((a) => a.id === id);
  const rest = areas.filter((a) => a.id !== id).map((a) => ({ ...a }));
  const moved = new Map<string, { from: Grid; to: Grid }>();
  if (!gone) return { areas: rest, moved };
  const band = rest.filter((a) => a.r1 === gone.r1 && a.r2 === gone.r2).sort((x, y) => x.c1 - y.c1);
  const stack = rest.filter((a) => a.c1 === gone.c1 && a.c2 === gone.c2).sort((x, y) => x.r1 - y.r1);
  if (band.length) {
    const lo = Math.min(gone.c1, ...band.map((a) => a.c1));
    const hi = Math.max(gone.c2, ...band.map((a) => a.c2));
    split(lo, hi, band.length).forEach(([c1, c2], i) => {
      const a = band[i];
      const from = rangeOf(a);
      a.c1 = c1; a.c2 = c2;
      moved.set(a.id, { from, to: rangeOf(a) });
    });
  } else if (stack.length) {
    const lo = Math.min(gone.r1, ...stack.map((a) => a.r1));
    const hi = Math.max(gone.r2, ...stack.map((a) => a.r2));
    split(lo, hi, stack.length).forEach(([r1, r2], i) => {
      const a = stack[i];
      const from = rangeOf(a);
      a.r1 = r1; a.r2 = r2;
      moved.set(a.id, { from, to: rangeOf(a) });
    });
  }
  const ordered = rest.sort((x, y) => x.order - y.order).map((a, i) => ({ ...a, order: i + 1 }));
  return { areas: ordered, moved };
}

/** Place a group of blocks (one, or plain words stacked) into one area's range, top to bottom. */
function stackInto(group: Block[], g: Grid): Block[] | null {
  if (group.length === 1) return [{ ...group[0], grid: rangeOf(g) }];
  const rows = g.r2 - g.r1 + 1;
  if (rows < group.length) return null;
  // The heading takes one row; the rest share what is left.
  const [first, ...others] = group;
  const head = isHeading(first) ? 1 : null;
  const spans = head ? [[g.r1, g.r1] as [number, number], ...split(g.r1 + 1, g.r2, others.length)] : split(g.r1, g.r2, group.length);
  return group.map((b, i) => ({ ...b, grid: { c1: g.c1, c2: g.c2, r1: spans[i][0], r2: spans[i][1] } }));
}

/** The card laid out on one structure, or null when the structure cannot hold every block. */
export function fitTo(card: Card, structure: Structure): Card | null {
  const blocks = blocksOf(card).slice().sort(readingOrder);
  if (!blocks.length) return null;
  const metrics = blocks.filter((b) => b.kind === 'metric');
  if (structure.id === 'big_number' && !metrics.length) return null;
  const chart = blocks.find((b) => b.kind === 'chart');

  // The units: each evidence block alone; plain words alone, or together when space is short.
  const words = blocks.filter(isWords);
  const evidence = blocks.filter((b) => !isWords(b));
  let areas = structure.areas.map((a) => ({ ...a }));
  const groupedWords = words.length > 1 && evidence.length + words.length > areas.length;
  const wordUnits: Block[][] = groupedWords ? [words] : words.map((w) => [w]);
  let units: Block[][] = [...wordUnits, ...evidence.map((b) => [b])];
  if (units.length > areas.length) return null;

  // Leading choices: the metric first on Big number, the chart first on a chart-first split.
  const lead = structure.id === 'big_number' ? metrics[0] : (structure.id === 'split_7_5' || structure.id === 'sidebar_8_4') ? chart : undefined;
  if (lead) units = [[lead], ...units.filter((u) => !(u.length === 1 && u[0] === lead))];

  // Drop surplus areas from the end of the reading order, reflowing each away.
  while (areas.length > units.length) {
    const last = areas.slice().sort((x, y) => y.order - x.order).find((a) => a.role !== 'title' && a.role !== 'metric') ?? areas.slice().sort((x, y) => y.order - x.order)[0];
    areas = reflowWithout(areas, last.id).areas;
  }

  const byOrder = areas.slice().sort((x, y) => x.order - y.order);
  const title = byOrder.find((a) => a.role === 'title');
  const headingUnit = units.find((u) => u.length >= 1 && isHeading(u[0]));
  const placed: Block[] = [];
  const free = byOrder.slice();
  const take = (a: Area, u: Block[]) => {
    const s = stackInto(u, a);
    if (!s) return false;
    placed.push(...s);
    free.splice(free.indexOf(a), 1);
    units = units.filter((x) => x !== u);
    return true;
  };
  if (title && headingUnit && !(lead && headingUnit.includes(lead))) { if (!take(title, headingUnit)) return null; }
  const metricArea = free.find((a) => a.role === 'metric');
  if (metricArea && lead) { if (!take(metricArea, units.find((u) => u[0] === lead)!)) return null; }
  for (const u of units.slice()) {
    const a = free.find((x) => x.role !== 'title' && x.role !== 'metric') ?? free[0];
    if (!a || !take(a, u)) return null;
  }

  const out: Card = { ...card, structure: structure.id, areas: byOrder, blocks: placed.sort(readingOrder) };
  delete out.layout;
  if (areasProblem(out.areas) || !sameEvidence(card, out)) return null;
  if (placed.some((b) => !byOrder.some((a) => contains(a, b.grid)))) return null;
  return out;
}

/** The line a layout offers itself with: the canvas's words, from what the card holds. */
export function lineFor(structure: Structure, card: Card): string {
  const blocks = blocksOf(card);
  const metrics = blocks.filter((b) => b.kind === 'metric');
  switch (structure.id) {
    case 'hero_3': return metrics.length === 3 ? 'Fits your 3 recorded figures' : 'Gives the headline the top band';
    case 'split_7_5': return blocks.some((b) => b.kind === 'chart') ? 'Puts the chart first' : 'Puts the main block first';
    case 'big_number': return `Leads with ${String(metrics[0]?.label || 'your figure').trim() || 'your figure'}`;
    case 'two_by_two': return 'Gives each proof its own cell';
    case 'thirds': return 'Gives three blocks equal weight';
    case 'halves': return 'Sets two blocks side by side';
    case 'quarters': return 'Lines up four blocks in a row';
    case 'split_5_7': return 'Puts the words first';
    case 'sidebar_4_8': return 'The words beside a large visual';
    case 'sidebar_8_4': return 'A large visual with the words beside it';
    case 'z_pattern': return 'Reads across, then down';
    case 'title_body': return 'A title band over one body';
    default: return structure.use;
  }
}

/** Four layouts for one card, deterministic: the first that hold every block, in `REMIX_ORDER`, never the card's own structure. */
export function remixOptions(card: Card, n = REMIX_OPTIONS): RemixOption[] {
  const current = areasOf(card).structure;
  const out: RemixOption[] = [];
  for (const id of REMIX_ORDER) {
    if (out.length >= n) break;
    if (id === current) continue;
    const s = structureOf(id);
    if (!s) continue;
    const fitted = fitTo(card, s);
    if (fitted) out.push({ structure: s.id, label: s.label, line: lineFor(s, card), card: fitted });
  }
  return out;
}

/**
 * pd5 "Remove a block · the rest reflows inside the grid", and AUTO-4's drop:
 * the block leaves the card; when it was alone in its area the area goes too,
 * and its neighbours take its cells (`reflowWithout`). Blocks keep their
 * content; those in a moved area move with it. Null when there is no such block.
 */
export function removeBlock(card: Card, blockId: string): Card | null {
  const blocks = blocksOf(card);
  const gone = blocks.find((b) => b.id === blockId);
  if (!gone) return null;
  const { areas } = areasOf(card);
  const home = areas.find((a) => contains(a, gone.grid));
  const left = blocks.filter((b) => b.id !== blockId);
  if (!home) return { ...card, blocks: left };
  const sharing = left.filter((b) => contains(home, b.grid));
  if (sharing.length) {
    // The area stays; the blocks left in it take its rows.
    const restacked = stackInto(sharing.sort(readingOrder), home) ?? sharing;
    return { ...card, blocks: [...left.filter((b) => !sharing.includes(b)), ...restacked].sort(readingOrder) };
  }
  const { areas: next, moved } = reflowWithout(areas, home.id);
  const moveBlock = (b: Block): Block => {
    for (const [, m] of moved) {
      if (!contains(m.from, b.grid)) continue;
      // A block that filled its area fills the new one; a stacked block keeps its rows and takes the new columns or rows.
      const g = b.grid;
      const full = g.c1 === m.from.c1 && g.c2 === m.from.c2 && g.r1 === m.from.r1 && g.r2 === m.from.r2;
      if (full) return { ...b, grid: rangeOf(m.to) };
      const colsSame = m.from.c1 === m.to.c1 && m.from.c2 === m.to.c2;
      return { ...b, grid: colsSame ? { ...rangeOf(g), r1: Math.max(g.r1, m.to.r1), r2: Math.min(g.r2, m.to.r2) } : { ...rangeOf(g), c1: m.to.c1, c2: m.to.c2 } };
    }
    return b;
  };
  return { ...card, structure: CUSTOM, areas: next, blocks: left.map(moveBlock).sort(readingOrder) };
}

/** True for a grid range on the 12 × 6 grid; the route's guard for a posted card. */
export const onGrid = (g: any) => g && [g.c1, g.c2].every((v) => Number.isInteger(v) && v >= 1 && v <= GRID_COLS)
  && [g.r1, g.r2].every((v) => Number.isInteger(v) && v >= 1 && v <= GRID_ROWS) && g.c1 <= g.c2 && g.r1 <= g.r2;

export { STRUCTURES };
