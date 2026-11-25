// D4130/D5609: one generated plan covers the full suite exactly once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
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
  assert.doesNotMatch(alerts, /(?:frontend|worker)-\d+-of-\d+/);
  // D7108 part 2, D8435: ci.yml carries exactly one literal part list, the full
  // tier's, and it is partsOf's names in order. It is the matrix on every event
  // but a draft pull request, whose fast tier is `rest` alone. Nothing comes
  // from `plan`, so the suite waits for no job.
  const literal = JSON.stringify(partsOf(pkg.scripts).map((p) => p.name));
  const matrix = `        part: \${{ fromJSON(github.event_name == 'pull_request' && github.event.pull_request.draft && '["rest"]' || '${literal}') }}\n`;
  assert.equal(ci.split(matrix).length, 2, 'the suite matrix lists partsOf(package.json) names, in order, once');
  const sharded = plan.parts.filter((p) => p.script).length;
  // D7881 names the one delegated part only to bound its hosted fallback.
  const macTimeout = "    timeout-minutes: ${{ matrix.part == 'worker-1-of-6' && vars.MACBOOK_WORKER_ENABLED == 'true' && github.event_name != 'pull_request' && 83 || 50 }}\n";
  assert.equal(ci.split(macTimeout).length, 2, 'exactly one bounded Mac-part timeout');
  assert.equal((ci.replace(macTimeout, '').match(/(?:frontend|worker)-\d+-of-\d+/g) || []).length, sharded, 'no additional part lists outside the queue matrix');
  assert.equal(new Set(JSON.parse(literal)).size, plan.parts.length, 'the literal list has no repeated part');
  // D8626: `capacity-route` joins the gate's needs for the routed-candidate refusal; the pass rule is unchanged.
  assert.match(ci, /needs: \[verified, plan, capacity-route, suite\]/);
  assert.match(ci, /if \{ \{ \[ "\$PLAN" = "success" \] && \[ "\$EVENT" != "merge_group" \]; \} \|\| \{ \[ "\$PLAN" = "skipped" \] && \[ "\$EVENT" = "merge_group" \]; \}; \} && \[ "\$SUITE" = "success" \]; then/);
  assert.match(ci, /  plan:\n    name: suite plan\n    needs: verified\n    if: \$\{\{ !cancelled\(\) && needs\.verified\.outputs\.run == '' && github\.event_name != 'merge_group' \}\}\n/);
  assert.match(ci, /--plan-file suite-plan\.json/);
  assert.match(alerts, /part: \$\{\{ fromJSON\(needs\.future-clock-plan\.outputs\.parts\) \}\}/);
  assert.match(alerts, /--plan test-timings\.json --without-rest/);
  assert.ok(Buffer.byteLength(JSON.stringify(plan.parts.map((p) => p.name)), 'utf16le') < 1024, 'names alone are far below the 1 MB job-output limit');
});

/** The run block of the suite step named `name` in ci.yml, unindented. */
const suiteStep = (ci, name) => {
  const at = ci.indexOf(`      - name: ${name}\n`);
  assert.ok(at > 0, name);
  const step = ci.slice(at).split(/\n(?= {6}(?:- |# ))/)[0];
  return { step, run: step.match(/ {8}run: \|\n((?: {10}[^\n]*\n?)+)/)[1].replace(/^ {10}/gm, '') };
};

test('D7108 part 2, D8435: on every event each suite part writes the plan itself, after setup-node and before any install, and downloads nothing', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  const suite = ci.slice(ci.indexOf('\n  suite:\n'), ci.indexOf('\n  test-deps:\n'));
  const { step } = suiteStep(suite, 'Exact-once plan from this commit');
  assert.doesNotMatch(step, /\n {8}if:/, 'the step runs on every event');
  assert.match(step, /\n {10}PART: \$\{\{ matrix\.part \}\}\n {10}TOTAL: \$\{\{ strategy\.job-total \}\}\n {10}DRAFT_TIER: \$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.draft \}\}\n/);
  assert.match(step, /names=\$\(node scripts\/test-drift-parts\.mjs --plan --equal-weights\)/);
  assert.doesNotMatch(suite, /name: suite-plan|needs\.plan/, 'no plan artifact and no plan output is read');
  const order = ['actions/setup-node', '- name: Exact-once plan from this commit', 'Install frontend deps', '--plan-file suite-plan.json'].map((s) => suite.indexOf(s));
  assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), JSON.stringify(order));
});

