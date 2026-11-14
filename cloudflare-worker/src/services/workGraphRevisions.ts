/**
 * D5581 part 1 (#5581, WorkGraph P0 under the #5577 epic) — the WorkGraph revision registry over D1: immutable
 * revisions in a same-asset parent DAG, an accepted head advanced only by compare-and-swap, the dependency DAG
 * (read, write, derived and composite-component edges) with cycle and staleness detection, one-way tombstones
 * under legal holds, and an append-only event trail. Preview-only: no route, no binding, no R2 call.
 *
 * It builds on D5579's contracts (`workGraphContracts.ts`): every record it admits is first checked by
 * `validateWorkGraph`, so scope, authority, digest format, Git SHA, revoked authors, agent approvals and stale
 * approvals are refused with D5579's own codes. This file adds what needs the database:
 *
 *   CAS          `advanceHead` moves `work_graph_assets.head_revision_uid` with ONE conditional UPDATE: it changes a
 *                row only while the head IS the caller's expected revision, the new revision is live, and none of
 *                its dependency edges is pinned to a revision that is no longer its asset's head. The audit row is
 *                in the same batch (`WHERE changes() > 0`), so a move and its record land together or not at all.
 *                A revision may replace a head only if that head is among its parents, so the head walks forward
 *                along the DAG: a stale writer can never overwrite work it did not build on, and A→B→A cannot recur.
 *   Idempotency  every write carries a key, unique per (tenant, company). A retry with the same key and the same
 *                request returns the first result and writes nothing (a lost or late callback); the same key with a
 *                different request is refused (`idempotency_conflict`).
 *   Cycles       a new revision's dependencies are walked through each dependency asset's head edges with one
 *                recursive query; reaching the revision's own asset is `cyclic_dependency`.
 *   Staleness    read, never stored: an edge is stale when its pinned revision is not its asset's head now.
 *                `impactOf` names every output revision built on a revision, transitively, and the approvals
 *                recorded on those outputs' head moves, which a dependency's new head invalidates.
 *   Cost         every call returns `cost` (`d1Statements`, `d1Batches`): the D1 statements it issued (#5581).
 *
 * PART 3 (D5581-p3.md) adds, at the head swap: the bytes of a WorkGraph-held revision (`r2_object` / `FILES` /
 * `wg/v1/…`, `workGraphBlobs.ts`) are re-read and checked against its digest before the CAS (`bytes_unverified`),
 * its residency must fit the bucket's jurisdiction, a revision flagged `bytes_missing`, `bytes_deleted`, `offline` or
 * `residency_mismatch` never becomes a head (re-checked inside the CAS), and, while `WORK_GRAPH_LEASES` is on and the
 * caller brings a fence, part 2's `assertFence` runs first (`stale_fence`, `no_capability`). Domain-held bytes are
 * pointed at, never re-verified here. Per-tenant asset and version caps hold inside the inserts (`tenant_limit`).
 * This file stores digests only; no content, preview or model text ever reaches a column.
 */
import type { Env } from '../types';
import {
  WORK_GRAPH_BLOB_DEPS, blobKey, integrityEventStatement, isWorkGraphBlobSource, residencyAllowed, verifyBlob,
} from './workGraphBlobs';
import { assertFence, leasesOn, type LeaseHolder, type LeaseUnit, type WriteCapability } from './workGraphLeases';
import {
  ACCESS_CLASSES, IMMUTABLE_KINDS, sha256Hex, validateWorkGraph,
  type AccessClass, type Actor, type ArtifactVersion, type Asset, type AssetKind, type Scope, type SourceRef,
  type ValidationContext, type Violation, type ViolationCode, type WorkGraph,
} from './workGraphContracts';

/** Limits per asset and revision. Defaults; a tenant plan may lower them (a later part reads plans). */
export const WORK_GRAPH_LIMITS = Object.freeze({
  /** Bytes one revision may describe (R2 single-object ceiling is larger; this is WorkGraph's cap). */
  maxRevisionBytes: 2 * 1024 * 1024 * 1024,
  maxVersionsPerAsset: 500,
  maxParents: 8,
  maxDependencies: 64,
  /** Depth the cycle and impact walks follow before stopping. */
  maxWalkDepth: 32,
  /** Per tenant, across its companies (D5581 part 3). Held inside the insert, so they hold under concurrency. */
  maxAssetsPerTenant: 10_000,
  maxVersionsPerTenant: 250_000,
});
export type WorkGraphLimits = typeof WORK_GRAPH_LIMITS;

/** The clock and id source, swappable in tests (D5614: tests never read the real clock). */
export const WORK_GRAPH_DEPS = {
  now: (): Date => new Date(),
  newId: (): string => crypto.randomUUID(),
};

export const DEPENDENCY_KINDS = ['read', 'write', 'derived', 'component'] as const;
export type DependencyKind = (typeof DEPENDENCY_KINDS)[number];

export type RefusalCode =
  | ViolationCode
  | 'not_found' | 'idempotency_conflict' | 'size_limit' | 'max_versions' | 'not_descendant' | 'stale_dependency'
  | 'composite_incompatible' | 'tombstoned' | 'legal_hold' | 'is_head' | 'approval_required' | 'person_required'
  // part 3
  | 'tenant_limit' | 'bytes_unverified' | 'residency_mismatch' | 'offline' | 'stale_fence' | 'no_capability';

/**
 * D1 statements and batches the call issued. `r2ClassB` (heads and gets) and `doCalls` (lease checks) appear only on
 * a call that made them (part 3), so a call that touched neither reads exactly as it did in part 1.
 */
export interface Cost { d1Statements: number; d1Batches: number; r2ClassB?: number; doCalls?: number }

export interface Refusal {
  ok: false;
  code: RefusalCode;
  /** Ids involved, never content. */
  ids: string[];
  /** On a stale write: the head the writer must rebase on. */
  currentHead?: { revisionUid: string | null; headSeq: number };
  violations?: Violation[];
  cost: Cost;
}

export interface Dependency { kind: DependencyKind; assetUid: string; revisionUid: string }

const HEX64 = /^[0-9a-f]{64}$/;

/** Counts D1 statements as they are issued. The SQL stays a literal at each `prepare` so the schema guards read it. */
class Meter {
  cost: Cost = { d1Statements: 0, d1Batches: 0 };
  first<T>(s: D1PreparedStatement): Promise<T | null> { this.cost.d1Statements++; return s.first<T>(); }
  async all<T>(s: D1PreparedStatement): Promise<T[]> { this.cost.d1Statements++; return ((await s.all<T>()).results ?? []) as T[]; }
  run(s: D1PreparedStatement) { this.cost.d1Statements++; return s.run(); }
  batch(list: D1PreparedStatement[]) { this.cost.d1Statements += list.length; this.cost.d1Batches++; return this.env.DB.batch(list); }
  /** Spend made outside this meter's own statements: R2 reads, lease calls and the lease audit's D1 batch. */
  add(extra: { r2ClassB?: number; doCalls?: number; d1Statements?: number }) {
    if (extra.r2ClassB) this.cost.r2ClassB = (this.cost.r2ClassB ?? 0) + extra.r2ClassB;
    if (extra.doCalls) this.cost.doCalls = (this.cost.doCalls ?? 0) + extra.doCalls;
    if (extra.d1Statements) { this.cost.d1Statements += extra.d1Statements; this.cost.d1Batches++; }
  }
  private env: Pick<Env, 'DB'>;
  constructor(env: Pick<Env, 'DB'>) { this.env = env; }
  refuse(code: RefusalCode, ids: string[], extra: Partial<Refusal> = {}): Refusal {
    return { ok: false, code, ids, ...extra, cost: { ...this.cost } };
  }
}

