// D5663: complete TAP and producer provenance before health recovery.
//
// D5663: validate complete, attempt-bound future-clock artifacts before any recovery decision.
import { createHash } from 'node:crypto';

// Tests that skip themselves, deterministically, on every Actions runner unless
// an environment opts them in. Each is matched by its exact top-level TAP name
// AND its exact skip directive: '' is a bare `# SKIP` (the Worker suites'
// `skip: !process.env.X`), any other string is the one reason that test prints.
// A skip with a different reason, a duplicate marker, a skipped subtest, or any
// other skipped assertion is incomplete evidence.
const OPTIONAL_SKIPS = new Map([
  // Worker integration suites: explicit local Wrangler opt-in.
  ['runtime drift — every derived /api path is mounted (no 404)', ''],
  ['Stripe webhook fulfilment invariants (MI Pro)', ''],
  ['Stripe webhook fulfilment invariants (founder tier + investor)', ''],
  // D8920: frontend suites. D7142's 600+ MiB proof runs only with D7142_LARGE=1;
  // D7905's ACL behaviour needs root, which an Actions runner job is not.
  ["bounded memory: a >600 MiB export, past Node's string limit, under --max-old-space-size=512 (D7142_LARGE=1)",
    'set D7142_LARGE=1 to write and read a 600+ MiB export'],
  ['D7905 behaviour: under umask 0077 the candidate UID reads the staged inputs and nothing else of the listener',
    'needs root, setfacl and setpriv to switch to the candidate UID'],
]);

export function inspectTap(tap) {
  if (typeof tap !== 'string' || !tap.trim()) return { state: 'unknown', code: 'tap_missing' };
  const lines = tap.split(/\r?\n/);
  const plans = lines.filter(s => /^1\.\.\d+\s*$/.test(s));
  const headers = lines.filter(s => s === 'TAP version 13');
  const result = lines.flatMap(s => /^(not ok|ok) (\d+) - /.test(s) ? [Number(/^(?:not ok|ok) (\d+)/.exec(s)[1])] : []);
  const summaries = lines.map(s => /^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/.exec(s)).filter(Boolean);
  const summary = name => { const all = summaries.filter(s => s[1] === name); return all.length === 1 ? Number(all[0][2]) : null; };
  const tests = summary('tests'), passed = summary('pass'), failed = summary('fail'), cancelled = summary('cancelled'), skipped = summary('skipped'), todo = summary('todo');
  const failedRoots = lines.filter(s => /^not ok \d+ - /.test(s)).length;
  const planned = plans.length === 1 ? Number(plans[0].slice(3)) : null;
  if (headers.length !== 1 || !Number.isSafeInteger(planned) || planned < 1 || result.length !== planned || result.some((n, i) => n !== i + 1)
      || [tests, passed, failed, cancelled, skipped, todo].some(n => !Number.isSafeInteger(n))
      || tests < planned || passed + failed + cancelled + skipped + todo !== tests
      || failedRoots > failed + cancelled || failed > 0 && !failedRoots
      || !lines.some(s => /^# duration_ms [\d.]+$/.test(s)) || lines.some(s => /^\s*Bail out!/.test(s))) return { state: 'unknown', code: 'tap_incomplete' };
  const optionalSkips = lines.flatMap(line => {
    const match = /^ok \d+ - (.+?) # SKIP(?: (.+))?$/.exec(line);
    return match && OPTIONAL_SKIPS.has(match[1]) && OPTIONAL_SKIPS.get(match[1]) === (match[2] ?? '') ? [match[1]] : [];
  });
  const onlyOptionalSkips = skipped === optionalSkips.length && skipped === new Set(optionalSkips).size;
  if (cancelled || todo || !onlyOptionalSkips || passed + failed === 0) return { state: 'unknown', code: 'tests_not_executed', tests, failed };
  return { state: failed ? 'failure' : 'green', code: failed ? 'assertion_failure' : 'complete_green', tests, failed };
}

/** blobs: [{part, manifest, tap}]; jobs are from the trusted same-attempt Actions jobs API. */
export function assessFutureClock({ expected, blobs, jobs, runId, attempt, sha }) {
  const discrepancies = [], verified = []; let knownPartialFailures = 0;
  const names = blobs.map(b => b.part);
  if (new Set(names).size !== names.length || names.some(p => !expected.includes(p))) discrepancies.push('unexpected_or_duplicate_artifact');
  for (const part of expected) {
    const blob = blobs.find(b => b.part === part);
    if (!blob) { discrepancies.push(`missing:${part}`); continue; }
    const matches = jobs.filter(j => j.name === `future clock (${part})`);
    const job = matches.length === 1 ? matches[0] : null;
    const ran = job?.status === 'completed' && job.conclusion === 'success' && job.steps?.some(s => s.name === 'Run the part 7 days ahead' && s.status === 'completed' && s.conclusion === 'success');
    const m = blob.manifest;
    if (!ran || !m || m.schema !== 1 || m.part !== part || String(m.runId) !== String(runId) || Number(m.attempt) !== Number(attempt) || m.sha !== sha || m.days !== 7 || !Number.isInteger(m.exitCode) || m.exitCode < 0 || m.exitCode > 255) {
      discrepancies.push(`execution_unverified:${part}`); continue;
    }
    const digest = createHash('sha256').update(blob.tap || '').digest('hex');
    if (m.bytes !== Buffer.byteLength(blob.tap || '') || m.sha256 !== digest) { discrepancies.push(`artifact_corrupt:${part}`); continue; }
    const evidence = inspectTap(blob.tap);
    if (evidence.code === 'tests_not_executed' && m.exitCode > 0) knownPartialFailures += evidence.failed || 0;
    if (evidence.state === 'unknown' || (m.exitCode === 0) !== (evidence.state === 'green')) { discrepancies.push(`${evidence.code === 'complete_green' ? 'exit_mismatch' : evidence.code}:${part}`); continue; }
    verified.push(evidence);
  }
  const failed = knownPartialFailures + verified.reduce((n, v) => n + v.failed, 0);
  const complete = discrepancies.length === 0 && verified.length === expected.length && expected.length > 0;
  return { state: complete ? (failed ? 'failure' : 'green') : 'incomplete', active: failed ? true : complete ? false : null,
    complete, failed, verifiedParts: verified.length, expectedParts: expected.length, discrepancies };
}
