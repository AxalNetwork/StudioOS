/** D5572 (#5572): disabled, unmounted control protocol for a customer-owned outbound-only `axal-runner`: enrollment, signed requests, D5565-fenced leases and the capability, egress, residency and consent decisions. */
import { z } from 'zod';
import { WORKLOADS } from './compute';
import { createRunnerControl, type RunnerIdentity, type RunnerStore } from './runnerProtocol';
import { workspaceDestination, type WorkspaceObject, type WorkspaceProviderEvidence } from './workspaceSecurity';
import { executorEligibility, trustedWorkspaceSpec, workspaceReference, workspaceRefusal,
  type ExecutorCapabilities, type Provider, type WorkspaceResult, type WorkspaceSpec } from './workspaceSpec';

// ── Enforcement the runner must attest ─────────────────────────────────────
/** Every workload, trusted or not. Missing any one refuses placement. */
export const BASE_ENFORCEMENT = ['image_signature_verification', 'digest_pinned_pulls', 'namespace_per_run', 'resource_quotas',
  'run_as_non_root', 'drop_all_capabilities', 'seccomp_runtime_default', 'no_privilege_escalation', 'deny_privileged',
  'deny_host_path', 'deny_host_network', 'deny_host_pid_ipc', 'deny_container_runtime_socket', 'deny_cloud_metadata',
  'network_policy_default_deny', 'ephemeral_scratch', 'active_deadline', 'cleanup_on_terminal'] as const;
/** Additionally required before untrusted code runs: a read-only root filesystem and a sandboxed runtime class. */
export const UNTRUSTED_ENFORCEMENT = ['read_only_root_filesystem', 'sandboxed_runtime'] as const;
/** Required only when the spec asks for them: an FQDN egress allowlist, a local encrypted checkpoint cache. */
export const OPTIONAL_ENFORCEMENT = ['egress_allowlist_enforced', 'encrypted_local_checkpoint'] as const;
export const ENFORCEMENT_FEATURES = [...BASE_ENFORCEMENT, ...UNTRUSTED_ENFORCEMENT, ...OPTIONAL_ENFORCEMENT] as const;
export type EnforcementFeature = typeof ENFORCEMENT_FEATURES[number];
export const RUNTIME_CLASSES = ['gvisor', 'kata', 'runc', 'unknown'] as const;

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const region = z.string().regex(/^[a-z][a-z0-9-]{1,31}$/);
const hostname = z.string().min(3).max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/);
const unique = <T>(values: T[]) => new Set(values).size === values.length;
const b64url = /^[A-Za-z0-9_-]+$/;
export const ventureScopeSchema = z.object({ tenant_id: positive, company_id: positive,
  project_ids: z.array(positive).min(1).max(256).refine(unique).nullable() }).strict();
export const clusterBindingSchema = z.object({ cluster_id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,62}$/), region,
  namespace_prefix: z.string().regex(/^[a-z](?:[a-z0-9-]{0,18}[a-z0-9])?$/) }).strict();
export const delegatedLimitsSchema = z.object({
  workload_classes: z.array(z.enum([...WORKLOADS, 'coding_trusted', 'coding_untrusted'])).min(1).max(8).refine(unique),
  max_concurrent: z.number().int().min(1).max(1000), cpu_max: z.number().finite().min(0.0625).max(256),
  memory_mb_max: positive.max(1048576), disk_mb_max: positive.max(4194304), duration_s_max: positive.max(21600),
  egress_hosts: z.array(hostname).max(64).refine(unique), checkpoint_restore: z.boolean(), shell: z.boolean(),
}).strict();
export const enforcementManifestSchema = z.object({ features: z.array(z.enum(ENFORCEMENT_FEATURES)).max(64).refine(unique),
  runtime_class: z.enum(RUNTIME_CLASSES), runner_version: z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,6}$/) }).strict();
const jwkSchema = z.object({ kty: z.literal('EC'), crv: z.literal('P-256'), x: z.string().regex(b64url).length(43), y: z.string().regex(b64url).length(43) }).strict();
export type VentureScope = z.infer<typeof ventureScopeSchema>;
export type ClusterBinding = z.infer<typeof clusterBindingSchema>;
export type DelegatedLimits = z.infer<typeof delegatedLimitsSchema>;
export type EnforcementManifest = z.infer<typeof enforcementManifestSchema>;
export type RunnerPublicKey = z.infer<typeof jwkSchema>;

// ── Records (persistence is the host's; see D5572 "Storage") ───────────────
type Registration = { id: string; code_hash: string; venture: VentureScope; cluster: ClusterBinding; limits: DelegatedLimits;
  created_by: number; expires_at: number; used: boolean };
type Credential = { key_id: string; jwk: RunnerPublicKey; issued_at: number; expires_at: number };
export type EnrolledRunner = { runner_id: string; venture: VentureScope; cluster: ClusterBinding; limits: DelegatedLimits;
  manifest: EnforcementManifest; status: 'pending_attestation' | 'active' | 'revoked'; credential: Credential | null;
  retired_keys: string[]; attested_by: number | null; conformance_at: number | null; last_seen: number;
  nonces: Record<string, number>; active_runs: string[] };
/** cleanup_generation is the generation a host cleanup must be acknowledged under; null while the lease is live. */
type Assignment = { run_id: string; runner_id: string; generation: number; lease_id: string | null; cleanup_generation: number | null };
export type ByocState = { registrations: Map<string, Registration>; runners: Map<string, EnrolledRunner>; assignments: Map<string, Assignment> };
/** One atomic transaction over the scope's records. The host backs it with DO storage; the memory store is test-only. */
export interface ByocStore { transaction<T>(change: (state: ByocState) => T): Promise<T> }

export type ByocActor = { member_id: number; kind: 'customer_admin' | 'axal_operator' };
export type ByocAction = 'register' | 'attest' | 'revoke' | 'kill' | 'confirm_cleanup';
export type ByocPolicy = { registration_ttl_ms: number; credential_ttl_ms: number; clock_skew_ms: number; offline_after_ms: number;
  conformance_max_age_ms: number; heartbeat_ms: number; missed_beat_limit: number; max_generations: number };
