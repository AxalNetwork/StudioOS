#!/usr/bin/env node
/**
 * D7881 (#7881): bounded, optional delegation of one existing Worker shard.
 * The hosted suite job remains the authority. A trusted main workflow admits
 * the source independently before the Mac checks it out or runs its tests.
 * No runner-inventory permission, App key, arbitrary ref or command is used.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const REPOSITORY = 'AxalNetwork/StudioOS';
export const PART = 'worker-1-of-6';
export const WORKFLOW = 'macbook-worker.yml';
export const WORKFLOW_PATH = `.github/workflows/${WORKFLOW}`;
export const MAC_JOB_NAME = 'Worker shard on MacBook';
export const TEST_STEP_NAME = 'Run delegated Worker shard';
export const RUNNER_GROUP_ID = 4;
export const LIMITS = Object.freeze({
  startTimeoutMs: 90_000,
  completionTimeoutMs: 25 * 60_000,
  pollMs: 5_000,
  runningPollMs: 15_000,
  parentPollMs: 30_000,
  cancelTimeoutMs: 30_000,
});

const ROOT = `/repos/${REPOSITORY}`;
const WORKFLOW_API = `${ROOT}/actions/workflows/${WORKFLOW}`;
const ACTIVE = ['in_progress', 'queued', 'waiting', 'pending', 'requested'];
const SHA = /^[a-f0-9]{40}$/;
const id = value => /^(?:[1-9][0-9]*)$/.test(String(value ?? '')) &&
  Number.isSafeInteger(Number(value)) ? String(value) : null;
const isDone = run => run?.status === 'completed';
const runPath = runId => `${ROOT}/actions/runs/${runId}`;

export function configFromEnv(env = process.env, event = {}) {
  return {
    enabled: env.MACBOOK_WORKER_ENABLED === 'true',
    repo: env.GITHUB_REPOSITORY,
    event: env.GITHUB_EVENT_NAME,
    ref: env.GITHUB_REF,
    sourceSha: env.GITHUB_SHA,
    parentRunId: env.GITHUB_RUN_ID,
    parentRunAttempt: env.GITHUB_RUN_ATTEMPT,
    part: env.PART,
    queueBaseSha: env.GITHUB_EVENT_NAME === 'merge_group' ? event.merge_group?.base_sha : '',
  };
}

export function configurationProblem(config) {
  if (!config.enabled) return 'disabled';
  if (config.repo !== REPOSITORY) return 'repository_not_allowed';
  if (config.part !== PART) return 'part_not_selected';
  if (!SHA.test(config.sourceSha || '') || !id(config.parentRunId) ||
      !id(config.parentRunAttempt)) return 'invalid_parent_identity';
  if (config.event === 'push' && config.ref === 'refs/heads/main') {
    return config.queueBaseSha ? 'invalid_queue_context' : null;
  }
  if (config.event === 'merge_group' &&
      /^refs\/heads\/gh-readonly-queue\/main\/[A-Za-z0-9._/-]+$/.test(config.ref || '') &&
      !config.ref.includes('..')) return SHA.test(config.queueBaseSha || '') ? null : 'invalid_queue_context';
  return 'event_not_allowed';
}

export function expectedTitle(config) {
  return `MacBook worker | ${config.parentRunId} | ${config.parentRunAttempt} | ${config.sourceSha} | ${config.part}`;
}

export function parentProblem(run, config) {
  if (id(run?.id) !== id(config.parentRunId) ||
      id(run?.run_attempt) !== id(config.parentRunAttempt) ||
      run?.repository?.full_name !== REPOSITORY ||
      run?.head_repository?.full_name !== REPOSITORY ||
      run?.path !== '.github/workflows/ci.yml' ||
      run?.head_sha !== config.sourceSha || run?.event !== config.event ||
      run?.head_branch !== config.ref.slice('refs/heads/'.length)) return 'parent_identity_mismatch';
  if (run.status !== 'in_progress' || run.conclusion != null) return 'parent_not_active';
  return null;
}

/** A dispatch response is not evidence that an arbitrary run belongs to us. */
export function ownedChild(run, config, childId, workflowId) {
  return id(run?.id) === id(childId) && id(run?.workflow_id) === id(workflowId) &&
    id(run?.run_attempt) === '1' && run?.repository?.full_name === REPOSITORY &&
    run?.head_repository?.full_name === REPOSITORY && run?.event === 'workflow_dispatch' &&
    run?.path === WORKFLOW_PATH && run?.head_branch === 'main' &&
    run?.display_title === expectedTitle(config);
}

