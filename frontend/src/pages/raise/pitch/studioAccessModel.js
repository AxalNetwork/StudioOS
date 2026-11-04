/**
 * D4359 (#4359, #2434 Q8 = A) — the Pitch deck studio's plan gate, pure.
 *
 * The studio is a Raise + Grow plan feature. Whether this member may use it is
 * the Worker's answer (`GET /api/decks/access`, the rule its own deck gates
 * apply), never a plan list kept here, so the page cannot draw an open studio
 * the Worker would refuse. `StudioGate.jsx` draws it.
 */
export const LOCKED_TITLE = 'The Pitch deck studio is on the Raise + Grow plan';
export const LOCKED_LINE = 'Your plan does not include it. Upgrade to Raise + Grow to draft, edit, share and present your decks here.';
export const UPGRADE = 'See Raise + Grow';
export const PLANS = 'Compare plans ›';
export const PLANS_HREF = '/pricing';
export const UNREAD_TITLE = 'Your plan could not be checked';
export const UNREAD_LINE = 'The studio opens once StudioOS has checked that your plan includes it. Nothing has changed.';
export const RETRY = 'Try again';
export const FEATURE = 'Pitch deck studio';

/**
 * The gate's state from the access read: `loading`, `open`, `locked` (with the
 * plan to upgrade to) or `unread`. An answer that is not exactly open, or a
 * read that failed, is never drawn as an open studio.
 */
export function accessState(read) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (read.status === 'error') return { state: 'unread' };
  const d = read.data;
  if (!d || typeof d !== 'object' || typeof d.open !== 'boolean') return { state: 'unread' };
  if (d.open === true) return { state: 'open' };
  const tier = typeof d.required === 'string' && d.required ? d.required : 'studio';
  const name = String(d.plan?.name || '').trim() || 'Raise + Grow';
  const message = String(d.message || '').trim() || LOCKED_LINE;
  return { state: 'locked', tier, name, message };
}
