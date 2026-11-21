import { useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  PIPELINE_FIT_VALUES, PIPELINE_NEXT_VALUES, PIPELINE_PATH_VALUES, PIPELINE_SORT_VALUES, PIPELINE_SOURCE_VALUES, PIPELINE_STAGE_VALUES,
} from './capRelPipelineFilters.js';

/**
 * D5377 (#5377): the filters, sort and page of Match, Activity and
 * Commitments, and the Pipeline board's Passed column, live in the address,
 * so a refresh, Back, Forward or a shared link lands on the same read
 * (D5073 did this for the pipeline's open investor and view only).
 *
 * Each tab's spec names its own keys, each key's default and the values it
 * allows. A value the spec does not allow reads as the default and is never
 * sent to the Worker; a default value is never written into the address.
 * Every key not in the spec (`project_id`, `view`, `investor` on Pipeline,
 * `moved`) is kept as it is. Tab links keep only `project_id`
 * (`tabSearch`), so one tab's filters never ride onto another tab's link.
 */

const text = (max) => ({ def: '', read: (v) => String(v ?? '').trim().slice(0, max).trim() });
const oneOf = (values) => ({ def: '', read: (v) => (values.includes(v) ? v : '') });
const pattern = (re) => ({ def: '', read: (v) => (re.test(String(v ?? '')) ? v : '') });
const flag = { def: false, read: (v) => v === '1', write: (v) => (v ? '1' : null) };
const count = (min, max, step = 1) => ({
  def: min,
  read: (v) => {
    if (!/^[1-9]\d{0,6}$/.test(String(v ?? ''))) return min;
    const n = Number(v);
    return n >= min && n <= max && (n - min) % step === 0 ? n : min;
  },
});

/* The sets below are the Worker's own: researchFundDirectory.ts (SIZE_BANDS,
 * SORTS, the country and focus shapes), capRelTabs.ts (ACTIVITY_KINDS) and
 * capRelReads.ts (COMMIT_STATUSES). */
export const MATCH_SIZE_BANDS = Object.freeze(['lt25', '25-50', '50-100', '100-250', '250-500', '500+']);
export const MATCH_FITS = Object.freeze(['fits', 'unclear', 'outside']);
export const MATCH_SORT_VALUES = Object.freeze(['name', '-size', '-vintage']);
export const ACTIVITY_KIND_VALUES = Object.freeze(['added', 'edited', 'steps', 'feedback', 'round', 'eadwyn']);
export const COMMIT_STATUS_VALUES = Object.freeze(['received', 'signed', 'wired', 'confirmed', 'pending', 'indicated', 'soft', 'not_recorded']);

/** Match (CRL7). `offset` steps by the page of 25; `sort` defaults to name. */
export const MATCH_FILTERS = Object.freeze({
  q: text(100),
  hq_country: pattern(/^[A-Z]{2}$/),
  focus: pattern(/^[a-z0-9][a-z0-9-]{0,79}$/),
  size_band: oneOf(MATCH_SIZE_BANDS),
  fit: oneOf(MATCH_FITS),
  warm: flag,
  sort: { def: 'name', read: (v) => (MATCH_SORT_VALUES.includes(v) ? v : 'name') },
  offset: count(0, 100_000, 25),
});

/** Activity (CRL12). `investor` is a prospect id; `page` starts at 1. */
export const ACTIVITY_FILTERS = Object.freeze({
  q: text(100),
  kind: oneOf(ACTIVITY_KIND_VALUES),
  investor: pattern(/^[1-9]\d{0,9}$/),
  page: count(1, 10_000),
});

/** Commitments' Every commitment (CRL9): filtered on the loaded read, not sent. */
export const COMMITMENT_FILTERS = Object.freeze({
  q: text(100),
  status: oneOf(COMMIT_STATUS_VALUES),
});