function macJob(jobs) {
  if (!Array.isArray(jobs?.jobs) || jobs.total_count > 100) return { error: 'invalid_child_jobs' };
  const matches = jobs.jobs.filter(job => job.name === MAC_JOB_NAME);
  if (matches.length > 1) return { error: 'ambiguous_mac_job' };
  const job = matches[0];
  if (!job || !(Number(job.runner_id) > 0) || !['in_progress', 'completed'].includes(job.status)) {
    return { job, started: false };
  }
  const labels = new Set((job.labels || []).map(label => String(label).toLowerCase()));
  if (Number(job.runner_group_id) !== RUNNER_GROUP_ID ||
      !['self-hosted', 'macos', 'arm64', 'studioos-macbook'].every(label => labels.has(label))) {
    return { error: 'wrong_mac_runner' };
  }
  const startedAt = Date.parse(job.started_at);
  if (!Number.isFinite(startedAt)) return { error: 'invalid_mac_start' };
  return { job, started: true, startedAt };
}

function testResult(job) {
  const steps = (job?.steps || []).filter(step => step.name === TEST_STEP_NAME);
  if (steps.some(step => step.status === 'completed' && step.conclusion === 'failure')) return 'failure';
  if (steps.length !== 1 || steps[0].status !== 'completed') return null;
  if (steps[0].conclusion === 'success') return 'success';
  return null; // skipped, cancelled and absent tests are never accepted as a pass.
}

export function annotationPath(value) {
  try {
    const url = new URL(value);
    const prefix = `${ROOT}/check-runs/`;
    const checkId = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : '';
    if (url.origin !== 'https://api.github.com' || url.username || url.password ||
        url.search || url.hash || !id(checkId)) return null;
    return `${prefix}${checkId}/annotations?per_page=100`;
  } catch { return null; }
}

/** GitHub command data escaping prevents annotation text becoming commands. */
export function failureAnnotationLines(annotations) {
  if (!Array.isArray(annotations)) throw new Error('invalid annotations');
  return annotations.filter(row => row?.title === 'ci-failure-id' && typeof row.message === 'string')
    .slice(0, 5).map(row => `::error title=ci-failure-id::${row.message.slice(0, 8000)
      .replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`);
}

const fallback = (reason, childRunId = '', extra = {}) =>
  ({ delegated: false, childRunId: String(childRunId), reason, exitCode: 0, ...extra });
const delegated = (result, childRunId) => ({
  delegated: true,
  childRunId: String(childRunId),
  reason: result === 'success' ? 'mac_passed' : 'mac_test_failed',
  exitCode: result === 'success' ? 0 : 1,
});