function canonical(v: unknown): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}
const requestHash = (op: string, body: unknown) => sha256Hex(new TextEncoder().encode(canonical({ op, body })));

function actorColumns(a: Actor): [string, number, string | null, string | null] {
  return a.kind === 'person' ? ['person', a.userId, null, null] : ['agent', a.onBehalfOfUserId, a.agentRunId, a.chargeId];
}
function actorMalformed(a: Actor | undefined): boolean {
  if (!a) return true;
  if (a.kind === 'person') return !(Number.isInteger(a.userId) && a.userId > 0);
  if (a.kind === 'agent') {
    return !(typeof a.agentRunId === 'string' && a.agentRunId.length > 0 && a.agentRunId.length <= 200
      && Number.isInteger(a.onBehalfOfUserId) && a.onBehalfOfUserId > 0);
  }
  return true;
}
const keyOk = (k: unknown): k is string => typeof k === 'string' && k.length >= 1 && k.length <= 200;

interface AssetRow {
  asset_uid: string; tenant_id: number; company_id: number; project_id: number | null; kind: string;
  access_class: string; approval_policy: string; head_revision_uid: string | null; head_seq: number; version_count: number;
}
interface RevisionRow {
  revision_uid: string; asset_uid: string; tenant_id: number; company_id: number; project_id: number | null; seq: number;
  parent_uids_json: string; digest: string; byte_length: number; media_profile: string; source_store: string;
  source_locator: string; source_id: string; source_revision: string; actor_kind: string; actor_user_id: number;
  agent_run_id: string | null; charge_id: string | null; created_at: string; legal_hold: number; tombstoned_at: string | null; residency?: string | null;
}

const scopeOf = (r: { tenant_id: number; company_id: number; project_id: number | null }): Scope =>
  ({ tenantId: r.tenant_id, companyId: r.company_id, projectId: r.project_id });

function assetOf(r: AssetRow): Asset {
  return {
    id: r.asset_uid, scope: scopeOf(r), kind: r.kind as AssetKind, headVersionId: r.head_revision_uid,
    accessClass: r.access_class as AccessClass, approvalPolicy: r.approval_policy,
  };
}
function versionOf(r: RevisionRow): ArtifactVersion {
  const author: Actor = r.actor_kind === 'agent'
    ? { kind: 'agent', agentRunId: r.agent_run_id ?? '', onBehalfOfUserId: r.actor_user_id, chargeId: r.charge_id }
    : { kind: 'person', userId: r.actor_user_id };
  return {
    id: r.revision_uid, assetId: r.asset_uid, scope: scopeOf(r), parents: JSON.parse(r.parent_uids_json) as string[],
    digest: r.digest, byteLength: r.byte_length, mediaProfile: r.media_profile,
    source: { store: r.source_store as SourceRef['store'], locator: r.source_locator, id: r.source_id, revision: r.source_revision },
    recipe: null, residency: null, license: null, author, createdAt: r.created_at, expiresAt: null,
  };
}

async function readAsset(env: Pick<Env, 'DB'>, m: Meter, assetUid: string): Promise<AssetRow | null> {
  return m.first<AssetRow>(env.DB.prepare(
    'SELECT asset_uid, tenant_id, company_id, project_id, kind, access_class, approval_policy, head_revision_uid, head_seq, version_count FROM work_graph_assets WHERE asset_uid = ?',
  ).bind(assetUid));
}

/** The caller may act on the asset: D5579's own scope rule (a company-wide caller covers its projects). */
function scopeRefusal(m: Meter, ctx: ValidationContext, asset: Asset): Refusal | null {
  const v = validateWorkGraph({ assets: [{ ...asset, headVersionId: null }] }, ctx);
  return v.length ? m.refuse(v[0].code, [asset.id], { violations: v }) : null;
}

