import { useCallback, useSyncExternalStore } from 'react';
import { safeReadJSON, safeWriteJSON } from '../lib/storage';
import { railPrefsApi } from '../lib/api/railPrefs.js';

/**
 * Whether "AI fills the blanks" is on, for one workspace.
 *
 * `DECISIONS` D14 listed this hook by name as the thing still genuinely
 * missing after the rail's spend meter landed — "per-page mode persistence
 * (`useAssistMode(pageKey)`)" — and D17 explained why it stayed missing: no
 * page branched on a mode, so persisting one would have made a dead control
 * look deliberate. Founder Validate branches now.
 *
 * OFF IS THE DEFAULT, and that is a decision rather than an omission. The
 * canvas draws the fill-the-blanks card selected with its switch on. But every
 * run spends a founder's own budget against their own monthly cap, and a mode
 * that is on before they have chosen it spends money they did not agree to
 * spend. `false` until they flip it.
 *
 * PER WORKSPACE, not per zone and not global. Same rule as the model choice
 * beside it, and for the same reason the Validate canvas gives: "Mode and
 * model are chosen on the workspace, not re-picked here." Global would mean
 * turning it on for Validate turned it on for Raise, where nothing fills a
 * blank.
 *
 * WHY A MODULE-LEVEL STORE AND NOT `useState`. Two components read this on one
 * screen — the rail draws the switch, the page decides whether to offer
 * proposals — and with `useState` each would hold its own copy: flipping the
 * switch would change the rail and leave the page as it was until a reload.
 * A context would work and would mean adding a provider above forty-seven
 * hosts to carry one boolean. `useSyncExternalStore` over a small module store
 * is the same result without the provider, and it is React's own answer for
 * exactly this.
 *
 * ON THE WORKER TOO (D698). The rail's "Eadwyn | Manual" switch writes this
 * store, and the choice follows the founder across devices: the setter also
 * PUTs it to `ai_rail_preferences` (migration 465), and `syncRailPrefs`
 * (`ui/railModelChoice.js`) seeds this store from the Worker once per page
 * load through `seedAssistModes`. A failed write leaves the local value, which
 * is what the page acts on.
 */
export const ASSIST_MODE_PREFIX = 'assist_mode:';
const KEY_PREFIX = ASSIST_MODE_PREFIX;
const sectionOf = (workspace) => String(workspace || '').toLowerCase().trim();
const keyFor = (workspace) => `${KEY_PREFIX}${sectionOf(workspace)}`;

/** key → boolean. Seeded from storage on first read, then authoritative. */
const cache = new Map();
const listeners = new Set();

function readMode(key) {
  if (!cache.has(key)) cache.set(key, safeReadJSON(key, false) === true);
  return cache.get(key);
}

function writeMode(key, next) {
  cache.set(key, next === true);
  safeWriteJSON(key, next === true);
  for (const l of listeners) l();
}

/**
 * The Worker's modes, seeded into this store (D698): `map` is section →
 * boolean. Every listener hears it once, so a switch drawn before the read
 * answered moves to the founder's stored choice.
 */
export function seedAssistModes(map) {
  let changed = false;
  for (const [workspace, value] of Object.entries(map || {})) {
    if (typeof value !== 'boolean') continue;
    const key = keyFor(workspace);
    if (cache.get(key) !== value) changed = true;
    cache.set(key, value);
    safeWriteJSON(key, value);
  }
  if (changed) for (const l of listeners) l();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Returns `[on, setOn]`.
 *
 * The server snapshot is `false` so a prerendered page never asserts that
 * something is on before the browser has read storage — `docs/` is prerendered
 * for 31 routes and a mismatch here would hydrate as a flicker from on to off,
 * which reads as the toggle turning itself off.
 */
export default function useAssistMode(workspace) {
  const key = keyFor(workspace);
  const on = useSyncExternalStore(
    subscribe,
    () => readMode(key),
    () => false,
  );
  const setOn = useCallback((next) => {
    writeMode(key, next);
    Promise.resolve()
      .then(() => railPrefsApi.setMode(sectionOf(workspace), next === true ? 'eadwyn' : 'manual'))
      .catch(() => {});
  }, [key, workspace]);
  return [on, setOn];
}

/** Test seam: forget everything read so far. Never called by the app. */
export function __resetAssistModeForTest() {
  cache.clear();
  listeners.clear();
}
