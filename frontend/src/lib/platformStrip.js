/**
 * D4860 part 5 (#4860, finding 13) — the live state the HQ Platform strip
 * carries, from the reads the Platform overview makes.
 *
 * The strip is shell chrome (`components/HqSubNavStrip.jsx`), drawn on every
 * Platform console. Its states come from ONE rule: `stripStates` in
 * `pages/hq/platformOverviewModel.js`, which is the overview's `signals` and
 * `platformHealth` over the same three reads (the platform summary with the
 * Worker's detected incidents, the deployments registry, traffic by branch).
 * Nothing here judges a signal.
 *
 * Where the reads come from:
 *   · on the overview, PlatformPage publishes its own reads once all three
 *     have settled (`publishPlatformReads`), so the strip adds no request
 *     there and shows exactly what the page shows;
 *   · on any other Platform console the strip reads them itself, once per
 *     `STRIP_READ_TTL_MS`, shared by every console visited in that window.
 *     A read that fails is UNAVAILABLE, which the model turns into Unknown,
 *     never into Healthy.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { api } from './api';
import { reportError } from './log';
import { stripStates } from '../pages/hq/platformOverviewModel';
import { PLATFORM_HOME } from './hqStrips';

/** How long a reading stands before a console visit reads again. */
export const STRIP_READ_TTL_MS = 5 * 60 * 1000;

const UNAVAILABLE = Symbol('unavailable');
let snapshot = null;
let inflight = null;
const listeners = new Set();

function store(reads) {
  const at = reads.at;
  snapshot = {
    at,
    ...stripStates({ ...reads, now: at, observed: { summary: at, deps: at, traffic: at } }),
  };
  for (const l of listeners) l();
}

/**
 * PlatformPage hands over the reads it made, once none is still loading
 * (`null`). `UNAVAILABLE` is the page's own marker for a read that failed.
 */
export function publishPlatformReads({ data, deps, traffic, UNAVAILABLE: marker, at }) {
  if (data === null || deps === null || traffic === null) return;
  store({ data, deps, traffic, UNAVAILABLE: marker, at: at || new Date() });
}

/** Reads the three for the strip; one read at a time, however many consoles ask. */
export function readPlatformStrip() {
  if (!inflight) {
    inflight = Promise.all([
      api.hqPlatform().catch((e) => { reportError('hq-platform-strip', e); return UNAVAILABLE; }),
      api.deployments().catch((e) => { reportError('hq-platform-strip:deployments', e); return UNAVAILABLE; }),
      api.analyticsTrafficByBranch('', '').catch((e) => { reportError('hq-platform-strip:trafficByBranch', e); return UNAVAILABLE; }),
    ]).then(([data, deps, traffic]) => {
      store({ data, deps, traffic, UNAVAILABLE, at: new Date() });
    }).finally(() => { inflight = null; });
  }
  return inflight;
}

/** For tests: forget the reading. */
export function resetPlatformStrip() {
  snapshot = null;
  inflight = null;
  for (const l of listeners) l();
}

const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const current = () => snapshot;

/**
 * The strip's states, or null before anything was read. `enabled` is false
 * for the other HQ strips, which read nothing. On the overview it waits for
 * the page to publish rather than reading a second time.
 */
export function usePlatformStrip(enabled, pathname) {
  const snap = useSyncExternalStore(subscribe, current, current);
  const fresh = snap && Date.now() - snap.at.getTime() < STRIP_READ_TTL_MS;
  useEffect(() => {
    if (!enabled || fresh || pathname === PLATFORM_HOME) return;
    readPlatformStrip();
  }, [enabled, fresh, pathname]);
  return enabled ? snap : null;
}
