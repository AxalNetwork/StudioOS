/**
 * D8912 (#8912, under #4536) — a company administrator's read of their own company's skill analytics, mounted at
 * `/api/teams/skills/analytics`.
 *
 *   GET /?company=<uid>[&scope=company&status=&uid=&version=&category=&tag=&role=&model=&from=&to=]
 *       → { company: { uid, name }, coverage, published_evaluation, executions, filters? }
 *
 * WHO. The caller must hold an Owner, Admin or Founder seat, or be the primary admin, in the named company
 * (`canEditAsMember`, the gate that already decides who writes a company's skills, D4161). The uid in the query only
 * says which of the caller's companies is meant; the seat is read from `user_company_links`, never taken from the
 * client. A platform admin with no seat is not let in: HQ reads the catalogue at `/api/admin/ai-agents/skills`.
 *   400 company_required   no company, or more than one
 *   404 not_found          no such company, or the caller holds no seat in it (another company is never confirmed)
 *   403 not_company_admin  a member of the company without an Owner, Admin or Founder seat
 *   400 the filter codes of `parseSkillFilters` (SKILL_ANALYTICS_METRICS.md § Filters); `scope` takes `company`
 *   404 team_agents_off    while `TEAM_AGENTS_ENABLED` is off, as every team skill route
 *
 * WHAT. The HQ read's measures, never a copy: `catalogueCoverage`, `skillExecutions` and the filters of
 * `services/agents/skillCoverage.ts` and `skillExecutions.ts`, with `subject: 'company'`. Every read is narrowed to
 * this company's skills in SQL (`COMPANY_COVERAGE_SQL`, `COMPANY_LINKS_SQL`, `COMPANY_EXECUTIONS_SQL`,
 * `COMPANY_OUTCOMES_SQL`), so no HQ draft and no other company's uid, slug or count is read out. The window, the
 * filters, the integer micro-USD charge and the `{ available: false }` rules are the HQ read's.
 *   - `published_evaluation` is `{ available: false }`: the published history is written for Axal skills only
 *     (`evaluatePublished`), and release evidence for company versions follows #4533.
 *   - `coverage.sources`, `coverage.drafts.without_current_evaluation` and `coverage.overlap` are HQ measures and
 *     read `{ available: false }`; workflows wait on #4535.
 * Nothing is written: no ledger, no audit row. #3851's proposal board is not read.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { canEditAsMember } from '../services/companyAccess';
import { taxonomyMaps } from '../services/agents/skillLinks';
import { ROLES } from '../services/agents/catalogue';
import { RADAR_AXES } from '../services/skillsTaxonomySchema';
import {
  COMPANY_COVERAGE_SQL, COMPANY_LINKS_SQL, FILTER_MODEL_IDS, adoptionOf, catalogueCoverage, filtersApplied, matchesSkill, parseSkillFilters,
  type CoverageRow, type SkillFilters, type SkillLinkRow, type Unavailable,
} from '../services/agents/skillCoverage';
import {
  COMPANY_EXECUTIONS_SQL, COMPANY_OUTCOMES_SQL, EXECUTION_LATENCY_SQL, executionsWindow, skillExecutions,
  type ExecutionRow, type LatencyRow, type OutcomeRow,
} from '../services/agents/skillExecutions';
import { teamAgentsEnabled } from './team_agents';
import agentEngineRoutes from './agent_engine';

type C = Context<{ Bindings: Env }>;
type Company = { id: number; uid: string; company_name: string };

const teamSkillAnalytics = new Hono<{ Bindings: Env }>();
const say = (c: C, status: number, code: string, message: string) => refuse(c, status, { code, message });

/** The named company, when the caller is one of its editors; otherwise the refusal to send. */
async function companyOfEditor(c: C, user: User): Promise<{ ok: true; company: Company } | { ok: false; res: Response }> {
  const uids = c.req.queries('company') ?? [];
  if (uids.length !== 1 || !uids[0]) return { ok: false, res: say(c, 400, 'company_required', 'Name one of your companies: ?company=<uid>.') };
  const company = await c.env.DB.prepare('SELECT id, uid, company_name FROM company_profiles WHERE uid = ?').bind(uids[0]).first<Company>();
  const none = { ok: false as const, res: say(c, 404, 'not_found', 'There is no such company.') };
  if (!company) return none;
  if (await canEditAsMember(c.env, company, user)) return { ok: true, company };
  // Not an editor. A seat with another role is told why; no seat at all reads as no company, so another company's
  // existence is never confirmed.
  const seat = await c.env.DB.prepare('SELECT 1 AS ok FROM user_company_links WHERE company_id = ? AND user_id = ?').bind(company.id, user.id).first();
  if (!seat) return none;
  return { ok: false, res: say(c, 403, 'not_company_admin', 'Only an Owner, Admin, Founder or the primary admin of this company can read its skill analytics.') };
}

