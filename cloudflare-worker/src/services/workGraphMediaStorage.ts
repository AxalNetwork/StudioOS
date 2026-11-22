/**
 * D5583 part 2 (#5583): bounded media upload preparation before any storage write.
 * Uses the landed admission/provenance rules, existing blob store and member
 * storage guard. Typed prefixes and the extended blob ledger keep classes and
 * owner accounting separate. No route is mounted and no head is moved here.
 */
import type { Env } from '../types';
import { actorOk, outOfScope, putVerified, integrityEventStatement, WORK_GRAPH_BLOB_DEPS, type BlobCost, type BlobRefusal, type PutVerifiedResult } from './workGraphBlobs';
import { sha256Hex, type AccessClass, type Actor, type Scope, type ValidationContext } from './workGraphContracts';
import {
  admitMedia, checkProvenance, pinDependencies,
  type AdmissionCode, type MediaDependency, type MediaKind, type MediaProvenance, type ObjectClass, type ProvenanceCode,
} from './workGraphMedia';
import { assertStorageRoom, noteStorageLanded, ventureStorageOwner, companyStorageOwner, type StorageTicket } from './storageRoom';

/** Buffered preview path only. Larger originals require the later multipart path, never a larger buffer. */
export const MEDIA_BUFFER_MAX_BYTES = 8 * 1024 * 1024;
export const MEDIA_PIN_LIMIT = 64;

type PreparationCode = AdmissionCode | 'malformed' | 'not_found' | 'wrong_tenant' | 'revoked_author'
  | 'stale_head' | 'stale_dependency' | 'provenance' | 'font_binary' | 'font_license_unknown'
  | 'malformed_dependency' | 'unavailable';
export type MediaPreparation = {
  ok: true;
  assetUid: string; scope: Scope; accessClass: AccessClass; expectedHead: string | null;
  objectClass: ObjectClass; kind: MediaKind; mediaProfile: string; format: string;
  digest: string; bytes: Uint8Array;
  dependencies: ReturnType<typeof pinDependencies> & { ok: true };
  /** Derived from the stored asset, not an arbitrary caller-supplied member id. */
  attribution: { companyId: number; projectId: number | null };
  cost: { d1Statements: number; r2ClassA: 0; r2ClassB: 0 };
} | { ok: false; code: PreparationCode; provenance?: ProvenanceCode[]; cost: { d1Statements: number; r2ClassA: 0; r2ClassB: 0 } };

export interface PrepareMediaInput {
  assetUid: string; expectedHead: string | null; by: Actor;
  kind: MediaKind; objectClass: ObjectClass; declaredMime: string; bytes: Uint8Array;
  provenance: MediaProvenance; use: string; dependencies?: MediaDependency[];
}
type AssetRow = { asset_uid: string; tenant_id: number; company_id: number; project_id: number | null;
  kind: string; access_class: AccessClass; head_revision_uid: string | null };
const scopeOf = (row: AssetRow): Scope => ({ tenantId: row.tenant_id, companyId: row.company_id, projectId: row.project_id });
const ASSET = 'SELECT asset_uid, tenant_id, company_id, project_id, kind, access_class, head_revision_uid FROM work_graph_assets WHERE asset_uid = ?';

/**
 * A read-only, short-lived preparation, not a reservation or authorization receipt.
 * A future writer must recheck the head/dependencies after quota admission and
 * use createRevision/advanceHead's atomic guards. No promise of concurrency-safe
 * quota, class isolation or resumable upload is made by returning this plan.
 */
