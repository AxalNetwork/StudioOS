/**
 * A REGISTRY OUTAGE MUST NOT LOOK LIKE A VULNERABILITY, AND MUST NOT PASS.
 *
 * `npm audit --audit-level=critical` exits 1 for two entirely different
 * outcomes: a critical advisory in the dependency tree, and the advisory
 * endpoint refusing to answer. On PR #431 the frontend audit job spent seven
 * minutes on
 *
 *     npm warn audit 503 Service Unavailable -
 *       POST https://registry.npmjs.org/-/npm/v1/security/audits/quick
 *
 * and went red with a bare `Process completed with exit code 1` — on a diff
 * that changed no dependency. It was the third time this session these two
 * jobs went red or were cancelled on a registry stall rather than a finding.
 *
 * The fix is NOT tolerance. A gate that could not reach the advisory database
 * has not cleared anything, so it still fails — the same rule
 * `check-docs-fresh.mjs` was hardened to in #397, where a check that could not
 * see the history was made to refuse rather than report success. What changes
 * is that the two outcomes are now distinguishable from the checks list, and
 * that a blip is retried instead of ending the job.
 *
 * These guards exist because the easy "fix" for a flaky security gate is to
 * append `|| true`, and that is the one change that must never land here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';


const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

const CI = read('.github/workflows/ci.yml');
const GATE = read('scripts/npm-audit-gate.mjs');
const SCRIPTS_README = read('scripts/README.md');

test('both npm audit jobs run through the gate, not npm audit directly', () => {
  const calls = CI.match(/node \.\.\/scripts\/npm-audit-gate\.mjs --level=critical/g) || [];
  assert.equal(calls.length, 2, 'the frontend and worker audit jobs both need it');
  assert.doesNotMatch(CI, /run: npm audit /,
    'a bare `npm audit` cannot tell a 503 from a CVE — that is the whole reason the gate exists');
});

/** One job's YAML block, from its header to the next job's. */
function jobBlock(name) {
  const at = CI.indexOf(`\n  ${name}:\n`);
  assert.ok(at > 0, `job ${name} is gone — has it been renamed?`);
  const rest = CI.slice(at + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

test('the gate is never made to pass on a failure', () => {
  // The easy "fix" for a flaky security gate, and the one that must never land.
  assert.doesNotMatch(CI, /npm-audit-gate\.mjs[^\n]*\|\|\s*true/);
  // Checked over each WHOLE job rather than around the call site: a
  // `continue-on-error: true` sits at step level, several lines above the
  // `run:` it disarms, and can be added to either job. Scanning near the first
  // call only would have missed it on the second — which is what the mutation
  // check caught when this test was written the narrow way.
  for (const name of ['audit-frontend', 'audit-worker']) {
    assert.doesNotMatch(jobBlock(name), /continue-on-error:\s*true/,
      `a security gate allowed to fail silently is not a gate (${name})`);
  }
});

test('an unreachable advisory database exits non-zero and says it is not a finding', () => {
  // Both halves matter. Exiting 0 would answer a question the gate could not
  // ask; exiting 1 with no explanation is what made the original failure
  // indistinguishable from a real CVE in the first place.
  assert.match(GATE, /the npm advisory database was unreachable \$\{why\}/);
  // Three ways to run out, and the message names which one — "all N attempts"
  // reads very differently from "the endpoint refused the request", and a
  // reader deciding whether to re-run needs to know which happened.
  for (const kind of ['attempts:', 'deadline:']) {
    assert.ok(GATE.includes(kind), `the summary must distinguish the ${kind} case`);
  }
  assert.match(GATE, /THIS IS NOT A VULNERABILITY FINDING/);
  const tail = GATE.slice(GATE.indexOf('THIS IS NOT A VULNERABILITY FINDING'));
  assert.match(tail, /process\.exit\(1\)/,
    'the run after an unreachable registry must fail, not pass');
  assert.doesNotMatch(tail, /process\.exit\(0\)/);
});

test('only a transport failure is retried — a real finding is reported at once', () => {
  // Retrying a finding would just burn the job's timeout and then report the
  // same advisories, and it would blur the one distinction this script exists
  // to draw.
  assert.match(GATE, /if \(verdict\.ran\) process\.exit\(report\(verdict\.payload\)\);/,
    'a completed audit ends the loop on its first attempt, whatever its verdict');
  assert.match(GATE, /payload\.metadata\.vulnerabilities/,
    'an audit that produced a vulnerability table RAN, whatever npm exited with');
});

test('each attempt is bounded FOR REAL — npm must not retry inside the bound', () => {
  assert.match(GATE, /--fetch-timeout=\$\{FETCH_TIMEOUT_MS\}/);
  // The half that was missing first time round, and the CI log proved it: npm
  // retries a failed request internally (`--fetch-retries`, default 2), so a
  // 60s `--fetch-timeout` bounded one HTTP call and not one attempt. Every
  // timed-out attempt took ~120s against a bound that said 60. Two nested
  // retry policies, with the outer one's budget computed as if the inner did
  // not exist.
  assert.match(GATE, /'--fetch-retries=0'/,
    "without this the timeout below is silently tripled and the budget maths is wrong");
  // One backoff per GAP between attempts. Fewer and the last attempts fire
  // back to back against an endpoint that has just failed, which is the case
  // the backoff exists for.
  const attempts = Number(GATE.match(/'--attempts=(\d+)'/)?.[1] || 0);
  const gaps = (GATE.match(/const BACKOFF_MS = \[([^\]]+)\]/)?.[1] || '').split(',').length;
  assert.ok(attempts > 0, "could not read the gate's own attempt count");
  assert.equal(gaps, attempts - 1,
    `${attempts} attempts need ${attempts - 1} backoff intervals, found ${gaps}`);
});

test('the gate stops before the runner kills it, and says it is stopping', () => {
  // THE BUDGET IS WALL-CLOCK, NOT A COUNT, and the reason is in the CI log for
  // 51fb1d756: attempt 1 took 180s where attempts 2-4 took ~92s, because npm
  // builds the dependency tree before it makes the request and --fetch-timeout
  // bounds only the request. `attempts × perAttempt + backoff` therefore
  // under-counted, both audit jobs ran past `timeout-minutes: 10`, and the
  // runner killed them mid-attempt — printing NOTHING. A cancelled job is the
  // bare indistinguishable red this whole script exists to replace, so running
  // out of time silently is worse than any verdict it could have reached.
  const deadline = Number(GATE.match(/const DEADLINE_MS = ([\d_]+);/)?.[1].replace(/_/g, '') || 0) / 1000;
  const perAttempt = Number(GATE.match(/const FETCH_TIMEOUT_MS = ([\d_]+);/)?.[1].replace(/_/g, '') || 0) / 1000;
  assert.ok(deadline > 0 && perAttempt > 0, "could not read the gate's own budget");

  const jobTimeout = Number(CI.match(/timeout-minutes: (\d+)\n\s+defaults:/)?.[1] || 0) * 60;
  assert.ok(jobTimeout > 0, 'the audit job must declare a timeout to fit inside');
  // Room for `npm ci` before it and the runner's cleanup after: the deadline
  // has to be meaningfully under the job's, not equal to it.
  assert.ok(deadline <= jobTimeout - 60,
    `the gate's ${deadline}s budget must leave the job's ${jobTimeout}s room to install and clean up`);
  assert.ok(deadline >= perAttempt * 2,
    'a budget that cannot fit two attempts makes the retry loop decorative');

  // It has to CHECK the budget before spending, not notice afterwards.
  assert.match(GATE, /if \(attempt > 1 && remaining\(\) < FETCH_TIMEOUT_MS\)/,
    'ask whether a whole attempt still fits before starting one');
  assert.match(GATE, /stopped = 'deadline'/);
  const tail = GATE.slice(GATE.indexOf('THIS IS NOT A VULNERABILITY FINDING'));
  assert.doesNotMatch(tail, /process\.exit\(0\)/);
});

test('every transport failure is retried, and the mix of them is reported', () => {
  // A 4xx rule lived here and was removed. The reasoning was sound in general
  // — a 400 means the endpoint read the request and refused it — and wrong for
  // THIS endpoint: the gate's exact command run five times against the live
  // service returned a success, a 400, a 500 and two network timeouts, for one
  // unchanged dependency tree. A status code here is not a verdict on the
  // request, so giving up on a 400 would abandon a run a retry could finish.
  // This guard pins the removal, because the rule reads so plausible that
  // someone will reintroduce it.
  assert.doesNotMatch(GATE, /isRetryable|verdict\.retryable/,
    'status-code triage was tested against the live endpoint and refuted');
  // What replaces it: report the distinct errors, so a reader can tell four
  // timeouts from a mix without opening the raw log.
  assert.match(GATE, /if \(!seen\.includes\(last\)\) seen\.push\(last\);/);
  assert.match(GATE, /distinct errors/);
});

test('the gate is listed with the other guards', () => {
  assert.match(SCRIPTS_README, /\| `npm-audit-gate\.mjs` \|/);
});
