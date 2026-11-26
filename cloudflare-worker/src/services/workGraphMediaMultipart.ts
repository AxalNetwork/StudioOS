/**
 * D5583 part 3 (#5583): checksummed, resumable multipart upload of one creative-media object, through the existing
 * blob service, media admission and member storage guard. Preview-only and unmounted: no route calls it, and no
 * production upload, rendition provider or signed delivery is activated here.
 *
 *   beginMediaMultipart    the caller declares the object (asset, expected head, class, type, size, SHA-256) with its
 *                          provenance, use and pins. Everything but the bytes is admitted now by the buffered path's
 *                          own rules (`checkMediaContext`, `beginStreamAdmission`), the D1170 guard is asked for the
 *                          declared size, and an R2 multipart upload is opened at the object's content-addressed media
 *                          key. The session row holds progress only; it is not a blob ledger.
 *   uploadMediaPart        parts arrive in order, each at most `MEDIA_BUFFER_MAX_BYTES` and with its own SHA-256. A
 *                          part is hashed, admitted (signature, header, PNG chunk walk, trailer) and chained into the
 *                          running hash of the whole object before R2 sees it. A retry of an acknowledged part with
 *                          the same bytes is idempotent; different bytes are `part_conflict`; a gap is `out_of_order`.
 *                          The last part's chained digest must be the declared one, or the upload fails closed and is
 *                          aborted before anything lands at the key.
 *   finishMediaMultipart   the caller repeats the declared context (its digest must match), which is re-admitted on
 *                          the current clock and head; the guard is asked again; R2 commits the parts only when the
 *                          chained hash is the key's digest (`completeContentAddressedMultipart`); `recordFinishedBlob`
 *                          stream-verifies what R2 holds and writes the existing ledger row. An intact object already at
 *                          the key is reused and this upload aborted. No head moves.
 *   abandonMediaMultipart  the uploader aborts an open upload.
 *   sweepMediaMultiparts   a company-wide caller aborts open uploads whose session expired (bounded per call).
 *
 * The clock is `WORK_GRAPH_BLOB_DEPS.now`; ids come from `MEDIA_MULTIPART_DEPS.newId` (swappable in tests, D5614).
 * Decision: `documentation/architecture/decisions/D5583-p3.md`.
 */
import type { Env } from '../types';
import {
  WORK_GRAPH_BLOB_DEPS, WORK_GRAPH_BLOB_LIMITS, actorOk, blobKey, integrityEventStatement, outOfScope, recordFinishedBlob,
  residencyAllowed, type BlobCost, type BlobRefusal, type PutVerifiedResult,
} from './workGraphBlobs';
import { sha256Hex, type AccessClass, type Actor, type Scope, type ValidationContext } from './workGraphContracts';
import { MEDIA_FORMATS, admitStreamPart, beginStreamAdmission, type ObjectClass, type ProvenanceCode, type StreamAdmissionState } from './workGraphMedia';
import {
  MEDIA_BUFFER_MAX_BYTES, checkMediaContext, countedEnv, mediaContextMalformed, mediaStorageRoom, revokedAuthor,
  type MediaContextInput, type PreparationCode,
} from './workGraphMediaStorage';
import { Sha256 } from './sha256Incremental';
import { stable } from './decks/coedit';
import { noteStorageLanded, type StorageTicket } from './storageRoom';
import {
  abortContentAddressedMultipart, completeContentAddressedMultipart, createContentAddressedMultipart, uploadContentAddressedPart,
} from './recordStore';

export const MEDIA_MULTIPART_LIMITS = Object.freeze({
  /** Every part but the last is exactly this size: the buffered cap, never more, and above R2's 5 MiB minimum. */
  partBytes: MEDIA_BUFFER_MAX_BYTES,
  /** Smaller objects take the buffered path, where `admitMedia` reads the whole file. */
  minBytes: MEDIA_BUFFER_MAX_BYTES + 1,
  /** An open upload is abandoned after this long; the same as reconciliation's grace period. */
  sessionTtlMs: 24 * 60 * 60 * 1000,
  /** Open uploads per company at once, so abandoned parts stay bounded. */
  maxOpenPerCompany: 16,
  sweepLimit: 100,
  maxSweepLimit: 500,
});
export type MediaMultipartLimits = typeof MEDIA_MULTIPART_LIMITS;

