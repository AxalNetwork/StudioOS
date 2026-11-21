/**
 * D5585 part 2 (#5585, WorkGraph P1 under the #5577 epic) — revocation and takedown of published releases with
 * retention, re-pointing a line to an earlier manifest by a forward re-pin, and what a line may serve. Preview-only:
 * no route, no binding, no flag. Decision: `documentation/architecture/decisions/D5585-p2.md`.
 *
 * TAKEDOWN (`takedownRelease`). A person with the authority takes down one release (a manifest) or one component
 * revision at its digest, wherever it is pinned, naming the release identity they saw (manifest and digest), a reason
 * code and the evidence. One batch writes the takedown row and a `release_retract` outbox effect for every confirmed
 * delivery of content it covers. A takedown is permanent and deletes nothing: the manifest, its decisions, attestations,
 * revisions and audit stay (retention), and `releaseStatus` keeps showing them with the takedown. What changes is what
 * may go out: `servedRelease` serves nothing a takedown covers, `publishRelease` refuses it (`taken_down`), a re-pin
 * refuses it, and a delivery handler withholds it. Refusals are recorded in the same table (`outcome = 'refused'`).
 *
 * RE-PIN (`repinRelease`). #5581's head only moves forward: the CAS takes a revision whose parent is the current
 * head, never an older revision. So re-pointing a line to an earlier manifest is a NEW manifest revision, cut on the
 * current one, whose body re-pins the earlier manifest's component revisions (`repin` names it). Those revisions are
 * usually no longer their assets' heads; `createRevision` and `advanceHead` accept them only as named
 * `repinnedComponents`, and only for a composite's component edges. The re-pin owes everything a manifest owes: a
 * publish approval of ITS digest, its components' attestations (the same revisions keep theirs) and publication by the
 * CAS from the head it was cut on. Only a manifest the line actually published, that is not the head and that no
 * takedown covers, may be re-pinned.
 *
 * SERVING (`servedRelease`). The manifest the pointer names, unless a takedown covers it or one of its pinned
 * revisions is tombstoned: then nothing is served and the reason is given. It never falls back to an older manifest on
 * its own; a person re-pins one.
 */
import type { Env } from '../types';
import { sha256Hex, type Actor, type AccessClass, type AssetKind, type SourceRef } from './workGraphContracts';
import { WORK_GRAPH_DEPS, createRevision, type Cost } from './workGraphRevisions';
import { WORK_GRAPH_EFFECT_LIMITS } from './workGraphEffects';
import {
  AUDIENCE_CLASSES, POLICY_PROFILES, Meter, actorOk, canonical, hashOf, keyOk, outOfScope, profilesFor, readComponents,
  readLine, readManifest, refOk, runOf, scopeOf, takedownsCovering, userOf,
  type Audience, type ManifestBody, type ManifestComponent, type ProfileName, type ReleaseContext, type ReleaseRefusal,
  type ReleaseRefusalCode, type TakedownRef,
} from './workGraphReleases';
import { retractEffect } from './workGraphReleaseDelivery';

export const TAKEDOWN_REASONS = ['rights_withdrawn', 'consent_withdrawn', 'legal_order', 'security', 'inaccurate', 'policy'] as const;
export type TakedownReason = (typeof TAKEDOWN_REASONS)[number];
/** Authorities that may always take content down, besides the approving authorities of the manifest's profiles. */
export const TAKEDOWN_AUTHORITIES: readonly string[] = Object.freeze(['counsel', 'security_officer']);

const HEX64 = /^[0-9a-f]{64}$/;
const ROLE = /^[a-z][a-z0-9_]{0,39}$/;
const MANIFEST_PROFILE = 'application/vnd.studioos.release-manifest+json';

// ---------------------------------------------------------------------------------------------------------------
// Takedown

