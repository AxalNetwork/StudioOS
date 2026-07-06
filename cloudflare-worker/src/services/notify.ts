/**
 * Phase 0.2 — Worker-side notification publisher.
 *
 * Mirrors backend/app/services/notify.py for the production stack on
 * axal.vc. Persists into `notifications_inbox` (D1) and best-effort
 * dispatches to email + Slack honoring per-event opt-outs stored in
 * `users.notification_prefs` (canonical, also used by /settings).
 *
 * Failures are swallowed — a downed Slack webhook must NEVER break the
 * underlying business action that triggered the notify call.
 *
 * Task #14 — Quiet hours + digest pipeline.
 *  - `category` is an optional argument; uncategorised callers behave
 *    as before (treated as critical, sent immediately).
 *  - Critical categories (`security`, `billing`, `contract_sign_request`)
 *    bypass both quiet hours and digest buffering.
 *  - Non-critical email is dropped into `notification_outbox` when the
 *    user is inside their quiet window OR has digest set to daily/weekly.
 *  - When digest=off and we're in quiet hours, the email is logged as
 *    `suppressed_quiet_hours` in `activity_logs` and skipped.
 *  - Slack is intentionally NOT digestable for this slice (spec).
 *  - `flushPendingDigests(env)` is what the cron calls to assemble each
 *    user's pending outbox into a single email at 09:00 user-tz.
 */
import type { Env } from '../types';
import { stripTrailingSlashes } from '../util/url';
import { getUserSettings, isInQuietHours } from './userSettings';

export type NotifyChannel = 'in_app' | 'email' | 'slack';
export type NotifyCategory =
  | 'security'
  | 'billing'
  | 'contract_sign_request'
  | 'mentions'
  | 'deals'
  | 'calendar'
  | 'scoring'
  | 'proactive_nudges'
  | string;

/** Categories that bypass quiet hours AND digest — spec'd by Task #14. */
export const CRITICAL_CATEGORIES: ReadonlySet<string> = new Set([
  'security',
  'billing',
  'contract_sign_request',
]);

export interface NotifyArgs {
  userId: number;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  payload?: Record<string, unknown> | null;
  channels?: NotifyChannel[];
  /** Task #14 — drives digest/quiet-hours routing. Omit for legacy
   *  callers; uncategorised notifications keep the pre-Task-14
   *  behaviour (sent immediately, no buffering). */
  category?: NotifyCategory;
}

let inboxMigrated = false;
async function ensureInbox(env: Env): Promise<boolean> {
  if (inboxMigrated) return true;
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS notifications_inbox (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         user_id INTEGER NOT NULL,
         type TEXT NOT NULL,
         title TEXT NOT NULL,
         body TEXT,
         link TEXT,
         payload TEXT,
         channel TEXT DEFAULT 'in_app',
         read_at TIMESTAMP,
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
       )`,
    ).run();
    await env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_inbox_user_unread
         ON notifications_inbox(user_id, read_at, created_at)`,
    ).run();
    // Task #2 (IB) — spec columns. Idempotent ALTERs so dev/preview D1
    // that never ran migration 053 still serves new writes & reads.
    for (const ddl of [
      `ALTER TABLE notifications_inbox ADD COLUMN category TEXT`,
      `ALTER TABLE notifications_inbox ADD COLUMN severity TEXT DEFAULT 'info'`,
      `ALTER TABLE notifications_inbox ADD COLUMN cta_url TEXT`,
      `ALTER TABLE notifications_inbox ADD COLUMN template_key TEXT`,
    ]) {
      try { await env.DB.prepare(ddl).run(); } catch { /* already-exists is fine */ }
    }
    // Task #14 — outbox for digest + quiet-hours buffering (mirrors
    // sql/migrations/013_notifications_digest.sql so dev/preview that
    // never run wrangler d1 execute still work).
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS notification_outbox (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         user_id INTEGER NOT NULL,
         type TEXT NOT NULL,
         title TEXT NOT NULL,
         body TEXT,
         link TEXT,
         payload TEXT,
         category TEXT,
         reason TEXT NOT NULL DEFAULT 'digest',
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         flushed_at TIMESTAMP,
         flushed_digest_id TEXT
       )`,
    ).run();
    await env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_outbox_user_pending
         ON notification_outbox(user_id, flushed_at)`,
    ).run();
    inboxMigrated = true;
    return true;
  } catch (e) {
    console.error('[notify] inbox migration failed', e);
    return false;
  }
}

