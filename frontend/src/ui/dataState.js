/**
 * D5129 (#5129) — the platform's data states, as data. Pure: no React, so a
 * page's model and a plain `node --test` can import it.
 *
 * The Platform States canvas (design/incoming/Platform States Page.dc.html,
 * boards ST-00 and ST-13) settles one vocabulary for every redesigned surface:
 *
 *   SIX VALUE STATES — exactly one applies to a slot:
 *     value           the read succeeded and there is a figure (a measured 0 is a Value)
 *     none            the read succeeded and the list is genuinely empty
 *     not_recorded    the store was read and holds no value for this field
 *     not_applicable  the measure does not apply here
 *     unavailable     the source could not be read this time
 *     refused         the viewer may not read this (HTTP 403 / 404, D5079)
 *   THREE MODIFIERS — they sit beside a Value and never replace it:
 *     stale           the last good value, older than its store's threshold, always with an age
 *     partial         a summary built from several sources, at least one not read
 *     provisional     modelled or estimated, not on record
 *   and Loading, which is transient: a skeleton, never a word or a 0.
 *
 * THE WORD FOR A FAILED READ. The owner answered Question 2 with A on
 * 2026-11-10: the SCREEN says "Unavailable". `unreadable` stays the name in
 * code (every page's `state === 'unreadable'`, the `Unreadable` component),
 * so `normalizeState` reads both spellings as the one state.
 *
 * `stateFromRead` maps the Worker's OperationalRead (D4858,
 * cloudflare-worker/src/util/operationalRead.ts) to a state, so no page
 * decides it inline. The rule it keeps is the house rule: missing data reads
 * Not recorded, never 0; a failed read is never Not recorded, None or 0; and
 * nothing is made up to fill a gap.
 */
import { RAISE_REFUSED_STATUSES } from '../lib/raiseErrors.js';
import { parseStamp } from './parseStamp.js';

export const VALUE_STATES = Object.freeze(['value', 'none', 'not_recorded', 'not_applicable', 'unavailable', 'refused']);
export const MODIFIERS = Object.freeze(['stale', 'partial', 'provisional']);

/** The exact word each state and modifier shows on screen (ST-00). */
export const STATE_WORDS = Object.freeze({
  value: 'Value',
  none: 'None',
  not_recorded: 'Not recorded',
  not_applicable: 'Not applicable',
  unavailable: 'Unavailable',
  refused: 'Refused',
  stale: 'Stale',
  partial: 'Partial',
  provisional: 'Modelled',
  loading: 'Loading',
});

/** What Retry-less states say when a page hands no sentence of its own. */
export const UNAVAILABLE_REASON = 'This source could not be read.';
export const UNAVAILABLE_CLAIM = 'This is not a claim that none exist.';
export const REFUSED_CLAIM = 'The read was refused. That is not a claim that nothing is recorded.';
export const PARTIAL_REASON = 'Part of this source could not be read, so the figures are not the whole answer.';

const ALIASES = Object.freeze({
  unreadable: 'unavailable',
  unrecorded: 'not_recorded',
  'not recorded': 'not_recorded',
  'not-recorded': 'not_recorded',
  na: 'not_applicable',
  'not-applicable': 'not_applicable',
  forbidden: 'refused',
  not_found: 'refused',
  empty: 'none',
  modelled: 'provisional',
});

/** One state name from any spelling a page already uses; `null` when it is not one. */
export function normalizeState(state) {
  if (state == null) return null;
  const s = String(state).trim().toLowerCase();
  if (VALUE_STATES.includes(s) || MODIFIERS.includes(s) || s === 'loading') return s;
  return ALIASES[s] ?? null;
}

/** Whether an error is a refusal (403 / 404, D5079) rather than a failed read. */
export function isRefusal(error) {
  return RAISE_REFUSED_STATUSES.includes(Number(error?.status));
}

const READ_STATUSES = new Set(['ready', 'partial', 'unavailable']);

/** Path segments `pick` never follows: they lead to a prototype, not to data. */
const UNSAFE_PATH_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function pick(data, field) {
  if (field == null || field === '') return data;
  if (typeof field === 'function') return field(data);
  return String(field).split('.').reduce((cur, key) => (cur == null || UNSAFE_PATH_KEYS.has(key) ? undefined : cur[key]), data);
}

const absent = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

const MONTH_MS = 30.44 * 24 * 3600 * 1000;

/**
 * How old a last good value is, in words: "7 months old". `null` when the
 * time is not recorded — the caller then says "age not recorded", never a
 * guessed age.
 */
