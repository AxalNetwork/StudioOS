/**
 * D810 (#2256) — newsletter lists: topics, double opt-in, signed links, and the
 * suppression list every sender checks.
 *
 * TOKENS. Two kinds, and neither is ever stored in the clear.
 *   - The CONFIRM token is 32 random bytes, sent once in the confirmation
 *     email. Only its SHA-256 is kept, with an expiry (48 h); confirming
 *     clears both, so it works once.
 *   - The PREFERENCES token, in every later email's preferences and
 *     unsubscribe links, is `<uid>.<version>.<hmac>`: an HMAC-SHA256 of the
 *     subscriber's uid and `token_version`, keyed by NEWSLETTER_TOKEN_KEY. It
 *     needs no row of its own and lasts until `token_version` is raised, which
 *     a fresh confirmation after an unsubscribe does, retiring every older link.
 *
 * THE IP is never stored: `ip_hash` is a SHA-256 of a salt (the token key) and
 * the address, enough to see one source signing up many addresses.
 *
 * SUPPRESSION (§4). One row per address and reason. An `unsubscribe` blocks
 * newsletter and marketing mail. A `bounce` or `complaint` blocks everything
 * but account security (sign-in links, email verification, password resets),
 * which the person asked for. An unreadable store blocks newsletter mail and
 * lets other mail through, as the marketing opt-out does (D189).
 */
import type { Env } from '../types';
import { constantTimeEqual, sha256Hex } from '../rpc/secret';

/** The topics a person can choose, as migration 515 seeds them. */
export const NEWSLETTER_TOPICS = Object.freeze([
  'brief', 'portfolio', 'founder_calls', 'events', 'insights', 'announcements', 'partner_letter', 'testing_calls',
] as const);
export type NewsletterTopic = typeof NEWSLETTER_TOPICS[number];

/** Topics only an investor or LP may hold; the website never offers them. */
export const INVESTOR_TOPICS: ReadonlySet<string> = new Set(['partner_letter']);

/** Roles that may hold the investor topics. */
export const INVESTOR_ROLES: ReadonlySet<string> = new Set(['investor', 'lp']);

/** The consent wording the signup shows, by version. A change of words is a new version. */
export const CONSENT_TEXT_VERSION = 'newsletter-2026-10-20';

/** How long a confirmation link lives. */
export const CONFIRM_TTL_MS = 48 * 60 * 60 * 1000;

/** The least time between two emails one signup can trigger to one address. */
export const EMAIL_PACE_MS = 10 * 60 * 1000;

/** What a send is, for the suppression list. */
export type MailClass = 'newsletter' | 'marketing' | 'transactional' | 'security';

export type SuppressionReason = 'unsubscribe' | 'bounce' | 'complaint';

/** Lowercased and trimmed, or null when it is not an address. */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  if (s.length < 5 || s.length > 254) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

/** The topics asked for, kept to the known public ones (and the investor ones when allowed), deduplicated. */
export function cleanTopics(input: unknown, opts: { investor?: boolean } = {}): string[] {
  const list = Array.isArray(input) ? input : [];
  const out: string[] = [];
  for (const t of list) {
    if (typeof t !== 'string') continue;
    if (!(NEWSLETTER_TOPICS as readonly string[]).includes(t)) continue;
    if (INVESTOR_TOPICS.has(t) && !opts.investor) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/** True in the production Worker. */
function isProduction(env: Env): boolean {
  const name = String(env.ENVIRONMENT || '').toLowerCase();
  return name === 'production' || name === 'prod';
}

/**
 * The HMAC key, or null. Production needs NEWSLETTER_TOKEN_KEY; dev and
 * preview fall back to JWT_SECRET so local work needs no extra secret.
 */
export function tokenKey(env: Env): string | null {
  if (env.NEWSLETTER_TOKEN_KEY) return env.NEWSLETTER_TOKEN_KEY;
  if (isProduction(env)) return null;
  return env.JWT_SECRET || null;
}

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

async function hmacHex(key: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(payload)));
}

/** A fresh confirm token (base64url, 32 random bytes) and the hash that is stored. */
export async function newConfirmToken(): Promise<{ token: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const token = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { token, hash: await sha256Hex(token) };
}

/** The stored hash of a confirm token. */
export function confirmTokenHash(token: string): Promise<string> {
  return sha256Hex(token);
}

/** The long-lived preferences token for a subscriber: `<uid>.<version>.<hmac>`. */
export async function preferencesToken(key: string, uid: string, version: number): Promise<string> {
  const payload = `${uid}.${version}`;
  return `${payload}.${await hmacHex(key, `newsletter:${payload}`)}`;
}

