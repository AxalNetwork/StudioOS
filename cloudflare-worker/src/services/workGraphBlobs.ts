/**
 * D5581 part 3 (#5581, WorkGraph under the #5577 epic) — content-addressed WorkGraph bytes in the existing R2 `FILES`
 * bucket, under their own prefix `wg/v1/t<tenant>/c<company>/sha256/<digest>`, with read-back verification, the
 * offline state and the per-tenant byte limit. Decision: `documentation/architecture/decisions/D5581-p3.md`.
 *
 *   putVerified          hashes the bytes (SHA-256), writes them under their digest with R2's own `sha256` check, so
 *                        R2 refuses a torn body, and records the blob in `work_graph_blobs`. An existing object whose
 *                        size and checksum match is reused, not rewritten. Refused: another tenant's scope, a residency
 *                        the bucket's jurisdiction cannot hold, a preview on a confidential or restricted record, the
 *                        per-put and per-tenant byte limits.
 *   verifyBlob           re-reads what R2 holds: size, R2's SHA-256 checksum and (up to 8 MiB, or with no checksum)
 *                        the bytes re-hashed. `missing_bytes` or `digest_mismatch` otherwise.
 *   readRevisionBytes    the bytes of a revision, digest-checked; refused while the revision is `offline`.
 *   readRevisionMetadata metadata only; a preview is returned only for `public` and `internal` assets.
 *   setRevisionOffline   a person marks a revision offline (metadata only) or back online. Audited.
 *
 * WHICH BYTES. Only a revision whose SourceRef is `r2_object` / `FILES` / `wg/v1/…` holds WorkGraph bytes. Bytes a
 * domain holds (a deck image under `deck-images/…`, a signed PDF under `esign/…`, a D1 row, Git) are pointed at, never
 * copied, and verified by that domain's own service (D5579 §1, §5 step 2), not here.
 *
 * NO PLAINTEXT PREVIEWS for restricted records. No D1 column holds content. An object's custom metadata carries ids,
 * the digest and the size; a short preview only when the access class is `public` or `internal`. A confidential or
 * restricted put with a preview is refused, and a reused object that still carries one is rewritten without it.
 */
import type { Env } from '../types';
import {
  ACCESS_CLASSES, sha256Hex, validateWorkGraph,
  type AccessClass, type Actor, type Scope, type SourceRef, type ValidationContext,
} from './workGraphContracts';

export const BLOB_BINDING = 'FILES' as const;
export const BLOB_PREFIX = 'wg/v1';

/** R2's jurisdictions (`scripts/lib/branchConfig.mjs` R2_JURISDICTIONS). */
export const R2_JURISDICTIONS = ['eu', 'fedramp'] as const;
export type R2Jurisdiction = (typeof R2_JURISDICTIONS)[number];

/**
 * The clock and the jurisdiction of the `FILES` bucket this Worker is bound to. HQ's `studioos-files` is declared
 * with no `jurisdiction` in `wrangler.toml`, so it guarantees none: null. Swappable in tests (D5614).
 */
export const WORK_GRAPH_BLOB_DEPS: { now: () => Date; jurisdiction: R2Jurisdiction | null } = {
  now: () => new Date(),
  jurisdiction: null,
};

export const WORK_GRAPH_BLOB_LIMITS = Object.freeze({
  /** One put is held in the Worker's memory; larger bytes need multipart, which no caller has yet. */
  maxPutBytes: 100 * 1024 * 1024,
  /** Live WorkGraph bytes per tenant, across its companies. */
  maxBytesPerTenant: 100 * 1024 * 1024 * 1024,
  /** Objects up to this size are re-hashed on verify; larger ones rely on R2's own SHA-256 checksum. */
  deepVerifyMaxBytes: 8 * 1024 * 1024,
  maxPreviewChars: 200,
});
export type WorkGraphBlobLimits = typeof WORK_GRAPH_BLOB_LIMITS;

/** The only access classes whose objects may carry a plaintext preview. */
export const PREVIEW_CLASSES: ReadonlySet<AccessClass> = new Set<AccessClass>(['public', 'internal']);

