/** D8345: real JWT/HTTP-client/native-predicate composition; ALL provider, authority and engine facts are synthetic.
 *
 * From frontend/test/README.md (moved by #6472): `hosted_readers_8345.test.mjs` exercises trusted
 * hosted-reader acquisition and bridge composition with real signatures, HTTP clients, SQLite
 * budgets and S09 inspection ports; provider/native/eligibility observations are synthetic, and
 * the default hosted execution boundary remains absent.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { CapacityRequestBudget } from '../../merge-control/src/lib/ciCapacityAuthPolicy.ts';
import '../../merge-control/test/runtime-loader.mjs';
const { SqlCapacityBudgetStore } = await import('../../merge-control/src/ciCapacityRuntime.ts');
import { createHostedReaders, hostedGithubRead, hostedReaderFactory } from '../../scripts/ci/runners/hosted-readers.mjs';
import { createHostedVerification } from '../../scripts/ci/runners/hosted-verification.mjs';
import { createReceiptReader, githubOidcToken } from '../../scripts/ci/capacity-client.mjs';
import { authenticateCapacity } from '../../merge-control/src/ciCapacityAuth.ts';
import { CapacityTransport } from '../../merge-control/src/ciCapacityTransport.ts';
import { resolveCatalogProfile } from '../../scripts/ci/runners/catalog.mjs';
import { hostedReaders, isolationFor, hostedExecutorDependencies } from '../../scripts/ci/runners/executor-isolation.mjs';
import { JobContainer } from '../../scripts/ci/runners/job-container.mjs';
import { receiptIdentity } from '../../scripts/ci/runner-admission.mjs';
import { main as bridge } from '../../scripts/ci/capacity-executor.mjs';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recoveryStore } from '../../scripts/ci/runners/recovery-store.mjs';
import { runInContainer } from '../../scripts/ci/runner-execution.mjs';
const NOW = 1_800_000_000_000, REPO = 'AxalNetwork/StudioOS', EXEC = 'e'.repeat(40), SOURCE = 'a'.repeat(40);
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const key = { ...publicKey.export({ format: 'jwk' }), kid: 'fixture-8345', alg: 'RS256', use: 'sig' };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = claims => { const input = `${encode({ alg: 'RS256', kid: key.kid })}.${encode(claims)}`; return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`; };
const clone = value => structuredClone(value);
function world(t, profile = 'hosted', child = EXEC) {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const receipt = { version: 1, requestId: '83450000-0000-4000-8000-000000000001', repository: REPO, logicalShard: 'worker-1-of-6', event: 'push',
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
  const native = new JobContainer(policy, { profileId: profile, namespace: () => true,
    async engine(command, options) { assert.ok(options.signal); assert.ok(options.timeout <= 30_000);
      calls.push({ engine: clone(command) });
      if (command[0] === 'inspect') return JSON.stringify([info]);
      if (command[0] === 'version') return 'fixture-engine';
      return command.at(-1).includes('python_version') ? policy.pythonVersion : command.includes('-e') ? 'readable' : policy.nodeVersion;
    } });
  native.owned = { id, owner, image, source: '/fixture/source', plan: '/fixture/plan.json', receipt: receiptIdentity(receipt), deadlineSeconds };
  // Synthetic egress qualification ONLY in this fixture. The actual S09 ports always return false today.
  for (const method of ['inspectBoundary', 'inspectReadiness']) native[method] = async args => {
    const value = await JobContainer.prototype[method].call(native, args);
    return value && { ...value, deniesHostControl: state.egressProof };
  };
  const envelope = { active: true, receipt: clone(receipt), hostedEvidence: { includedEligibility: { binding: clone(receipt), observedAt: NOW, jobId: 909,
    runnerGroupId: 6, provider: 'github-hosted', billingLane: 'included-compute', reservation: 'active', overageAllowed: false,
    stopAtLimitVerified: true, validUntil: NOW + 30_000 } } };
  const calls = [], state = { sign: () => jwt(claims), jobs: [selected], total: 1, pages: null, revoked: false, egressProof: true };
  const config = { repository: REPO, repositoryId: repo.id, executorSha: EXEC, childWorkflowSha: child };
  const transport = new CapacityTransport({ receipt: async () => clone(envelope.receipt) }, config, async () => !state.revoked, async () => {});
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET' });
    assert.equal(init.redirect, 'error'); assert.ok(init.signal);
    if (String(url) === 'https://token.actions.githubusercontent.com/.well-known/jwks') return Response.json({ keys: [key] });
    if (new URL(url).hostname === 'fixture.actions.githubusercontent.com') return Response.json({ value: state.sign() });
    if (String(url) === 'https://capacity.invalid/capacity/receipt') {
      const verify = () => authenticateCapacity(new Request(url, init), claims.aud, REPO, fetcher, Date.now);
      const work = async identity => {
        const result = await transport.receipt(JSON.parse(init.body), identity);
        return { ...result, ...(result.active ? { hostedEvidence: envelope.hostedEvidence } : {}) };
      };
      const result = state.budget ? await state.budget.run(verify, () => 'receipt', work)
        : await work(await verify());
      return Response.json(result);
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
      assert.equal(result.allowed, true, result.reason); assert.equal(result.boundary.instanceId, w.native.owned.id);
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
  const noJob = createHostedReaders({ ...w.options, job: undefined });
  await assert.rejects(noJob.readProvenance(w.args), /job_unconfigured/); await assert.rejects(noJob.readBoundary(w.args), /job_unconfigured|provenance_required/);
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
test('reader and exact S09 adapter support distinct child/control identities', async t => {
  const w = world(t, 'hosted', 'c'.repeat(40)); const result = await w.readers.readProvenance(w.args);
  assert.equal(result.claims.workflow_sha, 'c'.repeat(40)); assert.equal(result.binding.executorSha, EXEC);
  assert.equal((await w.inspect()).allowed, true, 'exact child identity is separate from the control checkout');
});
test('canonical receipt pin presence is retained even when child and control happen to match', async t => {
  const w = world(t); delete w.envelope.receipt.childWorkflowSha;
  await assert.rejects(w.readers.readProvenance(w.args), /hosted_receipt_changed/);
  assert.equal(w.calls.some(c => c.engine), false);
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
    if (fault === 'runtime') w.native.policy = { ...w.native.policy, nodeVersion: '20.0.0' };
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
      if (fault === 'policy') w.native.policy = { ...w.native.policy, image: `sha256:${'3'.repeat(64)}` };
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


test('separate readiness and live reader ports execute exact S09 methods, with no instance at admission', async t => {
  const w = world(t, 'hosted', 'c'.repeat(40)), owned = w.native.owned;
  const factory = hostedReaderFactory({ CI_CAPACITY_AUDIENCE: w.claims.aud, GH_TOKEN: 'fixture-only',
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://fixture.actions.githubusercontent.com/token', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fixture-only' },
  w.options.readReceipt, { fetcher: w.options.issuerFetch });
  const readers = factory({ job: w.native }), verification = createHostedVerification(readers);
  w.native.owned = null;
  const admission = await verification.inspectAdmission(w.args);
  assert.equal(admission.allowed, true, admission.reason);
  assert.equal(Object.hasOwn(admission.boundary, 'instanceId'), false);
  assert.equal(w.calls.some(c => c.engine?.[0] === 'inspect'), false);
  w.native.owned = owned;
  const boundary = w.native.boundaryIdentity();
  assert.equal(await verification.verifyExecution({ ...w.args, boundary }), true);
  assert.equal(await verification.verifyExecution({ ...w.args, boundary: { ...boundary, instanceId: 'wrong' } }), false);
});

test('actual bridge networking never becomes asserted host-control denial', async t => {
  const w = world(t); w.state.egressProof = false;
  assert.equal((await w.native.inspectReadiness({ signal: new AbortController().signal })).deniesHostControl, false);
  assert.equal((await w.native.inspectBoundary({ receipt: w.receipt, signal: new AbortController().signal })).deniesHostControl, false);
  await w.readers.readProvenance(w.args);
  await assert.rejects(w.readers.readBoundaryReadiness(w.args), /native_inspection_refused/);
  await assert.rejects(w.readers.readBoundary(w.args), /native_inspection_refused/);
  assert.equal(await createHostedVerification(w.readers).verifyAdmission(w.args), false);
  assert.equal(await createHostedVerification(w.readers).verifyExecution({ ...w.args, boundary: w.native.boundaryIdentity() }), false);
});

test('readiness rejects an instance, stale/future evidence, changed policy, scope and each missing denial', async t => {
  for (const fault of ['instance', 'stale', 'future', 'policy', 'scope', 'deniesRunnerAgent', 'deniesJobCredentials', 'deniesOidc', 'deniesAppCapabilities', 'deniesHostControl']) {
    await t.test(fault, async t => {
      const w = world(t), original = w.native.inspectReadiness;
      w.native.inspectReadiness = async args => {
        const document = await original(args);
        if (fault === 'instance') document.instanceId = w.native.owned.id;
        else if (fault === 'stale') document.observedAt = NOW - 30_001;
        else if (fault === 'future') document.observedAt = NOW + 1;
        else if (fault === 'policy') document.policyDigest = `sha256:${'0'.repeat(64)}`;
        else if (fault === 'scope') document.scope = 'tests-only';
        else document[fault] = false;
        return document;
      };
      await w.readers.readProvenance(w.args);
      await assert.rejects(w.readers.readBoundaryReadiness(w.args));
      assert.equal(await createHostedVerification(w.readers).verifyAdmission(w.args), false);
    });
  }
});

test('bridge receipt snapshots are isolation-scoped and fit the unchanged receipt budget across 24 minutes', async t => {
  const w = world(t), db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const storage = { sql: { exec(query, ...values) { const rows = db.prepare(query).all(...values); return { toArray: () => rows }; } },
    transactionSync(fn) { db.exec('BEGIN'); try { const value = fn(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; } } };
  w.state.budget = new CapacityRequestBudget(new SqlCapacityBudgetStore(storage));
  w.receipt.executionDeadline = NOW + 30 * 60_000; w.envelope.receipt = clone(w.receipt);
  w.native.owned = null; // Readiness is evaluated before any candidate/container exists.
  const env = { GITHUB_REPOSITORY: REPO, EXECUTOR_SHA: EXEC, CHILD_WORKFLOW_SHA: EXEC, GITHUB_WORKFLOW_SHA: EXEC,
    GITHUB_RUN_ID: '202', GITHUB_RUN_ATTEMPT: '1', PROFILE: 'hosted', CI_CAPACITY_AUDIENCE: w.claims.aud,
    GH_TOKEN: 'fixture-only', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://fixture.actions.githubusercontent.com/token', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fixture-only' };
  t.mock.method(globalThis, 'fetch', w.options.issuerFetch);
  let retainedReaders;
  const ports = { results: { read: () => null }, store: {}, authority: { readReceipt: w.options.readReceipt },
    isolationFactory(profileId, options) {
      const original = options.readers;
      return hostedExecutorDependencies({ profileId, boundaryJob: () => w.native,
        readers: args => { retainedReaders = original(args); return retainedReaders; } });
    },
    async admit(_env, dependencies) {
      assert.equal(await dependencies.verifyIsolation(w.args), false, 'no preceding authenticated observation');
      const input = { request: { requestId: w.receipt.requestId, shard: w.receipt.logicalShard,
        generation: w.receipt.generation, profile: w.receipt.profile }, context: w.args.context, phase: 'execute' };
      await dependencies.readReceipt(input);
      assert.equal(await dependencies.verifyIsolation(w.args), true);
      await dependencies.readReceipt(input); // S09 closes admission with a fresh canonical read.
      return 0;
    } };
  const transcript = [];
  for (let minute = 0; minute <= 24; minute++) {
    t.mock.timers.setTime(NOW + minute * 60_000);
    w.claims.iat = Date.now() / 1000; w.claims.nbf = w.claims.iat - 1; w.claims.exp = w.claims.iat + 300;
    const before = w.calls.filter(c => c.url === 'https://capacity.invalid/capacity/receipt').length;
    for (let phase = 0; phase < 5; phase++) assert.equal(await bridge('admit', env, ports), 0);
    const reads = w.calls.filter(c => c.url === 'https://capacity.invalid/capacity/receipt').length - before;
    assert.equal(reads, 10, 'reader documents add no receipt reservations');
    await assert.rejects(retainedReaders.readProvenance(w.args), /receipt_observation_missing/, 'snapshot is closed after isolation returns');
    // Authenticated result delivery shares this lane. Reserve its actual policy slot; transport delivery itself
    // is exercised in the existing composed suite, not inferred from this synthetic acknowledgement.
    const reserve = () => w.state.budget.run(async () => clone(w.claims), () => 'receipt', async () => ({ accepted: true }));
    assert.deepEqual(await reserve(), { accepted: true });
    await reserve(); // The twelfth slot is available; the thirteenth is still refused.
    await assert.rejects(reserve(), /work_limited/);
    transcript.push({ minute, receiptReads: reads, resultReservations: 1, normalReservations: reads + 1 });
  }
  // Revocation after native readiness must still fail the closing authenticated receipt read.
  t.mock.timers.setTime(NOW + 25 * 60_000);
  const ready = w.native.inspectReadiness;
  w.native.inspectReadiness = async args => { const value = await ready(args); w.state.revoked = true; return value; };
  await assert.rejects(bridge('admit', env, ports), /capacity_receipt_refused/);
  assert.ok(transcript.every(row => row.normalReservations < 12 && row.normalReservations * 6 <= 96));
  console.log('HOSTED_8345_CADENCE ' + JSON.stringify({ transcript, periodicPolling: 'none', protectedRolloverUnderFlood: 'not qualified' }));
});


test('readiness requires the exact trusted JobContainer profile, not a lookalike port object', async t => {
  const w = world(t);
  for (const job of [{ profileId: 'hosted', policy: w.native.policy, inspectReadiness: w.native.inspectReadiness },
    Object.assign(new JobContainer(w.native.policy, { profileId: 'github-8', engine: w.native.engine }), { inspectReadiness: w.native.inspectReadiness })]) {
    const readers = createHostedReaders({ ...w.options, job });
    await assert.rejects(readers.readProvenance(w.args), /job_unconfigured/);
    await assert.rejects(readers.readBoundaryReadiness(w.args), /job_unconfigured|provenance_required/);
  }
});
test('D8345-p1: the inspection-time job check stays after the early refusal', async t => {
  // A job whose profile changes after provenance cannot serve readiness or the live boundary.
  for (const method of ['readBoundaryReadiness', 'readBoundary']) await t.test(method, async t => {
    const v = world(t); await v.readers.readProvenance(v.args); v.native.profileId = 'github-8';
    await assert.rejects(v.readers[method](v.args), /job_unconfigured/, method);
    assert.equal(v.calls.some(c => c.engine), false);
  });
});

test('bridge snapshot age is bounded before isolation even when reader documents are fresh', async t => {
  for (const age of [-1, 29_000, 30_000, 30_001, 31_000]) await t.test(String(age), async t => {
    const w = world(t); w.native.owned = null;
    // D8345-p1: issue the token ten seconds earlier, so only the bridge's own non-future guard refuses the -1 ms case.
    w.claims.iat = NOW / 1000 - 10; w.claims.nbf = w.claims.iat - 1;
    t.mock.method(globalThis, 'fetch', w.options.issuerFetch);
    const env = { GITHUB_REPOSITORY: REPO, EXECUTOR_SHA: EXEC, CHILD_WORKFLOW_SHA: EXEC, GITHUB_WORKFLOW_SHA: EXEC,
      GITHUB_RUN_ID: '202', GITHUB_RUN_ATTEMPT: '1', PROFILE: 'hosted', CI_CAPACITY_AUDIENCE: w.claims.aud,
      GH_TOKEN: 'fixture-only', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://fixture.actions.githubusercontent.com/token', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fixture-only' };
    const accepted = age >= 0 && age <= 30_000;
    const code = await bridge('admit', env, { results: { read: () => null }, store: {},
      authority: { readReceipt: w.options.readReceipt },
      isolationFactory(profileId, options) {
        return hostedExecutorDependencies({ ...options, profileId, boundaryJob: () => w.native });
      },
      async admit(_env, dependencies) {
        const input = { request: { requestId: w.receipt.requestId, shard: w.receipt.logicalShard,
          generation: w.receipt.generation, profile: w.receipt.profile }, context: w.args.context, phase: 'execute' };
        await dependencies.readReceipt(input);
        t.mock.timers.setTime(NOW + age);
        assert.equal(await dependencies.verifyIsolation(w.args), accepted, `snapshot age ${age}`);
        if (accepted) await dependencies.readReceipt(input);
        return accepted ? 0 : 1;
      } });
    assert.equal(code, accepted ? 0 : 1);
  });
});

// D8345-p1: S21's H2 direct reader checks, H4 early refusal and the reconciliation of reader output with S09's ports.
const bridgeEnv = (w, profile = 'hosted') => ({ GITHUB_REPOSITORY: REPO, EXECUTOR_SHA: EXEC, CHILD_WORKFLOW_SHA: EXEC, GITHUB_WORKFLOW_SHA: EXEC,
  GITHUB_RUN_ID: '202', GITHUB_RUN_ATTEMPT: '1', PROFILE: profile, CI_CAPACITY_AUDIENCE: w.claims.aud,
  GH_TOKEN: 'fixture-only', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://fixture.actions.githubusercontent.com/token', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fixture-only' });
const receiptInput = w => ({ request: { requestId: w.receipt.requestId, shard: w.receipt.logicalShard,
  generation: w.receipt.generation, profile: w.receipt.profile }, context: w.args.context, phase: 'execute' });
const outbound = calls => calls.filter(c => c.url);

test('D8345-p1 H2: an inactive authority envelope refuses directly, before any OIDC or Actions call', async t => {
  for (const active of [false, 'true', 1, undefined]) await t.test(String(active), async t => {
    const w = world(t);
    const readers = createHostedReaders({ ...w.options, readReceipt: async () => ({ ...clone(w.envelope), active }) });
    await assert.rejects(readers.readProvenance(w.args), /hosted_receipt_changed/);
    assert.deepEqual(outbound(w.calls), []);
  });
});

test('D8345-p1 H2: a self-hosted label on the target job refuses in the reader, whatever its case', async t => {
  for (const label of ['self-hosted', 'Self-Hosted', 'SELF-HOSTED']) await t.test(label, async t => {
    const w = world(t); w.selected.labels = ['ubuntu-latest', label];
    await assert.rejects(w.readers.readProvenance(w.args), /hosted_target_job_refused/);
  });
});

test('D8345-p1 H2: a failed provenance refresh clears earlier provenance for every later reader', async t => {
  for (const method of ['readBoundaryReadiness', 'readBoundary']) await t.test(method, async t => {
    const w = world(t); await w.readers.readProvenance(w.args);
    w.state.jobs = []; w.state.total = 0; // The second refresh finds no target job.
    await assert.rejects(w.readers.readProvenance(w.args), /hosted_target_job_refused/);
    await assert.rejects(w.readers[method](w.args), /hosted_provenance_required/);
    assert.equal(w.calls.some(c => c.engine), false, 'no engine call without current provenance');
  });
});

test('D8345-p1 H2: one readers object never serves a second receipt binding', async t => {
  for (const field of ['generation', 'planDigest', 'requestId']) await t.test(field, async t => {
    const w = world(t);
    const readers = createHostedReaders({ ...w.options, readReceipt: async () => clone(w.envelope) });
    await readers.readProvenance(w.args);
    const other = clone(w.receipt);
    other[field] = field === 'generation' ? 4 : field === 'planDigest' ? `sha256:${'9'.repeat(64)}` : '83450000-0000-4000-8000-000000000002';
    w.envelope.receipt = clone(other); // Authority agrees with the second receipt; only the reader's scope latch differs.
    const before = outbound(w.calls).length;
    await assert.rejects(readers.readProvenance({ ...w.args, receipt: other }), /hosted_reader_scope_changed/);
    assert.equal(outbound(w.calls).length, before, 'no OIDC, JWKS or Actions call after the scope refusal');
  });
});

test('D8345-p1 H2: two distinct Actions jobs naming the same check run refuse', async t => {
  const w = world(t);
  w.state.jobs = [w.selected, { ...clone(w.selected), id: 908 }]; w.state.total = 2;
  await assert.rejects(w.readers.readProvenance(w.args), /hosted_target_job_refused/);
  w.state.jobs = [{ ...clone(w.selected), id: 908 }, w.selected];
  await assert.rejects(w.readers.readProvenance(w.args), /hosted_target_job_refused/, 'order does not pick a winner');
});

test('D8345-p1 H4: with no trusted boundary job, hosted admission refuses before any OIDC, JWKS or Actions call', async t => {
  for (const [name, profile, other] of [['default hosted', 'hosted', null], ['default github-8', 'github-8', null],
    ['job of the other profile', 'hosted', 'github-8']]) await t.test(name, async t => {
    const w = world(t, profile); t.mock.method(globalThis, 'fetch', w.options.issuerFetch);
    const ports = { results: { read: () => null }, store: {}, authority: { readReceipt: w.options.readReceipt },
      async admit(_env, dependencies) {
        await dependencies.readReceipt(receiptInput(w));
        const before = w.calls.length;
        assert.equal(await dependencies.verifyIsolation(w.args), false);
        assert.deepEqual(w.calls.slice(before), [], 'the refusing admission makes no outbound or engine call');
        return 1;
      } };
    // Default composition: the real isolationFor and hostedBoundaryJob (null). Otherwise a job serving another profile.
    if (other) ports.isolationFactory = (profileId, options) => hostedExecutorDependencies({ ...options, profileId,
      boundaryJob: () => new JobContainer(w.native.policy, { profileId: other, engine: w.native.engine }) });
    assert.equal(await bridge('admit', bridgeEnv(w, profile), ports), 1);
    const readers = hostedReaderFactory(bridgeEnv(w, profile), w.options.readReceipt, { fetcher: w.options.issuerFetch })({ job: null });
    const before = w.calls.length;
    await assert.rejects(readers.readProvenance(w.args), /hosted_native_job_unconfigured/);
    assert.deepEqual(w.calls.slice(before), []);
  });
});

test('D8345-p1 reconciliation: real readers through the bridge and S09 execution port, before install and before test', async t => {
  for (const profile of ['hosted', 'github-8']) await t.test(profile, async t => {
    const w = world(t, profile); t.mock.method(globalThis, 'fetch', w.options.issuerFetch);
    const receiptReads = () => w.calls.filter(c => c.url === 'https://capacity.invalid/capacity/receipt').length;
    const ports = { results: { read: () => null }, store: {}, authority: { readReceipt: w.options.readReceipt },
      isolationFactory: (profileId, options) => hostedExecutorDependencies({ ...options, profileId, boundaryJob: () => w.native }),
      async execute(mode, _env, deps) {
        assert.equal(mode, 'verify-plan'); assert.equal(deps.job, w.native);
        // The exact argument shape runner-execution's admit/recheck pass to executionIsolation.
        const check = () => deps.executionIsolation({ receipt: clone(w.receipt), context: clone(w.args.context),
          profile: clone(w.args.profile), phase: 'execute', signal: new AbortController().signal });
        const identity = w.native.boundaryIdentity(), reads = receiptReads();
        assert.equal(await check(), true, 'before install');
        assert.equal(await check(), true, 'before test');
        assert.equal(receiptReads() - reads, 2, 'one authenticated refresh per check, none per reader document');
        assert.deepEqual(w.native.boundaryIdentity(), identity, 'reading never changes the live instance');
        w.state.egressProof = false; // The actual S09 inspection today: host control is not denied.
        assert.equal(await check(), false, 'unverified egress refuses at the execution port');
        w.state.egressProof = true;
        const owned = w.native.owned; w.native.owned = null;
        assert.equal(await check(), false, 'no live instance is unbound'); w.native.owned = owned;
        const live = w.native.inspectBoundary;
        w.native.inspectBoundary = async args => ({ ...await live(args), instanceId: 'd'.repeat(64) });
        assert.equal(await check(), false, 'a document naming another instance refuses'); w.native.inspectBoundary = live;
        w.native.inspectReadiness = async () => { throw Error('readiness is never read by the execution port'); };
        if (profile === 'github-8') {
          const evidence = w.envelope.hostedEvidence; delete w.envelope.hostedEvidence;
          assert.equal(await check(), false, 'github-8 execution still needs the authority lane'); w.envelope.hostedEvidence = evidence;
        }
        assert.equal(await check(), true, 'restored');
        return 0;
      } };
    assert.equal(await bridge('verify-plan', bridgeEnv(w, profile), ports), 0);
  });
});

test('D8345-p1 reconciliation: reader documents carry exactly the identities S09 verifies', async t => {
  const w = world(t, 'github-8', 'c'.repeat(40)), owned = w.native.owned; w.native.owned = null;
  const provenance = await w.readers.readProvenance(w.args);
  const readiness = await w.readers.readBoundaryReadiness(w.args), lane = await w.readers.readIncludedEligibility(w.args);
  assert.equal(Object.hasOwn(readiness, 'instanceId'), false);
  w.native.owned = owned; const live = await w.readers.readBoundary(w.args);
  for (const document of [provenance, readiness, live, lane]) {
    assert.equal(document.binding.childWorkflowSha, 'c'.repeat(40), 'the exact child pin');
    assert.equal(document.binding.executorSha, EXEC, 'the control revision stays separate');
  }
  assert.deepEqual([readiness.jobId, live.jobId, lane.jobId], [909, 909, 909], 'every native and lane document names the provenance job');
  assert.deepEqual({ instanceId: live.instanceId, policyDigest: live.policyDigest },
    { instanceId: w.native.boundaryIdentity().instanceId, policyDigest: w.native.boundaryIdentity().policyDigest });
  assert.equal(readiness.policyDigest, live.policyDigest, 'admission readiness and live inspection name one policy');
  assert.equal(readiness.observedAt, NOW, 'inspection time is preserved, not re-stamped');
});

/** A stateful synthetic engine for one hosted JobContainer: create/start/inspect/exec/rm, state built from the create args. */
function hostedEngine(t) {
  const root = mkdtempSync(join(tmpdir(), 'hosted-8345-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source'), plan = join(root, 'plan.json'), id = 'b'.repeat(64);
  mkdirSync(source); writeFileSync(plan, '{}');
  let info = null, removed = false; const calls = [];
  const engine = async args => {
    calls.push(args[0]);
    if (args[0] === 'create') {
      const val = k => args[args.indexOf(k) + 1], all = k => args.flatMap((v, i) => v === k ? [args[i + 1]] : []);
      info = { Id: id, Image: args.at(-3), State: { Running: true, Pid: 123 },
        Config: { User: val('--user'), Labels: Object.fromEntries([val('--label').split('=')]), Entrypoint: [val('--entrypoint')], Cmd: args.slice(-2), Env: all('--env') },
        HostConfig: { Privileged: false, Init: true, ReadonlyRootfs: true, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], PidMode: '', IpcMode: 'private',
          CgroupnsMode: 'private', NetworkMode: 'bridge', PidsLimit: 256, Memory: 4294967296, NanoCpus: 2e9,
          Tmpfs: Object.fromEntries(all('--tmpfs').map(v => [v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':') + 1)])) },
        Mounts: [{ Type: 'bind', Source: source, Destination: '/input', RW: false, Propagation: 'rprivate' },
          { Type: 'bind', Source: plan, Destination: '/input-plan.json', RW: false, Propagation: 'rprivate' }] };
      return `${id}\n`;
    }
    if (args[0] === 'inspect') { if (removed) throw Object.assign(Error('gone'), { stderr: `Error: No such object: ${id}` }); return JSON.stringify([info]); }
    if (args[0] === 'rm') { removed = true; return ''; }
    if (args[0] === 'exec' && args.includes('-e')) return 'readable';
    if (args[0] === 'exec' && args.includes('/usr/local/bin/python3')) return '3.11.18\n';
    if (args[0] === 'exec' && args.includes('/usr/local/bin/node')) return '22.23.3\n';
    return '';
  };
  return { root, source, plan, engine, calls, removed: () => removed };
}

