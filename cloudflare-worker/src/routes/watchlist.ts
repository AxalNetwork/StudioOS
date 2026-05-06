/**
 * T14 — Watchlist + Anti-portfolio.
 * Mounted at /api (so /api/watchlist + /api/antiportfolio share one router).
 *
 * Watchlist is per-user. Reading is restricted to admin/investor/partner roles
 * (founders don't have a watchlist UI surface). The anti-portfolio is a derived
 * view of "passed" entries.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { isAdmin, isInvestor, isPartner, mapError, nowIso, newUid } from './_t13t14t15_helpers';

const r = new Hono<{ Bindings: Env }>();

type ItemRow = {
  id: number; uid: string; owner_user_id: number; project_id: number;
  conviction: string | null; thesis: string | null;
  next_check_at: string | null; status: string;
  passed_reason: string | null; passed_at: string | null;
  converted_deal_id: number | null; converted_at: string | null;
  created_at: string; updated_at: string;
};

function canUseWatchlist(user: User): boolean {
  return isAdmin(user) || isInvestor(user) || isPartner(user);
}

async function dto(env: Env, w: ItemRow): Promise<any> {
  const proj = await env.DB.prepare(
    'SELECT id, uid, name, sector, stage, status FROM projects WHERE id = ?'
  ).bind(w.project_id).first<any>();
  return {
    id: w.id, uid: w.uid, owner_user_id: w.owner_user_id,
    project_id: w.project_id,
    project: proj || null,
    conviction: w.conviction, thesis: w.thesis,
    next_check_at: w.next_check_at,
    status: w.status, passed_reason: w.passed_reason, passed_at: w.passed_at,
    converted_deal_id: w.converted_deal_id, converted_at: w.converted_at,
    created_at: w.created_at, updated_at: w.updated_at,
  };
}

// ---------------------------------------------------------------------------
// /api/watchlist  (list + create)
// ---------------------------------------------------------------------------
r.get('/watchlist', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseWatchlist(user)) return c.json({ detail: 'Forbidden' }, 403);
    const status = c.req.query('status');
    const conv = c.req.query('conviction');
    const owner = c.req.query('owner') || 'me';
    let where = 'owner_user_id = ?';
    const params: any[] = [];
    if (owner === 'all' && isAdmin(user)) {
      where = '1=1';
    } else {
      params.push(user.id);
    }
    if (status) { where += ' AND status = ?'; params.push(status); }
    if (conv) { where += ' AND conviction = ?'; params.push(conv); }
    const rows = await c.env.DB.prepare(
      `SELECT * FROM watchlist_items WHERE ${where} ORDER BY updated_at DESC LIMIT 500`
    ).bind(...params).all<ItemRow>();
    const items: any[] = [];
    for (const w of (rows.results || []) as ItemRow[]) items.push(await dto(c.env, w));
    return c.json({ items });
  } catch (e) { return mapError(c, e); }
});

r.post('/watchlist', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseWatchlist(user)) return c.json({ detail: 'Forbidden' }, 403);
    const body = await c.req.json().catch(() => ({} as any));
    const projectId = Number(body.project_id);
    if (!Number.isFinite(projectId)) return c.json({ detail: 'project_id required' }, 400);
    const proj = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(projectId).first<{ id: number }>();
    if (!proj) return c.json({ detail: 'Project not found' }, 404);
    const conviction = body.conviction ? String(body.conviction).slice(0, 16) : null;
    const thesis = body.thesis ? String(body.thesis).slice(0, 4000) : null;
    const next_check_at = body.next_check_at ? String(body.next_check_at).slice(0, 64) : null;
    const uid = newUid();
    try {
      const ins = await c.env.DB.prepare(
        `INSERT INTO watchlist_items
          (uid, owner_user_id, project_id, conviction, thesis, next_check_at, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'watching', ?, ?)`
      ).bind(uid, user.id, projectId, conviction, thesis, next_check_at, nowIso(), nowIso()).run();
      const w = await c.env.DB.prepare('SELECT * FROM watchlist_items WHERE id = ?')
        .bind((ins as any).meta?.last_row_id).first<ItemRow>();
      return c.json(await dto(c.env, w!));
    } catch (e: any) {
      if (String(e?.message || e).includes('UNIQUE')) {
        return c.json({ detail: 'Already on your watchlist' }, 409);
      }
      throw e;
    }
  } catch (e) { return mapError(c, e); }
});

// /api/watchlist/anti-portfolio — alias for the legacy SPA path
r.get('/watchlist/anti-portfolio', async (c) => {
  return r.fetch(new Request(new URL('/antiportfolio?owner=me', c.req.url), c.req.raw), c.env);
});

async function getOwnedItem(env: Env, uid: string, user: User): Promise<ItemRow | null | { _forbidden: true }> {
  const w = await env.DB.prepare('SELECT * FROM watchlist_items WHERE uid = ?').bind(uid).first<ItemRow>();
  if (!w) return null;
  if (w.owner_user_id !== user.id && !isAdmin(user)) return { _forbidden: true } as any;
  return w;
}

r.get('/watchlist/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseWatchlist(user)) return c.json({ detail: 'Forbidden' }, 403);
    const w = await getOwnedItem(c.env, c.req.param('uid'), user);
    if (!w) return c.json({ detail: 'Not found' }, 404);
    if ((w as any)._forbidden) return c.json({ detail: 'Forbidden' }, 403);
    return c.json(await dto(c.env, w as ItemRow));
  } catch (e) { return mapError(c, e); }
});

r.put('/watchlist/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseWatchlist(user)) return c.json({ detail: 'Forbidden' }, 403);
    const w = await getOwnedItem(c.env, c.req.param('uid'), user);
    if (!w) return c.json({ detail: 'Not found' }, 404);
    if ((w as any)._forbidden) return c.json({ detail: 'Forbidden' }, 403);
    const body = await c.req.json().catch(() => ({} as any));
    const item = w as ItemRow;
    const conviction = body.conviction !== undefined ? (body.conviction ? String(body.conviction).slice(0, 16) : null) : item.conviction;
    const thesis = body.thesis !== undefined ? (body.thesis ? String(body.thesis).slice(0, 4000) : null) : item.thesis;
    const next_check_at = body.next_check_at !== undefined ? (body.next_check_at ? String(body.next_check_at).slice(0, 64) : null) : item.next_check_at;
    let status = item.status;
    let passed_reason = item.passed_reason;
    let passed_at = item.passed_at;
    if (body.status && ['watching', 'passed'].includes(body.status)) {
      status = body.status;
      if (status === 'passed') {
        passed_reason = body.passed_reason ? String(body.passed_reason).slice(0, 2000) : null;
        passed_at = nowIso();
      } else {
        passed_reason = null;
        passed_at = null;
      }
    }
    await c.env.DB.prepare(
      `UPDATE watchlist_items SET conviction=?, thesis=?, next_check_at=?, status=?, passed_reason=?, passed_at=?, updated_at=? WHERE id=?`
    ).bind(conviction, thesis, next_check_at, status, passed_reason, passed_at, nowIso(), item.id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM watchlist_items WHERE id = ?').bind(item.id).first<ItemRow>();
    return c.json(await dto(c.env, fresh!));
  } catch (e) { return mapError(c, e); }
});

r.delete('/watchlist/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseWatchlist(user)) return c.json({ detail: 'Forbidden' }, 403);
    const w = await getOwnedItem(c.env, c.req.param('uid'), user);
    if (!w) return c.json({ detail: 'Not found' }, 404);
    if ((w as any)._forbidden) return c.json({ detail: 'Forbidden' }, 403);
    await c.env.DB.prepare('DELETE FROM watchlist_items WHERE id = ?').bind((w as ItemRow).id).run();
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

r.post('/watchlist/:uid/convert', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseWatchlist(user)) return c.json({ detail: 'Forbidden' }, 403);
    const w = await getOwnedItem(c.env, c.req.param('uid'), user);
    if (!w) return c.json({ detail: 'Not found' }, 404);
    if ((w as any)._forbidden) return c.json({ detail: 'Forbidden' }, 403);
    const item = w as ItemRow;
    const body = await c.req.json().catch(() => ({} as any));
    const dealId = body.deal_id != null ? Number(body.deal_id) : null;
    await c.env.DB.prepare(
      `UPDATE watchlist_items SET status='converted', converted_deal_id=?, converted_at=?, updated_at=? WHERE id=?`
    ).bind(dealId, nowIso(), nowIso(), item.id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM watchlist_items WHERE id = ?').bind(item.id).first<ItemRow>();
    return c.json(await dto(c.env, fresh!));
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// /api/antiportfolio — list of `passed` items (per user, or all for admin)
// ---------------------------------------------------------------------------
r.get('/antiportfolio', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseWatchlist(user)) return c.json({ detail: 'Forbidden' }, 403);
    const owner = c.req.query('owner') || 'me';
    let where = "status = 'passed' AND owner_user_id = ?";
    const params: any[] = [user.id];
    if (owner === 'all' && isAdmin(user)) {
      where = "status = 'passed'";
      params.length = 0;
    }
    const rows = await c.env.DB.prepare(
      `SELECT * FROM watchlist_items WHERE ${where} ORDER BY passed_at DESC LIMIT 500`
    ).bind(...params).all<ItemRow>();
    const items: any[] = [];
    for (const w of (rows.results || []) as ItemRow[]) items.push(await dto(c.env, w));
    return c.json({ items });
  } catch (e) { return mapError(c, e); }
});

export default r;
