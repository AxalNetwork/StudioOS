/**
 * D906 (#2454) — the Investor narrative tool's addresses, words and
 * derivations, kept pure so the tests read them without a browser.
 *
 * WHERE THE TOOL LIVES. `/raise/investor-narrative` is CycleRoute's module
 * page, and every `/raise/investor-narrative/<word>` is its record route
 * (`/raise/:slug/:id`, `cyclePaths.js` RECORD_ID). A version is a record whose
 * id is its number, so the tool's tabs are words CycleRoute reads as tabs, not
 * records (`isNarrativeTab`). No route is added: the module page is Home, a
 * numbered address is still a version, and `/new` is still New version.
 *
 * WHAT IS READ, AND FROM WHERE. Every figure comes from a read on `main`:
 *   - `GET /api/cycles/raise/modules/investor-narrative` → Home (the card, the
 *     versions table, From Mercury), as CycleRoute draws it today;
 *   - `GET …/modules/investor-narrative/form-options` → the saved versions,
 *     for the version picker and the compare;
 *   - `GET …/modules/investor-narrative/records/:version` → one version's
 *     narrative rows and its consistency check, as the Worker states them.
 * Nothing is a sample. A read that fails says so where its figure would be.
 *
 * Story (D910, #2694) reads the narrative's own stores, D908's sections and
 * bound figures, and PITCH's source registry; its derivations are in
 * `storyModel.js`.
 *
 * WHAT IS NOT DRAWN YET, AND WHO DRAWS IT. Claims' states, stored
 * positioning, the deck side of the check and objections are slot tasks on
 * #2454 (D906 §6); this file grows the derivation when its read lands.
 */

import { NOT_RECORDED } from '../../../lib/absence.js';

export const SLUG = 'investor-narrative';
export const HOME_PATH = `/raise/${SLUG}`;
export const NEW_PATH = `${HOME_PATH}/new`;
export const POSITIONING_TODAY = '/raise/pitch/positioning';

export const TITLE = 'Investor narrative';
// The canvas's line ends "with every claim backed."; nothing backs a claim
// until #2430's claim check lands, so the line stops before it.
export const LINE = 'The story you tell investors, one version per kind of investor.';

/**
 * The canvas's six tabs, less Claims, which waits for #2430's claim check.
 * `path` is the tab's segment under HOME_PATH; Home is the module page itself.
 */
export const TABS = [
  { id: 'home', label: 'Home', path: '' },
  { id: 'story', label: 'Story', path: '/story' },
  { id: 'positioning', label: 'Positioning', path: '/positioning' },
  { id: 'check', label: 'Check', path: '/check' },
  { id: 'versions', label: 'Versions', path: '/versions' },
];
const TAB_WORDS = new Set(TABS.filter((t) => t.path).map((t) => t.id));

/** True when CycleRoute's record id under this module is a tab, not a version. */
export const isNarrativeTab = (slug, id) => slug === SLUG && TAB_WORDS.has(String(id ?? ''));

/**
 * The query a tab keeps: the venture and, when `withVersion`, the chosen
 * version (`version` when given, else the address's own). Nothing else.
 */
export function tabSearch(search = '', version = null, withVersion = true) {
  const from = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const out = new URLSearchParams();
  const project = from.get('project_id') || from.get('project');
  if (project) out.set('project_id', project);
  const v = version ?? from.get('version');
  if (withVersion && v != null && /^\d+$/.test(String(v))) out.set('version', String(v));
  const s = out.toString();
  return s ? `?${s}` : '';
}

export const tabHref = (tab, search = '', version = null) => `${HOME_PATH}${tab.path}${tabSearch(search, version)}`;

/** A version's own page (its record), the venture kept. */
export const versionHref = (version, search = '') => `${HOME_PATH}/${encodeURIComponent(String(version))}${tabSearch(search, null, false)}`;

/** The saved versions from form-options, newest first; an unreadable list is []. */
export function versionsOf(options) {
  const list = Array.isArray(options?.versions) ? options.versions : [];
  return list
    .map((v) => ({ value: String(v?.value ?? ''), label: String(v?.label ?? '').trim() }))
    .filter((v) => /^\d+$/.test(v.value) && v.label)
    .sort((a, b) => Number(b.value) - Number(a.value));
}

