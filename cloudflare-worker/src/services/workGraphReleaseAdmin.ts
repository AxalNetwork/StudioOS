/**
 * D5585 part 7 (#5585, WorkGraph P1 under the #5577 epic) — what the Super-Admin release routes
 * (`routes/admin_work_graph_releases.ts`) read, the context they act in, and the scheduled release drain. Both are OFF
 * by default, as the owner asked (2026-11-21): the routes answer only while `WORK_GRAPH_RELEASE_ADMIN` is exactly `on`,
 * and the drain (scheduled or manual) delivers only while `WORK_GRAPH_RELEASE_DELIVERY` is exactly `preview` (part 3).
 * Neither is set in `wrangler.toml`; the owner sets them. Decision: `documentation/architecture/decisions/D5585-p7.md`.
 *
 * THE CONTEXT. A Super Admin acts in the one tenant and company the request names (`releaseAdminContext`), so a line or
 * manifest of any other scope is refused `wrong_tenant` by the part 1 and part 2 services, exactly as for any caller.
 * Release authorities (`maintainer`, `brand_owner`, `counsel`, `security_officer`…) are resolved by
 * `RELEASE_ADMIN_DEPS.authorities`, which reads part 8's per-company store (`workGraphReleaseAuthorities.ts`, the
 * owner's answer A to D5585-p7 §3): every person of the scope who holds a grant there and is still linked to the
 * company. Being a Super Admin grants no release authority by itself: a Super Admin holds one only where one was
 * granted to them, like anyone else, so with no grant an approval counts for nobody and a takedown is refused
 * `no_authority` (and recorded). Part 9 (D5585-p9) also resolves `revokedUserIds`: the scope's people whose account is
 * revoked (`users.is_active = 0`): their approvals stop counting, and they cannot decide, attest or act. Tests may
 * replace either.
 *
 * THE SCHEDULE. `scheduledReleaseDrain` runs from the existing every-minute cron (`index.ts` `scheduled()`, on minutes
 * where `% 5 === 2`), inside that tick's queue lease. Off, it returns null before touching D1. On, it runs ONE bounded
 * drain (`RELEASE_DRAIN_LIMITS.scheduled` effects) through the real adapters. Overlap is safe without a second lock:
 * every delivery first takes the outbox's own claim on its effect (`deliverEffect`), so two drains that overlap (a slow
 * tick and the next, or a manual drain beside a scheduled one) split the due effects and never deliver one twice.
 *
 * COST. Every read here carries `cost: { d1Statements, d1Batches }`. The drain's summary carries the outbox's D1 cost
 * and the provider requests by target; the cron row records it, and each delivery row keeps its own.
 */
import type { Env } from '../types';
import type { Scope } from './workGraphContracts';
import { swarmSnapshotFor } from './agents/workspaceAdmissionClient';
import type { Cost } from './workGraphRevisions';
import { EFFECT_TARGETS, Meter, type ReleaseContext } from './workGraphReleases';
import { RELEASE_RETRACT_KIND } from './workGraphReleaseDelivery';
import { drainReleaseEffects, releaseDeliveryEnabled, type ReleaseDrainResult } from './workGraphReleaseAdapters';
import type { ReleaseDistributionChannels } from './workGraphReleaseDistribution';
import type { DeliveryStatus } from './workGraphEffects';
import { releaseAuthoritiesForScope, revokedReleaseUsers } from './workGraphReleaseAuthorities';
import type { SwarmState } from './agents/swarmAdmission';
import { UNNAMED, lineNameFields, lineNamesOf } from './workGraphReleaseLineNames';

/** The value of `WORK_GRAPH_RELEASE_ADMIN` that turns the routes on. Unset, or anything else, is off. */
export const RELEASE_ADMIN_ON = 'on';
export const releaseAdminEnabled = (env: Pick<Env, 'WORK_GRAPH_RELEASE_ADMIN'>) => env.WORK_GRAPH_RELEASE_ADMIN === RELEASE_ADMIN_ON;

