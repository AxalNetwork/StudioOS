/**
 * D5585 part 15 (#5585, WorkGraph P1 under the #5577 epic): a render approved before it spends. A `render` approval on
 * a release manifest authorizes #5586's swarm admission to admit a video render or a brand image built on a piece that
 * manifest pins, up to the ceiling the approval states. This module answers the one question admission asks: for this
 * venture, this asset and this base revision, is there such an approval, and how much does it authorize? It reads D1
 * and writes nothing. Decision: `documentation/architecture/decisions/D5585-p15.md`.
 *
 * THE RULE. A manifest of the venture authorizes a render of `(asset, base)` when:
 *   - it pins exactly that revision of that asset;
 *   - no applied takedown covers it or the piece (`takedownsCovering`);
 *   - for every policy profile of that piece, at least one reviewer's live `render` decision counts, by the same
 *     counting rule publish approvals use (`decisionNotCounted`): an approval of this digest, for the line's audience,
 *     by a reviewer who is not revoked, not the manifest's author, and holds an authority the profile accepts.
 * Each counted approval states a ceiling. A profile authorizes the most any of its counted approvers allowed, and the
 * manifest authorizes the least across its profiles, so every profile has agreed to the spend. The newest manifest
 * that authorizes wins. A render with no base revision cannot be authorized: a manifest pins revisions, never an
 * asset's future.
 */
import type { Env } from '../types';
import type { Scope } from './workGraphContracts';
import type { Cost } from './workGraphRevisions';
import type { SwarmRenderApproval } from './agents/swarmAdmission';
import {
  Meter, decisionNotCounted, readLine, takedownsCovering,
  type LiveDecision, type ManifestBody, type ManifestRow, type ProfileName, type ReleaseContext,
} from './workGraphReleases';

/** Manifests read per question, newest first: a piece pinned by more release cuts than this is answered from these. */
export const RENDER_APPROVAL_LIMITS = Object.freeze({ manifestsMax: 10 });

export interface RenderApprovalQuery { assetUid: string; baseRevisionUid: string | null }

/** Why no manifest authorized the render, for the caller's own record; admission sees only the approval or null. */
export type RenderApprovalAnswer =
  | { approval: SwarmRenderApproval; reason: null }
  | { approval: null; reason: 'no_base' | 'not_pinned' | 'taken_down' | 'unapproved' };

/**
 * The render approval for `(asset, base)` in `ctx.scope`'s venture, under the context's authorities and revocations.
 * `approval` is what `SwarmFacts.render_approval` takes; null when none authorizes it (`reason` says which rule).
 */
export async function renderApprovalFor(env: Pick<Env, 'DB'>, ctx: ReleaseContext, q: RenderApprovalQuery): Promise<RenderApprovalAnswer & { cost: Cost }> {
  const m = new Meter(env);
  const done = (a: RenderApprovalAnswer) => ({ ...a, cost: { ...m.cost } });
  const scope: Scope | undefined = ctx?.scope;
  if (!scope || typeof q?.assetUid !== 'string' || !q.assetUid || (q.baseRevisionUid !== null && typeof q.baseRevisionUid !== 'string')) {
    return done({ approval: null, reason: 'not_pinned' });
  }
  if (!q.baseRevisionUid) return done({ approval: null, reason: 'no_base' });
  const manifests = await m.all<ManifestRow>(env.DB.prepare(
    `SELECT mf.manifest_uid, mf.line_asset_uid, mf.tenant_id, mf.company_id, mf.project_id, mf.audience, mf.manifest_digest,
            mf.base_manifest_uid, mf.partial, mf.body_json, mf.actor_kind, mf.actor_user_id, mf.agent_run_id, mf.created_at
       FROM work_graph_release_manifests mf
      WHERE mf.tenant_id = ? AND mf.company_id = ?
        AND EXISTS (SELECT 1 FROM work_graph_edges e
                     WHERE e.from_revision_uid = mf.manifest_uid AND e.edge_kind = 'component' AND e.to_revision_uid = ?)
      ORDER BY mf.created_at DESC, mf.manifest_uid DESC
      LIMIT ?`,
  ).bind(scope.tenantId, scope.companyId, q.baseRevisionUid, RENDER_APPROVAL_LIMITS.manifestsMax));
  let sawPinned = false, sawUnapproved = false;
  for (const man of manifests) {
    const body = JSON.parse(man.body_json) as ManifestBody;
    const piece = body.components.find((c) => c.asset === q.assetUid && c.revision === q.baseRevisionUid);
    if (!piece) continue;
    sawPinned = true;
    if ((await takedownsCovering(env, m, man.tenant_id, man.company_id, man.manifest_uid)).length) continue;
    sawUnapproved = true;
    const line = await readLine(env, m, man.line_asset_uid);
    if (!line) continue;
    const live = await m.all<LiveDecision & { render_ceiling_microusd: number | null }>(env.DB.prepare(
      `SELECT d.profile, d.authority, d.decision, d.reviewer_user_id, d.audience, d.manifest_digest, d.render_ceiling_microusd
         FROM work_graph_release_decisions d
        WHERE d.manifest_uid = ? AND d.purpose = 'render'
          AND d.id = (SELECT MAX(x.id) FROM work_graph_release_decisions x
                       WHERE x.manifest_uid = d.manifest_uid AND x.purpose = 'render' AND x.profile = d.profile
                         AND x.reviewer_user_id = d.reviewer_user_id)
        ORDER BY d.id`,
    ).bind(man.manifest_uid));
    const best = new Map<ProfileName, number>();
    for (const d of live) {
      if (decisionNotCounted(ctx, man, line.audience, d) !== null) continue;
      const cap = Number(d.render_ceiling_microusd);
      if (!Number.isSafeInteger(cap) || cap <= 0) continue;
      best.set(d.profile, Math.max(best.get(d.profile) ?? 0, cap));
    }
    if (!piece.profiles.length || !piece.profiles.every((p) => best.has(p))) continue;
    const ceiling = Math.min(...piece.profiles.map((p) => best.get(p) as number));
    return done({ approval: { manifest_uid: man.manifest_uid, ceiling_microusd: ceiling }, reason: null });
  }
  return done({ approval: null, reason: !sawPinned ? 'not_pinned' : sawUnapproved ? 'unapproved' : 'taken_down' });
}