export type BlobRefusalCode =
  | 'malformed' | 'wrong_tenant' | 'no_binding' | 'size_limit' | 'tenant_limit' | 'residency_mismatch'
  | 'preview_forbidden' | 'digest_mismatch' | 'missing_bytes' | 'not_found' | 'offline' | 'bytes_deleted'
  | 'domain_held' | 'person_required';

/** What a call cost: D1 statements and batches, R2 Class A (put, list, delete) and Class B (head, get) operations. */
export interface BlobCost { d1Statements: number; d1Batches: number; r2ClassA: number; r2ClassB: number }
export interface BlobRefusal<C extends string = BlobRefusalCode> { ok: false; code: C; ids: string[]; cost: BlobCost }

type BlobEnv = Pick<Env, 'DB'> & { FILES?: R2Bucket };

const posInt = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;

export function blobKey(scope: Pick<Scope, 'tenantId' | 'companyId'>, digest: string): string {
  return `${BLOB_PREFIX}/t${scope.tenantId}/c${scope.companyId}/sha256/${digest}`;
}
export function blobPrefix(scope: Pick<Scope, 'tenantId' | 'companyId'>): string {
  return `${BLOB_PREFIX}/t${scope.tenantId}/c${scope.companyId}/sha256/`;
}
const KEY_RE = /^wg\/v1\/t([1-9][0-9]{0,15})\/c([1-9][0-9]{0,15})\/sha256\/([0-9a-f]{64})$/;
export function parseBlobKey(key: string): { tenantId: number; companyId: number; digest: string } | null {
  const m = KEY_RE.exec(key);
  return m ? { tenantId: Number(m[1]), companyId: Number(m[2]), digest: m[3] } : null;
}

/** Whether a SourceRef names WorkGraph-held bytes (as opposed to bytes a domain holds and verifies itself). */
export function isWorkGraphBlobSource(src: Pick<SourceRef, 'store' | 'locator' | 'id'>): boolean {
  return src.store === 'r2_object' && src.locator === BLOB_BINDING && src.id.startsWith(`${BLOB_PREFIX}/`);
}
/** The SourceRef a revision of WorkGraph-held bytes carries: the bucket binding, the object key, the digest. */
export function blobSourceRef(scope: Pick<Scope, 'tenantId' | 'companyId'>, digest: string): SourceRef {
  return { store: 'r2_object', locator: BLOB_BINDING, id: blobKey(scope, digest), revision: digest };
}

/**
 * Whether bytes with this residency may live in a bucket of this jurisdiction. Null residency asks for no
 * guarantee. Any other value must be an R2 jurisdiction and equal the bucket's: HQ's unrestricted bucket holds none.
 */
export function residencyAllowed(residency: string | null | undefined, jurisdiction: R2Jurisdiction | null): boolean {
  if (residency === null || residency === undefined) return true;
  return (R2_JURISDICTIONS as readonly string[]).includes(residency) && residency === jurisdiction;
}

