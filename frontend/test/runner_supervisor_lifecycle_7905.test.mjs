/** D7905/D8009/D8010: the trusted supervisor owns run → observe → export → verified removal, and keeps recovery evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobContainer, FINISH_RESERVE_MS } from '../../scripts/ci/runners/job-container.mjs';
import { recoveryStore } from '../../scripts/ci/runners/recovery-store.mjs';
import { classifyOutcome, main, recoverRetained, runInContainer } from '../../scripts/ci/runner-execution.mjs';

const IMAGE = 'sha256:' + 'a'.repeat(64), CID = 'b'.repeat(64), NOW = 1800000000000, DEADLINE = NOW + 600000;
const POLICY = { version: 1, image: IMAGE, nodeVersion: '22.23.3', pythonVersion: '3.11.18' };
const identity = () => ({ version: 1, repository: 'AxalNetwork/StudioOS', profile: 'linux-x64', requestId: '00000000-0000-4000-8000-000000000001', logicalShard: 'worker-1-of-6', childRunId: 202, childAttempt: 1, generation: 1, executionDeadline: DEADLINE, event: 'push', sourceSha: 'e'.repeat(40) });
const live = () => ({ allowed: true, identity: identity(), sourceSha: 'e'.repeat(40), originalRunId: 101, originalAttempt: 1, originalEvent: 'push', sourceRef: 'refs/heads/main' });

/** Stateful engine: create/start/inspect/exec/rm. `removed` makes inspect report the exact ID as gone. */
function engineFixture(t, { rmFails = false, survivesRm = false, inspectAfterRm = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'lifecycle-7905-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source'), plan = join(root, 'plan.json'), store = join(root, 'state', 'containers');
  mkdirSync(source); writeFileSync(plan, '{}');
  const calls = []; let state = null, removed = false;
  const engine = args => {
    calls.push(args);
    if (args[0] === 'create') {
      removed = false;
      const val = k => args[args.indexOf(k) + 1], all = k => args.flatMap((v, i) => v === k ? [args[i + 1]] : []);
      state = { Id: CID, Name: '/studioos-job-202-1-1', Image: IMAGE, State: { Running: true, Pid: 123 }, Config: { User: val('--user'), Labels: { 'vc.axal.studioos.job': '202-1-1' }, Entrypoint: [val('--entrypoint')], Cmd: args.slice(-2), Env: all('--env') },
        HostConfig: { Privileged: false, Init: true, ReadonlyRootfs: true, CapDrop: ['ALL'], CapAdd: null, SecurityOpt: ['no-new-privileges'], PidMode: '', IpcMode: 'private', CgroupnsMode: 'private', NetworkMode: 'bridge', PortBindings: {}, Devices: [], DeviceRequests: null, VolumesFrom: null, ExtraHosts: null, Links: null, PidsLimit: 256, Memory: 4294967296, NanoCpus: 2e9, Tmpfs: Object.fromEntries(all('--tmpfs').map(v => [v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':') + 1)])) },
        Mounts: [{ Type: 'bind', Source: source, Destination: '/input', RW: false, Propagation: 'rprivate' }, { Type: 'bind', Source: plan, Destination: '/input-plan.json', RW: false, Propagation: 'rprivate' }] };
      return CID + '\n';
    }
    if (args[0] === 'inspect') {
      if (removed) { if (inspectAfterRm) throw inspectAfterRm; throw Object.assign(new Error('gone'), { stderr: `Error: No such object: ${CID}` }); }
      return JSON.stringify([state]);
    }
    if (args[0] === 'rm') { if (rmFails) throw new Error('daemon unavailable'); if (!survivesRm) removed = true; return ''; }
    if (args[0] === 'exec' && args.includes('-e')) return 'readable';
    if (args[0] === 'exec' && args.includes('/usr/local/bin/node')) return '22.23.3\n';
    if (args[0] === 'exec' && args.includes('/usr/local/bin/python3')) return '3.11.18\n';
    return '';
  };
  return { root, source, plan, storeRoot: store, calls, engine, isRemoved: () => removed };
}
/** The candidate phases run as REAL child processes: `install` and `test` map to shell scripts by phase. */
const realSpawn = (scripts, spawned = () => {}) => args => {
  const phase = args.at(-1).includes('npm ci') ? 'install' : 'test';
  const child = spawn('/bin/sh', ['-c', scripts[phase]], { stdio: 'ignore' });
  spawned(phase, child);
  return child;
};
const completeExport = async () => ({ state: 'complete', files: 1, bytes: 10 });
function supervisor(t, f, { scripts = { install: 'exit 0', test: 'exit 0' }, spawned, admit = async () => live(), signal = new AbortController().signal, exporter = completeExport, recheck = async () => true } = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const job = new JobContainer(POLICY, { engine: f.engine, spawnEngine: realSpawn(scripts, spawned), stage: () => {}, namespace: () => true });
  const store = recoveryStore({ root: f.storeRoot, create: true });
  const logs = [], outputs = [];
  const run = () => runInContainer({ job, executionIsolation: async () => true, admit, recheck, current: { profile: { id: 'linux-x64' }, identity: identity() }, paths: { source: f.source }, planPath: f.plan, signal, store, exporter, log: l => logs.push(l), output: o => outputs.push(o) });
  return { job, store, logs, outputs, run, outcome: () => JSON.parse(logs.find(l => l.includes('container_outcome'))) };
}
const records = f => existsSync(f.storeRoot) ? readdirSync(f.storeRoot) : [];

test('D7905 success: install then test in separate execs, removal verified, recovery record removed, exit 0', async t => {
  const f = engineFixture(t);
  let atStart;
  const s = supervisor(t, f, { admit: async () => { atStart = records(f); return live(); } });
  assert.equal(await s.run(), 0);
  assert.deepEqual(atStart, ['202-1-1.json'], 'the durable record exists before the candidate runs');
  const o = s.outcome();
  assert.equal(o.result, 'success');
  assert.deepEqual([o.category, o.install.status, o.test.status, o.test.exitCode, o.cleanup.state, o.export.state, o.cleanupComplete], ['success', 'success', 'success', 0, 'complete', 'complete', true]);
  const execs = f.calls.filter(c => c[0] === 'exec' && c.includes('/bin/sh')).map(c => c.at(-1));
  assert.equal(execs.length, 0, 'phases go through the interruptible spawner, not the sync engine');
  assert.deepEqual(f.calls.filter(c => c[0] === 'rm'), [['rm', '--force', CID]]);
  assert.deepEqual(records(f), []);
  assert.deepEqual(s.outputs, [{ category: 'success', result: 'success', test_exit: 0, cleanup: 'complete', export: 'complete' }]);
});

