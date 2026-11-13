/** D4557 part 2: the privileged Worker broker, scoped R2 manifests and existing Workflow handoff; no second scheduler. */
import type { Env, User } from '../../types';
import { engineMode, haltedAll } from '../../agents/runtime';
import { runByUid, type RunRow } from '../../agents/engine';
import { createJob, artifactPrefix, computeEnabled, inputsRefusal, LIMITS, recordResult, type JobRow, type Workload } from './compute';
import { COMPUTE_INPUT_CAP, computeBody, computeOperations, computeTarget, computeUid, decodeComputeBase64, hostResult, type HostAdmission, type HostManifest } from './computeHost';
import { executorEligibility, trustedWorkspaceSpec, type WorkspaceSpec } from './workspaceSpec';
import type { GrantTarget, WorkspaceImageEvidence, WorkspaceObject, WorkspacePermit, WorkspaceProviderEvidence } from './workspaceSecurity';
import { canManage, canRead, effectiveBook, scopeOfAgent, type AgentRow } from './teams';
import { optionRowIn } from './agentRun';
import { moduleOf } from './catalogue';
import type { TaskRow } from './tasks';
import { proposeRail } from '../railProposals';
import { assertStorageRoom, noteStorageLanded } from '../storageRoom';

type ComputeEnv = Env & { AGENT_COMPUTE_HOST?: Fetcher; AGENT_COMPUTE_POLICY_JSON?: string };
export type ComputePolicy = { template: Pick<WorkspaceSpec, 'image_digest' | 'repo_id' | 'base_sha' | 'cpu' | 'allowed_regions' | 'max_cost_microusd'>;
  image: WorkspaceImageEvidence; provider: WorkspaceProviderEvidence; artifact_ttl_s: number;
  job_cost_ceiling_microusd: Record<Workload, number> };
type RequestRow = { uid: string; task_id: number; requested_by_user_id: number; workload: Workload; operation: string; inputs_json: string; status: string };
type ObjectRow = { uid: string; request_uid: string; job_uid: string | null; owner_user_id: number; kind: string; name: string; r2_key: string;
  size_bytes: number; sha256: string; expires_at: string };
type ExecutionRow = { job_uid: string; request_uid: string; generation: number; spec_json: string; sponsor_json: string };
const uid = () => crypto.randomUUID().replaceAll('-', '');
const sqlTime = (at: number) => new Date(at).toISOString().slice(0, 19).replace('T', ' ');
export const computeFailure = (code: string, status = 409) => new Response(JSON.stringify({ code, message: 'This compute operation is not available for this task.' }),
  { status, headers: { 'content-type': 'application/json' } });
