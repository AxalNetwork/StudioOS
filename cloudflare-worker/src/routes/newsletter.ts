/**
 * D810 (#2256) — newsletter lists: the website's signup with double opt-in,
 * the preferences and unsubscribe links every email carries, and a signed-in
 * member's own choices.
 *
 * PUBLIC (no sign-in). Subscribe, confirm and preferences are rate-limited
 * per IP by the `newsletter_public` bucket (middleware/rateLimit.ts, fails
 * closed), and signup mail per address by `last_email_at`: one
 * signup-triggered email per address every ten minutes, silently. Unsubscribe
 * is NOT in the bucket: RFC 8058 one-click POSTs come from the mailbox
 * provider's own servers, many people's from a few addresses, and a capped
 * unsubscribe is an unsubscribe lost. Its HMAC token cannot be guessed.
 *
 *   POST /api/newsletter/subscribe { email, topics[], turnstileToken, hp }
 *     Turnstile, then a `pending` row with a fresh single-use confirm token and
 *     the Confirm subscription email. An address already confirmed gets a
 *     "manage your topics" email instead and nothing changes. The answer is the
 *     same for a new, pending, confirmed, paced or bounced address, so nobody
 *     can learn who is subscribed.
 *   GET  /api/newsletter/confirm?token=
 *     CHANGES NOTHING (S1's review): mail scanners such as Safe Links open
 *     every link in a message, so a GET that confirmed would confirm signups
 *     nobody made, and double opt-in would mean nothing. A browser gets a page
 *     with one button that POSTs; an API client gets `{ ok, status: 'pending' }`.
 *   POST /api/newsletter/confirm?token=
 *     Confirms the row, records the consent, lifts an earlier unsubscribe and
 *     sends Welcome. CSRF-exempt like the unsubscribe: the single-use token is
 *     the authorisation, and the Worker's own page posts it.
 *   Either: a used or unknown token is 410 `token_invalid`; an expired one is
 *   410 `token_expired`. A browser gets a short page, an API client JSON.
 *   GET  /api/newsletter/preferences?token=     the topics, by signed token
 *   PUT  /api/newsletter/preferences?token= { topics: { key: bool } }
 *     Saves them and sends Preferences saved (paced).
 *   GET  /api/newsletter/unsubscribe?token=&topic=
 *     Changes nothing: a browser gets a page with one button that POSTs.
 *   POST /api/newsletter/unsubscribe?token=&topic=
 *     One topic, or every topic when `topic` is absent: then the row is
 *     `unsubscribed` and the address gets an `unsubscribe` suppression. Sends
 *     Unsubscribed (paced). This is also the RFC 8058 one-click target of the
 *     `List-Unsubscribe` header, so it is CSRF-exempt (middleware/csrf.ts):
 *     the signed token is the authorisation.
 *
 *   Every public route answers 503 `newsletter_unconfigured` in production
 *   until NEWSLETTER_TOKEN_KEY is set (PRODUCTION.md §4).
 *
 * MEMBERS (signed in).
 *   GET  /api/me/newsletters                    the member's topics
 *   PUT  /api/me/newsletters { topics: { key: bool } }
 *     Tied to the account email. `partner_letter` only for investors and LPs
 *     (403 `topic_not_allowed` otherwise). The `insights` topic is mirrored
 *     into `insight_subscriptions`, whose routes keep answering (D813).
 *
 * The four emails are placeholders until the owner's design is exported
 * (templates/email/newsletter/).
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import { verifyTurnstile } from '../services/turnstile';
import { sendRawEmail } from '../services/email/gmail';
import { escapeHtml } from '../services/email';
import { stripTrailingSlashes } from '../util/url';
import {
  CONFIRM_TTL_MS, INVESTOR_TOPICS, NEWSLETTER_TOPICS, cleanTopics, confirmTokenHash, isInvestorMember,
  isSuppressed, markConfirmed, memberSubscriber, newConfirmToken, newSubscriberUid, newsletterIpHash,
  normalizeEmail, preferencesToken, readPreferencesToken, saveMemberTopics, setTopics, subscriberByEmail,
  subscriberByUid, tokenKey, tooSoon, topicsOf, addSuppression, type SubscriberRow,
} from '../services/newsletter';
import * as mail from '../templates/email/newsletter';

const newsletter = new Hono<{ Bindings: Env }>();

const FROM = 'Axal VC <noreply@axal.vc>';
const REPLY_TO = 'support@axal.vc';

/** The answer a signup always gets, whatever the address's state. */
const SIGNUP_ANSWER = { ok: true, message: 'Check your inbox: we have sent you an email to confirm.' };

