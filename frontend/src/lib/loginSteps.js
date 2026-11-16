// #6958 (Sign In v2, canvas D6956) — the steps of /login, without React.
//
// The first view offers Email, Apple and Google. Email opens a method chooser,
// and each method is its own step. Every step is a history entry
// (`/login?step=…`, with `next=` kept), so the in-card Back, the browser's Back
// and Android's back gesture all go one step up. These helpers are pure so the
// node tests can pin them.

export const STEPS = ['first', 'email', 'link', 'sent', 'code', 'passkey'];

/** The step one level up. The first view has none. */
export const PARENT = {
  email: 'first',
  link: 'email',
  sent: 'link',
  code: 'email',
  passkey: 'email',
};

/** Read `?step=` from a search string; anything unknown is the first view. */
export function stepFromSearch(search) {
  try {
    const s = new URLSearchParams(search || '').get('step');
    return STEPS.includes(s) ? s : 'first';
  } catch {
    return 'first';
  }
}

/**
 * The search string for `step`, keeping every other parameter (`next=` above
 * all). The first view carries no `step`.
 */
export function searchForStep(search, step) {
  const p = new URLSearchParams(search || '');
  if (!step || step === 'first') p.delete('step');
  else p.set('step', step);
  const q = p.toString();
  return q ? `?${q}` : '';
}

/**
 * A step a fresh page load may open directly. `sent` and `passkey` describe an
 * action that already happened in this tab; reloaded, they fall back to the
 * step that starts it, so no send or device prompt fires on its own.
 */
export function restorableStep(step) {
  if (step === 'sent') return 'link';
  if (step === 'passkey') return 'email';
  return STEPS.includes(step) ? step : 'first';
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * The code field takes the six digits from an authenticator, or a recovery
 * code (letters, digits and dashes), which /api/auth/login tries when the
 * digits do not match. Spaces and other punctuation from a paste are dropped.
 */
export function cleanCode(raw) {
  const s = String(raw || '').replace(/[^A-Za-z0-9-]/g, '');
  if (/^\d*$/.test(s)) return s.slice(0, 6);
  return s.slice(0, 24);
}

export function codeReady(code) {
  const c = String(code || '');
  return /^\d{6}$/.test(c) || (/[A-Za-z]/.test(c) && c.replace(/-/g, '').length >= 8);
}

/**
 * Where a `?magic_error=` return opens: the link step, ready to send a new one,
 * except an inactive account, which no new link can help.
 */
export function stepForMagicError(code) {
  return code === 'inactive' ? 'first' : 'link';
}

/** The codes routes/auth_apple.ts returns as `?apple_error=`, in our words. */
export const APPLE_ERROR_COPY = {
  cancelled: 'Apple sign-in was cancelled. Nothing was changed.',
  provider_error: "Apple didn't confirm your sign-in. Try again, or use Continue with Email.",
  exchange_failed: "Apple didn't confirm your sign-in. Try again, or use Continue with Email.",
  token_invalid: "We couldn't verify your Apple ID. Try again, or use Continue with Email.",
  missing_code: "Apple didn't confirm your sign-in. Try again, or use Continue with Email.",
  bad_state: 'This sign-in attempt expired. Press Continue with Apple again.',
  not_configured: "Sign in with Apple isn't available here yet. Use Continue with Email or Google.",
  email_unverified: "Apple hasn't verified the email on this Apple ID. Use Continue with Email.",
  email_missing: "Apple didn't share an email address. Sign in with Email once, then link Apple under Account → Security.",
  link_requires_email_proof: "Apple doesn't host this address, so it can't prove the inbox is yours. Sign in with Email once, then link Apple under Account → Security; after that, Continue with Apple works.",
  link_blocked_unverified: "An Axal VC account already uses this email, but the address isn't confirmed yet. Use 'Email me a sign-in link' once to confirm it, then link Apple under Account → Security.",
  account_inactive: 'Your Axal VC account is inactive. Contact support.',
  internal_error: 'Something went wrong on our side. Please try again.',
};

/** Banners that report a cancellation read as information, not as an error. */
export function isCancellation(code) {
  return code === 'cancelled' || code === 'access_denied' || code === 'popup_closed';
}
