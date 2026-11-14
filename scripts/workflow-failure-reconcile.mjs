#!/usr/bin/env node
// D6387: report exact GitHub attempts from trusted events and reconcile missed completions on a schedule.
import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { reconcileWindow } from '../engineering-notifications/reconcile.mjs';
import { createWorkflowFailureReporter } from './lib/workflowFailureIssues.mjs';
import { ensureMainRedIssue } from './health-alert-episodes.mjs';
import { workflowFailureHints } from './lib/workflowFailureHints.mjs';

const repository = 'AxalNetwork/StudioOS';
const base = '/repos/' + repository + '/actions/runs';
const HOUR = 3_600_000;
const OVERLAP = 2 * 60_000;
const failure = new Set(['failure', 'timed_out', 'startup_failure', 'action_required']);
const positive = n => Number.isSafeInteger(n) && n > 0;

function checkRun(run, id, attempt) {
  if (!positive(run?.id) || !positive(run.run_attempt) || !positive(run.workflow_id) ||
      run.repository?.full_name !== repository || run.id !== id || run.run_attempt !== attempt ||
      typeof run.status !== 'string' || (run.status === 'completed' && !run.conclusion)) {
    throw new Error('unverified_run_identity');
  }
  return run;
}

async function attemptJobs(api, run) {
  const jobs = [];
  const ids = new Set();
  for (let page = 1; ; page++) {
    const result = await api(base + '/' + run.id + '/attempts/' + run.run_attempt + '/jobs?per_page=100&page=' + page);
    if (!Array.isArray(result.jobs) || !Number.isSafeInteger(result.total_count) || result.total_count < 0) throw new Error('unreadable_jobs');
    for (const job of result.jobs) {
      if (!positive(job.id) || ids.has(job.id) || job.run_id !== run.id ||
          (job.run_attempt != null && job.run_attempt !== run.run_attempt)) throw new Error('unverified_job_identity');
      jobs.push(job);
      ids.add(job.id);
    }
    if (jobs.length === result.total_count) return jobs;
    if (result.jobs.length !== 100 || jobs.length > result.total_count) throw new Error('incomplete_jobs');
  }
}

// Only numeric IDs from dispatch are used. Conclusions, branch, repository and jobs come from the Actions API.
export async function reportAttempt({ api, reporter, hints = workflowFailureHints }, id, attempt, knownRun) {
  if (!positive(id) || !positive(attempt)) throw new Error('invalid_attempt_selector');
  const run = checkRun(knownRun ?? await api(base + '/' + id + '/attempts/' + attempt), id, attempt);
  if (run.status !== 'completed') {
    if (!knownRun) throw new Error('attempt_not_terminal');
    return { action: 'ignored' };
  }
  if (!failure.has(run.conclusion)) return { action: 'ignored' };
  const jobs = await attemptJobs(api, run);
  const evidence = await hints({ api, repository, run, jobs });
  return reporter.report({ run, jobs, ...evidence });
}

function validateCheckpoint(state, until) {
  if (state.version !== 1 || !positive(state.until) || state.until > until || (state.auditBefore != null && (!positive(state.auditBefore) || state.auditBefore > until)) || !Array.isArray(state.tracked)) throw new Error('invalid_failure_checkpoint');
  const tracks = new Map();
  for (const row of state.tracked) {
    if (!positive(row?.id) || tracks.has(row.id) || !Number.isSafeInteger(row.done) || row.done < 0 ||
        typeof row.pending !== 'boolean' || !positive(row.created) || row.created > until) throw new Error('invalid_failure_checkpoint');
    tracks.set(row.id, row);
  }
  return tracks;
}

