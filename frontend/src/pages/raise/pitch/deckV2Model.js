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
 *   saveChip, MORE_MENU  the editor header's save state and its ⋯ menu, with
 *   moreState, moreName  why each item is greyed and the ", N off" name
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
    { id: 'interview_quote', label: 'Interview quote', ...A('ventureElements', 3781) },
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
/**
 * PD-9 (plan §8): the page's own line for the two AI-off states. AI paused is
 * read from the studio's switch (D765); out of tokens is known once a run or a
 * quote is refused with a 402 (main has no balance gate before the press). In
 * either state Ask on an area is greyed with the same words, and the rest of
 * the page keeps working.
 */
export const PAUSED_BANNER = 'AI is paused for your studio. Editing, Present, Share and Export still work.';
export const TOKENS_BANNER = 'You are out of AI tokens. Runs wait until you add tokens; editing, Present, Share and Export still work.';
export const ASK_OFF_PAUSED = 'AI is paused for your studio.';
export const ASK_OFF_TOKENS = 'Out of AI tokens. Add tokens to run it.';
/** The page's AI-off state: paused wins, because adding tokens would not lift it. */
export function aiOffState({ aiOn = true, outOfTokens = false } = {}) {
  if (!aiOn) return { kind: 'paused', banner: PAUSED_BANNER, ask: ASK_OFF_PAUSED };
  if (outOfTokens) return { kind: 'tokens', banner: TOKENS_BANNER, ask: ASK_OFF_TOKENS };
  return null;
}
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
  // D1500: the card's own uid, so the edit lands on that card even if it moved since.
  const cardUid = typeof p.card_uid === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(p.card_uid) ? p.card_uid : null;
  const base = { uid: row.uid, option: row.rail_option || null, card: p.card, card_uid: cardUid, action, what: ACTION_WORDS[action] || 'Edit', at: row.created_at || null };
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
/**
 * D1500: where the card an edit was made for sits now. By its uid when the
 * edit names one: a card moved since is found, and a card removed since is -1,
 * never the card that took its place. An edit made before uids reads by place.
 */
export function editIndex(cards, edit) {
  const list = Array.isArray(cards) ? cards : [];
  if (edit?.card_uid) return list.findIndex((c) => c?.uid === edit.card_uid);
  return Number.isInteger(edit?.card) && edit.card < list.length ? edit.card : -1;
}

export function placeTextEdit(cards, edit) {
  const at = editIndex(cards, edit);
  const card = at >= 0 ? cards[at] : null;
  if (!card) return { error: `Card ${edit.card + 1} is no longer in this deck. Discard this proposal.` };
  const blocks = Array.isArray(card.blocks) ? card.blocks : [];
  const hit = blocks.find((b) => b.kind === 'text' && String(b.text ?? '') === edit.before);
  if (!hit) return { error: `Card ${edit.card + 1} changed since Eadwyn proposed this. Select the area and ask again.` };
  return { card: { ...card, blocks: blocks.map((b) => (b === hit ? { ...b, text: edit.after } : b)) }, blockId: hit.id };
}

// ---------------------------------------------------------------------------
// The editor's header (DeckToolbar, pd0 · pd13) and its ⋯ menu (DeckMoreMenu)
// ---------------------------------------------------------------------------

/** The ⋯ button's name, before the off suffix. */
export const MORE_NAME = 'More deck actions';
export const SAVED = '✓ Saved';
export const UNSAVED = '● Unsaved changes';
export const SAVE_VERSION = 'Save version';
export const READ_ONLY_LINE = 'Read only';

/**
 * The save state the header draws. With no autosave on main (#3751), Save
 * version shows only while there is something to save (owner question G,
 * S1's pick (a)). `when` is editorModel's `saveState` line ("Saved · 2 min
 * ago"), whose time becomes the title.
 */
export function saveChip({ dirty, readOnly, when, version = null }) {
  if (readOnly) return { text: version == null ? READ_ONLY_LINE : `${READ_ONLY_LINE} · v${version}`, title: 'You can read this deck. Changes are the founder’s.', save: false };
  if (dirty) return { text: UNSAVED, title: 'Nothing is saved until you save a version.', save: true };
  const at = /^Saved · (.+)$/.exec(String(when || ''))?.[1];
  // "Saved · v3" names the version, not a time: no time is drawn then.
  if (at && /^v\S+$/.test(at)) return { text: SAVED, title: 'All changes saved', save: false };
  return { text: SAVED, title: at ? `All changes saved · ${at}` : 'All changes saved', save: false };
}

