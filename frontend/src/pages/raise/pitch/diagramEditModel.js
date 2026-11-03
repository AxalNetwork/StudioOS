/**
 * D1542 (#3780, deck v2 B4) — a diagram's nodes edited on the canvas, pure.
 * No React, no network: `DiagramNodes.jsx` draws a field over each node of the
 * selected diagram block and calls these; the edited card goes through the
 * editor's `onCard`, held until Save like every other edit.
 *
 *   diagramOf     the selected area's diagram block, or null
 *   editableNodes each node the layout draws with what it edits: an item's
 *                 label (`{ item: i }`) or a matrix axis (`{ axis: 'x' | 'y' }`)
 *   setNodeLabel  the card with one node's words changed: `{ card }`,
 *                 `{ same: true }`, or `{ error }` for an empty label (a
 *                 diagram's step is never left without words)
 *   checkLine     the line under the card from the Worker's check
 *                 (`deckV2Adapter.diagrams`): fits, the first fit problem, or
 *                 the numbers a label names; "could not be checked" when the
 *                 check was unreadable, never "fits"
 */
import { diagramLayout } from './diagramLayout';
import { updateBlock } from './editorModel';

export const LABEL_MAX = 60;
export const EMPTY_LABEL = 'A step needs words. Type a label, or remove the diagram.';
export const FITS_LINE = 'Fits its area.';
export const UNCHECKED_LINE = 'The fit could not be checked. The edit is kept; check it again before you share.';
export const FIGURE_LINE = (figures) => `A diagram's labels are words: ${figures.map((f) => `"${f}"`).join(', ')} is a figure. Put figures in a metric bound to its record.`;

/** The selected area's diagram block (a `graphic` block whose diagram lays out), or null. */
export function diagramOf(area) {
  const b = area?.kind === 'block' ? area.block : null;
  return b && b.kind === 'graphic' && diagramLayout(b.diagram) ? b : null;
}

/** Every node the diagram draws, with its place (shares of the block's box) and the field it edits. */
export function editableNodes(diagram) {
  const layout = diagramLayout(diagram);
  if (!layout) return [];
  let item = 0;
  let axis = 0;
  return layout.shapes.filter((s) => s.kind === 'node').map((s) => {
    const target = s.role === 'axis' ? { axis: axis++ === 0 ? 'x' : 'y' } : { item: item++ };
    return { ...target, key: target.axis ? `axis-${target.axis}` : `item-${target.item}`, label: s.label, x: s.x, y: s.y, w: s.w, h: s.h, vertical: Boolean(s.vertical) };
  });
}

/** The card with one node's words changed, or why not. */
export function setNodeLabel(card, blockId, target, text) {
  const block = (card?.blocks || []).find((b) => String(b.id) === String(blockId));
  if (!block || !block.diagram) return { error: 'This diagram is no longer on the card.' };
  const label = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX);
  if (!label) return { error: EMPTY_LABEL };
  const d = block.diagram;
  if (target?.axis) {
    if ((d.axes?.[target.axis] ?? '') === label) return { same: true };
    return { card: updateBlock(card, block.id, { diagram: { ...d, axes: { ...d.axes, [target.axis]: label } } }) };
  }
  const i = Number(target?.item);
  if (!Number.isInteger(i) || !d.items?.[i]) return { error: 'This step is no longer in the diagram.' };
  if (d.items[i].label === label) return { same: true };
  return { card: updateBlock(card, block.id, { diagram: { ...d, items: d.items.map((it, k) => (k === i ? { ...it, label } : it)) } }) };
}

/** The line the Worker's check gives, or null while none was asked. */
export function checkLine(answer) {
  if (!answer) return null;
  if (answer.available !== true) return { ok: false, text: answer.unreadable ? UNCHECKED_LINE : null };
  const v = answer.value || {};
  if (Array.isArray(v.problems) && v.problems.length) return { ok: false, text: v.problems[0].message };
  if (Array.isArray(v.figures) && v.figures.length) return { ok: false, text: FIGURE_LINE(v.figures) };
  return v.fits === true ? { ok: true, text: FITS_LINE } : { ok: false, text: UNCHECKED_LINE };
}