/** The uid and version a preferences token names when its signature holds, else null. */
export async function readPreferencesToken(key: string, token: unknown): Promise<{ uid: string; version: number } | null> {
  if (typeof token !== 'string' || token.length > 300) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [uid, v, sig] = parts;
  if (!/^[0-9a-f-]{8,64}$/i.test(uid) || !/^\d{1,9}$/.test(v) || !/^[0-9a-f]{64}$/.test(sig)) return null;
  const expected = await hmacHex(key, `newsletter:${uid}.${v}`);
  return constantTimeEqual(sig, expected) ? { uid, version: Number(v) } : null;
}

/** A salted SHA-256 of the client IP, or null without one. */
export async function newsletterIpHash(salt: string, ip: string | undefined | null): Promise<string | null> {
  if (!ip) return null;
  return sha256Hex(`newsletter-ip:${salt}:${ip}`);
}

/** Whether a reason blocks a class of mail (D810 §4). */
export function reasonBlocks(reason: string, mailClass: MailClass): boolean {
  if (reason === 'unsubscribe') return mailClass === 'newsletter' || mailClass === 'marketing';
  if (reason === 'bounce' || reason === 'complaint') return mailClass !== 'security';
  return false;
}

/**
 * True when the suppression list blocks this class of mail to this address.
 * Every sender asks before it sends. An unreadable store blocks newsletter
 * mail only; anything else goes, as the marketing opt-out fails open (D189).
 */
export async function isSuppressed(env: Env, to: string, mailClass: MailClass): Promise<boolean> {
  const email = normalizeEmail(String(to || '').replace(/^.*<([^>]+)>.*$/, '$1'));
  if (!email) return false;
  try {
    const rows = await env.DB.prepare('SELECT reason FROM email_suppressions WHERE email = ?').bind(email).all<{ reason: string }>();
    return (rows.results || []).some((r) => reasonBlocks(r.reason, mailClass));
  } catch {
    return mailClass === 'newsletter';
  }
}

/** Adds a suppression (idempotent per address and reason). */
export async function addSuppression(env: Env, email: string, reason: SuppressionReason, source: string): Promise<void> {
  await env.DB.prepare(
    'INSERT OR IGNORE INTO email_suppressions (email, reason, source) VALUES (?, ?, ?)',
  ).bind(email, reason, source).run();
}

/** A fresh consent lifts an earlier unsubscribe; a bounce or complaint stays. */
export async function liftUnsubscribe(env: Env, email: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM email_suppressions WHERE email = ? AND reason = 'unsubscribe'`).bind(email).run();
}

export type SubscriberRow = {
  id: number; uid: string; email: string; user_id: number | null; status: 'pending' | 'confirmed' | 'unsubscribed';
  confirm_token_hash: string | null; confirm_expires_at: string | null; token_version: number;
  last_email_at: string | null;
};

const SUBSCRIBER_COLS = 'id, uid, email, user_id, status, confirm_token_hash, confirm_expires_at, token_version, last_email_at';

export function subscriberByEmail(env: Env, email: string): Promise<SubscriberRow | null> {
  return env.DB.prepare(`SELECT ${SUBSCRIBER_COLS} FROM newsletter_subscribers WHERE email = ?`).bind(email).first<SubscriberRow>();
}

export function subscriberByUid(env: Env, uid: string): Promise<SubscriberRow | null> {
  return env.DB.prepare(`SELECT ${SUBSCRIBER_COLS} FROM newsletter_subscribers WHERE uid = ?`).bind(uid).first<SubscriberRow>();
}

/** The subscriber's topics, as `{ topic: on }` for every known topic it may hold. */
export async function topicsOf(env: Env, subscriberId: number | null, opts: { investor?: boolean } = {}): Promise<Record<string, boolean>> {
  const on = new Set<string>();
  if (subscriberId != null) {
    const rows = await env.DB.prepare(
      'SELECT topic FROM newsletter_subscriber_topics WHERE subscriber_id = ? AND enabled = 1',
    ).bind(subscriberId).all<{ topic: string }>();
    for (const r of rows.results || []) on.add(r.topic);
  }
  const out: Record<string, boolean> = {};
  for (const t of NEWSLETTER_TOPICS) {
    if (INVESTOR_TOPICS.has(t) && !opts.investor && !on.has(t)) continue;
    out[t] = on.has(t);
  }
  return out;
}

/** Sets each named topic on or off; topics not named are left as they are. */
export async function setTopics(env: Env, subscriberId: number, choices: Record<string, boolean>): Promise<void> {
  const stmts = Object.entries(choices).map(([topic, enabled]) => env.DB.prepare(
    `INSERT INTO newsletter_subscriber_topics (subscriber_id, topic, enabled, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(subscriber_id, topic) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
  ).bind(subscriberId, topic, enabled ? 1 : 0));
  if (stmts.length) await env.DB.batch(stmts);
}

