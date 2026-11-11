/** D5501: admit only the exact main commit with all six trusted Actions checks. */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const repo = 'AxalNetwork/StudioOS';
const workflows = {
  'ci.yml': ['frontend (build)', 'worker (typecheck)', 'api ↔ worker drift', 'test:drift (full suite)'],
  'migration-immutability.yml': ['applied migrations unchanged'],
  'gitleaks.yml': ['scan'],
};
const fullSha = /^[0-9a-f]{40}$/;
const apiRoot = `/repos/${repo}`;

async function checkWorkflow(get, candidate, file, contexts) {
  const { workflow_runs: runs } = await get(`${apiRoot}/actions/workflows/${file}/runs?head_sha=${candidate}&event=push&branch=main&per_page=100`);
  if (!Array.isArray(runs)) throw new Error('Workflow inventory unreadable.');
  if (!runs.length) return { file, state: 'missing' };
  // Do not fall back to a stale green result if the latest run is red or rerunning.
  const run = [...runs].sort((a, b) => b.id - a.id)[0];
  const { id, run_attempt: attempt } = run;
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(attempt) || attempt <= 0 ||
      run.path !== `.github/workflows/${file}` || run.repository?.full_name !== repo ||
      run.head_repository?.full_name !== repo || run.head_sha !== candidate || run.head_branch !== 'main' || run.event !== 'push') {
    return { file, state: 'untrusted' };
  }
  if (run.status === 'completed' && ['cancelled', 'timed_out', 'stale', 'action_required', 'startup_failure', 'skipped'].includes(run.conclusion)) {
    return { file, run: id, attempt, state: 'failed', conclusion: run.conclusion };
  }
  const { jobs } = await get(`${apiRoot}/actions/runs/${id}/attempts/${attempt}/jobs?per_page=100`);
  if (!Array.isArray(jobs)) throw new Error('Workflow jobs unreadable.');
  const evidence = { file, run: id, attempt, checks: [] };
  for (const context of contexts) {
    const matches = jobs.filter(job => job.name === context);
    if (matches.length > 1) return { ...evidence, state: 'untrusted', context };
    const job = matches[0];
    if (!job) return { ...evidence, state: 'missing', context };
    if (!Number.isSafeInteger(job.id) || job.id <= 0 || job.run_id !== id || job.run_attempt !== attempt || job.head_sha !== candidate || job.head_branch !== 'main') {
      return { ...evidence, state: 'untrusted', context };
    }
    if (job.status !== 'completed') return { ...evidence, state: 'pending', context };
    if (job.conclusion !== 'success') return { ...evidence, state: 'failed', context, conclusion: job.conclusion };
    evidence.checks.push({ context, job: job.id });
  }
  return { ...evidence, state: 'verified' };
}

export async function verifyCandidate(candidate, get) {
  if (!fullSha.test(candidate ?? '')) return { status: 'untrusted' };
  const tip = await get(`${apiRoot}/git/ref/heads/main`);
  if (tip.ref !== 'refs/heads/main' || tip.object?.type !== 'commit' || !fullSha.test(tip.object?.sha ?? '')) {
    throw new Error('Main ref unreadable.');
  }
  if (tip.object.sha !== candidate) return { candidate, status: 'superseded', main: tip.object.sha };
  const checks = await Promise.all(Object.entries(workflows).map(([file, contexts]) => checkWorkflow(get, candidate, file, contexts)));
  const terminal = checks.find(check => ['untrusted', 'failed'].includes(check.state));
  return { candidate, status: terminal ? 'blocked' : checks.every(check => check.state === 'verified') ? 'verified' : 'waiting', checks };
}

async function main(candidate, mode) {
  const token = process.env.GH_TOKEN;
  if (process.env.GITHUB_REPOSITORY !== repo || process.env.GITHUB_REF !== 'refs/heads/main' ||
      !['push', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME) || process.env.GITHUB_SHA !== candidate ||
      !fullSha.test(candidate ?? '') || !token || !['--wait', '--once'].includes(mode)) {
    console.error('Production admission requires the canonical main workflow, exact SHA and Actions read access.');
    process.exitCode = 1;
    return;
  }
  async function get(path) {
    const response = await fetch(`https://api.github.com${path}`, { redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`GitHub verification request failed (${response.status}).`);
    return response.json();
  }
  const deadline = Date.now() + (mode === '--wait' ? 95 * 60_000 : 0);
  let report;
  do {
    try { report = await verifyCandidate(candidate, get); }
    catch { report = { candidate, status: 'unreadable' }; }
    if (!['waiting', 'unreadable'].includes(report.status) || Date.now() >= deadline) break;
    await delay(60_000);
  } while (Date.now() < deadline);
  console.log(JSON.stringify(report));
  if (report.status !== 'verified') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main(process.argv[2], process.argv[3]);
}
