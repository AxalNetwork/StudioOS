/**
 * WHAT THE BRANCH KNOWS ABOUT AN HQ SUPPORT SESSION IT IS INSIDE OF (D142).
 *
 * THE DEFECT THIS CLOSES, MEASURED. `SupportRedeemPage` has written
 * `localStorage.supportSession` since D120, under a comment saying the actor
 * and the reason are *"stored for the banner"*. That key occurred **exactly
 * once** in all of `frontend/src` — the setter. No reader, no banner, and
 * nothing removed it: `clearSession` purges `token`, `user`, `realUser`,
 * `realToken` and `viewMode`, and left this. So the blob outlived the
 * thirty-minute session AND outlived sign-out on that browser, and a banner
 * built on it naively would have told the branch user's next ordinary session
 * that HQ was inside their account.
 *
 * So two things are true of every read here and neither is optional:
 *
 *   1. IT EXPIRES. `active()` returns null once `expires_at` has passed. The
 *      session really does end — the JWT is minted for 30 minutes and
 *      `user_sessions.factor = 'hq_support'` is a real gate — so a payload that
 *      outlives it is describing something that is no longer happening.
 *   2. IT IS CLEARED ON SIGN-OUT. `KEY` is exported so the purge and the reader
 *      name the same string once, rather than a second copy in `App.jsx` that
 *      can be renamed apart from this one.
 *
 * WHY NOT ASK THE SERVER. Nothing branch-side exposes it. `/api/auth/me`
 * carries no `factor`, and `user_sessions.factor = 'hq_support'` is written by
 * `rpc/branchOps.ts` and read by nothing the branch can reach. A route for it
 * is worth having and is not this change; until then the redeem response is the
 * only place the fact exists, which is why it was stored in the first place.
 */

/** The one name for the stored payload. */
export const KEY = 'supportSession';

/** Remove it. Called on sign-out, and after it expires. */
export function clearSupportSession() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // A browser with storage blocked has nothing to clear, which is fine.
  }
}

/**
 * The support session that is happening RIGHT NOW, or null.
 *
 * Null covers every honest case: no session, a malformed blob, one with no
 * expiry (which cannot be shown to be current, so it is not claimed to be), and
 * one that has run out. An expired payload is cleared on the way past, so the
 * next read is cheap and the browser stops carrying a spent claim.
 *
 * @param {number} nowMs injected so the expiry can be tested without waiting
 */
export function activeSupportSession(nowMs = Date.now()) {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearSupportSession();
    return null;
  }
  if (!parsed || typeof parsed !== 'object') {
    clearSupportSession();
    return null;
  }

  // NO EXPIRY MEANS NOT CURRENT. A payload that cannot say when it ends cannot
  // be shown to be running, and the whole point of the banner is that it is
  // true while it is up. Cleared rather than kept, so it cannot accumulate.
  const endsMs = Date.parse(parsed.expires_at ?? '');
  if (!Number.isFinite(endsMs)) {
    clearSupportSession();
    return null;
  }
  if (endsMs <= nowMs) {
    clearSupportSession();
    return null;
  }

  return {
    actorName: typeof parsed.actor_name === 'string' ? parsed.actor_name : null,
    reason: typeof parsed.reason === 'string' ? parsed.reason : null,
    branch: typeof parsed.branch === 'string' ? parsed.branch : null,
    expiresAt: parsed.expires_at,
    msLeft: endsMs - nowMs,
  };
}

/** `21:14 left`, or null when there is nothing to count. */
export function timeLeftLabel(msLeft) {
  if (!Number.isFinite(msLeft) || msLeft <= 0) return null;
  const total = Math.floor(msLeft / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss} left`;
}
