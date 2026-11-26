// D8694 (#8694): the CI coverage matrix's --check fails a source folder or a
// test-running job with no row, a row naming a missing job, file or issue, a map
// out of key order and a stale page; the real repository's page is current.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { main, mayRun, whenOf, requiredName, sourceFolders, ROOT, PAGE, DATA } from '../../scripts/ci/coverage-matrix.mjs';
import { REQUIRED } from '../../scripts/lib/requiredChecks.mjs';

const REQ = Object.freeze({ 'test:drift (full suite)': 'ci.yml', 'worker (typecheck)': 'ci.yml' });

const CI = `name: CI
on:
  push:
    branches: [main]
  pull_request:
  merge_group:
jobs:
  worker:
    name: worker (typecheck)
    runs-on: ubuntu-latest
    steps:
      - run: npx tsc --noEmit
  suite:
    name: suite (\${{ matrix.part }})
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/test-drift-parts.mjs \${{ matrix.part }} --plan-file suite-plan.json
  gate:
    name: \${{ github.event_name == 'pull_request' && 'draft' || 'test:drift (full suite)' }}
    needs: [suite]
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
  visual:
    if: github.event_name != 'merge_group'
    runs-on: ubuntu-latest
    steps:
      - run: npx --no-install playwright test
`;