export const MEDIA_MULTIPART_DEPS: { newId: () => string } = { newId: () => `mpu_${crypto.randomUUID()}` };

export type MultipartCode = PreparationCode | 'use_buffered' | 'residency_mismatch' | 'no_binding' | 'too_many_open'
  | 'tenant_limit' | 'not_uploader' | 'upload_closed' | 'upload_expired' | 'out_of_order' | 'part_size'
  | 'digest_mismatch' | 'part_conflict' | 'incomplete' | 'context_mismatch' | 'missing_bytes';
export type MultipartRefusal = { ok: false; code: MultipartCode; provenance?: ProvenanceCode[]; detail?: string; cost: BlobCost };

export type MultipartBegun = { ok: true; uploadUid: string; key: string; digest: string; byteLength: number;
  partBytes: number; partCount: number; expiresAt: string; quota: StorageTicket; cost: BlobCost };
export type MultipartPart = { ok: true; uploadUid: string; partNumber: number; nextPart: number; duplicate: boolean; cost: BlobCost };
export type MultipartFinished = Exclude<PutVerifiedResult, BlobRefusal> & { uploadUid: string; objectClass: ObjectClass; mediaProfile: string;
  ownerUserId: number | null; quota: StorageTicket; cost: BlobCost };

export interface BeginMultipartInput extends MediaContextInput {
  /** SHA-256 of the whole object, lowercase hex: the content address it will be stored under. */
  digest: string;
  byteLength: number;
  residency?: string | null;
}

const HEX64 = /^[0-9a-f]{64}$/;
const posInt = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;
const authorOf = (by: Actor) => (by.kind === 'person' ? by.userId : by.onBehalfOfUserId);
const runOf = (by: Actor) => (by.kind === 'agent' ? by.agentRunId : null);

interface SessionRow {
  upload_uid: string; tenant_id: number; company_id: number; project_id: number; object_class: ObjectClass; asset_uid: string;
  access_class: AccessClass; digest: string; byte_length: number; part_bytes: number; part_count: number; residency: string | null;
  r2_upload_id: string; context_digest: string; next_part: number; hash_words: string; admission_json: string;
  author_user_id: number; agent_run_id: string | null; status: 'open' | 'completed' | 'abandoned' | 'failed';
  close_code: string | null; created_at: string; expires_at: string; closed_at: string | null;
}
const SESSION = 'SELECT * FROM work_graph_media_uploads WHERE upload_uid = ?';
const scopeOfSession = (r: SessionRow): Scope => ({ tenantId: r.tenant_id, companyId: r.company_id, projectId: r.project_id || null });
const keyOf = (r: SessionRow) => blobKey(scopeOfSession(r), r.digest, r.object_class);

/** What the finishing call must repeat exactly. A digest of ids, types and the declared rights; never stored as text. */
async function contextDigest(input: BeginMultipartInput | (MediaContextInput & { digest: string; byteLength: number; residency?: string | null })): Promise<string> {
  return sha256Hex(new TextEncoder().encode(stable({
    assetUid: input.assetUid, expectedHead: input.expectedHead, kind: input.kind, objectClass: input.objectClass,
    declaredMime: String(input.declaredMime).toLowerCase().split(';')[0].trim(), provenance: input.provenance, use: input.use,
    dependencies: input.dependencies ?? [], digest: input.digest, byteLength: input.byteLength, residency: input.residency ?? null,
  })));
}

function limitsOk(l: MediaMultipartLimits): boolean {
  return posInt(l?.partBytes) && l.partBytes % 64 === 0 && l.partBytes <= MEDIA_BUFFER_MAX_BYTES && posInt(l.minBytes)
    && l.minBytes > l.partBytes && posInt(l.sessionTtlMs) && posInt(l.maxOpenPerCompany) && posInt(l.sweepLimit) && posInt(l.maxSweepLimit);
}

/** Shared by every call: a refusal is audited (ids and the code only) and returned with the call's cost. */
function auditor(db: D1Database, cost: BlobCost, base: { tenantId: number; companyId: number }, by: Actor | null | undefined) {
  return async (code: string, detail: Record<string, unknown>, extra: Partial<MultipartRefusal> = {}): Promise<MultipartRefusal> => {
    await integrityEventStatement(db, { ...base, actor: actorOk(by) ? by : null, system: !actorOk(by), action: 'blob_refused',
      outcome: 'refused', refusalCode: code, detail, cost: { ...cost, d1Statements: cost.d1Statements + 1 },
      at: WORK_GRAPH_BLOB_DEPS.now().toISOString() }).run();
    return { ok: false, code: code as MultipartCode, ...extra, cost: { ...cost } };
  };
}

