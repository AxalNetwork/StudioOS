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
const realSpawn = scripts => args => {
  const script = args.at(-1).includes('npm ci') ? scripts.install : scripts.test;
  return spawn('/bin/sh', ['-c', script], { stdio: 'ignore' });
};
function supervisor(t, f, { scripts = { install: 'exit 0', test: 'exit 0' }, admit = async () => live(), signal = new AbortController().signal, exporter = null } = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const job = new JobContainer(POLICY, { engine: f.engine, spawnEngine: realSpawn(scripts), stage: () => {}, namespace: () => true });
  const store = recoveryStore({ root: f.storeRoot, create: true });
  const logs = [], outputs = [];
  const run = () => runInContainer({ job, executionIsolation: async () => true, admit, current: { profile: { id: 'linux-x64' }, identity: identity() }, paths: { source: f.source }, planPath: f.plan, signal, store, exporter, log: l => logs.push(l), output: o => outputs.push(o) });
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
  assert.deepEqual([o.install.status, o.test.status, o.test.exitCode, o.cleanup.state, o.export.state], ['success', 'success', 0, 'complete', 'not_configured']);
  const execs = f.calls.filter(c => c[0] === 'exec' && c.includes('/bin/sh')).map(c => c.at(-1));
  assert.equal(execs.length, 0, 'phases go through the interruptible spawner, not the sync engine');
  assert.deepEqual(f.calls.filter(c => c[0] === 'rm'), [['rm', '--force', CID]]);
  assert.deepEqual(records(f), []);
  assert.deepEqual(s.outputs, [{ result: 'success', test_exit: 0, cleanup: 'complete', export: 'not_configured' }]);
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
  let s = supervisor(t, f, { scripts: { install: 'exit 0', test: 'sleep 30' }, signal: controller.signal });
  const running = s.run(); setTimeout(() => controller.abort(), 100);
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
    assert.deepEqual([s.outcome().result, s.outcome().test.status, s.outcome().cleanup.state, s.outcome().cleanup.retained], ['cleanup_failure', 'success', state, true]);
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

test('D8009 the absolute deadline: staging time never extends the lease, and work stops a reserve before it', t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const f = engineFixture(t);
  // Staging consumes 200s; the container deadline stays the receipt's absolute second.
  let job = new JobContainer(POLICY, { engine: f.engine, stage: () => t.mock.timers.tick(200000), namespace: () => true });
  job.create(identity(), { source: f.source, plan: f.plan });
  const create = f.calls.find(c => c[0] === 'create');
  assert.ok(create.includes(`STUDIOOS_JOB_DEADLINE=${Math.floor(DEADLINE / 1000)}`));
  const { timeout } = job.candidateExec({ receipt: identity(), admitted: live(), phase: 'test' });
  assert.equal(timeout, DEADLINE - FINISH_RESERVE_MS - (NOW + 200000), 'work ends the reserve before the absolute deadline');
  // Staging that runs into the reserve refuses before any container exists.
  const g = engineFixture(t);
  job = new JobContainer(POLICY, { engine: g.engine, stage: () => t.mock.timers.tick(DEADLINE - Date.now() - FINISH_RESERVE_MS), namespace: () => true });
  assert.throws(() => job.create(identity(), { source: g.source, plan: g.plan }), /insufficient_execution_budget/);
  assert.equal(g.calls.some(c => c[0] === 'create'), false);
});

test('D8010 export runs while the container still exists, inside the lease; a failed or skipped export blocks success', async t => {
  let f = engineFixture(t), seen = null;
  let s = supervisor(t, f, { exporter: async args => { seen = { args, rmBefore: f.calls.some(c => c[0] === 'rm') }; return { state: 'complete' }; } });
  assert.equal(await s.run(), 0);
  assert.deepEqual([seen.rmBefore, seen.args.container, seen.args.observedTest.status, seen.args.deadline], [false, { id: CID, owner: '202-1-1' }, 'success', DEADLINE - 60000]);
  t.mock.timers.reset();
  f = engineFixture(t); s = supervisor(t, f, { exporter: async () => { throw new Error('stream truncated'); } });
  assert.equal(await s.run(), 1);
  assert.deepEqual([s.outcome().result, s.outcome().export.state, s.outcome().cleanup.state], ['export_failure', 'failed', 'complete']);
  t.mock.timers.reset();
  f = engineFixture(t); s = supervisor(t, f, { scripts: { install: 'exit 0', test: 'exit 5' }, exporter: async () => ({ state: 'failed' }) });
  assert.equal(await s.run(), 5, 'a known test failure survives a failed export');
});

test('D8010 classification precedence is fixed: real test exit, cancelled, timed out, then infrastructure', () => {
  const ok = { state: 'complete' }, none = { state: 'not_configured' };
  const pass = { status: 'success', exitCode: 0 };
  const rows = [
    [{ install: pass, test: pass, exported: none, cleanup: ok }, 'success', 0],
    [{ install: pass, test: { status: 'failure', exitCode: 4 }, exported: none, cleanup: { state: 'failed' }, aborted: true }, 'test_failure', 4],
    [{ install: pass, test: { status: 'cancelled', exitCode: null }, exported: none, cleanup: ok, aborted: true }, 'cancelled', 130],
    [{ install: { status: 'timed_out', exitCode: null }, test: { status: 'not_run' }, exported: none, cleanup: ok }, 'timed_out', 124],
    [{ install: null, test: null, exported: none, cleanup: ok, infrastructure: 'container_start_or_isolation_failed' }, 'infrastructure', 1],
    [{ install: { status: 'engine_failed', exitCode: 126 }, test: { status: 'not_run' }, exported: none, cleanup: ok }, 'install_failure', 1],
    [{ install: pass, test: { status: 'unknown', exitCode: null }, exported: none, cleanup: ok }, 'unknown', 1],
    [{ install: pass, test: pass, exported: { state: 'skipped_no_budget' }, cleanup: ok }, 'export_failure', 1],
    [{ install: pass, test: pass, exported: none, cleanup: { state: 'unverified' } }, 'cleanup_failure', 1],
    [{ install: null, test: null, exported: none, cleanup: { state: 'none' }, aborted: true }, 'cancelled', 130],
  ];
  for (const [input, result, code] of rows) assert.deepEqual(classifyOutcome(input), { result, code }, result);
});

test('D7905 the interruptible phase returns observations from real processes and never removes the container', async t => {
  const f = engineFixture(t);
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const run = async (script, signal) => {
    const job = new JobContainer(POLICY, { engine: f.engine, spawnEngine: () => spawn('/bin/sh', ['-c', script], { stdio: 'ignore' }), stage: () => {}, namespace: () => true });
    job.create(identity(), { source: f.source, plan: f.plan });
    const observed = await job.runCandidateInterruptible({ receipt: identity(), admitted: live(), signal, phase: 'test' });
    assert.ok(job.owned, 'still owned: removal is the supervisor\'s');
    job.cleanup(identity());
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
    job.create(identity(), { source: f.source, plan: f.plan });
    const controller = new AbortController();
    const observed = job.runCandidateInterruptible({ receipt: identity(), admitted: live(), signal: controller.signal, phase: 'test', timers: { setTimeout: fn => { fire = fn; return 1; }, clearTimeout: () => {} } });
    child.emit('exit', 2, null);
    if (late === 'abort') controller.abort(); else fire();
    child.emit('close', 2, null);
    assert.deepEqual(await observed, { phase: 'test', status: 'failure', exitCode: 2, signal: null }, late);
    assert.deepEqual(kills, [], 'nothing to kill after exit');
    job.cleanup(identity());
  }
});
