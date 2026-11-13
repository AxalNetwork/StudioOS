import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { crumbsOfKey, pageFor, setCurrentRail } from '../lib/railPages.js';

/**
 * D698 — WHERE THE RAIL IS: "section › module › record" (AIRail canvas, its
 * crumbs row). D768 (#2092, D720 §11) — and which page that is.
 *
 * A CONTEXT, NOT PROPS. About ninety pages mount the rail with a `workspace`
 * prop and nothing else, so none of them has to pass where it is:
 *
 *   - `RailPageProvider`, at the shell, reads the route's page key from the
 *     page map (`lib/railPages.js`, `pageFor`) and gives every rail below it
 *     its section and module.
 *   - A page that knows better still says so by mounting `RailCrumbsProvider`
 *     around its rail: `CycleRoute` passes the cycle's name and, on a module
 *     route, the module's. Its crumbs win; the page key stays the shell's.
 *   - A record view adds its title with `useSetRailCrumbs()({ record })`, and
 *     clears it with `({ record: null })` when it leaves. `ref: { type, id }`
 *     beside it names the record for the run (D765).
 *   - An open option (a fill band, an upload, a transcription, a draft) calls
 *     `useRailOption(key, label)`: while it is open the option is the last
 *     crumb and the run's `option`; when it closes the rail is the page's
 *     again.
 *
 * Outside every provider `useRailCrumbs()` is null, and the rail's crumbs are
 * its `workspace` alone.
 */
const RailCrumbsContext = createContext(null);
const RailPageContext = createContext(null);

const clean = (v) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || null;
};
const cleanRef = (ref) => (ref && clean(ref.type) && ref.id != null && String(ref.id).trim()
  ? { type: clean(ref.type), id: String(ref.id).trim() } : null);

/** The shell's provider: the route's page entry, the open option and the record. */
export function RailPageProvider({ role, children }) {
  const location = useLocation();
  const entry = useMemo(
    () => pageFor(location.pathname, role, { search: location.search, hash: location.hash }),
    [location.pathname, location.search, location.hash, role],
  );
  const [option, setOptionState] = useState(null);
  const [record, setRecordState] = useState({ title: null, ref: null });
  const setOption = useCallback((next) => setOptionState(next && clean(next.key) ? { key: clean(next.key), label: clean(next.label) } : null), []);
  const clearOption = useCallback((k) => setOptionState((o) => (o && o.key === k ? null : o)), []);
  const setRecord = useCallback((next) => setRecordState({ title: clean(next?.record), ref: cleanRef(next?.ref) }), []);
  const pageKey = entry?.key ?? null;
  // What a run started from this tab carries (`currentRail`, lib/railPages.js).
  useEffect(() => {
    setCurrentRail({ page: pageKey, option: option?.key ?? null, record: record.ref });
    return () => setCurrentRail(null);
  }, [pageKey, option, record.ref]);
  const page = useMemo(
    () => ({ page: pageKey, offCanvas: !!entry?.offCanvas, option, record, setOption, clearOption, setRecord }),
    [pageKey, entry, option, record, setOption, clearOption, setRecord],
  );
  const { section, module } = crumbsOfKey(pageKey);
  const crumbs = useMemo(
    () => (pageKey
      ? { crumbs: { section, module, record: option?.label ?? record.title }, set: setRecord }
      : null),
    [pageKey, section, module, option, record.title, setRecord],
  );
  return createElement(RailPageContext.Provider, { value: page },
    crumbs ? createElement(RailCrumbsContext.Provider, { value: crumbs }, children) : children);
}

export function RailCrumbsProvider({ section, module, children }) {
  const outer = useContext(RailPageContext);
  const [record, setRecord] = useState(null);
  const forward = outer?.setRecord;
  const set = useCallback((next) => {
    setRecord(clean(next?.record));
    forward?.(next);
  }, [forward]);
  const option = outer?.option ?? null;
  const value = useMemo(
    () => ({
      crumbs: { section: clean(section), module: clean(module), record: option?.label ?? record },
      set,
    }),
    [section, module, record, set, option],
  );
  return createElement(RailCrumbsContext.Provider, { value }, children);
}

/** `{ section, module, record }`, or null outside a provider. The page key is `useRailPage()`'s. */
export function useRailCrumbs() {
  return useContext(RailCrumbsContext)?.crumbs || null;
}

/** The rail page: `{ page, option, record, … }`, or null outside the shell's provider. */
export function useRailPage() {
  return useContext(RailPageContext);
}

const noop = () => {};

/**
 * The setter a record view calls with `{ record, ref? }`. Outside a provider
 * it does nothing, so a record view mounted elsewhere needs no guard.
 */
export function useSetRailCrumbs() {
  return useContext(RailCrumbsContext)?.set || noop;
}

/**
 * D768: a page names the option the member has open, `<verb>:<object>`
 * (`fill:pain_tag`, `transcribe:interview`), with the label the member sees.
 * A null key means none is open. Closing it, or leaving, gives the rail back
 * to the page; another option opened since is left alone.
 */
export function useRailOption(key, label) {
  const page = useContext(RailPageContext);
  const setOption = page?.setOption;
  const clearOption = page?.clearOption;
  const k = clean(key);
  const l = clean(label);
  useEffect(() => {
    if (!k || !setOption) return undefined;
    setOption({ key: k, label: l });
    return () => clearOption(k);
  }, [k, l, setOption, clearOption]);
}
