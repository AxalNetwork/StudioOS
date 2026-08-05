/**
 * Inbound GitHub webhook — the GitHub→Platform half of the ticket sync
 * (Task #9). Mounted at `/api/github`.
 *
 *   POST /webhook  → verify X-Hub-Signature-256 against GITHUB_WEBHOOK_SECRET,
 *                    then:
 *     - `issues` closed/reopened/edited          → ticket status + snapshots
 *     - `issues` labeled/unlabeled               → ticket priority/type + label snapshot
 *     - `issues` assigned/unassigned             → assignee snapshot
 *     - `issue_comment` created                  → bump updated_at + notify owner
 *
 * Loop prevention:
 *   - deliveries are deduped by the `X-GitHub-Delivery` GUID via the
 *     ticket_sync_events table (INSERT OR IGNORE);
 *   - events whose body carries the axal-sync source marker, or whose sender
 *     matches GITHUB_SYNC_BOT_LOGIN (the token identity), are acknowledged
 *     and dropped — they are echoes of our own outbound writes.
 *
 * Public (no auth) but signature-verified. Non-issue events, unknown issue
 * numbers, and irrelevant actions are acknowledged with 2xx so GitHub
 * doesn't retry. Pull-based sync in routes/tickets.ts remains the fallback.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import {
  ensureTicketSyncSchema, recordSyncEvent, sha256Hex,
  mapGithubStatusToLocal, parseLabelsFromGithub, hasSyncMarker,
} from '../services/githubSync';

const github = new Hono<{ Bindings: Env }>();

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

const ISSUE_ACTIONS = ['closed', 'reopened', 'edited', 'labeled', 'unlabeled', 'assigned', 'unassigned'];

github.post('/webhook', async (c) => {
  const secret = c.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return c.json({ error: 'webhook_secret_not_configured' }, 503);

  const raw = await c.req.arrayBuffer();
  const signature = c.req.header('X-Hub-Signature-256') || null;
  if (!(await verifySignature(secret, raw, signature))) {
    return c.json({ error: 'invalid_signature' }, 401);
  }

  const event = c.req.header('X-GitHub-Event');
  if (event !== 'issues' && event !== 'issue_comment') {
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

  if (event === 'issues' && !ISSUE_ACTIONS.includes(action)) {
    return c.json({ ok: true, ignored: `action:${action}` });
  }
  if (event === 'issue_comment' && action !== 'created') {
    return c.json({ ok: true, ignored: `action:${action}` });
  }

  // Loop prevention — drop echoes of our own outbound writes.
  const senderLogin: string | null = payload?.sender?.login || null;
  const botLogin = (c.env as any).GITHUB_SYNC_BOT_LOGIN as string | undefined;
  if (botLogin && senderLogin && senderLogin.toLowerCase() === botLogin.toLowerCase()) {
    return c.json({ ok: true, ignored: 'sync_bot_actor' });
  }
  // Only COMMENT bodies are marker-dropped: our issue bodies always carry the
  // marker, but a human closing/labeling that issue must still sync back.
  if (event === 'issue_comment' && hasSyncMarker(payload?.comment?.body)) {
    return c.json({ ok: true, ignored: 'sync_marker' });
  }

  await ensureTicketSyncSchema(c.env);

  // Idempotency — GitHub redelivers on timeouts; dedupe by delivery GUID.
  const delivery = c.req.header('X-GitHub-Delivery') || null;
  if (delivery) {
    const firstSeen = await recordSyncEvent(c.env, {
      issueNumber,
      direction: 'inbound',
      eventKey: `gh:${delivery}`,
      payloadHash: await sha256Hex(`${event}:${action}:${issueNumber}`),
    });
    if (!firstSeen) {
      return c.json({ ok: true, ignored: 'duplicate_delivery', delivery });
    }
  }

  const sql = getSQL(c.env);
  try {
    const rows = await sql`SELECT id, status, priority, type, user_id, title FROM tickets WHERE github_issue_number = ${issueNumber}`;
    if (rows.length === 0) {
      await sql.end();
      return c.json({ ok: true, ignored: 'no_matching_ticket', issue: issueNumber });
    }
    const ticket = rows[0];

    if (event === 'issue_comment') {
      // Comments are GitHub-canonical (detail view hydrates live); just bump
      // freshness and page the ticket owner.
      await sql`UPDATE tickets SET updated_at = datetime('now') WHERE id = ${ticket.id}`;
      try {
        if (ticket.user_id) {
          const { notify } = await import('../services/notify');
          await notify(c.env, {
            userId: ticket.user_id,
            type: 'ticket_update',
            title: `New comment on ticket #${ticket.id}`,
            body: `${senderLogin || 'Someone'} commented on "${ticket.title}".`,
            link: '/tickets',
            payload: { ticket_id: ticket.id, github_comment_id: payload?.comment?.id },
            channels: ['in_app'],
          });
        }
      } catch (e) { console.warn('[github] notify comment failed', e); }
      await sql.end();
      return c.json({ ok: true, updated: true, ticket_id: ticket.id, event: 'comment' });
    }

    // `issues` events — compute the full desired local state from the issue
    // payload (absolute writes, so redeliveries and out-of-order events are
    // safe) and apply whatever changed.
    const newStatus = mapGithubStatusToLocal(issue.state, issue.state_reason);
    const parsed = parseLabelsFromGithub(issue.labels);
    const labelsSnap = JSON.stringify(parsed.names);
    const assigneesSnap = JSON.stringify((issue.assignees || []).map((a: any) => a?.login).filter(Boolean));
    const newPriority = parsed.priority || ticket.priority;
    const newType = parsed.type || ticket.type || 'task';

    const changed = newStatus !== ticket.status || newPriority !== ticket.priority || newType !== ticket.type;
    await sql`UPDATE tickets SET status = ${newStatus}, priority = ${newPriority}, type = ${newType}, github_labels = ${labelsSnap}, github_assignees = ${assigneesSnap}, updated_at = datetime('now') WHERE id = ${ticket.id}`;

    // Notify the owner on meaningful state flips they didn't cause.
    if (changed && newStatus !== ticket.status) {
      try {
        if (ticket.user_id) {
          const { notify } = await import('../services/notify');
          await notify(c.env, {
            userId: ticket.user_id,
            type: 'ticket_update',
            title: `Ticket #${ticket.id} updated`,
            body: `Status: ${newStatus}.`,
            link: '/tickets',
            payload: { ticket_id: ticket.id, status: newStatus },
            channels: ['in_app'],
          });
        }
      } catch (e) { console.warn('[github] notify status failed', e); }
    }

    await sql.end();
    return c.json({ ok: true, updated: changed, ticket_id: ticket.id, status: newStatus, priority: newPriority, type: newType });
  } catch (e: any) {
    try { await sql.end(); } catch { /* noop */ }
    return c.json({ error: 'db_error', detail: String(e?.message || e).slice(0, 200) }, 500);
  }
});

export default github;
