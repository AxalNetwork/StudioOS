/**
 * D4620 (#4620) — the Studio dashboard's totals and its source status.
 *
 * The investor deal list was cut to 12 candidates and THEN filtered for what
 * the investor may find, and the page counted the rows it was handed. So 14
 * eligible ventures read as 12 (or 9), and when only older ventures qualified
 * the preview was empty although they existed. A read that failed was given a
 * stand-in (an empty list, a 0) with nothing to tell it from a true zero.
 *
 * Built on the whole baseline plus every migration, once, copied per test
 * (the D702 pattern: the findable filter reads half a dozen tables).
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/dashboard_totals_4620.test.ts
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import dashboard, { DEAL_CANDIDATE_CAP } from '../src/routes/dashboard.ts';
import { splitStatements } from './_baseline.mjs';
import { compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const INV = 3;    // an investor with no introductions
const INV2 = 4;   // a second one, so the cache test starts from an empty L1 entry
const FOUNDER = 2;

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
  const tmp = mkdtempSync(join(tmpdir(), 'd4620-'));
  TEMPLATE = join(tmp, 'template.db');
  db.exec(`VACUUM INTO '${TEMPLATE}'`);
  db.close();
});
after(() => rmSync(dirname(TEMPLATE), { recursive: true, force: true }));

let copies = 0;
function freshDb() {
  const path = join(dirname(TEMPLATE), `copy-${copies++}.db`);
  copyFileSync(TEMPLATE, path);
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: false });
  const u = db.prepare(`INSERT INTO users (id, uid, email, role, name, founder_id, is_active) VALUES (?,?,?,?,?,?,1)`);
  u.run(FOUNDER, 'fay-founder', 'fay@example.test', 'founder', 'Fay Founder', 10);
  u.run(INV, 'ian-investor', 'ian@example.test', 'investor', 'Ian Investor', null);
  u.run(INV2, 'ivy-investor', 'ivy@example.test', 'investor', 'Ivy Investor', null);
  db.prepare(`INSERT INTO founders (id, name, email) VALUES (10, 'Fay Founder', 'fay@example.test')`).run();
  return db;
}

/** Ventures 1..n, newest = highest id. `hidden` ids have their founder's findable toggle off. */
function seedVentures(db: any, n: number, hidden: number[] = []) {
  const p = db.prepare(`INSERT INTO projects (id, uid, name, founder_id, status, sector, stage, created_at, investor_findable)
                        VALUES (?,?,?,?,'tier_1','Climate','seed',datetime('2026-01-01 00:00:00', '+' || ? || ' hours'),?)`);
  for (let id = 1; id <= n; id++) {
    p.run(id, `v-${id}`, `Venture ${id}`, 10, id, hidden.includes(id) ? 0 : null);
  }
}