export interface TakedownInput {
  lineAssetUid: string;
  /** The release identity the person saw: the manifest and its digest. */
  manifestUid: string;
  digest: string;
  /** One pinned component revision at its digest, taken down wherever it is pinned; absent for the whole release. */
  component?: { revisionUid: string; digest: string } | null;
  reasonCode: TakedownReason;
  /** Where the reason is recorded: a rights notice, an order, a ticket. Ids only. */
  evidenceRef: string;
  authority: string;
  actor: Actor;
  idempotencyKey: string;
}
export type TakedownResult =
  | { ok: true; takedownId: number; changed: boolean; replayed: boolean; retractEffectIds: number[]; cost: Cost }
  | ReleaseRefusal;

export async function takedownRelease(env: Pick<Env, 'DB'>, ctx: ReleaseContext, input: TakedownInput): Promise<TakedownResult> {
  const m = new Meter(env);
  const comp = input?.component ?? null;
  if (!keyOk(input?.idempotencyKey) || !actorOk(input.actor) || typeof input.lineAssetUid !== 'string' || typeof input.manifestUid !== 'string'
    || !HEX64.test(String(input.digest)) || !(TAKEDOWN_REASONS as readonly string[]).includes(input.reasonCode) || !refOk(input.evidenceRef)
    || typeof input.authority !== 'string' || !ROLE.test(input.authority)
    || (comp !== null && (typeof comp !== 'object' || typeof comp.revisionUid !== 'string' || comp.revisionUid.length > 80 || !HEX64.test(String(comp.digest))))) {
    return m.refuse('malformed', [String(input?.manifestUid)]);
  }
  const line = await readLine(env, m, input.lineAssetUid);
  if (!line) return m.refuse('not_found', [input.lineAssetUid]);
  const man = await readManifest(env, m, input.manifestUid);
  if (!man || man.line_asset_uid !== line.line_asset_uid) return m.refuse('unknown_reference', [line.line_asset_uid, input.manifestUid]);

  const hash = await hashOf({ op: 'takedown', ...input, component: comp });
  const at = WORK_GRAPH_DEPS.now().toISOString();
  const scopeKind = comp ? 'component' : 'manifest';
  /** A refusal, recorded against the line's own tenant, with the actor who asked (another tenant's too). */
  const audited = async (code: ReleaseRefusalCode, ids: string[]): Promise<ReleaseRefusal> => {
    await m.run(env.DB.prepare(
      `INSERT INTO work_graph_release_takedowns (tenant_id, company_id, project_id, line_asset_uid, manifest_uid, manifest_digest,
         scope, revision_uid, digest, reason_code, evidence_ref, authority, actor_kind, actor_user_id, agent_run_id, outcome,
         refusal_code, request_hash, d1_statements, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'refused', ?, ?, ?, ?)`,
    ).bind(line.tenant_id, line.company_id, line.project_id, line.line_asset_uid, man.manifest_uid, man.manifest_digest, scopeKind,
      comp?.revisionUid ?? null, comp?.digest ?? null, input.reasonCode, input.evidenceRef, input.authority, input.actor.kind,
      userOf(input.actor), runOf(input.actor), code, hash, m.cost.d1Statements + 1, at));
    return m.refuse(code, ids);
  };
  if (outOfScope(ctx, scopeOf(line))) return audited('wrong_tenant', [line.line_asset_uid]);

  const byKey = async () => m.first<{ id: number; request_hash: string }>(env.DB.prepare(
    'SELECT id, request_hash FROM work_graph_release_takedowns WHERE tenant_id = ? AND company_id = ? AND idempotency_key = ?',
  ).bind(line.tenant_id, line.company_id, input.idempotencyKey));
  const keysOf = (keys: string[]) => (keys.length ? m.all<{ id: number }>(env.DB.prepare(
    `SELECT id FROM work_graph_effects WHERE tenant_id = ? AND company_id = ? AND idempotency_key IN (SELECT value FROM json_each(?)) ORDER BY id`,
  ).bind(line.tenant_id, line.company_id, JSON.stringify(keys))) : Promise.resolve([]));
  const prior = await byKey();
  if (prior) {
    if (prior.request_hash !== hash) return m.refuse('idempotency_conflict', [String(prior.id)]);
    return { ok: true, takedownId: prior.id, changed: false, replayed: true, retractEffectIds: [], cost: { ...m.cost } };
  }

  // A person, with standing, about the exact release they saw.
  if (input.actor.kind !== 'person') return audited('person_required', [man.manifest_uid]);
  if (ctx.revokedUserIds?.has(input.actor.userId)) return audited('revoked_author', [man.manifest_uid]);
  if (input.digest !== man.manifest_digest) return audited('stale_approval', [man.manifest_uid, input.digest]);
  const body = JSON.parse(man.body_json) as ManifestBody;
  if (comp) {
    const pinned = body.components.find((c) => c.revision === comp.revisionUid);
    if (!pinned) return audited('unknown_reference', [man.manifest_uid, comp.revisionUid]);
    if (pinned.digest !== comp.digest) return audited('stale_approval', [comp.revisionUid, comp.digest]);
  }
  const allowed = new Set([...TAKEDOWN_AUTHORITIES, ...body.components.flatMap((c) => c.profiles.flatMap((p) => POLICY_PROFILES[p].authorities))]);
  if (!allowed.has(input.authority) || !(ctx.authorities?.get(input.actor.userId) ?? []).includes(input.authority)) {
    return audited('no_authority', [man.manifest_uid, input.authority]);
  }

  // Already down: the first takedown stands, and nothing is queued twice.
  const covered = await m.first<{ id: number }>(env.DB.prepare(
    `SELECT id FROM work_graph_release_takedowns
      WHERE tenant_id = ? AND company_id = ? AND outcome = 'applied' AND scope = ? AND (scope = 'component' OR manifest_uid = ?)
        AND revision_uid IS ?
      ORDER BY id LIMIT 1`,
  ).bind(line.tenant_id, line.company_id, scopeKind, man.manifest_uid, comp?.revisionUid ?? null));
  if (covered) return { ok: true, takedownId: covered.id, changed: false, replayed: false, retractEffectIds: [], cost: { ...m.cost } };

  // Every confirmed delivery of the content it covers is retracted: the release's, or every release pinning the piece.
  const delivered = comp
    ? await m.all<{ manifest_uid: string; manifest_digest: string; line_asset_uid: string; target: string; target_ref: string }>(env.DB.prepare(
      `SELECT DISTINCT d.manifest_uid, d.manifest_digest, d.line_asset_uid, d.target, d.target_ref FROM work_graph_release_deliveries d
        WHERE d.tenant_id = ? AND d.company_id = ? AND d.op = 'publish' AND d.outcome = 'confirmed'
          AND d.manifest_uid IN (SELECT e.from_revision_uid FROM work_graph_edges e WHERE e.to_revision_uid = ? AND e.edge_kind = 'component')
        ORDER BY d.manifest_uid, d.target, d.target_ref`,
    ).bind(line.tenant_id, line.company_id, comp.revisionUid))
    : await m.all<{ manifest_uid: string; manifest_digest: string; line_asset_uid: string; target: string; target_ref: string }>(env.DB.prepare(
      `SELECT DISTINCT d.manifest_uid, d.manifest_digest, d.line_asset_uid, d.target, d.target_ref FROM work_graph_release_deliveries d
        WHERE d.tenant_id = ? AND d.company_id = ? AND d.op = 'publish' AND d.outcome = 'confirmed' AND d.manifest_uid = ?
        ORDER BY d.target, d.target_ref`,
    ).bind(line.tenant_id, line.company_id, man.manifest_uid));
  const retracts = await Promise.all(delivered.map((d) => retractEffect({
    manifest: d.manifest_uid, digest: d.manifest_digest, line: d.line_asset_uid, target: d.target, ref: d.target_ref,
  })));
  if (retracts.length) {
    const q = await m.first<{ n: number }>(env.DB.prepare(
      `SELECT COUNT(*) AS n FROM work_graph_effects WHERE tenant_id = ? AND state IN ('pending', 'claimed')`,
    ).bind(line.tenant_id));
    if (Number(q?.n ?? 0) + retracts.length > WORK_GRAPH_EFFECT_LIMITS.maxPendingPerTenant) {
      return audited('queue_full', [String(WORK_GRAPH_EFFECT_LIMITS.maxPendingPerTenant)]);
    }
  }

  const nowMs = WORK_GRAPH_DEPS.now().getTime();
  const statements = 1 + retracts.length * 2;
  try {
    await m.batch([
      env.DB.prepare(
        `INSERT INTO work_graph_release_takedowns (tenant_id, company_id, project_id, line_asset_uid, manifest_uid, manifest_digest,
           scope, revision_uid, digest, reason_code, evidence_ref, authority, actor_kind, actor_user_id, agent_run_id, outcome,
           idempotency_key, request_hash, retract_count, d1_statements, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'person', ?, NULL, 'applied', ?, ?, ?, ?, ?)
         ON CONFLICT (tenant_id, company_id, idempotency_key) DO NOTHING`,
      ).bind(line.tenant_id, line.company_id, line.project_id, line.line_asset_uid, man.manifest_uid, man.manifest_digest, scopeKind,
        comp?.revisionUid ?? null, comp?.digest ?? null, input.reasonCode, input.evidenceRef, input.authority, userOf(input.actor),
        input.idempotencyKey, hash, retracts.length, m.cost.d1Statements + statements, at),
      ...retracts.flatMap((r) => [
        // Guarded on this batch's own takedown row, so a retraction is never queued without its takedown.
        env.DB.prepare(
          `INSERT INTO work_graph_effects (tenant_id, company_id, asset_uid, effect_kind, idempotency_key, request_hash, payload_json,
             max_attempts, next_attempt_ms, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM work_graph_release_takedowns WHERE tenant_id = ? AND company_id = ? AND idempotency_key = ?
                            AND request_hash = ? AND outcome = 'applied')
           ON CONFLICT (tenant_id, company_id, idempotency_key) DO NOTHING`,
        ).bind(line.tenant_id, line.company_id, r.payload.line, r.kind, r.key, r.hash, canonical(r.payload),
          WORK_GRAPH_EFFECT_LIMITS.maxAttempts, nowMs, at, line.tenant_id, line.company_id, input.idempotencyKey, hash),
        env.DB.prepare(
          `INSERT INTO work_graph_integrity_events (tenant_id, company_id, asset_uid, revision_uid, digest, effect_id, action, outcome,
             actor_kind, actor_user_id, detail_json, created_at)
           SELECT ?, ?, ?, ?, ?, f.id, 'effect_enqueued', 'applied', 'person', ?, ?, ?
             FROM work_graph_effects f WHERE f.tenant_id = ? AND f.company_id = ? AND f.idempotency_key = ? AND changes() > 0`,
        ).bind(line.tenant_id, line.company_id, r.payload.line, r.payload.manifest, r.payload.digest, userOf(input.actor),
          JSON.stringify({ release: true, retract: r.payload.target, cause: 'takedown' }), at, line.tenant_id, line.company_id, r.key),
      ]),
    ]);
  } catch (e) {
    const raced = await byKey();
    if (!raced) throw e;
  }
  const row = await byKey();
  if (!row) throw new Error('takedown not recorded');
  if (row.request_hash !== hash) return m.refuse('idempotency_conflict', [String(row.id)]);
  const ids = await keysOf(retracts.map((r) => r.key));
  return { ok: true, takedownId: row.id, changed: true, replayed: false, retractEffectIds: ids.map((r) => Number(r.id)), cost: { ...m.cost } };
}

