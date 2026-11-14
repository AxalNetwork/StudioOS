/**
 * D5582 part 2 (#5582, WorkGraph P1 under the #5577 epic) — drafts and merged candidates of decks, legal templates
 * and offers, recorded as WorkGraph revisions (#5581's store) and written where their domain keeps drafts (the
 * owner's narrowed option B, 2026-11-14). Preview-only: a service and its tests, with no route.
 *
 * THE FLOW.
 *   1. `registerDraftedAsset`: a WorkGraph asset for one deck, template or offer, always under the
 *      `human_publication` policy, so #5581's `advanceHead` refuses any head move without a person's approval of
 *      the exact digest. Signed evidence and composites are refused here: evidence is never drafted, composites
 *      are #5585's.
 *   2. `adoptCurrent`: a PERSON names the domain's current row (a deck version, a template version, a quote
 *      version) as the asset's head. Their act is the approval; an agent cannot adopt.
 *   3. `proposeCandidate`: D5582 part 1's `planMerge` over the head's units and two drafts. A conflict writes
 *      nothing and returns the plan. Otherwise the candidate is written by its domain's draft writer:
 *        pitch_deck      one `pitch_deck_proposals` row (D767), which the founder Keeps or Discards as today; one
 *                        already waiting is never replaced (D1588's rule). An agent's candidate may not type a
 *                        figure into changed text (D1588 §4.3, `numberIn`).
 *        legal_template  one `legal_template_research_drafts` row, pending counsel review (`legalTemplateDrafts.ts`);
 *                        one already there is never replaced.
 *        offer           nothing: `quote_versions` has no draft state, so the plan and its digest are returned and
 *                        the partner saves the next version through the existing quote route.
 *      A stored candidate is a WorkGraph revision whose parent is the head and whose `SourceRef` names the draft row.
 *   4. `confirmPublished`: once a person has published (Keep on a deck, counsel's publish on a template, the
 *      partner's save on a quote), the new domain row becomes the head. Its units must read exactly what the person
 *      approved; anything else is `stale_approval`, and the head does not move.
 *
 * Retries are safe: every write carries an idempotency key, and a draft row already waiting with the same candidate
 * digest is the same proposal, not a second one.
 */
import type { Env } from '../types';
import {
  WORK_GRAPH_DEPS, advanceHead, createRevision, registerAsset,
  type AdvanceHeadResult, type CreateRevisionResult, type Refusal, type RegisterAssetResult,
} from './workGraphRevisions';
import type { AccessClass, Actor, AssetKind, Scope, SourceRef, ValidationContext } from './workGraphContracts';
import { planMerge, type MergePlan } from './workGraphMerge';
import {
  clausesOf, deckUnits, markdownFromUnits, slidesFromUnits, unitsBytes, unitsDigest, type Unit, type UnitDocument,
} from './workGraphUnits';
import { proposeResearchDraft } from './legalTemplateDrafts';
import { numberIn } from './decks/numbers';

/** Every drafted asset's policy: a head moves only with a person's approval of its exact digest (#5581). */
export const DRAFTING_POLICY = 'human_publication';
/** The kinds this service drafts. */
export const DRAFTED_KINDS: ReadonlySet<AssetKind> = new Set<AssetKind>(['pitch_deck', 'legal_template', 'offer']);
/** The media profile of a units revision: the canonical JSON `unitsBytes` produces. */
export const UNITS_MEDIA_PROFILE = 'application/vnd.axal.workgraph-units+json';
/** One deck proposal title is at most this long, as `proposeVariant`'s (D1588). */
const DECK_TITLE_MAX = 120;

export type DraftRefusalCode =
  | 'not_drafted_kind' | 'person_required' | 'merge_conflict' | 'stale_revision' | 'kind_mismatch'
  | 'proposal_waiting' | 'draft_waiting' | 'figure_in_text' | 'stale_approval' | 'not_found' | 'malformed';

export type DraftRefusal = { ok: false; code: DraftRefusalCode; ids: string[]; plan?: MergePlan };

// ---------------------------------------------------------------------------------------------------------------
// 1. The asset.

export interface RegisterDraftedAssetInput {
  scope: Scope;
  kind: AssetKind;
  accessClass: AccessClass;
  actor: Actor;
  idempotencyKey: string;
}

