/** D4557 part 2: recoverable one-job VM lifecycle; the AgentTaskWorkflow retains task/retry/approval ownership. */
import { LIMITS, type Workload } from '../cloudflare-worker/src/services/agents/compute';
import { computeTarget, hostAdmission, hostResult, type HostAdmission, type HostManifest, type HostResult } from '../cloudflare-worker/src/services/agents/computeHost';
import type { createWorkspaceSecurity } from '../cloudflare-worker/src/services/agents/workspaceSecurity';

export type HostState = 'starting' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'unknown';
export type HostRecord = HostAdmission & { state: HostState; deadline: number; cleanup_required: boolean; boot_attempted: boolean };
export interface HostStore { transaction<T>(change: (row: HostRecord | null) => { row: HostRecord | null; value: T }): Promise<T> }
export interface ComputeVm {
  start(imageDigest: string): void;
  ready(signal: AbortSignal): Promise<void>;
  run(input: { workload: Workload; operation: string; inputs: { name: string; data: string }[] }, signal: AbortSignal, bootstrapGrant: string): Promise<unknown>;
  destroy(): Promise<void>;
}
export interface ComputeBroker {
  manifest(admission: HostAdmission): Promise<HostManifest>;
  input(admission: HostAdmission, ref: string, token: string): Promise<string>;
  complete(admission: HostAdmission, result: HostResult, token: string): Promise<void>;
}

