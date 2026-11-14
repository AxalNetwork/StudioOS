/** #6326: the mutation check's pure decisions (lib/mutationCheck.mjs). */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyMutation, changedTests, countOccurrences, failedTests, isFileEntry, isRepoPath, parseSpec,
  runnerFor, runPassed, summaryLine, tapCounts, testArgv, testCommandLine, unescapeTapName, verdict,
} from './mutationCheck.mjs';

const ok = { file: 'cloudflare-worker/src/routes/x.ts', find: 'a === b', replace: 'true', test: 'cloudflare-worker/test/x.test.ts' };

test('each suite gets the loader its package.json script uses', () => {
  assert.deepEqual(testArgv('cloudflare-worker/test/x.test.ts'),
    ['--experimental-strip-types', '--no-warnings', '--import', './cloudflare-worker/test/_ts-loader.mjs', '--test', '--test-reporter=tap', 'cloudflare-worker/test/x.test.ts']);
  assert.deepEqual(testArgv('frontend/test/y.test.mjs'),
    ['--import', './frontend/test/_deck-loader.mjs', '--test', '--test-reporter=tap', 'frontend/test/y.test.mjs']);
  assert.equal(testCommandLine('meeting-bot/test/z.test.ts'), 'node --experimental-strip-types --no-warnings --test meeting-bot/test/z.test.ts');
  assert.match(testCommandLine('merge-control/test/q.test.ts'), /merge-control\/test\/runtime-loader\.mjs --test /);
  assert.equal(testCommandLine('scripts/lib/a.test.mjs'), 'node --test scripts/lib/a.test.mjs');
  assert.equal(testArgv('frontend/test/_helper.mjs'), null);
  assert.equal(testArgv('backend/tests/test_x.py'), null);
  assert.equal(runnerFor('scripts/lib/a.test.mjs').script, 'test:retention');
  // scripts/claude-review/review.test.mjs runs in claude-review.yml, not test:retention.
  assert.equal(runnerFor('scripts/claude-review/review.test.mjs').script, null);
  assert.equal(testCommandLine('scripts/claude-review/review.test.mjs'), 'node --test scripts/claude-review/review.test.mjs');
});

test('changedTests keeps only runnable test files, once, sorted', () => {
  assert.deepEqual(changedTests(['frontend/test/b.test.mjs', 'cloudflare-worker/src/a.ts', 'frontend/test/b.test.mjs', 'cloudflare-worker/test/a.test.ts']),
    ['cloudflare-worker/test/a.test.ts', 'frontend/test/b.test.mjs']);
});

test('parseSpec accepts an array or { mutations } and names unnamed mutations', () => {
  const a = parseSpec([ok, { ...ok, id: 'guard', replace: 'false' }]);
  assert.deepEqual(a.errors, []);
  assert.deepEqual(a.mutations.map((m) => m.id), ['m1', 'guard']);
  assert.deepEqual(parseSpec({ mutations: [ok] }).errors, []);
  assert.equal(parseSpec({}).errors.length, 1);
});