const digest = async (data: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(v => v.toString(16).padStart(2, '0')).join('');
function b64(data: Uint8Array) {
  let raw = ''; for (let at = 0; at < data.length; at += 16384) raw += String.fromCharCode(...data.subarray(at, at + 16384)); return btoa(raw);
}

/** Missing or unapproved evidence disables admission. These are owner-reviewed server settings, never request fields. */
export function computePolicy(env: ComputeEnv): ComputePolicy | null {
  try {
    const policy: ComputePolicy = JSON.parse(env.AGENT_COMPUTE_POLICY_JSON ?? 'null');
    if (!policy || !Number.isSafeInteger(policy.artifact_ttl_s) || policy.artifact_ttl_s < 3600 || policy.artifact_ttl_s > 30 * 86400
      || policy.image?.digest !== policy.template?.image_digest || policy.image.signature_verified !== true || policy.image.provenance_verified !== true
      || policy.image.sbom_verified !== true || policy.image.scan_passed !== true || policy.image.revoked !== false
      || !policy.provider || !Array.isArray(policy.template.allowed_regions) || policy.template.allowed_regions.length !== 1
      || policy.template.allowed_regions[0] !== 'global'
      || !['python', 'document_convert', 'spreadsheet'].every(workload => Number.isSafeInteger(policy.job_cost_ceiling_microusd?.[workload as Workload])
        && policy.job_cost_ceiling_microusd[workload as Workload] > 0)) return null;
    return policy;
  } catch { return null; }
}
export const computeConfigured = (env: ComputeEnv) => computeEnabled(env) && !!env.FILES && !!env.AGENT_COMPUTE_HOST && !!computePolicy(env);
const files = (env: Env) => { if (!env.FILES) throw computeFailure('compute_storage_unavailable', 503); return env.FILES; };
export async function computeRunRequested(env: Env, runUid: string): Promise<boolean> {
  return !!await env.DB.prepare('SELECT 1 AS requested FROM agent_compute_run_requests WHERE run_uid = ?').bind(runUid).first();
}

export async function computeTask(env: Env, taskId: number, user?: User) {
  const task = await env.DB.prepare('SELECT * FROM scope_tasks WHERE id = ?').bind(taskId).first<TaskRow>();
  const agent = task?.assignee_agent_id ? await env.DB.prepare('SELECT * FROM team_agents WHERE id = ?').bind(task.assignee_agent_id).first<AgentRow>() : null;
  if (!task || !agent || task.assignee_kind !== 'agent' || task.scope_kind !== agent.scope_kind
    || task.company_id !== agent.company_id || task.project_id !== agent.project_id) throw computeFailure('task_not_found', 404);
  const scope = await scopeOfAgent(env, agent);
  if (!scope || (user && (!await canRead(env, scope, user) || (user.id !== agent.sponsor_user_id && !await canManage(env, scope, user))))) throw computeFailure('task_not_found', 404);
  return { task, agent, scope };
}

export async function createComputeRequest(env: ComputeEnv, user: User, taskId: number, raw: unknown) {
  if (!computeConfigured(env)) throw computeFailure('compute_off', 404);
  const { task, agent } = await computeTask(env, taskId, user);
  if (user.id !== agent.sponsor_user_id || task.status !== 'open' || task.source_kind !== 'manual') throw computeFailure('compute_task_not_open');
  const input = raw as { workload: Workload; operation: string; inputs: { name: string; bytes: number }[] };
  const bad = inputsRefusal(input?.workload, input?.inputs);
  if (bad) throw computeFailure(bad.code, bad.status);
  if (!computeOperations(input.workload, input.operation) || input.inputs.reduce((n, value) => n + value.bytes, 0) > COMPUTE_INPUT_CAP
    || input.inputs.some(value => /\.py$/i.test(value.name))) throw computeFailure('compute_operation_refused', 422);
  const id = uid();
  await env.DB.prepare(`INSERT INTO agent_compute_requests (uid, task_id, requested_by_user_id, workload, operation, inputs_json)
      SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS(SELECT 1 FROM scope_tasks WHERE id = ? AND status = 'open' AND source_kind = 'manual')
      AND NOT EXISTS(SELECT 1 FROM agent_task_runs WHERE task_id = ? AND status IN ('admitted','running','waiting_decision'))
      ON CONFLICT(task_id) DO NOTHING`).bind(id, task.id, user.id, input.workload, input.operation,
      JSON.stringify(input.inputs.map(value => ({ name: value.name, bytes: value.bytes }))), task.id, task.id).run();
  const row = await env.DB.prepare('SELECT * FROM agent_compute_requests WHERE task_id = ?').bind(task.id).first<RequestRow>();
  if (!row || row.requested_by_user_id !== user.id || row.workload !== input.workload || row.operation !== input.operation
    || row.inputs_json !== JSON.stringify(input.inputs.map(value => ({ name: value.name, bytes: value.bytes })))) throw computeFailure('compute_request_conflict');
  return { uid: row.uid, status: row.status };
}

export async function requestFor(env: Env, requestUid: string, user: User) {
  if (!computeUid(requestUid)) throw computeFailure('request_not_found', 404);
  const request = await env.DB.prepare('SELECT * FROM agent_compute_requests WHERE uid = ?').bind(requestUid).first<RequestRow>();
  if (!request || request.requested_by_user_id !== user.id) throw computeFailure('request_not_found', 404);
  const task = await computeTask(env, request.task_id, user);
  return { request, ...task };
}

export async function uploadComputeInput(env: ComputeEnv, user: User, requestUid: string, name: string, body: Request) {
  if (!computeConfigured(env)) throw computeFailure('compute_off', 404);
  const { request, task } = await requestFor(env, requestUid, user);
  const inputs = JSON.parse(request.inputs_json) as { name: string; bytes: number }[], input = inputs.find(value => value.name === name);
  if (!input || request.status !== 'draft' || task.status !== 'open') throw computeFailure('compute_upload_closed');
  const bytes = await computeBody(body, Math.min(input.bytes, COMPUTE_INPUT_CAP));
  if (bytes.length !== input.bytes) throw computeFailure('compute_input_size', 422);
  const sha256 = await digest(bytes), objectUid = uid();
  const prior = await env.DB.prepare("SELECT * FROM agent_compute_objects WHERE request_uid = ? AND kind = 'input' AND name = ?").bind(request.uid, name).first<ObjectRow>();
  if (prior) { if (prior.sha256 !== sha256) throw computeFailure('compute_input_conflict'); return { uid: prior.uid }; }
  const ticket = await assertStorageRoom(env, { userId: user.id }, bytes.length, user);
  if (['unreadable', 'no_owner'].includes(ticket.passed)) throw computeFailure('compute_storage_unreadable', 503);
  const key = `agent-compute/${task.scope_kind}/${task.scope_kind === 'project' ? task.project_id : task.company_id}/pending-${request.uid}/${objectUid}`;
  await files(env).put(key, bytes, { customMetadata: { owner_user_id: String(user.id), request_uid: request.uid, sha256 } });
  const saved = await env.DB.prepare(`INSERT INTO agent_compute_objects
    (uid, request_uid, owner_user_id, kind, name, r2_key, size_bytes, sha256, expires_at)
    SELECT ?, ?, ?, 'input', ?, ?, ?, ?, ? WHERE EXISTS(SELECT 1 FROM agent_compute_requests WHERE uid = ? AND status = 'draft')
    ON CONFLICT DO NOTHING`).bind(objectUid, request.uid, user.id, name, key, bytes.length, sha256,
    sqlTime(Date.now() + computePolicy(env)!.artifact_ttl_s * 1000), request.uid).run();
  if (!Number(saved.meta?.changes)) { await files(env).delete(key); throw computeFailure('compute_upload_conflict'); }
  await noteStorageLanded(env, ticket);
  return { uid: objectUid };
}

export async function readyComputeRequest(env: ComputeEnv, user: User, requestUid: string) {
  if (!computeConfigured(env)) throw computeFailure('compute_off', 404);
  const { request, task } = await requestFor(env, requestUid, user);
  if (task.status !== 'open') throw computeFailure('compute_task_not_open');
  const expected = JSON.parse(request.inputs_json) as { name: string; bytes: number }[];
  const objects = (await env.DB.prepare("SELECT * FROM agent_compute_objects WHERE request_uid = ? AND kind = 'input' AND datetime(expires_at) > datetime('now')")
    .bind(request.uid).all<ObjectRow>()).results ?? [];
  if (expected.length !== objects.length || expected.some(input => !objects.some(object => object.name === input.name && object.size_bytes === input.bytes))) throw computeFailure('compute_inputs_incomplete');
  await env.DB.prepare("UPDATE agent_compute_requests SET status = 'ready' WHERE uid = ? AND status = 'draft'").bind(request.uid).run();
  return { uid: request.uid, status: 'ready' };
}

export async function callComputeHost<T>(env: ComputeEnv, job: Pick<JobRow, 'uid' | 'workload'>, path: string, data: Record<string, unknown> = {}): Promise<T> {
  if (!env.AGENT_COMPUTE_HOST || !env.AGENT_COMPUTE_SECRET) throw computeFailure('compute_host_unavailable', 503);
  const response = await env.AGENT_COMPUTE_HOST.fetch(new Request(`https://compute-host${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-compute-control': env.AGENT_COMPUTE_SECRET },
    body: JSON.stringify({ ...data, job_uid: job.uid, workload: job.workload }), signal: AbortSignal.timeout(20000) }));
  if (!response.ok) { await response.body?.cancel(); throw computeFailure('compute_host_unavailable', 503); }
  return JSON.parse(new TextDecoder().decode(await computeBody(response, 16384)));
}

export async function dispatchCompute(env: ComputeEnv, runUid: string): Promise<{ waiting: boolean }> {
  const run = await runByUid(env, runUid); if (!run || run.status !== 'running') throw computeFailure('run_not_running');
  if (!await computeRunRequested(env, run.uid)) return { waiting: false };
  if (!computeConfigured(env)) throw computeFailure('compute_off', 404);
  const request = await env.DB.prepare(`SELECT r.* FROM agent_compute_requests r JOIN agent_compute_run_requests link ON link.request_uid = r.uid
    WHERE link.run_uid = ? AND r.task_id = ?`).bind(run.uid, run.task_id).first<RequestRow>();
  if (!request) return { waiting: false };
  if (request.status !== 'ready') throw computeFailure('compute_inputs_incomplete');
  const { agent, scope } = await computeTask(env, run.task_id);
  const companyId = scope.kind === 'company' ? scope.id : scope.company_id;
  if (!companyId || (scope.kind === 'project' && run.admitted_company_id !== companyId) || agent.sponsor_user_id !== request.requested_by_user_id) throw computeFailure('compute_scope_refused');
  const policy = computePolicy(env)!, limits = LIMITS[request.workload];
  if (policy.template.max_cost_microusd < policy.job_cost_ceiling_microusd[request.workload]) throw computeFailure('compute_cost_limit', 422);
  const candidate = trustedWorkspaceSpec({ ...policy.template, version: 1, tenant_id: companyId, company_id: companyId,
    project_id: scope.kind === 'project' ? scope.id : null, agent_id: agent.id, task_id: run.task_id, run_id: run.uid,
    attempt: run.attempt, execution_generation: 1, idempotency_key: request.uid, scope_paths: ['inputs', 'outputs'],
    memory_mb: limits.memory_mb, disk_mb: limits.disk_mb, max_duration_s: limits.wall_ms / 1000,
    network_policy: { mode: 'deny' }, allowed_providers: ['cloudflare'], workload_class: request.workload,
    checkpoint_manifest_ref: null, artifact_sink_ref: request.uid });
  if (!candidate.ok) throw computeFailure(candidate.code, 422);
  const eligible = executorEligibility(candidate.value, policy.provider.capabilities);
  if (!eligible.ok) throw computeFailure(eligible.code, 422);
  const created = await createJob(env, { runUid, agent, workload: request.workload, inputs: JSON.parse(request.inputs_json), idempotencyKey: `agent:${runUid}:compute:1` });
  if (!created.ok) throw computeFailure(created.code, created.status);
  const job = created.job;
  if (['succeeded', 'failed', 'cancelled', 'timed_out'].includes(job.status)) return { waiting: false };
  const parsed = trustedWorkspaceSpec({ ...candidate.value, idempotency_key: job.uid, artifact_sink_ref: job.uid });
  if (!parsed.ok) throw computeFailure(parsed.code, 422);
  const admission: HostAdmission = { job_uid: job.uid, spec: parsed.value, sponsor: { member_id: agent.sponsor_user_id,
    tenant_id: companyId, company_id: companyId, project_id: scope.kind === 'project' ? scope.id : null } };
  await env.DB.prepare(`INSERT INTO agent_compute_executions (job_uid, request_uid, spec_json, sponsor_json) VALUES (?, ?, ?, ?)
    ON CONFLICT(job_uid) DO NOTHING`).bind(job.uid, request.uid, JSON.stringify(admission.spec), JSON.stringify(admission.sponsor)).run();
  await env.DB.prepare("UPDATE agent_compute_jobs SET status = 'running', dispatched_at = COALESCE(dispatched_at, CURRENT_TIMESTAMP) WHERE uid = ? AND status = 'queued'").bind(job.uid).run();
  await callComputeHost(env, job, '/dispatch', { admission });
  return { waiting: true };
}

async function execution(env: Env, jobUid: string) {
  if (!computeUid(jobUid)) throw computeFailure('job_not_found', 404);
  const job = await env.DB.prepare('SELECT * FROM agent_compute_jobs WHERE uid = ?').bind(jobUid).first<JobRow>();
  const meta = await env.DB.prepare('SELECT * FROM agent_compute_executions WHERE job_uid = ?').bind(jobUid).first<ExecutionRow>();
  if (!job || !meta) throw computeFailure('job_not_found', 404);
  const admission: HostAdmission = { job_uid: job.uid, spec: JSON.parse(meta.spec_json), sponsor: JSON.parse(meta.sponsor_json) };
  return { job, meta, admission };
}

/** Use-time authority: every token redemption rechecks the current actor, task, run, company and generation. */
export async function authorizeCompute(env: ComputeEnv, jobUid: string, raw: unknown) {
  const { job, meta, admission } = await execution(env, jobUid), request = raw as { spec: WorkspaceSpec; sponsor: HostAdmission['sponsor'] };
  const policy = computePolicy(env);
  let allowed = computeConfigured(env) && policy?.template.image_digest === admission.spec.image_digest
    && !!policy && executorEligibility(admission.spec, policy.provider.capabilities).ok
    && env.TEAM_AGENTS_ENABLED === 'true' && meta.generation === admission.spec.execution_generation
    && ['running', 'dispatched'].includes(job.status) && JSON.stringify(request.spec) === meta.spec_json
    && JSON.stringify(request.sponsor) === meta.sponsor_json;
  if (allowed) {
    const run = await runByUid(env, job.run_uid), { task, agent, scope } = await computeTask(env, admission.spec.task_id);
    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').bind(admission.sponsor.member_id).first<User>();
    allowed = !!user && agent.status === 'active' && agent.sponsor_user_id === user.id && !!run && run.status === 'running'
      && run.agent_id === agent.id && run.task_id === task.id && task.status === 'in_progress'
      && scope.kind === job.scope_kind && scope.id === Number(job.scope_id)
      && (scope.kind !== 'project' || run.admitted_company_id === admission.spec.company_id)
      && (scope.kind === 'company' ? scope.id : scope.company_id) === admission.spec.company_id
      && await canRead(env, scope, user) && !await haltedAll(env) && !['off', 'paused'].includes(await engineMode(env));
  }
  return { allowed, revision: 1, approved: false };
}

export async function computeInternal(env: ComputeEnv, action: string, jobUid: string, raw: unknown): Promise<unknown> {
  const { job, meta, admission } = await execution(env, jobUid);
  const body = raw as Record<string, any>;
  if (action === 'policy') { const policy = computePolicy(env); if (!policy) throw computeFailure('compute_policy_unavailable', 503); return { image: policy.image, provider: policy.provider }; }
  if (action === 'authorize') return authorizeCompute(env, jobUid, raw);
  if (action === 'audit') {
    if (!['workspace_grant_issued', 'workspace_grant_redeemed', 'workspace_run_revoked', 'workspace_generation_advanced'].includes(body.action)
      || body.run_id !== job.run_uid || body.generation !== admission.spec.execution_generation || body.member_id !== admission.sponsor.member_id) throw computeFailure('compute_audit_refused', 403);
    if (body.action !== 'workspace_run_revoked' && !await authorizeCompute(env, jobUid, admission).then(value => value.allowed)) throw computeFailure('compute_audit_refused', 403);
    await env.DB.prepare('INSERT INTO activity_logs (project_id, user_id, action, details, actor) VALUES (?, ?, ?, ?, ?)')
      .bind(admission.spec.project_id, admission.sponsor.member_id, 'agent_compute_security',
        JSON.stringify({ event: body.action, run_uid: job.run_uid, generation: meta.generation }), 'agent_compute_host').run();
    return { ok: true };
  }
  if (!await authorizeCompute(env, jobUid, admission).then(value => value.allowed)) throw computeFailure('compute_authorization_revoked', 403);
  const request = await env.DB.prepare('SELECT * FROM agent_compute_requests WHERE uid = ?').bind(meta.request_uid).first<RequestRow>();
  if (!request) throw computeFailure('request_not_found', 404);
  if (action === 'manifest') {
    const inputs = (await env.DB.prepare("SELECT * FROM agent_compute_objects WHERE request_uid = ? AND kind = 'input' AND datetime(expires_at) > datetime('now')")
      .bind(request.uid).all<ObjectRow>()).results ?? [];
    const expected = JSON.parse(request.inputs_json) as { name: string; bytes: number }[];
    if (expected.length !== inputs.length || expected.some(input => !inputs.some(row => row.name === input.name && row.size_bytes === input.bytes))) throw computeFailure('compute_inputs_incomplete');
    return { workload: job.workload, operation: request.operation, inputs: inputs.map(row => ({ name: row.name, bytes: row.size_bytes, ref: row.uid })) } satisfies HostManifest;
  }
  const object = (action === 'object' || action === 'input') && computeUid(body.ref)
    ? await env.DB.prepare("SELECT * FROM agent_compute_objects WHERE uid = ? AND request_uid = ? AND kind = 'input' AND datetime(expires_at) > datetime('now')")
      .bind(body.ref, request.uid).first<ObjectRow>() : null;
  if (action === 'object') return object ? { ref: object.uid, tenant_id: admission.spec.tenant_id, company_id: admission.spec.company_id,
    project_id: admission.spec.project_id, run_id: job.run_uid, execution_generation: meta.generation, sink_ref: admission.spec.artifact_sink_ref,
    region: admission.spec.allowed_regions[0], approved_restore_regions: [], key_id: 'r2-managed', expires_at: Date.parse(object.expires_at.replace(' ', 'T') + 'Z') } satisfies WorkspaceObject : null;
  const target: GrantTarget = action === 'input' ? computeTarget(admission, 'artifact.read', body.ref, admission.spec.allowed_regions[0]) : computeTarget(admission, 'executor.complete');
  const permit = await callComputeHost<{ ok: boolean; value?: WorkspacePermit }>(env, job, '/redeem', { target, token: body.token });
  if (!permit.ok || !permit.value || JSON.stringify(permit.value.spec) !== meta.spec_json) throw computeFailure('compute_grant_refused', 403);
  if (action === 'input' && object) {
    const stored = await files(env).get(object.r2_key); if (!stored || stored.size !== object.size_bytes) throw computeFailure('compute_input_missing', 404);
    const bytes = await computeBody(new Response(stored.body), Math.min(COMPUTE_INPUT_CAP, object.size_bytes));
    if (await digest(bytes) !== object.sha256) throw computeFailure('compute_input_digest', 422);
    return { data: b64(bytes) };
  }
  if (action !== 'complete') throw computeFailure('compute_action_refused', 404);
  const result = await hostResult(body.result, job.workload); if (!result) throw computeFailure('compute_result_invalid', 422);
  const keys: string[] = [];
  try {
    for (const artifact of result.artifacts) {
      const bytes = decodeComputeBase64(artifact.data), objectUid = uid();
      const ticket = await assertStorageRoom(env, { userId: admission.sponsor.member_id }, bytes.length, { id: admission.sponsor.member_id });
      if (['unreadable', 'no_owner'].includes(ticket.passed)) throw computeFailure('compute_storage_unreadable', 503);
      const key = artifactPrefix(job) + objectUid;
      await files(env).put(key, bytes, { customMetadata: { owner_user_id: String(admission.sponsor.member_id), job_uid: job.uid, sha256: artifact.sha256 } }); keys.push(key);
      const added = await env.DB.prepare(`INSERT INTO agent_compute_objects (uid, request_uid, job_uid, owner_user_id, kind, name, r2_key, size_bytes, sha256, expires_at)
        SELECT ?, ?, ?, ?, 'output', ?, ?, ?, ?, ? WHERE EXISTS(SELECT 1 FROM agent_compute_jobs j JOIN agent_compute_executions e ON e.job_uid = j.uid
          WHERE j.uid = ? AND j.status = 'running' AND e.generation = ?) ON CONFLICT DO NOTHING`)
        .bind(objectUid, request.uid, job.uid, admission.sponsor.member_id, artifact.name, key, bytes.length, artifact.sha256,
          sqlTime(Date.now() + computePolicy(env)!.artifact_ttl_s * 1000), job.uid, meta.generation).run();
      if (!Number(added.meta?.changes)) throw computeFailure('compute_completion_conflict');
      await noteStorageLanded(env, ticket);
    }
    if (!await authorizeCompute(env, jobUid, admission).then(value => value.allowed)) throw computeFailure('compute_authorization_revoked', 403);
    const recorded = await recordResult(env, job, { ...result, output_bytes: result.artifacts.reduce((n, value) => n + value.bytes, 0), artifacts: keys }, new Date(), meta.generation);
    if (!recorded.ok) throw computeFailure(recorded.code);
  } catch (error) {
    for (const key of keys) { await files(env).delete(key); await env.DB.prepare('DELETE FROM agent_compute_objects WHERE r2_key = ?').bind(key).run(); }
    throw error;
  }
  if (env.AGENT_TASK) {
    try { const instance = await env.AGENT_TASK.get(job.run_uid); await instance.sendEvent({ type: 'compute', payload: { job_uid: job.uid } }); }
    catch { console.warn('[agents] compute_event_failed'); } // Committed metadata is authoritative; the Workflow recovers a lost event.
  }
  return { ok: true };
}

export async function cancelComputeRun(env: ComputeEnv, runUid: string, timedOut = false) {
  const jobs = (await env.DB.prepare(`SELECT j.* FROM agent_compute_jobs j JOIN agent_compute_executions e ON e.job_uid = j.uid
    WHERE j.run_uid = ? AND (j.status IN ('queued','dispatched','running') OR (j.status IN ('cancelled','timed_out') AND e.cleanup_required = 1))`).bind(runUid).all<JobRow>()).results ?? [];
  for (const job of jobs) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE agent_compute_executions SET generation = generation + 1 WHERE job_uid = ?
        AND EXISTS(SELECT 1 FROM agent_compute_jobs WHERE uid = ? AND status IN ('queued','dispatched','running'))`).bind(job.uid, job.uid),
      env.DB.prepare("UPDATE agent_compute_jobs SET status = ?, failure_code = ?, cancelled_at = CURRENT_TIMESTAMP, ended_at = CURRENT_TIMESTAMP WHERE uid = ? AND status IN ('queued','dispatched','running')")
        .bind(timedOut ? 'timed_out' : 'cancelled', timedOut ? 'wall_limit' : 'cancelled', job.uid),
    ]);
    const stopped = await callComputeHost<{ cleanup_required: boolean }>(env, job, '/cancel');
    if (stopped.cleanup_required) throw computeFailure('compute_cleanup_unconfirmed', 503);
    await env.DB.prepare('UPDATE agent_compute_executions SET cleanup_required = 0 WHERE job_uid = ?').bind(job.uid).run();
  }
}

