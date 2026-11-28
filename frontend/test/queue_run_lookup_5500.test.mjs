// D5500 (#5500): the exact-SHA merge-queue reuse decision on a push to main, run on fixtures.
//
// `verified` (ci.yml, "merge-queue run lookup") runs scripts/ci/queue-run-lookup.mjs. Only a successful
// merge_group run of ci.yml on the pushed commit lets the push skip its suite parts; every other answer — a run
// that is not there yet, a run on another commit or event, a failed or cancelled run, an API that cannot be read —
// leaves `run` empty, and the suite runs in full. The last tests execute the two gates' own shell on the outcomes:
// a skipped or cancelled suite without that evidence fails both.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ATTEMPTS, DELAY_MS, lookup, main, matchRun, runsPath, summary } from '../../scripts/ci/queue-run-lookup.mjs';

const REPO = 'example-org/example-repo';
const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const URL_OK = 'https://example.test/runs/1';

const run = (over = {}) => ({ head_sha: SHA, event: 'merge_group', conclusion: 'success', html_url: URL_OK, ...over });
const page = (...runs) => ({ total_count: runs.length, workflow_runs: runs });
const FAIL = Symbol('api unavailable');

// One scripted answer per call; FAIL makes that call reject, as a failed `gh api` does.
function script(...answers) {
  const calls = [];
  const sleeps = [];
  return {
    calls,
    sleeps,
    fetchRuns: async (path) => {
      calls.push(path);
      const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
      if (answer === FAIL) throw new Error('HTTP 502');
      return answer;
    },
    sleep: async (ms) => { sleeps.push(ms); },
  };
}

test('the API query is the one the inline step made: this workflow, this commit, merge_group, success, one run', () => {
  assert.equal(runsPath(REPO, SHA), `repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${SHA}&event=merge_group&status=success&per_page=1`);
  assert.equal(ATTEMPTS, 4);
  assert.equal(DELAY_MS, 20_000);
});

test('exact match: the first lookup finds the queue run and the suite is skipped', async () => {
  const s = script(page(run()));
  const r = await lookup({ repo: REPO, sha: SHA, fetchRuns: s.fetchRuns, sleep: s.sleep });
  assert.deepEqual([r.run, r.outcome], [URL_OK, 'reused']);
  assert.equal(s.calls.length, 1);
  assert.deepEqual(s.sleeps, [], 'no wait after a match');
});

test('delayed success: the queue run closes after the push starts and a later lookup finds it', async () => {
  const s = script(page(), page(), page(run()));
  const r = await lookup({ repo: REPO, sha: SHA, fetchRuns: s.fetchRuns, sleep: s.sleep });
  assert.deepEqual([r.run, r.outcome], [URL_OK, 'reused']);
  assert.equal(s.calls.length, 3);
  assert.deepEqual(s.sleeps, [DELAY_MS, DELAY_MS]);
  assert.deepEqual(r.trail.map(t => t.result), ['none', 'none', 'found']);
});

test('a run that succeeds only after the fourth lookup is a miss: the suite runs', async () => {
  const s = script(page(), page(), page(), page(), page(run()));
  const r = await lookup({ repo: REPO, sha: SHA, fetchRuns: s.fetchRuns, sleep: s.sleep });
  assert.deepEqual([r.run, r.outcome], ['', 'miss']);
  assert.equal(s.calls.length, ATTEMPTS);
  assert.deepEqual(s.sleeps, [DELAY_MS, DELAY_MS, DELAY_MS], 'no wait after the last lookup');
});

for (const [label, answer] of [
  ['wrong SHA', page(run({ head_sha: OTHER }))],
  ['wrong event (a push run)', page(run({ event: 'push' }))],
  ['wrong event (a pull_request run)', page(run({ event: 'pull_request' }))],
  ['failed run', page(run({ conclusion: 'failure' }))],
  ['cancelled run', page(run({ conclusion: 'cancelled' }))],
  ['skipped run', page(run({ conclusion: 'skipped' }))],
  ['still in progress', page(run({ conclusion: null }))],
  ['no runs', page()],
  ['no workflow_runs field', {}],
  ['a match listed second only', page(run({ head_sha: OTHER }), run())],
]) {
  test(`${label}: no reuse, the full suite runs (miss)`, async () => {
    const s = script(answer);
    const r = await lookup({ repo: REPO, sha: SHA, fetchRuns: s.fetchRuns, sleep: s.sleep });
    assert.deepEqual([r.run, r.outcome], ['', 'miss']);
    assert.equal(s.calls.length, ATTEMPTS, 'it looks every time before giving up');
  });
}

test('API unavailable on every lookup: no reuse, the full suite runs (unavailable)', async () => {
  const s = script(FAIL);
  const r = await lookup({ repo: REPO, sha: SHA, fetchRuns: s.fetchRuns, sleep: s.sleep });
  assert.deepEqual([r.run, r.outcome], ['', 'unavailable']);
  assert.equal(s.calls.length, ATTEMPTS);
  assert.match(summary(r, SHA), /lookup unavailable \(4 of 4 lookups failed\).*the full suite runs on this push/);
});

test('an API failure followed by a match still reuses; a failure followed by misses reports unavailable', async () => {
  const found = await lookup({ repo: REPO, sha: SHA, ...script(FAIL, page(run())) });
  assert.deepEqual([found.run, found.outcome], [URL_OK, 'reused']);
  const missed = script(FAIL, page());
  const r = await lookup({ repo: REPO, sha: SHA, ...missed });
  assert.deepEqual([r.run, r.outcome], ['', 'unavailable']);
  assert.deepEqual(r.trail.map(t => t.result), ['error', 'none', 'none', 'none']);
});

