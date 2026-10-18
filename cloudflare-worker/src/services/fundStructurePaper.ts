/**
 * D717 (#1782) decision 11 — the paper drawing of the entity and money map:
 * the "Structure of the Fund" page that `ppm`, `subscription_booklet` and
 * `compliance_manual_code_of_ethics` print.
 *
 * `structureSvg(model)` draws the four entities and the outside parties as
 * boxes, and each money flow as a line from payer to payee with an arrowhead
 * and a numbered marker. Lines, arrowheads and markers are paths. Every text is
 * escaped, and no arrow character is used: the key under the drawing says
 * "to". `structureLines(model)` gives the same facts as numbered lines, for the
 * key and for the pdf-lib fallback.
 *
 * Pure: it imports only types from fundStructure.ts, so the paper never pulls
 * in the bank-account registry.
 */
import type { MoneyParty } from './moneyRails';
import type { ReceivingAccount, StructureModel } from './fundStructure';

export const STRUCTURE_HEADING = 'Structure of the Fund';
/** A body line that reads exactly this places the page (decision 11). */
export const STRUCTURE_MARKER = '[STRUCTURE OF THE FUND]';

const esc = (s: string): string => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** The sentence a flow's receiving account reads. */
export function receivingLine(r: ReceivingAccount): string {
  switch (r.shown) {
    case 'account': return `${r.beneficiary_name}, ${r.bank_name}, ending ${r.account_last4}`;
    case 'refusal': return r.label;
    default: return r.text;
  }
}

const RAIL = { stripe: 'Stripe', mercury: 'Mercury' } as const;

/** One line per fact: the roles, the licences, each numbered flow, and the note. */
export function structureLines(model: StructureModel): string[] {
  const name = (k: string) => model.entities.find((e) => e.key === k)?.name ?? k;
  return [
    ...model.entities.map((e) => `${e.name}: ${e.role}`),
    ...model.licences.map((l) => `${name(l.licensor)} licenses the platform to ${name(l.licensee)} for ${l.scope}.`),
    ...model.flows.map((f, i) =>
      `${i + 1}. ${f.label}: ${f.payer_label} to ${f.payee_label}, on ${RAIL[f.rail]}. Receiving account: ${receivingLine(f.receiving)}`),
    model.note,
  ];
}

// --- the drawing -------------------------------------------------------------

const W = 640;
const BOX_W = 132;
const BOX_H = 44;
const TOP_Y = 96;
const BOTTOM_Y = 300;
const H = 380;

/** Where each party's box sits: the entities across the top, the outside parties under their counterpart. */
const NODE_X: Readonly<Record<MoneyParty, number>> = Object.freeze({
  holdings: 80, management: 240, gp: 400, fund: 560, customer: 240, vendor: 400, lp: 560,
});
const isTop = (p: MoneyParty) => p === 'holdings' || p === 'management' || p === 'gp' || p === 'fund';
const nodeY = (p: MoneyParty) => (isTop(p) ? TOP_Y : BOTTOM_Y);

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