// ── begin ────────────────────────────────────────────────────────────────────

export async function beginMediaMultipart(
  env: Env, ctx: ValidationContext, input: BeginMultipartInput, limits: MediaMultipartLimits = MEDIA_MULTIPART_LIMITS,
): Promise<MultipartBegun | MultipartRefusal> {
  const { counted, db, cost } = countedEnv(env);
  const refuse = auditor(db, cost, { tenantId: ctx.scope.tenantId, companyId: ctx.scope.companyId }, input?.by);
  const plain = (code: MultipartCode): MultipartRefusal => ({ ok: false, code, cost: { ...cost } });
  if (mediaContextMalformed(input) || typeof input.digest !== 'string' || !HEX64.test(input.digest) || !posInt(input.byteLength)
    || !(input.residency == null || typeof input.residency === 'string') || !limitsOk(limits)) return plain('malformed');
  if (input.byteLength < limits.minBytes) return plain('use_buffered');
  if (revokedAuthor(ctx, input.by)) return refuse('revoked_author', { phase: 'multipart_begin' });
  const admission = beginStreamAdmission({ kind: input.kind, objectClass: input.objectClass, declaredMime: input.declaredMime, byteLength: input.byteLength });
  if (!admission.ok) return refuse(admission.code, { phase: 'multipart_begin', detail: admission.detail }, { detail: admission.detail });
  const context = await checkMediaContext(counted, ctx, input, cost);
  if (!context.ok) return refuse(context.code, { phase: 'multipart_begin' }, context.provenance ? { provenance: context.provenance } : {});
  const scope = context.scope;
  if (!residencyAllowed(input.residency ?? null, WORK_GRAPH_BLOB_DEPS.jurisdiction)) return refuse('residency_mismatch', { phase: 'multipart_begin' });
  if (!counted.FILES) return refuse('no_binding', { phase: 'multipart_begin' });
  const now = WORK_GRAPH_BLOB_DEPS.now();
  const open = await db.prepare(
    `SELECT COUNT(*) AS n FROM work_graph_media_uploads WHERE tenant_id = ? AND company_id = ? AND status = 'open' AND datetime(expires_at) > datetime(?)`,
  ).bind(scope.tenantId, scope.companyId, now.toISOString()).first<{ n: number }>();
  if (Number(open?.n ?? 0) >= limits.maxOpenPerCompany) return refuse('too_many_open', { phase: 'multipart_begin' });
  const room = await mediaStorageRoom(counted, { scope, objectClass: input.objectClass, digest: input.digest, byteLength: input.byteLength, by: input.by },
    async (code) => { await refuse(code, { phase: 'multipart_begin' }); });
  if (!room.ok) return plain(room.code);
  const used = await db.prepare('SELECT COALESCE(SUM(byte_length), 0) AS n FROM work_graph_blobs WHERE tenant_id = ? AND deleted_at IS NULL')
    .bind(scope.tenantId).first<{ n: number }>();
  if (room.ticket.incoming > 0 && Number(used?.n ?? 0) + input.byteLength > WORK_GRAPH_BLOB_LIMITS.maxBytesPerTenant) return refuse('tenant_limit', { phase: 'multipart_begin' });

  const key = blobKey(scope, input.digest, input.objectClass);
  const upload = await createContentAddressedMultipart(counted.FILES, key, input.digest, {
    customMetadata: { wg: 'v1', digest: input.digest, size: String(input.byteLength), tenant: String(scope.tenantId),
      company: String(scope.companyId), access: context.accessClass },
    httpMetadata: { contentType: 'application/octet-stream' },
  });
  const uploadUid = MEDIA_MULTIPART_DEPS.newId();
  const partCount = Math.ceil(input.byteLength / limits.partBytes);
  const at = now.toISOString();
  const expiresAt = new Date(now.getTime() + limits.sessionTtlMs).toISOString();
  const start = new Sha256().exportState().words;
  await db.prepare(
      `INSERT INTO work_graph_media_uploads (upload_uid, tenant_id, company_id, project_id, object_class, asset_uid, access_class, digest,
         byte_length, part_bytes, part_count, residency, r2_upload_id, context_digest, next_part, hash_words, admission_json,
         author_user_id, agent_run_id, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 'open', ?, ?)`,
    ).bind(uploadUid, scope.tenantId, scope.companyId, scope.projectId ?? 0, input.objectClass, context.assetUid, context.accessClass, input.digest,
      input.byteLength, limits.partBytes, partCount, input.residency ?? null, upload.uploadId, await contextDigest(input), start,
      JSON.stringify(admission.state), authorOf(input.by), runOf(input.by), at, expiresAt).run();
  return { ok: true, uploadUid, key, digest: input.digest, byteLength: input.byteLength, partBytes: limits.partBytes, partCount,
    expiresAt, quota: room.ticket, cost: { ...cost } };
}

