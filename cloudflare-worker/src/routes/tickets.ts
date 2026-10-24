/**
 * Ticket routes — CRUD + the outbound half of the ticket ↔ GitHub Issues
 * sync (Task #9). GitHub API calls live in services/githubSync.ts; every
 * outbound mutation records a `ticket_sync_events` row and surfaces an
 * explicit `github_sync_status` in the response (never silent).
 *
 * Comments stay GitHub-canonical: POST /:id/comments posts straight to the
 * linked issue (with an axal-sync source marker for loop prevention) and
 * GET /:id hydrates comments live from GitHub — no local comment table.
 *
 * D604 (#1280 step 4) — the Help Center's ticket screens. Every row carries
 * `review` (a feature request's review, from `feature_request_reviews`) and,
 * for an admin, `sla` (tier, hours and band). GET /:id returns the comments
 * as `thread`, by side (`ticketScreens.ts`), with `thread_unreadable` when
 * GitHub could not be read. POST /:id/mirror retries one ticket's mirror.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';
import {
  ensureTicketSyncSchema, recordSyncEvent, sha256Hex,
  validateTicketCreate, validateTicketUpdate, validateComment,
  labelsForTicket, mapGithubStatusToLocal, mapLocalStatusToGithub,
  parseLabelsFromGithub, assigneeLoginFor, githubConfigured,
  createIssue, updateIssue, addComment, setLabels, setAssignees,
  fetchIssue, fetchComments, mirrorIssueBody, mirrorReplyBody,
} from '../services/githubSync';
import { refusalBody } from '../util/refusal';
import { bountySummaries } from '../services/bugBounties';
import { parseTicketCategory } from '../services/ticketCategories';
import { readSlaTiers } from '../services/supportSlaPolicy';
import { reviewsForTickets, slaForTicket, threadEntry } from '../services/ticketScreens';

const tickets = new Hono<{ Bindings: Env }>();

/**
 * D604 — what the ticket screens draw beside each row: the review of a
 * feature request, for everyone, and the SLA, for an admin (the queue's
 * column). `sla` is absent for a member: the canvas never shows them one.
 */
async function forScreens(env: Env, rows: any[], isAdmin: boolean): Promise<any[]> {
  const [bounties, reviews, tiers] = await Promise.all([
    // D542 (#1105) — each ticket's bounty state, and what a fixed one paid.
    bountySummaries(env, rows),
    reviewsForTickets(env, rows),
    isAdmin ? readSlaTiers(env) : Promise.resolve(null),
  ]);
  const tierHours = tiers && tiers.available ? tiers.hours : null;
  const nowMs = Date.now();
  return rows.map((r) => ({
    ...r,
    bounty: bounties.get(Number(r.id)) ?? null,
    review: reviews.get(Number(r.id)) ?? null,
    ...(isAdmin ? { sla: slaForTicket(r, tierHours, nowMs) } : {}),
  }));
}

type TicketUpdate = { status?: string; priority?: string; type?: string; assigned_to?: string };

function labelSnapshot(ghIssue: any): { labels: string; assignees: string } {
  return {
    labels: JSON.stringify((ghIssue?.labels || []).map((l: any) => (typeof l === 'string' ? l : l?.name)).filter(Boolean)),
    assignees: JSON.stringify((ghIssue?.assignees || []).map((a: any) => a?.login).filter(Boolean)),
  };
}

/**
 * Mirror one saved ticket that has no issue yet. The admin backfill runs it
 * for up to 25 tickets at a time, and D604's per-ticket retry for one.
 *
 * Two admins may retry together. The row is claimed before GitHub is
 * contacted, and an interrupted request can be retried after five minutes.
 * Fresh submissions take the same lease while their create runs. `claimed`
 * means someone else holds it, and nothing was sent.
 */