test('D7108 part 2, D8435: the plan step fails a part, never drops one, when the matrix and the plan differ', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  const names = plan.parts.map((p) => p.name);
  const { run } = suiteStep(ci, 'Exact-once plan from this commit');
  const code = run.replace('node scripts/test-drift-parts.mjs --plan --equal-weights', `printf '%s' '${JSON.stringify(names)}'`);
  assert.notEqual(code, run);
  const exec = (PART, TOTAL, DRAFT_TIER = 'false') => spawnSync('bash', ['-e', '-c', code], { encoding: 'utf8', env: { ...process.env, PART, TOTAL: String(TOTAL), DRAFT_TIER } });
  for (const part of names) {
    const ok = exec(part, names.length);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, new RegExp(`this part is ${part}\\.`));
  }
  for (const [part, total] of [[names[0], names.length - 1], [names[0], names.length + 1], ['worker-7-of-6', names.length], ['', names.length]]) {
    const bad = exec(part, total);
    assert.equal(bad.status, 1, `${part}/${total}`);
    assert.match(bad.stderr, /::error::The suite matrix/);
  }
  // D8435: the runner benchmark shares these steps and runs the plan once a lane, so whole multiples pass.
  assert.equal(exec(names[0], names.length * 3).status, 0);
  for (const total of [0, names.length * 2 - 1, names.length * 2 + 1]) assert.equal(exec(names[0], total).status, 1, String(total));
  // D8435: the draft tier is one part, and it must be a part of the plan.
  assert.equal(exec('rest', 1, 'true').status, 0);
  for (const [part, total, draft] of [['rest', names.length, 'true'], ['rest', 2, 'true'], ['selected', 1, 'true'], ['rest', 1, 'false'], ['rest', 1, '']]) {
    const bad = exec(part, total, draft);
    assert.equal(bad.status, 1, `${part}/${total}/${draft}`);
    assert.match(bad.stderr, /::error::The suite matrix/);
  }
});

test('D7108 part 2: two shards planning independently with --equal-weights write identical bytes that cover every file once', () => {
  // Two checkouts of one commit, as two queue shards have. Each holds a file
  // named --equal-weights with broken JSON and a skewed test-timings.json:
  // the pinned input reads neither.
  const fixture = () => {
    const root = mkdtempSync(join(tmpdir(), 'queue-shard-'));
    mkdirSync(join(root, 'scripts', 'lib'), { recursive: true });
    for (const path of ['scripts/test-drift-parts.mjs', 'scripts/build-generated.mjs', 'scripts/lib/shardPlan.mjs', 'scripts/lib/flakyTests.mjs', 'scripts/lib/ciFailures.mjs']) {
      writeFileSync(join(root, path), readFileSync(path));
    }
    for (const dir of ['f', 'w']) mkdirSync(join(root, dir));
    for (let i = 0; i < 5; i++) writeFileSync(join(root, 'f', `t${i}.test.mjs`), '');
    for (let i = 0; i < 13; i++) writeFileSync(join(root, 'w', `t${i}.test.ts`), '');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: {
      'test:frontend': "node --test 'f/*.test.mjs'",
      'test:worker': "node --test 'w/*.test.ts'",
      'test:drift': 'npm run test:frontend && npm run test:worker && node scripts/check-x.mjs',
    } }));
    writeFileSync(join(root, '--equal-weights'), '{not json');
    writeFileSync(join(root, 'test-timings.json'), JSON.stringify({ 'w/t0.test.ts': 900000, 'f/t1.test.mjs': 900000 }));
    return root;
  };
  const roots = [fixture(), fixture()];
  try {
    const outputs = roots.map((root) => {
      const r = spawnSync(process.execPath, [join(root, 'scripts/test-drift-parts.mjs'), '--plan', '--equal-weights'], { cwd: root, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return { names: JSON.parse(r.stdout), bytes: readFileSync(join(root, 'suite-plan.json'), 'utf8') };
    });
    assert.equal(outputs[0].bytes, outputs[1].bytes);
    assert.deepEqual(outputs[0].names, outputs[1].names);
    const scripts = JSON.parse(readFileSync(join(roots[0], 'package.json'), 'utf8')).scripts;
    assert.equal(outputs[0].bytes, `${JSON.stringify(buildPlan(scripts, {}, roots[0]), null, 2)}\n`);
    const skewed = timingsOf(JSON.parse(readFileSync(join(roots[0], 'test-timings.json'), 'utf8')));
    assert.notEqual(outputs[0].bytes, `${JSON.stringify(buildPlan(scripts, skewed, roots[0]), null, 2)}\n`, 'the timings file would have changed the packing');
    const written = JSON.parse(outputs[0].bytes);
    assert.deepEqual(outputs[0].names, partsOf(scripts).map((p) => p.name));
    assert.equal(validatePlan(written, scripts, roots[1]).length, written.parts.length);
    for (const script of Object.keys(SHARDS)) assertExactOnce(written.parts.filter((p) => p.script === script), suiteFiles(scripts[script], roots[1]));
    assert.deepEqual(written.parts.find((p) => p.name === REST).commands, ['node scripts/check-x.mjs']);
    // Equal weights: each suite's parts differ in size by at most one file.
    for (const script of Object.keys(SHARDS)) {
      const sizes = written.parts.filter((p) => p.script === script).map((p) => p.files.length);
      assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `${script}: ${sizes}`);
    }
  } finally {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }
});

