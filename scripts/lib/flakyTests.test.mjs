// D6464: classification, expiry, the one-retry rule and the runner's reporter
// wiring.
//
// D6464 (#6464): the flaky list, its classification and expiry, and the suite
// runner's one retry under merge_group.
//   node --test scripts/lib/flakyTests.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classify, issueTitle, stillDefined, mergeList, parseFailures, queuePr, repoFile, retryDecision, wouldTurnGreen } from './flakyTests.mjs';
import { isNodeTest, queueChangedFiles, readFailures, readFlakyList, retryFailed, withFailureReporter } from '../test-drift-parts.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const A = { file: 'frontend/test/a.test.mjs', test: '11. for a founder the bare address is the module page' };
const B = { file: 'cloudflare-worker/test/b.test.ts', test: '7b. the push is durable' };
const LIST = [{ ...A, firstSeen: '2026-11-08', lastSeen: '2026-11-14', count: 10 }];
const CMD = "node --import ./frontend/test/_deck-loader.mjs --test 'frontend/test/a.test.mjs' 'frontend/test/z.test.mjs'";

test('D6464: a job log yields each failed test with its file, once', () => {
  const log = [
    "2026-11-14T18:06:39.3568991Z not ok 4644 - every flagged file is listed",
    '2026-11-14T18:06:39.3568991Z   ---',
    "2026-11-14T18:06:39.3568991Z   location: '/home/runner/work/StudioOS/StudioOS/frontend/test/money_5373.test.mjs:249:1'",
    'not ok 12 - frontend/test/money_5373.test.mjs',
    "  location: '/home/runner/work/StudioOS/StudioOS/frontend/test/money_5373.test.mjs:1:1'",
    'not ok 3 - cloudflare-worker/test/crash.test.ts',
    "  location: '/home/runner/work/StudioOS/StudioOS/cloudflare-worker/test/crash.test.ts:1:1'",
    'ok 4 - passes',
    'not ok 5 - every flagged file is listed',
    "  location: '/home/runner/work/StudioOS/StudioOS/frontend/test/money_5373.test.mjs:249:1'",
    'not ok 6 - no location here',
  ].join('\n');
  assert.deepEqual(parseFailures(log), [
    { file: 'frontend/test/money_5373.test.mjs', test: 'every flagged file is listed' },
    { file: 'cloudflare-worker/test/crash.test.ts', test: 'cloudflare-worker/test/crash.test.ts' },
  ]);
  assert.equal(repoFile('/x/y/scripts/lib/flakyTests.test.mjs:3:1'), 'scripts/lib/flakyTests.test.mjs');
  // TAP escapes `#` and `\\` in a name; the list holds the name as the test wrote it, as the reporter sees it.
  const escaped = ["not ok 7 - \\#4570 slice 8: a\\\\b # TODO later", "  location: '/r/StudioOS/cloudflare-worker/test/x.test.ts:3:1'"].join('\n');
  assert.deepEqual(parseFailures(escaped), [{ file: 'cloudflare-worker/test/x.test.ts', test: '#4570 slice 8: a\\b' }]);
  assert.equal(repoFile('/x/not-a-test.mjs:1:1'), null);
  assert.deepEqual([queuePr('gh-readonly-queue/main/pr-6412-abc'), queuePr('main'), queuePr(null)], [6412, null, null]);
});

test('D6464: a test failing on its own PR\'s changed file is never classed flaky', () => {
  const greens = [{ sha: 'g1', at: '2026-11-13T20:00:00Z', event: 'push' }, { sha: 'm1', at: '2026-11-14T11:00:00Z', event: 'push' }];
  const runs = [
    { id: 1, sha: 's1', at: '2026-11-13T10:00:00Z', failures: [A, B], changedFiles: [B.file] },
    { id: 2, sha: 's2', at: '2026-11-14T10:30:00Z', failures: [A], changedFiles: [] },
  ];
  assert.deepEqual(classify(runs, greens).map((r) => [r.file, r.test, r.runs]), [[A.file, A.test, [1, 2]]]);
});

