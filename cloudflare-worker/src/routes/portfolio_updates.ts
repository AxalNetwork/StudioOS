/**
 * Portfolio-company update inbox (Support stage).
 *
 * Founders submit periodic updates (KPIs + narrative) for projects they own;
 * investors/partners/admin read the resulting feed. Portfolio Health is
 * computed — this is the missing channel for founder-submitted signal.
 *
 * Mounted at /api/portfolio-updates. Dual-audience, so it is NOT behind a
 * paywall prefix; access is enforced per-role in each handler.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, canAccessFounderResource } from '../auth';
import { isAdmin, isInvestor, isPartner, isFounder, mapError, nowIso, newUid, jload } from './_t13t14t15_helpers';
import { notify } from '../services/notify';
import { ensureFollowsSchema } from './follows';
import { investorProjectIds, investorActiveCompany } from './_investorProjectScope';

const r = new Hono<{ Bindings: Env }>();

// Task #66 — when a portfolio update goes live, notify everyone following
// the startup. Best-effort: never blocks or fails the submit. Excludes the
// author so founders don't get pinged about their own update.
async function notifyProjectFollowers(env: Env, projectId: number, update: UpdateRow): Promise<void> {
  try {
    await ensureFollowsSchema(env);
    const proj = await env.DB.prepare(
      'SELECT uid, name FROM projects WHERE id = ? AND deleted_at IS NULL',
    ).bind(projectId).first<{ uid: string; name: string }>();
    if (!proj) return;
    const followers = await env.DB.prepare(
      "SELECT follower_user_id AS uid FROM follows WHERE entity_type = 'project' AND entity_id = ?",
    ).bind(projectId).all<{ uid: number }>();
    for (const f of followers.results || []) {
      if (f.uid === update.author_user_id) continue;
      await notify(env, {
        userId: f.uid,
        type: 'followed_entity_news',
        title: `${proj.name} posted an update`,
        body: update.title || null,
        link: `/startups/${proj.uid}`,
        payload: { entity_type: 'project', handle: proj.uid, update_uid: update.uid },
        category: 'proactive_nudges',
      });
    }
  } catch (e) {
    console.warn('[portfolio_updates] follower fan-out failed', e);
  }
}

type UpdateRow = {
  id: number; uid: string; project_id: number; author_user_id: number;
  period: string | null; title: string; body: string | null; kpis_json: string | null;
  status: string; submitted_at: string | null; created_at: string; updated_at: string;
};

function isInvestorSide(user: User): boolean {
  return isAdmin(user) || isInvestor(user) || isPartner(user);
}

async function projectFounderId(env: Env, projectId: number): Promise<number | null> {
  const p = await env.DB.prepare('SELECT founder_id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(projectId).first<{ founder_id: number | null }>();
  return p ? (p.founder_id ?? null) : undefined as any;
}

async function dto(env: Env, u: UpdateRow): Promise<any> {
  const proj = await env.DB.prepare('SELECT id, uid, name, sector, stage, status FROM projects WHERE id = ? AND deleted_at IS NULL').bind(u.project_id).first<any>();
  return {
    id: u.id, uid: u.uid, project_id: u.project_id, author_user_id: u.author_user_id,
    project: proj || null,
    period: u.period, title: u.title, body: u.body, kpis: jload(u.kpis_json, {}),
    status: u.status, submitted_at: u.submitted_at,
    created_at: u.created_at, updated_at: u.updated_at,
  };
}

// GET /api/portfolio-updates — investor inbox (submitted); founders see own drafts too
r.get('/', async (c) => {
  try {
    const user = await requireAuth(c);
    const projectId = c.req.query('project_id');
    const period = c.req.query('period');
    let where = '1=1';
    const params: any[] = [];
    if (isInvestorSide(user)) {
      where += " AND status = 'submitted'";
      if (isInvestor(user)) {
        const visible = await investorProjectIds(c.env, user, await investorActiveCompany(c, user));
        const ids = visible || [];
        if (ids.length === 0) where += ' AND 1 = 0';
        else {
          where += ` AND project_id IN (${ids.map(() => '?').join(',')})`;
          params.push(...ids);
        }
      }
    } else if (isFounder(user) && user.founder_id) {
      // Founders only see updates for projects they own.
      where += ' AND project_id IN (SELECT id FROM projects WHERE founder_id = ?)';
      params.push(user.founder_id);
    } else {
      return c.json({ items: [] });
    }
    if (projectId) { where += ' AND project_id = ?'; params.push(Number(projectId)); }
    if (period) { where += ' AND period = ?'; params.push(String(period)); }
    const rows = await c.env.DB.prepare(
      `SELECT * FROM portfolio_updates WHERE ${where} ORDER BY COALESCE(submitted_at, updated_at) DESC LIMIT 500`
    ).bind(...params).all<UpdateRow>();
    const items: any[] = [];
    for (const u of (rows.results || []) as UpdateRow[]) items.push(await dto(c.env, u));
    return c.json({ items });
  } catch (e) { return mapError(c, e); }
});

// POST /api/portfolio-updates — founder (own project) or admin creates an update
r.post('/', async (c) => {
  try {
    const user = await requireAuth(c);
    const body = await c.req.json().catch(() => ({} as any));
    const projectId = Number(body.project_id);
    const title = body.title ? String(body.title).slice(0, 300) : null;
    if (!Number.isFinite(projectId) || !title) return c.json({ detail: 'project_id and title required' }, 400);
    const founderId = await projectFounderId(c.env, projectId);
    if (founderId === undefined) return c.json({ detail: 'Project not found' }, 404);
    // Only the owning founder (or admin) may post an update for a project.
    if (!isAdmin(user) && !(isFounder(user) && canAccessFounderResource(user, founderId))) {
      return c.json({ detail: 'Forbidden' }, 403);
    }
    const submit = body.status === 'submitted';
    const uid = newUid();
    const ins = await c.env.DB.prepare(
      `INSERT INTO portfolio_updates (uid, project_id, author_user_id, period, title, body, kpis_json, status, submitted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      uid, projectId, user.id,
      body.period ? String(body.period).slice(0, 32) : null,
      title,
      body.body ? String(body.body).slice(0, 20000) : null,
      body.kpis != null ? JSON.stringify(body.kpis) : null,
      submit ? 'submitted' : 'draft',
      submit ? nowIso() : null,
      nowIso(), nowIso(),
    ).run();
    const u = await c.env.DB.prepare('SELECT * FROM portfolio_updates WHERE id = ?').bind((ins as any).meta?.last_row_id).first<UpdateRow>();
    if (submit && u) {
      c.executionCtx.waitUntil(notifyProjectFollowers(c.env, projectId, u));
    }
    return c.json(await dto(c.env, u!), 201);
  } catch (e) { return mapError(c, e); }
});

async function loadOwned(c: any, user: User): Promise<UpdateRow | null | { _forbidden: true } | { _notfound: true }> {
  const u = await c.env.DB.prepare('SELECT * FROM portfolio_updates WHERE uid = ?').bind(c.req.param('uid')).first() as UpdateRow | null;
  if (!u) return { _notfound: true };
  if (isInvestorSide(user)) {
    // Investor side may only read submitted updates.
    if (u.status !== 'submitted' && !isAdmin(user)) return { _forbidden: true };
    if (isInvestor(user)) {
      const visible = await investorProjectIds(c.env, user, await investorActiveCompany(c, user));
      if (!visible?.includes(Number(u.project_id))) return { _forbidden: true };
    }
    return u;
  }
  // Founder: must own the project.
  const founderId = await projectFounderId(c.env, u.project_id);
  if (!(isFounder(user) && canAccessFounderResource(user, founderId ?? null))) return { _forbidden: true };
  return u;
}

// GET /api/portfolio-updates/:uid — detail
r.get('/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    const u = await loadOwned(c, user);
    if ((u as any)?._notfound) return c.json({ detail: 'Not found' }, 404);
    if ((u as any)?._forbidden) return c.json({ detail: 'Forbidden' }, 403);
    return c.json(await dto(c.env, u as UpdateRow));
  } catch (e) { return mapError(c, e); }
});

// PUT /api/portfolio-updates/:uid — author edits own draft (or admin)
r.put('/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    const u = await c.env.DB.prepare('SELECT * FROM portfolio_updates WHERE uid = ?').bind(c.req.param('uid')).first<UpdateRow>();
    if (!u) return c.json({ detail: 'Not found' }, 404);
    if (u.author_user_id !== user.id && !isAdmin(user)) return c.json({ detail: 'Forbidden' }, 403);
    const body = await c.req.json().catch(() => ({} as any));
    await c.env.DB.prepare(
      `UPDATE portfolio_updates SET period=?, title=?, body=?, kpis_json=?, updated_at=? WHERE id=?`
    ).bind(
      body.period !== undefined ? (body.period ? String(body.period).slice(0, 32) : null) : u.period,
      body.title !== undefined ? (body.title ? String(body.title).slice(0, 300) : u.title) : u.title,
      body.body !== undefined ? (body.body ? String(body.body).slice(0, 20000) : null) : u.body,
      body.kpis !== undefined ? (body.kpis != null ? JSON.stringify(body.kpis) : null) : u.kpis_json,
      nowIso(), u.id,
    ).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM portfolio_updates WHERE id = ?').bind(u.id).first<UpdateRow>();
    return c.json(await dto(c.env, fresh!));
  } catch (e) { return mapError(c, e); }
});

// POST /api/portfolio-updates/:uid/submit — author submits the update
r.post('/:uid/submit', async (c) => {
  try {
    const user = await requireAuth(c);
    const u = await c.env.DB.prepare('SELECT * FROM portfolio_updates WHERE uid = ?').bind(c.req.param('uid')).first<UpdateRow>();
    if (!u) return c.json({ detail: 'Not found' }, 404);
    if (u.author_user_id !== user.id && !isAdmin(user)) return c.json({ detail: 'Forbidden' }, 403);
    const wasSubmitted = u.status === 'submitted';
    await c.env.DB.prepare("UPDATE portfolio_updates SET status='submitted', submitted_at=?, updated_at=? WHERE id=?")
      .bind(nowIso(), nowIso(), u.id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM portfolio_updates WHERE id = ?').bind(u.id).first<UpdateRow>();
    if (!wasSubmitted && fresh) {
      c.executionCtx.waitUntil(notifyProjectFollowers(c.env, fresh.project_id, fresh));
    }
    return c.json(await dto(c.env, fresh!));
  } catch (e) { return mapError(c, e); }
});

export default r;
