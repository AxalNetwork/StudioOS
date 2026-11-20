/**
 * D6790 (#6790) — an obligation's owner is someone on the company team.
 *
 * The company team is the `user_company_links` rows for the venture's
 * `projects.company_id`, the same people Build's owner picker lists (D5398's
 * `memberOwner` in `records/build.ts`). `compliance_events.owner_user_id`
 * (migration 443) holds the person; `owner_name`, the free text typed before
 * #6790, stays on older rows and is shown until someone is picked.
 *
 * Every surface that names the owner goes through `ownerShown`: the Grow
 * record and module rows, the cycle card, Calendar → Compliance
 * (`calendar/sourceReaders.ts`, `calendar.ts`), `GET /api/compliance/events`
 * and the daily reminder (`growDaily.ts`), so they all show the same owner.
 */
import type { Env } from '../types';

/** The owner as shown: the picked team member's name, else the name typed before #6790, else null. */
export function ownerShown(memberName: unknown, typedName: unknown): string | null {
  for (const v of [memberName, typedName]) if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}

/** `compliance_events` with the picked owner's name beside it, as `owner_user_name`. */
export const EVENTS_WITH_OWNER = '(SELECT e.*, o.name AS owner_user_name FROM compliance_events e LEFT JOIN users o ON o.id = e.owner_user_id)';

/** True when `userId` is on the team of the venture `pid` belongs to. */
export async function onCompanyTeam(env: Env, pid: number, userId: number): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT 1 AS ok FROM user_company_links l JOIN projects p ON p.company_id = l.company_id WHERE p.id = ? AND l.user_id = ?',
  ).bind(pid, userId).first();
  return !!row;
}

/** The venture's company team as listbox choices, by name; empty when the venture has no company. */
export async function companyTeam(env: Env, pid: number): Promise<Array<{ value: string; label: string }>> {
  const res = await env.DB.prepare(
    `SELECT u.id, u.name FROM user_company_links l JOIN projects p ON p.company_id = l.company_id JOIN users u ON u.id = l.user_id
      WHERE p.id = ? ORDER BY lower(COALESCE(u.name, '')), u.id`,
  ).bind(pid).all<{ id: number; name: string | null }>();
  return (res.results || []).map((u) => ({ value: String(u.id), label: ownerShown(u.name, null) ?? 'Unnamed member' }));
}