function baseUrl(env: Env): string {
  return stripTrailingSlashes(String(env.PUBLIC_BASE_URL || env.APP_URL || 'https://axal.vc'));
}

function unconfigured(c: Context<{ Bindings: Env }>) {
  return c.json({ error: 'newsletter_unconfigured', code: 'newsletter_unconfigured', message: 'Newsletter signups are not open yet.' }, 503);
}

function badToken(c: Context<{ Bindings: Env }>) {
  return c.json({ error: 'token_invalid', code: 'token_invalid', message: 'This link is not valid any more. Use the link in your latest email.' }, 403);
}

/** The links a subscriber's emails carry, signed with their current version. */
async function linksFor(env: Env, key: string, row: Pick<SubscriberRow, 'uid' | 'token_version'>) {
  const token = encodeURIComponent(await preferencesToken(key, row.uid, row.token_version));
  const base = baseUrl(env);
  return {
    // D813 builds this page; the API under it answers today.
    preferences_url: `${base}/newsletter/preferences?token=${token}`,
    unsubscribe_url: `${base}/api/newsletter/unsubscribe?token=${token}`,
  };
}

function topicLabels(keys: string[]): string[] {
  return keys.map((k) => LABELS[k] || k);
}

const LABELS: Record<string, string> = {
  brief: 'The Axal VC Brief', portfolio: 'Portfolio news', founder_calls: 'Founder calls', events: 'Events',
  insights: 'Insights', announcements: 'Announcements', partner_letter: 'Partner letter', testing_calls: 'Testing calls',
};

/** Sends one of the four emails and stamps `last_email_at`. False when nothing went. */
async function deliver(env: Env, row: Pick<SubscriberRow, 'id' | 'email'>, m: mail.NewsletterEmail, unsubscribeUrl?: string): Promise<boolean> {
  const e = env as any;
  if (!e.GMAIL_CLIENT_ID || !e.GMAIL_CLIENT_SECRET || !e.GMAIL_REFRESH_TOKEN) {
    console.warn(`newsletter: no mail credentials; subscriber ${row.id} not emailed`);
    return false;
  }
  const ok = await sendRawEmail(env, {
    to: row.email, subject: m.subject, text: m.text, html: m.html, from: FROM, replyTo: REPLY_TO,
    // A reply to the person's own action, so an unsubscribe does not stop it;
    // a bounce or complaint does.
    mailClass: 'transactional',
    extraHeaders: unsubscribeUrl
      ? { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
      : undefined,
  });
  await env.DB.prepare(`UPDATE newsletter_subscribers SET last_email_at = datetime('now') WHERE id = ?`).bind(row.id).run();
  return ok;
}

async function enabledTopics(env: Env, row: SubscriberRow): Promise<string[]> {
  const t = await topicsOf(env, row.id, { investor: true });
  return Object.keys(t).filter((k) => t[k]);
}

/** May the subscriber behind this row hold the investor topics? */
async function rowIsInvestor(env: Env, row: SubscriberRow): Promise<boolean> {
  if (row.user_id == null) return false;
  const u = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(row.user_id).first<{ role: string }>();
  return !!u && isInvestorMember(u);
}

/** The subscriber a preferences token names, when it is signed and current. */
async function rowFromToken(env: Env, key: string, token: unknown): Promise<SubscriberRow | null> {
  const t = await readPreferencesToken(key, token);
  if (!t) return null;
  const row = await subscriberByUid(env, t.uid);
  return row && row.token_version === t.version ? row : null;
}

/** `{ key: bool }` from a body's `topics`: an object of booleans, or a list of the keys to turn on. */
function choicesOf(input: unknown): Record<string, boolean> | null {
  if (Array.isArray(input)) {
    const out: Record<string, boolean> = {};
    for (const t of NEWSLETTER_TOPICS) out[t] = input.includes(t);
    return out;
  }
  if (!input || typeof input !== 'object') return null;
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!(NEWSLETTER_TOPICS as readonly string[]).includes(k)) continue;
    out[k] = v === true;
  }
  return out;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

