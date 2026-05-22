/**
 * URL helpers shared by worker routes/services/providers.
 *
 * Why this exists: CodeQL flags `s.replace(/\/+$/, '')` (and similar
 * `\/+$` regexes) as `js/polynomial-redos` because, although V8/JSC
 * regexes execute these in linear time, the static rule treats `+$`
 * as polynomial-vulnerable. A bounded loop sidesteps the rule and is
 * also marginally faster on hot paths.
 *
 * Always use `stripTrailingSlashes(env.APP_URL || '')` instead of
 * `(env.APP_URL || '').replace(/\/+$/, '')` for any base-URL building.
 */
export function stripTrailingSlashes(s: string): string {
  let i = s.length;
  while (i > 0 && s.charCodeAt(i - 1) === 47 /* '/' */) i--;
  return i === s.length ? s : s.slice(0, i);
}

/**
 * Base URL for OAuth redirect_uri and webhook callback registration.
 *
 * Task #5 — Post-login canonical-host flip. After APP_URL/PUBLIC_BASE_URL
 * are flipped to https://axal.vc, integration providers and calendar OAuth
 * callbacks must still resolve to https://app.axal.vc until every provider's
 * redirect URI registration is updated at the provider dashboard.
 *
 * Precedence: OAUTH_CALLBACK_BASE_URL → APP_URL → 'https://app.axal.vc'
 *
 * Operators flip APP_URL to axal.vc and set OAUTH_CALLBACK_BASE_URL to
 * app.axal.vc to decouple the post-login redirect from OAuth callback URIs.
 * Once all provider registrations are updated to axal.vc, drop
 * OAUTH_CALLBACK_BASE_URL and APP_URL converges.
 */
export function callbackBase(env: { OAUTH_CALLBACK_BASE_URL?: string; APP_URL?: string }): string {
  return stripTrailingSlashes(env.OAUTH_CALLBACK_BASE_URL || env.APP_URL || 'https://app.axal.vc');
}
