/**
 * D5585 part 1 (#5585, WorkGraph P1 under the #5577 epic) — immutable composite release manifests, the domain policy
 * profiles they are checked against, publish decisions bound to a manifest's digest, and publication by #5581's
 * compare-and-swap with the outbox effects queued in the same batch. Preview-only: no route, no binding, no flag.
 *
 * IT EXTENDS #5581's REGISTRY (`workGraphRevisions.ts`), it does not add a second one:
 *   release line   a `composite` asset under `human_publication`, with one fixed audience (`work_graph_release_lines`)
 *   manifest       one immutable revision of that asset. Its digest is SHA-256 of the canonical manifest body, and
 *                  its `component` edges pin each component's exact revision, which must be that asset's accepted head
 *                  when the manifest is cut. There is never a "latest" pointer inside a manifest.
 *   publication    the line's head, moved by `advanceHead`'s CAS from the manifest the publisher expects. The CAS
 *                  itself re-checks that every component is still its asset's head, so an edit that lands between the
 *                  checks and the write still refuses (`composite_incompatible`). The `advance_head` event is the
 *                  audit row; the outbox effects (`work_graph_effects`, kind `release_<target>`) are written in the
 *                  same batch, so a pointer never moves without its effects, nor effects without the pointer.
 *                  They are QUEUED, NOT DELIVERED: no handler is registered for a release effect in this part.
 *
 * WHAT IT REFUSES, besides #5581's and D5579's own codes (`wrong_tenant`, `stale_revision`, `not_descendant`,
 * `composite_incompatible`, `unpinned_component`, `unapproved_release`, `agent_review`, `stale_approval`,
 * `revoked_author`, `idempotency_conflict`):
 *   audience_forbidden    a component whose access class the line's audience may not see (no draft or confidential
 *                         piece reaches a public export)
 *   policy_profile        a profile the component's kind does not allow, or a decision for a profile not in the manifest
 *   incomplete_package    a full (non-partial) manifest that drops a component asset the line's published manifest has
 *   rebuild_required      a pinned component whose input or own source moved, under a profile that rebuilds
 *   reapproval_required   a pinned component superseded under a profile that re-approves
 *   attestation_missing   a component revision without the evidence its profiles require (PR and CI, rights, claims,
 *                         evidence, counsel, signing authority, residency, security)
 *   approval_required     a profile in the manifest with no live publish approval of this digest for this audience
 *   no_authority          a reviewer or attester without the authority the caller resolved for them
 *   self_approval         the manifest's author approving it
 *   approval_incomplete   an approval without the citations, rights or disclosure its profile needs
 *   changes_requested     a manifest whose latest decision from some reviewer is reject or request_changes
 *   effect_target         an effect target the manifest or audience does not support
 *   queue_full            the tenant's outbox has no room for this publication's effects
 *   taken_down            (part 2) a manifest a takedown covers, or one pinning a component revision a takedown covers
 *   not_published         (part 2) a re-pin of a manifest the line never published
 *
 * PART 2 (D5585-p2) adds, here: a manifest that RE-PINS an earlier published manifest's component revisions (`repin` in
 * its body) is current although those revisions are no longer their assets' heads, and its publication passes them to
 * the CAS as `repinnedComponents`; takedowns (`work_graph_release_takedowns`) show on every component they cover and
 * refuse publication. Takedown, re-pin, serving and delivery live in `workGraphReleaseTakedowns.ts` and
 * `workGraphReleaseDelivery.ts`.
 *
 * COST. Every result carries `cost: { d1Statements, d1Batches }`, including the statements `createRevision` and
 * `advanceHead` issued for it. Ids and digests only: no column or result holds content.
 */
import type { Env } from '../types';
import {
  sha256Hex, validateWorkGraph,
  type AccessClass, type Actor, type ArtifactVersion, type Asset, type AssetKind, type ReviewDecision, type Scope,
  type SourceRef, type ValidationContext, type WorkGraph,
} from './workGraphContracts';
import {
  WORK_GRAPH_DEPS, advanceHead, createRevision, registerAsset,
  type AdvanceHeadEnv, type Cost, type RefusalCode,
} from './workGraphRevisions';
import { WORK_GRAPH_EFFECT_LIMITS } from './workGraphEffects';

export const AUDIENCES = ['internal', 'investors', 'partners', 'public'] as const;
export type Audience = (typeof AUDIENCES)[number];

/** What each audience may see. A public export takes only `public` components. */
export const AUDIENCE_CLASSES: Readonly<Record<Audience, readonly AccessClass[]>> = Object.freeze({
  internal: ['public', 'internal', 'confidential', 'restricted'],
  investors: ['public', 'internal', 'confidential'],
  partners: ['public', 'internal'],
  public: ['public'],
});
const LINE_CLASS: Readonly<Record<Audience, AccessClass>> = { internal: 'internal', investors: 'confidential', partners: 'confidential', public: 'public' };

export const REQUIREMENTS = [
  'pr_validated', 'ci_passed', 'brand_rights', 'claims_review', 'evidence_review', 'counsel_review', 'signing_authority',
  'residency_review', 'security_review',
] as const;
export type Requirement = (typeof REQUIREMENTS)[number];

/** The authority a person needs to attest each requirement; null where an agent run (a CI check) may attest. */
export const REQUIREMENT_AUTHORITY: Readonly<Record<Requirement, readonly string[] | null>> = Object.freeze({
  pr_validated: null,
  ci_passed: null,
  brand_rights: ['brand_owner', 'marketing_lead'],
  claims_review: ['brand_owner', 'marketing_lead', 'counsel'],
  evidence_review: ['founder', 'partner'],
  counsel_review: ['counsel'],
  signing_authority: ['authorized_signatory', 'counsel'],
  residency_review: ['security_officer'],
  security_review: ['security_officer'],
});

export type StaleStatus = 'rebuild_required' | 'reapproval_required';
export const PROFILES = ['code', 'marketing', 'investor_pitch', 'contract', 'protected_data'] as const;
export type ProfileName = (typeof PROFILES)[number];

export interface PolicyProfile {
  /** Evidence every component under this profile must carry, at its exact digest. */
  requirements: readonly Requirement[];
  /** Who may approve publication of a manifest holding such a component. */
  authorities: readonly string[];
  /** What that approval must carry. */
  needs: { citations: boolean; rights: boolean; disclosure: boolean };
  /** The component's asset has a newer accepted head than the one pinned. */
  onSuperseded: StaleStatus;
  /** A dependency the pinned component was built from has a newer head (its derived output is out of date). */
  onInputChanged: StaleStatus;
}

/**
 * The domain policy profiles (#5585): code needs a validated PR and green CI, marketing needs brand rights and a claims
 * review, an investor pitch needs reviewed evidence, a contract needs counsel and signing authority, and protected data
 * (a `restricted` component, or one with a residency) needs residency and security review on top of its own profile.
 */
export const POLICY_PROFILES: Readonly<Record<ProfileName, PolicyProfile>> = Object.freeze({
  code: {
    requirements: ['pr_validated', 'ci_passed'], authorities: ['maintainer'],
    needs: { citations: false, rights: false, disclosure: false }, onSuperseded: 'rebuild_required', onInputChanged: 'rebuild_required',
  },
  marketing: {
    requirements: ['brand_rights', 'claims_review'], authorities: ['brand_owner', 'marketing_lead'],
    needs: { citations: false, rights: true, disclosure: true }, onSuperseded: 'reapproval_required', onInputChanged: 'rebuild_required',
  },
  investor_pitch: {
    requirements: ['evidence_review'], authorities: ['founder', 'partner'],
    needs: { citations: true, rights: false, disclosure: true }, onSuperseded: 'reapproval_required', onInputChanged: 'reapproval_required',
  },
  contract: {
    requirements: ['counsel_review', 'signing_authority'], authorities: ['counsel', 'authorized_signatory'],
    needs: { citations: false, rights: false, disclosure: false }, onSuperseded: 'reapproval_required', onInputChanged: 'reapproval_required',
  },
  protected_data: {
    requirements: ['residency_review', 'security_review'], authorities: ['security_officer'],
    needs: { citations: false, rights: false, disclosure: false }, onSuperseded: 'reapproval_required', onInputChanged: 'reapproval_required',
  },
});

