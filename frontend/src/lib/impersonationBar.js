/**
 * D290 / canvas H25 — what the operator's impersonation bar says, and the one
 * place the typed reason is kept on this side.
 *
 * WHO · AS · WHY · LIMIT, the four fields S13 draws on the branch's own bar
 * for the same session, so neither side can see a session the other cannot.
 * The bar is global chrome (`App.jsx`, above `PortalSwitcher`); this file is
 * its words, so a test can put a holder, a plain admin and a null reason
 * through it without rendering anything.
 *
 * THE REASON IS ECHOED, NEVER INVENTED. `POST /api/admin/impersonate/:id`
 * answers `reason` with the text it stored on `impersonation_sessions`, or
 * `null` when that best-effort write failed (routes/admin.ts). A null reason
 * reads "Not recorded" — the same word `lib/absence.js` uses for every other
 * figure no store holds — because a bar that filled the gap with "support"
 * would be this component asserting a fact the server did not send.
 *
 * ONE OWNER FOR THE STORED COPY. `api.adminImpersonate` writes the echoed
 * reason beside `impersonationExpiresAt` so a reload mid-session still draws
 * it, and `App.jsx` purges it on sign-out, on End session and on the
 * thirty-minute hand-back. The key is named here once, so the writer, the
 * reader and the three purges cannot be renamed apart (D142's rule for
 * `supportSession.js`).
 */

/** The one name for the stored reason. */
export const REASON_KEY = 'impersonationReason';

/** What a null reason reads as. Never a stand-in reason. */
export const NOT_RECORDED = 'Not recorded';

/**
 * How long a support session lasts, in the bar's Limit field. The worker's
 * `IMPERSONATION_EXPIRY_MINUTES` mints the token for this long; the guard
 * holds the two equal, so the bar cannot promise a limit the token does not.
 */
export const SUPPORT_SESSION_MINUTES = 30;

/** H25's control words. */
export const EXTEND_LABEL = 'Extend';
export const END_LABEL = 'End session';

/** Keep the echoed reason for the life of the session. A non-string clears it. */
export function storeReason(reason) {
  try {
    if (typeof reason === 'string' && reason.trim()) localStorage.setItem(REASON_KEY, reason);
    else localStorage.removeItem(REASON_KEY);
  } catch {
    // A browser with storage blocked keeps nothing, and the bar reads null.
  }
}

/** The stored reason, or null. */
export function readStoredReason() {
  try {
    const v = localStorage.getItem(REASON_KEY);
    return typeof v === 'string' && v.trim() ? v : null;
  } catch {
    return null;
  }
}

/** Remove it. Called on sign-out, on End session and on the hand-back. */
export function clearStoredReason() {
  try {
    localStorage.removeItem(REASON_KEY);
  } catch {
    // Nothing to clear on a browser that stores nothing.
  }
}

/** The Why field: the reason, quoted, or "Not recorded". */
export function whyValue(reason) {
  if (typeof reason !== 'string' || !reason.trim()) return NOT_RECORDED;
  return `“${reason.trim()}”`;
}

const ROLE_WORDS = {
  admin: 'Admin',
  founder: 'Founder',
  partner: 'Partner',
  investor: 'Investor',
  advisor: 'Advisor',
  exploring: 'Exploring',
};

/**
 * The four fields, in H25's order. `operator` is the signed-in admin
 * (`realUser`), `target` the person being acted as (`user`), `holder`
 * whether the operator carries the Super Admin elevation.
 */
export function impersonationFields({ operator, target, reason, holder = false }) {
  const who = operator?.name || operator?.email || NOT_RECORDED;
  const asName = target?.name || target?.email || NOT_RECORDED;
  const role = ROLE_WORDS[String(target?.role || '').toLowerCase()];
  return [
    { k: 'Who', v: `${who} · ${holder ? 'Axal VC HQ' : 'Admin'}` },
    { k: 'As', v: role ? `${asName} · ${role}` : asName },
    { k: 'Why', v: whyValue(reason) },
    { k: 'Limit', v: `${SUPPORT_SESSION_MINUTES} min · hard` },
  ];
}