test('D7905 a real test failure keeps its raw exit, and an install failure is never a test failure', async t => {
  let f = engineFixture(t), s = supervisor(t, f, { scripts: { install: 'exit 0', test: 'exit 3' } });
  assert.equal(await s.run(), 3, 'the raw nonzero test exit is the supervisor exit');
  assert.deepEqual([s.outcome().result, s.outcome().test.exitCode, s.outcome().cleanup.state], ['test_failure', 3, 'complete']);
  t.mock.timers.reset();
  f = engineFixture(t); s = supervisor(t, f, { scripts: { install: 'exit 7', test: 'exit 0' } });
  assert.equal(await s.run(), 1);
  const o = s.outcome();
  assert.deepEqual([o.result, o.install.status, o.install.exitCode, o.test.status], ['install_failure', 'failure', 7, 'not_run']);
  assert.deepEqual(records(f), []);
});

test('D7905 cancellation during the test exits 130 after verified removal; a late abort after an observed failure keeps the failure', async t => {
  let f = engineFixture(t), controller = new AbortController();
  // #8489: abort once the test phase is running, not 100 ms after run() starts, which on a busy runner can still
  // be the install phase.
  let s = supervisor(t, f, { scripts: { install: 'exit 0', test: 'sleep 30' }, signal: controller.signal, spawned: phase => { if (phase === 'test') setTimeout(() => controller.abort(), 100); } });
  const running = s.run();
  assert.equal(await running, 130);
  assert.deepEqual([s.outcome().result, s.outcome().test.status, s.outcome().cleanup.state], ['cancelled', 'cancelled', 'complete']);
  assert.deepEqual(records(f), []);
  t.mock.timers.reset();
  // The test exits 2; the abort arrives only after that exit was observed.
  f = engineFixture(t); controller = new AbortController();
  s = supervisor(t, f, { scripts: { install: 'exit 0', test: 'exit 2' }, signal: controller.signal, exporter: async () => { controller.abort(); return { state: 'complete' }; } });
  assert.equal(await s.run(), 2, 'not 130: the real failure was observed first');
  assert.deepEqual([s.outcome().result, s.outcome().test.exitCode], ['test_failure', 2]);
});

test('D7905 a failed or unverifiable removal keeps the recovery record and never reports success', async t => {
  for (const [options, state] of [[{ rmFails: true }, 'failed'], [{ survivesRm: true }, 'unverified'], [{ inspectAfterRm: new Error('daemon timeout') }, 'unverified']]) {
    const f = engineFixture(t, options), s = supervisor(t, f);
    assert.equal(await s.run(), 1, state);
    assert.deepEqual([s.outcome().category, s.outcome().result, s.outcome().test.status, s.outcome().cleanup.state, s.outcome().cleanup.retained, s.outcome().cleanupComplete], ['incomplete_cleanup', 'cleanup_failure', 'success', state, true, false]);
    assert.deepEqual(records(f), ['202-1-1.json'], 'the exact ownership evidence survives');
    t.mock.timers.reset();
  }
});

test('D7905 a retained record is later recovered exactly, and removed only once the engine reports it gone', async t => {
  const f = engineFixture(t, { rmFails: true }), s = supervisor(t, f);
  assert.equal(await s.run(), 1);
  const store = recoveryStore({ root: f.storeRoot });
  // A recovery that still cannot remove it keeps the record.
  let results = await recoverRetained(store, { recover: () => { throw new Error('container_recovery_unreadable'); }, verifyRemoved: () => false, log: () => {} });
  assert.deepEqual(results, [{ owner: '202-1-1', state: 'failed_retained' }]);
  assert.deepEqual(records(f), ['202-1-1.json']);
  // Recovery that reports removal but cannot verify absence keeps it too.
  results = await recoverRetained(store, { recover: () => 'removed', verifyRemoved: () => false, log: () => {} });
  assert.deepEqual(results, [{ owner: '202-1-1', state: 'unverified_retained' }]);
  // The engine is back: exact recovery removes the container, absence is verified, and only then the record goes.
  const engine = engineFixture(t);
  let state = 'present';
  const exact = args => {
    if (args[0] === 'inspect') { if (state === 'gone') throw Object.assign(new Error('x'), { stderr: `Error: No such object: ${CID}` }); return JSON.stringify([{ Id: CID, Name: '/studioos-job-202-1-1', Config: { Labels: { 'vc.axal.studioos.job': '202-1-1' } } }]); }
    if (args[0] === 'rm') { assert.deepEqual(args, ['rm', '--force', CID]); state = 'gone'; return ''; }
    return engine.engine(args);
  };
  results = await recoverRetained(store, { recover: r => JobContainer.recover(r, { engine: exact }), verifyRemoved: r => JobContainer.isRemoved(r, { engine: exact }), log: () => {} });
  assert.deepEqual(results, [{ owner: '202-1-1', state: 'removed' }]);
  assert.deepEqual(records(f), []);
});

test('D7905 the cleanup step fails visibly with a retained record but still removes the run files; a later prepare recovers it', async t => {
  const f = engineFixture(t, { rmFails: true }), s = supervisor(t, f);
  assert.equal(await s.run(), 1);
  t.mock.timers.reset();
  mkdirSync(join(f.root, 'temp')); mkdirSync(join(f.root, 'work'));
  const env = { RUNNER_TEMP: join(f.root, 'temp'), GITHUB_WORKSPACE: join(f.root, 'work'), GITHUB_RUN_ID: '202', GITHUB_RUN_ATTEMPT: '1' };
  const temp = join(f.root, 'temp', 'studioos-executor-202-1');
  assert.equal(await main('prepare', env), 0);
  const store = recoveryStore({ root: f.storeRoot });
  const stuck = { store, recover: () => { throw new Error('container_recovery_unreadable'); }, verifyRemoved: () => false, log: () => {} };
  await assert.rejects(main('cleanup', env, stuck), /container_recovery_retained/);
  assert.equal(existsSync(temp), false, 'run files removed');
  assert.deepEqual(records(f), ['202-1-1.json'], 'evidence kept outside the run directories');
  // Another run's cleanup never acts on this record.
  const other = { ...env, GITHUB_RUN_ID: '303' };
  let touched = false;
  assert.equal(await main('prepare', other, { ...stuck, recover: () => { touched = true; throw new Error('still down'); } }), 0, 'a stuck record does not block new preparation');
  assert.equal(touched, true, 'prepare attempts exact recovery of retained records');
  assert.deepEqual(records(f), ['202-1-1.json']);
  let selected = false;
  await main('cleanup', other, { ...stuck, recover: () => { selected = true; return 'removed'; } });
  assert.equal(selected, false, 'cleanup acts on its own run only');
  // The engine recovers: the next prepare removes it exactly and the record goes.
  assert.equal(await main('prepare', other, { store, recover: () => 'removed', verifyRemoved: () => true, log: () => {} }), 0);
  assert.deepEqual(records(f), []);
});

