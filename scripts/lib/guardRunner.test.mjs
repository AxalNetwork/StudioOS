/** D5505 (#5505): independent failures, prerequisites, signals and clean runs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runGuards, validateGuards } from './guardRunner.mjs';
import { GUARDS } from '../run-guards.mjs';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { runCommands } from '../test-drift-parts.mjs';

const guard = (id, code = 0, requires = []) => ({ id, command: [process.execPath, '-e', `process.exit(${code})`], requires });

test('all independent guards run; blocked prerequisites are explicit and do not mask another failure', async () => {
  const rows = [guard('first', 7), guard('dependent', 0, ['first']), guard('second', 4), guard('clean')];
  const result = await runGuards(rows);
  assert.deepEqual(result.results.map(row => [row.id, row.status, row.exitCode, row.blockedBy]), [
    ['first', 'failed', 7, []], ['dependent', 'blocked', null, ['first']], ['second', 'failed', 4, []], ['clean', 'passed', 0, []],
  ]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.interrupted, false);
});

test('a clean run reports the real commands and passes', async () => {
  const rows = [guard('first'), guard('second', 0, ['first'])];
  const result = await runGuards(rows);
  assert.deepEqual(result.results.map(row => [row.status, row.command]), rows.map(row => ['passed', row.command]));
  assert.equal(result.exitCode, 0);
});

test('a child signal fails closed; following guards are not reported as passing', async () => {
  const result = await runGuards([{ id: 'signal', command: [process.execPath, '-e', "process.kill(process.pid, 'SIGTERM')"] }, guard('later')]);
  assert.deepEqual(result.results.map(row => [row.status, row.exitCode, row.signal]), [['interrupted', null, 'SIGTERM'], ['not_run', null, 'SIGTERM']]);
  assert.equal(result.exitCode, 143);
  assert.equal(result.interrupted, true);
});

test('an interrupt of the runner terminates its active child and preserves a diagnostic', { timeout: 10000 }, async () => {
  const module = new URL('./guardRunner.mjs', import.meta.url).href;
  const code = `import { runGuards } from ${JSON.stringify(module)};
    const controller = new AbortController();
    process.once('SIGTERM', () => controller.abort('SIGTERM'));
    const result = await runGuards([
      {id:'active',command:[process.execPath,'-e',"process.kill(process.ppid, 'SIGTERM'); setInterval(() => {}, 1000)"]},
      {id:'later',command:[process.execPath,'-e','process.exit(0)']}
    ], {controller});
    console.log(JSON.stringify(result)); process.exitCode = result.exitCode;`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; child.stdout.on('data', data => { stdout += data; });
  const exit = await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
  const result = JSON.parse(stdout);
  assert.equal(exit, 143);
  assert.deepEqual(result.results.map(row => row.status), ['interrupted', 'not_run']);
  assert.equal(result.exitCode, 143);
});

test('missing executables report a bounded error and do not hide independent results', async () => {
  const result = await runGuards([{ id: 'missing', command: ['/no-such-studioos-guard'] }, guard('clean')]);
  assert.deepEqual(result.results.map(row => [row.status, row.exitCode, row.errorCode]), [['failed', 1, 'ENOENT'], ['passed', 0, undefined]]);
  assert.equal(result.exitCode, 1);
});

test('a prerequisite cannot be missing, forward-referenced or duplicated', () => {
  assert.throws(() => validateGuards([guard('a', 0, ['b']), guard('b')]), /prerequisite/);
  assert.throws(() => validateGuards([guard('a'), guard('a')]), /duplicate/);
});

test('the rest part continues independent stages and preserves failure', () => {
  const seen = [];
  const exit = runCommands(['fail', 'also-fail', 'clean'], { run: (_program, args) => {
    seen.push(args[1]); return { status: args[1] === 'fail' ? 7 : args[1] === 'also-fail' ? 4 : 0 };
  } });
  assert.deepEqual(seen, ['fail', 'also-fail', 'clean']);
  assert.equal(exit, 7);
  const cancelled = [];
  const interrupted = runCommands(['active', 'later'], { run: (_program, args) => { cancelled.push(args[1]); return { status: null, signal: 'SIGTERM' }; } });
  assert.deepEqual(cancelled, ['active']);
  assert.notEqual(interrupted, 0);
});

test('the package runs the complete catalog; preflight shares its prerequisites', () => {
  const { scripts } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(scripts['test:guards'], 'node scripts/run-guards.mjs');
  assert.equal(scripts['test:preflight'], 'node scripts/run-guards.mjs --preflight');
  assert.equal(scripts['pretest:guards'], undefined, 'the runner records generation as a prerequisite instead of npm hiding all later results');
  const fast = GUARDS.filter(row => row.preflight);
  assert.deepEqual(fast.map(row => row.id), ['generated', 'check-sql-migrations', 'check-runtime-ddl', 'check-decision-ids', 'build-auth-inventory', 'undefined-symbols']);
  validateGuards(fast);
  assert.deepEqual(GUARDS.find(row => row.id === 'check-model-coverage').command, ['node', '--experimental-strip-types', '--no-warnings', '--import', './cloudflare-worker/test/_ts-loader.mjs', 'scripts/check-model-coverage.mjs']);
  assert.deepEqual(GUARDS.find(row => row.id === 'check-skill-library').command, ['node', '--experimental-strip-types', '--no-warnings', '--import', './cloudflare-worker/test/_ts-loader.mjs', 'scripts/check-skill-library.mjs']);
  assert.deepEqual(GUARDS.find(row => row.id === 'check-preview-isolation').command, ['node', 'scripts/check-preview-isolation.mjs', '--static']);
  assert.deepEqual(GUARDS.find(row => row.id === 'check-test-clock').command, ['node', '--no-warnings', 'scripts/check-test-clock.mjs']);
});

test("the audited guards remain covered without dropping a check", () => {
  assert.deepEqual(GUARDS.filter(row => row.full !== false).map(row => row.id), [
  "generated",
  "no-anthropic-in-prod",
  "check-api-drift",
  "check-sql-unsafe",
  "check-sql-prepare",
  "check-refusal-bodies",
  "check-sql-migrations",
  "check-sqlite-dialect",
  "check-sqlite-tables",
  "check-sqlite-columns",
  "check-write-router-columns",
  "check-sqlite-table-collisions",
  "check-schema-pair-drift",
  "check-migration-declarations",
  "check-runtime-schema-declared",
  "check-runtime-ddl",
  "check-timestamp-comparisons",
  "check-migration-column-shapes",
  "check-money-cents",
  "check-regulated-wording",
  "check-row-generics",
  "check-schema-readiness",
  "check-wrangler-binding-parity",
  "check-preview-isolation",
  "check-scanner-ignore-parity",
  "check-inline-project-pickers",
  "check-folder-docs",
  "build-route-map",
  "build-profile-routing",
  "check-decision-ids",
  "check-unused-imports",
  "check-react-hook-imports",
  "check-frontend-logging",
  "check-secret-logging",
  "check-zone-handlers",
  "check-zone-hover-copy",
  "check-tail-consumer",
  "check-advisor-bank-drift",
  "check-statemachine-coverage",
  "check-deck-templates",
  "check-deck-payload-wiring",
  "check-branch-config",
  "check-access-comments",
  "build-auth-inventory",
  "check-docs-assets-closure",
  "check-bundle-budget",
  "check-frontend-builds",
  "check-mercury-member-surfaces",
  "check-deck-retention",
  "check-model-coverage",
  "check-skill-library",
  "check-test-clock"
]);
});
