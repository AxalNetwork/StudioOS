import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';

const activity = new Hono<{ Bindings: Env }>();

activity.get('/', async (c) => {
  const user = await requireAuth(c);
  const projectId = c.req.query('project_id');
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');
  const sql = getSQL(c.env);

  let countResult, rows;
  if (user.role === 'admin') {
    if (projectId) {
      countResult = await sql`SELECT COUNT(*) as total FROM activity_logs WHERE project_id = ${parseInt(projectId)}`;
      rows = await sql`SELECT * FROM activity_logs WHERE project_id = ${parseInt(projectId)} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
    } else {
      countResult = await sql`SELECT COUNT(*) as total FROM activity_logs`;
      rows = await sql`SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
    }
  } else {
    if (projectId) {
      countResult = await sql`SELECT COUNT(*) as total FROM activity_logs WHERE actor = ${user.email} AND project_id = ${parseInt(projectId)}`;
      rows = await sql`SELECT * FROM activity_logs WHERE actor = ${user.email} AND project_id = ${parseInt(projectId)} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
    } else {
      countResult = await sql`SELECT COUNT(*) as total FROM activity_logs WHERE actor = ${user.email}`;
      rows = await sql`SELECT * FROM activity_logs WHERE actor = ${user.email} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
    }
  }
  await sql.end();
  return c.json({ logs: rows, total: parseInt(countResult[0].total), limit, offset });
});

activity.get('/summary', async (c) => {
  const user = await requireAuth(c);
  const sql = getSQL(c.env);

  let total, recent, actionCounts;
  if (user.role === 'admin') {
    total = await sql`SELECT COUNT(*) as count FROM activity_logs`;
    recent = await sql`SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 10`;
    actionCounts = await sql`SELECT action, COUNT(*) as count FROM activity_logs GROUP BY action`;
  } else {
    total = await sql`SELECT COUNT(*) as count FROM activity_logs WHERE actor = ${user.email}`;
    recent = await sql`SELECT * FROM activity_logs WHERE actor = ${user.email} ORDER BY created_at DESC LIMIT 10`;
    actionCounts = await sql`SELECT action, COUNT(*) as count FROM activity_logs WHERE actor = ${user.email} GROUP BY action`;
  }
  await sql.end();

  const breakdown: Record<string, number> = {};
  for (const r of actionCounts) breakdown[r.action] = parseInt(r.count);

  return c.json({ total_events: parseInt(total[0].count), recent, action_breakdown: breakdown });
});

export default activity;