test('D7905 the recovery store is exclusive, private and refuses a linked or shared root', t => {
  const root = mkdtempSync(join(tmpdir(), 'store-7905-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, 'a', 'containers'), record = { version: 1, id: CID, owner: '202-1-1' };
  assert.deepEqual(recoveryStore({ root: dir }).list(), [], 'an absent root holds nothing and is not created');
  assert.equal(existsSync(dir), false);
  const store = recoveryStore({ root: dir, create: true });
  store.write(record);
  assert.throws(() => store.write(record), /EEXIST/, 'never overwritten');
  assert.deepEqual(store.list(), [record]);
  assert.throws(() => store.write({ ...record, owner: '202-2-1' }), /invalid_container_record/);
  chmodSync(dir, 0o755); assert.throws(() => store.list(), /unsafe_recovery_root/); chmodSync(dir, 0o700);
  const link = join(root, 'link'); symlinkSync(dir, link);
  assert.throws(() => recoveryStore({ root: link }).list(), /unsafe_recovery_root/);
  writeFileSync(join(dir, '303-1-1.json'), 'not json');
  assert.deepEqual(store.list().map(r => r.invalid ?? r.owner), ['202-1-1', '303-1-1.json'], 'a damaged record is reported, never dropped');
});

test('D8009 the absolute deadline: staging time never extends the lease, and work stops a reserve before it', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const f = engineFixture(t);
  // Staging consumes 200s; the container deadline stays the receipt's absolute second.
  let job = new JobContainer(POLICY, { engine: f.engine, stage: () => t.mock.timers.tick(200000), namespace: () => true });
  await job.create(identity(), { source: f.source, plan: f.plan });
  const create = f.calls.find(c => c[0] === 'create');
  assert.ok(create.includes(`STUDIOOS_JOB_DEADLINE=${Math.floor(DEADLINE / 1000)}`));
  const { timeout } = await job.candidateExec({ receipt: identity(), admitted: live(), phase: 'test' });
  assert.equal(timeout, DEADLINE - FINISH_RESERVE_MS - (NOW + 200000), 'work ends the reserve before the absolute deadline');
  // Staging that runs into the reserve refuses before any container exists.
  const g = engineFixture(t);
  job = new JobContainer(POLICY, { engine: g.engine, stage: () => t.mock.timers.tick(DEADLINE - Date.now() - FINISH_RESERVE_MS), namespace: () => true });
  await assert.rejects(job.create(identity(), { source: g.source, plan: g.plan }), /insufficient_execution_budget/);
  assert.equal(g.calls.some(c => c[0] === 'create'), false);
});

test('D8010 export runs while the container still exists, inside the lease; a failed or skipped export blocks success', async t => {
  let f = engineFixture(t), seen = null;
  let s = supervisor(t, f, { exporter: async args => { seen = { args, rmBefore: f.calls.some(c => c[0] === 'rm') }; return { state: 'complete' }; } });
  assert.equal(await s.run(), 0);
  assert.deepEqual([seen.rmBefore, seen.args.container, seen.args.observedTest.status, seen.args.deadline], [false, { id: CID, owner: '202-1-1' }, 'success', DEADLINE - 90000]);
  t.mock.timers.reset();
  f = engineFixture(t); s = supervisor(t, f, { exporter: async () => { throw new Error('stream truncated'); } });
  assert.equal(await s.run(), 1);
  assert.deepEqual([s.outcome().result, s.outcome().export.state, s.outcome().cleanup.state], ['export_failure', 'failed', 'complete']);
  t.mock.timers.reset();
  f = engineFixture(t); s = supervisor(t, f, { scripts: { install: 'exit 0', test: 'exit 5' }, exporter: async () => ({ state: 'failed' }) });
  assert.equal(await s.run(), 5, 'a known test failure survives a failed export');
});

test('D8010 classification: real test exit, cancelled, timed out, infrastructure, incomplete cleanup; no exporter is not success', () => {
  const ok = { state: 'complete' }, none = { state: 'not_configured' };
  const pass = { status: 'success', exitCode: 0 };
  const rows = [
    [{ install: pass, test: pass, exported: ok, cleanup: ok }, 'success', 'success', 0, true],
    [{ install: pass, test: pass, exported: none, cleanup: ok }, 'export_failure', 'infrastructure', 1, true],
    [{ install: pass, test: { status: 'failure', exitCode: 4 }, exported: none, cleanup: { state: 'failed' }, aborted: true }, 'test_failure', 'test_failure', 4, false],
    [{ install: pass, test: { status: 'cancelled', exitCode: null }, exported: ok, cleanup: ok, aborted: true }, 'cancelled', 'cancelled', 130, true],
    [{ install: { status: 'timed_out', exitCode: null }, test: { status: 'not_run' }, exported: ok, cleanup: ok }, 'timed_out', 'timed_out', 124, true],
    [{ install: null, test: null, exported: none, cleanup: ok, infrastructure: 'container_start_or_isolation_failed' }, 'infrastructure', 'infrastructure', 1, true],
    [{ install: pass, test: { status: 'not_run' }, exported: ok, cleanup: ok, infrastructure: 'boundary_recheck_failed' }, 'infrastructure', 'infrastructure', 1, true],
    [{ install: { status: 'engine_failed', exitCode: 126 }, test: { status: 'not_run' }, exported: ok, cleanup: ok }, 'install_failure', 'infrastructure', 1, true],
    [{ install: pass, test: { status: 'unknown', exitCode: null }, exported: ok, cleanup: ok }, 'unknown', 'infrastructure', 1, true],
    [{ install: pass, test: pass, exported: { state: 'skipped_no_budget' }, cleanup: ok }, 'export_failure', 'infrastructure', 1, true],
    [{ install: pass, test: pass, exported: ok, cleanup: { state: 'unverified' } }, 'cleanup_failure', 'incomplete_cleanup', 1, false],
    [{ install: null, test: null, exported: none, cleanup: { state: 'none' }, aborted: true }, 'cancelled', 'cancelled', 130, true],
  ];
  for (const [input, result, category, code, cleanupComplete] of rows) assert.deepEqual(classifyOutcome(input), { result, category, code, cleanupComplete }, result);
});

test('D8010 without an exporter a passing test is not successful proof', async t => {
  const f = engineFixture(t), s = supervisor(t, f, { exporter: null });
  assert.equal(await s.run(), 1);
  assert.deepEqual([s.outcome().category, s.outcome().result, s.outcome().test.status, s.outcome().export.state], ['infrastructure', 'export_failure', 'success', 'not_configured']);
});

test('D8007 the boundary is re-checked before tests: a failed or changed recheck runs no test and still cleans up', async t => {
  let f = engineFixture(t), s = supervisor(t, f, { recheck: async () => false });
  assert.equal(await s.run(), 1);
  assert.deepEqual([s.outcome().infrastructure, s.outcome().install.status, s.outcome().test.status, s.outcome().cleanup.state], ['boundary_recheck_failed', 'success', 'not_run', 'complete']);
  t.mock.timers.reset();
  f = engineFixture(t);
  s = supervisor(t, f, { recheck: async () => { s.job.owned.id = 'c'.repeat(64); return true; } });
  assert.equal(await s.run(), 1);
  assert.equal(s.outcome().infrastructure, 'boundary_recheck_failed');
  assert.equal(f.calls.filter(c => c[0] === 'exec' && c.includes('/bin/sh')).length, 0);
});
test('D7905 the interruptible phase returns observations from real processes and never removes the container', async t => {
  const f = engineFixture(t);
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const run = async (script, signal) => {
    const job = new JobContainer(POLICY, { engine: f.engine, spawnEngine: () => spawn('/bin/sh', ['-c', script], { stdio: 'ignore' }), stage: () => {}, namespace: () => true });
    await job.create(identity(), { source: f.source, plan: f.plan });
    const observed = await job.runCandidateInterruptible({ receipt: identity(), admitted: live(), signal, phase: 'test' });
    assert.ok(job.owned, 'still owned: removal is the supervisor\'s');
    await job.cleanup(identity());
    return observed;
  };
  assert.deepEqual(await run('exit 0'), { phase: 'test', status: 'success', exitCode: 0, signal: null });
  assert.deepEqual(await run('exit 9'), { phase: 'test', status: 'failure', exitCode: 9, signal: null });
  assert.deepEqual(await run('exit 125'), { phase: 'test', status: 'engine_failed', exitCode: 125, signal: null });
  const controller = new AbortController(); setTimeout(() => controller.abort(), 50);
  assert.equal((await run('sleep 30', controller.signal)).status, 'cancelled');
  const pre = new AbortController(); pre.abort();
  assert.equal((await run('exit 0', pre.signal)).status, 'cancelled');
  assert.equal(f.calls.filter(c => c[0] === 'rm').length, 5);
});

test('D7905 behaviour: SIGTERM to the real supervisor mid-test removes the container, clears its record and exits 130', async () => {
  const child = spawn(process.execPath, [new URL('./fixtures/runner_cancel_7905.mjs', import.meta.url).pathname], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  await new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => { out += chunk; if (out.includes('started\n') && !child.killed) child.kill('SIGTERM'); });
    child.once('error', reject); child.once('close', resolve);
  });
  assert.deepEqual(JSON.parse(out.trim().split('\n').at(-1)), { code: 130, result: 'cancelled', test: 'cancelled', cleanup: 'complete', removed: true, records: [] });
});

