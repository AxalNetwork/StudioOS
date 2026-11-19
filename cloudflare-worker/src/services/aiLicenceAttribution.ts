/**
 * D5948 (#5948) — the licence an AI run is attributed to, and the per-licence
 * cost, billed and margin of a period's AI runs.
 *
 * WHICH LICENCE. A branch Worker holds one licence: `branch_licence` row
 * `id = 1`, its `licence_uid`. HQ (`BRANCH_CODE` unset) has no licence of its
 * own, and no account names its licence yet (`routes/licence.ts`, U1), so an
 * HQ run names none. Nothing is guessed: no row, an empty uid or a failed read
 * all name none, and the run's rows keep `licence_uid` NULL, read as
 * unattributed. The lookup never blocks or fails the AI call.
 *
 * ONCE. A branch's licence is resolved once per database binding and kept for
 * the isolate; a lookup that names none is not kept, so a branch provisioned
 * after the isolate started is read again on its next run.
 *
 * WRITTEN ONCE. `stampReservationLicence` and `stampUsageLicence` write the
 * column right after the row is inserted, in the run's own execution, with
 * `licence_uid IS NULL` in the WHERE: a second stamp changes nothing, and no
 * other statement in the Worker writes the column.
 */
import type { Env } from '../types';
import { branchOf } from '../util/branch';

/** A licence uid as `branch_licence` holds it: a short opaque id. */
const LICENCE_UID = /^[A-Za-z0-9._:-]{1,120}$/;

const RESOLVED = new WeakMap<object, string>();

/** The licence this Worker's runs are attributed to, or null when none can be named. */
export async function runLicenceUid(env: Pick<Env, 'DB' | 'BRANCH_CODE'>): Promise<string | null> {
  let code: string | null;
  try { code = branchOf(env); } catch { return null; }
  if (!code) return null;
  const key = env.DB as unknown as object;
  const kept = RESOLVED.get(key);
  if (kept) return kept;
  try {
    const row = await env.DB.prepare('SELECT licence_uid FROM branch_licence WHERE id = 1').first<{ licence_uid: unknown }>();
    const uid = typeof row?.licence_uid === 'string' ? row.licence_uid.trim() : '';
    if (!LICENCE_UID.test(uid)) return null;
    RESOLVED.set(key, uid);
    return uid;
  } catch (e) {
    // Counts only: the reason, never a value. The run goes on unattributed.
    console.warn('[ai-licence] lookup failed:', (e as Error)?.message ?? 'unknown');
    return null;
  }
}

/** Writes the hold's licence once; a failure leaves it NULL (unattributed) and never fails the hold. */
export async function stampReservationLicence(env: Env, uid: string, licenceUid: string | null): Promise<boolean> {
  if (!licenceUid) return false;
  try {
    const res = await env.DB.prepare('UPDATE ai_budget_reservations SET licence_uid = ? WHERE uid = ? AND licence_uid IS NULL')
      .bind(licenceUid, uid).run();
    return Number(res?.meta?.changes) > 0;
  } catch (e) {
    console.warn('[ai-licence] hold not stamped:', (e as Error)?.message ?? 'unknown');
    return false;
  }
}

/** Writes the usage row's licence once; a failure leaves it NULL (unattributed) and never fails the run. */
export async function stampUsageLicence(env: Env, id: number | null, licenceUid: string | null): Promise<boolean> {
  if (!licenceUid || id == null) return false;
  try {
    const res = await env.DB.prepare('UPDATE ai_usage_logs SET licence_uid = ? WHERE id = ? AND licence_uid IS NULL')
      .bind(licenceUid, id).run();
    return Number(res?.meta?.changes) > 0;
  } catch (e) {
    console.warn('[ai-licence] usage row not stamped:', (e as Error)?.message ?? 'unknown');
    return false;
  }
}

export type LicenceAiFigures = {
  licence_uid: string;
  runs: number;
  /** Settled before migration 493 had a usage row to cost them: outside the margin, as `tokenMargin`. */
  runs_not_recorded: number;
  included_microusd: number;
  billed_microusd: number;
  cost_microusd: number;
  /** Null when every run of the licence this period has no usage row to cost it. */
  margin_microusd: number | null;
};

