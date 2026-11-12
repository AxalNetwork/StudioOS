/** D5567: unmounted broker security gate, one-use audience grants and tenant-bound artifact encryption. */
import { z } from 'zod';
import { executorEligibility, trustedWorkspaceSpec, workspaceRefusal, workspaceReference,
  type ExecutorCapabilities, type WorkspaceResult, type WorkspaceSpec } from './workspaceSpec';

export const WORKSPACE_AUDIENCES = ['executor.bootstrap', 'executor.heartbeat', 'executor.complete', 'artifact.upload', 'artifact.read', 'integration.publish'] as const;
export type WorkspaceAudience = typeof WORKSPACE_AUDIENCES[number];
export type WorkspaceSponsor = { member_id: number; tenant_id: number; company_id: number; project_id: number | null };
type Authorization = { allowed: boolean; revision: number; approved: boolean };
export type WorkspaceImageEvidence = { digest: string; signature_verified: boolean; provenance_verified: boolean; sbom_verified: boolean; scan_passed: boolean; revoked: boolean };
export type WorkspaceProviderEvidence = { capabilities: ExecutorCapabilities; non_root: boolean; immutable_root: boolean;
  ephemeral_scratch: boolean; resource_limits: boolean; host_socket: boolean; privileged: boolean;
  isolation: 'microvm' | 'gvisor' | 'container' | 'unknown'; network_connect_fence: boolean; metadata_denied: boolean };
export type WorkspaceObject = { ref: string; tenant_id: number; company_id: number; project_id: number | null; run_id: string;
  execution_generation: number; sink_ref: string; region: string; approved_restore_regions: string[]; key_id: string; expires_at: number };
type IssuedNonce = { expires_at: number; used: boolean; digest: string };
export type WorkspaceSecurityRun = { spec: WorkspaceSpec; sponsor: WorkspaceSponsor; permission_revision: number;
  revoked: boolean; nonces: Map<string, IssuedNonce> };
/** The real host must supply an atomic scoped DO store, not a process-local Map. */
export interface WorkspaceSecurityStore { transaction<T>(change: (runs: Map<string, WorkspaceSecurityRun>) => Promise<T> | T): Promise<T> }
export type WorkspaceSecurityDeps = {
  enabled(): boolean; halted(): boolean; clock(): number; nonce(): string; rootKey: CryptoKey; store: WorkspaceSecurityStore;
  authorize(sponsor: WorkspaceSponsor, spec: WorkspaceSpec, audience: WorkspaceAudience, objectRef: string | null): Promise<Authorization>;
  image(digest: string): Promise<WorkspaceImageEvidence | null>;
  provider(spec: WorkspaceSpec): Promise<WorkspaceProviderEvidence | null>;
  object(ref: string): Promise<WorkspaceObject | null>;
  encryptionKey(tenantId: number, keyId: string, operation: 'encrypt' | 'decrypt'): Promise<CryptoKey | null>;
  audit(event: { action: string; run_id: string; generation: number; member_id: number }): Promise<void>;
};

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const claimsSchema = z.object({ version: z.literal(1), aud: z.enum(WORKSPACE_AUDIENCES), tenant_id: positive, company_id: positive,
  project_id: positive.nullable(), agent_id: positive, task_id: positive, run_id: z.string().refine(workspaceReference),
  attempt: positive, execution_generation: positive, member_id: positive, permission_revision: positive,
  contract_hash: z.string().regex(/^[a-f0-9]{64}$/), nonce: z.string().regex(/^[A-Za-z0-9_-]{8,120}$/),
  iat: z.number().int().nonnegative(), exp: z.number().int().positive(), object_ref: z.string().refine(workspaceReference).nullable(),
  region: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/).nullable(),
}).strict();
type Claims = z.infer<typeof claimsSchema>;
export type WorkspacePermit = { claims: Claims; spec: WorkspaceSpec; object: WorkspaceObject | null };
export type GrantTarget = { run_id: string; execution_generation: number; audience: WorkspaceAudience; object_ref?: string | null; region?: string | null };
const encoder = new TextEncoder();
const bytes = (value: string) => encoder.encode(value);
function b64(value: Uint8Array): string {
  let raw = '';
  for (let offset = 0; offset < value.length; offset += 16384) raw += String.fromCharCode(...value.subarray(offset, offset + 16384));
  return btoa(raw).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function unb64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoded value');
  const raw = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4));
  const decoded = Uint8Array.from(raw, ch => ch.charCodeAt(0));
  if (b64(decoded) !== value) throw new Error('Noncanonical encoded value');
  return decoded;
}
const hash = async (value: string | Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? bytes(value) : value))].map(x => x.toString(16).padStart(2, '0')).join('');
const sameSponsor = (sponsor: WorkspaceSponsor, spec: WorkspaceSpec) => Number.isSafeInteger(sponsor.member_id) && sponsor.member_id > 0
  && sponsor.tenant_id === spec.tenant_id && sponsor.company_id === spec.company_id && sponsor.project_id === spec.project_id;

