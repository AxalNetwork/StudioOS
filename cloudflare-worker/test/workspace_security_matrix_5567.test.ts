/**
 * D5567 part 2 (#5567): the issue's acceptance matrix, one test per case,
 * each held against the real Worker bridge. That means `authorizeCompute`
 * over migrated SQLite, the real `createWorkspaceSecurity`, and the compute
 * host's own store (`_compute_world_4557.ts`), not a stubbed `authorize`.
 * Every identity, key and object is synthetic. These are local contract
 * tests; they claim nothing about a hosted sandbox (D5567).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/workspace_security_matrix_5567.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeWorld } from './_compute_world_4557.ts';
import { AGENT, SPONSOR, STRANGER, PROJECT, loopDeps } from './_agent_engine_fixture.ts';
import { createComputeRequest, uploadComputeInput, readyComputeRequest, dispatchCompute, authorizeCompute } from '../src/services/agents/computeBridge.ts';
import { load } from '../src/agents/loop.ts';
import { computeTarget } from '../src/services/agents/computeHost.ts';
import { workspaceDestination } from '../src/services/agents/workspaceSecurity.ts';
import { removeMigratedDatabases } from './_storage_schema.ts';

test.after(() => removeMigratedDatabases());
const requestInput = { workload: 'python', operation: 'sum', inputs: [{ name: 'values.json', bytes: 7 }] };
const project = { kind: 'project' as const, id: PROJECT };
const noModel = async () => { throw Error('compute_must_not_fall_back_to_generation'); };

/** A dispatched job with its run registered in the host's security store. */
async function dispatched(w: Awaited<ReturnType<typeof computeWorld>>, taskId = 201) {
  const request = await createComputeRequest(w.env, w.user(), taskId, requestInput);
  await uploadComputeInput(w.env, w.user(), request.uid, 'values.json', new Request('https://synthetic/upload', { method: 'PUT', body: '[1,2,3]' }));
  await readyComputeRequest(w.env, w.user(), request.uid);
  const admitted = await w.runtime.admit(project, { agentId: AGENT, taskId, by: SPONSOR, source: 'person' });
  assert.ok(admitted.ok, JSON.stringify(admitted));
  await w.runtime.startRun(project, admitted.run.uid);
  await load(loopDeps(w, noModel), admitted.run.uid);
  await dispatchCompute(w.env, admitted.run.uid);
  const job = w.db.prepare('SELECT * FROM agent_compute_jobs WHERE run_uid = ?').get(admitted.run.uid) as any;
  const meta = w.db.prepare('SELECT * FROM agent_compute_executions WHERE job_uid = ?').get(job.uid) as any;
  const admission = { job_uid: job.uid, spec: JSON.parse(meta.spec_json), sponsor: JSON.parse(meta.sponsor_json) };
  const { security } = w.hosts.get(job.uid)!;
  assert.deepEqual(await security.register(admission.spec, admission.sponsor), { ok: true, value: true });
  return { job, admission, security };
}
const code = (r: any) => (r.ok ? 'ok' : r.code);
const decodeClaims = (token: string) => JSON.parse(Buffer.from(token.split('.')[0].replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString('utf8'));

test('1. cross-venture: another company\'s sponsor, or another run, is refused', async () => {
  const w = await computeWorld();
  try {
    const { admission, security } = await dispatched(w);
    const elsewhere = { ...admission.sponsor, company_id: admission.sponsor.company_id + 1 };
    assert.equal(code(await security.register(admission.spec, elsewhere)), 'sponsor_scope_denied');
    assert.equal((await authorizeCompute(w.env, admission.job_uid, { ...admission, sponsor: elsewhere })).allowed, false);
    const other = { ...computeTarget(admission, 'executor.complete'), run_id: `${admission.spec.run_id}x` };
    assert.equal(code(await security.issue(other)), 'stale_generation', 'no grant for a run this host never registered');
  } finally { w.close(); }
});

test('2. revoked sponsor: a grant issued before the sponsor is disabled does not redeem', async () => {
  const w = await computeWorld();
  try {
    const { admission, security } = await dispatched(w);
    const target = computeTarget(admission, 'executor.complete');
    const grant = await security.issue(target); assert.ok(grant.ok);
    w.db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(SPONSOR);
    assert.equal(code(await security.redeem(grant.value.token, target)), 'sponsor_not_authorized');
    assert.equal(code(await security.issue(target)), 'sponsor_not_authorized', 'and no new grant is issued');
  } finally { w.close(); }
});

test('2b. revoke and re-grant inside one grant\'s life: the grant still dies (D5567 part 3, the revision triggers)', async () => {
  const w = await computeWorld();
  try {
    const { admission, security } = await dispatched(w);
    const target = computeTarget(admission, 'executor.complete');
    const grant = await security.issue(target); assert.ok(grant.ok);
    assert.equal(decodeClaims(grant.value.token).permission_revision, 1, 'no change yet: revision 1');
    // Someone else's access changing touches nothing of this sponsor's.
    w.db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(STRANGER);
    const other = await security.issue(target); assert.ok(other.ok, 'an unrelated member\'s change leaves the run alone');
    w.db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(SPONSOR);
    w.db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(SPONSOR);
    assert.equal((await authorizeCompute(w.env, admission.job_uid, admission)).allowed, true, 'the access is back');
    assert.equal((await authorizeCompute(w.env, admission.job_uid, admission)).revision, 3, 'two changes, two steps');
    assert.equal(code(await security.redeem(grant.value.token, target)), 'sponsor_not_authorized', 'the grant from before the revocation is dead');
    assert.equal(code(await security.redeem(other.value.token, target)), 'sponsor_not_authorized');
    assert.equal(code(await security.issue(target)), 'sponsor_not_authorized', 'the run registered before it gets no new grant');
    w.db.exec('ALTER TABLE agent_authz_revisions RENAME TO agent_authz_revisions_gone');
    assert.equal((await authorizeCompute(w.env, admission.job_uid, admission)).allowed, false, 'an unreadable revision refuses');
  } finally { w.close(); }
});

test('3. forged callback: a changed signature or payload is refused', async () => {
  const w = await computeWorld();
  try {
    const { admission, security } = await dispatched(w);
    const target = computeTarget(admission, 'executor.complete');
    const grant = await security.issue(target); assert.ok(grant.ok);
    const [payload, signature] = grant.value.token.split('.');
    assert.equal(code(await security.redeem(`${payload}.${signature.slice(0, -2)}AA`, target)), 'grant_invalid');
    const claims = decodeClaims(grant.value.token);
    const forged = Buffer.from(JSON.stringify({ ...claims, member_id: STRANGER })).toString('base64url');
    assert.equal(code(await security.redeem(`${forged}.${signature}`, target)), 'grant_invalid');
    assert.equal(code(await security.redeem(grant.value.token, target)), 'ok', 'the untouched grant still redeems once');
  } finally { w.close(); }
});

test('4. expired token: a grant past its expiry does not redeem', async (t) => {
  const w = await computeWorld();
  try {
    const { admission, security } = await dispatched(w);
    const target = computeTarget(admission, 'executor.complete');
    const grant = await security.issue(target, 1000); assert.ok(grant.ok);
    t.mock.timers.enable({ apis: ['Date'], now: grant.value.expires_at });
    assert.equal(code(await security.redeem(grant.value.token, target)), 'grant_expired');
  } finally { w.close(); }
});

test('5. nonce replay: a grant redeems once, also when two redemptions race', async () => {
  const w = await computeWorld();
  try {
    const { admission, security } = await dispatched(w);
    const target = computeTarget(admission, 'executor.complete');
    const grant = await security.issue(target); assert.ok(grant.ok);
    const both = await Promise.all([security.redeem(grant.value.token, target), security.redeem(grant.value.token, target)]);
    assert.deepEqual(both.map(code).sort(), ['grant_replay', 'ok']);
    assert.equal(code(await security.redeem(grant.value.token, target)), 'grant_replay');
  } finally { w.close(); }
});

test('6. late attempt: once the run moves to a new generation, the old generation\'s grant is dead', async () => {
  const w = await computeWorld();
  try {
    const { admission, security } = await dispatched(w);
    const target = computeTarget(admission, 'executor.complete');
    const grant = await security.issue(target); assert.ok(grant.ok);
    // The bridge's generation is D1's (a cancel bumps it); the host may not move on by itself.
    const next = { ...admission.spec, execution_generation: admission.spec.execution_generation + 1 };
    await assert.rejects(security.advance(next), (e: any) => e instanceof Response && e.status === 403, 'the host cannot advance a generation D1 has not recorded');
    w.db.prepare('UPDATE agent_compute_executions SET generation = generation + 1 WHERE job_uid = ?').run(admission.job_uid);
    assert.equal(code(await security.redeem(grant.value.token, target)), 'sponsor_not_authorized');
    assert.equal(code(await security.redeem(grant.value.token, { ...target, execution_generation: next.execution_generation })), 'grant_target_denied');
    assert.equal(code(await security.advance({ ...next, attempt: next.attempt + 1 })), 'generation_advance_denied',
      'an advance cannot change the attempt (or anything but the generation)');
  } finally { w.close(); }
});

test('7. path traversal: an object reference outside the opaque form is never granted', async () => {
  const w = await computeWorld();
  try {
    const { admission, security } = await dispatched(w);
    for (const ref of ['../other-tenant', 'a/../../b', '/etc/passwd', 'objects\\..\\x', '']) {
      const r = await security.issue(computeTarget(admission, 'artifact.read', ref, 'global'));
      assert.equal(r.ok, false, `issued for ${JSON.stringify(ref)}`);
    }
  } finally { w.close(); }
});

test('8. metadata, localhost and egress: the compute spec allows no destination at all', async () => {
  const w = await computeWorld();
  try {
    const { admission } = await dispatched(w);
    for (const url of ['http://169.254.169.254/latest/meta-data/', 'https://metadata.google.internal/', 'https://localhost/', 'https://127.0.0.1/',
      'https://[::1]/', 'https://example.com/', 'https://user:pw@example.com/']) {
      assert.equal(workspaceDestination(admission.spec, url), false, url);
    }
  } finally { w.close(); }
});

test('9. leaked credentials: a grant carries no secret and opens nothing but its own target', async () => {
  const w = await computeWorld(), other = await computeWorld();
  try {
    const first = await dispatched(w);
    const second = await dispatched(other);
    const target = computeTarget(first.admission, 'executor.complete');
    const grant = await first.security.issue(target); assert.ok(grant.ok);
    assert.deepEqual(Object.keys(decodeClaims(grant.value.token)).sort(), ['agent_id', 'attempt', 'aud', 'company_id', 'contract_hash', 'execution_generation', 'exp',
      'iat', 'member_id', 'nonce', 'object_ref', 'permission_revision', 'project_id', 'region', 'run_id', 'task_id', 'tenant_id', 'version']);
    assert.doesNotMatch(grant.value.token, /synthetic-compute-control-secret/, 'the control secret never rides in a grant');
    const elsewhere = { ...computeTarget(second.admission, 'executor.complete'), run_id: target.run_id };
    assert.notEqual(code(await second.security.redeem(grant.value.token, elsewhere)), 'ok', 'another deployment\'s host refuses it');
    assert.equal(code(await first.security.redeem(grant.value.token, computeTarget(first.admission, 'executor.heartbeat'))), 'grant_target_denied', 'another audience refuses it');
    assert.equal(code(await first.security.redeem(grant.value.token, { ...target, object_ref: 'objref' })), 'grant_target_denied', 'another object refuses it');
    assert.equal(code(await first.security.redeem(grant.value.token, target)), 'ok');
  } finally { w.close(); other.close(); }
});

test('10. privilege escalation: an operator cannot take a runner audience, and a stranger is no operator', async () => {
  const w = await computeWorld();
  try {
    const { admission, security } = await dispatched(w);
    const stranger = { ...admission.sponsor, member_id: STRANGER };
    assert.equal(code(await security.issue(computeTarget(admission, 'executor.complete'), 30000, stranger)), 'operator_audience_denied');
    assert.equal(code(await security.issue(computeTarget(admission, 'artifact.read', 'objref', 'global'), 30000, stranger)), 'operator_audience_denied');
    assert.equal(code(await security.issue(computeTarget(admission, 'executor.cancel'), 30000, stranger)), 'sponsor_not_authorized');
    assert.equal(code(await security.issue(computeTarget(admission, 'integration.publish', 'objref', 'global'))), 'sponsor_not_authorized',
      'publishing stays shut: the bridge never reports an approval');
  } finally { w.close(); }
});