/** Coverage over this company's skills: two reads, both narrowed to it in SQL. */
async function companyCoverage(env: Env, companyId: number, category: ReadonlyMap<string, string>, filters: SkillFilters | null) {
  const [read, links] = await Promise.all([
    env.DB.prepare(COMPANY_COVERAGE_SQL).bind(companyId).all<CoverageRow>(),
    env.DB.prepare(COMPANY_LINKS_SQL).bind(companyId).all<SkillLinkRow>(),
  ]);
  const all = read.results ?? [];
  const rows = filters ? all.filter((r) => matchesSkill(r, filters, category, 'company')) : all;
  const coverage = catalogueCoverage(rows, {
    subject: 'company', category, roleKeys: ROLES.map((r) => r.key), librarySlugs: [],
    adoption: adoptionOf(links.results ?? [], rows, 'company'), draftsWithoutCurrentEvaluation: null, filtered: filters != null,
  });
  const overlap: Unavailable = { available: false, reason: 'Overlap compares Axal\'s published skills only.' };
  return { block: { ...coverage, overlap }, rows };
}

/** Executions over this company's skills: the HQ read's three reads, each narrowed to it in SQL. */
async function companyExecutions(env: Env, companyId: number, category: ReadonlyMap<string, string>, filters: SkillFilters | null, published: readonly CoverageRow[]) {
  const window = executionsWindow(filters, new Date());
  const model = filters?.model ?? null, version = filters?.version ?? null;
  let rows: ExecutionRow[];
  try {
    rows = (await env.DB.prepare(COMPANY_EXECUTIONS_SQL).bind(window.since, window.until, model, model, companyId).all<ExecutionRow>()).results ?? [];
  } catch {
    return { available: false, reason: 'The completed-run history could not be read.', window } as const;
  }
  const ctx = { filters, category, window, published, subject: 'company' as const };
  const kept = skillExecutions(rows, [], ctx);
  const ids = [...new Set(rows.filter((r) => r.uid && kept.skills.some((s) => s.skill_uid === r.uid)).map((r) => Number(r.skill_id)))];
  let latency: LatencyRow[] | 'unreadable' = [];
  if (ids.length) {
    try {
      latency = (await env.DB.prepare(EXECUTION_LATENCY_SQL).bind(JSON.stringify(ids), window.since, window.until, model, model, version, version).all<LatencyRow>()).results ?? [];
    } catch { latency = 'unreadable'; }
  }
  let outcomes: OutcomeRow[] | 'unreadable';
  try {
    outcomes = (await env.DB.prepare(COMPANY_OUTCOMES_SQL).bind(companyId, window.since, window.until).all<OutcomeRow>()).results ?? [];
  } catch { outcomes = 'unreadable'; }
  return skillExecutions(rows, latency, { ...ctx, outcomes });
}

const NOT_EVALUATED: Unavailable = {
  available: false,
  reason: 'No published-version evaluation runs on a company skill: the published history is written for Axal skills only, and release evidence for company versions follows #4533.',
};

teamSkillAnalytics.get('/', async (c) => {
  if (!teamAgentsEnabled(c.env)) return c.json({ error: 'team_agents_off' }, 404);
  const user = await requireAuth(c);
  const who = await companyOfEditor(c, user);
  if (!who.ok) return who.res;
  const { company } = who;
  const tax = await taxonomyMaps(c.env);
  const parsed = parseSkillFilters(c.req.queries(), {
    categories: RADAR_AXES.map((a) => a.slug), tags: tax.category, roleKeys: ROLES.map((r) => r.key), modelIds: FILTER_MODEL_IDS,
    allowed: ['company'], scope: 'company',
  });
  if (!parsed.ok) return say(c, 400, parsed.code, parsed.message);
  const filters = parsed.filters;
  const coverage = await companyCoverage(c.env, company.id, tax.category, filters);
  const executions = await companyExecutions(c.env, company.id, tax.category, filters, coverage.rows);
  let applied = null;
  if (filters) {
    // The HQ read's `filters`, without its paged `skills` entry: this read serves no skill list.
    const f = filtersApplied(filters);
    applied = { applied: f.applied, window: f.window, coverage: f.coverage, published_evaluation: f.published_evaluation, executions: f.executions };
  }
  return c.json({
    company: { uid: company.uid, name: company.company_name },
    coverage: coverage.block, published_evaluation: NOT_EVALUATED, executions,
    ...(applied ? { filters: applied } : {}),
  });
});

// Ahead of `agent_engine.ts`, the first `/api/teams` router: the team routers below answer `/skills/:uid`.
export const mount: RouteMount = { path: '/api/teams/skills/analytics', router: teamSkillAnalytics, before: [agentEngineRoutes] };
export default teamSkillAnalytics;
