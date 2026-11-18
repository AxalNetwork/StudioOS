/**
 * D7103 (#7103, Raise v2 RA-14 and RA-17) — Investor narrative's own Home and
 * its header action, Save version. Pure: no React, so the tests read it
 * without a browser.
 *
 * WHAT IS READ. Everything here comes from the module read the page already
 * makes, `GET /api/cycles/raise/modules/investor-narrative`, and its
 * `parts.narrative` (`raiseCycle.ts` `narrativeHome`, D909), which carries the
 * saved versions, the newest version's check, the claim tally (D6068), the
 * deck that reads the narrative, and the viewer's narrative capability map
 * (D5074 part 7, `services/narrative/capabilities.ts`). Nothing is a sample.
 *
 * WHAT SAVE VERSION WRITES. The narrative's own version store:
 * `POST /api/cycles/raise/narrative-versions` (`routes/cycle_raise.ts`,
 * `saveNarrativeVersion` in `services/raiseWriters.ts`) with
 * `start_from: version`, the newest version and the audience chosen. It
 * creates the next version as a copy of the newest as it stands, carrying its
 * sections, bound figures and positioning, and runs the consistency check on
 * it. A version is named by its number and its audience, as the store names it
 * ("Version 5 saved for Seed fund"); the store holds no free-text name.
 *
 * The states are #5129's vocabulary (`ui/dataState.js`): Loading, None (first
 * use), Not recorded, Unavailable and Refused, and a Value.
 */

import { ventureSearch } from '../../cycles/ventureQuery.js';
import { HOME_PATH, LINE, NEW_PATH, NOT_RECORDED, narrativeStanding, positioningHref, readByLine, tabSearch } from './narrativeModel.js';

export const SAVE_ACTION = 'Save version';
/** `?save=version` opens Save version's dialog on Home: the header's action is a link, so it needs no state of its own. */
export const SAVE_PARAM = 'save';
export const SAVE_VALUE = 'version';

export const HOME_LINE = LINE;
export const SAVE_READ_ONLY = 'Save version is for the venture’s writers. You can read this narrative, not change it.';
export const SETUP_TITLE = 'Start your investor narrative';
export const SETUP_LINE = 'Write the story once for one kind of investor. Each saved version is checked against your records.';
export const SETUP_READER = 'No narrative version is saved for this venture yet.';
export const NOT_RECORDED_REASON = 'This read carried no narrative versions, so nothing is shown in their place.';
export const VERSIONS_UNAVAILABLE = 'This is not a claim that none are saved.';
export const OLDER_NOT_CHECKED = 'The check is read for the newest version only';
export const SAVE_FAILED = 'The version was not saved. Your choices are kept; try again.';

/** The audiences the store takes, in its own words (`raiseCycle.ts` INVESTOR_TYPE_LABEL). */
export const AUDIENCES = Object.freeze([
  { value: 'angel', label: 'Angel' },
  { value: 'pre_seed_fund', label: 'Pre-seed fund' },
  { value: 'seed_fund', label: 'Seed fund' },
  { value: 'series_a_fund', label: 'Series A fund' },
  { value: 'strategic', label: 'Strategic' },
  { value: 'grant', label: 'Grant' },
  { value: 'other', label: 'Other' },
]);

/** The store's key for an audience as the part words it ('Seed fund' → 'seed_fund'); '' when it is not one. */
export function audienceKey(label) {
  const hit = AUDIENCES.find((a) => a.label === String(label ?? '').trim());
  return hit ? hit.value : '';
}
export const audienceLabel = (key) => AUDIENCES.find((a) => a.value === key)?.label || '';

const partOf = (data) => data?.parts?.narrative ?? null;

/**
 * What Home draws, in one of #5129's states:
 *   loading       the module read has not answered (no data yet);
 *   not_recorded  the read answered with no narrative part at all;
 *   unavailable   the part could not be read (`state: 'unreadable'`);
 *   empty         read, and no version is saved (first use, #5129's None);
 *   ready         read, with at least one saved version.
 * A refused read never reaches here: the module page draws the Worker's sentence first.
 */
export function homeView(data) {
  if (data == null) return { state: 'loading', part: null, standing: narrativeStanding(null) };
  const part = partOf(data);
  const standing = narrativeStanding(part?.capabilities);
  if (!part || typeof part !== 'object') return { state: 'not_recorded', part: null, standing };
  if (part.state === 'unreadable') return { state: 'unavailable', part, standing, reason: typeof part.reason === 'string' ? part.reason : null };
  if (part.state !== 'ok' || !Array.isArray(part.versions)) return { state: 'not_recorded', part: null, standing };
  return { state: part.versions.length ? 'ready' : 'empty', part, standing };
}