async function loadPrefs(env: Env, userId: number): Promise<Record<string, any>> {
  try {
    const r: any = await env.DB.prepare(
      `SELECT notification_prefs FROM users WHERE id = ?`,
    ).bind(userId).first();
    if (!r?.notification_prefs) return {};
    try { return JSON.parse(r.notification_prefs) || {}; } catch { return {}; }
  } catch {
    return {};
  }
}

function resolveChannels(prefs: Record<string, any>, type: string, requested: NotifyChannel[]): NotifyChannel[] {
  // Honor per-event, per-channel opt-outs from /settings/notifications.
  // All three channels (in_app/email/slack) are user-toggleable and
  // default-on; an explicit `false` in prefs[type][ch] suppresses that
  // channel for that event type.
  const ev = (prefs && typeof prefs === 'object' ? (prefs[type] || {}) : {}) as Record<string, any>;
  const out: NotifyChannel[] = [];
  for (const ch of requested) {
    const enabled = ev[ch];
    if (enabled === undefined || enabled === true) out.push(ch);
  }
  return out;
}

/**
 * Task #1 (Slack, 2026-05-10) — Block Kit renderer for the 5 spec'd
 * trigger events (contract_signed, deal_stage_change, advisor_session_booked,
 * score_generated, dd_report_ready). Unknown event types fall through to a
 * plain section block so any future notify() call still delivers something
 * useful instead of silently dropping the Slack channel.
 */
function buildSlackBlocks(args: NotifyArgs, appUrl: string): Record<string, unknown> {
  const root = stripTrailingSlashes(appUrl);
  const link = args.link
    ? (args.link.startsWith('http') ? args.link : `${root}${args.link}`)
    : null;
  const HEADERS: Record<string, string> = {
    contract_signed: ':inbox_tray: Contract signed',
    deal_stage_change: ':twisted_rightwards_arrows: Deal stage updated',
    advisor_session_booked: ':calendar: Advisor session booked',
    score_generated: ':bar_chart: New score generated',
    dd_report_ready: ':page_facing_up: Due diligence report ready',
  };
  const headerText = HEADERS[args.type] || ':bell: Axal update';
  const blocks: Array<Record<string, unknown>> = [
    { type: 'header', text: { type: 'plain_text', text: headerText, emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: `*${args.title}*${args.body ? `\n${args.body}` : ''}` } },
  ];
  if (link) {
    blocks.push({
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: 'Open in Axal', emoji: true },
        url: link,
        style: 'primary',
      }],
    });
  }
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `Axal StudioOS · _Manage in <${root}/settings/notifications|Notification settings>_` }],
  });
  // `text` fallback is required by Slack for screen readers / push previews.
  return {
    text: `${args.title}${args.body ? ` — ${args.body}` : ''}`,
    blocks,
  };
}

async function postSlackBlocks(webhook: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      // Deliberately do NOT log the response body — Slack error responses
      // can echo the webhook URL or `team`/`channel` context, which would
      // leak per-user webhook material into centralized logs.
      console.warn('[notify] slack non-2xx', res.status);
    }
  } catch (e) {
    console.warn('[notify] slack failed', e);
  }
}

/** Returns true on confirmed dispatch, false otherwise. Callers that
 *  participate in the digest flush MUST honour the boolean — marking an
 *  outbox row flushed on a swallowed error is silent data loss. */
async function sendEmail(env: Env, to: string, subject: string, body: string): Promise<boolean> {
  try {
    const { sendNotificationEmail } = await import('./email');
    await sendNotificationEmail(env, to, subject, body);
    return true;
  } catch (e) {
    console.warn('[notify] email failed', e);
    return false;
  }
}