async function mirrorSavedTicket(
  env: Env, sql: ReturnType<typeof getSQL>, ticket: any, eventKey: string,
): Promise<{ status: 'synced'; number: number; url: string } | { status: 'claimed' } | { status: 'failed'; error: string }> {
  const claimed = await sql`UPDATE tickets
    SET github_sync_status = 'syncing', github_sync_attempted_at = datetime('now')
    WHERE id = ${ticket.id} AND github_issue_number IS NULL
      AND (github_sync_status IS NULL OR github_sync_status != 'syncing'
        OR github_sync_attempted_at IS NULL
        OR datetime(github_sync_attempted_at) < datetime('now', '-5 minutes'))
    RETURNING id`;
  if (!claimed.length) return { status: 'claimed' };
  // D600 — no `submitted_by` here: it holds the name or the email.
  const body = mirrorIssueBody(ticket, 'StudioOS (backfilled)');
  const gh = await createIssue(env, {
    title: ticket.title,
    body,
    labels: labelsForTicket({ type: ticket.type, priority: ticket.priority }),
  });
  if (gh.ok && gh.data?.number) {
    const snap = labelSnapshot(gh.data);
    await sql`UPDATE tickets
                 SET github_issue_number = ${gh.data.number}, github_issue_url = ${gh.data.html_url},
                     github_labels = ${snap.labels}, github_assignees = ${snap.assignees},
                     github_sync_status = 'synced', github_sync_error = NULL,
                     github_sync_attempted_at = datetime('now')
               WHERE id = ${ticket.id}`;
    await recordSyncEvent(env, {
      ticketId: ticket.id, issueNumber: gh.data.number, direction: 'outbound',
      eventKey,
      payloadHash: await sha256Hex(`${ticket.title}|${ticket.priority}|${ticket.type}`),
    });
    return { status: 'synced', number: gh.data.number, url: gh.data.html_url };
  }
  const err = gh.error || 'github_create_failed';
  await sql`UPDATE tickets
               SET github_sync_status = 'failed', github_sync_error = ${err},
                   github_sync_attempted_at = datetime('now')
             WHERE id = ${ticket.id}`;
  return { status: 'failed', error: err };
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
  return c.json(await forScreens(c.env, rows as any[], user.role === 'admin'));
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

  // THE BACKFILL, AND WHY IT IS NOT AUTOMATIC.
  //
  // The loop above selects `github_issue_number IS NOT NULL`, so it can only
  // REFRESH tickets that already mirrored. Every ticket filed while the
  // mirror was misconfigured has no issue and no way to get one — the sync
  // button silently skipped exactly the rows that needed it most.
  //
  // It reports before it acts. `unsynced_count` comes back on every call, so
  // an admin can see there is a backlog without doing anything; creating the
  // issues needs an explicit `{ backfill: true }`. That asymmetry is
  // deliberate: this writes to a public repository, an issue cannot be
  // deleted through the API once created, and a burst of them is not
  // something to trigger by loading a page.
  let unsyncedCount = 0;
  let backfilled = 0;
  const backfillErrors: Array<{ id: number; error: string }> = [];
  if (user.role === 'admin') {
    const pending = await sql`SELECT * FROM tickets WHERE github_issue_number IS NULL ORDER BY created_at ASC`;
    unsyncedCount = pending.length;

    let wantBackfill = false;
    try { wantBackfill = (await c.req.json())?.backfill === true; } catch { /* no body: report only */ }

    if (wantBackfill && githubConfigured(c.env)) {
      // Bounded per call so one click cannot open an unbounded number of
      // issues; the count that comes back tells the caller whether to run
      // it again.
      for (const ticket of pending.slice(0, 25)) {
        const out = await mirrorSavedTicket(c.env, sql, ticket, `out:backfill:ticket-${ticket.id}`);
        if (out.status === 'synced') backfilled++;
        // One bad ticket must not abandon the rest of the batch, and the
        // first error is usually the same error for all of them — so stop
        // after the batch rather than after the first, and report each.
        else if (out.status === 'failed') backfillErrors.push({ id: ticket.id, error: out.error });
      }
      unsyncedCount -= backfilled;
    }
  }

  const updatedRows = user.role === 'admin'
    ? await sql`SELECT * FROM tickets ORDER BY created_at DESC`
    : await sql`SELECT * FROM tickets WHERE user_id = ${user.id} ORDER BY created_at DESC`;
  await sql.end();
  return c.json({
    // D604 — the same rows `GET /` sends, so a page that takes its list from
    // here keeps the bounty, the review and the SLA beside each one.
    tickets: await forScreens(c.env, updatedRows as any[], user.role === 'admin'),
    synced: updates.length,
    // Present on every call, so "nothing ever mirrored" is visible without
    // having to ask for a backfill to find out.
    unsynced_count: unsyncedCount,
    github_configured: githubConfigured(c.env),
    ...(backfilled ? { backfilled } : {}),
    ...(backfillErrors.length ? { backfill_errors: backfillErrors } : {}),
  });
});

