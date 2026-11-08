/**
 * D4814 (#4814) — Approvals v2, part 1: the inbox read carries the Unassigned
 * figure across every lane (not one page), the overdue items nobody holds,
 * the oldest item with its lane, and, when a lane failed or was cut at the
 * cap, floors ("127+") rather than nothing. A read, no migration.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/admin_approvals_v2_4814.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import adminApprovalRoutes from '../src/routes/admin_approvals.ts';
import { INBOX_LANE_CAP, INBOX_PAGE_SIZE } from '../src/services/approvalAssignments.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d4814-0123456789';
const SUPER = 1, ADA = 2, BEA = 3, FOUNDER = 4;

const BUILT = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  return db;
})();

const stamp = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);

function fresh(seed: { jobs?: number[]; lp?: number[] } = {}) {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  const objs = BUILT.prepare(`SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
                               ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as any[];
  for (const o of objs) { try { db.exec(o.sql); } catch { /* views and triggers naming absent objects */ } }
  db.exec('PRAGMA foreign_keys = OFF');
  const user = db.prepare('INSERT INTO users (id, uid, email, name, role, is_active) VALUES (?, ?, ?, ?, ?, 1)');
  for (const [id, role, name] of [[SUPER, 'admin', 'Admin S'], [ADA, 'admin', 'Admin A'], [BEA, 'admin', 'Admin B'], [FOUNDER, 'founder', 'Person F']] as const) {
    user.run(id, `u-${id}`, `person${id}@example.com`, name, role);
  }
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  const job = db.prepare(`INSERT INTO job_postings (id, slug, host_user_id, title, status, created_at) VALUES (?, ?, ?, ?, 'pending_review', ?)`);
  (seed.jobs ?? []).forEach((h, i) => job.run(100 + i, `role-${i}`, FOUNDER, `Role ${i}`, stamp(h)));
  const lp = db.prepare(`INSERT INTO lp_applications (id, user_id, fund_slug, investor_type, status, created_at) VALUES (?, ?, ?, 'individual', 'pending', ?)`);
  (seed.lp ?? []).forEach((h, i) => lp.run(200 + i, FOUNDER, `fund-${i}`, stamp(h)));
  const app = new Hono<any>();
  app.route('/api/admin/approvals', adminApprovalRoutes);
  return { db, app, env: { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any };
}

async function call(f: any, id: number, path: string, method = 'GET', body?: unknown) {
  const token = await new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(`/api/admin/approvals${path.replace(/^\/(?=\?|$)/, '')}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }, f.env);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, body: json, text };
}

/** 30 jobs from 100h to 13h ago in 3h steps, and two LP applications (80h, 2h): 32 items, two pages. */
const SEED = { jobs: Array.from({ length: 30 }, (_, i) => 100 - i * 3), lp: [80, 2] };

test('Unassigned counts every lane, not one page, and agrees with the Unassigned view\'s total', async () => {
  const f = fresh(SEED);
  try {
    const first = (await call(f, ADA, '/')).body;
    assert.equal(first.total, 32);
    assert.equal(first.items.length, INBOX_PAGE_SIZE, 'the page is shorter than the figure');
    assert.equal(first.tiles.unassigned, 32, 'nobody holds anything yet');
    // Assign two overdue jobs and the youngest LP application (on page 2).
    const lp2 = (await call(f, ADA, '/?page=2')).body.items.find((it: any) => it.lane === 'lp');
    assert.ok(lp2, 'the 2h LP application is on page 2');
    const picks = [{ lane: 'jobs', item_id: 100 }, { lane: 'jobs', item_id: 101 }, { lane: 'lp', item_id: lp2.id }];
    assert.equal((await call(f, ADA, '/assignments', 'POST', { assignee_user_id: BEA, items: picks })).status, 200);

    const r = (await call(f, ADA, '/')).body;
    assert.equal(r.tiles.unassigned, 29, 'an item assigned on page 2 still leaves the figure');
    // Over 72 hours: jobs 100h…73h (10) and LP 80h = 11; two of them now held.
    assert.equal(r.tiles.over_72h, 11);
    assert.equal(r.tiles.overdue_unassigned, 9);
    assert.equal(r.tiles.complete, true);
    assert.equal('at_least' in r.tiles, false, 'no floors when every lane was read');
    const view = (await call(f, ADA, '/?assigned=none')).body;
    assert.equal(view.total, r.tiles.unassigned, 'the Unassigned view and the figure agree');
    assert.equal(view.unfiltered_total, r.total, 'and All is the same number as Waiting');
    assert.equal((await call(f, BEA, '/')).body.tiles.assigned_to_me, 3);
    assert.deepEqual(r.tiles.oldest, { age_hours: r.items[0].age_hours, lane: 'jobs', label: 'Jobs' });
    assert.ok(Math.round(r.tiles.oldest.age_hours) === 100);
  } finally { f.db.close(); }
});

test('a failed lane: no figure is shown short — floors say "at least", and complete is false', async () => {
  const f = fresh(SEED);
  try {
    assert.equal((await call(f, ADA, '/assignments', 'POST', { assignee_user_id: BEA, items: [{ lane: 'jobs', item_id: 100 }] })).status, 200);
    f.db.exec('DROP TABLE lp_applications');
    const r = (await call(f, ADA, '/')).body;
    assert.deepEqual(r.unreadable, ['LP applications']);
    assert.deepEqual([r.tiles.unassigned, r.tiles.overdue_unassigned, r.tiles.over_72h], [null, null, null]);
    assert.equal(r.tiles.complete, false);
    assert.deepEqual(r.tiles.at_least, { over_72h: 10, unassigned: 29, assigned_to_me: 0 });
    assert.equal(r.tiles.oldest.lane, 'jobs', 'the oldest of the lanes that answered');
  } finally { f.db.close(); }
});

test('an unreadable assignment record: Unassigned is not read, never "everything"', async () => {
  const f = fresh(SEED);
  try {
    f.db.exec('DROP TABLE approval_assignments');
    const r = (await call(f, ADA, '/')).body;
    assert.equal(r.tiles.unassigned, null);
    assert.equal(r.tiles.overdue_unassigned, null);
    assert.equal(r.tiles.over_72h, 11, 'the age figure needs no assignments');
    assert.equal(r.tiles.complete, true);
  } finally { f.db.close(); }
});

test('a lane read to its cap: Unassigned is a floor from the rows read', async () => {
  const f = fresh({ jobs: Array.from({ length: INBOX_LANE_CAP + 3 }, (_, i) => 2000 - i) });
  try {
    const r = (await call(f, ADA, '/')).body;
    assert.deepEqual(r.capped, ['Jobs']);
    assert.equal(r.tiles.unassigned, null);
    assert.equal(r.tiles.at_least.unassigned, INBOX_LANE_CAP);
    assert.equal(r.total, INBOX_LANE_CAP + 3, 'the total is still exact');
  } finally { f.db.close(); }
});

test('nothing waiting: Unassigned is a measured 0 and there is no oldest', async () => {
  const f = fresh({});
  try {
    const r = (await call(f, ADA, '/')).body;
    assert.equal(r.total, 0);
    assert.equal(r.tiles.unassigned, 0);
    assert.equal(r.tiles.oldest, null);
  } finally { f.db.close(); }
});
