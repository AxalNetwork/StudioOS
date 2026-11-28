/**
 * D5500 (#5500): on a push to main, look for the successful merge-queue run of ci.yml on this exact commit.
 *
 * The queue lands the very commit it tested, so when that run passed, the push need not run the full suite a
 * second time. Only an exact match counts: this workflow, this head SHA, the `merge_group` event and a `success`
 * conclusion. Anything else — no run yet, a run on another commit or event, a failed or cancelled run, or an
 * API that cannot be read — leaves `run` empty, and an empty `run` makes the suite run in full on the push.
 *
 * Writes two step outputs, `run` (the queue run's URL, or empty) and `outcome`, one of:
 *   reused       the queue already passed the full suite on this commit; the suite parts are skipped
 *   miss         every lookup answered and none matched; the full suite runs on this push
 *   unavailable  at least one lookup could not be read and none matched; the full suite runs on this push
 * It never fails the job: a lookup it cannot finish is reported as `unavailable`, which runs the suite.
 */
import { execFile } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ATTEMPTS = 4;
// The queue merges as soon as its required checks pass, so its run can still be closing when this push starts.
export const DELAY_MS = 20_000;

export function runsPath(repo, sha) {
  return `repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&event=merge_group&status=success&per_page=1`;
}

/** The newest listed run, only if it is a successful merge_group run on exactly `sha`; otherwise ''. */
export function matchRun(body, sha) {
  const run = Array.isArray(body?.workflow_runs) ? body.workflow_runs[0] : undefined;
  if (!run || !sha) return '';
  if (run.head_sha !== sha || run.event !== 'merge_group' || run.conclusion !== 'success') return '';
  return typeof run.html_url === 'string' ? run.html_url : '';
}

/**
 * Look up to `attempts` times, `delayMs` apart, stopping at the first match.
 * `fetchRuns(path)` resolves to the API's parsed JSON body and rejects when the call fails.
 */
export async function lookup({ repo, sha, fetchRuns, sleep, attempts = ATTEMPTS, delayMs = DELAY_MS }) {
  const trail = [];
  if (!repo || !sha) return { run: '', outcome: 'unavailable', trail: [{ attempt: 0, result: 'error', detail: 'REPO or SHA is not set' }] };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let run = '';
    try {
      run = matchRun(await fetchRuns(runsPath(repo, sha)), sha);
      trail.push({ attempt, result: run ? 'found' : 'none' });
    } catch {
      trail.push({ attempt, result: 'error' });
    }
    if (run) return { run, outcome: 'reused', trail };
    if (attempt < attempts) await sleep(delayMs);
  }
  return { run: '', outcome: trail.some(t => t.result === 'error') ? 'unavailable' : 'miss', trail };
}

export function summary({ run, outcome, trail }, sha) {
  const failed = trail.filter(t => t.result === 'error').length;
  if (outcome === 'reused') return `Merge-queue run reused: the queue already passed the full suite on ${sha}: ${run}. The suite parts are skipped on this push.`;
  if (outcome === 'miss') return `No successful merge-queue run of ci.yml on ${sha} after ${trail.length} lookups: the full suite runs on this push.`;
  return `Merge-queue run lookup unavailable (${failed} of ${trail.length} lookups failed) on ${sha || 'an unknown commit'}: the full suite runs on this push.`;
}

function ghApi(path) {
  return new Promise((resolve, reject) => {
    execFile('gh', ['api', path], { maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error) return reject(new Error('gh api failed'));
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error('gh api returned no JSON'));
      }
    });
  });
}

export async function main(env = process.env, { fetchRuns = ghApi, sleep = ms => new Promise(r => setTimeout(r, ms)), log = console.log } = {}) {
  let result;
  try {
    result = await lookup({ repo: env.REPO, sha: env.SHA, fetchRuns, sleep });
  } catch {
    result = { run: '', outcome: 'unavailable', trail: [{ attempt: 0, result: 'error' }] };
  }
  const line = summary(result, env.SHA);
  log(line);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `run=${result.run}\noutcome=${result.outcome}\n`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`);
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
