/**
 * D1542 (#3780, deck v2 B4) — the `grid_diagram` job: a diagram generated
 * into an area of the Grid. The model writes STRUCTURE ONLY, and code does the
 * rest:
 *
 *   model   `{ type, nodes: [{ id, label, detail? }], edges: [{ from, to }], axes? }`,
 *           from the card's own words, through the rail's Diagrams group
 *           (`resolveElementModel`, #3754) like every other element
 *   strip   every number is taken out of every label (`stripNumbers`): a
 *           "$3M ARR" label comes out "ARR". A diagram's labels are words;
 *           a figure is a metric bound to its record (D898 §8.4)
 *   order   the edges give a flow its order and a cycle its ring; a matrix is
 *           its four quadrants in reading order and its two named axes
 *   render  the stored diagram (`diagramModel.ts`) laid out in code
 *           (`diagramLayout.ts`), the one geometry every export draws
 *   fit     `fitProblems` (the steps the area's width holds) and every node's
 *           words against its own box (`nodeFitProblems`); a diagram that does
 *           not fit is refused, never placed broken
 *
 * THE FAMILY. `DIAGRAM_FAMILY` is every type the picker names: the four the
 * model and every export already draw (flow, cycle, matrix, timeline), and
 * the four the canvas marks "(later)" (funnel, hierarchy, hub and spoke,
 * positioning 2×2), which have no layout yet and are refused with that line.
 * Flow, Cycle and Matrix are the elements that generate (`DIAGRAM_ELEMENTS`);
 * a timeline is the Data group's, placed from records.
 *
 * Pure: no binding, no network. `areas.ts` plans the run and reads its
 * variants through it; `routes/deck_diagrams.ts` checks an edited diagram.
 */
import { DIAGRAM_ITEMS_MAX, DIAGRAM_LABEL_MAX, DIAGRAM_DETAIL_MAX, sanitizeDiagram, type Diagram, type DiagramItem, type DiagramType } from './diagramModel';
import { diagramLayout, diagramName, type DiagramNode } from './diagramLayout';
import { GLYPH_EM, fitProblems, lineHeight, wrapGreedy, type FitProblem } from './designSystem';
import { boxOfAt, type Aspect } from './structures';
import type { Grid } from './slideModel';
import { numberIn } from './newDeck';
import { parseJsonLoose } from './autofill';
import { untrustedBlock, withUntrustedRule } from '../ai/untrusted';
import { voicePreamble } from './prompts/voice';

/** The job's name: what the plan, the step and the proposal record for a generated diagram. */
export const GRID_DIAGRAM_JOB = 'grid_diagram';

export type FamilyType = DiagramType | 'funnel' | 'hierarchy' | 'hub' | 'positioning';
/** Every diagram type the picker names, live or later, with the type the model and the exports draw it as. */
export const DIAGRAM_FAMILY: Readonly<Record<FamilyType, { label: string; drawn: DiagramType | null; live: boolean }>> = Object.freeze({
  flow: { label: 'Flow', drawn: 'flow', live: true },
  cycle: { label: 'Cycle', drawn: 'cycle', live: true },
  matrix: { label: 'Matrix', drawn: 'matrix', live: true },
  timeline: { label: 'Timeline', drawn: 'timeline', live: true },
  funnel: { label: 'Funnel', drawn: null, live: false },
  hierarchy: { label: 'Hierarchy', drawn: null, live: false },
  hub: { label: 'Hub and spoke', drawn: null, live: false },
  positioning: { label: 'Positioning 2×2', drawn: null, live: false },
});
export const FAMILY_TYPES = Object.freeze(Object.keys(DIAGRAM_FAMILY) as FamilyType[]);

/** The picker's diagram elements (Diagrams group, and the Data group's 2×2), each the family type it generates. */
export const DIAGRAM_ELEMENTS: Readonly<Record<string, FamilyType>> = Object.freeze({
  flow: 'flow', cycle: 'cycle', matrix: 'matrix', funnel: 'funnel', hierarchy: 'hierarchy', hub: 'hub', positioning: 'positioning',
});
export const isDiagramElement = (element: string): boolean => Object.prototype.hasOwnProperty.call(DIAGRAM_ELEMENTS, element);
/** The stored type an element generates, or null while its type is "(later)". */
export function drawnTypeOf(element: string): DiagramType | null {
  const f = isDiagramElement(element) ? DIAGRAM_FAMILY[DIAGRAM_ELEMENTS[element]] : null;
  return f && f.live ? f.drawn : null;
}
export const LATER_LINE = 'This diagram is coming later. Flow, Cycle and Matrix generate today. Nothing was charged.';