async function recordActivity(env: Env, userId: number, action: string, details: Record<string, unknown>): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`,
    ).bind(action, JSON.stringify(details), null, userId).run();
  } catch (e) {
    console.warn('[notify] activity_logs insert failed', e);
  }
}

async function enqueueOutbox(env: Env, args: NotifyArgs, reason: 'digest' | 'quiet_hours'): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO notification_outbox
         (user_id, type, title, body, link, payload, category, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      args.userId,
      args.type,
      args.title,
      args.body ?? null,
      args.link ?? null,
      args.payload ? JSON.stringify(args.payload) : null,
      args.category ?? null,
      reason,
    ).run();
  } catch (e) {
    console.warn('[notify] outbox enqueue failed', e);
  }
}

/**
 * Best-effort fan-out. Returns the inbox row id on success, null otherwise.
 * Caller MUST not await this in a way that affects user-facing latency on
 * failure — wrap with try/catch at the call site as a defense-in-depth.
 */
export async function notify(env: Env, args: NotifyArgs): Promise<number | null> {
  try {
    if (!(await ensureInbox(env))) return null;
    const channels: NotifyChannel[] = (args.channels && args.channels.length > 0) ? args.channels : ['in_app'];
    const prefs = await loadPrefs(env, args.userId);
    const resolved = resolveChannels(prefs, args.type, channels);
    if (resolved.length === 0) return null;

    // Task #14 — categorisation drives quiet-hours + digest routing.
    // Uncategorised calls are treated as critical so we never silently
    // suppress a notification a caller didn't opt into the new pipeline.
    const isCritical = !args.category || CRITICAL_CATEGORIES.has(args.category);

    // T20 — Quiet hours: if the user is currently inside their configured
    // quiet window, suppress real-time push (DO broadcast) and email/slack
    // dispatch — but STILL write the inbox row so the bell catches up when
    // they return. Failures here must never block the underlying notify.
    let quiet = false;
    let settings: Awaited<ReturnType<typeof getUserSettings>> | null = null;
    try {
      settings = await getUserSettings(env, args.userId);
      quiet = isInQuietHours(settings);
    } catch (e) { console.warn('[notify] quiet-hours lookup failed', e); }
    const digest = settings?.digest_frequency || 'off';

    let rowId: number | null = null;
    if (resolved.includes('in_app')) {
      // Task #2 (IB) — also stamp category/severity/cta_url/template_key
      // so the Notification Center UI can filter + render CTA buttons
      // without re-parsing payload. Severity derives from isCritical
      // when caller didn't pass one explicitly (CRITICAL_CATEGORIES set).
      const severity = isCritical ? 'critical' : 'info';
      const ctaUrl = args.link ?? null;
      const templateKey = (args.payload as any)?.template_key ?? null;
      const insert: any = await env.DB.prepare(
        `INSERT INTO notifications_inbox
           (user_id, type, title, body, link, payload, channel,
            category, severity, cta_url, template_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        args.userId,
        args.type,
        args.title,
        args.body ?? null,
        args.link ?? null,
        args.payload ? JSON.stringify(args.payload) : null,
        resolved.join(','),
        args.category ?? null,
        severity,
        ctaUrl,
        templateKey,
      ).run();
      rowId = Number(insert?.meta?.last_row_id || 0) || null;

      // Real-time push: route through the existing PipelineRoom DO 'overview'
      // channel, which the bell already subscribes to. The DO's broadcast()
      // filters `type:"notification"` frames to the recipient socket only —
      // server-side authorization, NOT client-side filtering.
      // Skipped during quiet hours for non-critical messages — the row is
      // already in the inbox so the bell will surface it on next focus.
      const skipPush = quiet && !isCritical;
      if (!skipPush) {
        try {
          const { notifyPipelineRoom } = await import('./realtime');
          await notifyPipelineRoom(env, 'overview', {
            type: 'notification',
            user_id: args.userId,
            notification: {
              id: rowId,
              type: args.type,
              title: args.title,
              body: args.body ?? null,
              link: args.link ?? null,
              read_at: null,
              created_at: new Date().toISOString(),
            },
          });
        } catch (e) { console.warn('[notify] realtime push failed', e); }
      }
    }

    // Email routing — the only channel that participates in digest
    // buffering for this slice (Slack is intentionally out of scope).
    if (resolved.includes('email')) {
      if (isCritical) {
        await dispatchEmail(env, args);
      } else if (quiet) {
        if (digest === 'off') {
          await recordActivity(env, args.userId, 'suppressed_quiet_hours', {
            type: args.type, category: args.category ?? null,
          });
        } else {
          await enqueueOutbox(env, args, 'quiet_hours');
        }
      } else if (digest === 'daily' || digest === 'weekly') {
        await enqueueOutbox(env, args, 'digest');
      } else {
        await dispatchEmail(env, args);
      }
    }

    // Task #1 (Slack, 2026-05-10) — load the per-user incoming-webhook
    // URL from the integrations table (legacy global env.SLACK_WEBHOOK_URL
    // fallback removed — broadcasting every user's notifications to one
    // shared channel was a privacy footgun). Per-event opt-out is already
    // applied above by `resolveChannels` against `users.notification_prefs`
    // (the same matrix the Settings → Notifications UI writes to), so this
    // block only needs to honour quiet-hours and dispatch.
    if (resolved.includes('slack')) {
      const skipSlack = quiet && !isCritical;
      if (!skipSlack) {
        try {
          const { loadSlackWebhookForUser } = await import('../integrations/providers/slack');
          const hook = await loadSlackWebhookForUser(env, args.userId);
          if (hook?.url) {
            const appUrl = (env as { APP_URL?: string }).APP_URL || '';
            await postSlackBlocks(hook.url, buildSlackBlocks(args, appUrl));
          }
        } catch (e) { console.warn('[notify] slack lookup failed', e); }
      }
    }

    return rowId;
  } catch (e) {
    console.error('[notify] failed', { type: args.type, userId: args.userId, e });
    return null;
  }
}

