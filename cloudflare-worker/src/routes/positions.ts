/**
 * Portfolio cap-table / ownership view (Support stage).
 *
 * Records the fund's round-by-round positions (dilution over time) in
 * `portfolio_positions`, and reuses the existing `cap_table_holders` snapshot
 * (Carta integration, migration 020) for the current holder breakdown. Founders
 * have /build/captable; investors had no equivalent — this closes that gap.
 *
 * Mounted at /api/positions. Added to STUDIO_PREFIXES so founders get a 402;
 * admin/investor bypass the studio gate and are narrowed here via canViewLpData.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, requireAdmin, canViewLpData } from '../auth';
import { mapError, nowIso, newUid } from './_t13t14t15_helpers';

const r = new Hono<{ Bindings: Env }>();

type PositionRow = {
  id: number; uid: string; fund_id: number | null; project_id: number;
  round_name: string; invested_amount: number; shares: number | null;
  price_per_share: number | null; ownership_pct: number | null; position_date: string | null;
  created_by: number | null; created_at: string; updated_at: string;
};

function num(v: any): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// GET /api/positions — portfolio ownership summary (one row per project)
r.get('/', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canViewLpData(user)) return c.json({ detail: 'Forbidden' }, 403);
    const rows = await c.env.DB.prepare(
      `SELECT p.project_id,
              SUM(p.invested_amount) AS total_invested,
              COUNT(*) AS rounds,
              MAX(p.position_date) AS latest_date
         FROM portfolio_positions p
        GROUP BY p.project_id`
    ).all<any>();
    const items: any[] = [];
    for (const row of (rows.results || [])) {
      const proj = await c.env.DB.prepare('SELECT id, uid, name, sector, stage, status FROM projects WHERE id = ? AND deleted_at IS NULL').bind(row.project_id).first<any>();
      // Latest recorded ownership for the project.
      const latest = await c.env.DB.prepare(
        'SELECT ownership_pct, round_name FROM portfolio_positions WHERE project_id = ? ORDER BY COALESCE(position_date, created_at) DESC LIMIT 1'
      ).bind(row.project_id).first<any>();
      items.push({
        project_id: row.project_id,
        project: proj || null,
        total_invested: Number(row.total_invested) || 0,
        rounds: Number(row.rounds) || 0,
        latest_ownership_pct: latest?.ownership_pct ?? null,
        latest_round: latest?.round_name ?? null,
        latest_date: row.latest_date || null,
      });
    }
    return c.json({ items });
  } catch (e) { return mapError(c, e); }
});

// GET /api/positions/:projectUid — round history + current cap-table snapshot
r.get('/:projectUid', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canViewLpData(user)) return c.json({ detail: 'Forbidden' }, 403);
    const proj = await c.env.DB.prepare('SELECT id, uid, name, sector, stage, status FROM projects WHERE uid = ? AND deleted_at IS NULL').bind(c.req.param('projectUid')).first<any>();
    if (!proj) return c.json({ detail: 'Not found' }, 404);
    const rounds = await c.env.DB.prepare(
      'SELECT * FROM portfolio_positions WHERE project_id = ? ORDER BY COALESCE(position_date, created_at) ASC'
    ).bind(proj.id).all<PositionRow>();
    const holders = await c.env.DB.prepare(
      'SELECT name, security_type, shares, ownership_pct, source FROM cap_table_holders WHERE project_id = ? ORDER BY ownership_pct DESC'
    ).bind(proj.id).all<any>().catch(() => ({ results: [] }));
    return c.json({
      project: proj,
      rounds: rounds.results || [],
      cap_table_snapshot: holders.results || [],
    });
  } catch (e) { return mapError(c, e); }
});

// POST /api/positions — record a round position (admin only)
r.post('/', async (c) => {
  try {
    const user = await requireAdmin(c);
    const body = await c.req.json().catch(() => ({} as any));
    const projectId = Number(body.project_id);
    const roundName = body.round_name ? String(body.round_name).slice(0, 64) : null;
    if (!Number.isFinite(projectId) || !roundName) return c.json({ detail: 'project_id and round_name required' }, 400);
    const proj = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(projectId).first<{ id: number }>();
    if (!proj) return c.json({ detail: 'Project not found' }, 404);
    const uid = newUid();
    const ins = await c.env.DB.prepare(
      `INSERT INTO portfolio_positions (uid, fund_id, project_id, round_name, invested_amount, shares, price_per_share, ownership_pct, position_date, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      uid, body.fund_id != null ? Number(body.fund_id) : null, projectId, roundName,
      num(body.invested_amount) ?? 0, num(body.shares), num(body.price_per_share), num(body.ownership_pct),
      body.position_date ? String(body.position_date).slice(0, 32) : null,
      user.id, nowIso(), nowIso(),
    ).run();
    const x = await c.env.DB.prepare('SELECT * FROM portfolio_positions WHERE id = ?').bind((ins as any).meta?.last_row_id).first<PositionRow>();
    return c.json(x, 201);
  } catch (e) { return mapError(c, e); }
});

// PUT /api/positions/:uid — edit a round position (admin only)
r.put('/:uid', async (c) => {
  try {
    await requireAdmin(c);
    const x = await c.env.DB.prepare('SELECT * FROM portfolio_positions WHERE uid = ?').bind(c.req.param('uid')).first<PositionRow>();
    if (!x) return c.json({ detail: 'Not found' }, 404);
    const body = await c.req.json().catch(() => ({} as any));
    await c.env.DB.prepare(
      `UPDATE portfolio_positions SET fund_id=?, round_name=?, invested_amount=?, shares=?, price_per_share=?, ownership_pct=?, position_date=?, updated_at=? WHERE id=?`
    ).bind(
      body.fund_id !== undefined ? (body.fund_id != null ? Number(body.fund_id) : null) : x.fund_id,
      body.round_name !== undefined ? (body.round_name ? String(body.round_name).slice(0, 64) : x.round_name) : x.round_name,
      body.invested_amount !== undefined ? (num(body.invested_amount) ?? 0) : x.invested_amount,
      body.shares !== undefined ? num(body.shares) : x.shares,
      body.price_per_share !== undefined ? num(body.price_per_share) : x.price_per_share,
      body.ownership_pct !== undefined ? num(body.ownership_pct) : x.ownership_pct,
      body.position_date !== undefined ? (body.position_date ? String(body.position_date).slice(0, 32) : null) : x.position_date,
      nowIso(), x.id,
    ).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM portfolio_positions WHERE id = ?').bind(x.id).first<PositionRow>();
    return c.json(fresh);
  } catch (e) { return mapError(c, e); }
});

export default r;
