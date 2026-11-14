/**
 * D5581 part 3 (#5581, WorkGraph under the #5577 epic) — reconciliation of WorkGraph bytes against D1, for one tenant
 * and company per call, and the company or asset legal holds that stop every byte deletion. A scheduled job can call
 * `reconcileWorkGraph` later; nothing schedules it yet. Decision: `documentation/architecture/decisions/D5581-p3.md`.
 *
 *   half-uploaded R2   a live revision of WorkGraph-held bytes (older than the grace period) whose object is absent,
 *                      the wrong size or the wrong checksum is flagged `bytes_missing`; the head swap never advances to
 *                      it. Bytes that come back verified clear the flag.
 *   orphan blobs       an object under the company's `wg/v1/…` prefix that no revision names, older than the grace
 *                      period, is listed and deleted, unless a company hold is in force (`deletion_blocked`).
 *   deleted assets     a tombstoned revision's bytes are deleted once its tombstone is older than the retention period,
 *                      no live or newer-tombstoned revision shares them (bytes are content-addressed), and no revision,
 *                      asset or company hold covers them. Its revisions get the permanent `bytes_deleted` flag.
 *   crashed DO, expired lease   the lease object expires its own leases (part 2) and never reuses a fence; reconcile
 *                      only audits a grant whose expiry passed with no release or expiry row (`lease_expiry_observed`).
 *   cross-region       a revision whose residency the bucket's jurisdiction cannot hold is flagged `residency_mismatch`.
 *   stuck effects      claimed effects whose claim lapsed are counted; the next drain reclaims them.
 *
 * Every finding is a `work_graph_integrity_events` row (system actor) with the call's cost. Bounded: at most `limit`
 * rows of each kind per call, with cursors for the next call. `dryRun` reports and writes nothing (no flag, no
 * deletion, no audit row).
 */
import type { Env } from '../types';
import {
  BLOB_BINDING, Spend, WORK_GRAPH_BLOB_DEPS, actorOk, blobPrefix, integrityEventStatement, outOfScope, parseBlobKey,
  residencyAllowed, verifyBlob,
  type BlobCost, type BlobRefusal, type IntegrityEvent,
} from './workGraphBlobs';
import type { Actor, Scope, ValidationContext } from './workGraphContracts';

type ReconcileEnv = Pick<Env, 'DB'> & { FILES?: R2Bucket };

export const WORK_GRAPH_RECONCILE_DEFAULTS = Object.freeze({
  /** An upload, or a revision written just before its bytes, is left alone this long. */
  graceMs: 24 * 60 * 60 * 1000,
  /**
   * How long a tombstoned revision's bytes are kept. No retention policy exists yet (D5579 §5 step 5,
   * `dsrRequests.ts`), so this is the mechanism's default, and every call may pass its own.
   */
  retentionMs: 30 * 24 * 60 * 60 * 1000,
  limit: 100,
  maxLimit: 500,
});

export interface ReconcileInput {
  scope: Pick<Scope, 'tenantId' | 'companyId'>;
  graceMs?: number;
  retentionMs?: number;
  limit?: number;
  /** Continue after the last revision uid / R2 cursor of the previous call. */
  cursors?: { revisions?: string | null; orphans?: string | null; tombstones?: string | null };
  dryRun?: boolean;
}

export interface ReconcileReport {
  checked: number;
  missingBytes: string[];
  restored: string[];
  residencyFlagged: string[];
  orphans: { key: string; digest: string; size: number; action: 'deleted' | 'held' | 'listed' }[];
  retention: { digest: string; revisions: string[]; action: 'deleted' | 'held' | 'shared' | 'listed' }[];
  expiredLeases: { assetId: string; fence: number; expiresAtMs: number }[];
  stuckEffects: number;
  cursors: { revisions: string | null; orphans: string | null; tombstones: string | null };
}
export type ReconcileResult = { ok: true; report: ReconcileReport; cost: BlobCost } | BlobRefusal<'malformed' | 'wrong_tenant' | 'no_binding'>;

