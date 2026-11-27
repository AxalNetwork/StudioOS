/** D5565: injected-clock, atomic per-run lease protocol; no route, mount, D1, billing or task scheduler. */
import { artifactPrefix, LIMITS, safeName } from './compute';
import { trustedWorkspaceSpec, workspaceReference, workspaceRefusal, type WorkspaceResult, type WorkspaceSpec, type WorkspaceState } from './workspaceSpec';

export type RunnerIdentity = { tenant_id: number; company_id: number; project_id: number | null; agent_id: number; task_id: number; runner_id: string };
type Lease = { id: string; runner_id: string; expires_at: number; last_heartbeat: number; sequence: number };
export type RunnerRecord = {
  spec: WorkspaceSpec; generation: number; state: WorkspaceState; lease: Lease | null;
  used_nonces: string[]; last_now: number; started_at: number | null; cleanup_required: boolean;
  completed: { lease_id: string; runner_id: string; manifest_ref: string } | null;
};
/** Implement with one scope's DO storage transaction; the memory implementation belongs only to tests. */
export interface RunnerStore { transaction<T>(change: (records: Map<string, RunnerRecord>) => T): Promise<T> }
export type RunnerPolicy = {
  heartbeat_ms: number; missed_beat_limit: number; max_generations: number;
  nonce(): string;
  authorize(identity: RunnerIdentity, spec: WorkspaceSpec): boolean;
  manifestAllowed(spec: WorkspaceSpec, manifestRef: string): boolean;
};
export type RunnerCall = { run_id: string; execution_generation: number; lease_id: string; identity: RunnerIdentity };

export function workspaceArtifactPrefix(spec: WorkspaceSpec): string {
  return `tenants/${spec.tenant_id}/` + artifactPrefix({ scope_kind: spec.project_id ? 'project' : 'company', scope_id: spec.project_id ?? spec.company_id, run_uid: spec.run_id })
    + `workspace/g${spec.execution_generation}/`;
}