tickets.post('/', async (c) => {
  const user = await requireAuth(c);
  const raw = await c.req.json().catch(() => null);
  const parsed = validateTicketCreate(raw);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const data = parsed.value;
  // D482: one of the eight canvas categories, or none recorded (NULL).
  const category = parseTicketCategory(raw?.category);
  if (!category.ok) return c.json({ error: category.error }, 400);
  const sql = getSQL(c.env);
  await ensureTicketSyncSchema(c.env);

  const [ticket] = await sql`INSERT INTO tickets (title, description, priority, type, category, submitted_by, user_id, project_id, github_sync_status, github_sync_attempted_at) VALUES (${data.title}, ${data.description}, ${data.priority}, ${data.type}, ${category.value}, ${user.name || user.email}, ${user.id}, ${data.project_id}, 'syncing', datetime('now')) RETURNING *`;

  let githubIssue: any = null;
  let githubSyncError: string | null = null;
  if (githubConfigured(c.env)) {
    const body = mirrorIssueBody({ id: ticket.id, description: data.description, priority: data.priority, type: data.type }, 'StudioOS');
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
      // The status is kept beside the message because they answer different
      // questions and only one of them is in `gh.error`: a bare "Not Found"
      // cannot be told apart from a typo'd repo name, while 403 vs 404 vs 410
      // names the remedy (permission / visibility / Issues disabled).
      console.warn('[tickets] github issue create failed', gh.status, githubSyncError);
    }
  }

  // RECORD THE ATTEMPT, whichever way it went. Until migration 273 this
  // outcome existed only in the response body below, so a failed mirror was
  // unrecoverable the moment the caller discarded it — and `/help`'s own form
  // discards it. Best-effort by design: the ticket is already committed and a
  // failure to write the RECORD of a failure must not turn a saved ticket
  // into a 500.
  try {
    await sql`UPDATE tickets
                 SET github_sync_status = ${githubIssue ? 'synced' : (githubConfigured(c.env) ? 'failed' : 'not_configured')},
                     github_sync_error = ${githubSyncError},
                     github_sync_attempted_at = datetime('now')
               WHERE id = ${ticket.id}`;
  } catch (e) {
    console.warn('[tickets] recording github sync status failed', (e as Error).message);
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
      cta: { label: 'Open ticket', path: `/help/tickets/${ticket.id}` },
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
  // D604 — the thread by side (`ticketScreens.ts`), not by GitHub login: every
  // reply posted through StudioOS carries the same account's login, so the
  // login named the token's owner as the author of the member's own words.
  let thread: any[] = [];
  let threadUnreadable = false;
  let githubStatus = null;

  if (ticket.github_issue_number) {
    const gh = await fetchIssue(c.env, ticket.github_issue_number);
    let mirrorLogin: string | null = null;
    if (gh.ok && gh.data) {
      const ghIssue = gh.data;
      githubStatus = ghIssue.state;
      mirrorLogin = typeof ghIssue.user?.login === 'string' ? ghIssue.user.login : null;
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
    // A thread that could not be read says so; it is never an empty thread.
    if (ghComments.ok) thread = ((ghComments.data as any[]) || []).map((cm: any) => threadEntry(cm, mirrorLogin));
    else threadUnreadable = true;
  }

  await sql.end();
  const [screen] = await forScreens(c.env, [ticket], user.role === 'admin');
  return c.json({ ...screen, thread, thread_unreadable: threadUnreadable, github_status: githubStatus });
});

// D604 — an admin retries the mirror of ONE saved ticket from its page (H7),
// rather than the backfill, which would also open issues for up to 24 others.
tickets.post('/:id{[0-9]+}/mirror', async (c) => {
  const user = await requireAuth(c);
  if (user.role !== 'admin') return c.json({ error: 'Admin only' }, 403);
  const id = parseInt(c.req.param('id'));
  if (!githubConfigured(c.env)) {
    return c.json(refusalBody({
      code: 'github_not_configured',
      message: 'GitHub Sync is not configured in this environment, so no issue can be opened. Set it up in HQ › Integration keys › GitHub Sync.',
    }), 409);
  }
  const sql = getSQL(c.env);
  await ensureTicketSyncSchema(c.env);
  const rows = await sql`SELECT * FROM tickets WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Ticket not found' }, 404); }
  const ticket = rows[0];
  if (ticket.github_issue_number) {
    await sql.end();
    return c.json(refusalBody({
      code: 'already_mirrored',
      message: `This ticket is already on the tracker as #${ticket.github_issue_number}.`,
      extra: { github_issue_number: ticket.github_issue_number, github_issue_url: ticket.github_issue_url ?? null },
    }), 409);
  }
  const out = await mirrorSavedTicket(c.env, sql, ticket, `out:retry:ticket-${id}`);
  await sql.end();
  if (out.status === 'claimed') {
    return c.json(refusalBody({
      code: 'mirror_in_progress',
      message: 'Another request is opening this ticket\'s issue right now. Reload in a minute.',
    }), 409);
  }
  if (out.status === 'failed') {
    return c.json(refusalBody({
      code: 'github_create_failed',
      message: `The issue could not be opened: ${out.error}`,
      raw: out.error,
      extra: { github_sync_status: 'failed', github_sync_error: out.error },
    }), 502);
  }
  return c.json({ ok: true, github_sync_status: 'synced', github_issue_number: out.number, github_issue_url: out.url });
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

  // D600 — signed by side, never by name: only the ticket's own member or an
  // admin reaches this line (the 403 above), so anyone else replying is the team.
  const body = mirrorReplyBody(parsed.value.body, ticket.user_id === user.id ? 'member' : 'team', ticket.id);
  const gh = await addComment(c.env, ticket.github_issue_number, body);
  if (!gh.ok) {
    await sql.end();
    return c.json(refusalBody({ code: 'github_comment_failed', message: 'Your comment could not be posted to the linked issue. It was not saved; try again in a moment.', raw: gh.error || null, extra: { github_sync_status: 'failed' } }), 502);
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
    // D604 — the entry as the thread shows it: by side, with the reply as typed.
    comment: {
      id: gh.data?.id ?? null,
      from: ticket.user_id === user.id ? 'member' : 'team',
      login: null,
      body: parsed.value.body,
      created_at: gh.data?.created_at ?? null,
      updated_at: gh.data?.updated_at ?? null,
    },
  });
});