test('D6464: flaky means intermittent: the same commit passed it later, or a run passed between its failures', () => {
  const run = (id, sha, at) => ({ id, sha, at, failures: [A], changedFiles: [] });
  const main = (at) => ({ sha: `m-${at}`, at, event: 'push' });
  // The same commit failed, then passed on a later attempt.
  assert.equal(classify([run(1, 's1', '2026-11-14T10:00:00Z')], [{ sha: 's1', at: '2026-11-14T10:20:00Z', event: 'merge_group' }]).length, 1);
  // Failures on two days with a green run between them, and main green after.
  assert.equal(classify([run(1, 's1', '2026-11-13T10:00:00Z'), run(2, 's2', '2026-11-14T12:00:00Z')],
    [main('2026-11-13T20:00:00Z'), main('2026-11-14T13:00:00Z')]).length, 1);
  // The same green between two failures on ONE day is a queue episode: an entry ahead broke it for those behind.
  assert.equal(classify([run(1, 's1', '2026-11-14T10:00:00Z'), run(2, 's2', '2026-11-14T12:00:00Z')],
    [{ sha: 'g', at: '2026-11-14T11:00:00Z', event: 'merge_group' }, main('2026-11-14T13:00:00Z')]).length, 0);
  // A red main (D5398): every entry fails until the repair, then main passes. Nothing passed between the failures.
  const red = [1, 2, 3, 4, 5].map((i) => run(i, `s${i}`, `2026-11-14T1${i}:00:00Z`));
  assert.equal(classify(red, [main('2026-11-14T16:30:00Z'), { sha: 'g', at: '2026-11-14T16:40:00Z', event: 'merge_group' }]).length, 0);
  // No later pass of any kind, or only a main pass too late or before: nothing counts.
  assert.equal(classify([run(1, 's1', '2026-11-14T10:00:00Z'), run(2, 's2', '2026-11-14T12:00:00Z')], [main('2026-11-14T09:00:00Z')]).length, 0);
  assert.equal(classify([run(1, 's1', '2026-11-14T10:00:00Z')], [{ sha: 'other', at: '2026-11-14T10:20:00Z', event: 'merge_group' }]).length, 0, 'another queue entry is not the same code');
});

test('D6464: the list adds a test seen in two runs, updates known ones, and expiry removes a clean entry', () => {
  const found = [{ ...A, runs: [1, 2, 3], firstSeen: '2026-11-13T01:00:00Z', lastSeen: '2026-11-14T02:00:00Z' },
    { ...B, runs: [4], firstSeen: '2026-11-14T03:00:00Z', lastSeen: '2026-11-14T03:00:00Z' }];
  const old = { file: 'frontend/test/old.test.mjs', test: 'old', firstSeen: '2026-10-01', lastSeen: '2026-10-31', count: 4 };
  const fresh = { file: 'frontend/test/kept.test.mjs', test: 'kept', firstSeen: '2026-11-01', lastSeen: '2026-11-02', count: 2 };
  const next = mergeList([old, fresh], found, '2026-11-15T00:00:00Z', { expiryDays: 14 });
  assert.deepEqual(next, [
    { file: A.file, test: A.test, firstSeen: '2026-11-13', lastSeen: '2026-11-14', count: 3 },
    fresh,
  ]);
  assert.deepEqual(mergeList([fresh], [], '2026-11-17T00:00:00Z', { expiryDays: 14 }), [], 'fifteen clean days: gone');
  assert.deepEqual(mergeList([{ ...B, firstSeen: '2026-11-01', lastSeen: '2026-11-02', count: 2 }], [found[1]], '2026-11-15T00:00:00Z')[0].lastSeen, '2026-11-14', 'a known test needs only one more run to stay');
});

test('D6464: only merge_group retries, only listed failures, and never in a file the entry changed', () => {
  const ok = { event: 'merge_group', failures: [A], list: LIST, changedFiles: [] };
  assert.deepEqual(retryDecision(ok), { retry: true, files: [A.file], reason: 'every failure is on the flaky list' });
  for (const event of ['pull_request', 'push', undefined]) assert.equal(retryDecision({ ...ok, event }).retry, false, String(event));
  assert.match(retryDecision({ ...ok, failures: [A, B] }).reason, /not on the flaky list: cloudflare-worker\/test\/b\.test\.ts/);
  assert.equal(retryDecision({ ...ok, failures: [{ file: A.file, test: 'another test in a listed file' }] }).retry, false, 'the list names tests, not whole files');
  assert.match(retryDecision({ ...ok, changedFiles: [A.file] }).reason, /this entry changed frontend\/test\/a\.test\.mjs/);
  assert.match(retryDecision({ ...ok, changedFiles: null }).reason, /could not be read/);
  assert.match(retryDecision({ ...ok, failures: [] }).reason, /no failed test was recorded/);
});

