/**
 * D4557 (#4557, Part of): bounded compute for an agent run, the parts that
 * do not depend on the container's host. The owner's answers (2026-11-07):
 * Q1 B, build these now; Q2 A, the host is a separate Worker owning the
 * container; Q3 A, the Durable Object Container API on the default policy
 * with internet off; Q4 A, a job's output is still a proposal whose payload
 * references an R2 artifact. The host itself waits on D4554.
 *
 * OFF BY DEFAULT. `computeEnabled` is true only when AGENT_COMPUTE is `on`
 * AND AGENT_COMPUTE_SECRET is set. Neither is declared anywhere, no route
 * calls this file yet, and every entry point refuses `compute_off` until
 * both are.
 *
 * THE WORKER STAYS THE BROKER. A job is created by the run's own Worker side
 * (`createJob`), after the run's scope, task and agent are already checked by
 * the D1528 loop. The container receives only:
 *   - a short-lived, signed, single-use RUN GRANT (`mintGrant`): job uid, run
 *     uid, scope, workload, idempotency key, jti and expiry, signed with a key
 *     derived per job from AGENT_COMPUTE_SECRET, so one leaked grant opens one
 *     job;
 *   - the input references the job names.
 * It gets no D1, no provider key and no R2 credential.
 *
 * Every callback is checked before anything is written (`verifyGrant`): the
 * signature, the expiry, that the grant names this job and its scope (a
 * cross-tenant callback is refused), and that the job is still live (a
 * callback after a cancel is refused). `claimGrant` spends the grant once, by
 * a conditional UPDATE in D1, so a replay is refused even when concurrent.
 * `recordResult` ends the job once, by a guarded UPDATE, so a second callback
 * changes nothing. A result's artifacts must lie under the job's own prefix,
 * `agent-compute/<scope_kind>/<scope_id>/<run_uid>/`.
 *
 * QUOTAS ARE THE SERVER'S. `LIMITS` per workload: the input size and count,
 * the file types, the output size, the artifact count, and the CPU, memory,
 * wall-clock, disk and process limits the host is to apply, plus the live jobs
 * per scope. Input names are checked for traversal: no absolute path, `..`,
 * backslash, NUL or control character. Archives are refused as inputs in v1;
 * an Office file is a zip, which the container opens under its own
 * decompression limit.
 *
 * Never stored or logged: a grant token, an input, stdout, an output's
 * content or a prompt. Bound SQL only.
 */
import type { Env } from '../../types';
import { constantTimeEqual } from '../../rpc/secret';
import type { AgentRow } from './teams';

export const WORKLOADS = ['python', 'document_convert', 'spreadsheet'] as const;
export type Workload = typeof WORKLOADS[number];
export const GRANT_TTL_S = 15 * 60;
export const MAX_LIVE_JOBS_PER_SCOPE = 2;
const TERMINAL = ['succeeded', 'failed', 'cancelled', 'timed_out'] as const;

export type Limits = {
  cpu_ms: number; wall_ms: number; memory_mb: number; disk_mb: number; processes: number;
  max_inputs: number; max_input_bytes: number; max_output_bytes: number; max_artifacts: number;
  input_types: readonly string[];
};
const MB = 1024 * 1024;
/** What a job may use. The host applies the runtime ones; this file refuses the rest before dispatch and at the result. */
export const LIMITS: Record<Workload, Limits> = Object.freeze({
  python: { cpu_ms: 60_000, wall_ms: 120_000, memory_mb: 512, disk_mb: 256, processes: 16, max_inputs: 5, max_input_bytes: 10 * MB, max_output_bytes: 5 * MB, max_artifacts: 5, input_types: ['csv', 'json', 'txt', 'py'] },
  document_convert: { cpu_ms: 120_000, wall_ms: 300_000, memory_mb: 1024, disk_mb: 512, processes: 16, max_inputs: 3, max_input_bytes: 25 * MB, max_output_bytes: 10 * MB, max_artifacts: 5, input_types: ['pdf', 'docx', 'xlsx', 'pptx'] },
  spreadsheet: { cpu_ms: 60_000, wall_ms: 120_000, memory_mb: 512, disk_mb: 256, processes: 16, max_inputs: 5, max_input_bytes: 10 * MB, max_output_bytes: 10 * MB, max_artifacts: 3, input_types: ['csv', 'xlsx', 'json'] },
});

export type ComputeRefusal = { ok: false; status: number; code: string; message: string };
const no = (status: number, code: string, message: string): ComputeRefusal => ({ ok: false, status, code, message });

export function computeEnabled(env: Pick<Env, 'AGENT_COMPUTE' | 'AGENT_COMPUTE_SECRET'>): boolean {
  return String(env.AGENT_COMPUTE ?? '').trim() === 'on' && String(env.AGENT_COMPUTE_SECRET ?? '').length >= 32;
}
const OFF = no(404, 'compute_off', 'Agent compute is not switched on.');