export function createComputeHost(deps: { store: HostStore; security: ReturnType<typeof createWorkspaceSecurity>; vm: ComputeVm;
  broker: ComputeBroker; now(): number; arm(deadline: number): Promise<void> }) {
  let active: Promise<void> | null = null;
  const read = () => deps.store.transaction(row => ({ row, value: row }));
  const state = async (next: HostState, cleanup = true) => deps.store.transaction(row => {
    if (!row) throw Error('compute_record_missing');
    if (row.state === 'cancelled' || row.state === 'timed_out') return { row, value: row };
    row.state = next; row.cleanup_required = cleanup; return { row, value: row };
  });
  async function destroy(): Promise<boolean> {
    try {
      await deps.vm.destroy();
      await deps.store.transaction(row => { if (row) row.cleanup_required = false; return { row, value: null }; });
      return true;
    } catch { await state('unknown'); return false; }
  }
  const failure = (_row: HostRecord, code: string, outcome: 'failed' | 'timed_out' = 'failed'): HostResult => ({ outcome, failure_code: code,
    artifacts: [], cpu_ms: null, wall_ms: null, peak_rss_bytes: null, exit_code: null });
  async function publish(row: HostRecord, result: HostResult) {
    const current = await read();
    if (!current || ['cancelled', 'timed_out', 'unknown'].includes(current.state)) return;
    const token = await deps.security.issue(computeTarget(row, 'executor.complete'));
    if (!token.ok) throw Error(token.code);
    await deps.broker.complete(row, result, token.value.token);
    await state(result.outcome, false);
  }
  async function execute(row: HostRecord) {
    const timer = AbortSignal.timeout(Math.max(1, row.deadline - deps.now()));
    try {
      const registered = await deps.security.register(row.spec, row.sponsor);
      if (!registered.ok) throw Error(registered.code);
      const manifest = await deps.broker.manifest(row), inputs: { name: string; data: string }[] = [];
      for (const input of manifest.inputs) {
        const grant = await deps.security.issue(computeTarget(row, 'artifact.read', input.ref, row.spec.allowed_regions[0]));
        if (!grant.ok) throw Error(grant.code);
        inputs.push({ name: input.name, data: await deps.broker.input(row, input.ref, grant.value.token) });
      }
      const target = computeTarget(row, 'executor.bootstrap');
      const bootstrap = await deps.security.issue(target, 60000);
      if (!bootstrap.ok) throw Error(bootstrap.code);
      const permit = await deps.security.redeem(bootstrap.value.token, target);
      if (!permit.ok) throw Error(permit.code);
      const mayBoot = await deps.store.transaction(current => {
        if (!current || current.state !== 'starting' || current.boot_attempted || deps.now() >= current.deadline) return { row: current, value: false };
        current.boot_attempted = true; return { row: current, value: true };
      });
      if (!mayBoot) return;
      deps.vm.start(row.spec.image_digest);
      await deps.vm.ready(timer);
      const running = await deps.store.transaction(current => {
        if (!current || current.state !== 'starting' || deps.now() >= current.deadline) return { row: current, value: false };
        current.state = 'running'; return { row: current, value: true };
      });
      if (!running) return;
      const raw = await deps.vm.run({ workload: manifest.workload, operation: manifest.operation, inputs }, timer, bootstrap.value.token);
      const result = await hostResult(raw, manifest.workload);
      if (!result) throw Error('container_result_invalid');
      if (!await destroy()) return;
      await publish(row, result);
    } catch {
      const current = await read();
      if (!current || ['cancelled', 'timed_out'].includes(current.state)) return;
      if (await destroy()) await publish(row, failure(row, timer.aborted ? 'wall_limit' : 'compute_failed', timer.aborted ? 'timed_out' : 'failed'));
    } finally {
      const current = await read();
      if (current?.cleanup_required) await destroy();
    }
  }
  return {
    /** Persist the tombstone before allocating; a replay never boots another VM. */
    async dispatch(raw: unknown): Promise<{ state: HostState; duplicate: boolean }> {
      const admission = hostAdmission(raw); if (!admission) throw Error('compute_admission_invalid');
      const workload = admission.spec.workload_class as Workload;
      if (admission.spec.max_duration_s * 1000 > LIMITS[workload].wall_ms) throw Error('compute_limits_invalid');
      const selected = await deps.store.transaction(row => {
        if (row) {
          if (JSON.stringify({ job_uid: row.job_uid, spec: row.spec, sponsor: row.sponsor }) !== JSON.stringify(admission)) throw Error('compute_admission_conflict');
          return { row, value: { row, duplicate: true } };
        }
        const created: HostRecord = { ...admission, state: 'starting', deadline: deps.now() + admission.spec.max_duration_s * 1000, cleanup_required: true, boot_attempted: false };
        return { row: created, value: { row: created, duplicate: false } };
      });
      if (selected.duplicate) {
        // A reconstructed object cannot assume the former request or process survived.
        if (!active && selected.row.boot_attempted && ['starting', 'running', 'unknown'].includes(selected.row.state)) {
          if (await destroy()) { await state('failed', false); await publish(selected.row, failure(selected.row, 'execution_lost')); }
        }
        return { state: (await read())!.state, duplicate: true };
      }
      // A DO alarm owns the bounded VM request, rather than a post-response Worker waitUntil().
      await deps.arm(deps.now());
      return { state: selected.row.state, duplicate: false };
    },
    pending: () => active,
    status: read,
    async cancel(timedOut = false) {
      const row = await deps.store.transaction(row => {
        if (row && !['succeeded', 'failed', 'cancelled', 'timed_out'].includes(row.state)) { row.state = timedOut ? 'timed_out' : 'cancelled'; row.cleanup_required = true; }
        return { row, value: row };
      });
      if (!row) return;
      try { await deps.security.revoke(row.spec.run_id); }
      finally { await destroy(); }
    },
    async alarm() {
      const row = await read(); if (!row || !row.cleanup_required) return;
      if (deps.now() >= row.deadline) { await this.cancel(true); return; }
      if (active) return;
      if (row.boot_attempted) {
        if (await destroy()) { await state('failed', false); await publish(row, failure(row, 'execution_lost')); }
        return;
      }
      await deps.arm(row.deadline);
      active = execute(row).finally(() => { active = null; });
      await active;
    },
  };
}