// ---- the numbers ---------------------------------------------------------------

const EDGE_PUNCT = /^[\s,;:·•|/&+\-–—(]+|[\s,;:·•|/&+\-–—)]+$/g;

/**
 * Words with every number taken out: each whitespace-separated token that
 * names one (digits, a currency or percent sign, a number word from two up,
 * `newDeck.numberIn`'s rule) is dropped, then the punctuation it leaves at
 * either end. "$3M ARR" → "ARR"; "Grow to 40% margin" → "Grow to margin".
 * `stripped` counts the tokens dropped.
 */
export function stripNumbers(text: unknown): { text: string; stripped: number } {
  if (typeof text !== 'string') return { text: '', stripped: 0 };
  let stripped = 0;
  const kept = text.replace(/\s+/g, ' ').trim().split(' ').filter((t) => {
    if (!t) return false;
    if (numberIn(t)) { stripped += 1; return false; }
    return true;
  });
  const out = kept.join(' ').replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').replace(EDGE_PUNCT, '').trim();
  return { text: out, stripped };
}

// ---- the structure ---------------------------------------------------------------

export type Structure = { type?: unknown; nodes?: unknown; edges?: unknown; axes?: unknown };
export type Sanitized = { ok: true; diagram: Diagram; stripped: number } | { ok: false; code: string; message: string };

const NODE_ID = /^[A-Za-z0-9_.:-]{1,24}$/;
const MIN_ITEMS: Readonly<Record<DiagramType, number>> = Object.freeze({ flow: 2, cycle: 3, matrix: 4, timeline: 2 });

/** The order a chain of edges gives: start at the one node nothing points to, then follow; null when the edges are not one chain. */
function chainOrder(ids: string[], edges: Array<[string, string]>, ring: boolean): string[] | null {
  if (edges.length !== (ring ? ids.length : ids.length - 1)) return null;
  const next = new Map<string, string>();
  const into = new Map<string, number>();
  for (const [a, b] of edges) {
    if (next.has(a) || a === b) return null;
    next.set(a, b);
    into.set(b, (into.get(b) ?? 0) + 1);
  }
  if ([...into.values()].some((n) => n > 1)) return null;
  const start = ring ? ids[0] : ids.find((id) => !into.has(id));
  if (!start) return null;
  const order: string[] = [];
  const seen = new Set<string>();
  for (let at: string | undefined = start; at != null && !seen.has(at); at = next.get(at)) { seen.add(at); order.push(at); }
  return order.length === ids.length ? order : null;
}

/**
 * The model's structure as a stored diagram, or the sentence that refuses it.
 * The type is the element's (`type`), never the model's. Every label, detail
 * and axis is stripped of numbers; a node left with no words is dropped with
 * its edges. More nodes than a diagram holds is refused, never cut short.
 */