async function collectRuns(api, start, end, accept) {
  const seen = new Set();
  const complete = await reconcileWindow({
    start, end, scope: 'workflow-failures',
    list: async ({ start, end, page }) => {
      const range = new Date(start).toISOString() + '..' + new Date(end).toISOString();
      const result = await api(base + '?per_page=100&created=' + encodeURIComponent(range) + '&page=' + page);
      return { total: result.total_count, items: result.workflow_runs };
    },
    accept: run => {
      checkRun(run, run.id, run.run_attempt);
      if (seen.has(run.id)) throw new Error('unstable_run_pagination');
      seen.add(run.id);
      accept(run);
    },
    gap: () => { throw new Error('incomplete_run_window'); },
  });
  if (!complete) throw new Error('incomplete_run_window');
}

export async function reconcileFailures(options, state, now) {
  const { api } = options;
  const until = Math.floor(now / 1000) * 1000;
  const tracked = state ? validateCheckpoint(state, until) : new Map();
  const activation = state?.activation ?? until - HOUR;
  if (!positive(activation) || activation > until) throw new Error('invalid_activation_time');
  const start = state ? state.until - OVERLAP : activation;
  const recent = new Map();
  await collectRuns(api, start, until, run => recent.set(run.id, run));

  // Query dense pending cohorts by creation hour instead of one API call per queued run.
  const buckets = new Map();
  for (const row of tracked.values()) {
    if (!row.pending || recent.has(row.id)) continue;
    const bucket = Math.floor(row.created / HOUR) * HOUR;
    if (!buckets.has(bucket)) buckets.set(bucket, new Set());
    buckets.get(bucket).add(row.id);
  }
  for (const [hour, ids] of buckets) {
    if (ids.size >= 8) {
      await collectRuns(api, hour, Math.min(until, hour + HOUR - 1000), run => {
        if (ids.has(run.id)) recent.set(run.id, run);
      });
    }
    for (const id of ids) {
      if (recent.has(id)) continue;
      try {
        const run = await api(base + '/' + id);
        recent.set(id, checkRun(run, id, run.run_attempt));
      } catch (error) {
        if (error.status !== 404) throw error;
        console.warn('::warning::Previously observed workflow run ' + id + ' became unavailable before its conclusion');
        tracked.delete(id);
      }
    }
  }

  // GitHub's list API filters on creation time, not completion time. Revisit two hours of
  // older creations each tick, including successful reruns whose previous attempts failed.
  // A pass over GitHub's 30-day rerun window takes about 30 hours at five-minute cadence.
  const backfillFloor = until - 30 * 24 * HOUR;
  const auditEnd = state?.auditBefore && state.auditBefore >= backfillFloor
    ? Math.min(state.auditBefore, start - 1000) : start - 1000;
  const auditStart = Math.max(backfillFloor, auditEnd - 2 * HOUR + 1000);
  if (auditStart <= auditEnd) {
    await collectRuns(api, auditStart, auditEnd, run => {
      if (recent.has(run.id)) return;
      if (run.run_attempt > 1 || run.status !== 'completed' ||
          (failure.has(run.conclusion) && Date.parse(run.updated_at) >= activation)) recent.set(run.id, run);
    });
  }

  for (const run of recent.values()) {
    const created = Date.parse(run.created_at);
    if (!positive(created) || created > until) throw new Error('unverified_run_time');
    const prior = tracked.get(run.id);
    let done = prior?.done ?? 0;
    const pending = run.status !== 'completed';
    const completedAttempts = run.run_attempt - (pending ? 1 : 0);
    // Old runs can be rerun after activation. Check each exact attempt's completion
    // timestamp so the reconciliation circuit never files historical pre-rollout bugs.
    const predatesActivation = created < activation;
    if (done > completedAttempts) throw new Error('regressed_attempt_history');
    while (done < completedAttempts) {
      const attempt = done + 1;
      const exact = attempt === run.run_attempt ? run : checkRun(
        await api(base + '/' + run.id + '/attempts/' + attempt), run.id, attempt);
      if (exact.status !== 'completed') throw new Error('previous_attempt_not_terminal');
      if (predatesActivation && !Number.isFinite(Date.parse(exact.updated_at))) throw new Error('unverified_completion_time');
      if (!predatesActivation || Date.parse(exact.updated_at) >= activation) {
        await reportAttempt(options, run.id, attempt, exact);
      }
      done = attempt;
    }
    tracked.set(run.id, { id: run.id, created, done, pending });
  }
  return { version: 1, activation, until, auditBefore: auditStart - 1000, tracked: [...tracked.values()].filter(row => row.pending || row.created >= until - OVERLAP) };
}

