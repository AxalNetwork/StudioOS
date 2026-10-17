/**
 * D691 — the deck share link's signup gets the two guards every other
 * unauthenticated account-creating route has (issue #1705).
 *
 * THE DEFECT. `POST /api/decks/share/:token/signup` minted a `users` row (plus
 * `activity_logs` and `onboarding_progress`) for anyone holding a live share
 * token, with no Turnstile (its comment said the token "already proves
 * intent"; it proves access to one deck, and a link with no expiry or view cap
 * reaches whoever it is forwarded to) and no bucket of its own, so the generic
 * 200/min/IP limit was the only ceiling on account creation from a leaked link.
 *
 * HOW IT IS DRIVEN.
 *   - The route: the real `deck_share_actions.ts` router over HTTP, against a
 *     node:sqlite database sliced from `schema_baseline.sql`, with a real
 *     signed share token. Turnstile is ON (a secret is set) and `fetch` is
 *     swapped for a recorder that plays Cloudflare's siteverify, answering
 *     success only for the one token a solved challenge would yield.
 *   - The bucket: the real `rateLimitMiddleware` in front of a stub handler,
 *     over an in-memory KV, then a KV that throws.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';

import deckShareActions from '../src/routes/deck_share_actions.ts';
import { rateLimitMiddleware, DECK_SHARE_SIGNUP } from '../src/middleware/rateLimit.ts';
import { hashEmail } from '../src/util/hashEmail.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');

const JWT_SECRET = 'unit-test-jwt-secret-d691-0123456789-abcdef';
const SOLVED = 'solved-challenge-d691';
const DECK = 5;
const IP = '198.51.100.77';
const EMAIL = 'deck.viewer.d691@example.test';
const TABLES = ['users', 'activity_logs', 'onboarding_progress', 'pitch_decks', 'projects', 'pitch_deck_share_tokens'];

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A share token signed exactly as decks.ts mints one, for deck `DECK`. */
async function shareToken(): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify({
    k: `deck:${DECK}:v1`, exp: Math.floor(Date.now() / 1000) + 3600,
  })));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of TABLES) db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  db.prepare(`INSERT INTO projects (id, name) VALUES (1, 'Testventure Labs')`).run();
  db.prepare(`INSERT INTO pitch_decks (id, project_id, title, slides) VALUES (?, 1, 'Seed deck', '[]')`).run(DECK);
  const env = {
    JWT_SECRET, ENVIRONMENT: 'production', TURNSTILE_SECRET_KEY: 'test-secret-d691', DB: d1Over(db),
  } as any;
  return { db, env };
}

async function signup(env: any, body: Record<string, unknown>) {
  const verified: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);
    assert.match(url, /challenges\.cloudflare\.com\/turnstile\/v0\/siteverify$/, `unexpected outbound call to ${url}`);
    const token = new URLSearchParams(String(init?.body ?? '')).get('response') ?? '';
    verified.push(token);
    return new Response(JSON.stringify({ success: token === SOLVED, 'error-codes': token === SOLVED ? [] : ['invalid-input-response'] }), {
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    const res = await deckShareActions.fetch(new Request(`http://x/share/${await shareToken()}/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': IP },
      body: JSON.stringify({ email: EMAIL, name: 'Sam Example', role: 'investor', ...body }),
    }), env);
    return { status: res.status, body: await res.json().catch(() => ({})) as any, verified };
  } finally {
    globalThis.fetch = real;
  }
}

const count = (db: any, sql: string, ...args: unknown[]) => Number((db.prepare(sql).get(...args) as any).n);

test('a missing Turnstile token answers 403 and creates nothing, before the email is looked up', async () => {
  const { db, env } = fixture();
  const r = await signup(env, {});
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'Bot verification failed. Please try again.');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM users'), 0, 'a user was created without Turnstile');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM onboarding_progress'), 0);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'user_registered'`), 0);
});

