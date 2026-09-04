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
 *   · retries only a TRANSPORT failure (a registry error, not a finding),
 *     with backoff, because a failure from the audit endpoint is usually
 *     transient — and this repository's frontend tree, at 325 packages, is
 *     chronically marginal against it. Measured, not assumed: on the run that
 *     prompted the retry count going up, `audit (worker npm)` answered in 75s
 *     while `audit (frontend npm)` timed out four times against the same
 *     endpoint in the same minutes. It is not an outage; it is a large payload
 *     the endpoint frequently fails to serve in time;
 *   · bounds each attempt with `--fetch-timeout` AND `--fetch-retries=0`, so
 *     the bound is real rather than tripled by npm's own retrying, and a hang
 *     cannot eat the job's ten minutes before anyone learns why;
 *   · on a real finding, prints the advisories at or above the threshold
 *     rather than only the exit code.
 *
 * Usage, from the package directory:
 *   node ../scripts/npm-audit-gate.mjs --level=critical
 */
import { spawnSync } from 'node:child_process';

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

let last = null;
for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  const verdict = classify(runAudit());
  if (verdict.ran) process.exit(report(verdict.payload));

  last = verdict.detail;
  console.error(`npm-audit-gate: attempt ${attempt}/${ATTEMPTS} could not reach the advisory database — ${last}`);
  const wait = BACKOFF_MS[attempt - 1];
  if (attempt < ATTEMPTS && wait) {
    console.error(`  retrying in ${wait / 1000}s`);
    // Synchronous, so the log stays in order and no attempt overlaps another.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
  }
}

console.error(
  `\n✖ npm-audit-gate: the npm advisory database was unreachable on all ${ATTEMPTS} attempts.\n`
  + `  Last error: ${last}\n\n`
  + '  THIS IS NOT A VULNERABILITY FINDING. Nothing was checked, which is why this\n'
  + '  still fails rather than passing: a gate that could not ask the question must\n'
  + '  not answer it. If registry.npmjs.org is having an incident, re-run this job\n'
  + '  once it recovers — no code change will fix it.',
);
process.exit(1);
