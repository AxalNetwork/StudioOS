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
 *   GET /:uid/posthog-insights?project=&q=   D1604: the saved insights of the
 *       venture's linked PostHog project, for "Track a metric" (`insights-list`).
 *
 * D1604 (#3731 part 2): `/api/cycles` (`posthogCycleRoutes`, ahead of the
 * cycle routers so `/:section/posthog` is never read as a module):
 *   GET    /:section/posthog?project=&module=           the module's From PostHog
 *   POST   /:section/posthog/tracked                    { project, module, insight_short_id, role }
 *   DELETE /:section/posthog/tracked/:uid?project=      stop tracking
 *   DELETE /:section/posthog/facts/:id?project=         delete a fact; it stays deleted
 *   POST   /:section/posthog/proposals/:id/accept       { project, … }
 *   POST   /:section/posthog/proposals/:id/dismiss      { project }
 *   POST   /:section/posthog/sync                       { project }  D1605–: the section's founder-pressed sync
 *   GET    /validate/posthog/surveys?project=           D1605: the project's surveys, their questions and marks
 *   PUT    /validate/posthog/surveys/:id/marks          D1605: { project, question_id, question_index, mark | null }
 *
 * WHO, IN A MODULE. Reading From PostHog is the venture's team only (#2409
 * decision C, `isTeamViewer`). Tracking an insight, Accept and Dismiss are the
 * member whose PostHog serves the venture, on a venture they may write,
 * outside a support session: only they can list its insights. Untracking and
 * deleting a fact are any team member who may write the venture.
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
import { isTeamViewer } from '../services/mercury/growFeeds';
// D1605–: each section's sync and acceptors register themselves on import.
import '../services/posthog/validate';
import '../services/posthog/raise';
import '../services/posthog/grow';
import { flagChips, mustHaves, toolsLine } from '../services/posthog/build';
import { MARKS, marksOf, setMark } from '../services/posthog/validate';
import {
  AcceptRefused, MetricsRefused, syncFor, POSTHOG_MODULES, SECTIONS, acceptProposal, deleteFact, dismissProposal, fromPosthog, linkOf, track, untrack,
  type Section,
} from '../services/posthog/metrics';

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
  not_linked: 'Choose a PostHog project for this venture first.',
  not_your_posthog: 'Only the member whose PostHog serves this venture can do this.',
  team_only: 'From the founder’s PostHog: only the venture’s team sees these figures.',
  invalid_section: 'Choose Validate, Build, Raise or Grow.',
  no_sync: 'PostHog does not feed this section yet.',
  invalid_survey: 'That is not a PostHog survey.',
  invalid_question: 'That question is not in this survey.',
  invalid_module: 'Choose a module PostHog feeds.',
  invalid_role: 'Choose what this insight measures.',
  invalid_insight: 'Choose one of your saved insights.',
  insight_not_found: 'That insight is not in this PostHog project. Choose one from the list.',
  metric_not_found: 'That metric is not tracked on this venture.',
  fact_not_found: 'That figure is not on this venture.',
  proposal_not_found: 'That proposal is not on this venture.',
  proposal_decided: 'That proposal was already decided.',
  not_ready: 'This kind of item cannot be accepted yet. Its module’s part adds it.',
};

const readRefusal = (e: PosthogReadError): Refused =>
  e.code === 'not_connected' ? new Refused(409, 'posthog_not_connected')
    : e.code === 'unauthorized' ? new Refused(409, 'sign_in_again')
      : e.code === 'rate_limited' ? new Refused(429, 'rate_limited')
        : e.code === 'bad_id' ? new Refused(400, 'bad_id') : new Refused(502, 'posthog_unreadable');

function fail(c: C, e: unknown) {
  if (e instanceof Error && ['Unauthorized', 'Forbidden'].includes(e.message)) throw e;
  let r: Refused;
  if (e instanceof AcceptRefused) return c.json({ error: e.code, detail: e.detail }, e.status as any);
  if (e instanceof Refused) r = e;
  else if (e instanceof MetricsRefused) r = new Refused(e.status, e.code);
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

  // D1604: the saved insights of the venture's linked project, for "Track a metric".
  router.get('/:uid/posthog-insights', route(async (c, user) => {
    const row = await connection(c, user);
    const projectId = Number(c.req.query('project'));
    if (!Number.isSafeInteger(projectId) || projectId <= 0) throw new Refused(400, 'invalid_project');
    const link = await linkOf(c.env, projectId);
    if (!link || link.integration_id !== Number(row.id)) throw new Refused(409, 'not_linked');
    const reads = await posthogReadsFor(c.env, row, { fetcher: deps.fetcher, projectId: link.posthog_project_id });
    return c.json({ ok: true, project_id: projectId, insights: await reads.insights(c.req.query('q') || undefined) });
  }));

  return router;
}

const posthogRouter = createPosthogRouter();
export default posthogRouter;

// ═════════════════════════════════════════════ D1604: a module's From PostHog

