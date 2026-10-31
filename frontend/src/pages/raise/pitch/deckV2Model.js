/**
 * D1604 (#3716) — Pitch deck studio v2: the words and pure helpers every v2
 * surface shares. No React, no network.
 *
 *   LATER, PEND, HOLD    the three lines a v2 surface prints most often
 *   areaLabel            "c5–8 × r4–6", the Grid coordinates of an area
 *   ELEMENT_GROUPS       the lightbox's element picker (pd4 PICK): 8 groups,
 *                        each item routed to a Worker route on main, a free
 *                        edit, or the adapter key and issue that brings it
 *   ACCEPT, …            the one set of proposal verbs (§0 row 5)
 *   askName, …           the Ask button's accessible names (pd40, §0 row 6)
 *   DECK_ASK_OPTIONS     the rail options whose proposals Ask lists
 *   cardEdit, …          a waiting card edit, read from its rail proposal
 *
 * The owner's rules this file carries: the button is "Ask" and its name
 * "Ask Eadwyn", never "Fill"; every generated element is a proposal decided
 * with Accept or Discard; a count that could not be read is not drawn, never
 * "0 waiting".
 */

/** An item whose route is not on main yet. */
export const LATER = 'Coming later';
/** Marked on the three picker items the owner has not decided (M, H, G). */
export const PEND = '(pending owner)';
/** The adapter's reason, Team's copy (D1497). */
export const NOT_ON = 'Not switched on yet.';

/** The hold line shown before anything that costs tokens runs. `money` is already formatted ("$0.03"). */
export const HOLD = (money) => `Holds up to ${money} · you pay what it uses`;

/**
 * "c5–8 × r4–6": an area's columns and rows on the 12 × 6 Grid, 1-based and
 * inclusive (the slide model's `grid`: `{ c1, c2, r1, r2 }`). A one-cell span
 * reads "c5" rather than "c5–5". Null when the range is not a range.
 */
export function areaLabel(grid) {
  const n = (v) => (Number.isInteger(v) && v > 0 ? v : null);
  const c1 = n(grid?.c1); const c2 = n(grid?.c2); const r1 = n(grid?.r1); const r2 = n(grid?.r2);
  if (!c1 || !c2 || !r1 || !r2 || c2 < c1 || r2 < r1) return null;
  const span = (a, b) => (a === b ? `${a}` : `${a}–${b}`);
  return `c${span(c1, c2)} × r${span(r1, r2)}`;
}

// ---------------------------------------------------------------------------
// The element catalogue (pd4 PICK), routed
// ---------------------------------------------------------------------------

/**
 * Where an element comes from. `route` names a Worker route on main and the
 * rail option its run is charged to (`option`, null when it runs no model).
 * `adapter` names the `deckV2Adapter.js` method that answers unavailable until
 * `issue` merges. `free` marks an element placed with no model.
 */
const R = (route, option = null) => ({ route, option });
const A = (adapter, issue) => ({ adapter, issue });