/** A circle of radius r around (x, y), as a path of two arcs. */
function circlePath(x: number, y: number, r: number): string {
  return `M${f1(x - r)} ${f1(y)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
}

/** A filled arrowhead at (x, y) pointing along (dx, dy). */
function arrowPath(x: number, y: number, dx: number, dy: number): string {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len; const uy = dy / len;
  const bx = x - ux * 8; const by = y - uy * 8;
  return `M${f1(x)} ${f1(y)}L${f1(bx - uy * 4)} ${f1(by + ux * 4)}L${f1(bx + uy * 4)} ${f1(by - ux * 4)}Z`;
}

function boxSvg(p: MoneyParty, label: string, entity: boolean): string {
  const x = NODE_X[p] - BOX_W / 2;
  const y = nodeY(p) - BOX_H / 2;
  const words = label.split(' ');
  // Two lines at most: the box is narrow and SVG text does not wrap.
  const cut = Math.ceil(words.length / 2);
  const lines = words.length > 2 ? [words.slice(0, cut).join(' '), words.slice(cut).join(' ')] : [label];
  const text = lines.map((l, i) =>
    `<text class="fs-label" x="${NODE_X[p]}" y="${f1(nodeY(p) - (lines.length - 1) * 6 + i * 12 + 4)}" text-anchor="middle">${esc(l)}</text>`).join('');
  return `<path class="${entity ? 'fs-node' : 'fs-node fs-outside'}" d="M${x} ${y}h${BOX_W}v${BOX_H}h${-BOX_W}Z"/>${text}`;
}

export function structureSvg(model: StructureModel): string {
  // Entities are labelled by their names; an outside party by the flows' label for it.
  const labels = new Map<MoneyParty, string>();
  for (const e of model.entities) labels.set(e.key, e.name);
  for (const f of model.flows) {
    for (const [p, l] of [[f.payer, f.payer_label], [f.payee, f.payee_label]] as const) if (!labels.has(p)) labels.set(p, l);
  }

  const boxes = [...labels.entries()].filter(([p]) => p in NODE_X)
    .map(([p, label]) => boxSvg(p, label, isTop(p))).join('');

  // Flows sharing a pair of boxes each get their own lane.
  const lanes = new Map<string, number>();
  const flows = model.flows.filter((f) => f.payer in NODE_X && f.payee in NODE_X).map((f, idx) => {
    const n = model.flows.indexOf(f) + 1;
    const pair = [f.payer, f.payee].sort().join('|');
    const lane = lanes.get(pair) ?? 0;
    lanes.set(pair, lane + 1);
    const x1 = NODE_X[f.payer]; const x2 = NODE_X[f.payee];
    let d: string; let mx: number; let my: number; let ax: number; let ay: number; let tx: number; let ty: number;
    if (isTop(f.payer) && isTop(f.payee)) {
      // An arc above the entity row: higher for a longer span and for each lane.
      const y = TOP_Y - BOX_H / 2;
      const rise = 18 + Math.abs(x2 - x1) * 0.12 + lane * 16;
      const cx = (x1 + x2) / 2; const cy = y - rise * 2;
      d = `M${x1} ${y}Q${f1(cx)} ${f1(cy)} ${x2} ${y}`;
      mx = 0.25 * x1 + 0.5 * cx + 0.25 * x2; my = 0.5 * y + 0.5 * cy;
      ax = x2; ay = y; tx = x2 - cx; ty = y - cy;
    } else {
      // Between the rows: each lane is offset sideways so lines never sit on each other.
      const off = (lane - 1) * 14 + (idx % 2 ? 6 : -6);
      const down = isTop(f.payer);
      const sx = x1 + off; const ex = x2 + off;
      const sy = down ? TOP_Y + BOX_H / 2 : BOTTOM_Y - BOX_H / 2;
      const ey = down ? BOTTOM_Y - BOX_H / 2 : TOP_Y + BOX_H / 2;
      d = `M${f1(sx)} ${f1(sy)}L${f1(ex)} ${f1(ey)}`;
      mx = (sx + ex) / 2; my = (sy + ey) / 2; ax = ex; ay = ey; tx = ex - sx; ty = ey - sy;
    }
    const cls = f.rail === 'stripe' ? 'fs-line fs-stripe' : 'fs-line';
    return `<path class="${cls}" d="${d}"/>`
      + `<path class="fs-head${f.rail === 'stripe' ? ' fs-stripe' : ''}" d="${arrowPath(ax, ay, tx, ty)}"/>`
      + `<path class="fs-marker" d="${circlePath(mx, my, 8)}"/>`
      + `<text class="fs-num" x="${f1(mx)}" y="${f1(my + 3.5)}" text-anchor="middle">${n}</text>`;
  }).join('');

  const legend = '<path class="fs-line" d="M24 362h28"/><text class="fs-small" x="58" y="366">Mercury</text>'
    + '<path class="fs-line fs-stripe" d="M128 362h28"/><text class="fs-small" x="162" y="366">Stripe</text>'
    + `<text class="fs-small" x="230" y="366">${esc('Numbers match the key below.')}</text>`;

  return `<svg class="fund-structure" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(STRUCTURE_HEADING)}">`
    + `<title>${esc(STRUCTURE_HEADING)}</title>${flows}${boxes}${legend}</svg>`;
}
