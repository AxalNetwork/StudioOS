/** D5566: one disposable execution's persisted lifecycle; the existing Workflow owns task dispatch/retry/accounting. */
import { executorEligibility, sameExecution, trustedWorkspaceSpec, workspacePath, workspaceReference, workspaceRefusal,
  type ExecutionArtifacts, type ExecutionRef, type ExecutionStatus, type ExecutorCapabilities, type WorkspaceResult, type WorkspaceSpec, type WorkspaceState } from '../../cloudflare-worker/src/services/agents/workspaceSpec';
import type { WorkspaceAudience } from '../../cloudflare-worker/src/services/agents/workspaceSecurity';

export type Materialization = { bundle_b64: string; commands: string[][] };
export type WorkspaceOutput = { version: 1; run_id: string; execution_generation: number; base_sha: string;
  changed: ({ path: string; sha256: string; bytes: string } | { path: string; deleted: true })[] };
export type SignedArtifacts = ExecutionArtifacts & { signature_verified: boolean; manifest_sha256: string };
export type Admission = { spec: WorkspaceSpec; capabilities: ExecutorCapabilities; image_ref: string; budget_ref: string; materialization?: Materialization };
export interface WorkspaceBroker {
  /** The real main-Worker bridge must redeem the audience grant and re-check current roles/run/policy. */
  admit(ticket: string, audience: WorkspaceAudience, target: WorkspaceSpec | ExecutionRef): Promise<WorkspaceResult<Admission>>;
  accept(spec: WorkspaceSpec, output: WorkspaceOutput): Promise<WorkspaceResult<SignedArtifacts>>;
}
export type HostRow = { revision: number; spec: WorkspaceSpec; ref: ExecutionRef; state: WorkspaceState;
  deadline: number; cleaned: boolean; failure_code?: string; artifacts?: SignedArtifacts };
export interface HostStore {
  read(): Promise<HostRow | null>;
  replace(expected: number | null, value: HostRow): Promise<boolean>;
  alarm(at: number | null): Promise<void>;
}
export type HostDeps = { store: HostStore; container?: Container; broker: WorkspaceBroker; enabled(): boolean; clock(): number;
  pause(ms: number): Promise<void>; background(work: Promise<void>): void };
const no = workspaceRefusal;
const status = (row: HostRow): ExecutionStatus => ({ ref: row.ref, state: row.state, ...(row.failure_code ? { failure_code: row.failure_code } : {}) });
const hash = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
export async function workspaceExecutionId(spec: Pick<WorkspaceSpec, 'tenant_id' | 'run_id' | 'attempt' | 'execution_generation'>): Promise<string> {
  return 'ws-' + await hash(new TextEncoder().encode(JSON.stringify([spec.tenant_id, spec.run_id, spec.attempt, spec.execution_generation])));
}

/** This check runs outside the untrusted sandbox, before any broker artifact/signature/publication step. */
export async function validateWorkspaceOutput(spec: WorkspaceSpec, output: unknown): Promise<WorkspaceResult<WorkspaceOutput>> {
  const data = output as WorkspaceOutput;
  if (!data || data.version !== 1 || data.run_id !== spec.run_id || data.execution_generation !== spec.execution_generation || data.base_sha !== spec.base_sha
    || Object.keys(data).some(key => !['version', 'run_id', 'execution_generation', 'base_sha', 'changed'].includes(key))
    || !Array.isArray(data.changed) || data.changed.length > 100) return no('workspace_result_invalid', 422);
  const paths = new Set<string>(); let total = 0, decodedTotal = 0;
  for (const file of data.changed) {
    if (!file || typeof file.path !== 'string' || !workspacePath(file.path) || paths.has(file.path) || !spec.scope_paths.some(scope => file.path === scope || file.path.startsWith(scope + '/'))) return no('workspace_scope_violation', 403);
    paths.add(file.path);
    if ('deleted' in file) {
      if (file.deleted !== true || Object.keys(file).some(key => !['path', 'deleted'].includes(key))) return no('workspace_result_invalid', 422);
      continue;
    }
    if (Object.keys(file).some(key => !['path', 'sha256', 'bytes'].includes(key)) || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)
      || typeof file.bytes !== 'string') return no('workspace_result_invalid', 422);
    total += file.bytes.length;
    if (total > 3 * 1024 * 1024) return no('workspace_artifact_limit', 422);
    if (file.bytes.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.bytes)) return no('workspace_result_invalid', 422);
    let raw: string;
    try { raw = atob(file.bytes); if (btoa(raw) !== file.bytes) return no('workspace_result_invalid', 422); }
    catch { return no('workspace_result_invalid', 422); }
    const decoded = Uint8Array.from(raw, char => char.charCodeAt(0));
    decodedTotal += decoded.byteLength;
    if (decodedTotal > 2 * 1024 * 1024) return no('workspace_artifact_limit', 422);
    if (await hash(decoded) !== file.sha256) return no('workspace_artifact_hash_mismatch', 422);
  }
  return { ok: true, value: structuredClone(data) };
}

