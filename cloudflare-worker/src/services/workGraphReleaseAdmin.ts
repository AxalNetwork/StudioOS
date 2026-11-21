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
 * `RELEASE_ADMIN_DEPS.authorities`. No table records them today (D5585-p7 §3), so on main it resolves NONE: being a
 * Super Admin grants no release authority, an approval counts for nobody, and a takedown is refused `no_authority`
 * (and recorded) until an authority store exists. Tests replace the resolver.
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
import type { Cost } from './workGraphRevisions';
import { EFFECT_TARGETS, Meter, type ReleaseContext } from './workGraphReleases';
import { RELEASE_RETRACT_KIND } from './workGraphReleaseDelivery';
import { drainReleaseEffects, releaseDeliveryEnabled, type ReleaseDrainResult } from './workGraphReleaseAdapters';
import type { ReleaseDistributionChannels } from './workGraphReleaseDistribution';
import type { DeliveryStatus } from './workGraphEffects';

/** The value of `WORK_GRAPH_RELEASE_ADMIN` that turns the routes on. Unset, or anything else, is off. */
export const RELEASE_ADMIN_ON = 'on';
export const releaseAdminEnabled = (env: Pick<Env, 'WORK_GRAPH_RELEASE_ADMIN'>) => env.WORK_GRAPH_RELEASE_ADMIN === RELEASE_ADMIN_ON;

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

export const RELEASE_ADMIN_DEPS = {
  /**
   * Each person's release authorities in this scope. No store records them on main (D5585-p7 §3), so none are
   * resolved: a Super Admin holds no release authority by being one. Replaced in tests.
   */
  authorities: async (_env: Pick<Env, 'DB'>, _scope: Scope): Promise<ReadonlyMap<number, readonly string[]>> => new Map(),
};

const posInt = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;

/** The scope a request names: a tenant and a company (company-wide, so it covers their projects), or null. */
export function scopeFrom(tenant: unknown, company: unknown): Scope | null {
  const t = typeof tenant === 'string' && /^[1-9][0-9]{0,15}$/.test(tenant) ? Number(tenant) : tenant;
  const co = typeof company === 'string' && /^[1-9][0-9]{0,15}$/.test(company) ? Number(company) : company;
  return posInt(t) && posInt(co) ? { tenantId: t, companyId: co, projectId: null } : null;
}

/** The context a Super Admin acts in: the named scope and the authorities resolved for it. */
export async function releaseAdminContext(env: Pick<Env, 'DB'>, scope: Scope): Promise<ReleaseContext> {
  return { scope, authorities: await RELEASE_ADMIN_DEPS.authorities(env, scope) };
}

export const listLimit = (v: unknown) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, RELEASE_DRAIN_LIMITS.listMax) : RELEASE_DRAIN_LIMITS.listMax;
};

export interface ReleaseLineItem {
  lineAssetUid: string; projectId: number | null; audience: string; createdByUserId: number; createdAt: string;
  headManifestUid: string | null; headSeq: number; manifests: number;
}

/** The release lines of one scope, newest first, each with the manifest its publication pointer names. */
export async function listReleaseLines(env: Pick<Env, 'DB'>, scope: Scope, limit: number): Promise<{ lines: ReleaseLineItem[]; cost: Cost }> {
  const m = new Meter(env);
  const rows = await m.all<{ line_asset_uid: string; project_id: number | null; audience: string; created_by_user_id: number; created_at: string;
    head_revision_uid: string | null; head_seq: number; manifests: number }>(env.DB.prepare(
    `SELECT l.line_asset_uid, l.project_id, l.audience, l.created_by_user_id, l.created_at, a.head_revision_uid, a.head_seq,
            (SELECT COUNT(*) FROM work_graph_release_manifests x WHERE x.line_asset_uid = l.line_asset_uid) AS manifests
       FROM work_graph_release_lines l JOIN work_graph_assets a ON a.asset_uid = l.line_asset_uid
      WHERE l.tenant_id = ? AND l.company_id = ?
      ORDER BY l.created_at DESC, l.line_asset_uid
      LIMIT ?`,
  ).bind(scope.tenantId, scope.companyId, limit));
  return {
    lines: rows.map((r) => ({
      lineAssetUid: r.line_asset_uid, projectId: r.project_id, audience: r.audience, createdByUserId: r.created_by_user_id,
      createdAt: r.created_at, headManifestUid: r.head_revision_uid, headSeq: Number(r.head_seq), manifests: Number(r.manifests),
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