export async function computeProposal(env: ComputeEnv, run: RunRow, agent: AgentRow, task: TaskRow): Promise<string | null> {
  if (!computeConfigured(env)) throw computeFailure('compute_off', 404);
  const job = await env.DB.prepare('SELECT * FROM agent_compute_jobs WHERE run_uid = ? AND agent_id = ? AND idempotency_key = ?')
    .bind(run.uid, agent.id, `agent:${run.uid}:compute:1`).first<JobRow>();
  if (!job) return null;
  if (job.status !== 'succeeded') throw computeFailure(job.status === 'running' ? 'compute_in_flight' : `compute_${job.status}`);
  const scope = await scopeOfAgent(env, agent); if (!scope || !task.module || !task.option) throw computeFailure('compute_scope_refused');
  const { rules } = await effectiveBook(env, scope, agent.role_key), option = optionRowIn(task.module, task.option);
  if (!moduleOf(task.module) || !rules.may_propose.includes(task.option) || !option) throw computeFailure('compute_proposal_refused', 403);
  const objects = (await env.DB.prepare("SELECT uid, name, size_bytes, sha256 FROM agent_compute_objects WHERE job_uid = ? AND kind = 'output' AND datetime(expires_at) > datetime('now')")
    .bind(job.uid).all<Pick<ObjectRow, 'uid' | 'name' | 'size_bytes' | 'sha256'>>()).results ?? [];
  if (!objects.length) throw computeFailure('compute_artifact_missing');
  const proposal = await proposeRail(env, { userId: agent.sponsor_user_id, page: option.pageKey, option: option.optionKey, kind: 'draft',
    payload: { text: 'A deterministic compute result is ready for review.', compute_artifacts: objects }, agentId: agent.id, taskId: task.id, runKey: `agent:${run.uid}` });
  return proposal.uid;
}

