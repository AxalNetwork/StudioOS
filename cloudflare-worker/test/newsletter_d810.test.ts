/**
 * D810 (#2256) — newsletter lists: the public signup with double opt-in, the
 * signed preferences and unsubscribe links, one-click unsubscribe, the
 * suppression list every sender checks, a member's own topics, and the fold of
 * the weekly insights toggle into the `insights` topic.
 *
 * The real routers (`routes/newsletter.ts`, `routes/insights.ts`) over HTTP,
 * against node:sqlite holding `users` and `insight_subscriptions` from the
 * baseline plus migration 515 itself. `fetch` is a recorder that plays Gmail,
 * so every email the routes send is decoded and read back. Members sign in
 * with a real JWT. The rate limit is the real `rateLimitMiddleware` over an
 * in-memory KV, then a KV that throws.
 *
 * Run with the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/newsletter_d810.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import newsletterRoutes from '../src/routes/newsletter.ts';
import insightsRoutes from '../src/routes/insights.ts';
import { rateLimitMiddleware, NEWSLETTER_PUBLIC } from '../src/middleware/rateLimit.ts';
import { csrfMiddleware } from '../src/middleware/csrf.ts';
import { isSuppressed, preferencesToken, reasonBlocks, tokenKey } from '../src/services/newsletter.ts';
import { sendNotificationEmail, sendVerificationEmail } from '../src/services/email.ts';
import { mailClassOf, send } from '../src/services/email/send.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const M515 = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/migrations/515_newsletter_lists.sql'), 'utf8');

const JWT_SECRET = 'unit-test-jwt-secret-d810-0123456789-abcdef';
const KEY = 'unit-test-newsletter-key-d810';
const IP = '198.51.100.42';
const BASE = 'https://axal.vc';

type Mail = { to: string; subject: string; text: string; headers: string };

function freshDb(seed = '') {
  const db = new DatabaseSync(':memory:');
  db.exec(stripForeignKeys(tableFromBaseline(BASELINE, 'users')));
  db.exec(stripForeignKeys(tableFromBaseline(BASELINE, 'insight_subscriptions')));
  db.exec(`INSERT INTO users (id, email, name, role, is_active, email_verified) VALUES
    (1, 'founder@example.test', 'Fay Founder', 'founder', 1, 1),
    (2, 'Ivy.Investor@example.test', 'Ivy Investor', 'investor', 1, 1),
    (3, 'olly@example.test', 'Olly Old', 'investor', 1, 1);
    INSERT INTO insight_subscriptions (user_id, is_subscribed) VALUES (3, 1);`);
  if (seed) db.exec(seed);
  db.exec(M515);
  return db;
}

/** An RFC 2047 `=?UTF-8?B?…?=` header value, decoded. */
function decodeWord(v: string): string {
  const m = /^=\?UTF-8\?B\?(.*)\?=$/i.exec(v.trim());
  return m ? new TextDecoder().decode(Uint8Array.from(atob(m[1]), (ch) => ch.charCodeAt(0))) : v;
}

/** Reads an email the Gmail stub received: the headers and the decoded text part. */
function decodeMail(body: string): Mail {
  const raw = JSON.parse(body).raw as string;
  const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
  const mime = decodeURIComponent(escape(atob(b64)));
  const headers = mime.split('\r\n\r\n')[0];
  const textPart = /Content-Type: text\/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n\r\n/.exec(mime)?.[1] || '';
  const text = new TextDecoder().decode(Uint8Array.from(atob(textPart.replace(/\r\n/g, '')), (ch) => ch.charCodeAt(0)));
  return {
    to: /^To: (.*)$/m.exec(headers)?.[1] || '',
    subject: decodeWord(/^Subject: (.*)$/m.exec(headers)?.[1] || ''),
    text,
    headers,
  };
}

