#!/usr/bin/env node
/** D8013: bounded GET-only queue evidence and a review manifest; performs no GitHub mutation. */
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { cancellable, queueBranch, WORKFLOWS } from '../../merge-control/src/lib/reconcile.ts';
import { QUEUE_DEFAULTS, QUEUE_CLEAR_RATIO, parseQueueCutoff, queueAfterCutoff, queueState } from '../lib/githubAlerts.mjs';

export const REPOSITORY = 'AxalNetwork/StudioOS';
export const PREFIX = `/repos/${REPOSITORY}`;
export const SNAPSHOT_SCHEMA = 'studioos-queue-capacity-snapshot/v1';
export const LIMITS = Object.freeze({ requests: 80, pages: 3, runs: 20, timeoutMs: 10000, responseBytes: 2000000, snapshotBytes: 20000000 });
export const SOURCE_REVISIONS = Object.freeze({ main: 'c2fb23a5cc4e440268dce3c65c579a0ee21bf469', capacityTransport: 'db11f2f3da613f3542d2bf8f736acaa35735457d', executorIsolation: '513da8c5bf32eda4a4e8818f6fbbcd9bed63275c' });
const ACTIVE = ['queued', 'in_progress', 'waiting', 'pending', 'requested'];
const SHA = /^[a-f0-9]{40}$/;
const positive = value => Number.isSafeInteger(value) && value > 0;
const stamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const age = (at, now) => stamp(at) && Date.parse(at) <= now ? Math.floor((now - Date.parse(at)) / 1000) : null;
const exactRefPath = branch => `${PREFIX}/git/ref/heads/${encodeURIComponent(branch)}`;
const runPath = id => `${PREFIX}/actions/runs/${id}`;
const pagePath = (path, page) => `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`;
const fail = code => { throw new Error(code); };

