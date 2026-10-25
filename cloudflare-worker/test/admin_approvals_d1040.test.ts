/**
 * D1040 (#2888) — Approvals part 2: HQ's inbox read (every waiting item,
 * oldest first, with its assignee, paged, with an exact total and the tiles),
 * and assignment and history on HQ.
 *
 * Run on a database built from the baseline and every migration, as
 * production builds it.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/admin_approvals_d1040.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import adminApprovalRoutes from '../src/routes/admin_approvals.ts';
import { APPROVAL_SOURCES, sourcesFor } from '../src/services/approvalSources.ts';
import { INBOX_LANE_CAP, INBOX_PAGE_SIZE } from '../src/services/approvalAssignments.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const JWT_SECRET = 'unit-test-jwt-secret-d1040-0123456789';

const SUPER = 1, ADA = 2, BEA = 3, FOUNDER = 4, INACTIVE = 5;

function built(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort(compareMigrations)
    .filter((x) => migrationNumber(x) > BASELINE_CUTOFF)) {
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, f), 'utf8'))) {
      try { db.exec(stmt); } catch { /* already present on the baseline */ }
    }
  }
  return db;
}
const BUILT = built();

const stamp = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);

/** `jobs`: hours-ago stamps for pending jobs (a string is stored as given); `lp`: the same for LP applications. */
function fresh(seed: { jobs?: Array<number | string>; lp?: Array<number | string> } = {}) {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  const objs = BUILT.prepare(`SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
                               ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as any[];
  for (const o of objs) { try { db.exec(o.sql); } catch { /* views and triggers naming absent objects */ } }
  db.exec('PRAGMA foreign_keys = OFF');
  for (const [id, role, name, active] of [[SUPER, 'admin', 'Sam Super', 1], [ADA, 'admin', 'Ada Admin', 1], [BEA, 'admin', 'Bea Admin', 1],
    [FOUNDER, 'founder', 'Fay Founder', 1], [INACTIVE, 'admin', 'Ian Inactive', 0]] as const) {
    db.prepare('INSERT INTO users (id, uid, email, name, role, is_active) VALUES (?, ?, ?, ?, ?, ?)').run(id, `u-${id}`, `person${id}@example.test`, name, role, active);
  }
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER})`);
  const job = db.prepare(`INSERT INTO job_postings (id, slug, host_user_id, title, status, created_at) VALUES (?, ?, ?, ?, 'pending_review', ?)`);
  (seed.jobs ?? []).forEach((h, i) => job.run(100 + i, `role-${i}`, FOUNDER, `Role ${i}`, typeof h === 'string' ? h : stamp(h)));
  db.exec(`INSERT INTO job_postings (id, slug, host_user_id, title, status, created_at) VALUES (99, 'live-role', ${FOUNDER}, 'Live role', 'published', '${stamp(500)}')`);
  const lp = db.prepare(`INSERT INTO lp_applications (id, user_id, fund_slug, investor_type, status, created_at) VALUES (?, ?, ?, 'individual', 'pending', ?)`);
  (seed.lp ?? []).forEach((h, i) => lp.run(200 + i, FOUNDER, `fund-${i}`, typeof h === 'string' ? h : stamp(h)));
  const app = new Hono<any>();
  app.route('/api/admin/approvals', adminApprovalRoutes);
  return { db, app, env: { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any };
}

async function call(f: any, id: number, path: string, method = 'GET', body?: unknown, env = f.env) {
  const token = await new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  // The client calls `/admin/approvals?page=`, with no trailing slash.
  const res = await f.app.request(`/api/admin/approvals${path.replace(/^\/(?=\?|$)/, '')}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, env);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, body: json, text };
}

/** 30 jobs from 100h to 13h ago in 3h steps, one with no readable stamp, and two LP applications. */
const SEED = { jobs: [...Array.from({ length: 30 }, (_, i) => 100 - i * 3), 'not a date'], lp: [80, 2] };

test('the inbox: oldest first across lanes, 25 a page, an exact total, an unknown age last', async () => {
  const f = fresh(SEED);
  try {
    assert.equal((await call(f, FOUNDER, '/')).status, 403);
    const p1 = await call(f, ADA, '/');
    assert.equal(p1.status, 200, p1.text);
    assert.equal(p1.body.total, 33, '31 pending jobs and 2 LP applications; the published job is not waiting');
    assert.equal(p1.body.items.length, INBOX_PAGE_SIZE);
    assert.equal(p1.body.page_size, 25);
    const p2 = (await call(f, ADA, '/?page=2')).body;
    const all = [...p1.body.items, ...p2.items];
    assert.equal(all.length, 33);
    const ages = all.map((it: any) => it.age_hours);
    assert.equal(ages.at(-1), null, 'an age that cannot be read sorts last');
    assert.equal(all.at(-1).sla, 'unknown');
    const known = ages.slice(0, -1);
    assert.deepEqual(known, [...known].sort((a, b) => b - a), 'oldest first');
    assert.equal(all[0].lane, 'jobs');
    const lp80 = all.findIndex((it: any) => it.lane === 'lp' && it.id === 200);
    assert.ok(all[lp80 - 1].age_hours >= 80 && all[lp80 + 1].age_hours <= 80, 'lanes interleave by age');
    for (const k of ['lane', 'lane_label', 'id', 'who', 'what', 'created_at', 'age_hours', 'sla', 'assignee']) assert.ok(k in all[0], k);
    assert.equal(all[0].assignee, null, 'nobody assigned reads null, because the record was read');
    assert.equal(p1.body.decides, false);
    for (const k of ['branch', 'per_lane_limit']) assert.equal(k in p1.body, false, `${k} is the branch's`);
    assert.deepEqual(p1.body.unreadable, []);
    assert.deepEqual((await call(f, ADA, '/?page=3')).body.items, []);
    for (const q of ['0', '-1', 'x', '1.5']) assert.equal((await call(f, ADA, `/?page=${q}`)).status, 400, q);
  } finally { f.db.close(); }
});

