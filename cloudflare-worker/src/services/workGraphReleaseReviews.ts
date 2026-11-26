/**
 * D5585 part 10 (#5585, WorkGraph P1 under the #5577 epic) — what the signed-in reviewer routes
 * (`routes/release_reviews.ts`) act in: one person's release context in one tenant and company, and the
 * manifests awaiting that person's decision there. The decisions and attestations themselves are recorded by part 1's
 * `decideRelease` and `attestComponent`, unchanged. Decision: `documentation/architecture/decisions/D5585-p10.md`.
 *
 * THE CONTEXT. A reviewer's authorities come only from part 8's store, for exactly (tenant, company, reviewer)
 * (`resolveReleaseAuthorities`): nobody else's are resolved, and being a Super Admin adds none. Revoked people
 * (`users.is_active = 0`) come from part 9's resolver (`RELEASE_ADMIN_DEPS.revokedUsers`), so the services refuse a
 * revoked reviewer `revoked_author` even if a session were still live.
 *
 * THE PENDING LIST. The newest unpublished manifests of the scope (at most `REVIEW_LIMITS.scan`), each kept only if:
 * the person did not author it (an author cannot approve their own manifest); some policy profile in it is one the
 * person can decide (an authority they hold now approves it, per `POLICY_PROFILES`); the person has no live decision
 * for that profile (their latest row is absent or a `withdraw`); and no applied takedown covers it (part 2's
 * `takedownsCovering`). Ids, digests, audience and the profile and authority names only; never a body.
 */
import type { Env } from '../types';
import type { Scope } from './workGraphContracts';
import type { Cost } from './workGraphRevisions';
import { Meter, POLICY_PROFILES, takedownsCovering, type Audience, type ManifestBody, type ProfileName, type ReleaseContext } from './workGraphReleases';
import { resolveReleaseAuthorities } from './workGraphReleaseAuthorities';
import { RELEASE_ADMIN_DEPS, type ReleaseAdminEnv } from './workGraphReleaseAdmin';
import { releasePeople } from './workGraphReleaseDirectory';

export const REVIEW_LIMITS = Object.freeze({
  /** Unpublished manifests one pending read considers at most, newest first. */
  scan: 200,
  /** Rows a pending read answers at most. */
  listMax: 100,
});

export interface ReviewerContext {
  ctx: ReleaseContext;
  /** The release authorities the reviewer holds now in this tenant and company, sorted. */
  held: string[];
  revoked: boolean;
}

/** One reviewer's context: their own authorities in the scope (nobody else's), and the scope's revoked people. */
export async function reviewerContext(env: ReleaseAdminEnv, scope: Scope, userId: number): Promise<ReviewerContext> {
  const [held, revokedUserIds, renderAdmissions] = await Promise.all([
    resolveReleaseAuthorities(env, { tenantId: scope.tenantId, companyId: scope.companyId, userId }),
    RELEASE_ADMIN_DEPS.revokedUsers(env, scope),
    // Part 12 (D5585-p12): the swarm state behind `render_unadmitted`, read from the coordinator (part 13); null is not read.
    RELEASE_ADMIN_DEPS.renderAdmissions(env, scope),
  ]);
  return {
    ctx: { scope, authorities: new Map([[userId, held]]), revokedUserIds, renderAdmissions },
    held,
    revoked: revokedUserIds.has(userId),
  };
}

/** The policy profiles an authority set can decide: those any of its authorities approves. */
export function decidableProfiles(held: readonly string[]): ProfileName[] {
  return (Object.keys(POLICY_PROFILES) as ProfileName[]).filter((p) => POLICY_PROFILES[p].authorities.some((a) => held.includes(a))).sort();
}

