/**
 * D4623 part 2 (#4623) — `GET /api/dashboard?licence=investor` computes the
 * investor figures for a held Investor licence that is not the primary one.
 *
 * The multi-licence Studio (D4474) draws an Investor block for a member who
 * holds Investor beside another licence. The block reads the dashboard
 * summary, and the Worker computed that summary from `users.role` alone: for
 * a Founder-primary member the "deal flow" was their own projects, for an
 * Advisor-primary member the unfiltered marketplace. With `?licence=investor`
 * the held Investor licence gets the investor lens a primary investor gets.
 *
 * Synthetic fixtures only. The schema is the baseline plus every migration,
 * built once and copied per test (the D4620 pattern).
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/dashboard_investor_lens_4623.test.ts
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import dashboard from '../src/routes/dashboard.ts';
import { splitStatements } from './_baseline.mjs';
import { compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const ADMIN = 1;
const FOUNDER_INV = 2;   // primary Founder, granted Investor
const INV = 3;           // primary Investor
const ADVISOR_INV = 4;   // primary Advisor, granted Investor
const FOUNDER_ONLY = 5;  // primary Founder, no Investor licence
const BARE_INV = 6;      // primary Founder, granted Investor, no match scores
const CACHE_INV = 7;     // primary Founder, granted Investor; only the cache test asks for it (the L1 is per module)

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>, fail: RegExp[] = []) {
  return {
    prepare(sql: string) {
      if (fail.some((pattern) => pattern.test(sql))) throw new Error(`synthetic unreadable: ${sql.slice(0, 40)}`);
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
    async batch(x: any[]) { const out = []; for (const s of x) out.push(await s.run()); return out; },
  };
}

let TEMPLATE = '';
before(() => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const s of splitStatements(read('cloudflare-worker/sql/schema_baseline.sql'))) {
    try { db.exec(s); } catch { /* the baseline's two lp_investors triggers do not split; unrelated */ }
  }
  const dir = resolve(ROOT, 'cloudflare-worker/sql/migrations');
  for (const f of readdirSync(dir).filter((x) => /^\d+_.*\.sql$/.test(x) && Number(x.split('_')[0]) > 219).sort(compareMigrations)) {
    db.exec(readFileSync(join(dir, f), 'utf8'));
  }
  const tmp = mkdtempSync(join(tmpdir(), 'd4623p2-'));
  TEMPLATE = join(tmp, 'template.db');
  db.exec(`VACUUM INTO '${TEMPLATE}'`);
  db.close();
});
after(() => rmSync(dirname(TEMPLATE), { recursive: true, force: true }));

let copies = 0;
/**
 * Six ventures by another founder (id 11), all tier_1; venture 6's founder chose
 * "through introductions only", so an investor may not find it and the
 * investor total is 5. The members' own founder record (id 10) has no project.
 * Each member who holds Investor has match scores 80 and 70 (average 75), except BARE_INV.
 */