test('D7905 an abort or deadline that lands after the process exited, before close, keeps the real exit', async t => {
  const { EventEmitter } = await import('node:events');
  const f = engineFixture(t);
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  for (const late of ['abort', 'deadline']) {
    const child = new EventEmitter(); const kills = []; child.kill = s => kills.push(s);
    let fire = null;
    const job = new JobContainer(POLICY, { engine: f.engine, spawnEngine: () => child, stage: () => {}, namespace: () => true });
    await job.create(identity(), { source: f.source, plan: f.plan });
    const controller = new AbortController();
    const observed = job.runCandidateInterruptible({ receipt: identity(), admitted: live(), signal: controller.signal, phase: 'test', timers: { setTimeout: fn => { fire = fn; return 1; }, clearTimeout: () => {} } });
    await new Promise(resolve => setImmediate(resolve));
    child.emit('exit', 2, null);
    if (late === 'abort') controller.abort(); else fire();
    child.emit('close', 2, null);
    assert.deepEqual(await observed, { phase: 'test', status: 'failure', exitCode: 2, signal: null }, late);
    assert.deepEqual(kills, [], 'nothing to kill after exit');
    await job.cleanup(identity());
  }
});

test('D8007 run mode has no route but a verified boundary job: hosted, Mac and empty dependencies refuse', async () => {
  const { requireExecutionBoundary } = await import('../../scripts/ci/runner-execution.mjs');
  const { isolationFor } = await import('../../scripts/ci/runners/executor-isolation.mjs');
  for (const deps of [{}, undefined, isolationFor('hosted'), isolationFor('github-8'), isolationFor('macos-arm64'), { job: {} }, { executionIsolation: async () => true }]) {
    assert.throws(() => requireExecutionBoundary(deps), /execution_boundary_unavailable/);
  }
  const job = { id: 'container' };
  assert.equal(requireExecutionBoundary({ job, executionIsolation: async () => true }), job);
  const source = (await import('node:fs')).readFileSync(new URL('../../scripts/ci/runner-execution.mjs', import.meta.url), 'utf8');
  const run = source.split("return await withCancellation(async signal=>{")[1].split('\n });')[0];
  assert.match(run, /const job=requireExecutionBoundary\(dependencies\);/);
  assert.doesNotMatch(run, /executeShard\(/, 'the direct-host path is not reachable from run mode');
});

/**
 * S32 C3: an engine whose create performs its side effect but whose ID never reaches the supervisor (lost ack,
 * timeout, abort). `materialize` decides what the fixed name then resolves to.
 */
function lostCreate(f, { materialize = 'ours', inspectByName = null } = {}) {
  let created = null, removed = false;
  return args => {
    if (args[0] === 'create') {
      f.calls.push(args);
      f.engine(args); f.calls.pop();
      created = materialize; throw Object.assign(new Error('engine_call_timed_out'), { interrupted: true });
    }
    if (args[0] === 'inspect' && args[1] === '--type') {
      f.calls.push(args);
      if (inspectByName) throw inspectByName;
      if (created === null || removed || materialize === 'none') throw Object.assign(new Error('engine_call_failed'), { stderr: 'Error: No such container: studioos-job-202-1-1' });
      const row = JSON.parse(f.engine(['inspect', CID]))[0]; f.calls.pop();
      if (materialize === 'foreign') row.Image = 'sha256:' + 'f'.repeat(64);
      if (materialize === 'null') return JSON.stringify([null]);
      return JSON.stringify([row]);
    }
    if (args[0] === 'rm') removed = true;
    return f.engine(args);
  };
}
const runLost = async (t, f, engine, extra = {}) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const job = new JobContainer(POLICY, { engine, spawnEngine: realSpawn({ install: 'exit 0', test: 'exit 0' }), stage: () => {}, namespace: () => true });
  const logs = [];
  const code = await runInContainer({ job, executionIsolation: async () => true, admit: async () => live(), recheck: async () => true, current: { profile: { id: 'linux-x64' }, identity: identity() }, paths: { source: f.source }, planPath: f.plan, signal: new AbortController().signal, store: recoveryStore({ root: f.storeRoot, create: true }), exporter: completeExport, log: l => logs.push(l), ...extra });
  t.mock.timers.reset();
  return { code, job, o: JSON.parse(logs.find(l => l.includes('container_outcome'))) };
};

