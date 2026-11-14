/**
 * D5579 (#5579, WorkGraph P0 under the #5577 epic) — the versioned WorkGraph contracts and their validator: the
 * shapes `WorkItem`, `Asset`, `SourceRef`, `ArtifactVersion`, `ChangeSet`, `ComponentRef`, `ReviewDecision` and
 * `ReleaseManifest`, the authority matrix that says which store is canonical for each asset kind, and one pure
 * check that refuses a graph which would overwrite, mix or misattribute work.
 *
 * WHAT THIS IS NOT. No table, no route, no D1 or R2 call. #5581 owns the revision DAG storage, leases and the CAS
 * head; the domain adapters (#5582 documents/pitch/offers/legal, #5583 media, #5584 video) map their own tables
 * onto these shapes. The existing records stay canonical (D5579 §2): this module only names them.
 *
 * WHAT IT REFUSES (`validateWorkGraph`), each with a fixed code and the ids involved, never a guess:
 *   wrong_tenant            a record outside the caller's tenant/company scope
 *   duplicate_id            two records of one type with one id
 *   unknown_reference       a record names an id the graph does not hold
 *   stale_revision          a ChangeSet whose base is not its asset's current head
 *   cyclic_dependency       a WorkItem dependency cycle, or a version that is its own ancestor
 *   revoked_author          a record written by a revoked person or agent run
 *   digest_mismatch         a version's declared digest is not its bytes' digest (`verifyVersionBytes`)
 *   external_source_changed a version cut from an external revision that is no longer the remote's current one
 *   authority_violation     a version whose source is not the canonical store for its asset kind
 *   immutable_record        a ChangeSet against signed legal evidence or a released manifest
 *   agent_review            a ReviewDecision by an agent: approval is a person's (D4554 §4)
 *   stale_approval          an approval whose content digest is not the ChangeSet it approves
 *   unpinned_component      a ReleaseManifest component whose digest is not the version it names
 *   unapproved_release      a ReleaseManifest component with no approval of its exact content
 *
 * Every digest is lowercase hex SHA-256 of the exact bytes (64 characters). A Git SHA is a source revision, not a
 * WorkGraph digest.
 */

export const WORKGRAPH_CONTRACT_VERSION = 1 as const;

/** Where a WorkGraph record lives. `projectId` is null for company-wide assets (a brand master, a template). */
export interface Scope {
  tenantId: number;
  companyId: number;
  projectId: number | null;
}

/** Who wrote a record. An agent always carries its run; a person never does. */
export type Actor =
  | { kind: 'person'; userId: number }
  | { kind: 'agent'; agentRunId: string; onBehalfOfUserId: number; chargeId: string | null };

