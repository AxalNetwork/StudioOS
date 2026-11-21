/** D7905: the trusted executor binds the Linux container boundary; nothing else counts as isolation evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolationFor, linuxExecutorDependencies, LINUX_POLICY_PATH } from '../../scripts/ci/runners/executor-isolation.mjs';
import { JobContainer, aclStage } from '../../scripts/ci/runners/job-container.mjs';
import { containerRecordPath, recoverOwned, runInContainer } from '../../scripts/ci/runner-execution.mjs';
import { trustedAuthority } from '../../scripts/ci/executor-authority.mjs';
const POLICY = { version: 1, image: 'sha256:' + 'a'.repeat(64), nodeVersion: '22.23.3', pythonVersion: '3.11.18' };
const context = { repository: 'AxalNetwork/StudioOS', childRunId: '202', childAttempt: '1' };
const receipt = { profile: 'linux-x64', childRunId: 202, childAttempt: 1 };
const deps = extra => linuxExecutorDependencies({ readPolicy: () => POLICY, engine: () => '27.0', platform: 'linux', aclTool: () => true, ...extra });
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('D7905 only linux-x64 has an isolation implementation; Mac, hosted and github-8 get none', () => {
  for (const id of ['macos-arm64', 'hosted', 'github-8', undefined, 'LINUX-X64']) assert.equal(isolationFor(id), null);
  const linux = isolationFor('linux-x64', { readPolicy: () => POLICY, engine: () => '', platform: 'linux' });
  assert.equal(typeof linux.admissionIsolation, 'function');
  assert.equal(typeof linux.executionIsolation, 'function');
});

test('D7905 a missing, untrusted or non-Linux setup fails closed before any adapter exists', () => {
  assert.throws(() => linuxExecutorDependencies({ readPolicy: () => { throw new Error('untrusted_container_policy'); }, platform: 'linux' }), /untrusted_container_policy/);
  assert.throws(() => linuxExecutorDependencies({ readPolicy: () => POLICY, platform: 'darwin' }), /linux_isolation_unavailable/);
  assert.throws(() => linuxExecutorDependencies({ readPolicy: () => ({ ...POLICY, image: 'ubuntu:latest' }), platform: 'linux' }), /unreviewed_container_runtime/);
  assert.equal(LINUX_POLICY_PATH, '/etc/studioos/job-container-policy.json');
});

test('D7905 admission readiness needs the exact repository, linux-x64, a reachable engine and setfacl', async () => {
  const seen = [];
  const { admissionIsolation } = deps({ engine: args => { seen.push(args); return '27.0\n'; } });
  assert.equal(await admissionIsolation({ receipt, context, profile: { id: 'linux-x64' } }), true);
  assert.deepEqual(seen, [['version', '--format', '{{.Server.Version}}']]);
  assert.equal(await admissionIsolation({ receipt, context: { ...context, repository: 'Evil/Fork' }, profile: { id: 'linux-x64' } }), false);
  assert.equal(await admissionIsolation({ receipt, context, profile: { id: 'macos-arm64' } }), false);
  assert.equal(await admissionIsolation({ receipt: { ...receipt, profile: 'macos-arm64' }, context, profile: { id: 'linux-x64' } }), false);
  assert.equal(await admissionIsolation({}), false);
  assert.equal(await deps({ engine: () => { throw new Error('no engine'); } }).admissionIsolation({ receipt, context, profile: { id: 'linux-x64' } }), false);
  assert.equal(await deps({ aclTool: () => { throw new Error('ENOENT'); } }).admissionIsolation({ receipt, context, profile: { id: 'linux-x64' } }), false);
});

test('D7905 execution isolation is false until a live container is owned, so readiness cannot authorise a run', async () => {
  assert.equal(await deps().executionIsolation({ receipt, context, profile: { id: 'linux-x64' } }), false);
});

test('D7905 staging grants only the candidate UID read on exactly the source tree and plan, never through a link', () => {
  const calls = [];
  aclStage({ source: '/run/src', plan: '/run/plan.json' }, args => calls.push(args));
  assert.deepEqual(calls, [['-R', '-P', '-m', 'u:10000:rX', '--', '/run/src'], ['-m', 'u:10000:r', '--', '/run/plan.json']]);
});

const canRunAs = process.getuid?.() === 0 && spawnSync('/usr/bin/setfacl', ['--version']).status === 0 && spawnSync('/usr/bin/setpriv', ['--version']).status === 0;
test('D7905 behaviour: under umask 0077 the candidate UID reads the staged inputs and nothing else of the listener', { skip: canRunAs ? false : 'needs root, setfacl and setpriv to switch to the candidate UID' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'acl-7905-'));
  try {
    const source = join(root, 'source'), plan = join(root, 'plan.json'), secret = join(root, '.credentials');
    mkdirSync(join(source, 'scripts'), { recursive: true });
    writeFileSync(join(source, 'package.json'), '{}'); writeFileSync(join(source, 'scripts', 'a.mjs'), '');
    writeFileSync(plan, '{}'); writeFileSync(secret, 'listener-only');
    spawnSync('/usr/bin/ln', ['-s', secret, join(source, 'creds')]);
    for (const [path, mode] of [[root, 0o700], [source, 0o700], [join(source, 'scripts'), 0o700], [join(source, 'package.json'), 0o600], [join(source, 'scripts', 'a.mjs'), 0o600], [plan, 0o600], [secret, 0o600]]) chmodSync(path, mode);
    // The listener is a distinct system UID; the candidate is 10000.
    spawnSync('/usr/bin/chown', ['-hR', '10001:10001', root]);
    const asCandidate = path => spawnSync('/usr/bin/setpriv', ['--reuid=10000', '--regid=10000', '--clear-groups', '/usr/bin/cat', path]).status;
    assert.notEqual(spawnSync('/usr/bin/setpriv', ['--reuid=10000', '--regid=10000', '--clear-groups', '/usr/bin/test', '-r', plan]).status, 0, 'unreadable before staging');
    aclStage({ source, plan });
    // Inside the container the bind mount starts at the inputs, so the parent's mode does not apply; grant
    // traverse here only to imitate that.
    spawnSync('/usr/bin/setfacl', ['-m', 'u:10000:x', root]);
    assert.equal(asCandidate(plan), 0, 'plan readable');
    assert.equal(asCandidate(join(source, 'package.json')), 0, 'source readable');
    assert.equal(asCandidate(join(source, 'scripts', 'a.mjs')), 0, 'nested source readable');
    assert.notEqual(asCandidate(secret), 0, 'listener secret stays unreadable');
    assert.notEqual(asCandidate(join(source, 'creds')), 0, 'a link in the source does not open its target');
    assert.notEqual(spawnSync('/usr/bin/setpriv', ['--reuid=10000', '--regid=10000', '--clear-groups', '/usr/bin/touch', join(source, 'new')]).status, 0, 'source stays read-only');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('D7905 failed staging creates no container', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1800000000000 });
  const root = mkdtempSync(join(tmpdir(), 'stage-7905-'));
  try {
    const source = join(root, 'source'), plan = join(root, 'plan.json');
    mkdirSync(source); writeFileSync(plan, '{}');
    const calls = [];
    const job = new JobContainer(POLICY, { engine: args => { calls.push(args); return ''; }, stage: () => { throw new Error('EPERM'); }, namespace: () => true });
    assert.throws(() => job.create({ version: 1, repository: 'AxalNetwork/StudioOS', profile: 'linux-x64', sourceSha: 'e'.repeat(40), event: 'push', childRunId: 202, childAttempt: 1, generation: 1, requestId: '00000000-0000-4000-8000-000000000001', logicalShard: 'worker-1-of-6', executionDeadline: 1800000060000 }, { source, plan }), /container_input_staging_failed/);
    assert.equal(calls.length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function fakeJob({ create, run, cleanup } = {}) {
  const events = [];
  const job = {
    owned: null, onOwned: null, events,
    create(identity) { events.push('create'); if (create) return create.call(this, identity); this.owned = { id: 'c' }; this.onOwned({ version: 1, id: 'c'.repeat(64), owner: '202-1-1' }); },
    async runCandidateInterruptible(args) { events.push('run'); if (run) return run(args); },
    cleanup() { events.push('cleanup'); if (cleanup) return cleanup.call(this); this.owned = null; },
  };
  return job;
}
function runFixture(t) {
  const temp = mkdtempSync(join(tmpdir(), 'run-7905-')); t.after(() => rmSync(temp, { recursive: true, force: true }));
  const identity = { profile: 'linux-x64', requestId: 'r' };
  return { paths: { temp, source: join(temp, 'source') }, identity, current: { profile: { id: 'linux-x64' }, identity }, planPath: join(temp, 'plan') };
}
const go = (f, job, extra = {}) => runInContainer({ job, executionIsolation: async () => true, admit: async () => ({ allowed: true, identity: f.identity }), current: f.current, paths: f.paths, planPath: f.planPath, signal: new AbortController().signal, log: () => {}, ...extra });

test('D7905 success: create, live re-admission, interruptible run, exact cleanup, record removed', async t => {
  const f = runFixture(t), job = fakeJob();
  let admittedWith;
  assert.equal(await go(f, job, { admit: async verify => { admittedWith = verify; assert.ok(existsSync(containerRecordPath(f.paths)), 'record exists before the run'); return { allowed: true, identity: f.identity }; } }), 0);
  assert.equal(typeof admittedWith, 'function');
  assert.deepEqual(job.events, ['create', 'run', 'cleanup']);
  assert.equal(existsSync(containerRecordPath(f.paths)), false);
});

test('D7905 a rejected or superseded re-admission never runs the candidate and still cleans up', async t => {
  for (const live of [{ allowed: false, reason: 'execution_isolation_unverified' }, { allowed: true, identity: { profile: 'linux-x64', requestId: 'other' } }]) {
    const f = runFixture(t), job = fakeJob();
    assert.equal(await go(f, job, { admit: async () => live }), 1);
    assert.deepEqual(job.events, ['create', 'cleanup']);
  }
});

test('D7905 a candidate failure exits 1, a timeout 124, a cancellation 130, each after cleanup', async t => {
  for (const [reason, code] of [['candidate_failed', 1], ['execution_timed_out', 124]]) {
    const f = runFixture(t), job = fakeJob({ run: async () => { throw new Error(reason); } });
    assert.equal(await go(f, job), code, reason);
    assert.deepEqual(job.events, ['create', 'run', 'cleanup']);
  }
  const f = runFixture(t), controller = new AbortController();
  const job = fakeJob({ run: ({ signal }) => new Promise((_, reject) => { signal.addEventListener('abort', () => reject(new Error('execution_cancelled'))); controller.abort(); }) });
  assert.equal(await go(f, job, { signal: controller.signal }), 130);
  assert.deepEqual(job.events, ['create', 'run', 'cleanup']);
  const early = runFixture(t), aborted = new AbortController(); aborted.abort();
  const none = fakeJob();
  assert.equal(await go(early, none, { signal: aborted.signal }), 130);
  assert.deepEqual(none.events, ['cleanup'], 'a stop before create creates nothing');
});

test('D7905 a failed cleanup keeps the record for the workflow cleanup step and fails the run', async t => {
  const f = runFixture(t), job = fakeJob({ cleanup() { throw new Error('engine down'); } });
  assert.equal(await go(f, job), 1);
  assert.deepEqual(JSON.parse(readFileSync(containerRecordPath(f.paths), 'utf8')), { version: 1, id: 'c'.repeat(64), owner: '202-1-1' });
});

test('D7905 behaviour: SIGTERM during the candidate run reaches cleanup and exits 130', async () => {
  const child = spawn(process.execPath, [new URL('./fixtures/runner_cancel_7905.mjs', import.meta.url).pathname], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  await new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => { out += chunk; if (out.includes('started\n') && !child.killed) child.kill('SIGTERM'); });
    child.once('error', reject); child.once('close', resolve);
  });
  const result = JSON.parse(out.trim().split('\n').at(-1));
  assert.deepEqual(result, { code: 130, events: ['create', 'run', 'cleanup'], recordLeft: false });
});

test('D7905 the interruptible run kills the engine client on abort or deadline and always removes the container', async () => {
  const make = () => {
    const calls = [], kills = [];
    const job = new JobContainer(POLICY, { engine: args => { calls.push(args); return '[]'; }, spawnEngine: () => { const c = new EventEmitter(); c.kill = s => { kills.push(s); queueMicrotask(() => c.emit('close', null)); }; job.child = c; return c; } });
    job.candidateExec = () => ({ args: ['exec'], timeout: 50 });
    job.cleanup = () => calls.push(['cleanup']);
    return { job, calls, kills };
  };
  const timers = { setTimeout: () => 1, clearTimeout: () => {} };
  let m = make(); const ok = m.job.runCandidateInterruptible({ timers }); m.job.child.emit('close', 0); await ok;
  assert.deepEqual(m.calls, [['cleanup']]);
  m = make(); const bad = m.job.runCandidateInterruptible({ timers }); m.job.child.emit('close', 3);
  await assert.rejects(bad, /candidate_failed/); assert.deepEqual(m.calls, [['cleanup']]);
  m = make(); const controller = new AbortController(); const stopped = m.job.runCandidateInterruptible({ signal: controller.signal, timers }); controller.abort();
  await assert.rejects(stopped, /execution_cancelled/); assert.deepEqual(m.kills, ['SIGKILL']); assert.deepEqual(m.calls, [['cleanup']]);
  m = make(); let fire; const late = m.job.runCandidateInterruptible({ timers: { setTimeout: fn => { fire = fn; return 1; }, clearTimeout: () => {} } }); fire();
  await assert.rejects(late, /execution_timed_out/); assert.deepEqual(m.kills, ['SIGKILL']);
  m = make(); const pre = new AbortController(); pre.abort();
  await assert.rejects(m.job.runCandidateInterruptible({ signal: pre.signal, timers }), /execution_cancelled/); assert.deepEqual(m.calls, [['cleanup']]);
});

test('D7905 recovery after supervisor loss removes only the exact recorded container', async t => {
  const record = { version: 1, id: 'c'.repeat(64), owner: '202-1-1' };
  const row = { Id: record.id, Name: '/studioos-job-202-1-1', Config: { Labels: { 'vc.axal.studioos.job': '202-1-1' } } };
  const engine = rows => { const calls = []; return { calls, run: args => { calls.push(args); if (args[0] === 'inspect') { if (rows instanceof Error) throw rows; return JSON.stringify(rows); } return ''; } }; };
  let e = engine([row]); assert.equal(JobContainer.recover(record, { engine: e.run }), 'removed'); assert.deepEqual(e.calls.at(-1), ['rm', '--force', record.id]);
  e = engine(Object.assign(new Error('x'), { stderr: 'Error: No such object: ' + record.id })); assert.equal(JobContainer.recover(record, { engine: e.run }), 'absent');
  for (const other of [{ ...row, Name: '/studioos-job-999-1-1' }, { ...row, Config: { Labels: {} } }, { ...row, Id: 'd'.repeat(64) }]) {
    e = engine([other]); assert.throws(() => JobContainer.recover(record, { engine: e.run }), /identity_mismatch/); assert.equal(e.calls.some(c => c[0] === 'rm'), false);
  }
  e = engine(new Error('daemon down')); assert.throws(() => JobContainer.recover(record, { engine: e.run }), /unreadable/);
  for (const bad of [{ ...record, id: 'name' }, { ...record, owner: '202-2-1' }, { ...record, version: 2 }]) assert.throws(() => JobContainer.recover(bad, { engine: () => '' }), /invalid_container_record/);
  const temp = mkdtempSync(join(tmpdir(), 'recover-7905-')); t.after(() => rmSync(temp, { recursive: true, force: true }));
  assert.equal(await recoverOwned({ temp }, { recover: () => assert.fail('no record, no engine call') }), 'none');
  writeFileSync(containerRecordPath({ temp }), JSON.stringify(record));
  let given; assert.equal(await recoverOwned({ temp }, { recover: r => { given = r; return 'removed'; } }), 'removed');
  assert.deepEqual(given, record); assert.equal(existsSync(containerRecordPath({ temp })), false);
});

test('D7905 the receipt reader and catalog are composed only from repository configuration and fail closed', async () => {
  const none = await trustedAuthority({});
  assert.equal(none.readReceipt, undefined);
  assert.equal((await none.resolveProfile('linux-x64')).id, 'linux-x64');
  assert.throws(() => none.resolveProfile('candidate-profile'), /unknown_profile/);
  const built = [];
  const client = { githubOidcToken: env => ({ env }), createReceiptReader: options => { built.push(options); return 'reader'; } };
  const env = { CI_CAPACITY_URL: 'https://capacity.example/', CI_CAPACITY_AUDIENCE: 'studioos-capacity' };
  const on = await trustedAuthority(env, { loadClient: async () => client });
  assert.equal(on.readReceipt, 'reader');
  assert.deepEqual(built.map(({ url, audience }) => ({ url, audience })), [{ url: 'https://capacity.example/', audience: 'studioos-capacity' }]);
  assert.equal(built[0].oidcToken.env, env);
  assert.equal((await trustedAuthority({ CI_CAPACITY_URL: 'https://capacity.example/' }, { loadClient: async () => client })).readReceipt, undefined);
  assert.equal((await trustedAuthority(env, { loadClient: async () => { throw new Error('ERR_MODULE_NOT_FOUND'); } })).readReceipt, undefined);
  assert.equal((await trustedAuthority(env, { loadClient: async () => ({ ...client, createReceiptReader: () => { throw new Error('capacity_authority_unconfigured'); } }) })).readReceipt, undefined);
});

test('D7905 the executor never installs or tests candidate code on a Linux self-hosted host, and grants no OIDC yet', () => {
  const text = read('../../.github/workflows/runner-executor.yml');
  for (const name of ['Install admitted Worker dependencies', 'Install admitted root dependencies']) {
    const step = text.split(`- name: ${name}\n`)[1].split('\n      - name:')[0];
    assert.match(step, /^\s+if: inputs\.profile != 'linux-x64'$/m, name);
  }
  assert.doesNotMatch(text, /id-token:\s*write/, 'OIDC for the receipt reader is enablement work, not this change');
  assert.equal(text.match(/CI_CAPACITY_URL: \$\{\{ vars\.CI_CAPACITY_URL \}\}/g).length, 3);
  const cleanup = text.split('- name: Remove only this child\'s files\n')[1].split('\n      - name:')[0];
  assert.match(cleanup, /if: always\(\)/);
  assert.match(cleanup, /runner-execution\.mjs" cleanup/);
});

test('D7905 the workflow cleanup step recovers a recorded container, and still removes the run files when recovery fails', async t => {
  const { main } = await import('../../scripts/ci/runner-execution.mjs');
  const root = mkdtempSync(join(tmpdir(), 'cleanup-7905-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'temp')); mkdirSync(join(root, 'work'));
  const env = { RUNNER_TEMP: join(root, 'temp'), GITHUB_WORKSPACE: join(root, 'work'), GITHUB_RUN_ID: '202', GITHUB_RUN_ATTEMPT: '1' };
  const temp = join(root, 'temp', 'studioos-executor-202-1');
  const record = { version: 1, id: 'c'.repeat(64), owner: '202-1-1' };
  assert.equal(await main('prepare', env), 0);
  writeFileSync(containerRecordPath({ temp }), JSON.stringify(record));
  const seen = [];
  assert.equal(await main('cleanup', env, { recover: r => { seen.push(r); return 'removed'; } }), 0);
  assert.deepEqual(seen, [record]); assert.equal(existsSync(temp), false);
  assert.equal(await main('prepare', env), 0);
  writeFileSync(containerRecordPath({ temp }), JSON.stringify(record));
  await assert.rejects(main('cleanup', env, { recover: () => { throw new Error('container_recovery_identity_mismatch'); } }), /identity_mismatch/);
  assert.equal(existsSync(temp), false, 'run files are removed even when recovery refuses');
});

test('D7905 the run mode installs cancellation before the container path', () => {
  const exec = read('../../scripts/ci/runner-execution.mjs');
  const run = exec.split("if(mode==='verify-plan'){")[1];
  assert.match(run, /return await withCancellation\(async signal=>\{\n\s+if\(dependencies\.job\)\{/);
  assert.match(run, /runInContainer\(\{job,executionIsolation,current,paths,planPath,signal,/);
});