export function staleAge(lastGood, now = Date.now()) {
  const at = typeof lastGood === 'number' ? lastGood : parseStamp(lastGood);
  const nowMs = typeof now === 'number' ? now : parseStamp(now);
  if (at == null || nowMs == null || !Number.isFinite(at) || !Number.isFinite(nowMs)) return null;
  const ms = Math.max(0, nowMs - at);
  const unit = (n, w) => `${n} ${w}${n === 1 ? '' : 's'} old`;
  const hours = Math.floor(ms / 3600000);
  if (hours < 48) return unit(Math.max(1, hours), 'hour');
  const days = Math.floor(ms / 86400000);
  if (days < 60) return unit(days, 'day');
  const months = Math.floor(ms / MONTH_MS);
  if (months < 24) return unit(months, 'month');
  return unit(Math.floor(months / 12), 'year');
}

/**
 * The state of one slot of an OperationalRead.
 *
 *   stateFromRead(read, 'committed_cents')
 *   stateFromRead(null, 'calls', { error })            // the request itself failed
 *   stateFromRead(read, 'nav', { lastGood, staleAfterMs })
 *
 * Returns `{ state, value, reason, partial, partialReason, stale, sourceTime }`:
 *   - an `error` with HTTP 403 / 404 is Refused, any other error Unavailable;
 *   - a read that is not in the contract's shape is Unavailable (it is not evidence either way);
 *   - `status: unavailable` is Unavailable, with the read's own reason;
 *   - `status: ready`: a present value is a Value (0 included), an empty list is None,
 *     a null or blank field is Not recorded;
 *   - `status: partial`: `partial` is true and the block draws one PartialBanner. A present
 *     value stays a Value; a null field or an empty list is Unavailable, because the part
 *     that could not be read may be exactly where it lives — Not recorded or None would be
 *     a claim the read cannot support;
 *   - `stale` is set only on a Value, and only when a last-good time is given and older
 *     than `staleAfterMs`; its `age` is null ("age not recorded") when the time will not parse;
 *   - `sourceTime` is 'not_recorded' when `source_updated_at` is null, never "now".
 */
export function stateFromRead(read, field, opts = {}) {
  const { error = null, lastGood = undefined, staleAfterMs = null, now = Date.now(), notRecordedReason = null } = opts;
  const base = { value: undefined, reason: null, partial: false, partialReason: null, stale: null, sourceTime: null };
  if (error) {
    return isRefusal(error)
      ? { ...base, state: 'refused', reason: REFUSED_CLAIM }
      : { ...base, state: 'unavailable', reason: UNAVAILABLE_REASON };
  }
  if (!read || typeof read !== 'object' || !READ_STATUSES.has(read.status)) {
    return { ...base, state: 'unavailable', reason: UNAVAILABLE_REASON };
  }
  const sourceTime = read.source_updated_at == null ? 'not_recorded' : 'recorded';
  const ownReason = typeof read.completeness_reason === 'string' && read.completeness_reason.trim() ? read.completeness_reason : null;
  if (read.status === 'unavailable' || read.data == null) {
    // `data: null` on a read that says it answered breaks the contract's one rule
    // (data is null exactly when the read is unavailable), so it is not a record of nothing.
    return { ...base, sourceTime, state: 'unavailable', reason: ownReason || UNAVAILABLE_REASON };
  }
  const partial = read.status === 'partial';
  const partialReason = partial ? ownReason || PARTIAL_REASON : null;
  const value = pick(read.data, field);
  const out = { ...base, sourceTime, partial, partialReason, value };
  if (absent(value)) {
    return partial
      ? { ...out, value: undefined, state: 'unavailable', reason: partialReason }
      : { ...out, value: undefined, state: 'not_recorded', reason: notRecordedReason };
  }
  if (Array.isArray(value) && value.length === 0) {
    return partial
      ? { ...out, state: 'unavailable', reason: partialReason }
      : { ...out, state: 'none' };
  }
  let stale = null;
  if (lastGood !== undefined && lastGood !== null && Number.isFinite(Number(staleAfterMs))) {
    const at = typeof lastGood === 'number' ? lastGood : parseStamp(lastGood);
    const nowMs = typeof now === 'number' ? now : parseStamp(now);
    if (at == null || nowMs == null) stale = { age: null, lastGood };
    else if (nowMs - at > Number(staleAfterMs)) stale = { age: staleAge(at, nowMs), lastGood };
  }
  return { ...out, state: 'value', stale };
}

/** The Partial banner's counts from a list of `{ name, state }` sources. */
export function partialCounts(sources = []) {
  const list = Array.isArray(sources) ? sources : [];
  const norm = list.map((s) => ({ name: s?.name, state: normalizeState(s?.state) }));
  const unavailable = norm.filter((s) => s.state === 'unavailable');
  const refused = norm.filter((s) => s.state === 'refused');
  return { unavailable, refused, missing: unavailable.length + refused.length };
}
