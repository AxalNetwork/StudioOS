/**
 * D1604 (#3716, pd4, pd14, pd15) — what "Generate into N areas" does with
 * each selected area, pure. No React, no network: `AreaLightbox.jsx` calls the
 * clients this file names, and `AreaResults.jsx` places what it proposed.
 *
 *   defaultElement  the element an area starts with (its block's own kind)
 *   rowPlan         one area and its element → how it runs on main:
 *                     assist    POST /api/decks/:id/cards/:card/assist (text,
 *                               chart, table, timeline), charged to `option`
 *                     image     POST /api/decks/:id/images (deck:image)
 *                     metric    a recorded figure as a bound tile, no model
 *                     upload    an uploaded image, no model
 *                     dialog    a free element the editor's own dialog places
 *                     later     the adapter method and issue that bring it
 *                     refused   why this area takes no element (a figure
 *                               bound to a record, a chart in one cell)
 *   holdLine        "Holds up to $x · you pay what it uses", or the sum
 *                   across N runs while several areas run one after another
 *   runSequence     several areas on main: one run after another, each its
 *                   own charge; a refusal stops the rest
 *   placeResult     an accepted proposal placed in its area on the card
 *                   as it stands now, or the sentence that says why not
 *
 * THE SEAM. One quote and one hold for several areas, variants 2 and 3, and
 * text into an empty area arrive with #3764 / #3766 (`deckV2Adapter.areasQuote`
 * and `areasGenerate`). `batchMode` asks the adapter first: while it answers
 * unavailable the areas run in sequence, and when it answers available the
 * dialog swaps to the one batch with no screen change.
 *
 * The owner's rules this file carries: every element is a proposal placed
 * only on Accept; the model is the AIRail's, read-only here; a figure comes
 * from the records, never from a model.
 */

import { ELEMENTS, HOLD, LATER, areaLabel } from './deckV2Model.js';
import { availability } from './deckV2Adapter.js';
import { FIGURE_LINE, textBody } from './deckAssistModel.js';
import { aiTokens } from './newDeckModel.js';
import { askBody, defaultDescription } from './imageModel.js';
import { addBlock, removeBlock, updateBlock } from './editorModel.js';
import { areaKind } from './gridSelection.js';

/** The AIRail page every deck option is read on (`railOptions/founder.js`). */
export const RAIL_PAGE = 'Founder · Raise · Pitch deck';

/** The text elements: a filled text area's words, changed by one of `TEXT_CHANGES`. */
export const TEXT_ELEMENTS = Object.freeze(['title', 'kicker', 'body', 'bullets', 'callout', 'caption']);
const CHARTS = Object.freeze({ chart: 'chart', table: 'table', timeline: 'timeline' });
const IMAGES = Object.freeze({ photo: 'scene', illustration: 'flat' });
/** Free elements the editor's existing dialogs place (Add a block, ⋯ › Structure). */
const DIALOGS = Object.freeze({
  quote_founder: { open: 'add-block', kind: 'text' },
  video: { open: 'add-block', kind: 'video' },
  audio: { open: 'add-block', kind: 'audio' },
  link: { open: 'add-block', kind: 'link' },
  team_grid: { open: 'structure' },
});

/**
 * How a filled text area's words change, each its own rail option (D899).
 * Change tone and Translate are not here (plan §0, §4.2): they are typed
 * instructions in the editor's instruction box ("warmer", "in French"),
 * scoped to the selection (`instructionModel.typedChange`).
 */
export const TEXT_CHANGES = Object.freeze([
  { action: 'rewrite', label: 'Rewrite', option: 'deck:rewrite' },
  { action: 'shorten', label: 'Shorten', option: 'deck:shorten' },
  { action: 'expand', label: 'Expand', option: 'deck:expand' },
]);
/**
 * A Title's own change (plan §4.2): the Worker's `headline` action, charged to
 * deck:rewrite, writes a headline from the card's recorded figures (their
 * labels; the values stay the records'). It needs one recorded figure bound
 * on the card, so a card with none offers it greyed, with why.
 */
export const HEADLINE = Object.freeze({ action: 'headline', label: 'Headline', option: 'deck:rewrite' });
export const HEADLINE_WHY = 'A headline is written from the card’s recorded figures. Bind one on this card first.';
/** The changes a text element offers: a Title leads with its Headline. */
export const changesFor = (element) => (element === 'title' ? [HEADLINE, ...TEXT_CHANGES] : TEXT_CHANGES);

