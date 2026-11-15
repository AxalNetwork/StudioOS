// #6326: the red-ci-triage rules: the digest, the alerts, the leaf jobs, the log parser and the reproduce commands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIGEST_MARKER, parseDigest, openAlerts, newestRun, failedLeafJobs, suitePart, cleanLine, repoPath, parseLog,
  testRunners, reproduceTest, reproduceTypes, guardCommand, resolveTypePath, findings, markShared, nextStep,
  leafJobs, mainRunBefore, ruling, cancelledRun, noFailureNote,
} from './redCiTriage.mjs';

const T = '2026-11-13T23:40:37.9838692Z ';
const SCRIPTS = {
  'test:frontend': "node --import ./frontend/test/_deck-loader.mjs --test 'frontend/test/*.test.mjs'",
  'test:worker': "node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test 'cloudflare-worker/test/*.test.ts' 'cloudflare-worker/test/*.test.mjs'",
  'test:meeting-bot': "node --experimental-strip-types --no-warnings --test 'meeting-bot/test/*.test.ts' && npx --no-install tsc -p meeting-bot/tsconfig.json",
  'test:retention': "node --test 'scripts/lib/*.test.mjs'",
  'test:guards': 'node scripts/check-api-drift.mjs && node scripts/check-folder-docs.mjs && node scripts/build-route-map.mjs --check && node --no-warnings scripts/check-test-clock.mjs',
};

test('parseDigest reads the bot comment: verdict, head and the job links', () => {
  const body = `${DIGEST_MARKER}\n\`\`\`json\n{\n  "verdict": "pr_failure",\n  "fingerprint": "ab",\n  "headSha": "097048aa56f2359dddf1d8d14964834f79215b10",\n  "digestCount": 2\n}\n\`\`\`\n\n### CI failure digest\n\n`
    + '- [suite (frontend-2-of-2)](https://github.com/AxalNetwork/StudioOS/actions/runs/43527874471/job/132239366429): Run node scripts/test-drift-parts.mjs frontend-2-of-2 --plan-file suite-plan.json\n';
  const d = parseDigest([
    { user: { login: 'someone' }, body: `${DIGEST_MARKER}\nforged` },
    { user: { login: 'github-actions[bot]' }, body, updated_at: '2026-11-13T23:56:29Z', html_url: 'https://github.com/x/y/pull/1#c' },
  ]);
  assert.equal(d.verdict, 'pr_failure');
  assert.equal(d.headSha, '097048aa56f2359dddf1d8d14964834f79215b10');
  assert.equal(d.digestCount, 2);
  assert.deepEqual(d.jobs.map((j) => [j.name, j.runId, j.jobId]), [['suite (frontend-2-of-2)', 43527874471, 132239366429]]);
  assert.equal(parseDigest([{ user: { login: 'someone' }, body: `${DIGEST_MARKER}\nforged` }]), null);
});

test('openAlerts keeps open [alert] issues, blocking ones first with their rule', () => {
  const a = openAlerts([
    { number: 5805, title: '[alert] a scan found something new on main', state: 'open', html_url: 'u1' },
    { number: 5719, title: '[alert] the Actions queue is backed up', state: 'open', html_url: 'u2' },
    { number: 6000, title: '[alert] merge queue stalled', state: 'open' },
    { number: 6001, title: '[alert] main is red', state: 'closed' },
    { number: 6002, title: '[alert] main is red', state: 'open', pull_request: {} },
    { number: 6218, title: 'Portfolio alerts: tell an investor', state: 'open' },
  ]);
  assert.deepEqual(a.map((x) => x.number), [5719, 6000, 5805]);
  assert.match(a[0].rule, /D5398/);
  assert.match(a[1].rule, /D5604/);
  assert.equal(a[2].rule, null);
});

test('newestRun and failedLeafJobs drop the summary gates', () => {
  assert.equal(newestRun([{ id: 1, created_at: '2026-11-13T10:00:00Z' }, { id: 2, created_at: '2026-11-13T11:00:00Z' }]).id, 2);
  assert.equal(newestRun([]), null);
  const jobs = failedLeafJobs([
    { id: 1, name: 'suite (worker-2-of-6)', conclusion: 'failure', steps: [{ name: 'Set up job', conclusion: 'success' }, { name: 'Run node scripts/test-drift-parts.mjs worker-2-of-6 --plan-file suite-plan.json', conclusion: 'failure' }] },
    { id: 2, name: 'test:drift (full suite)', conclusion: 'failure' },
    { id: 3, name: 'landing gate', conclusion: 'failure' },
    { id: 4, name: 'ci / fast', conclusion: 'success' },
    { id: 5, name: 'frontend (build)', conclusion: 'timed_out', steps: [] },
  ]);
  assert.deepEqual(jobs.map((j) => j.id), [1, 5]);
  assert.match(jobs[0].step, /worker-2-of-6/);
  assert.equal(suitePart('suite (worker-2-of-6)'), 'worker-2-of-6');
  assert.equal(suitePart('ci / fast'), null);
});

