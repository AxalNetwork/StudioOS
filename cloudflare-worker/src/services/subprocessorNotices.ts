/**
 * D1075 (#2967) — subprocessor notices: a double opt-in subscription, and an
 * email to each confirmed subscriber before a new subprocessor starts.
 *
 * THE NEWSLETTER'S PATTERN (D810), SMALLER. A subscribe makes a `pending`
 * row and sends a single-use confirm link (48 hours, only its SHA-256 kept).
 * Nothing is ever sent to a pending or unsubscribed row: the sweep selects
 * `status = 'confirmed'` and nothing else. The answer to a subscribe is the
 * same whatever the address's state, so nobody learns who is subscribed.
 *
 * THE ADDRESS IS ENCRYPTED (`columnCipher.ts`, bound to the row's uid), with
 * an HMAC of it for the one-row-per-address lookup. Both derive from KEK_PII;
 * in production without it every route answers 503
 * `subscriptions_unconfigured` rather than store an address in the clear.
 *
 * THE UNSUBSCRIBE LINK is `<uid>.<version>.<hmac>`, signed with the same key
 * and never stored. Using it raises `token_version`, so each link works once.
 *
 * THE NOTICE. Publish lists a new subprocessor no sooner than ten days ahead
 * (`trustContent.ts`). `sendSubprocessorNotices` then emails each confirmed
 * subscriber once per subprocessor that has not started yet, claiming a row
 * in `subprocessor_notice_deliveries` before it sends, so two sweeps never
 * send twice. A failed send is retried after an hour. Without mail
 * credentials nothing is claimed, so the notices go once they are set.
 */
import type { Env } from '../types';
import { decryptColumn, encryptColumn, indexHmac } from './columnCipher';
import { constantTimeEqual } from '../rpc/secret';
import { CONFIRM_TTL_MS, EMAIL_PACE_MS, isSuppressed, newConfirmToken, confirmTokenHash, normalizeEmail } from './newsletter';
import { sendRawEmail } from './email/gmail';
import { stripTrailingSlashes } from '../util/url';
import { today } from './trustContent';
import * as mail from '../templates/email/trust';

const TABLE = 'subprocessor_subscribers';
const FROM = 'Axal VC <noreply@axal.vc>';
const REPLY_TO = 'privacy@axal.vc';
export const NOTICE_BATCH = 40;

export const SUBSCRIBE_ANSWER = { ok: true, message: 'Check your inbox to confirm. You are subscribed once you open the link we sent.' } as const;

export function baseUrl(env: Env): string {
  return stripTrailingSlashes(String(env.PUBLIC_BASE_URL || env.APP_URL || 'https://axal.vc'));
}

const mailReady = (env: Env) => {
  const e = env as any;
  return !!(e.GMAIL_CLIENT_ID && e.GMAIL_CLIENT_SECRET && e.GMAIL_REFRESH_TOKEN);
};

/** Whether the store can hold an address: false in production without KEK_PII. */
export async function canStoreAddresses(env: Env): Promise<boolean> {
  try { await indexHmac(env, TABLE, 'email', 'probe@example.test'); return true; } catch { return false; }
}

type SubscriberRow = {
  id: number; uid: string; email_enc: string; status: 'pending' | 'confirmed' | 'unsubscribed';
  confirm_token_hash: string | null; confirm_expires_at: string | null; token_version: number; last_email_at: string | null;
};