export type LicenceAiPeriod = {
  period: { start: string; end: string };
  licences: LicenceAiFigures[];
  /** Settled holds after attribution started that name no licence (HQ, or a lookup that named none). */
  unattributed_runs: number;
  /** Settled holds created before migration 202611150131 added the column: "Not recorded", never a licence or zero. */
  pre_migration_runs: number | null;
  /** When attribution started on this database, or null when that cannot be read. */
  attribution_started_at: string | null;
};

const n = (v: unknown) => Number(v) || 0;

/**
 * The period's settled AI holds by licence: billed (top-up spend), cost (the
 * provider cost of that spend) and margin, with `tokenMargin`'s arithmetic in
 * `routes/admin_revenue.ts` — the same join, the same settled-in-period rule
 * (`updated_at` in `[start, end)`), the same non-admin members. Bonus and
 * adjustment tokens are not subtracted: `ai_credit_ledger` names no licence,
 * so they stay in HQ's whole-business margin only (D5948).
 */
export async function licenceAiPeriod(env: Env, period: { start: string; end: string }): Promise<LicenceAiPeriod> {
  let started: string | null = null;
  try {
    const row = await env.DB.prepare('SELECT started_at FROM ai_licence_attribution_start WHERE id = 1').first<{ started_at: unknown }>();
    started = typeof row?.started_at === 'string' && row.started_at ? row.started_at : null;
  } catch { started = null; }
  const rows = await env.DB.prepare(
    `SELECT r.licence_uid AS licence_uid,
            COUNT(*) AS runs,
            SUM(CASE WHEN l.id IS NULL THEN 1 ELSE 0 END) AS not_recorded,
            COALESCE(SUM(r.actual_included_microusd), 0) AS included,
            COALESCE(SUM(CASE WHEN l.id IS NOT NULL THEN r.actual_topup_microusd ELSE 0 END), 0) AS topup_spend,
            COALESCE(SUM(CASE WHEN l.id IS NOT NULL AND r.actual_included_microusd + r.actual_topup_microusd > 0
              THEN l.est_cost_usd * 1000000.0 * r.actual_topup_microusd / (r.actual_included_microusd + r.actual_topup_microusd)
              ELSE 0 END), 0) AS topup_cost
       FROM ai_budget_reservations r
       JOIN users u ON u.id = r.user_id AND u.role <> 'admin'
       LEFT JOIN ai_usage_logs l ON l.reservation_uid = r.uid AND l.refusal IS NULL
      WHERE r.status = 'settled' AND r.updated_at >= ? AND r.updated_at < ? AND r.licence_uid IS NOT NULL
      GROUP BY r.licence_uid
      ORDER BY r.licence_uid`,
  ).bind(period.start, period.end).all<Record<string, unknown>>();
  const nulls = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN ? IS NOT NULL AND r.created_at < ? THEN 1 ELSE 0 END) AS before_start
       FROM ai_budget_reservations r
       JOIN users u ON u.id = r.user_id AND u.role <> 'admin'
      WHERE r.status = 'settled' AND r.updated_at >= ? AND r.updated_at < ? AND r.licence_uid IS NULL`,
  ).bind(started, started, period.start, period.end).first<{ total: unknown; before_start: unknown }>();
  const total = n(nulls?.total);
  const before = started ? n(nulls?.before_start) : null;
  return {
    period,
    licences: (rows.results || []).map((r) => {
      const runs = n(r.runs), notRecorded = n(r.not_recorded);
      const billed = n(r.topup_spend), cost = Math.round(n(r.topup_cost));
      return {
        licence_uid: String(r.licence_uid),
        runs,
        runs_not_recorded: notRecorded,
        included_microusd: n(r.included),
        billed_microusd: billed,
        cost_microusd: cost,
        margin_microusd: runs - notRecorded === 0 ? null : billed - cost,
      };
    }),
    // Without a start row nothing can tell a pre-migration hold from an unattributed one: all are unattributed, and the pre-migration count is null.
    unattributed_runs: before == null ? total : total - before,
    pre_migration_runs: before,
    attribution_started_at: started,
  };
}
