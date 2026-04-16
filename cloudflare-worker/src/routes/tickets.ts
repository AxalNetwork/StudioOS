import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';

const tickets = new Hono<{ Bindings: Env }>();

async function ensureGithubColumns(env: Env) {
  const db = env.DB;
  try {
    await db.prepare(`ALTER TABLE tickets ADD COLUMN github_issue_number INTEGER`).run();
  } catch {}
  try {
    await db.prepare(`ALTER TABLE tickets ADD COLUMN github_issue_url TEXT`).run();
  } catch {}
}

async function fetchGithubIssue(env: Env, issueNumber: number) {
  if (!env.GITHUB_ACCESS_TOKEN || !env.GITHUB_REPO_OWNER || !env.GITHUB_REPO_NAME) return null;
  try {
    const resp = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/issues/${issueNumber}`, {
      headers: {
        Authorization: `Bearer ${env.GITHUB_ACCESS_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'StudioOS-Worker',
      },
    });
    if (resp.ok) return await resp.json() as any;
  } catch {}
  return null;
}

async function fetchGithubComments(env: Env, issueNumber: number) {
  if (!env.GITHUB_ACCESS_TOKEN || !env.GITHUB_REPO_OWNER || !env.GITHUB_REPO_NAME) return [];
  try {
    const resp = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/issues/${issueNumber}/comments?per_page=50`, {
      headers: {
        Authorization: `Bearer ${env.GITHUB_ACCESS_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'StudioOS-Worker',
      },
    });
    if (resp.ok) return await resp.json() as any[];
  } catch {}
  return [];
}

function mapGithubStatusToLocal(ghState: string, ghStateReason?: string): string {
  if (ghState === 'closed') {
    if (ghStateReason === 'not_planned') return 'closed';
    return 'resolved';
  }
  return 'open';
}

tickets.get('/', async (c) => {
  const user = await requireAuth(c);
  const status = c.req.query('status');
  const sql = getSQL(c.env);
  await ensureGithubColumns(c.env);

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

tickets.post('/sync', async (c) => {
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  await ensureGithubColumns(c.env);

  let rows;
  if (user.role === 'admin') {
    rows = await sql`SELECT * FROM tickets WHERE github_issue_number IS NOT NULL ORDER BY created_at DESC`;
  } else {
    rows = await sql`SELECT * FROM tickets WHERE user_id = ${user.id} AND github_issue_number IS NOT NULL ORDER BY created_at DESC`;
  }

  const updates: any[] = [];
  for (const ticket of rows) {
    const ghIssue = await fetchGithubIssue(c.env, ticket.github_issue_number);
    if (ghIssue) {
      const newStatus = mapGithubStatusToLocal(ghIssue.state, ghIssue.state_reason);
      if (newStatus !== ticket.status) {
        await sql`UPDATE tickets SET status = ${newStatus}, updated_at = datetime('now') WHERE id = ${ticket.id}`;
        updates.push({ id: ticket.id, old_status: ticket.status, new_status: newStatus });
      }
    }
  }

  const updatedRows = user.role === 'admin'
    ? await sql`SELECT * FROM tickets ORDER BY created_at DESC`
    : await sql`SELECT * FROM tickets WHERE user_id = ${user.id} ORDER BY created_at DESC`;
  await sql.end();
  return c.json({ tickets: updatedRows, synced: updates.length });
});

tickets.post('/', async (c) => {
  const user = await requireAuth(c);
  const data = await c.req.json();
  const sql = getSQL(c.env);
  await ensureGithubColumns(c.env);

  const [ticket] = await sql`INSERT INTO tickets (title, description, priority, submitted_by, user_id, project_id) VALUES (${data.title}, ${data.description || null}, ${data.priority || 'medium'}, ${user.name || user.email}, ${user.id}, ${data.project_id || null}) RETURNING *`;

  let githubIssue = null;
  if (c.env.GITHUB_ACCESS_TOKEN) {
    try {
      const resp = await fetch(`https://api.github.com/repos/${c.env.GITHUB_REPO_OWNER}/${c.env.GITHUB_REPO_NAME}/issues`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${c.env.GITHUB_ACCESS_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          'User-Agent': 'StudioOS-Worker',
        },
        body: JSON.stringify({
          title: data.title,
          body: `${data.description || ''}\n\n---\n**Submitted by:** ${user.name || 'User'}\n**Priority:** ${data.priority || 'medium'}\n**Source:** StudioOS`,
          labels: [`priority: ${data.priority || 'medium'}`, 'support-ticket'],
        }),
      });
      if (resp.ok) {
        githubIssue = await resp.json() as any;
        await sql`UPDATE tickets SET github_issue_number = ${githubIssue.number}, github_issue_url = ${githubIssue.html_url} WHERE id = ${ticket.id}`;
        ticket.github_issue_number = githubIssue.number;
        ticket.github_issue_url = githubIssue.html_url;
      }
    } catch {}
  }

  await sql.end();
  return c.json({ ...ticket, github_sync_status: githubIssue ? 'synced' : 'failed' });
});

tickets.get('/:id', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  await ensureGithubColumns(c.env);

  const rows = await sql`SELECT * FROM tickets WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Ticket not found' }, 404); }
  if (user.role !== 'admin' && rows[0].user_id !== user.id) { await sql.end(); return c.json({ error: 'Access denied' }, 403); }

  const ticket = rows[0];
  let comments: any[] = [];
  let githubStatus = null;

  if (ticket.github_issue_number) {
    const ghIssue = await fetchGithubIssue(c.env, ticket.github_issue_number);
    if (ghIssue) {
      githubStatus = ghIssue.state;
      const newStatus = mapGithubStatusToLocal(ghIssue.state, ghIssue.state_reason);
      if (newStatus !== ticket.status) {
        await sql`UPDATE tickets SET status = ${newStatus}, updated_at = datetime('now') WHERE id = ${ticket.id}`;
        ticket.status = newStatus;
      }
    }
    const ghComments = await fetchGithubComments(c.env, ticket.github_issue_number);
    comments = ghComments.map((cm: any) => ({
      id: cm.id,
      body: cm.body,
      author: cm.user?.login || 'unknown',
      author_avatar: cm.user?.avatar_url || null,
      created_at: cm.created_at,
      updated_at: cm.updated_at,
    }));
  }

  await sql.end();
  return c.json({ ...ticket, comments, github_status: githubStatus });
});

tickets.put('/:id', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const data = await c.req.json();
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM tickets WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Ticket not found' }, 404); }
  if (user.role !== 'admin' && rows[0].user_id !== user.id) { await sql.end(); return c.json({ error: 'Access denied' }, 403); }

  if (data.status) await sql`UPDATE tickets SET status = ${data.status}, updated_at = datetime('now') WHERE id = ${id}`;
  if (data.assigned_to) {
    if (user.role !== 'admin') { await sql.end(); return c.json({ error: 'Only admins can assign tickets' }, 403); }
    await sql`UPDATE tickets SET assigned_to = ${data.assigned_to}, updated_at = datetime('now') WHERE id = ${id}`;
  }

  const [updated] = await sql`SELECT * FROM tickets WHERE id = ${id}`;
  await sql.end();
  return c.json(updated);
});

export default tickets;