/**
 * Pipeline (CRL2, CRL3): whether the board's Passed column is open, and
 * D6077's search, filters and sort (`sort` defaults to Next step due), all
 * applied to the loaded read (`capRelPipelineFilters.js`), never sent.
 */
export const PIPELINE_FILTERS = Object.freeze({
  passed: flag,
  q: text(100),
  stage: oneOf(PIPELINE_STAGE_VALUES),
  fit: oneOf(PIPELINE_FIT_VALUES),
  path: oneOf(PIPELINE_PATH_VALUES),
  source: oneOf(PIPELINE_SOURCE_VALUES),
  next: oneOf(PIPELINE_NEXT_VALUES),
  sort: { def: 'due', read: (v) => (PIPELINE_SORT_VALUES.includes(v) ? v : 'due') },
});

/** Which key a filter change resets to its default (the page), per spec. */
const PAGE_KEY = new Map([[MATCH_FILTERS, 'offset'], [ACTIVITY_FILTERS, 'page']]);

const params = (search) => (search instanceof URLSearchParams ? search : new URLSearchParams(String(search || '').replace(/^\?/, '')));

/** The tab's filters as read from the address; anything not allowed is its default. */
export function readFilters(spec, search) {
  const p = params(search);
  const out = {};
  for (const [k, rule] of Object.entries(spec)) out[k] = p.has(k) ? rule.read(p.get(k)) : rule.def;
  return out;
}

/** A new address: every other key kept, each of the spec's keys set, a default left out. */
export function writeFilters(spec, search, values) {
  const n = new URLSearchParams(params(search));
  for (const [k, rule] of Object.entries(spec)) {
    const v = rule.read(rule.write ? rule.write(values[k]) : values[k] == null ? '' : String(values[k]));
    if (v === rule.def) n.delete(k);
    else n.set(k, rule.write ? rule.write(v) : String(v));
  }
  return n;
}

/**
 * The address after one change: a change to anything but the page itself
 * sends the page back to the first.
 */
export function changeFilters(spec, search, patch) {
  const page = PAGE_KEY.get(spec);
  const cur = readFilters(spec, search);
  const next = { ...cur, ...patch };
  if (page && !(page in patch) && Object.keys(patch).some((k) => patch[k] !== cur[k])) next[page] = spec[page].def;
  return writeFilters(spec, search, next);
}

/** The address with none of the spec's keys: a venture switch (D5073). */
export function clearFilters(spec, search) {
  const n = new URLSearchParams(params(search));
  for (const k of Object.keys(spec)) n.delete(k);
  return n;
}

/** One string per distinct filter set, so an equal read is never re-sent. */
export const filtersKey = (spec, search) => writeFilters(spec, '', readFilters(spec, search)).toString();

/**
 * The tab's filters from the address, and `set(patch, { replace })`.
 * A filter or page change pushes a history entry, so Back restores the one
 * before; a search keystroke passes `replace` and pushes none. A change of
 * venture clears them, and the frame that sees the new venture first already
 * reads the defaults, so no read is ever sent with the last venture's filters.
 */
export function useTabFilters(spec, projectId) {
  const [search, setSearch] = useSearchParams();
  // The venture the address's filters belong to. Until the address is cleared
  // after a switch, the filters read as the defaults.
  const owner = useRef(projectId);
  const inAddress = filtersKey(spec, search);
  const key = owner.current === projectId ? inAddress : '';
  const filters = useMemo(() => readFilters(spec, key), [spec, key]);
  // Re-checked on every address change: another update in the same frame
  // (Pipeline's own, for its open investor) may be written over this one.
  const address = search.toString();
  useEffect(() => {
    if (owner.current === projectId) return;
    if (!Object.keys(spec).some((k) => search.has(k))) { owner.current = projectId; return; }
    setSearch((p) => clearFilters(spec, p), { replace: true });
  }, [projectId, spec, address]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch, { replace = false } = {}) => setSearch((p) => changeFilters(spec, p, patch), { replace });
  return [filters, set];
}
