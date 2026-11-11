// D5610: read dependencies, directory membership, conservative fallbacks and honest scoring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { select, score, report, FAN_IN_MAX, STALE_COMMITS, ALWAYS } from './selectTests.mjs';
const now = Date.parse('2026-11-11T12:00:00Z');
const tests = Array.from({ length: 100 }, (_, i) => `test/${i}.test.mjs`);
const fixture = () => ({ changed: [], deps: { generatedAt: '2026-11-11T11:00:00Z', tests: Object.fromEntries(tests.map((t) => [t, { files: [], directories: [] }])) }, tests, meta: { now, ageCommits: 0 } });

test('traced fs reads select a non-imported SQL consumer', () => {
  const f = fixture(); f.changed = ['x.sql']; f.deps.tests[tests[0]].files = ['x.sql'];
  assert.deepEqual(select(f).files, [tests[0]]);
  assert.deepEqual(select({ ...f, changed: ['unrelated'] }).files, []);
});

test('directory addition, deletion and rename select listers; content-only edits do not', () => {
  const f = fixture(); f.deps.tests[tests[0]].directories = ['sql'];
  for (const status of ['A', 'D', 'R100']) assert.deepEqual(select({ ...f, changed: [{ status, path: 'sql/new.sql' }] }).files, [tests[0]]);
  for (const path of ['sql/new.sql', 'sql-other/new.sql']) assert.deepEqual(select({ ...f, changed: [{ status: 'M', path }] }).files, []);
});

test('changed/new tests and transitive static imports for untraced tests are selected', () => {
  const f = fixture();delete f.deps.tests[tests[0]];
  f.graph = { [tests[0]]: ['a.mjs'], 'a.mjs': ['b.mjs'], 'b.mjs': ['a.mjs'] };
  f.changed = ['b.mjs', tests[1]];
  assert.deepEqual(select(f).files, tests.slice(0, 2).sort());
});

test('generator inputs select consumers of generated outputs', () => {
  const f = fixture(); f.changed = ['frontend/src/lib/api/new.js'];
  f.deps.tests[tests[0]].files = ['frontend/src/lib/apiModules.generated.js'];
  assert.deepEqual(select(f).files, [tests[0]]);
});

test('fan-in and opaque tests are always selected alongside mandatory commands', () => {
  const f = fixture();f.deps.tests[tests[0]].files = Array.from({ length: FAN_IN_MAX + 1 }, (_, i) => `file/${i}`);
  f.deps.tests[tests[1]].opaque = true;
  assert.deepEqual(select(f).files, tests.slice(0, 2).sort());
  assert.deepEqual(ALWAYS, ['test:guards', 'test:types', 'test:types:frontend', 'build']);
});

for (const [reason, paths] of Object.entries({ package: ['package.json', 'x/package-lock.json'], loader: ['x/_deck-loader-extra.mjs', '_ts-loader.mjs', 'x/_transpile-ts.mjs'], helper: ['frontend/test/_tick.mjs', 'cloudflare-worker/test/_data.ts'], workflow: ['.github/workflows/ci.yml'] })) {
  test(`full fallback: ${reason}`, () => {
    for (const path of paths) {
      const r = select({ ...fixture(), changed: [path] });
      assert.equal(r.mode, 'full', path);assert.equal(r.reason, reason);assert.equal(r.files.length, tests.length);
    }
  });
}

test('missing, invalid and stale traces fall back; exact age limits remain usable', () => {
  for (const deps of [null, 'bad', [], { tests: [] }, { tests: {} }]) assert.equal(select({ ...fixture(), deps }).mode, 'full');
  const f = fixture();
  for (const generatedAt of ['invalid', '2026-11-10T11:59:59Z', '2026-11-12T12:00:00Z']) assert.equal(select({ ...f, deps: { ...f.deps, generatedAt } }).reason, 'stale-trace');
  assert.equal(select({ ...f, meta: { now, ageCommits: STALE_COMMITS + 1 } }).reason, 'stale-trace');
  assert.equal(select({ ...f, deps: { ...f.deps, generatedAt: '2026-11-10T12:00:00Z' }, meta: { now, ageCommits: STALE_COMMITS } }).mode, 'selected');
  f.deps.tests[tests[0]].files = null;assert.equal(select(f).reason, 'missing-or-invalid-trace');
});

test('41 percent falls back; 40 percent stays selected', () => {
  assert.equal(select({ ...fixture(), changed: tests.slice(0, 41) }).mode, 'full');
  const r = select({ ...fixture(), changed: tests.slice(0, 40) });assert.equal(r.mode, 'selected');assert.equal(r.fraction, 0.4);
});

test('missing or non-PR failure evidence is unscored, never zero misses', () => {
  for (const failure of [null, {}, { verdict: 'pr_failure', failures: [] }, { verdict: 'inherited_main_failure', failures: [{ file: tests[0] }] }]) assert.deepEqual(score({ files: [] }, failure), { scoring: 'unscored', misses: null, failing: null });
  assert.deepEqual(score({ files: [tests[0]] }, { verdict: 'pr_failure', failures: [{ file: tests[0] }, { file: tests[1] }] }).misses, [tests[1]]);
  const records = [{ mode: 'full', ...score({ files: [] }, null) }, { mode: 'selected', ...score({ files: [] }, { verdict: 'pr_failure', failures: [{ file: tests[0] }] }) }];
  assert.deepEqual(report(records), { runs: 2, failing: 1, unscored: 1, misses: 1, fallbackFraction: 0.5, gate: 'not-met' });
});


test('D5608 producer fields include reads, resolved modules, sqlite and both probe outcomes', () => {
  const f = fixture();
  f.deps.tests[tests[0]] = { reads: ['x.sql'], modules: ['module.ts'], sqlite: ['test.db'], probes: { hits: ['present.sql'], misses: ['missing.sql'] }, directories: [] };
  for (const path of ['x.sql', 'module.ts', 'test.db', 'present.sql', 'missing.sql']) assert.deepEqual(select({ ...f, changed: [path] }).files, [tests[0]]);
  f.deps.tests[tests[0]].probes.misses = null;
  assert.equal(select(f).mode, 'full');
});
