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
import { NOTICE_DAYS, today } from './trustContent';
import * as mail from '../templates/email/trust';

const TABLE = 'subprocessor_subscribers';
const FROM = 'Axal VC <noreply@axal.vc>';
const REPLY_TO = 'privacy@axal.vc';
export const NOTICE_BATCH = 40;

export const SUBSCRIBE_ANSWER = { ok: true, message: 'Check your inbox to confirm. You are subscribed once you open the link we sent.' } as const;

export function baseUrl(env: Env): string {
  return stripTrailingSlashes(String(env.PUBLIC_BASE_URL || env.APP_URL || 'https://axal.vc'));
}

export const mailReady = (env: Env) => {
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

/** D4683: a `sending` claim older than this was interrupted before its outcome was recorded. */
export const SEND_LEASE_MS = 15 * 60 * 1000;
/** D4683: a failed send is retried after this long. */
export const RETRY_AFTER_MS = 60 * 60 * 1000;
/** D4683: sends attempted per subscriber and notice before the sweep stops and the notice needs attention. */
export const MAX_ATTEMPTS = 6;

/** SQLite's `datetime()` text for an instant, so every stamp the sweep compares is written the same way. */
const sqlAt = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

/**
 * Emails confirmed subscribers about subprocessors that are published and
 * have not started yet, at most `limit` emails per call. Counts only.
 *
 * D4683 — EVERY DELIVERY ENDS IN A RECORDED OUTCOME, OR IS RECOVERED.
 *   · A delivery is CLAIMED before it is sent (one row per subscriber and
 *     notice), so two sweeps never send it twice at once.
 *   · A claim still `sending` after `SEND_LEASE_MS` was interrupted (the
 *     isolate died between the send and the write). Whether the email left is
 *     unknown; the sweep re-claims it, counts it in `interrupted`, and sends
 *     again, because a notice of a new subprocessor delivered twice is better
 *     than one never delivered. The Trust workspace says a resend may have
 *     reached an inbox twice.
 *   · A failed send is retried after `RETRY_AFTER_MS`, up to `MAX_ATTEMPTS`
 *     sends in all; after that it is left failed and the notice needs
 *     attention instead of retrying for ever.
 *   · Nothing is sent once the subprocessor has started.
 * Every re-claim is one conditional UPDATE, so of two sweeps reaching the same
 * row only one goes on.
 */
export async function sendSubprocessorNotices(env: Env, opts: { limit?: number; now?: number } = {}) {
  const now = opts.now ?? Date.now();
  if (!mailReady(env)) return { sent: 0, failed: 0, recovered: 0, unconfigured: true };
  const limit = Math.max(1, Math.min(200, opts.limit ?? NOTICE_BATCH));
  const nowSql = sqlAt(now);
  const retryBefore = sqlAt(now - RETRY_AFTER_MS);
  const leaseBefore = sqlAt(now - SEND_LEASE_MS);
  const due = (await env.DB.prepare(
    `SELECT s.id AS sid, s.name, s.purpose, s.data_seen, s.location, s.starts_at,
            u.id AS subid, u.uid, u.email_enc, u.token_version, d.outcome
       FROM trust_subprocessors s
       JOIN subprocessor_subscribers u ON u.status = 'confirmed'
       LEFT JOIN subprocessor_notice_deliveries d ON d.subprocessor_id = s.id AND d.subscriber_id = u.id
      WHERE s.state = 'published' AND s.starts_at > ?
        AND (d.subprocessor_id IS NULL
          OR (d.outcome = 'failed' AND d.attempted_at < ? AND d.attempts < ?)
          OR (d.outcome = 'sending' AND d.attempted_at < ? AND d.attempts < ?))
      ORDER BY s.id, u.id LIMIT ?`,
  ).bind(today(now), retryBefore, MAX_ATTEMPTS, leaseBefore, MAX_ATTEMPTS, limit).all<{
    sid: number; name: string; purpose: string; data_seen: string; location: string; starts_at: string;
    subid: number; uid: string; email_enc: string; token_version: number; outcome: string | null;
  }>()).results || [];
  let sent = 0, failed = 0, recovered = 0;
  const list = `${baseUrl(env)}/trust/subprocessors`;
  for (const r of due) {
    let claim;
    if (r.outcome === 'failed') {
      claim = await env.DB.prepare(
        `UPDATE subprocessor_notice_deliveries SET outcome = 'sending', attempted_at = ?, attempts = attempts + 1
          WHERE subprocessor_id = ? AND subscriber_id = ? AND outcome = 'failed' AND attempted_at < ? AND attempts < ?`,
      ).bind(nowSql, r.sid, r.subid, retryBefore, MAX_ATTEMPTS).run();
    } else if (r.outcome === 'sending') {
      claim = await env.DB.prepare(
        `UPDATE subprocessor_notice_deliveries SET attempted_at = ?, attempts = attempts + 1, interrupted = interrupted + 1
          WHERE subprocessor_id = ? AND subscriber_id = ? AND outcome = 'sending' AND attempted_at < ? AND attempts < ?`,
      ).bind(nowSql, r.sid, r.subid, leaseBefore, MAX_ATTEMPTS).run();
    } else {
      claim = await env.DB.prepare(
        `INSERT OR IGNORE INTO subprocessor_notice_deliveries (subprocessor_id, subscriber_id, outcome, attempted_at, attempts)
         VALUES (?, ?, 'sending', ?, 1)`,
      ).bind(r.sid, r.subid, nowSql).run();
    }
    if (Number((claim as any)?.meta?.changes ?? 0) !== 1) continue;
    if (r.outcome === 'sending') recovered++;
    const email = await decryptColumn(env, TABLE, 'email', r.uid, r.email_enc);
    let ok = false;
    if (email) {
      const unsubscribeUrl = `${baseUrl(env)}/api/public/trust/subprocessors/unsubscribe?token=${encodeURIComponent(await unsubscribeToken(env, r.uid, r.token_version))}`;
      ok = await send(env, email, mail.subprocessorNotice({
        name: r.name, purpose: r.purpose, data: r.data_seen, location: r.location, starts_on: r.starts_at,
        list_url: list, unsubscribe_url: unsubscribeUrl,
      }), unsubscribeUrl).catch(() => false);
    }
    const doneAt = sqlAt(opts.now ?? Date.now());
    await env.DB.prepare(
      `UPDATE subprocessor_notice_deliveries SET outcome = ?, attempted_at = ?, sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END
        WHERE subprocessor_id = ? AND subscriber_id = ? AND outcome = 'sending'`,
    ).bind(ok ? 'sent' : 'failed', doneAt, ok ? 'sent' : 'failed', doneAt, r.sid, r.subid).run();
    if (ok) sent++; else failed++;
  }
  return { sent, failed, recovered, unconfigured: false };
}

/** D4803 (SE07): how many notices the Trust workspace lists, newest start first. */
export const NOTICE_SUMMARY_LIMIT = 20;
/** D4803: a notice stays on the list this many days after its subprocessor started. */
export const NOTICE_SUMMARY_DAYS = 90;

export type NoticeDelivery = {
  uid: string;
  name: string;
  starts_at: string;
  /** D4683: the public change-log entry that published this subprocessor, and whether that entry is on the log. */
  change_uid: string | null;
  published_at: string | null;
  in_change_log: boolean;
  /** D4683: the date the notice was owed by — `NOTICE_DAYS` before the start. A send after it was late. */
  notice_due_by: string;
  /** Whether the subprocessor's start day has come; after it, nothing more is sent. */
  started: boolean;
  /** Claimed and not yet answered by the mail provider, within the sweep's lease. */
  sending: number;
  /** D4683: claimed and never answered: the send was interrupted, so whether it left is unknown. The sweep resends it. */
  unknown: number;
  /** Accepted by the mail provider. Whether it reached an inbox is not recorded. */
  sent: number;
  /** D4683: of `sent`, accepted after `notice_due_by`. */
  late: number;
  /** D4683: of `sent`, deliveries that were interrupted at least once, so a subscriber may have the notice twice. */
  resent_after_interruption: number;
  /** Refused by the provider or no address; retried after an hour while not started and under the attempt limit. */
  failed: number;
  /** D4683: of `failed`, those that reached the attempt limit and will not be retried. */
  exhausted: number;
  /** Confirmed subscribers with no attempt yet: queued while not started, never sent once it has. */
  not_sent: number;
  /**
   * D4683: the notice as one word.
   *   delivered        every attempt was accepted
   *   in_progress      not started, still being sent, nothing stuck
   *   needs_attention  not started, and something is stuck: an interrupted send, the attempt limit, or the
   *                    notice date passed with deliveries still owed
   *   missed           started with deliveries never accepted: those subscribers were not told in time
   */
  state: 'delivered' | 'in_progress' | 'needs_attention' | 'missed';
};
export type NoticeDeliveries =
  | { available: true; mail_configured: boolean; rows: NoticeDelivery[] }
  | { available: false; reason: string };

const addDaysTo = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * D4803 — PER-NOTICE DELIVERY, from the rows the sweep already writes. D4683
 * adds what an operator needs to act on: the interrupted sends whose outcome
 * is unknown, the ones that hit the attempt limit, the sends that went out
 * after the notice date, the change-log entry each notice belongs to, and one
 * state per notice that never reads as delivered while a subscriber is owed.
 * Without mail credentials the sweep sends nothing, and `mail_configured`
 * says so, so "0 sent" is never read as delivery working.
 */
export async function noticeDeliveries(env: Env, now = Date.now()): Promise<NoticeDeliveries> {
  const day = today(now);
  const since = new Date(now - NOTICE_SUMMARY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const leaseBefore = sqlAt(now - SEND_LEASE_MS);
  try {
    const rows = (await env.DB.prepare(
      `SELECT s.uid, s.name, s.starts_at, s.change_uid, s.published_at,
              (SELECT COUNT(*) FROM trust_content_changes c WHERE c.uid = s.change_uid) AS logged,
              COALESCE(SUM(CASE WHEN d.outcome = 'sending' AND d.attempted_at >= ? THEN 1 ELSE 0 END), 0) AS sending,
              COALESCE(SUM(CASE WHEN d.outcome = 'sending' AND d.attempted_at < ? THEN 1 ELSE 0 END), 0) AS unknown,
              COALESCE(SUM(CASE WHEN d.outcome = 'sent' THEN 1 ELSE 0 END), 0) AS sent,
              COALESCE(SUM(CASE WHEN d.outcome = 'sent' AND d.sent_at IS NOT NULL AND substr(d.sent_at, 1, 10) > date(s.starts_at, ?) THEN 1 ELSE 0 END), 0) AS late,
              COALESCE(SUM(CASE WHEN d.outcome = 'sent' AND d.interrupted > 0 THEN 1 ELSE 0 END), 0) AS resent,
              COALESCE(SUM(CASE WHEN d.outcome = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
              COALESCE(SUM(CASE WHEN d.outcome = 'failed' AND d.attempts >= ? THEN 1 ELSE 0 END), 0) AS exhausted,
              (SELECT COUNT(*) FROM subprocessor_subscribers u
                WHERE u.status = 'confirmed'
                  AND NOT EXISTS (SELECT 1 FROM subprocessor_notice_deliveries x
                                   WHERE x.subprocessor_id = s.id AND x.subscriber_id = u.id)) AS not_sent
         FROM trust_subprocessors s
         LEFT JOIN subprocessor_notice_deliveries d ON d.subprocessor_id = s.id
        WHERE s.state = 'published' AND s.starts_at IS NOT NULL AND s.starts_at >= ?
        GROUP BY s.id
        ORDER BY s.starts_at DESC, s.id DESC
        LIMIT ?`,
    ).bind(leaseBefore, leaseBefore, `-${NOTICE_DAYS} days`, MAX_ATTEMPTS, since, NOTICE_SUMMARY_LIMIT).all<{
      uid: string; name: string; starts_at: string; change_uid: string | null; published_at: string | null; logged: number;
      sending: number; unknown: number; sent: number; late: number; resent: number; failed: number; exhausted: number; not_sent: number;
    }>()).results || [];
    return {
      available: true,
      mail_configured: mailReady(env),
      rows: rows.map((r) => {
        const n = (v: unknown) => Number(v) || 0;
        const started = String(r.starts_at) <= day;
        const dueBy = addDaysTo(String(r.starts_at).slice(0, 10), -NOTICE_DAYS);
        const owed = n(r.sending) + n(r.unknown) + n(r.failed) + n(r.not_sent);
        const stuck = n(r.unknown) > 0 || n(r.exhausted) > 0 || (owed > 0 && day > dueBy);
        const state: NoticeDelivery['state'] = owed === 0 ? 'delivered' : started ? 'missed' : stuck ? 'needs_attention' : 'in_progress';
        return {
          uid: r.uid,
          name: r.name,
          starts_at: r.starts_at,
          change_uid: r.change_uid ?? null,
          published_at: r.published_at ?? null,
          in_change_log: n(r.logged) > 0,
          notice_due_by: dueBy,
          started,
          sending: n(r.sending),
          unknown: n(r.unknown),
          sent: n(r.sent),
          late: n(r.late),
          resent_after_interruption: n(r.resent),
          failed: n(r.failed),
          exhausted: n(r.exhausted),
          not_sent: n(r.not_sent),
          state,
        };
      }),
    };
  } catch {
    return { available: false, reason: 'The notice deliveries could not be read on this database. This is not a claim that none were sent.' };
  }
}