test('every unknown age sorts after every known one, from whichever lane it comes', async () => {
  // The LP lane is read first, so its unreadable stamp leads the unsorted list.
  const f = fresh({ jobs: [5, 'not a date', 40], lp: ['garbage', 20] });
  try {
    const r = (await call(f, ADA, '/')).body;
    assert.deepEqual(r.items.map((it: any) => it.age_hours === null ? null : Math.round(it.age_hours)), [40, 20, 5, null, null]);
  } finally { f.db.close(); }
});

test('assignment on HQ, the assignee on each item, history, and the three tiles', async () => {
  const f = fresh(SEED);
  try {
    const first = (await call(f, ADA, '/')).body.items;
    const pick = first.slice(0, 3).map((it: any) => ({ lane: it.lane, item_id: it.id }));
    const a = await call(f, ADA, '/assignments', 'POST', { assignee_user_id: ADA, items: pick.slice(0, 2) });
    assert.equal(a.status, 200, a.text);
    assert.deepEqual(a.body.assigned.map((x: any) => x.assignee_name), ['Ada Admin', 'Ada Admin']);
    assert.equal((await call(f, ADA, '/assignments', 'POST', { assignee_user_id: BEA, items: [pick[2]] })).status, 200);
    assert.equal((await call(f, ADA, '/assignments', 'POST', { assignee_user_id: INACTIVE, items: [pick[2]] })).body.error, 'not_a_reviewer');
    assert.equal((await call(f, ADA, '/assignments', 'POST', { assignee_user_id: ADA, items: [{ lane: 'jobs', item_id: 99 }] })).body.error, 'not_on_board');
    assert.equal((await call(f, ADA, '/assignments', 'POST', { assignee_user_id: ADA, items: [{ lane: 'nope', item_id: 1 }] })).body.error, 'bad_item');
    assert.equal(f.db.prepare(`SELECT COUNT(*) AS n FROM activity_logs WHERE action LIKE '%approval_assignment%'`).get().n >= 3, true, 'one admin-audit row per item assigned');

    const r = (await call(f, ADA, '/')).body;
    assert.deepEqual(r.items.slice(0, 3).map((it: any) => it.assignee?.name ?? null), ['Ada Admin', 'Ada Admin', 'Bea Admin']);
    assert.equal(r.items[3].assignee, null);
    // Over 72 hours: jobs 100h…73h (10) and LP 80h = 11.
    assert.equal(r.tiles.over_72h, 11);
    assert.equal(r.tiles.assigned_to_me, 2);
    assert.deepEqual(r.tiles.per_admin, [{ id: SUPER, name: 'Sam Super', count: 0 }, { id: ADA, name: 'Ada Admin', count: 2 }, { id: BEA, name: 'Bea Admin', count: 1 }]);
    assert.equal((await call(f, BEA, '/')).body.tiles.assigned_to_me, 1, 'the caller’s own');
    assert.equal('reason' in r.tiles, false);

    const h = await call(f, ADA, `/history?lane=${pick[2].lane}&item_id=${pick[2].item_id}`);
    assert.equal(h.status, 200, h.text);
    assert.deepEqual(h.body.items.map((e: any) => [e.actor_name, e.assignee_name]), [['Ada Admin', 'Bea Admin']]);
    assert.equal((await call(f, ADA, '/history?lane=jobs&item_id=0')).status, 400);
  } finally { f.db.close(); }
});