// ---------------------------------------------------------------------------------------------------------------
// Re-pin: re-point a line to an earlier published manifest by a NEW manifest revision, never a backward move

export interface RepinInput { lineAssetUid: string; targetManifestUid: string; author: Actor; idempotencyKey: string }
export type RepinResult =
  | { ok: true; manifestUid: string; digest: string; baseManifestUid: string | null; repinOf: string; replayed: boolean; cost: Cost }
  | ReleaseRefusal;

export async function repinRelease(env: Pick<Env, 'DB'>, ctx: ReleaseContext, input: RepinInput): Promise<RepinResult> {
  const m = new Meter(env);
  if (!keyOk(input?.idempotencyKey) || !actorOk(input.author) || typeof input.lineAssetUid !== 'string' || typeof input.targetManifestUid !== 'string') {
    return m.refuse('malformed', [String(input?.lineAssetUid)]);
  }
  const line = await readLine(env, m, input.lineAssetUid);
  if (!line) return m.refuse('not_found', [input.lineAssetUid]);
  if (outOfScope(ctx, scopeOf(line))) return m.refuse('wrong_tenant', [line.line_asset_uid]);

  const prior = await m.first<{ manifest_uid: string; manifest_digest: string; base_manifest_uid: string | null; body_json: string }>(env.DB.prepare(
    `SELECT manifest_uid, manifest_digest, base_manifest_uid, body_json FROM work_graph_release_manifests
      WHERE tenant_id = ? AND company_id = ? AND idempotency_key = ?`,
  ).bind(line.tenant_id, line.company_id, input.idempotencyKey));
  if (prior) {
    const b = JSON.parse(prior.body_json) as ManifestBody;
    if (b.repin !== input.targetManifestUid || b.line !== line.line_asset_uid) return m.refuse('idempotency_conflict', [prior.manifest_uid]);
    return { ok: true, manifestUid: prior.manifest_uid, digest: prior.manifest_digest, baseManifestUid: prior.base_manifest_uid, repinOf: b.repin, replayed: true, cost: { ...m.cost } };
  }

  const target = await readManifest(env, m, input.targetManifestUid);
  if (!target || target.line_asset_uid !== line.line_asset_uid) return m.refuse('unknown_reference', [line.line_asset_uid, input.targetManifestUid]);
  if (line.head_revision_uid === target.manifest_uid) return m.refuse('is_head', [target.manifest_uid]);
  const published = await m.first<{ id: number }>(env.DB.prepare(
    `SELECT id FROM work_graph_events WHERE tenant_id = ? AND company_id = ? AND asset_uid = ? AND action = 'advance_head'
        AND outcome = 'applied' AND revision_uid = ? LIMIT 1`,
  ).bind(line.tenant_id, line.company_id, line.line_asset_uid, target.manifest_uid));
  if (!published) return m.refuse('not_published', [target.manifest_uid]);
  const down = await takedownsCovering(env, m, line.tenant_id, line.company_id, target.manifest_uid);
  if (down.length) return m.refuse('taken_down', [target.manifest_uid, ...down.map((t) => t.revisionUid ?? t.scope)]);

  const tbody = JSON.parse(target.body_json) as ManifestBody;
  const rows = await readComponents(env, m, tbody.components.map((c) => c.revision));
  const components: ManifestComponent[] = [];
  for (const c of tbody.components) {
    const r = rows.get(c.revision);
    if (!r || r.asset_uid !== c.asset) return m.refuse('unknown_reference', [c.asset, c.revision]);
    if (r.tenant_id !== line.tenant_id || r.company_id !== line.company_id || outOfScope(ctx, scopeOf(r))) return m.refuse('wrong_tenant', [c.asset]);
    if (r.tombstoned_at !== null) return m.refuse('tombstoned', [c.revision]);
    if (r.digest !== c.digest) return m.refuse('unpinned_component', [c.revision, c.digest]);
    const access = r.access_class as AccessClass;
    const kind = r.kind as AssetKind;
    // Re-checked against the line's audience as the asset is classed now, not as it was.
    if (!AUDIENCE_CLASSES[line.audience as Audience].includes(access)) return m.refuse('audience_forbidden', [c.asset, access, line.audience]);
    const profiles = profilesFor(kind, c.profiles[0] as ProfileName, access, r.residency);
    if (!profiles) return m.refuse('policy_profile', [c.asset, kind]);
    components.push({
      asset: c.asset, revision: c.revision, digest: r.digest, kind, role: c.role, access, profiles,
      source: { store: r.source_store as SourceRef['store'], locator: r.source_locator, id: r.source_id, revision: r.source_revision },
    });
  }
  components.sort((a, b) => (a.asset < b.asset ? -1 : a.asset > b.asset ? 1 : 0));

  const base = line.head_revision_uid;
  const body: ManifestBody = { v: 1, line: line.line_asset_uid, audience: line.audience, partial: target.partial === 1, base, components, repin: target.manifest_uid };
  const text = canonical(body);
  const digest = await sha256Hex(new TextEncoder().encode(text));
  const rev = await createRevision(env, ctx, {
    assetUid: line.line_asset_uid, parents: base ? [base] : [], digest, byteLength: new TextEncoder().encode(text).byteLength,
    mediaProfile: MANIFEST_PROFILE, source: { store: 'd1_record', locator: 'work_graph_release_manifests', id: digest, revision: digest },
    author: input.author, idempotencyKey: `release-manifest:${input.idempotencyKey}`,
    dependencies: components.map((c) => ({ kind: 'component' as const, assetUid: c.asset, revisionUid: c.revision })),
  }, undefined, { repinnedComponents: new Set(components.map((c) => c.revision)) });
  m.fold(rev.cost);
  if (!rev.ok) return m.refuse(rev.code, rev.ids, rev.currentHead ? { currentHead: rev.currentHead } : {});
  await m.run(env.DB.prepare(
    `INSERT INTO work_graph_release_manifests (manifest_uid, line_asset_uid, tenant_id, company_id, project_id, audience,
       manifest_digest, base_manifest_uid, partial, component_count, body_json, actor_kind, actor_user_id, agent_run_id,
       idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (manifest_uid) DO NOTHING`,
  ).bind(rev.revisionUid, line.line_asset_uid, line.tenant_id, line.company_id, line.project_id, line.audience, digest, base,
    target.partial, components.length, text, input.author.kind, userOf(input.author), runOf(input.author),
    input.idempotencyKey, WORK_GRAPH_DEPS.now().toISOString()));
  return { ok: true, manifestUid: rev.revisionUid, digest, baseManifestUid: base, repinOf: target.manifest_uid, replayed: rev.replayed, cost: { ...m.cost } };
}

