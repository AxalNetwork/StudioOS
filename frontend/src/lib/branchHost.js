/**
 * Which branch, if any, this page is served from — decided from the hostname,
 * with no request (D104).
 *
 * HQ is `axal.vc` (and `app.axal.vc`, which 301s to it). A branch is
 * `<code>.axal.vc`, a separate Worker over its own database, and its cookies
 * carry the code in their NAMES: `studioos_csrf_<code>` rather than
 * `studioos_csrf`. The reason is not tidiness. HQ's cookies are set for
 * `.axal.vc`, so the browser sends them to every subdomain; a branch page that
 * mirrored the first `studioos_csrf` it found would sometimes mirror HQ's and
 * fail the branch's double-submit check. Reading the suffixed name is what
 * makes the SPA and the Worker (`cloudflare-worker/src/util/branch.ts`) agree
 * on which cookie is theirs.
 *
 * The rule is deliberately narrow: exactly one label before `axal.vc`, not
 * `app` or `www`. Anything else — the apex, localhost, a preview
 * `*.workers.dev` — is not a branch.
 */

const BRANCH_HOST_RE = /^([a-z][a-z0-9-]{1,15})\.axal\.vc$/;
const NOT_A_BRANCH = new Set(['app', 'www']);

/** The branch code for `hostname`, or `null` when the page is HQ, dev or preview. */
export function branchCodeFromHost(hostname) {
  const m = BRANCH_HOST_RE.exec(String(hostname || '').toLowerCase());
  if (!m || NOT_A_BRANCH.has(m[1])) return null;
  return m[1];
}

/** The CSRF cookie this page must mirror: `studioos_csrf` on HQ, `studioos_csrf_<code>` on a branch. */
export function csrfCookieNameFor(hostname) {
  const code = branchCodeFromHost(hostname);
  return code ? `studioos_csrf_${code}` : 'studioos_csrf';
}