async function dispatchEmail(env: Env, args: NotifyArgs): Promise<void> {
  try {
    const u: any = await env.DB.prepare(`SELECT email FROM users WHERE id = ?`).bind(args.userId).first();
    if (u?.email) await sendEmail(env, u.email, `[Axal] ${args.title}`, args.body || args.title);
  } catch (e) { console.warn('[notify] email lookup failed', e); }
}

// ---------------------------------------------------------------------------
// Task #14 — digest cron flush.
// ---------------------------------------------------------------------------

interface OutboxRow {
  id: number;
  user_id: number;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  category: string | null;
  reason: string;
  created_at: string;
}

/** Returns true if `now` (UTC) corresponds to 09:00 in `tz`, on a day
 *  that matches the cadence (`daily` = every day, `weekly` = Monday). */
function isDigestSendTime(tz: string, cadence: 'daily' | 'weekly', now: Date): boolean {
  let hour = '00', minute = '00', weekday = 'Mon';
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz || 'UTC',
      hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
    });
    for (const p of fmt.formatToParts(now)) {
      if (p.type === 'hour') hour = p.value;
      else if (p.type === 'minute') minute = p.value;
      else if (p.type === 'weekday') weekday = p.value;
    }
  } catch { return false; }
  if (hour !== '09' || minute !== '00') return false;
  if (cadence === 'weekly' && weekday !== 'Mon') return false;
  return true;
}

function renderDigestEmail(rows: OutboxRow[], cadence: 'daily' | 'weekly'): { subject: string; body: string } {
  const subject = `[Axal] Your ${cadence} digest — ${rows.length} update${rows.length === 1 ? '' : 's'}`;
  const lines: string[] = [];
  lines.push(`You have ${rows.length} update${rows.length === 1 ? '' : 's'} from the last ${cadence === 'daily' ? '24 hours' : 'week'}.`);
  lines.push('');
  for (const r of rows) {
    lines.push(`• ${r.title}`);
    if (r.body) lines.push(`  ${r.body.replace(/\s+/g, ' ').slice(0, 240)}`);
    if (r.link) lines.push(`  ${r.link}`);
    lines.push('');
  }
  lines.push('— Axal StudioOS');
  return { subject, body: lines.join('\n') };
}