function until(deadline, now, signal) {
  const timeout = AbortSignal.timeout(Math.max(1, Math.ceil(deadline - now())));
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** Only fixed diagnostic categories/status codes may leave the controller. */
export class GitHubRequestError extends Error {
  constructor(status) { super('github_request_failed'); this.status = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null; }
}
function safeDiagnostic(error, operation) {
  return error instanceof GitHubRequestError && Number.isInteger(error.status) && error.status >= 100 && error.status <= 599 ? { operation, kind: 'http', status: error.status }
    : { operation, kind: error?.name === 'AbortError' || error?.name === 'TimeoutError' ? 'timeout_or_cancelled' : 'transport_or_unavailable' };
}

/** Reclaim only a fully bound legacy child whose queued pickup lease has expired. */
export async function reclaimExpiredChild({ listed, workflowId, request, now, startTimeoutMs, signal }) {
  if (!id(listed?.id) || listed.status !== 'queued') return null;
  const child = await request('GET', runPath(listed.id), undefined, signal);
  const title = /^MacBook worker \| ([1-9][0-9]*) \| ([1-9][0-9]*) \| ([a-f0-9]{40}) \| (worker-1-of-6)$/.exec(child?.display_title ?? '');
  const created = Date.parse(child?.created_at);
  if (!title || !id(title[1]) || !id(title[2]) || !Number.isFinite(created) || created > now() || now() - created < startTimeoutMs) return null;
  const identity = { parentRunId: title[1], parentRunAttempt: title[2], sourceSha: title[3], part: title[4] };
  if (!ownedChild(child, identity, listed.id, workflowId) || child.status !== 'queued' || !SHA.test(child.head_sha ?? '')) return null;
  const parent = await request('GET', runPath(identity.parentRunId), undefined, signal);
  if (id(parent?.id) !== identity.parentRunId || id(parent.run_attempt) !== identity.parentRunAttempt
      || parent.repository?.full_name !== REPOSITORY || parent.head_repository?.full_name !== REPOSITORY
      || parent.path !== '.github/workflows/ci.yml' || parent.head_sha !== identity.sourceSha
      || !(parent.event === 'push' && parent.head_branch === 'main'
        || parent.event === 'merge_group' && /^gh-readonly-queue\/main\/[A-Za-z0-9._/-]+$/.test(parent.head_branch ?? '') && !parent.head_branch.includes('..'))) return null;
  const jobs = await request('GET', `${runPath(child.id)}/jobs?per_page=100`, undefined, signal);
  if (!Array.isArray(jobs?.jobs) || !Number.isSafeInteger(jobs.total_count) || jobs.total_count !== jobs.jobs.length || jobs.total_count > 100
      || jobs.jobs.some(job => job.status !== 'queued' || job.runner_id !== 0 || !Array.isArray(job.steps) || job.steps.length > 0)) return null;
  // Recheck identity/status immediately before this exact run's cancellation.
  const current = await request('GET', runPath(child.id), undefined, signal);
  if (!ownedChild(current, identity, child.id, workflowId) || current.head_sha !== child.head_sha || current.status !== 'queued') return null;
  let requested = false;
  try { await request('POST', `${runPath(child.id)}/cancel`, {}, signal); requested = true; } catch { /* Read terminal truth, never guess from a POST failure. */ }
  try {
    const final = await request('GET', runPath(child.id), undefined, signal);
    if (!ownedChild(final, identity, child.id, workflowId) || final.head_sha !== child.head_sha) return { reason: 'stale_mac_identity_changed', cleanupRunId: String(child.id) };
    if (isDone(final)) return { reason: 'stale_mac_run_reconciled', cleanupRunId: String(child.id) };
  } catch { /* A later CI invocation may safely reconcile the same owned ID. */ }
  return { reason: requested ? 'stale_mac_cancel_pending' : 'stale_mac_cancel_unconfirmed', cleanupRunId: String(child.id) };
}

/**
 * Pure orchestration boundary: API, clock and sleeps are injectable. The child
 * workflow, loaded from main, performs the complete source/provenance admission.
 * This controller does not trust a caller-supplied merge-group PR list.
 */
async function runDelegation({ config, api, now = Date.now,
  sleep = (ms, signal) => delay(ms, undefined, { signal }), signal, limits = {},
  onDispatch = () => {}, onDiagnostic = () => {} }) {
  const problem = configurationProblem(config);
  if (problem) return fallback(problem);
  if (typeof api !== 'function') return fallback('api_unavailable');
  const bounds = { ...LIMITS, ...limits };
  if (Object.values(bounds).some(value => !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error('invalid delegation limits');
  }

  let childId = '';
  let workflowId;
  let targetSha;
  let owned = false;
  let failedTest = false;
  let lastMacJob;
  let macStartedAt;
  let dispatchAt;
  let lastParentCheck = -Infinity;

  const request = async (method, path, body, requestSignal = signal) => {
    const operation = path.endsWith('/cancel') ? 'cancel_request' : path.endsWith('/dispatches') ? 'dispatch_request'
      : path === runPath(config.parentRunId) ? 'parent_status' : path === runPath(childId) ? 'child_status'
      : path.includes('/jobs?') ? 'child_jobs' : path.includes('/runs?') ? 'busy_inventory' : 'metadata';
    try { return await api(method, path, body, { signal: requestSignal }); }
    catch (error) { onDiagnostic(safeDiagnostic(error, operation)); throw error; }
  };
  const readParent = async requestSignal => {
    const parent = await request('GET', runPath(config.parentRunId), undefined, requestSignal);
    lastParentCheck = now();
    return parentProblem(parent, config);
  };
  const failedResult = async () => {
    const result = { ...delegated('failure', childId), annotations: [], annotationWarning: false };
    const path = annotationPath(lastMacJob?.check_run_url);
    if (!path) return { ...result, annotationWarning: true };
    try {
      result.annotations = failureAnnotationLines(await request('GET', path, undefined, until(now() + 10_000, now)));
      result.annotationWarning = result.annotations.length === 0;
    } catch { result.annotationWarning = true; }
    return result;
  };

  /** Cancel this dispatch's exact ID; never a run proven to have another identity. */
  const cancelAndFinish = async (reason, interrupted = false) => {
    if (!childId || !owned) return fallback(reason, childId, { exitCode: interrupted ? 130 : 0 });
    const deadline = now() + bounds.cancelTimeoutMs;
    const cleanupSignal = until(deadline, now);
    try { await request('POST', `${runPath(childId)}/cancel`, {}, cleanupSignal); }
    catch { /* It may already have finished. Read its result before falling back. */ }
    while (now() < deadline) {
      try {
        const run = await request('GET', runPath(childId), undefined, cleanupSignal);
        if (!ownedChild(run, config, childId, workflowId) || run.head_sha !== targetSha) break;
        const info = macJob(await request('GET', `${runPath(childId)}/jobs?per_page=100`, undefined, cleanupSignal));
        if (!info.error && info.started) {
          lastMacJob = info.job;
          if (testResult(info.job) === 'failure') failedTest = true;
        }
        if (isDone(run)) {
          if (interrupted) return fallback('parent_cancelled', childId, { exitCode: 130 });
          if (failedTest) return await failedResult();
          if (!info.error && info.started && testResult(info.job) === 'success' &&
              info.job.status === 'completed' && info.job.conclusion === 'success' &&
              run.conclusion === 'success') return delegated('success', childId);
          return fallback(reason, childId);
        }
      } catch { break; }
      try { await sleep(Math.min(bounds.pollMs, deadline - now()), cleanupSignal); }
      catch { break; }
    }
    if (interrupted) return fallback('parent_cancelled', childId, { exitCode: 130 });
    if (failedTest) return await failedResult();
    return fallback(`${reason}_cancel_unconfirmed`, childId);
  };

  try {
    if (signal?.aborted) return fallback('parent_cancelled', '', { exitCode: 130 });
    const parentError = await readParent(signal);
    if (parentError) return fallback(parentError);

    const workflow = await request('GET', WORKFLOW_API);
    if (workflow?.path !== WORKFLOW_PATH || workflow?.state !== 'active' || !id(workflow?.id)) {
      return fallback('child_workflow_unavailable');
    }
    workflowId = workflow.id;
    // This is an inexpensive workflow-level busy check, not a runner reservation.
    // A race or a runner busy on another allowed workflow is bounded below.
    for (const status of ACTIVE) {
      const runs = await request('GET', `${WORKFLOW_API}/runs?branch=main&status=${status}&per_page=1`);
      if (!Array.isArray(runs?.workflow_runs) || !Number.isSafeInteger(runs?.total_count)) {
        return fallback('busy_state_unavailable');
      }
      if (runs.total_count > 0 || runs.workflow_runs.length > 0) {
        if (runs.workflow_runs.length > 1 || runs.workflow_runs.length > runs.total_count || runs.total_count < 1) return fallback('busy_state_unavailable');
        const stale = await reclaimExpiredChild({ listed: runs.workflow_runs[0], workflowId, request, now,
          startTimeoutMs: bounds.startTimeoutMs, signal: until(now() + bounds.cancelTimeoutMs, now, signal) });
        if (stale) return fallback(stale.reason, '', { cleanupRunId: stale.cleanupRunId });
        return fallback('mac_workflow_busy');
      }
    }
    const main = await request('GET', `${ROOT}/branches/main`);
    targetSha = main?.commit?.sha;
    if (!SHA.test(targetSha || '')) return fallback('main_target_unavailable');

    // Do not retry an uncertain dispatch: that could start the shard twice.
    dispatchAt = now();
    const dispatch = await request('POST', `${WORKFLOW_API}/dispatches`, {
      ref: 'main',
      inputs: {
        parent_run_id: String(config.parentRunId),
        parent_run_attempt: String(config.parentRunAttempt),
        source_sha: config.sourceSha,
        part: config.part,
        queue_base_sha: config.queueBaseSha || '',
      },
    });
    childId = id(dispatch?.workflow_run_id) || '';
    if (!childId) return fallback('dispatch_unconfirmed');
    // The fixed dispatch endpoint identified the new run. This permits cleanup
    // if the next read fails; no result is accepted until metadata is verified.
    owned = true;
    await onDispatch(childId);

    while (true) {
      if (signal?.aborted) return await cancelAndFinish('parent_cancelled', true);
      const deadline = macStartedAt === undefined
        ? dispatchAt + bounds.startTimeoutMs
        : macStartedAt + bounds.completionTimeoutMs;
      const expiry = macStartedAt === undefined ? 'mac_start_timeout' : 'mac_completion_timeout';
      if (now() >= deadline) return await cancelAndFinish(expiry);
      const pollSignal = until(deadline, now, signal);
      if (now() - lastParentCheck >= bounds.parentPollMs) {
        if (await readParent(pollSignal)) return await cancelAndFinish('parent_cancelled', true);
      }
      const run = await request('GET', runPath(childId), undefined, pollSignal);
      owned = ownedChild(run, config, childId, workflowId);
      if (!owned) return fallback('child_identity_mismatch', childId);
      // main may move between the read and dispatch. Never accept another target.
      if (run.head_sha !== targetSha) return await cancelAndFinish('child_source_target_mismatch');
      const info = macJob(await request('GET', `${runPath(childId)}/jobs?per_page=100`, undefined, pollSignal));
      if (info.error) return await cancelAndFinish(info.error);
      if (info.started) {
        lastMacJob = info.job;
        if (info.startedAt < dispatchAt - 60_000 || info.startedAt > now() + 60_000) {
          return await cancelAndFinish('invalid_mac_start');
        }
        macStartedAt ??= Math.min(info.startedAt, now());
        if (testResult(info.job) === 'failure') failedTest = true;
      }
      if (isDone(run)) {
        if (failedTest) return await failedResult();
        if (info.started && testResult(info.job) === 'success' &&
            info.job.status === 'completed' && info.job.conclusion === 'success' &&
            run.conclusion === 'success') return delegated('success', childId);
        return fallback('child_did_not_verify_tests', childId);
      }
      const nextDeadline = macStartedAt === undefined
        ? dispatchAt + bounds.startTimeoutMs
        : macStartedAt + bounds.completionTimeoutMs;
      const remaining = nextDeadline - now();
      if (remaining <= 0) continue;
      await sleep(Math.min(macStartedAt === undefined ? bounds.pollMs : bounds.runningPollMs, remaining), signal);
    }
  } catch {
    if (signal?.aborted) return await cancelAndFinish('parent_cancelled', true);
    if (childId && macStartedAt !== undefined && now() >= macStartedAt + bounds.completionTimeoutMs) {
      return await cancelAndFinish('mac_completion_timeout');
    }
    if (childId && macStartedAt === undefined && now() >= dispatchAt + bounds.startTimeoutMs) {
      return await cancelAndFinish('mac_start_timeout');
    }
    return await cancelAndFinish(childId ? 'child_status_unavailable' : 'github_unavailable');
  }
}

/** Preserve the historical success/failure shape; attach bounded diagnostics only after real API errors. */
export async function delegateWorker(options) {
  const diagnostics = [];
  const result = await runDelegation({ ...options, onDiagnostic: record => { if (diagnostics.length < 12) diagnostics.push(record); } });
  return diagnostics.length ? { ...result, diagnostics } : result;
}

/** Best-effort cancellation hook for a separate parent cancellation step. */
export async function cancelOwnedChild({ config, childRunId, api, signal }) {
  if (!childRunId) return { cancelled: false, reason: 'no_child' };
  if (!id(childRunId) || configurationProblem({ ...config, enabled: true })) {
    return { cancelled: false, reason: 'invalid_cleanup_identity' };
  }
  try {
    const parent = await api('GET', runPath(config.parentRunId), undefined, { signal });
    const parentError = parentProblem(parent, config);
    if (parentError && parentError !== 'parent_not_active') {
      return { cancelled: false, reason: 'parent_identity_mismatch' };
    }
    const workflow = await api('GET', WORKFLOW_API, undefined, { signal });
    if (workflow?.path !== WORKFLOW_PATH || !id(workflow?.id)) {
      return { cancelled: false, reason: 'child_workflow_unavailable' };
    }
    const child = await api('GET', runPath(childRunId), undefined, { signal });
    if (!ownedChild(child, config, childRunId, workflow.id)) {
      return { cancelled: false, reason: 'child_identity_mismatch' };
    }
    if (isDone(child)) return { cancelled: false, reason: 'child_already_completed' };
    await api('POST', `${runPath(childRunId)}/cancel`, {}, { signal });
    return { cancelled: true, reason: 'child_cancel_requested' };
  } catch { return { cancelled: false, reason: 'child_cancel_unconfirmed' }; }
}

/** Only the fixed repository's API paths are reachable; response URLs are data. */
export function githubApi(token, { fetchImpl = fetch, requestTimeoutMs = 10_000 } = {}) {
  return async (method, path, body, { signal } = {}) => {
    if (!token || !['GET', 'POST'].includes(method) ||
        !path.startsWith(`${ROOT}/`) || path.includes('..') || path.includes('://') ||
        /[\r\n\\#%]/.test(path)) throw new Error('invalid GitHub request');
    const timeout = AbortSignal.timeout(requestTimeoutMs);
    const response = await fetchImpl(`https://api.github.com${path}`, {
      method,
      redirect: 'error',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2026-03-10',
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) throw new GitHubRequestError(response.status);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };
}

export function writeOutputs(result, outputPath) {
  if (!outputPath) return;
  if (!/^[a-z_]+$/.test(result.reason) ||
      (result.childRunId !== '' && !id(result.childRunId))) throw new Error('invalid delegation output');
  appendFileSync(outputPath,
    `delegated=${result.delegated ? 'true' : 'false'}\nchild_run_id=${result.childRunId}\nreason=${result.reason}\n`);
}

export async function main(env = process.env, argv = process.argv.slice(2)) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  try {
    const token = env.GH_TOKEN || env.GITHUB_TOKEN;
    let event = {};
    if (env.GITHUB_EVENT_NAME === 'merge_group') {
      try { event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')); }
      catch { /* Missing queue provenance takes the hosted path. */ }
    }
    const config = configFromEnv(env, event);
    if (argv.length === 1 && argv[0] === '--cancel-owned') {
      const cleanup = token
        ? await cancelOwnedChild({ config, childRunId: env.CHILD_RUN_ID || '', api: githubApi(token), signal: controller.signal })
        : { cancelled: false, reason: 'token_unavailable' };
      console.log(`MacBook cleanup: ${cleanup.reason}.`);
      return 0;
    }
    if (argv.length) {
      console.error('Usage: node scripts/ci/macbook-worker.mjs [--cancel-owned]');
      return 2;
    }
    const result = token
      ? await delegateWorker({ config, api: githubApi(token), signal: controller.signal,
        onDispatch: childRunId => {
          // Persist before polling so a later cancellation step can find the
          // exact child even if this process is killed during cancellation.
          if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `child_run_id=${childRunId}\n`);
        } })
      : fallback(configurationProblem(config) || 'token_unavailable');
    writeOutputs(result, env.GITHUB_OUTPUT);
    for (const line of result.annotations || []) console.log(line);
    if (result.annotationWarning) console.warn('::warning::Could not mirror Mac test failure identities; the shard remains failed.');
    console.log(`MacBook delegation: ${result.reason}${result.childRunId ? ` (child run ${result.childRunId})` : ''}.`);
    return result.exitCode;
  } finally {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await main();
}
