import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { globSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { EXPECTED, mergeTraces } from '../../scripts/ci/merge-test-deps.mjs';

const tracer = new URL('../../scripts/ci/test-tracer.mjs', import.meta.url);

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'test-tracer-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'listed'));
  mkdirSync(join(root, 'node_modules'));
  for (const name of ['listed/input.txt', 'child.txt', 'node_modules/ignored.txt']) {
    writeFileSync(join(root, name), 'fixture');
  }
  writeFileSync(join(root, 'module.mjs'), 'export default 1;');
  writeFileSync(join(root, 'fixture.test.mjs'), `
    import assert from 'node:assert/strict';
    import { execFile, spawnSync } from 'node:child_process';
    import { existsSync, globSync, readFileSync, readdirSync } from 'node:fs';
    import { stat } from 'node:fs/promises';
    import { DatabaseSync } from 'node:sqlite';
    import test from 'node:test';
    import { promisify } from 'node:util';
    test('reads dependencies', async () => {
      readFileSync('listed/input.txt');
      readFileSync('node_modules/ignored.txt');
      readdirSync('listed');
      globSync('missing-dir/*.txt');
      assert.equal(existsSync('missing.txt'), false);
      await stat('listed/input.txt');
      await assert.rejects(stat('also-missing.txt'));
      await import('./module.mjs');
      const db = new DatabaseSync('local.db');
      db.close();
      const { stdout, stderr } = await promisify(execFile)(process.execPath, ['-e',
        "require('node:fs').readFileSync('../child.txt'); console.log('ok')"], { cwd: 'listed', env: {} });
      assert.equal(stdout.trim(), 'ok');
      assert.equal(stderr, '');
      assert.equal(spawnSync('/bin/sh', ['-c', 'true']).status, 0);
    });
  `);
  return root;
}

