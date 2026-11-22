#!/usr/bin/env node
/** D7881 (#7881): admit a delegated Worker shard using trusted GitHub metadata before candidate code is checked out. */
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPOSITORY = 'AxalNetwork/StudioOS';
const CI_PATH = '.github/workflows/ci.yml';
const PART = 'worker-1-of-6';
const DELEGATION_STEP = 'Try the MacBook for one Worker shard';
const SHA = /^[a-f0-9]{40}$/;
const ID = /^[1-9][0-9]*$/;
const QUEUE_BRANCH = /^gh-readonly-queue\/main\/pr-([1-9][0-9]*)-([a-f0-9]{40})$/;
const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);
export const ADMISSION_LIMITS = Object.freeze({ commits: 100, queueEntries: 32, runs: 100, apiCalls: 100 });

class Denied extends Error {}
const requireThat = (condition, reason) => { if (!condition) throw new Denied(reason); };
const sameId = (a, b) => ID.test(String(a ?? '')) && String(a) === String(b);
const sameRepo = (repository, repo, id) => repository?.full_name === repo && sameId(repository.id, id);

function inputs(value) {
  const input = Object.fromEntries(['repo', 'sourceSha', 'parentRunId', 'parentRunAttempt', 'part', 'queueBaseSha']
    .map((key) => [key, String(value?.[key] ?? '')]));
  requireThat(input.repo === REPOSITORY, 'invalid_repository');
  requireThat(SHA.test(input.sourceSha), 'invalid_source_sha');
  requireThat(ID.test(input.parentRunId), 'invalid_parent_run_id');
  requireThat(ID.test(input.parentRunAttempt), 'invalid_parent_run_attempt');
  requireThat(input.part === PART, 'invalid_part');
  requireThat(input.queueBaseSha === '' || SHA.test(input.queueBaseSha), 'invalid_queue_base_sha');
  return input;
}

function parentIdentity(run, input, repoId) {
  requireThat(sameId(run?.id, input.parentRunId), 'parent_run_mismatch');
  requireThat(sameId(run.run_attempt, input.parentRunAttempt), 'parent_attempt_mismatch');
  requireThat(run.path === CI_PATH, 'parent_workflow_mismatch');
  requireThat(run.head_sha === input.sourceSha, 'parent_source_mismatch');
  requireThat(ACTIVE.has(run.status) && run.conclusion == null, 'parent_not_active');
  requireThat(sameRepo(run.repository, input.repo, repoId) && sameRepo(run.head_repository, input.repo, repoId), 'parent_repository_mismatch');
  requireThat(run.event === 'push' || run.event === 'merge_group', 'parent_event_not_allowed');
  requireThat(run.event === 'push' ? run.head_branch === 'main' : QUEUE_BRANCH.test(run.head_branch ?? ''), 'parent_ref_not_allowed');
}

async function parentDelegation(get, prefix, input, expectedJobId) {
  const page = await get(`${prefix}/actions/runs/${input.parentRunId}/attempts/${input.parentRunAttempt}/jobs?per_page=100`);
  requireThat(Array.isArray(page?.jobs) && Number.isInteger(page.total_count) &&
    page.total_count === page.jobs.length && page.total_count <= 100, 'incomplete_parent_jobs');
  const jobs = page.jobs.filter((job) => job.name === `suite (${input.part})`);
  requireThat(jobs.length === 1, 'parent_job_not_unique');
  const job = jobs[0];
  requireThat(ID.test(String(job.id ?? '')) && sameId(job.run_id, input.parentRunId) &&
    sameId(job.run_attempt, input.parentRunAttempt) && job.head_sha === input.sourceSha &&
    (expectedJobId === undefined || sameId(job.id, expectedJobId)), 'parent_job_identity_mismatch');
  requireThat(job.status === 'in_progress' && job.conclusion == null, 'parent_job_not_active');
  requireThat(Array.isArray(job.steps), 'parent_delegation_step_not_unique');
  const steps = job.steps.filter((step) => step.name === DELEGATION_STEP);
  requireThat(steps.length === 1, 'parent_delegation_step_not_unique');
  requireThat(steps[0].status === 'in_progress' && steps[0].conclusion == null, 'parent_delegation_step_not_active');
  return String(job.id);
}