test('D6464: a listed file is re-run once and only once; its result is the part\'s result', () => {
  const calls = [];
  const exec = (code) => (cmd) => { calls.push(cmd); return code; };
  const passed = retryFailed({ cmd: CMD, failures: [A], list: LIST, changedFiles: [], event: 'merge_group', exec: exec(0) });
  assert.equal(passed.status, 0);
  assert.deepEqual(calls, ["node --import ./frontend/test/_deck-loader.mjs --test 'frontend/test/a.test.mjs'"]);
  assert.equal(passed.lines[0], '### Flaky, retried');
  assert.ok(passed.lines.includes(`- \`${A.file}\` › ${A.test}`));
  calls.length = 0;
  const failed = retryFailed({ cmd: CMD, failures: [A], list: LIST, changedFiles: [], event: 'merge_group', exec: exec(1) });
  assert.deepEqual([failed.status, calls.length, failed.lines[0]], [1, 1, '### Flaky retry failed']);
  calls.length = 0;
  for (const args of [{ failures: [B] }, { event: 'pull_request' }, { event: 'push' }]) {
    const r = retryFailed({ cmd: CMD, failures: [A], list: LIST, changedFiles: [], event: 'merge_group', exec: exec(0), ...args });
    assert.equal(r.status, 1);
    assert.match(r.lines[0], /^No retry: /);
  }
  assert.equal(calls.length, 0, 'an unlisted failure, a PR and a push never re-run anything');
});

test('D6464: the runner adds the failure reporter beside TAP, and only to node:test commands', () => {
  assert.equal(withFailureReporter(CMD, '/tmp/out.jsonl', '/r/rep.mjs'),
    "node --import ./frontend/test/_deck-loader.mjs --test-reporter=tap --test-reporter-destination=stdout --test-reporter='/r/rep.mjs' --test-reporter-destination='/tmp/out.jsonl' --test 'frontend/test/a.test.mjs' 'frontend/test/z.test.mjs'");
  assert.equal(isNodeTest(CMD), true);
  assert.equal(isNodeTest('npm run test:guards'), false);
  assert.equal(isNodeTest('node a.mjs && node --test x'), false);
});

test('D6464: the reporter writes each failed test; the runner reads it back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flaky-6464-'));
  mkdirSync(join(dir, 'frontend/test'), { recursive: true });
  writeFileSync(join(dir, 'frontend/test/a.test.mjs'), "import test from 'node:test';\ntest('passes', () => {});\ntest('fails here', () => { throw new Error('x'); });\ntest.describe('group', () => { test('inner fails', () => { throw new Error('y'); }); });\n");
  writeFileSync(join(dir, 'frontend/test/b.test.mjs'), "throw new Error('the file crashes');\n");
  const out = join(dir, 'failed.jsonl');
  const cmd = withFailureReporter("node --test 'frontend/test/a.test.mjs' 'frontend/test/b.test.mjs'", out, resolve(ROOT, 'scripts/lib/failedTestsReporter.mjs'));
  const { NODE_TEST_CONTEXT, ...env } = process.env; // a nested node --test would otherwise report to this run
  const r = spawnSync('sh', ['-c', cmd], { cwd: dir, encoding: 'utf8', env });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^TAP version 13/m, 'the log stays TAP');
  assert.deepEqual(readFailures(out), [
    { file: 'frontend/test/a.test.mjs', test: 'fails here' },
    { file: 'frontend/test/a.test.mjs', test: 'inner fails' },
    { file: 'frontend/test/b.test.mjs', test: 'frontend/test/b.test.mjs' },
  ]);
  assert.deepEqual(readFailures(join(dir, 'missing.jsonl')), []);
  assert.deepEqual(parseFailures(r.stdout).map((f) => f.test).sort(), ['fails here', 'frontend/test/b.test.mjs', 'inner fails'], 'the collector reads the same failures from the log');
});