/** Home's address with Save version's dialog open, the venture kept. */
export function saveHref(search = '') {
  const q = tabSearch(search, null, false);
  return `${HOME_PATH}${q ? `${q}&` : '?'}${SAVE_PARAM}=${SAVE_VALUE}`;
}
export const isSaveOpen = (search = '') => new URLSearchParams(String(search || '').replace(/^\?/, '')).get(SAVE_PARAM) === SAVE_VALUE;
/** Home's address with the dialog closed. */
export const closeSaveHref = (search = '') => `${HOME_PATH}${tabSearch(search, null, false)}`;

const noop = () => {};

/**
 * The header's one primary (RA-14's row: Save version), from the part's capability map and nothing else:
 *   - none while the read is loading, failed or carried no part, and none on first use, where the
 *     set-up card's New version is the page's one primary (D5076);
 *   - a writer (`edit`): Save version, opening its dialog on Home;
 *   - anyone else: Save version drawn disabled, with SAVE_READ_ONLY on the page as its reason.
 * `projectId` builds the venture query when no `search` is handed (the cycle's `homes` context has only the id).
 */
export function saveVersionAction(data, { search = null, projectId = null } = {}) {
  const view = homeView(data);
  if (view.state !== 'ready') return null;
  if (!view.standing.can('edit')) return { label: SAVE_ACTION, onClick: noop, disabled: true, reason: SAVE_READ_ONLY };
  return { label: SAVE_ACTION, href: saveHref(search ?? ventureSearch(projectId)) };
}

/** The newest saved version in the part (the list is newest first, but the number decides). */
export function newestVersion(part) {
  const list = Array.isArray(part?.versions) ? part.versions : [];
  return list.reduce((best, v) => (Number(v?.version) > Number(best?.version ?? 0) ? v : best), null);
}

/** Save version's starting choices: the newest version, and its audience when the part names one the store takes. */
export function saveDraft(part) {
  const newest = newestVersion(part);
  return { from: newest ? Number(newest.version) : null, audience: audienceKey(newest?.audience) };
}

/** What a draft is missing before it can be saved, or null. */
export function saveProblem(draft) {
  if (!Number.isInteger(draft?.from) || draft.from < 1) return 'No saved version to save from.';
  if (!audienceLabel(draft?.audience)) return 'Choose who this version is for.';
  return null;
}

/** The write: the store's own body for a version started from another (`saveNarrativeVersion`). */
export function saveBody(draft) {
  return { investor_type: draft.audience, start_from: 'version', based_on_version: draft.from };
}

/** The dialog's sentence: what is created, and that the version it copies does not change. */
export function saveLine(draft, part) {
  const next = Number(newestVersion(part)?.version ?? 0) + 1;
  const who = audienceLabel(draft?.audience);
  if (!Number.isInteger(draft?.from)) return `Saves v${next}.`;
  return `Saves v${next}${who ? ` for ${who}` : ''}, a copy of v${draft.from} as it stands now, and checks it against your records. Nothing in v${draft.from} changes.`;
}

/**
 * Save version's dialog, as a reducer, so "one save per press" and "a refused save keeps the draft" are
 * rules, not timing:
 *   press    starts a save only from idle, refused or failed with a complete draft; while saving it is ignored;
 *   edit     changes the draft, never while saving;
 *   refused  the Worker said no (4xx): the draft is kept as it was, with the Worker's sentence;
 *   failed   the save did not reach an answer: the draft is kept, with SAVE_FAILED;
 *   saved    the Worker answered with the new version.
 */
export function saveStart(part) {
  return { draft: saveDraft(part), status: 'idle', error: '', saved: null };
}

export function saveReducer(state, action) {
  switch (action?.type) {
    case 'press':
      if (state.status === 'saving' || state.status === 'saved') return state;
      if (saveProblem(state.draft)) return { ...state, status: 'idle', error: saveProblem(state.draft) };
      return { ...state, status: 'saving', error: '' };
    case 'edit':
      if (state.status === 'saving' || state.status === 'saved') return state;
      return { ...state, draft: { ...state.draft, ...action.patch }, error: state.status === 'idle' ? '' : state.error };
    case 'refused':
      return { ...state, status: 'refused', error: action.message || SAVE_FAILED };
    case 'failed':
      return { ...state, status: 'failed', error: action.message || SAVE_FAILED };
    case 'saved':
      return { ...state, status: 'saved', error: '', saved: action.version ?? null };
    default:
      return state;
  }
}

/** A refusal is the Worker's answer (any 4xx); anything else is a save that did not reach one. */
export const isSaveRefusal = (error) => Number(error?.status) >= 400 && Number(error?.status) < 500;

/**
 * `fn` run at most once at a time: a call while one is in flight gets that call's promise and starts
 * nothing. The guard is the page's second lock under the reducer's, for two presses in one frame.
 */