/** The profiles a component of each kind may declare; the first is the default. Nested releases wait for a later part. */
export const KIND_PROFILES: Readonly<Record<AssetKind, readonly ProfileName[]>> = Object.freeze({
  code: ['code'], legal_template: ['contract'], legal_signed: ['contract'], offer: ['contract'],
  document: ['marketing', 'investor_pitch', 'contract'], pitch_deck: ['investor_pitch'],
  brand: ['marketing'], image: ['marketing'], video: ['marketing'], audio: ['marketing'], model_3d: ['marketing'],
  composite: [],
});

export const EFFECT_TARGETS = ['github_pr', 'stream', 'signed_document', 'website_cdn', 'external_distribution'] as const;
export type EffectTarget = (typeof EFFECT_TARGETS)[number];

export const WORK_GRAPH_RELEASE_LIMITS = Object.freeze({ maxComponents: 32, maxEffects: 8, maxCitations: 32 });
export type WorkGraphReleaseLimits = typeof WORK_GRAPH_RELEASE_LIMITS;

/** The caller's resolved context: D5579's scope and revocations, plus each person's authorities (the route resolves them). */
export interface ReleaseContext extends ValidationContext {
  authorities?: ReadonlyMap<number, readonly string[]>;
}

export type ReleaseRefusalCode =
  | RefusalCode
  | 'audience_forbidden' | 'policy_profile' | 'incomplete_package' | 'rebuild_required' | 'reapproval_required'
  | 'attestation_missing' | 'no_authority' | 'self_approval' | 'approval_incomplete' | 'changes_requested'
  | 'effect_target' | 'queue_full' | 'taken_down' | 'not_published';
export interface ReleaseRefusal { ok: false; code: ReleaseRefusalCode; ids: string[]; cost: Cost; currentHead?: { revisionUid: string | null; headSeq: number } }

const MANIFEST_PROFILE = 'application/vnd.studioos.release-manifest+json';
const ROLE = /^[a-z][a-z0-9_]{0,39}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9_.:/#@-]{0,119}$/;
const HEX64 = /^[0-9a-f]{64}$/;
export const keyOk = (k: unknown): k is string => typeof k === 'string' && k.length >= 1 && k.length <= 160;
export const refOk = (r: unknown): r is string => typeof r === 'string' && r.length >= 1 && r.length <= 200;
const posInt = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;
export function actorOk(a: Actor | undefined): a is Actor {
  if (!a) return false;
  if (a.kind === 'person') return posInt(a.userId);
  return a.kind === 'agent' && typeof a.agentRunId === 'string' && a.agentRunId.length > 0 && a.agentRunId.length <= 200 && posInt(a.onBehalfOfUserId);
}
export const userOf = (a: Actor) => (a.kind === 'person' ? a.userId : a.onBehalfOfUserId);
export const runOf = (a: Actor) => (a.kind === 'agent' ? a.agentRunId : null);

export function canonical(v: unknown): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}
export const hashOf = (v: unknown) => sha256Hex(new TextEncoder().encode(canonical(v)));

/** Counts the D1 statements a call issues, and folds in what the #5581 calls it makes report. */
export class Meter {
  cost: Cost = { d1Statements: 0, d1Batches: 0 };
  private env: Pick<Env, 'DB'>;
  constructor(env: Pick<Env, 'DB'>) { this.env = env; }
  first<T>(s: D1PreparedStatement): Promise<T | null> { this.cost.d1Statements++; return s.first<T>(); }
  async all<T>(s: D1PreparedStatement): Promise<T[]> { this.cost.d1Statements++; return ((await s.all<T>()).results ?? []) as T[]; }
  run(s: D1PreparedStatement) { this.cost.d1Statements++; return s.run(); }
  batch(list: D1PreparedStatement[]) { this.cost.d1Statements += list.length; this.cost.d1Batches++; return this.env.DB.batch(list); }
  fold(c: Cost) { this.cost.d1Statements += c.d1Statements; this.cost.d1Batches += c.d1Batches; }
  refuse(code: ReleaseRefusalCode, ids: string[], extra: Partial<ReleaseRefusal> = {}): ReleaseRefusal {
    return { ok: false, code, ids, ...extra, cost: { ...this.cost } };
  }
}

export interface LineRow {
  line_asset_uid: string; tenant_id: number; company_id: number; project_id: number | null; audience: Audience;
  head_revision_uid: string | null; head_seq: number; approval_policy: string; access_class: string;
}
export const scopeOf = (r: { tenant_id: number; company_id: number; project_id: number | null }): Scope =>
  ({ tenantId: r.tenant_id, companyId: r.company_id, projectId: r.project_id });

/** D5579's own scope rule (a company-wide caller covers its projects). */
export function outOfScope(ctx: ValidationContext, scope: Scope): boolean {
  return validateWorkGraph({ assets: [{ id: 'x', scope, kind: 'composite', headVersionId: null, accessClass: 'internal', approvalPolicy: 'x' }] }, ctx)
    .some((v) => v.code === 'wrong_tenant');
}

export async function readLine(env: Pick<Env, 'DB'>, m: Meter, lineAssetUid: string): Promise<LineRow | null> {
  return m.first<LineRow>(env.DB.prepare(
    `SELECT l.line_asset_uid, l.tenant_id, l.company_id, l.project_id, l.audience, a.head_revision_uid, a.head_seq,
            a.approval_policy, a.access_class
       FROM work_graph_release_lines l JOIN work_graph_assets a ON a.asset_uid = l.line_asset_uid
      WHERE l.line_asset_uid = ?`,
  ).bind(lineAssetUid));
}

// ---------------------------------------------------------------------------------------------------------------
// Release lines

export interface RegisterLineInput { scope: Scope; audience: Audience; actor: Actor; idempotencyKey: string }
export type RegisterLineResult = { ok: true; lineAssetUid: string; replayed: boolean; cost: Cost } | ReleaseRefusal;

/** A release line: a composite asset under `human_publication`, for one audience that never changes. */
export async function registerReleaseLine(env: Pick<Env, 'DB'>, ctx: ReleaseContext, input: RegisterLineInput): Promise<RegisterLineResult> {
  const m = new Meter(env);
  if (!(AUDIENCES as readonly string[]).includes(input?.audience) || !keyOk(input.idempotencyKey) || !actorOk(input.actor)) {
    return m.refuse('malformed', []);
  }
  const r = await registerAsset(env, ctx, {
    scope: input.scope, kind: 'composite', accessClass: LINE_CLASS[input.audience], approvalPolicy: 'human_publication',
    actor: input.actor, idempotencyKey: `release-line:${input.idempotencyKey}`,
  });
  m.fold(r.cost);
  if (!r.ok) return m.refuse(r.code, r.ids);
  await m.run(env.DB.prepare(
    `INSERT INTO work_graph_release_lines (line_asset_uid, tenant_id, company_id, project_id, audience, created_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (line_asset_uid) DO NOTHING`,
  ).bind(r.assetUid, input.scope.tenantId, input.scope.companyId, input.scope.projectId, input.audience, userOf(input.actor),
    WORK_GRAPH_DEPS.now().toISOString()));
  const line = await readLine(env, m, r.assetUid);
  if (!line || line.audience !== input.audience) return m.refuse('idempotency_conflict', [r.assetUid]);
  return { ok: true, lineAssetUid: r.assetUid, replayed: r.replayed, cost: { ...m.cost } };
}

// ---------------------------------------------------------------------------------------------------------------
// Manifests

export interface ManifestComponentInput {
  assetUid: string;
  /** The exact revision, never "latest". It must be the asset's accepted head when the manifest is cut. */
  revisionUid: string;
  /** The digest the caller pins; it must be the revision's. */
  digest: string;
  /** What the piece is in the package (`deck`, `offer_terms`, `video_master`, `website`…), for tracing. */
  role: string;
  /** One of the kind's allowed profiles; the kind's default when absent. */
  profile?: ProfileName;
}
export interface ManifestComponent {
  asset: string; revision: string; digest: string; kind: AssetKind; role: string; access: AccessClass;
  profiles: ProfileName[]; source: SourceRef;
}
export interface ManifestBody {
  v: 1; line: string; audience: Audience; partial: boolean; base: string | null; components: ManifestComponent[];
  /** Part 2: the earlier published manifest whose component revisions this one re-pins. Absent on an ordinary cut. */
  repin?: string;
}