const toHex = (buf: ArrayBuffer | undefined | null): string | null =>
  buf ? [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('') : null;

const zero = (): BlobCost => ({ d1Statements: 0, d1Batches: 0, r2ClassA: 0, r2ClassB: 0 });

// ── audit ────────────────────────────────────────────────────────────────────

export interface IntegrityEvent {
  tenantId: number; companyId: number; assetUid?: string | null; revisionUid?: string | null; digest?: string | null;
  effectId?: number | null; action: string; outcome: 'applied' | 'refused' | 'flagged'; refusalCode?: string | null;
  actor?: Actor | null; system?: boolean; detail?: Record<string, unknown> | null; cost?: BlobCost; at: string;
}

/**
 * One `work_graph_integrity_events` row. Ids and digests only; the call's cost so far rides on the row. `guarded`
 * writes it only when the statement before it in the same batch changed a row.
 */
export function integrityEventStatement(db: D1Database, e: IntegrityEvent, guarded = false): D1PreparedStatement {
  const a = e.actor ?? null;
  const kind = a ? a.kind : e.system ? 'system' : null;
  const userId = a ? (a.kind === 'person' ? a.userId : a.onBehalfOfUserId) : null;
  const run = a && a.kind === 'agent' ? a.agentRunId : null;
  const c = e.cost ?? zero();
  const stmt = guarded
    ? db.prepare(
      `INSERT INTO work_graph_integrity_events (tenant_id, company_id, asset_uid, revision_uid, digest, effect_id, action,
         outcome, refusal_code, actor_kind, actor_user_id, agent_run_id, detail_json, d1_statements, r2_class_a, r2_class_b, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0`,
    )
    : db.prepare(
      `INSERT INTO work_graph_integrity_events (tenant_id, company_id, asset_uid, revision_uid, digest, effect_id, action,
         outcome, refusal_code, actor_kind, actor_user_id, agent_run_id, detail_json, d1_statements, r2_class_a, r2_class_b, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
  return stmt.bind(e.tenantId, e.companyId, e.assetUid ?? null, e.revisionUid ?? null, e.digest ?? null, e.effectId ?? null, e.action,
    e.outcome, e.refusalCode ?? null, kind, userId, run, e.detail ? JSON.stringify(e.detail) : null,
    c.d1Statements, c.r2ClassA, c.r2ClassB, e.at);
}

export function actorOk(a: Actor | undefined | null): a is Actor {
  if (!a) return false;
  if (a.kind === 'person') return posInt(a.userId);
  if (a.kind === 'agent') return typeof a.agentRunId === 'string' && a.agentRunId.length > 0 && a.agentRunId.length <= 200 && posInt(a.onBehalfOfUserId);
  return false;
}
const scopeOk = (s: Scope | undefined): s is Scope =>
  !!s && posInt(s.tenantId) && posInt(s.companyId) && (s.projectId === null || posInt(s.projectId));

/** D5579's scope rule, through its validator: a company-wide caller covers its projects. */
export function outOfScope(ctx: ValidationContext, scope: Scope, accessClass: AccessClass): boolean {
  return validateWorkGraph({ assets: [{ id: 'blob', scope, kind: 'image', headVersionId: null, accessClass, approvalPolicy: 'blob' }] }, ctx)
    .some((v) => v.code === 'wrong_tenant');
}

/** Counts what a call spends (D1, R2) and audits its refusals. Shared by the blob, reconcile and effect services. */
export class Spend {
  cost = zero();
  private env: BlobEnv;
  constructor(env: BlobEnv) { this.env = env; }
  async first<T>(s: D1PreparedStatement): Promise<T | null> { this.cost.d1Statements++; return s.first<T>(); }
  async all<T>(s: D1PreparedStatement): Promise<T[]> { this.cost.d1Statements++; return ((await s.all<T>()).results ?? []) as T[]; }
  async run(s: D1PreparedStatement) { this.cost.d1Statements++; return s.run(); }
  async batch(list: D1PreparedStatement[]) { this.cost.d1Statements += list.length; this.cost.d1Batches++; return this.env.DB.batch(list); }
  /** Audit a refusal, then return it. The audit's own statement is counted. */
  async refuse<C extends string = BlobRefusalCode>(code: C, ids: string[], ev: Omit<IntegrityEvent, 'action' | 'outcome' | 'refusalCode' | 'at'> & { action?: string } | null): Promise<BlobRefusal<C>> {
    if (ev) {
      const at = WORK_GRAPH_BLOB_DEPS.now().toISOString();
      this.cost.d1Statements++;
      await integrityEventStatement(this.env.DB, { ...ev, action: ev.action ?? 'blob_refused', outcome: 'refused', refusalCode: code, cost: { ...this.cost }, at }).run();
    }
    return { ok: false, code, ids, cost: { ...this.cost } };
  }
}

// ── verify ───────────────────────────────────────────────────────────────────

export type VerifyResult =
  | { ok: true; method: 'checksum' | 'rehash'; size: number; r2ClassB: number }
  | { ok: false; code: 'missing_bytes' | 'digest_mismatch' | 'no_binding'; detail: string; r2ClassB: number };

/**
 * Re-read what R2 holds under the blob key and compare it with the digest and size a revision declares. A head
 * answers size, R2's SHA-256 checksum (computed by R2 at put) and the digest WorkGraph wrote in custom metadata; an
 * object up to `deepVerifyMaxBytes`, or one without an R2 checksum, is also read back and re-hashed. Scope is the
 * caller's to check: the key itself carries the tenant and company.
 */
export async function verifyBlob(
  env: { FILES?: R2Bucket }, scope: Pick<Scope, 'tenantId' | 'companyId'>, digest: string, expectedSize: number,
  limits: WorkGraphBlobLimits = WORK_GRAPH_BLOB_LIMITS,
): Promise<VerifyResult> {
  let r2ClassB = 0;
  const bucket = env.FILES;
  if (!bucket) return { ok: false, code: 'no_binding', detail: BLOB_BINDING, r2ClassB };
  const key = blobKey(scope, digest);
  const head = await bucket.head(key);
  r2ClassB++;
  if (!head) return { ok: false, code: 'missing_bytes', detail: 'absent', r2ClassB };
  if (head.size !== expectedSize) return { ok: false, code: 'digest_mismatch', detail: 'size', r2ClassB };
  const checksum = toHex(head.checksums?.sha256);
  if (checksum !== null && checksum !== digest) return { ok: false, code: 'digest_mismatch', detail: 'checksum', r2ClassB };
  const meta = head.customMetadata?.digest;
  if (meta !== undefined && meta !== digest) return { ok: false, code: 'digest_mismatch', detail: 'metadata', r2ClassB };
  if (checksum !== null && head.size > limits.deepVerifyMaxBytes) return { ok: true, method: 'checksum', size: head.size, r2ClassB };
  if (checksum === null && head.size > limits.deepVerifyMaxBytes) return { ok: false, code: 'digest_mismatch', detail: 'unverifiable', r2ClassB };
  const body = await bucket.get(key);
  r2ClassB++;
  if (!body) return { ok: false, code: 'missing_bytes', detail: 'absent_on_read', r2ClassB };
  const bytes = new Uint8Array(await body.arrayBuffer());
  if (bytes.byteLength !== expectedSize || (await sha256Hex(bytes)) !== digest) return { ok: false, code: 'digest_mismatch', detail: 'rehash', r2ClassB };
  return { ok: true, method: 'rehash', size: bytes.byteLength, r2ClassB };
}

// ── put ──────────────────────────────────────────────────────────────────────

export interface PutVerifiedInput {
  scope: Scope;
  bytes: Uint8Array | ArrayBuffer;
  accessClass: AccessClass;
  /** The residency the bytes must keep (an R2 jurisdiction), or null for none. */
  residency?: string | null;
  actor: Actor;
  /** A short plaintext preview: refused unless the access class is public or internal. */
  preview?: string | null;
  assetUid?: string | null;
}
export type PutVerifiedResult =
  | { ok: true; digest: string; size: number; key: string; source: SourceRef; reused: boolean; cost: BlobCost }
  | BlobRefusal;

export async function putVerified(
  env: BlobEnv, ctx: ValidationContext, input: PutVerifiedInput, limits: WorkGraphBlobLimits = WORK_GRAPH_BLOB_LIMITS,
): Promise<PutVerifiedResult> {
  const s = new Spend(env);
  const bytes = input?.bytes instanceof Uint8Array ? input.bytes : input?.bytes instanceof ArrayBuffer ? new Uint8Array(input.bytes) : null;
  if (!scopeOk(input?.scope) || !bytes || !actorOk(input.actor)
    || !(ACCESS_CLASSES as readonly string[]).includes(input.accessClass)
    || (input.preview != null && (typeof input.preview !== 'string' || input.preview.length > limits.maxPreviewChars))
    || (input.assetUid != null && (typeof input.assetUid !== 'string' || input.assetUid.length > 80))) {
    return s.refuse('malformed', [], null);
  }
  const ev = { tenantId: input.scope.tenantId, companyId: input.scope.companyId, assetUid: input.assetUid ?? null, actor: input.actor };
  if (outOfScope(ctx, input.scope, input.accessClass)) return s.refuse('wrong_tenant', [], ev);
  if (input.preview != null && !PREVIEW_CLASSES.has(input.accessClass)) return s.refuse('preview_forbidden', [input.accessClass], ev);
  if (!residencyAllowed(input.residency ?? null, WORK_GRAPH_BLOB_DEPS.jurisdiction)) {
    return s.refuse('residency_mismatch', [String(input.residency), String(WORK_GRAPH_BLOB_DEPS.jurisdiction)], ev);
  }
  if (bytes.byteLength > limits.maxPutBytes) return s.refuse('size_limit', [String(limits.maxPutBytes)], ev);
  const bucket = env.FILES;
  if (!bucket) return s.refuse('no_binding', [BLOB_BINDING], ev);

  const digest = await sha256Hex(bytes);
  const key = blobKey(input.scope, digest);
  const evd = { ...ev, digest };
  const at = WORK_GRAPH_BLOB_DEPS.now().toISOString();
  const metadata: Record<string, string> = {
    wg: 'v1', digest, size: String(bytes.byteLength), tenant: String(input.scope.tenantId),
    company: String(input.scope.companyId), access: input.accessClass,
  };
  if (input.preview != null) metadata.preview = input.preview;
  const recordRow = (action: 'blob_put' | 'blob_reused', detail: Record<string, unknown> | null) => [
    env.DB.prepare(
      `INSERT INTO work_graph_blobs (tenant_id, company_id, digest, byte_length, residency, created_at)
       SELECT ?, ?, ?, ?, ?, ?
        WHERE (SELECT COALESCE(SUM(byte_length), 0) FROM work_graph_blobs WHERE tenant_id = ? AND deleted_at IS NULL) + ? <= ?
       ON CONFLICT (tenant_id, company_id, digest) DO UPDATE SET deleted_at = NULL WHERE work_graph_blobs.deleted_at IS NOT NULL`,
    ).bind(input.scope.tenantId, input.scope.companyId, digest, bytes.byteLength, input.residency ?? null, at,
      input.scope.tenantId, bytes.byteLength, limits.maxBytesPerTenant),
    integrityEventStatement(env.DB, { ...evd, action, outcome: 'applied', detail, cost: { ...s.cost, d1Statements: s.cost.d1Statements + 2, d1Batches: s.cost.d1Batches + 1 }, at }, action === 'blob_put'),
  ];

  // Already there: reuse it when R2's size and checksum agree. A preview left on it for a record that may not carry
  // one is removed by rewriting the object; a corrupt object at the digest's key is replaced with the verified bytes.
  const existing = await bucket.head(key);
  s.cost.r2ClassB++;
  const existingSum = toHex(existing?.checksums?.sha256);
  const intact = !!existing && existing.size === bytes.byteLength && existingSum === digest;
  const strayPreview = intact && existing!.customMetadata?.preview !== undefined && !PREVIEW_CLASSES.has(input.accessClass);
  if (intact && !strayPreview) {
    const known = await s.first<{ n: number }>(env.DB.prepare(
      'SELECT COUNT(*) AS n FROM work_graph_blobs WHERE tenant_id = ? AND company_id = ? AND digest = ? AND deleted_at IS NULL',
    ).bind(input.scope.tenantId, input.scope.companyId, digest));
    if (Number(known?.n ?? 0) === 0) {
      // The object outlived its row (a crash between put and record): the row is what the byte limit counts.
      const used = await tenantBytes(env, s, input.scope.tenantId);
      if (used + bytes.byteLength > limits.maxBytesPerTenant) return s.refuse('tenant_limit', [String(limits.maxBytesPerTenant)], { ...evd, action: 'limit_refused' });
    }
    await s.batch(recordRow('blob_reused', null));
    return { ok: true, digest, size: bytes.byteLength, key, source: blobSourceRef(input.scope, digest), reused: true, cost: { ...s.cost } };
  }
  if (!intact) {
    const used = await tenantBytes(env, s, input.scope.tenantId);
    if (used + bytes.byteLength > limits.maxBytesPerTenant) return s.refuse('tenant_limit', [String(limits.maxBytesPerTenant)], { ...evd, action: 'limit_refused' });
  }

  let written: R2Object | null;
  try {
    // R2 computes SHA-256 over what it received and refuses the put when it is not `digest`: a torn body never lands.
    written = await bucket.put(key, bytes, { sha256: digest, customMetadata: metadata, httpMetadata: { contentType: 'application/octet-stream' } });
  } catch {
    s.cost.r2ClassA++;
    return s.refuse('digest_mismatch', [digest, 'put_refused'], evd);
  }
  s.cost.r2ClassA++;
  if (!written || written.size !== bytes.byteLength || toHex(written.checksums?.sha256) !== digest) {
    return s.refuse('digest_mismatch', [digest, 'put_readback'], evd);
  }
  const res = await s.batch(recordRow('blob_put', existing ? { replaced: strayPreview ? 'preview' : 'corrupt' } : null));
  if (Number(res[0]?.meta?.changes ?? 0) === 0) {
    const row = await s.first<{ n: number }>(env.DB.prepare(
      'SELECT COUNT(*) AS n FROM work_graph_blobs WHERE tenant_id = ? AND company_id = ? AND digest = ? AND deleted_at IS NULL',
    ).bind(input.scope.tenantId, input.scope.companyId, digest));
    if (Number(row?.n ?? 0) === 0) {
      // Another put of this tenant took the last bytes between the read and the record: undo ours, unless the object
      // was there before this call (revisions may point at it; a corrupt one was just repaired, not added).
      if (!existing) { await bucket.delete(key); s.cost.r2ClassA++; }
      return s.refuse('tenant_limit', [String(limits.maxBytesPerTenant)], { ...evd, action: 'limit_refused' });
    }
    // The same bytes were recorded by a concurrent put of this company: this call reused them.
    s.cost.d1Statements++;
    await integrityEventStatement(env.DB, { ...evd, action: 'blob_reused', outcome: 'applied', detail: { raced: true }, cost: { ...s.cost }, at }).run();
  }
  return { ok: true, digest, size: bytes.byteLength, key, source: blobSourceRef(input.scope, digest), reused: false, cost: { ...s.cost } };
}

async function tenantBytes(env: BlobEnv, s: Spend, tenantId: number): Promise<number> {
  const r = await s.first<{ n: number }>(env.DB.prepare(
    'SELECT COALESCE(SUM(byte_length), 0) AS n FROM work_graph_blobs WHERE tenant_id = ? AND deleted_at IS NULL',
  ).bind(tenantId));
  return Number(r?.n ?? 0);
}

// ── revisions' bytes ─────────────────────────────────────────────────────────

interface RevisionBytesRow {
  revision_uid: string; asset_uid: string; tenant_id: number; company_id: number; project_id: number | null; digest: string;
  byte_length: number; media_profile: string; source_store: string; source_locator: string; source_id: string;
  kind: string; access_class: string; approval_policy: string; flags: string | null;
}

async function readRevision(env: BlobEnv, s: Spend, revisionUid: string): Promise<RevisionBytesRow | null> {
  return s.first<RevisionBytesRow>(env.DB.prepare(
    `SELECT r.revision_uid, r.asset_uid, r.tenant_id, r.company_id, r.project_id, r.digest, r.byte_length, r.media_profile,
            r.source_store, r.source_locator, r.source_id, a.kind, a.access_class, a.approval_policy,
            (SELECT group_concat(f.flag) FROM work_graph_revision_flags f WHERE f.revision_uid = r.revision_uid AND f.cleared_at IS NULL) AS flags
       FROM work_graph_revisions r JOIN work_graph_assets a ON a.asset_uid = r.asset_uid
      WHERE r.revision_uid = ?`,
  ).bind(revisionUid));
}
const flagsOf = (r: RevisionBytesRow) => new Set((r.flags ?? '').split(',').filter(Boolean));
const scopeOfRow = (r: RevisionBytesRow): Scope => ({ tenantId: r.tenant_id, companyId: r.company_id, projectId: r.project_id });

export type ReadBytesResult = { ok: true; bytes: Uint8Array; digest: string; size: number; cost: BlobCost } | BlobRefusal;

/** The bytes of a WorkGraph revision, re-hashed against its digest. Refused while offline or after deletion. */
export async function readRevisionBytes(env: BlobEnv, ctx: ValidationContext, input: { revisionUid: string; actor: Actor }): Promise<ReadBytesResult> {
  const s = new Spend(env);
  if (typeof input?.revisionUid !== 'string' || !actorOk(input.actor)) return s.refuse('malformed', [], null);
  const r = await readRevision(env, s, input.revisionUid);
  if (!r) return s.refuse('not_found', [input.revisionUid], null);
  const ev = { tenantId: r.tenant_id, companyId: r.company_id, assetUid: r.asset_uid, revisionUid: r.revision_uid, digest: r.digest, actor: input.actor, action: 'read_refused' };
  if (outOfScope(ctx, scopeOfRow(r), r.access_class as AccessClass)) return s.refuse('wrong_tenant', [r.revision_uid], ev);
  const flags = flagsOf(r);
  if (flags.has('offline')) return s.refuse('offline', [r.revision_uid], ev);
  if (flags.has('bytes_deleted')) return s.refuse('bytes_deleted', [r.revision_uid], ev);
  if (!isWorkGraphBlobSource({ store: r.source_store as SourceRef['store'], locator: r.source_locator, id: r.source_id })) {
    return s.refuse('domain_held', [r.revision_uid, r.source_store, r.source_locator], ev);
  }
  if (r.source_id !== blobKey({ tenantId: r.tenant_id, companyId: r.company_id }, r.digest)) return s.refuse('digest_mismatch', [r.revision_uid, 'key'], ev);
  const bucket = env.FILES;
  if (!bucket) return s.refuse('no_binding', [BLOB_BINDING], ev);
  const body = await bucket.get(r.source_id);
  s.cost.r2ClassB++;
  if (!body) return s.refuse('missing_bytes', [r.revision_uid], ev);
  const bytes = new Uint8Array(await body.arrayBuffer());
  if (bytes.byteLength !== r.byte_length || (await sha256Hex(bytes)) !== r.digest) return s.refuse('digest_mismatch', [r.revision_uid, 'rehash'], ev);
  s.cost.d1Statements++;
  await integrityEventStatement(env.DB, { ...ev, action: 'bytes_read', outcome: 'applied', cost: { ...s.cost }, at: WORK_GRAPH_BLOB_DEPS.now().toISOString() }).run();
  return { ok: true, bytes, digest: r.digest, size: bytes.byteLength, cost: { ...s.cost } };
}

export interface RevisionMetadata {
  revisionUid: string; assetUid: string; digest: string; size: number; mediaProfile: string; accessClass: AccessClass;
  flags: string[]; offline: boolean; workGraphHeld: boolean;
  /** Only for a public or internal asset that is online; null for every confidential, restricted or offline one. */
  preview: string | null;
}

/** A revision's metadata, readable even while it is offline. Never content; a preview only where the class allows. */
export async function readRevisionMetadata(env: BlobEnv, ctx: ValidationContext, revisionUid: string): Promise<{ ok: true; metadata: RevisionMetadata; cost: BlobCost } | BlobRefusal> {
  const s = new Spend(env);
  if (typeof revisionUid !== 'string') return s.refuse('malformed', [], null);
  const r = await readRevision(env, s, revisionUid);
  if (!r) return s.refuse('not_found', [revisionUid], null);
  const accessClass = r.access_class as AccessClass;
  if (outOfScope(ctx, scopeOfRow(r), accessClass)) return s.refuse('wrong_tenant', [r.revision_uid], { tenantId: r.tenant_id, companyId: r.company_id, assetUid: r.asset_uid, revisionUid: r.revision_uid, action: 'read_refused' });
  const flags = flagsOf(r);
  const held = isWorkGraphBlobSource({ store: r.source_store as SourceRef['store'], locator: r.source_locator, id: r.source_id });
  let preview: string | null = null;
  if (held && PREVIEW_CLASSES.has(accessClass) && !flags.has('offline') && !flags.has('bytes_deleted') && env.FILES) {
    const head = await env.FILES.head(r.source_id);
    s.cost.r2ClassB++;
    preview = head?.customMetadata?.preview ?? null;
  }
  return {
    ok: true,
    metadata: {
      revisionUid: r.revision_uid, assetUid: r.asset_uid, digest: r.digest, size: r.byte_length, mediaProfile: r.media_profile,
      accessClass, flags: [...flags].sort(), offline: flags.has('offline'), workGraphHeld: held, preview,
    },
    cost: { ...s.cost },
  };
}

/**
 * Mark a revision offline (its bytes are not served and it cannot become a head; its metadata stays readable) or
 * bring it back. A person's act; the route that exposes it must be Super-Admin-only.
 */
export async function setRevisionOffline(
  env: BlobEnv, ctx: ValidationContext, input: { revisionUid: string; offline: boolean; actor: Actor; reason: string },
): Promise<{ ok: true; changed: boolean; cost: BlobCost } | BlobRefusal> {
  const s = new Spend(env);
  if (input?.actor?.kind !== 'person' || !actorOk(input.actor)) return s.refuse('person_required', [], null);
  if (typeof input.revisionUid !== 'string' || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 500) return s.refuse('malformed', [], null);
  const r = await readRevision(env, s, input.revisionUid);
  if (!r) return s.refuse('not_found', [input.revisionUid], null);
  if (outOfScope(ctx, scopeOfRow(r), r.access_class as AccessClass)) {
    return s.refuse('wrong_tenant', [r.revision_uid], { tenantId: r.tenant_id, companyId: r.company_id, revisionUid: r.revision_uid, actor: input.actor, action: input.offline ? 'offline_set' : 'offline_cleared' });
  }
  const at = WORK_GRAPH_BLOB_DEPS.now().toISOString();
  const write = input.offline
    ? env.DB.prepare(
      `INSERT INTO work_graph_revision_flags (revision_uid, flag, tenant_id, company_id, asset_uid, set_at)
       VALUES (?, 'offline', ?, ?, ?, ?)
       ON CONFLICT (revision_uid, flag) DO UPDATE SET set_at = excluded.set_at, cleared_at = NULL WHERE cleared_at IS NOT NULL`,
    ).bind(r.revision_uid, r.tenant_id, r.company_id, r.asset_uid, at)
    : env.DB.prepare(
      `UPDATE work_graph_revision_flags SET cleared_at = ? WHERE revision_uid = ? AND flag = 'offline' AND cleared_at IS NULL`,
    ).bind(at, r.revision_uid);
  const audit = env.DB.prepare(
    `INSERT INTO work_graph_integrity_events (tenant_id, company_id, asset_uid, revision_uid, digest, action, outcome,
       actor_kind, actor_user_id, detail_json, d1_statements, created_at)
     SELECT ?, ?, ?, ?, ?, ?, 'applied', 'person', ?, ?, ?, ? WHERE changes() > 0`,
  ).bind(r.tenant_id, r.company_id, r.asset_uid, r.revision_uid, r.digest, input.offline ? 'offline_set' : 'offline_cleared',
    input.actor.userId, JSON.stringify({ reason: input.reason }), s.cost.d1Statements + 2, at);
  const res = await s.batch([write, audit]);
  return { ok: true, changed: Number(res[0]?.meta?.changes ?? 0) > 0, cost: { ...s.cost } };
}