function harness(db = freshDb(), envExtra: Record<string, unknown> = {}) {
  const app = new Hono<any>();
  app.route('/api', newsletterRoutes);
  app.route('/api/insights', insightsRoutes);
  const env: Record<string, unknown> = {
    ENVIRONMENT: 'development', JWT_SECRET, NEWSLETTER_TOKEN_KEY: KEY, APP_URL: BASE,
    GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'refresh',
    DB: d1Over(db), ...envExtra,
  };
  const mails: Mail[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    const url = String(input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
    if (url.startsWith('https://gmail.googleapis.com/')) {
      mails.push(decodeMail(String(init?.body)));
      return new Response('{}', { status: 200 });
    }
    return new Response('unexpected', { status: 599 });
  }) as unknown as typeof fetch;
  const req = (path: string, init: RequestInit = {}) => app.request(path, {
    ...init, headers: { 'CF-Connecting-IP': IP, ...(init.headers as Record<string, string> || {}) },
  }, env);
  const json = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => req(path, {
    method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { app, db, env, mails, req, json, restore: () => { globalThis.fetch = realFetch; } };
}

async function bearer(userId: number, role: string) {
  const t = await new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  return { Authorization: `Bearer ${t}` };
}

function linkIn(text: string, path: string): string {
  const m = new RegExp(`${BASE.replace(/\./g, '\\.')}${path.replace(/\//g, '\\/')}\\?token=([^\\s&]+)`).exec(text);
  assert.ok(m, `no ${path} link in:\n${text}`);
  return decodeURIComponent(m[1]);
}

/** Lets the next signup email go: the per-address pacing reads `last_email_at`. */
function unpace(db: InstanceType<typeof DatabaseSync>) {
  db.exec(`UPDATE newsletter_subscribers SET last_email_at = datetime('now', '-1 hour')`);
}

async function subscribeAndConfirm(h: ReturnType<typeof harness>, email: string, topics: string[]) {
  const res = await h.json('POST', '/api/newsletter/subscribe', { email, topics });
  assert.equal(res.status, 200);
  const confirm = linkIn(h.mails.at(-1)!.text, '/api/newsletter/confirm');
  const ok = await h.req(`/api/newsletter/confirm?token=${encodeURIComponent(confirm)}`, { headers: { Accept: 'application/json' } });
  assert.equal(ok.status, 200);
  return { confirm, prefs: linkIn(h.mails.at(-1)!.text, '/newsletter/preferences') };
}

test('subscribe answers identically for a new, a pending and a confirmed address', async () => {
  const h = harness();
  try {
    const answers: string[] = [];
    const ask = async (email: string) => {
      const res = await h.json('POST', '/api/newsletter/subscribe', { email, topics: ['brief', 'events', 'partner_letter', 'nope'] });
      answers.push(`${res.status} ${await res.text()}`);
    };
    await ask('new@example.test');                       // new
    assert.match(h.mails.at(-1)!.subject, /Confirm your subscription/);
    unpace(h.db);
    await ask('New@Example.test');                        // pending, same address in other case
    assert.equal(h.mails.length, 2, 'a pending address gets a fresh confirmation');
    const { prefs } = await subscribeAndConfirm(h, 'done@example.test', ['brief']);
    assert.ok(prefs);
    unpace(h.db);
    const before = h.mails.length;
    await ask('done@example.test');                       // confirmed
    assert.equal(h.mails.length, before + 1);
    assert.match(h.mails.at(-1)!.subject, /Your Axal VC subscription/, 'a confirmed address gets the manage email');
    assert.doesNotMatch(h.mails.at(-1)!.text, /confirm\?token=/, 'and no new confirmation');
    await ask('done@example.test');                       // paced: silent, same answer
    assert.equal(h.mails.length, before + 1, 'a second signup within ten minutes sends nothing');

    assert.equal(new Set(answers).size, 1, `answers differ:\n${answers.join('\n')}`);
    // One row per address, lowercased; the topics kept are the known public ones.
    const rows = h.db.prepare(`SELECT email, status FROM newsletter_subscribers WHERE source = 'website' ORDER BY id`).all() as any[];
    assert.deepEqual(rows.map((r) => r.email), ['new@example.test', 'done@example.test']);
    const topics = h.db.prepare(`SELECT topic FROM newsletter_subscriber_topics t JOIN newsletter_subscribers s ON s.id = t.subscriber_id
      WHERE s.email = 'new@example.test' AND enabled = 1 ORDER BY topic`).all() as any[];
    assert.deepEqual(topics.map((t) => t.topic), ['brief', 'events'], 'the investor topic and unknown keys are dropped');
  } finally { h.restore(); }
});

test('a confirm token works once and expires', async () => {
  const h = harness();
  try {
    const { confirm } = await subscribeAndConfirm(h, 'once@example.test', ['brief']);
    const row = h.db.prepare(`SELECT status, confirm_token_hash, consent_text_version, consented_at FROM newsletter_subscribers WHERE email = 'once@example.test'`).get() as any;
    assert.equal(row.status, 'confirmed');
    assert.equal(row.confirm_token_hash, null, 'the hash is cleared on use');
    assert.ok(row.consent_text_version && row.consented_at, 'the consent is recorded');
    assert.match(h.mails.at(-1)!.subject, /Welcome/);
    assert.match(h.mails.at(-1)!.headers, /List-Unsubscribe: <https:\/\/axal\.vc\/api\/newsletter\/unsubscribe\?token=/);
    assert.match(h.mails.at(-1)!.headers, /List-Unsubscribe-Post: List-Unsubscribe=One-Click/);

    const again = await h.req(`/api/newsletter/confirm?token=${encodeURIComponent(confirm)}`, { headers: { Accept: 'application/json' } });
    assert.equal(again.status, 410);
    assert.equal((await again.json() as any).code, 'token_invalid');

    await h.json('POST', '/api/newsletter/subscribe', { email: 'late@example.test', topics: [] });
    const late = linkIn(h.mails.at(-1)!.text, '/api/newsletter/confirm');
    h.db.exec(`UPDATE newsletter_subscribers SET confirm_expires_at = '2000-01-01T00:00:00.000Z' WHERE email = 'late@example.test'`);
    const expired = await h.req(`/api/newsletter/confirm?token=${encodeURIComponent(late)}`, { headers: { Accept: 'application/json' } });
    assert.equal(expired.status, 410);
    assert.equal((await expired.json() as any).code, 'token_expired');
    const still = h.db.prepare(`SELECT status FROM newsletter_subscribers WHERE email = 'late@example.test'`).get() as any;
    assert.equal(still.status, 'pending');

    // A browser gets a page, not JSON.
    const page = await h.req(`/api/newsletter/confirm?token=${encodeURIComponent(confirm)}`, { headers: { Accept: 'text/html' } });
    assert.equal(page.status, 410);
    assert.match(await page.text(), /already been used/);
  } finally { h.restore(); }
});

test('preferences and unsubscribe refuse a forged or an old token', async () => {
  const h = harness();
  try {
    const { prefs } = await subscribeAndConfirm(h, 'pat@example.test', ['brief', 'events']);
    const good = await h.req(`/api/newsletter/preferences?token=${encodeURIComponent(prefs)}`);
    assert.equal(good.status, 200);
    const body = await good.json() as any;
    assert.equal(body.email, 'p***@example.test', 'the address is masked');
    assert.equal(body.topics.brief, true);
    assert.equal('partner_letter' in body.topics, false, 'a website subscriber is never offered the partner letter');

    const [uid, version, sig] = prefs.split('.');
    const forged = [
      `${uid}.${version}.${sig.slice(0, -1)}${sig.endsWith('0') ? '1' : '0'}`,           // a changed signature
      `${uid}.${Number(version) + 1}.${sig}`,                                             // a changed version
      await preferencesToken('another-key', uid, Number(version)),                        // the wrong key
      'nonsense',
    ];
    for (const t of forged) {
      assert.equal((await h.req(`/api/newsletter/preferences?token=${encodeURIComponent(t)}`)).status, 403, t);
      assert.equal((await h.json('PUT', `/api/newsletter/preferences?token=${encodeURIComponent(t)}`, { topics: { brief: false } })).status, 403, t);
      assert.equal((await h.req(`/api/newsletter/unsubscribe?token=${encodeURIComponent(t)}`, { method: 'POST' })).status, 403, t);
    }

    // PUT saves and says so.
    unpace(h.db);
    const put = await h.json('PUT', `/api/newsletter/preferences?token=${encodeURIComponent(prefs)}`, { topics: { brief: false, portfolio: true, partner_letter: true } });
    assert.equal(put.status, 200);
    const saved = await put.json() as any;
    assert.deepEqual([saved.topics.brief, saved.topics.portfolio, saved.topics.events], [false, true, true]);
    assert.equal('partner_letter' in saved.topics, false, 'the partner letter cannot be turned on by token');
    assert.match(h.mails.at(-1)!.subject, /preferences are saved/);

    // Unsubscribed, then subscribed again: every link sent before is retired.
    assert.equal((await h.req(`/api/newsletter/unsubscribe?token=${encodeURIComponent(prefs)}`, { method: 'POST' })).status, 200);
    unpace(h.db);
    const { prefs: fresh } = await subscribeAndConfirm(h, 'pat@example.test', ['brief']);
    assert.notEqual(fresh, prefs);
    assert.equal((await h.req(`/api/newsletter/preferences?token=${encodeURIComponent(prefs)}`)).status, 403, 'the old link still works');
    assert.equal((await h.req(`/api/newsletter/preferences?token=${encodeURIComponent(fresh)}`)).status, 200);
  } finally { h.restore(); }
});

test('one-click unsubscribe works with a POST and no sign-in, and unsubscribing from all suppresses', async () => {
  const h = harness();
  try {
    const { prefs } = await subscribeAndConfirm(h, 'gone@example.test', ['brief', 'events']);
    const welcome = h.mails.at(-1)!;
    const header = /List-Unsubscribe: <([^>]+)>/.exec(welcome.headers)![1];
    const path = header.slice(BASE.length);

    // One topic first, from the email's own link.
    unpace(h.db);
    const one = await h.req(`/api/newsletter/unsubscribe?token=${encodeURIComponent(prefs)}&topic=events`, { method: 'POST' });
    assert.equal(one.status, 200);
    let row = h.db.prepare(`SELECT status FROM newsletter_subscribers WHERE email = 'gone@example.test'`).get() as any;
    assert.equal(row.status, 'confirmed', 'one topic leaves the subscription');
    assert.equal(h.db.prepare(`SELECT count(*) AS n FROM email_suppressions`).get()!.n, 0);

    // The RFC 8058 POST a mailbox provider makes: form body, no cookie, no CSRF token.
    const app = new Hono<any>();
    app.use('/api/*', csrfMiddleware());
    app.route('/api', newsletterRoutes);
    unpace(h.db);
    const res = await app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: 'studioos_auth=someone-elses-session' },
      body: 'List-Unsubscribe=One-Click',
    }, h.env);
    assert.equal(res.status, 200, 'the one-click POST is refused');
    row = h.db.prepare(`SELECT status, unsubscribed_at FROM newsletter_subscribers WHERE email = 'gone@example.test'`).get() as any;
    assert.equal(row.status, 'unsubscribed');
    assert.ok(row.unsubscribed_at);
    const sup = h.db.prepare(`SELECT reason, source FROM email_suppressions WHERE email = 'gone@example.test'`).all() as any[];
    assert.deepEqual(sup.map((s) => s.reason), ['unsubscribe']);
    assert.match(h.mails.at(-1)!.subject, /unsubscribed/);
    assert.equal(await isSuppressed(h.env as any, 'gone@example.test', 'newsletter'), true);

    // The GET behind the email link changes nothing: it offers the button.
    const db2 = freshDb();
    const h2 = harness(db2);
    try {
      const { prefs: p2 } = await subscribeAndConfirm(h2, 'look@example.test', ['brief']);
      const get = await h2.req(`/api/newsletter/unsubscribe?token=${encodeURIComponent(p2)}`, { headers: { Accept: 'text/html' } });
      assert.equal(get.status, 200);
      assert.match(await get.text(), /<form method="post"/);
      assert.equal((db2.prepare(`SELECT status FROM newsletter_subscribers`).get() as any).status, 'confirmed');
    } finally { h2.restore(); }
  } finally { h.restore(); }
});

