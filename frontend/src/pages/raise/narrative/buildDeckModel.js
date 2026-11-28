/**
 * D9104 (#9104, RAN-24 part 1) — "Build a deck from v[n]": the entry on Story's
 * Share menu and on each Versions row, and the confirm that reads the deck
 * outline (`POST /api/decks/narrative/outline`, D1516) before handing off to
 * Pitch deck studio. Pure, so the tests read it without a browser.
 *
 * WHAT IT READS. The outline binds `MAX(version)` of the saved narrative, so it
 * always reads the newest version: an older row offers the newest (◇, owner
 * pick A in D6067-p2). Opening the confirm runs nothing and holds nothing; the
 * build and its charge happen only in the studio (part 2).
 *
 * HOW THE ANSWER IS READ. `narrativeOutline` in `../pitch/deckV2Adapter.js`
 * never throws: it answers `{ available: true, value }` or, through `through`,
 * `{ available: false, unreadable: true, status, code }`. A 404 (a venture the
 * viewer cannot write) is turned into `{ available: false }` with no
 * `unreadable` ("Coming later" elsewhere): here it is the refused state, as is a
 * 403. Nothing here ever prints "Coming later", a zero price or an empty list.
 */
import { NOT_RECORDED } from '../../../lib/absence.js';
import { aiTokens } from '../pitch/newDeckModel.js';
import { asList, currentVersion } from '../pitch/pitchStudioModel.js';
import { versionHref } from './narrativeModel.js';

export const STUDIO_PATH = '/raise/pitch/new';
export const SAVE_FIRST = 'Build a deck from the narrative: Save a version first.';
export const READS = (v) => `v${v}’s words, figure-free. A sentence that names a figure is left out; figures come bound from your records.`;
export const NEWEST_ONLY = 'It always reads the newest saved version.';
export const PRICE_TAIL = 'held when you confirm in the studio, charged for what runs';
export const PRICE_LOADING = 'Reading the price…';
export const PRICE_NONE = 'The outline gave no price. The studio prices the build before anything runs.';
export const UNREADABLE_TITLE = 'Your investor narrative could not be read right now.';
export const UNREADABLE_LINE = 'The deck outline could not read the narrative, so Build a deck waits. No price is shown and nothing was charged.';
export const REFUSED_TITLE = 'Only the venture’s founders build a deck from the narrative.';
export const REFUSED_LINE = 'You cannot change this venture’s pitch deck, so nothing was read, run or charged.';
export const NO_VERSION_LINE = 'Save a version first.';
export const NO_CARDS_LINE = 'No card can be planned from your records yet, so there is nothing to build. Nothing was charged.';
export const OLDER_TAG = (newest) => `Builds from v${newest}, the newest, until older versions can be chosen`;
export const DECKS_UNREADABLE = 'Which deck version is current could not be read.';

/** The Worker's own sentence for a narrative store it could not read (`narrativeWords`), with no version. */
const STORE_UNREADABLE = /could not be read/i;

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** The newest saved version's number, from the versions list (newest first, `{ value }`), or null. */
export const newestOf = (versions) => num(Array.isArray(versions) && versions.length ? versions[0]?.value ?? versions[0]?.version : null);

/**
 * The Deck cell of one Versions row (RAN24a), or null for a viewer who cannot edit:
 *   build   the newest row: "Build a deck from v[n]" opens the confirm;
 *   older   any other row: the ◇ tag and "Open v[newest]", the newest version's page.
 */
export function deckEntry(version, newest, { readOnly = false, search = '' } = {}) {
  const n = num(newest);
  if (readOnly || n == null) return null;
  if (num(version) === n) return { kind: 'build', label: `Build a deck from v${n}` };
  return { kind: 'older', tag: OLDER_TAG(n), open: `Open v${n}`, href: versionHref(n, search) };
}

/** NoVersion's line (RAN24a, RAN26a), for an editor only. */
export const noVersionLine = (readOnly) => (readOnly ? null : SAVE_FIRST);

/**
 * Story's Share ▾ items. Only what is built is offered: Email intro and Investor update (RAN-23) and History (RAN-25)
 * are not on main, so they are not drawn. An admin keeps the plain Copy text button (no menu); a read-only member
 * sees neither.
 */
export function shareItems({ exportAs, newest, phone = false } = {}) {
  if (exportAs !== 'founder') return [];
  const n = num(newest);
  return [
    { id: 'export', label: phone ? 'Copy text' : 'Copy or export…' },
    ...(n == null ? [] : [{ id: 'build', label: phone ? `Build a deck from v${n}` : `Build a deck from v${n}…` }]),
  ];
}

