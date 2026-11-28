/**
 * D8966 (#8966, D5569 part 5): unmounted reconciliation of publication reservations the broker could not settle. A row
 * left `unknown` (a write began, then a timeout, rate limit or lost response) or left `reserved` past the deadline is
 * compared with what GitHub holds at `agent/<task>/<attempt>` and with the PR whose head is that branch. It becomes
 * `published` only when the ref SHA, the recorded candidate SHA, the PR head, the PR base and the canonical PR URL all
 * agree; anything else is `refused` with the evidence kept, and the branch is never deleted. A read that fails leaves
 * the row's state as it is and records only when to look again. The transport is read-only: this module never writes
 * to GitHub and never replays a publication.
 */
import type { Env } from '../../types';
import { classifyGithubResponse } from './agentPublisher';

/**
 * How long a reservation must have gone without an outcome before it is reconciled, in milliseconds. Measured from
 * `last_outcome_at_ms` (when the broker left the row `unknown`), else from `created_at_ms` (when it reserved it). A
 * broker invocation makes at most a dozen 15-second requests, so a live one has ended long before this.
 */
export const RECONCILE_AFTER_MS = 30 * 60_000;
/** When an unreadable answer (5xx, timeout, 401, malformed body) is read again. */
export const RECONCILE_RETRY_MS = 5 * 60_000;
/** A 403 that is not a rate limit: the installation lost access, which waiting rarely clears. */
export const RECONCILE_FORBIDDEN_RETRY_MS = 60 * 60_000;
export const RECONCILE_BATCH_MAX = 100;
const SHA = /^[a-f0-9]{40}$/;
const PULL_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]{0,9})$/;
/** At most this many PRs are listed in the evidence; a full page is refused as ambiguous. */
const PULLS_PAGE = 100;
const PULLS_KEPT = 10;

export type GitReadResponse = { status: number; body: string; headers: { get(name: string): string | null } };
/**
 * A read-only, repository-scoped transport the platform builds from the broker's installation token. It prefixes the
 * fixed API origin and `/repos/<owner>/<name>`, rejects redirects and bounds time and size, and throws when no response
 * arrived. It has no write method; the reconciler keeps only its `get`.
 */
export type GitReadTransport = {
  readonly repository_full_name: string;
  get(path: string): Promise<GitReadResponse>;
};
export type ReconcileTarget = { installation_uid: string; repository_full_name: string };
export type ReconcilePorts = {
  /** Throws, or returns a transport for another repository, when the installation cannot be read. */
  transportFor(target: ReconcileTarget): Promise<GitReadTransport>;
  now(): number;
};

export type ReconcileReason =
  | 'ref_missing' | 'ref_sha_differs' | 'pr_missing' | 'pr_multiple' | 'pr_head_differs' | 'pr_base_differs'
  | 'pr_url_differs';
export type ReconcileEvidence = {
  version: 1;
  outcome: 'published' | 'absent' | 'mismatch';
  prior_state: 'unknown' | 'reserved';
  checked_at_ms: number;
  ref: { name: string; sha: string } | null;
  candidate_sha: string;
  pulls_total: number;
  pulls: { number: number; url: string; head_sha: string; base_matches: boolean; state: 'open' | 'closed'; merged: boolean; draft: boolean }[];
  reasons: ReconcileReason[];
};
export type ReconcileOutcome =
  | { id: number; outcome: 'published'; pr_number: number; pr_url: string }
  | { id: number; outcome: 'absent'; retry_at_ms: number | null }
  | { id: number; outcome: 'mismatch'; reasons: ReconcileReason[] }
  /** A `reserved` row a retry re-opened: its start time is not recorded, so the deadline starts now. */
  | { id: number; outcome: 'deferred'; retry_at_ms: number }
  | { id: number; outcome: 'unreadable'; code: 'github_unavailable' | 'github_rate_limited' | 'github_forbidden'; retry_at_ms: number }
  /** The broker or another reconciler changed the row between the read and this write: nothing was written. */
  | { id: number; outcome: 'raced' };

