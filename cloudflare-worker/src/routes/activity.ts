import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';
import { clampLimit, parseOffset } from '../util/pagination';

const activity = new Hono<{ Bindings: Env }>();

// T16 — backfillUserId() used to run a full UPDATE on every request to map
// legacy activity_logs.actor (email) → user_id. The one-time SQL migration
// at sql/backfill_activity_user_ids.sql replaces it. Apply once via
// `wrangler d1 execute … --remote`; new INSERTs already set user_id directly.

activity.get('/', async (c) => {
  const user = await requireAuth(c);
  const limit = clampLimit(c.req.query('limit'));
  const offset = parseOffset(c.req.query('offset'));
  const sql = getSQL(c.env);

  // STRICT per-user privacy — even admins only see their OWN activity here.
  const countResult = await sql`
    SELECT COUNT(*) as total FROM activity_logs
    WHERE user_id = ${user.id} OR LOWER(actor) = LOWER(${user.email})
  `;
  const rows = await sql`
    SELECT * FROM activity_logs
    WHERE user_id = ${user.id} OR LOWER(actor) = LOWER(${user.email})
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  await sql.end();
  // T17 — Standard pagination envelope. `logs` retained for backwards
  // compatibility with existing ActivityPage; `items` is the new canonical
  // field that future callers should use.
  return c.json({
    items: rows,
    logs: rows,
    total: parseInt(countResult[0].total),
    limit,
    offset,
    user_id: user.id,
  });
});

activity.get('/summary', async (c) => {
  const user = await requireAuth(c);
  const sql = getSQL(c.env);

  const total = await sql`
    SELECT COUNT(*) as count FROM activity_logs
    WHERE user_id = ${user.id} OR LOWER(actor) = LOWER(${user.email})
  `;
  const recent = await sql`
    SELECT * FROM activity_logs
    WHERE user_id = ${user.id} OR LOWER(actor) = LOWER(${user.email})
    ORDER BY created_at DESC LIMIT 10
  `;
  const actionCounts = await sql`
    SELECT action, COUNT(*) as count FROM activity_logs
    WHERE user_id = ${user.id} OR LOWER(actor) = LOWER(${user.email})
    GROUP BY action
  `;
  await sql.end();

  const breakdown: Record<string, number> = {};
  for (const r of actionCounts) breakdown[r.action] = parseInt(r.count);

  return c.json({
    total_events: parseInt(total[0].count),
    recent,
    action_breakdown: breakdown,
    user_id: user.id,
  });
});

// ---------- GitHub sync ----------
// Mirrors the user's activity log to AxalNetwork/StudioOS at users/{user_id}/activity.md
activity.post('/sync-github', async (c) => {
  const user = await requireAuth(c);
  const env = c.env;

  if (!env.GITHUB_ACCESS_TOKEN || !env.GITHUB_REPO_OWNER || !env.GITHUB_REPO_NAME) {
    return c.json({
      status: 'failed',
      message: 'GitHub sync is not configured on the server. Ask an admin to set GITHUB_ACCESS_TOKEN.',
    }, 503);
  }

  const sql = getSQL(env);
  // T17 — was an unbounded SELECT *; cap at 5000 most-recent rows so a
  // long-tenured user's sync can't OOM the worker isolate or generate a
  // multi-MB GitHub commit.
  const rows = await sql`
    SELECT id, action, details, actor, created_at FROM activity_logs
    WHERE user_id = ${user.id} OR LOWER(actor) = LOWER(${user.email})
    ORDER BY created_at DESC
    LIMIT 5000
  `;
  await sql.end();

  const owner = env.GITHUB_REPO_OWNER;
  const repo = env.GITHUB_REPO_NAME;
  const path = `users/${user.id}/activity.md`;
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const headers = {
    Authorization: `Bearer ${env.GITHUB_ACCESS_TOKEN}`,
    'User-Agent': 'Axal-StudioOS-Worker',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // Build the markdown
  const generatedAt = new Date().toISOString();
  const lines = [
    `# Activity Log — User #${user.id}`,
    ``,
    `- **Name:** ${user.name}`,
    `- **Email:** ${user.email}`,
    `- **Role:** ${user.role}`,
    `- **Generated:** ${generatedAt}`,
    `- **Total events:** ${rows.length}`,
    ``,
    `> This file is generated automatically by Axal VC StudioOS and contains only this user's own activity.`,
    `> Capped at 5000 most-recent events.`,
    ``,
    `| When | Action | Details |`,
    `| --- | --- | --- |`,
    ...rows.map((r: any) => {
      const when = String(r.created_at || '').replace(/\|/g, '/');
      const action = String(r.action || '').replace(/\|/g, '/');
      const details = String(r.details || '').replace(/\|/g, '/').replace(/\n/g, ' ');
      return `| ${when} | ${action} | ${details} |`;
    }),
    ``,
  ];
  const content = lines.join('\n');
  const contentB64 = btoa(unescape(encodeURIComponent(content)));

  // Find existing SHA if file already exists
  let existingSha: string | undefined;
  try {
    const probe = await fetch(apiUrl, { headers });
    if (probe.ok) {
      const data: any = await probe.json();
      if (data && data.sha) existingSha = data.sha;
    }
  } catch {}

  const commitMsg = `chore(activity): sync user #${user.id} (${rows.length} events)`;
  const body: any = {
    message: commitMsg,
    content: contentB64,
    committer: { name: 'Axal VC StudioOS', email: 'noreply@axal.vc' },
  };
  if (existingSha) body.sha = existingSha;

  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!putRes.ok) {
    const errText = await putRes.text().catch(() => '');
    return c.json({
      status: 'failed',
      message: `GitHub commit failed (${putRes.status}). ${errText.slice(0, 200)}`,
    }, 502);
  }

  const result: any = await putRes.json();
  const githubUrl = result?.content?.html_url
    || `https://github.com/${owner}/${repo}/blob/main/${path}`;

  // Log the sync itself
  const sql2 = getSQL(env);
  await sql2`
    INSERT INTO activity_logs (action, details, actor, user_id)
    VALUES ('github_synced', ${`Activity log synced to GitHub: ${path}`}, ${user.email}, ${user.id})
  `;
  await sql2.end();

  return c.json({
    status: 'synced',
    entries: rows.length,
    github_url: githubUrl,
    path,
  });
});

export default activity;