// ── the session checks every later call makes ───────────────────────────────

type Loaded = { ok: true; row: SessionRow } | { ok: false; code: MultipartCode };
async function loadSession(db: D1Database, ctx: ValidationContext, uploadUid: string, by: Actor, opts: { allowExpired?: boolean } = {}): Promise<Loaded> {
  const row = await db.prepare(SESSION).bind(uploadUid).first<SessionRow>();
  if (!row) return { ok: false, code: 'not_found' };
  if (outOfScope(ctx, scopeOfSession(row), row.access_class)) return { ok: false, code: 'wrong_tenant' };
  if (authorOf(by) !== row.author_user_id || runOf(by) !== row.agent_run_id) return { ok: false, code: 'not_uploader' };
  if (revokedAuthor(ctx, by)) return { ok: false, code: 'revoked_author' };
  if (row.status !== 'open') return { ok: false, code: 'upload_closed' };
  if (!opts.allowExpired && WORK_GRAPH_BLOB_DEPS.now().getTime() >= Date.parse(row.expires_at)) return { ok: false, code: 'upload_expired' };
  return { ok: true, row };
}

/** Close an open session and abort its R2 upload. The abort is best effort: R2 may already have discarded it. */
async function closeSession(env: Env, db: D1Database, cost: BlobCost, row: SessionRow, status: 'failed' | 'abandoned', code: string): Promise<boolean> {
  try {
    await abortContentAddressedMultipart(env.FILES!, keyOf(row), row.digest, row.r2_upload_id);
  } catch { /* already completed, aborted or expired at R2 */ }
  cost.r2ClassA++;
  const res = await db.prepare(
    `UPDATE work_graph_media_uploads SET status = ?, close_code = ?, closed_at = ? WHERE upload_uid = ? AND status = 'open'`,
  ).bind(status, code, WORK_GRAPH_BLOB_DEPS.now().toISOString(), row.upload_uid).run();
  return Number(res.meta?.changes ?? 0) > 0;
}

// ── parts ────────────────────────────────────────────────────────────────────