/** Bounded lifecycle cleanup runs in the existing sweep, including after admission is disabled. */
export async function sweepComputeObjects(env: Env) {
  const rows = (await env.DB.prepare("SELECT uid, r2_key FROM agent_compute_objects WHERE datetime(expires_at) <= datetime('now') ORDER BY expires_at LIMIT 32")
    .all<Pick<ObjectRow, 'uid' | 'r2_key'>>()).results ?? [];
  for (const row of rows) { await files(env).delete(row.r2_key); await env.DB.prepare('DELETE FROM agent_compute_objects WHERE uid = ?').bind(row.uid).run(); }
}

/** R2 cleanup precedes metadata cascades so erasure never strands unaddressable private objects. */
export async function eraseComputeData(env: ComputeEnv, where: { userId: number } | { scope: { kind: 'company' | 'project'; id: number } }) {
  const kind = 'userId' in where ? 'account' : where.scope.kind, value = 'userId' in where ? where.userId : where.scope.id;
  const statements = {
    account: `SELECT r.uid FROM agent_compute_requests r JOIN scope_tasks t ON t.id = r.task_id WHERE r.requested_by_user_id = ?1
      OR EXISTS(SELECT 1 FROM agent_compute_executions e JOIN agent_compute_jobs j ON j.uid = e.job_uid JOIN team_agents a ON a.id = j.agent_id
        WHERE e.request_uid = r.uid AND a.sponsor_user_id = ?1)`,
    company: `SELECT r.uid FROM agent_compute_requests r JOIN scope_tasks t ON t.id = r.task_id WHERE (t.scope_kind = 'company' AND t.company_id = ?1)
      OR EXISTS(SELECT 1 FROM agent_compute_executions e JOIN agent_compute_jobs j ON j.uid = e.job_uid JOIN team_agents a ON a.id = j.agent_id
        WHERE e.request_uid = r.uid AND a.scope_kind = 'company' AND a.company_id = ?1)`,
    project: `SELECT r.uid FROM agent_compute_requests r JOIN scope_tasks t ON t.id = r.task_id WHERE (t.scope_kind = 'project' AND t.project_id = ?1)
      OR EXISTS(SELECT 1 FROM agent_compute_executions e JOIN agent_compute_jobs j ON j.uid = e.job_uid JOIN team_agents a ON a.id = j.agent_id
        WHERE e.request_uid = r.uid AND a.scope_kind = 'project' AND a.project_id = ?1)`,
  } as const;
  const requests = (await env.DB.prepare(statements[kind])
    .bind(value).all<{ uid: string }>()).results ?? [];
  for (const request of requests) {
    const runs = (await env.DB.prepare('SELECT j.run_uid FROM agent_compute_jobs j JOIN agent_compute_executions e ON e.job_uid = j.uid WHERE e.request_uid = ?')
      .bind(request.uid).all<{ run_uid: string }>()).results ?? [];
    for (const run of runs) {
      await cancelComputeRun(env, run.run_uid);
      const jobs = (await env.DB.prepare('SELECT * FROM agent_compute_jobs WHERE run_uid = ?').bind(run.run_uid).all<JobRow>()).results ?? [];
      for (const job of jobs) {
        const forgotten = await callComputeHost<{ cleanup_required: boolean }>(env, job, '/forget');
        if (forgotten.cleanup_required) throw computeFailure('compute_cleanup_unconfirmed', 503);
      }
    }
    while (true) {
      const objects = (await env.DB.prepare('SELECT uid, r2_key FROM agent_compute_objects WHERE request_uid = ? LIMIT 32').bind(request.uid)
        .all<Pick<ObjectRow, 'uid' | 'r2_key'>>()).results ?? [];
      if (!objects.length) break;
      for (const object of objects) { await files(env).delete(object.r2_key); await env.DB.prepare('DELETE FROM agent_compute_objects WHERE uid = ?').bind(object.uid).run(); }
    }
    await env.DB.prepare('DELETE FROM agent_compute_requests WHERE uid = ?').bind(request.uid).run();
  }
}
