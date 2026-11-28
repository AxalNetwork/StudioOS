// D5610: read dependencies, directory membership, conservative fallbacks and honest scoring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { select, score, report, FAN_IN_MAX, STALE_COMMITS, ALWAYS, traceAtOrBefore, replayInputs } from './selectTests.mjs';
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


const sha = (n) => n.toString(16).padStart(40, '0');
const artifact = (id, commit, created_at, extra = {}) => ({ id, name: `test-deps-${commit}`, created_at, expired: false, workflow_run: { head_sha: commit }, ...extra });

test('D5610-p3: the trace is the newest at or before the base, never a newer main commit', () => {
  const line = [sha(10), sha(9), sha(8)];
  const newer = artifact(1, sha(11), '2026-11-27T12:00:00Z');
  assert.deepEqual(traceAtOrBefore(line, [newer, artifact(2, sha(8), '2026-11-27T09:00:00Z'), artifact(3, sha(9), '2026-11-27T10:00:00Z')]), { id: 3, created_at: '2026-11-27T10:00:00Z', sha: sha(9), ageCommits: 1 });
  assert.equal(traceAtOrBefore(line, [newer]), null);
  // A rerun's newer artifact of the same commit wins; expired, misnamed or other-run artifacts never do.
  assert.equal(traceAtOrBefore(line, [artifact(4, sha(10), '2026-11-27T08:00:00Z'), artifact(5, sha(10), '2026-11-27T08:30:00Z')]).id, 5);
  for (const bad of [{ expired: true }, { name: 'test-deps-other' }, { workflow_run: { head_sha: sha(9) } }, { id: 0 }]) assert.equal(traceAtOrBefore([sha(10)], [artifact(6, sha(10), '2026-11-27T08:00:00Z', bad)]), null, JSON.stringify(bad));
});

test('D5610-p3: the lookup stops at STALE_COMMITS', () => {
  const line = Array.from({ length: STALE_COMMITS + 2 }, (_, i) => sha(100 - i));
  assert.equal(traceAtOrBefore(line, [artifact(7, line[STALE_COMMITS], '2026-11-27T08:00:00Z')]).ageCommits, STALE_COMMITS);
  assert.equal(traceAtOrBefore(line, [artifact(8, line[STALE_COMMITS + 1], '2026-11-27T08:00:00Z')]), null);
});

test('D5610-p3: guard failures never miss and never unscore a run with test failures', () => {
  const guard = { kind: 'guard', file: 'scripts/check-x.mjs' };
  assert.deepEqual(score({ files: [tests[0]] }, { verdict: 'pr_failure', failures: [guard, { kind: 'test', file: tests[0] }] }), { scoring: 'scored', failing: [tests[0]], misses: [] });
  assert.deepEqual(score({ files: [] }, { verdict: 'pr_failure', failures: [guard] }), { scoring: 'unscored', misses: null, failing: null });
});

test('D5610-p3: replay inputs judge the first red change against the recorded trace', () => {
  const deps = { sha: sha(1), tests: Object.fromEntries(tests.map((t, i) => [t, { files: i ? [] : ['x.sql'], directories: [] }])) };
  const inputs = replayInputs({ changed: [{ status: 'M', path: 'x.sql' }, { status: 'A', path: 'new/a.test.mjs' }, { status: 'D', path: 'old/b.test.mjs' }], deps, traceCreatedAt: '2026-11-20T22:10:06Z', ageCommits: 2 });
  assert.deepEqual(inputs.tests, ['new/a.test.mjs', ...tests].sort());
  assert.deepEqual(inputs.graph, { 'new/a.test.mjs': [] });
  assert.equal(inputs.deps.generatedAt, '2026-11-20T22:10:06Z');
  const selection = select(inputs);
  assert.equal(selection.mode, 'selected');
  assert.deepEqual(selection.files, ['new/a.test.mjs', tests[0]].sort());
  assert.deepEqual(score(selection, { verdict: 'pr_failure', failures: [{ file: tests[1] }] }).misses, [tests[1]]);
});

test('D5610-p3: every backtest episode is after the first trace and names a trace that existed when it ran', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/red_main_episodes.json', import.meta.url), 'utf8'));
  assert.ok(fixture.episodes.length > 0);
  for (const e of fixture.episodes) {
    assert.ok(e.createdAt >= '2026-11-16T22:21:00Z', e.firstRedCommit);
    assert.ok(e.trace.createdAt <= e.createdAt, e.firstRedCommit);
    assert.match(e.parentCommit, /^[a-f0-9]{40}$/);
    assert.ok(Number.isSafeInteger(e.trace.artifactId) && e.failingFiles.every((f) => /\.test\.(?:mjs|ts)$/.test(f)), e.firstRedCommit);
  }
});
