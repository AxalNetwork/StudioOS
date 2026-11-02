import { NOT_RECORDED, tileValue } from './editorModel';
import { cardOf } from './presentExportModel';
import { isTypedChart, marketCircles, projectionLines, tableView } from './typedChartsModel';

/**
 * D1564 (#3811, deck builder v2 D3; owner decision A = B) — the read-only
 * responsive card view of a shared deck. 16:9 stays the canonical deck; this
 * is the same version's cards, one under another, for a phone or a narrow
 * frame (`DeckCardView.jsx`, drawn through `BlockView`).
 *
 * WHAT AN INVESTOR NEVER SEES HERE (S1's one-click bar, dk-auto gap e):
 *   · a "Not recorded" placeholder. A block cut for missing data stays out:
 *     a metric with no figure, an image with no picture, a link with no
 *     address, a table with no cell, a chart with no point, a typed chart
 *     whose numbers do not make a shape. A card left with nothing stays out;
 *   · a source or grade badge. Blocks go out with no binding, a chart series
 *     with no raw source key in place of its label, a table cell with its own
 *     words only (never its source key), and `BlockView` is drawn
 *     live with sources off.
 * The compliance chrome stays on (owner decision T): each card's footnotes
 * and Confidential, from the Worker's `compliance` (`chromeOf`), keyed to the
 * card's place in the version, not its place in this list.
 *
 * Pure: no React, no network.
 */

const str = (v) => (v == null ? '' : String(v).trim());
const https = (v) => (typeof v === 'string' && /^https:\/\//.test(v.trim()) ? v.trim() : null);

/** Does this block carry what it shows; false when it would draw a gap. */
export function blockHasData(b) {
  if (!b || typeof b !== 'object') return false;
  switch (b.kind) {
    case 'text': return Boolean(str(b.text));
    case 'metric': return tileValue(b) !== NOT_RECORDED;
    case 'image': return Boolean(https(b.image_url));
    case 'video': case 'audio': case 'link': return Boolean(https(b.url));
    case 'graphic': return Boolean(str(b.graphic));
    case 'table': return tableView(b).body.some((row) => row.some((c) => str(c)));
    case 'chart':
      if (isTypedChart(b)) return Boolean(b.chart_type === 'market_circles' ? marketCircles(b) : projectionLines(b));
      return (Array.isArray(b.series) ? b.series : []).some((s) => Array.isArray(s?.points) && s.points.length > 0);
    default: return false;
  }
}

/** A block as the card view draws it: no binding (so no source or grade), a series named by its label only. */
export function bareBlock(b) {
  const { binding, ...rest } = b;
  void binding;
  // A bound table cell draws its raw source key (`cellText`); here it keeps only its own words.
  if (rest.kind === 'table' && Array.isArray(rest.rows)) {
    rest.rows = rest.rows.map((row) => (Array.isArray(row) ? row : []).map((cell) => (cell?.binding ? { text: str(cell.text) } : cell)));
  }
  if (rest.kind === 'chart' && Array.isArray(rest.series)) {
    rest.series = rest.series.map((s) => {
      const { binding: sb, ...series } = s || {};
      void sb;
      return { ...series, label: str(series.label) || 'Series' };
    });
  }
  return rest;
}

/** Reading order on the grid: by row, then column; a block with no range keeps its place after those with one. */
function readingOrder(blocks) {
  const at = (b) => (b?.grid && Number.isInteger(b.grid.r1) && Number.isInteger(b.grid.c1) ? b.grid.r1 * 100 + b.grid.c1 : 10_000);
  return blocks.map((b, i) => ({ b, i })).sort((x, y) => at(x.b) - at(y.b) || x.i - y.i).map((x) => x.b);
}

/** A fielded or template card as blocks, from what Present draws (`cardOf`), with every unrecorded part left out. */
function blocksFromCard(slide, i) {
  const card = cardOf(slide, i);
  const out = [];
  if (str(slide?.title)) out.push({ kind: 'text', style: 'heading', text: card.title });
  if (card.sub && card.sub !== NOT_RECORDED) out.push({ kind: 'text', style: 'paragraph', text: card.sub });
  for (const l of card.lines) if (!l.includes(NOT_RECORDED)) out.push({ kind: 'text', style: 'paragraph', text: l });
  if (card.bullets.length) out.push({ kind: 'text', style: 'list', text: card.bullets.join('\n') });
  for (const f of card.figures) if (str(f.v) && f.v !== NOT_RECORDED) out.push({ kind: 'metric', label: f.k, value: f.v });
  if (card.image) out.push({ kind: 'image', image_url: card.image, alt: card.title, fit: 'contain' });
  return out;
}

/**
 * The cards the view draws: `{ index, blocks }`, `index` the card's place in
 * the version (for its compliance chrome). A card whose every block is cut
 * stays out.
 */
export function cardViewCards(deck) {
  const slides = Array.isArray(deck?.slides) ? deck.slides : [];
  const out = [];
  slides.forEach((slide, index) => {
    const own = Array.isArray(slide?.blocks) && slide.blocks.length ? readingOrder(slide.blocks) : blocksFromCard(slide, index);
    const blocks = own.map((b) => (b && typeof b === 'object' ? bareBlock(b) : b)).filter(blockHasData).map((b, k) => ({ ...b, id: str(b.id) || `cv${index}-${k}` }));
    if (blocks.length) out.push({ index, blocks });
  });
  return out;
}

/** The narrowest screen the card view is built for (an iPhone 12–15), and its side gutter. */
export const PHONE_WIDTH = 390;
export const GUTTER = 16;
export const CARD_VIEW = 'Cards';
export const SLIDE_VIEW = 'Slides';
export const NO_CARDS = 'This version has no card to show here yet.';
