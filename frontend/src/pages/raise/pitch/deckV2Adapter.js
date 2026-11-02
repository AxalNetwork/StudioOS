/**
 * D1604 (#3716) — THE SEAM between the Pitch deck studio v2 surfaces and the
 * Worker routes that are not on main yet.
 *
 * Every v2 surface whose route has not merged reads through this file and
 * nowhere else. Each method answers `{ available: false, reason, issue }`:
 * the surface draws its "Coming later" state, titled with `reason`, and never
 * a zero, "$0.00" or "none" in its place (`shown` below). `issue` is the
 * GitHub issue whose route ends the wait; it keys the swap and is never drawn.
 *
 * Built the way Team's `pages/team/agentsAdapter.js` is (D1497): one line per
 * method, no network code. NO `/api` CLIENT METHOD IS ADDED FOR A ROUTE THAT
 * IS NOT ON MAIN (`scripts/check-api-drift.mjs` resolves every one).
 *
 * WHERE THE BUILDERS SWAP IN THE REAL CLIENT. When an issue's route merges,
 * its PR adds the client method under `frontend/src/lib/api/` (D527,
 * re-exported by one line in `api.js`) and replaces only the matching body
 * here with `through(() => <client>.<method>(…))`. `through` maps a Worker
 * refusal onto what the surface draws, so the swap changes no screen.
 *
 * Swapped out already: the Slides-suite (.odp) export (#3882) merged as
 * D1603, so `ExportDialog.jsx` calls `api.deckExportOdp` directly and this
 * file no longer lists it.
 *
 * Swapped here (`SWAPPED`): `grid`, whose route `GET /api/decks/:id/grid`
 * merged as D1499 part 1 (#3749), `stagePlan`, whose route
 * `GET /api/decks/:id/stage-plan` is D1522 (#3774), `remix`, whose route
 * `POST /api/decks/:id/remix` is D1553 (#3800), D1565's (#3812)
 * `investorLinks` and `withdrawInvestorLink`, and `typedTables`, whose route
 * `GET /api/decks/:id/typed-values` is D1538 (#3787). Each keeps its row, so
 * the plan's table still reads whole, and answers through its client
 * (`deckGridApi.grid`, `deckStageApi.stagePlan`, `deckRemixApi.remix`,
 * `deckInvestorLinksApi`, `deckTypedValuesApi.list`).
 * `elementModels` (D1503, #3754) answers through `deckElementModelsApi.read`.
 * And `consistency` (D1555, #3802): the free rules ride the deck check's own
 * reply, so it answers through `deckCheckApi.read`.
 * `rehearse` (D1580 F1, #3827) answers through `deckRehearsalsApi.list`; Present's
 * Rehearse panel runs, reads and keeps through the same client.
 *
 * Fields on routes that exist (`context.inferred` and `context.freshness`
 * from #3877; the PostHog, HubSpot and Linear source rows from #3880) need
 * no method here: the surfaces read them when the existing read carries them.
 */

import { LATER, NOT_ON } from './deckV2Model.js';
import { deckInvestorLinksApi } from '../../../lib/api/deckInvestorLinks.js';
import { deckGridApi } from '../../../lib/api/deckGrid.js';
import { deckStageApi } from '../../../lib/api/deckStage.js';
import { deckRemixApi } from '../../../lib/api/deckRemix.js';
import { deckTypedValuesApi } from '../../../lib/api/deckTypedValues.js';
import { deckCheckApi } from '../../../lib/api/deckCheck.js';
import { deckElementModelsApi } from '../../../lib/api/deckElementModels.js';
import { deckRehearsalsApi } from '../../../lib/api/deckRehearsals.js';

export { NOT_ON };

/** The one answer every method gives on this base. */
export const unavailable = (issue, reason = NOT_ON) => Object.freeze({ available: false, reason, issue });

/**
 * Every method, keyed by name: the issue that provides its route and what the
 * surface is. The table is the plan's §6.2; a test holds each to it.
 */