const posInt = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;
const nonNeg = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

interface LiveRow { revision_uid: string; asset_uid: string; digest: string; byte_length: number; residency: string | null; flags: string | null }
interface TombRow { revision_uid: string; asset_uid: string; digest: string; source_id: string }

export async function reconcileWorkGraph(env: ReconcileEnv, ctx: ValidationContext, input: ReconcileInput): Promise<ReconcileResult> {
  const s = new Spend(env);
  const d = WORK_GRAPH_RECONCILE_DEFAULTS;
  const graceMs = input?.graceMs ?? d.graceMs;
  const retentionMs = input?.retentionMs ?? d.retentionMs;
  const limit = input?.limit ?? d.limit;
  if (!posInt(input?.scope?.tenantId) || !posInt(input.scope.companyId) || !nonNeg(graceMs) || !nonNeg(retentionMs)
    || !posInt(limit) || limit > d.maxLimit) {
    return s.refuse('malformed', [], null);
  }
  const scope: Scope = { tenantId: input.scope.tenantId, companyId: input.scope.companyId, projectId: null };
  const base = { tenantId: scope.tenantId, companyId: scope.companyId, system: true };
  // Reconcile acts on a whole company: only a company-wide caller of that company may run it.
  if (outOfScope(ctx, scope, 'restricted')) return s.refuse('wrong_tenant', [], base);
  const bucket = env.FILES;
  if (!bucket) return s.refuse('no_binding', [BLOB_BINDING], base);

  const now = WORK_GRAPH_BLOB_DEPS.now();
  const at = now.toISOString();
  const graceCutoff = new Date(now.getTime() - graceMs).toISOString();
  const dry = input.dryRun === true;
  const writes: D1PreparedStatement[] = [];
  const events: IntegrityEvent[] = [];
  const flag = (revisionUid: string, assetUid: string, f: string) => env.DB.prepare(
    `INSERT INTO work_graph_revision_flags (revision_uid, flag, tenant_id, company_id, asset_uid, set_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (revision_uid, flag) DO UPDATE SET set_at = excluded.set_at, cleared_at = NULL WHERE cleared_at IS NOT NULL`,
  ).bind(revisionUid, f, scope.tenantId, scope.companyId, assetUid, at);
  const report: ReconcileReport = {
    checked: 0, missingBytes: [], restored: [], residencyFlagged: [], orphans: [], retention: [], expiredLeases: [],
    stuckEffects: 0, cursors: { revisions: null, orphans: null, tombstones: null },
  };

  // 1. Live revisions of WorkGraph-held bytes: half-uploaded, lost or corrupt objects, and residency.
  const live = await s.all<LiveRow>(env.DB.prepare(
    `SELECT r.revision_uid, r.asset_uid, r.digest, r.byte_length, r.residency,
            (SELECT group_concat(f.flag) FROM work_graph_revision_flags f WHERE f.revision_uid = r.revision_uid AND f.cleared_at IS NULL) AS flags
       FROM work_graph_revisions r
      WHERE r.tenant_id = ? AND r.company_id = ? AND r.source_store = 'r2_object' AND r.source_locator = 'FILES'
        AND r.source_id LIKE 'wg/v1/%' AND r.tombstoned_at IS NULL AND datetime(r.created_at) <= datetime(?) AND r.revision_uid > ?
      ORDER BY r.revision_uid LIMIT ?`,
  ).bind(scope.tenantId, scope.companyId, graceCutoff, input.cursors?.revisions ?? '', limit));
  const verified = new Map<string, boolean>();
  for (const r of live) {
    report.checked++;
    const flags = new Set((r.flags ?? '').split(',').filter(Boolean));
    if (!residencyAllowed(r.residency, WORK_GRAPH_BLOB_DEPS.jurisdiction) && !flags.has('residency_mismatch')) {
      report.residencyFlagged.push(r.revision_uid);
      if (!dry) writes.push(flag(r.revision_uid, r.asset_uid, 'residency_mismatch'));
      events.push({ ...base, assetUid: r.asset_uid, revisionUid: r.revision_uid, digest: r.digest, action: 'residency_flagged', outcome: 'flagged', detail: { residency: r.residency, jurisdiction: WORK_GRAPH_BLOB_DEPS.jurisdiction }, at });
    }
    const cacheKey = `${r.digest}:${r.byte_length}`;
    let ok = verified.get(cacheKey);
    if (ok === undefined) {
      const v = await verifyBlob(env, scope, r.digest, r.byte_length);
      s.cost.r2ClassB += v.r2ClassB;
      ok = v.ok;
      verified.set(cacheKey, ok);
    }
    if (!ok && !flags.has('bytes_missing')) {
      report.missingBytes.push(r.revision_uid);
      if (!dry) writes.push(flag(r.revision_uid, r.asset_uid, 'bytes_missing'));
      events.push({ ...base, assetUid: r.asset_uid, revisionUid: r.revision_uid, digest: r.digest, action: 'bytes_missing', outcome: 'flagged', at });
    } else if (ok && flags.has('bytes_missing')) {
      report.restored.push(r.revision_uid);
      if (!dry) {
        writes.push(env.DB.prepare(
          `UPDATE work_graph_revision_flags SET cleared_at = ? WHERE revision_uid = ? AND flag = 'bytes_missing' AND cleared_at IS NULL`,
        ).bind(at, r.revision_uid));
      }
      events.push({ ...base, assetUid: r.asset_uid, revisionUid: r.revision_uid, digest: r.digest, action: 'bytes_restored', outcome: 'applied', at });
    }
  }
  report.cursors.revisions = live.length === limit ? live[live.length - 1].revision_uid : null;

  // Holds over the whole company block every deletion; asset holds block their asset's bytes.
  const holds = await s.all<{ asset_uid: string | null }>(env.DB.prepare(
    'SELECT asset_uid FROM work_graph_holds WHERE tenant_id = ? AND company_id = ? AND released_at IS NULL',
  ).bind(scope.tenantId, scope.companyId));
  const companyHold = holds.some((h) => h.asset_uid === null);
  const heldAssets = new Set(holds.map((h) => h.asset_uid).filter((a): a is string => a !== null));
  const deleteKeys: string[] = [];
  const deletedDigests: string[] = [];

  // 2. Orphans: objects under this company's prefix that no revision names.
  const listed = await bucket.list({ prefix: blobPrefix(scope), limit, cursor: input.cursors?.orphans ?? undefined, include: ['customMetadata'] } as R2ListOptions);
  s.cost.r2ClassA++;
  const objects = listed.objects.filter((o) => {
    const k = parseBlobKey(o.key);
    return !!k && k.tenantId === scope.tenantId && k.companyId === scope.companyId;
  });
  if (objects.length) {
    const named = await s.all<{ source_id: string }>(env.DB.prepare(
      `SELECT DISTINCT source_id FROM work_graph_revisions
        WHERE tenant_id = ? AND company_id = ? AND source_store = 'r2_object' AND source_locator = 'FILES'
          AND source_id IN (SELECT value FROM json_each(?))`,
    ).bind(scope.tenantId, scope.companyId, JSON.stringify(objects.map((o) => o.key))));
    const referenced = new Set(named.map((n) => n.source_id));
    for (const o of objects) {
      if (referenced.has(o.key) || o.uploaded.getTime() > now.getTime() - graceMs) continue;
      const digest = parseBlobKey(o.key)!.digest;
      const action = dry ? 'listed' : companyHold ? 'held' : 'deleted';
      report.orphans.push({ key: o.key, digest, size: o.size, action });
      events.push({ ...base, digest, action: action === 'deleted' ? 'blob_deleted' : action === 'held' ? 'deletion_blocked' : 'orphan_listed', outcome: 'flagged', detail: { orphan: true, size: o.size }, at });
      if (action === 'deleted') { deleteKeys.push(o.key); deletedDigests.push(digest); }
    }
  }
  report.cursors.orphans = listed.truncated ? (listed as { cursor?: string }).cursor ?? null : null;

  // 3. Tombstoned revisions past retention: their bytes go, unless shared, newer or held.
  const retentionCutoff = new Date(now.getTime() - retentionMs).toISOString();
  const tombs = await s.all<TombRow>(env.DB.prepare(
    `SELECT r.revision_uid, r.asset_uid, r.digest, r.source_id FROM work_graph_revisions r
      WHERE r.tenant_id = ? AND r.company_id = ? AND r.source_store = 'r2_object' AND r.source_locator = 'FILES'
        AND r.source_id LIKE 'wg/v1/%' AND r.tombstoned_at IS NOT NULL AND r.tombstoned_at <= ? AND r.revision_uid > ?
        AND NOT EXISTS (SELECT 1 FROM work_graph_revision_flags f WHERE f.revision_uid = r.revision_uid AND f.flag = 'bytes_deleted')
      ORDER BY r.revision_uid LIMIT ?`,
  ).bind(scope.tenantId, scope.companyId, retentionCutoff, input.cursors?.tombstones ?? '', limit));
  const byKey = new Map<string, TombRow[]>();
  for (const t of tombs) byKey.set(t.source_id, [...(byKey.get(t.source_id) ?? []), t]);
  for (const [key, rows] of byKey) {
    const digest = rows[0].digest;
    const keep = await s.first<{ n: number; assets: string | null }>(env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM work_graph_revisions x
           WHERE x.tenant_id = ? AND x.company_id = ? AND x.source_id = ?
             AND (x.tombstoned_at IS NULL OR x.tombstoned_at > ? OR x.legal_hold = 1)) AS n,
         (SELECT group_concat(DISTINCT x.asset_uid) FROM work_graph_revisions x
           WHERE x.tenant_id = ? AND x.company_id = ? AND x.source_id = ?) AS assets`,
    ).bind(scope.tenantId, scope.companyId, key, retentionCutoff, scope.tenantId, scope.companyId, key));
    const assets = (keep?.assets ?? '').split(',').filter(Boolean);
    const revisions = rows.map((r) => r.revision_uid);
    let action: 'deleted' | 'held' | 'shared' | 'listed';
    if (Number(keep?.n ?? 0) > 0) action = 'shared';
    else if (companyHold || assets.some((a) => heldAssets.has(a))) action = 'held';
    else action = dry ? 'listed' : 'deleted';
    report.retention.push({ digest, revisions, action });
    if (action === 'shared') continue;
    events.push({ ...base, assetUid: rows[0].asset_uid, revisionUid: revisions[0], digest, action: action === 'deleted' ? 'blob_deleted' : action === 'held' ? 'deletion_blocked' : 'orphan_listed', outcome: 'flagged', detail: { tombstoned: revisions }, at });
    if (action === 'deleted') {
      deleteKeys.push(key);
      deletedDigests.push(digest);
      // The deletion tombstone: permanent, so the revision reads as deleted, never as merely missing.
      for (const r of rows) writes.push(flag(r.revision_uid, r.asset_uid, 'bytes_deleted'));
    }
  }
  report.cursors.tombstones = tombs.length === limit ? tombs[tombs.length - 1].revision_uid : null;

  // 4. Leases whose expiry passed with no release or expiry recorded (a crashed or never-called object). Audit only.
  const lapsed = await s.all<{ asset_id: string; fence: number; expires_at_ms: number }>(env.DB.prepare(
    `SELECT g.asset_id, g.fence, MAX(COALESCE(n.expires_at_ms, g.expires_at_ms)) AS expires_at_ms
       FROM work_graph_lease_events g
       LEFT JOIN work_graph_lease_events n ON n.tenant_id = g.tenant_id AND n.company_id = g.company_id
            AND n.asset_id = g.asset_id AND n.fence = g.fence AND n.action = 'renew'
      WHERE g.tenant_id = ? AND g.company_id = ? AND g.action = 'acquire'
        AND NOT EXISTS (SELECT 1 FROM work_graph_lease_events e WHERE e.tenant_id = g.tenant_id AND e.company_id = g.company_id
                         AND e.asset_id = g.asset_id AND e.fence = g.fence AND e.action IN ('release', 'expire'))
        AND NOT EXISTS (SELECT 1 FROM work_graph_integrity_events i WHERE i.tenant_id = g.tenant_id AND i.company_id = g.company_id
                         AND i.action = 'lease_expiry_observed' AND i.asset_uid = g.asset_id AND json_extract(i.detail_json, '$.fence') = g.fence)
      GROUP BY g.asset_id, g.fence
     HAVING MAX(COALESCE(n.expires_at_ms, g.expires_at_ms)) <= ?
      ORDER BY g.asset_id, g.fence LIMIT ?`,
  ).bind(scope.tenantId, scope.companyId, now.getTime(), limit));
  for (const l of lapsed) {
    report.expiredLeases.push({ assetId: l.asset_id, fence: Number(l.fence), expiresAtMs: Number(l.expires_at_ms) });
    events.push({ ...base, assetUid: l.asset_id, action: 'lease_expiry_observed', outcome: 'flagged', detail: { fence: Number(l.fence), expires_at_ms: Number(l.expires_at_ms) }, at });
  }

  // 5. Effects whose claim lapsed (a worker died mid-effect): counted; the next drain reclaims them.
  const stuck = await s.first<{ n: number }>(env.DB.prepare(
    `SELECT COUNT(*) AS n FROM work_graph_effects WHERE tenant_id = ? AND company_id = ? AND state = 'claimed' AND claimed_until_ms <= ?`,
  ).bind(scope.tenantId, scope.companyId, now.getTime()));
  report.stuckEffects = Number(stuck?.n ?? 0);

  if (deleteKeys.length && !dry) {
    await bucket.delete(deleteKeys);
    s.cost.r2ClassA++;
    writes.push(env.DB.prepare(
      `UPDATE work_graph_blobs SET deleted_at = ?
        WHERE tenant_id = ? AND company_id = ? AND deleted_at IS NULL AND digest IN (SELECT value FROM json_each(?))`,
    ).bind(at, scope.tenantId, scope.companyId, JSON.stringify(deletedDigests)));
  }
  // A dry run changes nothing: no flag, no deletion, no audit row. It only reports.
  const total = dry ? 0 : writes.length + events.length;
  if (total) {
    const cost: BlobCost = { ...s.cost, d1Statements: s.cost.d1Statements + total, d1Batches: s.cost.d1Batches + 1 };
    await s.batch([...writes, ...events.map((e) => integrityEventStatement(env.DB, { ...e, cost }))]);
  }
  return { ok: true, report, cost: { ...s.cost } };
}

// ── legal holds over a company or an asset ───────────────────────────────────

export type HoldResult = { ok: true; holdId: number; changed: boolean; cost: BlobCost } | BlobRefusal<'malformed' | 'wrong_tenant' | 'person_required' | 'not_found'>;

/**
 * Place a legal hold over a whole company (`assetUid` null) or one asset: no byte in its scope is deleted while it
 * is in force, orphans included. A person's act; the route that exposes it must be Super-Admin-only.
 */
export async function placeHold(
  env: Pick<Env, 'DB'>, ctx: ValidationContext, input: { scope: Pick<Scope, 'tenantId' | 'companyId'>; assetUid?: string | null; actor: Actor; reason: string },
): Promise<HoldResult> {
  const s = new Spend(env);
  if (input?.actor?.kind !== 'person' || !actorOk(input.actor)) return s.refuse('person_required', [], null);
  if (!posInt(input.scope?.tenantId) || !posInt(input.scope.companyId) || typeof input.reason !== 'string' || !input.reason.trim()
    || input.reason.length > 500 || (input.assetUid != null && (typeof input.assetUid !== 'string' || input.assetUid.length > 80))) {
    return s.refuse('malformed', [], null);
  }
  const scope: Scope = { tenantId: input.scope.tenantId, companyId: input.scope.companyId, projectId: null };
  const base = { tenantId: scope.tenantId, companyId: scope.companyId, assetUid: input.assetUid ?? null, actor: input.actor, action: 'hold_placed' };
  if (outOfScope(ctx, scope, 'restricted')) return s.refuse('wrong_tenant', [], base);
  if (input.assetUid != null) {
    const a = await s.first<{ n: number }>(env.DB.prepare(
      'SELECT COUNT(*) AS n FROM work_graph_assets WHERE asset_uid = ? AND tenant_id = ? AND company_id = ?',
    ).bind(input.assetUid, scope.tenantId, scope.companyId));
    if (!Number(a?.n ?? 0)) return s.refuse('not_found', [input.assetUid], base);
  }
  const at = WORK_GRAPH_BLOB_DEPS.now().toISOString();
  const res = await s.batch([
    env.DB.prepare(
      `INSERT INTO work_graph_holds (tenant_id, company_id, asset_uid, reason, placed_by_user_id, placed_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(scope.tenantId, scope.companyId, input.assetUid ?? null, input.reason, input.actor.userId, at),
    integrityEventStatement(env.DB, { ...base, outcome: 'applied', detail: { reason: input.reason }, cost: { ...s.cost, d1Statements: s.cost.d1Statements + 2, d1Batches: s.cost.d1Batches + 1 }, at }, true),
  ]);
  return { ok: true, holdId: Number(res[0]?.meta?.last_row_id ?? 0), changed: true, cost: { ...s.cost } };
}

