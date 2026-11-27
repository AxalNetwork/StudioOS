/**
 * D5568: immutable, encrypted, checksum-verified workspace checkpoints with an atomic, generation-fenced pointer,
 * portable restore from image digest + exact SHA, retention/quota/delete/export/GC plans and a metrics report.
 * Unmounted: the R2 bucket, the pointer's durable store (the run's DO transaction, owner answer A; D5568 part 2) and the
 * tenant key provider are injected ports. Only filesystem state is captured; processes, RAM, sockets and PIDs are never migrated.
 */
import { z } from 'zod';
import { executorEligibility, WORKSPACE_VERSION, workspacePath, workspaceReference, workspaceRefusal, workspaceSpecSchema,
  type ExecutorCapabilities, type WorkspaceResult, type WorkspaceSpec } from './workspaceSpec';
import { isExactSha, sha256Hex, type GitCache, type Worktree } from './workspaceGitCache';

export const CHECKPOINT_SCHEMA_VERSION = 1 as const;
export const NOT_MIGRATED = Object.freeze(['running_processes', 'memory', 'open_sockets', 'local_pids'] as const);
const hex64 = z.string().regex(/^[a-f0-9]{64}$/);
const uid = z.string().refine(workspaceReference);
const region = z.string().regex(/^[a-z][a-z0-9-]{1,31}$/);
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const fileEntry = z.object({ path: z.string().refine(workspacePath), sha256: hex64, size: z.number().int().nonnegative(),
  object_key: z.string().min(1).max(1024), object_sha256: hex64 }).strict();
export const checkpointManifestSchema = z.object({
  schema_version: z.literal(CHECKPOINT_SCHEMA_VERSION), workspace_version: z.literal(WORKSPACE_VERSION),
  tenant_id: positive, company_id: positive, project_id: positive.nullable(), run_id: uid, attempt: positive,
  execution_generation: positive, sequence: positive, idempotency_token: uid, repo_id: positive,
  base_sha: z.string().refine(isExactSha), tree_hash: hex64, artifact_hash: hex64,
  image_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/), created_at: z.number().int().nonnegative(),
  regions: z.object({ origin: region, allowed: z.array(region).min(1).max(32) }).strict(),
  path_allowlist: z.array(z.string().refine(workspacePath)).min(1).max(64),
  encryption: z.object({ algorithm: z.literal('AES-256-GCM'), key_scope: z.literal('tenant'), key_id: uid, aad: z.literal('workspace-checkpoint-v1') }).strict(),
  files: z.array(fileEntry).max(10000), deleted: z.array(z.string().refine(workspacePath)).max(10000),
  previous_manifest_sha256: hex64.nullable(),
}).strict();
export type CheckpointManifest = z.infer<typeof checkpointManifestSchema>;

const sorted = (values: string[]) => values.every((value, i) => i === 0 || values[i - 1] < value);
const inScope = (path: string, scopes: readonly string[]) => scopes.some(scope => path === scope || path.startsWith(scope + '/'));
export const checkpointPrefix = (tenant_id: number, run_id: string) => `tenants/${tenant_id}/workspace-checkpoints/${run_id}/`;
const attemptPrefix = (m: { tenant_id: number; run_id: string; execution_generation: number; idempotency_token: string }) =>
  `${checkpointPrefix(m.tenant_id, m.run_id)}g${m.execution_generation}/${m.idempotency_token}/`;
export const artifactHash = (files: CheckpointManifest['files'], deleted: string[]) =>
  sha256Hex(files.map(f => `${f.path}\u0000${f.sha256}\u0000${f.size}\n`).join('') + deleted.map(p => `-${p}\n`).join(''));

