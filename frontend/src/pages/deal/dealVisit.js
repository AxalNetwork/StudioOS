/**
 * D1152 (#3057) — part 2's `GET /api/deals/:id/whats-new` advances the
 * reader's "last looked" marker each time it answers (D1150), so the page
 * reads it once per deal per visit: the first call's promise is kept and
 * every later render, tab change or remount reuses its answer. It is never
 * prefetched or read again on focus. A read that failed advanced nothing
 * (D1150), so it is dropped and Try again reads afresh.
 */
import { dealContextApi } from '../../lib/api/dealContext.js';

const seen = new Map();

export function whatsNewOnce(dealId) {
  const key = String(dealId);
  if (!seen.has(key)) {
    const p = dealContextApi.whatsNew(dealId).catch((e) => { seen.delete(key); throw e; });
    seen.set(key, p);
  }
  return seen.get(key);
}

/** Tests only: forget every visit. */
export function forgetVisits() { seen.clear(); }