function wantsHtml(c: Context<{ Bindings: Env }>): boolean {
  const accept = c.req.header('Accept') || '';
  return accept.includes('text/html') && !accept.includes('application/json');
}

function page(c: Context<{ Bindings: Env }>, status: number, title: string, body: string) {
  return c.html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)} · Axal VC</title></head>`
    + `<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:64px auto;padding:0 16px;color:#111827;line-height:1.6">`
    + `<h1 style="font-size:20px">${escapeHtml(title)}</h1>${body}</body></html>`,
    status as any,
  );
}

newsletter.post('/newsletter/subscribe', async (c) => {
  try {
    const key = tokenKey(c.env);
    if (!key) return unconfigured(c);
    let body: Record<string, unknown> = {};
    try { body = await c.req.json<Record<string, unknown>>(); } catch { return c.json({ error: 'invalid_json' }, 400); }

    // Honeypot: the same answer, nothing done.
    if (typeof body.hp === 'string' && body.hp.trim()) return c.json(SIGNUP_ANSWER);

    const email = normalizeEmail(body.email);
    if (!email) return c.json({ error: 'invalid_email', code: 'invalid_email', message: 'Enter a valid email address.' }, 400);
    const topics = cleanTopics(body.topics);

    const ip = c.req.header('CF-Connecting-IP') || undefined;
    const token = typeof body.turnstileToken === 'string' ? body.turnstileToken.slice(0, 4096) : '';
    if (!(await verifyTurnstile(c.env, token, ip))) {
      return c.json({ error: 'turnstile_failed', code: 'turnstile_failed' }, 403);
    }

    // A bounced or complained address gets nothing, and the same answer.
    if (await isSuppressed(c.env, email, 'transactional')) return c.json(SIGNUP_ANSWER);

    let row = await subscriberByEmail(c.env, email);
    if (row && tooSoon(row)) return c.json(SIGNUP_ANSWER);

    if (row?.status === 'confirmed') {
      // No new consent from an unverified request: a way to manage, nothing more.
      const links = await linksFor(c.env, key, row);
      await deliver(c.env, row, mail.manageExisting({ preferences_url: links.preferences_url }));
      return c.json(SIGNUP_ANSWER);
    }

    const ipHash = await newsletterIpHash(key, ip);
    const confirm = await newConfirmToken();
    const expires = new Date(Date.now() + CONFIRM_TTL_MS).toISOString();
    if (row) {
      await c.env.DB.prepare(
        `UPDATE newsletter_subscribers SET status = 'pending', confirm_token_hash = ?, confirm_expires_at = ?, ip_hash = ? WHERE id = ?`,
      ).bind(confirm.hash, expires, ipHash, row.id).run();
    } else {
      await c.env.DB.prepare(
        `INSERT INTO newsletter_subscribers (uid, email, status, confirm_token_hash, confirm_expires_at, source, ip_hash)
         VALUES (?, ?, 'pending', ?, ?, 'website', ?)`,
      ).bind(newSubscriberUid(), email, confirm.hash, expires, ipHash).run();
    }
    row = (await subscriberByEmail(c.env, email))!;
    // The choice waits on the row until it is confirmed; nothing is sent to a pending row.
    const choices: Record<string, boolean> = {};
    for (const t of NEWSLETTER_TOPICS) if (!INVESTOR_TOPICS.has(t)) choices[t] = topics.includes(t);
    await setTopics(c.env, row.id, choices);

    const confirmUrl = `${baseUrl(c.env)}/api/newsletter/confirm?token=${encodeURIComponent(confirm.token)}`;
    await deliver(c.env, row, mail.confirmSubscription({ confirm_url: confirmUrl, topics: topicLabels(topics) }));
    return c.json(SIGNUP_ANSWER);
  } catch (e) { return mapError(c, e); }
});