/** Structural and semantic validation; the content checks (tree hash, every blob) happen again on restore. */
export async function validateCheckpointManifest(input: unknown): Promise<WorkspaceResult<CheckpointManifest>> {
  const parsed = checkpointManifestSchema.safeParse(input);
  if (!parsed.success) return workspaceRefusal(isExactSha((input as CheckpointManifest | null)?.base_sha) ? 'invalid_checkpoint_manifest' : 'invalid_base_sha', 422);
  const m = parsed.data, paths = m.files.map(f => f.path), prefix = attemptPrefix(m);
  if (!m.regions.allowed.includes(m.regions.origin)) return workspaceRefusal('invalid_checkpoint_manifest', 422);
  if (!sorted(paths) || !sorted(m.deleted) || m.deleted.some(p => paths.includes(p))) return workspaceRefusal('invalid_checkpoint_manifest', 422);
  if ([...paths, ...m.deleted].some(p => !inScope(p, m.path_allowlist))) return workspaceRefusal('path_not_allowed', 422);
  if (m.files.some(f => f.object_key !== `${prefix}blobs/${f.object_sha256}`)) return workspaceRefusal('invalid_checkpoint_manifest', 422);
  if (await artifactHash(m.files, m.deleted) !== m.artifact_hash) return workspaceRefusal('checksum_mismatch', 422);
  return { ok: true, value: m };
}

/** A port's typed refusal (D5568 part 2). The service maps `checksum_mismatch` and `stale_gc` to its own refusals, any other throw to 503. */
export class CheckpointStoreRefusal extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = 'CheckpointStoreRefusal'; this.code = code; }
}
const portCode = (error: unknown, keep: string[]) => error instanceof CheckpointStoreRefusal && keep.includes(error.code) ? error.code : null;

/** R2-shaped port. `list` reads one tenant/run prefix; `delete` is used only by an explicit, fenced plan. */
export interface CheckpointObjectStore {
  put(key: string, bytes: Uint8Array, meta: { sha256: string }): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  list(prefix: string): Promise<{ key: string; size: number }[]>;
  delete(key: string): Promise<void>;
}
/** Tenant-scoped AEAD; a key from another tenant, or other AAD, must fail to open. */
export interface CheckpointCipher {
  seal(tenant_id: number, key_id: string, aad: string, plain: Uint8Array): Promise<Uint8Array>;
  open(tenant_id: number, key_id: string, aad: string, sealed: Uint8Array): Promise<Uint8Array | null>;
}
type Committed = { sequence: number; manifest_key: string; manifest_sha256: string; bytes: number; created_at: number; objects: string[]; generation: number };
export type CheckpointPointer = { tenant_id: number; run_id: string; origin_region: string; generation: number; deleted: boolean;
  head: Committed | null; history: Committed[]; tokens: Record<string, { tree_hash: string; sequence: number; manifest_sha256: string; manifest_key: string; bytes: number }> };
/** The commit point. Backed by the run's DO transaction (owner answer A, `workspaceCheckpointStore.ts`); memory only in tests. */
export interface CheckpointPointerStore { transaction<T>(change: (rows: Map<string, CheckpointPointer>) => T): Promise<T> }
export type CheckpointPolicy = { max_file_bytes: number; tenant_quota_bytes: number; keep_last: number; ttl_ms: number };
const rowKey = (tenant_id: number, run_id: string) => `${tenant_id}/${run_id}`;
const canonical = (m: CheckpointManifest) => new TextEncoder().encode(JSON.stringify(m));
const aadFor = (m: { tenant_id: number; run_id: string; execution_generation: number }, path: string, sha: string) =>
  `workspace-checkpoint-v1|${m.tenant_id}|${m.run_id}|g${m.execution_generation}|${path}|${sha}`;

export type GcPlan = { tenant_id: number; run_id: string; generation: number; sequence: number; delete: string[]; reason: 'retention' | 'staged' | 'run_deleted' };

