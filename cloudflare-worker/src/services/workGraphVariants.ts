/**
 * D5583 part 1 (#5583, WorkGraph P1 under the #5577 epic) — media variants, a person's selection, and an approved
 * brand pack, on #5581's revision store. Preview-only: a service and its tests, with no route.
 *
 *   VARIANTS   `recordVariant`: one generated or uploaded version of an image, brand or 3D asset, recorded as a
 *              revision whose parent is the asset's head (the master), so twenty variants from two agents are twenty
 *              sibling revisions, each with its own provenance. Nothing is merged byte by byte; nothing moves the head.
 *              The bytes were admitted by `admitMedia` and written by #5581 part 3's blob service (its `SourceRef`
 *              is passed in); the provenance must hold for a draft (`checkProvenance`).
 *   SELECTION  `selectVariant`: a PERSON picks one variant and it becomes the asset's head, under `human_publication`
 *              (#5581 refuses the move without their approval of the exact digest). The provenance must hold for
 *              publication: rights in scope, licence not revoked or expired, consent where a person is shown.
 *   PACK       `composeBrandPack`: a `composite` asset whose revision pins each chosen asset's current head
 *              (#5581 refuses a pin that is not, `composite_incompatible`) and whose digest is the canonical list of
 *              pins. A person approves it. Masters and unchosen variants are never overwritten: a pack only points.
 *
 * Every asset this service registers uses `human_publication`. Every write carries an idempotency key.
 */
import type { Env } from '../types';
import {
  WORK_GRAPH_DEPS, advanceHead, createRevision, registerAsset,
  type AdvanceHeadResult, type CreateRevisionResult, type RegisterAssetResult,
} from './workGraphRevisions';
import { sha256Hex, type AccessClass, type Actor, type Scope, type SourceRef, type ValidationContext } from './workGraphContracts';
import { canonicalJson } from './decks/cardBlobs';
import { checkProvenance, pinDependencies, type MediaDependency, type MediaKind, type MediaProvenance, type ProvenanceCode } from './workGraphMedia';

export const MEDIA_POLICY = 'human_publication';
export const PACK_MEDIA_PROFILE = 'application/vnd.axal.workgraph-pack+json';
/** `work_graph_revisions.recipe` holds at most this many characters (#5581's CHECK): refused here, before the insert. */
export const RECIPE_MAX_CHARS = 2000;

export type MediaRefusal = {
  ok: false;
  code: 'provenance' | 'person_required' | 'not_found' | 'kind_mismatch' | 'not_a_head' | 'empty_pack' | 'font_binary'
    | 'font_license_unknown' | 'malformed_dependency' | 'malformed';
  ids: string[];
  provenance?: ProvenanceCode[];
};

// ---------------------------------------------------------------------------------------------------------------
// Assets.

export async function registerMediaAsset(env: Pick<Env, 'DB'>, ctx: ValidationContext, input: {
  scope: Scope; kind: MediaKind | 'composite'; accessClass: AccessClass; actor: Actor; idempotencyKey: string;
}): Promise<RegisterAssetResult | MediaRefusal> {
  if (!['image', 'brand', 'model_3d', 'composite'].includes(input.kind)) return { ok: false, code: 'kind_mismatch', ids: [String(input.kind)] };
  return registerAsset(env, ctx, { ...input, approvalPolicy: MEDIA_POLICY });
}

