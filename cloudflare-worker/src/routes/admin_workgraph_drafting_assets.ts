/**
 * D5582 part 4 (#5582): Super Admin preview registry for WorkGraph drafting assets: bootstrap a deck, template or offer
 * asset over HTTP, re-adopt its domain's current row, and freeze its approved head into a release manifest.
 *
 *   GET  /                      the verified company's drafting assets (ids, digests and sources only)
 *   POST /                      { tenantId, kind, sourceId, accessClass? }  register the domain object's asset and adopt
 *                               its current row. One asset per object: the retry key is derived from the object.
 *   POST /:assetUid/adopt       { headRevisionUid, idempotencyKey }  a domain save outside WorkGraph made the head
 *                               stale; a person adopts the current row, which renews the approval and leaves every
 *                               manifest pinning the old head stale
 *   POST /:assetUid/freeze      { headRevisionUid, approvedDigest, lineAssetUid, role, profile?, partial, idempotencyKey }
 *                               cut a D5585 manifest pinning the exact head, only while the domain row still reads
 *                               as that head. Part 5 (D5582-p5): a deck's embedded D5583 media revisions are pinned
 *                               in the same manifest at their digests, and refused when foreign, revoked, unreadable
 *                               or no longer their asset's head
 *
 * Same gates as part 3's drafting router: an HQ preview deployment, `WORK_GRAPH_DRAFTING=preview`, a Super Admin, the
 * write bar on every POST, and the caller's verified selected company. Templates also need counsel. Nothing here
 * writes a domain table, publishes a release or signs anything.
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { Env, User } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { activeCompanyFor } from '../middleware/activeCompany';
import { refuse } from '../util/refusal';
import { branchOf } from '../util/branch';
import { logAdminAction } from '../services/adminAudit';
import { ACCESS_CLASSES } from '../services/workGraphContracts';
import { adoptCurrent, registerDraftedAsset } from '../services/workGraphDrafting';
import { currentDraftingDomain, draftingAsset, readDraftingDomain, scopeOfDraft } from '../services/workGraphDraftingScope';
import {
  DRAFTING_KINDS, assetForObject, bootstrapKey, companyHeldElsewhere, listDraftingAssets, objectByDomainId, objectOfAsset,
  readableAt,
} from '../services/workGraphDraftingRegistry';
import { unitsDigest } from '../services/workGraphUnits';
import { EMBEDDED_MEDIA_ROLE, checkEmbeddedMedia, embeddedMediaRefs, type MediaPin } from '../services/workGraphDraftingMedia';
import { PROFILES, cutManifest } from '../services/workGraphReleases';

const r = new Hono<{ Bindings: Env; Variables: { actor: User } }>();
const key = z.string().min(1).max(150);
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const kind = z.enum(DRAFTING_KINDS as [typeof DRAFTING_KINDS[number], ...typeof DRAFTING_KINDS[number][]]);
const bootstrapInput = z.object({ tenantId: id, kind, sourceId: id,
  accessClass: z.enum(ACCESS_CLASSES).default('confidential') }).strict();
const adoptInput = z.object({ headRevisionUid: key, idempotencyKey: key }).strict();
const freezeInput = z.object({ headRevisionUid: key, approvedDigest: z.string().regex(/^[a-f0-9]{64}$/),
  lineAssetUid: key, role: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), profile: z.enum(PROFILES).optional(),
  partial: z.boolean(), idempotencyKey: key }).strict();
const LIST_MAX = 50;

r.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  if (c.env.ENVIRONMENT !== 'preview' || branchOf(c.env) || c.env.WORK_GRAPH_DRAFTING !== 'preview') {
    return refuse(c, 404, { code: 'drafting_unavailable', message: 'WorkGraph drafting is unavailable on this deployment.' });
  }
  c.set('actor', c.req.method === 'GET' ? await requireSuperAdmin(c as any) : await requireSuperAdminWriteBar(c as any));
  return next();
});
r.use('*', bodyLimit({ maxSize: 16_000, onError: c => refuse(c, 413, { code: 'draft_too_large', message: 'The drafting request is too large.' }) }));

const noCompany = (c: any) => refuse(c, 404, { code: 'drafting_asset_not_found', message: 'That drafting asset is unavailable in this company.' });
const malformed = (c: any) => refuse(c, 400, { code: 'invalid_draft_request', message: 'Supply the required drafting fields.' });
const stale = (c: any) => refuse(c, 409, { code: 'stale_revision', message: 'The domain record changed. Adopt its current revision before continuing.' });
const counselOnly = (c: any) => refuse(c, 403, { code: 'counsel_required', message: 'Counsel must review this template.' });
const refused = (c: any, result: { code: string; ids?: string[] }, status = 409) => refuse(c, status, {
  code: result.code, message: 'The WorkGraph registry refused this request.', extra: { ids: result.ids ?? [] } });

async function counsel(c: any, user: User) {
  return !!await c.env.DB.prepare('SELECT 1 AS ok FROM counsel_members WHERE user_id = ?').bind(user.id).first();
}
async function audit(c: any, user: User, action: string, details: Record<string, unknown>) {
  await logAdminAction(c.env, Number(user.id), String(user.email ?? ''), action, details);
}
const person = (user: User) => ({ kind: 'person' as const, userId: Number(user.id) });

r.get('/', async c => {
  const user = c.get('actor');
  const companyId = await activeCompanyFor(c, user);
  if (!companyId) return noCompany(c);
  const asked = c.req.query('kind');
  const filter = asked === undefined ? null : kind.safeParse(asked);
  if (filter && !filter.success) return malformed(c);
  const n = Number(c.req.query('limit'));
  const limit = Number.isSafeInteger(n) && n > 0 ? Math.min(n, LIST_MAX) : LIST_MAX;
  return c.json({ assets: await listDraftingAssets(c.env, companyId, filter ? filter.data : null, limit) });
});

r.post('/', async c => {
  const user = c.get('actor');
  const companyId = await activeCompanyFor(c, user);
  if (!companyId) return noCompany(c);
  const parsed = bootstrapInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return malformed(c);
  const b = parsed.data;
  const object = await objectByDomainId(c.env, companyId, b.kind, b.sourceId);
  if (!object) return refuse(c, 404, { code: 'drafting_source_not_found', message: 'That record is unavailable in this company.' });
  if (b.kind === 'legal_template' && !await counsel(c, user)) return counselOnly(c);
  const scope = { tenantId: b.tenantId, companyId, projectId: object.projectId };
  if (await companyHeldElsewhere(c.env, scope)) return refused(c, { code: 'wrong_tenant', ids: [String(companyId)] });
  // The current row is read before anything is written: an unreadable source never gets an asset.
  const current = await readDraftingDomain(c.env, readableAt(object, scope), Number(user.id));
  if (!current) return stale(c);
  const ctx = { scope };

  let existing = await assetForObject(c.env, scope, object);
  let registered = false;
  if (!existing) {
    const reg = await registerDraftedAsset(c.env, ctx, { scope, kind: b.kind, accessClass: b.accessClass, actor: person(user),
      idempotencyKey: bootstrapKey(object) });
    if (!reg.ok && reg.code !== 'idempotency_conflict') return refused(c, reg);
    existing = await assetForObject(c.env, scope, object);
    if (!existing) return refused(c, { code: 'not_found', ids: [] });
    registered = reg.ok && !reg.replayed;
  }
  let adopted = false;
  if (!existing.head_revision_uid) {
    const head = await adoptCurrent(c.env, ctx, { assetUid: existing.asset_uid, expectedRevisionUid: null, current: current.doc,
      by: person(user), idempotencyKey: `drafting-bootstrap-head:${existing.asset_uid}` });
    // A concurrent bootstrap that adopted first leaves the asset with its head; anything else is refused.
    if (!head.ok && head.code !== 'stale_revision' && head.code !== 'idempotency_conflict') return refused(c, head);
    adopted = head.ok && !head.replayed;
    existing = await assetForObject(c.env, scope, object);
  }
  const asset = existing?.head_revision_uid ? await draftingAsset(c.env, companyId, existing.asset_uid) : null;
  if (!asset) return refused(c, { code: 'not_found', ids: [String(existing?.asset_uid)] });
  await audit(c, user, 'workgraph_drafting_bootstrap', { asset_uid: asset.asset_uid, kind: asset.kind, company_id: companyId,
    tenant_id: asset.tenant_id, source: `${asset.source_locator}:${asset.source_id}`, registered, adopted });
  return c.json({ assetUid: asset.asset_uid, kind: asset.kind, tenantId: asset.tenant_id, headRevisionUid: asset.head_revision_uid,
    digest: asset.digest, source: { locator: asset.source_locator, id: asset.source_id }, registered, adopted }, registered ? 201 : 200);
});

async function scoped(c: any) {
  const user = c.get('actor') as User;
  const companyId = await activeCompanyFor(c, user);
  const asset = companyId ? await draftingAsset(c.env, companyId, c.req.param('assetUid')) : null;
  return asset ? { user, asset } : null;
}

r.post('/:assetUid/adopt', async c => {
  const s = await scoped(c);
  if (!s) return noCompany(c);
  const parsed = adoptInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return malformed(c);
  const b = parsed.data;
  if (s.asset.kind === 'legal_template' && !await counsel(c, s.user)) return counselOnly(c);
  const object = await objectOfAsset(c.env, s.asset);
  const scope = scopeOfDraft(s.asset);
  const current = object ? await readDraftingDomain(c.env, readableAt(object, scope), Number(s.user.id)) : null;
  if (!current) return refuse(c, 409, { code: 'drafting_source_gone', message: 'The domain record has no current version to adopt.' });
  // Refused before any revision is written; the CAS below still decides a race with another adoption.
  if (b.headRevisionUid !== s.asset.head_revision_uid) {
    return refuse(c, 409, { code: 'stale_revision', message: 'The head changed since it was read. Read it again before adopting.',
      extra: { currentHead: s.asset.head_revision_uid } });
  }
  const digest = await unitsDigest(current.doc.units);
  if (current.doc.source.id === s.asset.source_id && current.doc.source.revision === s.asset.source_revision && digest === s.asset.digest) {
    return c.json({ assetUid: s.asset.asset_uid, headRevisionUid: s.asset.head_revision_uid, digest, adopted: false });
  }
  const head = await adoptCurrent(c.env, { scope }, { assetUid: s.asset.asset_uid, expectedRevisionUid: b.headRevisionUid,
    current: current.doc, by: person(s.user), idempotencyKey: b.idempotencyKey });
  await audit(c, s.user, 'workgraph_drafting_adopt', { asset_uid: s.asset.asset_uid, expected: b.headRevisionUid,
    source: `${current.doc.source.locator}:${current.doc.source.id}`, outcome: head.ok ? 'applied' : head.code });
  if (!head.ok) return refused(c, head);
  const moved = 'impact' in head ? head : null;
  return c.json({ assetUid: s.asset.asset_uid, headRevisionUid: head.revisionUid, previousRevisionUid: moved?.previousRevisionUid ?? null,
    digest, adopted: true, replayed: head.replayed, invalidatedApprovals: moved?.impact.invalidatedApprovals ?? [], cost: head.cost });
});

r.post('/:assetUid/freeze', async c => {
  const s = await scoped(c);
  if (!s) return noCompany(c);
  const parsed = freezeInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return malformed(c);
  const b = parsed.data;
  if (s.asset.kind === 'legal_template' && !await counsel(c, s.user)) return counselOnly(c);
  if (b.headRevisionUid !== s.asset.head_revision_uid) return stale(c);
  if (b.approvedDigest !== s.asset.digest) {
    return refuse(c, 409, { code: 'stale_approval', message: 'The approved digest is not the head this export would pin.' });
  }
  // A domain save after the approval leaves the head stale: the export waits for a renewed adoption.
  const current = await currentDraftingDomain(c.env, s.asset, Number(s.user.id));
  if (!current) return stale(c);
  // Part 5: the media the approved deck embeds, read from the units its digest covers, pinned beside it.
  let media: { pins: MediaPin[]; cost: { d1Statements: number; r2ClassB: number } } = { pins: [], cost: { d1Statements: 0, r2ClassB: 0 } };
  if (s.asset.kind === 'pitch_deck') {
    const refs = embeddedMediaRefs(current.doc.units);
    const checked = refs.ok ? await checkEmbeddedMedia(c.env, scopeOfDraft(s.asset), refs.refs) : { ...refs, cost: media.cost };
    if (!checked.ok) {
      await audit(c, s.user, 'workgraph_drafting_freeze', { asset_uid: s.asset.asset_uid, revision_uid: s.asset.head_revision_uid,
        line_asset_uid: b.lineAssetUid, outcome: checked.code, media_ids: checked.ids });
      return refuse(c, checked.code === 'embedded_media_not_found' ? 404 : 409, { code: checked.code,
        message: 'Media the deck embeds cannot be frozen with it.', extra: { ids: checked.ids } });
    }
    media = checked;
  }
  const result = await cutManifest(c.env, { scope: { tenantId: s.asset.tenant_id, companyId: s.asset.company_id, projectId: null } }, {
    lineAssetUid: b.lineAssetUid, partial: b.partial, author: person(s.user), idempotencyKey: b.idempotencyKey,
    components: [{ assetUid: s.asset.asset_uid, revisionUid: s.asset.head_revision_uid, digest: s.asset.digest, role: b.role,
      ...(b.profile ? { profile: b.profile } : {}) },
      ...media.pins.map((p) => ({ assetUid: p.assetUid, revisionUid: p.revisionUid, digest: p.digest, role: EMBEDDED_MEDIA_ROLE }))],
  });
  await audit(c, s.user, 'workgraph_drafting_freeze', { asset_uid: s.asset.asset_uid, revision_uid: s.asset.head_revision_uid,
    line_asset_uid: b.lineAssetUid, outcome: result.ok ? 'applied' : result.code,
    media: media.pins.map((p) => `${p.assetUid}:${p.revisionUid}:${p.digest}`) });
  if (!result.ok) {
    if (result.code === 'not_found' || result.code === 'wrong_tenant') {
      return refuse(c, 404, { code: 'release_line_not_found', message: 'That release line is unavailable in this company.' });
    }
    return refused(c, result);
  }
  return c.json({ manifestUid: result.manifestUid, digest: result.digest, baseManifestUid: result.baseManifestUid,
    pinned: { assetUid: s.asset.asset_uid, revisionUid: s.asset.head_revision_uid, digest: s.asset.digest,
      source: { locator: s.asset.source_locator, id: s.asset.source_id } },
    media: media.pins.map((p) => ({ assetUid: p.assetUid, revisionUid: p.revisionUid, kind: p.kind, digest: p.digest,
      byteLength: p.byteLength, mediaProfile: p.mediaProfile, objectClass: p.objectClass, units: p.units })),
    replayed: result.replayed, cost: { ...result.cost, r2ClassB: media.cost.r2ClassB, d1Statements: result.cost.d1Statements + media.cost.d1Statements } });
});

export const mount: RouteMount = { path: '/api/admin/workgraph/drafting-assets', router: r };
export default r;
