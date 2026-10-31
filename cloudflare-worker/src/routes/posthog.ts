/**
 * D1385 (#3731, #2409 part 1) — "Your PostHog projects": the one PostHog
 * project each venture reads, chosen by the member whose PostHog it is.
 * Mounted at `/api/connectors` ahead of the generic integrations routes.
 *
 *   GET /:uid/posthog-projects   the ventures in the companies this
 *       connection is switched on for, each with its linked project, or the
 *       teammate whose PostHog already serves it, and the member's PostHog
 *       projects to choose from (`projects-get`). A failed PostHog read
 *       blanks only the choices: the ventures still answer.
 *   PUT /:uid/posthog-projects   link one venture to one of the member's
 *       PostHog projects, or unlink it (`posthog_project_id: null`).
 *
 * WHO. The connection's own member only (`uid` and `user_id` both match);
 * a support session is refused, as Notion's routes refuse one. A link needs
 * write access to the venture and the connection switched on for its
 * company. A venture reads one PostHog project: another member's link is
 * named, never replaced. The project must be one the member's own PostHog
 * lists, so nobody links a project they cannot open.
 *
 * WHAT IS LOGGED. Counts and outcomes only: the venture and integration ids
 * in `activity_logs`, never a project name or anything PostHog sent.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, selectJwt } from '../auth';
import { canAccessProject } from '../services/projectAccess';
import { enabledCompanyIds, projectEnabled } from '../integrations/companyScope';
import type { IntegrationRow } from '../integrations/registry';
import { PosthogReadError, posthogProjectId, posthogReadsFor, type PosthogFetch, type PosthogProject } from '../services/posthog/reads';
import { hashEmail } from '../util/hashEmail';

type C = Context<{ Bindings: Env }>;

class Refused extends Error {
  status: number; code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}

/** Each refusal's sentence, written here: never PostHog's text. */
export const SENTENCES: Record<string, string> = {
  support_session_refused: 'A support session cannot read or change a member’s PostHog.',
  not_found: 'That connection is not one of yours.',
  posthog_not_connected: 'PostHog is not connected. Sign in with PostHog first.',
  invalid_project: 'Choose a venture.',
  project_not_available: 'You cannot change this venture’s connections.',
  company_not_enabled: 'Your PostHog is not switched on for this venture’s company. Switch it on on this page.',
  bad_id: 'That is not a PostHog project.',
  project_not_yours: 'That project is not one your PostHog lists. Choose one from the list.',
  venture_served: 'A teammate’s PostHog already serves this venture. They can unlink it.',
  sign_in_again: 'PostHog asked you to sign in again.',
  rate_limited: 'PostHog asked us to wait. Try again in a minute.',
  posthog_unreadable: 'PostHog could not be read. Try again.',
  posthog_failed: 'PostHog could not be read or saved. Try again.',
};

const readRefusal = (e: PosthogReadError): Refused =>
  e.code === 'not_connected' ? new Refused(409, 'posthog_not_connected')
    : e.code === 'unauthorized' ? new Refused(409, 'sign_in_again')
      : e.code === 'rate_limited' ? new Refused(429, 'rate_limited')
        : e.code === 'bad_id' ? new Refused(400, 'bad_id') : new Refused(502, 'posthog_unreadable');

function fail(c: C, e: unknown) {
  if (e instanceof Error && ['Unauthorized', 'Forbidden'].includes(e.message)) throw e;
  let r: Refused;
  if (e instanceof Refused) r = e;
  else if (e instanceof PosthogReadError) r = readRefusal(e);
  else {
    console.error('[posthog] route failed:', (e as Error)?.name);
    r = new Refused(503, 'posthog_failed');
  }
  return c.json({ error: r.code, detail: SENTENCES[r.code] ?? SENTENCES.posthog_failed }, r.status as any);
}

export interface PosthogRouteDeps { fetcher?: PosthogFetch }

interface Venture { id: number; name: string | null; company_id: number; founder_id: number | null }
interface LinkRow { project_id: number; integration_id: number; posthog_project_id: string; posthog_project_name: string | null; posthog_org_id: string | null; region: string | null; linked_at: string; owner_name: string | null }

