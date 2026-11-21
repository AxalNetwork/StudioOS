/** D7905: the trusted executor binds the Linux container boundary; nothing else counts as isolation evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolationFor, linuxExecutorDependencies, LINUX_POLICY_PATH } from '../../scripts/ci/runners/executor-isolation.mjs';
import { JobContainer, aclStage } from '../../scripts/ci/runners/job-container.mjs';
import { trustedAuthority } from '../../scripts/ci/executor-authority.mjs';
const POLICY = { version: 1, image: 'sha256:' + 'a'.repeat(64), nodeVersion: '22.23.3', pythonVersion: '3.11.18' };
const context = { repository: 'AxalNetwork/StudioOS', childRunId: '202', childAttempt: '1' };
const receipt = { profile: 'linux-x64', childRunId: 202, childAttempt: 1 };
const deps = extra => linuxExecutorDependencies({ readPolicy: () => POLICY, engine: () => '27.0', platform: 'linux', aclTool: () => true, ...extra });
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('D7905 linux-x64 gets the container; hosted and github-8 get only the refusing hosted port; Mac gets none', async () => {
  for (const id of ['macos-arm64', undefined, 'LINUX-X64', 'self-hosted']) assert.equal(isolationFor(id), null);
  const linux = isolationFor('linux-x64', { readPolicy: () => POLICY, engine: () => '', platform: 'linux' });
  assert.equal(typeof linux.admissionIsolation, 'function');
  assert.equal(typeof linux.executionIsolation, 'function');
  for (const id of ['hosted', 'github-8']) {
    const hosted = isolationFor(id);
    assert.deepEqual(Object.keys(hosted), ['admissionIsolation'], 'no execution job: run mode refuses');
    assert.equal(await hosted.admissionIsolation({ receipt: { profile: id }, context, profile: { id } }), false);
  }
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
    assert.throws(() => job.create({ version: 1, repository: 'AxalNetwork/StudioOS', profile: 'linux-x64', sourceSha: 'e'.repeat(40), event: 'push', childRunId: 202, childAttempt: 1, generation: 1, requestId: '00000000-0000-4000-8000-000000000001', logicalShard: 'worker-1-of-6', executionDeadline: 1800000600000 }, { source, plan }), /container_input_staging_failed/);
    assert.equal(calls.length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
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

test('D7905 no profile installs or tests candidate code as a host step, uploads only a committed offer, and stages OIDC only for the disabled trusted supervisor', () => {
  const text = read('../../.github/workflows/runner-executor.yml');
  assert.doesNotMatch(text, /Install admitted (Worker|root) dependencies/);
  assert.doesNotMatch(text, /run: npm ci/);
  assert.match(text, /id-token:\s*write/);
  assert.match(text, /github.event_name == 'workflow_dispatch'/);
  assert.match(text, /vars\.RUNNER_EXECUTOR_ENABLED == 'true'/);
  assert.doesNotMatch(text.split('jobs:')[0], /id-token:/);
  assert.ok(text.includes('CI_CAPACITY_URL: ${{ vars.CI_CAPACITY_URL }}'));
  const upload = text.split('- name: Upload test traces\n')[1].split('\n      - name:')[0];
  assert.match(upload, /trace-export\/\*\/ready\n/);
  assert.doesNotMatch(upload, /test-traces\n/);
  const cleanup = text.split('- name: Remove only this child\'s files\n')[1].split('\n      - name:')[0];
  assert.match(cleanup, /if: always\(\)/);
  assert.match(cleanup, /capacity-executor\.mjs" cleanup/);
});