export const ELEMENT_GROUPS = Object.freeze([
  { id: 'text', label: 'Text', items: [
    { id: 'title', label: 'Title', ...R('POST /api/decks/:id/cards/:card/assist', 'deck:rewrite') },
    { id: 'kicker', label: 'Kicker', ...R('POST /api/decks/:id/cards/:card/assist', 'deck:rewrite') },
    { id: 'body', label: 'Body', ...R('POST /api/decks/:id/cards/:card/assist', 'deck:rewrite') },
    { id: 'bullets', label: 'Bullets', ...R('POST /api/decks/:id/cards/:card/assist', 'deck:rewrite') },
    { id: 'callout', label: 'Call-out', ...R('POST /api/decks/:id/cards/:card/assist', 'deck:rewrite') },
    { id: 'caption', label: 'Caption', ...R('POST /api/decks/:id/cards/:card/assist', 'deck:rewrite') },
    { id: 'quote_founder', label: 'Quote · founder’s own', free: true },
    { id: 'team_bios', label: 'Team bios', ...A('ventureElements', 3781) },
    { id: 'speaker_notes', label: 'Speaker notes', ...A('media', 3788) },
  ] },
  { id: 'images', label: 'Images', items: [
    { id: 'photo', label: 'Generated photo', ...R('POST /api/decks/:id/images', 'deck:image') },
    { id: 'illustration', label: 'Illustration', ...R('POST /api/decks/:id/images', 'deck:image') },
    { id: 'upload', label: 'Uploaded', free: true, ...R('POST /api/decks/:id/images/upload') },
    { id: 'brand_assets', label: 'Brand assets', ...A('brandLocks', 3819) },
    { id: 'edit_vary', label: 'Edit or vary', ...A('imageEdit', 3778) },
    { id: 'remove_bg', label: 'Background removal', pending: true, ...A('imageEdit', 3778) },
    { id: 'upscale', label: 'Upscale', ...A('imageEdit', 3778) },
  ] },
  { id: 'graphics', label: 'Graphics', items: [
    { id: 'icons', label: 'Icons', ...A('elementsLibrary', 3779) },
    { id: 'shapes', label: 'Shapes and dividers', ...A('elementsLibrary', 3779) },
    { id: 'textures', label: 'Backgrounds and textures', ...A('elementsLibrary', 3779) },
    { id: 'logo_wall', label: 'Logo wall', ...A('ventureElements', 3781) },
  ] },
  { id: 'data', label: 'Data', items: [
    { id: 'chart', label: 'Chart from records', ...R('POST /api/decks/:id/cards/:card/assist', 'deck:chart') },
    { id: 'metric', label: 'Metric', free: true, ...R('GET /api/decks/sources') },
    { id: 'table', label: 'Table from records', ...R('POST /api/decks/:id/cards/:card/assist', 'deck:table') },
    { id: 'timeline', label: 'Timeline', ...R('POST /api/decks/:id/cards/:card/assist', 'deck:timeline') },
    { id: 'market_size', label: 'Market size', ...A('typedTables', 3787) },
    { id: 'projections', label: 'Financial projections', ...A('typedTables', 3787) },
    { id: 'competition', label: 'Competition table', ...A('typedTables', 3787) },
    { id: 'typed_table', label: 'Typed table', ...A('typedTables', 3787) },
    { id: 'market_chart', label: 'Market-size chart', ...A('typedTables', 3787) },
    { id: 'projection_chart', label: 'Projection chart', ...A('typedTables', 3787) },
    { id: 'positioning', label: 'Positioning 2×2', ...A('diagrams', 3780) },
  ] },
  { id: 'diagrams', label: 'Diagrams', items: [
    { id: 'flow', label: 'Flow', ...A('diagrams', 3780) },
    { id: 'cycle', label: 'Cycle', ...A('diagrams', 3780) },
    { id: 'matrix', label: 'Matrix', ...A('diagrams', 3780) },
    { id: 'funnel', label: 'Funnel', ...A('diagrams', 3780) },
    { id: 'hierarchy', label: 'Hierarchy', ...A('diagrams', 3780) },
    { id: 'hub', label: 'Hub and spoke', ...A('diagrams', 3780) },
  ] },
  { id: 'venture', label: 'Venture records', items: [
    { id: 'team_grid', label: 'Team grid', free: true },
    { id: 'use_of_funds', label: 'Use of funds', ...A('ventureElements', 3781) },
    { id: 'round_terms', label: 'Round terms', ...A('ventureElements', 3781) },
    { id: 'interview_quote', label: 'Interview quote', pending: true, ...A('ventureElements', 3781) },
    { id: 'cap_table', label: 'Cap-table summary', ...A('ventureElements', 3781) },
  ] },
  { id: 'media', label: 'Media & links', items: [
    { id: 'video', label: 'Video', free: true, ...R('POST /api/decks/video-link') },
    { id: 'audio', label: 'Audio', free: true },
    { id: 'link', label: 'Link', free: true },
    { id: 'recorded_video', label: 'Recorded video', ...A('media', 3788) },
    { id: 'button', label: 'Button', ...A('media', 3788) },
    { id: 'embeds', label: 'Embeds', ...A('media', 3788) },
  ] },
  { id: 'stock', label: 'Stock', items: [
    { id: 'stock_photo', label: 'Stock photo', pending: true, ...A('stock', 3813) },
  ] },
]);

/** Every element, flat, with its group id. */
export const ELEMENTS = Object.freeze(ELEMENT_GROUPS.flatMap((g) => g.items.map((i) => Object.freeze({ ...i, group: g.id }))));

/** True when the element can be placed or generated on main today. */
export const elementOnMain = (el) => Boolean(el && !el.adapter && (el.route || el.free));

// ---------------------------------------------------------------------------
// Proposals: one set of verbs
// ---------------------------------------------------------------------------

export const ACCEPT = 'Accept';
export const ACCEPT_ALL = 'Accept all';
export const DISCARD = 'Discard';
/** Only for an edit that runs no model (a theme, a layout): one undo step, not a proposal. */
export const APPLY = 'Apply';
/** Said beside Accept until undo (#3767) can say "Still charged". */
export const CHARGED_LINE = 'The run was charged when Eadwyn proposed it. Accepting places it; it costs nothing more.';

// ---------------------------------------------------------------------------
// Ask (pd40)
// ---------------------------------------------------------------------------

