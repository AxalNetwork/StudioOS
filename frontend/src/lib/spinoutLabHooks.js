// Task #13 — Spin-Out Lab milestone hooks.
//
// Every milestone-eligible action across the app calls markMilestone() on
// success. The call is best-effort: it never throws into the user's primary
// flow (failures are logged via reportError). After a successful POST we
// dispatch a 'spinout-lab:advanced' window event so the Lab sidebar can
// re-pull /api/spinout-lab/state and reflect the new week / unlocks.
//
// Task #16 — The complete() response is the fresh LabState; we forward it
// in the CustomEvent `detail` so the global listener can distinguish a
// routine milestone (same week) from a week-advance moment or the final
// incorporation transition and pick a richer celebration accordingly.
//
// All call sites are gated on `user?.spinout_lab_active === 1` so non-Lab
// users never burn an API request.

import { spinoutLab } from './api';
import { reportError } from './log';

export async function markMilestone(user, key) {
  if (!user || user.spinout_lab_active !== 1) return;
  if (!key) return;
  try {
    const state = await spinoutLab.complete(key);
    try {
      window.dispatchEvent(
        new CustomEvent('spinout-lab:advanced', {
          detail: { state, milestoneKey: key },
        }),
      );
    } catch {
      // SSR / non-browser — safe to ignore.
    }
  } catch (e) {
    reportError(`spinoutLabHooks:${key}`, e);
  }
}