test('the raw IP is never stored', async () => {
  const h = harness();
  try {
    await h.json('POST', '/api/newsletter/subscribe', { email: 'ip@example.test', topics: ['brief'] });
    const pending = JSON.stringify(h.db.prepare(`SELECT * FROM newsletter_subscribers WHERE email = 'ip@example.test'`).all());
    assert.equal(pending.includes(IP), false, 'the signup stored the raw IP');
    const confirm = linkIn(h.mails.at(-1)!.text, '/api/newsletter/confirm');
    assert.equal((await h.req(`/api/newsletter/confirm?token=${encodeURIComponent(confirm)}`, { headers: { Accept: 'application/json' } })).status, 200);
    for (const table of ['newsletter_subscribers', 'newsletter_subscriber_topics', 'email_suppressions']) {
      const dump = JSON.stringify(h.db.prepare(`SELECT * FROM ${table}`).all());
      assert.equal(dump.includes(IP), false, `${table} holds the raw IP`);
      assert.equal(dump.includes(IP.replace(/\./g, '')), false);
    }
    const row = h.db.prepare(`SELECT ip_hash FROM newsletter_subscribers WHERE email = 'ip@example.test'`).get() as any;
    assert.match(row.ip_hash, /^[0-9a-f]{64}$/, 'a salted hash is kept instead');
  } finally { h.restore(); }
});

