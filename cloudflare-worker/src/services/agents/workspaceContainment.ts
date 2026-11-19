/** D5567 part 4: pure fail-closed containment gate (egress, metadata, guest bindings, privilege, sandbox strength) and the job-environment credential scan; unmounted. */
import { z } from 'zod';
import { PROVIDERS, workspaceRefusal, type Provider, type WorkspaceRefusal, type WorkspaceSpec } from './workspaceSpec';

/** The step name #5570's placement filter uses for this check, between residency and image/runtime. */
export const CONTAINMENT_STEP = 'security_capability' as const;
/** Evidence older than this is not evidence. A caller may pass a shorter window, never a longer one. */
export const CONTAINMENT_EVIDENCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Every reason a provider can be ineligible, in the order they are reported. Stable: #5570 and audit rows key on these strings. */
export const CONTAINMENT_REASONS = [
  'evidence_missing', 'evidence_malformed', 'evidence_untrusted_source', 'evidence_provider_mismatch', 'evidence_stale',
  'egress_deny_unenforced', 'egress_allowlist_unenforced', 'egress_private_ranges_open', 'egress_dns_rebinding_open',
  'egress_redirects_open', 'egress_raw_sockets_open', 'metadata_reachable', 'localhost_reachable',
  'guest_d1_binding', 'guest_durable_object_binding', 'guest_secret_binding', 'guest_control_plane_credential', 'guest_other_tenant_mount',
  'privileged_mode', 'host_socket', 'root_user', 'new_privileges_allowed', 'mutable_image',
  'sandbox_unknown', 'sandbox_too_weak',
] as const;
export type ContainmentReason = typeof CONTAINMENT_REASONS[number];

export const SANDBOX_CLASSES = ['unknown', 'container', 'gvisor', 'microvm'] as const;
export type SandboxClass = typeof SANDBOX_CLASSES[number];

const bool = z.boolean();
/**
 * What a provider can enforce, as recorded by the owner-controlled registry after a conformance run.
 * A provider's or runner's own report is never enough: `source` must be `owner_registry`.
 */
export const containmentEvidenceSchema = z.object({
  provider: z.enum(PROVIDERS),
  revision: z.string().min(1).max(120),
  source: z.enum(['owner_registry', 'provider_self_report', 'runner_report']),
  verified_at: z.number().int().nonnegative(),
  egress: z.object({
    deny_all: bool,
    connect_time_allowlist: bool,
    blocks_private_ranges: bool,
    blocks_dns_rebinding: bool,
    blocks_redirect_escape: bool,
    covers_raw_sockets: bool,
  }).strict(),
  metadata_blocked: bool,
  localhost_blocked: bool,
  guest: z.object({
    d1_binding: bool,
    durable_object_binding: bool,
    secret_bindings: bool,
    control_plane_credentials: bool,
    other_tenant_mounts: bool,
  }).strict(),
  privileged: bool,
  host_socket: bool,
  runs_as_root: bool,
  no_new_privileges: bool,
  immutable_image: bool,
  sandbox: z.enum(SANDBOX_CLASSES),
}).strict();
export type ContainmentEvidence = z.infer<typeof containmentEvidenceSchema>;

export type ContainmentDecision =
  | { eligible: true; provider: Provider; step: typeof CONTAINMENT_STEP; reasons: [] }
  | { eligible: false; provider: Provider; step: typeof CONTAINMENT_STEP; reasons: ContainmentReason[] };
export type ContainmentOptions = { now: number; maxAgeMs?: number };

const strength: Record<SandboxClass, number> = { unknown: 0, container: 1, gvisor: 2, microvm: 3 };
/** A hostile coding workload needs a gVisor- or microVM-class boundary; a plain Linux container is not enough for it. */
export function requiredSandbox(workload: WorkspaceSpec['workload_class']): Exclude<SandboxClass, 'unknown'> {
  return workload === 'coding_untrusted' ? 'gvisor' : 'container';
}

