/**
 * D8834 (#5620 items 4 and 5): the owner's sign-off of one T2 pull request
 * head, and the merge-queue rule that reads it.
 *
 * `POST /signoff {pr, head_sha, actor}` is an owner route behind the same
 * `ownerAuthorized` check as `/switch` and `/claims`. `RepoControl.signoff`
 * stores `{pr, head_sha, actor, policy_version, at}` under the exact
 * `signoffKey(pr, head_sha)`, writes one `signoff` audit row and re-posts the
 * `merge-control/policy` check run as `success` on that SHA only. A label, a
 * comment or a review never reaches this module.
 *
 * A T2 `merge_group` head passes only when its pull request (from the queue
 * branch, `gh-readonly-queue/main/pr-<n>-<sha>`) has a sign-off for the head
 * Merge Control last recorded for it, under this `policy_version`, and the
 * candidate is proved to be built from that head: its only parent is the
 * group's `base_sha` and every path of its tree is what a three-way merge of
 * the base and that head gives (D8692's binding, done over the GitHub API).
 * Every error or doubt is a reason, never a pass.
 */
import { CHECK_NAME, EVALUATE_TIMEOUT_MS } from './policyCheck.ts';
import type { Decision, PolicyTarget, SignoffEvidence } from './policyCheck.ts';
import { POLICY_VERSION } from './policy.ts';
import { comparePath, treePath } from './github.ts';
import { limitedBody, ownerAuthorized } from './webhook.ts';
import type { Env, GithubApi } from './types.ts';

export const SIGNOFF_ROUTE = '/signoff';
const SHA = /^[a-f0-9]{40}$/;
/** A GitHub login: what the owner names as the person signing. */
const ACTOR = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const MAX_PROBLEMS = 20;

export interface SignoffInput { readonly pr: number; readonly head_sha: string; readonly actor: string }
export interface Signoff extends SignoffInput { readonly policy_version: string; readonly at: number }
/** The latest pull_request head Merge Control saw for a pull request, by ingress time. */
export interface RecordedHead { readonly sha: string; readonly at: number }
export type SignoffOutcome =
  | { status: 200; signoff: Signoff; posted: boolean }
  | { status: 409; error: 'kill_switch_on' | 'not_current_head' | 'no_decision' };

/** The one storage key of a sign-off: the pull request and the exact head SHA. */
export function signoffKey(pr: number, sha: string): string {
  if (!Number.isSafeInteger(pr) || pr <= 0 || !SHA.test(sha)) throw new Error('sign-off key needs a pull request and a full SHA');
  return `signoff:${pr}:${sha}`;
}
export function prHeadKey(pr: number): string {
  if (!Number.isSafeInteger(pr) || pr <= 0) throw new Error('invalid pull request');
  return `pr-head:${pr}`;
}

/** A sign-off only counts under the policy_version it was made under. */
export function currentSignoff(record: unknown): Signoff | null {
  const s = record as Signoff | undefined;
  return s && s.policy_version === POLICY_VERSION ? s : null;
}

/** The request body, or the reason it is refused. */
export function parseSignoff(body: unknown): SignoffInput | string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'invalid body';
  const { pr, head_sha: head, actor } = body as Record<string, unknown>;
  if (!Number.isSafeInteger(pr) || Number(pr) <= 0) return 'invalid pr';
  if (typeof head !== 'string' || !SHA.test(head)) return 'invalid head_sha';
  if (typeof actor !== 'string' || !ACTOR.test(actor)) return 'invalid actor';
  return Object.freeze({ pr: Number(pr), head_sha: head, actor });
}

/** `POST /signoff`: owner token, bounded JSON body, then the repository object. */
export async function signoffRequest(request: Request, env: Env): Promise<Response> {
  if (!ownerAuthorized(request, env.OWNER_TOKEN)) return new Response('unauthorized', { status: 401 });
  if (request.method !== 'POST') return new Response('not found', { status: 404 });
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(await limitedBody(request, 4096))); } catch { return new Response('invalid body', { status: 400 }); }
  const input = parseSignoff(body);
  if (typeof input === 'string') return new Response(input, { status: 400 });
  const outcome = await env.REPO_CONTROL.getByName(env.REPOSITORY).signoff(input);
  return Response.json(outcome, { status: outcome.status });
}

/** The check run a sign-off posts on its head: success, naming who signed and under which policy. */
export function signedOffCheckRunBody(decision: Decision, signoff: Signoff, repository: string): Record<string, unknown> {
  if (decision.head !== signoff.head_sha || !SHA.test(decision.head) || !SHA.test(signoff.policy_version)) throw new Error('sign-off does not match the head');
  const text = [`Event: ${decision.kind}`, `Base: ${decision.base}`, `Head: ${decision.head}`, `policy_version: ${signoff.policy_version}`,
    `Signed off by ${signoff.actor} for pull request #${signoff.pr} at ${new Date(signoff.at).toISOString()}.`, '',
    ...(decision.reasons.length ? decision.reasons.map((r) => `- ${r}`) : ['- No guard hit.'])].join('\n').slice(0, 60_000);
  return {
    name: CHECK_NAME,
    head_sha: signoff.head_sha,
    status: 'completed',
    conclusion: 'success',
    external_id: `${signoff.policy_version}:signoff`,
    details_url: `https://github.com/${repository}/blob/${signoff.policy_version}/documentation/architecture/decisions/D8834.md`,
    output: {
      title: `${decision.tier}: signed off by the owner`,
      summary: `Tier ${decision.tier}, signed off by ${signoff.actor}. policy_version ${signoff.policy_version}.`,
      text,
    },
  };
}