export function createRunnerControl({ store, clock, policy }: { store: RunnerStore; clock: () => number; policy: RunnerPolicy }) {
  const ttl = policy.heartbeat_ms * policy.missed_beat_limit;
  if (!Number.isSafeInteger(policy.heartbeat_ms) || policy.heartbeat_ms < 1000 || !Number.isSafeInteger(policy.missed_beat_limit)
    || policy.missed_beat_limit < 2 || ttl > 60000 || !Number.isSafeInteger(policy.max_generations) || policy.max_generations < 1 || policy.max_generations > 20) throw new Error('Invalid runner lease policy');
  const refuse = workspaceRefusal;
  const readNow = () => {
    const now = clock();
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid injected clock');
    return now;
  };
  const owns = (r: RunnerRecord, actor: RunnerIdentity) => actor && actor.tenant_id === r.spec.tenant_id && actor.company_id === r.spec.company_id
    && actor.project_id === r.spec.project_id && actor.agent_id === r.spec.agent_id && actor.task_id === r.spec.task_id
    && safeName(actor.runner_id) && policy.authorize(actor, r.spec);
  function fence(r: RunnerRecord | undefined, call: RunnerCall, now: number): WorkspaceResult<RunnerRecord> {
    if (!r || !owns(r, call.identity)) return refuse('runner_not_authorized', 403);
    if (now < r.last_now) return refuse('clock_regressed', 503);
    if (call.execution_generation !== r.generation) return refuse('stale_generation');
    if (r.state !== 'running' || !r.lease || r.lease.id !== call.lease_id || r.lease.runner_id !== call.identity.runner_id) return refuse('lease_not_live');
    if (now >= r.lease.expires_at) return refuse('lease_expired');
    if (r.started_at !== null && now >= r.started_at + r.spec.max_duration_s * 1000) return refuse('execution_timed_out');
    return { ok: true, value: r };
  }

  return {
    /** Trusted broker call after existing runtime admission; it creates no task, hold or queue message. */
    async register(input: unknown): Promise<WorkspaceResult<{ execution_generation: number }>> {
      const parsed = trustedWorkspaceSpec(input);
      if (!parsed.ok) return parsed;
      const spec = parsed.value;
      return store.transaction(records => {
        const existing = records.get(spec.run_id);
        if (existing) return JSON.stringify(existing.spec) === JSON.stringify(spec)
          ? { ok: true, value: { execution_generation: existing.generation } } : refuse('run_contract_changed');
        const now = readNow();
        records.set(spec.run_id, { spec, generation: spec.execution_generation, state: 'queued', lease: null,
          used_nonces: [], last_now: now, started_at: null, cleanup_required: false, completed: null });
        return { ok: true, value: { execution_generation: spec.execution_generation } };
      });
    },

    /** One pull attempt. A transport may long-poll around an unavailable answer; this module never waits. */
    async lease({ run_id, execution_generation, request_nonce, identity }: Omit<RunnerCall, 'lease_id'> & { request_nonce: string }): Promise<WorkspaceResult<{ spec: WorkspaceSpec; lease_id: string; expires_at: number }>> {
      return store.transaction(records => {
        const r = records.get(run_id), now = readNow();
        if (!r || !owns(r, identity)) return refuse('runner_not_authorized', 403);
        if (now < r.last_now) return refuse('clock_regressed', 503);
        if (execution_generation !== r.generation) return refuse('stale_generation');
        if (!safeName(request_nonce) || r.used_nonces.includes(request_nonce)) return refuse('lease_replay');
        if (r.state !== 'queued' || r.lease) return refuse('lease_unavailable');
        if (r.cleanup_required) return refuse('cleanup_unconfirmed', 503);
        if (r.used_nonces.length >= policy.max_generations) return refuse('retry_limit');
        if (r.started_at !== null && now >= r.started_at + r.spec.max_duration_s * 1000) return refuse('execution_timed_out');
        const leaseId = policy.nonce();
        if (!safeName(leaseId)) return refuse('invalid_lease_nonce', 503);
        const effective = trustedWorkspaceSpec({ ...r.spec, execution_generation: r.generation });
        if (!effective.ok) return effective;
        r.used_nonces.push(request_nonce); r.last_now = now; r.started_at ??= now;
        r.lease = { id: leaseId, runner_id: identity.runner_id, expires_at: now + ttl, last_heartbeat: now, sequence: 0 };
        r.state = 'running';
        return { ok: true, value: { spec: effective.value, lease_id: leaseId, expires_at: now + ttl } };
      });
    },

    async heartbeat(call: RunnerCall & { sequence: number }): Promise<WorkspaceResult<{ cancel: boolean; expires_at: number }>> {
      return store.transaction(records => {
        const now = readNow(), checked = fence(records.get(call.run_id), call, now);
        if (!checked.ok) return { ...checked, cancel: true };
        const r = checked.value, lease = r.lease!;
        if (!Number.isSafeInteger(call.sequence) || call.sequence <= lease.sequence) return refuse('heartbeat_replay');
        lease.sequence = call.sequence; lease.last_heartbeat = now; lease.expires_at = now + ttl; r.last_now = now;
        return { ok: true, value: { cancel: false, expires_at: lease.expires_at } };
      });
    },

    /** Also called by the artifact broker before accepting any bytes; no object access is granted here. */
    async uploadFence(call: RunnerCall): Promise<WorkspaceResult<{ prefix: string }>> {
      return store.transaction(records => {
        const checked = fence(records.get(call.run_id), call, readNow());
        return checked.ok ? { ok: true, value: { prefix: workspaceArtifactPrefix({ ...checked.value.spec, execution_generation: checked.value.generation }) } } : checked;
      });
    },

    async complete(call: RunnerCall & { manifest_ref: string }): Promise<WorkspaceResult<{ duplicate: boolean }>> {
      return store.transaction(records => {
        const r = records.get(call.run_id), now = readNow();
        if (!r || !owns(r, call.identity)) return refuse('runner_not_authorized', 403);
        if (call.execution_generation !== r.generation) return refuse('stale_generation');
        if (!workspaceReference(call.manifest_ref) || !policy.manifestAllowed({ ...r.spec, execution_generation: r.generation }, call.manifest_ref)) return refuse('manifest_not_authorized', 403);
        if (r.completed) return r.completed.lease_id === call.lease_id && r.completed.runner_id === call.identity.runner_id && r.completed.manifest_ref === call.manifest_ref
          ? { ok: true, value: { duplicate: true } } : refuse('completion_conflict');
        const checked = fence(r, call, now);
        if (!checked.ok) return checked;
        r.completed = { lease_id: call.lease_id, runner_id: call.identity.runner_id, manifest_ref: call.manifest_ref };
        r.lease = null; r.state = 'finished'; r.last_now = now; r.cleanup_required = true;
        return { ok: true, value: { duplicate: false } };
      });
    },

    /** Existing runtime cancellation/revocation calls this; runner callbacks cannot invoke it via this module. */
    async requestCancel(runId: string, expectedGeneration: number): Promise<WorkspaceResult<{ execution_generation: number }>> {
      return store.transaction(records => {
        const r = records.get(runId);
        if (!r) return refuse('run_not_found', 403);
        if (expectedGeneration !== r.generation) return refuse('stale_generation');
        if (['finished', 'failed', 'cancelled'].includes(r.state)) return refuse('run_terminal');
        r.generation++; r.state = 'cancelling'; r.lease = null; r.cleanup_required = true;
        return { ok: true, value: { execution_generation: r.generation } };
      });
    },

    /** A missed-beat fence invalidates the old attempt immediately; relaunch still waits for host cleanup. */
    async reap(): Promise<{ run_id: string; execution_generation: number; state: WorkspaceState }[]> {
      return store.transaction(records => {
        const now = readNow(), reaped: { run_id: string; execution_generation: number; state: WorkspaceState }[] = [];
        for (const r of records.values()) {
          if (now < r.last_now || !r.lease || r.state !== 'running') continue;
          const timedOut = r.started_at !== null && now >= r.started_at + r.spec.max_duration_s * 1000;
          if (!timedOut && now < r.lease.last_heartbeat + policy.heartbeat_ms * policy.missed_beat_limit) continue;
          r.generation++; r.lease = null; r.last_now = now; r.cleanup_required = true;
          r.state = timedOut || r.used_nonces.length >= policy.max_generations ? 'failed' : 'queued';
          reaped.push({ run_id: r.spec.run_id, execution_generation: r.generation, state: r.state });
        }
        return reaped;
      });
    },

    /** Trusted host reconciliation only: a new lease is impossible while the preceding sandbox may still exist. */
    async acknowledgeCleanup(runId: string, expectedGeneration: number): Promise<WorkspaceResult<{ cleaned: true }>> {
      return store.transaction(records => {
        const r = records.get(runId);
        if (!r) return refuse('run_not_found', 403);
        if (r.generation !== expectedGeneration) return refuse('stale_generation');
        if (r.lease) return refuse('lease_still_live');
        r.cleanup_required = false;
        if (r.state === 'cancelling') r.state = 'cancelled';
        return { ok: true, value: { cleaned: true } };
      });
    },
  };
}

/** Existing deterministic limits are reused, never widened by the coding executor contract. */
export const deterministicLimits = LIMITS;