// ---------------------------------------------------------------------------------------------------------------
// Serving

export interface ServedRelease {
  manifestUid: string; digest: string; audience: Audience;
  components: { asset: string; revision: string; digest: string; role: string; kind: AssetKind; source: SourceRef }[];
}
export type ServedResult =
  | { ok: true; served: ServedRelease | null; withheld: { manifestUid: string; takedowns: TakedownRef[]; tombstoned: string[] } | null; headSeq: number; cost: Cost }
  | ReleaseRefusal;

/** What the line may serve now: its published manifest's pinned pieces, or nothing while a takedown covers any of it. */
export async function servedRelease(env: Pick<Env, 'DB'>, ctx: ReleaseContext, lineAssetUid: string): Promise<ServedResult> {
  const m = new Meter(env);
  const line = typeof lineAssetUid === 'string' ? await readLine(env, m, lineAssetUid) : null;
  if (!line) return m.refuse('not_found', [String(lineAssetUid)]);
  if (outOfScope(ctx, scopeOf(line))) return m.refuse('wrong_tenant', [line.line_asset_uid]);
  if (!line.head_revision_uid) return { ok: true, served: null, withheld: null, headSeq: line.head_seq, cost: { ...m.cost } };
  const man = await readManifest(env, m, line.head_revision_uid);
  if (!man) return m.refuse('not_found', [line.head_revision_uid]);
  const body = JSON.parse(man.body_json) as ManifestBody;
  const takedowns = await takedownsCovering(env, m, man.tenant_id, man.company_id, man.manifest_uid);
  const rows = await readComponents(env, m, body.components.map((c) => c.revision));
  const tombstoned = body.components.filter((c) => rows.get(c.revision)?.tombstoned_at !== null).map((c) => c.revision);
  if (takedowns.length || tombstoned.length) {
    return { ok: true, served: null, withheld: { manifestUid: man.manifest_uid, takedowns, tombstoned }, headSeq: line.head_seq, cost: { ...m.cost } };
  }
  return {
    ok: true, withheld: null, headSeq: line.head_seq, cost: { ...m.cost },
    served: {
      manifestUid: man.manifest_uid, digest: man.manifest_digest, audience: man.audience,
      components: body.components.map((c) => ({ asset: c.asset, revision: c.revision, digest: c.digest, role: c.role, kind: c.kind, source: c.source })),
    },
  };
}