/** Our sentence for each refusal code the release services send (the admin routes and part 10's reviewer routes). */
export const RELEASE_REFUSAL_SENTENCES: Readonly<Record<string, string>> = Object.freeze({
  malformed: 'The request is missing a field or has one in the wrong shape.',
  not_found: 'No such release line or manifest.',
  wrong_tenant: 'That release belongs to another tenant or company than the one this request names.',
  unknown_reference: 'The request names a manifest, line or revision that does not belong to this release.',
  stale_approval: 'The digest you reviewed is not this manifest’s digest any more. Reload the release and review it again.',
  stale_revision: 'The line’s publication pointer has moved since you loaded it. Reload the line and try again.',
  idempotency_conflict: 'This idempotency key was already used for a different request.',
  composite_incompatible: 'A pinned piece stopped being its asset’s accepted head while the release was being published.',
  audience_forbidden: 'A pinned piece may not be shown to this line’s audience.',
  rebuild_required: 'A pinned piece is out of date and must be rebuilt before this release can go out.',
  reapproval_required: 'A pinned piece changed and must be approved again before this release can go out.',
  attestation_missing: 'A pinned piece lacks the evidence its policy profile requires.',
  approval_required: 'A policy profile in this manifest has no live publish approval of this digest.',
  changes_requested: 'A reviewer’s latest decision on this manifest asks for changes.',
  no_authority: 'Nobody in this request holds the authority this act needs.',
  effect_target: 'This release cannot be delivered to one of the targets named.',
  queue_full: 'The tenant’s release outbox is full. Wait for the drain to catch up.',
  taken_down: 'A takedown covers this release or one of its pieces, so it cannot go out again.',
  not_published: 'Only a manifest this line has published can be re-pinned.',
  render_unadmitted: 'A pinned render was not admitted and settled within its render budget by swarm admission, so this release cannot be approved or published. The release status names the reason.',
  is_head: 'That manifest is already what the line’s pointer names.',
  tombstoned: 'A pinned piece was tombstoned and cannot be re-pinned.',
  person_required: 'Only a person can do this.',
  revoked_author: 'The person acting has been revoked.',
  unpinned_component: 'A pinned piece no longer matches the digest the manifest records.',
  unapproved_release: 'A pinned piece’s bytes were not approved by a person when they became its head.',
  unknown_authority: 'That is not a release authority. Name one of the authorities the release policy uses.',
  not_member: 'That person is not linked to this company, so they cannot hold its release authorities.',
  already_held: 'That person already holds this release authority in this company.',
  not_held: 'That person does not hold this release authority in this company, so there is nothing to revoke.',
  policy_profile: 'No piece of this manifest is under that policy profile, so it has nothing to decide there.',
  agent_review: 'Only a person can decide on a release.',
  self_approval: 'The author of a manifest cannot approve it.',
  approval_incomplete: 'This policy profile needs its approval to name the evidence, rights or disclosure it relied on.',
  // Part 16 (D5585-p16): a line's name.
  line_name_invalid: 'A line name is 1 to 120 characters of text, with no control or text-direction characters.',
  stale_line_name: 'The line’s name has changed since you loaded it. Reload the line and rename it again.',
  // Part 18 (D5585-p18): the origins that may read a company's site records.
  site_origin_invalid: 'An origin is https:// and a host name, with an optional port and nothing after it.',
  stale_site_origins: 'The company’s list of origins has changed since you loaded it. Reload it and try again.',
  already_allowed: 'That origin is already on this company’s list.',
  not_allowed: 'That origin is not on this company’s list, so there is nothing to remove.',
  site_origin_limit: 'This company already lists the most origins it may. Remove one before adding another.',
});
export const RELEASE_REFUSAL_STATUS: Readonly<Record<string, number>> = Object.freeze({ malformed: 400, unknown_authority: 400, not_found: 404, wrong_tenant: 403, queue_full: 503,
  line_name_invalid: 400, site_origin_invalid: 400 });

export const RELEASE_DRAIN_LIMITS = Object.freeze({
  /** Effects one scheduled drain delivers at most. */
  scheduled: 25,
  /** Effects one manual drain may ask for at most. */
  manualMax: 25,
  /** Rows a list answers at most. */
  listMax: 100,
});

/** The effect kinds a release drain handles: one publish kind per target, and the retraction. */
export const RELEASE_EFFECT_KINDS: readonly string[] = Object.freeze([...EFFECT_TARGETS.map((t) => `release_${t}`), RELEASE_RETRACT_KIND]);

/** What the admin and reviewer contexts read: D1, and (part 13) the admission coordinator's binding, which may be absent. */
export type ReleaseAdminEnv = Pick<Env, 'DB' | 'WORKSPACE_ADMISSION' | 'BRANCH_DO_JURISDICTION'>;

