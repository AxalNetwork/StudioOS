/**
 * D1561 (#3808): the words of the ⋯ menu's whole-deck actions as pd13, pd23
 * and pd25 draw them: Reorder for stage and Check wording. Pure.
 */
import { aiTokens } from './newDeckModel';

export const WORDING_TITLE = 'Wording';
export const WORDING_LINE = 'Unsupported claims and guarantee language, quoted from your cards. Charged only when you press.';
export const WORDING_EMPTY = 'The wording reads as supported.';
export const STAGES = Object.freeze([
  { id: 'pre_seed', label: 'Pre-seed' },
  { id: 'seed', label: 'Seed' },
  { id: 'series_a', label: 'Series A' },
  { id: 'series_b_plus', label: 'Series B+' },
]);

/** The Check wording button: the hold when the quote is known, never a guessed price. */
export function wordingLabel(quote) {
  if (quote?.ai !== true) return 'Check wording';
  const price = aiTokens(quote.hold_microusd);
  return price ? `Check wording · holds ${price}` : 'Check wording';
}

/** The stage's label, or the id when it is not one of the four. */
export const stageLabel = (id) => STAGES.find((s) => s.id === id)?.label ?? String(id ?? '');

/** The Reorder button's words: "Order for Seed · one undo step". */
export const reorderLabel = (stage) => `Order for ${stageLabel(stage)} · one undo step`;

/** What a reorder answered, in one line. */
export function reorderNote(r) {
  if (!r) return null;
  if (r.unchanged) return `The cards are already in the ${r.stage_label} order. Nothing was saved.`;
  const n = Number(r.moved) || 0;
  return `Ordered for ${r.stage_label}: ${n} card${n === 1 ? '' : 's'} moved, saved as one version. Undo restores the old order.`;
}