test('the public routes are capped per IP and fail closed', async () => {
  // The path test executed: the four routes, and nothing that merely shares the word.
  for (const p of ['/api/newsletter/subscribe', '/api/newsletter/confirm', '/api/newsletter/preferences', '/api/newsletter/unsubscribe']) {
    assert.equal(NEWSLETTER_PUBLIC.test(p), true, p);
  }
  for (const p of ['/api/me/newsletters', '/api/insights/newsletter/subscribe', '/api/newsletter/subscribe/x', '/api/newsletters']) {
    assert.equal(NEWSLETTER_PUBLIC.test(p), false, p);
  }

  const app = new Hono();
  let handled = 0;
  app.use('/api/*', rateLimitMiddleware());
  app.all('/api/*', (c) => { handled += 1; return c.json({ ok: true }); });
  const store = new Map<string, string>();
  const env: any = {
    RATE_LIMITS: { get: async (k: string) => store.get(k), put: async (k: string, v: string) => { store.set(k, v); } },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) },
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} } as any;
  const hit = (path: string, method = 'POST', ip = IP) => app.request(path, { method, headers: { 'cf-connecting-ip': ip } }, env, ctx);
  const previousNow = Date.now;
  Date.now = () => 1_800_000_000_000;
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await hit('/api/newsletter/subscribe')).status);
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 429]);
    assert.equal(handled, 10);
    assert.equal((await hit('/api/newsletter/confirm', 'GET')).status, 429, 'one cap across the four routes');
    assert.equal((await hit('/api/newsletter/subscribe', 'POST', '203.0.113.9')).status, 200, 'another IP is unaffected');

    const down: any = { ...env, RATE_LIMITS: { get: async () => { throw new Error('kv down'); }, put: async () => { throw new Error('kv down'); } } };
    const res = await app.request('/api/newsletter/subscribe', { method: 'POST', headers: { 'cf-connecting-ip': '192.0.2.1' } }, down, ctx);
    assert.equal(res.status, 503, 'a KV outage must not open the route');
  } finally { Date.now = previousNow; }
});