export async function uploadMediaPart(
  env: Env, ctx: ValidationContext, input: { uploadUid: string; partNumber: number; bytes: Uint8Array; partDigest: string; by: Actor },
): Promise<MultipartPart | MultipartRefusal> {
  const { counted, db, cost } = countedEnv(env);
  const plain = (code: MultipartCode): MultipartRefusal => ({ ok: false, code, cost: { ...cost } });
  if (!input || typeof input.uploadUid !== 'string' || !input.uploadUid || input.uploadUid.length > 80 || !posInt(input.partNumber)
    || !(input.bytes instanceof Uint8Array) || typeof input.partDigest !== 'string' || !HEX64.test(input.partDigest) || !actorOk(input.by)) return plain('malformed');
  if (input.bytes.byteLength > MEDIA_BUFFER_MAX_BYTES) return plain('oversized');
  // Snapshot before the first await: the bytes hashed, admitted and sent are one copy.
  const bytes = input.bytes.slice();
  const loaded = await loadSession(db, ctx, input.uploadUid, input.by);
  const refuse = auditor(db, cost, loaded.ok ? { tenantId: loaded.row.tenant_id, companyId: loaded.row.company_id } : ctx.scope, input.by);
  const detail = (extra: Record<string, unknown> = {}) => ({ phase: 'multipart_part', upload_uid: input.uploadUid, part: input.partNumber, ...extra });
  if (!loaded.ok) return refuse(loaded.code, detail());
  const row = loaded.row;
  if (input.partNumber > row.part_count) return refuse('malformed', detail());
  const expected = input.partNumber < row.part_count ? row.part_bytes : row.byte_length - (row.part_count - 1) * row.part_bytes;
  if (bytes.byteLength !== expected) return refuse('part_size', detail({ expected, got: bytes.byteLength }));
  const digest = await sha256Hex(bytes);
  if (digest !== input.partDigest) return refuse('digest_mismatch', detail({ scope: 'part' }));
  const key = keyOf(row);

  if (input.partNumber < row.next_part) {
    // A retry of an acknowledged part. Only the same bytes are accepted; they are sent again so R2 holds exactly
    // what the chained hash covered (a lost race may have left another body under that part number).
    const known = await db.prepare('SELECT digest FROM work_graph_media_upload_parts WHERE upload_uid = ? AND part_number = ?')
      .bind(row.upload_uid, input.partNumber).first<{ digest: string }>();
    if (!known || known.digest !== digest) return refuse('part_conflict', detail());
    let part: R2UploadedPart;
    try { part = await uploadContentAddressedPart(counted.FILES!, key, row.digest, row.r2_upload_id, input.partNumber, bytes); } catch { cost.r2ClassA++; return plain('unavailable'); }
    cost.r2ClassA++;
    await db.prepare('UPDATE work_graph_media_upload_parts SET etag = ?, uploaded_at = ? WHERE upload_uid = ? AND part_number = ? AND digest = ?')
      .bind(part.etag, WORK_GRAPH_BLOB_DEPS.now().toISOString(), row.upload_uid, input.partNumber, digest).run();
    return { ok: true, uploadUid: row.upload_uid, partNumber: input.partNumber, nextPart: row.next_part, duplicate: true, cost: { ...cost } };
  }
  if (input.partNumber > row.next_part) return refuse('out_of_order', detail({ next: row.next_part }));

  // The next part: admit it, chain it, and fail the whole upload closed on a refusal, before R2 sees the part.
  const offset = (input.partNumber - 1) * row.part_bytes;
  const mime = MEDIA_FORMATS.find((f) => f.id === (JSON.parse(row.admission_json) as StreamAdmissionState).f)?.mime ?? '';
  const admitted = admitStreamPart(JSON.parse(row.admission_json), bytes, { offset, total: row.byte_length, declaredMime: mime });
  const fail = async (code: MultipartCode, why: Record<string, unknown>) => {
    await closeSession(counted, db, cost, row, 'failed', code);
    return refuse(code, detail({ ...why, closed: true }));
  };
  if (!admitted.ok) return fail(admitted.code, { detail: admitted.detail });
  const hash = Sha256.resume({ words: row.hash_words, bytes: offset }).update(bytes);
  const last = input.partNumber === row.part_count;
  const words = last ? hash.hex() : hash.exportState().words;
  if (last && words !== row.digest) return fail('digest_mismatch', { scope: 'whole' });
  let part: R2UploadedPart;
  try { part = await uploadContentAddressedPart(counted.FILES!, key, row.digest, row.r2_upload_id, input.partNumber, bytes); } catch { cost.r2ClassA++; return plain('unavailable'); }
  cost.r2ClassA++;
  const at = WORK_GRAPH_BLOB_DEPS.now().toISOString();
  const res = await db.batch([
    db.prepare(
      `UPDATE work_graph_media_uploads SET next_part = next_part + 1, hash_words = ?, admission_json = ?
        WHERE upload_uid = ? AND status = 'open' AND next_part = ?`,
    ).bind(words, JSON.stringify(admitted.state), row.upload_uid, input.partNumber),
    db.prepare(
      `INSERT INTO work_graph_media_upload_parts (upload_uid, part_number, digest, byte_length, etag, uploaded_at)
       SELECT ?, ?, ?, ?, ?, ? WHERE changes() > 0`,
    ).bind(row.upload_uid, input.partNumber, digest, bytes.byteLength, part.etag, at),
  ]);
  // Another request advanced this part first. Its bytes are the ones the hash covers; this caller retries as a duplicate.
  if (Number(res[0]?.meta?.changes ?? 0) === 0) return refuse('part_conflict', detail({ raced: true }));
  return { ok: true, uploadUid: row.upload_uid, partNumber: input.partNumber, nextPart: input.partNumber + 1, duplicate: false, cost: { ...cost } };
}

// ── finish ───────────────────────────────────────────────────────────────────