/** The recorded figures bound on a card (at most six, as the Worker reads them): what a headline is written from. */
export function cardFigures(card, items = []) {
  const keys = (Array.isArray(card?.blocks) ? card.blocks : []).map((b) => b?.binding?.source_key).filter(Boolean);
  return [...new Set(keys)].filter((k) => items.some((i) => i.source_key === k && i.state === 'recorded')).slice(0, 6);
}

/** Variants per area: 1 on main; 2 and 3 arrive with #3764 (`areasGenerate`). */
export const VARIANTS = Object.freeze([1, 2, 3]);
export const NO_MODEL = 'No model · free';
export const MODEL_WHERE = 'set in the AIRail';
export const EMPTY_TEXT_WHAT = 'Words for an empty area';
/** The canvas's limit (pd12 inset 1): "A chart needs at least 4 × 3 cells." */
export const CHART_MIN = Object.freeze({ cols: 4, rows: 3 });
export const CHART_MIN_LINE = 'A chart needs at least 4 × 3 cells. Select a larger area.';
/** A table or a timeline from the records: the editor's own fit for a records block (3 × 2 or more, `ChartLibrary`). */
export const RECORDS_MIN = Object.freeze({ cols: 3, rows: 2 });
export const SEQUENCE_LINE = 'Each area runs on its own, one after another, and is charged on its own. If one is refused, the rest do not run.';
export const NOT_RUN = 'Not run: an area before it was refused. Nothing was charged for it.';
export const RESULTS_LINE = 'Nothing is on the card until you accept it. Accepting places it; Save writes the version.';

const byId = (id) => ELEMENTS.find((e) => e.id === id) || null;
const cols = (g) => g.c2 - g.c1 + 1;
const rows = (g) => g.r2 - g.r1 + 1;
const bound = (block) => Boolean(block && (block.kind === 'metric' || block.binding?.source_key));

/** The element an area starts with: its block's own kind, or a chart for an empty area. */
export function defaultElement(area) {
  const b = area?.kind === 'block' ? area.block : null;
  if (!b) return 'chart';
  if (b.kind === 'text') return b.style === 'heading' ? 'title' : b.style === 'list' ? 'bullets' : 'body';
  if (b.kind === 'metric' || b.binding?.source_key) return 'metric';
  if (b.kind === 'image') return 'photo';
  if (b.kind === 'chart') return 'chart';
  if (b.kind === 'video' || b.kind === 'audio' || b.kind === 'link') return b.kind;
  return 'body';
}

/** "Area 2 · c1–7 × r2–6 · Body", the row's label. */
export const rowLabel = (area, i) => [`Area ${i + 1}`, areaLabel(area?.grid), areaKind(area)].filter(Boolean).join(' · ');

/** The aspect an image for this range is drawn in: the nearest the image route takes. */
export function aspectFor(grid) {
  // A Grid cell on a 16:9 card is (16 / 12) wide by (9 / 6) tall.
  const r = (cols(grid) * (16 / 12)) / (rows(grid) * (9 / 6));
  const options = [['16:9', 16 / 9], ['4:3', 4 / 3], ['1:1', 1], ['3:4', 3 / 4]];
  return options.reduce((best, o) => (Math.abs(Math.log(o[1] / r)) < Math.abs(Math.log(best[1] / r)) ? o : best))[0];
}

/**
 * One area and its element, as it runs on main. `choice` carries the row's
 * own picks: `change` (a text change), `figure` (a recorded item's
 * source_key), `file` (an upload). `items` are the deck's sources
 * (`GET /api/decks/sources`). A Title starts as its Headline when the card
 * has a recorded figure bound, and as Rewrite when it has none.
 */
/**
 * D1500: how a run names its card: by uid, so a proposal made while the
 * founder reorders still belongs to that card; by place only for a card read
 * before it had one.
 */
export const cardKeyOf = (card, cardIndex) => (typeof card?.uid === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(card.uid) ? card.uid : cardIndex);

/**
 * D1500: an assist request's body as sent: when the card is named by uid, its
 * place rides along, for a card added since the version was saved (the Worker
 * does not hold its uid yet).
 */
export const assistBody = (plan, cardIndex) => (plan.cardKey !== cardIndex && Number.isInteger(cardIndex) ? { ...plan.body, card_index: cardIndex } : plan.body);