function data() {
  return {
    folders: {
      'cloudflare-worker': { checks: ['ci.yml#worker', 'suite:test:worker'], gaps: [] },
      frontend: { checks: ['ci.yml#visual', 'guard:check-x', 'suite:test:frontend'], gaps: ['#8524'] },
      scripts: { checks: ['suite:test:guards'], gaps: [] },
    },
    issues: { '#8524': 'eSign browser journey' },
    jobs: { 'ci.yml#visual': 'browser', 'ci.yml#worker': 'unit' },
    services: {
      esign: { checks: ['suite:test:worker'], gaps: ['#8524'], name: 'eSign', tests: ['cloudflare-worker/test/esign*.test.ts'] },
    },
  };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'coverage-8694-'));
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  put('CLAUDE.md', '# x\n\n## File map\n\n| Path | Role |\n| --- | --- |\n| `frontend/` | SPA |\n| `cloudflare-worker/` | API |\n\n## Rules\n\n| `ignored/` | not the map |\n');
  put('package.json', JSON.stringify({ scripts: {
    'test:frontend': "node --test 'frontend/test/*.test.mjs'",
    'test:worker': "node --test 'cloudflare-worker/test/*.test.ts'",
    'test:guards': 'node scripts/run-guards.mjs',
    'test:drift': 'npm run test:frontend && npm run test:worker && npm run test:guards',
  } }));
  put('scripts/guard-commands.json', JSON.stringify([{ id: 'check-x', command: ['node', 'x.mjs'] }, { id: 'off', command: ['node', 'y.mjs'], full: false }]));
  put('.github/workflows/ci.yml', CI);
  put('frontend/test/a.test.mjs', '');
  put('cloudflare-worker/test/esign_a.test.ts', '');
  put(DATA, JSON.stringify(data(), null, 2));
  mkdirSync(join(root, dirname(PAGE)), { recursive: true });
  const run = args => { const errors = []; const code = main(args, { root, required: REQ, log() {}, error: e => errors.push(e) }); return { code, errors }; };
  { const r = run([]); assert.equal(r.code, 0, r.errors.join('\n')); }
  return { root, put, run, setData: d => put(DATA, JSON.stringify(d, null, 2)), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('a fixture whose map matches its repository passes --check', () => {
  const f = fixture();
  try {
    assert.deepEqual(f.run(['--check']), { code: 0, errors: [] });
    const page = readFileSync(join(f.root, PAGE), 'utf8');
    assert.match(page, /\| `frontend\/` \| suite › `test:frontend`<br>suite › `test:guards` › `check-x`<br>`ci\.yml` › visual \|/);
    assert.match(page, /\| pull request, merge queue, push to main<br>pull request, merge queue, push to main<br>pull request, push to main \|/);
    assert.match(page, /\| isolated browser \| #8524 \|/);
    assert.match(page, /\| `cloudflare-worker\/` \|.*\| yes, in `test:drift \(full suite\)`<br>yes, `worker \(typecheck\)` \| unit and contract \| none filed \|/);
    assert.match(page, /\| `test:drift \(full suite\)` \| `ci\.yml#gate` \|/);
  } finally { f.cleanup(); }
});

test('--check fails a top-level source folder with no row', () => {
  const f = fixture();
  try {
    f.put('relay/wrangler.jsonc', '{}');
    const r = f.run(['--check']);
    assert.equal(r.code, 1);
    assert.deepEqual(r.errors, ['coverage-matrix: relay/ is a top-level source folder with no row']);
    const d = data(); d.folders = Object.fromEntries(Object.entries({ ...d.folders, relay: { checks: [], gaps: [] } }).sort());
    f.setData(d);
    f.put('CLAUDE.md', readFileSync(join(f.root, 'CLAUDE.md'), 'utf8').replace('| `cloudflare-worker/` | API |', '| `cloudflare-worker/` | API |\n| `vault/` | only in the file map |'));
    assert.deepEqual(f.run(['--check']).errors, ['coverage-matrix: vault/ is a top-level source folder with no row'], 'a file-map folder with no row');
  } finally { f.cleanup(); }
});

test('--check fails a row naming a job that does not exist', () => {
  const f = fixture();
  try {
    const d = data(); d.folders.frontend.checks = ['ci.yml#vizual', 'guard:check-x', 'suite:test:frontend']; d.jobs = { 'ci.yml#vizual': 'browser', 'ci.yml#worker': 'unit' };
    f.setData(d);
    const r = f.run(['--check']);
    assert.equal(r.code, 1);
    assert.ok(r.errors.includes('coverage-matrix: folders.frontend: "ci.yml#vizual" names a job that does not exist'), r.errors.join('\n'));
    assert.ok(r.errors.includes('coverage-matrix: ci.yml#visual runs tests and no row names it'), 'the real job is now unnamed');
  } finally { f.cleanup(); }
});

test('--check fails a stale page', () => {
  const f = fixture();
  try {
    const page = join(f.root, PAGE);
    writeFileSync(page, readFileSync(page, 'utf8').replace('none filed', 'nothing'));
    const r = f.run(['--check']);
    assert.equal(r.code, 1);
    assert.deepEqual(r.errors, [`coverage-matrix: ${PAGE} is stale. Run node scripts/ci/coverage-matrix.mjs and commit the result.`]);
    f.put('.github/workflows/ci.yml', CI.replace("if: github.event_name != 'merge_group'", "if: github.event_name != 'push'"));
    assert.equal(f.run([]).code, 0);
    assert.equal(f.run(['--check']).code, 0, 'rewriting makes it current');
  } finally { f.cleanup(); }
});

test('--check fails a test-running workflow with no row, and a missing suite step, guard, file or issue', () => {
  const f = fixture();
  try {
    f.put('.github/workflows/extra.yml', 'on: pull_request\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node --test scripts/a.mjs\n  u:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node scripts/x.test.mjs\n');
    assert.deepEqual(f.run(['--check']).errors, ['coverage-matrix: extra.yml#t runs tests and no row names it', 'coverage-matrix: extra.yml#u runs tests and no row names it']);
    f.put('.github/workflows/extra.yml', 'on: pull_request\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node scripts/build.mjs\n');
    const d = data();
    d.services.esign.checks = ['guard:off', 'suite:test:nope'];
    d.services.esign.tests = ['cloudflare-worker/test/sign*.test.ts'];
    d.services.esign.gaps = ['#9999'];
    f.setData(d);
    const errors = f.run(['--check']).errors;
    for (const want of [
      'services.esign: "guard:off" is not a guard test:guards runs',
      'services.esign: "suite:test:nope" is not a step of test:drift',
      'services.esign: "cloudflare-worker/test/sign*.test.ts" matches no file',
      'services.esign: gap #9999 is not in "issues"',
    ]) assert.ok(errors.includes(`coverage-matrix: ${want}`), `${want}\n${errors.join('\n')}`);
  } finally { f.cleanup(); }
});

test('--check fails a map or a list out of key order (D4134)', () => {
  const f = fixture();
  try {
    const d = data(); d.folders = { frontend: d.folders.frontend, 'cloudflare-worker': d.folders['cloudflare-worker'], scripts: d.folders.scripts };
    f.setData(d);
    assert.deepEqual(f.run(['--check']).errors, [`coverage-matrix: ${DATA}: "folders" is not in key order (D4134)`]);
    const e = data(); e.folders.frontend.checks = ['suite:test:frontend', 'ci.yml#visual', 'guard:check-x'];
    f.setData(e);
    assert.deepEqual(f.run(['--check']).errors, ['coverage-matrix: folders.frontend: "checks" is not in key order (D4134)']);
  } finally { f.cleanup(); }
});

test('a job condition leaves out only the events it rules out', () => {
  assert.equal(mayRun("github.event_name != 'merge_group'", 'merge_group'), false);
  assert.equal(mayRun("github.event_name != 'merge_group'", 'push'), true);
  assert.equal(mayRun("${{ (github.event_name == 'schedule' && x) || (github.event_name == 'workflow_dispatch' && y) }}", 'push'), false);
  assert.equal(mayRun("${{ (github.event_name == 'schedule' && x) || (github.event_name == 'workflow_dispatch' && y) }}", 'workflow_dispatch'), true);
  assert.equal(mayRun("github.event_name != 'merge_group' && (github.event_name != 'pull_request' || !draft)", 'pull_request'), true);
  assert.equal(mayRun("vars.X == 'true'", 'merge_group'), true);
  const wf = { events: { push: { branches: ['bench/**'] }, pull_request: { paths: ['a/**'] } } };
  assert.deepEqual(whenOf(wf, { if: undefined }), ['pull request (paths)', 'push, not to main']);
  assert.equal(requiredName('ci.yml', { name: "${{ a && 'x' || 'test:drift (full suite)' }}" }, REQ), 'test:drift (full suite)');
  assert.equal(requiredName('other.yml', { name: 'worker (typecheck)' }, REQ), null);
});

test('the repository\'s page is current, lists every required check, and runs in test:guards', () => {
  const errors = [];
  assert.equal(main(['--check'], { log() {}, error: e => errors.push(e) }), 0, errors.join('\n'));
  const page = readFileSync(join(ROOT, PAGE), 'utf8');
  for (const check of Object.keys(REQUIRED)) assert.ok(page.includes(`| \`${check}\` |`), check);
  const guards = JSON.parse(readFileSync(join(ROOT, 'scripts/guard-commands.json'), 'utf8'));
  assert.ok(guards.some(g => g.command.join(' ') === 'node scripts/ci/coverage-matrix.mjs --check' && g.full !== false));
  const folders = sourceFolders(ROOT, JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts);
  for (const folder of ['frontend', 'cloudflare-worker', 'cloudflare-worker/sql', 'backend', 'meeting-bot']) assert.ok(folders.includes(folder), folder);
});