export async function prepareMediaUpload(env: Pick<Env, 'DB'>, ctx: ValidationContext, input: PrepareMediaInput): Promise<MediaPreparation> {
  const cost = { d1Statements: 0, r2ClassA: 0 as const, r2ClassB: 0 as const };
  const refuse = (code: PreparationCode, provenance?: ProvenanceCode[]): MediaPreparation => ({ ok: false, code, ...(provenance ? { provenance } : {}), cost: { ...cost } });
  if (!input || typeof input.assetUid !== 'string' || !input.assetUid || input.assetUid.length > 80
    || !(input.expectedHead === null || typeof input.expectedHead === 'string' && input.expectedHead.length > 0 && input.expectedHead.length <= 80)
    || !actorOk(input.by) || typeof input.use !== 'string' || !input.use.trim() || input.use.length > 120
    || !input.provenance || !Array.isArray(input.dependencies ?? []) || (input.dependencies?.length ?? 0) > MEDIA_PIN_LIMIT
    || !(input.bytes instanceof Uint8Array)) return refuse('malformed');
  if (input.bytes.byteLength > MEDIA_BUFFER_MAX_BYTES) return refuse('oversized');
  const author = input.by.kind === 'person' ? input.by.userId : input.by.onBehalfOfUserId;
  if (ctx.revokedUserIds?.has(author) || input.by.kind === 'agent' && ctx.revokedAgentRunIds?.has(input.by.agentRunId)) return refuse('revoked_author');
  // Snapshot before the first await: the plan hashes exactly the bytes admitted,
  // even if another caller reuses and mutates its original view while D1 resolves.
  const bytes = input.bytes.slice();
  const admitted = admitMedia({ ...input, bytes });
  if (!admitted.ok) return refuse(admitted.code);
  const rights = checkProvenance(input.provenance, { stage: 'draft', use: input.use, now: WORK_GRAPH_BLOB_DEPS.now() });
  if (rights.length) return refuse('provenance', rights);
  const pins = pinDependencies(input.dependencies ?? []);
  if (!pins.ok) return refuse(pins.code);
  try {
    cost.d1Statements++;
    const asset = await env.DB.prepare(ASSET).bind(input.assetUid).first<AssetRow>();
    if (!asset) return refuse('not_found');
    const scope = scopeOf(asset);
    if (outOfScope(ctx, scope, asset.access_class)) return refuse('wrong_tenant');
    if (asset.kind !== input.kind) return refuse('wrong_kind');
    if (asset.head_revision_uid !== input.expectedHead) return refuse('stale_head');
    // A derivation must name the accepted source; an old source is never silently
    // relabelled as a new rendition of the current master.
    if (input.provenance.origin === 'derived' && input.provenance.sourceRevisionUid !== asset.head_revision_uid) return refuse('stale_dependency');
    for (const pin of pins.edges) {
      cost.d1Statements++;
      const dependency = await env.DB.prepare(ASSET).bind(pin.assetUid).first<AssetRow>();
      if (!dependency || outOfScope(ctx, scopeOf(dependency), dependency.access_class)) return refuse('wrong_tenant');
      if (dependency.head_revision_uid !== pin.revisionUid) return refuse('stale_dependency');
    }
    return { ok: true, assetUid: asset.asset_uid, scope, accessClass: asset.access_class, expectedHead: input.expectedHead,
      objectClass: input.objectClass, kind: input.kind, format: admitted.format.id, mediaProfile: admitted.mediaProfile,
      digest: await sha256Hex(bytes), bytes, dependencies: pins,
      attribution: { companyId: scope.companyId, projectId: scope.projectId }, cost: { ...cost } };
  } catch { return refuse('unavailable'); }
}


export type StoredMedia = Exclude<PutVerifiedResult, BlobRefusal> & { objectClass: ObjectClass; mediaProfile: string;
  ownerUserId: number | null; quota: StorageTicket; cost: BlobCost };
export type MediaStoreResult = StoredMedia | { ok: false; code: PreparationCode; provenance?: ProvenanceCode[]; cost: BlobCost } | BlobRefusal;

/**
 * Preview-only internal upload. Reuse the one blob service and existing member
 * guard. Storage quota keeps D1170's existing pass/fail semantics; it is not a
 * new concurrent byte-reservation protocol. A later revision/head write still
 * uses the revision service's atomic CAS; abandoned uploads are reconciled.
 */
