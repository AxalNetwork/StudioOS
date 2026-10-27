/**
 * D1170 (#3083) — HQ › Platform › Storage: what every member stores, as
 * totals only. `GET /api/admin/platform/storage`, Super Admin only.
 *
 * WHAT IT ANSWERS. Bytes and files by kind; members and bytes by plan; and
 * how many members are in each storage state. NO NAME, EMAIL, ID OR FILE
 * NAME: the payload carries counts, plan keys, kind keys and state keys
 * only, and a test walks it for anything else.
 *
 * ONE RULE, NOT A SECOND COPY. Each member's bytes come from the per-owner
 * statement beside each area's own query (`readStorageByOwner`), so a file
 * counts to the member it counts to on their own Storage page. Each member's
 * plan comes from `chooseStoragePlanKey`, the rule `storagePlanKey` applies,
 * fed in batch. One difference, stated: an LP admission counts here when the
 * LP row is linked to the account. The member's own read also links an LP
 * row matching their verified email the first time it runs (D1167); this read
 * writes nothing, so such a member counts on their profile plan until then.
 *
 * WHAT CANNOT BE READ IS SAID. An area that fails leaves the kinds that read
 * standing and names itself; every member's bytes are then a floor, so the
 * states and the bytes by plan are null with the reason, never a guess. A
 * failed plan read blanks the plan and state blocks only.
 */
import type { Env } from '../types';
import { aiLicenceKey } from './aiBudget';
import { chooseStoragePlanKey, storagePlan, STORAGE_PLANS, type StoragePlanKey } from './storagePlans';
import { readStorageByOwner, storageState, STORAGE_KINDS, type StorageState } from './storageUsage';

export const STATES: ReadonlyArray<StorageState> = ['ok', 'near_80', 'near_95', 'full', 'over', 'no_allowance'];
const AREAS_UNREADABLE = 'Some stored files could not be read, so no member’s total is complete.';
const PLANS_UNREADABLE = 'The plans could not be read.';

type SubRow = { user_id: number; plan_group: string | null; plan: string | null; status: string; period_end: string | null };

async function readPlans(env: Env): Promise<Map<number, StoragePlanKey> | null> {
  try {
    const [users, subs, admitted] = await Promise.all([
      env.DB.prepare('SELECT * FROM users').all<any>(),
      env.DB.prepare('SELECT user_id, plan_group, plan, status, period_end FROM account_subscriptions').all<SubRow>(),
      env.DB.prepare(`SELECT DISTINCT lp.user_id AS user_id FROM fund_lp_admissions a
        JOIN limited_partners lp ON lp.id = a.limited_partner_id AND lp.fund_id = a.fund_id
        WHERE lp.user_id IS NOT NULL AND date(a.admitted_on) <= date('now')`).all<{ user_id: number }>(),
    ]);
    if (users.success !== true || subs.success !== true || admitted.success !== true) return null;
    const byUser = new Map<number, SubRow[]>();
    for (const s of subs.results ?? []) byUser.set(Number(s.user_id), [...(byUser.get(Number(s.user_id)) ?? []), s]);
    const lps = new Set((admitted.results ?? []).map((r) => Number(r.user_id)));
    const plans = new Map<number, StoragePlanKey>();
    for (const u of users.results ?? []) {
      const id = Number(u.id);
      plans.set(id, chooseStoragePlanKey(aiLicenceKey(u), byUser.get(id) ?? [], lps.has(id)));
    }
    return plans;
  } catch {
    return null;
  }
}

export async function readPlatformStorage(env: Env) {
  const [{ owners, unreadable }, plans] = await Promise.all([readStorageByOwner(env), readPlans(env)]);
  const complete = unreadable.length === 0;

  let files = 0, measured = 0, unknown = 0;
  const kinds = Object.fromEntries(STORAGE_KINDS.map((k) => [k, 0])) as Record<string, number>;
  for (const t of owners.values()) {
    files += t.files; measured += t.measured_bytes; unknown += t.unknown_size_files;
    for (const k of STORAGE_KINDS) kinds[k] += t.kinds[k];
  }

  const byPlan = plans === null ? null : (Object.keys(STORAGE_PLANS) as StoragePlanKey[]).map((key) => {
    const plan = storagePlan(key)!;
    let members = 0, bytes = 0;
    for (const [id, k] of plans) if (k === key) { members += 1; bytes += owners.get(id)?.measured_bytes ?? 0; }
    return { plan_key: key, allowance_bytes: plan.allowance_bytes, allowance_reason: plan.allowance_reason, members, measured_bytes: complete ? bytes : null };
  });

  let byState: Record<string, number> | null = null;
  if (plans !== null && complete) {
    byState = Object.fromEntries([...STATES, 'not_measured'].map((s) => [s, 0]));
    for (const [id, key] of plans) {
      const state = storageState(owners.get(id)?.measured_bytes ?? 0, storagePlan(key)!.allowance_bytes, key);
      byState[state ?? 'not_measured'] += 1;
    }
  }

  return {
    complete,
    unreadable_areas: unreadable,
    reason: complete ? null : AREAS_UNREADABLE,
    totals: { members: plans?.size ?? null, files, measured_bytes: measured, unknown_size_files: unknown, complete },
    by_kind: STORAGE_KINDS.map((key) => ({ key, measured_bytes: kinds[key] })),
    by_plan: byPlan,
    by_plan_reason: plans === null ? PLANS_UNREADABLE : complete ? null : AREAS_UNREADABLE,
    by_state: byState,
    by_state_reason: plans === null ? PLANS_UNREADABLE : complete ? null : AREAS_UNREADABLE,
    // A negotiated plan has no allowance to measure against; it is counted apart.
    not_measured_means: 'A negotiated plan, whose allowance is agreed with the member rather than set in the table.',
  };
}
