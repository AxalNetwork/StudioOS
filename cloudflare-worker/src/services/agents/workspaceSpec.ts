/** D5565: versioned, broker-created workspace and executor contracts; unmounted and independent of task/usage stores. */
import { z } from 'zod';
import { LIMITS, safeName, WORKLOADS } from './compute';

export const WORKSPACE_VERSION = 1 as const;
export const PROVIDERS = ['cloudflare', 'azure', 'gcp', 'aws', 'byoc'] as const;
export const WORKSPACE_STATES = ['queued', 'provisioning', 'running', 'checkpointing', 'finished', 'failed', 'cancelling', 'cancelled', 'unknown'] as const;
export type WorkspaceState = typeof WORKSPACE_STATES[number];
export type Provider = typeof PROVIDERS[number];
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const uid = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/);
const region = z.string().regex(/^[a-z][a-z0-9-]{1,31}$/);
const unique = <T>(values: T[]) => new Set(values).size === values.length;
export const workspaceReference = (value: unknown): value is string => uid.safeParse(value).success;

export function workspacePath(value: string): boolean {
  if (!value || value.length > 512 || value.includes('\\') || value.includes('%') || value.includes(':')) return false;
  const parts = value.split('/');
  return parts.length <= 24 && parts.every(part => part !== '.git' && part !== '.' && part !== '..'
    && (part.startsWith('.') ? safeName('x' + part) : safeName(part)));
}

export const networkPolicySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('deny') }).strict(),
  z.object({ mode: z.literal('allowlist'), destinations: z.array(z.object({
    hostname: z.string().min(3).max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/),
    port: z.literal(443),
  }).strict()).min(1).max(32) }).strict(),
]);

