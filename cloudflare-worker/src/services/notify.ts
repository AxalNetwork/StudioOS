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
 */
import type { Env } from '../types';
import { getUserSettings, isInQuietHours } from './userSettings';

export type NotifyChannel = 'in_app' | 'email' | 'slack';

export interface NotifyArgs {
  userId: number;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  payload?: Record<string, unknown> | null;
  channels?: NotifyChannel[];
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

async function postSlack(webhook: string, text: string): Promise<void> {
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch (e) {
    console.warn('[notify] slack failed', e);
  }
}

async function sendEmail(env: Env, to: string, subject: string, body: string): Promise<void> {
  try {
    const { sendNotificationEmail } = await import('./email');
    await sendNotificationEmail(env, to, subject, body);
  } catch (e) {
    console.warn('[notify] email failed', e);
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

    // T20 — Quiet hours: if the user is currently inside their configured
    // quiet window, suppress real-time push (DO broadcast) and email/slack
    // dispatch — but STILL write the inbox row so the bell catches up when
    // they return. Failures here must never block the underlying notify.
    let quiet = false;
    try {
      const us = await getUserSettings(env, args.userId);
      quiet = isInQuietHours(us);
    } catch (e) { console.warn('[notify] quiet-hours lookup failed', e); }

    let rowId: number | null = null;
    if (resolved.includes('in_app')) {
      const insert: any = await env.DB.prepare(
        `INSERT INTO notifications_inbox (user_id, type, title, body, link, payload, channel)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        args.userId,
        args.type,
        args.title,
        args.body ?? null,
        args.link ?? null,
        args.payload ? JSON.stringify(args.payload) : null,
        resolved.join(','),
      ).run();
      rowId = Number(insert?.meta?.last_row_id || 0) || null;

      // Real-time push: route through the existing PipelineRoom DO 'overview'
      // channel, which the bell already subscribes to. The DO's broadcast()
      // filters `type:"notification"` frames to the recipient socket only —
      // server-side authorization, NOT client-side filtering.
      // Skipped during quiet hours — the row is already in the inbox so
      // the bell will surface it on next page-load / focus.
      if (quiet) {
        // no-op; intentional during quiet window
      } else try {
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

    if (resolved.includes('email') && !quiet) {
      try {
        const u: any = await env.DB.prepare(`SELECT email FROM users WHERE id = ?`).bind(args.userId).first();
        if (u?.email) await sendEmail(env, u.email, `[Axal] ${args.title}`, args.body || args.title);
      } catch (e) { console.warn('[notify] email lookup failed', e); }
    }

    if (resolved.includes('slack') && !quiet) {
      const hook = (env as any).SLACK_WEBHOOK_URL;
      if (hook) await postSlack(hook, `*${args.title}*\n${args.body || ''}\n${args.link || ''}`);
    }

    return rowId;
  } catch (e) {
    console.error('[notify] failed', { type: args.type, userId: args.userId, e });
    return null;
  }
}
