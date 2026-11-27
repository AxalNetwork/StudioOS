/** D5565: synthetic workspace, atomic memory store and faultable fake executor; never imported by production. */
import { executorEligibility, executionTransition, sameExecution, trustedWorkspaceSpec, workspaceRefusal,
  type ExecutionRef, type ExecutionStatus, type ExecutorAdapter, type ExecutorCapabilities, type WorkspaceResult, type WorkspaceSpec, type WorkspaceState } from '../src/services/agents/workspaceSpec.ts';
import type { RunnerIdentity, RunnerRecord, RunnerStore } from '../src/services/agents/runnerProtocol.ts';

export function specFixture(changes: Partial<WorkspaceSpec> = {}): WorkspaceSpec {
  const parsed = trustedWorkspaceSpec({ version: 1, tenant_id: 11, company_id: 21, project_id: 31, agent_id: 41, task_id: 51,
    run_id: 'run-synthetic', attempt: 1, execution_generation: 1, idempotency_key: 'run-synthetic:workspace:1',
    image_digest: 'sha256:' + 'a'.repeat(64), repo_id: 61, base_sha: 'b'.repeat(40), scope_paths: ['src', 'test'],
    cpu: 0.5, memory_mb: 512, disk_mb: 512, max_duration_s: 60, network_policy: { mode: 'deny' },
    allowed_regions: ['weur'], allowed_providers: ['cloudflare'], workload_class: 'coding_untrusted',
    checkpoint_manifest_ref: null, artifact_sink_ref: 'sink-synthetic', max_cost_microusd: 100000, ...changes });
  if (!parsed.ok) throw Error('Invalid synthetic fixture');
  return parsed.value;
}
export function actorFixture(spec = specFixture()): RunnerIdentity {
  return { tenant_id: spec.tenant_id, company_id: spec.company_id, project_id: spec.project_id, agent_id: spec.agent_id,
    task_id: spec.task_id, runner_id: 'runner-synthetic' };
}
export function memoryRunnerStore(): RunnerStore & { inspect(): Map<string, RunnerRecord> } {
  let records = new Map<string, RunnerRecord>();
  let pending: Promise<unknown> = Promise.resolve();
  return {
    async transaction<T>(change: (rows: Map<string, RunnerRecord>) => T): Promise<T> {
      const next = pending.then(() => { const copy = structuredClone(records); const result = change(copy); records = copy; return result; });
      pending = next.catch(() => {});
      return next;
    },
    inspect: () => structuredClone(records),
  };
}

export const fakeCapabilities = (): ExecutorCapabilities => ({ provider: 'cloudflare', revision: 'synthetic-1',
  workload_classes: ['coding_trusted', 'coding_untrusted'], digest_pulls: true, shell: true, untrusted_code: true,
  cpu_max: 2, memory_mb_max: 2048, disk_mb_max: 4096, duration_s_max: 600, enforced_network_modes: ['deny'],
  enforced_regions: ['weur'], gpu: false, interrupt: true, checkpoint_restore: true, concurrency_max: 2 });

export function fakeExecutor(clock: () => number, caps = fakeCapabilities()) {
  const runs = new Map<string, { spec: WorkspaceSpec; status: ExecutionStatus; created: number; stopped: boolean; manifest: string | null }>();
  const keys = new Map<string, string>();
  const stats = { physical_creates: 0 };
  const read = (ref: ExecutionRef) => { const row = runs.get(ref.execution_id); return row && sameExecution(row.status.ref, ref) ? row : null; };
  const change = (ref: ExecutionRef, state: WorkspaceState): WorkspaceResult<ExecutionStatus> => {
    const row = read(ref);
    if (!row) return workspaceRefusal('execution_not_authorized', 403);
    if (!executionTransition(row.status.state, state)) return workspaceRefusal('execution_transition_refused');
    row.status.state = state;
    return { ok: true, value: structuredClone(row.status) };
  };
  const adapter: ExecutorAdapter = {
    capabilities: async () => structuredClone(caps),
    async estimate(spec) {
      const gate = executorEligibility(spec, caps);
      return gate.ok ? { ok: true, value: { cost_microusd: 0, measured: false } } : gate;
    },
    async create(spec) {
      const parsed = trustedWorkspaceSpec(spec); if (!parsed.ok) return parsed;
      const gate = executorEligibility(parsed.value, caps); if (!gate.ok) return gate;
      const key = `${spec.tenant_id}/${spec.run_id}/${spec.attempt}/${spec.execution_generation}/${spec.idempotency_key}`;
      const prior = keys.get(key);
      if (prior) {
        const row = runs.get(prior)!;
        return JSON.stringify(row.spec) === JSON.stringify(parsed.value) ? { ok: true, value: structuredClone(row.status) } : workspaceRefusal('idempotency_conflict');
      }
      const active = [...runs.values()].filter(row => !row.stopped).length;
      if (active >= (caps.concurrency_max ?? 0)) return workspaceRefusal('capacity_exhausted', 503);
      const ref: ExecutionRef = { provider: caps.provider, execution_id: `fake-${++stats.physical_creates}`, tenant_id: spec.tenant_id,
        run_id: spec.run_id, attempt: spec.attempt, execution_generation: spec.execution_generation, region: gate.value.region };
      const status: ExecutionStatus = { ref, state: 'provisioning' };
      runs.set(ref.execution_id, { spec: parsed.value, status, created: clock(), stopped: false, manifest: null }); keys.set(key, ref.execution_id);
      return { ok: true, value: structuredClone(status) };
    },
    async get(ref) {
      const row = read(ref); if (!row) return workspaceRefusal('execution_not_authorized', 403);
      if (!row.stopped && clock() >= row.created + row.spec.max_duration_s * 1000) { row.stopped = true; row.status.state = 'failed'; row.status.failure_code = 'timeout'; }
      return { ok: true, value: structuredClone(row.status) };
    },
    async terminate(ref) {
      const row = read(ref); if (!row) return workspaceRefusal('execution_not_authorized', 403);
      if (['finished', 'failed', 'cancelled'].includes(row.status.state)) return { ok: true, value: structuredClone(row.status) };
      row.status.state = 'cancelled'; row.stopped = true;
      return { ok: true, value: structuredClone(row.status) };
    },
    async collect(ref) {
      const row = read(ref); if (!row) return workspaceRefusal('execution_not_authorized', 403);
      if (row.status.state !== 'finished') return workspaceRefusal('artifacts_unavailable');
      return { ok: true, value: { manifest_ref: row.manifest, checkpoint_manifest_ref: null } };
    },
    async cleanup(ref) {
      const row = read(ref); if (!row) return workspaceRefusal('execution_not_authorized', 403);
      return row.stopped ? { ok: true, value: { cleaned: true } } : workspaceRefusal('cleanup_unconfirmed', 503);
    },
  };
  return { adapter, stats,
    start: (ref: ExecutionRef) => change(ref, 'running'),
    finish(ref: ExecutionRef, manifest = 'manifest-synthetic') {
      const result = change(ref, 'finished'); if (result.ok) { const row = read(ref)!; row.manifest = manifest; row.stopped = true; } return result;
    },
    kill(ref: ExecutionRef) { const row = read(ref); if (!row) throw Error('Unknown fixture'); row.status.state = 'unknown'; },
    confirmStopped(ref: ExecutionRef) { const row = read(ref); if (!row) throw Error('Unknown fixture'); row.stopped = true; },
  };
}