type Row = {
  id: number; installation_uid: string; repository_full_name: string; target_ref: string; head_ref: string;
  candidate_sha: string; state: 'unknown' | 'reserved'; attempts: number; retry_at_ms: number | null;
  last_outcome_at_ms: number | null; created_at_ms: number;
};
type Pull = ReconcileEvidence['pulls'][number] & { repo_matches: boolean };

class Unreadable extends Error {
  readonly code: 'github_unavailable' | 'github_rate_limited' | 'github_forbidden';
  readonly retryAtMs: number;
  constructor(code: Unreadable['code'], retryAtMs: number) { super(code); this.code = code; this.retryAtMs = retryAtMs; }
}

const sameRepo = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const segments = (path: string) => path.split('/').map(encodeURIComponent).join('/');

/** Rows left `unknown`, or `reserved` and abandoned, oldest first. Only `get` is ever called on GitHub. */
export async function reconcileAgentPublications(
  env: Pick<Env, 'DB'>,
  ports: ReconcilePorts,
  options: { limit?: number } = {},
): Promise<ReconcileOutcome[]> {
  const now = ports.now();
  const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 25) || 25, RECONCILE_BATCH_MAX));
  const rows = (await env.DB.prepare(`SELECT id, installation_uid, repository_full_name, target_ref, head_ref,
      candidate_sha, state, attempts, retry_at_ms, last_outcome_at_ms, created_at_ms
    FROM agent_publish_requests
    WHERE state IN ('unknown', 'reserved')
      AND ((retry_at_ms IS NOT NULL AND retry_at_ms <= ?)
        OR (retry_at_ms IS NULL AND COALESCE(last_outcome_at_ms, created_at_ms) <= ?))
    ORDER BY COALESCE(retry_at_ms, last_outcome_at_ms, created_at_ms), id LIMIT ?`)
    .bind(now, now - RECONCILE_AFTER_MS, limit).all<Row>()).results ?? [];
  const outcomes: ReconcileOutcome[] = [];
  for (const row of rows) outcomes.push(await reconcileRow(env, ports, row, now));
  return outcomes;
}

/** Each write is a compare-and-set on the row as it was read, so a broker that moved it in between always wins. */
const changed = (result: { meta: { changes?: number } }) => Number(result.meta.changes) === 1;
const asRead = (row: Row) => [row.id, row.state, row.attempts, row.retry_at_ms, row.last_outcome_at_ms];

/** Only the time to look again; the state, attempts and outcome stay as they are. */
async function recordRetry(env: Pick<Env, 'DB'>, row: Row, retryAtMs: number): Promise<boolean> {
  return changed(await env.DB.prepare(`UPDATE agent_publish_requests SET retry_at_ms = ?
    WHERE id = ? AND state = ? AND attempts = ? AND retry_at_ms IS ? AND last_outcome_at_ms IS ?`)
    .bind(retryAtMs, ...asRead(row)).run());
}

async function recordPublished(env: Pick<Env, 'DB'>, row: Row, number: number, url: string, evidence: string, now: number): Promise<boolean> {
  return changed(await env.DB.prepare(`UPDATE agent_publish_requests SET state = 'published', pr_number = ?, pr_url = ?,
      retry_at_ms = NULL, last_outcome_at_ms = ?, reconcile_evidence_json = ?, reconciled_at_ms = ?
    WHERE id = ? AND state = ? AND attempts = ? AND retry_at_ms IS ? AND last_outcome_at_ms IS ?`)
    .bind(number, url, now, evidence, now, ...asRead(row)).run());
}

async function recordRefused(env: Pick<Env, 'DB'>, row: Row, retryAtMs: number | null, evidence: string, now: number): Promise<boolean> {
  return changed(await env.DB.prepare(`UPDATE agent_publish_requests SET state = 'refused', retry_at_ms = ?,
      last_outcome_at_ms = ?, reconcile_evidence_json = ?, reconciled_at_ms = ?
    WHERE id = ? AND state = ? AND attempts = ? AND retry_at_ms IS ? AND last_outcome_at_ms IS ?`)
    .bind(retryAtMs, now, evidence, now, ...asRead(row)).run());
}

