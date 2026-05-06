/**
 * T14 — Portfolio Health (snapshots).
 * Mounted at /api/portfolio.
 *
 * Visibility:
 *   admin/investor/partner   -> every project
 *   founder                  -> only projects they own
 *   mentor                   -> 403
 *
 * The recompute endpoints write a fresh snapshot using a lightweight scoring
 * model: traction (deals + tickets + recent activity) + score_snapshots
 * average. The full FastAPI service (`services/portfolio_health.py`) has more
 * signals; this worker port focuses on producing a deterministic score so the
 * dashboard can render — operators can call /recompute to refresh.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { isAdmin, isInvestor, isPartner, isFounder, mapError, nowIso, todayIso, newUid, jload } from './_t13t14t15_helpers';

const r = new Hono<{ Bindings: Env }>();

type SnapRow = {
  id: number; uid: string; project_id: number; snapshot_date: string;
  score: number; badge: string; intervention: number;
  drivers_json: string; notes: string | null; created_at: string;
};

function canViewDashboard(u: User): boolean {
  return isAdmin(u) || isFounder(u) || isInvestor(u) || isPartner(u);
}

async function visibleProjectIds(env: Env, user: User): Promise<number[] | null> {
  if (isAdmin(user) || isInvestor(user) || isPartner(user)) return null;
  if (isFounder(user)) {
    if (!user.founder_id) return [];
    const rows = await env.DB.prepare('SELECT id FROM projects WHERE founder_id = ?')
      .bind(user.founder_id).all<{ id: number }>();
    return (rows.results || []).map((r) => r.id);
  }
  return [];
}

async function computeScore(env: Env, projectId: number): Promise<{ score: number; drivers: any }> {
  const drivers: any = {};
  // Latest score snapshot
  const sc = await env.DB.prepare(
    'SELECT score FROM score_snapshots WHERE project_id = ? ORDER BY id DESC LIMIT 1'
  ).bind(projectId).first<{ score: number }>().catch(() => null);
  drivers.scoring = sc ? Number(sc.score) : null;
  // Open vs total tickets
  const t = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN status IN ('open','in_progress') THEN 1 ELSE 0 END) AS open,
       COUNT(*) AS total
     FROM tickets WHERE project_id = ?`
  ).bind(projectId).first<{ open: number; total: number }>().catch(() => null);
  drivers.tickets_open = Number(t?.open || 0);
  drivers.tickets_total = Number(t?.total || 0);
  // Recent activity (last 30 days)
  const thirty = new Date(Date.now() - 30 * 86400000).toISOString();
  const a = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM activity_logs
     WHERE created_at >= ? AND (
       details LIKE ('%project=' || ? || '%') OR details LIKE ('%project_id=' || ? || '%')
     )`
  ).bind(thirty, projectId, projectId).first<{ c: number }>().catch(() => null);
  drivers.activity_30d = Number(a?.c || 0);

  // Compose: scoring 60%, recent activity 30% (capped at 30 events = 100), ticket pressure -10
  const scoringPart = drivers.scoring != null ? Math.max(0, Math.min(100, drivers.scoring)) : 50;
  const activityPart = Math.min(100, drivers.activity_30d * 100 / 30);
  const ticketPressure = drivers.tickets_total > 0
    ? (drivers.tickets_open / drivers.tickets_total) * 100
    : 0;
  let score = Math.round(scoringPart * 0.6 + activityPart * 0.3 - ticketPressure * 0.1);
  if (score < 0) score = 0; if (score > 100) score = 100;
  return { score, drivers };
}

function badgeFor(score: number): { badge: string; intervention: boolean } {
  if (score >= 70) return { badge: 'green', intervention: false };
  if (score >= 40) return { badge: 'yellow', intervention: false };
  return { badge: 'red', intervention: true };
}

function snapDto(s: SnapRow, project?: any): any {
  return {
    id: s.id, uid: s.uid,
    project_id: s.project_id,
    project: project ? {
      id: project.id, uid: project.uid, name: project.name,
      sector: project.sector, stage: project.stage, status: project.status,
    } : undefined,
    snapshot_date: s.snapshot_date,
    score: s.score, badge: s.badge,
    intervention: !!s.intervention,
    drivers: jload(s.drivers_json, {} as any),
    notes: s.notes, created_at: s.created_at,
  };
}

async function upsertSnapshot(env: Env, project: any) {
  const { score, drivers } = await computeScore(env, project.id);
  const { badge, intervention } = badgeFor(score);
  const today = todayIso();
  const uid = newUid();
  // UPSERT on (project_id, snapshot_date)
  await env.DB.prepare(
    `INSERT INTO portfolio_health_snapshots
       (uid, project_id, snapshot_date, score, badge, intervention, drivers_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, snapshot_date) DO UPDATE SET
       score = excluded.score, badge = excluded.badge,
       intervention = excluded.intervention, drivers_json = excluded.drivers_json`
  ).bind(uid, project.id, today, score, badge, intervention ? 1 : 0,
         JSON.stringify(drivers), nowIso()).run();
  const row = await env.DB.prepare(
    'SELECT * FROM portfolio_health_snapshots WHERE project_id = ? AND snapshot_date = ?'
  ).bind(project.id, today).first<SnapRow>();
  return row!;
}

r.get('/health', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canViewDashboard(user)) return c.json({ detail: 'Forbidden' }, 403);
    const badge = c.req.query('badge');
    const interventionOnly = (c.req.query('intervention_only') || '').toLowerCase() === 'true';
    const visible = await visibleProjectIds(c.env, user);
    let projects: any[];
    if (visible == null) {
      projects = ((await c.env.DB.prepare('SELECT * FROM projects').all<any>()).results || []) as any[];
    } else if (visible.length === 0) {
      return c.json({ items: [], as_of: null, totals: { green: 0, yellow: 0, red: 0, intervention: 0 } });
    } else {
      const ph = visible.map(() => '?').join(',');
      projects = ((await c.env.DB.prepare(`SELECT * FROM projects WHERE id IN (${ph})`).bind(...visible).all<any>()).results || []) as any[];
    }
    const items: any[] = [];
    let asOf: string | null = null;
    for (const p of projects) {
      const row = await c.env.DB.prepare(
        'SELECT * FROM portfolio_health_snapshots WHERE project_id = ? ORDER BY snapshot_date DESC LIMIT 1'
      ).bind(p.id).first<SnapRow>();
      if (!row) continue;
      if (badge && row.badge !== badge) continue;
      if (interventionOnly && !row.intervention) continue;
      items.push(snapDto(row, p));
      if (!asOf || row.snapshot_date > asOf) asOf = row.snapshot_date;
    }
    items.sort((a, b) => (Number(b.intervention) - Number(a.intervention)) || (a.score - b.score));
    return c.json({
      items, as_of: asOf,
      totals: {
        green: items.filter((i) => i.badge === 'green').length,
        yellow: items.filter((i) => i.badge === 'yellow').length,
        red: items.filter((i) => i.badge === 'red').length,
        intervention: items.filter((i) => i.intervention).length,
      },
    });
  } catch (e) { return mapError(c, e); }
});

r.get('/health/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canViewDashboard(user)) return c.json({ detail: 'Forbidden' }, 403);
    const projectUid = c.req.param('uid');
    const days = Math.max(1, Math.min(365, Number(c.req.query('history_days') || 30)));
    const project = await c.env.DB.prepare('SELECT * FROM projects WHERE uid = ?').bind(projectUid).first<any>();
    if (!project) return c.json({ detail: 'Project not found' }, 404);
    const visible = await visibleProjectIds(c.env, user);
    if (visible != null && !visible.includes(project.id)) return c.json({ detail: 'Forbidden' }, 403);
    const rows = await c.env.DB.prepare(
      'SELECT * FROM portfolio_health_snapshots WHERE project_id = ? ORDER BY snapshot_date DESC LIMIT ?'
    ).bind(project.id, days).all<SnapRow>();
    const history = (rows.results || []).map((r) => snapDto(r));
    return c.json({
      project: { uid: project.uid, name: project.name, sector: project.sector, stage: project.stage, status: project.status },
      latest: history[0] || null,
      history,
    });
  } catch (e) { return mapError(c, e); }
});

r.post('/health/recompute', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!isAdmin(user)) return c.json({ detail: 'Admin only' }, 403);
    const projects = ((await c.env.DB.prepare('SELECT * FROM projects').all<any>()).results || []) as any[];
    let n = 0;
    for (const p of projects) { await upsertSnapshot(c.env, p); n++; }
    return c.json({ ok: true, summary: { projects_scored: n, snapshot_date: todayIso() } });
  } catch (e) { return mapError(c, e); }
});

r.post('/health/recompute/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!isAdmin(user) && !isInvestor(user) && !isPartner(user)) {
      return c.json({ detail: 'Admin/partner/investor only' }, 403);
    }
    const project = await c.env.DB.prepare('SELECT * FROM projects WHERE uid = ?').bind(c.req.param('uid')).first<any>();
    if (!project) return c.json({ detail: 'Project not found' }, 404);
    const row = await upsertSnapshot(c.env, project);
    return c.json(snapDto(row, project));
  } catch (e) { return mapError(c, e); }
});

export default r;
