/**
 * D1533 (#3777, deck v2 B1) — what direct manipulation leaves on a card: the
 * facts the Arrange set (pd26) writes, kept by `slideModel.ts` and honoured by
 * the exports. Pure: no binding, no fetch.
 *
 *   group    a group id on a block (an area) or a decor item. Members move,
 *            align and select together; decor groups with decor and areas with
 *            areas, so a group never mixes the two layers.
 *   pinned   the Arrange set's Lock: the item keeps its place and size. It is
 *            NOT the brand-kit lock (`locked`, #3819), which makes an area
 *            unselectable; a pinned item can still be selected and unlocked.
 *   layer    a decor item's place in the card's layer order, 1 at the bottom.
 *            Only decor has layers ("LAYERS · DECOR ONLY"): areas never
 *            overlap, so they have none. The stored decor list is in layer
 *            order and each item records its layer. A group's members share
 *            one place in that order, where its lowest member stood
 *            (`gathered`), so a group is one shape in PowerPoint and the PDF
 *            stacks it the same way.
 *   at       a decor item's box on the slide in slide pixels, each edge on the
 *            8 px baseline (`BASELINE`). Decor may overlap areas (it is drawn
 *            under them) and is nudged by 8 px; an item without `at` sits on
 *            its cell range (`grid`), as D1500 and #3779 place it.
 *
 * Decor is D1500's one list, `card.decor`, whose kinds are the elements
 * library's (#3779, D1541). This file adds no decor kind. A decor item never
 * holds a figure or body text: `decorHoldsContent` names the fields that would
 * make it one, and a save that carries any is refused (`slideModel.modelProblems`).
 *
 * The exports draw decor through `decorPlan`: in layer order, under the areas,
 * at `at` (else its range). `EXPORT_GEOMETRY` is the shape each export draws
 * natively for an item's kind and ref, the four pd26's layers list shows
 * (Circle, Square, Rounded square, Divider line); an item with no native shape
 * is placed in neither export (`geometry: null`), so the PDF and the PowerPoint
 * always agree. Mirrored in `frontend/src/pages/raise/pitch/arrangeModel.js`,
 * and `cloudflare-worker/test/deck_arrange_d1533.test.ts` holds the two equal.
 */
// No import from `slideModel.ts`, which imports this file: the block kinds a decor item may not claim are passed in.

export const BASELINE = 8;
/** The largest slide (16:9). A 4:3 card's decor stays inside 1440 px; the editor keeps it there. */
export const SLIDE_W = 1920;
export const SLIDE_H = 1080;
const ID = /^[A-Za-z0-9_-]{1,40}$/;

export type Box = { x: number; y: number; w: number; h: number };
export type Grid = { c1: number; c2: number; r1: number; r2: number };
export type Geometry = 'ellipse' | 'rect' | 'roundRect' | 'line';

/** The print card's tones (`PrintExtras.jsx`'s COLOURS), which a decor item's `tone` names. */
export const TONE_COLOURS: Readonly<Record<string, string>> = Object.freeze({ ink: '#0f2a3d', accent: '#6d28d9', muted: '#64748b', surface: '#fbfaf7' });

/** What each export draws natively, by `kind:ref` (#3779's refs). */
export const EXPORT_GEOMETRY: Readonly<Record<string, Geometry>> = Object.freeze({
  'shape:circle': 'ellipse',
  'shape:rect': 'rect',
  'shape:rounded': 'roundRect',
  'divider:line': 'line',
});

/** The fields that would make a decor item a figure or body text. */
const CONTENT_KEYS = ['text', 'paras', 'value', 'series', 'points', 'rows', 'binding'] as const;

/** Whether a raw decor item carries a figure or body text, or claims one of `blockKinds` (`slideModel.BLOCK_KINDS`). */
export function decorHoldsContent(raw: any, blockKinds: readonly string[]): boolean {
  if (!raw || typeof raw !== 'object') return false;
  if (blockKinds.includes(String(raw.kind))) return true;
  return CONTENT_KEYS.some((k) => raw[k] != null);
}

