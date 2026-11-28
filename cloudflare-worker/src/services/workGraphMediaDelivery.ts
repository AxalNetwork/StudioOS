/**
 * D5583 part 4 (#5583): short-lived signed delivery of creative-media revisions, streamed through the existing blob
 * service. Preview-only and unmounted, like parts 2 and 3: no route calls it, and no public link is activated here.
 *
 *   mintMediaDelivery  a caller in scope asks for a link to a media revision (a typed `master`, `snapshot`,
 *                      `rendition` or `thumbnail` object) that is its asset's current head, live and unflagged. The
 *                      token binds tenant, company and project, the asset and revision, the digest and size, the
 *                      object class, the head sequence, an expiry of at most five minutes (the download links' own
 *                      ceiling, task #33), an id, and who minted it. It is signed by `signedDownload.ts`'s secret and
 *                      token shape under a key derived for this one purpose, so `/api/files/dl` can never redeem it.
 *   openMediaDelivery  verifies the signature (constant time) and the expiry, checks the reader's scope against the
 *                      bound scope and that the minter is not revoked, then hands the binding to
 *                      `streamRevisionBytes`, which rechecks it against the revision as it is now (scope, digest, size,
 *                      class, still the head at the same head sequence, not tombstoned or flagged) and streams the
 *                      bytes, hashed as they pass, with the last chunk held back until the digest matches.
 *
 * A link may be opened more than once before it expires (a preview is re-requested); what it opens is rechecked every
 * time, so a superseded, revoked or rotted revision stops it at once. Minting writes nothing; every open is audited in
 * `work_graph_integrity_events` (`bytes_read`, or `read_refused` with the code) with the link's id and minter.
 *
 * The clock is `WORK_GRAPH_BLOB_DEPS.now`; ids come from `MEDIA_DELIVERY_DEPS.newId` (swappable in tests, D5614).
 * Decision: `documentation/architecture/decisions/D5583-p4.md`.
 */
import type { Env } from '../types';
import {
  WORK_GRAPH_BLOB_DEPS, Spend, actorOk, blobKey, isWorkGraphBlobSource, outOfScope, parseBlobKey, streamRevisionBytes,
  type BlobClass, type BlobCost, type BlobRefusal, type BlobRefusalCode, type StreamBytesResult,
} from './workGraphBlobs';
import type { AccessClass, Actor, Scope, SourceRef, ValidationContext } from './workGraphContracts';
import { revokedAuthor } from './workGraphMediaStorage';
import { signPurposeToken, verifyPurposeToken } from './signedDownload';

export const MEDIA_DELIVERY_PURPOSE = 'wg-media-delivery';
export const MEDIA_DELIVERY_LIMITS = Object.freeze({
  /** Five minutes, the ceiling `signedDownload.ts` holds every private download link to. */
  maxTtlSec: 300,
  defaultTtlSec: 300,
});
export const MEDIA_DELIVERY_DEPS: { newId: () => string } = { newId: () => `dl_${crypto.randomUUID()}` };

type MediaClass = Exclude<BlobClass, 'generic'>;
const MEDIA_CLASSES: readonly MediaClass[] = ['master', 'snapshot', 'rendition', 'thumbnail'];

export type DeliveryCode = BlobRefusalCode | 'expired' | 'bad_signature' | 'no_signing_key';
export type DeliveryRefusal = BlobRefusal<DeliveryCode>;
type DeliveryEnv = Pick<Env, 'DB'> & Partial<Pick<Env, 'KEK_R2' | 'JWT_SECRET'>> & { FILES?: R2Bucket };

/** The claims a delivery token carries. Ids, a digest and numbers only; never content or a key. */
interface Claims {
  v: 1; t: number; c: number; pr: number | null; a: string; r: string; d: string; n: number; k: MediaClass; s: number;
  iat: number; exp: number; jti: string; sub: number; run: string | null;
}

export type MediaDeliveryLink = {
  ok: true; token: string; expiresAt: string; revisionUid: string; digest: string; size: number; objectClass: MediaClass; cost: BlobCost;
};
export type MediaDeliveryStream = Extract<StreamBytesResult, { ok: true }> & { revisionUid: string; expiresAt: string };

const posInt = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;
const nonNeg = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const uid = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 80;
const secretOk = (env: DeliveryEnv) => (env.KEK_R2 || env.JWT_SECRET || '').length >= 16;
const nowSec = () => Math.floor(WORK_GRAPH_BLOB_DEPS.now().getTime() / 1000);