export async function finishMediaMultipart(
  env: Env, ctx: ValidationContext, input: BeginMultipartInput & { uploadUid: string },
): Promise<MultipartFinished | MultipartRefusal> {
  const { counted, db, cost } = countedEnv(env);
  const plain = (code: MultipartCode): MultipartRefusal => ({ ok: false, code, cost: { ...cost } });
  if (mediaContextMalformed(input) || typeof input.uploadUid !== 'string' || !input.uploadUid || input.uploadUid.length > 80
    || typeof input.digest !== 'string' || !HEX64.test(input.digest) || !posInt(input.byteLength)) return plain('malformed');
  const loaded = await loadSession(db, ctx, input.uploadUid, input.by);
  const refuse = auditor(db, cost, loaded.ok ? { tenantId: loaded.row.tenant_id, companyId: loaded.row.company_id } : ctx.scope, input.by);
  const detail = (extra: Record<string, unknown> = {}) => ({ phase: 'multipart_finish', upload_uid: input.uploadUid, ...extra });
  if (!loaded.ok) return refuse(loaded.code, detail());
  const row = loaded.row;
  if (await contextDigest(input) !== row.context_digest) return refuse('context_mismatch', detail());
  if (row.next_part !== row.part_count + 1) return refuse('incomplete', detail({ next: row.next_part }), { detail: String(row.next_part) });
  const fail = async (code: MultipartCode, why: Record<string, unknown> = {}, extra: Partial<MultipartRefusal> = {}) => {
    await closeSession(counted, db, cost, row, 'failed', code);
    return refuse(code, detail({ ...why, closed: true }), extra);
  };
  if (row.hash_words !== row.digest) return fail('digest_mismatch', { scope: 'whole' });
  // Re-admit on the current clock and head: rights may have been revoked and the head may have moved since begin.
  const context = await checkMediaContext(counted, ctx, input, cost);
  if (!context.ok) {
    if (context.code === 'unavailable') return plain('unavailable');
    return fail(context.code, {}, context.provenance ? { provenance: context.provenance } : {});
  }
  const scope = scopeOfSession(row);
  if (context.scope.tenantId !== scope.tenantId || context.scope.companyId !== scope.companyId || context.scope.projectId !== scope.projectId) return fail('wrong_tenant');
  const room = await mediaStorageRoom(counted, { scope, objectClass: row.object_class, digest: row.digest, byteLength: row.byte_length, by: input.by },
    async (code) => { await refuse(code, detail()); });
  if (!room.ok) return plain(room.code);

  const key = keyOf(row);
  const existing = await counted.FILES!.head(key);
  const existingSum = existing?.checksums?.sha256 ? [...new Uint8Array(existing.checksums.sha256)].map((b) => b.toString(16).padStart(2, '0')).join('') : null;
  const reused = !!existing && existing.size === row.byte_length && existingSum === row.digest;
  if (reused) {
    // The same bytes are already intact at their key (a buffered upload, or another finished one): keep that object.
    try { await abortContentAddressedMultipart(counted.FILES!, key, row.digest, row.r2_upload_id); } catch { /* already gone */ }
    cost.r2ClassA++;
  } else {
    const parts = (await db.prepare('SELECT part_number, etag FROM work_graph_media_upload_parts WHERE upload_uid = ? ORDER BY part_number')
      .bind(row.upload_uid).all<{ part_number: number; etag: string }>()).results ?? [];
    if (parts.length !== row.part_count) return fail('incomplete', { parts: parts.length });
    try {
      await completeContentAddressedMultipart(counted.FILES!, key, row.digest, row.hash_words, row.r2_upload_id,
        parts.map((p) => ({ partNumber: p.part_number, etag: p.etag })));
    } catch {
      cost.r2ClassA++;
      // R2 refused the commit (a part body was replaced under its number, or the upload is gone). Nothing landed;
      // the session stays open, so the uploader can resend acknowledged parts and finish again.
      return refuse('part_conflict', detail({ commit: 'refused' }));
    }
    cost.r2ClassA++;
  }
  const stored = await recordFinishedBlob(counted, ctx, { scope, objectClass: row.object_class, digest: row.digest, size: row.byte_length,
    storageOwnerUserId: room.ownerUserId, accessClass: row.access_class, residency: row.residency, actor: input.by, assetUid: row.asset_uid,
    reused, detail: { upload_uid: row.upload_uid, parts: row.part_count } });
  if (!stored.ok) {
    // The object is a record and is never deleted here; with no ledger row or revision naming it, reconciliation
    // collects it as an orphan after the grace period.
    await db.prepare(`UPDATE work_graph_media_uploads SET status = 'failed', close_code = ?, closed_at = ? WHERE upload_uid = ? AND status = 'open'`)
      .bind(stored.code, WORK_GRAPH_BLOB_DEPS.now().toISOString(), row.upload_uid).run();
    return { ok: false, code: stored.code as MultipartCode, detail: stored.ids.join(','), cost: { ...cost } };
  }
  await db.prepare(`UPDATE work_graph_media_uploads SET status = 'completed', close_code = ?, closed_at = ? WHERE upload_uid = ? AND status = 'open'`)
    .bind(reused ? 'reused' : 'stored', WORK_GRAPH_BLOB_DEPS.now().toISOString(), row.upload_uid).run();
  if (room.ticket.incoming > 0) await noteStorageLanded(counted, room.ticket);
  const format = MEDIA_FORMATS.find((f) => f.id === (JSON.parse(row.admission_json) as StreamAdmissionState).f);
  return { ...stored, uploadUid: row.upload_uid, objectClass: row.object_class, mediaProfile: format?.mime ?? '',
    ownerUserId: room.ownerUserId, quota: room.ticket, cost: { ...cost } };
}