export function sanitizeStructure(raw: unknown, type: DiagramType): Sanitized {
  const s = (raw && typeof raw === 'object' ? raw : null) as Structure | null;
  const list = Array.isArray(s?.nodes) ? (s!.nodes as any[]) : null;
  if (!list) return { ok: false, code: 'no_structure', message: 'Eadwyn returned no diagram. Nothing was placed.' };
  if (list.length > DIAGRAM_ITEMS_MAX) return { ok: false, code: 'too_many_nodes', message: `A diagram holds at most ${DIAGRAM_ITEMS_MAX} steps; Eadwyn wrote ${list.length}. Nothing was placed.` };
  let stripped = 0;
  const words = (v: unknown, max: number) => { const r = stripNumbers(v); stripped += r.stripped; return r.text.slice(0, max).trim(); };
  const nodes: Array<{ id: string; item: DiagramItem }> = [];
  const used = new Set<string>();
  list.forEach((n, i) => {
    const label = words(n?.label, DIAGRAM_LABEL_MAX);
    const detail = words(n?.detail, DIAGRAM_DETAIL_MAX);
    const id = typeof n?.id === 'string' && NODE_ID.test(n.id) && !used.has(n.id) ? n.id : `#${i}`;
    used.add(id);
    if (!label) return;
    nodes.push({ id, item: detail ? { label, detail } : { label } });
  });
  const ids = nodes.map((n) => n.id);
  const known = new Set(ids);
  const edges: Array<[string, string]> = (Array.isArray(s?.edges) ? (s!.edges as any[]) : [])
    .map((e) => [String(e?.from ?? ''), String(e?.to ?? '')] as [string, string])
    .filter(([a, b]) => known.has(a) && known.has(b));
  let order = ids;
  if (type === 'flow' || type === 'timeline' || type === 'cycle') {
    // The edges order the steps when they are one chain (or, for a cycle, one ring); otherwise the nodes keep the order written.
    order = (edges.length ? chainOrder(ids, edges, type === 'cycle') : null) ?? ids;
  }
  const byId = new Map(nodes.map((n) => [n.id, n.item]));
  const items = order.map((id) => byId.get(id)!);
  if (items.length < MIN_ITEMS[type]) {
    return { ok: false, code: 'too_few_nodes', message: type === 'matrix' ? 'A matrix needs four quadrants with words once numbers are removed. Nothing was placed.' : `A ${diagramName(type).toLowerCase()} needs at least ${MIN_ITEMS[type]} steps with words once numbers are removed. Nothing was placed.` };
  }
  const draft: any = { v: 1, type, items };
  if (type === 'matrix') {
    if (items.length !== 4) return { ok: false, code: 'matrix_shape', message: 'A matrix is exactly four quadrants. Nothing was placed.' };
    const axes = (s?.axes && typeof s.axes === 'object' ? s.axes : {}) as any;
    draft.axes = { x: words(axes.x, DIAGRAM_LABEL_MAX), y: words(axes.y, DIAGRAM_LABEL_MAX) };
    if (!draft.axes.x || !draft.axes.y) return { ok: false, code: 'matrix_axes', message: 'A matrix needs both axes named in words. Nothing was placed.' };
  }
  const diagram = sanitizeDiagram(draft);
  if (!diagram) return { ok: false, code: 'not_a_diagram', message: 'Eadwyn returned no diagram that can be drawn. Nothing was placed.' };
  // Belt and braces: what is placed names no number at all.
  const all = [...diagram.items.flatMap((it) => [it.label, it.detail ?? '']), diagram.axes?.x ?? '', diagram.axes?.y ?? ''];
  if (all.some((t) => numberIn(t))) return { ok: false, code: 'figure_in_diagram', message: 'A number was left in the diagram. Nothing was placed.' };
  return { ok: true, diagram, stripped };
}

// ---- the render and the fit -------------------------------------------------------

/** A diagram as the `graphic` block a card carries in its area. */
export function diagramBlock(diagram: Diagram, grid: Grid) {
  return { kind: 'graphic', graphic: diagramName(diagram.type), diagram, grid: { ...grid } };
}

/** The type a node's words are measured at, in slide pixels (the print page's: label 26px bold, detail 20px). */
export const NODE_TYPE = Object.freeze({ label: [26, 22] as readonly number[], labelLeading: 1.2, detail: 20, detailLeading: 1.3, padX: 12, padY: 8 });

/** Whether a node's words sit in its box at one of the label's sizes: every word inside a line, every line inside the box. */
function nodeFits(n: DiagramNode, w: number, h: number): boolean {
  const innerW = Math.max(1, w - NODE_TYPE.padX * 2), innerH = Math.max(1, h - NODE_TYPE.padY * 2);
  if (n.role === 'axis') {
    const span = n.vertical ? h : w;
    return NODE_TYPE.label.some((size) => n.label.length * size * GLYPH_EM <= span);
  }
  return NODE_TYPE.label.some((size) => {
    const per = Math.max(1, Math.floor(innerW / (size * GLYPH_EM)));
    const perDetail = Math.max(1, Math.floor(innerW / (NODE_TYPE.detail * GLYPH_EM)));
    const label = wrapGreedy(n.label, per);
    const detail = n.detail ? wrapGreedy(n.detail, perDetail) : [];
    const date = n.date ? 1 : 0;
    if (label.some((l) => l.length > per) || detail.some((l) => l.length > perDetail)) return false;
    const height = label.length * lineHeight(size, NODE_TYPE.labelLeading) + (detail.length + date) * lineHeight(NODE_TYPE.detail, NODE_TYPE.detailLeading);
    return height <= innerH;
  });
}

/** Every node whose words overflow its own box in the area, as the deck's fit problems. */
export function nodeFitProblems(diagram: Diagram, grid: Grid, aspect: Aspect = '16:9', card = 1): FitProblem[] {
  const layout = diagramLayout(diagram);
  if (!layout) return [];
  const box = boxOfAt(grid, aspect);
  const out: FitProblem[] = [];
  for (const s of layout.shapes) {
    if (s.kind !== 'node') continue;
    if (!nodeFits(s, s.w * box.w, s.h * box.h)) {
      out.push({ card, block: 'diagram', kind: 'overflow', over: 1, message: `Card ${card}: "${s.label}" is longer than its box in the diagram holds. Shorten it or widen the area.` });
    }
  }
  return out;
}