export function createCheckpointService({ objects, pointers, cipher, clock, policy }: {
  objects: CheckpointObjectStore; pointers: CheckpointPointerStore; cipher: CheckpointCipher; clock: () => number; policy: CheckpointPolicy }) {
  for (const n of [policy.max_file_bytes, policy.tenant_quota_bytes, policy.keep_last, policy.ttl_ms]) if (!Number.isSafeInteger(n) || n < 1) throw new Error('Invalid checkpoint policy');
  const refuse = workspaceRefusal;
  const tenantBytes = (rows: Map<string, CheckpointPointer>, tenant: number) => {
    let total = 0; for (const r of rows.values()) if (r.tenant_id === tenant) for (const c of r.history) total += c.bytes; return total;
  };
  /** Read-after-write: the bytes the store returns must hash to what was sent before the pointer may move. */
  async function putVerified(key: string, bytes: Uint8Array): Promise<WorkspaceResult<string>> {
    const sha = await sha256Hex(bytes);
    try { await objects.put(key, bytes, { sha256: sha }); } catch (e) { return portCode(e, ['checksum_mismatch']) ? refuse('checksum_mismatch', 422) : refuse('checkpoint_upload_interrupted', 503); }
    let stored: Uint8Array | null;
    try { stored = await objects.get(key); } catch (e) { return portCode(e, ['checksum_mismatch']) ? refuse('checksum_mismatch', 422) : refuse('checkpoint_upload_interrupted', 503); }
    if (!stored || await sha256Hex(stored) !== sha) return refuse('checksum_mismatch', 422);
    return { ok: true, value: sha };
  }
  /** A store that verifies its own checksum on read refuses with `checksum_mismatch`; any other failure is 503, never a throw. */
  async function readObject(key: string): Promise<WorkspaceResult<Uint8Array | null>> {
    try { return { ok: true, value: await objects.get(key) }; }
    catch (e) { return portCode(e, ['checksum_mismatch']) ? refuse('checksum_mismatch', 422) : refuse('checkpoint_store_unavailable', 503); }
  }

  const service = {
    /** Trusted runtime only, after D5565 admission: creates the pointer row at the run's first generation and pins its origin region. */
    async register(spec: WorkspaceSpec, origin_region: string): Promise<WorkspaceResult<{ generation: number }>> {
      const parsed = workspaceSpecSchema.safeParse(spec);
      if (!parsed.success) return refuse('invalid_workspace_spec', 422);
      if (!parsed.data.allowed_regions.includes(origin_region)) return refuse('region_not_allowed', 403);
      return pointers.transaction(rows => {
        const key = rowKey(spec.tenant_id, spec.run_id), row = rows.get(key);
        if (row) return row.origin_region === origin_region ? { ok: true, value: { generation: row.generation } } : refuse('run_contract_changed');
        rows.set(key, { tenant_id: spec.tenant_id, run_id: spec.run_id, origin_region, generation: spec.execution_generation, deleted: false, head: null, history: [], tokens: {} });
        return { ok: true, value: { generation: spec.execution_generation } };
      });
    },
    /** Mirrors D5565's generation bump (reap, cancel, retry). Only ever increases; afterwards older writers and GC plans are stale. */
    async fence(tenant_id: number, run_id: string, generation: number): Promise<WorkspaceResult<{ generation: number }>> {
      return pointers.transaction(rows => {
        const row = rows.get(rowKey(tenant_id, run_id));
        if (!row) return refuse('checkpoint_not_found', 403);
        if (!Number.isSafeInteger(generation) || generation <= row.generation) return refuse('stale_generation');
        row.generation = generation;
        return { ok: true, value: { generation } };
      });
    },

    /**
     * Upload every blob and the manifest, verify each read-back checksum, then advance the pointer in ONE
     * conditional transaction (same generation, same head, token unused). Anything before that step is invisible.
     */
    async commit({ spec, worktree, token, key_id }: { spec: WorkspaceSpec; worktree: Worktree; token: string; key_id: string }):
      Promise<WorkspaceResult<{ sequence: number; manifest_key: string; manifest_sha256: string; bytes: number; duplicate: boolean }>> {
      const parsed = workspaceSpecSchema.safeParse(spec);
      if (!parsed.success) return refuse('invalid_workspace_spec', 422);
      if (!workspaceReference(token) || !workspaceReference(key_id)) return refuse('invalid_checkpoint_request', 422);
      if (!worktree.open || worktree.tenant_id !== spec.tenant_id || worktree.run_id !== spec.run_id || worktree.repo_id !== spec.repo_id
        || worktree.generation !== spec.execution_generation || worktree.base_sha !== spec.base_sha) return refuse('worktree_not_authorized', 403);
      const tree_hash = await worktree.treeHash();
      const snapshot = await pointers.transaction(rows => {
        const row = rows.get(rowKey(spec.tenant_id, spec.run_id));
        if (!row || row.tenant_id !== spec.tenant_id) return refuse('checkpoint_not_found', 403);
        if (row.deleted) return refuse('checkpoint_deleted');
        if (spec.execution_generation !== row.generation) return refuse('stale_generation');
        if (worktree.region !== row.origin_region) return refuse('region_not_allowed', 403);
        const used = row.tokens[token];
        if (used) return used.tree_hash === tree_hash ? { ok: true as const, value: { duplicate: used, head: row.head, used: tenantBytes(rows, spec.tenant_id) } } : refuse('idempotency_conflict');
        return { ok: true as const, value: { duplicate: null, head: row.head, used: tenantBytes(rows, spec.tenant_id), origin: row.origin_region } };
      });
      if (!snapshot.ok) return snapshot;
      if (snapshot.value.duplicate) {
        const d = snapshot.value.duplicate;
        return { ok: true, value: { sequence: d.sequence, manifest_key: d.manifest_key, manifest_sha256: d.manifest_sha256, bytes: d.bytes, duplicate: true } };
      }
      const { written, deleted } = worktree.changes();
      const base = { tenant_id: spec.tenant_id, run_id: spec.run_id, execution_generation: spec.execution_generation, idempotency_token: token };
      const prefix = attemptPrefix(base), files: CheckpointManifest['files'] = [], keys: string[] = [];
      let bytes = 0;
      if (written.some(([, plain]) => plain.length > policy.max_file_bytes)) return refuse('checkpoint_file_too_large', 422);
      for (const [path, plain] of written) {
        const sha = await sha256Hex(plain), sealed = await cipher.seal(spec.tenant_id, key_id, aadFor(base, path, sha), plain);
        const object_sha256 = await sha256Hex(sealed), object_key = `${prefix}blobs/${object_sha256}`;
        bytes += sealed.length;
        if (snapshot.value.used + bytes > policy.tenant_quota_bytes) return refuse('checkpoint_quota_exceeded', 403);
        const put = await putVerified(object_key, sealed);
        if (!put.ok) return put;
        files.push({ path, sha256: sha, size: plain.length, object_key, object_sha256 }); keys.push(object_key);
      }
      const head = snapshot.value.head;
      const manifest: CheckpointManifest = { schema_version: CHECKPOINT_SCHEMA_VERSION, workspace_version: WORKSPACE_VERSION,
        tenant_id: spec.tenant_id, company_id: spec.company_id, project_id: spec.project_id, run_id: spec.run_id, attempt: spec.attempt,
        execution_generation: spec.execution_generation, sequence: (head?.sequence ?? 0) + 1, idempotency_token: token, repo_id: spec.repo_id,
        base_sha: spec.base_sha, tree_hash, artifact_hash: await artifactHash(files, deleted), image_digest: spec.image_digest, created_at: clock(),
        regions: { origin: snapshot.value.origin!, allowed: [...spec.allowed_regions] }, path_allowlist: [...spec.scope_paths],
        encryption: { algorithm: 'AES-256-GCM', key_scope: 'tenant', key_id, aad: 'workspace-checkpoint-v1' },
        files, deleted, previous_manifest_sha256: head?.manifest_sha256 ?? null };
      const valid = await validateCheckpointManifest(manifest);
      if (!valid.ok) return valid;
      const manifestBytes = canonical(manifest), manifest_key = `${prefix}manifest.json`;
      bytes += manifestBytes.length;
      if (snapshot.value.used + bytes > policy.tenant_quota_bytes) return refuse('checkpoint_quota_exceeded', 403);
      const put = await putVerified(manifest_key, manifestBytes);
      if (!put.ok) return put;
      keys.push(manifest_key);
      const advanced = await pointers.transaction(rows => {
        const row = rows.get(rowKey(spec.tenant_id, spec.run_id));
        if (!row || row.deleted) return refuse('checkpoint_deleted');
        if (row.generation !== spec.execution_generation) return refuse('stale_generation');
        if ((row.head?.sequence ?? 0) !== (head?.sequence ?? 0)) return refuse('checkpoint_conflict');
        if (row.tokens[token]) return refuse('idempotency_conflict');
        const committed: Committed = { sequence: manifest.sequence, manifest_key, manifest_sha256: put.value, bytes, created_at: manifest.created_at, objects: keys, generation: row.generation };
        row.head = committed; row.history.push(committed); row.tokens[token] = { tree_hash, sequence: committed.sequence, manifest_sha256: put.value, manifest_key, bytes };
        return { ok: true as const, value: committed };
      });
      if (!advanced.ok) return advanced;
      return { ok: true, value: { sequence: advanced.value.sequence, manifest_key, manifest_sha256: put.value, bytes, duplicate: false } };
    },

    /**
     * Restore the LAST ACKNOWLEDGED checkpoint on any eligible executor: a fresh checkout of the exact base SHA from that
     * executor's own tenant-scoped cache, under the same image digest, then every blob and the tree hash verified.
     */
    async restore({ spec, cache, capabilities, region }: { spec: WorkspaceSpec; cache: GitCache; capabilities: ExecutorCapabilities; region: string }):
      Promise<WorkspaceResult<{ worktree: Worktree; sequence: number; manifest_sha256: string; restored_bytes: number; not_migrated: typeof NOT_MIGRATED }>> {
      const parsed = workspaceSpecSchema.safeParse(spec);
      if (!parsed.success) return refuse(isExactSha((spec as WorkspaceSpec | null)?.base_sha) ? 'invalid_workspace_spec' : 'invalid_base_sha', 422);
      const gate = executorEligibility(spec, capabilities);
      if (!gate.ok) return gate;
      if (capabilities.checkpoint_restore !== true) return refuse('capability_denied', 422, 'checkpoint_restore');
      if (cache.provider !== capabilities.provider || cache.region !== region || !capabilities.enforced_regions.includes(region) || !spec.allowed_regions.includes(region)) return refuse('region_not_allowed', 403);
      const row = await pointers.transaction(rows => structuredClone(rows.get(rowKey(spec.tenant_id, spec.run_id)) ?? null));
      if (!row || row.tenant_id !== spec.tenant_id) return refuse('checkpoint_not_found', 403);
      if (row.deleted) return refuse('checkpoint_deleted');
      if (spec.execution_generation !== row.generation) return refuse('stale_generation');
      if (!row.head) return refuse('no_checkpoint');
      const read = await readObject(row.head.manifest_key);
      if (!read.ok) return read;
      const raw = read.value;
      if (!raw || await sha256Hex(raw) !== row.head.manifest_sha256) return refuse('checksum_mismatch', 422);
      let decoded: unknown;
      try { decoded = JSON.parse(new TextDecoder().decode(raw)); } catch { return refuse('invalid_checkpoint_manifest', 422); }
      const valid = await validateCheckpointManifest(decoded);
      if (!valid.ok) return valid;
      const m = valid.value;
      if (m.tenant_id !== spec.tenant_id || m.company_id !== spec.company_id || m.project_id !== spec.project_id || m.run_id !== spec.run_id) return refuse('tenant_mismatch', 403);
      if (!m.regions.allowed.includes(region)) return refuse('region_not_allowed', 403);
      if (m.repo_id !== spec.repo_id || m.base_sha !== spec.base_sha) return refuse('base_sha_mismatch', 409);
      if (m.image_digest !== spec.image_digest) return refuse('image_digest_mismatch', 409);
      if (m.sequence !== row.head.sequence) return refuse('checksum_mismatch', 422);
      if ([...m.files.map(f => f.path), ...m.deleted].some(p => !inScope(p, spec.scope_paths))) return refuse('path_not_allowed', 422);
      const checkout = await cache.checkout(spec);
      if (!checkout.ok) return checkout;
      const worktree = checkout.value, fail = (code: string, status: 403 | 409 | 422 | 503 = 422) => { worktree.release(); return refuse(code, status); };
      let restored_bytes = 0;
      for (const path of m.deleted) if (!worktree.remove(path).ok) return fail('restore_verification_failed');
      for (const f of m.files) {
        const got = await readObject(f.object_key);
        if (!got.ok) { worktree.release(); return got; }
        const sealed = got.value;
        if (!sealed || await sha256Hex(sealed) !== f.object_sha256) return fail('checksum_mismatch');
        const plain = await cipher.open(spec.tenant_id, m.encryption.key_id, aadFor(m, f.path, f.sha256), sealed);
        if (!plain || plain.length !== f.size || await sha256Hex(plain) !== f.sha256) return fail('checksum_mismatch');
        if (!worktree.write(f.path, plain).ok) return fail('path_not_allowed');
        restored_bytes += sealed.length;
      }
      if (await worktree.treeHash() !== m.tree_hash) return fail('restore_verification_failed');
      return { ok: true, value: { worktree, sequence: m.sequence, manifest_sha256: row.head.manifest_sha256, restored_bytes, not_migrated: NOT_MIGRATED } };
    },

    /** Superseded checkpoints beyond `keep_last` AND older than the TTL, plus fenced-generation staged objects. The head is never planned. */
    async retentionPlan(tenant_id: number, run_id: string): Promise<WorkspaceResult<GcPlan>> {
      const row = await pointers.transaction(rows => structuredClone(rows.get(rowKey(tenant_id, run_id)) ?? null));
      if (!row || row.tenant_id !== tenant_id) return refuse('checkpoint_not_found', 403);
      const now = clock(), keep = new Set<string>();
      const ordered = [...row.history].sort((a, b) => b.sequence - a.sequence);
      ordered.forEach((c, i) => { if (c === ordered[0] || i < policy.keep_last || now < c.created_at + policy.ttl_ms) for (const k of c.objects) keep.add(k); });
      const listed = row.deleted ? [] : await objects.list(checkpointPrefix(tenant_id, run_id));
      const referenced = new Set(row.history.flatMap(c => c.objects));
      const doomed = new Set<string>();
      for (const c of row.history) for (const k of c.objects) if (!keep.has(k)) doomed.add(k);
      for (const { key } of listed) {
        const gen = Number(/\/g(\d+)\//.exec(key.slice(checkpointPrefix(tenant_id, run_id).length - 1))?.[1]);
        if (!referenced.has(key) && Number.isSafeInteger(gen) && gen < row.generation) doomed.add(key);
      }
      return { ok: true, value: { tenant_id, run_id, generation: row.generation, sequence: row.head?.sequence ?? 0, delete: [...doomed].sort(), reason: 'retention' } };
    },
    /** Explicit tenant request: fence all writers (generation + 1), tombstone the pointer, plan every object of the run. */
    async deleteRun(tenant_id: number, run_id: string, expected_generation: number): Promise<WorkspaceResult<GcPlan>> {
      const row = await pointers.transaction(rows => {
        const r = rows.get(rowKey(tenant_id, run_id));
        if (!r || r.tenant_id !== tenant_id) return null;
        if (r.generation !== expected_generation) return 'stale' as const;
        r.generation++; r.deleted = true; r.head = null;
        return structuredClone(r);
      });
      if (row === null) return refuse('checkpoint_not_found', 403);
      if (row === 'stale') return refuse('stale_generation');
      const listed = await objects.list(checkpointPrefix(tenant_id, run_id));
      const keys = new Set([...row.history.flatMap(c => c.objects), ...listed.map(o => o.key)]);
      return { ok: true, value: { tenant_id, run_id, generation: row.generation, sequence: 0, delete: [...keys].sort(), reason: 'run_deleted' } };
    },
    /** Executes a plan only if the run's generation and head are what the plan saw; a stale GC is refused before any delete. */
    async executePlan(plan: GcPlan): Promise<WorkspaceResult<{ deleted: number }>> {
      const prefix = checkpointPrefix(plan.tenant_id, plan.run_id);
      if (plan.delete.some(k => !k.startsWith(prefix))) return refuse('gc_scope_violation', 403);
      const fresh = await pointers.transaction(rows => {
        const r = rows.get(rowKey(plan.tenant_id, plan.run_id));
        if (!r || r.tenant_id !== plan.tenant_id || r.generation !== plan.generation || (r.head?.sequence ?? 0) !== plan.sequence) return false;
        if (r.head && plan.delete.some(k => r.head!.objects.includes(k))) return false;
        if (plan.reason === 'run_deleted') r.history = [];
        else { const gone = new Set(plan.delete); r.history = r.history.filter(c => !c.objects.every(k => gone.has(k))); }
        return true;
      });
      if (!fresh) return refuse('stale_gc');
      let deleted = 0;
      for (const key of plan.delete) {
        try { await objects.delete(key); deleted++; }
        catch (e) { return portCode(e, ['stale_gc']) ? refuse('stale_gc') : refuse('checkpoint_store_unavailable', 503); }
      }
      return { ok: true, value: { deleted } };
    },
    /** Same-tenant, origin-region export of the acknowledged head: keys and checksums, plus the egress it would cost. */
    async exportPlan(tenant_id: number, run_id: string, region: string): Promise<WorkspaceResult<{ manifest_key: string; manifest_sha256: string; objects: string[]; egress_bytes: number }>> {
      const row = await pointers.transaction(rows => structuredClone(rows.get(rowKey(tenant_id, run_id)) ?? null));
      if (!row || row.tenant_id !== tenant_id) return refuse('checkpoint_not_found', 403);
      if (row.deleted || !row.head) return refuse('no_checkpoint');
      if (region !== row.origin_region) return refuse('region_not_allowed', 403);
      return { ok: true, value: { manifest_key: row.head.manifest_key, manifest_sha256: row.head.manifest_sha256, objects: [...row.head.objects], egress_bytes: row.head.bytes } };
    },
    async usage(tenant_id: number): Promise<{ checkpoints: number; bytes: number; max_bytes: number }> {
      return pointers.transaction(rows => {
        let checkpoints = 0, bytes = 0, max_bytes = 0;
        for (const r of rows.values()) if (r.tenant_id === tenant_id) for (const c of r.history) { checkpoints++; bytes += c.bytes; max_bytes = Math.max(max_bytes, c.bytes); }
        return { checkpoints, bytes, max_bytes };
      });
    },
  };
  return service;
}

export type WorkspaceMetricsReport = { source: 'local_fake_adapter' | 'measured'; github_push_count: number; clone_bytes: number;
  cache_hits: number; cache_misses: number; cache_hit_pct: number; disk_bytes: number; disk_cost_microusd: number;
  checkpoint_count: number; checkpoint_bytes: number; checkpoint_bytes_max: number };
/** Counts and bytes only. The disk rate is an operator-supplied input, never a hard-coded price claim. */
export function workspaceMetricsReport(input: { source: WorkspaceMetricsReport['source']; github_push_count: number;
  caches: { stats: { clone_bytes: number; cache_hits: number; cache_misses: number }; disk_bytes: number }[];
  checkpoints: { checkpoints: number; bytes: number; max_bytes: number }[]; disk_microusd_per_gb_hour: number; hours: number }): WorkspaceMetricsReport {
  const sum = <T>(rows: T[], pick: (row: T) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const hits = sum(input.caches, c => c.stats.cache_hits), misses = sum(input.caches, c => c.stats.cache_misses);
  const disk = sum(input.caches, c => c.disk_bytes);
  return { source: input.source, github_push_count: input.github_push_count, clone_bytes: sum(input.caches, c => c.stats.clone_bytes),
    cache_hits: hits, cache_misses: misses, cache_hit_pct: hits + misses ? Math.round(hits * 10000 / (hits + misses)) / 100 : 0,
    disk_bytes: disk, disk_cost_microusd: Math.round(disk / 1e9 * input.disk_microusd_per_gb_hour * input.hours),
    checkpoint_count: sum(input.checkpoints, c => c.checkpoints), checkpoint_bytes: sum(input.checkpoints, c => c.bytes),
    checkpoint_bytes_max: input.checkpoints.reduce((m, c) => Math.max(m, c.max_bytes), 0) };
}