export function rowPlan({ area, element, card, cardIndex, items = [], choice = {} }) {
  const cardKey = cardKeyOf(card, cardIndex);
  const el = byId(element);
  const block = area?.kind === 'block' ? area.block : null;
  if (!el || !area) return { run: 'refused', why: 'Pick an element for this area.' };
  if (el.adapter) return { run: 'later', adapter: el.adapter, issue: el.issue, why: LATER };
  // A figure bound to a record is the record's: only another recorded figure replaces it.
  if (bound(block) && element !== 'metric') {
    const module = items.find((i) => i.source_key === block.binding?.source_key)?.module ?? null;
    return { run: 'refused', why: FIGURE_LINE(module) };
  }
  if (TEXT_ELEMENTS.includes(element)) {
    const words = block?.kind === 'text' ? String(block.text ?? '').trim() : '';
    // Words for an empty area are the several-area route's (#3764): nothing on main writes them.
    if (!words) return { run: 'later', adapter: 'areasGenerate', issue: 3764, why: LATER, what: EMPTY_TEXT_WHAT };
    const figures = element === 'title' ? cardFigures(card, items) : [];
    const offered = figures.length ? changesFor(element) : TEXT_CHANGES;
    const change = offered.find((c) => c.action === choice.change) || offered[0];
    const body = change.action === 'headline' ? { ...textBody('headline', block), source_keys: figures } : textBody(change.action, block);
    return { run: 'assist', action: change.action, option: change.option, cardKey, body };
  }
  if (CHARTS[element]) {
    const min = element === 'chart' ? CHART_MIN : RECORDS_MIN;
    if (cols(area.grid) < min.cols || rows(area.grid) < min.rows) {
      return { run: 'refused', why: element === 'chart' ? CHART_MIN_LINE : `A ${element} needs at least ${min.cols} × ${min.rows} cells. Select a larger area.` };
    }
    const heading = String(card?.title || '').trim();
    return { run: 'assist', action: CHARTS[element], option: `deck:${CHARTS[element]}`, cardKey, body: { action: CHARTS[element], ...(heading ? { heading } : {}) } };
  }
  if (IMAGES[element]) {
    const description = defaultDescription(card) || String(card?.title || '').trim();
    if (description.length < 3) return { run: 'refused', why: 'Give this card a title first: the picture is described from its words.' };
    return {
      run: 'image', option: 'deck:image',
      body: { ...askBody({ use: 'content', description, style: IMAGES[element], palette: 'brand', aspect: aspectFor(area.grid), count: 1, card: cardIndex }), ...(cardKey !== cardIndex ? { card_uid: cardKey } : {}) },
    };
  }
  if (element === 'metric') {
    const item = items.find((i) => i.source_key === choice.figure && i.state === 'recorded') || null;
    return { run: 'metric', item, why: item ? null : 'Pick a recorded figure.' };
  }
  if (element === 'upload') return { run: 'upload', file: choice.file || null, why: choice.file ? null : 'Choose an image file.' };
  if (DIALOGS[element]) return { run: 'dialog', ...DIALOGS[element] };
  return { run: 'refused', why: 'This element cannot be placed here yet.' };
}

/** True for a plan Generate runs (a model run, or a free element that needs nothing more). */
export const runnable = (plan) => (plan.run === 'assist' || plan.run === 'image') || ((plan.run === 'metric' || plan.run === 'upload') && !plan.why);
/** True for a plan that runs a model and so is quoted and charged. */
export const charged = (plan) => plan.run === 'assist' || plan.run === 'image';

/** A quote's hold in micro-dollars: the assist route's `hold_microusd`, the image route's `total_microusd`. */
export function holdOf(quote) {
  if (!quote || quote.ai === false) return null;
  const v = quote.hold_microusd ?? quote.total_microusd;
  return v == null || !Number.isFinite(Number(v)) ? null : Number(v);
}

/**
 * The footer's hold line for the runs about to go. One run: its quote's
 * hold. Several: their sum, "across N runs". Null while a quote is still
 * reading or could not be read: no sum is drawn from a missing part, and no
 * "$0.00" for runs that charge nothing (free rows say "No model · free").
 */
export function holdLine(quotes) {
  const list = Array.isArray(quotes) ? quotes : [];
  if (!list.length) return null;
  const holds = list.map(holdOf);
  if (holds.some((h) => h == null)) return null;
  const sum = aiTokens(holds.reduce((a, b) => a + b, 0));
  return list.length === 1 ? HOLD(sum) : `Holds up to ${sum} across ${list.length} runs · you pay what each uses`;
}

/** "Valid for 10 min", only where a quote carries an expiry. */
export function validLine(quotes, now = Date.now()) {
  const ends = (quotes || []).map((q) => Date.parse(q?.expires_at || '')).filter(Number.isFinite);
  if (!ends.length) return null;
  const mins = Math.max(0, Math.round((Math.min(...ends) - now) / 60000));
  return `Valid for ${mins} min`;
}

/**
 * The read-only model chip, from the AIRail's own read (`GET /api/ai/rail`):
 * the model the rail has picked for this option, else the row's first. A
 * read that failed names no model and still says where the model is set.
 */