export function createPosthogCycleRouter(deps: PosthogRouteDeps = {}) {
  const router = new Hono<{ Bindings: Env }>();
  const route = (fn: (c: C, user: User) => Promise<Response>) => async (c: C) => {
    try { return await fn(c, await requireAuth(c)); } catch (e) { return fail(c, e); }
  };
  const idOf = (v: unknown, code: string) => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw new Refused(400, code); return n; };
  const bodyOf = async (c: C) => { const b = await c.req.json().catch(() => null); return b && typeof b === 'object' && !Array.isArray(b) ? b as Record<string, any> : {}; };
  const moduleOf = (section: Section, raw: unknown) => {
    const m = typeof raw === 'string' ? raw : '';
    if (!POSTHOG_MODULES[m] || POSTHOG_MODULES[m].section !== section) throw new Refused(400, 'invalid_module');
    return m;
  };
  const sectionOf = (c: C) => {
    const s = c.req.param('section') as Section;
    if (!SECTIONS.includes(s)) throw new Refused(400, 'invalid_section');
    return s;
  };
  async function noSupport(c: C) {
    if ((await selectJwt(c))?.payload?.impersonated_by) throw new Refused(403, 'support_session_refused');
  }
  /** A venture the caller may write; an admin acting for one is refused. */
  async function writable(c: C, user: User, raw: unknown) {
    const id = idOf(raw, 'invalid_project');
    const p = await c.env.DB.prepare('SELECT id, name, company_id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(id).first<Venture>();
    if (user.role === 'admin' || !p || !(await canAccessProject(c.env, user, p, { write: true }))) throw new Refused(403, 'project_not_available');
    return p;
  }
  /** The venture's link, served by the caller's own active PostHog: what tracking, Accept and Dismiss need. */
  async function ownLink(c: C, user: User, projectId: number) {
    const link = await linkOf(c.env, projectId);
    if (!link) throw new Refused(409, 'not_linked');
    if (link.owner_id !== user.id) throw new Refused(403, 'not_your_posthog');
    if (!link.active) throw new Refused(409, 'posthog_not_connected');
    return link;
  }
  /** The owner's reads, pinned to the venture's linked project. */
  async function readsFor(c: C, link: { integration_id: number; posthog_project_id: string }) {
    const row = await c.env.DB.prepare('SELECT * FROM integrations WHERE id = ?').bind(link.integration_id).first<IntegrationRow>();
    return posthogReadsFor(c.env, row!, { fetcher: deps.fetcher, projectId: link.posthog_project_id });
  }
  const log = async (c: C, user: User, action: string, details: Record<string, number | string>) => {
    await c.env.DB.prepare('INSERT INTO activity_logs (user_id, actor, action, details) VALUES (?, ?, ?, ?)')
      .bind(user.id, await hashEmail(user.email), action, JSON.stringify(details)).run();
  };

  router.get('/:section/posthog', route(async (c, user) => {
    const section = sectionOf(c);
    const module = moduleOf(section, c.req.query('module'));
    const projectId = idOf(c.req.query('project'), 'invalid_project');
    if (!(await isTeamViewer(c.env, user, projectId))) throw new Refused(403, 'team_only');
    // D1606: Build's modules read what their parts draw beside the figures.
    const extra = module === 'prototype_mvp' ? { must_haves: await mustHaves(c.env, projectId), flags: await flagChips(c.env, projectId) }
      : module === 'operating_systems' ? { tools: await toolsLine(c.env, projectId) } : {};
    return c.json({ ok: true, project_id: projectId, ...(await fromPosthog(c.env, projectId, module, user.id)), ...extra });
  }));

  router.post('/:section/posthog/tracked', route(async (c, user) => {
    await noSupport(c);
    const section = sectionOf(c);
    const b = await bodyOf(c);
    const module = moduleOf(section, b.module);
    const p = await writable(c, user, b.project);
    const link = await ownLink(c, user, p.id);
    const shortId = typeof b.insight_short_id === 'string' ? b.insight_short_id.trim() : '';
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(shortId)) throw new Refused(400, 'invalid_insight');
    const row = await c.env.DB.prepare('SELECT * FROM integrations WHERE id = ?').bind(link.integration_id).first<IntegrationRow>();
    const reads = await posthogReadsFor(c.env, row!, { fetcher: deps.fetcher, projectId: link.posthog_project_id });
    const insight = (await reads.insights()).find((i) => i.short_id === shortId);
    if (!insight) throw new Refused(400, 'insight_not_found');
    const m = await track(c.env, { integrationId: link.integration_id, projectId: p.id, userId: user.id, insight, role: b.role, module });
    await log(c, user, 'posthog_metric_tracked', { integration_id: link.integration_id, project_id: p.id });
    return c.json({ ok: true, tracked: { uid: m.uid, kpi: `posthog-${m.uid}`, name: m.insight_name, role: m.role, module: m.module, unit: m.unit } });
  }));

  router.delete('/:section/posthog/tracked/:uid', route(async (c, user) => {
    await noSupport(c);
    sectionOf(c);
    const p = await writable(c, user, c.req.query('project'));
    if (!(await isTeamViewer(c.env, user, p.id))) throw new Refused(403, 'team_only');
    if (!(await untrack(c.env, p.id, c.req.param('uid') || ''))) throw new Refused(404, 'metric_not_found');
    await log(c, user, 'posthog_metric_untracked', { project_id: p.id });
    return c.json({ ok: true });
  }));

  router.delete('/:section/posthog/facts/:id', route(async (c, user) => {
    await noSupport(c);
    sectionOf(c);
    const p = await writable(c, user, c.req.query('project'));
    if (!(await isTeamViewer(c.env, user, p.id))) throw new Refused(403, 'team_only');
    if (!(await deleteFact(c.env, p.id, idOf(c.req.param('id'), 'invalid_fact')))) throw new Refused(404, 'fact_not_found');
    await log(c, user, 'posthog_fact_deleted', { project_id: p.id });
    return c.json({ ok: true });
  }));

  // D1605–: the section's sync, the owner's own PostHog only, pinned to the venture's project.
  router.post('/:section/posthog/sync', route(async (c, user) => {
    await noSupport(c);
    const section = sectionOf(c);
    const b = await bodyOf(c);
    const p = await writable(c, user, b.project);
    const link = await ownLink(c, user, p.id);
    const sync = syncFor(section);
    if (!sync) throw new Refused(409, 'no_sync');
    const reads = await readsFor(c, link);
    const out = await sync(c.env, reads, { integrationId: link.integration_id, projectId: p.id, userId: user.id, today: new Date().toISOString().slice(0, 10) });
    await c.env.DB.prepare("UPDATE integrations SET last_synced_at = CURRENT_TIMESTAMP WHERE id = ?").bind(link.integration_id).run();
    await log(c, user, `posthog_${section}_synced`, { project_id: p.id, facts: out.facts + out.updated, proposals: out.proposals, partial: out.partial ? 1 : 0 });
    return c.json({ ok: true, ...out });
  }));

  // D1605: the surveys and their questions, for marking which answer means what.
  router.get('/validate/posthog/surveys', route(async (c, user) => {
    await noSupport(c);
    const p = await writable(c, user, c.req.query('project'));
    const link = await ownLink(c, user, p.id);
    const reads = await readsFor(c, link);
    const marks = await marksOf(c.env, p.id);
    const out = [];
    for (const s of (await reads.surveys()).slice(0, 10)) {
      const d = await reads.survey(s.id);
      out.push({
        id: s.id, name: s.name,
        questions: d.questions.filter((q) => q.id).map((q, i) => ({ id: q.id, index: i, text: q.text, type: q.type, mark: marks.find((m) => m.survey_id === s.id && m.question_id === q.id)?.mark ?? null })),
      });
    }
    return c.json({ ok: true, project_id: p.id, marks: MARKS, surveys: out });
  }));

  router.put('/validate/posthog/surveys/:id/marks', route(async (c, user) => {
    await noSupport(c);
    const b = await bodyOf(c);
    const p = await writable(c, user, b.project);
    const link = await ownLink(c, user, p.id);
    const surveyId = c.req.param('id') || '';
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(surveyId)) throw new Refused(400, 'invalid_survey');
    const reads = await readsFor(c, link);
    const d = await reads.survey(surveyId);
    const qid = typeof b.question_id === 'string' ? b.question_id : '';
    const index = d.questions.findIndex((q) => q.id === qid);
    if (index < 0) throw new Refused(400, 'invalid_question');
    await setMark(c.env, { integrationId: link.integration_id, projectId: p.id, userId: user.id }, surveyId, qid, index, b.mark ?? null);
    await log(c, user, 'posthog_survey_marked', { project_id: p.id });
    return c.json({ ok: true });
  }));

  // Accept and Dismiss: plain paths, one per verb, so the API drift guard can read them.
  const decide = (verb: 'accept' | 'dismiss') => route(async (c, user) => {
    await noSupport(c);
    sectionOf(c);
    const b = await bodyOf(c);
    const p = await writable(c, user, b.project);
    const link = await ownLink(c, user, p.id);
    const ctx = { integrationId: link.integration_id, projectId: p.id, userId: user.id };
    const id = idOf(c.req.param('id'), 'invalid_proposal');
    const out = verb === 'accept' ? await acceptProposal(c.env, ctx, id, b) : await dismissProposal(c.env, ctx, id);
    if (out === 'not_found') throw new Refused(404, 'proposal_not_found');
    if (out === 'decided') throw new Refused(409, 'proposal_decided');
    if (out === 'not_ready') throw new Refused(409, 'not_ready');
    await log(c, user, `posthog_proposal_${verb === 'accept' ? 'accepted' : 'dismissed'}`, { project_id: p.id, integration_id: link.integration_id });
    return c.json({ ok: true, ...(typeof out === 'object' ? { target_ref: out.target_ref } : {}) });
  });
  router.post('/:section/posthog/proposals/:id/accept', decide('accept'));
  router.post('/:section/posthog/proposals/:id/dismiss', decide('dismiss'));

  return router;
}

export const posthogCycleRoutes = createPosthogCycleRouter();
