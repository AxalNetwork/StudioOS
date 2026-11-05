/** D4478: keep only the latest offline position around the existing 15-second writer. */
import { positionWriter } from './learningModel';
import { isOnline } from './useOnline';

export function queuedPositionWriter(write, { online = isOnline, ...options } = {}) {
  let pending = null;
  let wake = null;
  let active = true;
  const writer = positionWriter(async (seconds, percent) => {
    try { await write(seconds, percent); }
    finally {
      // A reconnect can arrive while an earlier request is still in flight.
      // Retry once after it settles and positionWriter releases its busy flag.
      if (active && pending && online() && wake === null) wake = setTimeout(() => { wake = null; reconnect(); }, 0);
    }
  }, options);
  const queue = (seconds, duration) => {
    const s = Number(seconds);
    if (Number.isFinite(s) && s >= 0) pending = [s, duration];
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
    activate() { active = true; },
    dispose() { active = false; pending = null; if (wake !== null) clearTimeout(wake); wake = null; },
  };
}
