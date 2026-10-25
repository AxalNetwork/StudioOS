/**
 * Where an OAuth sign-in returns, when it started from Build's "Connect a tool"
 * (D686 §5.4, #1597).
 *
 * The callback runs on OAUTH_CALLBACK_BASE_URL's host (app.axal.vc), not
 * necessarily the host the sign-in started on, so neither a host-only cookie nor
 * the browser's per-origin sessionStorage can carry Build's return. The return,
 * with its venture, rides in the signed state nonce instead: `rb<project id>_`
 * (or `rb_`) as the nonce's prefix, after Calendar's `gm_` when present. The
 * nonce is HMAC-signed, so the prefix is only read back from a verified state.
 */
/**
 * Build's return carries its venture (#1597): `build:<project id>`. The callback
 * may run on OAUTH_CALLBACK_BASE_URL's host, where the start's host-only cookie
 * is absent, so the signed state nonce carries it too (`returnTag`, `returnFromNonce`).
 */
export function parseReturn(returnTo: string): { kind: string; projectId: number | null } {
  const m = /^build(?::(\d{1,12}))?$/.exec(returnTo || '');
  if (!m) return { kind: returnTo || '', projectId: null };
  const id = m[1] ? Number(m[1]) : null;
  return { kind: 'build', projectId: id && Number.isSafeInteger(id) && id > 0 ? id : null };
}
/** The nonce's prefix for a Build return: `rb<id>_` (or `rb_`); none for any other. */
export function returnTag(returnTo: string, projectId: unknown): string {
  if (returnTo !== 'build') return '';
  const id = Number(projectId);
  return `rb${Number.isSafeInteger(id) && id > 0 && id < 1e12 ? id : ''}_`;
}
/** The return a verified nonce names, or '' when it names none. */
export function returnFromNonce(nonce: string | null): string {
  const m = /^(?:(?:gm|mp)_)?rb(\d{0,12})_/.exec(nonce || '');
  return m ? (m[1] ? `build:${m[1]}` : 'build') : '';
}
