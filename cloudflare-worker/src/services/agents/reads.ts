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
 * D4667 (#4667) — EVIDENCE, NOT JUST DATA. A read says what it covers. A collection
 * carries `returned`, `total` and `omitted` (counted, not guessed: `total` is
 * `null` when it could not be counted, never 0); a row carries a stable
 * reference (`activity:<uid>`) and says when its text was clipped; an answer
 * too large for `READ_MAX` drops whole rows from the end and says how many, or
 * says `incomplete`, and is never a JSON substring. An unknown count is
 * unavailable, never zero. The preflight that reads this is `skillInputs.ts`.
 *
 * Bound SQL only.
 */
import type { Env } from '../../types';
import type { AgentRow, Scope } from './teams';

export const READ_MAX = 8 * 1024;
export type ReadContext = { scope: Scope; agent: AgentRow; projectId: number | null };
export type ReadResult = { untrusted: true; data: unknown; truncated?: true; incomplete?: true; reason?: 'too_large' };

/** What one collection in a read covers. `total` is null when it could not be counted. */
export type Coverage = { returned: number; total: number | null; omitted: number | null; complete: boolean };
export const coverageOf = (returned: number, total: number | null): Coverage => ({
  returned, total, omitted: total === null ? null : Math.max(0, total - returned), complete: total !== null && total <= returned,
});
type Reader = (env: Env, c: ReadContext) => Promise<unknown>;

const cut = (v: unknown, n = 600) => (typeof v === 'string' ? v.slice(0, n) : v ?? null);

const RECORD_LIMIT = 20;
const SUMMARY_MAX = 300;

async function cycleRecords(env: Env, c: ReadContext, cycle: string) {
  if (!c.projectId) return { records: [], coverage: coverageOf(0, null), scope: 'no_project' };
  const like = `${cycle}.%`;
  const r = await env.DB.prepare(
    `SELECT uid, entity_type, action, details, created_at FROM activity_logs
      WHERE project_id = ? AND entity_type LIKE ? ORDER BY id DESC LIMIT ?`,
  ).bind(c.projectId, like, RECORD_LIMIT).all<{ uid: string; entity_type: string; action: string; details: string | null; created_at: string }>();
  // The whole count, apart from the latest rows: a total is never inferred from the page.
  const n = await (async () => env.DB.prepare('SELECT COUNT(*) AS n FROM activity_logs WHERE project_id = ? AND entity_type LIKE ?')
    .bind(c.projectId, like).first<{ n: number }>())().catch(() => null);
  const records = (r.results ?? []).map((x) => ({
    ref: `activity:${x.uid}`,
    module: x.entity_type.slice(cycle.length + 1), action: x.action, summary: cut(x.details, SUMMARY_MAX), at: x.created_at,
    ...(typeof x.details === 'string' && x.details.length > SUMMARY_MAX ? { clipped: true } : {}),
  }));
  return { records, coverage: coverageOf(records.length, n && Number.isFinite(Number(n.n)) ? Number(n.n) : null), source: 'activity_logs' };
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

/**
 * What each built reader PROVIDES, so a skill that needs more is told so. The cycle readers answer the
 * latest activity summaries: not a typed ledger, a contract's text or a cohort's rows (#4667).
 */
export const READER_PROVIDES: Readonly<Record<string, 'project_profile' | 'company_profile' | 'roster' | 'activity_summaries'>> = Object.freeze({
  'project.summary': 'project_profile', 'company.profile': 'company_profile', 'team.roster': 'roster',
  'validate.records': 'activity_summaries', 'build.records': 'activity_summaries', 'raise.records': 'activity_summaries', 'grow.records': 'activity_summaries',
});

/** The bytes of a value as JSON. */
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v ?? null)).length;

/**
 * A value over the limit, with whole rows dropped from the end of its lists until it fits, and what was
 * dropped counted. The typed shape stays; `null` when no list can be shortened enough.
 */
function shrink(data: unknown): { data: unknown; dropped: Record<string, number> } | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const copy: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  const lists = Object.keys(copy).filter((k) => Array.isArray(copy[k]));
  if (!lists.length) return null;
  const dropped: Record<string, number> = {};
  const work = Object.fromEntries(lists.map((k) => [k, [...(copy[k] as unknown[])]]));
  const render = () => ({ ...copy, ...work, omitted_for_size: { ...dropped } });
  while (bytes(render()) > READ_MAX - 64) {
    // Take from the longest list, so no one list is emptied while another is long.
    const k = lists.reduce((a, b) => (work[b].length > work[a].length ? b : a));
    if (!work[k].length) return null;
    work[k].pop();
    dropped[k] = (dropped[k] ?? 0) + 1;
  }
  return { data: render(), dropped };
}

/** One read, wrapped to `READ_MAX` bytes of JSON without ever turning it into a substring. */
export async function readOne(env: Env, key: string, c: ReadContext, readers: Partial<Record<string, Reader>> = READERS): Promise<ReadResult> {
  const f = readers[key];
  if (!f) throw new Error('read_unavailable');
  const data = await f(env, c);
  if (bytes(data) <= READ_MAX) return { untrusted: true, data };
  const smaller = shrink(data);
  if (smaller) return { untrusted: true, data: smaller.data, truncated: true };
  // Nothing whole can be dropped: say so, rather than hand the model half a document.
  return { untrusted: true, data: null, incomplete: true, reason: 'too_large' };
}