export function singleFlight(fn) {
  let pending = null;
  return (...args) => {
    if (pending) return pending;
    pending = Promise.resolve().then(() => fn(...args)).finally(() => { pending = null; });
    return pending;
  };
}

/**
 * RA-17's state line, from the part only, each a #5129 state:
 *   Saved      the newest version, its audience and the day it was saved;
 *   Check      the newest version's mismatches once compared; Not recorded while nothing was compared;
 *   Claims     sections with a Mismatch from the claim tally; Unavailable when the tally failed;
 *   Pitch      whether a card of the current deck reads a version; Not applicable with no deck.
 */
export function stateLine(part) {
  const newest = newestVersion(part);
  if (!newest) return [];
  const out = [{ key: 'saved', kind: 'value', tone: 'ready', label: `v${newest.version} · ${newest.audience || NOT_RECORDED} · saved ${newest.saved || NOT_RECORDED}` }];
  const check = part?.newest && Number(part.newest.version) === Number(newest.version) ? part.newest : null;
  const mismatches = Array.isArray(check?.mismatches) ? check.mismatches.length : 0;
  if (!check || !check.compared) out.push({ key: 'check', kind: 'not_recorded', label: `Check · Not recorded`, reason: `Nothing compared yet in v${newest.version}` });
  else if (mismatches) out.push({ key: 'check', kind: 'value', tone: 'attention', label: `${mismatches} ${mismatches === 1 ? 'mismatch' : 'mismatches'} in v${newest.version}` });
  else out.push({ key: 'check', kind: 'value', tone: 'ready', label: `Checked · no mismatch in v${newest.version}` });
  const claims = part?.claims;
  if (claims?.state === 'unreadable') out.push({ key: 'claims', kind: 'unavailable', label: 'Claims · Unavailable' });
  else if (claims?.state === 'ok' && Array.isArray(claims.mismatch_sections) && claims.mismatch_sections.length) {
    const n = claims.mismatch_sections.length;
    out.push({ key: 'claims', kind: 'value', tone: 'attention', label: `${n} ${n === 1 ? 'section needs' : 'sections need'} attention` });
  }
  if (!part?.deck) out.push({ key: 'pitch', kind: 'not_applicable', label: 'Pitch · Not applicable', reason: 'No pitch deck yet' });
  else out.push({ key: 'pitch', kind: 'value', tone: part.deck.reads_narrative ? 'ready' : 'muted', label: part.deck.reads_narrative ? `Pitch deck v${part.deck.version} reads it` : `No card of Pitch deck v${part.deck.version} reads it` });
  return out;
}

/**
 * RA-17's Versions table: Version (the newest is Current), Saved, By, Based on, Used by and Consistency. The
 * part checks the newest version only, so an older version's Consistency is Not recorded with that reason,
 * never Ready and never blank.
 */
export function versionRows(part) {
  const list = (Array.isArray(part?.versions) ? part.versions : []).slice().sort((a, b) => Number(b.version) - Number(a.version));
  const newest = list[0];
  return list.map((v) => {
    const isNewest = v === newest;
    const check = isNewest && part?.newest && Number(part.newest.version) === Number(v.version) ? part.newest : null;
    const n = Array.isArray(check?.mismatches) ? check.mismatches.length : 0;
    const consistency = !isNewest ? { kind: 'not_recorded', label: NOT_RECORDED, reason: OLDER_NOT_CHECKED }
      : !check || !check.compared ? { kind: 'not_recorded', label: NOT_RECORDED, reason: 'Nothing compared yet' }
        : n ? { kind: 'value', tone: 'attention', label: `${n} ${n === 1 ? 'mismatch' : 'mismatches'}` }
          : { kind: 'value', tone: 'ready', label: 'No mismatch' };
    return {
      key: String(v.version),
      version: `v${v.version} · ${v.audience || NOT_RECORDED}`,
      current: isNewest,
      saved: v.saved || NOT_RECORDED,
      by: v.by || NOT_RECORDED,
      basedOn: v.based_on || NOT_RECORDED,
      usedBy: v.read_by?.cards?.length ? readByLine(v) : 'None',
      consistency,
    };
  });
}

/**
 * First use's set-up actions (RA-14: "the zero state's first action is the page's one primary", D5076): New
 * version first, then Positioning, which can be written before a version. A reader is given none.
 */
export function setupActions(standing, search = '') {
  if (!standing?.can?.('edit')) return [];
  const q = tabSearch(search, null, false);
  return [
    { key: 'new', label: 'New version', href: `${NEW_PATH}${q}`, primary: true },
    { key: 'positioning', label: 'Write your positioning', href: positioningHref(search) },
  ];
}