test('cleanLine and repoPath strip the runner noise', () => {
  assert.equal(cleanLine(`${T}\u001b[36;1mnode x\u001b[0m\r`), 'node x');
  assert.equal(repoPath('/home/runner/work/StudioOS/StudioOS/frontend/test/a.test.mjs'), 'frontend/test/a.test.mjs');
  assert.equal(repoPath('file:///home/runner/work/StudioOS/StudioOS/cloudflare-worker/test/b.test.ts'), 'cloudflare-worker/test/b.test.ts');
});

const TAP = [
  '# Subtest: H2 is live',
  'ok 3123 - H2 is live',
  '  ---',
  '  duration_ms: 1.5',
  '  ...',
  '# Subtest: every refusal code the Worker sends has its own sentence, and none shows the error text',
  'not ok 3124 - every refusal code the Worker sends has its own sentence, and none shows the error text',
  '  ---',
  '  duration_ms: 1.419968',
  "  location: '/home/runner/work/StudioOS/StudioOS/frontend/test/hq_ai_agents_4739.test.mjs:60:1'",
  "  failureType: 'testCodeFailure'",
  "  error: 'skill refusal code source_missing has no sentence'",
  "  code: 'ERR_ASSERTION'",
  '  ...',
  '# Subtest: the view: no number while the read is not ok',
  'ok 6408 - the view: no number while the read is not ok',
  '    not ok 1 - inner fails',
  '      ---',
  "      location: '/home/runner/work/StudioOS/StudioOS/cloudflare-worker/test/expiry_gate_datetime_d124.test.ts:243:10'",
  "      failureType: 'testCodeFailure'",
  '      error: |-',
  '        expected 19 normalised comparisons across the gated files, found 24',
  '        ',
  '        24 !== 19',
  "      code: 'ERR_ASSERTION'",
  '      ...',
  'not ok 6409 - outer',
  '  ---',
  "  location: '/home/runner/work/StudioOS/StudioOS/cloudflare-worker/test/expiry_gate_datetime_d124.test.ts:216:1'",
  "  failureType: 'subtestsFailed'",
  "  error: '1 subtest failed'",
  '  ...',
  'not ok 6410 - /home/runner/work/StudioOS/StudioOS/frontend/test/broken_import.test.mjs',
  '  ---',
  "  failureType: 'testCodeFailure'",
  "  error: 'test failed'",
  '  ...',
  '# tests 7824',
  '# pass 7823',
  '# fail 1',
  'test-drift-parts: "node --import ./frontend/test/_deck-loader.mjs --test \'frontend/test/a.test.mjs\'" exited 1',
  '##[error]Process completed with exit code 1.',
].map((l) => T + l).join('\n');

test('parseLog finds the failing tests by file and name, and skips a parent that failed only through its subtests', () => {
  const p = parseLog(TAP);
  assert.deepEqual(p.tests.map((t) => [t.file, t.line, t.name]), [
    ['frontend/test/hq_ai_agents_4739.test.mjs', 60, 'every refusal code the Worker sends has its own sentence, and none shows the error text'],
    ['cloudflare-worker/test/expiry_gate_datetime_d124.test.ts', 243, 'inner fails'],
    ['frontend/test/broken_import.test.mjs', null, '/home/runner/work/StudioOS/StudioOS/frontend/test/broken_import.test.mjs'],
  ]);
  assert.equal(p.tests[0].error, 'skill refusal code source_missing has no sentence');
  assert.equal(p.tests[1].error, 'expected 19 normalised comparisons across the gated files, found 24 24 !== 19');
  assert.deepEqual(p.counts, { tests: 7824, pass: 7823, fail: 1 });
  assert.match(p.failedCommand, /frontend\/test\/a\.test\.mjs/);
  assert.deepEqual(p.errors, []);
});

