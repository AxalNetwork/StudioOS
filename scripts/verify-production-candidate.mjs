/**
 * D5501: require a main SHA and its six trusted Actions check results.
 *
 * D5501: admit a main commit with all six trusted Actions checks. D8932: that
 * commit is the tip, or an ancestor of it within a bound and not older than the
 * Worker production serves.
 */
import { resolve } from 'node:path';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { VERSION_PATH, versionVerdict } from './lib/deployProvenance.mjs';

const repo = 'AxalNetwork/StudioOS';
const workflows = {
  'ci.yml': ['frontend (build)', 'worker (typecheck)', 'api ↔ worker drift', 'test:drift (full suite)'],
  'migration-immutability.yml': ['applied migrations unchanged'],
  'gitleaks.yml': ['scan'],
};
const fullSha = /^[0-9a-f]{40}$/;
const apiRoot = `/repos/${repo}`;
// D8932: how far a verified candidate may trail the main tip and still ship.
export const MAX_BEHIND_COMMITS = 30;
export const MAX_BEHIND_MS = 6 * 60 * 60_000;
// D8932: the Worker production serves, as GET /api/public/version names it (D8073).
const DEPLOYED_VERSION_URL = `https://axal.vc${VERSION_PATH}`;

function commitTime(commit) {
  const time = Date.parse(commit?.commit?.committer?.date ?? '');
  if (!Number.isFinite(time)) throw new Error('Commit time unreadable.');
  return time;
}

// GET /compare/{base}...{head}: `behind` means head is an ancestor of base, `ahead` that it descends from it.
async function compare(get, base, head) {
  const result = await get(`${apiRoot}/compare/${base}...${head}`);
  if (!['identical', 'ahead', 'behind', 'diverged'].includes(result?.status) || !Number.isSafeInteger(result.ahead_by) ||
      !Number.isSafeInteger(result.behind_by) || result.base_commit?.sha !== base) {
    throw new Error('Commit comparison unreadable.');
  }
  return result;
}

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

async function readSha(readDeployed) {
  try {
    const sha = await readDeployed();
    return fullSha.test(sha ?? '') ? sha : null;
  } catch {
    return null;
  }
}

// D8932: `readDeployed` resolves the commit production serves; anything but a full SHA is unreadable.
export async function verifyCandidate(candidate, get, readDeployed = async () => null) {
  if (!fullSha.test(candidate ?? '')) return { status: 'untrusted' };
  const tip = await get(`${apiRoot}/git/ref/heads/main`);
  if (tip.ref !== 'refs/heads/main' || tip.object?.type !== 'commit' || !fullSha.test(tip.object?.sha ?? '')) {
    throw new Error('Main ref unreadable.');
  }
  const main = tip.object.sha;
  let behind_by = 0, deployed;
  if (main === candidate) {
    // The tip keeps D5501's rule: it cannot be older than a main commit already served, so the read is evidence only.
    deployed = await readSha(readDeployed);
  } else {
    const ancestry = await compare(get, main, candidate);
    if (!['behind', 'identical'].includes(ancestry.status)) return { candidate, status: 'untrusted', main, comparison: ancestry.status };
    if (ancestry.status === 'behind') {
      if (ancestry.ahead_by !== 0 || ancestry.behind_by < 1 || ancestry.merge_base_commit?.sha !== candidate) {
        throw new Error('Commit comparison unreadable.');
      }
      behind_by = ancestry.behind_by;
      const lag = commitTime(ancestry.base_commit) - commitTime(ancestry.merge_base_commit);
      if (behind_by > MAX_BEHIND_COMMITS || lag > MAX_BEHIND_MS) return { candidate, status: 'superseded', main, behind_by };
    }
    deployed = await readSha(readDeployed);
    if (!deployed) return { candidate, status: 'unreadable', main, behind_by, deployed: null, reason: 'deployed version unreadable' };
    if (deployed !== candidate) {
      const progress = await compare(get, deployed, candidate);
      if (!['ahead', 'identical'].includes(progress.status)) return { candidate, status: 'stale', main, behind_by, deployed };
    }
  }
  const checks = await Promise.all(Object.entries(workflows).map(([file, contexts]) => checkWorkflow(get, candidate, file, contexts)));
  const terminal = checks.find(check => ['untrusted', 'failed'].includes(check.state));
  return { candidate, status: terminal ? 'blocked' : checks.every(check => check.state === 'verified') ? 'verified' : 'waiting',
    main, behind_by, deployed, checks };
}

async function main(candidate, mode) {
  const token = process.env.GH_TOKEN;
  // Only the initial Worker job consumes a decision. The shared write guards
  // and other workflows continue to require a verified candidate to exit zero.
  const decision = mode === '--wait-for-decision';
  const stage = process.env.STUDIOOS_RELEASE_CHECK;
  const run = process.env.GITHUB_RUN_ID, attempt = process.env.GITHUB_RUN_ATTEMPT;
  const identifiedRun = /^[1-9][0-9]*$/.test(run ?? '') && /^[1-9][0-9]*$/.test(attempt ?? '');
  if (process.env.GITHUB_REPOSITORY !== repo || process.env.GITHUB_REF !== 'refs/heads/main' ||
      !['push', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME) || process.env.GITHUB_SHA !== candidate ||
      !fullSha.test(candidate ?? '') || !token || !['--wait', '--once', '--wait-for-decision'].includes(mode) ||
      (decision && (stage !== 'initial' || !identifiedRun || !process.env.GITHUB_OUTPUT || !process.env.GITHUB_STEP_SUMMARY))) {
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
  async function readDeployed() {
    const response = await fetch(DEPLOYED_VERSION_URL, { redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/json' } });
    return versionVerdict(response.status, await response.text()).sha;
  }
  const deadline = Date.now() + (mode === '--once' ? 0 : 95 * 60_000);
  let report;
  do {
    try { report = await verifyCandidate(candidate, get, readDeployed); }
    catch { report = { candidate, status: 'unreadable' }; }
    if (!['waiting', 'unreadable'].includes(report.status) || Date.now() >= deadline) break;
    await delay(60_000);
  } while (Date.now() < deadline);
  console.log(JSON.stringify(report));
  if (report.status === 'superseded' && report.candidate === candidate && /^[a-z-]+$/.test(stage ?? '') && identifiedRun) {
    console.log('::notice title=StudioOS release outcome v1::' +
      ['superseded', stage, run, attempt, report.candidate, report.main].join(' '));
  }
  if (decision && ['verified', 'superseded', 'stale'].includes(report.status)) {
    if (report.status === 'superseded') {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        `### Deployment skipped\n\nCandidate \`${candidate}\` was superseded by \`${report.main}\` on main before admission.\n`);
    }
    if (report.status === 'stale') {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        `### Deployment skipped\n\nCandidate \`${candidate}\` is older than \`${report.deployed}\`, the version production serves.\n`);
    }
    appendFileSync(process.env.GITHUB_OUTPUT, `decision=${report.status}\n`);
    return;
  }
  if (report.status !== 'verified') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main(process.argv[2], process.argv[3]);
}