export const SURFACES = Object.freeze({
  grid: { issue: 3749, what: 'The 17 structures, divider drag and the 4:3 slide size' },
  saveCard: { issue: 3751, what: 'Autosave, one card at a time' },
  discardDraft: { issue: 3751, what: 'Discard the unsaved draft' },
  batch: { issue: 3753, what: 'Live build progress, per area' },
  cancelBatch: { issue: 3753, what: 'Stop a build' },
  elementModels: { issue: 3754, what: 'A model per element in the AIRail' },
  areasQuote: { issue: 3764, what: 'One quote and one hold for several areas' },
  areasGenerate: { issue: 3764, what: 'Generate into several areas, with variants' },
  history: { issue: 3767, what: 'Undo and redo' },
  narrativeOutline: { issue: 3768, what: 'An outline from the investor narrative' },
  instruct: { issue: 3773, what: 'An instruction on several areas' },
  stagePlan: { issue: 3774, what: 'Stage, the order for it and missing proof' },
  figures: { issue: 3775, what: 'Linked, Stated and Uncited on every figure' },
  deckUsage: { issue: 3776, what: 'Estimated and spent on this deck' },
  arrange: { issue: 3777, what: 'Align, distribute, group, lock and layers' },
  imageEdit: { issue: 3778, what: 'Crop, focus, filters, upscale and background removal' },
  elementsLibrary: { issue: 3779, what: 'Icons, shapes, dividers and textures' },
  diagrams: { issue: 3780, what: 'Funnel, hierarchy, hub and spoke, and 2×2 diagrams' },
  ventureElements: { issue: 3781, what: 'Logo wall, use of funds, round terms, cap-table summary and interview quotes' },
  templates: { issue: 3782, what: 'Template filters by stage, audience and style' },
  myTemplates: { issue: 3782, what: 'Your own templates' },
  saveAsTemplate: { issue: 3782, what: 'Save as my template' },
  typedTables: { issue: 3787, what: 'Data sheet, market circles and projection charts' },
  media: { issue: 3788, what: 'Sections, hide, appendix, buttons and recorded video' },
  presets: { issue: 3796, what: 'Fast, Balanced, Best and Custom presets' },
  orgLocks: { issue: 3786, what: 'A model pick locked by HQ' },
  critique: { issue: 3799, what: 'Fix with critique' },
  remix: { issue: 3800, what: 'Remix this slide' },
  consistency: { issue: 3802, what: 'Consistency and wording checks' },
  deckActions: { issue: 3808, what: 'Replace all images and Reorder for stage' },
  brandLocks: { issue: 3819, what: 'Brand kit locks' },
  pptxImport: { issue: 3809, what: 'Start from a .pptx template' },
  investorLinks: { issue: 3812, what: 'One link per investor, consent and watermark preview' },
  withdrawInvestorLink: { issue: 3812, what: 'Withdraw one investor\'s link, keeping its analytics' },
  comments: { issue: 3817, what: 'Comments with mentions' },
  slideAnalytics: { issue: 3820, what: 'Per-slide investor analytics' },
  presence: { issue: 3824, what: 'Who else is editing, and Suggest mode' },
  cardStatus: { issue: 3826, what: 'Card status and assignees' },
  rehearse: { issue: 3827, what: 'Rehearse and its report' },
  walkthrough: { issue: 3837, what: 'Record a pitch' },
  retryFailed: { issue: 3879, what: 'Retry the failed areas' },
  unseenBatches: { issue: 3879, what: 'The banner for a build that finished while you were away' },
  markSeen: { issue: 3879, what: 'Mark a finished build as seen' },
  setDeckSource: { issue: 3881, what: 'Tag a data-room file as a deck source' },
});

const off = (name) => async () => unavailable(SURFACES[name].issue);

/** The rows whose route is on main: each answers through its real client, never unavailable by default. */
export const SWAPPED = Object.freeze(['grid', 'stagePlan', 'remix', 'elementModels', 'investorLinks', 'withdrawInvestorLink', 'typedTables', 'consistency', 'rehearse']);

/**
 * A client call, as a surface reads it, for the day a method is swapped:
 * `{ available: true, value }`, or unavailable with the Worker's reason. A
 * route that answers 404 is still off; anything else is unreadable, never
 * empty.
 */
export async function through(call, issue) {
  try {
    return { available: true, value: await call() };
  } catch (e) {
    const status = e?.status ?? e?.response?.status ?? null;
    if (status === 404) return unavailable(issue);
    const message = typeof e?.message === 'string' && e.message ? e.message : 'could not be read';
    return Object.freeze({ available: false, unreadable: true, reason: message, issue });
  }
}

