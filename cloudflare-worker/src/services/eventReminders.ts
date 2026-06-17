/**
 * Task #6 — Event reminder sweep (design §6).
 *
 * Cron-driven (every ~5 min). Walks published, non-cancelled events whose
 * `starts_at` falls inside the next 24h and fires two reminder kinds to each
 * registered/confirmed principal:
 *   - `reminder_24h` — when 1 < hours-until <= 24
 *   - `reminder_1h`  — when 0 < hours-until <= 1
 * The two windows are mutually exclusive per sweep, so a principal never gets
 * both at once for the same tick.
 *
 * Idempotency is "insert-ledger-first": we write the
 * `event_notifications (event_id, principal_key, kind)` row BEFORE delivering.
 * The UNIQUE constraint means a duplicate insert throws → we skip delivery, so
 * every (event, principal, kind) reminder fires exactly once even across
 * overlapping/retried cron runs.
 *
 * Channels: account holders get the in-app inbox (notify, category 'events');
 * email-only registrants get a short reminder email when Gmail is configured.
 */
import type { Env } from '../types';
import { notify } from './notify';
import { ensureEventsSchema } from './eventsSchema';
import { wrap, type EmailTemplate } from '../templates/email/layout';

type ReminderKind = 'reminder_24h' | 'reminder_1h';

export interface ReminderSweepResult {
  events: number;
  sent: number;
  skipped: number;
}

function baseUrl(env: Env): string {
  return String((env as any).PUBLIC_BASE_URL || (env as any).APP_URL || 'https://axal.vc').replace(/\/$/, '');
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Hours from `now` until an event's `starts_at`, or null if unparseable. */
function hoursUntil(startsAt: unknown, now: Date): number | null {
  if (!startsAt) return null;
  const s = String(startsAt);
  const iso = s.includes('T') ? s : s.replace(' ', 'T') + 'Z';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return (t - now.getTime()) / 3_600_000;
}

function formatWhen(event: any): string {
  const raw = event.starts_at;
  if (!raw) return 'soon';
  const s = String(raw);
  const iso = s.includes('T') ? s : s.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return s;
  const tz = event.timezone || 'UTC';
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: tz, timeZoneName: 'short',
    }).format(d);
  } catch {
    return d.toUTCString();
  }
}

async function deliverReminder(
  env: Env,
  event: any,
  recipient: { user_id: number | null; email: string | null; name: string | null },
  kind: ReminderKind,
): Promise<void> {
  const when = formatWhen(event);
  const lead = kind === 'reminder_1h'
    ? `${event.title} starts in about an hour.`
    : `${event.title} is coming up in the next day.`;
  const title = kind === 'reminder_1h'
    ? `Starting soon: ${event.title}`
    : `Reminder: ${event.title}`;

  // Account holders → in-app inbox.
  if (recipient.user_id != null) {
    await notify(env, {
      userId: Number(recipient.user_id),
      type: 'event_reminder',
      category: 'events',
      title,
      body: when,
      link: `/events/${event.slug}`,
      payload: { event_id: event.id, kind },
    }).catch(() => {});
    return;
  }

  // Email-only registrants → reminder email (best-effort).
  const hasGmail = !!(env as any).GMAIL_CLIENT_ID
    && !!(env as any).GMAIL_CLIENT_SECRET
    && !!(env as any).GMAIL_REFRESH_TOKEN;
  if (!recipient.email || !hasGmail) return;

  const base = baseUrl(env);
  const eventUrl = `${base}/events/${encodeURIComponent(event.slug)}`;
  const greeting = recipient.name ? `Hi ${recipient.name},` : 'Hi,';

  const tmpl: EmailTemplate = {
    key: 'event_reminder',
    category: 'calendar',
    severity: 'info',
    replyTo: 'support@axal.vc',
    subject: title,
    text: [greeting, '', lead, '', `When: ${when}`, '', `Details: ${eventUrl}`].join('\n'),
    html: `<h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px;letter-spacing:-0.02em;">${esc(lead)}</h1>
<p style="font-size:14px;color:#6b7280;margin:0 0 20px;line-height:1.6;">${esc(greeting)}</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
  <tr><td style="padding:4px 0;color:#6b7280;font-size:13px;width:64px;">When</td><td style="padding:4px 0;color:#111827;font-size:14px;font-weight:600;">${esc(when)}</td></tr>
</table>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0;">
  <a href="${esc(eventUrl)}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 28px;border-radius:14px;">View event</a>
</td></tr></table>`,
  };

  try {
    const rendered = wrap(tmpl, {}, { appUrl: base });
    const { sendRawEmail } = await import('./email/gmail');
    await sendRawEmail(env, {
      to: recipient.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      from: rendered.from,
      replyTo: rendered.replyTo,
    });
  } catch (e: any) {
    console.warn('[eventReminders] reminder email failed', e?.message || e);
  }
}

/**
 * Fire due reminders. Safe to call on every cron tick — it exits cheaply when
 * no events fall inside the 24h window.
 */
export async function sweepEventReminders(env: Env, now: Date = new Date()): Promise<ReminderSweepResult> {
  const result: ReminderSweepResult = { events: 0, sent: 0, skipped: 0 };
  await ensureEventsSchema(env);

  let events: any[] = [];
  try {
    const q = await env.DB.prepare(
      `SELECT id, slug, title, starts_at, timezone
         FROM events
        WHERE status = 'published'
          AND datetime(starts_at) > datetime('now')
          AND datetime(starts_at) <= datetime('now', '+25 hours')`,
    ).all();
    events = (q.results || []) as any[];
  } catch (e) {
    console.error('[eventReminders] event query failed', e);
    return result;
  }

  for (const ev of events) {
    const hrs = hoursUntil(ev.starts_at, now);
    if (hrs == null) continue;
    const kinds: ReminderKind[] = [];
    if (hrs > 1 && hrs <= 24) kinds.push('reminder_24h');
    if (hrs > 0 && hrs <= 1) kinds.push('reminder_1h');
    if (!kinds.length) continue;
    result.events++;

    let recipients: any[] = [];
    try {
      const r = await env.DB.prepare(
        `SELECT user_id, email, name FROM event_registrations
          WHERE event_id = ? AND status IN ('registered','confirmed')`,
      ).bind(ev.id).all();
      recipients = (r.results || []) as any[];
    } catch (e) {
      console.warn('[eventReminders] recipients query failed', (e as Error).message);
      continue;
    }

    for (const rec of recipients) {
      const principalKey = rec.user_id != null
        ? `user:${rec.user_id}`
        : (rec.email ? `email:${String(rec.email).toLowerCase()}` : null);
      if (!principalKey) continue;

      for (const kind of kinds) {
        // Insert-ledger-first: a UNIQUE collision means this reminder already
        // went out → skip delivery.
        let claimed = false;
        try {
          await env.DB.prepare(
            `INSERT INTO event_notifications (event_id, principal_key, kind) VALUES (?, ?, ?)`,
          ).bind(ev.id, principalKey, kind).run();
          claimed = true;
        } catch {
          claimed = false;
        }
        if (!claimed) { result.skipped++; continue; }
        await deliverReminder(env, ev, rec, kind);
        result.sent++;
      }
    }
  }

  return result;
}
