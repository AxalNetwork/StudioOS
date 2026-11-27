/**
 * D1534 (#3778 phase 2, pd27) — the AI image tools on a placed image's toolbar.
 *
 * A tool is live only while the Worker says it is on (`GET /api/decks/images/tools`,
 * read through `deckV2Adapter.imageEditAi`). Otherwise it stays greyed under
 * "Coming later", as pd27 draws it. A press is always quoted first; the run
 * makes a proposed child image, which the editor keeps and places in the block's
 * own place, so the block keeps its crop, filter and fit (as Replace does).
 */
import { aiTokens } from './newDeckModel';

/** The "Coming later" label each tool stands for. */
export const TOOL_OF_LABEL = Object.freeze({ 'Remove background': 'remove_background', Upscale: 'upscale' });

/** The tools that can run now, by id, from the adapter's answer (or none). */
export function liveTools(answer) {
  if (answer?.available !== true) return new Set();
  return new Set((answer.value?.tools || []).filter((t) => t?.on === true).map((t) => t.tool));
}

/** The line a quote prints before the press runs. Never $0: an unreadable price says so. */
export function toolCostLine(quote) {
  if (!quote) return 'Pricing…';
  if (quote.ai === false) return quote.message || 'Coming later.';
  const cost = aiTokens(quote.hold_microusd);
  if (!cost) return `${quote.model_label || 'The image tool'} · Price not recorded`;
  return `${quote.model_label} · 1 image · ${cost}${quote.balance?.ok === false ? '' : ' · covered by your AI tokens'}`;
}

/** Whether the quoted press may run. */
export const toolRunnable = (quote) => quote?.ai === true && quote.balance?.ok !== false;

/** The block patch that places a kept tool result: the new image, the block's own look kept. */
export function placedResult(image) {
  if (!image?.url || !image?.uid) return null;
  return { image_url: image.url, image_id: image.uid };
}