async function parentPlan(get, prefix, input, repoId) {
  const page = await get(`${prefix}/actions/runs/${input.parentRunId}/artifacts?name=suite-plan&per_page=100`);
  requireThat(Array.isArray(page?.artifacts) && Number.isInteger(page.total_count) &&
    page.total_count === page.artifacts.length && page.total_count <= 100, 'incomplete_parent_artifacts');
  const plans = page.artifacts.filter((artifact) => artifact.name === 'suite-plan' && artifact.expired === false);
  requireThat(plans.length === 1, 'parent_plan_not_unique');
  const plan = plans[0];
  requireThat(ID.test(String(plan.id ?? '')) && sameId(plan.workflow_run?.id, input.parentRunId) &&
    plan.workflow_run.head_sha === input.sourceSha &&
    sameId(plan.workflow_run.repository_id, repoId) && sameId(plan.workflow_run.head_repository_id, repoId), 'parent_plan_identity_mismatch');
  // A failed-job rerun can legitimately reuse this immutable artifact from an
  // earlier attempt of the same run/head. The active attempt is checked separately.
  return String(plan.id);
}

function queueRunIdentity(run, sha, firstParent, input, repoId) {
  requireThat(run?.event === 'merge_group' && run.path === CI_PATH && run.head_sha === sha &&
    sameRepo(run.repository, input.repo, repoId) && sameRepo(run.head_repository, input.repo, repoId), 'queue_run_identity_mismatch');
  const branch = QUEUE_BRANCH.exec(run.head_branch ?? '');
  requireThat(branch && branch[2] === firstParent, 'queue_run_parent_mismatch');
  return branch[1];
}

function completeComparison(comparison, base, source) {
  requireThat(comparison?.status === 'ahead' && comparison.behind_by === 0 &&
    comparison.base_commit?.sha === base && comparison.merge_base_commit?.sha === base, 'queue_base_not_ancestor');
  requireThat(Number.isInteger(comparison.total_commits) && comparison.total_commits > 0 &&
    comparison.total_commits <= ADMISSION_LIMITS.commits && Array.isArray(comparison.commits) &&
    comparison.commits.length === comparison.total_commits && comparison.ahead_by === comparison.total_commits, 'incomplete_queue_comparison');
  const commits = new Map();
  for (const commit of comparison.commits) {
    requireThat(SHA.test(commit?.sha ?? '') && !commits.has(commit.sha) &&
      Array.isArray(commit.parents) && commit.parents.length >= 1 && commit.parents.length <= 2 &&
      commit.parents.every((parent) => SHA.test(parent?.sha ?? '')) &&
      new Set(commit.parents.map((parent) => parent.sha)).size === commit.parents.length, 'invalid_queue_commit_graph');
    commits.set(commit.sha, commit);
  }
  requireThat(commits.has(source) && !commits.has(base), 'queue_source_not_in_comparison');
  return commits;
}