/** The version the address names, when it is saved; else the newest; else null. */
export function chosenVersion(versions, wanted) {
  if (!versions.length) return null;
  const hit = versions.find((v) => v.value === String(wanted ?? ''));
  return (hit || versions[0]).value;
}

/** The version before `version` in the list (for the compare), or null. */
export function previousVersion(versions, version) {
  const i = versions.findIndex((v) => v.value === String(version));
  return i >= 0 && i + 1 < versions.length ? versions[i + 1].value : null;
}

/** One section of a record read, main or side, by its key. */
export function sectionOf(record, key) {
  const all = [...(Array.isArray(record?.main) ? record.main : []), ...(Array.isArray(record?.side) ? record.side : [])];
  return all.find((s) => s?.key === key) || null;
}

/**
 * The version's words, as the record's "The narrative" section states them:
 * `{ label, text }`, with `text` null when nothing is recorded.
 */
export function storyRows(record) {
  const rows = Array.isArray(sectionOf(record, 'narrative')?.rows) ? sectionOf(record, 'narrative').rows : [];
  return rows
    .map((r) => ({ label: String(r?.a ?? '').trim(), text: String(r?.b ?? '').trim() || null }))
    .filter((r) => r.label);
}

const RESULTS = { Mismatch: 'bad', OK: 'ok', 'Not compared': 'grey' };

/**
 * The record's consistency check, as the Worker states it: one row per figure
 * with the Worker's own detail and result word. Nothing is re-derived here.
 */
export function checkRows(record) {
  const rows = Array.isArray(sectionOf(record, 'consistency')?.rows) ? sectionOf(record, 'consistency').rows : [];
  return rows
    .map((r) => {
      const result = String(r?.c ?? '').trim();
      return { figure: String(r?.a ?? '').trim(), detail: String(r?.b ?? '').trim() || null, result: result || NOT_RECORDED, tone: RESULTS[result] || 'grey' };
    })
    .filter((r) => r.figure);
}

/** The line over the check: counts by result, or "Nothing compared yet." */
export function checkSummary(rows) {
  if (!rows.length) return null;
  const n = (word) => rows.filter((r) => r.result === word).length;
  const mismatch = n('Mismatch');
  const ok = n('OK');
  const none = n('Not compared');
  if (mismatch + ok === 0) return 'Nothing compared yet.';
  return [
    `${mismatch + ok} compared`,
    mismatch ? `${mismatch} ${mismatch === 1 ? 'mismatch' : 'mismatches'}` : 'no mismatch',
    none ? `${none} not compared` : null,
  ].filter(Boolean).join(' · ');
}

/**
 * Two versions side by side, section by section: every label either names,
 * each side's text (null when not recorded), and whether they differ.
 */
export function compareRows(a, b) {
  const left = storyRows(a);
  const right = storyRows(b);
  const labels = [...new Set([...left, ...right].map((r) => r.label))];
  return labels.map((label) => {
    const l = left.find((r) => r.label === label)?.text ?? null;
    const r = right.find((x) => x.label === label)?.text ?? null;
    return { label, a: l, b: r, changed: l !== r };
  });
}

/** The positioning page today, the venture kept, until part 5 moves it here. */
export const positioningHref = (search = '') => `${POSITIONING_TODAY}${tabSearch(search, null, false)}`;

export const NO_VERSION = 'No narrative yet. Start a version for one kind of investor.';
export const POSITIONING_WAITS = 'Positioning moves here once it is stored. Until then it is written in the Pitch deck builder, and nothing it writes is kept.';
// What the Worker's check reads today (raiseCycle.ts checkInputs): the figures
// the version states, and the venture profile's MRR, paying customers and
// funding needed. Part 1 (#2691) narrows it to what the version states.
export const CHECK_RUNS = 'The check runs each time a version is saved. It compares the figures the narrative states, and the MRR, paying customers and funding needed on the venture’s profile, with your stored metrics. The pitch deck’s own cards are not checked yet.';
export const FIX_NEWEST_ONLY = 'Eadwyn phrases a fix for the first mismatch in the newest version only.';

export { NOT_RECORDED };