test('S32 C3: an unconfirmed create is reconciled by its exact name; only an exact match is adopted and removed by ID', async t => {
  const f = engineFixture(t);
  const { code, o, job } = await runLost(t, f, lostCreate(f, { materialize: 'ours' }));
  assert.equal(code, 1);
  assert.deepEqual([o.category, o.infrastructure, o.install, o.cleanup, o.cleanupComplete], ['infrastructure', 'container_creation_unconfirmed', null, { state: 'complete', reconciled: 'create_unconfirmed' }, true]);
  assert.deepEqual(f.calls.filter(c => c[0] === 'rm'), [['rm', '--force', CID]], 'removed by the exact ID the name resolved to');
  assert.equal(f.calls.some(c => c[0] === 'start'), false, 'an adopted container is never started');
  assert.deepEqual(job.createReconciliation, { state: 'exact', id: CID });
  assert.deepEqual(records(f), [], 'the intent and the adopted ID record are both gone after verified removal');
});

test('S32 C3: a foreign, absent or unreadable name is never removed; the durable intent is kept and cleanup is not complete', async t => {
  for (const [materialize, inspectByName, cleanup] of [
    ['foreign', null, { state: 'unknown', reason: 'create_name_conflict', retained: true }],
    ['none', null, { state: 'unverified', reason: 'create_unconfirmed_absent', retained: true }],
    ['ours', new Error('daemon timeout'), { state: 'unknown', reason: 'create_unconfirmed', retained: true }],
    ['null', null, { state: 'unknown', reason: 'create_unconfirmed', retained: true }],
  ]) {
    const f = engineFixture(t);
    const { code, o } = await runLost(t, f, lostCreate(f, { materialize, inspectByName }));
    assert.equal(code, 1, materialize);
    assert.deepEqual([o.category, o.cleanup, o.cleanupComplete], ['infrastructure', cleanup, false], materialize);
    assert.equal(f.calls.some(c => c[0] === 'rm'), false, `${materialize}: no deletion without an exact identity`);
    assert.deepEqual(records(f), ['202-1-1.create.json'], `${materialize}: the create intent is retained`);
  }
  // A failure before any create was attempted is still a genuine 'none', and writes no intent.
  const g = engineFixture(t);
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const before = new JobContainer(POLICY, { engine: g.engine, stage: () => { throw new Error('EPERM'); }, namespace: () => true });
  const logs2 = [];
  await runInContainer({ job: before, executionIsolation: async () => true, admit: async () => live(), recheck: async () => true, current: { profile: { id: 'linux-x64' }, identity: identity() }, paths: { source: g.source }, planPath: g.plan, signal: new AbortController().signal, store: recoveryStore({ root: g.storeRoot, create: true }), exporter: completeExport, log: l => logs2.push(l) });
  assert.deepEqual(JSON.parse(logs2.find(l => l.includes('container_outcome'))).cleanup, { state: 'none' });
  assert.deepEqual(records(g), []);
});

test('S32 C3: the intent is durable before create is asked, and an unrecordable intent means no create at all', async t => {
  const f = engineFixture(t);
  let atCreate = null;
  const engine = args => { if (args[0] === 'create') atCreate = records(f); return f.engine(args); };
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const job = new JobContainer(POLICY, { engine, stage: () => {}, namespace: () => true });
  const store = recoveryStore({ root: f.storeRoot, create: true });
  job.onCreateIntent = intent => store.writeIntent(intent);
  job.onOwned = record => store.write(record);
  await job.create(identity(), { source: f.source, plan: f.plan });
  assert.deepEqual(atCreate, ['202-1-1.create.json']);
  assert.deepEqual(records(f), ['202-1-1.json'], 'the exact ID record supersedes the intent');
  const g = engineFixture(t);
  const refused = new JobContainer(POLICY, { engine: g.engine, stage: () => {}, namespace: () => true });
  refused.onCreateIntent = () => { throw new Error('ENOSPC'); };
  await assert.rejects(refused.create(identity(), { source: g.source, plan: g.plan }), /container_intent_unrecorded/);
  assert.equal(g.calls.some(c => c[0] === 'create'), false);
  assert.equal(refused.createAttempted, false);
});