/** Each tracked path's `mode type sha` in a commit's full tree; refuses a truncated or malformed tree. */
async function entries(api: GithubApi, sha: string): Promise<Map<string, string>> {
  const { tree, truncated } = ((await api('GET', treePath(sha))) ?? {}) as { tree?: unknown; truncated?: unknown };
  if (truncated !== false || !Array.isArray(tree)) throw new Error(`tree of ${sha} is truncated or malformed`);
  const out = new Map<string, string>();
  for (const entry of tree) {
    const { path, mode, type, sha: blob } = (entry ?? {}) as Record<string, unknown>;
    if (typeof path !== 'string' || typeof mode !== 'string' || typeof type !== 'string' || typeof blob !== 'string') throw new Error(`malformed tree entry in ${sha}`);
    if (type !== 'tree') out.set(path, `${mode} ${type} ${blob}`);
  }
  return out;
}

/**
 * D8692's binding without git: `candidate` is one commit on `base`, and each
 * path of its tree is what a three-way merge of `base` and `head` over their
 * merge base gives. A path both sides changed differently needs a content
 * merge the API cannot check, so it is refused. Returns the problems, none
 * when bound; throws on an API error.
 */
export async function bindCandidate(api: GithubApi, input: { base: string; head: string; candidate: string }): Promise<string[]> {
  const { base, head, candidate } = input;
  if (![base, head, candidate].every((s) => SHA.test(s))) return ['T2: the binding needs full SHAs'];
  const commit = (await api('GET', `git/commits/${candidate}`)) as { parents?: { sha?: unknown }[] } | null;
  const parents = Array.isArray(commit?.parents) ? commit.parents.map((p) => p?.sha) : [];
  if (parents.length !== 1 || parents[0] !== base) {
    return [`T2: candidate ${candidate} is not one commit on the merge group base ${base}`];
  }
  const compare = (await api('GET', comparePath(base, head))) as { merge_base_commit?: { sha?: unknown } } | null;
  const mergeBase = compare?.merge_base_commit?.sha;
  if (typeof mergeBase !== 'string' || !SHA.test(mergeBase)) return [`T2: no merge base for ${base} and ${head}`];
  const cache = new Map<string, Promise<Map<string, string>>>();
  const read = (sha: string) => { if (!cache.has(sha)) cache.set(sha, entries(api, sha)); return cache.get(sha)!; };
  const [b, h, m, c] = await Promise.all([base, head, mergeBase, candidate].map(read));
  const problems: string[] = [];
  for (const path of [...new Set([...b.keys(), ...h.keys(), ...m.keys(), ...c.keys()])].sort()) {
    const [bv, hv, mv] = [b.get(path), h.get(path), m.get(path)];
    let expected: string | undefined;
    if (hv === mv || bv === hv) expected = bv;
    else if (bv === mv) expected = hv;
    else { problems.push(`T2: ${path} changed on both sides; the candidate cannot be bound to ${head} without a content merge`); continue; }
    if (c.get(path) !== expected) problems.push(`T2: candidate ${candidate} is not built from ${head}: ${path} differs`);
  }
  return problems.slice(0, MAX_PROBLEMS);
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The sign-off evidence for a T2 merge-group head. Never throws: a missing
 * pull request number, recorded head or sign-off, a sign-off under another
 * policy_version, a failed binding, an API or storage error and a timeout
 * all return `ok: false` with the reason.
 */
export async function mergeGroupSignoff(api: GithubApi, target: PolicyTarget, get: (key: string) => Promise<unknown>,
  timeoutMs = EVALUATE_TIMEOUT_MS): Promise<SignoffEvidence> {
  const refuse = (reason: string): SignoffEvidence => Object.freeze({ ok: false, reasons: Object.freeze([reason]) });
  try {
    if (target.kind !== 'merge_group' || target.pr === null) return refuse('T2: the queue branch names no pull request');
    const recorded = (await get(prHeadKey(target.pr))) as RecordedHead | undefined;
    if (!recorded || !SHA.test(recorded.sha)) return refuse(`T2: no pull request head is recorded for #${target.pr}`);
    const signoff = currentSignoff(await get(signoffKey(target.pr, recorded.sha)));
    if (!signoff) return refuse(`T2: no owner sign-off for #${target.pr} head ${recorded.sha} under policy_version ${POLICY_VERSION}`);
    const problems = await withTimeout(bindCandidate(api, { base: target.base, head: recorded.sha, candidate: target.head }), timeoutMs);
    if (problems.length) return Object.freeze({ ok: false, reasons: Object.freeze(problems) });
    return Object.freeze({ ok: true, reasons: Object.freeze([
      `Signed off by ${signoff.actor} for #${target.pr} head ${recorded.sha}; the candidate is built from that head on base ${target.base}`]) });
  } catch {
    return refuse('T2: the sign-off lookup failed');
  }
}
