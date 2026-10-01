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
// `hq` is HQ's own code in the metrics store and is never given to a branch
// (D211), so `hq.axal.vc` is not a branch host either.
const NOT_A_BRANCH = new Set(['app', 'www', 'hq']);

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

/**
 * The origin a link the user is about to COPY or SEND should carry (D106).
 *
 * WHY THIS EXISTS RATHER THAN `https://axal.vc` INLINE. Seven places built a
 * shareable URL from that literal: a referral link, an author profile link, a
 * team-page link, an article link. On a branch every one of them would hand a
 * branch member a link into HQ — and a referral link is the sharpest case,
 * because the referee who follows it REGISTERS IN HQ'S DATABASE and the
 * reward is attributed against a member who is not there. A wrong link is not
 * a cosmetic bug when following it creates an account on the wrong tier.
 *
 * `window.location.origin` is the answer on every tier at once: HQ serves
 * `https://axal.vc`, a branch serves `https://<code>.axal.vc`, and neither
 * needs to be told which it is. The SSR/test fallback is the apex because
 * these strings are only ever rendered in a browser; a prerender that emitted
 * one would emit HQ's, which is the correct canonical for prerendered HTML.
 *
 * NOT FOR CANONICAL TAGS OR THE SITEMAP. `lib/ogRegistry.js`'s `SITE_URL`
 * stays the apex on purpose: those are statements about where the canonical
 * document lives, which is HQ, and a branch answers `X-Robots-Tag: noindex`
 * precisely so the duplicate is never indexed.
 */
export function appOrigin() {
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return 'https://axal.vc';
}
