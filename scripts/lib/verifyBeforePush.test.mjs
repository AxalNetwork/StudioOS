// #6326: which local checks a change needs, in what order, and how their results read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  areasOf, planSteps, chooseSteps, affectedTests, scriptFor, runnerOf, globToRegExp,
  envFailures, caseCollisions, preflightNotes, mergeResults, renderSummary, testsLine, AFFECTED_MAX,
} from './verifyBeforePush.mjs';

const SCRIPTS = {
  'test:frontend': "node --import ./frontend/test/_deck-loader.mjs --test 'frontend/test/*.test.mjs'",
  'test:worker': "node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test 'cloudflare-worker/test/*.test.ts' 'cloudflare-worker/test/*.test.mjs'",
  'test:meeting-bot': "node --experimental-strip-types --no-warnings --test 'meeting-bot/test/*.test.ts' && npx --no-install tsc -p meeting-bot/tsconfig.json",
  'test:retention': "node --test 'scripts/lib/*.test.mjs'",
};
const REST = ['npm run test:meeting-bot', 'npm run test:merge-control', 'npm run test:retention', 'npm run test:guards', 'npm run test:types', 'npm run test:types:frontend', 'npm run lint:undef', 'node scripts/check-dark-mode.mjs'];
const PARTS = [
  { name: 'frontend-1-of-2', script: 'test:frontend' }, { name: 'frontend-2-of-2', script: 'test:frontend' },
  { name: 'worker-1-of-2', script: 'test:worker' }, { name: 'worker-2-of-2', script: 'test:worker' },
  { name: 'rest', commands: REST },
];
const ids = (plan) => plan.steps.map((s) => s.id);

test('areasOf sorts paths into areas, and an unknown or shared path means everything', () => {
  assert.deepEqual([...areasOf(['frontend/src/App.jsx', 'cloudflare-worker/src/routes/x.ts', 'cloudflare-worker/sql/migrations/1.sql'])].sort(), ['frontend', 'sql', 'worker']);
  assert.deepEqual([...areasOf(['documentation/README.md', 'README.md'])], ['prose']);
  for (const p of ['package.json', 'frontend/package-lock.json', '.github/workflows/ci.yml', 'wrangler.toml', 'frontend/test/_deck-loader.mjs', 'cloudflare-worker/test/_baseline.mjs', 'scripts/test-drift-parts.mjs', 'frontend/tsconfig.json', 'somewhere/new.txt']) {
    assert.deepEqual([...areasOf([p])], ['everything'], p);
  }
});

test('planSteps: setup first, guards always, then the static checks, affected tests, late suites and parts', () => {
  const plan = planSteps({ changed: ['frontend/src/a.jsx'], scripts: SCRIPTS, parts: PARTS, affected: ['frontend/test/a.test.mjs'] });
  assert.deepEqual(ids(plan), ['generated', 'build', 'guards', 'types-frontend', 'lint-undef', 'dark-mode', 'lfs', 'affected-frontend', 'suite-plan', 'frontend-1-of-2', 'frontend-2-of-2']);
  assert.equal(plan.steps[0].cmd, 'node scripts/build-generated.mjs');
  assert.equal(plan.steps[1].cmd, 'npm run build');
  assert.equal(plan.steps.find((s) => s.id === 'lfs').cmd, 'node scripts/lfs-size-gate.mjs --against=origin/main');
  assert.equal(planSteps({ changed: ['frontend/src/a.jsx'], scripts: SCRIPTS, parts: PARTS, base: 'upstream/main' }).steps.find((s) => s.id === 'lfs').cmd, 'node scripts/lfs-size-gate.mjs --against=upstream/main');
  assert.equal(plan.steps.find((s) => s.id === 'affected-frontend').cmd, "node --import ./frontend/test/_deck-loader.mjs --test 'frontend/test/a.test.mjs'");
  assert.equal(plan.steps.find((s) => s.id === 'frontend-2-of-2').cmd, 'node scripts/test-drift-parts.mjs frontend-2-of-2 --plan-file <log-dir>/suite-plan.json');
});

test('planSteps: a prose-only change runs the setup and the guards, nothing else', () => {
  assert.deepEqual(ids(planSteps({ changed: ['documentation/architecture/decisions/D1.md'], scripts: SCRIPTS, parts: PARTS })), ['generated', 'build', 'guards', 'lfs']);
});

test('planSteps: worker and sql changes typecheck the worker and run its parts', () => {
  assert.deepEqual(ids(planSteps({ changed: ['cloudflare-worker/sql/migrations/202611140000_6326_x.sql'], scripts: SCRIPTS, parts: PARTS })), ['generated', 'build', 'guards', 'types', 'migrations', 'lfs', 'suite-plan', 'worker-1-of-2', 'worker-2-of-2']);
});

