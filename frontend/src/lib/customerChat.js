// Task #103 — the client half of the customer-chat tier gate.
//
// `components/CustomerChatWidget.jsx` has been fully built since Task #7 (IG)
// and mounted nowhere: its docblock says "The Help Center help panel enforces
// tier eligibility and only mounts this", and that panel was never written.
// The backend is complete — `routes/customer_chat.ts`, migration 056, the
// Slack round-trip — so the whole feature sat dark behind a missing caller.
//
// This is that caller's gate. It MIRRORS `isEligible` in
// `cloudflare-worker/src/routes/customer_chat.ts`, which stays the real
// enforcement: both `/thread` and `/send` return 402 to anyone who does not
// qualify, whatever the client believes. The mirror exists so an ineligible
// viewer is never offered a channel that would reject them — an entry point
// that always 402s is worse than no entry point.
//
// `frontend/test/help_center_contract.test.mjs` pins the two copies together:
// the tier sets and the bypass roles are read out of the worker source and
// compared against the constants below, so a plan change on one side fails
// the build rather than quietly opening or closing the door on the other.
//
// The two tier fields come from `GET /auth/me`. `subscription_tier` has
// always been in that payload; `investor_tier` was added by this same task,
// because without it an institutional investor — the one investor tier that
// qualifies — read as `free` on the client and was refused a channel the
// server would have granted.

/** Founder subscription tiers that qualify. Growth is deliberately excluded. */
export const CHAT_FOUNDER_TIERS = ['studio'];

/** Investor tiers that qualify. */
export const CHAT_INVESTOR_TIERS = ['institutional'];

/**
 * Roles that qualify regardless of tier: admin and advisor bypass the way
 * `requireTier` does, and partners pay through a partner contract rather
 * than a subscription row.
 */
export const CHAT_BYPASS_ROLES = ['admin', 'advisor', 'partner'];

/**
 * True when this user's role/tier qualifies for customer chat.
 *
 * Returns false for a missing user rather than throwing — the Help Center
 * renders before `/auth/me` resolves, and the contact list must not flicker
 * a channel on and then off.
 */
export function canUseCustomerChat(user) {
  if (!user) return false;
  const role = String(user.role || '').toLowerCase();
  if (CHAT_BYPASS_ROLES.includes(role)) return true;
  if (role === 'investor') {
    return CHAT_INVESTOR_TIERS.includes(String(user.investor_tier || 'free').toLowerCase());
  }
  return CHAT_FOUNDER_TIERS.includes(String(user.subscription_tier || 'free').toLowerCase());
}