export function requestedAttempts({ ATTEMPTS, RUN_ID, RUN_ATTEMPT }) {
  if (ATTEMPTS) {
    if (RUN_ID || RUN_ATTEMPT || ATTEMPTS.length > 2000) throw new Error('invalid_attempt_batch');
    const batch = JSON.parse(ATTEMPTS);
    if (!Array.isArray(batch) || !batch.length || batch.length > 20 ||
        !batch.every(pair => Array.isArray(pair) && pair.length === 2 && pair.every(positive))) throw new Error('invalid_attempt_batch');
    return [...new Map(batch.map(pair => [pair.join(':'), pair])).values()];
  }
  if (!RUN_ID && !RUN_ATTEMPT) return [];
  if (![RUN_ID, RUN_ATTEMPT].every(value => /^[1-9][0-9]*$/.test(value ?? '') && positive(Number(value)))) throw new Error('both_numeric_selectors_required');
  return [[Number(RUN_ID), Number(RUN_ATTEMPT)]];
}

function githubApi(token) {
  if (!token) throw new Error('missing_github_token');
  return async (path, init = {}) => {
    if (!path.startsWith('/repos/' + repository + '/')) throw new Error('invalid_github_api_path');
    const response = await fetch('https://api.github.com' + path, { ...init, redirect: 'error',
      signal: AbortSignal.timeout(20000), headers: {
        authorization: 'Bearer ' + token, accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28', ...(init.body ? { 'content-type': 'application/json' } : {}),
      } });
    if (!response.ok) throw Object.assign(new Error('github_http_' + response.status), { status: response.status });
    return response.status === 204 ? null : response.json();
  };
}

async function main(env) {
  if (env.GITHUB_REPOSITORY !== repository || env.GITHUB_REF !== 'refs/heads/main') throw new Error('trusted_main_required');
  const api = githubApi(env.GITHUB_TOKEN);
  const catalog = JSON.parse(await readFile(new URL('../engineering-notifications/workflow-channels.json', import.meta.url), 'utf8'));
  const reporter = createWorkflowFailureReporter({ api, repository, catalog,
    ensureMainRedIssue: (run, labels) => ensureMainRedIssue({ api, repository, run, labels }),
  });
  const options = { api, reporter };
  const attempts = requestedAttempts(env);
  if (attempts.length) {
    let errors = 0;
    for (const [id, attempt] of attempts) {
      try {
        const result = await reportAttempt(options, id, attempt);
        console.log('Run ' + id + ' attempt ' + attempt + ': ' + result.action + (result.issueNumber ? ' #' + result.issueNumber : ''));
      } catch {
        console.error('::error::Unable to confirm issue delivery for run ' + id + ', attempt ' + attempt);
        errors++;
      }
    }
    if (errors) throw new Error('incomplete_dispatched_batch');
    return;
  }
  let state;
  try { state = JSON.parse(await readFile(env.CURSOR_FILE, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!state) console.warn('::warning::No saved workflow-failure checkpoint. Reconciling the most recent hour of created runs.');
  const next = await reconcileFailures(options, state, Date.now());
  await writeFile(env.CURSOR_FILE + '.tmp', JSON.stringify(next), { mode: 0o600 });
  await rename(env.CURSOR_FILE + '.tmp', env.CURSOR_FILE);
  console.log('Reconciled through ' + new Date(next.until).toISOString() + ', tracking ' + next.tracked.filter(row => row.pending).length + ' unfinished runs.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.env).catch(error => {
    console.error('::error::Workflow failure reporting incomplete (' + (/^[a-z_0-9]+$/.test(error.message) ? error.message : 'unreadable_evidence') + ').');
    process.exitCode = 1;
  });
}