async function proveQueue(get, prefix, input, parent, repoId) {
  const branch = parent.head_branch;
  const refPath = `${prefix}/git/ref/heads/${branch}`;
  const readRef = async (path, expectedRef) => {
    const ref = await get(path);
    requireThat(ref?.ref === expectedRef && ref.object?.type === 'commit' && SHA.test(ref.object.sha ?? ''), 'invalid_queue_ref');
    return ref.object.sha;
  };
  const mainPath = `${prefix}/git/ref/heads/main`;
  const main = await readRef(mainPath, 'refs/heads/main');
  requireThat(await readRef(refPath, `refs/heads/${branch}`) === input.sourceSha, 'queue_ref_changed');
  const comparison = await get(`${prefix}/compare/${main}...${input.sourceSha}?per_page=100`);
  const commits = completeComparison(comparison, main, input.sourceSha);
  const chain = new Set([main]);
  const covered = new Set();
  const pullRequests = new Set();

  // The complete comparison contains every commit reachable from source but not
  // from main. A parent outside it is therefore already in trusted main ancestry.
  // Secondary parents of merge-style queue entries belong to the verified PR.
  function coverBranch(sha, visiting = new Set()) {
    if (!commits.has(sha) || covered.has(sha)) return;
    requireThat(!visiting.has(sha), 'queue_graph_cycle');
    visiting.add(sha);
    for (const parent of commits.get(sha).parents) coverBranch(parent.sha, visiting);
    visiting.delete(sha);
    covered.add(sha);
  }

  let sha = input.sourceSha;
  while (sha !== main) {
    requireThat(chain.size <= ADMISSION_LIMITS.queueEntries && !chain.has(sha), 'queue_chain_limit_or_cycle');
    const commit = commits.get(sha);
    requireThat(commit, 'queue_chain_does_not_reach_main');
    chain.add(sha);
    const firstParent = commit.parents[0].sha;
    let identities;
    if (sha === input.sourceSha) {
      identities = [queueRunIdentity(parent, sha, firstParent, input, repoId)];
    } else {
      const page = await get(`${prefix}/actions/runs?event=merge_group&head_sha=${sha}&per_page=100`);
      requireThat(Array.isArray(page?.workflow_runs) && Number.isInteger(page.total_count) &&
        page.total_count === page.workflow_runs.length && page.total_count <= ADMISSION_LIMITS.runs, 'incomplete_queue_run_history');
      const runs = page.workflow_runs.filter((run) => run.path === CI_PATH && run.event === 'merge_group' && run.head_sha === sha);
      requireThat(runs.length > 0, 'queue_entry_has_no_authenticated_run');
      identities = runs.map((run) => queueRunIdentity(run, sha, firstParent, input, repoId));
    }
    requireThat(new Set(identities).size === 1 && !pullRequests.has(identities[0]), 'ambiguous_queue_entry');
    const number = identities[0];
    pullRequests.add(number);
    const pr = await get(`${prefix}/pulls/${number}`);
    requireThat(sameId(pr?.number, number) && pr.state === 'open' && pr.base?.ref === 'main' &&
      sameRepo(pr.base.repo, input.repo, repoId) && sameRepo(pr.head?.repo, input.repo, repoId) &&
      SHA.test(pr.head?.sha ?? ''), 'queue_pull_request_not_same_repository');
    if (commit.parents.length === 2) {
      requireThat(commit.parents[1].sha === pr.head.sha, 'queue_pull_request_head_changed');
      coverBranch(commit.parents[1].sha);
    }
    covered.add(sha);
    sha = firstParent;
  }
  requireThat(covered.size === commits.size, 'queue_graph_not_fully_covered');
  requireThat(chain.has(input.queueBaseSha), 'queue_event_base_not_proven');
  requireThat(await readRef(mainPath, 'refs/heads/main') === main, 'main_changed_during_admission');
  requireThat(await readRef(refPath, `refs/heads/${branch}`) === input.sourceSha, 'queue_ref_changed');
}

/**
 * Metadata-only admission; `api(method, path, body, { signal })` is injectable.
 * Denials and unavailable evidence return allowed:false; no candidate code runs.
 * All API paths are relative to https://api.github.com and begin with `/repos/`.
 */