test('D6464: the entry\'s changed files come from its merge_group base; unreadable means unknown', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flaky-event-'));
  const base = 'a'.repeat(40); const head = 'b'.repeat(40);
  const event = join(dir, 'event.json');
  writeFileSync(event, JSON.stringify({ merge_group: { base_sha: base, head_sha: head } }));
  const calls = [];
  const git = (status, stdout = '') => (cmd, args) => { calls.push(args.join(' ')); return { status, stdout }; };
  assert.deepEqual(queueChangedFiles(dir, { GITHUB_EVENT_PATH: event }, git(0, 'frontend/test/a.test.mjs\nREADME.md\n')), ['frontend/test/a.test.mjs', 'README.md']);
  assert.deepEqual(calls, [`diff --name-only ${base} ${head}`]);
  calls.length = 0;
  assert.equal(queueChangedFiles(dir, { GITHUB_EVENT_PATH: event }, git(1)), null);
  assert.deepEqual(calls, [`diff --name-only ${base} ${head}`, `fetch --no-tags --depth=1 origin ${base}`, `diff --name-only ${base} ${head}`]);
  writeFileSync(event, JSON.stringify({ merge_group: { base_sha: 'not-a-sha; rm -rf /', head_sha: head } }));
  assert.equal(queueChangedFiles(dir, { GITHUB_EVENT_PATH: event }, git(0, 'x')), null);
  assert.equal(queueChangedFiles(dir, {}, git(0, 'x')), null);
});

test('D6464: the tracked list is well formed, sorted, and is read by the runner as is', () => {
  const data = JSON.parse(readFileSync(resolve(ROOT, 'scripts/flaky-tests.json'), 'utf8'));
  assert.equal(data.expiryDays, 14);
  assert.ok(Array.isArray(data.tests));
  for (const e of data.tests) {
    assert.deepEqual(Object.keys(e), ['file', 'test', 'firstSeen', 'lastSeen', 'count']);
    assert.match(e.file, /^[\w./-]+\.test\.(?:mjs|ts)$/);
    assert.match(e.firstSeen, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(e.count >= 2 && e.firstSeen <= e.lastSeen);
  }
  const sorted = [...data.tests].sort((a, b) => a.file.localeCompare(b.file) || a.test.localeCompare(b.test));
  assert.deepEqual(data.tests, sorted);
  assert.deepEqual(readFlakyList(ROOT), data.tests);
  assert.deepEqual(readFlakyList(join(tmpdir(), 'no-such-root')), [], 'a missing list retries nothing');
});

test('D6464: a failed queue run would pass with the retry only when every failure is listed and nothing else failed', () => {
  assert.equal(wouldTurnGreen({ failures: [A], changedFiles: [] }, LIST), true);
  assert.equal(wouldTurnGreen({ failures: [A, B], changedFiles: [] }, LIST), false);
  assert.equal(wouldTurnGreen({ failures: [A], changedFiles: [], otherJobsFailed: true }, LIST), false);
  assert.equal(wouldTurnGreen({ failures: [A], changedFiles: [A.file] }, LIST), false);
  assert.equal(wouldTurnGreen({ failures: [], changedFiles: [] }, LIST), false);
  assert.equal(issueTitle(A), `Flaky test: ${A.file} › ${A.test}`);
});

test('D6464: the runner watches only node:test commands under merge_group, and only a retry reaches the job summary', () => {
  const src = readFileSync(resolve(ROOT, 'scripts/test-drift-parts.mjs'), 'utf8');
  assert.match(src, /const watch = event === 'merge_group' && isNodeTest\(cmd\);/);
  // D7125: both exits first print the failure's ci-failure-id annotation (frontend/test/queue_stall_chains_7125.test.mjs).
  assert.match(src, /if \(!watch\) \{[\s\S]*?return r\.status \|\| 1;/);
  assert.match(src, /if \(retried\.status !== 0\) \{[\s\S]*?return r\.status \|\| 1;/);
  assert.match(src, /if \(env\.GITHUB_STEP_SUMMARY && retried\.lines\[0\]\.startsWith\('###'\)\) appendFileSync/);
  assert.doesNotMatch(src, /writeFileSync\([^)]*flaky-tests\.json/, 'the runner never writes the list');
});

test('D6464: a test renamed or removed since it failed leaves the list', () => {
  const src = "test('each workflow has a distinct identity', () => {});\ntest('the founder\\'s Home links to Upload', () => {});\n";
  assert.equal(stillDefined(src, 'each workflow has a distinct identity'), true);
  assert.equal(stillDefined(src, "the founder's Home links to Upload"), true, 'an escaped quote in the source');
  assert.equal(stillDefined(src, '11. for a founder the bare address is the module page'), false);
  assert.equal(stillDefined(null, 'x'), false, 'a deleted file');
  assert.equal(stillDefined(src, ''), false);
});
