/** D5505 (#5505): independent failures, prerequisites, signals, complete catalog and local preflight. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runGuards, validateGuards, selectGuards, executeGuard } from './guardRunner.mjs';
import { main as runGuardCli } from '../run-guards.mjs';
import { GUARDS, guardCommands } from './guardCatalog.mjs';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
const guard = (id, code = 0, requires = []) => ({ id, command: [process.execPath, '-e', `process.exit(${code})`], requires });
test('all independent failures are reported and only failed prerequisites block dependents', async () => {
  const observed = [];
  const result = await runGuards([guard('first', 7), guard('dependent', 0, ['first']), guard('second', 4), guard('clean')], { report: row => observed.push(row.id) });
  assert.deepEqual(observed, result.results.map(r => r.id));
  assert.deepEqual(result.results.map(r => [r.id, r.status, r.exitCode, r.blockedBy]), [
    ['first', 'failed', 7, []], ['dependent', 'blocked', null, ['first']], ['second', 'failed', 4, []], ['clean', 'passed', 0, []],
  ]);
  assert.equal(result.exitCode, 1); assert.equal(result.complete, true);
});
test('clean run is zero; a thrown command is nonzero and later independent checks still run', async () => {
  assert.equal((await runGuards([guard('first'), guard('second')])).exitCode, 0);
  const r = await runGuards([guard('first'), guard('second')], { execute: async command => { if (command.at(-1).includes('0')) throw new Error('private value'); } });
  assert.equal(r.exitCode, 1); assert.deepEqual(r.results.map(x => x.errorCode), ['EXECUTION_ERROR', 'EXECUTION_ERROR']);
  assert.ok(!JSON.stringify(r).includes('private value'));
});
test('interruption records running and remaining guards and never returns zero', async () => {
  const controller = new AbortController();
  const r = await runGuards([guard('first'), guard('second')], { controller, execute: async () => { controller.abort('SIGINT'); return { exitCode: 0 }; } });
  assert.equal(r.exitCode, 130); assert.deepEqual(r.results.map(x => x.status), ['interrupted', 'not_run']);
});
test('real child interruption waits for the spawn event, without a fixed tick wait', { timeout: 10000 }, async () => {
  const controller = new AbortController();
  const result = await executeGuard([process.execPath, '-e', 'setInterval(() => {}, 1000)'], {
    cwd: process.cwd(), signal: controller.signal,
    spawnProcess: (...args) => { const child = spawn(...args); child.once('spawn', () => controller.abort('SIGTERM')); return child; },
  });
  assert.equal(result.signal, 'SIGTERM');
});
test('catalog rejects duplicates, malformed commands, empty input and forward prerequisites', () => {
  for (const rows of [[], [guard('bad id')], [guard('same'), guard('same')], [guard('first', 0, ['later'])], [{ id: 'first', command: [] }], [{ ...guard('first'), requires: null }], [{ ...guard('first'), full: 'false' }]]) assert.throws(() => validateGuards(rows));
  validateGuards(GUARDS);
});
test('preflight and one-guard reproduction retain prerequisite closure and full entry wiring', () => {
  const scripts = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).scripts;
  assert.equal(scripts['test:guards'], 'node scripts/run-guards.mjs'); assert.equal(scripts['pretest:guards'], undefined);
  assert.ok(!selectGuards(GUARDS).some(g => g.id === 'undefined-symbols'));
  assert.equal(scripts['test:guards:preflight'], 'node scripts/run-guards.mjs --preflight');
  const fast = selectGuards(GUARDS, { preflight: true });
  assert.ok(!fast.some(g => g.id === 'check-sqlite-columns'));
  for (const id of ['generated', 'check-decision-ids', 'check-sql-migrations', 'check-runtime-ddl', 'build-auth-inventory', 'undefined-symbols']) assert.ok(fast.some(g => g.id === id));
  assert.deepEqual(selectGuards(GUARDS, { id: 'check-api-drift' }).map(g => g.id), ['generated', 'check-api-drift']);
  assert.throws(() => selectGuards(GUARDS, { id: 'missing' }));
});

// Audited command/flag contract from the pre-migration package; additions remain allowed.
const BASELINE = [
  [
    "node",
    "scripts/ci/no-anthropic-in-prod.mjs"
  ],
  [
    "node",
    "scripts/check-api-drift.mjs"
  ],
  [
    "node",
    "scripts/check-sql-unsafe.mjs"
  ],
  [
    "node",
    "scripts/check-sql-prepare.mjs"
  ],
  [
    "node",
    "scripts/check-refusal-bodies.mjs"
  ],
  [
    "node",
    "scripts/check-sql-migrations.mjs"
  ],
  [
    "node",
    "scripts/check-deal-preparation-readers.mjs"
  ],
  [
    "node",
    "scripts/check-sqlite-dialect.mjs"
  ],
  [
    "node",
    "scripts/check-sqlite-tables.mjs"
  ],
  [
    "node",
    "scripts/check-sqlite-columns.mjs"
  ],
  [
    "node",
    "scripts/check-write-router-columns.mjs"
  ],
  [
    "node",
    "scripts/check-sqlite-table-collisions.mjs"
  ],
  [
    "node",
    "--no-warnings",
    "scripts/check-schema-pair-drift.mjs"
  ],
  [
    "node",
    "--no-warnings",
    "scripts/check-migration-declarations.mjs"
  ],
  [
    "node",
    "--no-warnings",
    "scripts/check-runtime-schema-declared.mjs"
  ],
  [
    "node",
    "--no-warnings",
    "scripts/check-runtime-ddl.mjs"
  ],
  [
    "node",
    "scripts/check-timestamp-comparisons.mjs"
  ],
  [
    "node",
    "scripts/check-migration-column-shapes.mjs"
  ],
  [
    "node",
    "scripts/check-money-cents.mjs"
  ],
  [
    "node",
    "scripts/check-regulated-wording.mjs"
  ],
  [
    "node",
    "scripts/check-row-generics.mjs"
  ],
  [
    "node",
    "scripts/check-schema-readiness.mjs"
  ],
  [
    "node",
    "scripts/check-wrangler-binding-parity.mjs"
  ],
  [
    "node",
    "scripts/check-meeting-bot-teams.mjs"
  ],
  [
    "node",
    "scripts/check-preview-isolation.mjs",
    "--static"
  ],
  [
    "node",
    "scripts/check-scanner-ignore-parity.mjs"
  ],
  [
    "node",
    "scripts/check-inline-project-pickers.mjs"
  ],
  [
    "node",
    "scripts/build-r2-inventory.mjs",
    "--check"
  ],
  [
    "node",
    "scripts/check-record-writes.mjs"
  ],
  [
    "node",
    "scripts/check-folder-docs.mjs"
  ],
  [
    "node",
    "scripts/build-route-map.mjs",
    "--check"
  ],
  [
    "node",
    "scripts/build-profile-routing.mjs",
    "--check"
  ],
  [
    "node",
    "scripts/check-decision-ids.mjs"
  ],
  [
    "node",
    "scripts/check-decision-appends.mjs"
  ],
  [
    "node",
    "scripts/check-unused-imports.mjs"
  ],
  [
    "node",
    "scripts/check-react-hook-imports.mjs"
  ],
  [
    "node",
    "scripts/check-frontend-logging.mjs"
  ],
  [
    "node",
    "scripts/check-production-credentials.mjs"
  ],
  [
    "node",
    "scripts/check-secret-logging.mjs"
  ],
  [
    "node",
    "scripts/check-zone-handlers.mjs"
  ],
  [
    "node",
    "scripts/check-zone-hover-copy.mjs"
  ],
  [
    "node",
    "scripts/check-tail-consumer.mjs"
  ],
  [
    "node",
    "scripts/check-advisor-bank-drift.mjs"
  ],
  [
    "node",
    "scripts/check-statemachine-coverage.mjs"
  ],
  [
    "node",
    "scripts/check-deck-templates.mjs"
  ],
  [
    "node",
    "scripts/check-deck-payload-wiring.mjs"
  ],
  [
    "node",
    "scripts/check-branch-config.mjs"
  ],
  [
    "node",
    "scripts/check-access-comments.mjs"
  ],
  [
    "node",
    "scripts/build-auth-inventory.mjs",
    "--check"
  ],
  [
    "node",
    "scripts/check-docs-assets-closure.mjs"
  ],
  [
    "node",
    "scripts/check-bundle-budget.mjs"
  ],
  [
    "node",
    "scripts/check-frontend-builds.mjs"
  ],
  [
    "node",
    "scripts/check-mercury-member-surfaces.mjs"
  ],
  [
    "node",
    "scripts/check-deck-retention.mjs"
  ],
  [
    "node",
    "--experimental-strip-types",
    "--no-warnings",
    "--import",
    "./cloudflare-worker/test/_ts-loader.mjs",
    "scripts/check-model-coverage.mjs"
  ],
  [
    "node",
    "--experimental-strip-types",
    "--no-warnings",
    "--import",
    "./cloudflare-worker/test/_ts-loader.mjs",
    "scripts/check-skill-library.mjs"
  ],
  [
    "node",
    "--no-warnings",
    "scripts/check-test-clock.mjs"
  ]
];
test('every pre-migration guard retains its command, flags and relative order', () => {
 let after = -1; for (const command of BASELINE) { const at = guardCommands.indexOf(command.join(' ')); assert.ok(at > after, command.join(' ')); after = at; }
});

test('CLI refuses unsupported arguments and unknown guards before executing or overwriting results', async () => {
  await assert.rejects(() => runGuardCli(['--unsafe']));
  await assert.rejects(() => runGuardCli(['--guard', 'missing']));
});
test('an already aborted child request does not start a process', async () => {
  const controller = new AbortController(); controller.abort('SIGINT'); let started = false;
  const result = await executeGuard(['node', 'never'], { signal: controller.signal, spawnProcess: () => { started = true; } });
  assert.equal(started, false); assert.equal(result.signal, 'SIGINT');
});

test('the reported guard source is its actual script rather than its loader', async () => {
  const result = await runGuards([{ id: 'model', command: ['node', '--import', './loader.mjs', 'scripts/check-model-coverage.mjs'] }], { execute: async () => ({ exitCode: 0 }) });
  assert.equal(result.results[0].file, 'scripts/check-model-coverage.mjs');
});

test('cancellation still escalates a surviving process group after its parent closes', { timeout: 5000 }, async () => {
  const controller = new AbortController(), calls = [];
  const result = await executeGuard(['node', 'fixture'], {
    signal: controller.signal,
    spawnProcess: () => { const child = new EventEmitter(); child.pid = 4242; queueMicrotask(() => { controller.abort('SIGTERM'); child.emit('close', null, 'SIGTERM'); }); return child; },
    killProcess: (pid, name) => { assert.equal(pid, -4242); calls.push(name); },
  });
  assert.equal(result.signal, 'SIGTERM'); assert.deepEqual(calls, ['SIGTERM', 0, 'SIGKILL']);
});

test('a parent closing after escalation finishes even while the old group is still observable', { timeout: 10000 }, async () => {
  const controller = new AbortController(), calls = []; let child;
  const result = await executeGuard(['node', 'fixture'], {
    signal: controller.signal,
    spawnProcess: () => { child = new EventEmitter(); child.pid = 4242; queueMicrotask(() => controller.abort('SIGTERM')); return child; },
    killProcess: (pid, name) => { assert.equal(pid, -4242); calls.push(name); if (name === 'SIGKILL') queueMicrotask(() => child.emit('close', null, 'SIGKILL')); },
  });
  assert.equal(result.signal, 'SIGKILL'); assert.deepEqual(calls, ['SIGTERM', 'SIGKILL']);
});
