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
 *   5. Honour `user_marketing_prefs.unsubscribed_at` — marketing-class emails
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
import { enqueueJob } from '../queue';
import { getTemplate } from '../../templates/email/registry';
import type { EmailTemplate } from '../../templates/email/layout';
import { wrap } from '../../templates/email/layout';
import { stripTrailingSlashes } from '../../util/url';
import { isSuppressed, type MailClass } from '../newsletter';
import {
  deliverWithReference, isSettled, recipientOf, recordQueued, refKey,
  type DeliveryState, type SendReference,
} from './deliveryContract';

/** D810 — what a template's mail is, for the suppression list. */
export function mailClassOf(tmpl: Pick<EmailTemplate, 'category' | 'marketing'>): MailClass {
  if (tmpl.marketing) return 'marketing';
  if (tmpl.category === 'security') return 'security';
  return 'transactional';
}

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
  /** D8536 — the send reference of a critical-flow email. Set by `sendBound`,
   *  which also resolved `to` from the reference's subject record. */
  sendRef?: SendReference;
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
  /** D8536 — set for a send under a reference: its contract state and key. */
  state?: DeliveryState;
  ref?: string;
}

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
    // D189 — reads `user_marketing_prefs`, not `users`. The column 053
    // declared could never exist (`users` is at D1's 100-column cap), so this
    // SELECT named a column no environment has ever had; its own catch turned
    // that into `false`, and marketing suppression has therefore always failed
    // OPEN. Migration 277 gives the fact a table. The catch stays: a store
    // this cannot read is still not a reason to block a transactional email,
    // and failing open is the deliberate choice — but it is now a choice about
    // an unreadable store rather than about a column that was never there.
    const r: any = await env.DB.prepare(
      `SELECT unsubscribed_at FROM user_marketing_prefs WHERE user_id = ?`,
    ).bind(userId).first();
    return !!r?.unsubscribed_at;
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

  // D810 — the suppression list, by reason: an unsubscribe stops marketing,
  // a bounce or complaint stops everything but account security.
  if (await isSuppressed(env, to, mailClassOf(tmpl))) {
    return { ok: false, log_id: null, notification_id: null, reason: 'suppressed' };
  }

  // D8536 — a send under a reference that an earlier attempt already settled
  // (accepted, or left without an answer) is answered from the ledger: no
  // second log row, bell row or queue message.
  const ref = opts.sendRef ? refKey(opts.sendRef) : undefined;
  if (opts.sendRef) {
    const prior = await recordQueued(env, opts.sendRef);
    if (isSettled(prior)) {
      return { ok: true, log_id: null, notification_id: null, reason: 'reconciled', state: prior!, ref };
    }
  }

  const appUrl = String((env as any).APP_URL || 'https://axal.vc');
  const unsubscribeUrl = tmpl.marketing
    ? await buildUnsubscribeUrl(env, opts.userId, appUrl)
    : null;

  const rendered = wrap(tmpl, vars, { appUrl, unsubscribeUrl, to });
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
    send_ref: opts.sendRef ?? null,
  };

  // Immediate path — called by the queue consumer itself.
  if (opts.immediate) {
    const d = await deliver(env, payload);
    return { ok: d.delivered, log_id: logId, notification_id: notificationId, delivered: d.delivered, ...(ref ? { state: d.state, ref } : {}) };
  }

  // Normal path — enqueue. Falls back to immediate when JOB_QUEUE
  // binding is missing (dev/preview without queues configured).
  //
  // `enqueueJob`, not `Jobs.enqueue`. The latter only inserts a D1
  // `queue_jobs` row, which the minute cron drains — and skips entirely
  // while another drain holds the lease. Production has USE_CF_QUEUE and
  // a queue consumer that delivers `email_send` as soon as the message is
  // accepted. Writing the row and returning `ok` made /magic/start say the
  // link was on its way while the message waited for a cron tick that
  // might not run before the person gave up and pressed Resend.
  const hasQueue = !!(env as any).JOB_QUEUE;
  if (!hasQueue) {
    const d = await deliver(env, payload);
    return { ok: d.delivered, log_id: logId, notification_id: notificationId, delivered: d.delivered, ...(ref ? { state: d.state, ref } : {}) };
  }

  try {
    await enqueueJob(env, 'email_send', payload, { max_retries: 5 });
    return { ok: true, log_id: logId, notification_id: notificationId, ...(ref ? { state: 'queued' as const, ref } : {}) };
  } catch (e) {
    // The error names the stage only: the payload carries the message, and a
    // critical-flow message carries a usable link (D8536).
    console.error('[email/send] enqueue failed, falling back to immediate', (e as any)?.name || 'Error');
    const d = await deliver(env, payload);
    return { ok: d.delivered, log_id: logId, notification_id: notificationId, delivered: d.delivered, reason: 'enqueue_failed', ...(ref ? { state: d.state, ref } : {}) };
  }
}