export function modelChip(rail) {
  const models = Array.isArray(rail?.models) ? rail.models : [];
  const m = models.find((x) => x.id === rail?.pick) || models[0] || null;
  if (!m) return `Model ${MODEL_WHERE}`;
  return [m.name || m.id, m.price ? `${m.price} per variant` : null, MODEL_WHERE].filter(Boolean).join(' · ');
}

/**
 * Whether the several-area batch is on: the adapter answers first. On main it
 * answers unavailable, so several areas run in sequence.
 */
export function batchMode(check = availability) {
  const q = check('areasQuote');
  const g = check('areasGenerate');
  return q?.available === true && g?.available === true ? 'batch' : 'sequence';
}

/** Why a variant count is off, or null: 2 and 3 wait for the batch (#3764). */
export function variantWhy(n, mode = batchMode()) {
  if (n === 1 || mode === 'batch') return null;
  return availability('areasGenerate')?.reason || LATER;
}

/**
 * Several areas on main: each runnable row in order, through `runOne(row)`,
 * which answers its result or throws. The first refusal stops the rest,
 * which are listed as not run (nothing charged for them).
 */
export async function runSequence(rows, runOne) {
  const results = [];
  let refusal = null;
  for (const row of rows) {
    if (refusal) { results.push({ key: row.key, status: 'not_run', line: NOT_RUN }); continue; }
    try {
      results.push({ key: row.key, status: 'proposed', ...(await runOne(row)) });
    } catch (e) {
      refusal = { key: row.key, error: e };
      results.push({ key: row.key, status: 'refused', error: e });
    }
  }
  return { results, refusal };
}

/** What a run charged, summed, and the line under the results ("Charged $x for N runs …"). */
export function chargedLine(results) {
  const ran = (results || []).filter((r) => r.status === 'proposed' && r.charges);
  if (!ran.length) return null;
  const known = ran.map((r) => r.charged).filter((v) => v != null && Number.isFinite(Number(v)));
  const n = ran.length;
  const runs = `${n} run${n === 1 ? '' : 's'}`;
  if (known.length !== n) return `Charged for ${runs}; the amount is not recorded yet. What a run did not use was released.`;
  return `Charged ${aiTokens(known.reduce((a, b) => a + Number(b), 0))} for ${runs}. What a run did not use was released.`;
}

/**
 * An accepted proposal placed in its area on the card as it stands now:
 * `{ card, blockId }`, or `{ error }` when the card changed under it. A text
 * change lands only on the block whose words are still the proposal's
 * `before`; a new element takes the area's range, replacing the block that
 * held it, and only while that block is unchanged.
 */
export function placeResult(card, result, model = null) {
  const area = result?.area;
  if (!card || !area) return { error: 'This card is no longer open. Discard this proposal.' };
  const blocks = Array.isArray(card.blocks) ? card.blocks : [];
  if (result.kind === 'text') {
    const hit = blocks.find((b) => String(b.id) === String(area.block?.id) && b.kind === 'text' && String(b.text ?? '') === result.before);
    if (!hit) return { error: `${areaLabel(area.grid) || 'This area'} changed since Eadwyn proposed this. Select it and ask again.` };
    return { card: updateBlock(card, hit.id, { text: result.after }), blockId: hit.id };
  }
  let base = card;
  if (area.kind === 'block') {
    const was = blocks.find((b) => String(b.id) === String(area.block.id));
    const same = was && was.grid && ['c1', 'c2', 'r1', 'r2'].every((k) => was.grid[k] === area.grid[k]);
    if (!same) return { error: `${areaLabel(area.grid) || 'This area'} changed since Eadwyn proposed this. Select it and ask again.` };
    base = removeBlock(card, was.id);
  }
  const r = addBlock(base, { ...result.block, grid: { ...area.grid } }, model);
  if (r.error) return { error: `${r.error} Nothing was placed.` };
  return { card: r.card, blockId: r.card.blocks[r.card.blocks.length - 1]?.id ?? null };
}

/** A bound metric tile for a recorded item: its value is the record's, never typed. */
export function metricBlock(item) {
  return {
    kind: 'metric', label: item.label, value: item.value == null ? null : String(item.value),
    binding: { source_key: item.source_key, record_ref: item.record_ref ?? null, as_of: item.as_of ?? null, grade: item.grade ?? null, snapshot_hash: item.snapshot_hash ?? null },
  };
}

/** An image block for a kept or uploaded image. */
export function imageBlock(image, tag = 'illustration') {
  return { kind: 'image', image_url: image.url, image_id: image.uid, alt: image.alt || '', tag, fit: 'cover', crop: { x: 50, y: 50 } };
}