async function boundedOutput(stream: ReadableStream | null): Promise<Uint8Array> {
  if (!stream) throw Error('result_unavailable');
  const reader = stream.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      const chunk = new Uint8Array(next.value); length += chunk.length;
      if (length > 4 * 1024 * 1024) { await reader.cancel(); throw Error('output_limit'); }
      chunks.push(chunk);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export function createWorkspaceHost(deps: HostDeps) {
  let active = false;
  const read = () => deps.store.read();
  const write = (row: HostRow, changes: Partial<HostRow>) => deps.store.replace(row.revision, { ...row, ...changes, revision: row.revision + 1 });
  async function stop(): Promise<boolean> {
    try { if (!deps.container) return false; await deps.container.destroy(); return true; } catch { return false; }
  }
  async function fail(code: string, state: WorkspaceState = 'failed') {
    const cleaned = await stop(), row = await read(); if (!row) return;
    if (['cancelled', 'finished'].includes(row.state)) return;
    await write(row, { state: cleaned ? (row.state === 'cancelling' ? 'cancelled' : state) : 'unknown', cleaned, failure_code: cleaned ? code : 'cleanup_unconfirmed' });
    await deps.store.alarm(cleaned ? null : deps.clock() + 30000);
  }
  async function authorize(ref: ExecutionRef, ticket: string, audience: WorkspaceAudience): Promise<WorkspaceResult<HostRow>> {
    const allowed = await deps.broker.admit(ticket, audience, ref); if (!allowed.ok) return allowed;
    const row = await read();
    if (!row || !sameExecution(row.ref, ref) || JSON.stringify(row.spec) !== JSON.stringify(allowed.value.spec)) return no('execution_not_authorized', 403);
    return { ok: true, value: row };
  }
  async function drive(spec: WorkspaceSpec, materialization: Materialization) {
    try {
      const process = await deps.container!.exec(['/usr/bin/setpriv', '--no-new-privs', 'node', '/app/run-job.mjs'], { user: 'node', stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env: { PATH: '/usr/local/bin:/usr/bin:/bin' } });
      const payload = { version: 1, run_id: spec.run_id, execution_generation: spec.execution_generation, base_sha: spec.base_sha,
        scope_paths: spec.scope_paths, max_duration_s: spec.max_duration_s, bundle_b64: materialization.bundle_b64, commands: materialization.commands };
      const encoded = new TextEncoder().encode(JSON.stringify(payload)); if (encoded.byteLength > 8 * 1024 * 1024 || !process.stdin) throw Error('input_limit');
      const writer = process.stdin.getWriter(); await writer.write(encoded); await writer.close();
      const [bytes, exitCode] = await Promise.all([boundedOutput(process.stdout), process.exitCode]);
      const cleaned = await stop();
      let row = await read(); if (!row || row.state !== 'running') return;
      if (!cleaned) { await write(row, { state: 'unknown', cleaned: false, failure_code: 'cleanup_unconfirmed' }); await deps.store.alarm(deps.clock() + 30000); return; }
      if (exitCode !== 0) { await write(row, { state: 'failed', cleaned: true, failure_code: 'workspace_command_failed' }); await deps.store.alarm(null); return; }
      const output = await validateWorkspaceOutput(spec, JSON.parse(new TextDecoder().decode(bytes)));
      if (!output.ok) { await write(row, { state: 'failed', cleaned: true, failure_code: output.code }); await deps.store.alarm(null); return; }
      if (!await write(row, { state: 'checkpointing', cleaned: true })) return;
      // Main broker stages/hash-verifies/signs idempotently at this exact run/generation and re-checks cancellation.
      const accepted = await deps.broker.accept(spec, output.value);
      row = await read(); if (!row || row.state !== 'checkpointing') return;
      if (!accepted.ok) { await write(row, { state: 'unknown', failure_code: 'artifact_outcome_unknown' }); return; }
      const artifacts = accepted.value;
      if (artifacts.signature_verified !== true || !workspaceReference(artifacts.manifest_ref) || !/^[a-f0-9]{64}$/.test(artifacts.manifest_sha256)
        || (artifacts.checkpoint_manifest_ref !== null && !workspaceReference(artifacts.checkpoint_manifest_ref))
        || Object.keys(artifacts).some(key => !['manifest_ref', 'checkpoint_manifest_ref', 'signature_verified', 'manifest_sha256'].includes(key))) {
        await write(row, { state: 'failed', failure_code: 'signed_manifest_missing' }); return;
      }
      await write(row, { state: 'finished', artifacts }); await deps.store.alarm(null);
    } catch { await fail('workspace_execution_failed'); }
    finally { active = false; }
  }
  return {
    async create(input: unknown, ticket: string): Promise<WorkspaceResult<ExecutionStatus>> {
      if (deps.enabled() !== true || !deps.container) return no('workspace_preview_disabled', 403);
      const parsed = trustedWorkspaceSpec(input); if (!parsed.ok) return parsed;
      const spec = parsed.value;
      // This image/pilot admits reviewed synthetic work only. Hostile code needs separately proven containment.
      if (spec.workload_class !== 'coding_trusted' || spec.checkpoint_manifest_ref !== null || spec.network_policy.mode !== 'deny' || spec.max_duration_s > 600
        || spec.cpu > 1 || spec.memory_mb > 1024 || spec.disk_mb > 1024) return no('workspace_pilot_policy_denied', 422);
      const admission = await deps.broker.admit(ticket, 'executor.bootstrap', spec); if (!admission.ok) return admission;
      const permit = admission.value;
      if (JSON.stringify(permit.spec) !== JSON.stringify(spec) || !workspaceReference(permit.budget_ref)) return no('workspace_admission_denied', 403);
      const eligibility = executorEligibility(spec, permit.capabilities); if (!eligibility.ok) return eligibility;
      if (!/^registry\.cloudflare\.com\/[A-Za-z0-9_./:-]+@sha256:[a-f0-9]{64}$/.test(permit.image_ref) || !permit.image_ref.endsWith('@' + spec.image_digest)
        || deps.container.images.coding !== permit.image_ref) return no('workspace_image_mismatch', 403);
      const existing = await read();
      if (existing) return JSON.stringify(existing.spec) === JSON.stringify(spec) ? { ok: true, value: status(existing) } : no('workspace_idempotency_conflict');
      if (!permit.materialization) return no('workspace_materialization_unavailable', 503);
      const ref: ExecutionRef = { provider: 'cloudflare', execution_id: await workspaceExecutionId(spec), tenant_id: spec.tenant_id,
        run_id: spec.run_id, attempt: spec.attempt, execution_generation: spec.execution_generation, region: eligibility.value.region };
      const at = deps.clock(), deadline = at + spec.max_duration_s * 1000;
      if (!Number.isSafeInteger(at) || at < 0 || !Number.isSafeInteger(deadline)) return no('workspace_clock_unavailable', 503);
      const row: HostRow = { revision: 1, spec, ref, state: 'provisioning', deadline, cleaned: false };
      if (!await deps.store.replace(null, row)) return no('workspace_create_raced');
      await deps.store.alarm(deadline);
      try {
        deps.container.start({ image: permit.image_ref, enableInternet: false, instance: { vcpu: spec.cpu, memoryMib: spec.memory_mb, diskMb: spec.disk_mb },
          env: { PATH: '/usr/local/bin:/usr/bin:/bin' }, labels: { run: spec.run_id.slice(0, 64), generation: String(spec.execution_generation) } });
        await deps.container.setInactivityTimeout(Math.min(60000, spec.max_duration_s * 1000));
        while (!deps.container.running) {
          const current = await read(); if (!current || current.state !== 'provisioning') return current ? { ok: true, value: status(current) } : no('workspace_state_unavailable', 503);
          if (deps.clock() >= deadline) { await fail('workspace_provision_timeout'); return { ok: true, value: status((await read())!) }; }
          await deps.pause(50);
        }
        const current = await read(); if (!current || current.state !== 'provisioning') return current ? { ok: true, value: status(current) } : no('workspace_state_unavailable', 503);
        if (!await write(current, { state: 'running' })) return no('workspace_state_changed');
        active = true; deps.background(drive(spec, permit.materialization));
        return { ok: true, value: status((await read())!) };
      } catch { await fail('workspace_start_failed'); return { ok: true, value: status((await read())!) }; }
    },
    async get(ref: ExecutionRef, ticket: string): Promise<WorkspaceResult<ExecutionStatus>> {
      const allowed = await authorize(ref, ticket, 'executor.status'); if (!allowed.ok) return allowed;
      const row = allowed.value;
      if (row.state === 'checkpointing' && deps.clock() >= row.deadline) await write(row, { state: 'unknown', failure_code: 'artifact_outcome_unknown' });
      else if (['running', 'provisioning'].includes(row.state) && deps.clock() >= row.deadline) await fail('workspace_timeout');
      else if (row.state === 'running' && !active) await fail('workspace_interrupted', 'unknown');
      else if (row.state === 'running') await deps.container?.setInactivityTimeout(Math.min(60000, Math.max(1, row.deadline - deps.clock())));
      return { ok: true, value: status((await read())!) };
    },
    async terminate(ref: ExecutionRef, ticket: string): Promise<WorkspaceResult<ExecutionStatus>> {
      const allowed = await authorize(ref, ticket, 'executor.cancel'); if (!allowed.ok) return allowed;
      const row = allowed.value;
      if (['finished', 'failed', 'cancelled'].includes(row.state)) return { ok: true, value: status(row) };
      if (!await write(row, { state: 'cancelling' })) return no('workspace_state_changed');
      const cleaned = await stop(), current = await read();
      if (current) await write(current, { state: cleaned ? 'cancelled' : 'unknown', cleaned, ...(cleaned ? {} : { failure_code: 'cleanup_unconfirmed' }) });
      await deps.store.alarm(cleaned ? null : deps.clock() + 30000);
      return { ok: true, value: status((await read())!) };
    },
    async collect(ref: ExecutionRef, ticket: string): Promise<WorkspaceResult<ExecutionArtifacts>> {
      const allowed = await authorize(ref, ticket, 'executor.collect'); if (!allowed.ok) return allowed;
      return allowed.value.state === 'finished' && allowed.value.artifacts ? { ok: true, value: allowed.value.artifacts } : no('workspace_artifacts_unavailable');
    },
    async cleanup(ref: ExecutionRef, ticket: string): Promise<WorkspaceResult<{ cleaned: boolean }>> {
      const allowed = await authorize(ref, ticket, 'executor.cleanup'); if (!allowed.ok) return allowed;
      if (allowed.value.cleaned) return { ok: true, value: { cleaned: true } };
      if (['running', 'provisioning', 'checkpointing'].includes(allowed.value.state)) return no('workspace_cleanup_requires_stop');
      const cleaned = await stop(), row = await read(); if (row) await write(row, { cleaned });
      await deps.store.alarm(cleaned ? null : deps.clock() + 30000);
      return cleaned ? { ok: true, value: { cleaned } } : no('cleanup_unconfirmed', 503);
    },
    /** Trusted DO alarm, available even after admission is disabled or the original sponsor is revoked. */
    async expire(): Promise<void> {
      const row = await read();
      if (!row || deps.clock() < row.deadline) return;
      if (row.state === 'checkpointing') await write(row, { state: 'unknown', failure_code: 'artifact_outcome_unknown' });
      else if (!row.cleaned) await fail('workspace_timeout');
    },
  };
}