function freshDb() {
  const path = join(dirname(TEMPLATE), `copy-${copies++}.db`);
  copyFileSync(TEMPLATE, path);
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: false });
  const u = db.prepare(`INSERT INTO users (id, uid, email, role, name, founder_id, is_active) VALUES (?,?,?,?,?,?,1)`);
  u.run(ADMIN, 'a-admin', 'admin@example.test', 'admin', 'Test Admin', null);
  u.run(FOUNDER_INV, 'f-inv', 'f-inv@example.test', 'founder', 'Test Founder Investor', 10);
  u.run(INV, 'p-inv', 'p-inv@example.test', 'investor', 'Test Investor', null);
  u.run(ADVISOR_INV, 'a-inv', 'a-inv@example.test', 'advisor', 'Test Advisor Investor', null);
  u.run(FOUNDER_ONLY, 'f-only', 'f-only@example.test', 'founder', 'Test Founder Only', 12);
  u.run(BARE_INV, 'b-inv', 'b-inv@example.test', 'founder', 'Test Bare Investor', 13);
  u.run(CACHE_INV, 'c-inv', 'c-inv@example.test', 'founder', 'Test Cache Investor', 10);
  for (const [id, name] of [[10, 'Own Founder'], [11, 'Other Founder'], [12, 'Third Founder'], [13, 'Fourth Founder']] as const) {
    db.prepare(`INSERT INTO founders (id, name, email) VALUES (?, ?, ?)`).run(id, name, `founder-${id}@example.test`);
  }
  const g = db.prepare(`INSERT INTO account_licences (user_id, licence, source, granted_by) VALUES (?, 'investor', 'admin', ?)`);
  for (const id of [FOUNDER_INV, ADVISOR_INV, BARE_INV, CACHE_INV]) g.run(id, ADMIN);
  // An administrator who kept an Investor grant (D4472's retained primary): still no investor lens for an admin.
  g.run(ADMIN, ADMIN);
  const p = db.prepare(`INSERT INTO projects (id, uid, name, founder_id, status, sector, stage, created_at, investor_findable)
                        VALUES (?,?,?,11,'tier_1','Climate','seed',datetime('2026-01-01 00:00:00', '+' || ? || ' hours'),?)`);
  for (let id = 1; id <= 6; id++) p.run(id, `v-${id}`, `Venture ${id}`, id, id === 6 ? 0 : null);
  const s = db.prepare(`INSERT INTO match_scores (deal_id, user_id, score_type, score, model) VALUES (?, ?, 'deal_flow', ?, 'rule-based')`);
  for (const id of [FOUNDER_INV, INV, ADVISOR_INV, CACHE_INV]) { s.run(1, id, 80); s.run(2, id, 70); }
  return db;
}

async function call(db: any, path: string, as: number, role: string, opts: { fail?: RegExp[]; kv?: Map<string, string> } = {}) {
  const jwt = await new SignJWT({ user_id: as, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db, opts.fail || []) };
  if (opts.kv) {
    const kv = opts.kv;
    env.TOKENS = {
      async get(k: string, type?: string) { const v = kv.get(k); return v === undefined ? null : type === 'json' ? JSON.parse(v) : v; },
      async put(k: string, v: string) { kv.set(k, v); },
      async delete(k: string) { kv.delete(k); },
    };
  }
  const waits: Promise<unknown>[] = [];
  const ctx: any = { waitUntil: (p: Promise<unknown>) => { waits.push(p); }, passThroughOnException() {} };
  const res = await dashboard.request(path, { headers: { Authorization: `Bearer ${jwt}` } }, env, ctx);
  await Promise.all(waits);
  return { status: res.status, body: (await res.json()) as any };
}

const figures = (body: any) => ({
  total: body.proprietary_deal_flow_summary?.total,
  ai_score_avg: body.quick_stats?.ai_score_avg,
  role_view: body.role_view,
});

test('a primary investor: the payload is unchanged, with or without ?licence=investor', async () => {
  const db = freshDb();
  const plain = await call(db, '/?fresh=1', INV, 'investor');
  const lensed = await call(db, '/?fresh=1&licence=investor', INV, 'investor');
  assert.equal(plain.status, 200);
  assert.equal(lensed.status, 200);
  assert.deepEqual(figures(plain.body), { total: 5, ai_score_avg: 75, role_view: 'investor' });
  assert.deepEqual(figures(lensed.body), figures(plain.body));
  assert.deepEqual(lensed.body.proprietary_deal_flow.map((r: any) => Number(r.id)), plain.body.proprietary_deal_flow.map((r: any) => Number(r.id)));
});

test('Founder-primary with a held Investor licence: ?licence=investor computes the investor figures', async () => {
  const db = freshDb();
  const { status, body } = await call(db, '/?fresh=1&licence=investor', FOUNDER_INV, 'founder');
  assert.equal(status, 200);
  assert.deepEqual(figures(body), { total: 5, ai_score_avg: 75, role_view: 'investor' });
  // The investor lens filters what an investor may find: venture 6 is introductions-only.
  assert.deepEqual(body.proprietary_deal_flow.map((r: any) => Number(r.id)), [5, 4, 3, 2, 1]);
  // The member's own identity is not rewritten.
  assert.equal(body.user.role, 'founder');
});