export const RELEASE_ADMIN_DEPS = {
  /**
   * Each person's release authorities in this scope, from the part 8 store (D5585-p8): the grants whose latest row is
   * a grant, of people still linked to the company. A Super Admin holds only what was granted to them. Replaceable in
   * tests.
   */
  authorities: (env: Pick<Env, 'DB'>, scope: Scope): Promise<ReadonlyMap<number, readonly string[]>> =>
    releaseAuthoritiesForScope(env, { tenantId: scope.tenantId, companyId: scope.companyId }),
  /**
   * The people of this scope whose account is revoked (`users.is_active = 0`), D5585-p9: their approvals stop counting,
   * and they cannot decide, attest, publish or take down (`revoked_author`). Replaceable in tests.
   */
  revokedUsers: (env: Pick<Env, 'DB'>, scope: Scope): Promise<ReadonlySet<number>> =>
    revokedReleaseUsers(env, { tenantId: scope.tenantId, companyId: scope.companyId }),
  /**
   * Part 12 (D5585-p12): #5586's swarm admission state, which says whether each pinned render was admitted and settled
   * within its reserve. Part 13 (D5585-p13) reads it from the `WorkspaceAdmission` coordinator (#5586 part 3) through
   * `swarmSnapshotFor`, for the scope's own venture only. Any refusal (no binding, the object unreachable, a scope it
   * cannot name) answers null, "not read", so a manifest that pins a render is refused `render_unadmitted`
   * (`admission_unverified`), never treated as admitted. Replaceable in tests.
   */
  renderAdmissions: async (env: ReleaseAdminEnv, scope: Scope): Promise<SwarmState | null> => {
    const r = await swarmSnapshotFor(env, scope);
    return r.ok ? r.value : null;
  },
};

const posInt = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;

/** The scope a request names: a tenant and a company (company-wide, so it covers their projects), or null. */
export function scopeFrom(tenant: unknown, company: unknown): Scope | null {
  const t = typeof tenant === 'string' && /^[1-9][0-9]{0,15}$/.test(tenant) ? Number(tenant) : tenant;
  const co = typeof company === 'string' && /^[1-9][0-9]{0,15}$/.test(company) ? Number(company) : company;
  return posInt(t) && posInt(co) ? { tenantId: t, companyId: co, projectId: null } : null;
}

/** The context a Super Admin acts in: the named scope, the authorities resolved for it and its revoked people. */
export async function releaseAdminContext(env: ReleaseAdminEnv, scope: Scope): Promise<ReleaseContext> {
  const [authorities, revokedUserIds, renderAdmissions] = await Promise.all([RELEASE_ADMIN_DEPS.authorities(env, scope),
    RELEASE_ADMIN_DEPS.revokedUsers(env, scope), RELEASE_ADMIN_DEPS.renderAdmissions(env, scope)]);
  return { scope, authorities, revokedUserIds, renderAdmissions };
}

export const listLimit = (v: unknown) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, RELEASE_DRAIN_LIMITS.listMax) : RELEASE_DRAIN_LIMITS.listMax;
};

// Part 11 (D5585-p11): a release line had no name of its own, and every read said so (`lineName: null`,
// `lineNameReason: 'not_recorded'`) rather than inventing one. Part 16 (D5585-p16) gives a line a name a Super Admin
// sets (`workGraphReleaseLineNames.ts`, `lineNameFields`); an unnamed line still reads exactly so.

export interface ReleaseLineItem {
  lineAssetUid: string; projectId: number | null; audience: string; createdByUserId: number; createdAt: string;
  headManifestUid: string | null; headSeq: number; manifests: number;
  /** Part 16: the name a Super Admin gave the line; null with `not_recorded` while it has none. */
  lineName: string | null; lineNameReason: 'not_recorded' | null;
  /** Part 16: the `seq` of that name, 0 when never named: what a rename names as `expected_seq`. */
  lineNameSeq: number;
  /** Part 11: the name of the line's project, when it names one of this company's projects that is not deleted. */
  projectName: string | null;
}

