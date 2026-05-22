/**
 * Task #2 (IB) — Single transactional email entry point.
 *
 *   await send(env, 'auth_verify_email', user.email, { name, verify_url });
 *   await send(env, 'billing_invoice_receipt', user.email, vars, {
 *     userId: user.id,             // mirror into the Notification Center
 *     ctaUrl: vars.invoice_url,    // bell row links back to the receipt
 *   });
 *
 * Pipeline:
 *
 *   1. Look up the template in `../../templates/email/registry`.
 *   2. Render subject/text/html with caller `vars` (tiny `{{var}}`
 *      engine — no Handlebars / Mustache runtime).
 *   3. Wrap fragments in the shared chrome (header / footer with the
 *      registered company address + unsubscribe + account / legal links).
 *   4. Resolve `Reply-To` from the template, and for marketing class
 *      templates emit an HMAC-signed one-click `List-Unsubscribe` URL
 *      (RFC 8058) — the URL lands at /api/notifications/unsubscribe.
 *   5. Honour `users.marketing_unsubscribed_at` — marketing-class emails
 *      to that user are dropped (logged as `suppressed_unsubscribed`).
 *   6. Mirror into `notifications_inbox` (the bell) when `userId` is
 *      provided, stamping `category` / `severity` / `cta_url` /
 *      `template_key` per the IB spec schema.
 *   7. Insert a row in `email_send_log` (status=queued), then enqueue
 *      onto the native CF queue (job_type=`email_send`) with retry +
 *      DLQ via the existing JOB_QUEUE policy. If the queue binding is
 *      absent (dev/preview without queues), fall through to a direct
 *      synchronous send so dev iteration still emits mail.
 *
 * Failure to enqueue is logged but never throws — callers stay simple.
 */
import type { Env } from '../../types';
import { Jobs } from '../../models/jobs';
import { getTemplate } from '../../templates/email/registry';
import type { EmailTemplate } from '../../templates/email/layout';
import { wrap } from '../../templates/email/layout';
import { stripTrailingSlashes } from '../../util/url';

export interface SendOpts {
  /** Stamp `notifications_inbox` so the bell mirrors this email. */
  userId?: number;
  /** Override `cta_url` written to the inbox row. Defaults to vars
   *  `verify_url`/`magic_url`/`view_url`/etc. (first non-empty). */
  ctaUrl?: string;
  /** Override the inbox title (defaults to subject). */
  notificationTitle?: string;
  /** Override the inbox body (defaults to body text first line). */
  notificationBody?: string;
  /** Skip queue + send a synchronous Gmail call. Used by the queue
   *  consumer itself to actually deliver. */
  immediate?: boolean;
  /** Skip writing to `notifications_inbox`. The digest cron uses this
   *  to avoid mirroring a roll-up email of items already in the bell. */
  skipMirror?: boolean;
}

export interface SendResult {
  ok: boolean;
  /** `email_send_log.id` — the durable record of this attempt. */
  log_id: number | null;
  /** Set when the message was mirrored into the bell. */
  notification_id: number | null;
  /** Set when `immediate=true`. */
  delivered?: boolean;
  /** Reason for non-ok (e.g. `unknown_template`, `suppressed_unsubscribed`,
   *  `gmail_creds_missing`, `enqueue_failed`). */
  reason?: string;
}

const MARKETING_CATEGORIES = new Set<string>(['marketing']);

async function ensureSendLog(env: Env): Promise<boolean> {
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS email_send_log (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         user_id INTEGER,
         to_addr TEXT NOT NULL,
         template_key TEXT NOT NULL,
         category TEXT,
         job_id TEXT,
         status TEXT NOT NULL DEFAULT 'queued',
         attempts INTEGER NOT NULL DEFAULT 0,
         last_error TEXT,
         enqueued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         sent_at TIMESTAMP
       )`,
    ).run();
    return true;
  } catch (e) {
    console.error('[email/send] email_send_log bootstrap failed', e);
    return false;
  }
}

/** HMAC-signed one-click unsubscribe URL for marketing class emails.
 *  Token is `{user_id}.{exp}.{hex_sig}`; verifier lives in routes/notifications.ts. */
async function buildUnsubscribeUrl(env: Env, userId: number | undefined, appUrl: string): Promise<string | null> {
  if (!userId) return null;
  const secret = (env as any).AXAL_ENCRYPTION_SECRET || (env as any).JWT_SECRET;
  if (!secret) return null;
  const exp = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;  // 1 year
  const payload = `${userId}.${exp}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const sigHex = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  const token = `${payload}.${sigHex}`;
  return `${stripTrailingSlashes(appUrl)}/api/notifications/unsubscribe?token=${encodeURIComponent(token)}`;
}

