/**
 * D4478: keep only the latest offline position around the existing 15-second writer.
 *
 * #4646: with a `store` ({ load, save, clear }) a position that could not be written is also kept on the device, so it
 * survives the player unmounting, a navigation and a browser restart. It is written when the connection returns or the
 * item is opened again, and removed once the server has it. Without a store the writer behaves as before.
 */
import { positionWriter } from './learningModel';
import { isOnline } from './useOnline';

export function queuedPositionWriter(write, { online = isOnline, store = null, ...options } = {}) {
  let pending = null;
  let wake = null;
  let active = true;
  // What an earlier session left behind: the first thing to reconcile.
  const left = store?.load?.();
  if (left && Number.isFinite(left.seconds)) pending = [left.seconds, left.duration];
  const keep = (value) => { pending = value; if (value && store) store.save(value[0], value[1]); };
  const writer = positionWriter(async (seconds, percent) => {
    let ok = false;
    try { await write(seconds, percent); ok = true; }
    finally {
      // The server has this position: nothing older is still owed, unless a newer one is waiting.
      if (ok && store && !pending) store.clear();
      // A reconnect can arrive while an earlier request is still in flight.
      // Retry once after it settles and positionWriter releases its busy flag.
      if (active && pending && online() && wake === null) wake = setTimeout(() => { wake = null; reconnect(); }, 0);
    }
  }, options);
  const queue = (seconds, duration) => {
    const s = Number(seconds);
    if (Number.isFinite(s) && s >= 0) keep([s, duration]);
    return false;
  };
  function reconnect() {
    if (!active || !online() || !pending) return false;
    const latest = pending;
    pending = null;
    if (writer.flush(...latest)) return true;
    pending = latest;
    return false;
  }
  return {
    tick: (seconds, duration) => active && (online() ? writer.tick(seconds, duration) : queue(seconds, duration)),
    flush: (seconds, duration) => active && (online() ? writer.flush(seconds, duration) : queue(seconds, duration)),
    reconnect,
    /** A position left on the device by an earlier session, or null. */
    leftover: () => (left && Number.isFinite(left.seconds) ? left : null),
    activate() { active = true; },
    // The in-memory queue goes; the copy on the device stays until the server has it.
    dispose() { active = false; pending = null; if (wake !== null) clearTimeout(wake); wake = null; },
  };
}

/** A writer's `store` over the browser's, for one learner and item; null when either is unknown. */
export function positionStoreFor(drafts, store, key) {
  if (!store || !key) return null;
  return {
    load: () => drafts.loadPosition(store, key),
    save: (seconds, duration) => drafts.savePosition(store, key, seconds, duration),
    clear: () => drafts.clearDraft(store, key),
  };
}
