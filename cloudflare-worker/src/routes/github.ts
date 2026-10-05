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
 *     and dropped — they are echoes of our own outbound writes. One
 *     exception (D542 follow-up): a `labeled` bounty label from a sender on
 *     BOUNTY_GRANTERS is processed even when that sender is the sync bot,
 *     because the coordinator labels as the same account. The outbound sync
 *     never adds a bounty label (its label PUT keeps them as they are), so
 *     such an event is a person's decision, not an echo.
 *
 * Public (no auth) but signature-verified. Non-issue events, unknown issue
 * numbers, and irrelevant actions are acknowledged with 2xx so GitHub
 * doesn't retry. Pull-based sync in routes/tickets.ts remains the fallback.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import {
  ensureTicketSyncSchema, recordSyncEvent, releaseSyncEvent, sha256Hex,
  mapGithubStatusToLocal, parseLabelsFromGithub, hasSyncMarker, updateIssue,
} from '../services/githubSync';
import { bountyLabelEvent, bountySourceRef, parseGranters } from '../services/bugBounties';
import { refuse } from '../util/refusal';

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

/** A GitHub issue number: a JSON number that is a positive safe integer. */
export function isIssueNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
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
  if (issueNumber === undefined || issueNumber === null) return c.json({ ok: true, ignored: 'no_issue_number' });
  // The issue number goes into an outbound GitHub URL and a query. GitHub
  // sends a JSON number; anything else (a string, zero, a negative, a
  // fraction, past 2^53) is refused before anything is claimed or fetched.
  if (!isIssueNumber(issueNumber)) {
    return refuse(c, 400, {
      code: 'invalid_issue_number',
      message: 'The delivery\'s issue number is not a positive whole number, so it was not processed.',
    });
  }

  if (event === 'issues' && !ISSUE_ACTIONS.includes(action)) {
    return c.json({ ok: true, ignored: `action:${action}` });
  }
  if (event === 'issue_comment' && action !== 'created') {
    return c.json({ ok: true, ignored: `action:${action}` });
  }

  // Loop prevention — drop echoes of our own outbound writes.
  const senderLogin: string | null = payload?.sender?.login || null;
  const botLogin = (c.env as any).GITHUB_SYNC_BOT_LOGIN as string | undefined;
  // D542 follow-up — the coordinator labels as the same account the sync
  // bot uses, so a bounty label ADDED by an allowlisted sender is a decision,
  // not an echo: the outbound label PUT keeps bounty labels as they are and
  // never adds one. Every other event from the bot is still dropped.
  const grantedBountyLabel = event === 'issues' && action === 'labeled' && (() => {
    const kind = bountyLabelEvent({
      action, label: payload?.label?.name, sender: senderLogin, granters: parseGranters(c.env.BOUNTY_GRANTERS),
    }).kind;
    return kind !== 'ignored' && kind !== 'refused';
  })();
  if (botLogin && senderLogin && senderLogin.toLowerCase() === botLogin.toLowerCase() && !grantedBountyLabel) {
    return c.json({ ok: true, ignored: 'sync_bot_actor' });
  }
  // Only COMMENT bodies are marker-dropped: our issue bodies always carry the
  // marker, but a human closing/labeling that issue must still sync back.
  if (event === 'issue_comment' && hasSyncMarker(payload?.comment?.body)) {
    return c.json({ ok: true, ignored: 'sync_marker' });
  }

  await ensureTicketSyncSchema(c.env);

  // Idempotency — GitHub redelivers on timeouts; dedupe by delivery GUID.
  // Claim-then-release: the GUID is claimed up front, and RELEASED in the
  // catch below if the ticket mutation fails, so a GitHub retry of the same
  // delivery is reprocessed instead of being swallowed as a duplicate.
  const delivery = c.req.header('X-GitHub-Delivery') || null;
  const deliveryKey = delivery ? `gh:${delivery}` : null;
  if (deliveryKey) {
    const firstSeen = await recordSyncEvent(c.env, {
      issueNumber,
      direction: 'inbound',
      eventKey: deliveryKey,
      payloadHash: await sha256Hex(`${event}:${action}:${issueNumber}`),
    });
    if (!firstSeen) {
      return c.json({ ok: true, ignored: 'duplicate_delivery', delivery });
    }
  }

  const sql = getSQL(c.env);
  try {
    const rows = await sql`SELECT id, status, priority, type, user_id, title, github_updated_at FROM tickets WHERE github_issue_number = ${issueNumber}`;
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
            link: `/help/tickets/${ticket.id}`,
            payload: { ticket_id: ticket.id, github_comment_id: payload?.comment?.id },
            channels: ['in_app'],
          });
        }
      } catch (e) { console.warn('[github] notify comment failed', e); }
      await sql.end();
      return c.json({ ok: true, updated: true, ticket_id: ticket.id, event: 'comment' });
    }

    // `issues` events — compute the full desired local state from the issue
    // payload and apply it as an absolute write. Out-of-order protection:
    // drop deliveries whose issue.updated_at is older than the last applied
    // one, so a delayed stale event can't revert newer state.
    const issueUpdatedAt: string | null = issue.updated_at || null;
    if (issueUpdatedAt && ticket.github_updated_at && issueUpdatedAt < ticket.github_updated_at) {
      await sql.end();
      return c.json({ ok: true, ignored: 'stale_event', issue: issueNumber });
    }
    let newStatus = mapGithubStatusToLocal(issue.state, issue.state_reason);

    // D542 — a bounty label counts only from a sender on BOUNTY_GRANTERS.
    // The ordinary label snapshot below still records every label; what the
    // allowlist governs is what the platform DOES about one.
    const bounty = bountyLabelEvent({
      action,
      label: payload?.label?.name,
      sender: senderLogin,
      granters: parseGranters(c.env.BOUNTY_GRANTERS),
    });
    let bountyReport: Record<string, unknown> | null = null;
    if (bounty.kind === 'refused') {
      console.warn('[github] bounty label from a sender not on BOUNTY_GRANTERS ignored', bounty.label);
      bountyReport = { kind: bounty.kind, reason: bounty.reason, label: bounty.label };
    } else if (bounty.kind === 'outcome') {
      // Not a bug, or a duplicate: the ticket closes. S1's reason comment
      // reaches the user through the comment sync. The GitHub issue is closed
      // as not planned too, so the next absolute write cannot reopen it.
      //
      // The GitHub close comes FIRST. If it fails (401, 403, a rate limit,
      // 5xx after the retry), nothing is written locally, the delivery claim
      // is released and the response is a 502. GitHub does not redeliver a
      // failed delivery on its own: it shows as failed in the webhook's log,
      // and redelivering it from there runs the whole step again (the claim
      // was released, so it is not taken for a duplicate). Closing locally
      // anyway would be undone by the next sync, which reads the issue as
      // still open.
      newStatus = 'closed';
      let githubClosed: boolean | null = null;
      if (issue.state !== 'closed') {
        let r: { ok: boolean; error?: string | null } | null = null;
        let thrown: unknown = null;
        try {
          r = await updateIssue(c.env, issueNumber, { state: 'closed', state_reason: 'not_planned' });
        } catch (e) { thrown = e; }
        if (!r?.ok) {
          await sql.end();
          if (deliveryKey) await releaseSyncEvent(c.env, deliveryKey);
          return refuse(c, 502, {
            code: 'github_close_failed',
            message: 'The GitHub issue could not be closed, so the ticket was left open. Redeliver this event to try again.',
            raw: thrown ?? r?.error ?? null,
          });
        }
        githubClosed = true;
      }
      bountyReport = { kind: bounty.kind, outcome: bounty.outcome, github_closed: githubClosed };
    } else if (bounty.kind === 'tier_added' || bounty.kind === 'tier_removed') {
      // The grant and its revoke go through the credit grant service, keyed
      // by the source ref, so a redelivery or a later replay from the label
      // snapshot grants once. That service is not built yet: nothing is
      // granted or revoked here, and the response says so.
      bountyReport = {
        kind: bounty.kind,
        rule_key: bounty.ruleKey,
        source_ref: bountySourceRef(ticket.id),
        credits: 'not_granted',
        reason: 'The credit grant service is not built yet. The label is kept in the snapshot, and the grant '
          + 'is keyed by source_ref, so it can be applied once without loss when the service lands.',
      };
    } else if (bounty.kind !== 'ignored') {
      bountyReport = { kind: bounty.kind };
    }

    const parsed = parseLabelsFromGithub(issue.labels);
    const labelsSnap = JSON.stringify(parsed.names);
    const assigneesSnap = JSON.stringify((issue.assignees || []).map((a: any) => a?.login).filter(Boolean));
    const newPriority = parsed.priority || ticket.priority;
    const newType = parsed.type || ticket.type || 'task';

    const changed = newStatus !== ticket.status || newPriority !== ticket.priority || newType !== ticket.type;
    await sql`UPDATE tickets SET status = ${newStatus}, priority = ${newPriority}, type = ${newType}, github_labels = ${labelsSnap}, github_assignees = ${assigneesSnap}, github_updated_at = ${issueUpdatedAt}, updated_at = datetime('now') WHERE id = ${ticket.id}`;

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
            link: `/help/tickets/${ticket.id}`,
            payload: { ticket_id: ticket.id, status: newStatus },
            channels: ['in_app'],
          });
        }
      } catch (e) { console.warn('[github] notify status failed', e); }
    }

    await sql.end();
    return c.json({
      ok: true, updated: changed, ticket_id: ticket.id, status: newStatus, priority: newPriority, type: newType,
      ...(bountyReport ? { bounty: bountyReport } : {}),
    });
  } catch (e: any) {
    try { await sql.end(); } catch { /* noop */ }
    // Release the delivery claim so GitHub's retry of this delivery is
    // reprocessed rather than dropped as a duplicate.
    if (deliveryKey) await releaseSyncEvent(c.env, deliveryKey);
    return refuse(c, 500, { code: 'db_error', message: 'The delivery could not be recorded; GitHub will retry it.', raw: e });
  }
});

export default github;
