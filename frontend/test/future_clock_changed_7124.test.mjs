/**
 * D7124 (#7124): a pull request's changed test files run with the clock moved
 * ahead (scripts/future-clock-changed.mjs, one step in ci.yml), and the
 * nightly future-clock alert names its failures where D5663 allows: the
 * reporter's job log and step summary, never the issue or Slack.
 *
 * On 2026-11-17 promo_issued_report_5949 (merged 15 Nov) pushed a report
 * stamped with a fixed NOW while the HQ read used the real clock against a
 * 48-hour threshold; nothing merged for 6 h 25 min (#7108). The nightly had
 * counted it two days earlier, in an alert with no names and no date.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  BUDGET_MS, FIX, LIBFAKETIME, MAX_FILES, OFFSETS, clockEnv, dateBound, failureKeys, groupBySuite, main, parseOffset, suiteCommands,
} from '../../scripts/future-clock-changed.mjs';
import {
  breakDate, futureClockLogLines, futureClockSummary, repoTestPath, safeTestName, tapFailures, withFutureClockRunLine,
} from '../../scripts/lib/futureClockNames.mjs';
import { verifiedFailures } from '../../scripts/future-clock-report.mjs';
import { assessFutureClock } from '../../scripts/lib/futureClockEvidence.mjs';
import { message } from '../../scripts/lib/githubAlerts.mjs';
import { safeHealthFacts } from '../../scripts/health-alert-episodes.mjs';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const HOUR = 3_600_000;

/** A temporary repository with one suite (`test:retention`) and the given test files. */
function fixtureRoot(files) {
  const dir = mkdtempSync(join(tmpdir(), 'fc-changed-7124-'));
  mkdirSync(join(dir, 'scripts/lib'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { 'test:retention': "node --test 'scripts/lib/*.test.mjs'" } }));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

/** The kernel's clock, which libfaketime does not move (a new file's mtime), so this also holds under the nightly. */
function kernelNow() {
  const dir = mkdtempSync(join(tmpdir(), 'fc-now-'));
  try { writeFileSync(join(dir, 'x'), ''); return Math.round(statSync(join(dir, 'x')).mtimeMs); } finally { rmSync(dir, { recursive: true }); }
}

/** A fake `sh` for `main`: writes the failed tests the script's reporter would, from `fail(offsetLabel|null, file)`. */
function fakeShell(fail) {
  const calls = [];
  const sh = (command, env) => {
    const file = [...command.matchAll(/--test-reporter-destination='([^']+)'/g)].map((m) => m[1]).find((d) => d.endsWith('failed.jsonl'));
    const ran = [...command.matchAll(/'([\w./-]+\.test\.(?:mjs|ts))'/g)].map((m) => m[1]);
    const label = env.FAKETIME ? OFFSETS.find((o) => o.faketime === env.FAKETIME).label : null;
    calls.push({ label, ran });
    const failed = ran.flatMap((f) => (fail(label, f) || []).map((t) => ({ file: f, test: t })));
    writeFileSync(file, failed.map((x) => JSON.stringify(x)).join('\n'));
    return { status: failed.length ? 1 : 0 };
  };
  return { sh, calls };
}

const quiet = () => {};

test('offsets: +7d keeps the weekday, the second one moves weekday and time of day; libfaketime gets hours', () => {
  assert.deepEqual(OFFSETS.map((o) => o.label), ['+7d', '+9d 11h']);
  assert.equal(OFFSETS[1].faketime, '+227h', 'libfaketime reads "+9d 11h" as nine hours');
  assert.equal(OFFSETS[1].days * 24, 227);
  assert.notEqual(Math.floor(OFFSETS[1].days) % 7, 0, 'a different weekday');
  assert.notEqual(Math.round(OFFSETS[1].days * 24) % 24, 0, 'a different time of day');
  assert.equal(parseOffset('+9d 11h'), OFFSETS[1]);
  assert.deepEqual(parseOffset('+3d'), { label: '+3d', faketime: '+3d', days: 3 });
  assert.deepEqual(parseOffset('+12h'), { label: '+12h', faketime: '+12h', days: 0.5 });
  for (const bad of ['7d', '+0d', '-1d', '+1w', '', undefined]) assert.equal(parseOffset(bad), null, String(bad));
});