test('no commit or repository: nothing is asked and the suite runs', async () => {
  const s = script(page(run()));
  for (const args of [{ repo: REPO, sha: '' }, { repo: '', sha: SHA }]) {
    const r = await lookup({ ...args, fetchRuns: s.fetchRuns, sleep: s.sleep });
    assert.deepEqual([r.run, r.outcome], ['', 'unavailable']);
  }
  assert.equal(s.calls.length, 0);
});

test('matchRun reads only the newest listed run and wants a URL', () => {
  assert.equal(matchRun(page(run()), SHA), URL_OK);
  assert.equal(matchRun(page(run({ html_url: null })), SHA), '');
  assert.equal(matchRun(null, SHA), '');
  assert.equal(matchRun(page(run()), ''), '');
});

test('main writes `run` and `outcome` to the step outputs and the outcome to the step summary', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'queue-run-lookup-'));
  try {
    for (const [answers, want, outcome, said] of [
      [[page(run())], URL_OK, 'reused', /^Merge-queue run reused: .* The suite parts are skipped on this push\.$/],
      [[page()], '', 'miss', /^No successful merge-queue run of ci\.yml on a{40} after 4 lookups: the full suite runs on this push\.$/],
      [[FAIL], '', 'unavailable', /^Merge-queue run lookup unavailable/],
    ]) {
      const env = { REPO, SHA, GITHUB_OUTPUT: join(dir, `${outcome}.out`), GITHUB_STEP_SUMMARY: join(dir, `${outcome}.md`) };
      const lines = [];
      const s = script(...answers);
      await main(env, { fetchRuns: s.fetchRuns, sleep: s.sleep, log: l => lines.push(l) });
      assert.equal(readFileSync(env.GITHUB_OUTPUT, 'utf8'), `run=${want}\noutcome=${outcome}\n`);
      assert.match(readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8').trim(), said);
      assert.match(lines.join('\n'), said);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('main never throws: a lookup that blows up reports unavailable with an empty run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'queue-run-lookup-'));
  try {
    const env = { REPO, SHA, GITHUB_OUTPUT: join(dir, 'out') };
    const r = await main(env, { fetchRuns: async () => page(), sleep: async () => { throw new Error('boom'); }, log: () => {} });
    assert.deepEqual([r.run, r.outcome], ['', 'unavailable']);
    assert.equal(readFileSync(env.GITHUB_OUTPUT, 'utf8'), 'run=\noutcome=unavailable\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The gates read `needs.verified.outputs.run`. Run their own shell: only a push with the lookup's run and a skipped
// suite may pass without the suite; a skipped or cancelled suite with no run fails.
const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
function gateScript(jobId) {
  const job = ci.slice(ci.indexOf(`\n  ${jobId}:\n`) + 1);
  const body = job.slice(0, job.search(/\n {2}[a-z][\w-]*:\n/) + 1);
  return body.match(/ {8}run: \|\n((?: {10}[^\n]*\n|\n)+)/)[1].replace(/^ {10}/gm, '');
}
const verdict = (jobId, env) =>
  spawnSync('bash', ['-c', gateScript(jobId)], { encoding: 'utf8', env: { ...process.env, EVENT: 'push', DRAFT: '', PLAN: 'success', REQUIRED: 'pass', ROUTED: '', VERIFIED_RUN: '', ...env } }).status;

for (const jobId of ['gate', 'landing']) {
  test(`${jobId}: on a push, a reused queue run passes; a miss or unavailable lookup needs the suite`, () => {
    assert.equal(verdict(jobId, { VERIFIED_RUN: URL_OK, SUITE: 'skipped' }), 0, 'reused');
    assert.equal(verdict(jobId, { SUITE: 'success' }), 0, 'miss or unavailable, full suite passed');
    assert.equal(verdict(jobId, { SUITE: 'skipped' }), 1, 'skipped suite without trusted evidence');
    assert.equal(verdict(jobId, { SUITE: 'cancelled' }), 1, 'cancelled suite without trusted evidence');
    assert.equal(verdict(jobId, { SUITE: 'failure' }), 1, 'failed suite');
    assert.equal(verdict(jobId, { VERIFIED_RUN: URL_OK, SUITE: 'cancelled' }), 1, 'a cancelled suite fails even with a queue run');
    assert.equal(verdict(jobId, { VERIFIED_RUN: URL_OK, SUITE: 'failure' }), 1, 'a failed suite fails even with a queue run');
    assert.equal(verdict(jobId, { EVENT: 'merge_group', PLAN: 'skipped', VERIFIED_RUN: URL_OK, SUITE: 'skipped' }), 1, 'only a push may rely on a queue run');
  });
}

test('the job that runs the lookup is named for what it does, not for one outcome', () => {
  assert.ok(!ci.includes('already verified in the merge queue'));
  assert.match(ci, /\n {2}verified:\n {4}name: merge-queue run lookup\n {4}if: github\.event_name == 'push'\n/);
});

test('the command line calls `gh api` with the query and writes the step output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'queue-run-lookup-cli-'));
  try {
    const args = join(dir, 'args');
    writeFileSync(join(dir, 'gh'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${args}'\nprintf '%s' '${JSON.stringify(page(run()))}'\n`);
    chmodSync(join(dir, 'gh'), 0o755);
    const out = join(dir, 'out');
    const r = spawnSync(process.execPath, ['scripts/ci/queue-run-lookup.mjs'], {
      encoding: 'utf8',
      env: { PATH: `${dir}:${process.env.PATH}`, REPO, SHA, GITHUB_OUTPUT: out },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(args, 'utf8'), `api\n${runsPath(REPO, SHA)}\n`);
    assert.equal(readFileSync(out, 'utf8'), `run=${URL_OK}\noutcome=reused\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
