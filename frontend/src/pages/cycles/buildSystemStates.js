/**
 * D4846 part 2 (#6032; Build v2 boards BD14 A, B and C, BD14m) — Build's system
 * states as data. Pure: no React, so `node --test` reads it.
 *
 * BD14's audit finding (BU-0, P2): "All missing states carry the same visual
 * weight." Not recorded was a dashed pill, Not expected yet plain text,
 * Unavailable an amber pill, Blocked a red pill, Read only an amber bar. BD14
 * gives each of six states one word, one symbol and its own weight:
 *
 *   not_recorded   the source was read and holds no value          → D5129's Not recorded chip (dotted)
 *   not_expected   nothing is due yet: not a gap, lighter weight   → D5129's Not applicable shape, "Not expected yet"
 *   unavailable    the read failed; nothing is known either way    → D5129's Unavailable chip (dashed, "!")
 *   waiting        a source is still working on it (BD14's "Processing") → violet, ◷
 *   attention      a known blocker: Missing, Blocked, Needs attention → amber, ▲
 *   read_only      this viewer can read but not change it          → grey, lock
 *
 * The first three ARE the platform's states (D5129) and draw through its
 * `StateChip`; the screen word for a failed read is "Unavailable" (the owner's
 * answer on #5129, 2026-11-10), whatever word the Worker sent. The other three
 * are Build's own and draw in the same chip shape (`BuildStateTag.jsx`).
 *
 * THE RULE THIS FILE KEEPS: no state turns an unknown into a negative. A
 * missing value is Not recorded, never Needs attention; a failed read is
 * Unavailable, never Not recorded, None or 0; a word this file does not know
 * is left as the Worker wrote it (`null` here), never guessed into a state.
 */
import { cardView, cellView } from './cycleModel.js';

export const BUILD_STATES = Object.freeze(['not_recorded', 'not_expected', 'unavailable', 'waiting', 'attention', 'read_only']);

/** BD14's word for each state, as the screen draws it when the Worker sent no word of its own. */
export const BUILD_STATE_WORDS = Object.freeze({
  not_recorded: 'Not recorded',
  not_expected: 'Not expected yet',
  unavailable: 'Unavailable',
  waiting: 'Waiting',
  attention: 'Needs attention',
  read_only: 'Read only',
});

/** The D5129 chip kind a state draws through; `null` for Build's own three. */
export const PLATFORM_KIND = Object.freeze({
  not_recorded: 'not_recorded',
  not_expected: 'not_applicable',
  unavailable: 'unavailable',
  waiting: null,
  attention: null,
  read_only: null,
});

/**
 * The states whose label is always BD14's word. A failed read says
 * "Unavailable" even when the Worker wrote "Unreadable" or "Could not be
 * read" (Q2 = A); Not recorded always says Not recorded. The others keep the
 * Worker's own words ("Blocked", "Missing", "Waiting for review") in the
 * state's shape.
 */
const FIXED_WORD = new Set(['not_recorded', 'unavailable']);

/** Exact words (lower case) the Worker's Build reads send, and the state each one is. */
const WORD_STATE = new Map([
  ['not recorded', 'not_recorded'],
  ['not expected yet', 'not_expected'],
  ['not required', 'not_expected'],
  ['unavailable', 'unavailable'],
  ['could not be read', 'unavailable'],
  ['unreadable', 'unavailable'],
  ['processing', 'waiting'],
  ['waiting', 'waiting'],
  ['pending', 'waiting'],
  ['needs attention', 'attention'],
  ['missing', 'attention'],
  ['blocked', 'attention'],
  ['read only', 'read_only'],
  ['read-only', 'read_only'],
]);

/** The state a word names, or `null` when it names none (it is then drawn as the Worker wrote it). */
export function stateOfWord(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (WORD_STATE.has(t)) return WORD_STATE.get(t);
  // "Waiting for review", "Waiting for decision": still waiting, in its own words.
  if (t.startsWith('waiting for ')) return 'waiting';
  return null;
}

/**
 * One record cell as a Build state: `{ state, label }`, or `null` when the
 * cell is a value (a figure, a date, a name, "Done") and draws as before.
 * An empty or null cell is Not recorded (`cellView`'s own rule), never a
 * negative.
 */
export function cellState(cell) {
  const v = cellView(cell);
  if (v.nr) return { state: 'not_recorded', label: BUILD_STATE_WORDS.not_recorded };
  // A cell of several links is a value however its text reads.
  if (v.links) return null;
  const state = stateOfWord(v.text);
  if (!state) return null;
  return { state, label: FIXED_WORD.has(state) ? BUILD_STATE_WORDS[state] : v.text };
}

/** A phone row's pill (`{ label }`) as a Build state, by the same words; `null` leaves the pill as it is. */
export function pillState(pill) {
  if (!pill || typeof pill.label !== 'string') return null;
  return cellState(pill.label);
}

/**
 * A phone row with its pill drawn as a Build state where the pill's word is
 * one (BD14m: phone parity). The row moves the state into `state`, so the
 * page draws the same chip the desktop table draws, and drops `pill`.
 */
export function withRowState(row) {
  const st = pillState(row?.pill);
  if (!st) return row;
  const { pill: _pill, ...rest } = row;
  return { ...rest, state: st };
}

/**
 * The overview's module reads, counted for BD14's one notice ("5 of 6
 * modules read"). A card still loading counts neither way. A card the page
 * could not read (`cardView` → unreadable, including a state the page does
 * not know) is not read; every other card — empty, Not recorded, plan-locked
 * — was read. `show` is true only when at least one read failed.
 */
export function moduleReads(cards) {
  const list = (Array.isArray(cards) ? cards : []).filter((c) => c && typeof c === 'object');
  const failed = list
    .filter((c) => cardView(c).state === 'unreadable')
    .map((c) => ({ slug: c.slug ?? null, name: c.name || c.slug || 'A module' }));
  const total = list.length;
  const read = total - failed.length;
  return {
    total,
    read,
    failed,
    show: total > 0 && failed.length > 0,
    lead: `${read} of ${total} ${total === 1 ? 'module' : 'modules'} read`,
    rest: failed.length ? `${listNames(failed.map((f) => f.name))} could not be read.` : '',
  };
}

function listNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
