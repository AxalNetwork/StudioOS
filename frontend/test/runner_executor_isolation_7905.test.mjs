/** D7905: the trusted executor binds the Linux container boundary; nothing else counts as isolation evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isolationFor, linuxExecutorDependencies, LINUX_POLICY_PATH } from '../../scripts/ci/runners/executor-isolation.mjs';
const POLICY = { version: 1, image: 'sha256:' + 'a'.repeat(64), nodeVersion: '22.23.3', pythonVersion: '3.11.18' };
const context = { repository: 'AxalNetwork/StudioOS', childRunId: '202', childAttempt: '1' };
const receipt = { profile: 'linux-x64', childRunId: 202, childAttempt: 1 };
const read = () => readFileSync(new URL('../../.github/workflows/runner-executor.yml', import.meta.url), 'utf8');

test('D7905 only linux-x64 has an isolation implementation; Mac, hosted and github-8 get none', () => {
  for (const id of ['macos-arm64', 'hosted', 'github-8', undefined, 'LINUX-X64']) assert.equal(isolationFor(id), null);
  const deps = isolationFor('linux-x64', { readPolicy: () => POLICY, engine: () => '', platform: 'linux' });
  assert.equal(typeof deps.admissionIsolation, 'function');
  assert.equal(typeof deps.executionIsolation, 'function');
});

test('D7905 a missing, untrusted or non-Linux setup fails closed before any adapter exists', () => {
  assert.throws(() => linuxExecutorDependencies({ readPolicy: () => { throw new Error('untrusted_container_policy'); }, platform: 'linux' }), /untrusted_container_policy/);
  assert.throws(() => linuxExecutorDependencies({ readPolicy: () => POLICY, platform: 'darwin' }), /linux_isolation_unavailable/);
  assert.throws(() => linuxExecutorDependencies({ readPolicy: () => ({ ...POLICY, image: 'ubuntu:latest' }), platform: 'linux' }), /unreviewed_container_runtime/);
  assert.equal(LINUX_POLICY_PATH, '/etc/studioos/job-container-policy.json');
});

test('D7905 admission readiness needs the exact repository, the linux-x64 profile and a reachable engine', async () => {
  const seen = [];
  const { admissionIsolation } = linuxExecutorDependencies({ readPolicy: () => POLICY, engine: args => { seen.push(args); return '27.0\n'; }, platform: 'linux' });
  assert.equal(await admissionIsolation({ receipt, context, profile: { id: 'linux-x64' } }), true);
  assert.deepEqual(seen, [['version', '--format', '{{.Server.Version}}']]);
  assert.equal(await admissionIsolation({ receipt, context: { ...context, repository: 'Evil/Fork' }, profile: { id: 'linux-x64' } }), false);
  assert.equal(await admissionIsolation({ receipt, context, profile: { id: 'macos-arm64' } }), false);
  assert.equal(await admissionIsolation({ receipt: { ...receipt, profile: 'macos-arm64' }, context, profile: { id: 'linux-x64' } }), false);
  assert.equal(await admissionIsolation({}), false);
  const down = linuxExecutorDependencies({ readPolicy: () => POLICY, engine: () => { throw new Error('no engine'); }, platform: 'linux' });
  assert.equal(await down.admissionIsolation({ receipt, context, profile: { id: 'linux-x64' } }), false);
});

test('D7905 execution isolation is false until a live container is owned, so readiness cannot authorise a run', async () => {
  const { executionIsolation } = linuxExecutorDependencies({ readPolicy: () => POLICY, engine: () => '27.0', platform: 'linux' });
  assert.equal(await executionIsolation({ receipt, context, profile: { id: 'linux-x64' } }), false);
});

test('D7905 the executor never installs or tests candidate code on a Linux self-hosted host', () => {
  const text = read();
  for (const name of ['Install admitted Worker dependencies', 'Install admitted root dependencies']) {
    const step = text.split(`- name: ${name}\n`)[1].split('\n      - name:')[0];
    assert.match(step, /^\s+if: inputs\.profile != 'linux-x64'$/m, name);
  }
  const exec = readFileSync(new URL('../../scripts/ci/runner-execution.mjs', import.meta.url), 'utf8');
  assert.match(exec, /job\.create\(current\.identity/);
  assert.match(exec, /verifyIsolation:executionIsolation/);
  assert.match(exec, /job\.runCandidate/);
});