function run(root, trace) {
  const env = { ...process.env, NODE_OPTIONS: `--import=${tracer.href}` };
  for (const key of ['TEST_TRACE_DIR', 'TEST_TRACE_ROOT', 'TEST_TRACE_TEST', 'NODE_TEST_CONTEXT']) delete env[key];
  if (trace) env.TEST_TRACE_DIR = 'traces';
  const result = spawnSync('/bin/sh', ['-c', 'exec "$@"', 'sh', process.execPath, '--no-warnings', '--test', 'fixture.test.mjs'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

test('preload is inert without a trace directory', (t) => {
  const root = fixture(t);
  run(root, false);
  assert.ok(!readdirSync(root).includes('traces'));
});

test('captures reads, lists, probes, module and SQLite opens, and children without tracing the parent', (t) => {
  const root = fixture(t);
  run(root, true);
  const traces = readdirSync(join(root, 'traces')).map((name) => JSON.parse(readFileSync(join(root, 'traces', name))));
  assert.equal(traces.length, 2);
  const [parent, child] = [traces.find((r) => r.isTest), traces.find((r) => !r.isTest)];
  assert.equal(parent.test, 'fixture.test.mjs');
  assert.equal(parent.exitCode, 0);
  assert.ok(parent.wallMs > 0);
  assert.ok(parent.reads.includes('listed/input.txt'));
  assert.ok(!parent.reads.some((path) => path.includes('node_modules')));
  assert.ok(parent.directories.includes('listed'));
  assert.ok(parent.directories.includes('missing-dir'));
  assert.ok(parent.probes.hits.includes('listed/input.txt'));
  assert.ok(parent.probes.misses.includes('missing.txt'));
  assert.ok(parent.probes.misses.includes('also-missing.txt'));
  assert.ok(parent.modules.includes('module.mjs'));
  assert.ok(parent.sqlite.includes('local.db'));
  assert.ok(parent.children.includes('sh'));
  assert.equal(parent.opaque, true);
  assert.equal(child.test, parent.test);
  assert.ok(child.reads.includes('child.txt'));
});

test('merge is byte-stable and marks tests without a top-level trace as untraced', () => {
  const row = {
    test: 'b.test.mjs', isTest: true, wallMs: 12, exitCode: 0, opaque: false,
    reads: ['b', 'a'], directories: [], modules: [], sqlite: [], children: [],
    probes: { hits: [], misses: ['missing'] },
  };
  const child = { ...row, isTest: false, reads: ['c'], opaque: true, wallMs: 99 };
  const expected = ['b.test.mjs', 'a.test.mjs'];
  const meta = { sha: 'a'.repeat(40), node: 'v22' };
  const merged = mergeTraces([row, child], expected, meta);
  assert.equal(JSON.stringify(merged), JSON.stringify(mergeTraces([child, row], [...expected].reverse(), meta)));
  assert.deepEqual(merged.dependencies.tests['b.test.mjs'].reads, ['a', 'b', 'c']);
  assert.equal(merged.dependencies.tests['b.test.mjs'].opaque, true);
  assert.equal(merged.timings.tests['b.test.mjs'].wallMs, 12);
  assert.deepEqual(merged.timings.untraced, ['a.test.mjs']);
});

test('merge CLI reads process traces from separate shard artifact directories', (t) => {
  const root = fixture(t);
  for (const [shard, read, isTest] of [['first', 'a', true], ['second', 'b', false]]) {
    const directory = join(root, 'shards', shard);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'process.trace.json'), JSON.stringify({
      test: 'fixture.test.mjs', isTest, wallMs: 12, exitCode: 0, opaque: false,
      reads: [read], directories: [], modules: [], sqlite: [], children: [],
      probes: { hits: [], misses: [] },
    }));
  }
  const merger = fileURLToPath(new URL('../../scripts/ci/merge-test-deps.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [merger, 'shards', 'output', 'a'.repeat(40)], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(readFileSync(join(root, 'output', 'test-deps.json'), 'utf8'));
  assert.deepEqual(report.tests['fixture.test.mjs'].reads, ['a', 'b']);
  assert.equal(report.tests['fixture.test.mjs'].opaque, false);
});

// ── D5608: the ci.yml wiring ───────────────────────────────────────────────
const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
/** One top-level job's text, from `  <id>:` to the next job. */
function job(id) {
  const lines = ci.split('\n');
  const start = lines.findIndex((l) => l === `  ${id}:`);
  assert.ok(start > 0, `ci.yml has a job ${id}`);
  let end = lines.findIndex((l, i) => i > start && /^ {2}[a-z][\w-]*:$/.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(start, end).join('\n');
}
const ONLY_QUEUE_AND_MAIN = "(github.event_name == 'merge_group' || github.event_name == 'push' && github.ref == 'refs/heads/main')";

test('ci.yml: the suite step traces only under merge_group and push, and its run line is unchanged', () => {
  const suite = job('suite');
  const step = suite.match(/ {6}- run: node scripts\/test-drift-parts\.mjs \$\{\{ matrix\.part \}\} --plan-file suite-plan\.json\n {8}env:\n(?: {10}CI_FAILURE_[A-Z]+: .+\n)* {10}TEST_TRACE_DIR: (.+)\n/);
  assert.ok(step, 'the test-drift-parts step keeps its run line and sets TEST_TRACE_DIR as env');
  assert.equal(step[1], `\${{ ${ONLY_QUEUE_AND_MAIN} && format('{0}/test-traces', runner.temp) || '' }}`);
  assert.equal((ci.match(/TEST_TRACE_DIR/g) || []).length, 1, 'no other step or job sets the tracer');
});

test('ci.yml: each part uploads its traces even when it failed, only under merge_group and push', () => {
  const suite = job('suite');
  const upload = suite.slice(suite.indexOf("- name: Upload this part's test traces"));
  assert.ok(upload.includes(`\n        if: always() && ${ONLY_QUEUE_AND_MAIN}\n`), 'the upload runs even after a failed part, on the queue and main only');
  assert.match(upload, /name: test-traces-\$\{\{ matrix\.part \}\}/);
  assert.match(upload, /path: \$\{\{ runner\.temp \}\}\/test-traces/);
  assert.match(upload, /continue-on-error: true/);
});

test('ci.yml: test-deps merges after the suite, uploads test-deps-<sha> for 30 days, and no gate waits on it', () => {
  const deps = job('test-deps');
  assert.match(deps, /\n {4}needs: suite\n/);
  assert.ok(deps.includes(`\n    if: always() && ${ONLY_QUEUE_AND_MAIN} && needs.suite.result != 'skipped'\n`), 'test-deps runs on the queue and main only, after a suite that ran');
  assert.match(deps, /pattern: test-traces-\*/);
  assert.match(deps, /node scripts\/ci\/merge-test-deps\.mjs "\$RUNNER_TEMP\/test-traces" "\$RUNNER_TEMP\/test-deps" "\$GITHUB_SHA"/);
  assert.match(deps, /name: test-deps-\$\{\{ github\.sha \}\}/);
  assert.match(deps, /test-deps\.json\n\s+\$\{\{ runner\.temp \}\}\/test-deps\/test-timings\.json/);
  assert.match(deps, /retention-days: 30\n/);
  for (const gate of ['landing', 'gate']) {
    const needs = job(gate).match(/\n {4}needs: \[([^\]]*)\]/);
    assert.ok(needs, `${gate} lists its needs`);
    assert.ok(!needs[1].split(',').map((n) => n.trim()).includes('test-deps'), `${gate} must not need test-deps: its failure cannot block`);
  }
  // No other job waits on it either, so a failed merge only loses the artifact.
  assert.equal((ci.match(/needs:[^\n]*test-deps/g) || []).length, 0);
});

test('the tracer observes modules off-thread, never with a synchronous registerHooks hook', () => {
  // With a synchronous hook in the test process, even one that passed every call
  // through, data_room_d696 test 11 rendered the tool instead of the module page
  // under _deck-loader.mjs's async hooks, and the merge queue ejected #6904.
  const source = readFileSync(fileURLToPath(tracer), 'utf8');
  assert.doesNotMatch(source.replace(/\/\/.*$/gm, ''), /registerHooks\s*\?*\.?\(/);
  assert.match(source, /modules\.register\(new URL\('\.\/test-tracer-hooks\.mjs'/);
});

test('the merger expects every test file the package scripts run under node --test', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts;
  const globs = [...new Set(Object.values(scripts).flatMap((cmd) => [...cmd.matchAll(/--test '([^']+)'/g)].map((m) => m[1])))];
  assert.ok(globs.length >= 5, `found ${globs.length} --test globs`);
  const expected = new Set(globSync(EXPECTED, { cwd: root }));
  for (const glob of globs) {
    const files = globSync(glob, { cwd: root });
    assert.ok(files.length > 0, `${glob} matches no file`);
    const missing = files.filter((file) => !expected.has(file));
    assert.deepEqual(missing, [], `${glob} is not in merge-test-deps EXPECTED`);
  }
});