export type JobRow = {
  id: number; uid: string; run_uid: string; agent_id: number; scope_kind: 'project' | 'company'; scope_id: number;
  workload: Workload; idempotency_key: string; status: string; inputs_json: string; input_bytes: number;
  grant_jti: string | null; grant_expires_at: string | null; grant_claimed_at: string | null;
  output_bytes: number | null; artifact_keys_json: string | null; cpu_ms: number | null; wall_ms: number | null;
  peak_rss_bytes: number | null; exit_code: number | null; failure_code: string | null;
  created_at: string; dispatched_at: string | null; ended_at: string | null; cancelled_at: string | null;
};
export type Input = { name: string; bytes: number };

/** A safe input file name: one relative segment of printable characters, no traversal. */
export function safeName(name: unknown): name is string {
  if (typeof name !== 'string' || !name || name.length > 120) return false;
  if (name.startsWith('/') || name.includes('\\') || name.includes('/') || name === '.' || name === '..' || name.includes('..')) return false;
  return /^[A-Za-z0-9][A-Za-z0-9 ._()-]*$/.test(name);
}
const ext = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');

/** Why these inputs may not go to `workload`; null when they may. */
export function inputsRefusal(workload: unknown, raw: unknown): ComputeRefusal | null {
  if (!(WORKLOADS as readonly unknown[]).includes(workload)) return no(422, 'workload_unknown', 'That is not a compute workload.');
  const l = LIMITS[workload as Workload];
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > l.max_inputs) return no(422, 'inputs_invalid', `Give 1 to ${l.max_inputs} input files.`);
  let total = 0;
  const seen = new Set<string>();
  for (const f of raw) {
    const name = (f as Input)?.name;
    const bytes = (f as Input)?.bytes;
    if (!safeName(name)) return no(422, 'input_name_invalid', 'An input file name may not be a path.');
    if (seen.has(name)) return no(422, 'input_name_invalid', 'Each input file name is given once.');
    seen.add(name);
    if (!l.input_types.includes(ext(name))) return no(422, 'input_type_refused', `This workload takes ${l.input_types.join(', ')} files.`);
    if (!Number.isSafeInteger(bytes) || bytes < 0) return no(422, 'inputs_invalid', 'Each input file states its size in bytes.');
    total += bytes;
  }
  if (total > l.max_input_bytes) return no(413, 'inputs_too_large', `The inputs come to more than ${l.max_input_bytes} bytes.`);
  return null;
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const b64u = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));
async function hmacHex(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)));
}
/** One key per job, derived from the master: a grant leaked from one job opens nothing else. */
const jobKey = (env: Pick<Env, 'AGENT_COMPUTE_SECRET'>, jobUid: string) => hmacHex(String(env.AGENT_COMPUTE_SECRET), `agent-compute:v1:${jobUid}`);
const newUid = () => hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
const sqlTime = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19);

/**
 * The job for one step of a live run, or the one an earlier delivery of the
 * same idempotency key made. Refused: compute off, a run that is not this
 * agent's or not running, bad inputs, or the scope at its live-job limit.
 */