// ── abandon and sweep ────────────────────────────────────────────────────────

export async function abandonMediaMultipart(
  env: Env, ctx: ValidationContext, input: { uploadUid: string; by: Actor },
): Promise<{ ok: true; uploadUid: string; changed: boolean; cost: BlobCost } | MultipartRefusal> {
  const { counted, db, cost } = countedEnv(env);
  if (!input || typeof input.uploadUid !== 'string' || !input.uploadUid || input.uploadUid.length > 80 || !actorOk(input.by)) {
    return { ok: false, code: 'malformed', cost: { ...cost } };
  }
  const loaded = await loadSession(db, ctx, input.uploadUid, input.by, { allowExpired: true });
  if (!loaded.ok) return auditor(db, cost, ctx.scope, input.by)(loaded.code, { phase: 'multipart_abandon', upload_uid: input.uploadUid });
  const changed = await closeSession(counted, db, cost, loaded.row, 'abandoned', 'abandoned');
  return { ok: true, uploadUid: input.uploadUid, changed, cost: { ...cost } };
}

/**
 * Abort open uploads of one company whose session expired. Their parts never entered the ledger or the meter, so
 * nothing is uncharged; R2's uncommitted parts are discarded. A company-wide caller only, like reconciliation.
 */
export async function sweepMediaMultiparts(
  env: Env, ctx: ValidationContext, input: { scope: Pick<Scope, 'tenantId' | 'companyId'>; limit?: number },
  limits: MediaMultipartLimits = MEDIA_MULTIPART_LIMITS,
): Promise<{ ok: true; abandoned: string[]; cost: BlobCost } | MultipartRefusal> {
  const { counted, db, cost } = countedEnv(env);
  const limit = input?.limit ?? limits.sweepLimit;
  if (!posInt(input?.scope?.tenantId) || !posInt(input.scope.companyId) || !posInt(limit) || limit > limits.maxSweepLimit) {
    return { ok: false, code: 'malformed', cost: { ...cost } };
  }
  const scope: Scope = { tenantId: input.scope.tenantId, companyId: input.scope.companyId, projectId: null };
  if (outOfScope(ctx, scope, 'restricted')) return auditor(db, cost, scope, null)('wrong_tenant', { phase: 'multipart_sweep' });
  if (!counted.FILES) return { ok: false, code: 'no_binding', cost: { ...cost } };
  const at = WORK_GRAPH_BLOB_DEPS.now().toISOString();
  const expired = (await db.prepare(
    `SELECT * FROM work_graph_media_uploads WHERE tenant_id = ? AND company_id = ? AND status = 'open' AND datetime(expires_at) <= datetime(?)
      ORDER BY expires_at, upload_uid LIMIT ?`,
  ).bind(scope.tenantId, scope.companyId, at, limit).all<SessionRow>()).results ?? [];
  const abandoned: string[] = [];
  for (const row of expired) {
    if (await closeSession(counted, db, cost, row, 'abandoned', 'expired')) abandoned.push(row.upload_uid);
  }
  return { ok: true, abandoned, cost: { ...cost } };
}
