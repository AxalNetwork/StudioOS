import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAdmin, createJWT } from '../auth';

const admin = new Hono<{ Bindings: Env }>();

admin.get('/users', async (c) => {
  await requireAdmin(c);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id, uid, email, name, role, is_active, email_verified, created_at FROM users ORDER BY created_at DESC`;
  await sql.end();
  return c.json(rows);
});

admin.post('/impersonate/:userId', async (c) => {
  const adminUser = await requireAdmin(c);
  const userId = parseInt(c.req.param('userId'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM users WHERE id = ${userId}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'User not found' }, 404); }
  const target = rows[0];
  const token = await createJWT(c.env, target.id, target.email, target.role, adminUser.id);
  await sql`INSERT INTO activity_logs (action, details, actor) VALUES ('admin_impersonate', ${`Admin ${adminUser.name} impersonated user ${target.name} (${target.email})`}, ${adminUser.email})`;
  await sql.end();
  return c.json({ token, user: { id: target.id, email: target.email, name: target.name, role: target.role } });
});

admin.patch('/users/:userId/role', async (c) => {
  const adminUser = await requireAdmin(c);
  const userId = parseInt(c.req.param('userId'));
  const { role } = await c.req.json();
  if (!['admin', 'founder', 'partner'].includes(role)) return c.json({ error: `Invalid role: ${role}` }, 400);

  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM users WHERE id = ${userId}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'User not found' }, 404); }
  if (rows[0].id === adminUser.id) { await sql.end(); return c.json({ error: 'Cannot change your own role' }, 400); }

  const oldRole = rows[0].role;
  await sql`UPDATE users SET role = ${role} WHERE id = ${userId}`;
  await sql`INSERT INTO activity_logs (action, details, actor) VALUES ('role_changed', ${`Admin ${adminUser.name} changed ${rows[0].name}'s role from ${oldRole} to ${role}`}, ${adminUser.email})`;
  await sql.end();
  return c.json({ message: `Role updated to ${role}`, user_id: userId, role });
});

admin.patch('/users/:userId/toggle-active', async (c) => {
  const adminUser = await requireAdmin(c);
  const userId = parseInt(c.req.param('userId'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM users WHERE id = ${userId}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'User not found' }, 404); }
  if (rows[0].id === adminUser.id) { await sql.end(); return c.json({ error: 'Cannot deactivate yourself' }, 400); }

  const newActive = !rows[0].is_active;
  await sql`UPDATE users SET is_active = ${newActive} WHERE id = ${userId}`;
  await sql`INSERT INTO activity_logs (action, details, actor) VALUES ('user_toggled', ${`Admin ${adminUser.name} ${newActive ? 'activated' : 'deactivated'} user ${rows[0].name}`}, ${adminUser.email})`;
  await sql.end();
  return c.json({ message: `User ${newActive ? 'activated' : 'deactivated'}`, is_active: newActive });
});

export default admin;