export type ByocAudit = { action: string; outcome: 'accepted' | 'refused'; code?: string; count?: number };
export type ByocDeps = {
  /** Off unless an owner-authorized flag says otherwise. Revoke, kill and cleanup stay available when off. */
  enabled(): boolean; clock(): number; nonce(): string; policy: ByocPolicy;
  store: ByocStore; runStore: RunnerStore;
  /** Existing role checks: a customer admin of the venture, or an Axal operator for revoke/kill. */
  authorize(actor: ByocActor, venture: VentureScope, action: ByocAction): Promise<boolean>;
  /** The broker's own spec for a run (D5565); never the runner's copy. */
  specOf(runId: string): Promise<WorkspaceSpec | null>;
  /** The member's recorded consent for this run's execution, if any. */
  consentOf(spec: WorkspaceSpec): Promise<ExecutionConsent | null>;
  manifestAllowed(spec: WorkspaceSpec, manifestRef: string): boolean;
  /** D5567 `revoke(runId)`: clears every outstanding grant for the run. */
  revokeGrants(runId: string): Promise<void>;
  /** Counts and outcomes only: no ids, keys, hostnames or payloads. */
  audit(event: ByocAudit): Promise<void>;
};

// ── Wire format ─────────────────────────────────────────────────────────────
export const REQUEST_KINDS = ['enroll', 'rotate', 'lease', 'report', 'complete', 'reconcile', 'cleanup'] as const;
export type RequestKind = typeof REQUEST_KINDS[number];
export type RunnerRequest = { v: 1; runner_id: string; key_id: string; iat: number; nonce: string; kind: RequestKind; body: unknown };
export type RunnerEnvelope = { payload: string; signature: string };
const envelopeSchema = z.object({ payload: z.string().min(1).max(32768).regex(b64url), signature: z.string().min(1).max(200).regex(b64url) }).strict();
const requestSchema = z.object({ v: z.literal(1), runner_id: z.string().refine(workspaceReference), key_id: z.string().regex(/^[a-f0-9]{64}$/),
  iat: z.number().int().nonnegative(), nonce: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/), kind: z.enum(REQUEST_KINDS), body: z.unknown() }).strict();
const runRef = { run_id: z.string().refine(workspaceReference), execution_generation: positive };
const bodies = {
  enroll: z.object({ code: z.string().regex(b64url).min(32).max(64), jwk: jwkSchema, manifest: enforcementManifestSchema }).strict(),
  rotate: z.object({ jwk: jwkSchema, proof: z.string().regex(b64url).max(200) }).strict(),
  lease: z.object({ ...runRef, request_nonce: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/) }).strict(),
  report: z.object({ ...runRef, lease_id: z.string().max(120), sequence: positive, state: z.enum(['running', 'checkpointing']),
    namespace: z.string().max(63) }).strict(),
  complete: z.object({ ...runRef, lease_id: z.string().max(120), manifest_ref: z.string().max(120) }).strict(),
  reconcile: z.object({ runs: z.array(z.object(runRef).strict()).max(256) }).strict(),
  cleanup: z.object(runRef).strict(),
};
const encoder = new TextEncoder();
const SIGNING_CONTEXT = 'axal-runner-v1.';
function b64(value: Uint8Array): string {
  let raw = '';
  for (let offset = 0; offset < value.length; offset += 16384) raw += String.fromCharCode(...value.subarray(offset, offset + 16384));
  return btoa(raw).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function unb64(value: string): Uint8Array {
  const raw = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4));
  const decoded = Uint8Array.from(raw, ch => ch.charCodeAt(0));
  if (b64(decoded) !== value) throw new Error('Noncanonical encoding');
  return decoded;
}
const sha256 = async (value: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))]
  .map(x => x.toString(16).padStart(2, '0')).join('');
const ecdsa = { name: 'ECDSA', hash: 'SHA-256' } as const;