test('clockEnv: libfaketime and the loader ahead; every libfaketime variable emptied on the real clock', () => {
  const loader = `--import=${resolve(root, 'scripts/future-clock.mjs')}`;
  const base = { PATH: '/bin', NODE_OPTIONS: '--max-old-space-size=4096', NODE_TEST_CONTEXT: 'child', LD_PRELOAD: '/x/other.so' };
  const ahead = clockEnv(base, OFFSETS[1], '/lib/libfaketime.so.1');
  assert.equal(ahead.FAKETIME, '+227h');
  assert.equal(ahead.FAKETIME_DONT_FAKE_MONOTONIC, '1');
  assert.equal(ahead.FAKETIME_DONT_RESET, '1');
  assert.equal(ahead.LD_PRELOAD, '/lib/libfaketime.so.1 /x/other.so');
  assert.equal(ahead.FUTURE_CLOCK_DAYS, String(227 / 24));
  assert.equal(ahead.NODE_OPTIONS, `--max-old-space-size=4096 ${loader}`);
  assert.equal('NODE_TEST_CONTEXT' in ahead, false, 'a nested node --test runs as its own runner');
  // Under the nightly the parent already runs ahead; the real-clock run must not inherit it.
  const real = clockEnv({ ...ahead, FAKETIME_NO_CACHE: '1' }, null);
  assert.equal(real.LD_PRELOAD, '/x/other.so');
  for (const k of ['FAKETIME', 'FAKETIME_DONT_FAKE_MONOTONIC', 'FAKETIME_DONT_RESET', 'FAKETIME_NO_CACHE', 'FUTURE_CLOCK_DAYS']) assert.equal(real[k], '', k);
  assert.equal(real.NODE_OPTIONS, '--max-old-space-size=4096');
  // libfaketime's handle to its parent's shared memory passes through: emptied, a child under the nightly cannot start.
  assert.equal(clockEnv({ FAKETIME_SHARED: '/faketime_sem_1 /faketime_shm_1' }, OFFSETS[0]).FAKETIME_SHARED, '/faketime_sem_1 /faketime_shm_1');
});

test('only changed files a suite runs are tested, with that suite\'s own command; helpers and other files are not', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  const commands = suiteCommands(scripts);
  assert.deepEqual(commands.map((c) => c.key), ['test:frontend', 'test:worker', 'test:meeting-bot', 'test:retention']);
  assert.ok(!commands.find((c) => c.key === 'test:meeting-bot').cmd.includes('&&'), 'the tsc step after && is not a test command');
  const groups = groupBySuite([
    'frontend/test/github_alerts.test.mjs', 'frontend/test/_deck-loader.mjs', 'README.md',
    'cloudflare-worker/test/promo_issued_report_5949.test.ts', 'scripts/future-clock-changed.mjs',
  ], commands, root);
  assert.deepEqual(groups.map((g) => [g.key, g.files]), [
    ['test:frontend', ['frontend/test/github_alerts.test.mjs']],
    ['test:worker', ['cloudflare-worker/test/promo_issued_report_5949.test.ts']],
  ]);
  assert.match(groups[0].cmd, /^node --import \.\/frontend\/test\/_deck-loader\.mjs --test /);
});

test('dateBound: a failure ahead is the clock\'s unless the same test, or its whole file, fails now', () => {
  const k = (f, t) => `${f}\u0000${t}`;
  const ahead = new Set([k('a.test.mjs', 'x'), k('a.test.mjs', 'y'), k('b.test.mjs', 'z')]);
  assert.deepEqual(dateBound(ahead, new Set([k('a.test.mjs', 'y')])), [{ file: 'a.test.mjs', test: 'x' }, { file: 'b.test.mjs', test: 'z' }]);
  assert.deepEqual(dateBound(ahead, new Set([k('b.test.mjs', 'b.test.mjs')])), [{ file: 'a.test.mjs', test: 'x' }, { file: 'a.test.mjs', test: 'y' }]);
  // A run that failed with no test recorded counts each file it ran as failed whole; one that passed counts nothing.
  assert.deepEqual([...failureKeys({ status: 1, failures: [] }, ['a.test.mjs'])], [k('a.test.mjs', 'a.test.mjs')]);
  assert.deepEqual([...failureKeys({ status: 0, failures: [] }, ['a.test.mjs'])], []);
  assert.deepEqual([...failureKeys({ status: 1, failures: [{ file: 'other.test.mjs', test: 't' }] }, ['a.test.mjs'])], [k('a.test.mjs', 'a.test.mjs')]);
});