async function reconcileRow(env: Pick<Env, 'DB'>, ports: ReconcilePorts, row: Row, now: number): Promise<ReconcileOutcome> {
  // A broker retry re-reserves a refused row without recording when; wait a full deadline from first sight.
  if (row.state === 'reserved' && row.retry_at_ms === null && row.last_outcome_at_ms !== null) {
    const retryAt = now + RECONCILE_AFTER_MS;
    return await recordRetry(env, row, retryAt)
      ? { id: row.id, outcome: 'deferred', retry_at_ms: retryAt } : { id: row.id, outcome: 'raced' };
  }
  let ref: { name: string; sha: string } | null;
  let pulls: Pull[];
  let pullsTotal: number;
  try {
    let transport: GitReadTransport;
    try { transport = await ports.transportFor({ installation_uid: row.installation_uid, repository_full_name: row.repository_full_name }); }
    catch { throw new Unreadable('github_unavailable', now + RECONCILE_RETRY_MS); }
    if (typeof transport?.repository_full_name !== 'string' || !sameRepo(transport.repository_full_name, row.repository_full_name)
        || typeof transport.get !== 'function') throw new Unreadable('github_unavailable', now + RECONCILE_RETRY_MS);
    const get = transport.get.bind(transport);
    ({ ref } = await readRef(get, row, now));
    ({ pulls, total: pullsTotal } = await readPulls(get, row, now));
  } catch (error) {
    const failure = error instanceof Unreadable ? error : new Unreadable('github_unavailable', now + RECONCILE_RETRY_MS);
    return await recordRetry(env, row, failure.retryAtMs)
      ? { id: row.id, outcome: 'unreadable', code: failure.code, retry_at_ms: failure.retryAtMs } : { id: row.id, outcome: 'raced' };
  }

  const reasons: ReconcileReason[] = [];
  if (!ref) reasons.push('ref_missing');
  else if (ref.sha !== row.candidate_sha) reasons.push('ref_sha_differs');
  if (pullsTotal === 0) reasons.push('pr_missing');
  else if (pullsTotal > 1) reasons.push('pr_multiple');
  else {
    const pull = pulls[0];
    if (pull.head_sha !== row.candidate_sha) reasons.push('pr_head_differs');
    if (!pull.base_matches) reasons.push('pr_base_differs');
    if (!pull.repo_matches) reasons.push('pr_url_differs');
  }
  const absent = !ref && pullsTotal === 0;
  const outcome: ReconcileEvidence['outcome'] = reasons.length === 0 ? 'published' : absent ? 'absent' : 'mismatch';
  const evidence: ReconcileEvidence = {
    version: 1, outcome, prior_state: row.state, checked_at_ms: now, ref, candidate_sha: row.candidate_sha,
    pulls_total: pullsTotal,
    pulls: pulls.slice(0, PULLS_KEPT).map(({ repo_matches: _drop, ...pull }) => pull),
    reasons: absent ? [] : reasons,
  };
  const json = JSON.stringify(evidence);
  if (outcome === 'published') {
    const pull = pulls[0];
    return await recordPublished(env, row, pull.number, pull.url, json, now)
      ? { id: row.id, outcome: 'published', pr_number: pull.number, pr_url: pull.url } : { id: row.id, outcome: 'raced' };
  }
  // Nothing reached GitHub: the broker's own bounded retry may try again (it re-verifies everything and creates the
  // branch only if it does not exist). Any trace on GitHub that does not match is kept for a person to read.
  const retryAt = absent && row.attempts < 5 ? now : null;
  return await recordRefused(env, row, retryAt, json, now)
    ? (absent ? { id: row.id, outcome: 'absent', retry_at_ms: retryAt } : { id: row.id, outcome: 'mismatch', reasons })
    : { id: row.id, outcome: 'raced' };
}

type Get = GitReadTransport['get'];

