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
  assert.match(GATE, /unreachable on all \$\{ATTEMPTS\} attempts/);
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

test('each attempt is bounded, so a hang cannot eat the job before anyone learns why', () => {
  assert.match(GATE, /--fetch-timeout=\$\{FETCH_TIMEOUT_MS\}/);
  assert.match(GATE, /const FETCH_TIMEOUT_MS = 60_000;/);
  // Four bounded attempts plus backoff must still fit the job's timeout.
  const budget = 4 * 60 + (5 + 15 + 30);
  const jobTimeout = Number(CI.match(/timeout-minutes: (\d+)\n\s+defaults:/)?.[1] || 0) * 60;
  assert.ok(jobTimeout >= budget,
    `the audit job's timeout (${jobTimeout}s) must cover the gate's worst case (${budget}s)`);
});

test('the gate is listed with the other guards', () => {
  assert.match(SCRIPTS_README, /\| `npm-audit-gate\.mjs` \|/);
});
