import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changedLines, fileProblems, pathRefusal, validate } from '../src/lib/patchGuard.mjs';

// D5622-p2: one fixture per refusal. Pure data, no clock.
const LIMITS = { maxFiles: 5, maxLines: 40 };
const SRC = 'frontend/src/pages/validate.js';
const edit = (path: string, before: string | null, after: string | null, extra = {}) => ({ path, before, after, ...extra });
const refused = (changes: object[], pattern: RegExp, limits = LIMITS) => {
  const v = validate(changes, limits);
  assert.equal(v.ok, false, `expected a refusal matching ${pattern}`);
  assert.ok(v.problems.some((p: string) => pattern.test(p)), `${pattern} not in ${JSON.stringify(v.problems)}`);
};

test('a bounded source fix and a new test pass', () => {
  const v = validate([
    edit(SRC, 'export const a = 1;\n', 'export const a = 2;\n'),
    edit('frontend/test/validate_new.test.mjs', null, "test('a is 2', () => { assert.equal(a, 2); });\n"),
  ], LIMITS);
  assert.deepEqual(v.problems, []);
  assert.equal(v.ok, true);
  assert.equal(v.files, 2);
});

test('closed by default: unset, zero or malformed limits refuse every patch', () => {
  for (const limits of [{}, { maxFiles: 0, maxLines: 40 }, { maxFiles: 5, maxLines: 0 }, { maxFiles: 1.5, maxLines: 40 }, null]) {
    refused([edit(SRC, 'a\n', 'b\n')], /limits are not set/, limits as never);
  }
});

test('privileged paths are refused whatever the content (workflows, scripts, Merge Control, packages, schema)', () => {
  for (const path of ['.github/workflows/ci.yml', 'scripts/check-folder-docs.mjs', 'merge-control/src/lib/patchGuard.mjs',
    'package.json', 'frontend/package-lock.json', 'cloudflare-worker/sql/migrations/202611270000_1_x.sql', 'AGENTS.md']) {
    refused([edit(path, 'a\n', 'b\n')], /privileged path/);
  }
});

test('an existing test, a fixture or helper, a baseline, an allowlist, a guard or a shard list is refused', () => {
  refused([edit('frontend/test/validate.test.mjs', "test('x', () => {});\n", "test('x', () => { /* fixed */ });\n")], /changes an existing test/);
  refused([edit('frontend/test/_deck-loader.mjs', 'a\n', 'b\n')], /helper, loader or fixture/);
  refused([edit('frontend/test/fixtures/data.json', null, '{}\n')], /helper, loader or fixture/);
  refused([edit('frontend/src/data/routes-baseline.json', '[]\n', '[1]\n')], /baseline/);
  refused([edit('frontend/src/data/host-allowlist.js', 'a\n', 'b\n')], /allowlist/);
  refused([edit('frontend/src/lib/routeGuard.js', 'a\n', 'b\n')], /guard or check script/);
  refused([edit('frontend/src/lib/test-shards.js', 'a\n', 'b\n')], /shard list/);
  assert.equal(pathRefusal('frontend/test/new.test.mjs', false), null, 'a new test file is allowed');
  assert.equal(pathRefusal(SRC, true), null);
});

test('a deletion or a rename is refused', () => {
  refused([edit(SRC, 'a\n', null)], /deletes the file/);
  refused([edit('frontend/src/pages/renamed.js', null, 'a\n', { previousPath: SRC })], /renames/);
});

test('added skip, only or todo, fewer tests or assertions, a changed timeout are refused', () => {
  refused([edit('frontend/test/extra.test.mjs', null, "test.skip('x', () => {});\n")], /skip, only or todo/);
  refused([edit(SRC, 'run();\n', "run({ only: true });\n")], /skip, only or todo/);
  refused([edit(SRC, "it('a', f);\nit('b', g);\n", "it('a', f);\n")], /fewer test calls/);
  refused([edit(SRC, 'assert.ok(a);\nassert.ok(b);\n', 'assert.ok(a);\n')], /fewer assertions/);
  refused([edit(SRC, 'const timeoutMs = 5000;\n', 'const timeoutMs = 50000;\n')], /changes a timeout/);
});

test('binary content, a mode change, an emptied file and oversize patches are refused', () => {
  refused([edit(SRC, 'a\n', 'a\u0000b\n')], /is binary/);
  refused([edit(SRC, 'a\n', 'b\n', { mode: '100755' })], /file mode 100755/);
  refused([edit(SRC, 'a\n', 'b\n', { mode: '120000' })], /file mode 120000/);
  refused([edit(SRC, 'export const a = 1;\n', '   \n')], /empties the file/);
  refused([edit(SRC, 'a\n', `${'x\n'.repeat(41)}`)], /changed lines, above the limit of 40/);
  const many = Array.from({ length: 6 }, (_, i) => edit(`frontend/src/pages/p${i}.js`, 'a\n', 'b\n'));
  refused(many, /6 files, above the limit of 5/);
  refused([edit(SRC, '', 'y'.repeat(200_001))], /larger than 200000 bytes/, { maxFiles: 5, maxLines: 1_000_000 });
  refused([], /changes nothing/);
  refused([edit(SRC, 'a\n', 'b\n'), edit(SRC, 'a\n', 'c\n')], /named twice/);
});

test('changedLines counts lines added plus removed', () => {
  assert.equal(changedLines('a\nb\n', 'a\nc\n'), 2);
  assert.equal(changedLines(null, 'a\nb'), 2);
  assert.deepEqual(fileProblems(edit(SRC, 'a\n', 'b\n')), []);
});