/** URL checking is only a broker preflight; an attested connect-time fence is separately mandatory. */
export function workspaceDestination(spec: WorkspaceSpec, raw: string): boolean {
  try {
    const url = new URL(raw);
    if (spec.network_policy.mode !== 'allowlist' || url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
    const host = url.hostname.toLowerCase();
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)
      || /(?:^|\.)(?:localhost|local|internal|home|test|invalid)$/.test(host) || host === 'metadata.google.internal') return false;
    return spec.network_policy.destinations.some(destination => destination.hostname === host && destination.port === 443);
  } catch { return false; }
}

export function createWorkspaceSecurity(deps: WorkspaceSecurityDeps) {
  const keyAlgorithm = deps.rootKey.algorithm as { name: string; hash?: { name: string }; length?: number };
  if (deps.rootKey.type !== 'secret' || deps.rootKey.extractable || keyAlgorithm.name !== 'HMAC'
    || keyAlgorithm.hash?.name !== 'SHA-256' || (keyAlgorithm.length ?? 0) < 256 || !deps.rootKey.usages.includes('sign')) throw new Error('Invalid broker signing key');
  const refuse = workspaceRefusal;
  const now = () => {
    const result = deps.clock();
    if (!Number.isSafeInteger(result) || result < 0) throw new Error('Invalid security clock');
    return result;
  };
  async function eligibility(spec: WorkspaceSpec): Promise<WorkspaceResult<true>> {
    if (deps.enabled() !== true || deps.halted() !== false) return refuse('workspace_halted', 403);
    const evidence = await deps.image(spec.image_digest);
    if (!evidence || evidence.digest !== spec.image_digest || evidence.signature_verified !== true || evidence.provenance_verified !== true
      || evidence.sbom_verified !== true || evidence.scan_passed !== true || evidence.revoked !== false) return refuse('image_not_approved', 403);
    const provider = await deps.provider(spec);
    if (!provider || provider.non_root !== true || provider.immutable_root !== true || provider.ephemeral_scratch !== true || provider.resource_limits !== true
      || provider.host_socket !== false || provider.privileged !== false || provider.metadata_denied !== true || provider.network_connect_fence !== true) return refuse('provider_security_denied', 403);
    if (spec.workload_class === 'coding_untrusted' && !['microvm', 'gvisor'].includes(provider.isolation)) return refuse('hostile_workload_denied', 403);
    const caps = executorEligibility(spec, provider.capabilities);
    return caps.ok ? { ok: true, value: true } : caps;
  }
  async function authorization(run: WorkspaceSecurityRun, aud: WorkspaceAudience, objectRef: string | null): Promise<boolean> {
    if (run.revoked || !sameSponsor(run.sponsor, run.spec)) return false;
    const current = await deps.authorize(run.sponsor, run.spec, aud, objectRef);
    return current.allowed === true && current.revision === run.permission_revision && (aud !== 'integration.publish' || current.approved === true);
  }
  async function objectFor(spec: WorkspaceSpec, ref: string | null, region: string | null, aud: WorkspaceAudience): Promise<WorkspaceObject | null | false> {
    const needsObject = aud.startsWith('artifact.') || aud === 'integration.publish';
    if (!needsObject) return ref === null && region === null ? null : false;
    if (!ref || !region || !spec.allowed_regions.includes(region)) return false;
    const provider = await deps.provider(spec);
    if (!provider?.capabilities.enforced_regions?.includes(region)) return false;
    const object = await deps.object(ref);
    if (!object || object.ref !== ref || object.tenant_id !== spec.tenant_id || object.company_id !== spec.company_id
      || object.project_id !== spec.project_id || object.run_id !== spec.run_id || object.execution_generation !== spec.execution_generation
      || object.sink_ref !== spec.artifact_sink_ref || !workspaceReference(object.key_id) || !Number.isSafeInteger(object.expires_at)
      || now() >= object.expires_at || !Array.isArray(object.approved_restore_regions)) return false;
    if (region !== object.region && (aud !== 'artifact.read' || !object.approved_restore_regions.includes(region))) return false;
    return object;
  }
  async function signingKey(claims: Pick<Claims, 'tenant_id' | 'run_id' | 'execution_generation' | 'aud'>): Promise<CryptoKey> {
    const material = await crypto.subtle.sign('HMAC', deps.rootKey, bytes(JSON.stringify(['workspace-grant-v1', claims.tenant_id, claims.run_id, claims.execution_generation, claims.aud])));
    return crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  }
  async function audit(action: string, run: WorkspaceSecurityRun) {
    await deps.audit({ action, run_id: run.spec.run_id, generation: run.spec.execution_generation, member_id: run.sponsor.member_id });
  }
  const methods = {
    eligibility,
    /** Trusted Worker admission only. Structural validation is not a replacement for existing scope/role checks. */
    async register(input: unknown, sponsor: WorkspaceSponsor): Promise<WorkspaceResult<true>> {
      const parsed = trustedWorkspaceSpec(input); if (!parsed.ok) return parsed;
      const spec = parsed.value;
      if (!sameSponsor(sponsor, spec)) return refuse('sponsor_scope_denied', 403);
      const authorized = await deps.authorize(sponsor, spec, 'executor.bootstrap', null);
      if (!authorized.allowed || !Number.isSafeInteger(authorized.revision) || authorized.revision < 1) return refuse('sponsor_not_authorized', 403);
      const allowed = await eligibility(spec); if (!allowed.ok) return allowed;
      return deps.store.transaction(runs => {
        const prior = runs.get(spec.run_id);
        if (prior) return JSON.stringify(prior.spec) === JSON.stringify(spec) && prior.sponsor.member_id === sponsor.member_id
          && !prior.revoked && prior.permission_revision === authorized.revision ? { ok: true, value: true } : refuse('run_contract_changed');
        runs.set(spec.run_id, { spec, sponsor: structuredClone(sponsor), permission_revision: authorized.revision, revoked: false, nonces: new Map() });
        return { ok: true, value: true };
      });
    },

    async issue(target: GrantTarget, ttlMs = 30000): Promise<WorkspaceResult<{ token: string; expires_at: number }>> {
      if (!Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > 60000 || !WORKSPACE_AUDIENCES.includes(target.audience)) return refuse('grant_policy_denied', 422);
      return deps.store.transaction(async runs => {
        const run = runs.get(target.run_id);
        if (!run || run.spec.execution_generation !== target.execution_generation) return refuse('stale_generation', 403);
        const allowed = await eligibility(run.spec); if (!allowed.ok) return allowed;
        const objectRef = target.object_ref ?? null, region = target.region ?? null;
        if (!await authorization(run, target.audience, objectRef)) return refuse('sponsor_not_authorized', 403);
        if (await objectFor(run.spec, objectRef, region, target.audience) === false) return refuse('object_not_authorized', 403);
        const at = now();
        for (const [nonce, entry] of run.nonces) if (entry.expires_at <= at) run.nonces.delete(nonce);
        if (run.nonces.size >= 1024) return refuse('grant_capacity_exhausted', 503);
        const nonce = deps.nonce();
        const claims: Claims = { version: 1, aud: target.audience, tenant_id: run.spec.tenant_id, company_id: run.spec.company_id,
          project_id: run.spec.project_id, agent_id: run.spec.agent_id, task_id: run.spec.task_id, run_id: run.spec.run_id,
          attempt: run.spec.attempt, execution_generation: run.spec.execution_generation, member_id: run.sponsor.member_id,
          permission_revision: run.permission_revision, contract_hash: await hash(JSON.stringify(run.spec)), nonce,
          iat: at, exp: at + ttlMs, object_ref: objectRef, region };
        if (!claimsSchema.safeParse(claims).success || run.nonces.has(nonce)) return refuse('grant_nonce_invalid', 503);
        const payload = b64(bytes(JSON.stringify(claims)));
        const signature = b64(new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(claims), bytes(payload))));
        run.nonces.set(nonce, { expires_at: claims.exp, used: false, digest: await hash(payload) });
        await audit('workspace_grant_issued', run);
        return { ok: true, value: { token: `${payload}.${signature}`, expires_at: claims.exp } };
      });
    },

    async redeem(token: unknown, target: GrantTarget): Promise<WorkspaceResult<WorkspacePermit>> {
      let claims: Claims, payload: string;
      try {
        if (typeof token !== 'string' || token.length > 4096) return refuse('grant_invalid', 403);
        const parts = token.split('.'); if (parts.length !== 2) return refuse('grant_invalid', 403);
        payload = parts[0]; const parsed = claimsSchema.safeParse(JSON.parse(new TextDecoder().decode(unb64(payload))));
        if (!parsed.success) return refuse('grant_invalid', 403);
        claims = parsed.data;
        if (!await crypto.subtle.verify('HMAC', await signingKey(claims), unb64(parts[1]), bytes(payload))) return refuse('grant_invalid', 403);
      } catch { return refuse('grant_invalid', 403); }
      const at = now();
      if (claims.iat > at || at >= claims.exp || claims.exp <= claims.iat || claims.exp - claims.iat > 60000) return refuse('grant_expired', 403);
      if (claims.run_id !== target.run_id || claims.execution_generation !== target.execution_generation || claims.aud !== target.audience
        || claims.object_ref !== (target.object_ref ?? null) || claims.region !== (target.region ?? null)) return refuse('grant_target_denied', 403);
      return deps.store.transaction(async runs => {
        const run = runs.get(claims.run_id);
        if (!run || run.spec.execution_generation !== claims.execution_generation || run.spec.attempt !== claims.attempt) return refuse('stale_generation', 403);
        const allowed = await eligibility(run.spec); if (!allowed.ok) return allowed;
        if (run.sponsor.member_id !== claims.member_id || run.permission_revision !== claims.permission_revision
          || run.spec.tenant_id !== claims.tenant_id || run.spec.company_id !== claims.company_id || run.spec.project_id !== claims.project_id
          || run.spec.agent_id !== claims.agent_id || run.spec.task_id !== claims.task_id || await hash(JSON.stringify(run.spec)) !== claims.contract_hash
          || !await authorization(run, claims.aud, claims.object_ref)) return refuse('sponsor_not_authorized', 403);
        const object = await objectFor(run.spec, claims.object_ref, claims.region, claims.aud);
        if (object === false) return refuse('object_not_authorized', 403);
        const nonce = run.nonces.get(claims.nonce);
        if (!nonce || nonce.used || nonce.expires_at !== claims.exp || nonce.digest !== await hash(payload)) return refuse('grant_replay', 403);
        nonce.used = true;
        await audit('workspace_grant_redeemed', run);
        return { ok: true, value: { claims, spec: structuredClone(run.spec), object: object ? structuredClone(object) : null } };
      });
    },

    /** Trusted control-plane revocation, before acknowledging membership/run revocation to its caller. */
    async revoke(runId: string): Promise<void> {
      await deps.store.transaction(async runs => { const run = runs.get(runId); if (run) { run.revoked = true; run.nonces.clear(); await audit('workspace_run_revoked', run); } });
    },

    /** Existing runtime requeue only: no actor, scope, image, path or budget may change under the old run. */
    async advance(input: unknown): Promise<WorkspaceResult<true>> {
      const parsed = trustedWorkspaceSpec(input); if (!parsed.ok) return parsed;
      return deps.store.transaction(async runs => {
        const run = runs.get(parsed.value.run_id);
        if (!run || parsed.value.execution_generation !== run.spec.execution_generation + 1
          || JSON.stringify({ ...run.spec, execution_generation: parsed.value.execution_generation }) !== JSON.stringify(parsed.value)) return refuse('generation_advance_denied', 403);
        if (!await authorization(run, 'executor.bootstrap', null)) return refuse('sponsor_not_authorized', 403);
        run.spec = parsed.value; run.nonces.clear(); await audit('workspace_generation_advanced', run);
        return { ok: true, value: true };
      });
    },
  };

  function aad(object: WorkspaceObject): Uint8Array {
    return bytes(JSON.stringify([1, object.ref, object.tenant_id, object.company_id, object.project_id, object.run_id,
      object.execution_generation, object.sink_ref, object.region, object.key_id, object.expires_at]));
  }
  return { ...methods,
    async seal(token: unknown, target: GrantTarget, plaintext: Uint8Array): Promise<WorkspaceResult<{ version: 1; key_id: string; iv: string; ciphertext: string }>> {
      if (target.audience !== 'artifact.upload' || plaintext.byteLength > 8 * 1024 * 1024) return refuse('artifact_policy_denied', 422);
      const permit = await methods.redeem(token, target); if (!permit.ok) return permit;
      const object = permit.value.object!;
      const key = await deps.encryptionKey(object.tenant_id, object.key_id, 'encrypt');
      if (!key) return refuse('artifact_key_unavailable', 503);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(object) }, key, plaintext));
      return { ok: true, value: { version: 1, key_id: object.key_id, iv: b64(iv), ciphertext: b64(ciphertext) } };
    },
    async open(token: unknown, target: GrantTarget, envelope: { version: number; key_id: string; iv: string; ciphertext: string }): Promise<WorkspaceResult<Uint8Array>> {
      if (target.audience !== 'artifact.read') return refuse('artifact_policy_denied', 422);
      const permit = await methods.redeem(token, target); if (!permit.ok) return permit;
      const object = permit.value.object!;
      if (envelope.version !== 1 || envelope.key_id !== object.key_id || typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length > 12 * 1024 * 1024) return refuse('artifact_ciphertext_invalid', 422);
      const key = await deps.encryptionKey(object.tenant_id, object.key_id, 'decrypt');
      if (!key) return refuse('artifact_key_unavailable', 503);
      try {
        const iv = unb64(envelope.iv); if (iv.length !== 12) return refuse('artifact_ciphertext_invalid', 422);
        const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(object) }, key, unb64(envelope.ciphertext));
        return { ok: true, value: new Uint8Array(plaintext) };
      } catch { return refuse('artifact_ciphertext_invalid', 422); }
    },
  };
}