test('main: no changed test logs "no changed tests" and runs nothing; over the cap leaves it to the nightly', () => {
  const dir = fixtureRoot({ 'scripts/lib/a.test.mjs': '' });
  try {
    const logs = [];
    const { sh, calls } = fakeShell(() => []);
    let checked = 0;
    const check = () => { checked++; return { status: 0 }; };
    assert.equal(main([], { root: dir, env: { FUTURE_CLOCK_BASE: 'f'.repeat(40) }, log: (s) => logs.push(s), error: (s) => logs.push(s), sh, check, diff: () => ['README.md'] }), 0);
    assert.ok(logs.some((l) => /no changed tests/.test(l)));
    // --list prints nothing on stdout, so the workflow step installs nothing.
    const out = [];
    assert.equal(main(['--list'], { root: dir, env: {}, log: (s) => out.push(s), error: quiet, sh, check, diff: () => ['README.md'] }), 0);
    assert.deepEqual(out, []);
    const many = Array.from({ length: MAX_FILES + 1 }, (_, i) => `scripts/lib/t${i}.test.mjs`);
    for (const f of many) writeFileSync(join(dir, f), '');
    const capped = [];
    assert.equal(main(['--list'], { root: dir, env: {}, log: (s) => capped.push(s), error: (s) => capped.push(`E ${s}`), sh, check, diff: () => many }), 0);
    assert.equal(capped.length, 1);
    assert.match(capped[0], /^E .*41 changed test files, over the cap of 40; the nightly future-clock run covers them/);
    assert.equal(main([], { root: dir, env: {}, log: quiet, error: quiet, sh, check, diff: () => many }), 0);
    assert.equal(calls.length + checked, 0);
    // An unreadable diff is not "no changed tests".
    assert.equal(main([], { root: dir, env: {}, log: quiet, error: quiet, sh, check, diff: () => null }), 1);
  } finally { rmSync(dir, { recursive: true }); }
});