/** Release a hold. A person's act; audited. Releasing a released hold changes nothing. */
export async function releaseHold(
  env: Pick<Env, 'DB'>, ctx: ValidationContext, input: { holdId: number; actor: Actor; reason: string },
): Promise<HoldResult> {
  const s = new Spend(env);
  if (input?.actor?.kind !== 'person' || !actorOk(input.actor)) return s.refuse('person_required', [], null);
  if (!posInt(input.holdId) || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 500) return s.refuse('malformed', [], null);
  const h = await s.first<{ tenant_id: number; company_id: number; asset_uid: string | null; released_at: string | null }>(env.DB.prepare(
    'SELECT tenant_id, company_id, asset_uid, released_at FROM work_graph_holds WHERE id = ?',
  ).bind(input.holdId));
  if (!h) return s.refuse('not_found', [String(input.holdId)], null);
  const scope: Scope = { tenantId: h.tenant_id, companyId: h.company_id, projectId: null };
  const base = { tenantId: h.tenant_id, companyId: h.company_id, assetUid: h.asset_uid, actor: input.actor, action: 'hold_released' };
  if (outOfScope(ctx, scope, 'restricted')) return s.refuse('wrong_tenant', [String(input.holdId)], base);
  if (h.released_at !== null) return { ok: true, holdId: input.holdId, changed: false, cost: { ...s.cost } };
  const at = WORK_GRAPH_BLOB_DEPS.now().toISOString();
  const res = await s.batch([
    env.DB.prepare('UPDATE work_graph_holds SET released_at = ?, released_by_user_id = ? WHERE id = ? AND released_at IS NULL')
      .bind(at, input.actor.userId, input.holdId),
    integrityEventStatement(env.DB, { ...base, outcome: 'applied', detail: { hold: input.holdId, reason: input.reason }, cost: { ...s.cost, d1Statements: s.cost.d1Statements + 2, d1Batches: s.cost.d1Batches + 1 }, at }, true),
  ]);
  return { ok: true, holdId: input.holdId, changed: Number(res[0]?.meta?.changes ?? 0) > 0, cost: { ...s.cost } };
}
