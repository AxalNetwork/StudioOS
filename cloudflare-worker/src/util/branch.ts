/**
 * Branch mode — which subsidiary this Worker serves, if any (D104, D105).
 *
 * HQ is the `studioos` Worker at axal.vc with `BRANCH_CODE` unset. A branch is
 * the same code deployed again as `studioos-<code>` at `<code>.axal.vc` over
 * its own database, with `BRANCH_CODE=<code>` in its generated config. The
 * code is the hostname's first label, and it suffixes the branch's cookie
 * names: the browser keeps sending HQ's `.axal.vc` cookies to every
 * subdomain, and two cookies called `studioos_auth` on one host are ordered
 * by the user agent, not by us (RFC 6265 §5.4), so a branch that read the
 * plain name would sometimes read HQ's session and reject its own user.
 *
 * A malformed value THROWS rather than reading as "not a branch". A branch
 * Worker that quietly ran as HQ would serve HQ's console over branch data,
 * and every request failing loudly is the safer of the two.
 */
import type { Env } from '../types';

export const BRANCH_CODE_RE = /^[a-z][a-z0-9-]{1,15}$/;

/** The branch code this Worker is deployed for, lower-cased, or `null` on HQ. */
export function branchOf(env: Pick<Env, 'BRANCH_CODE'> | undefined | null): string | null {
  const raw = String(env?.BRANCH_CODE ?? '').trim();
  if (!raw) return null;
  const code = raw.toLowerCase();
  if (!BRANCH_CODE_RE.test(code)) {
    throw new Error(`BRANCH_CODE "${raw}" is not a branch code (expected ${BRANCH_CODE_RE})`);
  }
  return code;
}

/** `studioos_auth` on HQ, `studioos_auth_<code>` on a branch. */
export function authCookieName(env: Pick<Env, 'BRANCH_CODE'> | undefined | null): string {
  const b = branchOf(env);
  return b ? `studioos_auth_${b}` : 'studioos_auth';
}

/**
 * `studioos_csrf` on HQ, `studioos_csrf_<code>` on a branch. The SPA derives
 * the same name from its own hostname (`frontend/src/lib/branchHost.js`), so
 * the two sides agree without a request.
 */
export function csrfCookieName(env: Pick<Env, 'BRANCH_CODE'> | undefined | null): string {
  const b = branchOf(env);
  return b ? `studioos_csrf_${b}` : 'studioos_csrf';
}