export interface PendingItem {
  manifestUid: string; lineAssetUid: string; digest: string; audience: Audience;
  /** Part 11: who cut the manifest (named in the answer's `people` only if linked to the company). */
  authorUserId: number;
  /** The profiles of this manifest the person can decide and has no live decision on. */
  profiles: ProfileName[];
  /** For each of those profiles, the authorities the person holds that approve it. */
  authorities: Partial<Record<ProfileName, string[]>>;
}

/** The manifests of one scope awaiting this person's decision, newest first. */
export async function pendingReleaseDecisions(
  env: Pick<Env, 'DB'>, scope: Scope, userId: number, held: readonly string[], limit: number,
): Promise<{ pending: PendingItem[]; cost: Cost }> {
  const m = new Meter(env);
  const can = decidableProfiles(held);
  if (!can.length) return { pending: [], cost: { ...m.cost } };
  const rows = await m.all<{ manifest_uid: string; line_asset_uid: string; manifest_digest: string; audience: Audience; body_json: string; actor_user_id: number }>(env.DB.prepare(
    `SELECT mf.manifest_uid, mf.line_asset_uid, mf.manifest_digest, mf.audience, mf.body_json, mf.actor_user_id
       FROM work_graph_release_manifests mf JOIN work_graph_assets a ON a.asset_uid = mf.line_asset_uid
      WHERE mf.tenant_id = ? AND mf.company_id = ? AND mf.actor_user_id <> ?
        AND a.head_revision_uid IS NOT mf.manifest_uid
      ORDER BY mf.created_at DESC, mf.manifest_uid
      LIMIT ?`,
  ).bind(scope.tenantId, scope.companyId, userId, REVIEW_LIMITS.scan));
  // The person's live decision of each (manifest, profile): their latest row, unless it is a withdrawal.
  const mine = await m.all<{ manifest_uid: string; profile: string; decision: string }>(env.DB.prepare(
    `SELECT d.manifest_uid, d.profile, d.decision FROM work_graph_release_decisions d
      WHERE d.tenant_id = ? AND d.company_id = ? AND d.reviewer_user_id = ? AND d.purpose = 'publish'
        AND d.id = (SELECT MAX(x.id) FROM work_graph_release_decisions x
                     WHERE x.manifest_uid = d.manifest_uid AND x.purpose = 'publish' AND x.profile = d.profile
                       AND x.reviewer_user_id = d.reviewer_user_id)`,
  ).bind(scope.tenantId, scope.companyId, userId));
  const decided = new Set(mine.filter((d) => d.decision !== 'withdraw').map((d) => `${d.manifest_uid} ${d.profile}`));
  const pending: PendingItem[] = [];
  for (const r of rows) {
    if (pending.length >= limit) break;
    const body = JSON.parse(r.body_json) as ManifestBody;
    const inManifest = new Set(body.components.flatMap((c) => c.profiles));
    const profiles = can.filter((p) => inManifest.has(p) && !decided.has(`${r.manifest_uid} ${p}`));
    if (!profiles.length) continue;
    if ((await takedownsCovering(env, m, scope.tenantId, scope.companyId, r.manifest_uid)).length) continue;
    const authorities: PendingItem['authorities'] = {};
    for (const p of profiles) authorities[p] = POLICY_PROFILES[p].authorities.filter((a) => held.includes(a));
    pending.push({
      manifestUid: r.manifest_uid, lineAssetUid: r.line_asset_uid, digest: r.manifest_digest, audience: r.audience,
      authorUserId: Number(r.actor_user_id), profiles, authorities,
    });
  }
  return { pending, cost: { ...m.cost } };
}

/**
 * Part 11 (D5585-p11): the names a reviewer may see beside the pending list's authors — only people linked to the
 * reviewer's company, never an email (#3841); anyone else is null. One statement, none for an empty list.
 */
export async function pendingPeople(env: Pick<Env, 'DB'>, scope: Scope, items: readonly PendingItem[]) {
  const m = new Meter(env);
  return { people: await releasePeople(env, m, items.map((i) => i.authorUserId), { linkedTo: scope.companyId }), cost: m.cost };
}
