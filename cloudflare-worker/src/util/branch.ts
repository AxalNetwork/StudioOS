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

/**
 * One hostname label — and never `hq` (D211). Every Worker writes its code to
 * Analytics Engine's blob6 as `branchOf(env) || 'hq'`, so HQ's own rows ARE the
 * rows coded `hq`: a branch given that code would be counted into HQ's line on
 * H15, and HQ's analytics route, which lists `hq` first and then every
 * registered code, would draw the same line twice. So the code is reserved in
 * every copy of this rule, not in one of them.
 */
export const BRANCH_CODE_RE = /^(?!hq$)[a-z][a-z0-9-]{1,15}$/;

/**
 * The two refusals branch mode adds, as the exact strings thrown (D106).
 *
 * They live here, beside `branchOf`, because `index.ts`'s
 * `AUTH_ERROR_STATUSES` maps a thrown message to a status by EXACT STRING: a
 * sentence that drifts from its map entry does not weaken the gate, it turns
 * a working refusal into a 500, which is what the map's own comment says
 * happened to "Super admin required" before it had an entry. One constant,
 * read by both the throw and the map, is the only shape where they cannot
 * disagree.
 *
 * `HQ_ONLY` is deliberately a different sentence from "Super admin required".
 * A branch admin is not an admin who lacks an elevation — the elevation does
 * not exist on their deployment at all — and the support queue should not
 * have to guess which of the two happened.
 */
export const HQ_ONLY = 'HQ only';

/**
 * D.9, in the words the subsidiary canvas uses for it. The branch owns its
 * assessment RESULTS and its contracts; the questions and the master
 * templates are HQ's, and the route back is a Content submission, not an
 * edit.
 */
export const HQ_AUTHORING_ONLY = 'Changing a template is a Content submission';

/**
 * A suspended branch's queues are frozen (D107, S0/S8 on the subsidiary
 * canvas). Thrown by `requireBranchNotSuspended` and mapped to **423 Locked**
 * — not 403 — because the two say different things and the shell renders
 * them differently: 403 is "this is not yours", 423 is "this is yours and HQ
 * has frozen it", which is a state with a date, a reason and an appeal path.
 *
 * READS ARE NEVER GATED BY IT. A frozen branch can still see its queue; that
 * is what the banner is about. Only the decision writes stop, because a
 * decision taken while the licence is suspended is one HQ would have to
 * unwind.
 */
export const BRANCH_SUSPENDED = 'Branch suspended by HQ';

/**
 * The mirror of `HQ_ONLY`: a surface that only exists on a BRANCH (D112).
 *
 * `HQ_ONLY` refuses a branch reaching for HQ's console. This refuses HQ
 * reaching for a branch's own tier — the To-HQ escalation lane being the first
 * of them, because HQ has no HQ to escalate to. Both are 403 for the same
 * reason: it is not a malformed request, it is a surface that is not this
 * tier's.
 *
 * DECLARED HERE RATHER THAN IN THE ROUTE, because `AUTH_ERROR_STATUSES` keys
 * on the sentence. A route that threw its own wording would fall through
 * `mapError` to 400, and the SPA cannot tell a refusal from a bad request at
 * 400 — which is exactly the defect D110 found across 31 route files.
 */
export const BRANCH_ONLY = 'Branch only';


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

/**
 * Refuse this request unless the Worker is a branch, and return the code.
 *
 * LIFTED OUT OF `routes/branch_escalations.ts` (D130) BECAUSE THE APPROVALS
 * BOARD IS THE SECOND BRANCH-ONLY SURFACE, and a second hand-written copy is
 * how one of them ends up throwing its own sentence — which `mapError` would
 * answer 400 rather than 403, the exact defect D110 found across 31 route
 * files. Throwing the SHARED constant is what makes `AUTH_ERROR_STATUSES` map
 * it, so the thing worth sharing is the throw, not just the string.
 */
export function requireBranchTier(env: Pick<Env, 'BRANCH_CODE'>): string {
  const code = branchOf(env);
  if (!code) throw new Error(BRANCH_ONLY);
  return code;
}

/**
 * On a branch, refuse to serve `/api/*` unless the URL vars name the branch's
 * own host (D106). No-op on HQ.
 *
 * WHY THIS IS A BOOT ASSERTION AND NOT A LINT. `APP_URL`, `PUBLIC_BASE_URL`,
 * `OAUTH_CALLBACK_BASE_URL` and `PUBLIC_MARKETING_URL` are read by every
 * email, magic link, OAuth callback, Stripe webhook registration and share
 * link the Worker emits. A branch deployed with HQ's values does not fail:
 * it succeeds, and sends the branch's users to HQ's host, where their
 * branch-named cookie does not exist and their account is not in the
 * database. That is a silent cross-tier leak with a plausible-looking screen
 * at the end of it, so it has to be the kind of failure that stops the
 * deployment rather than the kind someone notices in a week.
 *
 * It sits beside `assertJwtSecretStrength`, on the `/api/*` path only, for
 * the reason that one does: a static asset needs no configuration and cold
 * traffic should not pay for this check.
 *
 * `BRANCH_CODE` is the authority on which host is ours — it is what
 * `wrangler.branch.<code>.toml` also derives the route from — so the
 * comparison is against `<code>.axal.vc` and not against one var trusting
 * another.
 */
export function assertBranchAppUrl(env: Env): void {
  const code = branchOf(env);
  if (!code) return;
  const expected = `${code}.axal.vc`;
  const vars = ['APP_URL', 'PUBLIC_BASE_URL', 'OAUTH_CALLBACK_BASE_URL', 'PUBLIC_MARKETING_URL'] as const;
  const wrong: string[] = [];
  for (const name of vars) {
    const raw = String((env as unknown as Record<string, string | undefined>)[name] ?? '').trim();
    if (!raw) { wrong.push(`${name} is unset`); continue; }
    let host: string;
    try { host = new URL(raw).host.toLowerCase(); } catch { wrong.push(`${name} is not a URL`); continue; }
    if (host !== expected) wrong.push(`${name} points at ${host}`);
  }
  if (wrong.length) {
    throw new Error(`branch ${code} expects every URL var on ${expected}: ${wrong.join('; ')}`);
  }
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
