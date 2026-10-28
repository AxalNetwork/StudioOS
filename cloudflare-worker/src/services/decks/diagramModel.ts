/**
 * D898 §8.4 (#3658) — a diagram on a card: an editable, typed element, never
 * a picture of one. It rides on a `graphic` block as an optional `diagram`
 * (version 1), so a deck saved before it still reads, and a reader that does
 * not know diagrams still draws the graphic's own name.
 *
 *   { v: 1, type: 'timeline' | 'flow' | 'cycle' | 'matrix',
 *     items: [{ label, detail?, date?, binding? }] }
 *
 * Every label and detail is text the founder edits. A timeline item's date is
 * a day or a month (`YYYY-MM-DD` or `YYYY-MM`). An item may carry D896's
 * binding when a record placed it (a roadmap objective, a release), so it
 * keeps its source and date like any figure. A matrix is two axes and up to
 * four quadrant items, so it holds exactly four.
 *
 * Numbers are not a diagram's business: a figure is a metric or a chart,
 * bound to its record. A diagram's labels are words.
 */
import { sanitizeBinding } from './sources';

export const DIAGRAM_VERSION = 1;
export const DIAGRAM_TYPES = ['timeline', 'flow', 'cycle', 'matrix'] as const;
export type DiagramType = typeof DIAGRAM_TYPES[number];
export const DIAGRAM_ITEMS_MAX = 8;
export const DIAGRAM_LABEL_MAX = 60;
export const DIAGRAM_DETAIL_MAX = 140;
const DATE = /^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/;

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export type DiagramItem = { label: string; detail?: string; date?: string; binding?: unknown };
export type Diagram = { v: 1; type: DiagramType; items: DiagramItem[]; axes?: { x: string; y: string } };

/** A diagram as stored, or null when it is not one. Items without a label are dropped; a timeline keeps its dated order. */
export function sanitizeDiagram(v: any): Diagram | null {
  if (!v || typeof v !== 'object' || Number(v.v) !== DIAGRAM_VERSION) return null;
  const type = (DIAGRAM_TYPES as readonly string[]).includes(v.type) ? v.type as DiagramType : null;
  if (!type) return null;
  const items: DiagramItem[] = [];
  for (const it of (Array.isArray(v.items) ? v.items : []).slice(0, DIAGRAM_ITEMS_MAX)) {
    const label = str(it?.label, DIAGRAM_LABEL_MAX);
    if (!label) continue;
    const out: DiagramItem = { label };
    const detail = str(it?.detail, DIAGRAM_DETAIL_MAX);
    if (detail) out.detail = detail;
    if (typeof it?.date === 'string' && DATE.test(it.date)) out.date = it.date;
    const bd = sanitizeBinding(it?.binding);
    if (bd) out.binding = bd;
    items.push(out);
  }
  if (items.length < (type === 'matrix' ? 4 : 2)) return null;
  const d: Diagram = { v: 1, type, items: type === 'matrix' ? items.slice(0, 4) : items };
  if (type === 'matrix') {
    const x = str(v.axes?.x, DIAGRAM_LABEL_MAX), y = str(v.axes?.y, DIAGRAM_LABEL_MAX);
    if (!x || !y) return null;
    d.axes = { x, y };
  }
  return d;
}

/** Why a diagram would be refused on save, or null when it is sound. */
export function diagramProblem(v: any): string | null {
  if (v == null) return null;
  if (Number(v?.v) !== DIAGRAM_VERSION) return `the diagram must be version ${DIAGRAM_VERSION}.`;
  if (!(DIAGRAM_TYPES as readonly string[]).includes(v?.type)) return `the diagram type must be one of ${DIAGRAM_TYPES.join(', ')}.`;
  if (Array.isArray(v.items) && v.items.length > DIAGRAM_ITEMS_MAX) return `a diagram holds at most ${DIAGRAM_ITEMS_MAX} steps.`;
  if (!sanitizeDiagram(v)) return v.type === 'matrix' ? 'a matrix needs two named axes and four items.' : 'a diagram needs at least two labelled steps.';
  return null;
}