/**
 * Is `provider` able to enforce what `spec` asks for? Pure: no I/O, no clock read. Every failing reason is
 * reported (so placement can explain itself); any reason makes the provider ineligible. Unknown is ineligible.
 */
export function containmentEligibility(spec: Pick<WorkspaceSpec, 'network_policy' | 'workload_class'>, provider: Provider,
  evidence: unknown, options: ContainmentOptions): ContainmentDecision {
  const no = (reasons: ContainmentReason[]): ContainmentDecision => ({ eligible: false, provider, step: CONTAINMENT_STEP,
    reasons: CONTAINMENT_REASONS.filter(reason => reasons.includes(reason)) });
  if (!Number.isSafeInteger(options?.now) || options.now < 0) throw new Error('Invalid containment clock');
  const maxAge = Math.min(options.maxAgeMs ?? CONTAINMENT_EVIDENCE_MAX_AGE_MS, CONTAINMENT_EVIDENCE_MAX_AGE_MS);
  if (evidence === null || evidence === undefined) return no(['evidence_missing']);
  const parsed = containmentEvidenceSchema.safeParse(evidence);
  if (!parsed.success) return no(['evidence_malformed']);
  const e = parsed.data, reasons: ContainmentReason[] = [];
  if (e.source !== 'owner_registry') reasons.push('evidence_untrusted_source');
  if (e.provider !== provider) reasons.push('evidence_provider_mismatch');
  if (e.verified_at > options.now || options.now - e.verified_at > maxAge) reasons.push('evidence_stale');

  const mode = spec.network_policy?.mode;
  if (mode === 'deny') {
    if (e.egress.deny_all !== true) reasons.push('egress_deny_unenforced');
  } else if (mode === 'allowlist') {
    // A hostname check is a preflight. Only a connect-time fence that also closes these paths enforces an allowlist.
    if (e.egress.connect_time_allowlist !== true) reasons.push('egress_allowlist_unenforced');
    if (e.egress.blocks_private_ranges !== true) reasons.push('egress_private_ranges_open');
    if (e.egress.blocks_dns_rebinding !== true) reasons.push('egress_dns_rebinding_open');
    if (e.egress.blocks_redirect_escape !== true) reasons.push('egress_redirects_open');
    if (e.egress.covers_raw_sockets !== true) reasons.push('egress_raw_sockets_open');
  } else reasons.push('egress_allowlist_unenforced');
  if (e.metadata_blocked !== true) reasons.push('metadata_reachable');
  if (e.localhost_blocked !== true) reasons.push('localhost_reachable');

  if (e.guest.d1_binding !== false) reasons.push('guest_d1_binding');
  if (e.guest.durable_object_binding !== false) reasons.push('guest_durable_object_binding');
  if (e.guest.secret_bindings !== false) reasons.push('guest_secret_binding');
  if (e.guest.control_plane_credentials !== false) reasons.push('guest_control_plane_credential');
  if (e.guest.other_tenant_mounts !== false) reasons.push('guest_other_tenant_mount');

  if (e.privileged !== false) reasons.push('privileged_mode');
  if (e.host_socket !== false) reasons.push('host_socket');
  if (e.runs_as_root !== false) reasons.push('root_user');
  if (e.no_new_privileges !== true) reasons.push('new_privileges_allowed');
  if (e.immutable_image !== true) reasons.push('mutable_image');

  if (e.sandbox === 'unknown') reasons.push('sandbox_unknown');
  else if (strength[e.sandbox] < strength[requiredSandbox(spec.workload_class)]) reasons.push('sandbox_too_weak');
  return reasons.length ? no(reasons) : { eligible: true, provider, step: CONTAINMENT_STEP, reasons: [] };
}

/** The boolean form for a placement filter. */
export function isContainmentEligible(spec: Pick<WorkspaceSpec, 'network_policy' | 'workload_class'>, provider: Provider,
  evidence: unknown, options: ContainmentOptions): boolean {
  return containmentEligibility(spec, provider, evidence, options).eligible === true;
}