export interface CutManifestInput {
  lineAssetUid: string;
  components: ManifestComponentInput[];
  /** A partial package may leave out pieces the published manifest has; a full one may not. */
  partial: boolean;
  author: Actor;
  idempotencyKey: string;
}
export type CutManifestResult =
  | { ok: true; manifestUid: string; digest: string; baseManifestUid: string | null; replayed: boolean; cost: Cost }
  | ReleaseRefusal;

export interface ComponentRow {
  revision_uid: string; asset_uid: string; digest: string; tombstoned_at: string | null; source_store: string;
  source_locator: string; source_id: string; source_revision: string; residency: string | null; tenant_id: number;
  company_id: number; project_id: number | null; kind: string; access_class: string; approval_policy: string;
  head_revision_uid: string | null;
}

export async function readComponents(env: Pick<Env, 'DB'>, m: Meter, revisionUids: string[]): Promise<Map<string, ComponentRow>> {
  const rows = await m.all<ComponentRow>(env.DB.prepare(
    `SELECT r.revision_uid, r.asset_uid, r.digest, r.tombstoned_at, r.source_store, r.source_locator, r.source_id,
            r.source_revision, r.residency, a.tenant_id, a.company_id, a.project_id, a.kind, a.access_class, a.approval_policy,
            a.head_revision_uid
       FROM work_graph_revisions r JOIN work_graph_assets a ON a.asset_uid = r.asset_uid
      WHERE r.revision_uid IN (SELECT value FROM json_each(?))`,
  ).bind(JSON.stringify(revisionUids)));
  return new Map(rows.map((r) => [r.revision_uid, r]));
}

export function profilesFor(kind: AssetKind, declared: ProfileName | undefined, access: AccessClass, residency: string | null): ProfileName[] | null {
  const allowed = KIND_PROFILES[kind] ?? [];
  const own = declared ?? allowed[0];
  if (!own || !allowed.includes(own)) return null;
  return access === 'restricted' || residency ? [own, 'protected_data'] : [own];
}

/**
 * Cut a manifest: an immutable revision of the line that pins each component at its revision and digest, built on the
 * line's current published manifest. Checked here: scope, the pin (`unpinned_component`), the audience's access
 * classes, the kind's profiles, the accepted head (a draft is `composite_incompatible`), and a full package's coverage.
 */
export async function cutManifest(
  env: Pick<Env, 'DB'>, ctx: ReleaseContext, input: CutManifestInput, limits: WorkGraphReleaseLimits = WORK_GRAPH_RELEASE_LIMITS,
): Promise<CutManifestResult> {
  const m = new Meter(env);
  const comps = Array.isArray(input?.components) ? input.components : [];
  if (!keyOk(input?.idempotencyKey) || !actorOk(input.author) || typeof input.lineAssetUid !== 'string'
    || typeof input.partial !== 'boolean' || comps.length < 1 || comps.length > limits.maxComponents
    || comps.some((c) => !c || typeof c.assetUid !== 'string' || typeof c.revisionUid !== 'string' || !HEX64.test(String(c.digest))
      || typeof c.role !== 'string' || !ROLE.test(c.role) || (c.profile !== undefined && !(PROFILES as readonly string[]).includes(c.profile)))
    || new Set(comps.map((c) => c.assetUid)).size !== comps.length) {
    return m.refuse('malformed', [String(input?.lineAssetUid)]);
  }
  const line = await readLine(env, m, input.lineAssetUid);
  if (!line) return m.refuse('not_found', [input.lineAssetUid]);
  if (outOfScope(ctx, scopeOf(line))) return m.refuse('wrong_tenant', [line.line_asset_uid]);

  // A retry after a lost callback returns the manifest it cut, whatever has moved since.
  const prior = await m.first<{ manifest_uid: string; manifest_digest: string; base_manifest_uid: string | null; body_json: string }>(env.DB.prepare(
    `SELECT manifest_uid, manifest_digest, base_manifest_uid, body_json FROM work_graph_release_manifests
      WHERE tenant_id = ? AND company_id = ? AND idempotency_key = ?`,
  ).bind(line.tenant_id, line.company_id, input.idempotencyKey));
  const requestShape = (b: { line: string; partial: boolean; components: { asset: string; revision: string; digest: string; role: string }[] }) =>
    canonical({ line: b.line, partial: b.partial, components: b.components.map((c) => ({ asset: c.asset, revision: c.revision, digest: c.digest, role: c.role })).sort((a, b2) => (a.asset < b2.asset ? -1 : 1)) });
  const asked = requestShape({ line: input.lineAssetUid, partial: input.partial, components: comps.map((c) => ({ asset: c.assetUid, revision: c.revisionUid, digest: c.digest, role: c.role })) });
  if (prior) {
    const body = JSON.parse(prior.body_json) as ManifestBody;
    if (body.repin !== undefined || requestShape(body) !== asked) return m.refuse('idempotency_conflict', [prior.manifest_uid]);
    return { ok: true, manifestUid: prior.manifest_uid, digest: prior.manifest_digest, baseManifestUid: prior.base_manifest_uid, replayed: true, cost: { ...m.cost } };
  }

  const rows = await readComponents(env, m, comps.map((c) => c.revisionUid));
  const components: ManifestComponent[] = [];
  for (const c of comps) {
    const r = rows.get(c.revisionUid);
    if (!r || r.asset_uid !== c.assetUid) return m.refuse('unknown_reference', [c.assetUid, c.revisionUid]);
    if (outOfScope(ctx, scopeOf(r)) || r.tenant_id !== line.tenant_id || r.company_id !== line.company_id) {
      return m.refuse('wrong_tenant', [c.assetUid]);
    }
    if (r.digest !== c.digest) return m.refuse('unpinned_component', [c.revisionUid, c.digest]);
    if (r.tombstoned_at !== null) return m.refuse('tombstoned', [c.revisionUid]);
    const kind = r.kind as AssetKind;
    const access = r.access_class as AccessClass;
    const profiles = profilesFor(kind, c.profile, access, r.residency);
    if (!profiles) return m.refuse('policy_profile', [c.assetUid, kind, String(c.profile)]);
    if (!AUDIENCE_CLASSES[line.audience].includes(access)) return m.refuse('audience_forbidden', [c.assetUid, access, line.audience]);
    // Only accepted work is released: a candidate that never became its asset's head is a draft.
    if (r.head_revision_uid !== c.revisionUid) return m.refuse('composite_incompatible', [c.assetUid, c.revisionUid, String(r.head_revision_uid)]);
    components.push({
      asset: c.assetUid, revision: c.revisionUid, digest: r.digest, kind, role: c.role, access, profiles,
      source: { store: r.source_store as SourceRef['store'], locator: r.source_locator, id: r.source_id, revision: r.source_revision },
    });
  }
  components.sort((a, b) => (a.asset < b.asset ? -1 : a.asset > b.asset ? 1 : 0));

  const base = line.head_revision_uid;
  if (base && !input.partial) {
    const pub = await m.first<{ body_json: string }>(env.DB.prepare(
      'SELECT body_json FROM work_graph_release_manifests WHERE manifest_uid = ?',
    ).bind(base));
    const had = pub ? (JSON.parse(pub.body_json) as ManifestBody).components.map((c) => c.asset) : [];
    const missing = had.filter((a) => !components.some((c) => c.asset === a));
    if (missing.length) return m.refuse('incomplete_package', missing);
  }

  const body: ManifestBody = { v: 1, line: line.line_asset_uid, audience: line.audience, partial: input.partial, base, components };
  const text = canonical(body);
  const digest = await sha256Hex(new TextEncoder().encode(text));
  const rev = await createRevision(env, ctx, {
    assetUid: line.line_asset_uid, parents: base ? [base] : [], digest, byteLength: new TextEncoder().encode(text).byteLength,
    mediaProfile: MANIFEST_PROFILE, source: { store: 'd1_record', locator: 'work_graph_release_manifests', id: digest, revision: digest },
    author: input.author, idempotencyKey: `release-manifest:${input.idempotencyKey}`,
    dependencies: components.map((c) => ({ kind: 'component' as const, assetUid: c.asset, revisionUid: c.revision })),
  });
  m.fold(rev.cost);
  if (!rev.ok) return m.refuse(rev.code, rev.ids, rev.currentHead ? { currentHead: rev.currentHead } : {});
  await m.run(env.DB.prepare(
    `INSERT INTO work_graph_release_manifests (manifest_uid, line_asset_uid, tenant_id, company_id, project_id, audience,
       manifest_digest, base_manifest_uid, partial, component_count, body_json, actor_kind, actor_user_id, agent_run_id,
       idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (manifest_uid) DO NOTHING`,
  ).bind(rev.revisionUid, line.line_asset_uid, line.tenant_id, line.company_id, line.project_id, line.audience, digest, base,
    input.partial ? 1 : 0, components.length, text, input.author.kind, userOf(input.author), runOf(input.author),
    input.idempotencyKey, WORK_GRAPH_DEPS.now().toISOString()));
  return { ok: true, manifestUid: rev.revisionUid, digest, baseManifestUid: base, replayed: rev.replayed, cost: { ...m.cost } };
}