test('a failed lane is named and never an empty inbox; the tiles refuse to be short', async () => {
  const f = fresh(SEED);
  try {
    f.db.exec('DROP TABLE lp_applications');
    const r = (await call(f, ADA, '/')).body;
    assert.deepEqual(r.unreadable, ['LP applications']);
    assert.match(r.reason, /LP applications could not be read/);
    assert.equal(r.lanes.find((l: any) => l.key === 'lp').count, null, 'no count rather than a zero');
    assert.equal(r.total, 31, 'the lanes that answered, all of them');
    assert.equal(r.items.length, 25, 'the rows that could be read stay');
    assert.deepEqual([r.tiles.over_72h, r.tiles.assigned_to_me, r.tiles.per_admin], [null, null, null]);
    assert.match(r.tiles.reason, /LP applications could not be read/);
  } finally { f.db.close(); }
});

test('an unreadable assignment record leaves the items without an assignee, never "nobody"', async () => {
  const f = fresh(SEED);
  try {
    f.db.exec('DROP TABLE approval_assignments');
    const r = (await call(f, ADA, '/')).body;
    assert.equal('assignee' in r.items[0], false);
    assert.equal(r.assignments.available, false);
    assert.equal(r.tiles.over_72h, 11, 'the age tile needs no assignments');
    assert.deepEqual([r.tiles.assigned_to_me, r.tiles.per_admin], [null, null]);
    assert.match(r.tiles.reason, /not a claim that nobody is assigned/);
  } finally { f.db.close(); }
});

test('a lane read to its cap: the total from its count, the tiles withheld, an old item still assignable', async () => {
  const jobs = Array.from({ length: INBOX_LANE_CAP + 5 }, (_, i) => 2000 - i);
  const f = fresh({ jobs });
  try {
    const res = await call(f, ADA, '/');
    assert.equal(res.status, 200, res.text);
    const r = res.body;
    assert.deepEqual(r.capped, ['Jobs']);
    assert.equal(r.total, INBOX_LANE_CAP + 5, 'exact, though the read stopped at the cap');
    assert.equal(r.tiles.over_72h, null);
    assert.match(r.tiles.reason, /more open items than this read takes/);
    // The 150th oldest job: past the branch board's 100, inside HQ's read.
    const deep = await call(f, ADA, '/assignments', 'POST', { assignee_user_id: BEA, items: [{ lane: 'jobs', item_id: 100 + 149 }] });
    assert.equal(deep.status, 200, deep.text);
  } finally { f.db.close(); }
});

