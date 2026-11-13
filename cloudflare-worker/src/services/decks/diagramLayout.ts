/**
 * D903 §11 (#3660) — where a diagram's parts sit inside its block, the one
 * geometry every export draws it from: the offline HTML file, the editable
 * PowerPoint (Google Slides), the OpenDocument file, and the print page that
 * the PDF and the PowerPoint pictures photograph (the frontend mirror,
 * `frontend/src/pages/raise/pitch/diagramLayout.js`, checked shape by shape
 * by `deck_diagram_exports_d903.test.ts`).
 *
 * A diagram (`diagramModel.ts`, D898 §8.4) becomes shapes, each placed as a
 * share of the block's box (x and y from its top left, 0 to 1), so a writer
 * multiplies by its own box and draws:
 *
 *   node   a box holding an item's words: its date (a timeline's), its label
 *          and its detail; or an axis name (`role: 'axis'`, `vertical` for the
 *          matrix's y axis). Every word is the stored text, unchanged;
 *   line   a connector, `arrow` at its end;
 *   dot    a timeline's marker on its axis.
 *
 *   timeline  an axis across the top third, a dot and a node per item, in
 *             their stored (dated) order;
 *   flow      boxes left to right with an arrow between each; past four
 *             items, a second row that runs back right to left under the
 *             first (a snake), joined by a downward arrow;
 *   cycle     boxes on a ring, starting at the top, clockwise, an arrow from
 *             each to the next and from the last back to the first;
 *   matrix    the four quadrants (top left, top right, bottom left, bottom
 *             right, in stored order) with the y axis up the left and the x
 *             axis along the bottom, each named.
 *
 * Nothing here adds a word or a number: no step numbers, no scale. A diagram
 * that does not sanitize has no layout, and the writers keep their
 * "Graphic · …" line for it.
 */
import { sanitizeDiagram, type Diagram } from './diagramModel';

export type DiagramNode = {
  kind: 'node'; x: number; y: number; w: number; h: number;
  role: 'item' | 'axis'; label: string; detail?: string; date?: string; vertical?: boolean;
};
export type DiagramLine = { kind: 'line'; x1: number; y1: number; x2: number; y2: number; arrow: boolean };
export type DiagramDot = { kind: 'dot'; x: number; y: number; w: number; h: number };
export type DiagramShape = DiagramNode | DiagramLine | DiagramDot;
export type DiagramLayout = { type: Diagram['type']; shapes: DiagramShape[] };

/** Four decimals: enough for any card, and the same numbers in the mirror. */
const r4 = (n: number) => Math.round(n * 10000) / 10000;

function node(x: number, y: number, w: number, h: number, it: { label: string; detail?: string; date?: string }, role: 'item' | 'axis' = 'item'): DiagramNode {
  const out: DiagramNode = { kind: 'node', x: r4(x), y: r4(y), w: r4(w), h: r4(h), role, label: it.label };
  if (it.detail) out.detail = it.detail;
  if (it.date) out.date = it.date;
  return out;
}
const line = (x1: number, y1: number, x2: number, y2: number, arrow = true): DiagramLine =>
  ({ kind: 'line', x1: r4(x1), y1: r4(y1), x2: r4(x2), y2: r4(y2), arrow });

function timeline(items: Diagram['items']): DiagramShape[] {
  const n = items.length;
  const AXIS = 0.3;
  const out: DiagramShape[] = [line(0.01, AXIS, 0.99, AXIS)];
  items.forEach((it, i) => {
    const cx = (i + 0.5) / n;
    out.push({ kind: 'dot', x: r4(cx - 0.012), y: r4(AXIS - 0.03), w: 0.024, h: 0.06 });
    out.push(node(i / n + 0.01, AXIS + 0.08, 1 / n - 0.02, 1 - AXIS - 0.08, it));
  });
  return out;
}

