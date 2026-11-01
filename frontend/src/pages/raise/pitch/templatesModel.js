/**
 * D1604 (#3716, pd29, plan §7) — the templates gallery's words and
 * derivations, pure. No React, no network.
 *
 * The Gallery is main's: `GET /api/decks/methods` (each template's label,
 * what it is best for, its card count, its plan lock and its cards) and
 * `GET /api/decks/recommend` (the one recommended for the venture's stage).
 * The Stage, Audience and Style filters need the tags #3782's store adds, and
 * Yours and "Save as my template" are #3782's routes: those read
 * `deckV2Adapter.js` and draw "Coming later" until it merges. Audience offers
 * New deck's seven audiences, never the canvas's three. The 24 designer
 * templates are #3876's content and land with #3782: no placeholder tile is
 * drawn for them.
 */
import { AUDIENCE_LABELS } from './editorModel';
import { recommendReason } from './studioActionsModel';

export const TEMPLATES_PATH = '/raise/pitch/templates';
export const TEMPLATES_TITLE = 'Templates';
export const GALLERY = 'Gallery';
export const YOURS = 'Yours';
export const USE_TEMPLATE = 'Use this template';
export const LOCKED_LINE = 'Part of a paid plan';
export const RECOMMENDED = 'Recommended for your stage';
export const NO_TEMPLATES = 'No template is available to you yet.';
export const METHODS_FAILED = 'The templates could not be read.';
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
 * The gallery's tiles from the methods read: the recommended one first, with
 * its reason; each with its name, its count, what it is best for, its lock,
 * and the titles of its first cards for the thumbnail.
 */
export function galleryTiles(methods, rec = null) {
  const list = (Array.isArray(methods) ? methods : []).filter((m) => m && m.id);
  const recId = rec?.method_id || null;
  const tiles = list.map((m) => ({
    id: m.id, label: str(m.label) || m.id, count: cardCount(m), bestFor: str(m.best_for) || null, locked: Boolean(m.locked),
    recommended: recId != null && m.id === recId, reason: recId != null && m.id === recId ? recommendReason(rec) : null,
    titles: (Array.isArray(m.slides) ? m.slides : []).filter((s) => s && !s.appendix).map((s) => str(s.title)).filter(Boolean),
  }));
  const at = tiles.findIndex((t) => t.recommended);
  if (at > 0) tiles.unshift(tiles.splice(at, 1)[0]);
  return tiles;
}
