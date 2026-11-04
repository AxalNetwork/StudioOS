/**
 * D4387 (#4387, #3742 E8) — an agent's sponsor and the cap's monthly reset.
 *
 * THE SPONSOR is the member whose AI tokens pay the agent's runs (owner Q2 A).
 * `sponsorRefusal` is the one check of a member who would become it, shared by
 * `PUT /api/teams/agents/:uid/sponsor` and its candidates read, in this order:
 *
 *   sponsor_not_member     no seat on the agent's team (`onTeam`)
 *   sponsor_cannot_manage  a seat, but not an editor (`canManage`): the run
 *                          would pause the agent `sponsor_left` at once
 *   sponsor_plan_required  not a paid Founder plan (`planOk`, owner Q4 B)
 *   sponsor_no_tokens      no AI tokens left (`defaultTokensLeft`, the duties'
 *                          own read: allowance and paid balance together)
 *   sponsor_balance_unreadable  that read failed: refused, never taken as 0 or OK
 *
 * THE CAP RESUME. An agent the run paused at its monthly cap
 * (`paused_reason = 'cap'`) resumes once the UTC month it was paused in is
 * over: `resumeCapPauses`, from the existing agent sweep. Its pause instant is
 * its latest `paused` event, else its row's `updated_at`. No other reason is
 * ever resumed here. `capResumesAt` is the same date for the cap pill
 * ("Resumes 1 Dec"), so the browser never works it out.
 */
import type { Env, User } from '../../types';
import { planOk } from '../../routes/team_agents';
import { defaultTokensLeft } from './duties';
import { canManage, logEvent, monthStart, onTeam, type AgentRow, type Scope } from './teams';

export type SponsorRefusal = { status: number; code: string; message: string };

export const SPONSOR_WORDS = {
  sponsor_not_found: 'There is no such member.',
  sponsor_not_member: 'That person is not on this team. A sponsor must be a member of it.',
  sponsor_cannot_manage: 'That person cannot manage this team’s agents. A sponsor must be one of its editors.',
  sponsor_plan_required: 'That person is not on a paid Founder plan. A sponsor pays for the agent’s runs, so they need one.',
  sponsor_no_tokens: 'That person has no AI tokens left. A sponsor pays for the agent’s runs from their tokens.',
  sponsor_balance_unreadable: 'That person’s AI tokens could not be read, so the sponsor was not changed. Try again shortly.',
} as const;

const no = (status: number, code: keyof typeof SPONSOR_WORDS): SponsorRefusal => ({ status, code, message: SPONSOR_WORDS[code] });

/** Why `target` cannot sponsor an agent of scope `s`, or null when they can. */
export async function sponsorRefusal(env: Env, s: Scope, target: User,
  tokensLeft: (env: Env, userId: number) => Promise<boolean | null> = defaultTokensLeft): Promise<SponsorRefusal | null> {
  if (!(await onTeam(env, s, target.id))) return no(422, 'sponsor_not_member');
  if (!(await canManage(env, s, target))) return no(422, 'sponsor_cannot_manage');
  if (!planOk(target)) return no(422, 'sponsor_plan_required');
  const left = await tokensLeft(env, target.id);
  if (left === null) return no(503, 'sponsor_balance_unreadable');
  if (!left) return no(422, 'sponsor_no_tokens');
  return null;
}

/** `YYYY-MM-DD HH:MM:SS` → the first day of the next UTC month, `YYYY-MM-DD`; null for an unreadable instant. */
export function nextMonthDay(at: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(String(at ?? ''));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`;
}

/** The day a cap-paused agent resumes (`YYYY-MM-DD`, UTC); null for any other agent or an unreadable pause. */
export async function capResumesAt(env: Env, a: Pick<AgentRow, 'id' | 'status' | 'paused_reason'>): Promise<string | null> {
  if (a.status !== 'paused' || a.paused_reason !== 'cap') return null;
  try {
    // When it was paused: its latest `paused` event, else its row's `updated_at` (the same expression as the sweep's).
    const row = await env.DB.prepare(
      `SELECT COALESCE((SELECT MAX(e.created_at) FROM team_agent_events e WHERE e.agent_id = a.id AND e.kind = 'paused'), a.updated_at) AS at
         FROM team_agents a WHERE a.id = ?`,
    ).bind(a.id).first<{ at: string | null }>();
    return nextMonthDay(row?.at);
  } catch { return null; }
}

/** At most this many of a team's members are checked as possible sponsors. */
export const CANDIDATES_MAX = 100;

/**
 * The team's members who hold a seat, as `users` rows (active accounts only):
 * a company's `user_company_links`, a project's accepted members and its
 * founder-owner, the seats `onTeam` counts. Ordered by name.
 */
export async function teamMembers(env: Env, s: Scope): Promise<User[]> {
  const rows = s.kind === 'company'
    ? await env.DB.prepare(
      `SELECT u.* FROM users u JOIN user_company_links l ON l.user_id = u.id
        WHERE l.company_id = ? AND u.is_active = 1 GROUP BY u.id ORDER BY u.name, u.id LIMIT ?`,
    ).bind(s.id, CANDIDATES_MAX).all<User>()
    : await env.DB.prepare(
      `SELECT u.* FROM users u
        WHERE u.is_active = 1 AND (
          u.id IN (SELECT m.user_id FROM project_members m WHERE m.project_id = ? AND m.status = 'accepted')
          OR (u.role = 'founder' AND u.founder_id IS NOT NULL AND u.founder_id = ?))
        ORDER BY u.name, u.id LIMIT ?`,
    ).bind(s.id, s.founder_id ?? -1, CANDIDATES_MAX).all<User>();
  return rows.results ?? [];
}

export const CAP_RESUME_MAX = 60;

/**
 * Resume the agents paused at their cap in an earlier UTC month than `now`'s,
 * at most `CAP_RESUME_MAX` a sweep. The update re-checks `paused_reason =
 * 'cap'`, so a pause a person made meanwhile is never undone.
 */
export async function resumeCapPauses(env: Env, now: Date): Promise<number> {
  const rows = (await env.DB.prepare(
    `SELECT a.id FROM team_agents a
      WHERE a.status = 'paused' AND a.paused_reason = 'cap'
        AND COALESCE((SELECT MAX(e.created_at) FROM team_agent_events e WHERE e.agent_id = a.id AND e.kind = 'paused'), a.updated_at) < ?
      ORDER BY a.id LIMIT ?`,
  ).bind(monthStart(now), CAP_RESUME_MAX).all<{ id: number }>()).results ?? [];
  let resumed = 0;
  for (const r of rows) {
    const u = await env.DB.prepare(
      "UPDATE team_agents SET status = 'active', paused_reason = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'paused' AND paused_reason = 'cap'",
    ).bind(r.id).run();
    if (!u.meta?.changes) continue;
    await logEvent(env, r.id, null, 'resumed', { reason: 'cap_reset' });
    resumed += 1;
  }
  return resumed;
}
