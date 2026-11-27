/**
 * `/api/users`: user administration reads. Listing users exposes names and roles, so it is admin only; one user's
 * record is its owner's, an admin's for a non-admin, and the Super Admin's for an admin (D9041, #9041). The unused,
 * unaudited admin create (`POST /`) was retired by D9041; accounts are made by sign-up and invitations.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth, requireAdmin, isSuperAdmin } from '../auth';

const users = new Hono<{ Bindings: Env }>();

users.get('/', async (c) => {
  // Listing all users exposes emails/names/roles — admin only.
  await requireAdmin(c);
  const role = c.req.query('role');
  const sql = getSQL(c.env);
  const rows = role
    ? await sql`SELECT id, uid, email, name, role, is_active, email_verified, created_at FROM users WHERE role = ${role} ORDER BY created_at DESC`
    : await sql`SELECT id, uid, email, name, role, is_active, email_verified, created_at FROM users ORDER BY created_at DESC`;
  await sql.end();
  return c.json(rows);
});

users.get('/:id', async (c) => {
  // A user may view their own record; an admin may view a non-admin's. Another admin's
  // record, a Super Admin's included, belongs to the Super Admin (AGENTS.md, D9041).
  const caller = await requireAuth(c);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'invalid_user_id', detail: 'Invalid user id' }, 400);
  }
  const own = caller.id === id;
  if (caller.role !== 'admin' && !own) {
    return c.json({ error: 'forbidden', detail: 'Forbidden' }, 403);
  }
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id, uid, email, name, role, is_active, email_verified, founder_id, partner_id, created_at FROM users WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'not_found', detail: 'User not found' }, 404); }
  if (!own && String(rows[0].role ?? '').toLowerCase() === 'admin' && !isSuperAdmin(caller as any)) {
    await sql.end();
    return c.json({ error: 'super_admin_required', detail: 'Another admin\'s record is read by the Super Admin.' }, 403);
  }
  const result: any = { ...rows[0] };
  if (rows[0].founder_id) {
    const f = await sql`SELECT id, uid, name, email, company, linkedin_url, domain_expertise, experience_years, bio, created_at FROM founders WHERE id = ${rows[0].founder_id}`;
    if (f.length > 0) result.founder = f[0];
  }
  if (rows[0].partner_id) {
    const p = await sql`SELECT id, uid, name, company, email, specialization, status, created_at FROM partners WHERE id = ${rows[0].partner_id}`;
    if (p.length > 0) result.partner = p[0];
  }
  await sql.end();
  return c.json(result);
});

export default users;
