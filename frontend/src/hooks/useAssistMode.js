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
 * THE DEFAULT IS THE HOST'S (D769, #2088). Since D720 the rail draws "Turn
 * off AI assistance on this page" on every page, and a page that never stored
 * a choice reads `defaultOn`:
 *   - a page with fills keeps OFF (Manual), the D698 default: a fill run spends
 *     a founder's own budget, and a mode on before they chose it spends money
 *     they did not agree to spend;
 *   - every other page is ON: its suggestions are shown, and nothing runs
 *     without a press.
 * D720 §6 makes on the default everywhere once the Worker refuses `assist_off`
 * (D765) and a recording's Stop asks first (D770); that is D769's second PR.
 * A stored choice, here or on the Worker, always wins over the default.
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
/** The keys that hold a choice, stored here or on the Worker: only these ignore the page's default. */
const chosen = new Set();
const listeners = new Set();

function readMode(key) {
  if (!cache.has(key)) {
    cache.set(key, safeReadJSON(key, false) === true);
    if (typeof safeReadJSON(key, null) === 'boolean') chosen.add(key);
  }
  return cache.get(key);
}

/** The page's mode: its choice where it made one, else the host's default (D769). */
function modeFor(key, defaultOn) {
  const value = readMode(key);
  return chosen.has(key) ? value : defaultOn === true;
}

function writeMode(key, next) {
  cache.set(key, next === true);
  chosen.add(key);
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
    if (cache.get(key) !== value || !chosen.has(key)) changed = true;
    cache.set(key, value);
    chosen.add(key);
    safeWriteJSON(key, value);
  }
  if (changed) for (const l of listeners) l();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Returns `[on, setOn]`. `defaultOn` is what a page that stored nothing reads
 * (false unless the host passes it; see above).
 *
 * The server snapshot is the default, so a prerendered page never asserts a
 * mode the browser has not read: a page with fills prerenders off, as before,
 * and a page that is on by default prerenders on.
 */
export default function useAssistMode(workspace, { defaultOn = false } = {}) {
  const key = keyFor(workspace);
  const on = useSyncExternalStore(
    subscribe,
    () => modeFor(key, defaultOn),
    () => defaultOn === true,
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
  chosen.clear();
  listeners.clear();
}
