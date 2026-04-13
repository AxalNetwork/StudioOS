import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';

const tickets = new Hono<{ Bindings: Env }>();

tickets.get('/', async (c) => {
  const user = await requireAuth(c);
  const status = c.req.query('status');
  const sql = getSQL(c.env);

  let rows;
  if (user.role === 'admin') {
    rows = status
      ? await sql`SELECT * FROM tickets WHERE status = ${status} ORDER BY created_at DESC`
      : await sql`SELECT * FROM tickets ORDER BY created_at DESC`;
  } else {
    rows = status
      ? await sql`SELECT * FROM tickets WHERE user_id = ${user.id} AND status = ${status} ORDER BY created_at DESC`
      : await sql`SELECT * FROM tickets WHERE user_id = ${user.id} ORDER BY created_at DESC`;
  }
  await sql.end();
  return c.json(rows);
});

tickets.post('/', async (c) => {
  const user = await requireAuth(c);
  const data = await c.req.json();
  const sql = getSQL(c.env);

  const [ticket] = await sql`INSERT INTO tickets (title, description, priority, submitted_by, user_id, project_id) VALUES (${data.title}, ${data.description || null}, ${data.priority || 'medium'}, ${user.name || user.email}, ${user.id}, ${data.project_id || null}) RETURNING *`;
  await sql.end();

  let githubIssue = null;
  if (c.env.GITHUB_ACCESS_TOKEN) {
    try {
      const resp = await fetch(`https://api.github.com/repos/${c.env.GITHUB_REPO_OWNER}/${c.env.GITHUB_REPO_NAME}/issues`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${c.env.GITHUB_ACCESS_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: data.title, body: `${data.description || ''}\n\n---\n**Submitted by:** ${user.name}\n**Priority:** ${data.priority || 'medium'}\n**Source:** StudioOS`, labels: [`priority: ${data.priority || 'medium'}`, 'support-ticket'] }),
      });
      if (resp.ok) githubIssue = await resp.json();
    } catch {}
  }

  return c.json({ ...ticket, github_issue: githubIssue ? { number: (githubIssue as any).number, url: (githubIssue as any).html_url } : null, github_sync_status: githubIssue ? 'synced' : 'failed' });
});

tickets.get('/:id', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM tickets WHERE id = ${id}`;
  await sql.end();
  if (rows.length === 0) return c.json({ error: 'Ticket not found' }, 404);
  if (user.role !== 'admin' && rows[0].user_id !== user.id) return c.json({ error: 'Access denied' }, 403);
  return c.json(rows[0]);
});

tickets.put('/:id', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const data = await c.req.json();
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM tickets WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Ticket not found' }, 404); }
  if (user.role !== 'admin' && rows[0].user_id !== user.id) { await sql.end(); return c.json({ error: 'Access denied' }, 403); }

  if (data.status) await sql`UPDATE tickets SET status = ${data.status}, updated_at = now() WHERE id = ${id}`;
  if (data.assigned_to) {
    if (user.role !== 'admin') { await sql.end(); return c.json({ error: 'Only admins can assign tickets' }, 403); }
    await sql`UPDATE tickets SET assigned_to = ${data.assigned_to}, updated_at = now() WHERE id = ${id}`;
  }

  const [updated] = await sql`SELECT * FROM tickets WHERE id = ${id}`;
  await sql.end();
  return c.json(updated);
});

export default tickets;