async function send(env: Env, to: string, m: mail.TrustEmail, unsubscribeUrl?: string): Promise<boolean> {
  if (!mailReady(env)) return false;
  return sendRawEmail(env, {
    to, subject: m.subject, text: m.text, html: m.html, from: FROM, replyTo: REPLY_TO, mailClass: 'transactional',
    extraHeaders: unsubscribeUrl
      ? { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
      : undefined,
  });
}

const tooSoon = (row: Pick<SubscriberRow, 'last_email_at'> | null, now: number) =>
  !!row?.last_email_at && now - Date.parse(row.last_email_at.includes('T') ? row.last_email_at : `${row.last_email_at.replace(' ', 'T')}Z`) < EMAIL_PACE_MS;

/**
 * A subscribe. Returns false when the address is not one; otherwise true,
 * whatever happened, because the answer never says which.
 */
export async function subscribe(env: Env, rawEmail: unknown, now = Date.now()): Promise<boolean> {
  const email = normalizeEmail(rawEmail);
  if (!email) return false;
  if (await isSuppressed(env, email, 'transactional')) return true;
  const hash = await indexHmac(env, TABLE, 'email', email);
  const row = await env.DB.prepare(`SELECT id, uid, email_enc, status, confirm_token_hash, confirm_expires_at, token_version, last_email_at FROM subprocessor_subscribers WHERE email_hash = ?`).bind(hash).first<SubscriberRow>();
  if (row?.status === 'confirmed') return true;
  if (row && tooSoon(row, now)) return true;

  const confirm = await newConfirmToken();
  const expires = new Date(now + CONFIRM_TTL_MS).toISOString();
  const sentAt = new Date(now).toISOString();
  if (row) {
    await env.DB.prepare(
      `UPDATE subprocessor_subscribers SET status = 'pending', confirm_token_hash = ?, confirm_expires_at = ?, last_email_at = ? WHERE id = ?`,
    ).bind(confirm.hash, expires, sentAt, row.id).run();
  } else {
    const uid = `sps_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const enc = await encryptColumn(env, TABLE, 'email', uid, email);
    await env.DB.prepare(
      `INSERT INTO subprocessor_subscribers (uid, email_hash, email_enc, status, confirm_token_hash, confirm_expires_at, last_email_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
    ).bind(uid, hash, enc, confirm.hash, expires, sentAt).run();
  }
  const url = `${baseUrl(env)}/api/public/trust/subprocessors/confirm?token=${encodeURIComponent(confirm.token)}`;
  await send(env, email, mail.subprocessorConfirm({ confirm_url: url }));
  return true;
}

export type TokenRefusal = 'token_invalid' | 'token_expired';

/** The pending row a confirm token names while it is usable, or why not. Reads only. */
export async function confirmRow(env: Env, token: string, now = Date.now()): Promise<SubscriberRow | TokenRefusal> {
  if (token.length < 20 || token.length > 200) return 'token_invalid';
  const row = await env.DB.prepare(`SELECT id, uid, email_enc, status, confirm_token_hash, confirm_expires_at, token_version, last_email_at FROM subprocessor_subscribers WHERE confirm_token_hash = ?`)
    .bind(await confirmTokenHash(token)).first<SubscriberRow>();
  if (!row) return 'token_invalid';
  if (!row.confirm_expires_at || Date.parse(row.confirm_expires_at) < now) return 'token_expired';
  return row;
}

/** Confirms the row a token names. Single use: only the request that clears the hash goes on. */
export async function confirm(env: Env, token: string, now = Date.now()): Promise<true | TokenRefusal> {
  const row = await confirmRow(env, token, now);
  if (typeof row === 'string') return row;
  const claimed = await env.DB.prepare(
    `UPDATE subprocessor_subscribers SET status = 'confirmed', confirmed_at = ?, unsubscribed_at = NULL,
            confirm_token_hash = NULL, confirm_expires_at = NULL
      WHERE id = ? AND confirm_token_hash = ?`,
  ).bind(new Date(now).toISOString(), row.id, row.confirm_token_hash).run();
  return Number((claimed as any)?.meta?.changes ?? 0) === 1 ? true : 'token_invalid';
}

/** The unsubscribe link's token for a row: `<uid>.<version>.<hmac>`. */
export async function unsubscribeToken(env: Env, uid: string, version: number): Promise<string> {
  return `${uid}.${version}.${await indexHmac(env, TABLE, 'unsubscribe', `${uid}.${version}`)}`;
}

/** Unsubscribes the row a token names, once: the version it was signed over is raised. */
export async function unsubscribe(env: Env, token: unknown, now = Date.now()): Promise<true | 'token_invalid'> {
  if (typeof token !== 'string' || token.length > 200) return 'token_invalid';
  const parts = token.split('.');
  if (parts.length !== 3) return 'token_invalid';
  const [uid, v, sig] = parts;
  if (!/^sps_[0-9a-f]{20}$/.test(uid) || !/^\d{1,9}$/.test(v) || !/^[0-9a-f]{64}$/.test(sig)) return 'token_invalid';
  const expected = await indexHmac(env, TABLE, 'unsubscribe', `${uid}.${v}`);
  if (!constantTimeEqual(sig, expected)) return 'token_invalid';
  const done = await env.DB.prepare(
    `UPDATE subprocessor_subscribers SET status = 'unsubscribed', unsubscribed_at = ?, token_version = token_version + 1
      WHERE uid = ? AND token_version = ? AND status = 'confirmed'`,
  ).bind(new Date(now).toISOString(), uid, Number(v)).run();
  return Number((done as any)?.meta?.changes ?? 0) === 1 ? true : 'token_invalid';
}

/** Counts by status, for HQ. Never an address. */
export async function subscriberCounts(env: Env) {
  const rows = (await env.DB.prepare(`SELECT status, COUNT(*) AS n FROM subprocessor_subscribers GROUP BY status`).all<{ status: string; n: number }>()).results || [];
  const out = { confirmed: 0, pending: 0, unsubscribed: 0 };
  for (const r of rows) if (r.status in out) (out as any)[r.status] = Number(r.n);
  return out;
}

/**
 * Emails confirmed subscribers about subprocessors that are published and
 * have not started yet, at most `limit` emails per call. Counts only.
 */
export async function sendSubprocessorNotices(env: Env, opts: { limit?: number; now?: number } = {}) {
  const now = opts.now ?? Date.now();
  if (!mailReady(env)) return { sent: 0, failed: 0, unconfigured: true };
  const limit = Math.max(1, Math.min(200, opts.limit ?? NOTICE_BATCH));
  const due = (await env.DB.prepare(
    `SELECT s.id AS sid, s.name, s.purpose, s.data_seen, s.location, s.starts_at,
            u.id AS subid, u.uid, u.email_enc, u.token_version, d.outcome
       FROM trust_subprocessors s
       JOIN subprocessor_subscribers u ON u.status = 'confirmed'
       LEFT JOIN subprocessor_notice_deliveries d ON d.subprocessor_id = s.id AND d.subscriber_id = u.id
      WHERE s.state = 'published' AND s.starts_at > ?
        AND (d.subprocessor_id IS NULL OR (d.outcome = 'failed' AND d.attempted_at < datetime(?, '-1 hour')))
      ORDER BY s.id, u.id LIMIT ?`,
  ).bind(today(now), new Date(now).toISOString().slice(0, 19).replace('T', ' '), limit).all<{
    sid: number; name: string; purpose: string; data_seen: string; location: string; starts_at: string;
    subid: number; uid: string; email_enc: string; token_version: number; outcome: string | null;
  }>()).results || [];
  let sent = 0, failed = 0;
  const list = `${baseUrl(env)}/trust/subprocessors`;
  for (const r of due) {
    const claim = r.outcome === 'failed'
      ? await env.DB.prepare(
        `UPDATE subprocessor_notice_deliveries SET outcome = 'sending', attempted_at = datetime('now')
          WHERE subprocessor_id = ? AND subscriber_id = ? AND outcome = 'failed'`,
      ).bind(r.sid, r.subid).run()
      : await env.DB.prepare(
        `INSERT OR IGNORE INTO subprocessor_notice_deliveries (subprocessor_id, subscriber_id, outcome) VALUES (?, ?, 'sending')`,
      ).bind(r.sid, r.subid).run();
    if (Number((claim as any)?.meta?.changes ?? 0) !== 1) continue;
    const email = await decryptColumn(env, TABLE, 'email', r.uid, r.email_enc);
    let ok = false;
    if (email) {
      const unsubscribeUrl = `${baseUrl(env)}/api/public/trust/subprocessors/unsubscribe?token=${encodeURIComponent(await unsubscribeToken(env, r.uid, r.token_version))}`;
      ok = await send(env, email, mail.subprocessorNotice({
        name: r.name, purpose: r.purpose, data: r.data_seen, location: r.location, starts_on: r.starts_at,
        list_url: list, unsubscribe_url: unsubscribeUrl,
      }), unsubscribeUrl);
    }
    await env.DB.prepare(
      `UPDATE subprocessor_notice_deliveries SET outcome = ?, attempted_at = datetime('now') WHERE subprocessor_id = ? AND subscriber_id = ?`,
    ).bind(ok ? 'sent' : 'failed', r.sid, r.subid).run();
    if (ok) sent++; else failed++;
  }
  return { sent, failed, unconfigured: false };
}
