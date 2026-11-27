/**
 * D685 §5.6.8 (#1588) — nothing reloads or logs out under a running capture.
 *
 * A recording gives the page no input and lives in memory: the 20-minute
 * inactivity logout, the service worker's `controllerchange` reload and the
 * stale-chunk reload would each end it mid-interview. They ask `isCapturing()`
 * first, and a reload waits with `whenIdle`. The recorder registers its probe
 * (`contexts/ActiveRecordingContext.jsx`); with none registered, nothing is
 * capturing. This file imports nothing, so the earliest boot code can use it.
 */
let probe = () => false;

export function setCaptureProbe(fn) { probe = typeof fn === 'function' ? fn : () => false; }

export function isCapturing() {
  try { return !!probe(); } catch { return false; }
}

/** Run `cb` now, or once the capture ends (checked every `every` ms). */
export function whenIdle(cb, { every = 2000, setTimer = (f, ms) => setTimeout(f, ms) } = {}) {
  if (!isCapturing()) { cb(); return; }
  setTimer(() => whenIdle(cb, { every, setTimer }), every);
}