/** A tenant-limit refusal, audited in part 3's integrity trail (part 1's event actions have no row for it). */
async function limitRefused(
  env: Pick<Env, 'DB'>, m: Meter, scope: Scope, assetUid: string | null, actor: Actor, what: 'assets' | 'versions', max: number, at: string,
): Promise<void> {
  await m.run(integrityEventStatement(env.DB, {
    tenantId: scope.tenantId, companyId: scope.companyId, assetUid, actor, action: 'limit_refused', outcome: 'refused',
    refusalCode: 'tenant_limit', detail: { limit: what, max },
    cost: { d1Statements: m.cost.d1Statements + 1, d1Batches: m.cost.d1Batches, r2ClassA: 0, r2ClassB: m.cost.r2ClassB ?? 0 }, at,
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// Assets

export interface RegisterAssetInput {
  scope: Scope;
  kind: AssetKind;
  accessClass: AccessClass;
  approvalPolicy: string;
  actor: Actor;
  idempotencyKey: string;
}
export type RegisterAssetResult = { ok: true; assetUid: string; replayed: boolean; cost: Cost } | Refusal;

export async function registerAsset(
  env: Pick<Env, 'DB'>, ctx: ValidationContext, input: RegisterAssetInput, limits: WorkGraphLimits = WORK_GRAPH_LIMITS,
): Promise<RegisterAssetResult> {
  const m = new Meter(env);
  if (!keyOk(input.idempotencyKey) || actorMalformed(input.actor)
    || !(ACCESS_CLASSES as readonly string[]).includes(input.accessClass)
    || typeof input.approvalPolicy !== 'string' || !input.approvalPolicy || input.approvalPolicy.length > 80) {
    return m.refuse('malformed', []);
  }
  const draft: Asset = { id: 'new', scope: input.scope, kind: input.kind, headVersionId: null, accessClass: input.accessClass, approvalPolicy: input.approvalPolicy };
  const scoped = scopeRefusal(m, ctx, draft);
  if (scoped) return scoped;
  const hash = await requestHash('registerAsset', input);

  const replay = async (): Promise<RegisterAssetResult | null> => {
    const prior = await m.first<{ asset_uid: string; request_hash: string }>(env.DB.prepare(
      'SELECT asset_uid, request_hash FROM work_graph_assets WHERE tenant_id = ? AND company_id = ? AND idempotency_key = ?',
    ).bind(input.scope.tenantId, input.scope.companyId, input.idempotencyKey));
    if (!prior) return null;
    if (prior.request_hash !== hash) return m.refuse('idempotency_conflict', [prior.asset_uid]);
    return { ok: true, assetUid: prior.asset_uid, replayed: true, cost: { ...m.cost } };
  };
  const prior = await replay();
  if (prior) return prior;

  const uid = `wga_${WORK_GRAPH_DEPS.newId()}`;
  const at = WORK_GRAPH_DEPS.now().toISOString();
  const [kind, userId, runId, chargeId] = actorColumns(input.actor);
  let results: D1Result[];
  try {
    results = await m.batch([
      // The tenant's asset cap holds inside the insert (part 3): no asset row, no event row.
      env.DB.prepare(
        `INSERT INTO work_graph_assets (asset_uid, tenant_id, company_id, project_id, kind, access_class, approval_policy,
           created_by_user_id, idempotency_key, request_hash, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE (SELECT COUNT(*) FROM work_graph_assets WHERE tenant_id = ?) < ?`,
      ).bind(uid, input.scope.tenantId, input.scope.companyId, input.scope.projectId, input.kind, input.accessClass,
        input.approvalPolicy, userId, input.idempotencyKey, hash, at, input.scope.tenantId, limits.maxAssetsPerTenant),
      env.DB.prepare(
        `INSERT INTO work_graph_events (tenant_id, company_id, project_id, asset_uid, action, actor_kind, actor_user_id,
           agent_run_id, charge_id, outcome, idempotency_key, request_hash, created_at)
         SELECT ?, ?, ?, ?, 'register_asset', ?, ?, ?, ?, 'applied', ?, ?, ? WHERE changes() > 0`,
      ).bind(input.scope.tenantId, input.scope.companyId, input.scope.projectId, uid, kind, userId, runId, chargeId,
        input.idempotencyKey, hash, at),
    ]);
  } catch (e) {
    const raced = await replay();
    if (raced) return raced;
    throw e;
  }
  if (Number(results[0]?.meta?.changes ?? 0) === 0) {
    await limitRefused(env, m, input.scope, null, input.actor, 'assets', limits.maxAssetsPerTenant, at);
    return m.refuse('tenant_limit', ['assets', String(limits.maxAssetsPerTenant)]);
  }
  return { ok: true, assetUid: uid, replayed: false, cost: { ...m.cost } };
}

// ---------------------------------------------------------------------------------------------------------------
// Revisions

export interface CreateRevisionInput {
  assetUid: string;
  parents: string[];
  digest: string;
  byteLength: number;
  mediaProfile: string;
  source: SourceRef;
  recipe?: string | null;
  residency?: string | null;
  license?: string | null;
  expiresAt?: string | null;
  author: Actor;
  idempotencyKey: string;
  /** The read set, write set, derivations and (composite only) the component revisions this revision pins. */
  dependencies?: Dependency[];
}
export type CreateRevisionResult =
  | { ok: true; revisionUid: string; seq: number; replayed: boolean; cost: Cost }
  | Refusal;

export async function createRevision(
  env: Pick<Env, 'DB'>, ctx: ValidationContext, input: CreateRevisionInput, limits: WorkGraphLimits = WORK_GRAPH_LIMITS,
): Promise<CreateRevisionResult> {
  const m = new Meter(env);
  const deps = input.dependencies ?? [];
  const parents = Array.isArray(input.parents) ? input.parents : [];
  if (!keyOk(input.idempotencyKey) || actorMalformed(input.author) || typeof input.assetUid !== 'string'
    || !Array.isArray(input.parents) || parents.some((p) => typeof p !== 'string')
    || new Set(parents).size !== parents.length
    || deps.some((d) => !(DEPENDENCY_KINDS as readonly string[]).includes(d?.kind) || typeof d.assetUid !== 'string' || typeof d.revisionUid !== 'string')) {
    return m.refuse('malformed', [String(input.assetUid)]);
  }
  if (!HEX64.test(String(input.digest))) return m.refuse('malformed', [input.assetUid]);
  if (!Number.isSafeInteger(input.byteLength) || input.byteLength < 0) return m.refuse('malformed', [input.assetUid]);
  if (input.byteLength > limits.maxRevisionBytes) return m.refuse('size_limit', [input.assetUid, String(limits.maxRevisionBytes)]);
  if (parents.length > limits.maxParents || deps.length > limits.maxDependencies) return m.refuse('size_limit', [input.assetUid]);

  const row = await readAsset(env, m, input.assetUid);
  if (!row) return m.refuse('not_found', [input.assetUid]);
  const asset = assetOf(row);
  const scoped = scopeRefusal(m, ctx, asset);
  if (scoped) return scoped;

  const hash = await requestHash('createRevision', input);
  const replay = async (): Promise<CreateRevisionResult | null> => {
    const prior = await m.first<{ revision_uid: string; seq: number; request_hash: string }>(env.DB.prepare(
      'SELECT revision_uid, seq, request_hash FROM work_graph_revisions WHERE tenant_id = ? AND company_id = ? AND idempotency_key = ?',
    ).bind(row.tenant_id, row.company_id, input.idempotencyKey));
    if (!prior) return null;
    if (prior.request_hash !== hash) return m.refuse('idempotency_conflict', [prior.revision_uid]);
    return { ok: true, revisionUid: prior.revision_uid, seq: prior.seq, replayed: true, cost: { ...m.cost } };
  };
  const prior = await replay();
  if (prior) return prior;

  if (row.version_count >= limits.maxVersionsPerAsset) return m.refuse('max_versions', [input.assetUid, String(limits.maxVersionsPerAsset)]);

  // Parents: live revisions of this asset. D5579's validator checks lineage, scope, authority, digest and author.
  const parentRows = parents.length ? await m.all<RevisionRow>(env.DB.prepare(
    `SELECT revision_uid, asset_uid, tenant_id, company_id, project_id, seq, parent_uids_json, digest, byte_length, media_profile,
            source_store, source_locator, source_id, source_revision, actor_kind, actor_user_id, agent_run_id, charge_id,
            created_at, legal_hold, tombstoned_at
       FROM work_graph_revisions WHERE revision_uid IN (SELECT value FROM json_each(?))`,
  ).bind(JSON.stringify(parents))) : [];
  const deadParent = parentRows.find((p) => p.tombstoned_at !== null);
  if (deadParent) return m.refuse('tombstoned', [deadParent.revision_uid]);

  const uid = `wgr_${WORK_GRAPH_DEPS.newId()}`;
  const at = WORK_GRAPH_DEPS.now().toISOString();
  const candidate: ArtifactVersion = {
    id: uid, assetId: asset.id, scope: asset.scope, parents, digest: input.digest, byteLength: input.byteLength,
    mediaProfile: input.mediaProfile, source: input.source, recipe: input.recipe ?? null, residency: input.residency ?? null,
    license: input.license ?? null, author: input.author, createdAt: at, expiresAt: input.expiresAt ?? null,
  };
  // Parents are context here, admitted when they were written: only the new version and its author are checked.
  const parentVersions = parentRows.map((p) => ({ ...versionOf(p), parents: [], author: input.author }));
  const graph: WorkGraph = { assets: [{ ...asset, headVersionId: null }], versions: [...parentVersions, candidate] };
  const violations = validateWorkGraph(graph, ctx);
  if (violations.length) return m.refuse(violations[0].code, [uid, ...violations[0].ids], { violations });
  if (typeof input.mediaProfile !== 'string' || !input.mediaProfile || input.mediaProfile.length > 120) return m.refuse('malformed', [uid]);
  // WorkGraph-held bytes live under this asset's own tenant and company, at the key of this digest (part 3).
  if (isWorkGraphBlobSource(input.source)
    && (input.source.id !== blobKey(asset.scope, input.digest) || input.source.revision !== input.digest)) {
    return m.refuse('malformed', [uid, 'blob_key']);
  }

  // Dependencies: other assets' live revisions, in the same tenant and company, pinned at their current head.
  const isComposite = asset.kind === 'composite';
  // Components belong to composites, and a composite is nothing but its pinned components.
  if (deps.some((d) => d.kind === 'component') !== isComposite) return m.refuse('malformed', [uid]);
  if (deps.some((d) => d.assetUid === asset.id)) return m.refuse('cyclic_dependency', [asset.id]);
  if (deps.length) {
    const depRows = await m.all<{
      revision_uid: string; asset_uid: string; tombstoned_at: string | null; tenant_id: number; company_id: number;
      project_id: number | null; kind: string; access_class: string; approval_policy: string; head_revision_uid: string | null;
    }>(env.DB.prepare(
      `SELECT r.revision_uid, r.asset_uid, r.tombstoned_at, a.tenant_id, a.company_id, a.project_id, a.kind, a.access_class,
              a.approval_policy, a.head_revision_uid
         FROM work_graph_revisions r JOIN work_graph_assets a ON a.asset_uid = r.asset_uid
        WHERE r.revision_uid IN (SELECT value FROM json_each(?))`,
    ).bind(JSON.stringify(deps.map((d) => d.revisionUid))));
    const byUid = new Map(depRows.map((r) => [r.revision_uid, r]));
    for (const d of deps) {
      const r = byUid.get(d.revisionUid);
      if (!r || r.asset_uid !== d.assetUid) return m.refuse('unknown_reference', [uid, d.revisionUid]);
      const depAsset: Asset = {
        id: r.asset_uid, scope: scopeOf(r), kind: r.kind as AssetKind, headVersionId: null,
        accessClass: r.access_class as AccessClass, approvalPolicy: r.approval_policy,
      };
      // The caller's scope is one company, so this also keeps every edge inside the asset's own company.
      const v = validateWorkGraph({ assets: [depAsset] }, ctx);
      if (v.length) return m.refuse('wrong_tenant', [uid, d.assetUid], { violations: v });
      if (r.tombstoned_at !== null) return m.refuse('tombstoned', [d.revisionUid]);
      if (r.head_revision_uid !== d.revisionUid) {
        return m.refuse(isComposite ? 'composite_incompatible' : 'stale_dependency', [d.assetUid, d.revisionUid, String(r.head_revision_uid)]);
      }
    }
    // Cycle: does any dependency asset (through its head's edges) already depend on this asset?
    const hit = await m.first<{ asset_uid: string }>(env.DB.prepare(
      `WITH RECURSIVE reach(asset_uid, depth) AS (
         SELECT value, 0 FROM json_each(?)
         UNION
         SELECT e.to_asset_uid, reach.depth + 1
           FROM reach
           JOIN work_graph_assets a ON a.asset_uid = reach.asset_uid
           JOIN work_graph_edges e ON e.from_revision_uid = a.head_revision_uid
          WHERE reach.depth < ?
       )
       SELECT asset_uid FROM reach WHERE asset_uid = ? LIMIT 1`,
    ).bind(JSON.stringify([...new Set(deps.map((d) => d.assetUid))]), limits.maxWalkDepth, asset.id));
    if (hit) return m.refuse('cyclic_dependency', [asset.id, ...new Set(deps.map((d) => d.assetUid))]);
  }

  const [kind, userId, runId, chargeId] = actorColumns(input.author);
  const stmts: D1PreparedStatement[] = [
    // The version cap holds inside the write: a revision is inserted only while the asset is under it.
    env.DB.prepare(
      `INSERT INTO work_graph_revisions (revision_uid, asset_uid, tenant_id, company_id, project_id, seq, parent_uids_json,
         digest, byte_length, media_profile, source_store, source_locator, source_id, source_revision, recipe, residency,
         license, actor_kind, actor_user_id, agent_run_id, charge_id, idempotency_key, request_hash, created_at, expires_at)
       SELECT ?, a.asset_uid, a.tenant_id, a.company_id, a.project_id, a.version_count + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         FROM work_graph_assets a WHERE a.asset_uid = ? AND a.version_count < ?
          AND (SELECT COUNT(*) FROM work_graph_revisions t WHERE t.tenant_id = a.tenant_id) < ?`,
    ).bind(uid, JSON.stringify(parents), input.digest, input.byteLength, input.mediaProfile, input.source.store,
      input.source.locator, input.source.id, input.source.revision, input.recipe ?? null, input.residency ?? null,
      input.license ?? null, kind, userId, runId, chargeId, input.idempotencyKey, hash, at, input.expiresAt ?? null,
      asset.id, limits.maxVersionsPerAsset, limits.maxVersionsPerTenant),
    env.DB.prepare(
      `UPDATE work_graph_assets SET version_count = version_count + 1
        WHERE asset_uid = ? AND EXISTS (SELECT 1 FROM work_graph_revisions r WHERE r.revision_uid = ?)`,
    ).bind(asset.id, uid),
  ];
  for (const d of deps) {
    stmts.push(env.DB.prepare(
      `INSERT INTO work_graph_edges (tenant_id, company_id, from_revision_uid, from_asset_uid, edge_kind, to_asset_uid, to_revision_uid, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM work_graph_revisions r WHERE r.revision_uid = ?)`,
    ).bind(asset.scope.tenantId, asset.scope.companyId, uid, asset.id, d.kind, d.assetUid, d.revisionUid, at, uid));
  }
  stmts.push(env.DB.prepare(
    `INSERT INTO work_graph_events (tenant_id, company_id, project_id, asset_uid, action, actor_kind, actor_user_id,
       agent_run_id, charge_id, base_revision_uid, revision_uid, outcome, idempotency_key, request_hash, created_at)
     SELECT ?, ?, ?, ?, 'create_revision', ?, ?, ?, ?, ?, ?, 'applied', ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM work_graph_revisions r WHERE r.revision_uid = ?)`,
  ).bind(asset.scope.tenantId, asset.scope.companyId, asset.scope.projectId, asset.id, kind, userId, runId, chargeId,
    parents[0] ?? null, uid, input.idempotencyKey, hash, at, uid));

  let results: D1Result[];
  try {
    results = await m.batch(stmts);
  } catch (e) {
    const raced = await replay();
    if (raced) return raced;
    throw e;
  }
  if (Number(results[0]?.meta?.changes ?? 0) === 0) {
    // Which cap held: this asset's, or (part 3) the tenant's.
    const now = await readAsset(env, m, asset.id);
    if (Number(now?.version_count ?? 0) < limits.maxVersionsPerAsset) {
      await limitRefused(env, m, asset.scope, asset.id, input.author, 'versions', limits.maxVersionsPerTenant, at);
      return m.refuse('tenant_limit', ['versions', String(limits.maxVersionsPerTenant)]);
    }
    return m.refuse('max_versions', [asset.id, String(limits.maxVersionsPerAsset)]);
  }
  // The sequence number is the one the insert took inside the batch, never the one read before it.
  const taken = await m.first<{ seq: number }>(env.DB.prepare(
    'SELECT seq FROM work_graph_revisions WHERE revision_uid = ?',
  ).bind(uid));
  return { ok: true, revisionUid: uid, seq: Number(taken?.seq ?? 0), replayed: false, cost: { ...m.cost } };
}

// ---------------------------------------------------------------------------------------------------------------
// The head

export interface Approval {
  /** The approval-inbox item (D5579 §1: reuse, not a second inbox). */
  ref: string;
  /** The exact bytes approved: must equal the revision's digest. */
  contentDigest: string;
  reviewer: Actor;
  decidedAt: string;
}
export interface AdvanceHeadInput {
  assetUid: string;
  /** The head the writer built on: null for an asset's first head. */
  expectedRevisionUid: string | null;
  revisionUid: string;
  actor: Actor;
  approval?: Approval | null;
  idempotencyKey: string;
  /**
   * Part 3: the lease fence the writer holds on `unit`, and the capability its own authorization check produced.
   * Checked with part 2's `assertFence` only while `WORK_GRAPH_LEASES` is on; otherwise ignored, and optimistic
   * concurrency alone decides. The holder is always the actor. Not part of the retry key's request hash.
   */
  fence?: { value: number; unit: LeaseUnit; capability: WriteCapability | null } | null;
}
/** What the head swap may reach beyond D1: the WorkGraph bytes (part 3) and the lease object (part 2). */
export type AdvanceHeadEnv = Pick<Env, 'DB'> & Partial<Pick<Env, 'FILES' | 'WORK_GRAPH_LEASES' | 'WORK_GRAPH_LEASE' | 'BRANCH_DO_JURISDICTION'>>;
export interface ImpactedOutput { assetUid: string; revisionUid: string; edgeKind: DependencyKind; isHead: boolean; depth: number }
export interface InvalidatedApproval { assetUid: string; revisionUid: string; approvalRef: string; approvalDigest: string | null }
export interface Impact { outputs: ImpactedOutput[]; invalidatedApprovals: InvalidatedApproval[] }
export type AdvanceHeadResult =
  | { ok: true; revisionUid: string; previousRevisionUid: string | null; headSeq: number; replayed: boolean; impact: Impact; cost: Cost }
  | Refusal;

/** Approval policies under which a head may move only with a person's approval of the exact bytes (D5579 §1). */
export const APPROVAL_REQUIRED_POLICIES: ReadonlySet<string> = new Set(['human_publication']);

export async function advanceHead(env: AdvanceHeadEnv, ctx: ValidationContext, input: AdvanceHeadInput): Promise<AdvanceHeadResult> {
  const m = new Meter(env);
  if (!keyOk(input.idempotencyKey) || actorMalformed(input.actor) || typeof input.revisionUid !== 'string'
    || (input.expectedRevisionUid !== null && typeof input.expectedRevisionUid !== 'string')
    || (input.fence != null && (!Number.isSafeInteger(input.fence.value) || !input.fence.unit || typeof input.fence.unit !== 'object'))) {
    return m.refuse('malformed', [String(input.assetUid)]);
  }
  const row = await readAsset(env, m, input.assetUid);
  if (!row) return m.refuse('not_found', [input.assetUid]);
  const asset = assetOf(row);
  const scoped = scopeRefusal(m, ctx, asset);
  if (scoped) return scoped;

  // The fence is coordination, not the request: a retry under a re-acquired lease is the same move.
  const { fence: _fence, ...hashed } = input;
  const hash = await requestHash('advanceHead', hashed);
  const replay = async (): Promise<AdvanceHeadResult | null> => {
    const prior = await m.first<{ revision_uid: string; base_revision_uid: string | null; head_seq: number; request_hash: string }>(env.DB.prepare(
      `SELECT revision_uid, base_revision_uid, head_seq, request_hash FROM work_graph_events
        WHERE tenant_id = ? AND company_id = ? AND action = 'advance_head' AND idempotency_key = ?`,
    ).bind(row.tenant_id, row.company_id, input.idempotencyKey));
    if (!prior) return null;
    if (prior.request_hash !== hash) return m.refuse('idempotency_conflict', [prior.revision_uid]);
    // A late or repeated callback: the move already happened once. Its effects are not repeated.
    return {
      ok: true, revisionUid: prior.revision_uid, previousRevisionUid: prior.base_revision_uid, headSeq: prior.head_seq,
      replayed: true, impact: { outputs: [], invalidatedApprovals: [] }, cost: { ...m.cost },
    };
  };
  const prior = await replay();
  if (prior) return prior;

  const rev = await m.first<RevisionRow>(env.DB.prepare(
    `SELECT revision_uid, asset_uid, tenant_id, company_id, project_id, seq, parent_uids_json, digest, byte_length, media_profile,
            source_store, source_locator, source_id, source_revision, actor_kind, actor_user_id, agent_run_id, charge_id,
            created_at, legal_hold, tombstoned_at, residency
       FROM work_graph_revisions WHERE revision_uid = ?`,
  ).bind(input.revisionUid));
  if (!rev || rev.asset_uid !== asset.id) return m.refuse('unknown_reference', [asset.id, input.revisionUid]);
  if (rev.tombstoned_at !== null) return m.refuse('tombstoned', [rev.revision_uid]);
  if (IMMUTABLE_KINDS.has(asset.kind) && row.head_revision_uid !== null) return m.refuse('immutable_record', [asset.id]);
  const version = versionOf(rev);
  if (input.expectedRevisionUid !== null && !version.parents.includes(input.expectedRevisionUid)) {
    return m.refuse('not_descendant', [rev.revision_uid, input.expectedRevisionUid]);
  }

  // Who moves the head, and who approved which bytes: D5579's own ChangeSet/ReviewDecision checks.
  const approval = input.approval ?? null;
  if (APPROVAL_REQUIRED_POLICIES.has(asset.approvalPolicy) && !approval) return m.refuse('approval_required', [asset.id, rev.revision_uid]);
  if (approval && (typeof approval.ref !== 'string' || !approval.ref || approval.ref.length > 200 || actorMalformed(approval.reviewer))) {
    return m.refuse('malformed', [asset.id]);
  }
  const graph: WorkGraph = {
    assets: [{ ...asset, kind: IMMUTABLE_KINDS.has(asset.kind) ? 'document' : asset.kind, headVersionId: null }],
    // Lineage and source authority were admitted at creation; here only the writer and the approval are new.
    versions: [{ ...version, parents: [], author: input.actor }],
    workItems: [{
      id: 'advance', scope: asset.scope, deliverableAssetId: asset.id, modifies: [], baseVersionId: null, dependsOn: [],
      author: input.actor, priority: 0, risk: 'low', idempotencyKey: input.idempotencyKey,
    }],
    changeSets: [{
      id: 'advance', scope: asset.scope, workItemId: 'advance', assetId: asset.id, baseVersionId: null,
      proposedDigest: version.digest, components: [], author: input.actor, idempotencyKey: input.idempotencyKey,
    }],
    reviews: approval ? [{
      id: approval.ref, scope: asset.scope, changeSetId: 'advance', contentDigest: approval.contentDigest, decision: 'approve',
      reviewer: approval.reviewer, approvalRef: approval.ref, decidedAt: approval.decidedAt,
    }] : [],
  };
  const violations = validateWorkGraph(graph, ctx).filter((v) => v.code !== 'authority_violation');
  if (violations.length) return m.refuse(violations[0].code, [asset.id, ...violations[0].ids], { violations });

  const at = WORK_GRAPH_DEPS.now().toISOString();
  const [kind, userId, runId, chargeId] = actorColumns(input.actor);
  /** A refusal before the swap (part 3: fence, residency, bytes), recorded like the swap's own refusals. */
  const refuseAudited = async (code: RefusalCode, ids: string[], detail: Record<string, unknown>): Promise<Refusal> => {
    await m.run(env.DB.prepare(
      `INSERT INTO work_graph_events (tenant_id, company_id, project_id, asset_uid, action, actor_kind, actor_user_id,
         agent_run_id, charge_id, base_revision_uid, revision_uid, head_seq, outcome, refusal_code, request_hash, detail_json, created_at)
       VALUES (?, ?, ?, ?, 'advance_refused', ?, ?, ?, ?, ?, ?, ?, 'refused', ?, ?, ?, ?)`,
    ).bind(row.tenant_id, row.company_id, row.project_id, asset.id, kind, userId, runId, chargeId, input.expectedRevisionUid,
      rev.revision_uid, row.head_seq, code, hash, JSON.stringify(detail), at));
    return m.refuse(code, ids);
  };

  // Part 3, step 1: the fence. Only while leases are on and the writer brought one; a lease never authorizes, so the
  // capability from the writer's own authorization check must come with it (part 2's assertFence checks both).
  if (input.fence && leasesOn(env)) {
    const holder: LeaseHolder = input.actor.kind === 'person'
      ? { actorKind: 'person', userId: input.actor.userId }
      : { actorKind: 'agent', agentRunId: input.actor.agentRunId };
    const f = await assertFence(env as Env, {
      caller: { scope: ctx.scope }, resource: { scope: asset.scope, assetId: asset.id, unit: input.fence.unit },
      fence: input.fence.value, holder, capability: input.fence.capability,
    });
    m.add({ doCalls: f.cost.doCalls, d1Statements: f.cost.d1Statements });
    if (!f.ok) {
      const leaseCode = f.status === 'refused' ? f.code : f.status;
      const code: RefusalCode = leaseCode === 'no_capability' ? 'no_capability' : 'stale_fence';
      return refuseAudited(code, [asset.id, String(input.fence.value), leaseCode], { lease: leaseCode, fence: input.fence.value });
    }
  }

  // Part 3, step 2: integrity before release. WorkGraph-held bytes are re-read and checked against the digest;
  // bytes a domain holds (d1_record, git, esign, another R2 prefix) are that domain's to verify (D5579 §1).
  if (isWorkGraphBlobSource(version.source)) {
    const residency = rev.residency ?? null;
    if (!residencyAllowed(residency, WORK_GRAPH_BLOB_DEPS.jurisdiction)) {
      return refuseAudited('residency_mismatch', [rev.revision_uid, String(residency), String(WORK_GRAPH_BLOB_DEPS.jurisdiction)], { residency, jurisdiction: WORK_GRAPH_BLOB_DEPS.jurisdiction });
    }
    if (version.source.id !== blobKey(asset.scope, version.digest)) {
      return refuseAudited('bytes_unverified', [rev.revision_uid, 'blob_key'], { cause: 'blob_key' });
    }
    const v = await verifyBlob(env, asset.scope, version.digest, version.byteLength);
    m.add({ r2ClassB: v.r2ClassB });
    if (!v.ok) return refuseAudited('bytes_unverified', [rev.revision_uid, v.code, v.detail], { cause: v.code, detail: v.detail, digest: version.digest });
  }
  const approverId = approval && approval.reviewer.kind === 'person' ? approval.reviewer.userId : null;
  let results: D1Result[];
  try {
    results = await m.batch([
      // THE compare-and-swap. It changes the row only while every condition holds at the instant it runs.
      env.DB.prepare(
        `UPDATE work_graph_assets SET head_revision_uid = ?, head_seq = head_seq + 1
          WHERE asset_uid = ? AND head_revision_uid IS ?
            AND EXISTS (SELECT 1 FROM work_graph_revisions r WHERE r.revision_uid = ? AND r.asset_uid = ? AND r.tombstoned_at IS NULL)
            AND NOT EXISTS (
              SELECT 1 FROM work_graph_edges e JOIN work_graph_assets d ON d.asset_uid = e.to_asset_uid
               WHERE e.from_revision_uid = ? AND d.head_revision_uid IS NOT e.to_revision_uid)
            AND NOT EXISTS (
              SELECT 1 FROM work_graph_revision_flags f WHERE f.revision_uid = ? AND f.cleared_at IS NULL)`,
      ).bind(rev.revision_uid, asset.id, input.expectedRevisionUid, rev.revision_uid, asset.id, rev.revision_uid, rev.revision_uid),
      env.DB.prepare(
        `INSERT INTO work_graph_events (tenant_id, company_id, project_id, asset_uid, action, actor_kind, actor_user_id,
           agent_run_id, charge_id, base_revision_uid, revision_uid, head_seq, approval_ref, approval_digest, approver_user_id,
           outcome, idempotency_key, request_hash, created_at)
         SELECT ?, ?, ?, ?, 'advance_head', ?, ?, ?, ?, ?, ?, (SELECT head_seq FROM work_graph_assets WHERE asset_uid = ?), ?, ?, ?,
                'applied', ?, ?, ?
          WHERE changes() > 0`,
      ).bind(row.tenant_id, row.company_id, row.project_id, asset.id, kind, userId, runId, chargeId, input.expectedRevisionUid,
        rev.revision_uid, asset.id, approval?.ref ?? null, approval?.contentDigest ?? null, approverId,
        input.idempotencyKey, hash, at),
    ]);
  } catch (e) {
    const raced = await replay();
    if (raced) return raced;
    throw e;
  }

  if (Number(results[0]?.meta?.changes ?? 0) === 0) {
    // Refused at the swap. Say why from what is true now, and record the refusal.
    const now = await readAsset(env, m, asset.id);
    const currentHead = { revisionUid: now?.head_revision_uid ?? null, headSeq: Number(now?.head_seq ?? 0) };
    let code: RefusalCode;
    let ids: string[];
    if (currentHead.revisionUid !== input.expectedRevisionUid) {
      code = 'stale_revision';
      ids = [rev.revision_uid, String(input.expectedRevisionUid), String(currentHead.revisionUid)];
    } else {
      const stale = await staleEdges(env, m, rev.revision_uid);
      const flags = stale.length ? [] : (await m.all<{ flag: string }>(env.DB.prepare(
        'SELECT flag FROM work_graph_revision_flags WHERE revision_uid = ? AND cleared_at IS NULL ORDER BY flag',
      ).bind(rev.revision_uid))).map((f) => f.flag);
      if (stale.length) {
        code = asset.kind === 'composite' ? 'composite_incompatible' : 'stale_dependency';
        ids = stale.flatMap((s) => [s.toAssetUid, s.pinnedRevisionUid, String(s.headRevisionUid)]);
      } else if (flags.length) {
        // Part 3: reconcile or a person flagged the revision (missing or deleted bytes, offline, residency).
        code = flags.includes('offline') ? 'offline' : flags.includes('residency_mismatch') ? 'residency_mismatch' : 'bytes_unverified';
        ids = [rev.revision_uid, ...flags];
      } else {
        code = 'tombstoned';
        ids = [rev.revision_uid];
      }
    }
    await m.run(env.DB.prepare(
      `INSERT INTO work_graph_events (tenant_id, company_id, project_id, asset_uid, action, actor_kind, actor_user_id,
         agent_run_id, charge_id, base_revision_uid, revision_uid, head_seq, outcome, refusal_code, request_hash, detail_json, created_at)
       VALUES (?, ?, ?, ?, 'advance_refused', ?, ?, ?, ?, ?, ?, ?, 'refused', ?, ?, ?, ?)`,
    ).bind(row.tenant_id, row.company_id, row.project_id, asset.id, kind, userId, runId, chargeId, input.expectedRevisionUid,
      rev.revision_uid, currentHead.headSeq, code, hash, JSON.stringify({ current_head: currentHead.revisionUid }), at));
    return m.refuse(code, ids, { currentHead });
  }

  const after = await m.first<{ head_seq: number }>(env.DB.prepare(
    'SELECT head_seq FROM work_graph_assets WHERE asset_uid = ?',
  ).bind(asset.id));
  const impact = input.expectedRevisionUid === null
    ? { outputs: [], invalidatedApprovals: [] }
    : await impactWith(env, m, input.expectedRevisionUid, row.tenant_id, row.company_id, WORK_GRAPH_LIMITS.maxWalkDepth);
  return {
    ok: true, revisionUid: rev.revision_uid, previousRevisionUid: input.expectedRevisionUid, headSeq: Number(after?.head_seq ?? 0),
    replayed: false, impact, cost: { ...m.cost },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The dependency DAG, read

export interface StaleEdge { edgeKind: DependencyKind; toAssetUid: string; pinnedRevisionUid: string; headRevisionUid: string | null }

async function staleEdges(env: Pick<Env, 'DB'>, m: Meter, revisionUid: string): Promise<StaleEdge[]> {
  const rows = await m.all<{ edge_kind: string; to_asset_uid: string; to_revision_uid: string; head_revision_uid: string | null }>(env.DB.prepare(
    `SELECT e.edge_kind, e.to_asset_uid, e.to_revision_uid, d.head_revision_uid
       FROM work_graph_edges e JOIN work_graph_assets d ON d.asset_uid = e.to_asset_uid
      WHERE e.from_revision_uid = ? AND d.head_revision_uid IS NOT e.to_revision_uid
      ORDER BY e.id`,
  ).bind(revisionUid));
  return rows.map((r) => ({
    edgeKind: r.edge_kind as DependencyKind, toAssetUid: r.to_asset_uid, pinnedRevisionUid: r.to_revision_uid, headRevisionUid: r.head_revision_uid,
  }));
}

/** The dependencies of a revision whose pinned revision is no longer its asset's head. */
export async function staleDependencies(
  env: Pick<Env, 'DB'>, ctx: ValidationContext, revisionUid: string,
): Promise<{ ok: true; stale: StaleEdge[]; cost: Cost } | Refusal> {
  const m = new Meter(env);
  const owner = await m.first<AssetRow>(env.DB.prepare(
    `SELECT a.asset_uid, a.tenant_id, a.company_id, a.project_id, a.kind, a.access_class, a.approval_policy, a.head_revision_uid,
            a.head_seq, a.version_count
       FROM work_graph_revisions r JOIN work_graph_assets a ON a.asset_uid = r.asset_uid WHERE r.revision_uid = ?`,
  ).bind(revisionUid));
  if (!owner) return m.refuse('not_found', [revisionUid]);
  const scoped = scopeRefusal(m, ctx, assetOf(owner));
  if (scoped) return scoped;
  const stale = await staleEdges(env, m, revisionUid);
  return { ok: true, stale, cost: { ...m.cost } };
}

async function impactWith(env: Pick<Env, 'DB'>, m: Meter, revisionUid: string, tenantId: number, companyId: number, depth: number): Promise<Impact> {
  const rows = await m.all<{ asset_uid: string; revision_uid: string; edge_kind: string; is_head: number; depth: number }>(env.DB.prepare(
    `WITH RECURSIVE hit(revision_uid, asset_uid, edge_kind, depth) AS (
       SELECT e.from_revision_uid, e.from_asset_uid, e.edge_kind, 1 FROM work_graph_edges e
        WHERE e.to_revision_uid = ? AND e.tenant_id = ? AND e.company_id = ?
       UNION
       SELECT e.from_revision_uid, e.from_asset_uid, e.edge_kind, hit.depth + 1
         FROM hit JOIN work_graph_edges e ON e.to_revision_uid = hit.revision_uid
        WHERE hit.depth < ? AND e.tenant_id = ? AND e.company_id = ?
     )
     SELECT hit.asset_uid, hit.revision_uid, hit.edge_kind, MIN(hit.depth) AS depth,
            CASE WHEN a.head_revision_uid = hit.revision_uid THEN 1 ELSE 0 END AS is_head
       FROM hit JOIN work_graph_assets a ON a.asset_uid = hit.asset_uid
      GROUP BY hit.asset_uid, hit.revision_uid, hit.edge_kind, a.head_revision_uid
      ORDER BY depth, hit.asset_uid, hit.revision_uid`,
  ).bind(revisionUid, tenantId, companyId, depth, tenantId, companyId));
  const outputs = rows.map((r) => ({
    assetUid: r.asset_uid, revisionUid: r.revision_uid, edgeKind: r.edge_kind as DependencyKind, isHead: r.is_head === 1, depth: r.depth,
  }));
  if (!outputs.length) return { outputs, invalidatedApprovals: [] };
  const approvals = await m.all<{ asset_uid: string; revision_uid: string; approval_ref: string; approval_digest: string | null }>(env.DB.prepare(
    `SELECT asset_uid, revision_uid, approval_ref, approval_digest FROM work_graph_events
      WHERE action = 'advance_head' AND outcome = 'applied' AND approval_ref IS NOT NULL
        AND tenant_id = ? AND company_id = ? AND revision_uid IN (SELECT value FROM json_each(?))
      ORDER BY id`,
  ).bind(tenantId, companyId, JSON.stringify([...new Set(outputs.map((o) => o.revisionUid))])));
  return {
    outputs,
    invalidatedApprovals: approvals.map((a) => ({
      assetUid: a.asset_uid, revisionUid: a.revision_uid, approvalRef: a.approval_ref, approvalDigest: a.approval_digest,
    })),
  };
}

/**
 * Every output built on a revision (directly or through other outputs), and the approvals recorded when those
 * outputs became heads: what a new head of the revision's asset leaves stale (D5579 §6).
 */
export async function impactOf(
  env: Pick<Env, 'DB'>, ctx: ValidationContext, revisionUid: string, limits: WorkGraphLimits = WORK_GRAPH_LIMITS,
): Promise<{ ok: true; impact: Impact; cost: Cost } | Refusal> {
  const m = new Meter(env);
  const owner = await m.first<AssetRow>(env.DB.prepare(
    `SELECT a.asset_uid, a.tenant_id, a.company_id, a.project_id, a.kind, a.access_class, a.approval_policy, a.head_revision_uid,
            a.head_seq, a.version_count
       FROM work_graph_revisions r JOIN work_graph_assets a ON a.asset_uid = r.asset_uid WHERE r.revision_uid = ?`,
  ).bind(revisionUid));
  if (!owner) return m.refuse('not_found', [revisionUid]);
  const scoped = scopeRefusal(m, ctx, assetOf(owner));
  if (scoped) return scoped;
  const impact = await impactWith(env, m, revisionUid, owner.tenant_id, owner.company_id, limits.maxWalkDepth);
  return { ok: true, impact, cost: { ...m.cost } };
}

// ---------------------------------------------------------------------------------------------------------------
// Retention: tombstones and legal holds. Nothing is ever deleted.

interface OwnedRevision { revision_uid: string; asset_uid: string; legal_hold: number; tombstoned_at: string | null; head_revision_uid: string | null }

async function readOwned(env: Pick<Env, 'DB'>, m: Meter, ctx: ValidationContext, revisionUid: string): Promise<{ rev: OwnedRevision; asset: AssetRow } | Refusal> {
  const asset = await m.first<AssetRow & { revision_uid: string; legal_hold: number; tombstoned_at: string | null }>(env.DB.prepare(
    `SELECT a.asset_uid, a.tenant_id, a.company_id, a.project_id, a.kind, a.access_class, a.approval_policy, a.head_revision_uid,
            a.head_seq, a.version_count, r.revision_uid, r.legal_hold, r.tombstoned_at
       FROM work_graph_revisions r JOIN work_graph_assets a ON a.asset_uid = r.asset_uid WHERE r.revision_uid = ?`,
  ).bind(revisionUid));
  if (!asset) return m.refuse('not_found', [revisionUid]);
  const scoped = scopeRefusal(m, ctx, assetOf(asset));
  if (scoped) return scoped;
  return { rev: asset, asset };
}

export type RetentionResult = { ok: true; revisionUid: string; changed: boolean; cost: Cost } | Refusal;

/**
 * Tombstone a revision: it stays in the DAG (its children keep their lineage) but can never again become a head or
 * a parent. Refused under a legal hold, and for the current head (advance the head first). A person's act.
 */
export async function tombstoneRevision(
  env: Pick<Env, 'DB'>, ctx: ValidationContext, input: { revisionUid: string; actor: Actor; reason: string },
): Promise<RetentionResult> {
  const m = new Meter(env);
  if (input.actor?.kind !== 'person' || actorMalformed(input.actor)) return m.refuse('person_required', [String(input.revisionUid)]);
  if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 500) return m.refuse('malformed', [String(input.revisionUid)]);
  const owned = await readOwned(env, m, ctx, input.revisionUid);
  if ('ok' in owned) return owned;
  const { rev, asset } = owned;
  if (rev.tombstoned_at !== null) return { ok: true, revisionUid: rev.revision_uid, changed: false, cost: { ...m.cost } };
  if (rev.legal_hold === 1) return m.refuse('legal_hold', [rev.revision_uid]);
  if (rev.head_revision_uid === rev.revision_uid) return m.refuse('is_head', [rev.revision_uid]);
  const at = WORK_GRAPH_DEPS.now().toISOString();
  const res = await m.batch([
    env.DB.prepare(
      `UPDATE work_graph_revisions SET tombstoned_at = ?, tombstoned_by_user_id = ?, tombstone_reason = ?
        WHERE revision_uid = ? AND tombstoned_at IS NULL AND legal_hold = 0
          AND NOT EXISTS (SELECT 1 FROM work_graph_assets a WHERE a.head_revision_uid = ?)`,
    ).bind(at, input.actor.userId, input.reason, rev.revision_uid, rev.revision_uid),
    env.DB.prepare(
      `INSERT INTO work_graph_events (tenant_id, company_id, project_id, asset_uid, action, actor_kind, actor_user_id,
         revision_uid, outcome, detail_json, created_at)
       SELECT ?, ?, ?, ?, 'tombstone', 'person', ?, ?, 'applied', ?, ? WHERE changes() > 0`,
    ).bind(asset.tenant_id, asset.company_id, asset.project_id, asset.asset_uid, input.actor.userId, rev.revision_uid,
      JSON.stringify({ reason: input.reason }), at),
  ]);
  if (Number(res[0]?.meta?.changes ?? 0) === 0) {
    // Something changed between the read and the write: say what is true now.
    const again = await readOwned(env, m, ctx, input.revisionUid);
    if ('ok' in again) return again;
    if (again.rev.tombstoned_at !== null) return { ok: true, revisionUid: rev.revision_uid, changed: false, cost: { ...m.cost } };
    return m.refuse(again.rev.legal_hold === 1 ? 'legal_hold' : 'is_head', [rev.revision_uid]);
  }
  return { ok: true, revisionUid: rev.revision_uid, changed: true, cost: { ...m.cost } };
}

/** Place or release a legal hold on a live revision. A person's act; the route that exposes it must be Super-Admin-only. */
export async function setLegalHold(
  env: Pick<Env, 'DB'>, ctx: ValidationContext, input: { revisionUid: string; hold: boolean; actor: Actor; reason: string },
): Promise<RetentionResult> {
  const m = new Meter(env);
  if (input.actor?.kind !== 'person' || actorMalformed(input.actor)) return m.refuse('person_required', [String(input.revisionUid)]);
  if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 500) return m.refuse('malformed', [String(input.revisionUid)]);
  const owned = await readOwned(env, m, ctx, input.revisionUid);
  if ('ok' in owned) return owned;
  const { rev, asset } = owned;
  if (rev.tombstoned_at !== null) return m.refuse('tombstoned', [rev.revision_uid]);
  const want = input.hold ? 1 : 0;
  if (rev.legal_hold === want) return { ok: true, revisionUid: rev.revision_uid, changed: false, cost: { ...m.cost } };
  const at = WORK_GRAPH_DEPS.now().toISOString();
  const res = await m.batch([
    env.DB.prepare(
      'UPDATE work_graph_revisions SET legal_hold = ? WHERE revision_uid = ? AND tombstoned_at IS NULL AND legal_hold <> ?',
    ).bind(want, rev.revision_uid, want),
    env.DB.prepare(
      `INSERT INTO work_graph_events (tenant_id, company_id, project_id, asset_uid, action, actor_kind, actor_user_id,
         revision_uid, outcome, detail_json, created_at)
       SELECT ?, ?, ?, ?, ?, 'person', ?, ?, 'applied', ?, ? WHERE changes() > 0`,
    ).bind(asset.tenant_id, asset.company_id, asset.project_id, asset.asset_uid, input.hold ? 'legal_hold_set' : 'legal_hold_released',
      input.actor.userId, rev.revision_uid, JSON.stringify({ reason: input.reason }), at),
  ]);
  return { ok: true, revisionUid: rev.revision_uid, changed: Number(res[0]?.meta?.changes ?? 0) > 0, cost: { ...m.cost } };
}