test('S32 C3: a retained intent is recovered by exact name later; a foreign name or unreadable engine keeps it', async t => {
  const intent = { version: 1, owner: '202-1-1', image: IMAGE, deadlineSeconds: Math.floor(DEADLINE / 1000) };
  const root = mkdtempSync(join(tmpdir(), 'intent-7905-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = recoveryStore({ root: join(root, 'containers'), create: true });
  store.writeIntent(intent);
  assert.deepEqual(store.list(), [{ intent }]);
  assert.throws(() => store.writeIntent(intent), /EEXIST/);
  const listed = () => readdirSync(join(root, 'containers'));
  // No intent reconciler configured: never dropped.
  assert.deepEqual(await recoverRetained(store, { recover: () => 'removed', verifyRemoved: () => true, log: () => {} }), [{ owner: '202-1-1', state: 'intent_unknown_retained' }]);
  const row = { Id: CID, Name: '/studioos-job-202-1-1', Image: IMAGE, Config: { Labels: { 'vc.axal.studioos.job': '202-1-1' }, Entrypoint: ['/bin/sh'], Cmd: ['-c', 'exec sleep "$(( STUDIOOS_JOB_DEADLINE - $(date +%s) - 1 ))"'], Env: [`STUDIOOS_JOB_DEADLINE=${intent.deadlineSeconds}`] } };
  const engineFor = (state) => { const seen = []; const engine = args => {
    seen.push(args);
    if (args[0] === 'inspect') { if (state.unreadable) throw new Error('daemon down'); if (state.gone) throw Object.assign(new Error('x'), { stderr: 'Error: No such object' }); return JSON.stringify([state.row]); }
    if (args[0] === 'rm') { assert.deepEqual(args, ['rm', '--force', CID]); state.gone = !state.survives; return ''; }
    throw new Error('unexpected ' + args[0]);
  }; return { engine, seen }; };
  const recoverWith = state => { const e = engineFor(state); return { e, run: () => recoverRetained(store, { recover: () => assert.fail(), verifyRemoved: () => assert.fail(), recoverIntent: i => JobContainer.recoverIntent(i, { engine: e.engine }), log: () => {} }) }; };
  let r = recoverWith({ row: { ...row, Image: 'sha256:' + 'f'.repeat(64) } });
  assert.deepEqual(await r.run(), [{ owner: '202-1-1', state: 'intent_conflict_retained' }]);
  assert.equal(r.e.seen.some(a => a[0] === 'rm'), false, 'a foreign object under the name is never removed');
  r = recoverWith({ unreadable: true });
  assert.deepEqual(await r.run(), [{ owner: '202-1-1', state: 'intent_failed_retained' }]);
  r = recoverWith({ row, survives: true });
  assert.deepEqual(await r.run(), [{ owner: '202-1-1', state: 'intent_unverified_retained' }]);
  assert.deepEqual(listed(), ['202-1-1.create.json']);
  r = recoverWith({ row });
  assert.deepEqual(await r.run(), [{ owner: '202-1-1', state: 'intent_removed' }]);
  assert.deepEqual(r.e.seen.map(a => a.slice(0, 2)), [['inspect', '--type'], ['rm', '--force'], ['inspect', CID], ['inspect', '--type']]);
  assert.deepEqual(listed(), []);
  store.writeIntent(intent);
  r = recoverWith({ gone: true });
  assert.deepEqual(await r.run(), [{ owner: '202-1-1', state: 'intent_absent' }]);
  assert.deepEqual(listed(), []);
});

test('S32 F1/F3: a full-length receipt ends work, export and three removal calls inside the 26-minute Run step', async t => {
  const { runStepDeadline, LINUX_RUN_STEP_MS, RUN_STEP_MARGIN_MS } = await import('../../scripts/ci/runner-execution.mjs');
  const { FINISH_RESERVE_MS, REMOVAL_RESERVE_MS } = await import('../../scripts/ci/runners/job-container.mjs');
  assert.equal(FINISH_RESERVE_MS, 150_000); assert.equal(REMOVAL_RESERVE_MS, 90_000, 'inspect + rm + absence check at 30s each');
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const f = engineFixture(t);
  const full = { ...identity(), executionDeadline: NOW + 1_590_000 };
  const step = runStepDeadline(NOW);
  assert.equal(step, NOW + LINUX_RUN_STEP_MS - RUN_STEP_MARGIN_MS);
  const job = new JobContainer(POLICY, { engine: f.engine, stage: () => {}, namespace: () => true });
  job.workDeadline = Math.min(full.executionDeadline, step);
  await job.create(full, { source: f.source, plan: f.plan });
  const { timeout } = await job.candidateExec({ receipt: full, admitted: { ...live(), identity: full }, phase: 'test' });
  // Work + export reserve + three 30s removal calls cannot pass the wrapper (the old code reached 1,589,999ms).
  assert.ok(NOW + timeout + FINISH_RESERVE_MS <= step, `${NOW + timeout + FINISH_RESERVE_MS} <= ${step}`);
  assert.ok(step < NOW + LINUX_RUN_STEP_MS);
  const wf = (await import('node:fs')).readFileSync(new URL('../../.github/workflows/runner-executor.yml', import.meta.url), 'utf8');
  assert.match(wf, /timeout-minutes: \$\{\{ inputs\.profile == 'hosted' && 41 \|\| inputs\.profile == 'github-8' && 29 \|\| 26 \}\}/, 'the Linux Run wrapper the executor bounds itself by');
});

test('S32 F3: the supervisor applies the Run step wrapper to the job before any work starts', async t => {
  const f = engineFixture(t);
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const timeouts = [];
  const job = new JobContainer(POLICY, { engine: f.engine, stage: () => {}, namespace: () => true, spawnEngine: () => spawn('/bin/sh', ['-c', 'exit 0'], { stdio: 'ignore' }) });
  const exec = job.candidateExec.bind(job);
  job.candidateExec = async options => { const planned = await exec(options); timeouts.push(planned.timeout); return planned; };
  const step = NOW + 300_000; // earlier than the receipt's NOW + 600_000
  await runInContainer({ job, executionIsolation: async () => true, admit: async () => live(), recheck: async () => true, current: { profile: { id: 'linux-x64' }, identity: identity() }, paths: { source: f.source }, planPath: f.plan, signal: new AbortController().signal, store: recoveryStore({ root: f.storeRoot, create: true }), exporter: completeExport, log: () => {}, stepDeadline: step });
  assert.equal(job.workDeadline, step);
  assert.ok(timeouts.length === 2 && timeouts.every(ms => ms === step - 150_000 - NOW), JSON.stringify(timeouts));
});

test('S32 F6: the engine client is bounded and interruptible on real processes, and an interrupted call is marked ambiguous', async () => {
  const { boundedClient, callBudget, ENGINE_CALL_MS } = await import('../../scripts/ci/runners/job-container.mjs');
  const client = boundedClient('/bin/sh', { spawnProcess: args => spawn('/bin/sh', ['-c', args[0]], { stdio: ['ignore', 'pipe', 'pipe'] }) });
  assert.equal(await client(['printf ok']), 'ok');
  await assert.rejects(client(['echo "Error: No such object" >&2; exit 1']), e => e.code === 'engine_call_failed' && e.status === 1 && /No such object/.test(e.stderr) && e.interrupted === false);
  let started = performance.now();
  await assert.rejects(client(['sleep 30'], { timeout: 100 }), e => e.code === 'engine_call_timed_out' && e.interrupted === true);
  assert.ok(performance.now() - started < 5000, 'killed at its timeout, not after the command');
  const controller = new AbortController(); setTimeout(() => controller.abort(), 50);
  started = performance.now();
  await assert.rejects(client(['sleep 30'], { signal: controller.signal }), e => e.code === 'engine_call_cancelled' && e.interrupted === true);
  assert.ok(performance.now() - started < 5000);
  await assert.rejects(client(['true'], { signal: controller.signal }), e => e.code === 'engine_call_cancelled' && e.started === false, 'an aborted signal starts nothing');
  await assert.rejects(client(['true'], { timeout: 0 }), e => e.code === 'engine_budget_exhausted' && e.started === false);
  await assert.rejects(client(['head -c 1100000 /dev/zero']), e => e.code === 'engine_output_limit');
  await assert.rejects(boundedClient('/nonexistent/docker')(['version']), e => e.code === 'engine_unavailable' && e.interrupted === false);
  assert.equal(callBudget(Infinity, 0), ENGINE_CALL_MS);
  assert.equal(callBudget(1_000, 0), 1_000);
  assert.throws(() => callBudget(0, 0), /engine_budget_exhausted/);
});

test('S32 F6: a cancel during a hanging engine call stops it, and removal still runs (it is never cancellable)', async t => {
  const { boundedClient } = await import('../../scripts/ci/runners/job-container.mjs');
  const f = engineFixture(t);
  const hanging = boundedClient('/bin/sh', { spawnProcess: () => spawn('/bin/sh', ['-c', 'sleep 30'], { stdio: ['ignore', 'pipe', 'pipe'] }) });
  const removalSignals = [];
  const engine = (args, options) => {
    if (args[0] === 'start') { f.calls.push(args); return hanging(args, options); }
    if (args[0] === 'rm' || (args[0] === 'inspect' && f.calls.some(c => c[0] === 'start'))) removalSignals.push(options?.signal ?? null);
    return f.engine(args);
  };
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const job = new JobContainer(POLICY, { engine, spawnEngine: realSpawn({ install: 'exit 0', test: 'exit 0' }), stage: () => {}, namespace: () => true });
  const controller = new AbortController(); setTimeout(() => controller.abort(), 50);
  const logs = [];
  const started = performance.now();
  const code = await runInContainer({ job, executionIsolation: async () => true, admit: async () => live(), recheck: async () => true, current: { profile: { id: 'linux-x64' }, identity: identity() }, paths: { source: f.source }, planPath: f.plan, signal: controller.signal, store: recoveryStore({ root: f.storeRoot, create: true }), exporter: completeExport, log: l => logs.push(l) });
  const o = JSON.parse(logs.find(l => l.includes('container_outcome')));
  assert.ok(performance.now() - started < 5000, 'the hung start was killed');
  assert.deepEqual([code, o.category, o.cleanup.state, o.install], [130, 'cancelled', 'complete', null]);
  assert.ok(removalSignals.length >= 2 && removalSignals.every(s => s === null), 'inspect and rm carry no cancellation signal');
  assert.deepEqual(records(f), []);
});

test('S32 F1/F3: every mandatory phase is bounded inside the lifecycle bound; a hung admission or recheck cannot eat the reserves', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const run = async ({ admit = async () => live(), recheck = async () => true }) => {
    const f = engineFixture(t), seen = [];
    const engine = (args, options) => { seen.push({ op: args[0], timeout: options?.timeout }); return f.engine(args); };
    const job = new JobContainer(POLICY, { engine, spawnEngine: realSpawn({ install: 'exit 0', test: 'exit 0' }), stage: () => {}, namespace: () => true });
    // The step wrapper leaves 300ms of work before the 150s finish reserve.
    const step = NOW + FINISH_RESERVE_MS + 300, logs = [];
    const started = performance.now();
    const code = await runInContainer({ job, executionIsolation: async () => true, admit, recheck, current: { profile: { id: 'linux-x64' }, identity: identity() }, paths: { source: f.source }, planPath: f.plan, signal: new AbortController().signal, store: recoveryStore({ root: f.storeRoot, create: true }), exporter: completeExport, log: l => logs.push(l), stepDeadline: step });
    return { code, f, seen, step, elapsed: performance.now() - started, o: JSON.parse(logs.find(l => l.includes('container_outcome'))) };
  };
  const never = () => new Promise(() => {});
  for (const [name, options, infrastructure] of [['admission', { admit: never }, 'admission_budget_exhausted'], ['recheck', { recheck: never }, 'recheck_budget_exhausted']]) {
    const r = await run(options);
    assert.ok(r.elapsed < 3000, `${name}: stopped at the work deadline (${r.elapsed}ms)`);
    assert.deepEqual([r.code, r.o.infrastructure, r.o.test?.status ?? null, r.o.cleanup.state], [1, infrastructure, name === 'recheck' ? 'not_run' : null, 'complete'], name);
    // Every engine call carried a budget no larger than ENGINE_CALL_MS and no later than the bound.
    assert.ok(r.seen.every(c => Number.isSafeInteger(c.timeout) && c.timeout > 0 && c.timeout <= 30_000 && NOW + c.timeout <= r.step), JSON.stringify(r.seen));
    // Pre-test calls end by the work deadline; removal calls end by the bound.
    const removal = r.seen.slice(r.seen.findIndex(c => c.op === 'rm') - 1);
    assert.deepEqual(removal.map(c => c.op), ['inspect', 'rm', 'inspect'], name);
    for (const c of r.seen.slice(0, r.seen.length - 3)) assert.ok(NOW + c.timeout <= r.step - FINISH_RESERVE_MS, `${name}: ${c.op} ${c.timeout}`);
  }
});

test('S32 F1/F3: a work deadline already past refuses create before any engine call, and the export window is the bound less removal', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const f = engineFixture(t), logs = [];
  let exportDeadline = null;
  const job = new JobContainer(POLICY, { engine: f.engine, stage: () => {}, namespace: () => true });
  await runInContainer({ job, executionIsolation: async () => true, admit: async () => live(), current: { profile: { id: 'linux-x64' }, identity: identity() }, paths: { source: f.source }, planPath: f.plan, signal: new AbortController().signal, store: recoveryStore({ root: f.storeRoot, create: true }), exporter: async a => { exportDeadline = a.deadline; return { state: 'complete' }; }, log: l => logs.push(l), stepDeadline: NOW + FINISH_RESERVE_MS });
  const o = JSON.parse(logs.find(l => l.includes('container_outcome')));
  assert.deepEqual([o.infrastructure, o.cleanup.state, f.calls.length, exportDeadline], ['insufficient_execution_budget', 'none', 0, null]);
  const step = NOW + 400_000;
  const g = engineFixture(t), job2 = new JobContainer(POLICY, { engine: g.engine, spawnEngine: realSpawn({ install: 'exit 0', test: 'exit 0' }), stage: () => {}, namespace: () => true });
  await runInContainer({ job: job2, executionIsolation: async () => true, admit: async () => live(), recheck: async () => true, current: { profile: { id: 'linux-x64' }, identity: identity() }, paths: { source: g.source }, planPath: g.plan, signal: new AbortController().signal, store: recoveryStore({ root: g.storeRoot, create: true }), exporter: async a => { exportDeadline = a.deadline; return { state: 'complete' }; }, log: () => {}, stepDeadline: step });
  assert.equal(exportDeadline, step - 90_000);
});

