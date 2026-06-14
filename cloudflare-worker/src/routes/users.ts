import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth, requireAdmin } from '../auth';

const users = new Hono<{ Bindings: Env }>();

users.get('/', async (c) => {
  // Listing all users exposes emails/names/roles — admin only (matches POST /).
  await requireAdmin(c);
  const role = c.req.query('role');
  const sql = getSQL(c.env);
  const rows = role
    ? await sql`SELECT id, uid, email, name, role, is_active, email_verified, created_at FROM users WHERE role = ${role} ORDER BY created_at DESC`
    : await sql`SELECT id, uid, email, name, role, is_active, email_verified, created_at FROM users ORDER BY created_at DESC`;
  await sql.end();
  return c.json(rows);
});

users.post('/', async (c) => {
  await requireAdmin(c);
  const data = await c.req.json();
  const sql = getSQL(c.env);
  const existing = await sql`SELECT id FROM users WHERE email = ${data.email}`;
  if (existing.length > 0) { await sql.end(); return c.json({ error: 'User with this email already exists' }, 409); }
  const validRole = ['founder', 'partner', 'investor'].includes(data.role) ? data.role : 'partner';
  const [user] = await sql`INSERT INTO users (email, name, role, founder_id, partner_id) VALUES (${data.email}, ${data.name}, ${validRole}, ${data.founder_id || null}, ${data.partner_id || null}) RETURNING id, uid, email, name, role, is_active, email_verified, created_at`;
  await sql.end();
  return c.json(user, 201);
});

users.get('/:id', async (c) => {
  // A user may view their own record; viewing anyone else's is admin-only.
  const caller = await requireAuth(c);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid user id' }, 400);
  }
  if (caller.role !== 'admin' && caller.id !== id) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id, uid, email, name, role, is_active, email_verified, founder_id, partner_id, created_at FROM users WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'User not found' }, 404); }
  const result: any = { ...rows[0] };
  if (rows[0].founder_id) {
    const f = await sql`SELECT * FROM founders WHERE id = ${rows[0].founder_id}`;
    if (f.length > 0) result.founder = f[0];
  }
  if (rows[0].partner_id) {
    const p = await sql`SELECT * FROM partners WHERE id = ${rows[0].partner_id}`;
    if (p.length > 0) result.partner = p[0];
  }
  await sql.end();
  return c.json(result);
});

export default users;