test('planSteps: --full and an everything path run every rest step and every part, with no affected step', () => {
  const full = ids(planSteps({ changed: [], scripts: SCRIPTS, parts: PARTS, affected: ['frontend/test/a.test.mjs'], full: true }));
  const pkg = ids(planSteps({ changed: ['package.json'], scripts: SCRIPTS, parts: PARTS }));
  const expected = ['generated', 'build', 'guards', 'types', 'types-frontend', 'lint-undef', 'dark-mode', 'migrations', 'lfs', 'retention', 'meeting-bot', 'merge-control', 'suite-plan', 'frontend-1-of-2', 'frontend-2-of-2', 'worker-1-of-2', 'worker-2-of-2'];
  assert.deepEqual(full, expected);
  assert.deepEqual(pkg, expected);
});

test('planSteps: a rest step it does not know always runs, so it is never narrower than CI', () => {
  const parts = PARTS.map((p) => (p.name === 'rest' ? { ...p, commands: [...REST, 'node scripts/check-new-thing.mjs'] } : p));
  const plan = planSteps({ changed: ['documentation/x.md'], scripts: SCRIPTS, parts });
  assert.ok(plan.steps.some((s) => s.cmd === 'node scripts/check-new-thing.mjs'));
});

test('planSteps: more affected files than the cap become a skipped step', () => {
  const affected = Array.from({ length: AFFECTED_MAX + 1 }, (_, i) => `frontend/test/t${i}.test.mjs`);
  const step = planSteps({ changed: ['frontend/src/a.jsx'], scripts: SCRIPTS, parts: PARTS, affected }).steps.find((s) => s.id === 'affected-frontend');
  assert.equal(step.kind, 'skipped');
  assert.equal(step.cmd, null);
});

test('planSteps: a frontend change whose affected worker tests pass the cap plans the worker parts', () => {
  // frontend/src/lib/money.js is imported by worker services, so its affected tests are worker tests.
  const affected = Array.from({ length: AFFECTED_MAX + 1 }, (_, i) => `cloudflare-worker/test/t${i}.test.ts`);
  const plan = planSteps({ changed: ['frontend/src/lib/money.js'], scripts: SCRIPTS, parts: PARTS, affected });
  assert.equal(plan.steps.find((s) => s.id === 'affected-worker').kind, 'skipped');
  for (const id of ['worker-1-of-2', 'worker-2-of-2', 'frontend-1-of-2']) assert.ok(ids(plan).includes(id), id);
});

test('planSteps: a runner with no parts keeps its affected step over the cap', () => {
  const affected = Array.from({ length: AFFECTED_MAX + 1 }, (_, i) => `scripts/lib/t${i}.test.mjs`);
  const step = planSteps({ changed: ['scripts/lib/x.mjs'], scripts: SCRIPTS, parts: PARTS, affected }).steps.find((s) => s.id === 'affected-scripts');
  assert.equal(step.kind, 'affected');
  assert.equal(step.files.length, AFFECTED_MAX + 1);
});

test('planSteps: meeting-bot/worker is type-checked by the worker tsconfig, so meeting-bot plans types', () => {
  assert.ok(ids(planSteps({ changed: ['meeting-bot/worker/container.ts'], scripts: SCRIPTS, parts: PARTS })).includes('types'));
});

test('chooseSteps: --only adds the suite plan in front of a part; --from starts mid-way; unknown ids are reported', () => {
  const { steps } = planSteps({ changed: ['frontend/src/a.jsx'], scripts: SCRIPTS, parts: PARTS });
  assert.deepEqual(chooseSteps(steps, { only: 'frontend-2-of-2' }).chosen.map((s) => s.id), ['suite-plan', 'frontend-2-of-2']);
  assert.deepEqual(chooseSteps(steps, { only: 'guards,nope' }).unknown, ['nope']);
  assert.deepEqual(chooseSteps(steps, { from: 'frontend-2-of-2' }).chosen.map((s) => s.id), ['suite-plan', 'frontend-2-of-2']);
  assert.deepEqual(chooseSteps(steps, { from: 'missing' }), { chosen: [], unknown: ['missing'] });
});

test('runnerOf and scriptFor map a test file to the script and loader that run it', () => {
  assert.equal(runnerOf(SCRIPTS['test:meeting-bot']).prefix, 'node --experimental-strip-types --no-warnings --test ');
  assert.equal(scriptFor('cloudflare-worker/test/a.test.ts', SCRIPTS), 'test:worker');
  assert.equal(scriptFor('cloudflare-worker/test/a.test.mjs', SCRIPTS), 'test:worker');
  assert.equal(scriptFor('scripts/lib/a.test.mjs', SCRIPTS), 'test:retention');
  assert.equal(scriptFor('frontend/test/sub/a.test.mjs', SCRIPTS), null);
  assert.ok(!globToRegExp('frontend/test/*.test.mjs').test('frontend/test/aXtest.mjs'));
});

test('affectedTests follows imports transitively and includes a changed test', () => {
  const graph = { 't/a.test.mjs': ['src/a.js'], 'src/a.js': ['src/b.js'], 'src/b.js': [], 't/c.test.mjs': ['src/c.js'], 't/loop.test.mjs': ['src/l1.js'], 'src/l1.js': ['src/l2.js'], 'src/l2.js': ['src/l1.js'] };
  const tests = ['t/a.test.mjs', 't/c.test.mjs', 't/loop.test.mjs'];
  assert.deepEqual(affectedTests(['src/b.js'], tests, graph), ['t/a.test.mjs']);
  assert.deepEqual(affectedTests(['t/c.test.mjs'], tests, graph), ['t/c.test.mjs']);
  assert.deepEqual(affectedTests(['src/l2.js'], tests, graph), ['t/loop.test.mjs']);
  assert.deepEqual(affectedTests(['unrelated.md'], tests, graph), []);
});

