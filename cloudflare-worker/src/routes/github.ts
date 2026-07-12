/**
 * Inbound GitHub webhook. Mounted at `/api/github`.
 *
 *   POST /webhook  → verify X-Hub-Signature-256 against GITHUB_WEBHOOK_SECRET,
 *                    then on issue closed/reopened/edited update the matching
 *                    ticket's status by github_issue_number.
 *
 * Public (no auth) but signature-verified. Non-issue events, unknown issue
 * numbers, and irrelevant actions are acknowledged without changes so GitHub
 * doesn't retry. Pull-based sync in routes/tickets.ts remains the fallback.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';

const github = new Hono<{ Bindings: Env }>();

function mapGithubStatusToLocal(ghState: string, ghStateReason?: string): string {
  if (ghState === 'closed') {
    if (ghStateReason === 'not_planned') return 'closed';
    return 'resolved';
  }
  return 'open';
}

// Constant-time-ish compare over hex strings of equal length.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function verifySignature(secret: string, raw: ArrayBuffer, header: string | null): Promise<boolean> {
  if (!header || !header.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, raw);
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(`sha256=${hex}`, header.trim());
}

github.post('/webhook', async (c) => {
  const secret = c.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return c.json({ error: 'webhook_secret_not_configured' }, 503);

  const raw = await c.req.arrayBuffer();
  const signature = c.req.header('X-Hub-Signature-256') || null;
  if (!(await verifySignature(secret, raw, signature))) {
    return c.json({ error: 'invalid_signature' }, 401);
  }

  const event = c.req.header('X-GitHub-Event');
  if (event !== 'issues') {
    return c.json({ ok: true, ignored: event || 'unknown' });
  }

  let payload: any;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const action = payload?.action;
  const issue = payload?.issue || {};
  const issueNumber = issue?.number;
  if (!issueNumber) return c.json({ ok: true, ignored: 'no_issue_number' });
  if (!['closed', 'reopened', 'edited'].includes(action)) {
    return c.json({ ok: true, ignored: `action:${action}` });
  }

  const newStatus = mapGithubStatusToLocal(issue.state, issue.state_reason);
  const sql = getSQL(c.env);
  try {
    const rows = await sql`SELECT id, status FROM tickets WHERE github_issue_number = ${issueNumber}`;
    if (rows.length === 0) {
      await sql.end();
      return c.json({ ok: true, ignored: 'no_matching_ticket', issue: issueNumber });
    }
    const ticket = rows[0];
    if (ticket.status !== newStatus) {
      await sql`UPDATE tickets SET status = ${newStatus}, updated_at = datetime('now') WHERE id = ${ticket.id}`;
      await sql.end();
      return c.json({ ok: true, updated: true, ticket_id: ticket.id, status: newStatus });
    }
    await sql.end();
    return c.json({ ok: true, updated: false, ticket_id: ticket.id, status: newStatus });
  } catch (e: any) {
    try { await sql.end(); } catch { /* noop */ }
    return c.json({ error: 'db_error', detail: String(e?.message || e).slice(0, 200) }, 500);
  }
});

export default github;
