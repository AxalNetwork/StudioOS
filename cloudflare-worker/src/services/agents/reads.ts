/**
 * D1528 (#3847, E3 of #3742) — the read functions a run's `context` step may
 * call: one per rule book `reads` key (`catalogue.ts` READ_KEYS). A key with
 * no function here is refused `read_unavailable`, never skipped: an agent
 * whose rule book names a read it cannot have does not run on less than it
 * was told it would see.
 *
 * Each read:
 *   - runs as the agent's sponsor, inside the scope: the caller checks the
 *     sponsor still reads the scope (and, for a company agent's project, that
 *     the project is still the company's) before calling any;
 *   - answers `{ untrusted: true, data }` and at most `READ_MAX` bytes of
 *     JSON: what a person typed into a record is data, never instructions;
 *   - never answers an email or a numeric user id.
 *
 * Built: the project and company summaries, the team roster, and the four
 * cycles' records (their activity lines, D690). The others (cap table, data
 * room, research, network, compliance, and the connected tools Mercury,
 * Stripe, GitHub and Vercel) are not built yet and refuse `read_unavailable`.
 *
 * Bound SQL only.
 */
import type { Env } from '../../types';
import type { AgentRow, Scope } from './teams';

export const READ_MAX = 8 * 1024;
export type ReadContext = { scope: Scope; agent: AgentRow; projectId: number | null };
export type ReadResult = { untrusted: true; data: unknown; truncated?: true };
type Reader = (env: Env, c: ReadContext) => Promise<unknown>;

const cut = (v: unknown, n = 600) => (typeof v === 'string' ? v.slice(0, n) : v ?? null);

async function cycleRecords(env: Env, c: ReadContext, cycle: string) {
  if (!c.projectId) return { records: [] };
  const r = await env.DB.prepare(
    `SELECT entity_type, action, details, created_at FROM activity_logs
      WHERE project_id = ? AND entity_type LIKE ? ORDER BY id DESC LIMIT 20`,
  ).bind(c.projectId, `${cycle}.%`).all<{ entity_type: string; action: string; details: string | null; created_at: string }>();
  return { records: (r.results ?? []).map((x) => ({ module: x.entity_type.slice(cycle.length + 1), action: x.action, summary: cut(x.details, 300), at: x.created_at })) };
}

export const READERS: Partial<Record<string, Reader>> = {
  'project.summary': async (env, c) => {
    if (!c.projectId) return null;
    const p = await env.DB.prepare(
      'SELECT name, stage, sector, status, description, problem_statement, solution, why_now FROM projects WHERE id = ?',
    ).bind(c.projectId).first<Record<string, unknown>>();
    return p ? Object.fromEntries(Object.entries(p).map(([k, v]) => [k, cut(v)])) : null;
  },
  'company.profile': async (env, c) => {
    const companyId = c.scope.kind === 'company' ? c.scope.id : c.scope.company_id;
    if (!companyId) return null;
    const p = await env.DB.prepare(
      'SELECT company_name, stage, revenue_range, employee_count, description, website FROM company_profiles WHERE id = ?',
    ).bind(companyId).first<Record<string, unknown>>();
    return p ? Object.fromEntries(Object.entries(p).map(([k, v]) => [k, cut(v)])) : null;
  },
  'team.roster': async (env, c) => {
    const [companyId, projectId] = c.scope.kind === 'company' ? [c.scope.id, null] : [null, c.scope.id];
    const agents = await env.DB.prepare(
      `SELECT role_key, first_name, last_name, status FROM team_agents
        WHERE scope_kind = ? AND IFNULL(company_id, 0) = ? AND IFNULL(project_id, 0) = ? AND status <> 'removed' LIMIT 20`,
    ).bind(c.scope.kind, companyId ?? 0, projectId ?? 0).all<Record<string, unknown>>();
    const people = c.scope.kind === 'company'
      ? (await env.DB.prepare(
        `SELECT u.name, l.role_in_company AS role FROM user_company_links l JOIN users u ON u.id = l.user_id
          WHERE l.company_id = ? AND u.is_active = 1 LIMIT 30`,
      ).bind(c.scope.id).all<Record<string, unknown>>()).results ?? []
      : [];
    return { agents: agents.results ?? [], people };
  },
  'validate.records': (env, c) => cycleRecords(env, c, 'validate'),
  'build.records': (env, c) => cycleRecords(env, c, 'build'),
  'raise.records': (env, c) => cycleRecords(env, c, 'raise'),
  'grow.records': (env, c) => cycleRecords(env, c, 'grow'),
};

export const readAvailable = (key: string) => typeof READERS[key] === 'function';

/** One read, wrapped and cut to `READ_MAX` bytes of JSON. */
export async function readOne(env: Env, key: string, c: ReadContext, readers: Partial<Record<string, Reader>> = READERS): Promise<ReadResult> {
  const f = readers[key];
  if (!f) throw new Error('read_unavailable');
  const data = await f(env, c);
  const text = JSON.stringify(data ?? null);
  if (new TextEncoder().encode(text).length <= READ_MAX) return { untrusted: true, data };
  // Cut by characters until the bytes fit: the cut copy is a string, never half an object.
  let s = text.slice(0, READ_MAX);
  while (new TextEncoder().encode(s).length > READ_MAX - 64) s = s.slice(0, Math.floor(s.length * 0.9));
  return { untrusted: true, data: s, truncated: true };
}
