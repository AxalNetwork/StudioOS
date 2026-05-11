/**
 * Task #1 (AG) — Service Offerings (founder-marketplace catalog).
 *
 * Mounted at /api/services. All endpoints authenticated.
 *
 *   GET    /offerings             — list (filter q, category)
 *   GET    /offerings/:id         — read one
 *   POST   /offerings             — create (provider/admin)
 *   PUT    /offerings/:id         — update (owner/admin)
 *   DELETE /offerings/:id         — delete (owner/admin)
 *   POST   /offerings/:id/engage  — founder requests this offering
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';

const services = new Hono<{ Bindings: Env }>();

type Offering = {
  id: number;
  uid: string;
  owner_user_id: number;
  title: string;
  category: string | null;
  summary: string | null;
  price_usd: number | null;
  is_active: number;
  created_at: string;
  updated_at: string;
};

type SerializedOffering = Omit<Offering, 'is_active'> & { is_active: boolean };
function serialize(o: Offering): SerializedOffering {
  return {
    id: o.id,
    uid: o.uid,
    owner_user_id: o.owner_user_id,
    title: o.title,
    category: o.category,
    summary: o.summary,
    price_usd: o.price_usd,
    is_active: !!o.is_active,
    created_at: o.created_at,
    updated_at: o.updated_at,
  };
}

function isAdmin(u: User): boolean { return u.role === 'admin'; }

services.get('/offerings', async (c) => {
  await requireAuth(c);
  const q = (c.req.query('q') || '').trim().toLowerCase();
  const category = (c.req.query('category') || '').trim();
  let where = 'is_active = 1';
  const params: string[] = [];
  if (category) { where += ' AND category = ?'; params.push(category); }
  const rows = await c.env.DB.prepare(
    `SELECT * FROM service_offerings WHERE ${where} ORDER BY created_at DESC LIMIT 200`,
  ).bind(...params).all<Offering>();
  let items: SerializedOffering[] = (rows.results || []).map(serialize);
  if (q) {
    items = items.filter((o) =>
      (o.title || '').toLowerCase().includes(q) ||
      (o.summary || '').toLowerCase().includes(q));
  }
  return c.json({ items });
});

services.get('/offerings/:id', async (c) => {
  await requireAuth(c);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ detail: 'Invalid id' }, 400);
  const row = await c.env.DB.prepare('SELECT * FROM service_offerings WHERE id = ?')
    .bind(id).first<Offering>();
  if (!row) return c.json({ detail: 'Offering not found' }, 404);
  return c.json(serialize(row));
});

services.post('/offerings', async (c) => {
  const user = await requireAuth(c);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const title = String(body?.title || '').trim();
  if (!title) return c.json({ detail: 'title required' }, 400);
  const summary = body?.summary ? String(body.summary).slice(0, 4000) : null;
  const category = body?.category ? String(body.category).slice(0, 80) : null;
  const price = body?.price_usd != null ? Number(body.price_usd) : null;
  const uid = crypto.randomUUID();
  const now = new Date().toISOString();
  const r = await c.env.DB.prepare(
    `INSERT INTO service_offerings (uid, owner_user_id, title, category, summary, price_usd, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).bind(uid, user.id, title.slice(0, 200), category, summary,
         price != null && Number.isFinite(price) ? price : null, now, now).run();
  const fresh = await c.env.DB.prepare('SELECT * FROM service_offerings WHERE id = ?')
    .bind(r.meta.last_row_id).first<Offering>();
  return c.json(serialize(fresh as Offering));
});

async function ensureOwnerOr404(env: Env, id: number, user: User): Promise<Offering | null> {
  const row = await env.DB.prepare('SELECT * FROM service_offerings WHERE id = ?')
    .bind(id).first<Offering>();
  if (!row) return null;
  if (row.owner_user_id !== user.id && !isAdmin(user)) return null;
  return row;
}

services.put('/offerings/:id', async (c) => {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ detail: 'Invalid id' }, 400);
  const row = await ensureOwnerOr404(c.env, id, user);
  if (!row) return c.json({ detail: 'Offering not found' }, 404);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const title = body?.title != null ? String(body.title).slice(0, 200) : row.title;
  const summary = body?.summary !== undefined ? (body.summary ? String(body.summary).slice(0, 4000) : null) : row.summary;
  const category = body?.category !== undefined ? (body.category ? String(body.category).slice(0, 80) : null) : row.category;
  const price = body?.price_usd !== undefined
    ? (body.price_usd == null ? null : Number(body.price_usd))
    : row.price_usd;
  const isActive = body?.is_active !== undefined ? (body.is_active ? 1 : 0) : row.is_active;
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE service_offerings SET title = ?, summary = ?, category = ?, price_usd = ?, is_active = ?, updated_at = ? WHERE id = ?`,
  ).bind(title, summary, category,
         price != null && Number.isFinite(price as number) ? price : null,
         isActive, now, id).run();
  const fresh = await c.env.DB.prepare('SELECT * FROM service_offerings WHERE id = ?')
    .bind(id).first<Offering>();
  return c.json(serialize(fresh as Offering));
});

services.delete('/offerings/:id', async (c) => {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ detail: 'Invalid id' }, 400);
  const row = await ensureOwnerOr404(c.env, id, user);
  if (!row) return c.json({ detail: 'Offering not found' }, 404);
  await c.env.DB.prepare('DELETE FROM service_offerings WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

services.post('/offerings/:id/engage', async (c) => {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ detail: 'Invalid id' }, 400);
  const offering = await c.env.DB.prepare('SELECT * FROM service_offerings WHERE id = ?')
    .bind(id).first<Offering>();
  if (!offering || !offering.is_active) return c.json({ detail: 'Offering not available' }, 404);
  if (offering.owner_user_id === user.id) return c.json({ detail: 'cannot engage own offering' }, 400);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const note = body?.note ? String(body.note).slice(0, 2000) : null;
  const uid = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO service_engagements (uid, offering_id, requester_user_id, owner_user_id, note, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))`,
  ).bind(uid, id, user.id, offering.owner_user_id, note).run();
  return c.json({ ok: true, uid });
});

export default services;
