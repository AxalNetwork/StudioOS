// D4130/D5609: one generated plan covers the full suite exactly once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { partsOf, testCommand, suiteFiles, buildPlan, validatePlan, timingsOf, SHARDS, REST } from '../../scripts/test-drift-parts.mjs';
import { assertExactOnce } from '../../scripts/lib/shardPlan.mjs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const plan = buildPlan(pkg.scripts);

test('every test:drift step appears once; rest retains order', () => {
  const steps = pkg.scripts['test:drift'].split(' && ');
  const rest = plan.parts.find((p) => p.name === REST);
  assert.deepEqual(rest.commands, steps.filter((s) => !Object.keys(SHARDS).some((k) => s === `npm run ${k}`)));
  assert.deepEqual([...rest.commands, ...Object.keys(SHARDS).map((k) => `npm run ${k}`)].sort(), [...steps].sort());
});

test('real tree glob expansion and every generated file list cover the same files exactly once', () => {
  for (const [script, count] of Object.entries(SHARDS)) {
    const parts = plan.parts.filter((p) => p.script === script);
    assert.equal(parts.length, count);
    assertExactOnce(parts, suiteFiles(pkg.scripts[script]));
    for (const part of parts) {
      assert.doesNotMatch(part.commands[0], /--test-shard|\*/);
      assert.ok(part.commands[0].startsWith(testCommand(pkg.scripts[script]).prefix));
      assert.equal(testCommand(part.commands[0]).patterns.length, part.files.length);
    }
  }
  assert.equal(JSON.stringify(plan), JSON.stringify(buildPlan(pkg.scripts)));
  assert.equal(new Set(plan.parts.map((p) => p.name)).size, plan.parts.length);
  assert.equal(validatePlan(plan, pkg.scripts).length, plan.parts.length);
  const misplaced = structuredClone(plan);
  misplaced.parts[0].script = 'test:worker';
  assert.throws(() => validatePlan(misplaced, pkg.scripts), /names\/scripts/);
  for (const mutation of ['drop', 'repeat', 'extra']) {
    const bad = structuredClone(plan);
    if (mutation === 'drop') bad.parts[0].files.pop();
    if (mutation === 'repeat') bad.parts[0].files.push(bad.parts[0].files[0]);
    if (mutation === 'extra') bad.parts[0].files.push('extra.test.mjs');
    assert.throws(() => validatePlan(bad, pkg.scripts), /missing|repeated|extra/);
  }
});

test('Node 22 globSync agrees with node --test glob expansion on a temporary tree', () => {
  const root = mkdtempSync(join(tmpdir(), 's38-glob-'));
  try {
    for (const f of ['a.test.mjs', 'b.test.mjs']) writeFileSync(join(root, f), `import test from 'node:test'; test('${f}', () => {});`);
    const cmd = "node --test '*.test.mjs'";
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '*.test.mjs'], { cwd: root, encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
    for (const f of suiteFiles(cmd, root)) assert.ok(r.stdout.includes(`# Subtest: ${f}`), JSON.stringify(r.stdout));
    assert.match(r.stdout, /# tests 2\b/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('unsafe commands and missing plan fail closed', () => {
  for (const cmd of ['node --test a && echo x', 'node --test --test-shard=1/2 a', 'node a']) assert.throws(() => testCommand(cmd));
  assert.throws(() => partsOf({ 'test:drift': 'npm run test:guards' }, { 'test:x': 2 }), /does not run/);
  const r = spawnSync(process.execPath, ['scripts/test-drift-parts.mjs', plan.parts[0].name], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /requires --plan-file/);
});

test('both workflow matrices consume only generated names and the gate requires a successful plan', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  const alerts = readFileSync('.github/workflows/github-alerts.yml', 'utf8');
  for (const wf of [ci, alerts]) assert.doesNotMatch(wf, /(?:frontend|worker)-\d+-of-\d+/);
  assert.match(ci, /part: \$\{\{ fromJSON\(needs\.plan\.outputs\.parts\) \}\}/);
  assert.match(ci, /needs: \[verified, plan, suite\]/);
  assert.match(ci, /if \[ "\$PLAN" = "success" \] && \[ "\$SUITE" = "success" \]/);
  assert.match(ci, /--plan-file suite-plan\.json/);
  assert.match(alerts, /part: \$\{\{ fromJSON\(needs\.future-clock-plan\.outputs\.parts\) \}\}/);
  assert.match(alerts, /--plan test-timings\.json --without-rest/);
  assert.ok(Buffer.byteLength(JSON.stringify(plan.parts.map((p) => p.name)), 'utf16le') < 1024, 'names alone are far below the 1 MB job-output limit');
});


test('D5608 timing metadata is unpacked before duration planning', () => {
  assert.deepEqual(timingsOf({ sha: 'abc', node: 'v22', tests: { 'a.test.mjs': { wallMs: 120, exitCode: 0 }, 'b.test.ts': { wallMs: 400, exitCode: 1 } }, untraced: [] }), { 'a.test.mjs': 120, 'b.test.ts': 400 });
  assert.deepEqual(timingsOf({ 'a.test.mjs': 10 }), { 'a.test.mjs': 10 });
  for (const input of [null, [], { tests: [] }]) assert.throws(() => timingsOf(input), /invalid/);
});
