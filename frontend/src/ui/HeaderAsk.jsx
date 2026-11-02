import React, { useEffect, useId, useSyncExternalStore } from 'react';
import { PageAsk } from './AskButton.jsx';

/**
 * D1443 part 5 (#3992) — the page header's Ask, on every page with a rail.
 *
 * ONE HELPER, ONE BUTTON A PAGE. The shared header pieces each mount this:
 * `ZoneActions` (the action row ~70 pages draw, through `ZoneToolbar` or
 * directly), `ZoneHeaderTools` and `WorkspaceShell` (the Investor, Advisor
 * and Operating Partner zone headers), `CycleOverview` (Validate, Build,
 * Grow and Raise) and the admin board frame. A page may stack two of them
 * (a zone header whose body draws a toolbar), so each mount claims a place
 * and only the first one claimed draws: there is never a second Ask on a
 * page.
 *
 * THE RAIL'S FALLBACK. A page whose header has no mount (a back-link stack, an
 * editor, a centred hero) still gets one: `WorkerRail` mounts a `fallback`
 * claim at the top of its column, and a fallback draws only while no header
 * mount is claimed. On a phone the column is hidden, so there D405's floating
 * button stays exactly where no header carries Ask.
 *
 * WHEN IT DRAWS. It is `PageAsk` (D1443): it draws only while the page's
 * rail serves Ask to this viewer (`useAskRail`, set by `WorkerRail`), so a
 * page on `NO_RAIL_ROUTES`, a page without a rail page key, a support session
 * and an Explorer get nothing, and nothing is decided twice. "N waiting" is
 * the member's open proposals on the rail's page (D1442); a count that could
 * not be read draws nothing, never "0 waiting".
 */
let claims = [];
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const snapshot = () => claims;

/**
 * Who draws: the first header mount, else the first fallback (the rail's own,
 * for a page whose header has no mount). Exported for tests and for
 * `WorkerRail`, whose D405 phone button stands down while a header carries Ask.
 */
export function headerAskWinner(list) {
  return (list.find((c) => !c.fallback) || list[0] || null)?.id ?? null;
}

/** The claims, in mount order, for tests. */
export const headerAskClaims = () => claims.map((c) => c.id);

/** Whether a page header (not the rail's fallback) carries Ask now. */
export function useHeaderCarriesAsk() {
  const list = useSyncExternalStore(subscribe, snapshot, snapshot);
  return list.some((c) => !c.fallback);
}

export default function HeaderAsk({ label, testId = 'header-ask', fallback = false }) {
  const id = useId();
  useEffect(() => {
    claims = [...claims, { id, fallback }];
    emit();
    return () => { claims = claims.filter((c) => c.id !== id); emit(); };
  }, [id, fallback]);
  const list = useSyncExternalStore(subscribe, snapshot, snapshot);
  if (headerAskWinner(list) !== id) return null;
  return <PageAsk label={label} testId={testId} />;
}