test('S32 F1/F3: removal that starts late still ends by the bound: inspect, rm and the absence check get only what is left', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const f = engineFixture(t), seen = [];
  const engine = (args, options) => { seen.push({ op: args[0], timeout: options?.timeout, at: Date.now() }); return f.engine(args); };
  const job = new JobContainer(POLICY, { engine, spawnEngine: realSpawn({ install: 'exit 0', test: 'exit 0' }), stage: () => {}, namespace: () => true });
  const step = NOW + 400_000;
  // The export returns 10s before the bound (it overran its own window); removal must not run past the bound.
  const exporter = async () => { t.mock.timers.tick(step - 10_000 - Date.now()); return { state: 'complete' }; };
  const logs = [];
  await runInContainer({ job, executionIsolation: async () => true, admit: async () => live(), recheck: async () => true, current: { profile: { id: 'linux-x64' }, identity: identity() }, paths: { source: f.source }, planPath: f.plan, signal: new AbortController().signal, store: recoveryStore({ root: f.storeRoot, create: true }), exporter, log: l => logs.push(l), stepDeadline: step });
  const removal = seen.slice(-3);
  assert.deepEqual(removal.map(c => c.op), ['inspect', 'rm', 'inspect']);
  assert.ok(removal.every(c => c.timeout > 0 && c.at + c.timeout <= step), JSON.stringify(removal));
  assert.equal(JSON.parse(logs.find(l => l.includes('container_outcome'))).cleanup.state, 'complete');
});

