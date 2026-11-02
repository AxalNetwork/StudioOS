// D4130 (#4130): CI runs `npm run test:drift` in parallel parts. Splitting the
// suite must not drop a step or a test file, so this holds the parts to the
// suite itself:
//   - every step of package.json's test:drift is in exactly one part;
//   - a sharded script's parts are the same command with --test-shard=i/N,
//     for every i from 1 to N, and nothing else changed;
//   - ci.yml's matrix lists exactly these parts, and the job runs each one.
//
// Run with:
//   node --test frontend/test/ci_suite_parts_4130.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { partsOf, shardCommand, SHARDS, REST } from '../../scripts/test-drift-parts.mjs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const parts = partsOf(pkg.scripts);
const steps = pkg.scripts['test:drift'].split(' && ').map((s) => s.trim());

const SHARD_FLAG = / --test-shard=(\d+)\/(\d+)(?= )/;

test('every step of test:drift is in exactly one part, and the parts add nothing', () => {
  const covered = [];
  for (const p of parts) {
    if (p.name === REST) { covered.push(...p.commands); continue; }
    assert.equal(p.commands.length, 1, `${p.name} is one sharded command`);
  }
  for (const script of Object.keys(SHARDS)) covered.push(`npm run ${script}`);
  assert.deepEqual([...covered].sort(), [...steps].sort(), 'the parts are the suite: no step dropped, none added, none twice');
  const rest = parts.find((p) => p.name === REST);
  assert.deepEqual(rest.commands, steps.filter((s) => !Object.keys(SHARDS).some((k) => s === `npm run ${k}`)), 'rest keeps the suite\'s order');
});

test('a sharded script runs as N shards, 1 to N, each the unchanged command plus the shard flag', () => {
  for (const [script, n] of Object.entries(SHARDS)) {
    assert.ok(Number.isInteger(n) && n >= 2, `${script} is cut into at least two shards`);
    const mine = parts.filter((p) => p.name.startsWith(`${script.replace(/^test:/, '')}-`));
    assert.equal(mine.length, n);
    const seen = [];
    for (const p of mine) {
      const [cmd] = p.commands;
      const m = SHARD_FLAG.exec(cmd);
      assert.ok(m, `${p.name} carries --test-shard`);
      assert.equal(Number(m[2]), n, `${p.name} shards out of ${n}`);
      seen.push(Number(m[1]));
      assert.equal(cmd.replace(SHARD_FLAG, ''), pkg.scripts[script], `${p.name} is ${script} with only the shard flag added`);
      assert.match(cmd, / --test --test-shard=/, 'the flag sits right after --test');
    }
    assert.deepEqual(seen.sort((a, b) => a - b), Array.from({ length: n }, (_, i) => i + 1), `${script}: every shard 1..${n}, once`);
  }
});

test('part names are unique', () => {
  const names = parts.map((p) => p.name);
  assert.equal(new Set(names).size, names.length);
});

test('a command the script cannot cut safely is refused, not guessed', () => {
  assert.throws(() => shardCommand("node --test 'a/*.mjs' && echo x", 1, 2), /compound/);
  assert.throws(() => shardCommand('node --test --test-shard=1/2 a.mjs', 1, 2), /already sharded/);
  assert.throws(() => shardCommand('node a.mjs', 1, 2), /exactly one --test/);
  assert.throws(() => partsOf({ 'test:drift': 'npm run test:guards' }, { 'test:frontend': 2 }), /does not run/);
  assert.throws(() => partsOf({ 'test:drift': 'npm run test:x' }, { 'test:x': 2 }), /does not define/);
  assert.throws(() => partsOf({ 'test:drift': 'npm run test:x && npm run test:x', 'test:x': 'node --test a' }, { 'test:x': 2 }), /twice/);
});

test('ci.yml\'s suite matrix lists exactly these parts and runs each one', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8').split('\n').filter((l) => !/^\s*#/.test(l));
  const at = ci.findIndex((l) => l === '  suite:');
  assert.ok(at > 0, 'ci.yml has the suite job');
  const end = ci.findIndex((l, i) => i > at && /^ {2}\S/.test(l));
  const job = ci.slice(at, end);
  const m = job.findIndex((l) => l.trim() === 'part:');
  const listed = [];
  for (const l of job.slice(m + 1)) {
    const item = /^ {10}- (\S+)\s*$/.exec(l);
    if (!item) break;
    listed.push(item[1]);
  }
  assert.deepEqual(listed, parts.map((p) => p.name), 'the matrix is the parts, in order — update one with the other');
  assert.ok(job.some((l) => l.trim() === '- run: node scripts/test-drift-parts.mjs ${{ matrix.part }}'), 'each matrix leg runs its part');
});
