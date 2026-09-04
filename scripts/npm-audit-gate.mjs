#!/usr/bin/env node
/**
 * `npm audit` as a CI gate that can tell "you have a critical CVE" apart from
 * "the registry did not answer".
 *
 * WHY THIS EXISTS. The two audit jobs in `ci.yml` ran `npm audit --omit=dev
 * --audit-level=critical` directly, and that command exits 1 for both of those
 * outcomes. On PR #431 the frontend job spent seven minutes on
 *
 *     npm warn audit 503 Service Unavailable -
 *       POST https://registry.npmjs.org/-/npm/v1/security/audits/quick
 *     npm error audit endpoint returned an error
 *
 * and then went red with `Process completed with exit code 1` — indistinguish-
 * able, from the checks list, from a real critical advisory in a diff that
 * changed no dependency. That is the third time this session these two jobs
 * have gone red or been cancelled on a registry stall rather than a finding.
 *
 * WHAT IT DOES NOT DO: pass. A gate that cannot reach the advisory database
 * has not cleared the dependencies; it has failed to look at them, and
 * answering "yes" on a question it could not ask is the exact failure
 * `check-docs-fresh.mjs` was hardened against in #397. So an unreachable
 * registry still exits non-zero — it just says so in one line instead of
 * looking like a CVE, and it stops burning the job's whole timeout getting
 * there.
 *
 * WHAT IT DOES:
 *   · retries EVERY transport failure with backoff, whatever its status code.
 *     A 4xx rule was written here first, on the reasoning that `400 Bad
 *     Request` means the endpoint read the request and refused it, so retrying
 *     cannot change its mind. Sound in general, and WRONG for this endpoint:
 *     running the gate's exact command against the live service five times in
 *     a row produced a success, a `400 Bad Request`, a `500 Internal Server
 *     Error` and two network timeouts — for one unchanged dependency tree. A
 *     status code here is not a verdict on the request, so giving up on a 400
 *     would abandon a run a retry could have finished. The rule was built,
 *     tested against the live endpoint, and removed;
 *   · reports the DISTINCT errors it saw rather than only the last, because
 *     "four timeouts" and "a 400, a 500 and two timeouts" tell a reader
 *     different things about whether re-running is worth it;
 *   · bounds each attempt with `--fetch-timeout` AND `--fetch-retries=0`, so
 *     the bound is real rather than tripled by npm's own retrying;
 *   · keeps its OWN wall-clock deadline and stops while there is still time to
 *     print. See DEADLINE_MS: the first attempt costs about twice the rest
 *     because npm builds the dependency tree before it asks anything, an
 *     attempt-count budget missed that, and BOTH audit jobs were killed by the
 *     runner mid-attempt — printing nothing at all, which is the exact
 *     indistinguishable red this script replaces;
 *   · on a real finding, prints the advisories at or above the threshold
 *     rather than only the exit code.
 *
 * A CORRECTION worth keeping, because it was asserted in a commit message and
 * is not supported: this was called "not an outage, just the frontend's larger
 * payload", on the evidence of one run where `audit (worker npm)` answered in
 * 75s while the frontend timed out. On the very next run BOTH jobs failed, the
 * worker's included. One observation was not enough to name a cause, and the
 * gate does not need one — it needs to say clearly which of the two things
 * happened, whatever the reason.
 *
 * Usage, from the package directory:
 *   node ../scripts/npm-audit-gate.mjs --level=critical
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * Only audit when RUN, never when imported.
 *
 * A guard suite briefly imported this module to test a helper against real npm
 * error strings, and importing it fired a live `npm audit` — three minutes of
 * network calls from inside a unit test. The helper is gone; the guard stays,
 * because the property it protects is one a reader will assume anyway: reading
 * this file's exports must not cost a network round trip.
 */
const IS_MAIN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