/** Splits candidates into the ones that can contain this workload and the ones that cannot, with their reasons. */
export function filterContainment(spec: Pick<WorkspaceSpec, 'network_policy' | 'workload_class'>,
  candidates: ReadonlyArray<{ provider: Provider; evidence: unknown }>, options: ContainmentOptions) {
  const eligible: Provider[] = [], ineligible: { provider: Provider; reasons: ContainmentReason[] }[] = [];
  for (const candidate of candidates) {
    const decision = containmentEligibility(spec, candidate.provider, candidate.evidence, options);
    if (decision.eligible) eligible.push(candidate.provider); else ineligible.push({ provider: candidate.provider, reasons: decision.reasons });
  }
  return { step: CONTAINMENT_STEP, eligible, ineligible };
}

/** The broker's refusal for an ineligible decision. The first reason is the reported capability; the rest stay server-side. */
export function containmentRefusal(decision: ContainmentDecision): WorkspaceRefusal | null {
  return decision.eligible ? null : workspaceRefusal('containment_unsupported', 422, decision.reasons[0] ?? 'evidence_missing');
}

// ---- The job environment: no cloud credential or provider token may reach the guest. ----

/** The only variable names a coding or compute guest may carry. Anything else is a finding, so a new name is a reviewed change. */
export const GUEST_ENV_ALLOWED = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'USER', 'PWD', 'HOSTNAME', 'TERM',
  'PYTHONDONTWRITEBYTECODE', 'PYTHONUNBUFFERED', 'LD_LIBRARY_PATH'] as const;
const credentialName = [
  /^(?:AWS|AMAZON)_/, /^AZURE_/, /^ARM_(?:CLIENT|TENANT|SUBSCRIPTION)/, /^(?:GOOGLE|GCP|GCLOUD|CLOUDSDK)_/, /^(?:CLOUDFLARE|CF)_/,
  /^(?:GITHUB|GH|GITLAB|BITBUCKET)_/, /^(?:NPM|PYPI|TWINE|DOCKER|REGISTRY)_/, /^(?:OPENAI|HF|HUGGING_?FACE)_/,
  /(?:^|_)(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIALS?|AUTH)(?:_|$)/,
];
const credentialValue = [
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, /\bgh[opsur]_[A-Za-z0-9]{30,}/, /\bgithub_pat_[A-Za-z0-9_]{30,}/, /\bsk-ant-[A-Za-z0-9_-]{16,}/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/, /\bxox[abpr]-[A-Za-z0-9-]{10,}/, /\bAIza[0-9A-Za-z_-]{35}\b/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, /\/\/[^/\s:@]+:[^/\s@]+@/,
];
export type EnvFinding = { name: string; kind: 'credential_name' | 'credential_value' | 'unlisted_name' | 'malformed' };

/**
 * Scans what a job would be started with. Reports variable NAMES and a kind, never a value, so the finding
 * itself can be logged. Anything that is not a plain string map is one `malformed` finding.
 */
export function jobEnvironmentFindings(env: unknown, allowed: readonly string[] = GUEST_ENV_ALLOWED): EnvFinding[] {
  if (env === undefined || env === null) return [];
  if (typeof env !== 'object' || Array.isArray(env)) return [{ name: '*', kind: 'malformed' }];
  const findings: EnvFinding[] = [];
  for (const [rawName, value] of Object.entries(env as Record<string, unknown>)) {
    const name = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(rawName) ? rawName : '*';
    if (name === '*' || typeof value !== 'string') { findings.push({ name, kind: 'malformed' }); continue; }
    const upper = name.toUpperCase();
    if (credentialName.some(pattern => pattern.test(upper))) findings.push({ name, kind: 'credential_name' });
    else if (!allowed.includes(name)) findings.push({ name, kind: 'unlisted_name' });
    if (credentialValue.some(pattern => pattern.test(value))) findings.push({ name, kind: 'credential_value' });
  }
  return findings;
}

/** True only when the environment is a string map with nothing but allowed, credential-free variables. */
export function jobEnvironmentClean(env: unknown, allowed?: readonly string[]): boolean {
  return jobEnvironmentFindings(env, allowed).length === 0;
}
