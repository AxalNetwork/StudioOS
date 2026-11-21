/**
 * D5569 part 3: unmounted privileged GitHub publisher executor. The server supplies authorization and WorkIntent
 * evidence, while D1 reserves one logical task before any network call. Tokens remain local to this invocation.
 * An uncertain write stays reserved for reconciliation; retries never guess that a branch or PR was not created.
 */
import type { Env } from '../../types';
import {
  classifyGithubResponse, intentDigest, planAgentPublish, publisherEnabled, publishIntentProblem,
  type PublishIntent, type PublisherObservations, type PublisherRefusal,
} from './agentPublisher';
import { inspectVentureGitPublisher, type VentureGitScope } from './ventureGitInstallation';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const SHA = /^[a-f0-9]{40}$/;
const MAX_PENDING = 100;
const API = 'https://api.github.com';

export type PublisherPreflight = {
  candidate_sha: string;
  observations: PublisherObservations;
  /** Loaded by the server from WorkGraph; never accepted from a workspace request. */
  work_intent: {
    uid: string; tenant_id: number; company_id: number; project_id: number;
    repository_full_name: string; task_id: string; agent_id: string; run_uuid: string;
    base_sha: string; paths: string[]; expires_at_ms: number; state: 'active' | 'revoked';
  } | null;
};

export type PublisherBrokerPorts = {
  /** Both authorization and evidence reads must use the platform's current records. */
  authorize(scope: VentureGitScope, intent: PublishIntent): Promise<boolean>;
  preflight(scope: VentureGitScope, intent: PublishIntent, candidateSha: string): Promise<PublisherPreflight>;
  /** The privileged signer supplies a short-lived JWT for this separate write App only. */
  appJwt(appId: number): Promise<string>;
  fetch: typeof fetch;
  now(): number;
};

export type BrokerResult =
  | { ok: true; number: number; url: string; commit_sha: string; replayed: boolean }
  | PublisherRefusal
  | { ok: false; code: 'not_authorized' | 'work_intent_required' | 'candidate_mismatch' | 'queue_full'
      | 'publication_pending' | 'github_unavailable';
      retryable: boolean };

type PublicationRow = {
  intent_digest: string; candidate_sha: string; state: string; pr_number: number | null; pr_url: string | null; attempts: number; retry_at_ms: number | null;
};
type Json = Record<string, unknown>;

class GithubFailure extends Error {
  readonly status: number;
  readonly retryAt?: string;
  constructor(status: number, retryAt?: string) {
    super('github_request_failed');
    this.status = status;
    this.retryAt = retryAt;
  }
}

async function boundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new GithubFailure(0);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_BODY_BYTES) throw new GithubFailure(0);
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}

function workMatches(work: PublisherPreflight['work_intent'], scope: VentureGitScope, intent: PublishIntent, now: number): boolean {
  return !!work && work.state === 'active' && !!work.uid && work.tenant_id === scope.tenant_id
    && work.company_id === scope.company_id && work.project_id === scope.project_id
    && sameRepo(work.repository_full_name, intent.repository_full_name)
    && work.task_id === intent.provenance.task_id && work.agent_id === intent.provenance.agent_id
    && work.run_uuid === intent.provenance.run_uuid && work.base_sha === intent.base_sha
    && Number.isSafeInteger(work.expires_at_ms) && work.expires_at_ms > now
    && Array.isArray(work.paths) && intent.files.every(file => work.paths.includes(file.path));
}

/** Sign with a broker-owned non-extractable RS256 key. Neither key nor JWT is a workspace artifact. */
export async function publisherAppJwt(appId: number, key: CryptoKey, now: number): Promise<string> {
  if (!Number.isSafeInteger(appId) || appId <= 0 || !Number.isSafeInteger(now) || now < 0
      || key.extractable || key.type !== 'private' || key.algorithm.name !== 'RSASSA-PKCS1-v1_5'
      || (key.algorithm as CryptoKeyRsaKeyAlgorithm).hash?.name !== 'SHA-256') throw new Error('invalid_publisher_signer');
  const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const json = (value: object) => encode(new TextEncoder().encode(JSON.stringify(value)));
  const seconds = Math.floor(now / 1000);
  const unsigned = json({ alg: 'RS256', typ: 'JWT' }) + '.' + json({ iss: String(appId), iat: seconds - 60, exp: seconds + 540 });
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  return unsigned + '.' + encode(new Uint8Array(signature));
}