test('parseSpec refuses what would make the check meaningless or unsafe', () => {
  const errs = (m) => parseSpec([m]).errors.join(' | ');
  assert.match(errs({ ...ok, replace: ok.find }), /nothing changes/);
  assert.match(errs({ ...ok, file: ok.test }), /mutates the test itself/);
  assert.match(errs({ ...ok, file: '../etc/passwd' }), /repository-relative/);
  assert.match(errs({ ...ok, file: '/abs/x.ts' }), /repository-relative/);
  assert.match(errs({ ...ok, file: 'docs/assets/x.js' }), /docs\//);
  assert.match(errs({ ...ok, test: 'backend/tests/test_x.py' }), /no known runner/);
  assert.match(errs({ ...ok, replace: undefined }), /"replace" is a string/);
  assert.match(errs({ ...ok, equivalent: ' ' }), /reason/);
  assert.match(parseSpec([{ ...ok, id: 'x' }, { ...ok, id: 'x', replace: 'y' }]).errors.join(), /id used twice/);
  assert.equal(errs({ ...ok, replace: '' }), '');
});

test('isRepoPath', () => {
  assert.equal(isRepoPath('a/b.ts'), true);
  for (const p of ['', '/a', 'a/../b', './a', 'a//b', 'a\\b', null]) assert.equal(isRepoPath(p), false, String(p));
});

test('applyMutation replaces exactly one occurrence and refuses zero or many', () => {
  assert.equal(countOccurrences('aaa', 'aa'), 1);
  assert.equal(countOccurrences('x', ''), 0);
  assert.deepEqual(applyMutation('if (a === b) go();', ok), { ok: true, text: 'if (true) go();' });
  assert.match(applyMutation('nothing here', ok).error, /not in/);
  assert.match(applyMutation('a === b; a === b', ok).error, /occurs 2 times/);
  assert.equal(applyMutation('x a === b y', { ...ok, replace: '' }).text, 'x  y');
});

const tap = [
  'TAP version 13',
  '# Subtest: outer',
  '    not ok 1 - refuses a second answer',
  '    ok 2 - lists answers',
  'not ok 1 - outer',
  'not ok 2 - skipped one # SKIP not today',
  '# pass 1',
  '# fail 2',
].join('\n');

test('failedTests reads not-ok lines at any depth; tapCounts reads the summary', () => {
  assert.deepEqual(failedTests(tap), ['refuses a second answer', 'outer', 'skipped one']);
  assert.deepEqual(tapCounts(tap), { pass: 1, fail: 2 });
  assert.equal(tapCounts('no summary'), null);
});

test('verdict: a failure is caught, a pass survives unless a reason is given', () => {
  const failed = { code: 1, timedOut: false, output: tap };
  const passed = { code: 0, timedOut: false, output: '# pass 3' };
  assert.equal(verdict(ok, failed), 'caught');
  assert.equal(verdict({ ...ok, expect: 'second answer' }, failed), 'caught');
  assert.equal(verdict({ ...ok, expect: 'some other test' }, failed), 'wrong_failure');
  assert.equal(verdict(ok, passed), 'survived');
  assert.equal(verdict({ ...ok, equivalent: 'the WHERE guard also refuses' }, passed), 'equivalent');
  assert.equal(verdict(ok, { code: 1, timedOut: true, output: '' }), 'timeout');
});

test('failedTests unescapes the names TAP escapes, so an expect with # matches', () => {
  assert.equal(unescapeTapName('lt \\# strict \\\\ x'), 'lt # strict \\ x');
  const out = ['not ok 1 - refuses a second answer \\(\\#4545\\)', 'not ok 2 - lt \\# strict: boundary', 'not ok 3 - todo one # TODO later'].join('\n');
  assert.deepEqual(failedTests(out), ['refuses a second answer \\(#4545\\)', 'lt # strict: boundary', 'todo one']);
  assert.equal(verdict({ ...ok, expect: 'lt # strict' }, { code: 1, timedOut: false, output: out }), 'caught');
});

test('a file that fails to load is a wrong failure, even when expect is part of its path', () => {
  const m = { ...ok, test: 'scripts/lib/code_4545.test.mjs', expect: 'code_4545' };
  const loadFail = ['TAP version 13', 'not ok 1 - scripts/lib/code_4545.test.mjs', '  ---', "  error: 'test failed'", '  ...', '# pass 0', '# fail 1'].join('\n');
  assert.equal(verdict(m, { code: 1, timedOut: false, output: loadFail }), 'wrong_failure');
  const absFail = 'not ok 1 - /home/u/repo/scripts/lib/code_4545.test.mjs';
  assert.equal(verdict(m, { code: 1, timedOut: false, output: absFail }), 'wrong_failure');
  assert.equal(isFileEntry('scripts/lib/code_4545.test.mjs', m.test), true);
  assert.equal(isFileEntry('code_4545 refuses twice', m.test), false);
  // Without expect, any non-zero exit still counts: the spec chose not to name a test.
  assert.equal(verdict({ ...m, expect: undefined }, { code: 1, timedOut: false, output: loadFail }), 'caught');
});

test('summaryLine is the fixed STATUS format, and names what failed the run', () => {
  const rs = [
    { id: 'm1', verdict: 'caught' },
    { id: 'm2', verdict: 'caught' },
    { id: 'm3', verdict: 'equivalent', equivalent: 'D1 cascades the rows' },
  ];
  assert.equal(summaryLine(rs), '3 mutations, 2 caught, 1 equivalent (m3: D1 cascades the rows)');
  assert.equal(summaryLine(rs.slice(0, 2)), '2 mutations, 2 caught, 0 equivalent');
  assert.equal(summaryLine([...rs, { id: 'm4', verdict: 'survived' }, { id: 'm5', verdict: 'wrong_failure' }]),
    '5 mutations, 2 caught, 1 equivalent (m3: D1 cascades the rows), 1 survived (m4), 1 wrong failure (m5)');
});

test('runPassed needs a green baseline, a clean restore, and no survivor', () => {
  const good = [{ verdict: 'caught' }, { verdict: 'equivalent' }];
  assert.equal(runPassed(good, true, true), true);
  assert.equal(runPassed(good, false, true), false);
  assert.equal(runPassed(good, true, false), false);
  assert.equal(runPassed([], true, true), false);
  assert.equal(runPassed([...good, { verdict: 'survived' }], true, true), false);
  assert.equal(runPassed([{ verdict: 'wrong_failure' }], true, true), false);
});