test('an HQ lane is a Super Admin’s: read, assigned and its history, and nobody’s on a branch', async () => {
  assert.deepEqual(sourcesFor(false, [{ key: 'a', scope: 'hq' }, { key: 'b' }] as any).map((s: any) => s.key), ['b']);
  assert.equal(sourcesFor(true, [{ key: 'a', scope: 'hq' }, { key: 'b' }] as any).length, 2);
  const hq = {
    key: 'hq_test', label: 'HQ test', scope: 'hq',
    countSql: "SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM job_postings WHERE status = 'hq_review'",
    rowsSql: "SELECT j.id AS id, j.title AS who, 'HQ · ' || j.title AS what, j.created_at AS created_at FROM job_postings j WHERE j.status = 'hq_review' ORDER BY j.created_at ASC LIMIT ?",
  };
  (APPROVAL_SOURCES as any[]).push(hq);
  const f = fresh({ jobs: [10] });
  try {
    f.db.exec(`INSERT INTO job_postings (id, slug, host_user_id, title, status, created_at) VALUES (900, 'licence-change', ${FOUNDER}, 'Licence change', 'hq_review', '${stamp(50)}')`);
    const sup = (await call(f, SUPER, '/')).body;
    assert.deepEqual(sup.items.map((it: any) => it.lane), ['hq_test', 'jobs']);
    const ada = (await call(f, ADA, '/')).body;
    assert.deepEqual(ada.items.map((it: any) => it.lane), ['jobs']);
    assert.equal(ada.lanes.some((l: any) => l.key === 'hq_test'), false);
    assert.equal(ada.total, 1);
    const item = [{ lane: 'hq_test', item_id: 900 }];
    assert.equal((await call(f, ADA, '/assignments', 'POST', { assignee_user_id: ADA, items: item })).body.error, 'bad_item');
    assert.equal((await call(f, ADA, '/history?lane=hq_test&item_id=900')).body.error, 'bad_item');
    assert.equal((await call(f, SUPER, '/assignments', 'POST', { assignee_user_id: BEA, items: item })).status, 200);
    assert.equal((await call(f, SUPER, '/history?lane=hq_test&item_id=900')).body.items.length, 1);
    const onBranch = { ...f.env, BRANCH_CODE: 'pt' };
    assert.deepEqual((await call(f, SUPER, '/', 'GET', undefined, onBranch)).body.items.map((it: any) => it.lane), ['jobs'], 'no Super Admin on a branch');
  } finally {
    (APPROVAL_SOURCES as any[]).pop();
    f.db.close();
  }
});

test('on a suspended branch the HQ route is frozen too: no assignment, and the reads still answer', async () => {
  const f = fresh({ jobs: [10] });
  try {
    f.db.exec(`INSERT INTO branch_licence (id, licence_uid, status, suspended_note, pushed_at) VALUES (1, 'lic-pt', 'suspended', 'paused', datetime('now'))`);
    const onBranch = { ...f.env, BRANCH_CODE: 'pt' };
    const frozen = await call(f, ADA, '/assignments', 'POST', { assignee_user_id: BEA, items: [{ lane: 'jobs', item_id: 100 }] }, onBranch);
    assert.equal(frozen.status, 423, frozen.text);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM approval_assignments').get().n, 0);
    assert.equal((await call(f, ADA, '/', 'GET', undefined, onBranch)).status, 200);
    assert.equal((await call(f, ADA, '/history?lane=jobs&item_id=100', 'GET', undefined, onBranch)).status, 200);
    // HQ has no licence to suspend: the same write lands there.
    assert.equal((await call(f, ADA, '/assignments', 'POST', { assignee_user_id: BEA, items: [{ lane: 'jobs', item_id: 100 }] })).status, 200);
  } finally { f.db.close(); }
});

test('mounted where the client calls it, and the branch board shares the same steps', () => {
  const index = readFileSync(resolve(ROOT, 'cloudflare-worker/src/index.ts'), 'utf8');
  assert.match(index, /app\.route\('\/api\/admin\/approvals', adminApprovalRoutes\)/);
  const branch = readFileSync(resolve(ROOT, 'cloudflare-worker/src/routes/branch_approval_assignments.ts'), 'utf8');
  assert.match(branch, /assignFromBody\(/);
  assert.match(branch, /readHistoryQuery\(/);
  const client = readFileSync(resolve(ROOT, 'frontend/src/lib/api/adminApprovals.js'), 'utf8');
  for (const p of ["'/admin/approvals/assignments'", '/admin/approvals/history?lane=', '/admin/approvals?page=']) assert.ok(client.includes(p), p);
  assert.match(readFileSync(resolve(ROOT, 'frontend/src/lib/api.js'), 'utf8'), /export \* from '\.\/api\/adminApprovals\.js';/);
});