test('main: fails ahead and passes now fails the step with file, test, offset and fix; fails on both exits 0', () => {
  const dir = fixtureRoot({ 'scripts/lib/promo.test.mjs': '', 'scripts/lib/sat.test.mjs': '', 'scripts/lib/broken.test.mjs': '' });
  const summary = join(dir, 'summary.md');
  try {
    const fail = (label, f) => ({
      'scripts/lib/promo.test.mjs': label ? ['report reads as reported'] : [],
      'scripts/lib/sat.test.mjs': label === '+9d 11h' ? ['not on a Saturday'] : [],
      'scripts/lib/broken.test.mjs': ['always'],
    })[f];
    const { sh, calls } = fakeShell(fail);
    const errors = []; const logs = [];
    const status = main([], { root: dir, env: { FUTURE_CLOCK_BASE: 'f'.repeat(40), GITHUB_STEP_SUMMARY: summary }, log: (s) => logs.push(s), error: (s) => errors.push(s), sh, check: () => ({ status: 0 }), diff: () => ['scripts/lib/promo.test.mjs', 'scripts/lib/sat.test.mjs', 'scripts/lib/broken.test.mjs'] });
    assert.equal(status, 1);
    assert.deepEqual(errors.map((e) => /^::error file=([^,]+),title=[^:]+::(.+?) fails with the clock (\S+(?: 11h)?) ahead/.exec(e).slice(1)), [
      ['scripts/lib/promo.test.mjs', 'report reads as reported', '+7d'],
      ['scripts/lib/promo.test.mjs', 'report reads as reported', '+9d 11h'],
      ['scripts/lib/sat.test.mjs', 'not on a Saturday', '+9d 11h'],
    ]);
    assert.ok(errors.every((e) => e.endsWith(FIX)));
    assert.ok(logs.some((l) => /fails on today's clock too, left to the suite: scripts\/lib\/broken\.test\.mjs › always/.test(l)));
    // One file per run, and only a file that failed ahead runs again on the real clock.
    assert.ok(calls.every((c) => c.ran.length === 1));
    const realRuns = calls.filter((c) => c.label === null);
    assert.deepEqual(realRuns.map((c) => c.ran[0]), ['scripts/lib/broken.test.mjs', 'scripts/lib/promo.test.mjs', 'scripts/lib/broken.test.mjs', 'scripts/lib/promo.test.mjs', 'scripts/lib/sat.test.mjs']);
    const text = readFileSync(summary, 'utf8');
    assert.match(text, /\| `scripts\/lib\/sat\.test\.mjs` \| not on a Saturday \| \+9d 11h \| `node scripts\/future-clock-changed\.mjs --offset '\+9d 11h' scripts\/lib\/sat\.test\.mjs` \|/);
    // Failing on both clocks alone is the suite's to report.
    assert.equal(main([], { root: dir, env: {}, log: quiet, error: quiet, sh, check: () => ({ status: 0 }), diff: () => ['scripts/lib/broken.test.mjs'] }), 0);
    // A clock that did not move tests nothing and fails.
    const before = calls.length;
    assert.equal(main([], { root: dir, env: {}, log: quiet, error: quiet, sh, check: () => ({ status: 1 }), diff: () => ['scripts/lib/promo.test.mjs'] }), 1);
    assert.equal(calls.length, before);
  } finally { rmSync(dir, { recursive: true }); }
});

test('the step stops starting runs once its budget is spent; started runs finish and the rest are named for the nightly', () => {
  // Owner answer A on #7124 (2026-11-26): about 150 s, then the nightly covers the rest, exit 0.
  // Mutations checked: the budget check before each file dropped → every file runs; the offset-level check dropped →
  // the second offset's clock proof still runs; `>=` turned to `>` → the run at exactly the budget starts.
  assert.equal(BUDGET_MS, 150_000);
  const dir = fixtureRoot({ 'scripts/lib/a.test.mjs': '', 'scripts/lib/b.test.mjs': '', 'scripts/lib/c.test.mjs': '' });
  try {
    let t = 0;
    const { sh: inner, calls } = fakeShell((label, f) => (f === 'scripts/lib/b.test.mjs' && label === '+7d' ? ['expired'] : []));
    const sh = (command, env) => { t += 60_000; return inner(command, env); };  // each run takes a minute
    let proofs = 0;
    const logs = [];
    const status = main([], { root: dir, env: {}, log: (s) => logs.push(s), error: (s) => logs.push(s), sh, check: () => { proofs++; return { status: 0 }; },
      diff: () => ['scripts/lib/a.test.mjs', 'scripts/lib/b.test.mjs', 'scripts/lib/c.test.mjs'], now: () => t, budgetMs: 150_000 });
    // a (60 s), b ahead (120 s) fails, b today (180 s) still runs to decide it; c would start at 180 s, past the budget.
    assert.deepEqual(calls.map((c) => [c.label, c.ran[0]]), [['+7d', 'scripts/lib/a.test.mjs'], ['+7d', 'scripts/lib/b.test.mjs'], [null, 'scripts/lib/b.test.mjs']]);
    assert.equal(proofs, 1, 'the second offset is not even clock-checked');
    assert.equal(status, 1, 'the date-bound test found inside the budget still fails the step');
    const note = logs.find((l) => /budget was spent/.test(l));
    assert.match(note, /the 150 s budget was spent; 4 run\(s\) not started, the nightly future-clock run covers them \(D7124\)/);
    assert.match(note, /scripts\/lib\/c\.test\.mjs \+7d, scripts\/lib\/a\.test\.mjs \+9d 11h/);
    // Within the budget nothing is skipped and nothing is said about it; a run at exactly the budget does not start.
    t = 0; calls.length = 0;
    const quietLogs = [];
    assert.equal(main([], { root: dir, env: {}, log: (s) => quietLogs.push(s), error: quiet, sh, check: () => ({ status: 0 }), diff: () => ['scripts/lib/a.test.mjs'], now: () => t, budgetMs: 10 * 60_000 }), 0);
    assert.equal(calls.length, 2);
    assert.ok(!quietLogs.some((l) => /budget/.test(l)));
    t = 0; calls.length = 0;
    assert.equal(main([], { root: dir, env: {}, log: quiet, error: quiet, sh, check: () => ({ status: 0 }), diff: () => ['scripts/lib/a.test.mjs'], now: () => t, budgetMs: 60_000 }), 0);
    assert.deepEqual(calls.map((c) => c.label), ['+7d'], 'the second run would start at exactly 60 s and does not');
  } finally { rmSync(dir, { recursive: true }); }
});

// The real shape, under real libfaketime. CI's PR parts do not install it, so there this test says so and stops;
// the nightly (which runs every suite under libfaketime) and a local run with `apt-get install faketime` run it.
test('under libfaketime: the 2026-11-17 shape fails at +7d, a pinned clock passes, a weekday test fails only at +9d 11h', (t) => {
  if (!existsSync(LIBFAKETIME)) { t.diagnostic(`libfaketime is not installed (${LIBFAKETIME}); the real-clock fixtures did not run`); return; }
  const now = kernelNow();
  const weekdayAhead = new Date(now + 227 * HOUR).getUTCDay();
  const code = `export function status(reportedAt, now = Date.now()) { return now - reportedAt > 48 * 3600000 ? 'stale' : 'reported'; }\n`;
  const head = `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { status } from './report.mjs';\nconst NOW = ${now - HOUR};\n`;
  const dir = fixtureRoot({
    'scripts/lib/report.mjs': code,
    'scripts/lib/promo.test.mjs': `${head}test('a report pushed at NOW reads as reported', () => assert.equal(status(NOW), 'reported'));\n`,
    'scripts/lib/pinned.test.mjs': `${head}test('pinned clock', (t) => { t.mock.timers.enable({ apis: ['Date'], now: NOW + 60000 }); assert.equal(status(NOW), 'reported'); });\n`,
    'scripts/lib/weekday.test.mjs': `import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('not on weekday ${weekdayAhead}', () => assert.notEqual(new Date().getUTCDay(), ${weekdayAhead}));\n`,
    'scripts/lib/broken.test.mjs': `import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('broken on every clock', () => assert.fail('no'));\n`,
  });
  const silent = (command, env) => spawnSync('sh', ['-c', command], { cwd: dir, env, encoding: 'utf8' });
  const run = (files) => {
    const errors = [];
    const status = main(files, { root: dir, env: process.env, log: quiet, error: (s) => errors.push(s), sh: silent,
      check: (env) => spawnSync(process.execPath, [resolve(root, 'scripts/future-clock-check.mjs')], { cwd: dir, env, encoding: 'utf8' }) });
    return { status, found: errors.map((e) => /^::error file=([^,]+),title=[^:]+::(.+?) fails with the clock (\S+(?: 11h)?) ahead/.exec(e)?.slice(1)) };
  };
  try {
    const bad = run(['scripts/lib/promo.test.mjs', 'scripts/lib/pinned.test.mjs', 'scripts/lib/weekday.test.mjs', 'scripts/lib/broken.test.mjs']);
    assert.equal(bad.status, 1);
    assert.deepEqual(bad.found, [
      ['scripts/lib/promo.test.mjs', 'a report pushed at NOW reads as reported', '+7d'],
      ['scripts/lib/promo.test.mjs', 'a report pushed at NOW reads as reported', '+9d 11h'],
      ['scripts/lib/weekday.test.mjs', `not on weekday ${weekdayAhead}`, '+9d 11h'],
    ]);
    assert.deepEqual(run(['scripts/lib/pinned.test.mjs', 'scripts/lib/broken.test.mjs']), { status: 0, found: [] });
  } finally { rmSync(dir, { recursive: true }); }
});

test('the step runs in ci.yml\'s rest part on non-draft pull requests only, and installs libfaketime only for a changed test', () => {
  const wf = read('.github/workflows/ci.yml');
  const suite = wf.slice(wf.indexOf('\n  suite:\n'), wf.indexOf('\n  test-deps:\n'));
  const at = suite.indexOf('- name: Changed tests with the clock moved ahead (D7124)');
  assert.ok(at > suite.indexOf('node scripts/test-drift-parts.mjs ${{ matrix.part }}'), 'after the part, in the suite job the gate reads');
  const step = suite.slice(at, suite.indexOf('\n      - ', at + 1) > 0 ? suite.indexOf('\n      - ', at + 1) : undefined);
  assert.match(step, /if: github\.event_name == 'pull_request' && !github\.event\.pull_request\.draft && matrix\.part == 'rest'\n/);
  assert.match(step, /FUTURE_CLOCK_BASE: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  const list = step.indexOf('node scripts/future-clock-changed.mjs --list');
  const exit = step.indexOf('if [ -z "$files" ]; then exit 0; fi');
  const install = step.indexOf('apt-get install -y -qq faketime');
  const runIt = step.lastIndexOf('node scripts/future-clock-changed.mjs');
  assert.ok(list > 0 && list < exit && exit < install && install < runIt, 'list, then install only when a test changed, then run');
  assert.doesNotMatch(step, /continue-on-error|\|\| true/);
  assert.doesNotMatch(wf.slice(0, wf.indexOf('\n  suite:\n')), /future-clock-changed/, 'no new job');
});

test('tapFailures reads real node:test TAP: nested tests with their file, a file that fails whole, no suite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fc-tap-7124-'));
  try {
    const sub = join(dir, 'frontend/test');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, 'a.test.mjs'), "import test from 'node:test'; import assert from 'node:assert/strict';\ntest('alpha `x` <b>', () => assert.equal(1, 2));\ntest.describe('group', () => { test('inner', () => assert.ok(false)); });\ntest('fine', () => {});\n");
    writeFileSync(join(sub, 'b.test.mjs'), "throw new Error('boom');\n");
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'frontend/test/a.test.mjs', 'frontend/test/b.test.mjs'], { cwd: dir, env, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.deepEqual(tapFailures(r.stdout), [
      { file: 'frontend/test/a.test.mjs', test: 'alpha `x` <b>' },
      { file: 'frontend/test/a.test.mjs', test: 'inner' },
      { file: 'frontend/test/b.test.mjs', test: 'frontend/test/b.test.mjs' },
    ]);
  } finally { rmSync(dir, { recursive: true }); }
  assert.equal(repoTestPath('/home/runner/work/StudioOS/StudioOS/cloudflare-worker/test/promo_issued_report_5949.test.ts:12:3'), 'cloudflare-worker/test/promo_issued_report_5949.test.ts');
  assert.equal(repoTestPath('/tmp/elsewhere/x.test.mjs:1:1'), null);
  assert.deepEqual(tapFailures(''), []);
});