async function call(get: Get, path: string, now: number): Promise<GitReadResponse | null> {
  let response: GitReadResponse;
  try { response = await get(path); } catch { throw new Unreadable('github_unavailable', now + RECONCILE_RETRY_MS); }
  if (response?.status === 200) return response;
  if (response?.status === 404) return null;
  if (response?.status === 403 || response?.status === 429) {
    const seconds = response.headers.get('retry-after');
    const classified = classifyGithubResponse({
      status: response.status, at_ms: now, consecutive: 1,
      secondary: /secondary rate limit|abuse detection/i.test(String(response.body)),
      retry_after_s: seconds === null ? null : Number(seconds),
      ratelimit_remaining: response.headers.get('x-ratelimit-remaining') === '0' ? 0 : null,
      ratelimit_reset_s: Number(response.headers.get('x-ratelimit-reset')) || null,
    });
    if (classified.kind === 'rate_limited') throw new Unreadable('github_rate_limited', classified.retry_at_ms);
    throw new Unreadable('github_forbidden', now + RECONCILE_FORBIDDEN_RETRY_MS);
  }
  throw new Unreadable('github_unavailable', now + RECONCILE_RETRY_MS);
}

function parse(response: GitReadResponse, now: number): unknown {
  try { return JSON.parse(response.body); } catch { throw new Unreadable('github_unavailable', now + RECONCILE_RETRY_MS); }
}

async function readRef(get: Get, row: Row, now: number): Promise<{ ref: { name: string; sha: string } | null }> {
  const name = 'refs/heads/' + row.head_ref;
  const response = await call(get, '/git/ref/' + segments('heads/' + row.head_ref), now);
  if (!response) return { ref: null };
  const body = parse(response, now);
  const sha = isObject(body) && isObject(body.object) ? body.object.sha : undefined;
  // An answer for another ref (GitHub's prefix match) or without a SHA is not an observation of this branch.
  if (!isObject(body) || body.ref !== name || typeof sha !== 'string' || !SHA.test(sha)) {
    throw new Unreadable('github_unavailable', now + RECONCILE_RETRY_MS);
  }
  return { ref: { name, sha } };
}

async function readPulls(get: Get, row: Row, now: number): Promise<{ pulls: Pull[]; total: number }> {
  const owner = row.repository_full_name.split('/')[0];
  const query = new URLSearchParams({ head: owner + ':' + row.head_ref, state: 'all', per_page: String(PULLS_PAGE) });
  const response = await call(get, '/pulls?' + query.toString(), now);
  if (!response) throw new Unreadable('github_unavailable', now + RECONCILE_RETRY_MS);
  const body = parse(response, now);
  if (!Array.isArray(body)) throw new Unreadable('github_unavailable', now + RECONCILE_RETRY_MS);
  const base = row.target_ref.startsWith('refs/heads/') ? row.target_ref.slice('refs/heads/'.length) : row.target_ref;
  const pulls: Pull[] = [];
  for (const item of body) {
    const head = isObject(item) ? item.head : undefined;
    const headRepo = isObject(head) ? head.repo : undefined;
    // `head=<owner>:<branch>` is GitHub's filter; a listed PR for another head is ignored, not trusted.
    if (!isObject(item) || !isObject(head) || head.ref !== row.head_ref
        || !isObject(headRepo) || typeof headRepo.full_name !== 'string' || !sameRepo(headRepo.full_name, row.repository_full_name)) continue;
    const number = item.number, url = item.html_url, headSha = head.sha;
    const baseRef = isObject(item.base) ? item.base.ref : undefined;
    if (!Number.isSafeInteger(number) || Number(number) <= 0 || typeof url !== 'string' || typeof headSha !== 'string'
        || !SHA.test(headSha) || (item.state !== 'open' && item.state !== 'closed')) {
      throw new Unreadable('github_unavailable', now + RECONCILE_RETRY_MS);
    }
    const canonical = PULL_URL.exec(url);
    pulls.push({
      number: Number(number), url: canonical ? url : '', head_sha: headSha, base_matches: baseRef === base,
      state: item.state, merged: typeof item.merged_at === 'string', draft: item.draft === true,
      repo_matches: !!canonical && sameRepo(canonical[1], row.repository_full_name) && Number(canonical[2]) === number,
    });
  }
  // A full page may hide more: never call that one PR.
  return { pulls, total: body.length >= PULLS_PAGE ? Math.max(pulls.length, 2) : pulls.length };
}