export async function createJob(env: Env, input: { runUid: string; agent: Pick<AgentRow, 'id' | 'scope_kind' | 'company_id' | 'project_id'>; workload: unknown; inputs: unknown; idempotencyKey: string }):
  Promise<{ ok: true; job: JobRow; replayed: boolean } | ComputeRefusal> {
  if (!computeEnabled(env)) return OFF;
  if (typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9:_-]{8,128}$/.test(input.idempotencyKey)) return no(400, 'idempotency_key_invalid', 'A job is named by an idempotency key.');
  const prior = await env.DB.prepare('SELECT * FROM agent_compute_jobs WHERE idempotency_key = ?').bind(input.idempotencyKey).first<JobRow>();
  if (prior) {
    // A redelivery, never another job: the same key must name the same run and agent.
    if (prior.run_uid !== input.runUid || prior.agent_id !== input.agent.id) return no(409, 'idempotency_key_reused', 'That key names another job.');
    return { ok: true, job: prior, replayed: true };
  }
  const run = await env.DB.prepare('SELECT agent_id, status FROM agent_task_runs WHERE uid = ?').bind(input.runUid).first<{ agent_id: number; status: string }>();
  if (!run || Number(run.agent_id) !== input.agent.id) return no(404, 'run_not_found', 'There is no such run for this agent.');
  if (run.status !== 'running') return no(409, 'run_not_running', 'Only a running step can start compute.');
  const bad = inputsRefusal(input.workload, input.inputs);
  if (bad) return bad;
  const scopeKind = input.agent.scope_kind;
  const scopeId = scopeKind === 'company' ? input.agent.company_id : input.agent.project_id;
  if (scopeId == null) return no(404, 'run_not_found', 'There is no such run for this agent.');
  const live = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM agent_compute_jobs WHERE scope_kind = ? AND scope_id = ? AND status IN ('queued', 'dispatched', 'running')`,
  ).bind(scopeKind, scopeId).first<{ n: number }>();
  if (Number(live?.n ?? 0) >= MAX_LIVE_JOBS_PER_SCOPE) return no(429, 'compute_busy', `This team already has ${MAX_LIVE_JOBS_PER_SCOPE} compute jobs running.`);
  const inputs = (input.inputs as Input[]).map((f) => ({ name: f.name, bytes: f.bytes }));
  const uid = newUid();
  await env.DB.prepare(
    `INSERT INTO agent_compute_jobs (uid, run_uid, agent_id, scope_kind, scope_id, workload, idempotency_key, inputs_json, input_bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (idempotency_key) DO NOTHING`,
  ).bind(uid, input.runUid, input.agent.id, scopeKind, scopeId, input.workload, input.idempotencyKey, JSON.stringify(inputs),
    inputs.reduce((n, f) => n + f.bytes, 0)).run();
  // Two deliveries racing on one key: whichever row landed is the job.
  const job = await env.DB.prepare('SELECT * FROM agent_compute_jobs WHERE idempotency_key = ?').bind(input.idempotencyKey).first<JobRow>();
  if (!job) return no(503, 'job_unwritten', 'The job could not be recorded.');
  return { ok: true, job, replayed: job.uid !== uid };
}

export type GrantClaims = { v: 1; jti: string; job: string; run: string; scope: { kind: string; id: number }; workload: Workload; idem: string; exp: number };

/** The job's one run grant: it moves `queued` → `dispatched`. A job already granted is not granted again. */
export async function mintGrant(env: Env, job: JobRow, now = new Date()): Promise<{ ok: true; token: string; claims: GrantClaims } | ComputeRefusal> {
  if (!computeEnabled(env)) return OFF;
  const claims: GrantClaims = {
    v: 1, jti: newUid(), job: job.uid, run: job.run_uid, scope: { kind: job.scope_kind, id: Number(job.scope_id) },
    workload: job.workload, idem: job.idempotency_key, exp: Math.floor(now.getTime() / 1000) + GRANT_TTL_S,
  };
  const r = await env.DB.prepare(
    `UPDATE agent_compute_jobs SET status = 'dispatched', grant_jti = ?, grant_expires_at = ?, dispatched_at = ?
      WHERE uid = ? AND status = 'queued' AND grant_jti IS NULL`,
  ).bind(claims.jti, sqlTime(new Date(claims.exp * 1000)), sqlTime(now), job.uid).run();
  if (!Number(r.meta?.changes ?? 0)) return no(409, 'already_dispatched', 'This job was already dispatched.');
  const body = b64u(JSON.stringify(claims));
  return { ok: true, token: `${body}.${await hmacHex(await jobKey(env, job.uid), body)}`, claims };
}

/**
 * A callback's grant, checked against the job the path names. Every failure
 * is one refusal; nothing is written. `claimGrant` then spends it.
 */
export async function verifyGrant(env: Env, token: unknown, jobUid: string, now = new Date()): Promise<{ ok: true; claims: GrantClaims; job: JobRow } | ComputeRefusal> {
  if (!computeEnabled(env)) return OFF;
  const forged = no(401, 'grant_invalid', 'That run grant is not valid.');
  if (typeof token !== 'string' || token.length > 2048 || !/^[A-Za-z0-9_-]+\.[0-9a-f]{64}$/.test(token)) return forged;
  const [body, sig] = token.split('.');
  let claims: GrantClaims;
  try { claims = JSON.parse(unb64u(body)); } catch { return forged; }
  if (!claims || claims.v !== 1 || typeof claims.job !== 'string' || !/^[0-9a-f]{32}$/.test(claims.job)) return forged;
  // The signature first, with the key of the job the grant claims to be for.
  if (!constantTimeEqual(await hmacHex(await jobKey(env, claims.job), body), sig)) return forged;
  if (claims.job !== jobUid) return no(403, 'grant_wrong_job', 'That grant is for another job.');
  if (!Number.isSafeInteger(claims.exp) || claims.exp <= Math.floor(now.getTime() / 1000)) return no(401, 'grant_expired', 'That run grant has expired.');
  const job = await env.DB.prepare('SELECT * FROM agent_compute_jobs WHERE uid = ?').bind(jobUid).first<JobRow>();
  if (!job || job.grant_jti !== claims.jti) return forged;
  if (job.run_uid !== claims.run || job.scope_kind !== claims.scope?.kind || Number(job.scope_id) !== claims.scope?.id || job.idempotency_key !== claims.idem) {
    return no(403, 'grant_wrong_scope', 'That grant is not for this team.');
  }
  if (job.cancelled_at || (TERMINAL as readonly string[]).includes(job.status)) return no(409, 'job_ended', 'This job has ended; nothing more is accepted for it.');
  return { ok: true, claims, job };
}

/** Spend the grant once (`dispatched` → `running`). A replay, even a concurrent one, changes nothing and is refused. */
export async function claimGrant(env: Env, job: JobRow, now = new Date()): Promise<{ ok: true } | ComputeRefusal> {
  const r = await env.DB.prepare(
    `UPDATE agent_compute_jobs SET status = 'running', grant_claimed_at = ?
      WHERE uid = ? AND grant_jti = ? AND grant_claimed_at IS NULL AND status = 'dispatched' AND cancelled_at IS NULL`,
  ).bind(sqlTime(now), job.uid, job.grant_jti).run();
  return Number(r.meta?.changes ?? 0) ? { ok: true } : no(409, 'grant_replayed', 'That run grant was already used.');
}

export type Result = {
  outcome: 'succeeded' | 'failed' | 'timed_out';
  output_bytes: number; artifacts: string[]; cpu_ms: number; wall_ms: number; peak_rss_bytes: number;
  exit_code: number; failure_code?: string | null;
};
/** The job's R2 prefix: inputs and outputs live only here. */
export const artifactPrefix = (job: Pick<JobRow, 'scope_kind' | 'scope_id' | 'run_uid'>) => `agent-compute/${job.scope_kind}/${Number(job.scope_id)}/${job.run_uid}/`;

/** Why a result may not be recorded for `job`; null when it may. Counts and keys only. */
export function resultRefusal(job: Pick<JobRow, 'workload' | 'scope_kind' | 'scope_id' | 'run_uid'>, r: any): ComputeRefusal | null {
  const l = LIMITS[job.workload];
  const bad = no(422, 'result_invalid', 'That result is not one this job can record.');
  if (!r || !['succeeded', 'failed', 'timed_out'].includes(r.outcome)) return bad;
  for (const k of ['output_bytes', 'cpu_ms', 'wall_ms', 'peak_rss_bytes']) if (!Number.isSafeInteger(r[k]) || r[k] < 0) return bad;
  if (!Number.isSafeInteger(r.exit_code)) return bad;
  if (r.failure_code != null && !(typeof r.failure_code === 'string' && /^[a-z0-9_]{1,64}$/.test(r.failure_code))) return bad;
  if (r.output_bytes > l.max_output_bytes) return no(413, 'output_too_large', 'The job wrote more than its output limit.');
  if (!Array.isArray(r.artifacts) || r.artifacts.length > l.max_artifacts) return no(422, 'too_many_artifacts', `A job keeps at most ${l.max_artifacts} artifacts.`);
  const prefix = artifactPrefix(job);
  for (const k of r.artifacts) {
    if (typeof k !== 'string' || !k.startsWith(prefix) || k.length > 512 || !safeName(k.slice(prefix.length))) {
      return no(403, 'artifact_outside_job', 'An artifact may only be written under the job\'s own prefix.');
    }
  }
  return null;
}

/** End a running job once with its bounded outcome. A second callback, or one after a cancel, changes nothing. */
export async function recordResult(env: Env, job: JobRow, r: Result, now = new Date()): Promise<{ ok: true } | ComputeRefusal> {
  const bad = resultRefusal(job, r);
  if (bad) return bad;
  const u = await env.DB.prepare(
    `UPDATE agent_compute_jobs SET status = ?, output_bytes = ?, artifact_keys_json = ?, cpu_ms = ?, wall_ms = ?, peak_rss_bytes = ?,
        exit_code = ?, failure_code = ?, ended_at = ?
      WHERE uid = ? AND status = 'running' AND cancelled_at IS NULL`,
  ).bind(r.outcome, r.output_bytes, JSON.stringify(r.artifacts), r.cpu_ms, r.wall_ms, r.peak_rss_bytes, r.exit_code, r.failure_code ?? null,
    sqlTime(now), job.uid).run();
  return Number(u.meta?.changes ?? 0) ? { ok: true } : no(409, 'already_recorded', 'This job has already ended.');
}

/** Cancel a live job. The host is to stop the process; a grant or result that arrives later is refused. */
export async function cancelJob(env: Env, jobUid: string, now = new Date()): Promise<{ ok: true } | ComputeRefusal> {
  const r = await env.DB.prepare(
    `UPDATE agent_compute_jobs SET status = 'cancelled', cancelled_at = ?, ended_at = ? WHERE uid = ? AND status IN ('queued', 'dispatched', 'running')`,
  ).bind(sqlTime(now), sqlTime(now), jobUid).run();
  return Number(r.meta?.changes ?? 0) ? { ok: true } : no(409, 'job_ended', 'This job has already ended.');
}