const ARGS = process.argv.slice(2);
const LEVEL = (ARGS.find((a) => a.startsWith('--level=')) || '--level=critical').split('=')[1];
const ATTEMPTS = Number((ARGS.find((a) => a.startsWith('--attempts=')) || '--attempts=5').split('=')[1]);
/**
 * Per-attempt registry timeout — and it is only honest alongside
 * `--fetch-retries=0` below.
 *
 * The first version of this script set `--fetch-timeout=60000` and assumed
 * that bounded one attempt at a minute. It did not: npm retries a failed
 * request internally (`--fetch-retries`, default 2), so one `npm audit`
 * invocation was up to THREE 60s calls. The CI log shows it exactly — every
 * timed-out attempt took ~120s, not 60. Two retry policies were nested inside
 * each other, and the outer one's budget was computed against the inner one's
 * being absent.
 *
 * So npm's own retrying is turned off and the backoff here is the only retry
 * policy. Five genuinely-bounded attempts plus backoff is 5×90 + 65 = 515s,
 * inside the job's 10 minutes with room to spare — and it is more shots at a
 * flaky endpoint than the old four, which in practice were fewer.
 */
const FETCH_TIMEOUT_MS = 90_000;
const BACKOFF_MS = [5_000, 10_000, 20_000, 30_000];

/**
 * The gate's OWN deadline, and the reason it needs one.
 *
 * Five bounded attempts plus backoff was computed as 515s and it was wrong,
 * because it assumed every attempt costs the same. It does not: `npm audit`
 * builds the dependency tree before it makes the request, and `--fetch-timeout`
 * bounds the request only. The CI log for `51fb1d756` is unambiguous —
 *
 *     10:23:22 → 10:26:22  attempt 1   180s
 *     10:26:27 → 10:27:59  attempt 2    92s
 *     10:28:09 → 10:29:44  attempt 3    95s
 *     10:30:04 → 10:31:36  attempt 4    92s
 *     10:33:13 ##[error]The operation was canceled.
 *
 * — a first attempt costing twice the rest, and both audit jobs killed by the
 * runner's `timeout-minutes: 10` partway through attempt 5.
 *
 * A CANCELLED JOB IS THE FAILURE THIS SCRIPT EXISTS TO PREVENT. The runner
 * kills the process, so nothing prints: no counts, no advisory list, and above
 * all not the line saying this is not a vulnerability finding. The checks list
 * shows a bare red X, which is precisely the indistinguishable outcome the gate
 * was written to replace.
 *
 * So the budget is wall-clock rather than a count. Before each attempt the loop
 * asks whether a whole bounded attempt still fits; when it does not it stops
 * and reports, with time left for the report to be read. 480s against the
 * job's 600s leaves two minutes for `npm ci` and the runner's own cleanup.
 */
const DEADLINE_MS = 480_000;

/** Severities at or above the threshold, in npm's own order. */
const ORDER = ['info', 'low', 'moderate', 'high', 'critical'];
const AT_OR_ABOVE = ORDER.slice(ORDER.indexOf(LEVEL));