/** The fewest steps a type draws, and the most the area's width holds (`fitProblems`'s rule, never another). */
export function stepsFor(type: DiagramType, grid: Grid): { min: number; max: number } {
  return { min: MIN_ITEMS[type], max: Math.min(DIAGRAM_ITEMS_MAX, Math.max(2, Math.floor((grid.c2 - grid.c1 + 1) / 2))) };
}

/**
 * Why a rendered diagram may not be placed in its area, as fit problems:
 * `fitProblems` over the block on its card, then every node's own box.
 * Empty when it fits; a diagram that does not is refused, never drawn broken.
 */
export function diagramFit(diagram: Diagram, grid: Grid, aspect: Aspect = '16:9', cardIndex = 0): FitProblem[] {
  const slides: any[] = [];
  slides[Math.max(0, cardIndex)] = { blocks: [{ id: 'diagram', ...diagramBlock(diagram, grid) }] };
  return [...fitProblems(slides, aspect), ...nodeFitProblems(diagram, grid, aspect, Math.max(0, cardIndex) + 1)];
}

// ---- the prompt and the variant -----------------------------------------------------

const SHAPE_LINE: Readonly<Record<DiagramType, string>> = Object.freeze({
  flow: 'steps in order, each edge from one step to the next',
  cycle: 'steps that repeat, each edge from one step to the next and the last back to the first',
  matrix: 'exactly four quadrants in reading order (top left, top right, bottom left, bottom right), no edges, and "axes": {"x": "...", "y": "..."} naming what the two axes measure',
  timeline: 'moments in order, each edge from one to the next',
});

/** The system and user message of one diagram run: structure only, from the card's own words, never a number. */
export function diagramMessage(type: DiagramType, grid: Grid, narrative: string, voice: unknown): { system: string; user: string } {
  const { min, max } = stepsFor(type, grid);
  const count = type === 'matrix' ? 'exactly 4' : min === max ? `${min}` : `${min} to ${max}`;
  const system = withUntrustedRule([
    voicePreamble(voice),
    `You draw the structure of one ${diagramName(type).toLowerCase()} diagram for a pitch-deck card: ${SHAPE_LINE[type]}.`,
    'Answer with JSON only: {"type": "' + type + '", "nodes": [{"id": "a", "label": "...", "detail": "..."}], "edges": [{"from": "a", "to": "b"}]}.',
    `Write ${count} nodes. A label is at most 4 words; a detail, optional, at most 10.`,
    'Use only what the card says. Never write a number, a figure, an amount, a percentage or a date: a diagram\'s labels are words.',
  ].join(' '));
  const user = `Draw the ${diagramName(type).toLowerCase()} for this card.\n\nCard:\n${untrustedBlock('deck_import', narrative)}`;
  return { system, user };
}

export type DiagramPayload = { kind: 'diagram'; job: typeof GRID_DIAGRAM_JOB; element: string; type: DiagramType; grid: Grid; card_index: number; replaces_block: string | null };
export type DiagramVariant =
  | { ok: true; block: ReturnType<typeof diagramBlock>; title: string; stripped: number }
  | { ok: false; code: string; message: string };

/**
 * One finished run's words as a diagram block for its area, or why not: the
 * structure parsed, sanitized and stripped of numbers, rendered, then held to
 * its area (`diagramFit`). An overflow is refused with the fit's sentence.
 */
export function diagramVariant(payload: Partial<DiagramPayload> | null | undefined, text: unknown, aspect: Aspect = '16:9'): DiagramVariant {
  const type = payload?.type;
  const grid = payload?.grid;
  if (!type || !grid || !(['flow', 'cycle', 'matrix', 'timeline'] as string[]).includes(type)) return { ok: false, code: 'not_a_diagram', message: 'This proposal is not a diagram. Nothing was placed.' };
  const raw = parseJsonLoose<Structure>(typeof text === 'string' ? text : '');
  const s = sanitizeStructure(raw, type);
  if (!s.ok) return s;
  const problems = diagramFit(s.diagram, grid, aspect, Number(payload?.card_index) || 0);
  if (problems.length) return { ok: false, code: 'does_not_fit', message: `${problems[0].message} Nothing was placed; you were charged only for what ran.` };
  return { ok: true, block: diagramBlock(s.diagram, grid), title: diagramName(type), stripped: s.stripped };
}
