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
 * Which rows are swapped is not written down anywhere: `SWAPPED`, at the foot
 * of this file, is derived (#4134). A row is swapped when its method below
 * answers through `through()`, and off while it is `off('<name>')`. So a swap
 * is one line, the row's own, and its decision is named in the comment above
 * that line. Never add a row to a list here: two branches that each swap a
 * row then meet only if they swap the same one.
 * D1515 history is browser-local: it returns gridOps directly, with no API contract.
 *
 * Fields on routes that exist (`context.inferred` and `context.freshness`
 * from #3877; the PostHog, HubSpot and Linear source rows from #3880) need
 * no method here: the surfaces read them when the existing read carries them.
 */

import { LATER, NOT_ON } from './deckV2Model.js';
// One line per client, in file-name order (pitch_v2_adapter_d1604 holds it), so two swaps add lines at different places.
import { dataRoomApi } from '../../../lib/api/dataRoom.js';
import { deckBatchesApi } from '../../../lib/api/deckBatches.js';
import { deckCardStatusApi } from '../../../lib/api/deckCardStatus.js';
import { deckCheckApi } from '../../../lib/api/deckCheck.js';
import { deckCoeditApi } from '../../../lib/api/deckCoedit.js';
import { deckCommentsApi } from '../../../lib/api/deckComments.js';
import { deckCritiqueApi } from '../../../lib/api/deckCritique.js';
import { deckDraftApi } from '../../../lib/api/deckDraft.js';
import { deckElementModelsApi } from '../../../lib/api/deckElementModels.js';
import { deckElementsApi } from '../../../lib/api/deckElements.js';
import { deckFiguresApi } from '../../../lib/api/deckFigures.js';
import { deckGridApi } from '../../../lib/api/deckGrid.js';
import { deckImageEditsApi } from '../../../lib/api/deckImageEdits.js';
import { deckInvestorLinksApi } from '../../../lib/api/deckInvestorLinks.js';
import { deckMediaApi } from '../../../lib/api/deckMedia.js';
import { deckModelPresetsApi } from '../../../lib/api/deckModelPresets.js';
import { deckRehearsalsApi } from '../../../lib/api/deckRehearsals.js';
import { deckRemixApi } from '../../../lib/api/deckRemix.js';
import { deckSlideAnalyticsApi } from '../../../lib/api/deckSlideAnalytics.js';
import { deckStageApi } from '../../../lib/api/deckStage.js';
import { deckTemplatesApi } from '../../../lib/api/deckTemplates.js';
import { deckTypedValuesApi } from '../../../lib/api/deckTypedValues.js';
import { deckUsageApi } from '../../../lib/api/deckUsage.js';
import { deckVentureElementsApi } from '../../../lib/api/deckVentureElements.js';
import { arrange as arrangeCard } from './arrangeModel.js';
import * as gridOps from './gridOps.js';

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
  draft: { issue: 3751, what: 'Restore unsaved changes' },
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
  imageVary: { issue: 3784, what: 'Erase, expand, vary and reference images' },
  elementsLibrary: { issue: 3779, what: 'Icons, shapes, dividers and textures' },
  diagrams: { issue: 3780, what: 'Funnel, hierarchy, hub and spoke, and 2×2 diagrams' },
  ventureElements: { issue: 3781, what: 'Team bios, logo wall, use of funds, round terms, cap-table summary and interview quotes' },
  templates: { issue: 3782, what: 'Template filters by stage, audience and style' },
  myTemplates: { issue: 3782, what: 'Your own templates' },
  saveAsTemplate: { issue: 3782, what: 'Save as my template' },
  typedTables: { issue: 3787, what: 'Data sheet, market circles and projection charts' },
  media: { issue: 3788, what: 'Sections, hide, appendix, buttons and recorded video' },
  pasteCards: { issue: 3788, what: 'Paste cards from another deck' },
  buttonClicks: { issue: 3788, what: 'Clicks on a deck\'s buttons' },
  presets: { issue: 3796, what: 'Fast, Balanced, Best and Custom presets' },
  orgLocks: { issue: 3786, what: 'A model pick locked by HQ' },
  critique: { issue: 3799, what: 'Fix with critique' },
  remix: { issue: 3800, what: 'Remix this slide' },
  consistency: { issue: 3802, what: 'Consistency and wording checks' },
  deckActions: { issue: 3808, what: 'Replace all images and Reorder for stage' },
  brandLocks: { issue: 3819, what: 'Brand kit locks' },
  pptxImport: { issue: 3819, what: 'Start from a .pptx template' },
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

/** The rows still off. `off(name)` records its row, so `SWAPPED` (at the foot) is every other row. */
const OFF = new Set();
const off = (name) => {
  OFF.add(name);
  return async () => unavailable(SURFACES[name].issue);
};


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
    // D1577 (#3824): a route that is on main but switched off (503 `*_off`, e.g. `presence_off` on a
    // Worker without its binding) is still "Coming later", with the Worker's own sentence.
    if (status === 503 && typeof e?.code === 'string' && e.code.endsWith('_off')) return unavailable(issue, e.message || NOT_ON);
    const message = typeof e?.message === 'string' && e.message ? e.message : 'could not be read';
    // D1543: a Worker refusal's code (a gate such as `no_consent`) rides along, so a surface can draw its line.
    const code = typeof e?.code === 'string' && e.code ? e.code : null;
    return Object.freeze({ available: false, unreadable: true, reason: message, issue, status, data: e?.data ?? null, ...(code ? { code } : {}) });
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
// D1501 (#3751): wired. A card's working copy (`If-Match: <rev>`, 0 for its first), the draft read for
// "Restore unsaved changes from …", and Discard.
export const saveCard = (deckId, uid, card, rev, opts) => through(() => deckDraftApi.saveCard(deckId, uid, card, rev, opts), SURFACES.saveCard.issue);
export const discardDraft = (deckId) => through(() => deckDraftApi.discard(deckId), SURFACES.discardDraft.issue);
export const draft = (deckId) => through(() => deckDraftApi.draft(deckId), SURFACES.draft.issue);
// D1502 part 2 (#3753): a run, read to resume it (pd2b, pd2c), and Stop. Follow it live with
// `deckBatchesApi.events(uid, onEvent)`, the run's Server-Sent Events; `batch` is the read it falls back to.
export const batch = (uid) => through(() => deckBatchesApi.batch(uid), SURFACES.batch.issue);
export const cancelBatch = (uid) => through(() => deckBatchesApi.cancel(uid), SURFACES.cancelBatch.issue);
/** D1503 (#3754): each grid element's models and the pick its next run uses (`GET /api/decks/:id/element-models`). */
export const elementModels = (deckId) => through(() => deckElementModelsApi.read(deckId), SURFACES.elementModels.issue);
export const areasQuote = off('areasQuote');
export const areasGenerate = off('areasGenerate');
/**
 * D1515 (#3767): undo and redo, frontend-only. No Worker route stores the history, so this row answers at once with
 * `gridOps.js` (its reducers and the 100-step history) and is not a client call: it has no contract.
 */
export const history = async () => Object.freeze({ available: true, value: gridOps });
export const narrativeOutline = off('narrativeOutline');
export const instruct = off('instruct');
/** D1522 (#3774): the deck's stage plan — the order for its stage, a why line per card, and missing-proof warnings. */
export const stagePlan = (deckId, opts) => through(() => deckStageApi.stagePlan(deckId, opts), SURFACES.stagePlan.issue);
/** D1523 (#3775): every figure on the version, Linked, Stated, Uncited or Not recorded, and the counts Check claims shows. Editor-only. */
export const figures = (deckId) => through(() => deckFiguresApi.list(deckId), SURFACES.figures.issue);
/**
 * D1524 (#3776): the deck's estimate and spend, formatted for the rail rows
 * (`deckUsageApi.rail`),
 * with the per-run prices the plain-units line divides the balance by. A
 * figure the Worker could not read is null, never $0.00.
 */
export const deckUsage = (deckId) => through(() => deckUsageApi.rail(deckId), SURFACES.deckUsage.issue);
/**
 * D1533 (#3777): one Arrange operation on a card (`arrangeModel.arrange`): `{ card, line }`,
 * `{ same, line }` or `{ error }`. Local and synchronous underneath; the edited card is saved with every other edit.
 */
export const arrange = async (card, selection, op, opts) => ({ available: true, value: arrangeCard(card, selection, op, opts) });
export const imageEdit = off('imageEdit');
/** D1544 (#3784): an edit's price (vary, edit, erase, expand) before it runs: one hold for the edit and its checks. */
export const imageVary = (uid, ask) => through(() => deckImageEditsApi.quote(uid, ask), SURFACES.imageVary.issue);
/**
 * D1541 (#3779): the elements library and a page of icons for the pd28
 * panel, in one answer: `{ licence, decor_max, shapes, dividers, textures,
 * generate, icons: { total, offset, items } }`.
 */
export const elementsLibrary = (opts = {}) => through(() => Promise.all([deckElementsApi.library(), deckElementsApi.icons(opts)]).then(([lib, page]) => ({ ...lib, icons: { total: page?.total ?? 0, offset: page?.offset ?? 0, items: page?.icons ?? [], licence: page?.licence ?? null } })), SURFACES.elementsLibrary.issue);
export const diagrams = off('diagrams');
/**
 * D1543 (#3781): the venture-record elements, from records with their Source and grade, no model.
 * `ventureElements(deckId, element, opts)` reads one (`GET /api/decks/:id/venture-elements/:element`), refused by its gate;
 * `ventureElements(deckId, null, opts)` reads them all for the one-click run, each placed or left out.
 */
export const ventureElements = (deckId, element, opts) => through(() => (element ? deckVentureElementsApi.element(deckId, element, opts) : deckVentureElementsApi.list(deckId, opts)), SURFACES.ventureElements.issue);
/** D1535 (#3782): HQ's Gallery templates, filtered by stage, New deck's seven audiences and style. */
export const templates = (filters = {}) => through(() => deckTemplatesApi.templates(filters), SURFACES.templates.issue);
/** D1535: the caller's own templates. */
export const myTemplates = () => through(() => deckTemplatesApi.myTemplates(), SURFACES.myTemplates.issue);
/** D1535: a deck saved as the caller's template, text and figures removed. */
export const saveAsTemplate = (deckId, name) => through(() => deckTemplatesApi.saveAsTemplate(deckId, name), SURFACES.saveAsTemplate.issue);
/** D1538 (#3787): the figures typed for the deck, each Stated, with who typed it. */
export const typedTables = (deckId) => through(() => deckTypedValuesApi.list(deckId), SURFACES.typedTables.issue);
/**
 * D1545 (#3788): recorded video. `media(deckId, file)` uploads an MP4 and answers the video a block names
 * (`{ video: { provider: 'mp4', video_id, url } }`). Its row being swapped turns on Hide and Move to section,
 * Recorded video and Button, which have no route of their own.
 */
export const media = (deckId, file) => through(() => deckMediaApi.uploadVideo(deckId, file), SURFACES.media.issue);
/** D1545: another deck's cards, as a save keeps them, for the editor to place (`{ cards, missing }`); nothing is saved. */
export const pasteCards = (deckId, fromDeckId, cardUids) => through(() => deckMediaApi.paste(deckId, fromDeckId, cardUids), SURFACES.pasteCards.issue);
/** D1545: each pressed button's clicks and viewers (`{ buttons: [{ card_uid, block_id, clicks, viewers }] }`). */
export const buttonClicks = (deckId) => through(() => deckMediaApi.buttonClicks(deckId), SURFACES.buttonClicks.issue);
/** D1549 (#3796): the deck's preset in force, each group's model per preset, and HQ's locks (`GET /api/decks/:id/model-presets`). */
export const presets = (deckId) => through(() => deckModelPresetsApi.read(deckId), SURFACES.presets.issue);
/** D1549 (#3796, the row is #3786's): each element group HQ locked, with "Set by Axal VC HQ" — the same reply's `locks`. */
export const orgLocks = (deckId) => through(() => deckModelPresetsApi.read(deckId).then((r) => r.locks), SURFACES.orgLocks.issue);
// D1552 (#3799): Fix with critique: its quote (the ⋯ item's hold), or the run itself with `{ run: true }`.
export const critique = (deckId, { run = false, vision = true } = {}) => through(() => (run ? deckCritiqueApi.run(deckId, { vision }) : deckCritiqueApi.quote(deckId)), SURFACES.critique.issue);
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
/**
 * D1570 (#3817): the venture's comment threads, who is reading, the people who can be mentioned and the open count
 * (`GET /api/decks/:id/comments`). The sheet writes through `deckCommentsApi`; no model is in a thread.
 */
export const comments = (deckId) => through(() => deckCommentsApi.list(deckId), SURFACES.comments.issue);
/**
 * D1573 (#3820): one investor link's pd37 sheet (`GET /api/decks/:id/investor-links/:shareId/analytics`): its views,
 * its Time per slide consent, seconds per card by uid (null when not counted, and `cards: null` with the consent
 * off), the most-read card and the visit timeline. #3815's signals read the same timeline.
 */
export const slideAnalytics = (deckId, shareId) => through(() => deckSlideAnalyticsApi.read(deckId, shareId), SURFACES.slideAnalytics.issue);
/**
 * D1577 (#3824): who else is editing the deck (`GET /api/decks/:id/presence` → `{ editors }`).
 * A Worker without the DECK_PRESENCE binding answers 503 `presence_off`, so this stays
 * "Coming later" and no avatar, "N editing" or Suggest switch is drawn. Suggest mode waits on its store.
 */
export const presence = (deckId) => through(() => deckCoeditApi.presence(deckId), SURFACES.presence.issue);
/**
 * D1579 (#3826): each card's status and assignee on the saved version, filtered by status and assignee, the cards
 * not Done, and who a card can be assigned to (`GET /api/decks/:id/card-status`). Status and assignee are written
 * by saving a version.
 */
export const cardStatus = (deckId, filter) => through(() => deckCardStatusApi.read(deckId, filter), SURFACES.cardStatus.issue);
/**
 * D1580 F1 (#3827): the founder's rehearsals of this version, newest first; the surface runs and reads them through
 * `deckRehearsalsApi`. Present's Rehearse panel runs, reads and keeps through the same client.
 */
export const rehearse = (deckId) => through(() => deckRehearsalsApi.list(deckId), SURFACES.rehearse.issue);
export const walkthrough = off('walkthrough');
export const retryFailed = off('retryFailed');
export const unseenBatches = off('unseenBatches');
export const markSeen = off('markSeen');
export const setDeckSource = (projectUid, fileUid, opts) => through(() => dataRoomApi.setDeckSource(projectUid, fileUid, opts), SURFACES.setDeckSource.issue);

/**
 * #4134: the rows whose route is on main, each answering through its real client, never unavailable by
 * default. Derived, never listed: every row whose method above is not `off(...)`, in SURFACES order.
 * pitch_v2_adapter_d1604 holds each one to a `through(() => <client>…)` body.
 */
export const SWAPPED = Object.freeze(Object.keys(SURFACES).filter((name) => !OFF.has(name)));

/** Synchronous: whether a surface is on, for a menu that greys its item before any read. */
export const availability = (name) => (SURFACES[name] && !SWAPPED.includes(name) ? unavailable(SURFACES[name].issue) : null);