test('the reporter lists failures from verified parts only, each with its part', () => {
  const tap = "TAP version 13\nnot ok 1 - expired\n  ---\n  type: 'test'\n  location: '/w/frontend/test/x.test.mjs:3:1'\n  ...\n";
  const blobs = [{ part: 'frontend-1-of-2', tap }, { part: 'worker-1-of-6', tap: tap.replace('frontend/test/x.test.mjs', 'cloudflare-worker/test/y.test.ts') }, { part: 'worker-2-of-6' }, { part: 'unexpected', tap }];
  assert.deepEqual(verifiedFailures(blobs, { discrepancies: ['artifact_corrupt:worker-1-of-6', 'missing:worker-3-of-6', 'unexpected_or_duplicate_artifact'] }), [
    { part: 'frontend-1-of-2', file: 'frontend/test/x.test.mjs', test: 'expired' },
  ]);
});

test('a part whose only doubt is tests_not_executed and that exited non-zero is named, because its failures are counted', () => {
  // 2026-11-25 nightly 45604894738: failed:1 came from a part read as tests_not_executed, and the log named nothing.
  // Mutations checked: the partial set folded back into the doubted set → no name; the exit-code test dropped → the
  // exit-0 part is named.
  const sha = 'a'.repeat(40), runId = '45604894738', expected = ['frontend-1-of-2', 'frontend-2-of-2', 'worker-1-of-6'];
  const tapOf = (file) => `TAP version 13\nnot ok 1 - expired\n  ---\n  type: 'test'\n  location: '/w/${file}:3:1'\n  ...\nok 2 - not run here # SKIP\n1..2\n# tests 2\n# suites 0\n# pass 0\n# fail 1\n# cancelled 0\n# skipped 1\n# todo 0\n# duration_ms 10\n`;
  const blob = (part, file, exitCode) => {
    const tap = tapOf(file);
    return { part, tap, manifest: { schema: 1, part, runId, attempt: 1, sha, days: 7, exitCode, bytes: Buffer.byteLength(tap), sha256: createHash('sha256').update(tap).digest('hex') } };
  };
  const blobs = [blob('frontend-1-of-2', 'frontend/test/z.test.mjs', 0), blob('frontend-2-of-2', 'frontend/test/x.test.mjs', 1)];
  const jobs = expected.map(part => ({ name: `future clock (${part})`, status: 'completed', conclusion: 'success', steps: [{ name: 'Run the part 7 days ahead', status: 'completed', conclusion: 'success' }] }));
  const evidence = assessFutureClock({ expected, blobs, jobs, runId, attempt: 1, sha });
  assert.deepEqual(evidence.discrepancies, ['tests_not_executed:frontend-1-of-2', 'tests_not_executed:frontend-2-of-2', 'missing:worker-1-of-6']);
  assert.equal(evidence.failed, 1, 'only the part that exited non-zero is counted');
  const named = verifiedFailures(blobs, evidence);
  assert.deepEqual(named, [{ part: 'frontend-2-of-2', file: 'frontend/test/x.test.mjs', test: 'expired' }]);
  assert.equal(named.length, evidence.failed, 'the alert count and the names agree');
  // A doubted part is still never named, whatever its exit code.
  assert.deepEqual(verifiedFailures(blobs, { discrepancies: ['artifact_corrupt:frontend-2-of-2'] }).map(f => f.part), ['frontend-1-of-2']);
});