/** True when an email to this subscriber went out less than EMAIL_PACE_MS ago. */
export function tooSoon(row: Pick<SubscriberRow, 'last_email_at'> | null, now = Date.now()): boolean {
  if (!row?.last_email_at) return false;
  const at = Date.parse(row.last_email_at.includes('T') ? row.last_email_at : `${row.last_email_at.replace(' ', 'T')}Z`);
  return Number.isFinite(at) && now - at < EMAIL_PACE_MS;
}

/** A fresh subscriber uid, the shape migration 515's backfill writes. */
export function newSubscriberUid(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** May this member hold the investor topics? */
export function isInvestorMember(user: { role?: string | null }): boolean {
  return INVESTOR_ROLES.has(String(user.role || ''));
}

/** A member's subscriber row: theirs by user_id, else the one on their account email. */
export async function memberSubscriber(env: Env, user: { id: number; email: string }): Promise<SubscriberRow | null> {
  const byUser = await env.DB.prepare(`SELECT ${SUBSCRIBER_COLS} FROM newsletter_subscribers WHERE user_id = ?`).bind(user.id).first<SubscriberRow>();
  if (byUser) return byUser;
  const email = normalizeEmail(user.email);
  return email ? subscriberByEmail(env, email) : null;
}

/**
 * Turns the subscriber's mail back on with a fresh consent: confirmed, no
 * confirm token, the consent recorded, and any `unsubscribe` suppression
 * lifted. A row that was unsubscribed (`unsubscribed_at` set, which a fresh
 * signup leaves in place while the row is pending again) has its
 * `token_version` raised, so links sent before the unsubscribe stop working.
 */
export async function markConfirmed(env: Env, row: SubscriberRow, extra: { userId?: number | null; ipHash?: string | null } = {}): Promise<void> {
  await env.DB.prepare(
    `UPDATE newsletter_subscribers
        SET status = 'confirmed', confirm_token_hash = NULL, confirm_expires_at = NULL,
            consent_text_version = ?, consented_at = datetime('now'),
            confirmed_at = datetime('now'),
            token_version = token_version + (CASE WHEN unsubscribed_at IS NOT NULL THEN 1 ELSE 0 END),
            unsubscribed_at = NULL,
            user_id = COALESCE(user_id, ?), ip_hash = COALESCE(?, ip_hash)
      WHERE id = ?`,
  ).bind(CONSENT_TEXT_VERSION, extra.userId ?? null, extra.ipHash ?? null, row.id).run();
  await liftUnsubscribe(env, row.email);
}

/**
 * Saves a signed-in member's choices on their account email. A member is
 * signed in with a verified address, so no confirmation email is needed: the
 * row is `account`-sourced and confirmed the first time a topic is turned on.
 * Returns the row as it now stands.
 */
export async function saveMemberTopics(
  env: Env, user: { id: number; email: string }, choices: Record<string, boolean>,
): Promise<SubscriberRow | null> {
  const email = normalizeEmail(user.email);
  if (!email) return null;
  let row = await memberSubscriber(env, user);
  const turningOn = Object.values(choices).some(Boolean);
  if (!row) {
    if (!turningOn) return null;
    await env.DB.prepare(
      `INSERT INTO newsletter_subscribers (uid, email, user_id, status, source, consent_text_version, consented_at, confirmed_at)
       VALUES (?, ?, ?, 'confirmed', 'account', ?, datetime('now'), datetime('now'))`,
    ).bind(newSubscriberUid(), email, user.id, CONSENT_TEXT_VERSION).run();
    await liftUnsubscribe(env, email);
  } else {
    if (row.user_id == null) {
      await env.DB.prepare('UPDATE newsletter_subscribers SET user_id = ? WHERE id = ?').bind(user.id, row.id).run();
    }
    if (turningOn && row.status !== 'confirmed') await markConfirmed(env, row, { userId: user.id });
  }
  row = await memberSubscriber(env, user);
  if (row) await setTopics(env, row.id, choices);
  return row;
}