function allowedPath(path) {
  if (typeof path !== 'string' || !path.startsWith(`${PREFIX}/`) || /[\r\n#]/.test(path)) return false;
  const tail = path.slice(PREFIX.length);
  if (/^\/actions\/runs\?status=(queued|in_progress|waiting|pending|requested)&per_page=100&page=[1-5]$/.test(tail)) return true;
  if (/^\/pulls\?state=open&per_page=100&page=[1-5]$/.test(tail)) return true;
  if (/^\/actions\/runs\/[1-9][0-9]*$/.test(tail)) return true;
  if (/^\/actions\/runs\/[1-9][0-9]*\/attempts\/[1-9][0-9]*(\/jobs\?per_page=100&page=[1-5])?$/.test(tail)) return true;
  if (/^\/pulls\/[1-9][0-9]*$/.test(tail)) return true;
  if (tail === '/git/matching-refs/heads/gh-readonly-queue/main/') return true;
  if (tail.startsWith('/git/ref/heads/')) {
    try {
      const branch = decodeURIComponent(tail.slice('/git/ref/heads/'.length));
      return branch === 'main' || queueBranch(branch);
    } catch { return false; }
  }
  return false;
}

/** Only these public operational fields enter saved snapshots; no runner names, actors, URLs or raw errors. */
function project(path, value) {
  const fields = (v, names) => Object.fromEntries(names.filter(k => v?.[k] !== undefined).map(k => [k, v[k]]));
  const run = v => ({ ...fields(v, ['id', 'run_attempt', 'workflow_id', 'name', 'path', 'event', 'head_sha', 'head_branch', 'status', 'conclusion', 'created_at', 'updated_at', 'run_started_at']), repository: fields(v?.repository, ['full_name']) });
  const pr = v => ({ ...fields(v, ['number', 'state', 'merged', 'merged_at']), head: fields(v?.head, ['sha']), base: { repo: fields(v?.base?.repo, ['full_name']) } });
  const ref = v => ({ ref: v?.ref, object: fields(v?.object, ['sha', 'type']) });
  if (path === PREFIX) return fields(value, ['full_name', 'id']);
  if (path.includes('/jobs?')) return { total_count: value?.total_count, jobs: Array.isArray(value?.jobs) ? value.jobs.map(v => fields(v, ['id', 'run_id', 'run_attempt', 'head_sha', 'name', 'status', 'conclusion', 'created_at', 'started_at', 'completed_at'])) : null };
  if (path.includes('/actions/runs?')) return { total_count: value?.total_count, workflow_runs: Array.isArray(value?.workflow_runs) ? value.workflow_runs.map(run) : null };
  if (path.includes('/actions/runs/')) return run(value);
  if (path.includes('/git/matching-refs/')) return Array.isArray(value) ? value.map(ref) : null;
  if (path.includes('/git/ref/')) return ref(value);
  if (path.includes('/pulls?')) return Array.isArray(value) ? value.map(pr) : null;
  if (path.includes('/pulls/')) return pr(value);
  return null;
}

/** Fixed GitHub host, allowlisted paths, GET and redirect refusal; the token is never part of evidence. */
export function githubGet({ token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN, fetchImpl = fetch, now = () => new Date().toISOString(), limits = LIMITS } = {}) {
  limits = boundedLimits(limits);
  let count = 0;
  return async path => {
    if (path !== PREFIX && !allowedPath(path)) return fail('read_path_refused');
    if (count >= limits.requests) return { status: 'budget_exceeded', complete: false, observedAt: now() };
    count++;
    const at = () => now();
    try {
      const response = await fetchImpl(`https://api.github.com${path}`, { method: 'GET', redirect: 'error',
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: AbortSignal.timeout(limits.timeoutMs) });
      if (!response.ok) return { status: response.status, complete: true, observedAt: at() };
      const reader = response.body?.getReader();
      if (!reader) return { status: 'invalid_response', complete: false, observedAt: at() };
      const chunks = []; let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > limits.responseBytes) { await reader.cancel(); return { status: 'response_bound', complete: false, observedAt: at() }; }
        chunks.push(value);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      return { status: 200, complete: true, observedAt: at(), nextPage: /rel="next"/.test(response.headers.get('link') || ''), data: project(path, body) };
    } catch (error) {
      return { status: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'unreadable', complete: false, observedAt: at() };
    }
  };
}

function boundedLimits(limits) {
  const l = { ...LIMITS, ...limits };
  for (const [key, max] of Object.entries({ requests: 200, pages: 5, runs: 50, timeoutMs: 30000, responseBytes: 8000000, snapshotBytes: 20000000 })) {
    if (!positive(l[key]) || l[key] > max) fail('invalid_limits');
  }
  return l;
}

/** A custom reader supplies GET observations only. This collector never loads or invokes any operational reporter. */
export async function collectSnapshot({ get, runIds = [], now = () => new Date().toISOString(), limits = {}, cutoff = null, issueOpen = true } = {}) {
  const l = boundedLimits(limits);
  if (typeof get !== 'function' || !Array.isArray(runIds) || runIds.length > l.runs || runIds.some(id => !positive(id))) fail('invalid_collection');
  const snapshot = { schema: SNAPSHOT_SCHEMA, repository: REPOSITORY, startedAt: now(), observedAt: null,
    selection: runIds.length ? 'explicit_run_ids' : 'bounded_active_sample', runIds: [], limits: l, requests: {},
    reportingContext: { cutoff, issueOpen } };
  let calls = 0;
  const read = async path => {
    if (path !== PREFIX && !allowedPath(path)) fail('read_path_refused');
    if (calls >= l.requests) {
      snapshot.requestBudgetExhausted = true;
      const result = { status: 'budget_exceeded', complete: false, observedAt: now() };
      if (Object.hasOwn(snapshot.requests, path)) snapshot.requests[path] = result;
      return result;
    }
    calls++;
    const result = await get(path);
    snapshot.requests[path] = result;
    return result;
  };
  const pages = async (path, field) => {
    const items = [];
    for (let page = 1; page <= l.pages; page++) {
      const result = await read(pagePath(path, page));
      const rows = field ? result.data?.[field] : result.data;
      if (result.status !== 200 || result.complete !== true || !Array.isArray(rows)) break;
      items.push(...rows);
      if (!result.nextPage && rows.length < 100) break;
    }
    return items;
  };
  await read(PREFIX);
  await read(exactRefPath('main'));
  const active = [];
  for (const status of ACTIVE) active.push(...await pages(`${PREFIX}/actions/runs?status=${status}`, 'workflow_runs'));
  await pages(`${PREFIX}/pulls?state=open`, null);
  await read(`${PREFIX}/git/matching-refs/heads/gh-readonly-queue/main/`);
  const ids = runIds.length ? runIds : [...new Set(active.map(r => r.id).filter(positive))].slice(0, l.runs);
  snapshot.runIds = ids;
  for (const id of ids) {
    const current = await read(runPath(id));
    const run = current.data;
    if (current.status !== 200 || !positive(run?.run_attempt)) continue;
    await read(`${runPath(id)}/attempts/${run.run_attempt}`);
    await pages(`${runPath(id)}/attempts/${run.run_attempt}/jobs`, 'jobs');
    if (queueBranch(run.head_branch || '')) {
      await read(exactRefPath(run.head_branch));
      const number = /^gh-readonly-queue\/main\/pr-([1-9][0-9]*)-[a-f0-9]{40}$/.exec(run.head_branch)?.[1];
      if (number) await read(`${PREFIX}/pulls/${number}`);
    }
    // A retry started while jobs were being read must not inherit the previous attempt's evidence.
    await read(runPath(id));
  }
  snapshot.observedAt = now();
  snapshot.requestCount = calls;
  return snapshot;
}

function evidence(snapshot, path) {
  const value = snapshot.requests[path];
  if (!value || !stamp(value.observedAt) || Date.parse(value.observedAt) > Date.parse(snapshot.observedAt)) return { status: 'not_observed', complete: false, path };
  return { ...value, path };
}
const good = record => record.status === 200 && record.complete === true;
function readPages(snapshot, path, field) {
  const items = [], paths = []; let total = null;
  for (let page = 1; page <= snapshot.limits.pages; page++) {
    const record = evidence(snapshot, pagePath(path, page));
    paths.push(record.path);
    const rows = field ? record.data?.[field] : record.data;
    if (!good(record) || !Array.isArray(rows) || rows.length > 100) return { complete: false, items, paths, total, reason: 'unreadable_page' };
    if (field && (!Number.isSafeInteger(record.data.total_count) || record.data.total_count < 0)) return { complete: false, items, paths, total, reason: 'missing_total' };
    if (field) {
      if (total !== null && total !== record.data.total_count) return { complete: false, items, paths, total, reason: 'changing_total' };
      total = record.data.total_count;
    }
    items.push(...rows);
    if (!record.nextPage && rows.length < 100) {
      const ids = items.map(x => x.id ?? x.number);
      const unique = new Set(ids).size === ids.length;
      return { complete: unique && (total === null || items.length === total), items, paths, total, reason: !unique ? 'duplicate_items' : total !== null && items.length !== total ? 'total_mismatch' : 'end_of_pages' };
    }
  }
  return { complete: false, items, paths, total, reason: 'page_bound' };
}
function refFact(snapshot, branch) {
  const record = evidence(snapshot, exactRefPath(branch));
  const identity = good(record) && record.data?.ref === `refs/heads/${branch}` && record.data.object?.type === 'commit' && SHA.test(record.data.object.sha || '');
  return { state: identity ? 'present' : record.status === 404 && record.complete === true ? 'explicit_404' : 'unknown',
    path: record.path, status: record.status, observedAt: record.observedAt ?? null, sha: identity ? record.data.object.sha : null };
}
function validRun(run, id) {
  return run?.id === id && positive(run.run_attempt) && positive(run.workflow_id) && run.repository?.full_name === REPOSITORY
    && SHA.test(run.head_sha || '') && typeof run.head_branch === 'string' && typeof run.path === 'string' && typeof run.status === 'string';
}
function timing(run, attempt, jobs, now) {
  const belongs = jobs.items.every(job => positive(job.id) && job.run_id === run.id && job.run_attempt === run.run_attempt
    && job.head_sha === run.head_sha && [...ACTIVE, 'completed'].includes(job.status));
  return {
    originalRunAgeSeconds: age(run.created_at, now),
    currentAttempt: { number: run.run_attempt, startedAt: attempt?.run_started_at ?? null,
      startedAgeSeconds: age(attempt?.run_started_at, now), queueWaitSeconds: null,
      queueWaitReason: 'GitHub does not supply an authoritative attempt-enqueued timestamp here.' },
    jobsComplete: jobs.complete && belongs,
    jobs: jobs.items.filter(job => job.run_id === run.id && job.run_attempt === run.run_attempt && job.head_sha === run.head_sha).map(job => ({
      id: job.id, name: job.name, status: job.status, createdAt: job.created_at ?? null, startedAt: job.started_at ?? null,
      waitingSeconds: ACTIVE.includes(job.status) && job.status !== 'in_progress' ? age(job.created_at, now) : null,
      queueDelaySeconds: stamp(job.created_at) && stamp(job.started_at) && Date.parse(job.started_at) >= Date.parse(job.created_at)
        ? Math.floor((Date.parse(job.started_at) - Date.parse(job.created_at)) / 1000) : null,
    })),
  };
}

/** The report is evidence for a person to recheck. It never asserts authority to execute a cancellation. */
export function auditSnapshot(input) {
  if (input?.schema !== SNAPSHOT_SCHEMA || input.repository !== REPOSITORY || !stamp(input.observedAt)
    || !input.requests || typeof input.requests !== 'object' || Array.isArray(input.requests)) fail('invalid_snapshot');
  const snapshot = { ...input, limits: boundedLimits(input.limits) };
  if (!Array.isArray(snapshot.runIds) || snapshot.runIds.length > snapshot.limits.runs || snapshot.runIds.some(id => !positive(id))
    || new Set(snapshot.runIds).size !== snapshot.runIds.length || Object.keys(snapshot.requests).length > snapshot.limits.requests) fail('snapshot_bound');
  const now = Date.parse(snapshot.observedAt);
  const repo = evidence(snapshot, PREFIX), main = refFact(snapshot, 'main');
  const refsReadable = good(repo) && repo.data?.full_name === REPOSITORY && main.state === 'present';
  const activePages = ACTIVE.map(status => readPages(snapshot, `${PREFIX}/actions/runs?status=${status}`, 'workflow_runs'));
  const activeRuns = activePages.flatMap(page => page.items);
  const activeComplete = activePages.every(page => page.complete) && activeRuns.every(run => validRun(run, run.id))
    && new Set(activeRuns.map(run => run.id)).size === activeRuns.length;
  const prs = readPages(snapshot, `${PREFIX}/pulls?state=open`, null);
  const prsComplete = prs.complete && prs.items.every(pr => positive(pr.number) && pr.state === 'open' && SHA.test(pr.head?.sha || '') && pr.base?.repo?.full_name === REPOSITORY);
  const refList = evidence(snapshot, `${PREFIX}/git/matching-refs/heads/gh-readonly-queue/main/`);
  // GitHub matching-refs is unpaginated. An unexpected continuation or excessive result is unknown.
  const refsComplete = good(refList) && !refList.nextPage && Array.isArray(refList.data) && refList.data.length <= 1000
    && new Set(refList.data.map(ref => ref.ref)).size === refList.data.length
    && refList.data.every(ref => typeof ref.ref === 'string' && ref.ref.startsWith('refs/heads/') && queueBranch(ref.ref.slice(11)) && ref.object?.type === 'commit' && SHA.test(ref.object.sha || ''));
  const rows = snapshot.runIds.map(id => {
    const current = evidence(snapshot, runPath(id)), run = current.data;
    if (!good(current) || !validRun(run, id)) return { runId: id, classification: 'unknown_evidence', reason: 'current_run_unreadable', evidencePaths: [current.path] };
    const attemptPath = `${runPath(id)}/attempts/${run.run_attempt}`;
    const attempt = evidence(snapshot, attemptPath);
    const attemptMatches = good(attempt) && validRun(attempt.data, id) && attempt.data.run_attempt === run.run_attempt
      && attempt.data.head_sha === run.head_sha && attempt.data.path === run.path && attempt.data.event === run.event && attempt.data.head_branch === run.head_branch;
    const jobs = readPages(snapshot, `${attemptPath}/jobs`, 'jobs');
    const times = timing(run, attemptMatches ? attempt.data : null, jobs, now);
    const ref = queueBranch(run.head_branch) ? refFact(snapshot, run.head_branch) : null;
    const number = /^gh-readonly-queue\/main\/pr-([1-9][0-9]*)-[a-f0-9]{40}$/.exec(run.head_branch)?.[1];
    const pr = number ? evidence(snapshot, `${PREFIX}/pulls/${number}`) : null;
    const prKnown = good(pr || {}) && pr.data?.number === Number(number) && ['open', 'closed'].includes(pr.data.state)
      && pr.data.base?.repo?.full_name === REPOSITORY && SHA.test(pr.data.head?.sha || '')
      && (pr.data.state !== 'closed' || typeof pr.data.merged === 'boolean');
    const base = { runId: id, attempt: run.run_attempt, workflow: { id: run.workflow_id, path: run.path, name: run.name ?? null }, event: run.event,
      candidateSha: run.head_sha, branch: run.head_branch, status: run.status, ...times, exactRef: ref,
      pullRequest: prKnown ? { number: pr.data.number, state: pr.data.state, merged: pr.data.merged === true, headSha: pr.data.head.sha } : { state: 'unknown' },
      evidencePaths: [current.path, attemptPath, ...jobs.paths, ...(ref ? [ref.path] : []), ...(pr ? [pr.path] : [])] };
    if (run.status === 'completed') return { ...base, classification: 'terminal_work', reason: 'run_completed' };
    if (run.event === 'push' && run.head_branch === 'main') return { ...base, classification: 'protected_main_push', reason: 'main_push_excluded' };
    if (run.event === 'pull_request' || prs.items.some(pr => pr.head?.sha === run.head_sha)) return { ...base, classification: 'protected_pr_head', reason: 'current_pr_or_pr_event_excluded' };
    if (main.sha === run.head_sha) return { ...base, classification: 'protected_main_head', reason: 'current_main_sha_excluded' };
    if (!ACTIVE.includes(run.status) || !attemptMatches || !times.jobsComplete || !refsReadable || !cancellable(run, run.head_sha)) return { ...base, classification: 'unknown_evidence', reason: 'identity_pages_or_policy_unproven' };
    if (ref.state === 'present') return { ...base, classification: ref.sha === run.head_sha ? 'active_candidate' : 'superseded_candidate', reason: ref.sha === run.head_sha ? 'exact_ref_matches' : 'exact_ref_sha_mismatch' };
    if (ref.state !== 'explicit_404') return { ...base, classification: 'unknown_evidence', reason: 'exact_ref_unreadable' };
    return { ...base, classification: 'missing_exact_ref', reason: 'exact_get_returned_404', prKnown };
  });
  const missing = rows.filter(row => row.classification === 'missing_exact_ref');
  const manifest = [], held = [];
  for (const row of missing) {
    const liveRefs = refsComplete ? refList.data.filter(ref => ref.object.sha === row.candidateSha).map(ref => ref.ref) : [];
    const prHeads = prs.items.filter(pr => pr.head?.sha === row.candidateSha).map(pr => pr.number);
    const relatedPrHead = row.pullRequest.headSha === row.candidateSha;
    const otherRuns = activeRuns.filter(run => run.id !== row.runId && run.head_sha === row.candidateSha);
    const coReview = otherRuns.filter(run => missing.some(other => other.prKnown && other.runId === run.id && other.attempt === run.run_attempt));
    const consumers = otherRuns.filter(run => !coReview.includes(run)).map(run => ({ runId: run.id, attempt: run.run_attempt, event: run.event, workflow: run.path }));
    const refDisagrees = refsComplete && refList.data.some(ref => ref.ref === `refs/heads/${row.branch}`);
    const complete = activeComplete && prsComplete && refsComplete && row.prKnown && !refDisagrees && !snapshot.requestBudgetExhausted;
    const remaining = { complete, liveRefs, prHeads, relatedPrHead, otherActiveConsumers: consumers,
      coReviewRunIds: coReview.map(run => run.id), externalDelegation: 'unknown_requires_operator_check',
      scope: 'GitHub refs, PR heads and bounded active-run inventory; no external authority queried.' };
    const entry = { runId: row.runId, attempt: row.attempt, workflow: row.workflow, event: row.event, candidateSha: row.candidateSha,
      exactRef: row.exactRef, remainingConsumers: remaining, observedAt: snapshot.observedAt,
      requiresFreshGets: [...new Set([PREFIX, exactRefPath('main'), ...row.evidencePaths, ...coReview.flatMap(run => missing.find(other => other.runId === run.id).evidencePaths), ...activePages.flatMap(page => page.paths), ...prs.paths, refList.path])],
      disposition: 'operator_review_only', permissionToCancel: false };
    if (complete && !liveRefs.length && !prHeads.length && !relatedPrHead && !consumers.length) manifest.push(entry);
    else held.push({ ...entry, reason: complete ? 'remaining_consumer_observed' : 'remaining_consumer_evidence_unknown' });
  }
  let cutoff = null;
  if (snapshot.reportingContext?.cutoff) cutoff = parseQueueCutoff(snapshot.reportingContext.cutoff);
  const queued = activePages[0];
  const queueContext = queueAfterCutoff({ total: queued.total ?? queued.items.length, runs: queued.items, cutoff });
  return {
    schema: 'studioos-queue-capacity-audit/v1', repository: REPOSITORY, observedAt: snapshot.observedAt,
    evidenceKind: 'timestamped_snapshot_not_live_authority', sourceRevisions: SOURCE_REVISIONS,
    eligibilityPolicy: { decision: 'D5618', path: 'merge-control/src/lib/reconcile.ts', workflows: WORKFLOWS,
      sha256: createHash('sha256').update(readFileSync(new URL('../../merge-control/src/lib/reconcile.ts', import.meta.url))).digest('hex') },
    sample: { startedAt: snapshot.startedAt ?? null, selectedRuns: rows.length, activeRunsObserved: activeRuns.length, activeInventoryComplete: activeComplete,
      activeInventories: activePages.map((page, index) => ({ status: ACTIVE[index], complete: page.complete, reason: page.reason, total: page.total, observedRuns: page.items.length, paths: page.paths })),
      openPrPagesComplete: prsComplete, queueRefsComplete: refsComplete, requestCount: snapshot.requestCount ?? Object.keys(snapshot.requests).length,
      requestBudgetExhausted: snapshot.requestBudgetExhausted === true, limits: snapshot.limits, selection: snapshot.selection ?? 'saved_snapshot' },
    reportingContext: { ...queueContext, thresholds: QUEUE_DEFAULTS, clearRatio: QUEUE_CLEAR_RATIO,
      complete: queued.complete, reportedQueueState: queued.complete ? queueState({ ...queueContext, oldestCreatedAt: queueContext.oldestCreatedAt, now, issueOpen: snapshot.reportingContext?.issueOpen === true }) : null,
      incidentTransition: 'not_evaluated' },
    runs: rows, cancellationReviewManifest: manifest, heldForEvidence: held,
    warning: 'Every snapshot can become stale immediately. Re-read exact run/attempt, ref and consumer evidence before any separate operator action; external delegated consumers remain unverified.',
  };
}

export async function main(args = process.argv.slice(2), { stdout = value => process.stdout.write(value), get, now } = {}) {
  let input = null, live = false; const runIds = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--snapshot' && args[i + 1] && input === null) input = args[++i];
    else if (args[i] === '--github' && !live) live = true;
    else if (args[i] === '--run-id' && /^[1-9][0-9]{0,14}$/.test(args[i + 1] || '')) runIds.push(Number(args[++i]));
    else fail('usage: --snapshot FILE OR --github [--run-id ID]; GET-only diagnostic');
  }
  if ((input !== null) === live || (input && runIds.length)) fail('choose_one_input');
  let snapshot;
  if (input) {
    if (statSync(resolve(input)).size > LIMITS.snapshotBytes) fail('snapshot_bound');
    const bytes = readFileSync(resolve(input));
    if (bytes.byteLength > LIMITS.snapshotBytes) fail('snapshot_bound');
    snapshot = JSON.parse(bytes.toString('utf8'));
  } else snapshot = await collectSnapshot({ get: get || githubGet(), now, runIds });
  stdout(JSON.stringify(auditSnapshot(snapshot), null, 2) + '\n');
  return 0;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = await main(); }
  catch { console.error('queue_capacity_audit_failed: invalid input or unavailable evidence'); process.exitCode = 1; }
}
