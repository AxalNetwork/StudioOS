/**
 * Company scoping: the Studio dashboard's own project list.
 *
 * This is the FIRST list a founder sees after signing in, and it disagreed
 * with the project picker two sidebar rows below it: `/projects` narrowed from
 * stage 4 onward while `GET /api/dashboard` still selected every project the
 * founder owned. Switch company and Studio kept showing the other company's
 * work — the "an overview disagrees with its own detail" failure this rollout
 * has now hit six times.
 *
 * ONLY THE FOUNDER BRANCH NARROWS. The admin branch is an oversight view of
 * every project on the platform. The investor and partner branches are a
 * marketplace — tier_1/tier_2 deals plus anything they have a match score on —
 * and narrowing a marketplace hides the deals the surface exists to show.
 *
 * `getSQL` is a thin tagged-template wrapper over `DB.prepare().bind().all()`,
 * so the same in-memory D1 shim the other stages use drives it unchanged.
 * `safeQuery` swallows errors from the tables this fixture omits, which is why
 * only `projects` and `users` need to exist.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import dashboard from '../src/routes/dashboard.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const FOUNDER = { user: 50, founder_id: 150 };
const ADMIN = 44;
const CO_A = 21;
const CO_B = 22;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
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
    async batch(x: any[]) { return x; },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, name TEXT, sector TEXT, stage TEXT, status TEXT,
      founder_id INTEGER, company_id INTEGER, deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE user_company_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, user_id INTEGER NOT NULL
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, founder_id, email) VALUES (?,?,?,?)');
  u.run(FOUNDER.user, 'founder', FOUNDER.founder_id, 'f@example.com');
  u.run(ADMIN, 'admin', null, 'a@example.com');
  const p = db.prepare(
    'INSERT INTO projects (id, name, status, founder_id, company_id) VALUES (?,?,?,?,?)');
  p.run(1, 'Alpha', 'tier_1', FOUNDER.founder_id, CO_A);
  p.run(2, 'Beta', 'tier_1', FOUNDER.founder_id, CO_B);
  p.run(3, 'Legacy', 'tier_1', FOUNDER.founder_id, null);
  p.run(4, 'Someone else', 'tier_1', 999, CO_A);
  const l = db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (?,?)');
  l.run(CO_A, FOUNDER.user); l.run(CO_B, FOUNDER.user);
  // The admin holds CO_A too, so the "admin is never narrowed" test sends a
  // header that actually resolves — a caller that holds no link resolves to
  // null and makes an over-narrowing canary vacuous.
  l.run(CO_A, ADMIN);
  return db;
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function deals(who: { user: number; role: string }, company?: number | string): Promise<number[]> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token(who.user, who.role)}`,
  };
  if (company !== undefined) headers['X-Company-Id'] = String(company);
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(freshDb()) };
  const res = await dashboard.request('/', { headers }, env);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  const rows = body?.deals ?? body?.proprietary_deal_flow ?? [];
  return rows.map((r: any) => Number(r.id)).sort((a: number, b: number) => a - b);
}

const founder = { user: FOUNDER.user, role: 'founder' };
const admin = { user: ADMIN, role: 'admin' };

test('the Studio project list follows the selected company', async () => {
  assert.deepEqual(await deals(founder, CO_A), [1, 3], 'company A, plus the project with no company');
  assert.deepEqual(await deals(founder, CO_B), [2, 3]);
});

test('with no company selected the founder sees all of their projects', async () => {
  assert.deepEqual(await deals(founder), [1, 2, 3]);
});

test('a forged company header is ignored, not obeyed', async () => {
  assert.deepEqual(await deals(founder, 999), [1, 2, 3]);
  assert.deepEqual(await deals(founder, 'abc'), [1, 2, 3]);
});

test('another founder\'s project never appears, whatever the company', async () => {
  // Project 4 sits in CO_A — the company the caller is acting for — and is
  // owned by someone else. Only founder_id keeps it out.
  for (const co of [CO_A, CO_B, undefined]) {
    assert.ok(!(await deals(founder, co)).includes(4), `company=${co}`);
  }
});

test('an admin is never narrowed', async () => {
  // The admin genuinely belongs to CO_A, so this header resolves. Project 2
  // (CO_B) and project 4 (another founder's) are what disappear if the admin
  // branch is ever narrowed.
  assert.deepEqual(await deals(admin, CO_A), [1, 2, 3, 4]);
});

test('the cache key carries the company, so a switch is not served a stale payload', async () => {
  // THE BUG THIS PINS, and the reason the first test above failed before the
  // fix: both cache tiers keyed on `user.id` alone. That was correct while the
  // payload was identical under every company and became a cross-company leak
  // the moment the project list narrowed — switch company, and L1 serves the
  // other company's dashboard for the whole TTL. Scoping a payload without
  // scoping its cache key is not a smaller version of scoping it.
  //
  // The L1 map is module-level and shared across these requests, which is what
  // makes this assertable at all: two calls in a row, different companies.
  const first = await deals(founder, CO_A);
  const second = await deals(founder, CO_B);
  assert.deepEqual(first, [1, 3]);
  assert.deepEqual(second, [2, 3], 'a cached payload from the other company must not be served');
});

test('refreshing clears every company variant, not just the current one', () => {
  // Once the key carries the company there is no longer one entry to delete.
  // Clearing only the caller's current company leaves a stale dashboard behind
  // the switcher — the same bug as not invalidating, one click later.
  const src = readFileSync(
    resolve(process.cwd(), 'cloudflare-worker/src/routes/dashboard.ts'), 'utf8');
  const handler = src.slice(src.indexOf("dashboard.post('/refresh-scores'"));
  assert.match(handler, /k\.startsWith\(prefix\)/, 'L1 must be cleared by prefix');
  assert.match(handler, /FROM user_company_links WHERE user_id = \?/,
    'and KV for every company the user belongs to');
  assert.doesNotMatch(handler.slice(0, 900), /kvKey\(user\.id\)/,
    'the single-key delete is gone');
});