function flow(items: Diagram['items']): DiagramShape[] {
  const n = items.length;
  const GAP = 0.06;
  const perRow = n <= 4 ? n : Math.ceil(n / 2);
  const w = (1 - GAP * (perRow - 1)) / perRow;
  const rows = n <= 4 ? [{ y: 0.2, h: 0.6 }] : [{ y: 0.02, h: 0.4 }, { y: 0.58, h: 0.4 }];
  const at = (i: number) => {
    const row = i < perRow ? 0 : 1;
    const col = row === 0 ? i : perRow - 1 - (i - perRow); // the second row runs back, right to left
    return { x: col * (w + GAP), ...rows[row], row };
  };
  const out: DiagramShape[] = [];
  items.forEach((it, i) => { const p = at(i); out.push(node(p.x, p.y, w, p.h, it)); });
  for (let i = 0; i + 1 < n; i += 1) {
    const a = at(i), b = at(i + 1);
    if (a.row === b.row) {
      const mid = a.y + a.h / 2;
      out.push(a.x < b.x ? line(a.x + w, mid, b.x, mid) : line(a.x, mid, b.x + w, mid));
    } else {
      const cx = a.x + w / 2;
      out.push(line(cx, a.y + a.h, cx, b.y));
    }
  }
  return out;
}

function cycle(items: Diagram['items']): DiagramShape[] {
  const n = items.length;
  const w = n <= 4 ? 0.26 : 0.22, h = n <= 4 ? 0.24 : 0.2;
  const R = 0.36;
  const centre = (i: number) => {
    const t = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return { x: 0.5 + R * Math.cos(t), y: 0.5 + R * Math.sin(t) };
  };
  const out: DiagramShape[] = [];
  items.forEach((it, i) => { const c = centre(i); out.push(node(c.x - w / 2, c.y - h / 2, w, h, it)); });
  for (let i = 0; i < n; i += 1) {
    const a = centre(i), b = centre((i + 1) % n);
    // The middle of the chord, pushed outward a little so two items' arrows never lie on each other.
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const ox = (dy / len) * -0.03, oy = (-dx / len) * -0.03;
    out.push(line(a.x + dx * 0.32 + ox, a.y + dy * 0.32 + oy, a.x + dx * 0.68 + ox, a.y + dy * 0.68 + oy));
  }
  return out;
}

function matrix(d: Diagram): DiagramShape[] {
  const X0 = 0.1, Y1 = 0.86, GAP = 0.02;
  const qw = (1 - X0 - GAP) / 2, qh = (Y1 - GAP) / 2;
  const cells = [[X0, 0], [X0 + qw + GAP, 0], [X0, qh + GAP], [X0 + qw + GAP, qh + GAP]];
  const out: DiagramShape[] = d.items.map((it, i) => node(cells[i][0], cells[i][1], qw, qh, it));
  // The axes: up the left edge and along the bottom, each pointing to "more".
  out.push(line(X0 - 0.015, Y1, X0 - 0.015, 0));
  out.push(line(X0 - 0.015, Y1 + 0.015, 1, Y1 + 0.015));
  out.push(node(X0, Y1 + 0.03, 1 - X0, 1 - Y1 - 0.03, { label: d.axes!.x }, 'axis'));
  out.push({ ...node(0, 0, X0 - 0.03, Y1, { label: d.axes!.y }, 'axis'), vertical: true });
  return out;
}

/** The diagram on a `graphic` block, laid out; null when the block holds none, or one that does not sanitize. */
export function diagramLayout(raw: unknown): DiagramLayout | null {
  const d = sanitizeDiagram(raw);
  if (!d) return null;
  const shapes = d.type === 'timeline' ? timeline(d.items)
    : d.type === 'flow' ? flow(d.items)
      : d.type === 'cycle' ? cycle(d.items)
        : matrix(d);
  return { type: d.type, shapes };
}

/** "Timeline", "Flow", "Cycle", "Matrix": a diagram's name, for a frame's name or an image's description. */
export const diagramName = (type: Diagram['type']) => `${type.charAt(0).toUpperCase()}${type.slice(1)}`;

/** Every word a layout draws, in reading order: what a text-only reader keeps. */
export function diagramWords(layout: DiagramLayout): string[] {
  const out: string[] = [];
  for (const s of layout.shapes) {
    if (s.kind !== 'node') continue;
    out.push([s.date, s.label, s.detail].filter(Boolean).join(' · '));
  }
  return out;
}