export function createPosthogRouter(deps: PosthogRouteDeps = {}) {
  const router = new Hono<{ Bindings: Env }>();

  const route = (fn: (c: C, user: User) => Promise<Response>) => async (c: C) => {
    try { return await fn(c, await requireAuth(c)); } catch (e) { return fail(c, e); }
  };

  /** The caller's own PostHog connection by uid, active; a support session is refused first. */
  async function connection(c: C, user: User): Promise<IntegrationRow> {
    if ((await selectJwt(c))?.payload?.impersonated_by) throw new Refused(403, 'support_session_refused');
    const uid = c.req.param('uid') || '';
    if (!/^[A-Za-z0-9-]{8,64}$/.test(uid)) throw new Refused(404, 'not_found');
    const row = await c.env.DB.prepare("SELECT * FROM integrations WHERE uid = ? AND user_id = ? AND provider_key = 'posthog'")
      .bind(uid, user.id).first<IntegrationRow>();
    if (!row) throw new Refused(404, 'not_found');
    if (row.status !== 'active') throw new Refused(409, 'posthog_not_connected');
    return row;
  }

  /** The ventures in the connection's switched-on companies that the member may write. */
  async function ventures(c: C, user: User, row: IntegrationRow): Promise<Venture[]> {
    const companies = await enabledCompanyIds(c.env, Number(row.id));
    if (!companies.length) return [];
    const r = await c.env.DB.prepare(
      'SELECT id, name, company_id, founder_id FROM projects WHERE deleted_at IS NULL ' +
      'AND company_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?)) ORDER BY company_id, name, id LIMIT 200',
    ).bind(JSON.stringify(companies)).all<Venture>();
    const out: Venture[] = [];
    for (const p of r.results || []) if (user.role !== 'admin' && await canAccessProject(c.env, user, p, { write: true })) out.push(p);
    return out;
  }

  async function linksFor(c: C, ids: number[]): Promise<Map<number, LinkRow>> {
    const out = new Map<number, LinkRow>();
    if (!ids.length) return out;
    const r = await c.env.DB.prepare(
      'SELECT l.project_id, l.integration_id, l.posthog_project_id, l.posthog_project_name, l.posthog_org_id, l.region, l.linked_at, ' +
      'COALESCE(u.display_name, u.name) AS owner_name FROM posthog_project_links l ' +
      'JOIN integrations i ON i.id = l.integration_id JOIN users u ON u.id = i.user_id ' +
      'WHERE l.project_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))',
    ).bind(JSON.stringify(ids)).all<LinkRow>();
    for (const l of r.results || []) out.set(Number(l.project_id), l);
    return out;
  }

  router.get('/:uid/posthog-projects', route(async (c, user) => {
    const row = await connection(c, user);
    const list = await ventures(c, user, row);
    const links = await linksFor(c, list.map((v) => v.id));
    let choices: PosthogProject[] | null = null;
    let choicesError: string | null = null;
    try {
      choices = await (await posthogReadsFor(c.env, row, { fetcher: deps.fetcher })).projects();
    } catch (e) {
      if (!(e instanceof PosthogReadError)) throw e;
      const r = readRefusal(e);
      choicesError = r.code;
      console.warn('[posthog] projects unreadable', { outcome: r.code });
    }
    const mine = Number(row.id);
    return c.json({
      ok: true,
      ventures: list.map((v) => {
        const l = links.get(v.id);
        const own = l && Number(l.integration_id) === mine;
        return {
          project_id: v.id,
          name: v.name,
          company_id: v.company_id,
          link: own ? { posthog_project_id: l!.posthog_project_id, name: l!.posthog_project_name, region: l!.region, organization_id: l!.posthog_org_id, linked_at: l!.linked_at } : null,
          served_by: l && !own ? { name: l.owner_name || null } : null,
        };
      }),
      choices,
      choices_error: choicesError ? { code: choicesError, detail: SENTENCES[choicesError] } : null,
    });
  }));

  router.put('/:uid/posthog-projects', route(async (c, user) => {
    const row = await connection(c, user);
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const projectId = Number(body?.project_id);
    if (!Number.isSafeInteger(projectId) || projectId <= 0) throw new Refused(400, 'invalid_project');
    const venture = await c.env.DB.prepare('SELECT id, name, company_id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL')
      .bind(projectId).first<Venture>();
    if (user.role === 'admin' || !venture || !(await canAccessProject(c.env, user, venture, { write: true }))) throw new Refused(403, 'project_not_available');
    if (!(await projectEnabled(c.env, Number(row.id), projectId))) throw new Refused(409, 'company_not_enabled');
    const existing = (await linksFor(c, [projectId])).get(projectId);
    const mine = Number(row.id);
    if (existing && Number(existing.integration_id) !== mine) throw new Refused(409, 'venture_served');
    const actor = await hashEmail(user.email);

    if (body?.posthog_project_id === null) {
      await c.env.DB.batch([
        c.env.DB.prepare('DELETE FROM posthog_project_links WHERE project_id = ? AND integration_id = ?').bind(projectId, mine),
        c.env.DB.prepare('INSERT INTO activity_logs (user_id, actor, action, details) VALUES (?, ?, ?, ?)')
          .bind(user.id, actor, 'posthog_project_unlinked', JSON.stringify({ integration_id: mine, project_id: projectId })),
      ]);
      return c.json({ ok: true, project_id: projectId, link: null });
    }

    const wanted = posthogProjectId(body?.posthog_project_id);
    const projects = await (await posthogReadsFor(c.env, row, { fetcher: deps.fetcher })).projects();
    const chosen = projects.find((p) => p.id === wanted);
    if (!chosen) throw new Refused(400, 'project_not_yours');
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO posthog_project_links (uid, integration_id, project_id, posthog_org_id, posthog_project_id, posthog_project_name, region, linked_by) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET posthog_org_id = excluded.posthog_org_id, ' +
        'posthog_project_id = excluded.posthog_project_id, posthog_project_name = excluded.posthog_project_name, region = excluded.region, ' +
        "linked_by = excluded.linked_by, linked_at = datetime('now'), updated_at = datetime('now') WHERE posthog_project_links.integration_id = excluded.integration_id",
      ).bind(crypto.randomUUID(), mine, projectId, chosen.organization_id, chosen.id, chosen.name, chosen.region, user.id),
      c.env.DB.prepare('INSERT INTO activity_logs (user_id, actor, action, details) VALUES (?, ?, ?, ?)')
        .bind(user.id, actor, 'posthog_project_linked', JSON.stringify({ integration_id: mine, project_id: projectId })),
    ]);
    const link = (await linksFor(c, [projectId])).get(projectId);
    if (!link || Number(link.integration_id) !== mine) throw new Refused(409, 'venture_served');
    return c.json({ ok: true, project_id: projectId, link: { posthog_project_id: link.posthog_project_id, name: link.posthog_project_name, region: link.region, organization_id: link.posthog_org_id, linked_at: link.linked_at } });
  }));

  return router;
}

const posthogRouter = createPosthogRouter();
export default posthogRouter;