/** The visible label: always "Ask", on every width (the phone shows the word too). */
export const ASK_LABEL = 'Ask';
/** The one accessible name. AI off keeps it (§0 row 6, owner question H). */
export const ASK_NAME = 'Ask Eadwyn';

/**
 * The header button's accessible name: "Ask Eadwyn", and ", N waiting" only
 * when a read counted N > 0. An unread count (null) adds nothing.
 */
export function askName(waiting) {
  return Number.isInteger(waiting) && waiting > 0 ? `${ASK_NAME}, ${waiting} waiting` : ASK_NAME;
}

/** The selection's Ask: "Ask Eadwyn about this area" or "…about these N areas". */
export function askAreaName(n) {
  return Number.isInteger(n) && n > 1 ? `${ASK_NAME} about these ${n} areas` : `${ASK_NAME} about this area`;
}

export const ASKING = 'Asking…';
export const ASK_UNREADABLE = 'Eadwyn could not be reached. Try again.';
export const ASK_OFF = 'AI is paused. What is waiting can still be accepted or discarded.';
export const WAITING_TITLE = 'Waiting for you';
export const WAITING_NONE = 'Nothing is waiting. What Eadwyn proposes for this deck appears here until you accept or discard it.';
export const STILL_WORKS = Object.freeze([
  'Manual editing',
  'Refresh from records',
  'Check claims’ free checks',
  'Accepting or discarding what is already waiting',
]);

/** The deck's text and data edits a card run proposes (deck_assist.ts), in the editor's order. */
export const DECK_ASK_OPTIONS = Object.freeze(['deck:rewrite', 'deck:shorten', 'deck:expand', 'deck:tone', 'deck:translate', 'deck:chart', 'deck:table', 'deck:timeline']);

const ACTION_WORDS = {
  rewrite: 'Rewrite', shorten: 'Shorter', expand: 'Longer', headline: 'Headline', tone: 'New tone', translate: 'Translation',
  ask: 'Your instruction', chart: 'Chart from records', table: 'Table from records', timeline: 'Timeline from records',
};
const CHART_ACTIONS = new Set(['chart', 'table', 'timeline']);
const CHART_SIZE = { chart: { cols: 6, rows: 3 }, table: { cols: 6, rows: 3 }, timeline: { cols: 12, rows: 2 } };

/**
 * A waiting card edit, read from one `ai_rail_proposals` row that a card run
 * left (`deck_assist.ts`: `record = deck:<id>`, payload `{ deck_id, card,
 * action, before, after }` or `{ …, block, title }`). Null for a row this
 * deck did not propose or that is not open.
 */
export function cardEdit(row, deckId) {
  if (!row || (row.status && row.status !== 'proposed')) return null;
  const p = row.payload && typeof row.payload === 'object' ? row.payload : null;
  if (!p || String(p.deck_id) !== String(deckId) || !Number.isInteger(p.card) || p.card < 0) return null;
  const action = String(p.action || '');
  const base = { uid: row.uid, option: row.rail_option || null, card: p.card, action, what: ACTION_WORDS[action] || 'Edit', at: row.created_at || null };
  if (CHART_ACTIONS.has(action)) {
    if (!p.block || typeof p.block !== 'object') return null;
    return { ...base, kind: 'block', block: p.block, title: p.title || null, size: CHART_SIZE[action] };
  }
  if (typeof p.after !== 'string' || !p.after.trim()) return null;
  return { ...base, kind: 'text', before: String(p.before ?? ''), after: p.after };
}

/** One line naming the edit: "Card 3 · Shorter". */
export const cardEditLine = (edit) => `Card ${edit.card + 1} · ${edit.what}`;

/**
 * The waiting count, or null when any read it depends on failed: a failed
 * read draws no count, never "0 waiting".
 */
export function waitingCount({ deck, edits }) {
  if (deck?.status !== 'ready' || edits?.status !== 'ready') return null;
  return (deck.proposal ? 1 : 0) + edits.items.length;
}

/**
 * Where a text edit lands: the card's text block whose text is still the
 * proposal's `before`. When the card changed since, nothing is guessed.
 */
export function placeTextEdit(cards, edit) {
  const card = Array.isArray(cards) ? cards[edit.card] : null;
  if (!card) return { error: `Card ${edit.card + 1} is no longer in this deck. Discard this proposal.` };
  const blocks = Array.isArray(card.blocks) ? card.blocks : [];
  const hit = blocks.find((b) => b.kind === 'text' && String(b.text ?? '') === edit.before);
  if (!hit) return { error: `Card ${edit.card + 1} changed since Eadwyn proposed this. Select the area and ask again.` };
  return { card: { ...card, blocks: blocks.map((b) => (b === hit ? { ...b, text: edit.after } : b)) }, blockId: hit.id };
}