export async function registerDraftedAsset(
  env: Pick<Env, 'DB'>, ctx: ValidationContext, input: RegisterDraftedAssetInput,
): Promise<RegisterAssetResult | DraftRefusal> {
  if (!DRAFTED_KINDS.has(input.kind)) return { ok: false, code: 'not_drafted_kind', ids: [input.kind] };
  return registerAsset(env, ctx, { ...input, approvalPolicy: DRAFTING_POLICY });
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Adopting the domain's current row.

export interface AdoptCurrentInput {
  assetUid: string;
  /** The head this adoption replaces (null for the first). */
  expectedRevisionUid: string | null;
  /** The units of the domain row that is current now, from its own reader. */
  current: UnitDocument;
  /** A person: their adoption is the approval of these exact units. */
  by: Actor;
  idempotencyKey: string;
}

export async function adoptCurrent(
  env: Pick<Env, 'DB'>, ctx: ValidationContext, input: AdoptCurrentInput,
): Promise<AdvanceHeadResult | CreateRevisionResult | DraftRefusal> {
  if (input.by?.kind !== 'person') return { ok: false, code: 'person_required', ids: [input.assetUid] };
  const asset = await readAsset(env, ctx, input.assetUid);
  if (!asset) return { ok: false, code: 'not_found', ids: [input.assetUid] };
  if (asset.kind !== input.current.kind) return { ok: false, code: 'kind_mismatch', ids: [input.assetUid, input.current.kind] };
  return recordHead(env, ctx, {
    assetUid: input.assetUid, expected: input.expectedRevisionUid, doc: input.current, author: input.by,
    approval: { ref: `adopt:${input.current.source.locator}:${input.current.source.id}`, reviewer: input.by },
    idempotencyKey: input.idempotencyKey,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Proposing a merged candidate.

export type CandidateTarget =
  | { kind: 'pitch_deck'; projectId: number; baseDeckId: number; title: string; createdByUserId: number }
  | { kind: 'legal_template'; templateId: number; templateSlug: string; jurisdiction: string }
  | { kind: 'offer' };

export interface ProposeCandidateInput {
  assetUid: string;
  /** The head the drafts were cut from: it must still be the head. */
  headRevisionUid: string;
  base: Unit[];
  ours: Unit[];
  theirs: Unit[];
  author: Actor;
  /** Who drafted each side, kept as the revision's recipe (ids only, no content). */
  contributors: { ours: string; theirs: string };
  target: CandidateTarget;
  idempotencyKey: string;
}

export type ProposeCandidateResult =
  | { ok: true; plan: MergePlan; digest: string; stored: { revisionUid: string; source: SourceRef } | null; cost?: unknown }
  | DraftRefusal | Refusal;

export async function proposeCandidate(
  env: Pick<Env, 'DB'>, ctx: ValidationContext, input: ProposeCandidateInput,
): Promise<ProposeCandidateResult> {
  const asset = await readAsset(env, ctx, input.assetUid);
  if (!asset) return { ok: false, code: 'not_found', ids: [input.assetUid] };
  if (asset.kind !== input.target.kind) return { ok: false, code: 'kind_mismatch', ids: [input.assetUid, input.target.kind] };
  if (asset.head_revision_uid !== input.headRevisionUid) {
    return { ok: false, code: 'stale_revision', ids: [input.headRevisionUid, String(asset.head_revision_uid)] };
  }
  const planned = planMerge(asset.kind as AssetKind, input.base, input.ours, input.theirs);
  if ('ok' in planned) return { ok: false, code: 'malformed', ids: [planned.code] };
  const plan = planned;
  if (plan.conflicts.length) return { ok: false, code: 'merge_conflict', ids: plan.conflicts.map((c) => c.unitId), plan };
  const digest = await unitsDigest(plan.units);

  // An agent may not type a figure into words the merge changed (D1588 §4.3); a person's draft may.
  if (input.author.kind === 'agent' && asset.kind === 'pitch_deck') {
    const before = new Map(input.base.map((u) => [u.id, u.value]));
    const typed = plan.units.filter((u) => u.textMergeable && before.get(u.id) !== u.value && numberIn(u.text));
    if (typed.length) return { ok: false, code: 'figure_in_text', ids: typed.map((u) => u.id), plan };
  }

  let source: SourceRef | null = null;
  const t = input.target;
  if (t.kind === 'offer') {
    return { ok: true, plan, digest, stored: null };
  } else if (t.kind === 'pitch_deck') {
    const slides = slidesFromUnits(plan.units);
    const title = String(t.title ?? '').trim().slice(0, DECK_TITLE_MAX) || 'Pitch deck';
    const waiting = await env.DB.prepare(
      'SELECT id, slides FROM pitch_deck_proposals WHERE project_id = ? ORDER BY id LIMIT 1',
    ).bind(t.projectId).first<{ id: number; slides: string }>();
    let id: number;
    if (waiting) {
      // The same candidate written before (a retry) is the same proposal; anything else is the founder's to decide.
      const theirsDigest = await digestOfSlides(waiting.slides);
      if (theirsDigest !== digest) return { ok: false, code: 'proposal_waiting', ids: [String(waiting.id)] };
      id = Number(waiting.id);
    } else {
      const res = await env.DB.prepare(
        `INSERT INTO pitch_deck_proposals (project_id, base_deck_id, slides, title, method_id, created_by)
         VALUES (?, ?, ?, ?, NULL, ?)`,
      ).bind(t.projectId, t.baseDeckId, JSON.stringify(slides), title, t.createdByUserId || null).run();
      id = Number((res as any)?.meta?.last_row_id ?? 0);
    }
    source = { store: 'd1_record', locator: 'pitch_deck_proposals', id: String(id), revision: digest };
  } else {
    const body = markdownFromUnits(plan.units);
    const wrote = await proposeResearchDraft(env, {
      templateId: t.templateId, templateSlug: t.templateSlug, jurisdiction: t.jurisdiction, bodyMd: body, candidateDigest: digest,
    });
    let id: number;
    if (wrote.ok) {
      id = wrote.id;
    } else if (wrote.code === 'draft_waiting') {
      const theirsDigest = await unitsDigest(clausesOf(wrote.existing.draft_body_md, 'clause'));
      if (theirsDigest !== digest) return { ok: false, code: 'draft_waiting', ids: [String(wrote.existing.id)] };
      id = Number(wrote.existing.id);
    } else {
      return { ok: false, code: wrote.code, ids: [String(t.templateId)] };
    }
    source = { store: 'd1_record', locator: 'legal_template_research_drafts', id: String(id), revision: digest };
  }

  const bytes = unitsBytes(plan.units);
  const rev = await createRevision(env, ctx, {
    assetUid: input.assetUid, parents: [input.headRevisionUid], digest, byteLength: bytes.byteLength,
    mediaProfile: UNITS_MEDIA_PROFILE, source, author: input.author, idempotencyKey: input.idempotencyKey,
    recipe: JSON.stringify({ merge: { ours: input.contributors.ours, theirs: input.contributors.theirs } }),
  });
  if (!rev.ok) return rev;
  return { ok: true, plan, digest, stored: { revisionUid: rev.revisionUid, source }, cost: rev.cost };
}

// ---------------------------------------------------------------------------------------------------------------
// 4. After a person published.

export interface ConfirmPublishedInput {
  assetUid: string;
  expectedRevisionUid: string;
  /** The digest the person approved: the candidate's, or the plan's for an offer. */
  approvedDigest: string;
  /** The domain row the person's publish wrote, read back by its own reader. */
  published: UnitDocument;
  /** The person's publish: Keep on the deck, counsel's publish, the partner's save. */
  approval: { ref: string; reviewer: Actor };
  idempotencyKey: string;
}

export async function confirmPublished(
  env: Pick<Env, 'DB'>, ctx: ValidationContext, input: ConfirmPublishedInput,
): Promise<AdvanceHeadResult | CreateRevisionResult | DraftRefusal> {
  if (input.approval?.reviewer?.kind !== 'person') return { ok: false, code: 'person_required', ids: [input.assetUid] };
  const asset = await readAsset(env, ctx, input.assetUid);
  if (!asset) return { ok: false, code: 'not_found', ids: [input.assetUid] };
  if (asset.kind !== input.published.kind) return { ok: false, code: 'kind_mismatch', ids: [input.assetUid, input.published.kind] };
  const digest = await unitsDigest(input.published.units);
  if (digest !== input.approvedDigest) return { ok: false, code: 'stale_approval', ids: [input.assetUid, digest] };
  return recordHead(env, ctx, {
    assetUid: input.assetUid, expected: input.expectedRevisionUid, doc: input.published, author: input.approval.reviewer,
    approval: input.approval, idempotencyKey: input.idempotencyKey,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers.

interface AssetRow { asset_uid: string; kind: string; head_revision_uid: string | null; tenant_id: number; company_id: number; project_id: number | null }

/** The asset, if it is in the caller's scope (a project caller sees only its project). Read-only. */
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

/** Record a units document as a revision on the head and move the head to it, with a person's approval. */
async function recordHead(env: Pick<Env, 'DB'>, ctx: ValidationContext, a: {
  assetUid: string; expected: string | null; doc: UnitDocument; author: Actor;
  approval: { ref: string; reviewer: Actor }; idempotencyKey: string;
}): Promise<AdvanceHeadResult | CreateRevisionResult> {
  const bytes = unitsBytes(a.doc.units);
  const digest = await unitsDigest(a.doc.units);
  const rev = await createRevision(env, ctx, {
    assetUid: a.assetUid, parents: a.expected ? [a.expected] : [], digest, byteLength: bytes.byteLength,
    mediaProfile: UNITS_MEDIA_PROFILE, source: a.doc.source, author: a.author, idempotencyKey: `${a.idempotencyKey}:rev`,
  });
  if (!rev.ok) return rev;
  return advanceHead(env, ctx, {
    assetUid: a.assetUid, expectedRevisionUid: a.expected, revisionUid: rev.revisionUid, actor: a.author,
    approval: { ref: a.approval.ref, contentDigest: digest, reviewer: a.approval.reviewer, decidedAt: WORK_GRAPH_DEPS.now().toISOString() },
    idempotencyKey: `${a.idempotencyKey}:head`,
  });
}

async function digestOfSlides(json: string): Promise<string | null> {
  try {
    const slides = JSON.parse(json);
    return unitsDigest(deckUnits({ id: 0, version: 0, slides: Array.isArray(slides) ? slides : [] }).units);
  } catch {
    return null;
  }
}
