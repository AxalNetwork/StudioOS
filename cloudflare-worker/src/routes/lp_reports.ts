/**
 * LP Reporting / quarterly LP updates (Support stage).
 *
 * GPs (admin) draft and publish per-fund, per-period reports (NAV, called,
 * distributed, DPI/TVPI/IRR, narrative). LPs (investors) see only PUBLISHED
 * reports for funds they belong to (via limited_partners). Fills the gap where
 * capital *calls* existed but there was no way to report back to LPs.
 *
 * Mounted at /api/lp-reports. Added to STUDIO_PREFIXES so founders get a 402;
 * admin/investor bypass the studio gate and are further narrowed here.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, requireAdmin, canViewLpData } from '../auth';
import { isAdmin, mapError, nowIso, newUid } from './_t13t14t15_helpers';

const r = new Hono<{ Bindings: Env }>();

type ReportRow = {
  id: number; uid: string; fund_id: number; period: string; status: string;
  nav: number | null; called: number | null; distributed: number | null;
  dpi: number | null; tvpi: number | null; irr: number | null;
  narrative: string | null; created_by: number | null; published_at: string | null;
  created_at: string; updated_at: string;
};

async function dto(env: Env, x: ReportRow): Promise<any> {
  const fund = await env.DB.prepare('SELECT id, name, vintage_year, status FROM vc_funds WHERE id = ?').bind(x.fund_id).first<any>();
  return { ...x, fund: fund || null };
}

/** Fund ids the caller may view: all for admin, else funds where they are an LP. */
async function visibleFundIds(env: Env, user: User): Promise<number[] | 'all'> {
  if (isAdmin(user)) return 'all';
  const rows = await env.DB.prepare('SELECT DISTINCT fund_id FROM limited_partners WHERE user_id = ?').bind(user.id).all<{ fund_id: number }>();
  return (rows.results || []).map((row) => Number(row.fund_id));
}

function num(v: any): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// GET /api/lp-reports — admin: all; investor: published reports for own funds
r.get('/', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canViewLpData(user)) return c.json({ detail: 'Forbidden' }, 403);
    const fundId = c.req.query('fund_id');
    const visible = await visibleFundIds(c.env, user);
    let where = '1=1';
    const params: any[] = [];
    if (visible !== 'all') {
      if (visible.length === 0) return c.json({ items: [] });
      where += ` AND fund_id IN (${visible.map(() => '?').join(',')}) AND status = 'published'`;
      params.push(...visible);
    }
    if (fundId) { where += ' AND fund_id = ?'; params.push(Number(fundId)); }
    const rows = await c.env.DB.prepare(
      `SELECT * FROM lp_reports WHERE ${where} ORDER BY period DESC, updated_at DESC LIMIT 500`
    ).bind(...params).all<ReportRow>();
    const items: any[] = [];
    for (const x of (rows.results || []) as ReportRow[]) items.push(await dto(c.env, x));
    return c.json({ items });
  } catch (e) { return mapError(c, e); }
});

// POST /api/lp-reports — create a draft (admin only)
r.post('/', async (c) => {
  try {
    const user = await requireAdmin(c);
    const body = await c.req.json().catch(() => ({} as any));
    const fundId = Number(body.fund_id);
    const period = body.period ? String(body.period).slice(0, 32) : null;
    if (!Number.isFinite(fundId) || !period) return c.json({ detail: 'fund_id and period required' }, 400);
    const fund = await c.env.DB.prepare('SELECT id FROM vc_funds WHERE id = ?').bind(fundId).first<{ id: number }>();
    if (!fund) return c.json({ detail: 'Fund not found' }, 404);
    const uid = newUid();
    try {
      const ins = await c.env.DB.prepare(
        `INSERT INTO lp_reports (uid, fund_id, period, status, nav, called, distributed, dpi, tvpi, irr, narrative, created_by, created_at, updated_at)
         VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        uid, fundId, period,
        num(body.nav), num(body.called), num(body.distributed),
        num(body.dpi), num(body.tvpi), num(body.irr),
        body.narrative ? String(body.narrative).slice(0, 20000) : null,
        user.id, nowIso(), nowIso(),
      ).run();
      const x = await c.env.DB.prepare('SELECT * FROM lp_reports WHERE id = ?').bind((ins as any).meta?.last_row_id).first<ReportRow>();
      return c.json(await dto(c.env, x!), 201);
    } catch (e: any) {
      if (String(e?.message || e).includes('UNIQUE')) return c.json({ detail: 'A report already exists for this fund and period' }, 409);
      throw e;
    }
  } catch (e) { return mapError(c, e); }
});

// GET /api/lp-reports/:uid — detail (same visibility rules as list)
r.get('/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canViewLpData(user)) return c.json({ detail: 'Forbidden' }, 403);
    const x = await c.env.DB.prepare('SELECT * FROM lp_reports WHERE uid = ?').bind(c.req.param('uid')).first<ReportRow>();
    if (!x) return c.json({ detail: 'Not found' }, 404);
    if (!isAdmin(user)) {
      if (x.status !== 'published') return c.json({ detail: 'Not found' }, 404);
      const lp = await c.env.DB.prepare('SELECT 1 FROM limited_partners WHERE user_id = ? AND fund_id = ? LIMIT 1').bind(user.id, x.fund_id).first();
      if (!lp) return c.json({ detail: 'Forbidden' }, 403);
    }
    return c.json(await dto(c.env, x));
  } catch (e) { return mapError(c, e); }
});

// PUT /api/lp-reports/:uid — edit metrics/narrative (admin only)
r.put('/:uid', async (c) => {
  try {
    await requireAdmin(c);
    const x = await c.env.DB.prepare('SELECT * FROM lp_reports WHERE uid = ?').bind(c.req.param('uid')).first<ReportRow>();
    if (!x) return c.json({ detail: 'Not found' }, 404);
    const body = await c.req.json().catch(() => ({} as any));
    await c.env.DB.prepare(
      `UPDATE lp_reports SET nav=?, called=?, distributed=?, dpi=?, tvpi=?, irr=?, narrative=?, updated_at=? WHERE id=?`
    ).bind(
      body.nav !== undefined ? num(body.nav) : x.nav,
      body.called !== undefined ? num(body.called) : x.called,
      body.distributed !== undefined ? num(body.distributed) : x.distributed,
      body.dpi !== undefined ? num(body.dpi) : x.dpi,
      body.tvpi !== undefined ? num(body.tvpi) : x.tvpi,
      body.irr !== undefined ? num(body.irr) : x.irr,
      body.narrative !== undefined ? (body.narrative ? String(body.narrative).slice(0, 20000) : null) : x.narrative,
      nowIso(), x.id,
    ).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM lp_reports WHERE id = ?').bind(x.id).first<ReportRow>();
    return c.json(await dto(c.env, fresh!));
  } catch (e) { return mapError(c, e); }
});

// POST /api/lp-reports/:uid/publish — publish (admin only)
r.post('/:uid/publish', async (c) => {
  try {
    await requireAdmin(c);
    const x = await c.env.DB.prepare('SELECT * FROM lp_reports WHERE uid = ?').bind(c.req.param('uid')).first<ReportRow>();
    if (!x) return c.json({ detail: 'Not found' }, 404);
    await c.env.DB.prepare("UPDATE lp_reports SET status='published', published_at=?, updated_at=? WHERE id=?")
      .bind(nowIso(), nowIso(), x.id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM lp_reports WHERE id = ?').bind(x.id).first<ReportRow>();
    return c.json(await dto(c.env, fresh!));
  } catch (e) { return mapError(c, e); }
});

export default r;