interface HeadRow {
  revision_uid: string; asset_uid: string; tenant_id: number; company_id: number; project_id: number | null; digest: string;
  byte_length: number; source_store: string; source_locator: string; source_id: string; tombstoned_at: string | null;
  access_class: string; head_revision_uid: string | null; head_seq: number; flags: string | null;
}

/** The refusal a live revision flag answers with; the head swap refuses a revision with any of them, and so does a link. */
export function flagCode(flags: readonly string[]): DeliveryCode {
  return flags.includes('offline') ? 'offline' : flags.includes('bytes_deleted') ? 'bytes_deleted'
    : flags.includes('bytes_missing') ? 'missing_bytes' : 'residency_mismatch';
}

/** Mint a short-lived signed link to a media revision that is its asset's live head. Writes nothing. */
export async function mintMediaDelivery(
  env: DeliveryEnv, ctx: ValidationContext, input: { revisionUid: string; actor: Actor; ttlSec?: number },
): Promise<MediaDeliveryLink | DeliveryRefusal> {
  const s = new Spend(env);
  const ttl = input?.ttlSec ?? MEDIA_DELIVERY_LIMITS.defaultTtlSec;
  if (!uid(input?.revisionUid) || !actorOk(input.actor) || !posInt(ttl) || ttl > MEDIA_DELIVERY_LIMITS.maxTtlSec) {
    return s.refuse<DeliveryCode>('malformed', [], null);
  }
  const r = await s.first<HeadRow>(env.DB.prepare(
    `SELECT r.revision_uid, r.asset_uid, r.tenant_id, r.company_id, r.project_id, r.digest, r.byte_length,
            r.source_store, r.source_locator, r.source_id, r.tombstoned_at, a.access_class, a.head_revision_uid, a.head_seq,
            (SELECT group_concat(f.flag) FROM work_graph_revision_flags f WHERE f.revision_uid = r.revision_uid AND f.cleared_at IS NULL) AS flags
       FROM work_graph_revisions r JOIN work_graph_assets a ON a.asset_uid = r.asset_uid
      WHERE r.revision_uid = ?`,
  ).bind(input.revisionUid));
  if (!r) return s.refuse<DeliveryCode>('not_found', [input.revisionUid], null);
  const ev = { tenantId: r.tenant_id, companyId: r.company_id, assetUid: r.asset_uid, revisionUid: r.revision_uid, digest: r.digest,
    actor: input.actor, action: 'read_refused', detail: { phase: 'delivery_mint' } };
  const scope: Scope = { tenantId: r.tenant_id, companyId: r.company_id, projectId: r.project_id };
  if (outOfScope(ctx, scope, r.access_class as AccessClass)) return s.refuse<DeliveryCode>('wrong_tenant', [r.revision_uid], ev);
  if (revokedAuthor(ctx, input.actor)) return s.refuse<DeliveryCode>('revoked', [r.revision_uid, 'minter'], ev);
  if (r.tombstoned_at !== null) return s.refuse<DeliveryCode>('revoked', [r.revision_uid, 'tombstoned'], ev);
  const flags = (r.flags ?? '').split(',').filter(Boolean).sort();
  if (flags.length) return s.refuse<DeliveryCode>(flagCode(flags), [r.revision_uid, ...flags], ev);
  const parsed = isWorkGraphBlobSource({ store: r.source_store as SourceRef['store'], locator: r.source_locator, id: r.source_id }) ? parseBlobKey(r.source_id) : null;
  const objectClass = parsed?.objectClass as MediaClass | undefined;
  if (!objectClass) return s.refuse<DeliveryCode>('not_media', [r.revision_uid], ev);
  if (r.source_id !== blobKey(scope, r.digest, objectClass)) return s.refuse<DeliveryCode>('digest_mismatch', [r.revision_uid, 'key'], ev);
  if (r.head_revision_uid !== r.revision_uid) return s.refuse<DeliveryCode>('superseded', [r.revision_uid], ev);
  if (!secretOk(env)) return s.refuse<DeliveryCode>('no_signing_key', [], ev);
  const iat = nowSec();
  const claims: Claims = {
    v: 1, t: r.tenant_id, c: r.company_id, pr: r.project_id, a: r.asset_uid, r: r.revision_uid, d: r.digest, n: Number(r.byte_length),
    k: objectClass, s: Number(r.head_seq), iat, exp: iat + ttl, jti: MEDIA_DELIVERY_DEPS.newId(),
    sub: input.actor.kind === 'person' ? input.actor.userId : input.actor.onBehalfOfUserId,
    run: input.actor.kind === 'agent' ? input.actor.agentRunId : null,
  };
  const token = await signPurposeToken(env as Pick<Env, 'KEK_R2' | 'JWT_SECRET'>, MEDIA_DELIVERY_PURPOSE, { ...claims });
  if (!token) return s.refuse<DeliveryCode>('no_signing_key', [], ev);
  return { ok: true, token, expiresAt: new Date(claims.exp * 1000).toISOString(), revisionUid: r.revision_uid, digest: r.digest,
    size: claims.n, objectClass, cost: { ...s.cost } };
}

