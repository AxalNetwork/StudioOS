/** D8345: real JWT/HTTP-client/native-predicate composition; ALL provider, authority and engine facts are synthetic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createHostedReaders, hostedGithubRead } from '../../scripts/ci/runners/hosted-readers.mjs';
import { createHostedVerification } from '../../scripts/ci/runners/hosted-verification.mjs';
import { createReceiptReader, githubOidcToken } from '../../scripts/ci/capacity-client.mjs';
import { authenticateCapacity } from '../../merge-control/src/ciCapacityAuth.ts';
import { CapacityTransport } from '../../merge-control/src/ciCapacityTransport.ts';
import { resolveCatalogProfile } from '../../scripts/ci/runners/catalog.mjs';
import { hostedReaders, isolationFor } from '../../scripts/ci/runners/executor-isolation.mjs';
const NOW = 1_800_000_000_000, REPO = 'AxalNetwork/StudioOS', EXEC = 'e'.repeat(40), SOURCE = 'a'.repeat(40);
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const key = { ...publicKey.export({ format: 'jwk' }), kid: 'fixture-8345', alg: 'RS256', use: 'sig' };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = claims => { const input = `${encode({ alg: 'RS256', kid: key.kid })}.${encode(claims)}`; return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`; };
const clone = value => structuredClone(value);
function world(t, profile = 'hosted', child = EXEC) {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const receipt = { version: 1, requestId: 'fixture-8345', repository: REPO, logicalShard: 'worker-1-of-6', event: 'push',
    parentRunId: 101, parentAttempt: 1, parentWorkflowId: 77, sourceSha: SOURCE, queueBaseSha: null, planDigest: `sha256:${'1'.repeat(64)}`,
    planArtifactId: 505, executorSha: EXEC, childWorkflowSha: child, profile, generation: 3, childRunId: 202, childAttempt: 1,
    startDeadline: NOW + 60_000, executionDeadline: NOW + 1_000_000 };
  const context = { repository: REPO, executorSha: EXEC, childWorkflowSha: child, childRunId: '202', childAttempt: '1' };
  const claims = { iss: 'https://token.actions.githubusercontent.com', aud: 'studioos-ci-capacity', sub: `repo:${REPO}:ref:refs/heads/main`,
    repository: REPO, repository_id: '1191713997', run_id: '202', run_attempt: '1', runner_environment: 'github-hosted', sha: child,
    workflow_sha: child, workflow_ref: `${REPO}/.github/workflows/runner-executor.yml@refs/heads/main`, event_name: 'workflow_dispatch',
    ref: 'refs/heads/main', check_run_id: '910', exp: NOW / 1000 + 300, iat: NOW / 1000, nbf: NOW / 1000 - 1 };
  const repo = { id: 1191713997, full_name: REPO };
  const run = { id: 202, run_attempt: 1, path: '.github/workflows/runner-executor.yml', head_sha: child, head_branch: 'main',
    event: 'workflow_dispatch', status: 'in_progress', conclusion: null, repository: repo, head_repository: repo };
  const selected = { id: 909, run_id: 202, run_attempt: 1, head_sha: child, name: 'Admitted Worker shard', status: 'in_progress', conclusion: null,
    started_at: new Date(NOW - 1).toISOString(), check_run_url: `https://api.github.com/repos/${REPO}/check-runs/910`,
    labels: profile === 'hosted' ? ['ubuntu-latest'] : ['studioos-bench-linux-8'],
    ...(profile === 'github-8' ? { runner_group_id: 6, runner_group_name: 'StudioOS Included Compute' } : {}) };
  const owner = '202-1-3', id = 'f'.repeat(64), image = `sha256:${'2'.repeat(64)}`, deadlineSeconds = Math.floor(receipt.executionDeadline / 1000);
  const policy = { version: 1, image, nodeVersion: '22.23.3', pythonVersion: '3.11.18' };
  const info = { Id: id, Image: image, State: { Running: true, Pid: 123 },
    Config: { User: '10001:10001', Labels: { 'vc.axal.studioos.job': owner }, Entrypoint: ['/bin/sh'],
      Cmd: ['-c', 'exec sleep "$(( STUDIOOS_JOB_DEADLINE - $(date +%s) - 1 ))"'],
      Env: ['PATH=/usr/local/bin:/usr/bin:/bin', 'HOME=/work/home', 'LANG=C.UTF-8', 'CI=true', 'TZ=UTC', `STUDIOOS_JOB_DEADLINE=${deadlineSeconds}`] },
    HostConfig: { Privileged: false, Init: true, ReadonlyRootfs: true, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], PidMode: '', IpcMode: 'private',
      CgroupnsMode: 'private', NetworkMode: 'bridge', PidsLimit: 256, Memory: 4294967296, NanoCpus: 2000000000,
      Tmpfs: { '/work': 'rw,nosuid,nodev,size=4294967296,uid=10000,gid=10000,mode=0700', '/tmp': 'rw,nosuid,nodev,noexec,size=268435456,uid=10000,gid=10000,mode=0700' } },
    Mounts: [{ Type: 'bind', Source: '/fixture/source', Destination: '/input', RW: false, Propagation: 'rprivate' },
      { Type: 'bind', Source: '/fixture/plan.json', Destination: '/input-plan.json', RW: false, Propagation: 'rprivate' }] };
  const native = { policy, owned: { id, owner, image, source: '/fixture/source', plan: '/fixture/plan.json', receipt: clone(receipt), deadlineSeconds },
    namespace: () => true, async engine(command, options) { assert.ok(options.signal); assert.ok(options.timeout <= 10_000);
      calls.push({ engine: clone(command) }); return command[0] === 'inspect' ? JSON.stringify([info]) : command.at(-1).includes('python_version') ? policy.pythonVersion : policy.nodeVersion; } };
  const envelope = { active: true, receipt: clone(receipt), hostedEvidence: { includedEligibility: { binding: clone(receipt), observedAt: NOW, jobId: 909,
    runnerGroupId: 6, provider: 'github-hosted', billingLane: 'included-compute', reservation: 'active', overageAllowed: false,
    stopAtLimitVerified: true, validUntil: NOW + 30_000 } } };
  const calls = [], state = { sign: () => jwt(claims), jobs: [selected], total: 1, pages: null, revoked: false };
  const config = { repository: REPO, repositoryId: repo.id, executorSha: EXEC, childWorkflowSha: child };
  const transport = new CapacityTransport({ receipt: async () => clone(envelope.receipt) }, config, async () => !state.revoked, async () => {});
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET' });
    assert.equal(init.redirect, 'error'); assert.ok(init.signal);
    if (String(url) === 'https://token.actions.githubusercontent.com/.well-known/jwks') return Response.json({ keys: [key] });
    if (new URL(url).hostname === 'fixture.actions.githubusercontent.com') return Response.json({ value: state.sign() });
    if (String(url) === 'https://capacity.invalid/capacity/receipt') {
      const identity = await authenticateCapacity(new Request(url, init), claims.aud, REPO, fetcher, Date.now);
      const result = await transport.receipt(JSON.parse(init.body), identity);
      return Response.json({ ...result, ...(result.active ? { hostedEvidence: envelope.hostedEvidence } : {}) });
    }
    if (String(url).endsWith('/attempts/1')) return Response.json(run);
    if (String(url).includes('/attempts/1/jobs?')) { const data = state.pages?.[new URL(url).searchParams.get('page')]; return Response.json(data ?? { total_count: state.total, jobs: state.jobs }); }
    throw Error('unexpected fixture HTTP request');
  };
  const token = githubOidcToken({ ACTIONS_ID_TOKEN_REQUEST_URL: 'https://fixture.actions.githubusercontent.com/token', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fixture-only' }, fetcher);
  const options = { audience: claims.aud, readReceipt: createReceiptReader({ url: 'https://capacity.invalid', audience: claims.aud, oidcToken: token, fetcher }),
    oidcToken: token, githubRead: hostedGithubRead({ token: 'fixture-only', fetcher }), issuerFetch: fetcher, job: native, now: Date.now };
  const args = { receipt, context, profile: resolveCatalogProfile(profile), phase: 'execute' };
  const readers = createHostedReaders(options);
  return { receipt, claims, run, selected, info, native, envelope, calls, state, options, args, readers,
    inspect: () => createHostedVerification(readers).inspect(args) };
}

test('signed target token + authenticated receipt transport + independent job + native inspection drive the real adapter', async t => {
  for (const profile of ['hosted', 'github-8']) {
    await t.test(profile, async t => { const w = world(t, profile); const result = await w.inspect();
      assert.equal(result.allowed, true); assert.equal(result.boundary.instanceId, w.native.owned.id);
      assert.equal(result.boundary.jobId, 909, 'Actions job id differs from the OIDC check id 910');
      assert.equal(w.calls.filter(c => c.engine?.[0] === 'inspect').length, 1);
      assert.equal(w.calls.filter(c => c.url?.includes('api.github.com')).length, 2);
      assert.ok(w.calls.every(c => !['POST', 'PATCH', 'DELETE'].includes(c.method) || c.url === 'https://capacity.invalid/capacity/receipt'));
    });
  }
});
test('main defaults still refuse; readers have no implicit positive dependency', async t => {
  const w = world(t); assert.deepEqual(hostedReaders(), {}); assert.equal(await isolationFor('hosted').admissionIsolation(w.args), false);
  await assert.rejects(createHostedReaders().readProvenance(w.args), /unconfigured/);
  const noJob = createHostedReaders({ ...w.options, job: undefined }); await noJob.readProvenance(w.args); await assert.rejects(noJob.readBoundary(w.args), /job_unconfigured/);
});
test('forged signature, wrong audience, expired token and changed target-job claims refuse', async t => {
  for (const fault of ['signature', 'aud', 'exp', 'check_run_id', 'runner_environment', 'workflow_sha']) {
    await t.test(fault, async t => { const w = world(t);
      if (fault === 'signature') w.state.sign = () => { const p = jwt(w.claims).split('.'); p[1] = encode({ ...w.claims, run_id: '203' }); return p.join('.'); };
      else w.claims[fault] = ({ aud: 'wrong', exp: NOW / 1000, check_run_id: '911', runner_environment: 'self-hosted', workflow_sha: SOURCE })[fault];
      assert.equal((await w.inspect()).allowed, false);
    });
  }
});
test('every canonical receipt field, including distinct child-workflow identity, is bound before native inspection', async t => {
  const w = world(t);
  for (const field of Object.keys(w.receipt)) {
    const original = w.envelope.receipt[field]; w.envelope.receipt[field] = typeof original === 'number' ? original + 1 : 'wrong';
    assert.equal((await w.inspect()).allowed, false, field); w.envelope.receipt[field] = original;
  }
  assert.equal(w.calls.some(c => c.engine), false);
});
test('reader supports distinct child/control identities; existing S30 adapter coupling remains a tracked integration refusal', async t => {
  const w = world(t, 'hosted', 'c'.repeat(40)); const result = await w.readers.readProvenance(w.args);
  assert.equal(result.claims.workflow_sha, 'c'.repeat(40)); assert.equal(result.binding.executorSha, EXEC);
  assert.equal((await w.inspect()).allowed, false, 'no relaxation of the unchanged adapter');
});
test('revocation is refreshed between provenance and native inspection', async t => {
  const w = world(t); await w.readers.readProvenance(w.args); w.state.revoked = true;
  await assert.rejects(w.readers.readBoundary(w.args), /capacity_receipt_refused/); assert.equal(w.calls.some(c => c.engine), false);
});
test('foreign/duplicate/incomplete/over-cap job observations refuse', async t => {
  for (const fault of ['foreign', 'duplicate', 'incomplete', 'cap']) await t.test(fault, async t => {
    const w = world(t);
    if (fault === 'foreign') w.selected.run_id = 203;
    if (fault === 'duplicate') { w.state.jobs = [w.selected, clone(w.selected)]; w.state.total = 2; }
    if (fault === 'incomplete') w.state.total = 2;
    if (fault === 'cap') w.state.total = 301;
    assert.equal((await w.inspect()).allowed, false); assert.equal(w.calls.some(c => c.engine), false);
  });
});
test('native credential and ownership defects never become asserted denial flags', async t => {
  for (const fault of ['privileged', 'credentials', 'mount', 'namespace', 'owner', 'runtime', 'id']) await t.test(fault, async t => {
    const w = world(t);
    if (fault === 'id') w.info.Id = '9'.repeat(64);
    if (fault === 'privileged') w.info.HostConfig.Privileged = true;
    if (fault === 'credentials') w.info.Config.Env.push('ACTIONS_ID_TOKEN_REQUEST_TOKEN=fixture-forbidden');
    if (fault === 'mount') w.info.Mounts.push({ Destination: '/var/run/docker.sock' });
    if (fault === 'namespace') w.native.namespace = () => false;
    if (fault === 'owner') w.native.owned.owner = '203-1-3';
    if (fault === 'runtime') w.native.policy.nodeVersion = '20.0.0';
    assert.equal((await w.inspect()).allowed, false);
  });
});
test('same instance must survive rechecks before install/tests', async t => {
  const w = world(t); assert.equal((await w.inspect()).allowed, true);
  w.native.owned.id = 'd'.repeat(64); w.info.Id = w.native.owned.id;
  assert.equal((await w.inspect()).allowed, false);
});
test('included eligibility comes only from the fresh authenticated response and never from profile labels', async t => {
  for (const fault of ['missing', 'future', 'stale', 'overage', 'job', 'expiry', 'binding']) await t.test(fault, async t => {
    const w = world(t, 'github-8'), lane = w.envelope.hostedEvidence.includedEligibility;
    if (fault === 'missing') delete w.envelope.hostedEvidence;
    if (fault === 'future') lane.observedAt = NOW + 1;
    if (fault === 'stale') lane.observedAt = NOW - 30_001;
    if (fault === 'overage') lane.overageAllowed = true;
    if (fault === 'job') lane.jobId = 910;
    if (fault === 'expiry') lane.validUntil = NOW;
    if (fault === 'binding') lane.binding.planDigest = `sha256:${'0'.repeat(64)}`;
    await w.readers.readProvenance(w.args);
    await assert.rejects(w.readers.readIncludedEligibility(w.args), /included_authority_unavailable/, 'the reader must refuse independently of the outer adapter');
    assert.equal((await w.inspect()).allowed, false);
  });
});
test('cancel interrupts an unresponsive reader and late completion cannot become provenance', async t => {
  const w = world(t), controller = new AbortController(); let release;
  const readers = createHostedReaders({ ...w.options, githubRead: () => new Promise(resolve => { release = resolve; }) });
  const pending = readers.readProvenance({ ...w.args, signal: controller.signal });
  while (!release) await new Promise(resolve => setImmediate(resolve)); controller.abort();
  await assert.rejects(pending, /cancelled/); release(w.run);
  await assert.rejects(readers.readBoundary(w.args), /provenance_required/);
});
test('receipt deadline and clock rollback refuse evidence even with successful fact ports', async t => {
  const w = world(t);
  // Hold canonical authority constant to isolate the reader's own non-future check from JWT iat refusal.
  const readers = createHostedReaders({ ...w.options, readReceipt: async () => clone(w.envelope) });
  await readers.readProvenance(w.args);
  t.mock.timers.setTime(NOW - 1); await assert.rejects(readers.readBoundary(w.args), /provenance_required/);
  t.mock.timers.setTime(w.receipt.executionDeadline); await assert.rejects(readers.readProvenance(w.args), /lease_expired/);
});
test('GitHub acquisition refuses arbitrary endpoints/methods, redirects and over-size bodies', async t => {
  const w = world(t), controller = new AbortController();
  for (const path of ['../user', 'actions/runs/202/cancel', 'actions/runs/202/attempts/2', 'actions/runs/202/attempts/1/jobs?per_page=100&page=4'])
    await assert.rejects(w.options.githubRead(path, controller.signal), /path_refused/);
  const redirected = hostedGithubRead({ token: 'fixture', fetcher: async () => { const response = Response.json({}); Object.defineProperty(response, 'redirected', { value: true }); return response; } });
  await assert.rejects(redirected('actions/runs/202/attempts/1', controller.signal), /redirect/);
  const huge = hostedGithubRead({ token: 'fixture', fetcher: async () => new Response('x'.repeat(512 * 1024 + 1)) });
  await assert.rejects(huge('actions/runs/202/attempts/1', controller.signal), /bound/);
});
test('job pagination reaches the exact target on the third page without accepting truncated observations', async t => {
  const w = world(t);
  const jobs = Array.from({ length: 299 }, (_, i) => ({ ...clone(w.selected), id: 1000 + i, name: `other-${i}`, check_run_url: `https://api.github.com/repos/${REPO}/check-runs/${2000 + i}` }));
  jobs.push(w.selected);
  w.state.pages = Object.fromEntries([1, 2, 3].map(page => [page, { total_count: 300, jobs: jobs.slice((page - 1) * 100, page * 100) }]));
  assert.equal((await w.inspect()).allowed, true);
  assert.equal(w.calls.filter(c => c.url?.includes('/jobs?')).length, 3);
});
test('reader deadline interrupts a hung port even without the outer adapter', async t => {
  const w = world(t); t.mock.timers.reset(); t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: NOW });
  let entered = false;
  const readers = createHostedReaders({ ...w.options, githubRead: () => { entered = true; return new Promise(() => {}); } });
  const pending = assert.rejects(readers.readProvenance(w.args), /cancelled/);
  while (!entered) await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(10_000); await pending;
});
test('pre-cancellation causes no authority, OIDC, API or engine work', async t => {
  const w = world(t), controller = new AbortController(); controller.abort();
  await assert.rejects(w.readers.readProvenance({ ...w.args, signal: controller.signal }), /cancelled/);
  assert.deepEqual(w.calls, []);
});
test('late native inspection cannot rejuvenate its original observation time', async t => {
  const w = world(t), engine = w.native.engine;
  w.native.engine = async (...args) => { const result = await engine(...args); t.mock.timers.setTime(NOW + 30_001); return result; };
  assert.equal((await w.inspect()).allowed, false);
});
test('the reader independently verifies the target JWT even after a valid authority receipt', async t => {
  const w = world(t);
  const valid = jwt(w.claims).split('.'); valid[1] = encode({ ...w.claims, fixtureTampered: true });
  for (const token of [valid.join('.'), jwt({ ...w.claims, iss: 'https://wrong.invalid' }), jwt({ ...w.claims, aud: 'wrong' }),
    jwt({ ...w.claims, exp: NOW / 1000 }), jwt({ ...w.claims, nbf: NOW / 1000 + 1 })]) {
    const reader = createHostedReaders({ ...w.options, oidcToken: async () => token });
    await assert.rejects(reader.readProvenance(w.args));
  }
  assert.equal(w.calls.some(c => c.url?.includes('api.github.com')), false, 'authentication fails before provider inspection');
});
test('runtime version probes and job/policy mutation during inspection refuse', async t => {
  for (const fault of ['version', 'instance', 'policy']) await t.test(fault, async t => {
    const w = world(t), engine = w.native.engine;
    w.native.engine = async (...args) => {
      const result = await engine(...args);
      if (fault === 'version' && args[0][0] === 'exec') return 'unreviewed';
      if (fault === 'instance') w.native.owned.source = '/fixture/replaced';
      if (fault === 'policy') w.native.policy.image = `sha256:${'3'.repeat(64)}`;
      return result;
    };
    assert.equal((await w.inspect()).allowed, false);
  });
});
test('authenticated but wrong target-only claims refuse without relying on adapter validation', async t => {
  const w = world(t);
  for (const patch of [{ runner_environment: 'self-hosted' }, { run_attempt: '2' }, { check_run_id: undefined },
    { workflow_sha: SOURCE }, { sha: SOURCE }, { workflow_ref: `${REPO}/.github/workflows/ci.yml@refs/heads/main` }]) {
    const readers = createHostedReaders({ ...w.options, oidcToken: async () => jwt({ ...w.claims, ...patch }) });
    await assert.rejects(readers.readProvenance(w.args));
  }
});