function runAudit() {
  return spawnSync(
    'npm',
    [
      'audit', '--omit=dev', `--audit-level=${LEVEL}`, '--json',
      `--fetch-timeout=${FETCH_TIMEOUT_MS}`,
      // See FETCH_TIMEOUT_MS: without this, npm retries inside the call and
      // the bound above silently becomes three times what it says.
      '--fetch-retries=0',
    ],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
}

/**
 * Classify one attempt. `npm audit --json` exits non-zero for BOTH a finding
 * and a transport error, so the exit code alone cannot decide — the payload
 * has to. A body carrying `metadata.vulnerabilities` means the audit ran and
 * its answer is trustworthy whatever the exit code says; a body carrying a
 * top-level `error`, or no parseable JSON at all, means it did not run.
 */
function classify(res) {
  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  let payload = null;
  try { payload = JSON.parse(stdout); } catch { /* not JSON — a transport failure prints prose */ }

  if (payload && payload.metadata && payload.metadata.vulnerabilities) {
    return { ran: true, payload };
  }
  const detail = (payload && payload.error && (payload.error.summary || payload.error.detail))
    || stderr.split('\n').find((l) => l.includes('npm error') || l.includes('npm warn audit'))
    || stderr.trim().split('\n').pop()
    || 'no output';
  return { ran: false, detail: String(detail).trim() };
}

function report(payload) {
  const counts = payload.metadata.vulnerabilities || {};
  const summary = ORDER.map((s) => `${counts[s] || 0} ${s}`).join(', ');
  const blocking = AT_OR_ABOVE.reduce((a, s) => a + (counts[s] || 0), 0);
  console.log(`npm audit (prod deps): ${summary}.`);

  if (blocking === 0) {
    console.log(`✓ npm-audit-gate: nothing at or above ${LEVEL} in the production dependency tree.`);
    return 0;
  }
  console.error(`\n✖ npm-audit-gate: ${blocking} advisory(ies) at or above ${LEVEL}.\n`);
  for (const [name, v] of Object.entries(payload.vulnerabilities || {})) {
    if (!AT_OR_ABOVE.includes(v.severity)) continue;
    const via = (v.via || []).map((x) => (typeof x === 'string' ? x : x.title)).filter(Boolean);
    console.error(`  ${name} (${v.severity})${via.length ? ` — ${via.join('; ')}` : ''}`);
    if (v.fixAvailable === false) console.error('    no patched release available');
  }
  return 1;
}

function main() {
const startedAt = Date.now();
const elapsed = () => Date.now() - startedAt;
const remaining = () => DEADLINE_MS - elapsed();

let last = null;
let attempts = 0;
let stopped = 'attempts';
// Distinct, in the order first seen. Four identical timeouts and a mix of
// 400/500/timeout are different stories about the same red check.
const seen = [];
for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  // Ask before spending, not after. An attempt started with less than its own
  // bound left is one the runner may kill mid-flight, taking the report with
  // it — and the report is the whole point.
  if (attempt > 1 && remaining() < FETCH_TIMEOUT_MS) {
    stopped = 'deadline';
    console.error(
      `npm-audit-gate: stopping after ${attempt - 1} attempt(s) — `
      + `${Math.round(remaining() / 1000)}s left of this script's ${DEADLINE_MS / 1000}s budget, `
      + `less than one ${FETCH_TIMEOUT_MS / 1000}s attempt.`,
    );
    break;
  }

  attempts = attempt;
  const verdict = classify(runAudit());
  if (verdict.ran) process.exit(report(verdict.payload));

  last = verdict.detail;
  if (!seen.includes(last)) seen.push(last);
  console.error(`npm-audit-gate: attempt ${attempt}/${ATTEMPTS} could not reach the advisory database — ${last}`);

  const wait = BACKOFF_MS[attempt - 1];
  if (attempt < ATTEMPTS && wait) {
    console.error(`  retrying in ${wait / 1000}s`);
    // Synchronous, so the log stays in order and no attempt overlaps another.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
  }
}

const why = {
  attempts: `on all ${attempts} attempt(s)`,
  deadline: `on ${attempts} attempt(s) before this script's own ${DEADLINE_MS / 1000}s budget ran out`,
}[stopped];

console.error(
  `\n✖ npm-audit-gate: the npm advisory database was unreachable ${why}.\n`
  + `  ${seen.length === 1 ? 'The error' : 'The ' + seen.length + ' distinct errors'} it returned:\n`
  + seen.map((e) => `    · ${e}\n`).join('')
  + `  Spent ${Math.round(elapsed() / 1000)}s of a ${DEADLINE_MS / 1000}s budget.\n\n`
  + '  THIS IS NOT A VULNERABILITY FINDING. Nothing was checked, which is why this\n'
  + '  still fails rather than passing: a gate that could not ask the question must\n'
  + '  not answer it. If registry.npmjs.org is having an incident, re-run this job\n'
  + '  once it recovers — no code change will fix it.',
);
process.exit(1);
}

if (IS_MAIN) main();