tickets.put('/:id{[0-9]+}', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const raw = await c.req.json().catch(() => null);
  // D482: a category is changed only when the body names the key; null clears it.
  // A body naming the category alone is a valid update on its own.
  const hasCategory = !!raw && typeof raw === 'object' && 'category' in raw;
  const onlyCategory = hasCategory && Object.keys(raw).length === 1;
  const parsed = onlyCategory ? { ok: true as const, value: {} as TicketUpdate } : validateTicketUpdate(raw);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const data = parsed.value;
  const category = parseTicketCategory(hasCategory ? raw.category : undefined);
  if (!category.ok) return c.json({ error: category.error }, 400);
  const sql = getSQL(c.env);
  await ensureTicketSyncSchema(c.env);
  const rows = await sql`SELECT * FROM tickets WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Ticket not found' }, 404); }
  if (user.role !== 'admin' && rows[0].user_id !== user.id) { await sql.end(); return c.json({ error: 'Access denied' }, 403); }
  const before = rows[0];

  if (data.status) await sql`UPDATE tickets SET status = ${data.status}, updated_at = datetime('now') WHERE id = ${id}`;
  if (data.priority) await sql`UPDATE tickets SET priority = ${data.priority}, updated_at = datetime('now') WHERE id = ${id}`;
  if (data.type) await sql`UPDATE tickets SET type = ${data.type}, updated_at = datetime('now') WHERE id = ${id}`;
  if (hasCategory) await sql`UPDATE tickets SET category = ${category.value}, updated_at = datetime('now') WHERE id = ${id}`;
  if (data.assigned_to) {
    if (user.role !== 'admin') { await sql.end(); return c.json({ error: 'Only admins can assign tickets' }, 403); }
    await sql`UPDATE tickets SET assigned_to = ${data.assigned_to}, updated_at = datetime('now') WHERE id = ${id}`;
  }

  const [updated] = await sql`SELECT * FROM tickets WHERE id = ${id}`;

  // Outbound GitHub mirror — best-effort, explicit status in response:
  //   not_linked      → ticket has no GitHub issue
  //   not_configured  → linked, but GitHub creds absent in this env
  //   synced/partial  → all/some mirror calls succeeded (errors listed)
  let githubSyncStatus: string = updated.github_issue_number
    ? (githubConfigured(c.env) ? 'synced' : 'not_configured')
    : 'not_linked';
  const ghErrors: string[] = [];
  if (updated.github_issue_number && githubConfigured(c.env)) {
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
      // Swap only OUR managed labels; preserve everything else. Read the
      // issue's CURRENT labels from GitHub (not the local snapshot) so a
      // concurrent human label change isn't clobbered, and persist only the
      // set GitHub confirms back.
      const live = await fetchIssue(c.env, updated.github_issue_number);
      if (!live.ok) {
        githubSyncStatus = 'partial'; ghErrors.push(`labels: could not read current issue (${live.error})`);
      } else {
        const prev = parseLabelsFromGithub(live.data?.labels || []);
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
          const confirmed = (Array.isArray(res.data) ? res.data : []).map((l: any) => l?.name).filter(Boolean);
          await sql`UPDATE tickets SET github_labels = ${JSON.stringify(confirmed.length ? confirmed : [...managed, ...unmanaged])} WHERE id = ${id}`;
          await recordSyncEvent(c.env, {
            ticketId: id, issueNumber: updated.github_issue_number, direction: 'outbound',
            eventKey: `out:labels:${id}:${Date.now()}`,
          });
        } else { githubSyncStatus = 'partial'; ghErrors.push(`labels: ${res.error}`); }
      }
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
        githubSyncStatus = 'partial';
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
        link: `/help/tickets/${fresh.id}`,
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
