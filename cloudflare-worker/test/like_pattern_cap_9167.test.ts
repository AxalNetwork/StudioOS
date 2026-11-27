/**
 * D9167 (#9167): a long search answers instead of failing on D1's 50-byte LIKE limit.
 *
 * D1 refuses a LIKE pattern over 50 bytes with "LIKE or GLOB pattern too
 * complex", and only once a row is compared, so the failure needs a seeded
 * row and a real D1 engine to show. node:sqlite (the `_d1_sqlite.mjs` shim)
 * keeps SQLite's default limit of 50,000 bytes and would pass the broken code,
 * so the route tests here run on Miniflare's local D1 (workerd's SQLite, the
 * engine `wrangler dev` uses). That is the local engine, not production D1;
 * the first route test proves the local engine enforces the same 50/51-byte
 * line before it means anything.
 *
 * The helper's byte math is tested on its own: ASCII, CJK, emoji, a term that
 * would end mid-character, and `%`, `_` and `\` escaping.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/like_pattern_cap_9167.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

import {
  LIKE_PATTERN_MAX_BYTES, likeEscapeCapped, likeNeedle, likeNeedleLower, likeNeedleWhole, likePrefix, likePrefixLower,
} from '../src/util/likeSearch.ts';
import eventsPublic from '../src/routes/events_public.ts';
import admin from '../src/routes/admin.ts';

const bytes = (s: string) => new TextEncoder().encode(s).length;
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

// ── the helper's byte math ─────────────────────────────────────────────────

test('ASCII: a 60-character term is trimmed to 48 so the pattern is exactly 50 bytes', () => {
  const like = likeNeedle('a'.repeat(60))!;
  assert.equal(like, `%${'a'.repeat(48)}%`);
  assert.equal(bytes(like), LIKE_PATTERN_MAX_BYTES);
  assert.equal(likeNeedle('a'.repeat(48)), `%${'a'.repeat(48)}%`, 'a term that fits is not touched');
  assert.equal(likeNeedle('a'.repeat(49)), `%${'a'.repeat(48)}%`, 'one byte over is trimmed by one character');
});

test('CJK: three bytes a character, so 16 fit and the 17th would make 51', () => {
  const like = likeNeedle('漢'.repeat(30))!;
  assert.equal(like, `%${'漢'.repeat(16)}%`);
  assert.equal(bytes(like), 50);
});

test('emoji: four bytes and two UTF-16 units each; never half a surrogate pair', () => {
  const like = likeNeedle('😀'.repeat(20))!;
  assert.equal(like, `%${'😀'.repeat(12)}%`);
  assert.equal(bytes(like), 50);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(like), 'no lone high surrogate');
});

test('a term that would end mid-character stops before that character', () => {
  // 47 ASCII bytes + a 3-byte character would be 50 inside the wildcards, 52 in all.
  const like = likeNeedle(`${'a'.repeat(47)}漢b`)!;
  assert.equal(like, `%${'a'.repeat(47)}%`);
  assert.ok(bytes(like) <= 50);
  // 46 + 2-byte é = 48: fits exactly.
  assert.equal(likeNeedle(`${'a'.repeat(46)}éz`), `%${'a'.repeat(46)}é%`);
  // 47 + 4-byte emoji: does not fit, and nothing of it is kept.
  assert.equal(likeNeedle(`${'a'.repeat(47)}😀`), `%${'a'.repeat(47)}%`);
});

test('%, _ and \\ are escaped, and the escape counts against the 50 bytes', () => {
  assert.equal(likeNeedle('a_b'), '%a\\_b%');
  assert.equal(likeNeedle('50%'), '%50\\%%');
  assert.equal(likeNeedle('a\\b'), '%a\\\\b%', 'a backslash means itself');
  assert.equal(likeNeedle('a\\'), '%a\\\\%', 'a trailing backslash cannot escape the closing wildcard');
  const like = likeNeedle('%'.repeat(30))!;
  assert.equal(like, `%${'\\%'.repeat(24)}%`, 'each escaped character takes two bytes');
  assert.equal(bytes(like), 50);
  // 47 plain bytes then `_`: the escaped pair would be 49 inside, 51 in all, so it is dropped whole.
  const edge = likeNeedle(`${'a'.repeat(47)}_`)!;
  assert.equal(edge, `%${'a'.repeat(47)}%`, 'never a lone escape character before the wildcard');
});

test('the prefix, lower and whole forms share the budget and the escaping', () => {
  assert.equal(likePrefix('A_b'), 'A\\_b%');
  assert.equal(bytes(likePrefix('x'.repeat(80))!), 50, 'one wildcard, so 49 characters');
  assert.equal(likePrefixLower('AB%'), 'ab\\%%');
  assert.equal(likeNeedleLower('İ'.repeat(30))!.length > 0, true);
  assert.ok(bytes(likeNeedleLower('İ'.repeat(30))!) <= 50, 'lower-cased before it is measured (İ grows to 3 bytes)');
  assert.equal(likeNeedleWhole('Ada@Example.test'), '%ada@example.test%');
  assert.equal(likeNeedleWhole(`${'a'.repeat(40)}@example.test`), null, 'an identity that does not fit is not trimmed into someone else');
  assert.equal(likeNeedleWhole(''), null, 'blank is not `%%`, which is every row');
  assert.equal(likeEscapeCapped('a%b', Infinity), 'a\\%b');
});

test('minLength still refuses short terms, and 0 keeps an empty term as `%%`', () => {
  assert.equal(likeNeedle('a'), null);
  assert.equal(likeNeedle('  '), null);
  assert.equal(likeNeedle('', 0), '%%');
  assert.equal(likeNeedle(undefined, 1), null);
});

// ── the routes, on a local D1 ──────────────────────────────────────────────

const LONG_ASCII = 'A'.repeat(60);
const LONG_CJK = '漢'.repeat(30);

async function localD1() {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, compatibilityDate: '2026-01-01', d1Databases: ['DB'],
    script: 'export default { fetch() { return new Response("synthetic fixture"); } }',
  }) as any);
  return { mf, DB: await mf.getD1Database('DB') as any };
}

test('the local engine enforces the 50-byte line, so the route tests below can fail', async () => {
  const { mf, DB } = await localD1();
  try {
    await DB.prepare('CREATE TABLE t (a TEXT)').run();
    await DB.prepare("INSERT INTO t VALUES ('x')").run();
    await DB.prepare("SELECT * FROM t WHERE a LIKE ? ESCAPE '\\'").bind(`%${'A'.repeat(48)}%`).all();
    await assert.rejects(DB.prepare('SELECT * FROM t WHERE a LIKE ?').bind(`%${'A'.repeat(49)}%`).all(), /pattern too complex/);
    await assert.rejects(DB.prepare('SELECT * FROM t WHERE a LIKE ?').bind(`%${LONG_CJK}%`).all(), /pattern too complex/);
  } finally { await mf.dispose(); }
});

test('GET /api/public/events?q=: a 60-character ASCII and a 30-character CJK term answer 200, never 500', async () => {
  const { mf, DB } = await localD1();
  try {
    const env: any = { DB, ENVIRONMENT: 'development' };
    const app = new Hono<any>().route('/api/public', eventsPublic);
    // The tables `events` names in its foreign keys (D1 enforces them); the dev schema bootstrap creates `events`.
    await DB.prepare('CREATE TABLE projects (id INTEGER PRIMARY KEY)').run();
    await DB.prepare('CREATE TABLE users (id INTEGER PRIMARY KEY)').run();
    await app.request('/api/public/events', {}, env);
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
    await DB.prepare(`INSERT INTO events (slug, title, summary, starts_at, visibility, status, admin_published)
      VALUES ('synthetic-long', ?1, ?2, ?3, 'public', 'published', 1)`)
      .bind(`${'A'.repeat(70)} meetup`, `${'漢'.repeat(40)} summary`, future).run();
    for (const [label, q] of [['ascii', LONG_ASCII], ['cjk', LONG_CJK], ['emoji', '😀'.repeat(20)], ['wildcards', '%_\\'.repeat(20)]] as const) {
      const res = await app.request(`/api/public/events?q=${encodeURIComponent(q)}`, {}, env);
      assert.equal(res.status, 200, `${label}: ${await res.clone().text()}`);
    }
    const ascii = await (await app.request(`/api/public/events?q=${LONG_ASCII}`, {}, env)).json() as any;
    assert.deepEqual(ascii.events.map((e: any) => e.slug), ['synthetic-long'], 'the trimmed search still finds the row it names');
    const cjk = await (await app.request(`/api/public/events?q=${encodeURIComponent(LONG_CJK)}`, {}, env)).json() as any;
    assert.deepEqual(cjk.events.map((e: any) => e.slug), ['synthetic-long'], 'a CJK search matches the summary');
    const pct = await (await app.request(`/api/public/events?q=${encodeURIComponent('%')}`, {}, env)).json() as any;
    assert.deepEqual(pct.events, [], 'a literal % is not "every event"');
  } finally { await mf.dispose(); }
});

test('GET /api/admin/users?q=: an admin search with a 60-character ASCII and a 30-character CJK term answers 200', async () => {
  const { mf, DB } = await localD1();
  try {
    await DB.prepare(`CREATE TABLE users (
      id INTEGER PRIMARY KEY, uid TEXT, email TEXT, name TEXT, role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1, email_verified INTEGER NOT NULL DEFAULT 0,
      kyc_status TEXT, access_level TEXT, jwt_min_iat INTEGER, created_at TEXT)`).run();
    await DB.prepare(`INSERT INTO users (id, uid, email, name, role, created_at) VALUES
      (1, 'u1', 'root@axal.test', 'Root Admin', 'admin', '2026-01-01T00:00:00Z'),
      (2, 'u2', 'long@axal.test', ?1, 'founder', '2026-02-01T00:00:00Z')`).bind(`${'A'.repeat(70)} ${'漢'.repeat(20)}`).run();
    const app = new Hono<any>().route('/admin', admin);
    const token = await new SignJWT({ user_id: 1, role: 'admin' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    const env = { JWT_SECRET, ENVIRONMENT: 'development', DB };
    for (const q of [LONG_ASCII, LONG_CJK]) {
      const res = await app.request(`/admin/users?envelope=1&q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${token}` } }, env);
      const body = await res.json() as any;
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.deepEqual(body.results.map((u: any) => u.id), [2], 'the trimmed search finds the account');
    }
  } finally { await mf.dispose(); }
});