export async function admitMacbookJob(value, { api, signal } = {}) {
  const output = {
    allowed: false, reason: 'admission_not_completed', source_sha: '', parent_event: '', source_ref: '',
    parent_run_id: '', parent_run_attempt: '', queue_base_sha: '', plan_mode: '', plan_artifact_id: '',
  };
  try {
    const input = inputs(value);
    Object.assign(output, { source_sha: input.sourceSha, parent_run_id: input.parentRunId, parent_run_attempt: input.parentRunAttempt });
    requireThat(typeof api === 'function', 'github_api_unavailable');
    let calls = 0;
    const get = async (path) => {
      requireThat(!signal?.aborted, 'admission_cancelled');
      requireThat(++calls <= ADMISSION_LIMITS.apiCalls, 'admission_api_limit');
      return api('GET', path, undefined, { signal });
    };
    const prefix = `/repos/${input.repo}`;
    const runPath = `${prefix}/actions/runs/${input.parentRunId}`;
    const parent = await get(runPath);
    const repoId = parent?.repository?.id;
    parentIdentity(parent, input, repoId);
    const attempt = await get(`${runPath}/attempts/${input.parentRunAttempt}`);
    parentIdentity(attempt, input, repoId);
    requireThat(attempt.event === parent.event && attempt.head_branch === parent.head_branch, 'parent_attempt_identity_mismatch');
    // An active workflow may have moved this shard back to hosted execution.
    // Require the exact delegating step, not merely unrelated work in that run.
    const parentJobId = await parentDelegation(get, prefix, input);
    output.parent_event = parent.event;
    output.source_ref = `refs/heads/${parent.head_branch}`;
    if (parent.event === 'push') {
      requireThat(input.queueBaseSha === '', 'unexpected_queue_base_sha');
      output.plan_artifact_id = await parentPlan(get, prefix, input, repoId);
      output.plan_mode = 'parent-artifact';
    } else {
      requireThat(SHA.test(input.queueBaseSha), 'missing_queue_base_sha');
      await proveQueue(get, prefix, input, parent, repoId);
      output.queue_base_sha = input.queueBaseSha;
      output.plan_mode = 'equal-weights';
    }
    const finalParent = await get(runPath);
    parentIdentity(finalParent, input, repoId);
    requireThat(finalParent.event === parent.event && finalParent.head_branch === parent.head_branch, 'parent_changed_during_admission');
    await parentDelegation(get, prefix, input, parentJobId);
    output.allowed = true;
    output.reason = parent.event === 'push' ? 'trusted_main_push' : 'same_repository_merge_group';
  } catch (error) {
    output.allowed = false;
    output.reason = error instanceof Denied ? error.message : signal?.aborted ? 'admission_cancelled' : 'github_api_unavailable';
  }
  return output;
}

export function githubReadApi(token, fetcher = globalThis.fetch) {
  return async (method, path, _body, { signal } = {}) => {
    requireThat(method === 'GET' && path.startsWith(`/repos/${REPOSITORY}/`) &&
      !/(^|\/)\.\.(\/|$)/.test(path) && !path.includes('\\'), 'invalid_admission_api_request');
    requireThat(typeof token === 'string' && token.length > 0, 'missing_github_token');
    const timeout = AbortSignal.timeout(10_000);
    const response = await fetcher(`https://api.github.com${path}`, {
      method: 'GET', redirect: 'error',
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2026-03-10' },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) throw new Error('GitHub metadata request failed');
    return response.json();
  };
}

async function main(env) {
  const result = await admitMacbookJob({
    repo: env.REPO, sourceSha: env.SOURCE_SHA, parentRunId: env.PARENT_RUN_ID,
    parentRunAttempt: env.PARENT_RUN_ATTEMPT, part: env.PART, queueBaseSha: env.QUEUE_BASE_SHA,
  }, { api: githubReadApi(env.GH_TOKEN), signal: AbortSignal.timeout(60_000) });
  if (env.GITHUB_OUTPUT) {
    appendFileSync(env.GITHUB_OUTPUT, Object.entries(result).map(([key, value]) => `${key}=${value}\n`).join(''));
  }
  console.log(JSON.stringify(result));
  return result.allowed ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await main(process.env);
}