test('D7108 part 2: on the real tree the equal-weight plan is a pure function of the commit and runs every test:drift file and step once', () => {
  const a = buildPlan(pkg.scripts, {});
  const b = buildPlan(structuredClone(pkg.scripts), {});
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.deepEqual(a.parts.map((p) => p.name), partsOf(pkg.scripts).map((p) => p.name));
  for (const script of Object.keys(SHARDS)) assertExactOnce(a.parts.filter((p) => p.script === script), suiteFiles(pkg.scripts[script]));
  assert.equal(validatePlan(a, pkg.scripts).length, a.parts.length);
  const steps = pkg.scripts['test:drift'].split(' && ');
  const covered = [...a.parts.find((p) => p.name === REST).commands, ...Object.keys(SHARDS).map((k) => `npm run ${k}`)];
  assert.deepEqual(covered.sort(), [...steps].sort());
});

test('D5608 timing metadata is unpacked before duration planning', () => {
  assert.deepEqual(timingsOf({ sha: 'abc', node: 'v22', tests: { 'a.test.mjs': { wallMs: 120, exitCode: 0 }, 'b.test.ts': { wallMs: 400, exitCode: 1 } }, untraced: [] }), { 'a.test.mjs': 120, 'b.test.ts': 400 });
  assert.deepEqual(timingsOf({ 'a.test.mjs': 10 }), { 'a.test.mjs': 10 });
  for (const input of [null, [], { tests: [] }]) assert.throws(() => timingsOf(input), /invalid/);
});

test('#6460 the real CI planner gives drafts only rest and preserves all nine parts for ready, queue and push', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.match(ci, /types: \[opened, synchronize, reopened, ready_for_review\]/);
  const planner = ci.match(/id: plan\n(?:[^\n]*\n)*? {8}run: \|\n((?: {10}[^\n]*\n)+)/)[1];
  const code = planner.replace(/^ {10}/gm, '').replace(
    'node scripts/test-drift-parts.mjs --plan test-timings.json',
    `printf '%s' '${JSON.stringify(plan.parts.map(part => part.name))}'`,
  ).replace('>> "$GITHUB_OUTPUT"', '');
  for (const [EVENT, DRAFT, expected] of [
    ['pull_request', 'true', ['rest']],
    ['pull_request', 'false', plan.parts.map(part => part.name)],
    ['push', '', plan.parts.map(part => part.name)],
    ['merge_group', '', plan.parts.map(part => part.name)],
  ]) {
    const run = spawnSync('bash', ['-e', '-c', code], { encoding: 'utf8', env: { ...process.env, EVENT, DRAFT } });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout.trim().slice('parts='.length)), expected);
  }
});

