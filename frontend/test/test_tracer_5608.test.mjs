import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { mergeTraces } from '../../scripts/ci/merge-test-deps.mjs';

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
