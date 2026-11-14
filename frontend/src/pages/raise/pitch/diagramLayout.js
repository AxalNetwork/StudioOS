// D903 §11 (#3660) — a diagram's layout on the page: where a typed timeline,
// flow, cycle or matrix draws its boxes, connectors and dots inside its block,
// as a share of the block (0 to 1 from its top left).
//
// It mirrors the Worker's `cloudflare-worker/src/services/decks/diagramLayout.ts`
// (and the sanitizing in `diagramModel.ts` that it leans on), and
// `cloudflare-worker/test/deck_diagram_exports_d903.test.ts` checks the two
// agree shape by shape, so the print page that the PDF and the PowerPoint
// pictures photograph draws what the HTML, editable PowerPoint and ODP files
// draw. Nothing here adds a word or a number to the diagram.

export const DIAGRAM_TYPES = Object.freeze(['timeline', 'flow', 'cycle', 'matrix']);
const ITEMS_MAX = 8;
const LABEL_MAX = 60;
const DETAIL_MAX = 140;
const DATE = /^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/;

const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** The Worker's `sanitizeDiagram`, without the bindings (a layout never reads them). */
function sanitize(v) {
  if (!v || typeof v !== 'object' || Number(v.v) !== 1) return null;
  if (!DIAGRAM_TYPES.includes(v.type)) return null;
  const items = [];
  for (const it of (Array.isArray(v.items) ? v.items : []).slice(0, ITEMS_MAX)) {
    const label = str(it?.label, LABEL_MAX);
    if (!label) continue;
    const out = { label };
    const detail = str(it?.detail, DETAIL_MAX);
    if (detail) out.detail = detail;
    if (typeof it?.date === 'string' && DATE.test(it.date)) out.date = it.date;
    items.push(out);
  }
  if (items.length < (v.type === 'matrix' ? 4 : 2)) return null;
  const d = { type: v.type, items: v.type === 'matrix' ? items.slice(0, 4) : items };
  if (v.type === 'matrix') {
    const x = str(v.axes?.x, LABEL_MAX), y = str(v.axes?.y, LABEL_MAX);
    if (!x || !y) return null;
    d.axes = { x, y };
  }
  return d;
}

const r4 = (n) => Math.round(n * 10000) / 10000;

function node(x, y, w, h, it, role = 'item') {
  const out = { kind: 'node', x: r4(x), y: r4(y), w: r4(w), h: r4(h), role, label: it.label };
  if (it.detail) out.detail = it.detail;
  if (it.date) out.date = it.date;
  return out;
}
const line = (x1, y1, x2, y2, arrow = true) => ({ kind: 'line', x1: r4(x1), y1: r4(y1), x2: r4(x2), y2: r4(y2), arrow });

function timeline(items) {
  const n = items.length;
  const AXIS = 0.3;
  const out = [line(0.01, AXIS, 0.99, AXIS)];
  items.forEach((it, i) => {
    const cx = (i + 0.5) / n;
    out.push({ kind: 'dot', x: r4(cx - 0.012), y: r4(AXIS - 0.03), w: 0.024, h: 0.06 });
    out.push(node(i / n + 0.01, AXIS + 0.08, 1 / n - 0.02, 1 - AXIS - 0.08, it));
  });
  return out;
}

function flow(items) {
  const n = items.length;
  const GAP = 0.06;
  const perRow = n <= 4 ? n : Math.ceil(n / 2);
  const w = (1 - GAP * (perRow - 1)) / perRow;
  const rows = n <= 4 ? [{ y: 0.2, h: 0.6 }] : [{ y: 0.02, h: 0.4 }, { y: 0.58, h: 0.4 }];
  const at = (i) => {
    const row = i < perRow ? 0 : 1;
    const col = row === 0 ? i : perRow - 1 - (i - perRow);
    return { x: col * (w + GAP), ...rows[row], row };
  };
  const out = [];
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

function cycle(items) {
  const n = items.length;
  const w = n <= 4 ? 0.26 : 0.22, h = n <= 4 ? 0.24 : 0.2;
  const R = 0.36;
  const centre = (i) => {
    const t = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return { x: 0.5 + R * Math.cos(t), y: 0.5 + R * Math.sin(t) };
  };
  const out = [];
  items.forEach((it, i) => { const c = centre(i); out.push(node(c.x - w / 2, c.y - h / 2, w, h, it)); });
  for (let i = 0; i < n; i += 1) {
    const a = centre(i), b = centre((i + 1) % n);
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const ox = (dy / len) * -0.03, oy = (-dx / len) * -0.03;
    out.push(line(a.x + dx * 0.32 + ox, a.y + dy * 0.32 + oy, a.x + dx * 0.68 + ox, a.y + dy * 0.68 + oy));
  }
  return out;
}

function matrix(d) {
  const X0 = 0.1, Y1 = 0.86, GAP = 0.02;
  const qw = (1 - X0 - GAP) / 2, qh = (Y1 - GAP) / 2;
  const cells = [[X0, 0], [X0 + qw + GAP, 0], [X0, qh + GAP], [X0 + qw + GAP, qh + GAP]];
  const out = d.items.map((it, i) => node(cells[i][0], cells[i][1], qw, qh, it));
  out.push(line(X0 - 0.015, Y1, X0 - 0.015, 0));
  out.push(line(X0 - 0.015, Y1 + 0.015, 1, Y1 + 0.015));
  out.push(node(X0, Y1 + 0.03, 1 - X0, 1 - Y1 - 0.03, { label: d.axes.x }, 'axis'));
  out.push({ ...node(0, 0, X0 - 0.03, Y1, { label: d.axes.y }, 'axis'), vertical: true });
  return out;
}

/** A graphic block's diagram laid out, or null when it holds none (the block keeps its "Graphic · …" line). */
export function diagramLayout(raw) {
  const d = sanitize(raw);
  if (!d) return null;
  const shapes = d.type === 'timeline' ? timeline(d.items)
    : d.type === 'flow' ? flow(d.items)
      : d.type === 'cycle' ? cycle(d.items)
        : matrix(d);
  return { type: d.type, shapes };
}

export const diagramName = (type) => `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