async function call(db: any, path: string, as = INV, role = 'investor') {
  const jwt = await new SignJWT({ user_id: as, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) };
  const res = await dashboard.request(path, { headers: { Authorization: `Bearer ${jwt}` } }, env);
  return { status: res.status, body: (await res.json()) as any };
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

test('14 eligible ventures: the total says 14 and the preview is a separate, bounded list of 12', async () => {
  const db = freshDb();
  // 16 candidates; the founder hid two of the newest twelve.
  seedVentures(db, 16, [15, 13]);
  const { status, body } = await call(db, '/?fresh=1');
  assert.equal(status, 200);
  assert.equal(body.proprietary_deal_flow_summary.total, 14);
  assert.equal(body.proprietary_deal_flow_summary.preview_limit, 12);
  assert.equal(body.proprietary_deal_flow_summary.previewed, 12);
  assert.equal(body.proprietary_deal_flow.length, 12);
  assert.equal(body.proprietary_deal_flow_summary.total_is_lower_bound, false);
  // The preview is the NEWEST eligible, so the hidden ones are not in it.
  const ids = body.proprietary_deal_flow.map((r: any) => Number(r.id));
  assert.deepEqual(ids, [16, 14, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
});

test('qualifying ventures beyond the first twelve candidates still fill the preview', async () => {
  const db = freshDb();
  // The twelve newest are all hidden; only the three oldest qualify.
  seedVentures(db, 15, range(4, 15));
  const { body } = await call(db, '/?fresh=1');
  assert.equal(body.proprietary_deal_flow_summary.total, 3);
  assert.deepEqual(body.proprietary_deal_flow.map((r: any) => Number(r.id)), [3, 2, 1]);
});

test('a true zero is 0, from a read that answered', async () => {
  const db = freshDb();
  const { body } = await call(db, '/?fresh=1');
  assert.equal(body.proprietary_deal_flow_summary.total, 0);
  assert.equal(body.proprietary_deal_flow.length, 0);
  assert.equal(body.source_status.deals, 'ready');
});

test('a deal read that failed has no total, and says it is unreadable', async () => {
  const db = freshDb();
  seedVentures(db, 5);
  db.exec('ALTER TABLE projects RENAME TO projects_away');
  const { status, body } = await call(db, '/?fresh=1');
  assert.equal(status, 200);
  assert.equal(body.proprietary_deal_flow_summary.total, null, 'a failed read is not a total of 0');
  assert.equal(body.source_status.deals, 'unreadable');
  assert.equal(body.source_status.syndicatesAll, 'ready', 'the other reads keep their own status');
});

test('a payload carrying a stand-in is not served from the cache afterwards', async () => {
  const db = freshDb();
  seedVentures(db, 5);
  db.exec('ALTER TABLE projects RENAME TO projects_away');
  const first = await call(db, '/?fresh=1', INV2);
  assert.equal(first.body.source_status.deals, 'unreadable');
  db.exec('ALTER TABLE projects_away RENAME TO projects');
  const second = await call(db, '/', INV2);
  assert.equal(second.body.cached, false, 'the failure was cached');
  assert.equal(second.body.proprietary_deal_flow_summary.total, 5);
});

test('above the candidate cap the total is a floor, and says so', async () => {
  const db = freshDb();
  db.exec('BEGIN');
  seedVentures(db, DEAL_CANDIDATE_CAP + 5);
  db.exec('COMMIT');
  const { body } = await call(db, '/?fresh=1');
  assert.equal(body.proprietary_deal_flow_summary.total, DEAL_CANDIDATE_CAP);
  assert.equal(body.proprietary_deal_flow_summary.total_is_lower_bound, true);
  assert.equal(body.proprietary_deal_flow.length, 12);
});

test('a founder is not filtered, and gets a total as well', async () => {
  const db = freshDb();
  seedVentures(db, 14);
  const { body } = await call(db, '/?fresh=1', FOUNDER, 'founder');
  assert.equal(body.proprietary_deal_flow_summary.total, 14);
  assert.equal(body.proprietary_deal_flow.length, 12);
});

test('lifecycle: a count whose read failed is null, the others keep their numbers', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO investor_introductions (uid, investor_user_id, project_id, quarter) VALUES ('i-1', ?, 1, '2026Q4')`).run(INV);
  db.exec('ALTER TABLE watchlist_items RENAME TO watchlist_items_away');
  const { status, body } = await call(db, '/investor-lifecycle');
  assert.equal(status, 200);
  assert.equal(body.counts.watching, null, 'a failed read is not 0 watching');
  assert.equal(body.counts.intros, 1);
  assert.equal(body.sources['inv:watching'], 'unreadable');
  assert.equal(body.sources['inv:intros'], 'ready');
  assert.equal(body.partial, true);
  const watching = body.stages.find((s: any) => s.id === 'watching');
  assert.equal(watching.count, null);
});

test('lifecycle: a true zero is 0 and is not partial', async () => {
  const db = freshDb();
  const { body } = await call(db, '/investor-lifecycle');
  assert.equal(body.counts.watching, 0);
  assert.equal(body.partial, false);
});

test('lifecycle: when no count could be read the route fails instead of drawing an empty funnel', async () => {
  const db = freshDb();
  for (const t of ['watchlist_items', 'investor_introductions', 'investor_dealroom_members', 'dd_cases', 'ic_decisions', 'decision_journal_entries', 'portfolio_positions', 'secondary_listings']) {
    db.exec(`ALTER TABLE ${t} RENAME TO ${t}_away`);
  }
  const { status, body } = await call(db, '/investor-lifecycle');
  assert.equal(status, 503);
  assert.equal(body.error, 'unreadable');
});