// ---------------------------------------------------------------------------------------------------------------
// Attestations: the evidence a profile requires of one component revision, at one digest

export interface AttestInput {
  revisionUid: string;
  digest: string;
  requirement: Requirement;
  /** Where the evidence lives: a PR and commit, a CI run, a rights record, a review item. Ids only. */
  evidenceRef: string;
  /** The authority the attester acts under (a person's requirement needs one the caller resolved). */
  authority?: string | null;
  actor: Actor;
  idempotencyKey: string;
}
export type AttestResult = { ok: true; attestationId: number; replayed: boolean; cost: Cost } | ReleaseRefusal;

export async function attestComponent(env: Pick<Env, 'DB'>, ctx: ReleaseContext, input: AttestInput): Promise<AttestResult> {
  const m = new Meter(env);
  if (!keyOk(input?.idempotencyKey) || !actorOk(input.actor) || typeof input.revisionUid !== 'string' || !HEX64.test(String(input.digest))
    || !(REQUIREMENTS as readonly string[]).includes(input.requirement) || !refOk(input.evidenceRef)
    || (input.authority != null && (typeof input.authority !== 'string' || !ROLE.test(input.authority)))) {
    return m.refuse('malformed', [String(input?.revisionUid)]);
  }
  const r = (await readComponents(env, m, [input.revisionUid])).get(input.revisionUid);
  if (!r) return m.refuse('not_found', [input.revisionUid]);
  if (outOfScope(ctx, scopeOf(r))) return m.refuse('wrong_tenant', [r.asset_uid]);
  const hash = await hashOf({ op: 'attest', ...input });
  const prior = await m.first<{ id: number; request_hash: string }>(env.DB.prepare(
    'SELECT id, request_hash FROM work_graph_release_attestations WHERE tenant_id = ? AND company_id = ? AND idempotency_key = ?',
  ).bind(r.tenant_id, r.company_id, input.idempotencyKey));
  if (prior) {
    return prior.request_hash === hash
      ? { ok: true, attestationId: prior.id, replayed: true, cost: { ...m.cost } }
      : m.refuse('idempotency_conflict', [String(prior.id)]);
  }
  if (r.digest !== input.digest) return m.refuse('stale_approval', [input.revisionUid, input.digest]);
  const revokedPerson = input.actor.kind === 'person' ? ctx.revokedUserIds?.has(input.actor.userId) : (ctx.revokedAgentRunIds?.has(input.actor.agentRunId) || ctx.revokedUserIds?.has(input.actor.onBehalfOfUserId));
  if (revokedPerson) return m.refuse('revoked_author', [input.revisionUid]);
  const needed = REQUIREMENT_AUTHORITY[input.requirement];
  if (needed) {
    if (input.actor.kind !== 'person') return m.refuse('person_required', [input.revisionUid, input.requirement]);
    const held = ctx.authorities?.get(input.actor.userId) ?? [];
    if (!input.authority || !needed.includes(input.authority) || !held.includes(input.authority)) {
      return m.refuse('no_authority', [input.revisionUid, input.requirement]);
    }
  }
  const at = WORK_GRAPH_DEPS.now().toISOString();
  try {
    await m.run(env.DB.prepare(
      `INSERT INTO work_graph_release_attestations (tenant_id, company_id, revision_uid, digest, requirement, evidence_ref,
         authority, actor_kind, actor_user_id, agent_run_id, idempotency_key, request_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(r.tenant_id, r.company_id, r.revision_uid, r.digest, input.requirement, input.evidenceRef, input.authority ?? null,
      input.actor.kind, userOf(input.actor), runOf(input.actor), input.idempotencyKey, hash, at));
  } catch (e) {
    const raced = await attestComponent(env, ctx, input);
    if (raced.ok) return raced;
    throw e;
  }
  const row = await m.first<{ id: number }>(env.DB.prepare(
    'SELECT id FROM work_graph_release_attestations WHERE tenant_id = ? AND company_id = ? AND idempotency_key = ?',
  ).bind(r.tenant_id, r.company_id, input.idempotencyKey));
  return { ok: true, attestationId: Number(row?.id), replayed: false, cost: { ...m.cost } };
}

// ---------------------------------------------------------------------------------------------------------------
// Decisions: a reviewer's decision on one manifest digest, bound to audience, profile, authority, citations,
// disclosure and rights. The approval-inbox item it came from is `approvalRef` (D5579 §1: reuse, not a second inbox).

export interface DecideInput {
  manifestUid: string;
  /** The digest the reviewer saw. Any other is stale. */
  digest: string;
  audience: Audience;
  purpose: 'publish' | 'render';
  profile: ProfileName;
  authority: string;
  decision: 'approve' | 'reject' | 'request_changes' | 'withdraw';
  reviewer: Actor;
  approvalRef: string;
  /** Revision uids in this company the reviewer relied on. */
  citations?: string[];
  disclosureRef?: string | null;
  rightsRef?: string | null;
  idempotencyKey: string;
}
export type DecideResult = { ok: true; decisionId: number; replayed: boolean; cost: Cost } | ReleaseRefusal;

export interface ManifestRow {
  manifest_uid: string; line_asset_uid: string; tenant_id: number; company_id: number; project_id: number | null;
  audience: Audience; manifest_digest: string; base_manifest_uid: string | null; partial: number; body_json: string;
  actor_kind: string; actor_user_id: number; agent_run_id: string | null; created_at: string;
}
export async function readManifest(env: Pick<Env, 'DB'>, m: Meter, manifestUid: string): Promise<ManifestRow | null> {
  return m.first<ManifestRow>(env.DB.prepare(
    `SELECT manifest_uid, line_asset_uid, tenant_id, company_id, project_id, audience, manifest_digest, base_manifest_uid,
            partial, body_json, actor_kind, actor_user_id, agent_run_id, created_at
       FROM work_graph_release_manifests WHERE manifest_uid = ?`,
  ).bind(manifestUid));
}

export async function decideRelease(env: Pick<Env, 'DB'>, ctx: ReleaseContext, input: DecideInput, limits: WorkGraphReleaseLimits = WORK_GRAPH_RELEASE_LIMITS): Promise<DecideResult> {
  const m = new Meter(env);
  const citations = input?.citations ?? [];
  if (!keyOk(input?.idempotencyKey) || typeof input.manifestUid !== 'string' || !HEX64.test(String(input.digest))
    || !(AUDIENCES as readonly string[]).includes(input.audience) || !['publish', 'render'].includes(input.purpose)
    || !(PROFILES as readonly string[]).includes(input.profile) || typeof input.authority !== 'string' || !ROLE.test(input.authority)
    || !['approve', 'reject', 'request_changes', 'withdraw'].includes(input.decision) || !actorOk(input.reviewer)
    || !refOk(input.approvalRef) || !Array.isArray(citations) || citations.length > limits.maxCitations
    || citations.some((c) => typeof c !== 'string' || c.length > 80)
    || (input.disclosureRef != null && !refOk(input.disclosureRef)) || (input.rightsRef != null && !refOk(input.rightsRef))) {
    return m.refuse('malformed', [String(input?.manifestUid)]);
  }
  const man = await readManifest(env, m, input.manifestUid);
  if (!man) return m.refuse('not_found', [input.manifestUid]);
  if (outOfScope(ctx, scopeOf(man))) return m.refuse('wrong_tenant', [man.manifest_uid]);

  const hash = await hashOf({ op: 'decide', ...input, citations });
  const prior = await m.first<{ id: number; request_hash: string }>(env.DB.prepare(
    'SELECT id, request_hash FROM work_graph_release_decisions WHERE tenant_id = ? AND company_id = ? AND idempotency_key = ?',
  ).bind(man.tenant_id, man.company_id, input.idempotencyKey));
  if (prior) {
    return prior.request_hash === hash
      ? { ok: true, decisionId: prior.id, replayed: true, cost: { ...m.cost } }
      : m.refuse('idempotency_conflict', [String(prior.id)]);
  }

  // A person decides, about these exact bytes, for this audience (D5579's codes; D5458's binding).
  if (input.reviewer.kind !== 'person') return m.refuse('agent_review', [man.manifest_uid]);
  if (ctx.revokedUserIds?.has(input.reviewer.userId)) return m.refuse('revoked_author', [man.manifest_uid]);
  if (input.digest !== man.manifest_digest) return m.refuse('stale_approval', [man.manifest_uid, input.digest]);
  if (input.audience !== man.audience) return m.refuse('audience_forbidden', [man.manifest_uid, input.audience, man.audience]);
  const body = JSON.parse(man.body_json) as ManifestBody;
  if (!body.components.some((c) => c.profiles.includes(input.profile))) return m.refuse('policy_profile', [man.manifest_uid, input.profile]);
  const held = ctx.authorities?.get(input.reviewer.userId) ?? [];
  if (!POLICY_PROFILES[input.profile].authorities.includes(input.authority) || !held.includes(input.authority)) {
    return m.refuse('no_authority', [man.manifest_uid, input.profile, input.authority]);
  }
  if (input.decision === 'approve') {
    if (input.reviewer.userId === man.actor_user_id) return m.refuse('self_approval', [man.manifest_uid]);
    const needs = POLICY_PROFILES[input.profile].needs;
    if (input.purpose === 'publish' && ((needs.citations && !citations.length) || (needs.rights && !input.rightsRef) || (needs.disclosure && !input.disclosureRef))) {
      return m.refuse('approval_incomplete', [man.manifest_uid, input.profile]);
    }
  }
  if (citations.length) {
    const found = await m.all<{ revision_uid: string }>(env.DB.prepare(
      `SELECT revision_uid FROM work_graph_revisions
        WHERE tenant_id = ? AND company_id = ? AND revision_uid IN (SELECT value FROM json_each(?))`,
    ).bind(man.tenant_id, man.company_id, JSON.stringify(citations)));
    const missing = citations.filter((c) => !found.some((f) => f.revision_uid === c));
    if (missing.length) return m.refuse('unknown_reference', [man.manifest_uid, ...missing]);
  }
  const at = WORK_GRAPH_DEPS.now().toISOString();
  try {
    await m.run(env.DB.prepare(
      `INSERT INTO work_graph_release_decisions (tenant_id, company_id, project_id, manifest_uid, manifest_digest, audience,
         purpose, profile, authority, decision, reviewer_user_id, approval_ref, citations_json, disclosure_ref, rights_ref,
         idempotency_key, request_hash, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(man.tenant_id, man.company_id, man.project_id, man.manifest_uid, man.manifest_digest, man.audience, input.purpose,
      input.profile, input.authority, input.decision, input.reviewer.userId, input.approvalRef, JSON.stringify(citations),
      input.disclosureRef ?? null, input.rightsRef ?? null, input.idempotencyKey, hash, at));
  } catch (e) {
    const raced = await decideRelease(env, ctx, input, limits);
    if (raced.ok) return raced;
    throw e;
  }
  const row = await m.first<{ id: number }>(env.DB.prepare(
    'SELECT id FROM work_graph_release_decisions WHERE tenant_id = ? AND company_id = ? AND idempotency_key = ?',
  ).bind(man.tenant_id, man.company_id, input.idempotencyKey));
  return { ok: true, decisionId: Number(row?.id), replayed: false, cost: { ...m.cost } };
}

// ---------------------------------------------------------------------------------------------------------------
// Status: what each pinned component owes, under its profiles, and what the manifest still lacks

export type ComponentStatus = 'current' | StaleStatus;
export interface ComponentState extends ManifestComponent {
  headRevisionUid: string | null;
  status: ComponentStatus;
  /**
   * `superseded`: its asset has a newer head; `input_changed`: a dependency it was built from has one; `repinned`
   * (part 2): a re-pin pins it on purpose, so neither counts; `taken_down`: a takedown covers it (part 2).
   */
  reasons: ('superseded' | 'input_changed' | 'tombstoned' | 'repinned' | 'taken_down')[];
  missingAttestations: Requirement[];
}
export interface PublishApproval { profile: ProfileName; approvalRef: string; reviewerUserId: number; authority: string; decidedAt: string }
/**
 * Part 11 (D5585-p11): why a reviewer's live decision on a manifest does not count as a publish approval of it. One
 * code per decision, the first rule of `decisionNotCounted` it fails, in the order the evaluation applies them.
 */
export const DECISION_NOT_COUNTED = [
  'withdrawn', 'changes_requested', 'other_digest', 'other_audience', 'reviewer_revoked', 'author_own', 'authority_not_held',
  'authority_not_for_profile',
] as const;
export type DecisionNotCountedReason = (typeof DECISION_NOT_COUNTED)[number];
export interface NotCountedDecision {
  profile: ProfileName; reviewerUserId: number; authority: string; decision: string; decidedAt: string; reason: DecisionNotCountedReason;
}
/** The fields of a live decision row the counting rule reads. */
export interface LiveDecision { profile: ProfileName; authority: string; decision: string; reviewer_user_id: number; audience: string; manifest_digest: string }

/**
 * THE counting rule (part 11 made it one function, so the evaluation and its explanation cannot drift): null when a
 * reviewer's live decision counts as a publish approval of this manifest for this line's audience, else the reason it
 * does not. Authority and revocation are re-read from the context, never trusted from the decision (D5458).
 */
export function decisionNotCounted(
  ctx: ReleaseContext, man: Pick<ManifestRow, 'manifest_digest' | 'actor_user_id'>, lineAudience: string, d: LiveDecision,
): DecisionNotCountedReason | null {
  if (d.decision === 'withdraw') return 'withdrawn';
  if (d.decision !== 'approve') return 'changes_requested';
  if (d.manifest_digest !== man.manifest_digest) return 'other_digest';
  if (d.audience !== lineAudience) return 'other_audience';
  if (ctx.revokedUserIds?.has(d.reviewer_user_id)) return 'reviewer_revoked';
  if (d.reviewer_user_id === man.actor_user_id) return 'author_own';
  if (!(ctx.authorities?.get(d.reviewer_user_id) ?? []).includes(d.authority)) return 'authority_not_held';
  if (!POLICY_PROFILES[d.profile].authorities.includes(d.authority)) return 'authority_not_for_profile';
  return null;
}
export interface ReleaseState {
  manifestUid: string; lineAssetUid: string; audience: Audience; digest: string; partial: boolean; baseManifestUid: string | null;
  /** True while the line's publication pointer names this manifest. */
  published: boolean;
  status: ComponentStatus;
  components: ComponentState[];
  /** Profiles in the manifest with no live publish approval of this digest. */
  missingApprovals: ProfileName[];
  approvals: PublishApproval[];
  /** Part 11: the person who cut the manifest (for an agent, its sponsor). */
  authorUserId: number;
  /** Part 11: every other live decision, with the one reason `decisionNotCounted` gives for it. */
  notCounted: NotCountedDecision[];
  /** Reviewers whose latest decision is reject or request_changes. */
  changesRequestedBy: number[];
  /** Part 2: the earlier published manifest this one re-pins, or null. */
  repinOf: string | null;
  /** Part 2: applied takedowns covering this manifest or a component it pins. Retained evidence; never served. */
  takedowns: TakedownRef[];
}
export interface TakedownRef { id: number; scope: 'manifest' | 'component'; revisionUid: string | null; reasonCode: string; createdAt: string }

/**
 * Part 2: the applied takedowns that cover a manifest: one of the manifest itself, or one of a component revision it
 * pins (wherever that revision was taken down).
 */
export async function takedownsCovering(env: Pick<Env, 'DB'>, m: Meter, tenantId: number, companyId: number, manifestUid: string): Promise<TakedownRef[]> {
  const rows = await m.all<{ id: number; scope: 'manifest' | 'component'; revision_uid: string | null; reason_code: string; created_at: string }>(env.DB.prepare(
    `SELECT t.id, t.scope, t.revision_uid, t.reason_code, t.created_at FROM work_graph_release_takedowns t
      WHERE t.tenant_id = ? AND t.company_id = ? AND t.outcome = 'applied'
        AND ((t.scope = 'manifest' AND t.manifest_uid = ?)
          OR (t.scope = 'component' AND t.revision_uid IN (
                SELECT e.to_revision_uid FROM work_graph_edges e WHERE e.from_revision_uid = ? AND e.edge_kind = 'component')))
      ORDER BY t.id`,
  ).bind(tenantId, companyId, manifestUid, manifestUid));
  return rows.map((r) => ({ id: r.id, scope: r.scope, revisionUid: r.revision_uid, reasonCode: r.reason_code, createdAt: r.created_at }));
}

const worse = (a: ComponentStatus, b: ComponentStatus): ComponentStatus =>
  (a === 'reapproval_required' || b === 'reapproval_required') ? 'reapproval_required'
    : (a === 'rebuild_required' || b === 'rebuild_required') ? 'rebuild_required' : 'current';

export async function evaluate(env: Pick<Env, 'DB'>, m: Meter, ctx: ReleaseContext, man: ManifestRow, line: LineRow): Promise<ReleaseState> {
  const body = JSON.parse(man.body_json) as ManifestBody;
  const revs = body.components.map((c) => c.revision);
  // A re-pin pins the component revisions of a manifest this line published; only those are exempt from staleness.
  let repinned = new Set<string>();
  if (body.repin) {
    const target = await readManifest(env, m, body.repin);
    if (target && target.line_asset_uid === man.line_asset_uid) {
      repinned = new Set((JSON.parse(target.body_json) as ManifestBody).components.map((c) => c.revision));
    }
  }
  const takedowns = await takedownsCovering(env, m, man.tenant_id, man.company_id, man.manifest_uid);
  const downRevs = new Set(takedowns.flatMap((t) => (t.revisionUid ? [t.revisionUid] : [])));
  const now = await readComponents(env, m, revs);
  // Inputs a pinned component was built from that have moved on (its read, write and derived edges).
  const stale = await m.all<{ from_revision_uid: string }>(env.DB.prepare(
    `SELECT DISTINCT e.from_revision_uid FROM work_graph_edges e JOIN work_graph_assets d ON d.asset_uid = e.to_asset_uid
      WHERE e.from_revision_uid IN (SELECT value FROM json_each(?)) AND e.edge_kind <> 'component'
        AND d.head_revision_uid IS NOT e.to_revision_uid`,
  ).bind(JSON.stringify(revs)));
  const staleSet = new Set(stale.map((s) => s.from_revision_uid));
  const atts = await m.all<{ revision_uid: string; digest: string; requirement: Requirement }>(env.DB.prepare(
    `SELECT DISTINCT revision_uid, digest, requirement FROM work_graph_release_attestations
      WHERE tenant_id = ? AND company_id = ? AND revision_uid IN (SELECT value FROM json_each(?))`,
  ).bind(man.tenant_id, man.company_id, JSON.stringify(revs)));

  let status: ComponentStatus = 'current';
  const components: ComponentState[] = body.components.map((c) => {
    const r = now.get(c.revision);
    const reasons: ComponentState['reasons'] = [];
    let s: ComponentStatus = 'current';
    if (!r || r.tombstoned_at !== null) { reasons.push('tombstoned'); s = 'reapproval_required'; }
    if (repinned.has(c.revision)) {
      if (r && (r.head_revision_uid !== c.revision || staleSet.has(c.revision))) reasons.push('repinned');
    } else {
      if (r && r.head_revision_uid !== c.revision) {
        reasons.push('superseded');
        for (const p of c.profiles) s = worse(s, POLICY_PROFILES[p].onSuperseded);
      }
      if (staleSet.has(c.revision)) {
        reasons.push('input_changed');
        for (const p of c.profiles) s = worse(s, POLICY_PROFILES[p].onInputChanged);
      }
    }
    if (downRevs.has(c.revision)) reasons.push('taken_down');
    status = worse(status, s);
    const have = new Set(atts.filter((a) => a.revision_uid === c.revision && a.digest === c.digest).map((a) => a.requirement));
    const missingAttestations = [...new Set(c.profiles.flatMap((p) => POLICY_PROFILES[p].requirements))].filter((q) => !have.has(q));
    return { ...c, headRevisionUid: r?.head_revision_uid ?? null, status: s, reasons, missingAttestations };
  });

  // The live decision of each reviewer is their latest row for (purpose, profile).
  const decisions = await m.all<{ id: number; profile: ProfileName; authority: string; decision: string; reviewer_user_id: number;
    approval_ref: string; decided_at: string; audience: string; manifest_digest: string }>(env.DB.prepare(
    `SELECT d.id, d.profile, d.authority, d.decision, d.reviewer_user_id, d.approval_ref, d.decided_at, d.audience, d.manifest_digest
       FROM work_graph_release_decisions d
      WHERE d.manifest_uid = ? AND d.purpose = 'publish'
        AND d.id = (SELECT MAX(x.id) FROM work_graph_release_decisions x
                     WHERE x.manifest_uid = d.manifest_uid AND x.purpose = 'publish' AND x.profile = d.profile
                       AND x.reviewer_user_id = d.reviewer_user_id)
      ORDER BY d.id`,
  ).bind(man.manifest_uid));
  const changesRequestedBy = [...new Set(decisions.filter((d) => d.decision === 'reject' || d.decision === 'request_changes').map((d) => d.reviewer_user_id))];
  const approvals: PublishApproval[] = [];
  const notCounted: NotCountedDecision[] = [];
  for (const d of decisions) {
    // Authority and revocation are re-read at publication time, not trusted from the decision (D5458).
    const reason = decisionNotCounted(ctx, man, line.audience, d);
    if (reason) {
      notCounted.push({ profile: d.profile, reviewerUserId: d.reviewer_user_id, authority: d.authority, decision: d.decision, decidedAt: d.decided_at, reason });
      continue;
    }
    approvals.push({ profile: d.profile, approvalRef: d.approval_ref, reviewerUserId: d.reviewer_user_id, authority: d.authority, decidedAt: d.decided_at });
  }
  const profiles = [...new Set(body.components.flatMap((c) => c.profiles))].sort();
  const missingApprovals = profiles.filter((p) => !approvals.some((a) => a.profile === p));
  return {
    manifestUid: man.manifest_uid, lineAssetUid: man.line_asset_uid, audience: man.audience, digest: man.manifest_digest,
    partial: man.partial === 1, baseManifestUid: man.base_manifest_uid, published: line.head_revision_uid === man.manifest_uid,
    status, components, missingApprovals, approvals, authorUserId: man.actor_user_id, notCounted, changesRequestedBy, repinOf: body.repin ?? null, takedowns,
  };
}

export type ReleaseStatusResult = { ok: true; release: ReleaseState; cost: Cost } | ReleaseRefusal;

/** A manifest's state: every pinned piece with its source, what it owes, and what the manifest lacks. */
export async function releaseStatus(env: Pick<Env, 'DB'>, ctx: ReleaseContext, manifestUid: string): Promise<ReleaseStatusResult> {
  const m = new Meter(env);
  const man = typeof manifestUid === 'string' ? await readManifest(env, m, manifestUid) : null;
  if (!man) return m.refuse('not_found', [String(manifestUid)]);
  if (outOfScope(ctx, scopeOf(man))) return m.refuse('wrong_tenant', [man.manifest_uid]);
  const line = await readLine(env, m, man.line_asset_uid);
  if (!line) return m.refuse('not_found', [man.line_asset_uid]);
  return { ok: true, release: await evaluate(env, m, ctx, man, line), cost: { ...m.cost } };
}

export type PublishedResult = { ok: true; release: ReleaseState | null; headSeq: number; cost: Cost } | ReleaseRefusal;

/** The manifest the line's publication pointer names, traced to its pinned versions (never the components' latest). */
export async function publishedRelease(env: Pick<Env, 'DB'>, ctx: ReleaseContext, lineAssetUid: string): Promise<PublishedResult> {
  const m = new Meter(env);
  const line = typeof lineAssetUid === 'string' ? await readLine(env, m, lineAssetUid) : null;
  if (!line) return m.refuse('not_found', [String(lineAssetUid)]);
  if (outOfScope(ctx, scopeOf(line))) return m.refuse('wrong_tenant', [line.line_asset_uid]);
  if (!line.head_revision_uid) return { ok: true, release: null, headSeq: line.head_seq, cost: { ...m.cost } };
  const man = await readManifest(env, m, line.head_revision_uid);
  if (!man) return m.refuse('not_found', [line.head_revision_uid]);
  return { ok: true, release: await evaluate(env, m, ctx, man, line), headSeq: line.head_seq, cost: { ...m.cost } };
}

// ---------------------------------------------------------------------------------------------------------------
// Publication: the CAS pointer, with the outbox effects in the same batch

export interface PublishEffect {
  target: EffectTarget;
  /** The target's own id: `owner/repo#123`, a Stream uid, an envelope id, a site, a channel. Ids only. */
  ref: string;
}
export interface PublishInput {
  lineAssetUid: string;
  manifestUid: string;
  /** The manifest the publisher expects the pointer to name now: null for the line's first release. */
  expectedManifestUid: string | null;
  effects: PublishEffect[];
  actor: Actor;
  idempotencyKey: string;
}
export type PublishResult =
  | { ok: true; manifestUid: string; previousManifestUid: string | null; headSeq: number; replayed: boolean; effectIds: number[]; cost: Cost }
  | ReleaseRefusal;

/**
 * Publish a manifest. Refused unless every component is still its asset's accepted head, every pinned input is
 * current, every profile's attestations exist at the pinned digests, every profile has a live publish approval of this
 * digest for this audience by a person with the authority (not the author), nobody's latest decision asks for changes,
 * and D5579's release check passes (each component's bytes were approved by a person when they became its head).
 * Then one batch: #5581's CAS on the line's head from `expectedManifestUid`, its `advance_head` audit row, and one
 * pending `work_graph_effects` row (with its `effect_enqueued` audit) per target. A replay returns the first result.
 */
export async function publishRelease(
  env: AdvanceHeadEnv, ctx: ReleaseContext, input: PublishInput, limits: WorkGraphReleaseLimits = WORK_GRAPH_RELEASE_LIMITS,
): Promise<PublishResult> {
  const m = new Meter(env);
  const effects = Array.isArray(input?.effects) ? input.effects : [];
  if (!keyOk(input?.idempotencyKey) || !actorOk(input.actor) || typeof input.lineAssetUid !== 'string' || typeof input.manifestUid !== 'string'
    || (input.expectedManifestUid !== null && typeof input.expectedManifestUid !== 'string') || effects.length > limits.maxEffects
    || effects.some((e) => !e || !(EFFECT_TARGETS as readonly string[]).includes(e.target) || typeof e.ref !== 'string' || !REF.test(e.ref))
    || new Set(effects.map((e) => `${e.target}|${e.ref}`)).size !== effects.length) {
    return m.refuse('malformed', [String(input?.lineAssetUid)]);
  }
  const line = await readLine(env, m, input.lineAssetUid);
  if (!line) return m.refuse('not_found', [input.lineAssetUid]);
  if (outOfScope(ctx, scopeOf(line))) return m.refuse('wrong_tenant', [line.line_asset_uid]);
  const man = await readManifest(env, m, input.manifestUid);
  if (!man || man.line_asset_uid !== line.line_asset_uid) return m.refuse('unknown_reference', [line.line_asset_uid, input.manifestUid]);

  const effectRows = effects.map((e) => {
    const payload = { manifest: man.manifest_uid, digest: man.manifest_digest, line: line.line_asset_uid, audience: line.audience, target: e.target, ref: e.ref };
    return { kind: `release_${e.target}`, key: `release:${man.manifest_uid}:${e.target}:${e.ref}`, payload };
  });
  const advanceKey = `release-publish:${input.idempotencyKey}`;
  const effectIdsOf = async () => (effectRows.length ? await m.all<{ id: number; idempotency_key: string }>(env.DB.prepare(
    `SELECT id, idempotency_key FROM work_graph_effects
      WHERE tenant_id = ? AND company_id = ? AND idempotency_key IN (SELECT value FROM json_each(?)) ORDER BY id`,
  ).bind(line.tenant_id, line.company_id, JSON.stringify(effectRows.map((e) => e.key)))) : []);

  // A retry of a publication that already happened (a lost or late callback, a redelivered webhook) returns what the
  // first one did and writes nothing; the same key for another manifest, base or effect set is refused.
  const replay = async (): Promise<PublishResult | null> => {
    const ev = await m.first<{ revision_uid: string; base_revision_uid: string | null; head_seq: number }>(env.DB.prepare(
      `SELECT revision_uid, base_revision_uid, head_seq FROM work_graph_events
        WHERE tenant_id = ? AND company_id = ? AND action = 'advance_head' AND idempotency_key = ?`,
    ).bind(line.tenant_id, line.company_id, advanceKey));
    if (!ev) return null;
    const ids = await effectIdsOf();
    if (ev.revision_uid !== man.manifest_uid || ev.base_revision_uid !== input.expectedManifestUid || ids.length !== effectRows.length) {
      return m.refuse('idempotency_conflict', [ev.revision_uid]);
    }
    return {
      ok: true, manifestUid: ev.revision_uid, previousManifestUid: ev.base_revision_uid, headSeq: Number(ev.head_seq), replayed: true,
      effectIds: ids.map((r) => Number(r.id)), cost: { ...m.cost },
    };
  };
  const first = await replay();
  if (first) return first;

  const at = WORK_GRAPH_DEPS.now().toISOString();
  const hash = await hashOf({ op: 'publish', ...input, effects });
  const audited = async (code: ReleaseRefusalCode, ids: string[]): Promise<ReleaseRefusal> => {
    await m.run(env.DB.prepare(
      `INSERT INTO work_graph_events (tenant_id, company_id, project_id, asset_uid, action, actor_kind, actor_user_id,
         agent_run_id, charge_id, base_revision_uid, revision_uid, head_seq, outcome, refusal_code, request_hash, detail_json, created_at)
       VALUES (?, ?, ?, ?, 'advance_refused', ?, ?, ?, ?, ?, ?, ?, 'refused', ?, ?, ?, ?)`,
    ).bind(line.tenant_id, line.company_id, line.project_id, line.line_asset_uid, input.actor.kind, userOf(input.actor),
      runOf(input.actor), input.actor.kind === 'agent' ? input.actor.chargeId : null, input.expectedManifestUid, man.manifest_uid,
      line.head_seq, code, hash, JSON.stringify({ release: true, ids: ids.slice(0, 20) }), at));
    return m.refuse(code, ids);
  };

  let approval: PublishApproval | null = null;
  let repinnedComponents: string[] = [];
  {
    const state = await evaluate(env, m, ctx, man, line);
    // Part 2: content a takedown covers is never published again, under any manifest.
    if (state.takedowns.length) return audited('taken_down', [man.manifest_uid, ...state.takedowns.map((t) => t.revisionUid ?? t.scope)]);
    if (state.status !== 'current') {
      return audited(state.status, state.components.filter((c) => c.status !== 'current').flatMap((c) => [c.asset, c.revision, ...c.reasons]));
    }
    const outside = state.components.find((c) => !AUDIENCE_CLASSES[line.audience].includes(c.access));
    if (outside) return audited('audience_forbidden', [outside.asset, outside.access, line.audience]);
    const unattested = state.components.filter((c) => c.missingAttestations.length);
    if (unattested.length) return audited('attestation_missing', unattested.flatMap((c) => [c.asset, ...c.missingAttestations]));
    if (state.changesRequestedBy.length) return audited('changes_requested', state.changesRequestedBy.map(String));
    if (state.missingApprovals.length) return audited('approval_required', [man.manifest_uid, ...state.missingApprovals]);
    // Effects the package can carry: a PR needs code, a signed document a contract, a website a public audience.
    const profiles = new Set(state.components.flatMap((c) => c.profiles));
    const badTarget = effects.find((e) => (e.target === 'github_pr' && !profiles.has('code'))
      || (e.target === 'signed_document' && !profiles.has('contract'))
      || (e.target === 'website_cdn' && line.audience !== 'public'));
    if (badTarget) return audited('effect_target', [badTarget.target, badTarget.ref]);

    // D5579's release check: each pinned component's bytes were approved by a person when they became its head.
    const comp = await m.all<{ revision_uid: string; approval_ref: string; approval_digest: string; approver_user_id: number }>(env.DB.prepare(
      `SELECT revision_uid, approval_ref, approval_digest, approver_user_id FROM work_graph_events
        WHERE tenant_id = ? AND company_id = ? AND action = 'advance_head' AND outcome = 'applied' AND approval_ref IS NOT NULL
          AND approver_user_id IS NOT NULL AND revision_uid IN (SELECT value FROM json_each(?))
        ORDER BY id`,
    ).bind(line.tenant_id, line.company_id, JSON.stringify(state.components.map((c) => c.revision))));
    const scope = scopeOf(man);
    const reviewer: Actor = { kind: 'person', userId: 1 };
    const graph: WorkGraph = {
      assets: state.components.map((c): Asset => ({ id: c.asset, scope, kind: c.kind, headVersionId: null, accessClass: c.access, approvalPolicy: 'release' })),
      versions: state.components.map((c): ArtifactVersion => ({
        id: c.revision, assetId: c.asset, scope, parents: [], digest: c.digest, byteLength: 0, mediaProfile: 'x', source: c.source,
        recipe: null, residency: null, license: null, author: reviewer, createdAt: at, expiresAt: null,
      })),
      workItems: [{ id: 'release', scope, deliverableAssetId: state.components[0].asset, modifies: [], baseVersionId: null, dependsOn: [], author: reviewer, priority: 0, risk: 'low', idempotencyKey: 'release' }],
      changeSets: state.components.map((c) => ({
        id: `cs:${c.revision}`, scope, workItemId: 'release', assetId: c.asset, baseVersionId: null, proposedDigest: c.digest,
        components: [], author: reviewer, idempotencyKey: c.revision,
      })),
      reviews: comp.map((a, i): ReviewDecision => ({
        id: `ap:${i}`, scope, changeSetId: `cs:${a.revision_uid}`, contentDigest: a.approval_digest, decision: 'approve',
        reviewer: { kind: 'person', userId: a.approver_user_id }, approvalRef: a.approval_ref, decidedAt: at,
      })),
      releases: [{
        id: man.manifest_uid, scope, components: state.components.map((c) => ({ assetId: c.asset, versionId: c.revision, digest: c.digest })),
        approvalIds: comp.map((_, i) => `ap:${i}`), expectedPreviousId: null, idempotencyKey: input.idempotencyKey,
      }],
    };
    // Sources were admitted when each revision was written, and signed evidence is never edited by this check.
    const v = validateWorkGraph(graph, ctx).filter((x) => x.code !== 'authority_violation' && x.code !== 'immutable_record');
    if (v.length) return audited(v[0].code, v[0].ids);

    if (effects.length) {
      const q = await m.first<{ n: number }>(env.DB.prepare(
        `SELECT COUNT(*) AS n FROM work_graph_effects WHERE tenant_id = ? AND state IN ('pending', 'claimed')`,
      ).bind(line.tenant_id));
      if (Number(q?.n ?? 0) + effects.length > WORK_GRAPH_EFFECT_LIMITS.maxPendingPerTenant) return audited('queue_full', [String(WORK_GRAPH_EFFECT_LIMITS.maxPendingPerTenant)]);
    }
    approval = state.approvals[0];
    // Every component of a re-pin was pinned by a manifest this line published; the CAS exempts them from being heads.
    if (state.repinOf) repinnedComponents = state.components.map((c) => c.revision);
  }

  const effectHashes = await Promise.all(effectRows.map((e) => hashOf({ kind: e.kind, asset: line.line_asset_uid, payload: e.payload })));
  const nowMs = WORK_GRAPH_DEPS.now().getTime();
  const res = await advanceHead(env, ctx, {
    assetUid: line.line_asset_uid, expectedRevisionUid: input.expectedManifestUid, revisionUid: man.manifest_uid, actor: input.actor,
    approval: approval ? { ref: approval.approvalRef, contentDigest: man.manifest_digest, reviewer: { kind: 'person', userId: approval.reviewerUserId }, decidedAt: approval.decidedAt } : null,
    idempotencyKey: advanceKey,
  }, {
    repinnedComponents,
    afterSwap: (swap) => effectRows.flatMap((e, i) => [
      env.DB.prepare(
        `INSERT INTO work_graph_effects (tenant_id, company_id, asset_uid, effect_kind, idempotency_key, request_hash, payload_json,
           max_attempts, next_attempt_ms, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM work_graph_events WHERE tenant_id = ? AND company_id = ? AND action = 'advance_head'
                          AND idempotency_key = ? AND request_hash = ? AND outcome = 'applied')
         ON CONFLICT (tenant_id, company_id, idempotency_key) DO NOTHING`,
      ).bind(line.tenant_id, line.company_id, line.line_asset_uid, e.kind, e.key, effectHashes[i], canonical(e.payload),
        WORK_GRAPH_EFFECT_LIMITS.maxAttempts, nowMs, swap.at, line.tenant_id, line.company_id, swap.idempotencyKey, swap.requestHash),
      env.DB.prepare(
        `INSERT INTO work_graph_integrity_events (tenant_id, company_id, asset_uid, revision_uid, digest, effect_id, action, outcome,
           actor_kind, actor_user_id, agent_run_id, detail_json, created_at)
         SELECT ?, ?, ?, ?, ?, f.id, 'effect_enqueued', 'applied', ?, ?, ?, ?, ?
           FROM work_graph_effects f WHERE f.tenant_id = ? AND f.company_id = ? AND f.idempotency_key = ? AND changes() > 0`,
      ).bind(line.tenant_id, line.company_id, line.line_asset_uid, man.manifest_uid, man.manifest_digest, input.actor.kind,
        userOf(input.actor), runOf(input.actor), JSON.stringify({ release: true, target: e.payload.target }), swap.at,
        line.tenant_id, line.company_id, e.key),
    ]),
  });
  m.fold(res.cost);
  if (!res.ok) {
    // Two deliveries of one publication at once: the loser's swap is refused, and the winner's result is the answer.
    const raced = await replay();
    if (raced) return raced;
    return m.refuse(res.code, res.ids, res.currentHead ? { currentHead: res.currentHead } : {});
  }
  const ids = await effectIdsOf();
  return {
    ok: true, manifestUid: res.revisionUid, previousManifestUid: res.previousRevisionUid, headSeq: res.headSeq, replayed: res.replayed,
    effectIds: ids.map((r) => Number(r.id)), cost: { ...m.cost },
  };
}
