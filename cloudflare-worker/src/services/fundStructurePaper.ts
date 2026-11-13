/**
 * D717 (#1782) decision 11 — the paper drawing of the entity and money map:
 * the "Structure of the Fund" page that `ppm`, `subscription_booklet` and
 * `compliance_manual_code_of_ethics` print.
 *
 * `structureSvg(model)` prints `model.map` (#1855): the boxes, the numbered
 * routes with their heads and markers, the guides and the caption, as paths
 * and texts at the positions the model computed. It holds no coordinate of its
 * own, so the paper and the admin screen draw one map. Every text is escaped,
 * and no arrow character is used. `structureTable(model)` gives the No. | Flow
 * | Rail | Receiving account rows, and `structureLines(model)` the same facts
 * as numbered lines, for the pdf-lib fallback.
 *
 * Pure: it imports only types from fundStructure.ts, so the paper never pulls
 * in the bank-account registry.
 */
import type { ReceivingAccount, StructureModel } from './fundStructure';

export const STRUCTURE_HEADING = 'Structure of the Fund';
export const STRUCTURE_SUBTITLE = 'The four entities, the two platform licences and every money flow';
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

/** "A. Axal VC Holdings LLC licenses the platform to Axal VC Management LLC for management administration." */
export function licenceLines(model: StructureModel): string[] {
  const name = (k: string) => model.entities.find((e) => e.key === k)?.name ?? k;
  return model.licences.map((l) => `${l.id}. ${name(l.licensor)} licenses the platform to ${name(l.licensee)} for ${l.scope}.`);
}

/** One line per fact: the roles, the licences A and B, each numbered row, and the note. */
export function structureLines(model: StructureModel): string[] {
  return [
    ...model.entities.map((e) => `${e.name}: ${e.role}`),
    ...licenceLines(model),
    ...model.rows.map((r) => `${r.no}. ${r.label}, on ${RAIL[r.rail]}. Receiving account: ${r.receiving_text}`),
    model.note,
  ];
}

/** The table under the drawing: No. | Flow | Rail | Receiving account, one row per numbered row. */
export function structureTable(model: StructureModel): [string, string, string, string][] {
  return model.rows.map((r) => [String(r.no), r.label, RAIL[r.rail], r.receiving_text]);
}

// --- the drawing -------------------------------------------------------------

const text = (cls: string, x: number, y: number, t: string, size?: number) =>
  `<text class="${cls}" x="${x}" y="${y}"${size ? ` font-size="${size}"` : ''} text-anchor="middle">${esc(t)}</text>`;

export function structureSvg(model: StructureModel): string {
  const m = model.map;
  const routes = m.routes.map((r) => `<path class="fs-line fs-${r.style}" d="${esc(r.d)}"/>`
    + `<path class="fs-head fs-${r.style}" d="${esc(r.head)}"/>`
    + `<path class="fs-marker fs-${r.style}" d="${esc(r.marker)}"/>`
    + text(`fs-num fs-${r.style}`, r.num.x, r.num.y, r.id)).join('');
  const guides = m.guides.map((g) => `<path class="fs-guide" d="${esc(g.d)}"/>`).join('');
  const boxes = m.boxes.map((b) => `<path class="${b.outside ? 'fs-node fs-outside' : 'fs-node'}" d="${esc(b.d)}"/>`
    + text('fs-label', b.title.x, b.title.y, b.title.text)
    + (b.sub ? text('fs-sub', b.sub.x, b.sub.y, b.sub.text) : '')).join('');
  const labels = m.labels.map((l) => text(`fs-text fs-${l.tone}`, l.x, l.y, l.text, l.size)).join('');
  const caption = text('fs-caption', m.caption.x, m.caption.y, m.caption.text, m.caption.size);
  return `<svg class="fund-structure" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m.view_box[0]} ${m.view_box[1]}" role="img" aria-label="${esc(STRUCTURE_HEADING)}">`
    + `<title>${esc(STRUCTURE_HEADING)}</title>${guides}${routes}${boxes}${labels}${caption}</svg>`;
}
