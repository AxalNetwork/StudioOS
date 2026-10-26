/** D1167 (#3080): the owner's storage table. Allowances are never added. */
import type { Env, User } from '../types';
import { inGrace } from '../middleware/planSubscription';
import { LPs } from '../models/funds';
import { claimLpRowsByEmail } from './lpClaim';

export const STORAGE_GB = 1024 ** 3;
export type StoragePlan = Readonly<{
  allowance_bytes: number | null;
  allowance_reason: string | null;
  best_suited: string | null;
  best_suited_reason: string | null;
}>;
const measured = (gb: number, best_suited: string): StoragePlan => Object.freeze({
  allowance_bytes: gb * STORAGE_GB, allowance_reason: null, best_suited, best_suited_reason: null,
});
const FREE = measured(1, 'Exploring Axal and basic documents');
const START = measured(10, 'Individual founders and investors getting started');
const ACTIVE = measured(50, 'Active founders and investors managing multiple projects');
const POWER = measured(100, 'Power users with substantial research and documentation');
const PROFESSIONAL = measured(250, 'Professional investors and intensive company-building workflows');

export const STORAGE_PLANS = Object.freeze({
  'founder:free': FREE,
  'founder:growth': START,
  'founder:studio': POWER,
  'investor:free': FREE,
  'investor:plus': ACTIVE,
  'investor:professional': PROFESSIONAL,
  'investor:institutional': Object.freeze({ allowance_bytes: null, allowance_reason: 'Negotiated',
    best_suited: null, best_suited_reason: 'Best suited for is negotiated with the plan.' }),
  'advisor:free': FREE,
  'advisor:pro': START,
  'partner:free': FREE,
  'partner:pro': START,
  other: FREE,
  lp_access: measured(10, 'Verified Axal VC fund investors; fund documents excluded'),
  admin: Object.freeze({ allowance_bytes: null, allowance_reason: 'Staff accounts have no storage allowance.',
    best_suited: null, best_suited_reason: 'Staff accounts hold no plan.' }),
} satisfies Record<string, StoragePlan>);
export type StoragePlanKey = keyof typeof STORAGE_PLANS;

export function storagePlan(key: string | null | undefined): StoragePlan | null {
  return key && Object.hasOwn(STORAGE_PLANS, key) ? STORAGE_PLANS[key as StoragePlanKey] : null;
}

/** Public projection; Market Intelligence adds no storage to the profile plan. */
export function storageFields(key: string | null | undefined) {
  const plan = storagePlan(key);
  return { storage_plan_key: plan ? key : null, storage_bytes: plan?.allowance_bytes ?? null,
    storage_reason: plan?.allowance_reason ?? (plan ? null : 'Storage follows the member’s profile plan.'),
    best_suited: plan?.best_suited ?? null,
    best_suited_reason: plan?.best_suited_reason ?? (plan ? null : 'Best suited for follows the member’s profile plan.') };
}

/**
 * The authenticated member's largest allowance. A negotiated allowance stays
 * unknown; an LP admission cannot turn it into a smaller, measured allowance.
 * Any failed entitlement read throws a fixed error, never a guessed Free plan.
 */
export async function storagePlanKey(env: Env, user: User): Promise<StoragePlanKey> {
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) throw new Error('Storage plan unreadable');
  if (user.role === 'admin') return 'admin';
  try {
    // Lazy: the general plan catalogue projects this file, while aiLicenceKey's
    // tier helpers themselves use that catalogue. No eager dependency cycle.
    const { aiLicenceKey } = await import('./aiBudget');
    const licence = aiLicenceKey(user);
    let key: StoragePlanKey = licence === 'advisor' || licence === 'partner' ? `${licence}:free` : licence;
    const candidates: StoragePlanKey[] = [key];
    const subs = await env.DB.prepare('SELECT plan_group, plan, status, period_end FROM account_subscriptions WHERE user_id = ?')
      .bind(user.id).all<{ plan_group: string | null; plan: string | null; status: string; period_end: string | null }>();
    if (subs.success !== true) throw new Error('Storage plan unreadable');
    for (const sub of subs.results ?? []) {
      if ((sub.plan_group === 'advisor' || sub.plan_group === 'partner') && sub.plan === `${sub.plan_group}_pro`
          && inGrace(sub.status, sub.period_end)) candidates.push(`${sub.plan_group}:pro`);
    }
    // The existing LP reader owns membership (lpSelfScope), including legacy
    // verified-email matches. Pair its grant with the canonical one-time claim
    // so an email address never becomes a standing transferable entitlement.
    await claimLpRowsByEmail(env, user.id, user.email);
    const membership = await LPs.listByUser(env, user);
    if (membership.success !== true) throw new Error('Storage plan unreadable');
    const ids = (membership.results ?? []).map((lp: any) => {
      // The canonical claim is best-effort for document reads. Storage is an
      // entitlement: an unpersisted email link must retry, never stand as one.
      if (lp.user_id !== user.id) throw new Error('Storage plan unreadable');
      if (!Number.isSafeInteger(lp.id) || lp.id <= 0 || !Number.isSafeInteger(lp.fund_id) || lp.fund_id <= 0)
        throw new Error('Storage plan unreadable');
      return [lp.id, lp.fund_id];
    });
    const lps = await env.DB.prepare(`SELECT 1 AS admitted FROM fund_lp_admissions a
      JOIN json_each(?) own ON a.limited_partner_id = json_extract(own.value, '$[0]')
        AND a.fund_id = json_extract(own.value, '$[1]')
      WHERE date(a.admitted_on) <= date('now') LIMIT 1`)
      .bind(JSON.stringify(ids)).all<{ admitted: number }>();
    if (lps.success !== true) throw new Error('Storage plan unreadable');
    if (lps.results?.length) candidates.push('lp_access');
    for (const candidate of candidates) {
      const current = STORAGE_PLANS[key].allowance_bytes;
      const next = STORAGE_PLANS[candidate].allowance_bytes;
      if (current !== null && (next === null || next > current)) key = candidate;
    }
    return key;
  } catch {
    throw new Error('Storage plan unreadable');
  }
}