const sameRepo = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const hash = async (text: string) => {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return 'sha256:' + [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
};

/** Disabled by default. No route, queue handler or Env binding enables this entry point. */
export async function executeAgentPublication(
  env: Pick<Env, 'DB'>,
  scope: VentureGitScope,
  intent: PublishIntent,
  candidateSha: string,
  flag: unknown,
  ports: PublisherBrokerPorts,
): Promise<BrokerResult> {
  if (!publisherEnabled(flag)) return { ok: false, code: 'publisher_disabled', retryable: false };
  const invalid = publishIntentProblem(intent);
  if (invalid) return { ok: false, code: 'invalid_intent', retryable: false, field: invalid };
  if (!await ports.authorize(scope, intent)) return { ok: false, code: 'not_authorized', retryable: false };
  if (scope.tenant_id !== intent.tenant_id || scope.company_id !== intent.company_id || scope.project_id !== intent.project_id) {
    return { ok: false, code: 'not_authorized', retryable: false };
  }
  if (!SHA.test(candidateSha)) return { ok: false, code: 'candidate_mismatch', retryable: false };

  const inspection = await inspectVentureGitPublisher(env.DB, scope, intent.installation_uid);
  if (inspection.code !== 'venture_git_publisher_disabled' || !('installation' in inspection)) {
    return { ok: false, code: 'installation_not_found', retryable: false };
  }
  const installation = inspection.installation;
  const evidence = await ports.preflight(scope, intent, candidateSha);
  const work = evidence.work_intent;
  if (!workMatches(work, scope, intent, ports.now())) {
    return { ok: false, code: 'work_intent_required', retryable: false };
  }
  if (evidence.candidate_sha !== candidateSha) return { ok: false, code: 'candidate_mismatch', retryable: false };
  const observations = evidence.observations;
  // The trusted evidence may narrow paths, but never replace the canonical installation's scope or approval.
  observations.installation = observations.installation && {
    ...observations.installation, ...installation,
  };
  observations.now_ms = ports.now();
  observations.enabled = true;
  const decision = await planAgentPublish(intent, observations);
  if (!decision.ok) return decision;
  const plan = decision.plan;
  const digest = await intentDigest(intent);
  const bind = [scope.tenant_id, scope.company_id, scope.project_id, installation.uid, intent.provenance.task_id];
  const read = () => env.DB.prepare(`SELECT intent_digest, candidate_sha, state, pr_number, pr_url, attempts, retry_at_ms
    FROM agent_publish_requests WHERE tenant_id=? AND company_id=? AND project_id=? AND installation_uid=? AND task_id=?`)
    .bind(...bind).first<PublicationRow>();
  const priorResult = (row: PublicationRow): BrokerResult => {
    if (row.intent_digest !== digest || row.candidate_sha !== candidateSha) return { ok: false, code: 'idempotency_conflict', retryable: false };
    if (row.state === 'published' && row.pr_number && row.pr_url) {
      return { ok: true, number: row.pr_number, url: row.pr_url, commit_sha: candidateSha, replayed: true };
    }
    return { ok: false, code: 'publication_pending', retryable: false };
  };
  const prior = await read();
  let attempts = 1;
  if (prior) {
    if (prior.intent_digest !== digest || prior.candidate_sha !== candidateSha || prior.state !== 'refused'
        || prior.retry_at_ms === null || prior.retry_at_ms > ports.now() || prior.attempts >= 5) return priorResult(prior);
    const retried = await env.DB.prepare(`UPDATE agent_publish_requests SET state='reserved',attempts=attempts+1,retry_at_ms=NULL
      WHERE tenant_id=? AND company_id=? AND project_id=? AND installation_uid=? AND task_id=?
        AND state='refused' AND retry_at_ms<=? AND attempts<5
        AND (SELECT COUNT(*) FROM agent_publish_requests WHERE tenant_id=? AND state IN ('reserved','unknown')) < ?`)
      .bind(...bind, ports.now(), scope.tenant_id, MAX_PENDING).run();
    if (!Number(retried.meta.changes)) return { ok: false, code: 'publication_pending', retryable: false };
    attempts = prior.attempts + 1;
  } else {
    const reserved = await env.DB.prepare(`INSERT INTO agent_publish_requests
      (tenant_id, company_id, project_id, installation_uid, task_id, agent_id, run_uuid, idempotency_key,
       intent_digest, patch_digest, candidate_sha, base_sha, work_intent_uid, approvals_json,
       repository_full_name, target_ref, head_ref, state, created_at_ms)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'reserved',?
      WHERE (SELECT COUNT(*) FROM agent_publish_requests WHERE tenant_id=? AND state IN ('reserved','unknown')) < ?
      ON CONFLICT DO NOTHING`).bind(...bind, intent.provenance.agent_id, intent.provenance.run_uuid, intent.idempotency_key,
        digest, intent.patch_digest, candidateSha, intent.base_sha, work!.uid, JSON.stringify(observations.approvals),
        installation.repository_full_name, installation.base_ref, plan.head_branch,
        ports.now(), scope.tenant_id, MAX_PENDING).run();
    if (!Number(reserved.meta.changes)) {
      const raced = await read();
      if (raced) return priorResult(raced);
      const sameKey = await env.DB.prepare(`SELECT task_id FROM agent_publish_requests WHERE
        tenant_id=? AND company_id=? AND project_id=? AND installation_uid=? AND idempotency_key=?`)
        .bind(scope.tenant_id, scope.company_id, scope.project_id, installation.uid, intent.idempotency_key).first();
      return sameKey ? { ok: false, code: 'idempotency_conflict', retryable: false }
        : { ok: false, code: 'queue_full', retryable: true };
    }
  }

  let writeStarted = false;
  let retryAtMs: number | null = null;
  let token: string | null = null;
  const repoPath = '/repos/' + installation.repository_full_name.split('/').map(encodeURIComponent).join('/');
  const request = async (path: string, credential: string, body?: Json, accept = 'application/vnd.github+json') => {
    const response = await ports.fetch(API + path, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { Accept: accept, Authorization: 'Bearer ' + credential, 'User-Agent': 'StudioOS-agent-publisher',
        'X-GitHub-Api-Version': '2026-03-10', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      if (response.status === 403 || response.status === 429) {
        const detail = await boundedText(response);
        const seconds = response.headers.get('retry-after');
        const classified = classifyGithubResponse({
          status: response.status, at_ms: ports.now(), consecutive: attempts,
          secondary: /secondary rate limit|abuse detection/i.test(detail),
          retry_after_s: seconds === null ? null : Number(seconds),
          ratelimit_remaining: response.headers.get('x-ratelimit-remaining') === '0' ? 0 : null,
          ratelimit_reset_s: Number(response.headers.get('x-ratelimit-reset')) || null,
        });
        throw new GithubFailure(response.status, classified.kind === 'rate_limited'
          ? new Date(classified.retry_at_ms).toISOString() : undefined);
      }
      await response.body?.cancel();
      throw new GithubFailure(response.status);
    }
    return boundedText(response);
  };
  const json = async (path: string, credential: string, body?: Json): Promise<Json> =>
    JSON.parse(await request(path, credential, body)) as Json;
  try {
    const jwt = await ports.appJwt(installation.app_id);
    const live = await json('/app/installations/' + installation.installation_id, jwt);
    if (live.id !== installation.installation_id || live.app_id !== installation.app_id || live.suspended_at !== null) {
      throw new GithubFailure(401);
    }
    const minted = await json('/app/installations/' + installation.installation_id + '/access_tokens', jwt, {
      repository_ids: [installation.repository_id],
      permissions: { contents: 'write', pull_requests: 'write', metadata: 'read', checks: 'read' },
    });
    const expires = Date.parse(String(minted.expires_at));
    if (typeof minted.token !== 'string' || !minted.token || !Number.isFinite(expires)
        || expires <= ports.now() + 30_000 || expires > ports.now() + 65 * 60_000) throw new GithubFailure(401);
    token = minted.token;
    const repo = await json(repoPath, token);
    if (repo.id !== installation.repository_id || typeof repo.full_name !== 'string'
        || !sameRepo(repo.full_name, installation.repository_full_name)) throw new GithubFailure(401);
    const commit = await json(repoPath + '/git/commits/' + candidateSha, token);
    const parents = commit.parents as { sha: string }[] | undefined;
    if (commit.sha !== candidateSha || !Array.isArray(parents) || parents.length !== 1 || parents[0].sha !== intent.base_sha) {
      return { ok: false, code: 'candidate_mismatch', retryable: false };
    }
    const comparePath = repoPath + '/compare/' + intent.base_sha + '...' + candidateSha;
    const comparison = await json(comparePath, token);
    const files = comparison.files as { filename: string; status: string }[] | undefined;
    const statuses: Record<string, string> = { added: 'added', modified: 'modified', removed: 'removed' };
    if (comparison.total_commits !== 1 || !Array.isArray(files) || files.length !== intent.files.length || new Set(files.map(file => file.filename)).size !== files.length
        || files.some(file => !intent.files.some(expected => expected.path === file.filename && statuses[file.status] === expected.change))
        || await hash(await request(comparePath, token, undefined, 'application/vnd.github.diff')) !== intent.patch_digest) {
      return { ok: false, code: 'candidate_mismatch', retryable: false };
    }
    // Recheck current scope, WorkIntent, checks and base immediately before a write.
    const current = await inspectVentureGitPublisher(env.DB, scope, intent.installation_uid);
    if (current.code !== 'venture_git_publisher_disabled' || !('installation' in current)
        || current.installation.app_id !== installation.app_id
        || current.installation.installation_id !== installation.installation_id
        || current.installation.repository_id !== installation.repository_id
        || !sameRepo(current.installation.repository_full_name, installation.repository_full_name)
        || current.installation.base_ref !== installation.base_ref) throw new GithubFailure(401);
    const fresh = await ports.preflight(scope, intent, candidateSha);
    if (!workMatches(fresh.work_intent, scope, intent, ports.now()) || fresh.work_intent!.uid !== work!.uid
        || fresh.candidate_sha !== candidateSha) {
      return { ok: false, code: 'work_intent_required', retryable: false };
    }
    const finalPlan = await planAgentPublish(intent, {
      ...fresh.observations, enabled: true, now_ms: ports.now(),
      installation: fresh.observations.installation && { ...fresh.observations.installation, ...current.installation },
    });
    if (!finalPlan.ok) return finalPlan;
    if (finalPlan.plan.intent_digest !== plan.intent_digest) return { ok: false, code: 'candidate_mismatch', retryable: false };
    const base = await json(repoPath + '/git/ref/' + encodeURIComponent(installation.base_ref.slice(5)), token);
    if ((base.object as { sha?: string } | undefined)?.sha !== intent.base_sha) {
      return { ok: false, code: 'base_moved', retryable: false };
    }
    const approvalReceipt = await env.DB.prepare(`UPDATE agent_publish_requests SET approvals_json=? WHERE
      tenant_id=? AND company_id=? AND project_id=? AND installation_uid=? AND task_id=? AND state='reserved'`)
      .bind(JSON.stringify(fresh.observations.approvals), ...bind).run();
    if (!Number(approvalReceipt.meta.changes)) return { ok: false, code: 'publication_pending', retryable: false };
    const final = finalPlan.plan;
    writeStarted = true;
    const branch = await json(repoPath + '/git/refs', token, { ref: 'refs/heads/' + final.head_branch, sha: candidateSha });
    if (branch.ref !== 'refs/heads/' + final.head_branch
        || (branch.object as { sha?: string } | undefined)?.sha !== candidateSha) throw new GithubFailure(0);
    const created = await json(repoPath + '/pulls', token, {
      head: final.head_branch, base: final.base_ref.slice('refs/heads/'.length), title: final.title, body: final.body,
      draft: true, maintainer_can_modify: false,
    });
    const number = created.number;
    const expectedUrl = 'https://github.com/' + repo.full_name + '/pull/' + number;
    if (!Number.isSafeInteger(number) || Number(number) <= 0 || created.html_url !== expectedUrl
        || created.draft !== true || (created.head as { sha?: string } | undefined)?.sha !== candidateSha) {
      throw new GithubFailure(0);
    }
    const saved = await env.DB.prepare(`UPDATE agent_publish_requests SET state='published',pr_number=?,pr_url=?,last_outcome_at_ms=? WHERE
      tenant_id=? AND company_id=? AND project_id=? AND installation_uid=? AND task_id=? AND state='reserved'`)
      .bind(number, expectedUrl, ports.now(), ...bind).run();
    if (Number(saved.meta.changes) !== 1) throw new GithubFailure(0);
    return { ok: true, number: Number(number), url: expectedUrl, commit_sha: candidateSha, replayed: false };
  } catch (error) {
    if (error instanceof GithubFailure && (error.status === 403 || error.status === 429)) {
      if (!writeStarted && error.retryAt && attempts < 5) retryAtMs = Date.parse(error.retryAt);
      return error.retryAt
        ? { ok: false, code: 'github_rate_limited', retryable: retryAtMs !== null, retry_at: error.retryAt }
        : { ok: false, code: 'github_forbidden', retryable: false };
    }
    if (!writeStarted && attempts < 5) retryAtMs = ports.now() + Math.min(60_000 * 2 ** (attempts - 1), 3_600_000);
    return { ok: false, code: 'github_unavailable', retryable: retryAtMs !== null };
  } finally {
    token = null;
    // A failed read is safe to retry after reconciliation. A possibly accepted write is never automatically replayed.
    await env.DB.prepare(`UPDATE agent_publish_requests SET state=?,last_outcome_at_ms=?,retry_at_ms=? WHERE
      tenant_id=? AND company_id=? AND project_id=? AND installation_uid=? AND task_id=? AND state='reserved'`)
      .bind(writeStarted ? 'unknown' : 'refused', ports.now(), retryAtMs, ...bind).run();
  }
}
