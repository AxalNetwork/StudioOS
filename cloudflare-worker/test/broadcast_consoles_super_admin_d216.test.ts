/**
 * D216 — the Telegram and X consoles are HQ's (#337), and a disabled Telegram
 * channel sends nothing (#328).
 *
 * #337: every route under /api/admin/telegram/* and /api/admin/x/* checked
 * only `requireAdmin`, so any subsidiary admin could create, test and send on
 * the platform's broadcast channels, and `GET /channels` handed each of them
 * every channel's `chat_id`. Both files now gate on `requireSuperAdmin`
 * (the D133 precedent). Each refusal is paired with the super admin reaching
 * the same call, because a guard that also stopped HQ would be worse.
 *
 * #328: `POST /posts/:id/send` refused a channel with no chat_id but sent
 * through a disabled one. It now refuses with its own sentence, before the
 * compare-and-set claim, so the draft stays a draft.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/broadcast_consoles_super_admin_d216.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import telegram from '../src/routes/admin_telegram.ts';
import x from '../src/routes/admin_x.ts';

const app = new Hono<any>();
app.route('/telegram', telegram);
app.route('/x', x);
// Replicates index.ts's `app.onError` status map, which a directly
// dispatched sub-app does not pass through.
app.onError((err: any, c) => {
  const status = ({
    Unauthorized: 401,
    'Admin required': 403,
    'Super admin required': 403,
  } as Record<string, 401 | 403>)[String(err?.message || '')];
  if (status) return c.json({ detail: err.message }, status);
  throw err;
});

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1;
const PLAIN = 2;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...xs: any[]) => { b = coerce(xs); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(xs: any[]) { const out = []; for (const st of xs || []) out.push(await st.run().catch(() => ({}))); return out; },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
      jwt_min_iat INTEGER, name TEXT, email TEXT
    );
    CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
    CREATE TABLE activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT, user_id INTEGER
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)');
  u.run(SUPER, 'admin', 'Sue', 'sue@axal.example');
  u.run(PLAIN, 'admin', 'Pat', 'pat@axal.example');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  return db;
}

const kv = () => {
  const m = new Map<string, string>();
  return {
    async get(k: string) { return m.get(k) ?? null; },
    async put(k: string, v: string) { m.set(k, v); },
    async delete(k: string) { m.delete(k); },
  };
};

const env = (db: InstanceType<typeof DatabaseSync>) => ({
  JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db),
  RATE_LIMITS: kv(), TOKENS: kv(),
});

async function token(userId: number): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(e: any, actor: number, method: string, path: string, body?: any) {
  const res = await app.request(path, {
    method,
    headers: { Authorization: `Bearer ${await token(actor)}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, e);
  let json: any = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}

/* Every route both files mount, read off the source rather than retyped, so
 * a route added later without the gate is caught here. */
function routesOf(file: string): Array<[string, string]> {
  const src = readFileSync(resolve(import.meta.dirname, '../src/routes', file), 'utf8');
  const out: Array<[string, string]> = [];
  for (const m of src.matchAll(/^r\.(get|post|put|delete|patch)\('([^']+)'/gm)) out.push([m[1].toUpperCase(), m[2]]);
  return out;
}

test('neither console file calls plain requireAdmin any more', () => {
  for (const f of ['admin_telegram.ts', 'admin_x.ts']) {
    const src = readFileSync(resolve(import.meta.dirname, '../src/routes', f), 'utf8');
    assert.ok(!/\brequireAdmin\b/.test(src), `${f} still names requireAdmin`);
    assert.ok(/await requireSuperAdmin\(c\)/.test(src), `${f} does not gate on requireSuperAdmin`);
  }
});

test('a subsidiary admin is refused on every Telegram and X route', async () => {
  const db = freshDb();
  const e = env(db);
  const routes = [
    ...routesOf('admin_telegram.ts').map(([m, p]) => [m, `/telegram${p}`]),
    ...routesOf('admin_x.ts').map(([m, p]) => [m, `/x${p}`]),
  ].filter(([, p]) => !p.endsWith('/callback'));
  assert.ok(routes.length > 30, `only ${routes.length} routes were read`);
  for (const [m, p] of routes) {
    const path = p.replace(/:id|:user_id/g, '1');
    const r = await call(e, PLAIN, m, path, m === 'GET' ? undefined : {});
    assert.equal(r.status, 403, `${m} ${path} answered ${r.status} to a plain admin`);
    assert.equal(r.body?.detail, 'Super admin required', `${m} ${path}`);
  }
});

test('the X OAuth callback sends a plain admin back refused', async () => {
  const e = env(freshDb());
  const res = await app.request('/x/oauth/callback?code=c&state=s', {
    headers: { Authorization: `Bearer ${await token(PLAIN)}` },
  }, e);
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location') || '', /x_oauth_error=admin_required/);
});

test('a plain admin no longer reads chat_id; the super admin still does', async () => {
  const db = freshDb();
  const e = env(db);
  const created = await call(e, SUPER, 'POST', '/telegram/channels',
    { slug: 'hq-news', label: 'HQ news', audience: 'public', chat_id: '-100123' });
  assert.ok(created.status < 300, `create answered ${created.status}: ${JSON.stringify(created.body)}`);

  const plain = await call(e, PLAIN, 'GET', '/telegram/channels');
  assert.equal(plain.status, 403);
  assert.ok(!JSON.stringify(plain.body).includes('-100123'));

  const sup = await call(e, SUPER, 'GET', '/telegram/channels');
  assert.equal(sup.status, 200);
  assert.ok(JSON.stringify(sup.body).includes('-100123'), 'HQ lost the chat id it needs');
});

test('#328 — a draft on a disabled channel is refused with its own sentence, and stays a draft', async () => {
  const db = freshDb();
  const e = env(db);
  const ch = await call(e, SUPER, 'POST', '/telegram/channels',
    { slug: 'hq-news', label: 'HQ news', audience: 'public', chat_id: '-100123' });
  const channelId = ch.body?.id ?? ch.body?.channel?.id
    ?? (db.prepare('SELECT id FROM telegram_channels WHERE slug = ?').get('hq-news') as any).id;
  const post = await call(e, SUPER, 'POST', '/telegram/posts',
    { channel_id: channelId, body_md: 'Office hours move to Thursday.' });
  assert.ok(post.status < 300, `draft answered ${post.status}: ${JSON.stringify(post.body)}`);
  const postId = post.body?.id ?? post.body?.post?.id
    ?? (db.prepare('SELECT id FROM telegram_posts ORDER BY id DESC').get() as any).id;

  db.prepare('UPDATE telegram_channels SET enabled = 0 WHERE id = ?').run(channelId);

  const sent = await call(e, SUPER, 'POST', `/telegram/posts/${postId}/send`, {});
  assert.equal(sent.status, 409);
  assert.equal(sent.body?.error, 'channel_disabled');
  assert.match(sent.body?.message || '', /disabled/);
  const row: any = db.prepare('SELECT status FROM telegram_posts WHERE id = ?').get(postId);
  assert.equal(row.status, 'draft', 'the refusal claimed the draft');
});