/**
 * The row a confirm token names while it is still usable, or the refusal to
 * send. Shared by the GET, which only reads, and the POST, which confirms.
 */
async function confirmRow(c: Context<{ Bindings: Env }>, token: string): Promise<SubscriberRow | Response> {
  const html = wantsHtml(c);
  const row = token.length >= 20 && token.length <= 200
    ? await c.env.DB.prepare(
      `SELECT id, uid, email, user_id, status, confirm_token_hash, confirm_expires_at, token_version, last_email_at
         FROM newsletter_subscribers WHERE confirm_token_hash = ?`,
    ).bind(await confirmTokenHash(token)).first<SubscriberRow>()
    : null;
  if (!row) {
    const message = 'This confirmation link has already been used or is not valid.';
    return html ? page(c, 410, 'Link not valid', `<p>${message}</p>`) : c.json({ error: 'token_invalid', code: 'token_invalid', message }, 410);
  }
  if (!row.confirm_expires_at || Date.parse(row.confirm_expires_at) < Date.now()) {
    const message = 'This confirmation link has expired. Sign up again to get a new one.';
    return html ? page(c, 410, 'Link expired', `<p>${message}</p>`) : c.json({ error: 'token_expired', code: 'token_expired', message }, 410);
  }
  return row;
}

newsletter.get('/newsletter/confirm', async (c) => {
  try {
    const key = tokenKey(c.env);
    if (!key) return unconfigured(c);
    const token = c.req.query('token') || '';
    const row = await confirmRow(c, token);
    if (row instanceof Response) return row;
    if (!wantsHtml(c)) return c.json({ ok: true, status: 'pending' });
    const action = `/api/newsletter/confirm?token=${encodeURIComponent(token)}`;
    return page(c, 200, 'Confirm your subscription', '<p>Press the button to confirm your subscription to Axal VC.</p>'
      + `<form method="post" action="${escapeHtml(action)}"><button type="submit" style="font:inherit;padding:10px 18px;border-radius:8px;border:1px solid #111827;background:#111827;color:#fff;cursor:pointer">Confirm subscription</button></form>`);
  } catch (e) { return mapError(c, e); }
});

newsletter.post('/newsletter/confirm', async (c) => {
  try {
    const key = tokenKey(c.env);
    if (!key) return unconfigured(c);
    const html = wantsHtml(c);
    const row = await confirmRow(c, c.req.query('token') || '');
    if (row instanceof Response) return row;
    // Single use: only the request that clears the hash goes on.
    const claimed = await c.env.DB.prepare(
      'UPDATE newsletter_subscribers SET confirm_token_hash = NULL WHERE id = ? AND confirm_token_hash = ?',
    ).bind(row.id, row.confirm_token_hash).run();
    if (!Number((claimed as any)?.meta?.changes ?? 1)) return badToken(c);

    const member = await c.env.DB.prepare('SELECT id FROM users WHERE lower(trim(email)) = ?').bind(row.email).first<{ id: number }>();
    const ipHash = await newsletterIpHash(key, c.req.header('CF-Connecting-IP'));
    await markConfirmed(c.env, row, { userId: member?.id ?? null, ipHash });

    const fresh = (await subscriberByUid(c.env, row.uid))!;
    const links = await linksFor(c.env, key, fresh);
    const topics = topicLabels(await enabledTopics(c.env, fresh));
    await deliver(c.env, fresh, mail.welcome({ topics, ...links }), links.unsubscribe_url);
    return html
      ? page(c, 200, 'Subscription confirmed', '<p>Thank you. Your subscription to Axal VC is confirmed, and a welcome email is on its way.</p>')
      : c.json({ ok: true, status: 'confirmed' });
  } catch (e) { return mapError(c, e); }
});