export const workspaceSpecSchema = z.object({
  version: z.literal(WORKSPACE_VERSION),
  tenant_id: id, company_id: id, project_id: id.nullable(), agent_id: id, task_id: id,
  run_id: uid, attempt: id.max(100), execution_generation: id,
  idempotency_key: uid,
  image_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  repo_id: id, base_sha: z.string().regex(/^[a-f0-9]{40}$/),
  scope_paths: z.array(z.string().refine(workspacePath, 'Invalid workspace scope path')).min(1).max(64).refine(unique),
  cpu: z.number().finite().min(0.0625).max(32),
  memory_mb: id.min(128).max(262144), disk_mb: id.min(64).max(1048576), max_duration_s: id.max(21600),
  network_policy: networkPolicySchema,
  allowed_regions: z.array(region).min(1).max(32).refine(unique),
  allowed_providers: z.array(z.enum(PROVIDERS)).min(1).max(PROVIDERS.length).refine(unique),
  workload_class: z.enum([...WORKLOADS, 'coding_trusted', 'coding_untrusted']),
  checkpoint_manifest_ref: uid.nullable(), artifact_sink_ref: uid,
  max_cost_microusd: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict().superRefine((spec, ctx) => {
  if (spec.workload_class in LIMITS) {
    const limits = LIMITS[spec.workload_class as typeof WORKLOADS[number]];
    if (spec.max_duration_s * 1000 > limits.wall_ms || spec.memory_mb > limits.memory_mb || spec.disk_mb > limits.disk_mb) {
      ctx.addIssue({ code: 'custom', message: 'Existing deterministic workload ceilings remain in force' });
    }
  }
});
export type WorkspaceSpec = z.infer<typeof workspaceSpecSchema>;

export type WorkspaceRefusal = { ok: false; status: 403 | 409 | 422 | 503; code: string; message: string; capability?: string };
export type WorkspaceResult<T> = { ok: true; value: T } | WorkspaceRefusal;
export const workspaceRefusal = (code: string, status: WorkspaceRefusal['status'] = 409, capability?: string): WorkspaceRefusal => ({
  ok: false, status, code, message: 'This workspace operation is not permitted by its current execution contract.', ...(capability ? { capability } : {}),
});

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

/** All spec fields come from the authorized broker. A browser/runner may override none of them. */
export function trustedWorkspaceSpec(server: unknown, client: unknown = {}): WorkspaceResult<WorkspaceSpec> {
  if (!client || typeof client !== 'object' || Array.isArray(client) || Object.keys(client).length) return workspaceRefusal('untrusted_workspace_override', 403);
  const parsed = workspaceSpecSchema.safeParse(server);
  return parsed.success ? { ok: true, value: freeze(parsed.data) } : workspaceRefusal('invalid_workspace_spec', 422);
}

export type ExecutorCapabilities = {
  provider: Provider; revision: string; workload_classes: WorkspaceSpec['workload_class'][];
  digest_pulls: boolean; shell: boolean; untrusted_code: boolean;
  cpu_max: number; memory_mb_max: number; disk_mb_max: number; duration_s_max: number;
  enforced_network_modes: WorkspaceSpec['network_policy']['mode'][]; enforced_regions: string[];
  gpu: boolean; interrupt: boolean; checkpoint_restore: boolean; concurrency_max: number | null;
};

/** Unknown containment/capacity is a refusal, never a silent downgrade. */
export function executorEligibility(spec: WorkspaceSpec, caps: ExecutorCapabilities): WorkspaceResult<{ region: string }> {
  if (!workspaceSpecSchema.safeParse(spec).success) return workspaceRefusal('invalid_workspace_spec', 422);
  const denied = (capability: string) => workspaceRefusal('capability_denied', 422, capability);
  if (!caps || !PROVIDERS.includes(caps.provider) || !Array.isArray(caps.workload_classes)
    || !Array.isArray(caps.enforced_network_modes) || !Array.isArray(caps.enforced_regions)) return denied('capabilities_unverified');
  if (!spec.allowed_providers.includes(caps.provider)) return denied('provider');
  if (caps.digest_pulls !== true) return denied('image_digest');
  if (caps.interrupt !== true) return denied('cancel');
  if (!caps.workload_classes?.includes(spec.workload_class)) return denied('workload_class');
  if (spec.workload_class.startsWith('coding') && caps.shell !== true) return denied('shell');
  if (spec.workload_class === 'coding_untrusted' && caps.untrusted_code !== true) return denied('hostile_code_isolation');
  for (const [need, maximum, name] of [[spec.cpu, caps.cpu_max, 'cpu'], [spec.memory_mb, caps.memory_mb_max, 'memory'],
    [spec.disk_mb, caps.disk_mb_max, 'disk'], [spec.max_duration_s, caps.duration_s_max, 'duration']] as const) {
    if (!Number.isFinite(maximum) || maximum < need) return denied(name);
  }
  if (!Number.isSafeInteger(caps.concurrency_max) || (caps.concurrency_max ?? 0) < 1) return denied('capacity_unverified');
  if (!caps.enforced_network_modes?.includes(spec.network_policy.mode)) return denied('network_policy');
  const location = spec.allowed_regions.find(value => caps.enforced_regions?.includes(value));
  if (!location) return denied('region');
  if (spec.checkpoint_manifest_ref && caps.checkpoint_restore !== true) return denied('checkpoint_restore');
  return { ok: true, value: { region: location } };
}

export type ExecutionRef = { provider: Provider; execution_id: string; tenant_id: number; run_id: string; attempt: number; execution_generation: number; region: string };
export type ExecutionStatus = { ref: ExecutionRef; state: WorkspaceState; failure_code?: string };
export type ExecutionArtifacts = { manifest_ref: string | null; checkpoint_manifest_ref: string | null };
export interface ExecutorAdapter {
  capabilities(): Promise<ExecutorCapabilities>;
  estimate(spec: WorkspaceSpec): Promise<WorkspaceResult<{ cost_microusd: number; measured: boolean }>>;
  create(spec: WorkspaceSpec): Promise<WorkspaceResult<ExecutionStatus>>;
  get(ref: ExecutionRef): Promise<WorkspaceResult<ExecutionStatus>>;
  terminate(ref: ExecutionRef): Promise<WorkspaceResult<ExecutionStatus>>;
  collect(ref: ExecutionRef): Promise<WorkspaceResult<ExecutionArtifacts>>;
  cleanup(ref: ExecutionRef): Promise<WorkspaceResult<{ cleaned: boolean }>>;
}

const transitions: Record<WorkspaceState, readonly WorkspaceState[]> = {
  queued: ['provisioning', 'failed', 'cancelling'], provisioning: ['running', 'failed', 'cancelling', 'unknown'],
  running: ['checkpointing', 'finished', 'failed', 'cancelling', 'unknown'],
  checkpointing: ['running', 'finished', 'failed', 'cancelling', 'unknown'],
  cancelling: ['cancelled', 'unknown'], unknown: ['provisioning', 'running', 'finished', 'failed', 'cancelling', 'cancelled'],
  finished: [], failed: [], cancelled: [],
};
export function executionTransition(from: WorkspaceState, to: WorkspaceState): boolean {
  return from === to || Boolean(transitions[from]?.includes(to));
}

export function sameExecution(a: ExecutionRef, b: ExecutionRef): boolean {
  return a.provider === b.provider && a.execution_id === b.execution_id && a.tenant_id === b.tenant_id && a.run_id === b.run_id
    && a.attempt === b.attempt && a.execution_generation === b.execution_generation && a.region === b.region;
}