/** Where Continue goes: New deck, with the venture and the narrative start (read by part 2). */
export const studioHref = (projectId) => `${STUDIO_PATH}?project_id=${encodeURIComponent(String(projectId))}&from=narrative`;

/**
 * The adapter's answer as the confirm's state:
 *   loading     no answer yet
 *   refused     a 403, or the 404 `through` turned into `{ available: false }`
 *   unreadable  any other failure, or a narrative store the outline could not read
 *   empty       no saved version (`narrative.version: null`) or no card to plan
 *   ready       the outline, with `warning` when part of the narrative could not be read
 */
export function outlineState(result) {
  if (result == null) return { kind: 'loading' };
  if (result.available === true) {
    const o = result.value || {};
    const version = num(o.narrative?.version);
    const reason = typeof o.narrative?.reason === 'string' && o.narrative.reason.trim() ? o.narrative.reason.trim() : null;
    if (version == null) {
      return reason && STORE_UNREADABLE.test(reason) ? { kind: 'unreadable' } : { kind: 'empty', why: 'no_version', line: NO_VERSION_LINE };
    }
    const cards = Array.isArray(o.cards) ? o.cards : [];
    if (!cards.length) return { kind: 'empty', why: 'no_cards', line: NO_CARDS_LINE, version };
    return { kind: 'ready', outline: o, version, warning: reason };
  }
  if (result.unreadable && result.status !== 403) return { kind: 'unreadable', status: result.status ?? null, code: result.code ?? null };
  return { kind: 'refused', status: result.status ?? 404 };
}

/** Continue is offered only on a ready outline. */
export const canContinue = (state) => state?.kind === 'ready';

/** The outline line: "11 cards planned · 1 left out: Closing line, Closing line not evidenced", or nothing left out. */
export function outlineLine(outline) {
  const cards = Array.isArray(outline?.cards) ? outline.cards.length : 0;
  const out = Array.isArray(outline?.left_out) ? outline.left_out : [];
  const planned = `${cards} ${cards === 1 ? 'card' : 'cards'} planned`;
  if (!out.length) return `${planned} · nothing left out`;
  return `${planned} · ${out.length} left out: ${out.map((l) => [l?.title, l?.line].filter(Boolean).join(', ') || NOT_RECORDED).join('; ')}`;
}

/** The price from the outline's quote, or null when it carries none (never $0). */
export function priceLine(outline) {
  const shown = aiTokens(outline?.quote?.hold_microusd);
  return shown ? `${shown} estimated · ${PRICE_TAIL}` : null;
}

/**
 * What the build saves, from the deck versions read (`GET /api/decks/by-project/:pid`): the next number, "not
 * current", and the version that stays current. `decks` is `{ status: 'ready', data }` or `{ status: 'error' }`.
 */
export function savesView(decks) {
  if (!decks || decks.status === 'loading') return { kind: 'loading', next: null };
  if (decks.status !== 'ready') return { kind: 'unreadable', next: null, line: `A new deck version, not current. ${DECKS_UNREADABLE}` };
  const list = asList(decks.data, 'versions', 'decks');
  const next = list.reduce((m, d) => Math.max(m, num(d?.version) ?? 0), 0) + 1;
  const current = list.length ? currentVersion(list) : null;
  const isCurrent = Boolean(current && (current.is_current || current.current));
  if (!isCurrent) return { kind: 'ready', next, current: null, line: `A new deck version, Pitch deck v${next}, not current. You have no current deck yet.` };
  return { kind: 'ready', next, current: num(current.version), line: `A new deck version, Pitch deck v${next}, not current. Pitch deck v${current.version} stays current.` };
}

/** The Read by sentence. */
export const readByChange = (next, version) => `Changes only once you make ${next ? `v${next}` : 'the new version'} current and its cards bind v${version}.`;

/** A save that landed after the page loaded: the outline reads another version than the one on screen. */
export function versionDrift(onScreen, read) {
  const a = num(onScreen);
  const b = num(read);
  if (a == null || b == null || a === b) return null;
  return b < a
    ? `The outline read v${b}, not v${a}. The newest saved version it could read is v${b}.`
    : `A version was saved after this page loaded: the outline read v${b}, not v${a}.`;
}

/** The version line under the title: "v5 · audience Seed fund · saved 2026-11-12 by Fay Founder · revision Not recorded". */
export function versionLine(version, row = null, revision = null) {
  const r = row || {};
  return `v${version} · audience ${r.audience || NOT_RECORDED} · saved ${r.saved || NOT_RECORDED} by ${r.by || NOT_RECORDED} · revision ${revision ?? NOT_RECORDED}`;
}
