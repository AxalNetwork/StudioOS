import type { Env, User } from '../types';
import { nowIso, newUid } from '../routes/_t13t14t15_helpers';

export const CYCLE_STORES = {
  validate: ['discovery_interviews', 'pain_groups', 'hypotheses', 'demand_signals'],
  build: ['mvp_features', 'venture_risks', 'roadmap_okrs', 'formation_steps'],
  raise: ['readiness_items', 'pitch_decks', 'data_room_files', 'raise_prospects'],
  grow: ['product_feedback', 'growth_channels', 'growth_partners', 'markets', 'compliance_events'],
} as const;

const cycleQuery = `SELECT ${Object.entries(CYCLE_STORES).map(([cycle, stores]) =>
  `EXISTS(SELECT 1 FROM projects p WHERE p.company_id = ? AND p.founder_id = ?
    AND p.deleted_at IS NULL AND (${stores.map(store =>
      `EXISTS(SELECT 1 FROM ${store} s WHERE s.project_id = p.id)`).join(' OR ')})) AS ${cycle}`
).join(', ')}`;

export async function cyclesActive(env: Env, user: User, companyId: number): Promise<string[] | null> {
  if (user.founder_id == null || (user.role !== 'founder' && Number(user.spinout_lab_active ?? 0) !== 1)) return [];
  try {
    const row = await env.DB.prepare(cycleQuery)
      .bind(...Object.keys(CYCLE_STORES).flatMap(() => [companyId, user.founder_id]))
      .first<Record<string, number>>();
    return Object.keys(CYCLE_STORES).filter(cycle => Number(row?.[cycle] ?? 0) === 1);
  } catch {
    return null;
  }
}

export type LastOpened = { cycle: string; at: string };
export async function visitsFor(env: Env, userId: number): Promise<Map<number, LastOpened> | null> {
  try {
    const rows = await env.DB.prepare('SELECT company_id, cycle, opened_at FROM user_company_visits WHERE user_id = ?')
      .bind(userId).all<{ company_id: number; cycle: string; opened_at: string }>();
    return new Map((rows.results || []).map(row => [row.company_id, { cycle: row.cycle, at: row.opened_at }]));
  } catch {
    return null;
  }
}

export async function recordVisit(env: Env, userId: number, companyId: number, cycle: string): Promise<string> {
  const at = nowIso();
  await env.DB.prepare(`INSERT INTO user_company_visits (uid, user_id, company_id, cycle, opened_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, company_id) DO UPDATE SET
    cycle = excluded.cycle, opened_at = excluded.opened_at, updated_at = datetime('now')`)
    .bind(newUid(), userId, companyId, cycle, at).run();
  return at;
}
