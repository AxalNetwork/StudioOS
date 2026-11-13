/** D4557: real migrated SQL, canonical grants and the existing Workflow/proposal journey; all data synthetic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { computeWorld } from './_compute_world_4557.ts';
import { AGENT, ADMIN, SPONSOR, STRANGER, PROJECT, loopDeps } from './_agent_engine_fixture.ts';
import { createComputeRequest, computeRunRequested, uploadComputeInput, readyComputeRequest, dispatchCompute, cancelComputeRun, computeInternal, authorizeCompute, eraseComputeData, sweepComputeObjects } from '../src/services/agents/computeBridge.ts';
import { runTaskLoop, load, runStep } from '../src/agents/loop.ts';
import { createJob } from '../src/services/agents/compute.ts';
import { computeTarget } from '../src/services/agents/computeHost.ts';
import { router } from '../src/routes/agent_compute.ts';
import { createJWT } from '../src/auth.ts';
import { storageUsedBytes } from '../src/services/storageUsage.ts';
import { removeMigratedDatabases } from './_storage_schema.ts';

test.after(() => removeMigratedDatabases());
const requestInput = { workload: 'python', operation: 'sum', inputs: [{ name: 'values.json', bytes: 7 }] };
const project = { kind: 'project' as const, id: PROJECT };
async function prepare(w: Awaited<ReturnType<typeof computeWorld>>) {
  const request = await createComputeRequest(w.env, w.user(), 201, requestInput);
  await uploadComputeInput(w.env, w.user(), request.uid, 'values.json', new Request('https://synthetic/upload', { method: 'PUT', body: '[1,2,3]' }));
  await readyComputeRequest(w.env, w.user(), request.uid);
  const admitted = await w.runtime.admit(project, { agentId: AGENT, taskId: 201, by: SPONSOR, source: 'person' });
  assert.ok(admitted.ok, JSON.stringify(admitted));
  await w.runtime.startRun(project, admitted.run.uid);
  return { request, runUid: admitted.run.uid };
}
const noModel = async () => { throw Error('compute_must_not_fall_back_to_generation'); };

test('ordinary member stages bytes; existing Workflow produces one private artifact proposal without a model call or automatic approval', async () => {
  const w = await computeWorld();
  try {
    const { runUid } = await prepare(w), saved = new Map<string, unknown>();
    const step = {
      async do<T>(name: string, _config: unknown, fn: () => Promise<T>) { if (!saved.has(name)) saved.set(name, await fn()); return saved.get(name) as T; },
      async waitForEvent<T>(_name: string, options: { type: string }) {
        if (options.type !== 'compute') throw Error('synthetic_no_human_decision');
        await w.runAlarms(); return { payload: { job_uid: 'metadata-only' } as T };
      },
    };
    const completed = await runTaskLoop(runUid, step, loopDeps(w, noModel));
    assert.equal(completed.go, false); assert.equal((completed as any).status, 'waiting_decision');
    const job = w.db.prepare('SELECT * FROM agent_compute_jobs WHERE run_uid = ?').get(runUid) as any;
    assert.equal(job.status, 'succeeded'); assert.equal(w.stats.starts, 1);
    const proposal = w.db.prepare('SELECT status, payload_json FROM ai_rail_proposals WHERE run_key = ?').get(`agent:${runUid}`) as any;
    assert.equal(proposal.status, 'proposed');
    const payload = JSON.parse(proposal.payload_json); assert.equal(payload.compute_artifacts.length, 1);
    assert.equal(JSON.stringify(payload).includes('"sum":6'), false);
    assert.doesNotMatch(JSON.stringify(w.stats.vmInputs), /SECRET|control|token|D1|R2|member_id|sponsor/);
    await runStep(loopDeps(w, noModel), runUid);
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM ai_rail_proposals WHERE run_key = ?').get(`agent:${runUid}`) as any).n, 1);
    assert.equal((await storageUsedBytes(w.env, SPONSOR))?.measured_bytes, 16);
  } finally { w.close(); }
});

test('cross-member requests, raw scripts, quotas and unready inputs refuse before admission', async () => {
  const w = await computeWorld();
  try {
    await assert.rejects(createComputeRequest(w.env, w.user(STRANGER), 201, requestInput), error => error instanceof Response && error.status === 404);
    await assert.rejects(createComputeRequest(w.env, w.user(), 201, { ...requestInput, operation: 'shell' }));
    await assert.rejects(createComputeRequest(w.env, w.user(), 201, { ...requestInput, inputs: [{ name: 'code.py', bytes: 1 }] }));
    const request = await createComputeRequest(w.env, w.user(), 201, requestInput);
    assert.equal((await w.runtime.admit(project, { agentId: AGENT, taskId: 201, by: SPONSOR, source: 'person' })).ok, false);
    await assert.rejects(readyComputeRequest(w.env, w.user(), request.uid));
    await assert.rejects(uploadComputeInput(w.env, w.user(), request.uid, 'values.json', new Request('https://synthetic/upload', { method: 'PUT', body: 'longer-than-seven' })));
    assert.equal(w.objects.size, 0); assert.equal(w.stats.starts, 0);
  } finally { w.close(); }
});

test('cancellation is persisted before stop, stale grants fail, and an unconfirmed stop remains retryable after admission is off', async () => {
  const w = await computeWorld();
  try {
    const { runUid } = await prepare(w); await load(loopDeps(w, noModel), runUid); await dispatchCompute(w.env, runUid);
    const job = w.db.prepare('SELECT * FROM agent_compute_jobs WHERE run_uid = ?').get(runUid) as any;
    const selected = w.hosts.get(job.uid)!;
    const meta = w.db.prepare('SELECT * FROM agent_compute_executions WHERE job_uid = ?').get(job.uid) as any;
    const admission = { job_uid: job.uid, spec: JSON.parse(meta.spec_json), sponsor: JSON.parse(meta.sponsor_json) };
    await selected.security.register(admission.spec, admission.sponsor);
    const grant = await selected.security.issue(computeTarget(admission, 'executor.complete')); assert.ok(grant.ok);
    w.stats.stopFails = true; await assert.rejects(cancelComputeRun(w.env, runUid));
    assert.equal((w.db.prepare('SELECT status FROM agent_compute_jobs WHERE uid = ?').get(job.uid) as any).status, 'cancelled');
    assert.equal((await selected.security.redeem(grant.value.token, computeTarget(admission, 'executor.complete'))).ok, false);
    w.stats.stopFails = false; w.env.AGENT_COMPUTE = 'off'; await cancelComputeRun(w.env, runUid);
    assert.equal((w.db.prepare('SELECT cleanup_required, generation FROM agent_compute_executions WHERE job_uid = ?').get(job.uid) as any).cleanup_required, 0);
    assert.equal((w.db.prepare('SELECT generation FROM agent_compute_executions WHERE job_uid = ?').get(job.uid) as any).generation, 2);
    assert.equal(w.stats.starts, 0);
  } finally { w.close(); }
});

test('a company transfer or disabled sponsor invalidates the canonical permit before artifacts are accepted', async () => {
  for (const change of ['company', 'sponsor']) {
    const w = await computeWorld();
    try {
      const { runUid } = await prepare(w); await load(loopDeps(w, noModel), runUid); await dispatchCompute(w.env, runUid);
      const job = w.db.prepare('SELECT * FROM agent_compute_jobs WHERE run_uid = ?').get(runUid) as any;
      const meta = w.db.prepare('SELECT * FROM agent_compute_executions WHERE job_uid = ?').get(job.uid) as any;
      const admission = { job_uid: job.uid, spec: JSON.parse(meta.spec_json), sponsor: JSON.parse(meta.sponsor_json) };
      if (change === 'company') w.db.prepare('UPDATE projects SET company_id = NULL WHERE id = ?').run(PROJECT);
      else w.db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(SPONSOR);
      assert.equal((await authorizeCompute(w.env, job.uid, admission)).allowed, false);
      await w.runAlarms().catch(() => {});
      assert.equal(w.stats.starts, 0);
      assert.equal((w.db.prepare("SELECT COUNT(*) AS n FROM agent_compute_objects WHERE kind = 'output'").get() as any).n, 0);
    } finally { w.close(); }
  }
});

test('a cancel between upload and completion cannot finish the job or retain an output object', async () => {
  const w = await computeWorld();
  try {
    const { runUid } = await prepare(w); await load(loopDeps(w, noModel), runUid); await dispatchCompute(w.env, runUid);
    w.stats.beforePut = async () => { w.stats.beforePut = null; await cancelComputeRun(w.env, runUid); };
    await w.runAlarms().catch(() => {});
    assert.equal((w.db.prepare('SELECT status FROM agent_compute_jobs WHERE run_uid = ?').get(runUid) as any).status, 'cancelled');
    assert.equal((w.db.prepare("SELECT COUNT(*) AS n FROM agent_compute_objects WHERE kind = 'output'").get() as any).n, 0);
    assert.equal(w.objects.size, 1);
  } finally { w.close(); }
});

test('callback routes deny missing credentials; per-object expiry and erasure remove bytes before metadata', async () => {
  const w = await computeWorld();
  try {
    const app = new Hono().route('/api/agent-compute', router);
    const response = await app.request('/api/agent-compute/internal/complete', { method: 'POST', body: '{}' }, w.env);
    assert.equal(response.status, 404);
    const request = await createComputeRequest(w.env, w.user(), 201, requestInput);
    await uploadComputeInput(w.env, w.user(), request.uid, 'values.json', new Request('https://synthetic/upload', { method: 'PUT', body: '[1,2,3]' }));
    w.db.prepare("UPDATE agent_compute_objects SET expires_at = '2000-01-01 00:00:00'").run();
    await sweepComputeObjects(w.env); assert.equal(w.objects.size, 0);
    await uploadComputeInput(w.env, w.user(), request.uid, 'values.json', new Request('https://synthetic/upload', { method: 'PUT', body: '[1,2,3]' }));
    await eraseComputeData(w.env, { userId: SPONSOR });
    assert.equal(w.objects.size, 0); assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM agent_compute_requests').get() as any).n, 0);
  } finally { w.close(); }
});

test('concurrent callbacks leave one immutable output; a failed duplicate cannot delete the winning object', async () => {
  const w = await computeWorld();
  try {
    const { runUid } = await prepare(w); await load(loopDeps(w, noModel), runUid); await dispatchCompute(w.env, runUid);
    const job = w.db.prepare('SELECT * FROM agent_compute_jobs WHERE run_uid = ?').get(runUid) as any;
    const selected = w.hosts.get(job.uid)!, meta = w.db.prepare('SELECT * FROM agent_compute_executions WHERE job_uid = ?').get(job.uid) as any;
    const admission = { job_uid: job.uid, spec: JSON.parse(meta.spec_json), sponsor: JSON.parse(meta.sponsor_json) };
    await selected.security.register(admission.spec, admission.sponsor);
    const first = await selected.security.issue(computeTarget(admission, 'executor.complete'));
    const second = await selected.security.issue(computeTarget(admission, 'executor.complete'));
    assert.ok(first.ok && second.ok);
    await assert.rejects(computeInternal(w.env, 'complete', job.uid, { result: w.result, token: first.value.token.slice(0, -1) + '!' }));
    let uploads = 0, release: () => void = () => {}; const both = new Promise<void>(resolve => { release = resolve; });
    w.stats.beforePut = async () => { if (++uploads === 2) release(); await both; };
    const finished = await Promise.allSettled([first, second].map(grant => computeInternal(w.env, 'complete', job.uid, { result: w.result, token: grant.value.token })));
    assert.equal(finished.filter(answer => answer.status === 'fulfilled').length, 1);
    assert.equal((w.db.prepare("SELECT COUNT(*) AS n FROM agent_compute_objects WHERE kind = 'output'").get() as any).n, 1);
    assert.equal(w.objects.size, 2);
    assert.equal((w.db.prepare('SELECT status FROM agent_compute_jobs WHERE uid = ?').get(job.uid) as any).status, 'succeeded');
    await assert.rejects(computeInternal(w.env, 'complete', job.uid, { result: w.result, token: first.value.token }));
    assert.equal(w.objects.size, 2);
  } finally { w.close(); }
});

test('the SQL admission fence enforces the scope quota even when deliveries race', async () => {
  const w = await computeWorld();
  try {
    const { runUid } = await prepare(w); await load(loopDeps(w, noModel), runUid);
    const agent = w.db.prepare('SELECT * FROM team_agents WHERE id = ?').get(AGENT) as any;
    const attempts = await Promise.all([1, 2, 3].map(index => createJob(w.env, { runUid, agent, workload: 'python', inputs: requestInput.inputs, idempotencyKey: `synthetic:quota:${index}` })));
    assert.equal(attempts.filter(answer => answer.ok).length, 2);
    assert.equal((w.db.prepare("SELECT COUNT(*) AS n FROM agent_compute_jobs WHERE status = 'queued'").get() as any).n, 2);
  } finally { w.close(); }
});

test('disabling compute cannot turn a compute task into a model generation request', async () => {
  const w = await computeWorld();
  try {
    const { runUid } = await prepare(w); await load(loopDeps(w, noModel), runUid); w.env.AGENT_COMPUTE = 'off';
    const stopped = await runStep(loopDeps(w, noModel), runUid);
    assert.equal(stopped.go, false); assert.equal((stopped as any).refusal, 'compute_off');
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM ai_rail_proposals').get() as any).n, 0);
  } finally { w.close(); }
});


test('erasure confirms host termination and forgets grants before deleting an executed request', async () => {
  const w = await computeWorld();
  try {
    const { runUid } = await prepare(w); await load(loopDeps(w, noModel), runUid); await dispatchCompute(w.env, runUid);
    w.stats.stopFails = true; await assert.rejects(eraseComputeData(w.env, { userId: SPONSOR }));
    assert.equal(w.objects.size, 1);
    w.stats.stopFails = false; w.env.AGENT_COMPUTE = 'off'; await eraseComputeData(w.env, { userId: SPONSOR });
    assert.equal(w.stats.forgotten.length, 1); assert.equal(w.objects.size, 0);
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM agent_compute_executions').get() as any).n, 0);
  } finally { w.close(); }
});

test('the global SQL quota includes other scopes and unconfirmed cleanup', async () => {
  const w = await computeWorld();
  try {
    const { runUid } = await prepare(w); await load(loopDeps(w, noModel), runUid);
    const agent = w.db.prepare('SELECT * FROM team_agents WHERE id = ?').get(AGENT) as any;
    for (let index = 1; index <= 4; index++) {
      const answer = await createJob(w.env, { runUid, agent, workload: 'python', inputs: requestInput.inputs, idempotencyKey: `global:quota:${index}` });
      assert.ok(answer.ok);
      w.db.prepare('UPDATE agent_compute_jobs SET scope_id = ? WHERE uid = ?').run(9000 + index, answer.job.uid);
    }
    const blocked = await createJob(w.env, { runUid, agent, workload: 'python', inputs: requestInput.inputs, idempotencyKey: 'global:quota:blocked' });
    assert.equal(blocked.ok, false);
  } finally { w.close(); }
});


test('permission revoked during output upload cannot commit the result or leave output bytes', async () => {
  const w = await computeWorld();
  try {
    const { runUid } = await prepare(w); await load(loopDeps(w, noModel), runUid); await dispatchCompute(w.env, runUid);
    w.stats.beforePut = async () => { w.stats.beforePut = null; w.db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(SPONSOR); };
    await w.runAlarms().catch(() => {});
    assert.notEqual((w.db.prepare('SELECT status FROM agent_compute_jobs WHERE run_uid = ?').get(runUid) as any).status, 'succeeded');
    assert.equal((w.db.prepare("SELECT COUNT(*) AS n FROM agent_compute_objects WHERE kind = 'output'").get() as any).n, 0);
    assert.equal(w.objects.size, 1);
  } finally { w.close(); }
});

test('a lost completion event leaves a committed success and the existing Workflow recovers it', async () => {
  const w = await computeWorld();
  try {
    const { runUid } = await prepare(w);
    w.env.AGENT_TASK.get = async () => ({ sendEvent: async () => { throw Error('synthetic_lost_event'); } });
    const step = { async do(_name: string, _config: unknown, fn: () => Promise<any>) { return fn(); },
      async waitForEvent(_name: string, options: { type: string }) { if (options.type === 'compute') await w.runAlarms(); throw Error('synthetic_no_event'); } };
    const outcome = await runTaskLoop(runUid, step, loopDeps(w, noModel));
    assert.equal((outcome as any).status, 'waiting_decision');
    assert.equal((w.db.prepare('SELECT status FROM agent_compute_jobs WHERE run_uid = ?').get(runUid) as any).status, 'succeeded');
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM ai_rail_proposals').get() as any).n, 1);
    assert.equal(w.stats.starts, 1);
  } finally { w.close(); }
});


test('a compute request created between the admission read and insert cannot fall through to a model run', async () => {
  const w = await computeWorld();
  try {
    const original = w.env.DB.prepare.bind(w.env.DB); let injected = false;
    w.env.DB.prepare = (sql: string) => {
      if (!injected && sql.includes('INSERT INTO agent_task_runs')) {
        injected = true;
        w.db.prepare("INSERT INTO agent_compute_requests (uid, task_id, requested_by_user_id, workload, operation, inputs_json) VALUES (?, 201, ?, 'python', 'sum', ?)").run('c'.repeat(32), SPONSOR, JSON.stringify(requestInput.inputs));
      }
      return original(sql);
    };
    const answer = await w.runtime.admit(project, { agentId: AGENT, taskId: 201, by: SPONSOR, source: 'person' });
    assert.equal(answer.ok, false); assert.equal(injected, true);
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM agent_task_runs').get() as any).n, 0);
  } finally { w.close(); }
});


test('erasing an agent after a sponsor change cleans its former execution before run metadata cascades', async () => {
  const w = await computeWorld();
  try {
    const { runUid } = await prepare(w); await load(loopDeps(w, noModel), runUid); await dispatchCompute(w.env, runUid);
    w.db.prepare('UPDATE team_agents SET sponsor_user_id = ? WHERE id = ?').run(STRANGER, AGENT);
    await eraseComputeData(w.env, { userId: STRANGER });
    assert.equal(w.stats.forgotten.length, 1); assert.equal(w.objects.size, 0);
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM agent_compute_requests').get() as any).n, 0);
  } finally { w.close(); }
});


test('artifact delivery requires its owner and the original company, including for an admin reader', async () => {
  const w = await computeWorld();
  try {
    const { runUid } = await prepare(w); await load(loopDeps(w, noModel), runUid); await dispatchCompute(w.env, runUid); await w.runAlarms();
    const row = w.db.prepare("SELECT uid FROM agent_compute_objects WHERE kind = 'output'").get() as any;
    const app = new Hono().route('/api/agent-compute', router);
    async function download(id: number) {
      const user = w.user(id), token = await createJWT(w.env, id, user.email, user.role);
      return app.request('/api/agent-compute/artifacts/' + row.uid, { headers: { authorization: 'Bearer ' + token } }, w.env);
    }
    const own = await download(SPONSOR);
    assert.equal(own.status, 200); assert.equal(own.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await own.json(), { sum: 6 });
    for (const id of [STRANGER, ADMIN]) assert.equal((await download(id)).status, 404);
    w.db.prepare('UPDATE projects SET company_id = NULL WHERE id = ?').run(PROJECT);
    assert.equal((await download(SPONSOR)).status, 404);
  } finally { w.close(); }
});


test('request erasure preserves the compute-mode fence until the run itself is erased', async () => {
  const w = await computeWorld();
  try {
    const { runUid } = await prepare(w); await load(loopDeps(w, noModel), runUid); await dispatchCompute(w.env, runUid);
    await eraseComputeData(w.env, { userId: SPONSOR });
    assert.equal(await computeRunRequested(w.env, runUid), true);
    assert.equal((w.db.prepare('SELECT request_uid FROM agent_compute_run_requests WHERE run_uid = ?').get(runUid) as any).request_uid, null);
    let modelCalls = 0;
    const outcome = await runStep(loopDeps(w, async () => { modelCalls++; throw Error('erased_compute_must_not_use_a_model'); }), runUid);
    assert.equal(outcome.go, false); assert.equal(modelCalls, 0);
    assert.equal((outcome as any).status, 'failed');
  } finally { w.close(); }
});