test('S32 durable tail: a run whose synchronous store work ends past the lifecycle bound is never reported as success', async t => {
  const step = NOW + 400_000;
  const run = async ({ test = 'exit 0' } = {}) => {
    t.mock.timers.reset(); t.mock.timers.enable({ apis: ['Date'], now: NOW });
    const f = engineFixture(t);
    const job = new JobContainer(POLICY, { engine: f.engine, spawnEngine: realSpawn({ install: 'exit 0', test }), stage: () => {}, namespace: () => true });
    // S32's model: the export returns, and inspect, rm and the absence check finish, 1ms before the bound;
    // then 60s of durable-store work runs around the real, synchronous record removal.
    const exporter = async () => { t.mock.timers.tick(step - 1 - Date.now()); return { state: 'complete' }; };
    const real = recoveryStore({ root: f.storeRoot, create: true });
    const store = { ...real, remove: owner => { t.mock.timers.tick(60_000); real.remove(owner); } };
    const logs = [], outputs = [];
    const code = await runInContainer({ job, executionIsolation: async () => true, admit: async () => live(), recheck: async () => true, current: { profile: { id: 'linux-x64' }, identity: identity() }, paths: { source: f.source }, planPath: f.plan, signal: new AbortController().signal, store, exporter, log: l => logs.push(l), output: o => outputs.push(o), stepDeadline: step });
    return { code, f, outputs, o: JSON.parse(logs.find(l => l.includes('container_outcome'))) };
  };
  let r = await run();
  assert.deepEqual([r.code, r.o.result, r.o.category, r.o.cleanup.state, r.o.lifecycle], [1, 'deadline_overrun', 'infrastructure', 'complete', { overran: true, overrunMs: 59_999 }]);
  assert.deepEqual(records(r.f), [], 'the removal itself completed and was recorded');
  assert.equal(r.outputs[0].result, 'deadline_overrun');
  // A real test failure observed before the overrun keeps its raw exit.
  r = await run({ test: 'exit 3' });
  assert.deepEqual([r.code, r.o.result], [3, 'test_failure']);
});

test('S32 durable tail: classification keeps success only inside the bound', () => {
  const ok = { state: 'complete' }, pass = { status: 'success', exitCode: 0 };
  assert.deepEqual(classifyOutcome({ install: pass, test: pass, exported: ok, cleanup: ok, overran: false }), { result: 'success', category: 'success', code: 0, cleanupComplete: true });
  assert.deepEqual(classifyOutcome({ install: pass, test: pass, exported: ok, cleanup: ok, overran: true }), { result: 'deadline_overrun', category: 'infrastructure', code: 1, cleanupComplete: true });
  assert.deepEqual(classifyOutcome({ install: pass, test: { status: 'failure', exitCode: 4 }, exported: ok, cleanup: ok, overran: true }).code, 4);
  assert.deepEqual(classifyOutcome({ install: pass, test: { status: 'cancelled' }, exported: ok, cleanup: ok, overran: true, aborted: true }).code, 130);
});