test('an unsolved token answers 403, and the refusal is logged with a hashed email and an IP bucket only', async () => {
  const { db, env } = fixture();
  const r = await signup(env, { turnstileToken: 'forged-token' });
  assert.equal(r.status, 403);
  assert.deepEqual(r.verified, ['forged-token'], 'the token was not checked with Cloudflare');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM users'), 0);
  const logs = db.prepare(`SELECT details, actor FROM activity_logs WHERE action = 'turnstile_failed'`).all() as any[];
  assert.equal(logs.length, 1, 'the refusal was not logged');
  const text = JSON.stringify(logs);
  assert.ok(!text.includes(EMAIL) && !text.includes('deck.viewer'), 'the raw email reached the log');
  assert.ok(!text.includes(IP), 'the full IP reached the log');
  assert.ok(logs[0].details.includes(`email_hash=${await hashEmail(EMAIL)}`), logs[0].details);
  assert.equal(logs[0].actor, '198.51.100.0/24');
});

test('an existing email behind a failed challenge gets 403, not the 409 that would confirm the account', async () => {
  const { db, env } = fixture();
  db.prepare(`INSERT INTO users (email, name, role) VALUES (?, 'Sam Example', 'investor')`).run(EMAIL);
  const r = await signup(env, {});
  assert.equal(r.status, 403);
  assert.equal(r.body.requires_login, undefined);
});

test('a solved challenge creates the user exactly as before', async () => {
  const { db, env } = fixture();
  const r = await signup(env, { turnstileToken: SOLVED });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  assert.equal(r.body.email, EMAIL);
  const u = db.prepare('SELECT email, role, email_verified FROM users').all() as any[];
  assert.deepEqual(u.map((x) => ({ ...x })), [{ email: EMAIL, role: 'investor', email_verified: 0 }]);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'user_registered'`), 1);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'turnstile_failed'`), 0);
  // The existing-email refusal stays, behind a solved challenge.
  const again = await signup(env, { turnstileToken: SOLVED });
  assert.equal(again.status, 409);
  assert.equal(again.body.requires_login, true);
});

/* ------------------------------------------------------------------ *
 * the bucket                                                          *
 * ------------------------------------------------------------------ */

function limited() {
  const app = new Hono();
  let handled = 0;
  app.use('/api/*', rateLimitMiddleware());
  app.post('/api/*', (c) => { handled += 1; return c.json({ ok: true }); });
  const store = new Map<string, string>();
  const env: any = {
    RATE_LIMITS: { get: async (k: string) => store.get(k), put: async (k: string, v: string) => { store.set(k, v); } },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) },
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} } as any;
  const post = (path: string, ip = IP) => app.request(path, { method: 'POST', headers: { 'cf-connecting-ip': ip } }, env, ctx);
  return { env, post, handled: () => handled };
}

test('the seventh signup in a minute from one IP answers 429; another IP is unaffected', async () => {
  const previousNow = Date.now;
  Date.now = () => 1_800_000_000_000;
  try {
    const l = limited();
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await l.post('/api/decks/share/tok-a/signup')).status);
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 200, 429]);
    assert.equal(l.handled(), 6);
    // Per IP: the bucket counts the source, not the token, so rotating links does not help.
    assert.equal((await l.post('/api/decks/share/tok-b/signup')).status, 429);
    assert.equal((await l.post('/api/decks/share/tok-a/signup', '203.0.113.9')).status, 200);
  } finally { Date.now = previousNow; }
});

test('with KV failing, the signup bucket refuses with 503 (fail-closed)', async () => {
  const l = limited();
  l.env.RATE_LIMITS.get = async () => { throw new Error('Synthetic KV outage'); };
  const r = await l.post('/api/decks/share/tok-a/signup');
  assert.equal(r.status, 503);
  assert.equal(l.handled(), 0);
});

test('the pattern is anchored to the signup route and nothing else in the share family', () => {
  assert.ok(DECK_SHARE_SIGNUP.test('/api/decks/share/abc.def/signup'));
  for (const p of [
    '/api/decks/share/abc/nda', '/api/decks/share/abc/feedback', '/api/decks/share/abc/context',
    '/api/decks/share/abc/deal-pack', '/api/decks/share/abc', '/api/decks/share/abc/signup/x',
    '/api/decks/share//signup', '/x/api/decks/share/abc/signup', '/api/auth/register',
  ]) assert.ok(!DECK_SHARE_SIGNUP.test(p), `${p} would be capped by the signup bucket`);
});