/**
 * D8536 — send a registry template in a critical flow. The recipient is the
 * address `ref`'s subject record names (`deliveryContract.ts`), never a
 * parameter, and the answer carries the contract state and the reference.
 */
export async function sendBound(
  env: Env,
  templateKey: string,
  ref: SendReference,
  vars: Record<string, unknown> = {},
  opts: Omit<SendOpts, 'sendRef'> = {},
): Promise<SendResult & { state: DeliveryState; ref: string }> {
  const key = refKey(ref);
  const to = await recipientOf(env, ref);
  if (!to) return { ok: false, log_id: null, notification_id: null, reason: 'no_recipient', state: 'refused', ref: key };
  const r = await send(env, templateKey, to, vars, { ...opts, sendRef: ref });
  return { ...r, state: r.state ?? 'refused', ref: key };
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
type DeliveryPayload = {
  template_key: string; to: string; subject: string;
  text: string; html: string; from: string; reply_to: string;
  category: string; list_unsubscribe: string | null;
  user_id: number | null; log_id: number | null;
  /** D8536 — present for a critical-flow email; see `deliveryContract.ts`. */
  send_ref?: SendReference | null;
};

/**
 * True when the message needs no further try: it was delivered, or (under a
 * send reference) it is settled — accepted, or left without an answer, which
 * a retry must not send again. The queue consumer throws on false, so
 * Cloudflare Queues retries; a retry of a referenced send reconciles.
 */
export async function deliverNow(env: Env, payload: DeliveryPayload): Promise<boolean> {
  const d = await deliver(env, payload);
  return d.delivered || isSettled(d.state ?? null);
}

async function deliver(env: Env, payload: DeliveryPayload): Promise<{ delivered: boolean; state?: DeliveryState }> {
  if (payload.send_ref) return deliverReferenced(env, payload, payload.send_ref);
  return { delivered: await deliverUnreferenced(env, payload) };
}

function mimeOf(payload: DeliveryPayload) {
  return {
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
    from: payload.from,
    replyTo: payload.reply_to,
    mailClass: (payload.category === 'security' ? 'security' : payload.list_unsubscribe ? 'marketing' : 'transactional') as MailClass,
    extraHeaders: payload.list_unsubscribe
      ? {
          'List-Unsubscribe': `<${payload.list_unsubscribe}>, <mailto:unsubscribe@axal.vc?subject=unsubscribe>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        }
      : undefined,
  };
}

/** D8536 — one send under its reference. The address is re-read from the subject record here, not taken from the payload. */
async function deliverReferenced(env: Env, payload: DeliveryPayload, ref: SendReference): Promise<{ delivered: boolean; state: DeliveryState }> {
  const { sendRawEmailOutcome } = await import('./gmail');
  let r;
  try {
    r = await deliverWithReference(env, ref, (to) => sendRawEmailOutcome(env, { ...mimeOf(payload), to }));
  } catch (e: any) {
    // An unreadable subject record, say. Refused, so the queue retries; a
    // row left `sending` answers `timed_out` on that retry and is not re-sent.
    console.error('[email/send] referenced delivery threw', e?.name || 'Error');
    await markLog(env, payload.log_id, 'failed', 'deliver_threw');
    return { delivered: false, state: 'refused' };
  }
  if (!r.reconciled) {
    await markLog(env, payload.log_id, r.state === 'accepted' ? 'sent' : r.state === 'timed_out' ? 'timed_out' : 'failed', r.reason);
  }
  return { delivered: r.state === 'accepted', state: r.state };
}

async function deliverUnreferenced(env: Env, payload: DeliveryPayload): Promise<boolean> {
  const creds = !!(env as any).GMAIL_CLIENT_ID && !!(env as any).GMAIL_CLIENT_SECRET && !!(env as any).GMAIL_REFRESH_TOKEN;
  if (!creds) {
    await markLog(env, payload.log_id, 'failed', 'gmail_creds_missing');
    return false;
  }
  try {
    const { sendRawEmail } = await import('./gmail');
    const ok = await sendRawEmail(env, { ...mimeOf(payload), to: payload.to });
    await markLog(env, payload.log_id, ok ? 'sent' : 'failed', ok ? null : 'gmail_send_failed');
    return ok;
  } catch (e: any) {
    await markLog(env, payload.log_id, 'failed', e?.message || 'deliver_now_threw');
    return false;
  }
}

async function markLog(env: Env, logId: number | null, status: 'sent' | 'failed' | 'dlq' | 'timed_out', err: string | null): Promise<void> {
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
