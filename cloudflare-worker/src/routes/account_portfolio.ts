/**
 * D1415 (#3697, part 2) — the Portfolio reads. Mounted at /api beside
 * `account_companies.ts`.
 *
 *   GET /api/account/switcher                              — companies with their projects nested,
 *                                                            standalone projects, and seated projects
 *                                                            in companies the caller does not belong to
 *   GET /api/account/settings-scope?company=<uid>&project=<id>
 *                                                          — which settings apply to the selection
 *   GET /api/account/resolve?path=/c/<a>[/p/<b>] | /p/<b>  — a path to its company and project
 *
 * WHO SEES WHAT. A company is the caller's when they hold a link to it; a
 * platform admin reads any. A project is visible when the caller owns it or
 * holds an accepted seat on it (`account_companies.ts`'s rule, never every
 * venture), when they belong to its company, or when they are a platform admin.
 * Anything else reads 404, the same answer as a path that names nothing.
 *
 * Archived companies (D1137) are left out of the switcher and do not resolve.
 *
 * A block whose store failed is `{ available: false, reason }`, never a zero
 * or an empty list. The server's project scope does not change here: the
 * selection of a project is client state, as the active company is.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { isAdmin, mapError } from './_t13t14t15_helpers';
import { ensureProjectMembershipSchema } from '../services/projectAccess';
import { refuse } from '../util/refusal';
import { companyPath, projectPath } from '../services/slugs';

type Row = Record<string, any>;
type Block<T> = { available: true; value: T } | { available: false; reason: string };
const ok = <T>(value: T): Block<T> => ({ available: true, value });
const failed = (what: string): Block<never> => ({ available: false, reason: `${what} could not be read. That is not the same as none.` });

async function rows(env: Env, what: string, sql: string, binds: unknown[]): Promise<Block<Row[]>> {
  try {
    const r: any = await env.DB.prepare(sql).bind(...binds).all();
    if (!Array.isArray(r?.results)) throw new Error('rows were not returned');
    return ok(r.results);
  } catch (e) {
    console.warn('[account_portfolio] unreadable', what, (e as Error)?.message);
    return failed(what);
  }
}

const r = new Hono<{ Bindings: Env }>();

const MY_COMPANIES_SQL = `SELECT cp.id, cp.uid, cp.company_name, cp.slug, cp.legal_form,
    l.role_in_company AS my_role, l.is_primary_admin
  FROM user_company_links l JOIN company_profiles cp ON cp.id = l.company_id
  WHERE l.user_id = ? AND cp.archived_at IS NULL
  ORDER BY l.is_primary_admin DESC, l.created_at ASC, cp.id ASC`;

// Owned (by founder_id) or seated (accepted, not removed): account_companies.ts's rule.
const MY_PROJECTS_SQL = `SELECT p.id, p.uid, p.name, p.slug, p.company_id,
    cp.uid AS company_uid, cp.slug AS company_slug, cp.company_name, cp.archived_at AS company_archived_at,
    CASE WHEN p.founder_id IS NOT NULL AND p.founder_id = ? THEN 'owner' ELSE pm.role END AS my_seat
  FROM projects p
  LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ? AND pm.status = 'accepted' AND pm.removed_at IS NULL
  LEFT JOIN company_profiles cp ON cp.id = p.company_id
  WHERE p.deleted_at IS NULL AND ((p.founder_id IS NOT NULL AND p.founder_id = ?) OR pm.id IS NOT NULL)
  ORDER BY p.created_at DESC, p.id DESC`;

const companyDto = (c: Row) => ({
  uid: c.uid, name: c.company_name, slug: c.slug ?? null, path: companyPath({ uid: c.uid, slug: c.slug ?? null }),
  legal_form: c.legal_form ?? null, my_role: c.my_role, is_primary_admin: !!c.is_primary_admin,
});

const projectDto = (p: Row) => {
  const company = p.company_id != null ? { uid: p.company_uid, slug: p.company_slug ?? null } : null;
  return {
    id: Number(p.id), uid: p.uid, name: p.name, slug: p.slug ?? null,
    path: projectPath({ id: Number(p.id), slug: p.slug ?? null }, company), my_seat: p.my_seat ?? null,
  };
};

r.get('/account/switcher', async (c) => {
  try {
    const user = await requireAuth(c);
    await ensureProjectMembershipSchema(c.env);
    const companies = await rows(c.env, 'Your companies', MY_COMPANIES_SQL, [user.id]);
    if (!companies.available) return refuse(c, 503, { code: 'switcher_unreadable', message: 'Your companies could not be read. That is not the same as none.' });
    const projects = await rows(c.env, 'Your projects', MY_PROJECTS_SQL, [user.founder_id ?? null, user.id, user.founder_id ?? null]);
    const mine = new Set(companies.value.map((co) => Number(co.id)));
    const under = (id: number): Block<ReturnType<typeof projectDto>[]> => (projects.available
      ? ok(projects.value.filter((p) => Number(p.company_id) === id).map(projectDto))
      : projects);
    return c.json({
      companies: companies.value.map((co) => ({ ...companyDto(co), projects: under(Number(co.id)) })),
      standalone: projects.available ? ok(projects.value.filter((p) => p.company_id == null).map(projectDto)) : projects,
      // Seated projects whose company the caller does not belong to (or that is archived).
      elsewhere: projects.available
        ? ok(projects.value.filter((p) => p.company_id != null && !mine.has(Number(p.company_id)))
          .map((p) => ({ ...projectDto(p), company_name: p.company_name ?? null })))
        : projects,
      create: { company: '/api/company/create', project: '/api/projects' },
    });
  } catch (e) { return mapError(c, e); }
});

// ── Visibility ──────────────────────────────────────────────────────────────

type CompanyRow = { id: number; uid: string; company_name: string; slug: string | null; archived_at: string | null };
type ProjectRow = { id: number; uid: string; name: string; slug: string | null; company_id: number | null; founder_id: number | null };

async function isMemberOf(env: Env, user: User, companyId: number): Promise<boolean> {
  if (isAdmin(user)) return true;
  return !!(await env.DB.prepare('SELECT 1 FROM user_company_links WHERE company_id = ? AND user_id = ?').bind(companyId, user.id).first());
}

/** The caller owns or sits on the project, belongs to its company, or is a platform admin. */
async function canSeeProject(env: Env, user: User, p: ProjectRow): Promise<boolean> {
  if (isAdmin(user)) return true;
  if (user.founder_id != null && p.founder_id != null && Number(p.founder_id) === Number(user.founder_id)) return true;
  await ensureProjectMembershipSchema(env);
  const seat = await env.DB.prepare(
    "SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ? AND status = 'accepted' AND removed_at IS NULL",
  ).bind(p.id, user.id).first();
  if (seat) return true;
  return p.company_id != null && (await isMemberOf(env, user, p.company_id));
}