/**
 * What a surface prints for an answer: the value through `format` when
 * available, and otherwise the "Coming later" line (or "could not be read").
 * An unavailable answer is never formatted, so it can never print 0 or $0.00.
 */
export function shown(answer, format = String, later = LATER) {
  if (answer?.available === true) return format(answer.value);
  return answer?.unreadable ? 'Could not be read' : later;
}

// ---------------------------------------------------------------- the methods

/** D1499 (#3749): the deck version's Grid — its aspect, the 17 structures and each card's areas, each with its box. */
export const grid = (deckId) => through(() => deckGridApi.grid(deckId), SURFACES.grid.issue);
export const saveCard = off('saveCard');
export const discardDraft = off('discardDraft');
export const batch = off('batch');
export const cancelBatch = off('cancelBatch');
/** D1503 (#3754): each grid element's models and the pick its next run uses (`GET /api/decks/:id/element-models`). */
export const elementModels = (deckId) => through(() => deckElementModelsApi.read(deckId), SURFACES.elementModels.issue);
export const areasQuote = off('areasQuote');
export const areasGenerate = off('areasGenerate');
export const history = off('history');
export const narrativeOutline = off('narrativeOutline');
export const instruct = off('instruct');
/** D1522 (#3774): the deck's stage plan — the order for its stage, a why line per card, and missing-proof warnings. */
export const stagePlan = (deckId, opts) => through(() => deckStageApi.stagePlan(deckId, opts), SURFACES.stagePlan.issue);
export const figures = off('figures');
export const deckUsage = off('deckUsage');
export const arrange = off('arrange');
export const imageEdit = off('imageEdit');
export const elementsLibrary = off('elementsLibrary');
export const diagrams = off('diagrams');
export const ventureElements = off('ventureElements');
export const templates = off('templates');
export const myTemplates = off('myTemplates');
export const saveAsTemplate = off('saveAsTemplate');
/** D1538 (#3787): the figures typed for the deck, each Stated, with who typed it. */
export const typedTables = (deckId) => through(() => deckTypedValuesApi.list(deckId), SURFACES.typedTables.issue);
export const media = off('media');
export const presets = off('presets');
export const orgLocks = off('orgLocks');
export const critique = off('critique');
/** D1553 (#3800): four layouts for one card, and the remove-a-block reflow; free, so it answers with AI paused. */
export const remix = (deckId, card, opts) => through(() => deckRemixApi.remix(deckId, card, opts), SURFACES.remix.issue);
/**
 * D1555 (#3802): the free consistency rules, in the deck check's own reply (no route of their own).
 * `{ state, findings: [{ key, rule, message, cards }] }`, or null for a reader who is not the founder.
 * The Wording half stays with #3808 C13.
 */
export const consistency = (deckId) => through(() => deckCheckApi.read(deckId).then((r) => r?.consistency ?? null), SURFACES.consistency.issue);
export const deckActions = off('deckActions');
export const brandLocks = off('brandLocks');
export const pptxImport = off('pptxImport');
// D1565 (#3812): wired. Each body is `through(() => <client>(…), issue)`.
export const investorLinks = (deckId) => through(() => deckInvestorLinksApi.investorLinks(deckId), SURFACES.investorLinks.issue);
export const withdrawInvestorLink = (deckId, shareId) => through(() => deckInvestorLinksApi.withdrawInvestorLink(deckId, shareId), SURFACES.withdrawInvestorLink.issue);
export const comments = off('comments');
export const slideAnalytics = off('slideAnalytics');
export const presence = off('presence');
export const cardStatus = off('cardStatus');
/** D1580 F1 (#3827): the founder's rehearsals of this version, newest first; the surface runs and reads them through `deckRehearsalsApi`. */
export const rehearse = (deckId) => through(() => deckRehearsalsApi.list(deckId), SURFACES.rehearse.issue);
export const walkthrough = off('walkthrough');
export const retryFailed = off('retryFailed');
export const unseenBatches = off('unseenBatches');
export const markSeen = off('markSeen');
export const setDeckSource = off('setDeckSource');

/** Synchronous: whether a surface is on, for a menu that greys its item before any read. */
export const availability = (name) => (SURFACES[name] && !SWAPPED.includes(name) ? unavailable(SURFACES[name].issue) : null);