export async function storeMediaUpload(env: Env, ctx: ValidationContext, input: PrepareMediaInput & { residency?: string | null }): Promise<MediaStoreResult> {
  const cost: BlobCost = { d1Statements: 0, d1Batches: 0, r2ClassA: 0, r2ClassB: 0 };
  const db = new Proxy(env.DB, { get(target, prop) {
    if (prop === 'prepare') return (sql: string) => { cost.d1Statements++; return target.prepare(sql); };
    if (prop === 'batch') return (statements: D1PreparedStatement[]) => { cost.d1Batches++; return target.batch(statements); };
    const value = Reflect.get(target, prop, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const files = env.FILES ? new Proxy(env.FILES, { get(target, prop) {
    const value = Reflect.get(target, prop, target);
    if (typeof value !== 'function') return value;
    return (...args: unknown[]) => {
      if (['put', 'delete', 'list'].includes(String(prop))) cost.r2ClassA++;
      else if (prop === 'get' || prop === 'head') cost.r2ClassB++;
      return value.apply(target, args);
    };
  } }) : env.FILES;
  const counted = { ...env, DB: db, FILES: files };
  const auditRefusal = async (code: string) => {
    if (!actorOk(input?.by)) return;
    await integrityEventStatement(db, { tenantId: ctx.scope.tenantId, companyId: ctx.scope.companyId,
      actor: input.by, action: 'blob_refused', outcome: 'refused', refusalCode: code,
      detail: { phase: 'media_admission' }, cost: { ...cost, d1Statements: cost.d1Statements + 1 },
      at: WORK_GRAPH_BLOB_DEPS.now().toISOString() }).run();
  };
  const prepared = await prepareMediaUpload(counted, ctx, input);
  if (!prepared.ok) { await auditRefusal(prepared.code); return { ...prepared, cost: { ...cost } }; }
  const ownerScope = prepared.scope.projectId !== null ? { projectId: prepared.scope.projectId } : { companyId: prepared.scope.companyId };
  if (prepared.scope.projectId !== null) {
    const project = await db.prepare('SELECT company_id FROM projects WHERE id = ?').bind(prepared.scope.projectId).first<{ company_id: number | null }>();
    if (project?.company_id !== prepared.scope.companyId) { await auditRefusal('wrong_tenant'); return { ok: false, code: 'wrong_tenant', cost: { ...cost } }; }
  }
  // Snapshot attribution when readable; the existing guard owns no-owner and
  // unreadable-owner policy. Never replace an unresolved owner with the uploader.
  let ownerUserId: number | null = null;
  try { ownerUserId = prepared.scope.projectId !== null ? await ventureStorageOwner(counted, prepared.scope.projectId)
    : await companyStorageOwner(counted, prepared.scope.companyId); } catch { /* existing guard records unreadable below */ }
  const existing = await db.prepare("SELECT byte_length FROM work_graph_blobs WHERE tenant_id = ? AND company_id = ? AND project_id = ? AND object_class = ? AND digest = ? AND deleted_at IS NULL")
    .bind(prepared.scope.tenantId, prepared.scope.companyId, prepared.scope.projectId ?? 0, prepared.objectClass, prepared.digest).first<{ byte_length: number }>();
  let ticket: StorageTicket;
  try {
    ticket = await assertStorageRoom(counted, ownerScope, existing ? 0 : prepared.bytes.byteLength,
      { id: input.by.kind === 'person' ? input.by.userId : input.by.onBehalfOfUserId });
  } catch (error) { await auditRefusal(error instanceof Response && error.status === 413 ? 'storage_full' : 'quota_unreadable'); throw error; }
  ownerUserId = ticket.ownerId ?? (ticket.passed === 'staff' ? ownerUserId : null);
  // Quota reads may await several stores; refuse a dependency/head that moved
  // while they ran, and re-evaluate the rights clock before storing bytes.
  const current = await prepareMediaUpload(counted, ctx, { ...input, bytes: prepared.bytes });
  if (!current.ok) { await auditRefusal(current.code); return { ...current, cost: { ...cost } }; }
  const stored = await putVerified(counted, ctx, { scope: current.scope, bytes: current.bytes,
    objectClass: current.objectClass, storageOwnerUserId: ownerUserId, storageProjectId: current.scope.projectId,
    accessClass: current.accessClass, actor: input.by, assetUid: current.assetUid, residency: input.residency });
  if (!stored.ok) return { ...stored, cost: { ...cost } };
  if (ticket.incoming > 0) await noteStorageLanded(counted, ticket);
  return { ...stored, objectClass: current.objectClass, mediaProfile: current.mediaProfile,
    ownerUserId, quota: ticket, cost: { ...cost } };
}