test('#6674 the timing selector has clean stdout on a fresh checkout', () => {
  const root = mkdtempSync(join(tmpdir(), 'timing-selector-'));
  try {
    const artifacts = join(root, 'artifacts.json');
    const commits = join(root, 'commits.json');
    writeFileSync(commits, JSON.stringify([{ sha: 'eligible' }]));
    const run = () => spawnSync(process.execPath,
      ['scripts/test-drift-parts.mjs', '--main-artifact', artifacts, commits], { encoding: 'utf8' });
    writeFileSync(artifacts, JSON.stringify({ artifacts: [{
      id: 27, name: 'test-deps-eligible', expired: false, created_at: '2026-11-15', workflow_run: { head_sha: 'eligible' },
    }] }));
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '27\n');
    writeFileSync(artifacts, '{"artifacts":[]}');
    result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    writeFileSync(artifacts, '{"artifacts":[{"id":"27"}]}');
    result = run();
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /invalid timing artifact or main commit inventory/);
    rmSync(artifacts);
    result = run();
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('#6674 all three planners use the same timing download step', () => {
  for (const workflow of ['ci', 'github-alerts', 'runner-benchmark']) {
    const yaml = readFileSync(`.github/workflows/${workflow}.yml`, 'utf8');
    assert.match(yaml, /run: bash scripts\/ci\/download-test-timings\.sh/);
  }
});

test('#6674 the downloader distinguishes unavailable, absent, malformed and eligible timings', () => {
  const root = mkdtempSync(join(tmpdir(), 'timing-download-'));
  try {
    mkdirSync(join(root, 'scripts', 'ci'), { recursive: true });
    for (const path of ['scripts/test-drift-parts.mjs', 'scripts/build-generated.mjs', 'scripts/ci/download-test-timings.sh']) {
      writeFileSync(join(root, path), readFileSync(path));
    }
    mkdirSync(join(root, 'scripts', 'lib'));
    for (const name of ['shardPlan', 'flakyTests', 'ciFailures']) {
      writeFileSync(join(root, 'scripts', 'lib', name + '.mjs'), readFileSync('scripts/lib/' + name + '.mjs'));
    }
    writeFileSync(join(root, 'gh'), `#!/usr/bin/env bash
case "$2" in
  */commits*) [[ $MODE != unavailable ]] || exit 1; echo '[{"sha":"eligible"}]' ;;
  */actions/artifacts/27/zip) cat "$RUNNER_TEMP/timings-fixture.zip" ;;
  */actions/artifacts'?'*) case "$MODE" in
    absent) echo '{"artifacts":[]}' ;;
    malformed) echo '{"error":"bad input"}' ;;
    *) echo '{"artifacts":[{"id":27,"name":"test-deps-eligible","expired":false,"created_at":"2026-11-15","workflow_run":{"head_sha":"eligible"}}]}' ;;
  esac ;;
  *) exit 2 ;;
esac
`, { mode: 0o755 });
    writeFileSync(join(root, 'test-timings.json'), '{"a.test.mjs":27}');
    const zip = spawnSync('zip', ['-q', 'timings-fixture.zip', 'test-timings.json'], { cwd: root, encoding: 'utf8' });
    assert.equal(zip.status, 0, zip.stderr);
    const run = (MODE) => spawnSync('bash', ['scripts/ci/download-test-timings.sh'], {
      cwd: root, encoding: 'utf8',
      env: { ...process.env, MODE, REPO: 'AxalNetwork/StudioOS', RUNNER_TEMP: root,
        PATH: [root, join(process.execPath, '..'), process.env.PATH].join(':') },
    });
    for (const [mode, status, line] of [
      ['unavailable', 0, 'Could not query'],
      ['absent', 0, 'No eligible'],
      ['malformed', 1, 'Invalid main timing artifact selector input'],
    ]) {
      const result = run(mode);
      assert.equal(result.status, status, result.stderr);
      assert.ok(result.stdout.includes(line), result.stdout);
      assert.equal(existsSync(join(root, 'test-timings.json')), false);
    }
    const result = run('eligible');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Using main timing artifact 27\./);
    assert.equal(readFileSync(join(root, 'test-timings.json'), 'utf8'), '{"a.test.mjs":27}');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