test("a member's topics round-trip on the account email; the partner letter is for investors", async () => {
  const h = harness();
  try {
    const founder = await bearer(1, 'founder');
    const empty = await h.req('/api/me/newsletters', { headers: founder });
    assert.equal(empty.status, 200);
    const e = await empty.json() as any;
    assert.equal(e.status, 'none');
    assert.equal(e.topics.some((t: any) => t.key === 'partner_letter'), false);

    const put = await h.json('PUT', '/api/me/newsletters', { topics: { brief: true, insights: true } }, founder);
    assert.equal(put.status, 200);
    const back = await (await h.req('/api/me/newsletters', { headers: founder })).json() as any;
    assert.equal(back.status, 'confirmed');
    const on = back.topics.filter((t: any) => t.enabled).map((t: any) => t.key).sort();
    assert.deepEqual(on, ['brief', 'insights']);
    const row = h.db.prepare(`SELECT email, user_id, source FROM newsletter_subscribers WHERE user_id = 1`).get() as any;
    assert.deepEqual({ ...row }, { email: 'founder@example.test', user_id: 1, source: 'account' });

    const refused = await h.json('PUT', '/api/me/newsletters', { topics: { partner_letter: true } }, founder);
    assert.equal(refused.status, 403);
    assert.equal((await refused.json() as any).code, 'topic_not_allowed');

    const investor = await bearer(2, 'investor');
    const inv = await h.json('PUT', '/api/me/newsletters', { topics: { partner_letter: true } }, investor);
    assert.equal(inv.status, 200);
    const invBody = await inv.json() as any;
    assert.equal(invBody.topics.find((t: any) => t.key === 'partner_letter').enabled, true);
    assert.equal((h.db.prepare(`SELECT email FROM newsletter_subscribers WHERE user_id = 2`).get() as any).email, 'ivy.investor@example.test');

    assert.equal((await h.req('/api/me/newsletters')).status, 401, 'signed out');
  } finally { h.restore(); }
});