export const ASSET_KINDS = [
  'code', 'legal_template', 'legal_signed', 'document', 'pitch_deck', 'offer', 'brand', 'image', 'video',
  'audio', 'model_3d', 'composite',
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/**
 * The store a source revision is read from. `r2_object` is immutable bytes, never an editor; `d1_record` is a row
 * in an existing domain table (named in `table`), never a blob store.
 */
export const SOURCE_STORES = [
  'git', 'd1_record', 'r2_object', 'esign_envelope', 'stream', 'external_editor',
] as const;
export type SourceStore = (typeof SOURCE_STORES)[number];

export interface SourceRef {
  store: SourceStore;
  /** git: `owner/repo`; d1_record: table name; r2_object: bucket binding; esign_envelope: provider; external_editor: connector. */
  locator: string;
  /** The record's id within the locator: a path, a row id, an object key, an envelope or document id. */
  id: string;
  /** The revision at the source: a 40-hex Git SHA, a row revision, an object digest, a connector revision id. */
  revision: string;
}

/**
 * The canonical store per asset kind (D5579 §2). A version whose source is not in its kind's list is refused.
 * `external_editor` is allowed only where the matrix declares an external editing mode.
 */
export const AUTHORITY: Readonly<Record<AssetKind, readonly SourceStore[]>> = Object.freeze({
  code: ['git'],
  legal_template: ['d1_record'],
  legal_signed: ['esign_envelope'],
  document: ['d1_record', 'external_editor'],
  pitch_deck: ['d1_record', 'external_editor'],
  offer: ['d1_record'],
  brand: ['d1_record', 'r2_object', 'external_editor'],
  image: ['r2_object', 'external_editor'],
  video: ['r2_object', 'stream'],
  audio: ['r2_object'],
  model_3d: ['r2_object', 'external_editor'],
  composite: ['d1_record'],
});

/** Kinds whose records never take a ChangeSet once they exist: signed evidence is appended to, never edited. */
export const IMMUTABLE_KINDS: ReadonlySet<AssetKind> = new Set<AssetKind>(['legal_signed']);

export const ACCESS_CLASSES = ['public', 'internal', 'confidential', 'restricted'] as const;
export type AccessClass = (typeof ACCESS_CLASSES)[number];

export interface Asset {
  id: string;
  scope: Scope;
  kind: AssetKind;
  /** The accepted head version, or null before the first accepted version. #5581 advances it by CAS. */
  headVersionId: string | null;
  accessClass: AccessClass;
  /** A policy name the approval inbox knows; `human_publication` for legal, money and released material. */
  approvalPolicy: string;
  /** A released manifest pins this asset: further ChangeSets are refused until a new release line starts. */
  released?: boolean;
}

export interface ArtifactVersion {
  id: string;
  assetId: string;
  scope: Scope;
  /** Parent version ids: none for a first version, one for an edit, two or more for a merge. */
  parents: string[];
  digest: string;
  byteLength: number;
  mediaProfile: string;
  source: SourceRef;
  /** Model, settings, seed or edit recipe, where the version was generated. */
  recipe: string | null;
  residency: string | null;
  license: string | null;
  author: Actor;
  createdAt: string;
  expiresAt: string | null;
}

/** A structured unit inside an asset: a section, clause, slide, shape, layer, timeline range or scene node. */
export interface ComponentRef {
  assetId: string;
  versionId: string;
  unit: { kind: string; id: string } | null;
}

export interface ChangeSet {
  id: string;
  scope: Scope;
  workItemId: string;
  assetId: string;
  baseVersionId: string | null;
  /** Digest of the proposed content: the version this ChangeSet would become. */
  proposedDigest: string;
  components: ComponentRef[];
  author: Actor;
  idempotencyKey: string;
}

export interface ReviewDecision {
  id: string;
  scope: Scope;
  changeSetId: string;
  /** The exact content approved. An approval of other bytes is stale. */
  contentDigest: string;
  decision: 'approve' | 'reject' | 'request_changes';
  reviewer: Actor;
  /** The approval-inbox item this decision came from (reuse, not a second inbox). */
  approvalRef: string | null;
  decidedAt: string;
}

export interface ReleaseManifest {
  id: string;
  scope: Scope;
  components: { assetId: string; versionId: string; digest: string }[];
  approvalIds: string[];
  /** The manifest pointer this release expects to replace (#5581 CAS). */
  expectedPreviousId: string | null;
  idempotencyKey: string;
}

export type RiskLevel = 'low' | 'medium' | 'high';

export interface WorkItem {
  id: string;
  scope: Scope;
  deliverableAssetId: string;
  /** The units it proposes to modify; overlap detection reads these (#5580, #5581). */
  modifies: ComponentRef[];
  baseVersionId: string | null;
  dependsOn: string[];
  author: Actor;
  priority: number;
  risk: RiskLevel;
  idempotencyKey: string;
}

export interface WorkGraph {
  workItems?: WorkItem[];
  assets?: Asset[];
  versions?: ArtifactVersion[];
  changeSets?: ChangeSet[];
  reviews?: ReviewDecision[];
  releases?: ReleaseManifest[];
}

/** What the caller resolved before validating: its scope, and what it knows of revocations and remotes. */
export interface ValidationContext {
  scope: Scope;
  revokedUserIds?: ReadonlySet<number>;
  revokedAgentRunIds?: ReadonlySet<string>;
  /** Current remote revision by `store:locator:id`, as the connector last read it. Absent means not checked. */
  externalHeads?: ReadonlyMap<string, string>;
}

export type ViolationCode =
  | 'wrong_tenant' | 'duplicate_id' | 'unknown_reference' | 'stale_revision' | 'cyclic_dependency'
  | 'revoked_author' | 'digest_mismatch' | 'external_source_changed' | 'authority_violation'
  | 'immutable_record' | 'agent_review' | 'stale_approval' | 'unpinned_component' | 'unapproved_release'
  | 'malformed';

export interface Violation {
  code: ViolationCode;
  record: string;
  ids: string[];
}

const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;

export function sourceKey(ref: SourceRef): string {
  return `${ref.store}:${ref.locator}:${ref.id}`;
}

function sameScope(a: Scope, b: Scope): boolean {
  // A company-wide caller scope (projectId null) covers that company's projects; a project caller sees only its own.
  return a.tenantId === b.tenantId && a.companyId === b.companyId
    && (a.projectId === null || a.projectId === b.projectId);
}

function revoked(actor: Actor, ctx: ValidationContext): boolean {
  if (actor.kind === 'person') return ctx.revokedUserIds?.has(actor.userId) ?? false;
  return (ctx.revokedAgentRunIds?.has(actor.agentRunId) ?? false)
    || (ctx.revokedUserIds?.has(actor.onBehalfOfUserId) ?? false);
}

function findCycle(edges: Map<string, string[]>): string[] | null {
  const state = new Map<string, 1 | 2>();
  const path: string[] = [];
  const visit = (n: string): string[] | null => {
    const s = state.get(n);
    if (s === 2) return null;
    if (s === 1) return path.slice(path.indexOf(n)).concat(n);
    state.set(n, 1); path.push(n);
    for (const m of edges.get(n) ?? []) {
      if (!edges.has(m)) continue;
      const c = visit(m);
      if (c) return c;
    }
    path.pop(); state.set(n, 2);
    return null;
  };
  for (const n of edges.keys()) {
    const c = visit(n);
    if (c) return c;
  }
  return null;
}

/**
 * Check a WorkGraph slice against the contract. Returns every violation found, in a stable order; an empty list
 * means the slice may be admitted. Pure: it reads nothing and writes nothing.
 */
export function validateWorkGraph(graph: WorkGraph, ctx: ValidationContext): Violation[] {
  const out: Violation[] = [];
  const add = (code: ViolationCode, record: string, ...ids: string[]) => out.push({ code, record, ids });

  const index = <T extends { id: string }>(record: string, list: T[] | undefined): Map<string, T> => {
    const m = new Map<string, T>();
    for (const r of list ?? []) {
      if (typeof r.id !== 'string' || !r.id) { add('malformed', record, String(r.id)); continue; }
      if (m.has(r.id)) add('duplicate_id', record, r.id);
      else m.set(r.id, r);
    }
    return m;
  };
  const workItems = index('WorkItem', graph.workItems);
  const assets = index('Asset', graph.assets);
  const versions = index('ArtifactVersion', graph.versions);
  const changeSets = index('ChangeSet', graph.changeSets);
  const reviews = index('ReviewDecision', graph.reviews);
  const releases = index('ReleaseManifest', graph.releases);

  const scoped: [string, Map<string, { id: string; scope: Scope }>][] = [
    ['WorkItem', workItems], ['Asset', assets], ['ArtifactVersion', versions], ['ChangeSet', changeSets],
    ['ReviewDecision', reviews], ['ReleaseManifest', releases],
  ];
  for (const [record, m] of scoped) {
    for (const r of m.values()) if (!sameScope(ctx.scope, r.scope)) add('wrong_tenant', record, r.id);
  }

  // Assets and versions.
  for (const a of assets.values()) {
    if (!(ASSET_KINDS as readonly string[]).includes(a.kind)) add('malformed', 'Asset', a.id);
    if (a.headVersionId !== null && !versions.has(a.headVersionId)) add('unknown_reference', 'Asset', a.id, a.headVersionId);
  }
  const parentEdges = new Map<string, string[]>();
  for (const v of versions.values()) {
    const asset = assets.get(v.assetId);
    if (!asset) add('unknown_reference', 'ArtifactVersion', v.id, v.assetId);
    else if (!sameScope(asset.scope, v.scope)) add('wrong_tenant', 'ArtifactVersion', v.id, asset.id);
    if (!HEX64.test(v.digest)) add('malformed', 'ArtifactVersion', v.id);
    if (asset && !AUTHORITY[asset.kind]?.includes(v.source.store)) add('authority_violation', 'ArtifactVersion', v.id, asset.kind, v.source.store);
    if (v.source.store === 'git' && !HEX40.test(v.source.revision)) add('malformed', 'ArtifactVersion', v.id);
    if (v.source.store === 'external_editor') {
      const head = ctx.externalHeads?.get(sourceKey(v.source));
      if (head !== undefined && head !== v.source.revision) add('external_source_changed', 'ArtifactVersion', v.id, v.source.revision, head);
    }
    if (revoked(v.author, ctx)) add('revoked_author', 'ArtifactVersion', v.id);
    for (const p of v.parents) {
      const pv = versions.get(p);
      if (!pv) add('unknown_reference', 'ArtifactVersion', v.id, p);
      else if (pv.assetId !== v.assetId) add('unknown_reference', 'ArtifactVersion', v.id, p);
    }
    parentEdges.set(v.id, v.parents);
  }
  const versionCycle = findCycle(parentEdges);
  if (versionCycle) add('cyclic_dependency', 'ArtifactVersion', ...versionCycle);

  // Work items.
  const depEdges = new Map<string, string[]>();
  for (const w of workItems.values()) {
    if (!assets.has(w.deliverableAssetId)) add('unknown_reference', 'WorkItem', w.id, w.deliverableAssetId);
    for (const d of w.dependsOn) if (!workItems.has(d)) add('unknown_reference', 'WorkItem', w.id, d);
    if (revoked(w.author, ctx)) add('revoked_author', 'WorkItem', w.id);
    depEdges.set(w.id, w.dependsOn);
  }
  const workCycle = findCycle(depEdges);
  if (workCycle) add('cyclic_dependency', 'WorkItem', ...workCycle);

  // ChangeSets.
  for (const c of changeSets.values()) {
    const asset = assets.get(c.assetId);
    if (!asset) { add('unknown_reference', 'ChangeSet', c.id, c.assetId); continue; }
    if (!workItems.has(c.workItemId)) add('unknown_reference', 'ChangeSet', c.id, c.workItemId);
    if (IMMUTABLE_KINDS.has(asset.kind) || asset.released) add('immutable_record', 'ChangeSet', c.id, asset.id);
    if (c.baseVersionId !== asset.headVersionId) add('stale_revision', 'ChangeSet', c.id, String(c.baseVersionId), String(asset.headVersionId));
    if (!HEX64.test(c.proposedDigest)) add('malformed', 'ChangeSet', c.id);
    if (revoked(c.author, ctx)) add('revoked_author', 'ChangeSet', c.id);
    for (const comp of c.components) {
      const cv = versions.get(comp.versionId);
      if (!cv || cv.assetId !== comp.assetId) add('unknown_reference', 'ChangeSet', c.id, comp.versionId);
    }
  }

  // Reviews: a person decides, about exact bytes.
  const approvedDigests = new Map<string, Set<string>>(); // assetId -> approved digests
  for (const r of reviews.values()) {
    const c = changeSets.get(r.changeSetId);
    if (!c) { add('unknown_reference', 'ReviewDecision', r.id, r.changeSetId); continue; }
    if (r.reviewer.kind !== 'person') add('agent_review', 'ReviewDecision', r.id);
    if (revoked(r.reviewer, ctx)) add('revoked_author', 'ReviewDecision', r.id);
    if (r.contentDigest !== c.proposedDigest) { add('stale_approval', 'ReviewDecision', r.id, c.id); continue; }
    if (r.decision === 'approve' && r.reviewer.kind === 'person' && !revoked(r.reviewer, ctx)) {
      if (!approvedDigests.has(c.assetId)) approvedDigests.set(c.assetId, new Set());
      approvedDigests.get(c.assetId)!.add(r.contentDigest);
    }
  }

  // Releases pin exact, approved bytes.
  for (const m of releases.values()) {
    for (const comp of m.components) {
      const v = versions.get(comp.versionId);
      if (!v || v.assetId !== comp.assetId) { add('unknown_reference', 'ReleaseManifest', m.id, comp.versionId); continue; }
      if (v.digest !== comp.digest) add('unpinned_component', 'ReleaseManifest', m.id, comp.versionId);
      if (!approvedDigests.get(comp.assetId)?.has(v.digest)) add('unapproved_release', 'ReleaseManifest', m.id, comp.versionId);
    }
    for (const a of m.approvalIds) if (!reviews.has(a)) add('unknown_reference', 'ReleaseManifest', m.id, a);
    if (m.expectedPreviousId !== null && !releases.has(m.expectedPreviousId)) add('unknown_reference', 'ReleaseManifest', m.id, m.expectedPreviousId);
  }

  return out;
}

/** Lowercase hex SHA-256 of the bytes. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Check a version's declared digest and length against the bytes actually read back (from R2, a render or an
 * upload). Returns `digest_mismatch` on any difference, so a partial upload or a swapped object is never accepted.
 */
export async function verifyVersionBytes(version: ArtifactVersion, bytes: Uint8Array): Promise<Violation | null> {
  const actual = await sha256Hex(bytes);
  if (actual !== version.digest || bytes.byteLength !== version.byteLength) {
    return { code: 'digest_mismatch', record: 'ArtifactVersion', ids: [version.id, actual] };
  }
  return null;
}