/** A box on the 8 px baseline inside the slide, or null. Never rounded into place: an off-grid box is refused. */
export function atOf(v: any): Box | null {
  if (!v || typeof v !== 'object') return null;
  const n = [v.x, v.y, v.w, v.h];
  if (!n.every((x) => Number.isInteger(x) && x % BASELINE === 0)) return null;
  const [x, y, w, h] = n as number[];
  if (x < 0 || y < 0 || w < BASELINE || h < BASELINE || x + w > SLIDE_W || y + h > SLIDE_H) return null;
  return { x, y, w, h };
}

export const groupOf = (v: unknown): string | null => (typeof v === 'string' && ID.test(v) ? v : null);

/** A block's arrange fields: its group and its pin. */
export function blockArrange(raw: any): { group?: string; pinned?: true } {
  const out: { group?: string; pinned?: true } = {};
  const g = groupOf(raw?.group);
  if (g) out.group = g;
  if (raw?.pinned === true) out.pinned = true;
  return out;
}

/** A decor item's arrange fields: its group, pin, layer and box. */
export function decorArrange(raw: any): { group?: string; pinned?: true; layer?: number; at?: Box } {
  const out: { group?: string; pinned?: true; layer?: number; at?: Box } = blockArrange(raw);
  if (Number.isInteger(raw?.layer) && raw.layer >= 1) out.layer = raw.layer;
  const at = atOf(raw?.at);
  if (at) out.at = at;
  return out;
}

/** Items in layer order (by `layer`, else list place; ties in list order), each group's members gathered where its lowest stood. */
export function gathered<T extends { layer?: unknown; group?: unknown }>(items: T[]): T[] {
  const sorted = items
    .map((d, i) => ({ d, k: Number.isInteger(d?.layer) ? d.layer as number : i + 1, i }))
    .sort((a, z) => a.k - z.k || a.i - z.i)
    .map((x) => x.d);
  const out: T[] = [];
  const seen = new Set<string>();
  for (const d of sorted) {
    const g = groupOf(d?.group);
    if (!g) { out.push(d); continue; }
    if (seen.has(g)) continue;
    seen.add(g);
    out.push(...sorted.filter((x) => groupOf(x?.group) === g));
  }
  return out;
}

/**
 * The decor list in layer order (`gathered`), each renumbered 1…n. An item
 * that claims a block's kind is dropped: decor is never content.
 */
export function layered<T extends { kind: string; layer?: number }>(items: T[] | null, blockKinds: readonly string[]): T[] | null {
  if (!items) return null;
  const out = gathered(items.filter((d) => !blockKinds.includes(d.kind))).map((d, i) => ({ ...d, layer: i + 1 }));
  return out.length ? out : null;
}

export type DecorDraw = { id: string; kind: string; ref: string | null; tone: string; colour: string; geometry: Geometry | null; at: Box | null; grid: Grid | null; group: string | null; pinned: boolean; layer: number };

/** What an export draws for a card's decor, bottom layer first. Both exports read this one list. */
export function decorPlan(card: any): DecorDraw[] {
  const list = Array.isArray(card?.decor) ? card.decor : [];
  return gathered(list as any[])
    .map((d: any, i: number) => {
      const ref = typeof d?.ref === 'string' ? d.ref : null;
      const tone = typeof d?.tone === 'string' && Object.hasOwn(TONE_COLOURS, d.tone) ? d.tone : 'ink';
      return {
        id: String(d?.id ?? `d${i + 1}`), kind: String(d?.kind ?? ''), ref, tone, colour: TONE_COLOURS[tone],
        geometry: ref ? EXPORT_GEOMETRY[`${d.kind}:${ref}`] ?? null : null,
        at: atOf(d?.at), grid: d?.grid && typeof d.grid === 'object' ? d.grid as Grid : null,
        group: groupOf(d?.group), pinned: d?.pinned === true, layer: i + 1,
      };
    });
}