async function preferencesPayload(env: Env, row: SubscriberRow) {
  const investor = await rowIsInvestor(env, row);
  return {
    email: maskEmail(row.email),
    status: row.status,
    topics: await topicsOf(env, row.id, { investor }),
  };
}

newsletter.get('/newsletter/preferences', async (c) => {
  try {
    const key = tokenKey(c.env);
    if (!key) return unconfigured(c);
    const row = await rowFromToken(c.env, key, c.req.query('token'));
    if (!row) return badToken(c);
    return c.json(await preferencesPayload(c.env, row));
  } catch (e) { return mapError(c, e); }
});

newsletter.put('/newsletter/preferences', async (c) => {
  try {
    const key = tokenKey(c.env);
    if (!key) return unconfigured(c);
    const row = await rowFromToken(c.env, key, c.req.query('token'));
    if (!row) return badToken(c);
    let body: Record<string, unknown> = {};
    try { body = await c.req.json<Record<string, unknown>>(); } catch { return c.json({ error: 'invalid_json' }, 400); }
    const choices = choicesOf(body.topics);
    if (!choices) return c.json({ error: 'invalid_topics', code: 'invalid_topics', message: 'Send topics as { key: true | false }.' }, 400);
    const investor = await rowIsInvestor(c.env, row);
    for (const t of Object.keys(choices)) {
      if (INVESTOR_TOPICS.has(t) && !investor) delete choices[t];
    }
    // Turning a topic on from the mailbox's own link is a fresh consent.
    if (Object.values(choices).some(Boolean) && row.status !== 'confirmed') await markConfirmed(c.env, row);
    await setTopics(c.env, row.id, choices);

    const fresh = (await subscriberByUid(c.env, row.uid))!;
    if (!tooSoon(row)) {
      const links = await linksFor(c.env, key, fresh);
      const topics = topicLabels(await enabledTopics(c.env, fresh));
      await deliver(c.env, fresh, mail.preferencesSaved({ topics, preferences_url: links.preferences_url }), links.unsubscribe_url);
    }
    return c.json({ ok: true, ...(await preferencesPayload(c.env, fresh)) });
  } catch (e) { return mapError(c, e); }
});

function topicParam(c: Context<{ Bindings: Env }>): string | null | undefined {
  const t = c.req.query('topic');
  if (!t) return null;
  return (NEWSLETTER_TOPICS as readonly string[]).includes(t) ? t : undefined;
}

newsletter.get('/newsletter/unsubscribe', async (c) => {
  try {
    const key = tokenKey(c.env);
    if (!key) return unconfigured(c);
    const row = await rowFromToken(c.env, key, c.req.query('token'));
    const topic = topicParam(c);
    if (!row || topic === undefined) {
      return wantsHtml(c) ? page(c, 403, 'Link not valid', '<p>This link is not valid any more. Use the link in your latest email.</p>') : badToken(c);
    }
    if (!wantsHtml(c)) return c.json({ ok: true, topic, status: row.status });
    const what = topic ? escapeHtml(LABELS[topic] || topic) : 'every Axal VC newsletter';
    const action = `/api/newsletter/unsubscribe?token=${encodeURIComponent(c.req.query('token') || '')}${topic ? `&topic=${encodeURIComponent(topic)}` : ''}`;
    return page(c, 200, 'Unsubscribe', `<p>Stop receiving ${what}?</p>`
      + `<form method="post" action="${escapeHtml(action)}"><button type="submit" style="font:inherit;padding:10px 18px;border-radius:8px;border:1px solid #111827;background:#111827;color:#fff;cursor:pointer">Unsubscribe</button></form>`);
  } catch (e) { return mapError(c, e); }
});