test('insights mirrors the old toggle, both ways, and the backfill carried it over', async () => {
  const h = harness();
  try {
    // Migration 515's backfill: user 3 had the toggle on.
    const olly = await bearer(3, 'investor');
    const backfilled = await (await h.req('/api/me/newsletters', { headers: olly })).json() as any;
    assert.equal(backfilled.topics.find((t: any) => t.key === 'insights').enabled, true);
    assert.equal(backfilled.status, 'confirmed');

    // The old route writes the topic.
    const ivy = await bearer(2, 'investor');
    assert.equal((await h.req('/api/insights/newsletter/subscribe', { method: 'POST', headers: ivy })).status, 200);
    let mine = await (await h.req('/api/me/newsletters', { headers: ivy })).json() as any;
    assert.equal(mine.topics.find((t: any) => t.key === 'insights').enabled, true);
    assert.equal((await (await h.req('/api/insights/newsletter', { headers: ivy })).json() as any).is_subscribed, true);

    // The topic writes the old table, and the old GET reads the topic.
    await h.json('PUT', '/api/me/newsletters', { topics: { insights: false } }, ivy);
    const old = h.db.prepare('SELECT is_subscribed FROM insight_subscriptions WHERE user_id = 2').get() as any;
    assert.equal(old.is_subscribed, 0);
    assert.equal((await (await h.req('/api/insights/newsletter', { headers: ivy })).json() as any).is_subscribed, false);

    assert.equal((await h.req('/api/insights/newsletter/unsubscribe', { method: 'POST', headers: olly })).status, 200);
    mine = await (await h.req('/api/me/newsletters', { headers: olly })).json() as any;
    assert.equal(mine.topics.find((t: any) => t.key === 'insights').enabled, false);
  } finally { h.restore(); }
});