async function isMarketingUnsubscribed(env: Env, userId?: number): Promise<boolean> {
  if (!userId) return false;
  try {
    const r: any = await env.DB.prepare(
      `SELECT marketing_unsubscribed_at FROM users WHERE id = ?`,
    ).bind(userId).first();
    return !!r?.marketing_unsubscribed_at;
  } catch { return false; }
}

function pickCtaUrl(vars: Record<string, unknown>, override?: string): string | null {
  if (override) return override;
  const candidates = ['verify_url', 'magic_url', 'reset_url', 'view_url', 'sign_url', 'manage_url', 'invoice_url', 'report_url', 'work_url', 'join_url', 'lab_url', 'dashboard_url', 'issue_url', 'signup_url', 'accept_url', 'confirm_url', 'revoke_url'];
  for (const k of candidates) {
    const v = vars[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

async function mirrorToInbox(
  env: Env,
  tmpl: EmailTemplate,
  rendered: { subject: string; text: string },
  vars: Record<string, unknown>,
  opts: SendOpts,
): Promise<number | null> {
  if (opts.skipMirror || !opts.userId) return null;
  try {
    // Bootstrap the spec columns lazily — migration 053 may not have
    // landed yet on dev / preview D1.
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS notifications_inbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL,
      body TEXT, link TEXT, payload TEXT, channel TEXT DEFAULT 'in_app',
      read_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`).run();
    for (const col of ['category TEXT', 'severity TEXT', 'cta_url TEXT', 'template_key TEXT']) {
      try { await env.DB.prepare(`ALTER TABLE notifications_inbox ADD COLUMN ${col}`).run(); } catch { /* idempotent */ }
    }
    const cta = pickCtaUrl(vars, opts.ctaUrl);
    const title = opts.notificationTitle || rendered.subject;
    const body  = opts.notificationBody  || rendered.text.split('\n').slice(0, 4).join(' ').slice(0, 320);
    const r: any = await env.DB.prepare(
      `INSERT INTO notifications_inbox
         (user_id, type, title, body, link, channel, category, severity, cta_url, template_key)
       VALUES (?, ?, ?, ?, ?, 'email,in_app', ?, ?, ?, ?)`,
    ).bind(
      opts.userId, tmpl.key, title, body, cta, tmpl.category, tmpl.severity, cta, tmpl.key,
    ).run();
    return Number(r?.meta?.last_row_id || 0) || null;
  } catch (e) {
    console.warn('[email/send] inbox mirror failed', e);
    return null;
  }
}

/**
 * Single entry point. Enqueues onto JOB_QUEUE so retries + DLQ go
 * through the existing Cloudflare Queues plumbing. The actual SMTP
 * (Gmail OAuth) call happens inside the queue consumer.
 */
export async function send(
  env: Env,
  templateKey: string,
  to: string,
  vars: Record<string, unknown> = {},
  opts: SendOpts = {},
): Promise<SendResult> {
  const tmpl = getTemplate(templateKey);
  if (!tmpl) {
    console.warn('[email/send] unknown template_key', templateKey);
    return { ok: false, log_id: null, notification_id: null, reason: 'unknown_template' };
  }

  // Marketing class respects the per-user opt-out. Transactional /
  // security / billing categories ignore it (CAN-SPAM allows this).
  if (tmpl.marketing && (await isMarketingUnsubscribed(env, opts.userId))) {
    return { ok: false, log_id: null, notification_id: null, reason: 'suppressed_unsubscribed' };
  }

  const appUrl = String((env as any).APP_URL || 'https://axal.vc');
  const unsubscribeUrl = tmpl.marketing
    ? await buildUnsubscribeUrl(env, opts.userId, appUrl)
    : null;

  const rendered = wrap(tmpl, vars, { appUrl, unsubscribeUrl });
  const notificationId = await mirrorToInbox(env, tmpl, rendered, vars, opts);

  // Log row first so the queue consumer can find + update it by id.
  await ensureSendLog(env);
  let logId: number | null = null;
  try {
    const r: any = await env.DB.prepare(
      `INSERT INTO email_send_log
         (user_id, to_addr, template_key, category, status)
       VALUES (?, ?, ?, ?, 'queued')`,
    ).bind(opts.userId ?? null, to, tmpl.key, tmpl.category).run();
    logId = Number(r?.meta?.last_row_id || 0) || null;
  } catch (e) {
    console.warn('[email/send] log insert failed', e);
  }

  const payload = {
    template_key: tmpl.key,
    to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    from: rendered.from,
    reply_to: rendered.replyTo,
    category: tmpl.category,
    list_unsubscribe: rendered.unsubscribeUrl ?? null,
    user_id: opts.userId ?? null,
    log_id: logId,
  };

  // Immediate path — called by the queue consumer itself.
  if (opts.immediate) {
    const delivered = await deliverNow(env, payload);
    return { ok: delivered, log_id: logId, notification_id: notificationId, delivered };
  }

  // Normal path — enqueue. Falls back to immediate when JOB_QUEUE
  // binding is missing (dev/preview without queues configured).
  const hasQueue = !!(env as any).JOB_QUEUE;
  if (!hasQueue) {
    const delivered = await deliverNow(env, payload);
    return { ok: delivered, log_id: logId, notification_id: notificationId, delivered };
  }

  try {
    await Jobs.enqueue(env, 'email_send' as any, payload, { max_retries: 5 });
    return { ok: true, log_id: logId, notification_id: notificationId };
  } catch (e) {
    console.error('[email/send] enqueue failed, falling back to immediate', e);
    const delivered = await deliverNow(env, payload);
    return { ok: delivered, log_id: logId, notification_id: notificationId, delivered, reason: 'enqueue_failed' };
  }
}

/**
 * Direct delivery — used by:
 *   - the queue consumer (`handleEmailSend` in queueWorker.ts)
 *   - the dev fallback when no JOB_QUEUE binding is bound
 *   - immediate=true callers (e.g. a debug ping)
 *
 * Adds the marketing one-click `List-Unsubscribe` + `List-Unsubscribe-Post`
 * headers on top of the existing multipart/alternative MIME built by
 * services/email.ts. We do NOT modify services/email.ts — instead we
 * wrap the raw envelope here, since List-Unsubscribe is only relevant
 * to the new send() pipeline.
 */
export async function deliverNow(
  env: Env,
  payload: {
    template_key: string; to: string; subject: string;
    text: string; html: string; from: string; reply_to: string;
    category: string; list_unsubscribe: string | null;
    user_id: number | null; log_id: number | null;
  },
): Promise<boolean> {
  const creds = !!(env as any).GMAIL_CLIENT_ID && !!(env as any).GMAIL_CLIENT_SECRET && !!(env as any).GMAIL_REFRESH_TOKEN;
  if (!creds) {
    await markLog(env, payload.log_id, 'failed', 'gmail_creds_missing');
    return false;
  }
  try {
    const { sendRawEmail } = await import('./gmail');
    const ok = await sendRawEmail(env, {
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
      from: payload.from,
      replyTo: payload.reply_to,
      extraHeaders: payload.list_unsubscribe
        ? {
            'List-Unsubscribe': `<${payload.list_unsubscribe}>, <mailto:unsubscribe@axal.vc?subject=unsubscribe>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          }
        : undefined,
    });
    await markLog(env, payload.log_id, ok ? 'sent' : 'failed', ok ? null : 'gmail_send_failed');
    return ok;
  } catch (e: any) {
    await markLog(env, payload.log_id, 'failed', e?.message || 'deliver_now_threw');
    return false;
  }
}

async function markLog(env: Env, logId: number | null, status: 'sent' | 'failed' | 'dlq', err: string | null): Promise<void> {
  if (!logId) return;
  try {
    if (status === 'sent') {
      await env.DB.prepare(
        `UPDATE email_send_log SET status='sent', attempts=attempts+1, sent_at=CURRENT_TIMESTAMP, last_error=NULL WHERE id=?`,
      ).bind(logId).run();
    } else {
      await env.DB.prepare(
        `UPDATE email_send_log SET status=?, attempts=attempts+1, last_error=? WHERE id=?`,
      ).bind(status, err ?? null, logId).run();
    }
  } catch (e) {
    console.warn('[email/send] log update failed', e);
  }
}