test('D8345-p1 chain: authenticated receipt, real readers and S09 execution port drive install, recheck, test, export and verified removal', async t => {
  for (const [name, testScript, egressAtRecheck] of [['success', 'exit 0', true], ['sticky test failure', 'exit 3', true],
    ['host control not denied at the pre-test recheck', 'exit 0', false]]) await t.test(name, async t => {
    const w = world(t), f = hostedEngine(t), phases = [];
    const job = new JobContainer(w.native.policy, { profileId: 'hosted', engine: f.engine, stage: async () => {}, namespace: () => true,
      spawnEngine: args => { const phase = args.at(-1).includes('npm ci') ? 'install' : 'test'; phases.push(phase);
        return spawn('/bin/sh', ['-c', phase === 'install' ? 'exit 0' : testScript], { stdio: 'ignore' }); } });
    // Synthetic egress qualification only; the actual S09 inspectBoundary reports deniesHostControl: false.
    const inspect = job.inspectBoundary.bind(job);
    job.inspectBoundary = async args => { const value = await inspect(args); return value && { ...value, deniesHostControl: w.state.egressProof }; };
    const deps = hostedExecutorDependencies({ profileId: 'hosted', boundaryJob: () => job, readers: ({ job: trusted }) => createHostedReaders({ ...w.options, job: trusted }) });
    assert.equal(deps.job, job);
    const call = signal => ({ receipt: clone(w.receipt), context: clone(w.args.context), profile: clone(w.args.profile), phase: 'execute', signal });
    const admitted = { allowed: true, identity: clone(w.receipt), sourceSha: SOURCE, originalRunId: 101, originalAttempt: 1, originalEvent: 'push', sourceRef: 'refs/heads/main' };
    const seen = [], logs = [];
    const code = await runInContainer({ job, executionIsolation: deps.executionIsolation, current: { profile: w.args.profile, identity: clone(w.receipt) },
      paths: { source: f.source }, planPath: f.plan, signal: new AbortController().signal, store: recoveryStore({ root: join(f.root, 'state'), create: true }),
      exporter: async () => ({ state: 'complete', files: 1, bytes: 10 }), log: line => logs.push(line), output: () => {},
      admit: async (verifyIsolation, { signal }) => { const ok = await verifyIsolation(call(signal)); seen.push(['admit', ok]); return ok ? admitted : { allowed: false }; },
      recheck: async ({ signal }) => { w.state.egressProof = egressAtRecheck; const ok = await deps.executionIsolation(call(signal)); seen.push(['recheck', ok]); return ok; } });
    const outcome = JSON.parse(logs.find(line => line.includes('container_outcome')));
    assert.deepEqual(seen, [['admit', true], ['recheck', egressAtRecheck]]);
    assert.equal(outcome.install.status, 'success');
    assert.equal(outcome.cleanup.state, 'complete'); assert.equal(f.removed(), true, 'removal is verified on every path');
    if (!egressAtRecheck) {
      assert.deepEqual(phases, ['install'], 'no test runs after a refused recheck');
      assert.deepEqual([outcome.category, outcome.infrastructure, outcome.test.status, code], ['infrastructure', 'boundary_recheck_failed', 'not_run', 1]);
    } else if (testScript === 'exit 3') {
      assert.deepEqual([outcome.category, outcome.test.status, outcome.test.exitCode, code], ['test_failure', 'failure', 3, 3], 'the verified test failure keeps its raw exit');
    } else {
      assert.deepEqual([outcome.category, outcome.test.status, outcome.export.state, code], ['success', 'success', 'complete', 0]);
    }
  });
});