const companyById = (env: Env, id: number) =>
  env.DB.prepare('SELECT id, uid, company_name, slug, archived_at FROM company_profiles WHERE id = ?').bind(id).first<CompanyRow>();
const projectById = (env: Env, id: number) =>
  env.DB.prepare('SELECT id, uid, name, slug, company_id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(id).first<ProjectRow>();

// ── Settings scope ──────────────────────────────────────────────────────────

type Tab = { key: string; label: string; path: string; available: boolean; reason?: string; children?: Tab[] };

const BILLING_REASON = 'Billing is per account today. It is in Account › Billing.';

function companyTabs(base: string, projects: ProjectRow[], company: CompanyRow): Tab[] {
  const t = (key: string, label: string): Tab => ({ key, label, path: `${base}/settings/${key}`, available: true });
  return [
    t('general', 'General'),
    t('legal', 'Legal'),
    t('team', 'Team'),
    // Owner question B, answer a: billing is per account, so the tab points there.
    { key: 'billing', label: 'Billing', path: '/account/billing', available: false, reason: BILLING_REASON },
    {
      ...t('projects', 'Projects'),
      children: projects.map((p) => ({
        key: `projects:${p.id}`, label: p.name, path: `${projectPath(p, company)}/settings/general`, available: true,
      })),
    },
  ];
}

function projectTabs(base: string): Tab[] {
  const t = (key: string, label: string): Tab => ({ key, label, path: `${base}/settings/${key}`, available: true });
  return [
    t('general', 'General'),
    t('team', 'Team'),
    { key: 'billing', label: 'Billing', path: '/account/billing', available: false, reason: BILLING_REASON },
  ];
}

const notFound = (c: any) => refuse(c, 404, { code: 'not_found', message: 'That company or project was not found.' });

r.get('/account/settings-scope', async (c) => {
  try {
    const user = await requireAuth(c);
    const companyUid = c.req.query('company') || null;
    const projectRaw = c.req.query('project') || null;
    if (!companyUid && !projectRaw) {
      return refuse(c, 400, { code: 'scope_missing', message: 'Name a company, a project, or both.' });
    }

    let company: CompanyRow | null = null;
    if (companyUid) {
      company = await c.env.DB.prepare('SELECT id, uid, company_name, slug, archived_at FROM company_profiles WHERE uid = ?')
        .bind(companyUid).first<CompanyRow>();
      if (!company || !(await isMemberOf(c.env, user, company.id))) return notFound(c);
    }

    let project: ProjectRow | null = null;
    if (projectRaw) {
      const id = Number(projectRaw);
      project = Number.isSafeInteger(id) && id > 0 ? await projectById(c.env, id) : null;
      if (!project || !(await canSeeProject(c.env, user, project))) return notFound(c);
      if (company && project.company_id !== company.id) {
        return refuse(c, 409, { code: 'project_not_in_company', message: 'That project is not in that company.' });
      }
      // A project in a company the caller belongs to opens inside that company's settings.
      if (!company && project.company_id != null) {
        const own = await companyById(c.env, project.company_id);
        if (own && await isMemberOf(c.env, user, own.id)) company = own;
      }
    }

    if (company) {
      const list = await rows(c.env, 'The company\'s projects',
        'SELECT id, uid, name, slug, company_id, founder_id FROM projects WHERE company_id = ? AND deleted_at IS NULL ORDER BY name, id', [company.id]);
      const base = companyPath(company);
      const tabs = companyTabs(base, list.available ? (list.value as ProjectRow[]) : [], company);
      if (!list.available) {
        const i = tabs.findIndex((t) => t.key === 'projects');
        tabs[i] = { ...tabs[i], available: false, reason: list.reason, children: [] };
      }
      return c.json({
        scope: project ? 'company_project' : 'company',
        label: 'Company settings',
        company: { uid: company.uid, name: company.company_name, slug: company.slug, path: base, archived: company.archived_at != null },
        project: project ? { id: project.id, uid: project.uid, name: project.name, slug: project.slug, path: projectPath(project, company) } : null,
        open_tab: project ? `projects:${project.id}` : 'general',
        tabs,
      });
    }

    // A standalone project, or one in a company the caller does not belong to.
    const owner = project!.company_id != null ? await companyById(c.env, project!.company_id) : null;
    const path = projectPath(project!, owner);
    return c.json({
      scope: 'project',
      label: 'Project settings',
      company: null,
      project: { id: project!.id, uid: project!.uid, name: project!.name, slug: project!.slug, path },
      open_tab: 'general',
      tabs: projectTabs(path),
    });
  } catch (e) { return mapError(c, e); }
});

// ── Resolve a path ──────────────────────────────────────────────────────────

const SEGMENT = /^[A-Za-z0-9-]{1,64}$/;

/** `/c/<a>`, `/c/<a>/p/<b>` or `/p/<b>`; null for anything else. */
function parsePath(raw: string): { company: string | null; project: string | null } | null {
  const clean = raw.split(/[?#]/)[0].replace(/\/+$/, '');
  const parts = clean.split('/').slice(1);
  if (parts.length === 2 && parts[0] === 'c' && SEGMENT.test(parts[1])) return { company: parts[1], project: null };
  if (parts.length === 4 && parts[0] === 'c' && parts[2] === 'p' && SEGMENT.test(parts[1]) && SEGMENT.test(parts[3])) return { company: parts[1], project: parts[3] };
  if (parts.length === 2 && parts[0] === 'p' && SEGMENT.test(parts[1])) return { company: null, project: parts[1] };
  return null;
}

const retired = (env: Env, kind: 'company' | 'project', scope: number, slug: string) =>
  env.DB.prepare('SELECT target_id FROM slug_history WHERE kind = ? AND ifnull(scope_company_id, 0) = ? AND slug = ?')
    .bind(kind, scope, slug).first<{ target_id: number }>();

/** A company by its current slug, its uid, or a slug it retired. */
async function companyBySegment(env: Env, seg: string): Promise<CompanyRow | null> {
  const bySlug = await env.DB.prepare('SELECT id, uid, company_name, slug, archived_at FROM company_profiles WHERE slug = ?').bind(seg.toLowerCase()).first<CompanyRow>();
  if (bySlug) return bySlug;
  const byUid = await env.DB.prepare('SELECT id, uid, company_name, slug, archived_at FROM company_profiles WHERE uid = ?').bind(seg).first<CompanyRow>();
  if (byUid) return byUid;
  const old = await retired(env, 'company', 0, seg.toLowerCase());
  return old ? companyById(env, Number(old.target_id)) : null;
}

/** A project in a scope by its current slug, its id, or a slug it retired there. */
async function projectBySegment(env: Env, seg: string, scopeCompanyId: number | null): Promise<ProjectRow | null> {
  const slug = seg.toLowerCase();
  const bySlug = scopeCompanyId == null
    ? await env.DB.prepare('SELECT id, uid, name, slug, company_id, founder_id FROM projects WHERE company_id IS NULL AND slug = ? AND deleted_at IS NULL').bind(slug).first<ProjectRow>()
    : await env.DB.prepare('SELECT id, uid, name, slug, company_id, founder_id FROM projects WHERE company_id = ? AND slug = ? AND deleted_at IS NULL').bind(scopeCompanyId, slug).first<ProjectRow>();
  if (bySlug) return bySlug;
  if (/^\d+$/.test(seg)) {
    const byId = await projectById(env, Number(seg));
    if (byId) return byId;
  }
  const old = await retired(env, 'project', scopeCompanyId ?? 0, slug);
  return old ? projectById(env, Number(old.target_id)) : null;
}

r.get('/account/resolve', async (c) => {
  try {
    const user = await requireAuth(c);
    const given = c.req.query('path') || '';
    const parsed = parsePath(given);
    if (!parsed) return refuse(c, 400, { code: 'path_invalid', message: 'That is not a company or project address.' });

    let company: CompanyRow | null = null;
    if (parsed.company) {
      company = await companyBySegment(c.env, parsed.company);
      if (!company || company.archived_at || !(await isMemberOf(c.env, user, company.id))) return notFound(c);
    }

    if (!parsed.project) {
      const canonical = companyPath(company!);
      return c.json({ kind: 'company', company_uid: company!.uid, project_id: null, canonical_path: canonical, redirected: canonical !== given.split(/[?#]/)[0].replace(/\/+$/, '') });
    }

    const project = await projectBySegment(c.env, parsed.project, company ? company.id : null);
    if (!project || !(await canSeeProject(c.env, user, project))) return notFound(c);
    // The canonical address is where the project sits now, which a move may have changed.
    const home = project.company_id != null ? await companyById(c.env, project.company_id) : null;
    if (home?.archived_at) return notFound(c);
    const canonical = projectPath(project, home);
    return c.json({
      kind: 'project', company_uid: home?.uid ?? null, project_id: project.id,
      canonical_path: canonical, redirected: canonical !== given.split(/[?#]/)[0].replace(/\/+$/, ''),
    });
  } catch (e) { return mapError(c, e); }
});

export default r;