/** The release lines of one scope, newest first, each with the manifest its publication pointer names. */
export async function listReleaseLines(env: Pick<Env, 'DB'>, scope: Scope, limit: number): Promise<{ lines: ReleaseLineItem[]; cost: Cost }> {
  const m = new Meter(env);
  const rows = await m.all<{ line_asset_uid: string; project_id: number | null; audience: string; created_by_user_id: number; created_at: string;
    head_revision_uid: string | null; head_seq: number; manifests: number; project_name: string | null }>(env.DB.prepare(
    `SELECT l.line_asset_uid, l.project_id, l.audience, l.created_by_user_id, l.created_at, a.head_revision_uid, a.head_seq,
            (SELECT COUNT(*) FROM work_graph_release_manifests x WHERE x.line_asset_uid = l.line_asset_uid) AS manifests,
            p.name AS project_name
       FROM work_graph_release_lines l JOIN work_graph_assets a ON a.asset_uid = l.line_asset_uid
       LEFT JOIN projects p ON p.id = l.project_id AND p.company_id = l.company_id AND p.deleted_at IS NULL
      WHERE l.tenant_id = ? AND l.company_id = ?
      ORDER BY l.created_at DESC, l.line_asset_uid
      LIMIT ?`,
  ).bind(scope.tenantId, scope.companyId, limit));
  const names = await lineNamesOf(env, m, scope, rows.map((r) => r.line_asset_uid));
  return {
    lines: rows.map((r) => ({
      lineAssetUid: r.line_asset_uid, projectId: r.project_id, audience: r.audience, createdByUserId: r.created_by_user_id,
      createdAt: r.created_at, headManifestUid: r.head_revision_uid, headSeq: Number(r.head_seq), manifests: Number(r.manifests),
      ...lineNameFields(names.get(r.line_asset_uid) ?? UNNAMED), projectName: r.project_name ?? null,
    })),
    cost: { ...m.cost },
  };
}

export interface ManifestItem {
  manifestUid: string; digest: string; baseManifestUid: string | null; partial: boolean; componentCount: number;
  repinOf: string | null; actorUserId: number; createdAt: string;
}

/** The manifests cut on one line of the scope, newest first. Ids and digests only, never a body. */
export async function listLineManifests(env: Pick<Env, 'DB'>, scope: Scope, lineAssetUid: string, limit: number): Promise<{ manifests: ManifestItem[]; cost: Cost }> {
  const m = new Meter(env);
  const rows = await m.all<{ manifest_uid: string; manifest_digest: string; base_manifest_uid: string | null; partial: number; component_count: number;
    repin: string | null; actor_user_id: number; created_at: string }>(env.DB.prepare(
    `SELECT manifest_uid, manifest_digest, base_manifest_uid, partial, component_count, json_extract(body_json, '$.repin') AS repin,
            actor_user_id, created_at
       FROM work_graph_release_manifests
      WHERE tenant_id = ? AND company_id = ? AND line_asset_uid = ?
      ORDER BY created_at DESC, manifest_uid
      LIMIT ?`,
  ).bind(scope.tenantId, scope.companyId, lineAssetUid, limit));
  return {
    manifests: rows.map((r) => ({
      manifestUid: r.manifest_uid, digest: r.manifest_digest, baseManifestUid: r.base_manifest_uid, partial: r.partial === 1,
      componentCount: Number(r.component_count), repinOf: r.repin ?? null, actorUserId: r.actor_user_id, createdAt: r.created_at,
    })),
    cost: { ...m.cost },
  };
}

export const EFFECT_STATES = ['pending', 'claimed', 'applied', 'dead'] as const;

export interface DeliveryItem {
  effectId: number; kind: string; state: string; attempts: number; maxAttempts: number; lastErrorCode: string | null;
  nextAttemptMs: number; createdAt: string; appliedAt: string | null;
  manifestUid: string | null; target: string | null; ref: string | null;
  /** Part 2's delivery row, once the effect was applied: what happened at the provider, and what it cost. */
  delivery: { op: string; outcome: string; reasonCode: string | null; externalRef: string | null; reconciled: boolean; attempt: number;
    d1Statements: number; providerCalls: number; createdAt: string } | null;
}

/**
 * The release outbox of one scope, newest first: every release effect with its state, and its delivery row once it
 * has one. `state` and `manifestUid` narrow it.
 */