test('parseLog reads guard, tsc, eslint and crashed-step failures', () => {
  const log = [
    '✓ check-inline-project-pickers: no in-body startup picker anywhere',
    '✖ check-folder-docs:',
    '  - frontend/src/lib/api/researchProjectBriefs.js has no header comment (#4104)',
    'test-drift-parts: "npm run test:guards" exited 1',
    '✖ test-clock: frontend/test/pitch_overview_reads_4599.test.mjs:59 [sleep] new real-clock dependency',
    "src/routes/deals.ts(41,7): error TS2322: Type 'string' is not assignable to type 'number'.",
    '',
    '/home/runner/work/StudioOS/StudioOS/frontend/src/pages/Deals.jsx',
    "  12:5  error  'useMemo' is not defined  no-undef",
    '',
    '##[group]Run node "$RUNNER_TEMP/fast-guards/scripts/check-api-drift.mjs"',
    "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/x/generatedOutput.mjs'",
    '##[error]The merge queue ref no longer exists.',
  ].map((l) => T + l).join('\n');
  const p = parseLog(log);
  assert.deepEqual(p.guards.map((g) => [g.name, g.details.length]), [['check-folder-docs', 1], ['test-clock', 0]]);
  assert.deepEqual(p.types, [{ file: 'src/routes/deals.ts', line: 41, code: 'TS2322', message: "Type 'string' is not assignable to type 'number'." }]);
  assert.deepEqual(p.lint, [{ file: 'frontend/src/pages/Deals.jsx', line: 12, message: "'useMemo' is not defined", rule: 'no-undef' }]);
  assert.equal(p.failedCommand, 'npm run test:guards');
  assert.equal(p.failedStep, 'node "$RUNNER_TEMP/fast-guards/scripts/check-api-drift.mjs"');
  assert.deepEqual(p.errors, ['The merge queue ref no longer exists.']);
  assert.match(p.thrown, /ERR_MODULE_NOT_FOUND/);
});

test('reproduce commands come from package.json: the suite loader, the type project, the guard step', () => {
  assert.equal(testRunners(SCRIPTS).length, 4);
  assert.equal(reproduceTest('frontend/test/hq_ai_agents_4739.test.mjs', SCRIPTS), 'node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_ai_agents_4739.test.mjs');
  assert.equal(reproduceTest('cloudflare-worker/test/expiry_gate_datetime_d124.test.ts', SCRIPTS),
    'node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/expiry_gate_datetime_d124.test.ts');
  assert.equal(reproduceTest('meeting-bot/test/a.test.ts', SCRIPTS), 'node --experimental-strip-types --no-warnings --test meeting-bot/test/a.test.ts');
  assert.equal(reproduceTest('scripts/lib/claims.test.mjs', SCRIPTS), 'node --test scripts/lib/claims.test.mjs');
  assert.equal(reproduceTest('frontend/test/nested/a.test.mjs', SCRIPTS), null, 'a single * never crosses a folder');
  assert.equal(reproduceTest(null, SCRIPTS), null);
  assert.equal(reproduceTypes('frontend/src/a.jsx'), 'npm run test:types:frontend');
  assert.equal(reproduceTypes('cloudflare-worker/src/a.ts'), 'npm run test:types');
  assert.equal(guardCommand('check-folder-docs', SCRIPTS), 'node scripts/check-folder-docs.mjs');
  assert.equal(guardCommand('test-clock', SCRIPTS), 'node --no-warnings scripts/check-test-clock.mjs');
  assert.equal(guardCommand('route-map', SCRIPTS), 'node scripts/build-route-map.mjs --check');
  assert.equal(guardCommand('nothing-here', SCRIPTS), null);
  assert.equal(resolveTypePath('src/routes/deals.ts', (p) => p === 'cloudflare-worker/src/routes/deals.ts'), 'cloudflare-worker/src/routes/deals.ts');
  assert.equal(resolveTypePath('frontend/src/a.jsx', (p) => p === 'frontend/src/a.jsx'), 'frontend/src/a.jsx');
});

test('findings gives one row per failure, and a step row with the local command when nothing is recognised', () => {
  const job = { name: 'ci / fast', step: 'Run drift checker' };
  const rows = findings(job, parseLog(`${T}##[group]Run node "$RUNNER_TEMP/fast-guards/scripts/check-api-drift.mjs"\n${T}##[error]Process completed with exit code 1.`), SCRIPTS);
  assert.deepEqual(rows.map((r) => [r.kind, r.what, r.reproduce]), [['step', 'Run drift checker', 'node scripts/check-api-drift.mjs']]);
  const suite = findings({ name: 'suite (frontend-2-of-2)' }, parseLog(TAP), SCRIPTS);
  assert.deepEqual(suite.map((r) => r.kind), ['test', 'test', 'test']);
  assert.match(suite[0].reproduce, /_deck-loader\.mjs --test frontend\/test\/hq_ai_agents_4739\.test\.mjs$/);
});