test('Founder-primary without the parameter keeps the founder payload (single-licence callers unchanged)', async () => {
  const db = freshDb();
  const { status, body } = await call(db, '/?fresh=1', FOUNDER_INV, 'founder');
  assert.equal(status, 200);
  assert.equal(body.role_view, 'founder');
  assert.equal(body.proprietary_deal_flow_summary.total, 0, 'the founder\'s own projects, of which there are none');
});

test('Advisor-primary with a held Investor licence: the investor lens filters, the advisor lens did not', async () => {
  const db = freshDb();
  const advisor = await call(db, '/?fresh=1', ADVISOR_INV, 'advisor');
  assert.equal(advisor.body.proprietary_deal_flow_summary.total, 6, 'the primary lens counts the introductions-only venture');
  const investor = await call(db, '/?fresh=1&licence=investor', ADVISOR_INV, 'advisor');
  assert.equal(investor.status, 200);
  assert.deepEqual(figures(investor.body), { total: 5, ai_score_avg: 75, role_view: 'investor' });
});

test('a truly missing figure stays null, never 0', async () => {
  const db = freshDb();
  // No match score was ever recorded for this member: no average, not an average of 0.
  const bare = await call(db, '/?fresh=1&licence=investor', BARE_INV, 'founder');
  assert.equal(bare.status, 200);
  assert.equal(bare.body.quick_stats.ai_score_avg, null);
  assert.equal(bare.body.proprietary_deal_flow_summary.total, 5, 'the total is still counted');
  // A deal read that failed has no total, and says so.
  const failed = await call(db, '/?fresh=1&licence=investor', FOUNDER_INV, 'founder', { fail: [/FROM projects p LEFT JOIN match_scores/] });
  assert.equal(failed.status, 200);
  assert.equal(failed.body.proprietary_deal_flow_summary.total, null);
  assert.equal(failed.body.source_status.deals, 'unreadable');
  assert.equal(failed.body.quick_stats.ai_score_avg, 75, 'the other figure keeps its value');
});

test('a licence the member does not hold is refused, never served another licence\'s figures', async () => {
  const db = freshDb();
  const notHeld = await call(db, '/?fresh=1&licence=investor', FOUNDER_ONLY, 'founder');
  assert.equal(notHeld.status, 403);
  assert.equal(notHeld.body.error, 'licence_not_held');
  assert.equal(notHeld.body.proprietary_deal_flow_summary, undefined);
  const admin = await call(db, '/?fresh=1&licence=investor', ADMIN, 'admin');
  assert.equal(admin.status, 403, 'an admin keeps the admin payload; there is no investor lens for an admin');
  const other = await call(db, '/?fresh=1&licence=founder', FOUNDER_INV, 'founder');
  assert.equal(other.status, 400);
  assert.equal(other.body.error, 'invalid_licence');
});

test('the investor payload and the primary payload never share a cache entry', async () => {
  const db = freshDb();
  const kv = new Map<string, string>();
  const lensed = await call(db, '/?licence=investor', CACHE_INV, 'founder', { kv });
  assert.equal(lensed.body.role_view, 'investor');
  const plain = await call(db, '/', CACHE_INV, 'founder', { kv });
  assert.equal(plain.body.role_view, 'founder', 'the primary payload is not the cached investor one');
  assert.equal(plain.body.cached, false);
  const again = await call(db, '/?licence=investor', CACHE_INV, 'founder', { kv });
  assert.equal(again.body.role_view, 'investor');
  assert.notEqual(again.body.cached, false, 'the investor payload is served from its own entry');
  assert.ok([...kv.keys()].some((k) => k.endsWith(':investor')), 'the KV key carries the lens');
});