test('envFailures names the environment failures that are not the PR\'s, and nothing else', () => {
  const code = (log) => envFailures(log).map((e) => e.code);
  assert.deepEqual(code('✖ check-docs-assets-closure: docs/assets/ does not exist.'), ['docs-not-built']);
  assert.deepEqual(code("Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'react' imported from /x"), ['missing-deps']);
  assert.deepEqual(code('sh: 1: eslint: not found'), ['missing-deps']);
  assert.deepEqual(code('sh: 1: cloudflare-worker/node_modules/.bin/tsc: not found'), ['missing-deps']);
  assert.deepEqual(code('Error: spawn age ENOENT'), ['age-missing']);
  assert.deepEqual(code('TypeError: fetch failed'), ['network']);
  assert.deepEqual(code('Error: ENOSPC: no space left on device'), ['disk-full']);
  assert.deepEqual(code('This Worker requires compatibility date "2026-11-08", but the newest date supported by this server binary is "2026-10-26".'), ['workerd-version']);
  assert.deepEqual(code('AssertionError [ERR_ASSERTION]: Expected values to be strictly equal'), []);
  assert.deepEqual(code("Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/repo/frontend/src/x.js'"), []);
});

test('caseCollisions finds module paths that differ only by case, ignoring the extension', () => {
  assert.deepEqual(caseCollisions(['a/WhatsAppWayB.jsx', 'a/whatsappWayB.js', 'a/Other.jsx', 'b/readme.md', 'b/README.md']), [['a/WhatsAppWayB.jsx', 'a/whatsappWayB.js']]);
  assert.deepEqual(caseCollisions(['a/x.js', 'a/y.js']), []);
  assert.deepEqual(caseCollisions(['t/api_drift.test.mjs', 't/api_drift.test.ts']), []);
});

test('preflightNotes warns about old node, missing deps, case collisions only on a case-insensitive disk, and logs in the repo', () => {
  assert.deepEqual(preflightNotes({ nodeMajor: 22 }), []);
  assert.equal(preflightNotes({ nodeMajor: 20 }).length, 1);
  assert.match(preflightNotes({ nodeMajor: 22, missingModules: ['frontend/node_modules'] })[0], /frontend\/node_modules is missing/);
  assert.deepEqual(preflightNotes({ nodeMajor: 22, caseInsensitive: false, collisions: [['a', 'A']] }), []);
  assert.match(preflightNotes({ nodeMajor: 22, caseInsensitive: true, collisions: [['a/X.jsx', 'a/x.js']] })[0], /case-insensitive/);
  assert.match(preflightNotes({ nodeMajor: 22, logDirInRepo: true })[0], /inside the repository/);
});

test('mergeResults keeps earlier results, marks those from another tree stale, and replaces a re-run step', () => {
  const prev = { guards: { id: 'guards', status: 'fail', tree: 't1' }, build: { id: 'build', status: 'pass', tree: 't2' } };
  const out = mergeResults(prev, [{ id: 'guards', status: 'pass' }], 't2');
  assert.deepEqual(out.guards, { id: 'guards', status: 'pass', tree: 't2', stale: false });
  assert.equal(out.build.stale, false);
  assert.equal(mergeResults(prev, [], 't3').build.stale, true);
});

test('testsLine reports current results only, names failures with their env codes and timeouts', () => {
  const results = {
    build: { status: 'pass', stale: false },
    guards: { status: 'fail', stale: false, env: [{ code: 'docs-not-built' }] },
    'worker-3-of-6': { status: 'timeout', stale: false },
    old: { status: 'pass', stale: true },
    'affected-worker': { status: 'skipped', stale: false },
  };
  assert.equal(testsLine(results), 'tests: 1/3 planned steps exit 0 (build); failed: guards [env: docs-not-built]; timed out: worker-3-of-6');
  assert.equal(testsLine(results, ['generated', 'build', 'guards', 'lfs', 'worker-3-of-6']), 'tests: 1/5 planned steps exit 0 (build); failed: guards [env: docs-not-built]; timed out: worker-3-of-6; not run: generated, lfs');
  assert.equal(testsLine({ old: { status: 'pass', stale: true } }), 'tests: none run on this tree');
  assert.equal(testsLine({ old: { status: 'pass', stale: true } }, ['old']), 'tests: none run on this tree (not run: old)');
  const table = renderSummary({ b: { status: 'pass', exit: 0, seconds: 3, log: 'b.log' }, a: { status: 'fail', exit: 1, seconds: 9, log: 'a.log', stale: true } }, ['a', 'b']);
  assert.match(table.split('\n')[0], /^STALE fail\s+a\s/);
  assert.match(table.split('\n')[1], /^pass\s+b\s+exit=0/);
});