test('job log and step summary carry names and the reproduce command; the alert text carries the break date and no name', () => {
  assert.equal(breakDate('2026-11-15T09:38:00Z'), '2026-11-22');
  assert.equal(breakDate(null), null);
  const failures = [{ part: 'worker-3-of-6', file: 'cloudflare-worker/test/promo_issued_report_5949.test.ts', test: 'HQ reads the report as `reported` <@team>' }];
  const summary = futureClockSummary({ failures, failed: 1, broke: '2026-11-22', runUrl: 'https://github.com/o/r/actions/runs/43700195545' });
  assert.match(summary, /### 1 test failure\(s\) with the clock 7 days ahead \(D7124\)/);
  assert.match(summary, /break main by 2026-11-22/);
  assert.match(summary, /\| worker-3-of-6 \| `cloudflare-worker\/test\/promo_issued_report_5949\.test\.ts` \| HQ reads the report as reported at team \|/);
  assert.match(summary, /node scripts\/future-clock-changed\.mjs --offset \+7d cloudflare-worker\/test\/promo_issued_report_5949\.test\.ts/);
  assert.equal(safeTestName('a`b<c>@d|e\nf'), 'a b c at d e f');
  assert.match(futureClockSummary({ failures: [], failed: 0 }), /No test fails/);
  assert.match(futureClockSummary({ failures, failed: 3, complete: false }), /evidence is incomplete/);
  const lines = futureClockLogLines({ failures, broke: '2026-11-22' });
  assert.equal(lines[0], 'future-clock: worker-3-of-6 cloudflare-worker/test/promo_issued_report_5949.test.ts › HQ reads the report as reported at team');
  assert.ok(lines.includes('future-clock: reproduce: node scripts/future-clock-changed.mjs --offset +7d cloudflare-worker/test/promo_issued_report_5949.test.ts'));
  assert.ok(lines.includes('future-clock: these break main by 2026-11-22'));

  // The alert: break date and where the names are, no test name; a date that is not one never reaches it.
  const facts = safeHealthFacts({ days: 7, failedCount: 2, runUrl: 'https://github.com/o/r/actions/runs/43700195545', breakDate: '2026-11-22', failures, names: ['x'] });
  assert.deepEqual(Object.keys(facts).sort(), ['breakDate', 'days', 'failedCount', 'runUrl']);
  for (const bad of ['2026-11-22\n@x', '2026-13-45', 'soon']) assert.equal(safeHealthFacts({ breakDate: bad }).breakDate, undefined, bad);
  const text = message('future-clock', 'open', { ...facts, issueUrl: 'https://github.com/o/r/issues/6616' });
  assert.match(text, /2 verified test failures with the clock 7 days ahead/);
  assert.match(text, /They break main by 2026-11-22 unless fixed first; a main repair is due before then\./);
  assert.match(text, /names and the reproduce command are in the run summary/);
  assert.doesNotMatch(text, /promo_issued|HQ reads/);
});

test('the open alert issue gets one "Latest failing run" line, replaced each night, before the health marker', () => {
  const run = (n) => `https://github.com/o/r/actions/runs/${n}`;
  const body = ':alarm_clock: *2 verified test failures with the clock 7 days ahead.*\n\n<!-- studioos-health:v1 {"schema":1} -->';
  const once = withFutureClockRunLine(body, { runUrl: run(1), broke: '2026-11-22' });
  assert.match(once, /\n\nLatest failing run: \[run\]\(https:\/\/github\.com\/o\/r\/actions\/runs\/1\)\. The failing test names and the reproduce command are in its summary\. A failure first seen in that run breaks main by 2026-11-22\.\n\n<!-- studioos-health:v1/);
  const twice = withFutureClockRunLine(once, { runUrl: run(2), broke: '2026-11-23' });
  assert.equal(twice.match(/Latest failing run/g).length, 1);
  assert.match(twice, /runs\/2\).*2026-11-23/);
  assert.equal(withFutureClockRunLine(body, { runUrl: 'https://evil.example/x', broke: '2026-11-22' }), body);
  assert.equal(withFutureClockRunLine(body, { runUrl: run(1), broke: null }), body);
  const cli = read('scripts/github-alerts.mjs');
  const mode = cli.slice(cli.indexOf("if (mode === 'future-clock')"), cli.indexOf('throw new Error(`unknown mode'));
  assert.match(mode, /appendFileSync\(env\.GITHUB_STEP_SUMMARY, futureClockSummary\(/);
  assert.match(mode, /withFutureClockRunLine\(open\.body/);
  assert.match(mode, /breakDate: broke \}/);
  assert.doesNotMatch(mode.slice(mode.indexOf('return apply(')), /failures/, 'no name reaches the alert facts');
});

test('the nightly keeps its evidence 14 days, past the 7-day fuse', () => {
  const wf = read('.github/workflows/github-alerts.yml');
  const part = wf.slice(wf.indexOf('  future-clock-part:'), wf.indexOf('  future-clock:\n'));
  assert.match(part, /name: future-clock-\$\{\{ matrix\.part \}\}[\s\S]*?retention-days: 14\n/);
});

test('the routing is written where agents and the coordinator read it', () => {
  assert.match(read('AGENTS.md'), /`\[alert\] future-clock tests failing` is a main repair due before its break date[\s\S]{0,200}Session 1 files the slot task from the run summary/);
  assert.match(read('.claude/skills/coordinator-audit/SKILL.md'), /\[alert\] future-clock tests failing[\s\S]{0,400}run summary/);
  assert.match(read('.claude/skills/red-ci-triage/SKILL.md'), /Changed tests with the clock moved ahead \(D7124\)/);
  assert.match(read('documentation/architecture/decisions/D7124.md'), /^## D7124 — .+ \(#7124\)$/m);
});