/**
 * Task #8 (Slack digest, 2026-05-10) — Block Kit renderer for the
 * post-quiet-hours digest. Mirrors the email digest content (one bullet
 * per buffered item) but compressed into Slack's section-block limits:
 *  - mrkdwn `text` field is hard-capped at 3000 chars by Slack; we cap
 *    at 20 visible items and tail with a "...and N more" line so very
 *    chatty days don't break Slack delivery.
 *  - Each item links to either the original `link` (absolute URL or
 *    in-app path resolved against APP_URL) when present, otherwise the
 *    in-app inbox at `/inbox`.
 *  - Always renders an "Open inbox" action button as the primary CTA so
 *    the user has one click back to the catch-up surface.
 *  - Always returns a `text:` fallback for screen readers / push
 *    previews (Slack rejects payloads with neither `text` nor `blocks`).
 */
function renderDigestSlackBlocks(
  rows: OutboxRow[],
  cadence: 'daily' | 'weekly',
  appUrl: string,
): Record<string, unknown> {
  const root = stripTrailingSlashes(appUrl);
  const inboxUrl = `${root}/inbox`;
  const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const resolveLink = (raw: string | null): string => {
    if (!raw) return inboxUrl;
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    return `${root}${raw.startsWith('/') ? '' : '/'}${raw}`;
  };

  const MAX_ITEMS = 20;
  const visible = rows.slice(0, MAX_ITEMS);
  const overflow = rows.length - visible.length;

  const bullets = visible.map((r) => {
    const title = escape(r.title || '(untitled update)');
    const url = resolveLink(r.link);
    const sub = r.body ? `\n      _${escape(r.body.replace(/\s+/g, ' ').slice(0, 180))}_` : '';
    return `• <${url}|${title}>${sub}`;
  });
  if (overflow > 0) {
    bullets.push(`_…and ${overflow} more — <${inboxUrl}|view all in your inbox>_`);
  }
  // 3000-char Slack section limit. If we overflow even after the cap,
  // truncate the joined string and re-anchor the inbox link.
  let bulletText = bullets.join('\n');
  if (bulletText.length > 2900) {
    bulletText = bulletText.slice(0, 2800).replace(/\n[^\n]*$/, '');
    bulletText += `\n_Truncated — <${inboxUrl}|view all in your inbox>_`;
  }

  const headerText = `:envelope_with_arrow: Your ${cadence} Axal digest`;
  const introText = `*${rows.length} update${rows.length === 1 ? '' : 's'}* buffered during your quiet hours over the last ${cadence === 'daily' ? '24 hours' : 'week'}.`;
  const blocks: Array<Record<string, unknown>> = [
    { type: 'header', text: { type: 'plain_text', text: headerText, emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: introText } },
    { type: 'section', text: { type: 'mrkdwn', text: bulletText } },
    {
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: 'Open inbox', emoji: true },
        url: inboxUrl,
        style: 'primary',
      }],
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Axal StudioOS · _Manage in <${root}/settings/notifications|Notification settings>_` }],
    },
  ];
  return {
    text: `Your ${cadence} Axal digest — ${rows.length} update${rows.length === 1 ? '' : 's'}`,
    blocks,
  };
}

/** Walk every user with at least one pending outbox row, and — when
 *  their local time is the digest send slot — assemble + send a single
 *  email and mark the rows flushed. Idempotent: rows already flushed
 *  (flushed_at NOT NULL) are skipped.
 *
 *  Designed for the every-minute cron in index.ts (so we hit each user's
 *  09:00 once per day without expensive scheduling math). Returns a
 *  small summary for logging. */
export async function flushPendingDigests(env: Env, now: Date = new Date()): Promise<{ scanned: number; sent: number; rows: number }> {
  if (!(await ensureInbox(env))) return { scanned: 0, sent: 0, rows: 0 };

  // Pull users with pending rows, joined to their settings. Cap at
  // 500/tick — anything beyond that should batch over multiple ticks.
  let users: Array<{ user_id: number; tz: string; digest: 'daily' | 'weekly' }> = [];
  try {
    const res: any = await env.DB.prepare(
      `SELECT o.user_id AS user_id,
              COALESCE(s.quiet_hours_tz, s.timezone, 'UTC') AS tz,
              COALESCE(s.digest_frequency, 'off') AS digest
         FROM notification_outbox o
         LEFT JOIN user_settings s ON s.user_id = o.user_id
        WHERE o.flushed_at IS NULL
        GROUP BY o.user_id
        LIMIT 500`,
    ).all();
    users = (res?.results || []).map((r: any) => ({
      user_id: Number(r.user_id),
      tz: String(r.tz || 'UTC'),
      digest: (r.digest === 'daily' || r.digest === 'weekly') ? r.digest : 'daily',
    }));
  } catch (e) {
    console.warn('[notify] flushPendingDigests scan failed', e);
    return { scanned: 0, sent: 0, rows: 0 };
  }

  let sent = 0, totalRows = 0;
  for (const u of users) {
    // Users whose digest flipped to 'off' AFTER an enqueue: still flush
    // their backlog daily so it doesn't grow forever.
    const cadence: 'daily' | 'weekly' = u.digest === 'weekly' ? 'weekly' : 'daily';
    if (!isDigestSendTime(u.tz, cadence, now)) continue;

    let rows: OutboxRow[] = [];
    try {
      const r: any = await env.DB.prepare(
        `SELECT id, user_id, type, title, body, link, category, reason, created_at
           FROM notification_outbox
          WHERE user_id = ? AND flushed_at IS NULL
          ORDER BY id ASC
          LIMIT 100`,
      ).bind(u.user_id).all();
      rows = (r?.results || []) as OutboxRow[];
    } catch (e) { console.warn('[notify] outbox load failed', e); continue; }
    if (rows.length === 0) continue;

    const digestId = crypto.randomUUID();
    let userEmail: string | null = null;
    try {
      const r: any = await env.DB.prepare(`SELECT email FROM users WHERE id = ?`).bind(u.user_id).first();
      userEmail = r?.email || null;
    } catch { /* noop */ }

    // Architect blocking-fix: only mark rows flushed on confirmed
    // delivery. If we have no email on file OR sendEmail() reports a
    // failure, leave the rows pending so the next cron tick (or
    // tomorrow's window) retries them rather than silently dropping
    // the user's digest. The 09:00 send-slot check throttles retries
    // to one attempt per minute over the user's local 09:00 hour.
    if (!userEmail) {
      console.warn('[notify] digest skipped — no email for user', u.user_id);
      continue;
    }
    const { subject, body } = renderDigestEmail(rows, cadence);
    const ok = await sendEmail(env, userEmail, subject, body);
    if (!ok) {
      console.warn('[notify] digest email failed; leaving outbox rows pending for retry', { user_id: u.user_id });
      continue;
    }
    try {
      const ids = rows.map(r => r.id).join(',');
      await env.DB.prepare(
        `UPDATE notification_outbox
            SET flushed_at = CURRENT_TIMESTAMP, flushed_digest_id = ?
          WHERE id IN (${ids})`,
      ).bind(digestId).run();
      sent += 1;
      totalRows += rows.length;
    } catch (e) { console.warn('[notify] outbox flush UPDATE failed', e); }

    // Task #8 (Slack digest, 2026-05-10) — best-effort fan-out to the
    // user's connected Slack webhook AFTER the email succeeds + rows
    // are marked flushed. Slack delivery is intentionally NOT a gating
    // condition for flushing: email is the primary digest channel
    // (every digest user has an email); a transient Slack 5xx must not
    // re-send tomorrow's email. Users without a connected Slack
    // integration are a no-op (loadSlackWebhookForUser returns null).
    try {
      const { loadSlackWebhookForUser } = await import('../integrations/providers/slack');
      const hook = await loadSlackWebhookForUser(env, u.user_id);
      if (hook?.url) {
        const appUrl = (env as { APP_URL?: string }).APP_URL || '';
        await postSlackBlocks(hook.url, renderDigestSlackBlocks(rows, cadence, appUrl));
      }
    } catch (e) { console.warn('[notify] slack digest dispatch failed', e); }
  }
  return { scanned: users.length, sent, rows: totalRows };
}
