/**
 * D1604 (#3716, pd29, plan §7) — the templates gallery's words and
 * derivations, pure. No React, no network.
 *
 * The Gallery is the template store (D1535, #3782; content #3876), read
 * through `deckV2Adapter.js`: the 24 tiles with their Stage, Audience (New
 * deck's seven) and Style filters, Yours, and Save as my template. v1's deck
 * methods stay on New deck only (D1535 Q5). The words for New deck's method
 * start (`templateSentence`, `templateStartLine`) live here too.
 */
import { AUDIENCE_LABELS } from './editorModel';

export const TEMPLATES_PATH = '/raise/pitch/templates';
export const TEMPLATES_TITLE = 'Templates';
export const GALLERY = 'Gallery';
export const YOURS = 'Yours';
export const USE_TEMPLATE = 'Use this template';
export const NO_TEMPLATES = 'No template is available to you yet.';
export const SAVE_MINE = 'Save as my template';
export const SAVE_MINE_LINE = 'Text and figures are removed; structure, theme and decor are kept.';
export const YOURS_EMPTY = 'No templates of yours yet.';
export const USE_SENTENCE = 'Eadwyn fills the template from your records as a proposal beside your current version. You review it before anything is saved.';
/**
 * The templates `POST /api/decks/apply-method` does not propose: it copies
 * the Lab's records and runs no model, so it writes a new version at once
 * (`cloudflare-worker/src/routes/decks.ts`, the `axal_spinout_demoday`
 * branch, which answers `{ deck }`, never a proposal).
 */
export const DIRECT_METHODS = Object.freeze(['axal_spinout_demoday']);
export const DIRECT_SENTENCE = 'This template copies your Lab records into a new version straight away. No model runs. Your earlier versions stay.';
/** The Use this template dialog's sentence for this template: what apply-method really does with it. */
export const templateSentence = (methodId) => (DIRECT_METHODS.includes(methodId) ? DIRECT_SENTENCE : USE_SENTENCE);
/** New deck's line under a template start. */
export const templateStartLine = (methodId) => (DIRECT_METHODS.includes(methodId)
  ? 'This template copies your Lab records; the outline below is not used.'
  : 'Eadwyn fills the template from your records; the outline below is not used.');

/** The three filter rows, in pd29's order; Audience is New deck's seven. */
export const FILTERS = Object.freeze([
  { id: 'stage', label: 'Stage', chips: ['Pre-seed', 'Seed', 'Series A', 'Series B+'] },
  { id: 'audience', label: 'Audience', chips: Object.values(AUDIENCE_LABELS) },
  { id: 'style', label: 'Style', chips: ['Editorial', 'Bold', 'Minimal'] },
]);

const str = (v) => (v == null ? '' : String(v).trim());

/** "12 cards", or nothing when the template does not say. Never "0 cards". */
export function cardCount(method) {
  const n = Number(method?.slide_count ?? (Array.isArray(method?.slides) ? method.slides.length : NaN));
  return Number.isInteger(n) && n > 0 ? `${n} card${n === 1 ? '' : 's'}` : null;
}

/**
 * #3876 / D1535 Q5 (the owner's answer): the Gallery's tiles are the template
 * store's 24 (`GET /api/decks/templates`), not v1's methods. The methods stay
 * on New deck. Each swatch's base palette is H10's (#3876 §2), so a cover
 * draws its ground and ink before the store says more; `cover` carries the
 * template's own accent and display font once the list returns them.
 */
