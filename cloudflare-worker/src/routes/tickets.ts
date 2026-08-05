/**
 * Ticket routes — CRUD + the outbound half of the ticket ↔ GitHub Issues
 * sync (Task #9). GitHub API calls live in services/githubSync.ts; every
 * outbound mutation records a `ticket_sync_events` row and surfaces an
 * explicit `github_sync_status` in the response (never silent).
 *
 * Comments stay GitHub-canonical: POST /:id/comments posts straight to the
 * linked issue (with an axal-sync source marker for loop prevention) and
 * GET /:id hydrates comments live from GitHub — no local comment table.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';
import {
  ensureTicketSyncSchema, recordSyncEvent, sha256Hex,
  validateTicketCreate, validateTicketUpdate, validateComment,
  labelsForTicket, mapGithubStatusToLocal, mapLocalStatusToGithub,
  parseLabelsFromGithub, syncMarker, assigneeLoginFor, githubConfigured,
  createIssue, updateIssue, addComment, setLabels, setAssignees,
  fetchIssue, fetchComments,
} from '../services/githubSync';

const tickets = new Hono<{ Bindings: Env }>();

function labelSnapshot(ghIssue: any): { labels: string; assignees: string } {
  return {
    labels: JSON.stringify((ghIssue?.labels || []).map((l: any) => (typeof l === 'string' ? l : l?.name)).filter(Boolean)),
    assignees: JSON.stringify((ghIssue?.assignees || []).map((a: any) => a?.login).filter(Boolean)),
  };
}

tickets.get('/', async (c) => {
  const user = await requireAuth(c);
  const status = c.req.query('status');
  const sql = getSQL(c.env);
  await ensureTicketSyncSchema(c.env);

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
  await ensureTicketSyncSchema(c.env);

  let rows;
  if (user.role === 'admin') {
    rows = await sql`SELECT * FROM tickets WHERE github_issue_number IS NOT NULL ORDER BY created_at DESC`;
  } else {
    rows = await sql`SELECT * FROM tickets WHERE user_id = ${user.id} AND github_issue_number IS NOT NULL ORDER BY created_at DESC`;
  }

  const updates: any[] = [];
  for (const ticket of rows) {
    const gh = await fetchIssue(c.env, ticket.github_issue_number);
    if (gh.ok && gh.data) {
      const ghIssue = gh.data;
      const newStatus = mapGithubStatusToLocal(ghIssue.state, ghIssue.state_reason);
      const parsed = parseLabelsFromGithub(ghIssue.labels);
      const snap = labelSnapshot(ghIssue);
      const newPriority = parsed.priority || ticket.priority;
      const newType = parsed.type || ticket.type || 'task';
      if (newStatus !== ticket.status || newPriority !== ticket.priority || newType !== ticket.type
          || snap.labels !== ticket.github_labels || snap.assignees !== ticket.github_assignees) {
        await sql`UPDATE tickets SET status = ${newStatus}, priority = ${newPriority}, type = ${newType}, github_labels = ${snap.labels}, github_assignees = ${snap.assignees}, updated_at = datetime('now') WHERE id = ${ticket.id}`;
        if (newStatus !== ticket.status) updates.push({ id: ticket.id, old_status: ticket.status, new_status: newStatus });
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
  const parsed = validateTicketCreate(await c.req.json().catch(() => null));
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const data = parsed.value;
  const sql = getSQL(c.env);
  await ensureTicketSyncSchema(c.env);

  const [ticket] = await sql`INSERT INTO tickets (title, description, priority, type, submitted_by, user_id, project_id) VALUES (${data.title}, ${data.description}, ${data.priority}, ${data.type}, ${user.name || user.email}, ${user.id}, ${data.project_id}) RETURNING *`;

  let githubIssue: any = null;
  let githubSyncError: string | null = null;
  if (githubConfigured(c.env)) {
    const body = `${data.description || ''}\n\n---\n**Submitted by:** ${user.name || 'User'}\n**Priority:** ${data.priority}\n**Type:** ${data.type}\n**Source:** StudioOS\n\n${syncMarker(ticket.id)}`;
    const gh = await createIssue(c.env, {
      title: data.title,
      body,
      labels: labelsForTicket({ type: data.type, priority: data.priority }),
    });
    if (gh.ok && gh.data?.number) {
      githubIssue = gh.data;
      const snap = labelSnapshot(githubIssue);
      await sql`UPDATE tickets SET github_issue_number = ${githubIssue.number}, github_issue_url = ${githubIssue.html_url}, github_labels = ${snap.labels}, github_assignees = ${snap.assignees} WHERE id = ${ticket.id}`;
      ticket.github_issue_number = githubIssue.number;
      ticket.github_issue_url = githubIssue.html_url;
      ticket.github_labels = snap.labels;
      ticket.github_assignees = snap.assignees;
      await recordSyncEvent(c.env, {
        ticketId: ticket.id, issueNumber: githubIssue.number, direction: 'outbound',
        eventKey: `out:create:ticket-${ticket.id}`,
        payloadHash: await sha256Hex(`${data.title}|${data.priority}|${data.type}`),
      });
    } else {
      githubSyncError = gh.error || 'github_create_failed';
      console.warn('[tickets] github issue create failed', githubSyncError);
    }
  }

  // Phase 1 (2026-05-26) — surface new tickets in #axal-review. Best-effort:
  // a missing Slack token or unreachable Slack must not break ticket creation
  // (DB write already committed above).
  try {
    const { postToChannel, buildEventCard } = await import('../services/slackBus');
    const priority = data.priority;
    const card = buildEventCard({
      appUrl: (c.env as { APP_URL?: string }).APP_URL || '',
      header: priority === 'urgent' || priority === 'high'
        ? ':rotating_light: New high-priority ticket'
        : ':ticket: New support ticket',
      title: data.title,
      body: data.description ? String(data.description).slice(0, 600) : null,
      fields: [
        { label: 'Submitted by', value: `${user.name || user.email} (${user.role || 'user'})` },
        { label: 'Priority', value: priority },
        { label: 'Type', value: data.type },
        ...(githubIssue ? [{ label: 'GitHub', value: `<${githubIssue.html_url}|#${githubIssue.number}>` }] : []),
      ],
      cta: { label: 'Open ticket', path: `/tickets/${ticket.id}` },
    });
    await postToChannel(c.env, {
      channel: 'review',
      text: card.text,
      blocks: card.blocks,
    });
  } catch (e) {
    console.warn('[tickets] slack notify failed', (e as Error).message);
  }

  await sql.end();
  return c.json({
    ...ticket,
    github_sync_status: githubIssue ? 'synced' : (githubConfigured(c.env) ? 'failed' : 'not_configured'),
    ...(githubSyncError ? { github_sync_error: githubSyncError } : {}),
  });
});

tickets.get('/:id{[0-9]+}', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  await ensureTicketSyncSchema(c.env);

  const rows = await sql`SELECT * FROM tickets WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Ticket not found' }, 404); }
  if (user.role !== 'admin' && rows[0].user_id !== user.id) { await sql.end(); return c.json({ error: 'Access denied' }, 403); }

  const ticket = rows[0];
  let comments: any[] = [];
  let githubStatus = null;

  if (ticket.github_issue_number) {
    const gh = await fetchIssue(c.env, ticket.github_issue_number);
    if (gh.ok && gh.data) {
      const ghIssue = gh.data;
      githubStatus = ghIssue.state;
      const newStatus = mapGithubStatusToLocal(ghIssue.state, ghIssue.state_reason);
      const snap = labelSnapshot(ghIssue);
      if (newStatus !== ticket.status || snap.labels !== ticket.github_labels || snap.assignees !== ticket.github_assignees) {
        await sql`UPDATE tickets SET status = ${newStatus}, github_labels = ${snap.labels}, github_assignees = ${snap.assignees}, updated_at = datetime('now') WHERE id = ${ticket.id}`;
        ticket.status = newStatus;
        ticket.github_labels = snap.labels;
        ticket.github_assignees = snap.assignees;
      }
    }
    const ghComments = await fetchComments(c.env, ticket.github_issue_number);
    comments = (ghComments.ok ? (ghComments.data as any[]) || [] : []).map((cm: any) => ({
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

// Task #9 — admin mapping/debug endpoint: ticket ↔ issue linkage + recent
// sync events (both directions) for observability.
tickets.get('/:id{[0-9]+}/mapping', async (c) => {
  const user = await requireAuth(c);
  if (user.role !== 'admin') return c.json({ error: 'Admin only' }, 403);
  const id = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  await ensureTicketSyncSchema(c.env);
  const rows = await sql`SELECT id, github_issue_number, github_issue_url, github_labels, github_assignees, status, priority, type FROM tickets WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Ticket not found' }, 404); }
  const events = await sql`SELECT direction, event_key, github_issue_number, payload_hash, created_at FROM ticket_sync_events WHERE ticket_id = ${id} OR github_issue_number = ${rows[0].github_issue_number ?? -1} ORDER BY id DESC LIMIT 20`;
  await sql.end();
  return c.json({
    ticket_id: rows[0].id,
    github_issue_number: rows[0].github_issue_number,
    github_issue_url: rows[0].github_issue_url,
    status: rows[0].status,
    priority: rows[0].priority,
    type: rows[0].type,
    github_labels: rows[0].github_labels ? JSON.parse(rows[0].github_labels) : [],
    github_assignees: rows[0].github_assignees ? JSON.parse(rows[0].github_assignees) : [],
    last_sync_events: events,
  });
});

// Task #9 — comments stay GitHub-canonical. Posts to the linked issue with
// the source marker so the inbound webhook drops the echo. 409 when the
// ticket has no linked issue (nothing to attach the comment to).
tickets.post('/:id{[0-9]+}/comments', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const parsed = validateComment(await c.req.json().catch(() => null));
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const sql = getSQL(c.env);
  await ensureTicketSyncSchema(c.env);

  const rows = await sql`SELECT * FROM tickets WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Ticket not found' }, 404); }
  if (user.role !== 'admin' && rows[0].user_id !== user.id) { await sql.end(); return c.json({ error: 'Access denied' }, 403); }
  const ticket = rows[0];
  if (!ticket.github_issue_number) { await sql.end(); return c.json({ error: 'no_linked_issue', message: 'This ticket has no linked GitHub issue to comment on.' }, 409); }

  const body = `${parsed.value.body}\n\n---\n_Comment by **${user.name || user.email}** via StudioOS_\n\n${syncMarker(ticket.id)}`;
  const gh = await addComment(c.env, ticket.github_issue_number, body);
  if (!gh.ok) {
    await sql.end();
    return c.json({ error: 'github_comment_failed', detail: gh.error || null, github_sync_status: 'failed' }, 502);
  }
  await recordSyncEvent(c.env, {
    ticketId: ticket.id, issueNumber: ticket.github_issue_number, direction: 'outbound',
    eventKey: `out:comment:${gh.data?.id ?? `${ticket.id}-${Date.now()}`}`,
    payloadHash: await sha256Hex(parsed.value.body),
  });
  await sql`UPDATE tickets SET updated_at = datetime('now') WHERE id = ${ticket.id}`;
  await sql.end();
  return c.json({
    ok: true,
    github_sync_status: 'synced',
    comment: {
      id: gh.data?.id,
      body: gh.data?.body,
      author: gh.data?.user?.login || 'unknown',
      author_avatar: gh.data?.user?.avatar_url || null,
      created_at: gh.data?.created_at,
      updated_at: gh.data?.updated_at,
    },
  });
});

tickets.put('/:id{[0-9]+}', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const parsed = validateTicketUpdate(await c.req.json().catch(() => null));
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const data = parsed.value;
  const sql = getSQL(c.env);
  await ensureTicketSyncSchema(c.env);
  const rows = await sql`SELECT * FROM tickets WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Ticket not found' }, 404); }
  if (user.role !== 'admin' && rows[0].user_id !== user.id) { await sql.end(); return c.json({ error: 'Access denied' }, 403); }
  const before = rows[0];

  if (data.status) await sql`UPDATE tickets SET status = ${data.status}, updated_at = datetime('now') WHERE id = ${id}`;
  if (data.priority) await sql`UPDATE tickets SET priority = ${data.priority}, updated_at = datetime('now') WHERE id = ${id}`;
  if (data.type) await sql`UPDATE tickets SET type = ${data.type}, updated_at = datetime('now') WHERE id = ${id}`;
  if (data.assigned_to) {
    if (user.role !== 'admin') { await sql.end(); return c.json({ error: 'Only admins can assign tickets' }, 403); }
    await sql`UPDATE tickets SET assigned_to = ${data.assigned_to}, updated_at = datetime('now') WHERE id = ${id}`;
  }

  const [updated] = await sql`SELECT * FROM tickets WHERE id = ${id}`;

  // Outbound GitHub mirror — best-effort, explicit status in response.
  let githubSyncStatus: string = 'not_linked';
  const ghErrors: string[] = [];
  if (updated.github_issue_number && githubConfigured(c.env)) {
    githubSyncStatus = 'synced';
    if (data.status && data.status !== before.status) {
      const gh = mapLocalStatusToGithub(data.status);
      const res = await updateIssue(c.env, updated.github_issue_number, gh.state === 'closed'
        ? { state: 'closed', state_reason: gh.state_reason }
        : { state: 'open' });
      if (!res.ok) { githubSyncStatus = 'partial'; ghErrors.push(`state: ${res.error}`); }
      else await recordSyncEvent(c.env, {
        ticketId: id, issueNumber: updated.github_issue_number, direction: 'outbound',
        eventKey: `out:state:${id}:${data.status}:${Date.now()}`,
      });
    }
    if ((data.priority && data.priority !== before.priority) || (data.type && data.type !== before.type)) {
      // Preserve unmanaged labels from the snapshot; swap only ours.
      const prev = parseLabelsFromGithub(updated.github_labels ? JSON.parse(updated.github_labels) : []);
      const managed = labelsForTicket({ type: updated.type, priority: updated.priority, categories: prev.categories });
      const unmanaged = prev.names.filter((n) => {
        const low = n.toLowerCase();
        return !/^priority:\s*(low|medium|high|urgent)$/.test(low)
          && !['bug', 'feature', 'task'].includes(low)
          && !['audit', 'beta-readiness', 'tracking'].includes(low)
          && low !== 'support-ticket';
      });
      const res = await setLabels(c.env, updated.github_issue_number, [...managed, ...unmanaged]);
      if (res.ok) {
        await sql`UPDATE tickets SET github_labels = ${JSON.stringify([...managed, ...unmanaged])} WHERE id = ${id}`;
        await recordSyncEvent(c.env, {
          ticketId: id, issueNumber: updated.github_issue_number, direction: 'outbound',
          eventKey: `out:labels:${id}:${Date.now()}`,
        });
      } else { githubSyncStatus = 'partial'; ghErrors.push(`labels: ${res.error}`); }
    }
    if (data.assigned_to && data.assigned_to !== before.assigned_to) {
      const login = assigneeLoginFor(c.env, data.assigned_to);
      if (login) {
        const res = await setAssignees(c.env, updated.github_issue_number, [login]);
        if (res.ok) {
          await sql`UPDATE tickets SET github_assignees = ${JSON.stringify([login])} WHERE id = ${id}`;
          await recordSyncEvent(c.env, {
            ticketId: id, issueNumber: updated.github_issue_number, direction: 'outbound',
            eventKey: `out:assign:${id}:${login}:${Date.now()}`,
          });
        } else { githubSyncStatus = 'partial'; ghErrors.push(`assignees: ${res.error}`); }
      } else {
        ghErrors.push('assignees: no GitHub login mapped for this assignee (set ADMIN_GITHUB_LOGINS)');
      }
    }
  }

  const [fresh] = await sql`SELECT * FROM tickets WHERE id = ${id}`;

  // Phase 0.2 notify — page the ticket owner on any update they didn't make.
  try {
    const ownerId = fresh?.user_id;
    if (ownerId && ownerId !== user.id) {
      const { notify } = await import('../services/notify');
      await notify(c.env, {
        userId: ownerId,
        type: 'ticket_update',
        title: `Ticket #${fresh.id} updated`,
        body: `Status: ${fresh.status}${fresh.assigned_to ? ` · assigned to ${fresh.assigned_to}` : ''}.`,
        link: '/tickets',
        payload: { ticket_id: fresh.id, status: fresh.status },
        channels: ['in_app', 'email'],
      });
    }
  } catch (e) { console.warn('[tickets] notify ticket_update failed', e); }

  await sql.end();
  return c.json({
    ...fresh,
    github_sync_status: githubSyncStatus,
    ...(ghErrors.length ? { github_sync_errors: ghErrors } : {}),
  });
});

export default tickets;