newsletter.post('/newsletter/unsubscribe', async (c) => {
  try {
    const key = tokenKey(c.env);
    if (!key) return unconfigured(c);
    const row = await rowFromToken(c.env, key, c.req.query('token'));
    if (!row) return badToken(c);
    const topic = topicParam(c);
    if (topic === undefined) return c.json({ error: 'invalid_topic', code: 'invalid_topic' }, 400);

    if (topic) {
      await setTopics(c.env, row.id, { [topic]: false });
    } else {
      const off: Record<string, boolean> = {};
      for (const t of NEWSLETTER_TOPICS) off[t] = false;
      await setTopics(c.env, row.id, off);
      await c.env.DB.prepare(
        `UPDATE newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = datetime('now'),
                confirm_token_hash = NULL, confirm_expires_at = NULL WHERE id = ?`,
      ).bind(row.id).run();
      await addSuppression(c.env, row.email, 'unsubscribe', 'newsletter');
    }
    if (row.user_id != null && (!topic || topic === 'insights')) await mirrorInsights(c.env, row.user_id, false);

    if (!tooSoon(row)) {
      const links = await linksFor(c.env, key, row);
      await deliver(c.env, row, mail.unsubscribed({ topic_label: topic ? (LABELS[topic] || topic) : null, preferences_url: links.preferences_url }));
    }
    if (wantsHtml(c)) {
      return page(c, 200, 'Unsubscribed', topic
        ? `<p>You will no longer receive ${escapeHtml(LABELS[topic] || topic)} from Axal VC.</p>`
        : '<p>You will no longer receive newsletters from Axal VC.</p>');
    }
    return c.json({ ok: true, topic, status: topic ? row.status : 'unsubscribed' });
  } catch (e) { return mapError(c, e); }
});

/** Keeps the old weekly-insights toggle in step with the `insights` topic (D813 retires it). */
export async function mirrorInsights(env: Env, userId: number, on: boolean): Promise<void> {
  try {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO insight_subscriptions (user_id, is_subscribed, cadence, created_at, updated_at)
       VALUES (?, ?, 'weekly', ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET is_subscribed = excluded.is_subscribed, updated_at = excluded.updated_at`,
    ).bind(userId, on ? 1 : 0, now, now).run();
  } catch (e) {
    console.warn('newsletter: could not mirror the insights toggle', (e as Error)?.message || 'unknown');
  }
}

async function memberPayload(env: Env, user: { id: number; email: string; role?: string | null }) {
  const investor = isInvestorMember(user);
  const row = await memberSubscriber(env, user);
  const on = await topicsOf(env, row?.id ?? null, { investor });
  const rows = await env.DB.prepare(
    'SELECT key, label, description, audience FROM newsletter_topics ORDER BY sort_order',
  ).all<{ key: string; label: string; description: string; audience: string }>();
  return {
    email: user.email,
    status: row?.status ?? 'none',
    topics: (rows.results || []).filter((t) => t.key in on).map((t) => ({ ...t, enabled: on[t.key] })),
  };
}

newsletter.get('/me/newsletters', async (c) => {
  try {
    const user = await requireAuth(c);
    return c.json(await memberPayload(c.env, user));
  } catch (e) { return mapError(c, e); }
});

newsletter.put('/me/newsletters', async (c) => {
  try {
    const user = await requireAuth(c);
    let body: Record<string, unknown> = {};
    try { body = await c.req.json<Record<string, unknown>>(); } catch { return c.json({ error: 'invalid_json' }, 400); }
    const choices = choicesOf(body.topics);
    if (!choices) return c.json({ error: 'invalid_topics', code: 'invalid_topics', message: 'Send topics as { key: true | false }.' }, 400);
    if (!isInvestorMember(user)) {
      if (Object.keys(choices).some((t) => INVESTOR_TOPICS.has(t) && choices[t])) {
        return c.json({ error: 'topic_not_allowed', code: 'topic_not_allowed', message: 'The partner letter is for investors and LPs.' }, 403);
      }
      for (const t of INVESTOR_TOPICS) delete choices[t];
    }
    await saveMemberTopics(c.env, user, choices);
    if ('insights' in choices) await mirrorInsights(c.env, user.id, choices.insights);
    return c.json({ ok: true, ...(await memberPayload(c.env, user)) });
  } catch (e) { return mapError(c, e); }
});

export default newsletter;