/**
 * The ⋯ menu, in its three sections (plan §2.2). An item is wired on main
 * (`write` when it changes the deck, so a reader sees it greyed), or it names
 * the `deckV2Adapter.js` method (`adapter`) that answers unavailable until its
 * issue merges: drawn greyed "Coming later", titled with the adapter's
 * reason, still reachable by keyboard. `ai` marks an item that runs a model.
 */
export const MORE_MENU = Object.freeze([
  { id: 'deck', label: 'This deck', items: [
    { id: 'stage', label: 'Stage', adapter: 'stagePlan' },
    // D1499 (#3749): the theme's aspect, written like a theme and held until a version is saved.
    { id: 'size', label: 'Slide size 16:9 · 4:3', write: true },
    { id: 'theme', label: 'Theme', write: true },
    { id: 'brand', label: 'Brand kit' },
    { id: 'reorder', label: 'Reorder for stage', adapter: 'deckActions' },
    { id: 'sources', label: 'Sources and coverage' },
    { id: 'versions', label: 'Versions…' },
    { id: 'save_named', label: 'Save as a named version…', write: true },
    // Kept from v1's editor bar and Notes tab: the thread with the venture's admins (D905).
    { id: 'notes', label: 'Notes from your admins' },
  ] },
  { id: 'card', label: 'This card', items: [
    { id: 'structure', label: 'Structure', write: true },
    { id: 'remix', label: 'Remix this slide', note: 'Free', adapter: 'remix' },
    { id: 'duplicate', label: 'Duplicate', write: true },
    { id: 'hide', label: 'Hide', adapter: 'media' },
    { id: 'section', label: 'Move to section', adapter: 'media' },
    { id: 'appendix', label: 'Mark as appendix', write: true },
    { id: 'background', label: 'Background image', write: true },
  ] },
  { id: 'ai', label: 'Whole deck · uses AI', items: [
    { id: 'replace_images', label: 'Replace all images', adapter: 'deckActions', ai: true },
    { id: 'check', label: 'Check claims', note: 'Free checks' },
    { id: 'critique', label: 'Fix with critique', adapter: 'critique', ai: true },
  ] },
]);

/** On a phone, Share's two items move into ⋯ (plan §2.1). */
export const SHARE_ITEMS = Object.freeze([
  { id: 'share', label: 'Share link…' },
  { id: 'export', label: 'Export…' },
]);

/**
 * Why each item is greyed, or null when it can be pressed: the adapter's
 * reason ("Coming later") while its surface answers unavailable, read only
 * for a write, the editor not on screen yet (`waiting`, for every item but
 * Share's two), or AI paused / out of tokens for a wired item that runs a
 * model. An item whose adapter surface answers available is wired like any
 * other: the seam greys it only until its issue merges. `off` counts only the
 * last kind: the items that would work but for AI.
 */
export function moreState(sections, { readOnly = false, aiOn = true, outOfTokens = false, availability = () => null, waiting = null } = {}) {
  let off = 0;
  let why = null;
  const shareIds = new Set(SHARE_ITEMS.map((i) => i.id));
  const out = sections.map((s) => ({
    ...s,
    items: s.items.map((it) => {
      if (it.adapter) {
        const a = availability(it.adapter);
        if (!a || a.available !== true) return { ...it, disabled: true, later: true, why: a?.reason || NOT_ON };
      }
      if (readOnly && it.write) return { ...it, disabled: true, why: 'Read only' };
      if (waiting && !shareIds.has(it.id)) return { ...it, disabled: true, why: waiting };
      if (it.ai && (!aiOn || outOfTokens)) {
        off += 1;
        why = why || (!aiOn ? 'AI is paused' : 'out of AI tokens');
        return { ...it, disabled: true, why: !aiOn ? 'AI is paused for your studio.' : 'Out of AI tokens. Add tokens to run it.' };
      }
      return { ...it, disabled: false, why: null };
    }),
  }));
  return { sections: out, off, why };
}

/** The ⋯ items' line while the editor itself is not on screen (the deck or the model still reading, or failed). */
export const EDITOR_WAITING = 'Opens once the deck is on screen.';

/** "More deck actions", with ", N off: <why>" when items are off for AI. */
export const moreName = (off, why) => (off > 0 ? `${MORE_NAME}, ${off} off: ${why}` : MORE_NAME);