export async function listReleaseDeliveries(
  env: Pick<Env, 'DB'>, scope: Scope, opts: { state?: string | null; manifestUid?: string | null; limit: number },
): Promise<{ deliveries: DeliveryItem[]; cost: Cost }> {
  const m = new Meter(env);
  const rows = await m.all<any>(env.DB.prepare(
    `SELECT f.id, f.effect_kind, f.state, f.attempts, f.max_attempts, f.last_error_code, f.next_attempt_ms, f.created_at, f.applied_at,
            json_extract(f.payload_json, '$.manifest') AS manifest, json_extract(f.payload_json, '$.target') AS target,
            json_extract(f.payload_json, '$.ref') AS ref,
            d.op, d.outcome, d.reason_code, d.external_ref, d.reconciled, d.attempt, d.d1_statements, d.provider_calls, d.created_at AS delivered_at
       FROM work_graph_effects f
       LEFT JOIN work_graph_release_deliveries d ON d.effect_id = f.id
      WHERE f.tenant_id = ? AND f.company_id = ? AND f.effect_kind IN (SELECT value FROM json_each(?))
        AND (? IS NULL OR f.state = ?)
        AND (? IS NULL OR json_extract(f.payload_json, '$.manifest') = ?)
      ORDER BY f.id DESC
      LIMIT ?`,
  ).bind(scope.tenantId, scope.companyId, JSON.stringify(RELEASE_EFFECT_KINDS), opts.state ?? null, opts.state ?? null,
    opts.manifestUid ?? null, opts.manifestUid ?? null, opts.limit));
  return {
    deliveries: rows.map((r): DeliveryItem => ({
      effectId: Number(r.id), kind: r.effect_kind, state: r.state, attempts: Number(r.attempts), maxAttempts: Number(r.max_attempts),
      lastErrorCode: r.last_error_code ?? null, nextAttemptMs: Number(r.next_attempt_ms), createdAt: r.created_at, appliedAt: r.applied_at ?? null,
      manifestUid: r.manifest ?? null, target: r.target ?? null, ref: r.ref ?? null,
      delivery: r.op == null ? null : {
        op: r.op, outcome: r.outcome, reasonCode: r.reason_code ?? null, externalRef: r.external_ref ?? null, reconciled: r.reconciled === 1,
        attempt: Number(r.attempt), d1Statements: Number(r.d1_statements), providerCalls: Number(r.provider_calls), createdAt: r.delivered_at,
      },
    })),
    cost: { ...m.cost },
  };
}

export interface ReleaseDrainSummary {
  /** How many deliveries ended in each outbox status. */
  byStatus: Partial<Record<DeliveryStatus, number>>;
  deliveries: number;
  cost: { d1Statements: number; d1Batches: number };
  providerRequests: number;
  providerRequestsByTarget: Record<string, number>;
}

/** The cost and outcome of one drain, ids and counts only. */
export function summariseDrain(r: Extract<ReleaseDrainResult, { ok: true }>): ReleaseDrainSummary {
  const byStatus: Partial<Record<DeliveryStatus, number>> = {};
  for (const x of r.results) byStatus[x.status] = (byStatus[x.status] ?? 0) + 1;
  return {
    byStatus, deliveries: r.results.length, cost: { d1Statements: r.cost.d1Statements, d1Batches: r.cost.d1Batches },
    providerRequests: r.providerRequests, providerRequestsByTarget: { ...r.providerRequestsByTarget },
  };
}

/** One line for the cron row: what the drain delivered and what it cost. */
export function drainSummaryLine(s: ReleaseDrainSummary): string {
  const statuses = Object.entries(s.byStatus).map(([k, n]) => `${k}=${n}`).join(' ');
  return `work graph release drain deliveries=${s.deliveries}${statuses ? ` ${statuses}` : ''} d1=${s.cost.d1Statements} provider=${s.providerRequests}`;
}

/**
 * The scheduled drain: null while `WORK_GRAPH_RELEASE_DELIVERY` is not `preview`, before any D1 read or provider call.
 * On, one bounded drain through the real adapters (`website_cdn` writes to `FILES` when it is bound; `external_distribution`
 * has no channel on main and refuses `target_not_configured`). `distributionChannels` is for tests.
 */
export async function scheduledReleaseDrain(
  env: Env, opts: { distributionChannels?: ReleaseDistributionChannels } = {},
): Promise<ReleaseDrainSummary | null> {
  if (!releaseDeliveryEnabled(env)) return null;
  const r = await drainReleaseEffects(env, { limit: RELEASE_DRAIN_LIMITS.scheduled, distributionChannels: opts.distributionChannels });
  return r.ok ? summariseDrain(r) : null;
}