test('markShared matches a test against every failed main log, since parts are packed per run', () => {
  const rows = [
    { kind: 'test', job: 'suite (worker-2-of-6)', file: 'a.test.ts', what: 'x' },
    { kind: 'test', job: 'suite (worker-2-of-6)', file: 'b.test.ts', what: 'y' },
    { kind: 'guard', job: 'suite (rest)', file: null, what: 'test-clock' },
    { kind: 'type', job: 'worker (typecheck)', file: 'c.ts', what: 'TS2322' },
  ];
  // On main the same test failed in worker-3, and worker-2 passed there.
  const main = { failedJobs: ['suite (worker-3-of-6)', 'suite (rest)'], rows: { 'suite (worker-3-of-6)': [{ kind: 'test', file: 'a.test.ts', what: 'x' }], 'suite (rest)': [{ kind: 'guard', file: null, what: 'test-clock' }] }, unread: [] };
  assert.deepEqual(markShared(rows, main).map((r) => r.onMain), [true, false, true, false]);
  // A failed main log that could not be read leaves an unmatched test unknown, never "not on main".
  assert.deepEqual(markShared(rows, { ...main, unread: ['suite (worker-5-of-6)'] }).map((r) => r.onMain), [true, null, true, false]);
  assert.deepEqual(markShared(rows, { failedJobs: ['suite (rest)'], rows: {}, unread: ['suite (rest)'] }).map((r) => r.onMain), [null, null, null, false]);
  assert.deepEqual(markShared(rows, null).map((r) => r.onMain), [null, null, null, null]);
});

test('mainRunBefore picks main as the PR run saw it, not main now', () => {
  const runs = [
    { id: 3, status: 'completed', conclusion: 'success', created_at: '2026-11-14T12:00:00Z' },
    { id: 2, status: 'completed', conclusion: 'failure', created_at: '2026-11-14T09:00:00Z' },
    { id: 1, status: 'completed', conclusion: 'success', created_at: '2026-11-14T08:00:00Z' },
    { id: 4, status: 'in_progress', created_at: '2026-11-14T09:30:00Z' },
  ];
  assert.equal(mainRunBefore(runs, { run_started_at: '2026-11-14T10:00:00Z', created_at: '2026-11-14T09:59:00Z' }).id, 2);
  assert.equal(mainRunBefore(runs, { created_at: '2026-11-14T08:30:00Z' }).id, 1);
  assert.equal(mainRunBefore(runs, { run_started_at: '2026-11-14T07:00:00Z' }), null);
  assert.equal(mainRunBefore(runs, {}), null);
});

test('leafJobs drops both summary gates before classify and infraFingerprint', () => {
  assert.deepEqual(leafJobs([{ name: 'landing gate' }, { name: 'test:drift (full suite)' }, { name: 'suite (rest)' }, null]).map((j) => j.name), ['suite (rest)']);
});

test('ruling: a current digest governs, and a disagreement is shown', () => {
  const head = 'abc';
  const run = { head_sha: 'abc' };
  assert.deepEqual(ruling({ digest: { headSha: 'abc', verdict: 'inherited_main_failure' }, head, run, live: 'pr_failure' }), { verdict: 'inherited_main_failure', source: 'digest', disagree: true });
  assert.deepEqual(ruling({ digest: { headSha: 'old', verdict: 'inherited_main_failure' }, head, run, live: 'pr_failure' }), { verdict: 'pr_failure', source: 'script', disagree: false });
  assert.deepEqual(ruling({ digest: { headSha: 'abc', verdict: 'made_up' }, head, run, live: 'pr_failure' }).source, 'script');
  assert.deepEqual(ruling({ digest: { headSha: 'abc', verdict: 'pr_failure' }, head, run: { head_sha: 'other' }, live: 'inherited_main_failure' }).source, 'script');
  assert.deepEqual(ruling({ digest: null, head, run, live: 'pr_failure' }).source, 'script');
});