test('suppression goes by reason: an unsubscribe stops marketing, a bounce stops all but account security', async () => {
  assert.equal(reasonBlocks('unsubscribe', 'newsletter'), true);
  assert.equal(reasonBlocks('unsubscribe', 'marketing'), true);
  assert.equal(reasonBlocks('unsubscribe', 'transactional'), false);
  assert.equal(reasonBlocks('unsubscribe', 'security'), false);
  for (const r of ['bounce', 'complaint']) {
    assert.equal(reasonBlocks(r, 'newsletter'), true);
    assert.equal(reasonBlocks(r, 'transactional'), true);
    assert.equal(reasonBlocks(r, 'security'), false, `${r} must not stop a sign-in link`);
  }
  assert.equal(mailClassOf({ category: 'security', marketing: false } as any), 'security');
  assert.equal(mailClassOf({ category: 'billing', marketing: true } as any), 'marketing');
  assert.equal(mailClassOf({ category: 'billing' } as any), 'transactional');

  const h = harness(freshDb(), {});
  try {
    h.db.exec(`INSERT INTO email_suppressions (email, reason, source) VALUES ('bounced@example.test', 'bounce', 'test'), ('left@example.test', 'unsubscribe', 'test')`);
    const env = h.env as any;
    assert.equal(await isSuppressed(env, 'Someone <Bounced@Example.test>', 'transactional'), true, 'a display-name address is read');
    assert.equal(await isSuppressed(env, 'left@example.test', 'transactional'), false);

    // The legacy senders ask before they send.
    assert.equal(await sendNotificationEmail(env, 'bounced@example.test', 'Hi', 'Body'), false);
    assert.equal(h.mails.length, 0, 'a bounced address is not mailed');
    assert.equal(await sendNotificationEmail(env, 'left@example.test', 'Hi', 'Body'), true, 'an unsubscribe does not stop transactional mail');
    assert.equal(await sendVerificationEmail(env, 'bounced@example.test', 'B', `${BASE}/verify?t=x`), true, 'account security still goes');
    assert.equal(h.mails.length, 2);

    // The template pipeline asks too, by the template's class.
    assert.equal((await send(env, 'compliance_notice_issued', 'bounced@example.test', {})).reason, 'suppressed');
    assert.equal((await send(env, 'daily_digest', 'left@example.test', {})).reason, 'suppressed', 'an unsubscribe stops marketing');

    // A bounced address that signs up gets the same answer, and nothing.
    const before = h.mails.length;
    const res = await h.json('POST', '/api/newsletter/subscribe', { email: 'bounced@example.test', topics: ['brief'] });
    assert.equal(res.status, 200);
    assert.equal(h.mails.length, before);
    assert.equal(h.db.prepare(`SELECT count(*) AS n FROM newsletter_subscribers WHERE email = 'bounced@example.test'`).get()!.n, 0,
      'a bounced address is not stored as a subscriber');

    // An unreadable store blocks newsletter mail only.
    const broken: any = { ...env, DB: { prepare: () => { throw new Error('no table'); } } };
    assert.equal(await isSuppressed(broken, 'x@example.test', 'newsletter'), true);
    assert.equal(await isSuppressed(broken, 'x@example.test', 'transactional'), false);
  } finally { h.restore(); }
});

test('production refuses every public route until NEWSLETTER_TOKEN_KEY is set', async () => {
  assert.equal(tokenKey({ ENVIRONMENT: 'production', JWT_SECRET } as any), null);
  assert.equal(tokenKey({ ENVIRONMENT: 'development', JWT_SECRET } as any), JWT_SECRET);
  const h = harness(freshDb(), { ENVIRONMENT: 'production', NEWSLETTER_TOKEN_KEY: undefined, TURNSTILE_SECRET_KEY: 'x' });
  try {
    const res = await h.json('POST', '/api/newsletter/subscribe', { email: 'a@example.test' });
    assert.equal(res.status, 503);
    assert.equal((await res.json() as any).code, 'newsletter_unconfigured');
    assert.equal((await h.req('/api/newsletter/confirm?token=abc')).status, 503);
    assert.equal((await h.req('/api/newsletter/preferences?token=abc')).status, 503);
    assert.equal((await h.req('/api/newsletter/unsubscribe?token=abc', { method: 'POST' })).status, 503);
  } finally { h.restore(); }
});