function claimsOf(raw: Record<string, unknown>): Claims | null {
  const c = raw as Partial<Claims>;
  if (c.v !== 1 || !posInt(c.t) || !posInt(c.c) || !(c.pr === null || posInt(c.pr)) || !uid(c.a) || !uid(c.r)
    || typeof c.d !== 'string' || !/^[0-9a-f]{64}$/.test(c.d) || !nonNeg(c.n) || !MEDIA_CLASSES.includes(c.k as MediaClass)
    || !nonNeg(c.s) || !nonNeg(c.iat) || !posInt(c.exp) || c.exp <= c.iat || c.exp - c.iat > MEDIA_DELIVERY_LIMITS.maxTtlSec
    || !uid(c.jti) || !posInt(c.sub) || !(c.run === null || typeof c.run === 'string' && c.run.length > 0 && c.run.length <= 200)) return null;
  return c as Claims;
}

/**
 * Open a delivery link for a reader: the token is verified, then the bytes are streamed only while everything it was
 * minted for is still true. Every refusal is audited under the reader's scope (or the revision's, once it is known).
 */
export async function openMediaDelivery(
  env: DeliveryEnv, ctx: ValidationContext, input: { token: string; reader: Actor },
): Promise<MediaDeliveryStream | DeliveryRefusal> {
  const s = new Spend(env);
  if (!actorOk(input?.reader) || !posInt(ctx?.scope?.tenantId) || !posInt(ctx.scope.companyId)) return s.refuse<DeliveryCode>('malformed', [], null);
  const ev = { tenantId: ctx.scope.tenantId, companyId: ctx.scope.companyId, actor: input.reader, action: 'read_refused',
    detail: { phase: 'delivery_open' } as Record<string, unknown> };
  if (!secretOk(env)) return s.refuse<DeliveryCode>('no_signing_key', [], ev);
  const raw = await verifyPurposeToken(env as Pick<Env, 'KEK_R2' | 'JWT_SECRET'>, MEDIA_DELIVERY_PURPOSE, input.token);
  if (!raw) return s.refuse<DeliveryCode>('bad_signature', [], ev);
  const c = claimsOf(raw);
  if (!c) return s.refuse<DeliveryCode>('malformed', [], ev);
  const bound = { ...ev, revisionUid: c.r, assetUid: c.a, digest: c.d, detail: { ...ev.detail, link: c.jti, minted_by: c.sub } };
  if (nowSec() >= c.exp) return s.refuse<DeliveryCode>('expired', [c.r], bound);
  if (outOfScope(ctx, { tenantId: c.t, companyId: c.c, projectId: c.pr }, 'restricted')) return s.refuse<DeliveryCode>('wrong_tenant', [c.r], bound);
  if (ctx.revokedUserIds?.has(c.sub) || (c.run !== null && ctx.revokedAgentRunIds?.has(c.run))) return s.refuse<DeliveryCode>('revoked', [c.r, 'minter'], bound);
  const streamed = await streamRevisionBytes(env, ctx, {
    revisionUid: c.r, actor: input.reader,
    delivery: { tenantId: c.t, companyId: c.c, projectId: c.pr, assetUid: c.a, digest: c.d, size: c.n, objectClass: c.k, headSeq: c.s,
      detail: { link: c.jti, minted_by: c.sub, expires: c.exp } },
  });
  const cost = { d1Statements: s.cost.d1Statements + streamed.cost.d1Statements, d1Batches: s.cost.d1Batches + streamed.cost.d1Batches,
    r2ClassA: s.cost.r2ClassA + streamed.cost.r2ClassA, r2ClassB: s.cost.r2ClassB + streamed.cost.r2ClassB };
  if (!streamed.ok) return { ...streamed, cost };
  return { ...streamed, revisionUid: c.r, expiresAt: new Date(c.exp * 1000).toISOString(), cost };
}
