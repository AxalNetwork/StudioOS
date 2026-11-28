/**
 * #9035 — scripts/check-test-collection.mjs: every test file and browser spec is run by a
 * package.json suite, a named workflow step, or a run test that imports or starts it, or is
 * listed in scripts/baselines/test-collection.json with a reason. A synthetic repository
 * exercises each way of being run, and each way the list goes stale.
 *
 *   node --test frontend/test/test_collection_9035.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect, compare, listFiles, main, isTestFile, LIST } from '../../scripts/check-test-collection.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const WORKFLOW = `name: synthetic
on: push
permissions: {}
jobs:
  unit:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Named node test
        run: node --test scripts/ci/named.test.mjs
      - name: Python discovery
        run: python -m unittest discover -s scripts -p test_gate.py
      - name: An npm script
        run: npm run test:py
      - name: Named spec after cd
        run: |
          cd frontend
          npx --no-install playwright test tests/e2e/named.spec.js --retries=0
  visual:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    defaults:
      run:
        working-directory: frontend
    steps:
      - name: Whole visual config
        run: npx --no-install playwright test -c tests/visual/pw.config.mjs
`;

const BASE = {
  'package.json': JSON.stringify({ scripts: { 'test:frontend': "node --test 'frontend/test/*.test.mjs'", 'test:py': 'cd scripts && python3 -m unittest discover -p test_npm.py' } }),
  'frontend/package.json': JSON.stringify({ scripts: { 'test:e2e': 'playwright test' } }),
  'frontend/playwright.config.js': "export default { testDir: './tests/e2e' };\n",
  'frontend/tests/visual/pw.config.mjs': "export default { testDir: '.', testMatch: /.*\\.spec\\.mjs$/ };\n",
  'frontend/tests/visual/page.spec.mjs': '// synthetic spec\n',
  'frontend/tests/e2e/named.spec.js': '// synthetic spec\n',
  'frontend/tests/e2e/other.spec.js': '// synthetic spec, run by nothing\n',
  'frontend/test/wrapper.test.mjs': "// scripts/test_commented.py is only cited here, with python in the comment\nimport '../../scripts/ci/wrapped.test.mjs';\n",
  'frontend/test/spawn.test.mjs': "import { spawnSync } from 'node:child_process';\nspawnSync('python3', ['scripts/test_spawned.py']);\n",
  'scripts/ci/wrapped.test.mjs': '// synthetic\n',
  'scripts/ci/named.test.mjs': '// synthetic\n',
  'scripts/test_gate.py': '# synthetic\n',
  'scripts/test_npm.py': '# synthetic\n',
  'scripts/test_spawned.py': '# synthetic\n',
  'scripts/test_commented.py': '# synthetic\n',
  '.github/workflows/unit.yml': WORKFLOW,
};
const LISTED = {
  'frontend/tests/e2e/other.spec.js': 'synthetic: needs a preview',
  'scripts/test_commented.py': 'synthetic: only a comment names it',
};

const inOrder = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
function fixture(extra = {}, files = LISTED, ordered = true) {
  const root = mkdtempSync(join(tmpdir(), 'test-collection-9035-'));
  const all = { ...BASE, [LIST]: JSON.stringify({ files: ordered ? inOrder(files) : files }), ...extra };
  for (const [p, body] of Object.entries(all)) {
    if (body == null) continue;
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), body);
  }
  return root;
}
function check(extra, files, ordered) {
  const root = fixture(extra, files, ordered);
  try {
    const { tests, how } = collect(root, listFiles(root));
    const list = JSON.parse(readFileSync(join(root, LIST), 'utf8'));
    return { how, ...compare(tests, how, list), code: quiet(() => main(root)) };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
function quiet(fn) {
  const { log, error } = console;
  console.log = console.error = () => {};
  try { return fn(); } finally { console.log = log; console.error = error; }
}

test('names test files by pattern: JS/TS test and spec files, Python test_*.py and *_test.py', () => {
  for (const f of ['a/b.test.mjs', 'a/b.spec.ts', 'a/b.visual.spec.js', 'a/test_x.py', 'a/x_test.py', 'a/b.test.tsx']) assert.ok(isTestFile(f), f);
  for (const f of ['a/b.fixture.mjs', 'a/_helpers.js', 'a/conftest.py', 'a/testing.py', 'a/__screenshots__/b.spec.mjs/x.png']) assert.ok(!isTestFile(f), f);
});

test('the synthetic repository passes: every way of being run is recognised, and the list holds the rest', () => {
  const r = check();
  assert.deepEqual(r.errors, []);
  assert.equal(r.code, 0);
  assert.match(r.how.get('frontend/test/wrapper.test.mjs'), /^package\.json test:frontend$/);
  assert.match(r.how.get('scripts/ci/wrapped.test.mjs'), /^imported by frontend\/test\/wrapper\.test\.mjs$/);
  assert.match(r.how.get('scripts/ci/named.test.mjs'), /unit\.yml › unit › Named node test/);
  assert.match(r.how.get('scripts/test_gate.py'), /Python discovery/);
  assert.match(r.how.get('scripts/test_npm.py'), /An npm script/);
  assert.match(r.how.get('scripts/test_spawned.py'), /^started by frontend\/test\/spawn\.test\.mjs$/);
  assert.match(r.how.get('frontend/tests/e2e/named.spec.js'), /Named spec after cd/);
  assert.match(r.how.get('frontend/tests/visual/page.spec.mjs'), /visual › Whole visual config/);
  assert.deepEqual(r.unrun, ['frontend/tests/e2e/other.spec.js', 'scripts/test_commented.py']);
});

test('a new scripts/ci test with no runner and no reason fails, naming the file', () => {
  const r = check({ 'scripts/ci/x.test.mjs': '// synthetic, run by nothing\n' });
  assert.equal(r.code, 1);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^scripts\/ci\/x\.test\.mjs is run by no package\.json suite, workflow step or run test/);
});

test('a new frontend/tests/e2e spec with no runner and no reason fails, naming the file', () => {
  const r = check({ 'frontend/tests/e2e/x.spec.js': '// synthetic, run by nothing\n' });
  assert.equal(r.code, 1);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^frontend\/tests\/e2e\/x\.spec\.js is run by no/);
});

test('a listed file that no longer exists fails as stale', () => {
  const r = check({}, { ...LISTED, 'scripts/ci/gone.test.mjs': 'synthetic: deleted since' });
  assert.equal(r.code, 1);
  assert.deepEqual(r.errors, [`${LIST}: stale entry "scripts/ci/gone.test.mjs": no such test file any more — delete the entry`]);
});

test('a listed file that is now run fails as stale, saying what runs it', () => {
  const r = check({}, { ...LISTED, 'scripts/ci/wrapped.test.mjs': 'synthetic: was unrun' });
  assert.equal(r.code, 1);
  assert.deepEqual(r.errors, [`${LIST}: stale entry "scripts/ci/wrapped.test.mjs": now run (imported by frontend/test/wrapper.test.mjs) — delete the entry`]);
});

test('the list is kept in key order and every entry has a reason', () => {
  const unordered = { 'scripts/test_commented.py': LISTED['scripts/test_commented.py'], 'frontend/tests/e2e/other.spec.js': LISTED['frontend/tests/e2e/other.spec.js'] };
  const r = check({}, unordered, false);
  assert.equal(r.code, 1);
  assert.deepEqual(r.errors, [`${LIST}: "scripts/test_commented.py" is out of key order (D4134); insert each entry at its place`]);
  const blank = check({}, { ...LISTED, 'scripts/test_commented.py': ' ' });
  assert.deepEqual(blank.errors, [`${LIST}: "scripts/test_commented.py" has no reason`]);
});

test('the repository passes, and the four files #9035 wired in are run', () => {
  assert.equal(quiet(() => main(ROOT)), 0);
  const { how } = collect(ROOT, listFiles(ROOT));
  assert.equal(how.get('scripts/ci/queue-capacity-audit-8013.test.mjs'), 'imported by frontend/test/queue_capacity_audit_8013.test.mjs');
  for (const py of ['scripts/test_fund_lp_flags.py', 'scripts/test_import_research_funds.py', 'backend/test_deals_scope.py']) {
    assert.equal(how.get(py), 'started by frontend/test/script_python_tests_9035.test.mjs', py);
  }
});