test('nextStep: an inherited failure never sends the slot to fix or port, even with a PR-only test inside', () => {
  const marked = [{ kind: 'test', onMain: true }, { kind: 'test', onMain: false }];
  const alerts = [{ number: 5721, title: '[alert] main is red' }];
  const inherited = nextStep({ verdict: 'inherited_main_failure', rows: marked, alerts });
  assert.match(inherited, /^Do nothing to the PR\. STATUS: blockers: inherited main failure, #5721/);
  assert.match(inherited, /1 failure\(s\) not in main's log, to fix once main is green/);
  assert.doesNotMatch(inherited, /fix it on this branch|push/i);
  const green = nextStep({ verdict: 'inherited_main_failure', rows: marked, alerts, mainNow: 'success' });
  assert.match(green, /main is green now\. Do not port the repair/);
  assert.doesNotMatch(nextStep({ verdict: 'inherited_main_failure', rows: [marked[0]], alerts }), /not in main's log/);
  assert.match(nextStep({ verdict: 'main_health_unknown', rows: marked }), /treat every failure as this PR's own/);
  assert.match(nextStep({ verdict: 'pr_failure', rows: marked }), /fix it on this branch, push once/);
  assert.match(nextStep({ verdict: 'pr_failure', rows: [marked[0]] }), /needs its log read/);
  assert.doesNotMatch(nextStep({ verdict: 'infra_failure' }), /D5619|re-run/);
  assert.match(nextStep({ verdict: 'infra_failure', alerts: [{ number: 5719, title: '[alert] the Actions queue is backed up' }] }), /#5719 is open: at most one failed-job re-run/);
});

test('a run whose suite jobs were cancelled by a newer push is called cancelled, not "no failed job" (#6420)', () => {
  const jobs = [
    { id: 1, name: 'suite (worker-1-of-6)', conclusion: 'cancelled' },
    { id: 2, name: 'suite (frontend-1-of-2)', conclusion: 'cancelled' },
    { id: 3, name: 'ci / fast', conclusion: 'success' },
    { id: 4, name: 'test:drift (full suite)', conclusion: 'failure' },
    { id: 5, name: 'landing gate', conclusion: 'failure' },
  ];
  const run = { status: 'completed', conclusion: 'failure', head_sha: 'a'.repeat(40) };
  assert.deepEqual(cancelledRun(run, jobs), { cancelled: ['suite (worker-1-of-6)', 'suite (frontend-1-of-2)'], gates: ['test:drift (full suite)', 'landing gate'] });

  const old = noFailureNote({ run, jobs, head: 'b'.repeat(40) });
  assert.equal(old.cancelled, true);
  assert.equal(old.line, 'this run was cancelled or superseded by a newer push: 2 job(s) were cancelled and none failed');
  assert.match(old.next, /cancelled or superseded by a newer push/);
  assert.match(old.next, /test:drift \(full suite\) and landing gate shows failure only because the jobs it waits on were cancelled/);
  assert.match(old.next, /Read the run on the current head bbbbbbbbbb\./);
  assert.doesNotMatch(old.next, /No failed job/);

  const same = noFailureNote({ run, jobs, head: 'a'.repeat(40) });
  assert.match(same.next, /Read the newest run on the current head; if this is still the newest, nothing has replaced it yet\./);

  // The run itself cancelled, with no job list to go on.
  assert.match(noFailureNote({ run: { status: 'completed', conclusion: 'cancelled' }, jobs: [], head: 'b' }).line, /the run was cancelled and no job failed/);
});

test('cancelledRun stays out of the way when a job really failed or nothing was cancelled (#6420)', () => {
  const run = { status: 'completed', conclusion: 'failure', head_sha: 'a' };
  // A real failure beside cancelled jobs is a failure: the failed job's log is what to read.
  assert.equal(cancelledRun(run, [{ id: 1, name: 'suite (rest)', conclusion: 'failure' }, { id: 2, name: 'suite (worker-1-of-6)', conclusion: 'cancelled' }]), null);
  // A cancelled summary gate alone does not make the run a cancelled one.
  assert.equal(cancelledRun({ status: 'completed', conclusion: 'success' }, [{ id: 1, name: 'landing gate', conclusion: 'cancelled' }, { id: 2, name: 'ci / fast', conclusion: 'success' }]), null);
  assert.deepEqual(noFailureNote({ run: { status: 'completed', conclusion: 'success' }, jobs: [{ id: 1, name: 'ci / fast', conclusion: 'success' }], head: 'a' }),
    { cancelled: false, line: 'no failed job on this run', next: 'No failed job on this run (success).' });
  assert.equal(noFailureNote({ run: { status: 'in_progress', conclusion: null }, jobs: [], head: 'a' }).next, 'No job has failed yet; the run is still going.');
});