/** RFC 7638 thumbprint: the runner's key id. Only the public point is ever held by the Worker. */
export async function jwkThumbprint(jwk: RunnerPublicKey): Promise<string> {
  return sha256(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }));
}
/** Reference signer for the runner side (and the tests). The private key never leaves the cluster. */
export async function signRunnerRequest(privateKey: CryptoKey, request: RunnerRequest): Promise<RunnerEnvelope> {
  const payload = b64(encoder.encode(JSON.stringify(request)));
  const signature = new Uint8Array(await crypto.subtle.sign(ecdsa, privateKey, encoder.encode(SIGNING_CONTEXT + payload)));
  return { payload, signature: b64(signature) };
}
const rotationMessage = (runnerId: string, oldKeyId: string, newKeyId: string) => `axal-runner-rotate-v1.${runnerId}.${oldKeyId}.${newKeyId}`;
/** Proof that the runner holds the new private key, signed by that key. */
export async function signRotationProof(newPrivateKey: CryptoKey, runnerId: string, oldKeyId: string, newKeyId: string): Promise<string> {
  return b64(new Uint8Array(await crypto.subtle.sign(ecdsa, newPrivateKey, encoder.encode(rotationMessage(runnerId, oldKeyId, newKeyId)))));
}
async function verifySignature(jwk: RunnerPublicKey, signature: string, message: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('jwk', { ...jwk, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await crypto.subtle.verify(ecdsa, key, unb64(signature), encoder.encode(message));
  } catch { return false; }
}
function decodeRequest(envelope: unknown, kind: RequestKind): { request: RunnerRequest; envelope: RunnerEnvelope } | null {
  try {
    const outer = envelopeSchema.safeParse(envelope); if (!outer.success) return null;
    const parsed = requestSchema.safeParse(JSON.parse(new TextDecoder().decode(unb64(outer.data.payload))));
    if (!parsed.success || parsed.data.kind !== kind) return null;
    return { request: parsed.data as RunnerRequest, envelope: outer.data };
  } catch { return null; }
}

// ── Pure decisions ──────────────────────────────────────────────────────────
const has = (manifest: EnforcementManifest, feature: EnforcementFeature) => manifest.features.includes(feature);
const sandboxed = (manifest: EnforcementManifest) => manifest.runtime_class === 'gvisor' || manifest.runtime_class === 'kata';
const conformanceFresh = (runner: Pick<EnrolledRunner, 'conformance_at'>, now: number, maxAge: number) =>
  runner.conformance_at !== null && now >= runner.conformance_at && now - runner.conformance_at < maxAge;

/** Every enforcement feature this spec needs that the runner has not attested. Empty means none missing. */
export function enforcementGaps(runner: Pick<EnrolledRunner, 'manifest' | 'conformance_at'>, spec: WorkspaceSpec, now: number, conformanceMaxAgeMs: number): string[] {
  const required: EnforcementFeature[] = [...BASE_ENFORCEMENT];
  const untrusted = spec.workload_class === 'coding_untrusted';
  if (untrusted) required.push(...UNTRUSTED_ENFORCEMENT);
  if (spec.network_policy.mode === 'allowlist') required.push('egress_allowlist_enforced');
  const gaps: string[] = required.filter(feature => !has(runner.manifest, feature));
  if (untrusted && !sandboxed(runner.manifest)) gaps.push('sandboxed_runtime_class');
  if (untrusted && !conformanceFresh(runner, now, conformanceMaxAgeMs)) gaps.push('conformance_unverified');
  return gaps;
}

/** The runner's attested limits as D5565 executor capabilities, so `executorEligibility` decides the rest. */
export function byocCapabilities(runner: Pick<EnrolledRunner, 'cluster' | 'limits' | 'manifest' | 'conformance_at'>, now: number, conformanceMaxAgeMs: number): ExecutorCapabilities {
  const m = runner.manifest, l = runner.limits;
  return { provider: 'byoc', revision: `runner-${m.runner_version}`, workload_classes: [...l.workload_classes],
    digest_pulls: has(m, 'digest_pinned_pulls') && has(m, 'image_signature_verification'), shell: l.shell,
    untrusted_code: UNTRUSTED_ENFORCEMENT.every(feature => has(m, feature)) && sandboxed(m) && conformanceFresh(runner, now, conformanceMaxAgeMs),
    cpu_max: l.cpu_max, memory_mb_max: l.memory_mb_max, disk_mb_max: l.disk_mb_max, duration_s_max: l.duration_s_max,
    enforced_network_modes: has(m, 'network_policy_default_deny') ? (has(m, 'egress_allowlist_enforced') ? ['deny', 'allowlist'] : ['deny']) : [],
    enforced_regions: [runner.cluster.region], gpu: false, interrupt: true, checkpoint_restore: l.checkpoint_restore, concurrency_max: l.max_concurrent };
}

/** The same runner as D5567 provider evidence, for `createWorkspaceSecurity`'s eligibility gate. */
export function byocProviderEvidence(runner: Pick<EnrolledRunner, 'cluster' | 'limits' | 'manifest' | 'conformance_at'>, now: number, conformanceMaxAgeMs: number): WorkspaceProviderEvidence {
  const m = runner.manifest;
  return { capabilities: byocCapabilities(runner, now, conformanceMaxAgeMs), non_root: has(m, 'run_as_non_root'),
    no_new_privileges: has(m, 'no_privilege_escalation'), immutable_image: has(m, 'digest_pinned_pulls') && has(m, 'image_signature_verification'),
    ephemeral_scratch: has(m, 'ephemeral_scratch'), resource_limits: has(m, 'resource_quotas'),
    host_socket: !has(m, 'deny_container_runtime_socket'), privileged: !has(m, 'deny_privileged'),
    isolation: m.runtime_class === 'gvisor' ? 'gvisor' : m.runtime_class === 'kata' ? 'microvm' : m.runtime_class === 'runc' ? 'container' : 'unknown',
    network_connect_fence: has(m, 'network_policy_default_deny'), metadata_denied: has(m, 'deny_cloud_metadata') };
}

/** An allowlisted destination must pass D5567's preflight and be one the customer's delegated policy permits. */
export function egressDecision(spec: WorkspaceSpec, limits: DelegatedLimits): WorkspaceResult<true> {
  if (spec.network_policy.mode === 'deny') return { ok: true, value: true };
  for (const destination of spec.network_policy.destinations) {
    if (!workspaceDestination(spec, `https://${destination.hostname}/`)) return workspaceRefusal('egress_forbidden', 422, 'destination');
    if (!limits.egress_hosts.includes(destination.hostname)) return workspaceRefusal('egress_forbidden', 422, 'customer_policy');
  }
  return { ok: true, value: true };
}

export function inVenture(venture: VentureScope, spec: Pick<WorkspaceSpec, 'tenant_id' | 'company_id' | 'project_id'>): boolean {
  if (venture.tenant_id !== spec.tenant_id || venture.company_id !== spec.company_id) return false;
  return venture.project_ids === null || (spec.project_id !== null && venture.project_ids.includes(spec.project_id));
}

/** The one namespace a run may occupy on its cluster. A report naming any other is an escalation. */
export async function runNamespace(cluster: ClusterBinding, spec: Pick<WorkspaceSpec, 'tenant_id' | 'company_id' | 'project_id' | 'run_id'>): Promise<string> {
  const digest = await sha256(JSON.stringify(['axal-runner-ns-v1', spec.tenant_id, spec.company_id, spec.project_id, spec.run_id]));
  return `${cluster.namespace_prefix}-${spec.tenant_id}-${digest.slice(0, 16)}`;
}

// ── Consent ─────────────────────────────────────────────────────────────────
export const CONSENT_VERSION = 1 as const;
export type ExecutionMode = 'axal_managed' | 'customer_managed';
export const EXECUTION_MODE_LABEL: Record<ExecutionMode, string> = { axal_managed: 'Axal-managed execution', customer_managed: 'Customer-managed execution' };
export type ExecutionPlacement = { mode: ExecutionMode; tenant_id: number; company_id: number; cluster_id: string | null; region: string };
export type ExecutionConsent = ExecutionPlacement & { version: number; member_id: number; statement: string };
/** The exact words a member agrees to. The two modes never share a sentence about who runs the machine. */
export function consentStatement(placement: Pick<ExecutionPlacement, 'mode' | 'cluster_id' | 'region'>): string {
  if (placement.mode === 'axal_managed') return `${EXECUTION_MODE_LABEL.axal_managed}. Axal runs this task in a disposable workspace on infrastructure Axal operates, in region ${placement.region}. Axal is responsible for the workspace's isolation, network rules, logs and clean-up.`;
  return `${EXECUTION_MODE_LABEL.customer_managed}. This task runs on cluster ${placement.cluster_id ?? 'unnamed'} in region ${placement.region}, which your organization operates. Your organization is responsible for that cluster's isolation, network, logs, data retention and compute cost. Axal keeps the task record and sends work only over a connection your runner opens; Axal stops work there only by telling the runner to stop.`;
}
/** Consent covers a placement only for the same mode, scope, cluster, region and the current wording. */
export function consentCovers(consent: ExecutionConsent | null, placement: ExecutionPlacement): boolean {
  if (!consent || consent.version !== CONSENT_VERSION || !Number.isSafeInteger(consent.member_id) || consent.member_id < 1) return false;
  if (consent.mode !== placement.mode || consent.tenant_id !== placement.tenant_id || consent.company_id !== placement.company_id
    || consent.cluster_id !== placement.cluster_id || consent.region !== placement.region) return false;
  if (placement.mode === 'customer_managed' && !placement.cluster_id) return false;
  if (placement.mode === 'axal_managed' && placement.cluster_id !== null) return false;
  return consent.statement === consentStatement(placement);
}

// ── Residency on resume ─────────────────────────────────────────────────────
export type CheckpointRef = Pick<WorkspaceObject, 'ref' | 'tenant_id' | 'run_id' | 'region' | 'approved_restore_regions' | 'key_id'> & { sealed: boolean };
export type ResumeTarget = { mode: ExecutionMode; provider: Provider; region: string; cluster_id: string | null };
export type TransferPolicy = { cross_border_allowed: boolean; jurisdictionOf(region: string): string | null };
/** Resume only where the spec, the checkpoint's approval and the data policy all allow it, and never from a plaintext checkpoint. */
export function resumeDecision(spec: WorkspaceSpec, checkpoint: CheckpointRef, target: ResumeTarget, transfer: TransferPolicy): WorkspaceResult<{ transfer: 'none' | 'in_jurisdiction' | 'cross_border' }> {
  const refuse = (code: string, status: 403 | 409 | 422 = 403) => workspaceRefusal(code, status);
  if (checkpoint.tenant_id !== spec.tenant_id || checkpoint.run_id !== spec.run_id || spec.checkpoint_manifest_ref !== checkpoint.ref) return refuse('checkpoint_not_authorized');
  if (checkpoint.sealed !== true || !workspaceReference(checkpoint.key_id)) return refuse('plaintext_checkpoint', 422);
  if ((target.provider === 'byoc') !== (target.mode === 'customer_managed') || (target.mode === 'customer_managed') !== Boolean(target.cluster_id)) return refuse('execution_mode_mismatch', 422);
  if (!spec.allowed_providers.includes(target.provider) || !spec.allowed_regions.includes(target.region)) return refuse('region_not_allowed');
  if (target.region === checkpoint.region) return { ok: true, value: { transfer: 'none' } };
  if (!Array.isArray(checkpoint.approved_restore_regions) || !checkpoint.approved_restore_regions.includes(target.region)) return refuse('restore_region_not_approved');
  const from = transfer.jurisdictionOf(checkpoint.region), to = transfer.jurisdictionOf(target.region);
  if (!from || !to) return refuse('jurisdiction_unknown');
  if (from === to) return { ok: true, value: { transfer: 'in_jurisdiction' } };
  return transfer.cross_border_allowed === true ? { ok: true, value: { transfer: 'cross_border' } } : refuse('cross_border_denied');
}

// ── Placement ───────────────────────────────────────────────────────────────
/** Whether this run may be placed on this runner now. Fail-closed in a fixed order; the first refusal wins. */
export function placementDecision(spec: WorkspaceSpec, runner: EnrolledRunner, consent: ExecutionConsent | null, now: number, policy: Pick<ByocPolicy, 'offline_after_ms' | 'conformance_max_age_ms'>): WorkspaceResult<{ region: string }> {
  if (runner.status === 'revoked') return workspaceRefusal('runner_revoked', 403);
  if (runner.status !== 'active') return workspaceRefusal('runner_unattested', 403);
  if (now - runner.last_seen >= policy.offline_after_ms) return workspaceRefusal('cluster_offline', 503);
  if (!inVenture(runner.venture, spec)) return workspaceRefusal('venture_scope_denied', 403);
  const gaps = enforcementGaps(runner, spec, now, policy.conformance_max_age_ms);
  if (gaps.length) return workspaceRefusal('enforcement_missing', 422, gaps[0]);
  const egress = egressDecision(spec, runner.limits); if (!egress.ok) return egress;
  const eligible = executorEligibility(spec, byocCapabilities(runner, now, policy.conformance_max_age_ms)); if (!eligible.ok) return eligible;
  if (runner.active_runs.length >= runner.limits.max_concurrent) return workspaceRefusal('scheduling_limit', 503);
  if (!consentCovers(consent, { mode: 'customer_managed', tenant_id: spec.tenant_id, company_id: spec.company_id, cluster_id: runner.cluster.cluster_id, region: runner.cluster.region })) return workspaceRefusal('consent_missing', 403);
  return eligible;
}

export type Directive = { run_id: string; execution_generation: number; action: 'continue' | 'stop' };

// ── The control plane ───────────────────────────────────────────────────────
export function createByocRunnerControl(deps: ByocDeps) {
  const p = deps.policy;
  const within = (value: number, min: number, max: number) => Number.isSafeInteger(value) && value >= min && value <= max;
  if (!within(p.registration_ttl_ms, 60_000, 3_600_000) || !within(p.credential_ttl_ms, 300_000, 86_400_000) || !within(p.clock_skew_ms, 1000, 120_000)
    || !within(p.offline_after_ms, 10_000, 600_000) || !within(p.conformance_max_age_ms, 3_600_000, 30 * 86_400_000)) throw new Error('Invalid runner policy');
  const refuse = workspaceRefusal;
  const now = () => { const at = deps.clock(); if (!Number.isSafeInteger(at) || at < 0) throw new Error('Invalid injected clock'); return at; };
  /** D5565's lease protocol, reused. Its authorize hook admits only a call this module has just verified. */
  const permits = new Map<string, number>();
  const permitKey = (runnerId: string, runId: string) => `${runnerId}\n${runId}`;
  const runs = createRunnerControl({ store: deps.runStore, clock: deps.clock, policy: {
    heartbeat_ms: p.heartbeat_ms, missed_beat_limit: p.missed_beat_limit, max_generations: p.max_generations, nonce: deps.nonce,
    authorize: (identity: RunnerIdentity, spec: WorkspaceSpec) => (permits.get(permitKey(identity.runner_id, spec.run_id)) ?? 0) > 0,
    manifestAllowed: deps.manifestAllowed } });
  async function permitted<T>(runnerId: string, runId: string, call: () => Promise<T>): Promise<T> {
    const key = permitKey(runnerId, runId);
    permits.set(key, (permits.get(key) ?? 0) + 1);
    try { return await call(); } finally { const left = (permits.get(key) ?? 1) - 1; if (left > 0) permits.set(key, left); else permits.delete(key); }
  }
  const identityFor = (spec: WorkspaceSpec, runnerId: string): RunnerIdentity => ({ tenant_id: spec.tenant_id, company_id: spec.company_id,
    project_id: spec.project_id, agent_id: spec.agent_id, task_id: spec.task_id, runner_id: runnerId });
  async function done<T>(action: string, result: WorkspaceResult<T>, count?: number): Promise<WorkspaceResult<T>> {
    await deps.audit({ action, outcome: result.ok ? 'accepted' : 'refused', ...(result.ok ? {} : { code: result.code }), ...(count === undefined ? {} : { count }) });
    return result;
  }
  const disabled = () => deps.enabled() !== true;

  /** Every runner call: a signed, fresh, never-seen request from a live, attested, unexpired, current key. */
  async function verify<K extends Exclude<RequestKind, 'enroll'>>(envelope: unknown, kind: K): Promise<WorkspaceResult<{ runner: EnrolledRunner; body: z.infer<typeof bodies[K]>; at: number }>> {
    const decoded = decodeRequest(envelope, kind);
    if (!decoded) return refuse('request_invalid', 403);
    const { request } = decoded, at = now();
    if (Math.abs(at - request.iat) > p.clock_skew_ms) return refuse('request_expired', 403);
    const check = (runner: EnrolledRunner | undefined): WorkspaceResult<EnrolledRunner> => {
      if (!runner) return refuse('runner_unknown', 403);
      if (runner.status === 'revoked') return refuse('runner_revoked', 403);
      if (runner.status !== 'active') return refuse('runner_unattested', 403);
      if (!runner.credential || runner.credential.key_id !== request.key_id) return refuse(runner.retired_keys.includes(request.key_id) ? 'credential_rotated' : 'credential_unknown', 403);
      if (at >= runner.credential.expires_at) return refuse('credential_expired', 403);
      return { ok: true, value: runner };
    };
    const known = await deps.store.transaction(state => { const r = check(state.runners.get(request.runner_id)); return r.ok ? { ok: true as const, value: structuredClone(r.value) } : r; });
    if (!known.ok) return known;
    if (!await verifySignature(known.value.credential!.jwk, decoded.envelope.signature, SIGNING_CONTEXT + decoded.envelope.payload)) return refuse('signature_invalid', 403);
    const body = bodies[kind].safeParse(request.body);
    if (!body.success) return refuse('request_invalid', 403);
    return deps.store.transaction(state => {
      const r = check(state.runners.get(request.runner_id)); if (!r.ok) return r;
      const runner = r.value;
      for (const [nonce, iat] of Object.entries(runner.nonces)) if (iat < at - 2 * p.clock_skew_ms) delete runner.nonces[nonce];
      if (request.nonce in runner.nonces) return refuse('request_replay', 403);
      if (Object.keys(runner.nonces).length >= 4096) return refuse('nonce_capacity', 503);
      runner.nonces[request.nonce] = request.iat; runner.last_seen = Math.max(runner.last_seen, at);
      return { ok: true, value: { runner: structuredClone(runner), body: body.data as z.infer<typeof bodies[K]>, at } };
    });
  }
  async function assignedTo(runner: EnrolledRunner, runId: string): Promise<Assignment | null> {
    return deps.store.transaction(state => { const a = state.assignments.get(runId); return a && a.runner_id === runner.runner_id ? structuredClone(a) : null; });
  }
  /** Fence one assignment through D5565 (generation bump), revoke its D5567 grants and record the cleanup generation. */
  async function fence(a: Assignment): Promise<boolean> {
    if (a.cleanup_generation !== null) return false;
    const cancelled = await runs.requestCancel(a.run_id, a.generation);
    if (!cancelled.ok) return false;
    await deps.store.transaction(state => { const row = state.assignments.get(a.run_id); if (row && row.generation === a.generation) { row.cleanup_generation = cancelled.value.execution_generation; row.lease_id = null; } });
    await deps.revokeGrants(a.run_id);
    return true;
  }
  async function release(runId: string, runnerId: string) {
    await deps.store.transaction(state => {
      state.assignments.delete(runId);
      const runner = state.runners.get(runnerId); if (runner) runner.active_runs = runner.active_runs.filter(id => id !== runId);
    });
  }

  return {
    /** The broker's D5565 run plane (register, reap), exposed to trusted Worker code only. */
    runs,

    /** A customer admin opens one registration: a one-time code, hashed at rest, bound to one venture, cluster and set of limits. */
    async createRegistration(actor: ByocActor, input: { venture: unknown; cluster: unknown; limits: unknown }): Promise<WorkspaceResult<{ registration_id: string; code: string; expires_at: number }>> {
      if (disabled()) return done('runner_registration', refuse('byoc_runner_disabled', 403));
      const venture = ventureScopeSchema.safeParse(input?.venture), cluster = clusterBindingSchema.safeParse(input?.cluster), limits = delegatedLimitsSchema.safeParse(input?.limits);
      if (!venture.success || !cluster.success || !limits.success) return done('runner_registration', refuse('registration_invalid', 422));
      if (actor?.kind !== 'customer_admin' || !await deps.authorize(actor, venture.data, 'register')) return done('runner_registration', refuse('admin_not_authorized', 403));
      const id = `reg-${deps.nonce()}`;
      if (!workspaceReference(id)) return done('runner_registration', refuse('registration_nonce_invalid', 503));
      const code = b64(crypto.getRandomValues(new Uint8Array(32))), codeHash = await sha256(code), at = now();
      const result = await deps.store.transaction(state => {
        if (state.registrations.has(id) || state.runners.has(id)) return refuse('registration_nonce_invalid', 503);
        state.registrations.set(id, { id, code_hash: codeHash, venture: venture.data, cluster: cluster.data, limits: limits.data,
          created_by: actor.member_id, expires_at: at + p.registration_ttl_ms, used: false });
        return { ok: true as const, value: { registration_id: id, code, expires_at: at + p.registration_ttl_ms } };
      });
      return done('runner_registration', result);
    },

    /** The runner redeems the code once, proving it holds the key it registers. It stays unusable until attested. */
    async enroll(envelope: unknown): Promise<WorkspaceResult<{ runner_id: string; key_id: string; expires_at: number }>> {
      if (disabled()) return done('runner_enroll', refuse('byoc_runner_disabled', 403));
      const decoded = decodeRequest(envelope, 'enroll');
      const body = decoded ? bodies.enroll.safeParse(decoded.request.body) : null;
      if (!decoded || !body?.success) return done('runner_enroll', refuse('request_invalid', 403));
      const { request } = decoded, at = now();
      if (Math.abs(at - request.iat) > p.clock_skew_ms) return done('runner_enroll', refuse('request_expired', 403));
      const keyId = await jwkThumbprint(body.data.jwk);
      if (keyId !== request.key_id || !await verifySignature(body.data.jwk, decoded.envelope.signature, SIGNING_CONTEXT + decoded.envelope.payload)) return done('runner_enroll', refuse('signature_invalid', 403));
      const codeHash = await sha256(body.data.code);
      const result = await deps.store.transaction(state => {
        const reg = state.registrations.get(request.runner_id);
        if (!reg || reg.used || at >= reg.expires_at || state.runners.has(reg.id)) return refuse('registration_invalid', 403);
        reg.used = true;   // one attempt per code: a wrong code burns it
        if (reg.code_hash !== codeHash) return refuse('registration_invalid', 403);
        state.runners.set(reg.id, { runner_id: reg.id, venture: reg.venture, cluster: reg.cluster, limits: reg.limits, manifest: body.data.manifest,
          status: 'pending_attestation', credential: { key_id: keyId, jwk: body.data.jwk, issued_at: at, expires_at: at + p.credential_ttl_ms },
          retired_keys: [], attested_by: null, conformance_at: null, last_seen: at, nonces: { [request.nonce]: request.iat }, active_runs: [] });
        return { ok: true as const, value: { runner_id: reg.id, key_id: keyId, expires_at: at + p.credential_ttl_ms } };
      });
      return done('runner_enroll', result);
    },

    /** A customer admin confirms the key and the enforcement manifest the runner presented. Both must match exactly. */
    async attest(actor: ByocActor, runnerId: string, claim: { key_id: string; manifest: unknown }): Promise<WorkspaceResult<true>> {
      if (disabled()) return done('runner_attest', refuse('byoc_runner_disabled', 403));
      const manifest = enforcementManifestSchema.safeParse(claim?.manifest);
      const runner = await deps.store.transaction(state => structuredClone(state.runners.get(runnerId) ?? null));
      if (!runner || runner.status !== 'pending_attestation') return done('runner_attest', refuse('runner_not_attestable', 409));
      if (actor?.kind !== 'customer_admin' || !await deps.authorize(actor, runner.venture, 'attest')) return done('runner_attest', refuse('admin_not_authorized', 403));
      const sorted = (m: EnforcementManifest) => JSON.stringify({ ...m, features: [...m.features].sort() });
      if (!manifest.success || claim.key_id !== runner.credential?.key_id || sorted(manifest.data) !== sorted(runner.manifest)) return done('runner_attest', refuse('attestation_mismatch', 403));
      const at = now();
      return done('runner_attest', await deps.store.transaction(state => {
        const row = state.runners.get(runnerId);
        if (!row || row.status !== 'pending_attestation' || row.credential?.key_id !== claim.key_id || at >= row.credential.expires_at) return refuse('runner_not_attestable', 409);
        row.status = 'active'; row.attested_by = actor.member_id;
        return { ok: true as const, value: true as const };
      }));
    },

    /** Trusted Axal verifier only: a conformance probe's outcome. Untrusted code needs a fresh pass. */
    async recordConformance(runnerId: string, passed: boolean): Promise<WorkspaceResult<true>> {
      const at = now();
      return done('runner_conformance', await deps.store.transaction(state => {
        const row = state.runners.get(runnerId);
        if (!row || row.status !== 'active') return refuse('runner_not_active', 409);
        row.conformance_at = passed === true ? at : null;
        return { ok: true as const, value: true as const };
      }));
    },

    /** Signed by the current key; proves the new one. The old key stops working at once. */
    async rotate(envelope: unknown): Promise<WorkspaceResult<{ key_id: string; expires_at: number }>> {
      if (disabled()) return done('runner_rotate', refuse('byoc_runner_disabled', 403));
      const checked = await verify(envelope, 'rotate'); if (!checked.ok) return done('runner_rotate', checked);
      const { runner, body, at } = checked.value, oldKeyId = runner.credential!.key_id, newKeyId = await jwkThumbprint(body.jwk);
      if (newKeyId === oldKeyId || runner.retired_keys.includes(newKeyId)
        || !await verifySignature(body.jwk, body.proof, rotationMessage(runner.runner_id, oldKeyId, newKeyId))) return done('runner_rotate', refuse('rotation_invalid', 403));
      return done('runner_rotate', await deps.store.transaction(state => {
        const row = state.runners.get(runner.runner_id);
        if (!row || row.status !== 'active' || row.credential?.key_id !== oldKeyId) return refuse('rotation_invalid', 409);
        row.retired_keys = [...row.retired_keys, oldKeyId].slice(-16);
        row.credential = { key_id: newKeyId, jwk: body.jwk, issued_at: at, expires_at: at + p.credential_ttl_ms };
        return { ok: true as const, value: { key_id: newKeyId, expires_at: at + p.credential_ttl_ms } };
      }));
    },

    /** Pull-only: the runner asks for one queued run. Placement, a capacity reservation, then D5565's atomic lease. */
    async lease(envelope: unknown): Promise<WorkspaceResult<{ spec: WorkspaceSpec; lease_id: string; expires_at: number; namespace: string }>> {
      if (disabled()) return done('runner_lease', refuse('byoc_runner_disabled', 403));
      const checked = await verify(envelope, 'lease'); if (!checked.ok) return done('runner_lease', checked);
      const { runner, body, at } = checked.value;
      const stored = await deps.specOf(body.run_id), parsed = stored ? trustedWorkspaceSpec(stored) : null;
      if (!parsed?.ok) return done('runner_lease', refuse('run_not_found', 403));
      const spec = parsed.value;
      const placed = placementDecision(spec, runner, await deps.consentOf(spec), at, p); if (!placed.ok) return done('runner_lease', placed);
      const reserved = await deps.store.transaction(state => {
        const row = state.runners.get(runner.runner_id);
        if (!row || row.status !== 'active') return refuse('runner_revoked', 403);
        if (state.assignments.has(spec.run_id) || row.active_runs.includes(spec.run_id)) return refuse('lease_unavailable');
        if (row.active_runs.length >= row.limits.max_concurrent) return refuse('scheduling_limit', 503);
        row.active_runs.push(spec.run_id);
        state.assignments.set(spec.run_id, { run_id: spec.run_id, runner_id: runner.runner_id, generation: body.execution_generation, lease_id: null, cleanup_generation: null });
        return { ok: true as const, value: true };
      });
      if (!reserved.ok) return done('runner_lease', reserved);
      const leased = await permitted(runner.runner_id, spec.run_id, () => runs.lease({ run_id: spec.run_id, execution_generation: body.execution_generation,
        request_nonce: body.request_nonce, identity: identityFor(spec, runner.runner_id) }));
      if (!leased.ok) { await release(spec.run_id, runner.runner_id); return done('runner_lease', leased); }
      await deps.store.transaction(state => { const a = state.assignments.get(spec.run_id); if (a) a.lease_id = leased.value.lease_id; });
      return done('runner_lease', { ok: true, value: { ...leased.value, namespace: await runNamespace(runner.cluster, spec) } });
    },

    /** A signed status: assigned to this runner, in its own namespace, at the live generation and a higher sequence. A refusal means stop. */
    async report(envelope: unknown): Promise<WorkspaceResult<{ cancel: false; expires_at: number }>> {
      if (disabled()) return done('runner_report', refuse('byoc_runner_disabled', 403));
      const checked = await verify(envelope, 'report'); if (!checked.ok) return done('runner_report', checked);
      const { runner, body } = checked.value;
      const assignment = await assignedTo(runner, body.run_id), spec = assignment ? await deps.specOf(body.run_id) : null;
      if (!assignment || !spec) return done('runner_report', refuse('run_not_assigned', 403));
      if (body.namespace !== await runNamespace(runner.cluster, spec)) return done('runner_report', refuse('namespace_escalation', 403));
      const beat = await permitted(runner.runner_id, body.run_id, () => runs.heartbeat({ run_id: body.run_id, execution_generation: body.execution_generation,
        lease_id: body.lease_id, identity: identityFor(spec, runner.runner_id), sequence: body.sequence }));
      return done('runner_report', beat.ok ? { ok: true, value: { cancel: false, expires_at: beat.value.expires_at } } : workspaceRefusal(beat.code, beat.status));
    },

    /** Completion goes through D5565's fenced, idempotent completion. Capacity is held until cleanup is confirmed. */
    async complete(envelope: unknown): Promise<WorkspaceResult<{ duplicate: boolean }>> {
      if (disabled()) return done('runner_complete', refuse('byoc_runner_disabled', 403));
      const checked = await verify(envelope, 'complete'); if (!checked.ok) return done('runner_complete', checked);
      const { runner, body } = checked.value;
      const assignment = await assignedTo(runner, body.run_id), spec = assignment ? await deps.specOf(body.run_id) : null;
      if (!assignment || !spec) return done('runner_complete', refuse('run_not_assigned', 403));
      const result = await permitted(runner.runner_id, body.run_id, () => runs.complete({ run_id: body.run_id, execution_generation: body.execution_generation,
        lease_id: body.lease_id, identity: identityFor(spec, runner.runner_id), manifest_ref: body.manifest_ref }));
      if (result.ok) await deps.store.transaction(state => { const a = state.assignments.get(body.run_id); if (a && a.cleanup_generation === null) { a.cleanup_generation = body.execution_generation; a.lease_id = null; } });
      return done('runner_complete', result);
    },

    /** On (re)connect: the Worker's record wins. Anything not live at this generation for this runner is told to stop. */
    async reconcile(envelope: unknown): Promise<WorkspaceResult<{ directives: Directive[] }>> {
      if (disabled()) return done('runner_reconcile', refuse('byoc_runner_disabled', 403));
      const checked = await verify(envelope, 'reconcile'); if (!checked.ok) return done('runner_reconcile', checked);
      const { runner, body } = checked.value;
      const mine = await deps.store.transaction(state => [...state.assignments.values()].filter(a => a.runner_id === runner.runner_id).map(a => structuredClone(a)));
      const directives: Directive[] = body.runs.map(reported => {
        const a = mine.find(row => row.run_id === reported.run_id);
        const live = a && a.cleanup_generation === null && a.lease_id !== null && a.generation === reported.execution_generation;
        return { ...reported, action: live ? 'continue' : 'stop' };
      });
      let fenced = 0;
      for (const a of mine) {
        if (body.runs.some(reported => reported.run_id === a.run_id)) continue;
        if (await fence(a)) fenced++;   // the runner no longer has it: fence it so no late callback lands
        directives.push({ run_id: a.run_id, execution_generation: a.generation, action: 'stop' });
      }
      return done('runner_reconcile', { ok: true, value: { directives } }, fenced);
    },

    /** The runner confirms the namespace for a finished or fenced run is gone; only then may D5565 lease the run again. */
    async cleanup(envelope: unknown): Promise<WorkspaceResult<{ cleaned: true }>> {
      const checked = await verify(envelope, 'cleanup'); if (!checked.ok) return done('runner_cleanup', checked);
      const { runner, body } = checked.value;
      const a = await assignedTo(runner, body.run_id);
      if (!a || a.generation !== body.execution_generation) return done('runner_cleanup', refuse('run_not_assigned', 403));
      if (a.cleanup_generation === null) return done('runner_cleanup', refuse('lease_still_live'));
      const acknowledged = await runs.acknowledgeCleanup(a.run_id, a.cleanup_generation);
      if (!acknowledged.ok) return done('runner_cleanup', acknowledged);
      await release(a.run_id, runner.runner_id);
      return done('runner_cleanup', acknowledged);
    },

    /** Trusted schedule: fence leases past their missed beats (D5565 reap) and count clusters that have gone quiet. */
    async sweep(): Promise<{ fenced: number; offline: number }> {
      const reaped = await runs.reap(), at = now();
      for (const r of reaped) {
        await deps.store.transaction(state => { const a = state.assignments.get(r.run_id); if (a && a.cleanup_generation === null) { a.cleanup_generation = r.execution_generation; a.lease_id = null; } });
        await deps.revokeGrants(r.run_id);
      }
      const offline = await deps.store.transaction(state => [...state.runners.values()].filter(row => row.status === 'active' && at - row.last_seen >= p.offline_after_ms).length);
      await deps.audit({ action: 'runner_sweep', outcome: 'accepted', count: reaped.length });
      return { fenced: reaped.length, offline };
    },

    /** Whether the broker may place work on this runner at all right now. */
    async available(runnerId: string): Promise<boolean> {
      const at = now();
      return deps.store.transaction(state => { const row = state.runners.get(runnerId); return Boolean(row && row.status === 'active' && at - row.last_seen < p.offline_after_ms); });
    },

    /** Kill one run: fence its generation, clear its grants. Works with the feature off. */
    async kill(actor: ByocActor, runId: string): Promise<WorkspaceResult<{ fenced: boolean }>> {
      const found = await deps.store.transaction(state => { const a = state.assignments.get(runId); const r = a && state.runners.get(a.runner_id); return a && r ? { a: structuredClone(a), venture: structuredClone(r.venture) } : null; });
      if (!found) return done('runner_kill', refuse('run_not_assigned', 403));
      if (!actor || !await deps.authorize(actor, found.venture, 'kill')) return done('runner_kill', refuse('admin_not_authorized', 403));
      return done('runner_kill', { ok: true, value: { fenced: await fence(found.a) } });
    },

    /** Revoke a runner: no request from it is accepted again, and every run it holds is fenced. Works with the feature off. */
    async revoke(actor: ByocActor, runnerId: string): Promise<WorkspaceResult<{ fenced: number }>> {
      const venture = await deps.store.transaction(state => structuredClone(state.runners.get(runnerId)?.venture ?? null));
      if (!venture) return done('runner_revoke', refuse('runner_unknown', 403));
      if (!actor || !await deps.authorize(actor, venture, 'revoke')) return done('runner_revoke', refuse('admin_not_authorized', 403));
      const held = await deps.store.transaction(state => {
        const row = state.runners.get(runnerId)!;
        row.status = 'revoked';
        if (row.credential) row.retired_keys = [...row.retired_keys, row.credential.key_id].slice(-16);
        row.credential = null; row.nonces = {};
        return [...state.assignments.values()].filter(a => a.runner_id === runnerId).map(a => structuredClone(a));
      });
      let fenced = 0;
      for (const a of held) if (await fence(a)) fenced++;
      return done('runner_revoke', { ok: true, value: { fenced } }, fenced);
    },

    /** A revoked or vanished runner cannot confirm cleanup; the customer admin who owns the cluster can. */
    async confirmCleanup(actor: ByocActor, runId: string): Promise<WorkspaceResult<{ cleaned: true }>> {
      const found = await deps.store.transaction(state => { const a = state.assignments.get(runId); const r = a && state.runners.get(a.runner_id); return a && r ? { a: structuredClone(a), venture: structuredClone(r.venture) } : null; });
      if (!found) return done('runner_confirm_cleanup', refuse('run_not_assigned', 403));
      if (actor?.kind !== 'customer_admin' || !await deps.authorize(actor, found.venture, 'confirm_cleanup')) return done('runner_confirm_cleanup', refuse('admin_not_authorized', 403));
      if (found.a.cleanup_generation === null) return done('runner_confirm_cleanup', refuse('lease_still_live'));
      const acknowledged = await runs.acknowledgeCleanup(runId, found.a.cleanup_generation);
      if (acknowledged.ok) await release(runId, found.a.runner_id);
      return done('runner_confirm_cleanup', acknowledged);
    },
  };
}