/** A master: the first head of a media asset, set by a person (their act is the approval of these bytes). */
export async function recordMaster(env: Pick<Env, 'DB'>, ctx: ValidationContext, input: {
  assetUid: string;
  /** The head this master replaces (null for the first). Passed in, never read back, so a retry replays exactly. */
  expectedRevisionUid: string | null;
  digest: string; byteLength: number; mediaProfile: string; source: SourceRef; provenance: MediaProvenance;
  dependencies?: MediaDependency[]; use: string; by: Actor; idempotencyKey: string;
}): Promise<AdvanceHeadResult | CreateRevisionResult | MediaRefusal> {
  if (input.by?.kind !== 'person') return { ok: false, code: 'person_required', ids: [input.assetUid] };
  const asset = await readAsset(env, ctx, input.assetUid);
  if (!asset) return { ok: false, code: 'not_found', ids: [input.assetUid] };
  const bad = checkProvenance(input.provenance, { stage: 'publish', use: input.use, now: WORK_GRAPH_DEPS.now() });
  if (bad.length) return { ok: false, code: 'provenance', ids: [input.assetUid], provenance: bad };
  const pins = pinDependencies(input.dependencies ?? []);
  if (!pins.ok) return { ok: false, code: pins.code, ids: [pins.detail] };
  const recipe = recipeOf(input.provenance, pins.fonts);
  if (recipe.length > RECIPE_MAX_CHARS) return { ok: false, code: 'malformed', ids: [input.assetUid, 'recipe'] };
  const rev = await createRevision(env, ctx, {
    assetUid: input.assetUid, parents: input.expectedRevisionUid ? [input.expectedRevisionUid] : [], digest: input.digest,
    byteLength: input.byteLength, mediaProfile: input.mediaProfile, source: input.source, author: input.by,
    recipe, license: input.provenance.rights.licenseRef ?? null,
    dependencies: pins.edges, idempotencyKey: `${input.idempotencyKey}:rev`,
  });
  if (!rev.ok) return rev;
  return advanceHead(env, ctx, {
    assetUid: input.assetUid, expectedRevisionUid: input.expectedRevisionUid, revisionUid: rev.revisionUid, actor: input.by,
    approval: { ref: `master:${input.source.locator}:${input.source.id}`, contentDigest: input.digest, reviewer: input.by, decidedAt: WORK_GRAPH_DEPS.now().toISOString() },
    idempotencyKey: `${input.idempotencyKey}:head`,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Variants.

export interface RecordVariantInput {
  assetUid: string;
  /** The head the variant was made from (the master). */
  parentRevisionUid: string;
  digest: string;
  byteLength: number;
  mediaProfile: string;
  /** Where #5581's blob service wrote the bytes. */
  source: SourceRef;
  provenance: MediaProvenance;
  dependencies?: MediaDependency[];
  use: string;
  author: Actor;
  idempotencyKey: string;
}

export async function recordVariant(env: Pick<Env, 'DB'>, ctx: ValidationContext, input: RecordVariantInput): Promise<CreateRevisionResult | MediaRefusal> {
  const asset = await readAsset(env, ctx, input.assetUid);
  if (!asset) return { ok: false, code: 'not_found', ids: [input.assetUid] };
  if (asset.head_revision_uid !== input.parentRevisionUid) return { ok: false, code: 'not_a_head', ids: [input.parentRevisionUid, String(asset.head_revision_uid)] };
  const bad = checkProvenance(input.provenance, { stage: 'draft', use: input.use, now: WORK_GRAPH_DEPS.now() });
  if (bad.length) return { ok: false, code: 'provenance', ids: [input.assetUid], provenance: bad };
  const pins = pinDependencies(input.dependencies ?? []);
  if (!pins.ok) return { ok: false, code: pins.code, ids: [pins.detail] };
  const recipe = recipeOf(input.provenance, pins.fonts);
  if (recipe.length > RECIPE_MAX_CHARS) return { ok: false, code: 'malformed', ids: [input.assetUid, 'recipe'] };
  return createRevision(env, ctx, {
    assetUid: input.assetUid, parents: [input.parentRevisionUid], digest: input.digest, byteLength: input.byteLength,
    mediaProfile: input.mediaProfile, source: input.source, author: input.author,
    recipe, license: input.provenance.rights.licenseRef ?? null,
    dependencies: pins.edges, idempotencyKey: input.idempotencyKey,
  });
}

/** A person picks a variant; it becomes the head. Publication rules apply to its provenance. */
export async function selectVariant(env: Pick<Env, 'DB'>, ctx: ValidationContext, input: {
  assetUid: string; expectedRevisionUid: string; variantRevisionUid: string; digest: string; provenance: MediaProvenance;
  use: string; by: Actor; approvalRef: string; idempotencyKey: string;
}): Promise<AdvanceHeadResult | MediaRefusal> {
  if (input.by?.kind !== 'person') return { ok: false, code: 'person_required', ids: [input.assetUid] };
  const bad = checkProvenance(input.provenance, { stage: 'publish', use: input.use, now: WORK_GRAPH_DEPS.now() });
  if (bad.length) return { ok: false, code: 'provenance', ids: [input.variantRevisionUid], provenance: bad };
  return advanceHead(env, ctx, {
    assetUid: input.assetUid, expectedRevisionUid: input.expectedRevisionUid, revisionUid: input.variantRevisionUid, actor: input.by,
    approval: { ref: input.approvalRef, contentDigest: input.digest, reviewer: input.by, decidedAt: WORK_GRAPH_DEPS.now().toISOString() },
    idempotencyKey: input.idempotencyKey,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The brand pack.

export interface ComposePackInput {
  packAssetUid: string;
  /** The pack's head this composition replaces (null for the first). Passed in, so a retry replays exactly. */
  expectedRevisionUid: string | null;
  /** The assets whose CURRENT heads the pack pins, in pack order. */
  members: string[];
  by: Actor;
  approvalRef: string;
  idempotencyKey: string;
}

/**
 * Compose an approved pack: read each member's head and its digest, record a composite revision pinning them, and
 * move the pack's head with the person's approval. A member with no head, or a head that moves before the swap, is
 * refused (here, or by #5581 at the swap).
 */
export async function composeBrandPack(env: Pick<Env, 'DB'>, ctx: ValidationContext, input: ComposePackInput): Promise<AdvanceHeadResult | CreateRevisionResult | MediaRefusal> {
  if (input.by?.kind !== 'person') return { ok: false, code: 'person_required', ids: [input.packAssetUid] };
  const pack = await readAsset(env, ctx, input.packAssetUid);
  if (!pack) return { ok: false, code: 'not_found', ids: [input.packAssetUid] };
  if (pack.kind !== 'composite') return { ok: false, code: 'kind_mismatch', ids: [input.packAssetUid, pack.kind] };
  const members = Array.isArray(input.members) ? input.members : [];
  if (!members.length) return { ok: false, code: 'empty_pack', ids: [input.packAssetUid] };
  if (new Set(members).size !== members.length) return { ok: false, code: 'malformed', ids: [input.packAssetUid] };

  const pins: { assetUid: string; revisionUid: string; digest: string }[] = [];
  for (const m of members) {
    const a = await readAsset(env, ctx, m);
    if (!a) return { ok: false, code: 'not_found', ids: [m] };
    if (!a.head_revision_uid) return { ok: false, code: 'not_a_head', ids: [m] };
    const r = await env.DB.prepare('SELECT digest FROM work_graph_revisions WHERE revision_uid = ? AND asset_uid = ?')
      .bind(a.head_revision_uid, m).first<{ digest: string }>();
    if (!r) return { ok: false, code: 'not_found', ids: [a.head_revision_uid] };
    pins.push({ assetUid: m, revisionUid: a.head_revision_uid, digest: r.digest });
  }
  const manifest = new TextEncoder().encode(canonicalJson(pins.map((p) => [p.assetUid, p.revisionUid, p.digest])));
  const digest = await sha256Hex(manifest);
  // A composite is nothing but its pinned components (#5581): its canonical record is those edge rows.
  const source: SourceRef = { store: 'd1_record', locator: 'work_graph_edges', id: `${input.packAssetUid}:${digest}`, revision: digest };
  const rev = await createRevision(env, ctx, {
    assetUid: input.packAssetUid, parents: input.expectedRevisionUid ? [input.expectedRevisionUid] : [], digest,
    byteLength: manifest.byteLength, mediaProfile: PACK_MEDIA_PROFILE, source, author: input.by,
    dependencies: pins.map((p) => ({ kind: 'component' as const, assetUid: p.assetUid, revisionUid: p.revisionUid })),
    idempotencyKey: `${input.idempotencyKey}:rev`,
  });
  if (!rev.ok) return rev;
  return advanceHead(env, ctx, {
    assetUid: input.packAssetUid, expectedRevisionUid: input.expectedRevisionUid, revisionUid: rev.revisionUid, actor: input.by,
    approval: { ref: input.approvalRef, contentDigest: digest, reviewer: input.by, decidedAt: WORK_GRAPH_DEPS.now().toISOString() },
    idempotencyKey: `${input.idempotencyKey}:head`,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers.

interface AssetRow { asset_uid: string; kind: string; head_revision_uid: string | null; tenant_id: number; company_id: number; project_id: number | null }

async function readAsset(env: Pick<Env, 'DB'>, ctx: ValidationContext, assetUid: string): Promise<AssetRow | null> {
  if (typeof assetUid !== 'string' || !assetUid) return null;
  const row = await env.DB.prepare(
    'SELECT asset_uid, kind, head_revision_uid, tenant_id, company_id, project_id FROM work_graph_assets WHERE asset_uid = ?',
  ).bind(assetUid).first<AssetRow>();
  if (!row) return null;
  const s = ctx.scope;
  if (Number(row.tenant_id) !== s.tenantId || Number(row.company_id) !== s.companyId) return null;
  if (s.projectId !== null && Number(row.project_id) !== s.projectId) return null;
  return row;
}

/**
 * The revision's recipe: provenance with the font manifest, as JSON. It names the provider, model, seed, rights,
 * consent and watermark. The prompt itself is not copied: it stays in the domain row that already holds it (for a
 * deck image, `deck_images.prompt`), and the recipe records only that one was recorded.
 */
function recipeOf(p: MediaProvenance, fonts: { family: string; license: string; foundry: string | null }[]): string {
  const g = p.generation;
  return JSON.stringify({
    origin: p.origin,
    source: p.sourceRevisionUid ?? null,
    generation: g ? { provider: g.provider, model: g.model, seed: g.seed, reproducible: g.reproducible && !!g.reproducibilityVerifiedAt, recipe_recorded: !!g.recipe } : null,
    rights: { basis: p.rights.basis, licensor: p.rights.licensor ?? null, license: p.rights.licenseRef ?? null, scope: p.rights.usageScope, attribution: p.rights.attribution ?? null, expires: p.rights.expiresAt ?? null },
    consent: p.consent ? { shows_person: p.consent.showsPerson, recorded: !!p.consent.consentAt } : null,
    watermark: p.watermark ?? null,
    fonts,
  });
}