export const SWATCHES = Object.freeze({
  cream: { ground: '#F4EDE0', ink: '#1F1B16', muted: '#5C5246', rule: null },
  white: { ground: '#FFFFFF', ink: '#111418', muted: '#545B66', rule: null },
  near_black: { ground: '#121212', ink: '#F4F2EE', muted: '#B3AFA8', rule: null },
  blush: { ground: '#F6E3DD', ink: '#2A1A1A', muted: '#6A4B46', rule: null },
  navy: { ground: '#14213D', ink: '#F5F3EE', muted: '#B9C1D1', rule: null },
  sage: { ground: '#E3E9DD', ink: '#1B2318', muted: '#4C5848', rule: null },
  ivory: { ground: '#FAF6EB', ink: '#22201B', muted: '#5D574B', rule: null },
  white_rule: { ground: '#FFFFFF', ink: '#141414', muted: '#575757', rule: '#BDBDBD' },
});
export const STORE_FAILED = 'The templates could not be read.';
/** What the store's apply really does: a placeholder proposal, no model (deck_templates.ts `/templates/:uid/apply`). */
export const STORE_SENTENCE = 'The template becomes a proposal beside your current version, with placeholders where your words go and figures from your records or \u201cNot recorded\u201d. No model runs. You review it before anything is saved.';
export const NO_MATCH = 'No template matches these filters. Clear one to see more.';
export const SAVE_NO_DECK = 'Build a deck first: Save as my template keeps the current version’s structure, theme and decor.';
export const SAVED_MINE = 'Saved to Yours.';
export const PREVIEW_FAILED = 'This template’s cards could not be read.';
const HEX = /^#[0-9a-f]{6}$/i;

const labelOf = (list, key) => (Array.isArray(list) ? list.find((x) => x?.key === key)?.label : null) || null;

/**
 * A store template as a tile: its name, "N cards" (never 0), its stage and
 * style by the store's own labels, the audiences it is tagged for, and its
 * cover (H10's swatch, with the template's accent and display font when the
 * store gives them). `filters` is the list read's `{ stages, audiences, styles }`.
 */
export function storeTile(meta, filters = null) {
  if (!meta || !meta.uid) return null;
  const n = Number(meta.card_count);
  const sw = SWATCHES[meta.swatch] || null;
  const cov = meta.cover && typeof meta.cover === 'object' ? meta.cover : {};
  return {
    id: String(meta.uid), label: str(meta.name) || String(meta.uid), description: str(meta.description) || null,
    count: Number.isInteger(n) && n > 0 ? `${n} card${n === 1 ? '' : 's'}` : null,
    stage: labelOf(filters?.stages, meta.stage), style: labelOf(filters?.styles, meta.style),
    audiences: (Array.isArray(meta.audience_tags) ? meta.audience_tags : []).map((k) => labelOf(filters?.audiences, k) || null).filter(Boolean),
    cover: sw ? {
      ground: sw.ground, ink: sw.ink, muted: sw.muted, rule: sw.rule,
      accent: HEX.test(String(cov.accent || '')) ? cov.accent : null,
      font: typeof cov.display_font === 'string' && /^[A-Za-z0-9 ]{1,40}$/.test(cov.display_font) ? cov.display_font : null,
    } : null,
  };
}

/** The list read's tiles, in the store's order; anything without a uid is dropped. */
export const storeTiles = (read) => (Array.isArray(read?.templates) ? read.templates : []).map((m) => storeTile(m, read?.filters)).filter(Boolean);

/** The chips the list read offers, by group, in pd29's order; New deck's seven audiences come from the store. */
export function filterGroups(read) {
  const f = read?.filters || {};
  return [
    { id: 'stage', label: 'Stage', chips: Array.isArray(f.stages) ? f.stages : [] },
    { id: 'audience', label: 'Audience', chips: Array.isArray(f.audiences) ? f.audiences : [] },
    { id: 'style', label: 'Style', chips: Array.isArray(f.styles) ? f.styles : [] },
  ];
}

/** One chip per group: pressing the chosen one clears it. */
export const toggleFilter = (sel, group, key) => ({ ...sel, [group]: sel?.[group] === key ? null : key });

/** A template read's card titles for the preview strip, in order; a card with no title says which card it is. */
export function previewTitles(read) {
  const cards = Array.isArray(read?.cards) ? read.cards : [];
  return cards.map((c, i) => str(c?.title) || `Card ${i + 1}`);
}
