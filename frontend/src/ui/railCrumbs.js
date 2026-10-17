import { createContext, createElement, useCallback, useContext, useMemo, useState } from 'react';

/**
 * D698 — WHERE THE RAIL IS: "section › module › record" (AIRail canvas, its
 * crumbs row).
 *
 * A CONTEXT, NOT PROPS. About ninety pages mount the rail with a `workspace`
 * prop and nothing else. A page that knows more says so by mounting this
 * provider around its rail: `CycleRoute` passes the cycle's name and, on a
 * module route, the module's. A record view below it (#1658, D696) adds its
 * own title with `useSetRailCrumbs()({ record })`, and clears it with
 * `({ record: null })` when it leaves, without editing the rail or the route.
 *
 * Outside a provider `useRailCrumbs()` is null, and the rail's crumbs are its
 * `workspace` alone.
 */
const RailCrumbsContext = createContext(null);

const clean = (v) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || null;
};

export function RailCrumbsProvider({ section, module, children }) {
  const [record, setRecord] = useState(null);
  const set = useCallback((next) => { setRecord(clean(next?.record)); }, []);
  const value = useMemo(
    () => ({ crumbs: { section: clean(section), module: clean(module), record }, set }),
    [section, module, record, set],
  );
  return createElement(RailCrumbsContext.Provider, { value }, children);
}

/** `{ section, module, record }`, or null outside a provider. */
export function useRailCrumbs() {
  return useContext(RailCrumbsContext)?.crumbs || null;
}

const noop = () => {};

/**
 * The setter a record view calls with `{ record }`. Outside a provider it
 * does nothing, so a record view mounted elsewhere needs no guard.
 */
export function useSetRailCrumbs() {
  return useContext(RailCrumbsContext)?.set || noop;
}
