/**
 * D1132 (#3012) — the D1038 gaps S21 confirmed on main:
 *
 *   · HQ's inbox read: search, the lane, group, age and assigned filters, the
 *     sort, each lane's split by age band, and the one-item read;
 *   · the Product testers lane (part 4's store) and HQ's Program-grant
 *     requests lane, counted, the program requests no longer in Support's;
 *   · removing a product tester ends their open program places;
 *   · the co-marketing board's one-pitch read, and "already decided" with its
 *     code and who decided.
 *
 * The database is the baseline plus every migration above the cutoff, schema
 * only, so every lane's SQL runs against production's columns. Every person,
 * product and pitch is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/approvals_gaps_d1132.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import approvalsRoute from '../src/routes/admin_approvals.ts';
import testersRoute from '../src/routes/admin_product_testers.ts';
import comarketingRoute from '../src/routes/comarketing.ts';
import { LANE_GROUP, INBOX_GROUPS } from '../src/services/approvalInbox.ts';
import { APPROVAL_SOURCES } from '../src/services/approvalSources.ts';
import { HQ_APPROVAL_SOURCES } from '../src/services/hqApprovalSources.ts';
import { PROGRAM_REQUEST_KINDS } from '../src/services/escalationRequests.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const ROOT = process.cwd();
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const SUPER = 1, ADA = 2, BEA = 3, FOUNDER = 4, TESTER = 5, APPLICANT = 6, PARTNER = 7;

const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of readdirSync(MIGRATIONS).filter((n) => /^\d+_.*\.sql$/.test(n)).sort(compareMigrations)
    .filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

const stamp = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  const u = db.prepare('INSERT INTO users (id, uid, role, name, email, is_active, email_verified, kyc_status) VALUES (?, ?, ?, ?, ?, 1, 1, ?)');
  u.run(SUPER, 'u1', 'admin', 'Sam Super', 'sam@example.test', 'verified');
  u.run(ADA, 'u2', 'admin', 'Ada Admin', 'ada@example.test', 'verified');
  u.run(BEA, 'u3', 'admin', 'Bea Admin', 'bea@example.test', 'verified');
  u.run(FOUNDER, 'u4', 'founder', 'Fay Founder', 'fay@example.test', 'not_started');
  u.run(TESTER, 'u5', 'founder', 'Tia Tester', 'tia@example.test', 'verified');
  u.run(APPLICANT, 'u6', 'founder', 'Abe Applicant', 'abe@example.test', 'verified');
  u.run(PARTNER, 'u7', 'partner', 'Pia Partner', 'pia@example.test', 'verified');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (const id of [SUPER, ADA, BEA, FOUNDER]) {
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))")
      .run(id, `totp-${id}`);
  }
  db.exec(`
    INSERT INTO job_postings (id, slug, host_user_id, title, status, created_at) VALUES
      (100, 'role-a', ${FOUNDER}, 'Founding engineer', 'pending_review', '${stamp(100)}'),
      (101, 'role-b', ${FOUNDER}, 'Designer', 'pending_review', '${stamp(30)}'),
      (102, 'role-c', ${FOUNDER}, 'Analyst', 'pending_review', 'not a date');
    INSERT INTO lp_applications (id, user_id, fund_slug, investor_type, status, created_at) VALUES
      (200, ${FOUNDER}, 'fund-a', 'individual', 'pending', '${stamp(80)}');
    -- Product testers: one waiting, one active (not waiting).
    INSERT INTO product_testers (id, user_id, status, applied_at) VALUES (300, ${APPLICANT}, 'applied', '${stamp(5)}');
    INSERT INTO product_testers (id, user_id, status, applied_at, decided_at, decided_by) VALUES (301, ${TESTER}, 'active', '${stamp(900)}', '${stamp(800)}', ${SUPER});
    -- HQ: a studio's question (Support) and a program grant (its own lane), both open; an answered program end.
    INSERT INTO hq_escalations (id, uid, branch_code, kind, subject, raised_by_name, status, created_at) VALUES
      (400, 'e-q', 'fr', 'question', 'Seats', 'Studio Admin', 'open', '${stamp(40)}'),
      (401, 'e-g', 'fr', 'program_grant', 'Founder circles', 'Studio Admin', 'open', '${stamp(60)}'),
      (402, 'e-x', 'fr', 'program_end', 'Old program', 'Studio Admin', 'answered', '${stamp(300)}');
    INSERT INTO approval_assignments (lane, item_id, assignee_user_id, assigned_by_user_id) VALUES ('jobs', 101, ${ADA}, ${SUPER});
  `);
  return db;
}

const app = new Hono<any>();
app.route('/api/admin/approvals', approvalsRoute);
app.route('/api/admin/product-testers', testersRoute);
app.route('/api/comarketing', comarketingRoute);
app.onError((err) => {
  const m = String((err as Error)?.message || '');
  if (m === 'Unauthorized') return new Response(JSON.stringify({ error: m }), { status: 401 });
  if (m === 'Admin required') return new Response(JSON.stringify({ error: m }), { status: 403 });
  throw err;
});

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown, DB: any = d1Over(db)) {
  const token = await new SignJWT({ user_id: who, jti: `totp-${who}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error, console.log]; console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try {
    const res = await withThrownResponses(() => app.request(path, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error, console.log] = saved; }
}
const inbox = (db: DatabaseSync, who: number, qs = '') => call(db, who, 'GET', `/api/admin/approvals?page=1${qs}`);
const keys = (body: any) => body.items.map((it: any) => `${it.lane}:${it.id}`);

// ───────────────────────────────────────────── the inbox read

test('inbox: search from two characters on who, what and lane; one character does not filter', async () => {
  const db = fixture();
  const all = (await inbox(db, ADA)).body;
  assert.equal(all.total, 5, 'three jobs, one LP application, one tester application');
  // No row holds a "q": searched on one character it would match nothing, so 5 means it was not applied.
  assert.equal((await inbox(db, ADA, '&q=q')).body.total, 5, 'one character does not filter');
  assert.equal((await inbox(db, ADA, '&q=qq')).body.total, 0, 'two do');
  const designer = (await inbox(db, ADA, '&q=DESIGN')).body;
  assert.deepEqual(keys(designer), ['jobs:101'], 'case does not matter');
  assert.equal(designer.total, 1, 'the total counts what matches');
  assert.equal(designer.unfiltered_total, 5);
  assert.deepEqual(keys((await inbox(db, ADA, '&q=abe')).body), ['product_testers:300'], 'by who');
  // "testers" is in the lane's name only (the row says "Product tester application").
  assert.deepEqual(keys((await inbox(db, ADA, '&q=testers')).body), ['product_testers:300'], 'by the lane');
});

test('inbox: lane, group and age filters, each alone and together', async () => {
  const db = fixture();
  assert.deepEqual(keys((await inbox(db, ADA, '&lane=jobs')).body), ['jobs:100', 'jobs:101', 'jobs:102']);
  assert.deepEqual(keys((await inbox(db, ADA, '&group=people')).body), ['lp:200', 'product_testers:300']);
  assert.deepEqual(keys((await inbox(db, ADA, '&group=community')).body), ['jobs:100', 'jobs:101', 'jobs:102']);
  assert.deepEqual(keys((await inbox(db, ADA, '&age=past')).body), ['jobs:100', 'lp:200']);
  assert.deepEqual(keys((await inbox(db, ADA, '&age=due_soon')).body), ['jobs:101']);
  assert.deepEqual(keys((await inbox(db, ADA, '&age=ok')).body), ['product_testers:300']);
  assert.deepEqual(keys((await inbox(db, ADA, '&age=unknown')).body), ['jobs:102']);
  assert.deepEqual(keys((await inbox(db, ADA, '&group=community&age=past')).body), ['jobs:100']);
  // HQ's lanes are their own group, for a Super Admin.
  assert.deepEqual(keys((await inbox(db, SUPER, '&group=hq')).body), ['grants:401', 'support:400']);
});

test('inbox: assigned to me, to nobody, to anyone, to one admin', async () => {
  const db = fixture();
  db.exec(`INSERT INTO approval_assignments (lane, item_id, assignee_user_id, assigned_by_user_id) VALUES ('lp', 200, ${BEA}, ${SUPER})`);
  assert.deepEqual(keys((await inbox(db, ADA, '&assigned=me')).body), ['jobs:101']);
  assert.deepEqual(keys((await inbox(db, BEA, '&assigned=me')).body), ['lp:200'], 'each admin holds their own');
  assert.deepEqual(keys((await inbox(db, BEA, `&assigned=${ADA}`)).body), ['jobs:101'], 'one admin, not anyone assigned');
  assert.deepEqual(keys((await inbox(db, BEA, '&assigned=any')).body), ['lp:200', 'jobs:101']);
  assert.deepEqual(keys((await inbox(db, BEA, '&assigned=none')).body), ['jobs:100', 'product_testers:300', 'jobs:102']);
  // With the record unreadable, "assigned" is refused, never answered as nobody.
  db.exec('DROP TABLE approval_events');
  const r = await inbox(db, ADA, '&assigned=me');
  assert.deepEqual([r.status, r.body?.error], [503, 'assigned_unreadable']);
  assert.equal((await inbox(db, ADA, '&lane=jobs')).status, 200, 'the other filters still answer');
});

test('inbox: the sort — oldest first by default, newest, by lane and by who; an unknown age is last either way', async () => {
  const db = fixture();
  assert.deepEqual(keys((await inbox(db, ADA)).body), ['jobs:100', 'lp:200', 'jobs:101', 'product_testers:300', 'jobs:102']);
  assert.deepEqual(keys((await inbox(db, ADA, '&sort=newest')).body), ['product_testers:300', 'jobs:101', 'lp:200', 'jobs:100', 'jobs:102']);
  // By lane label (Jobs, LP applications, Product testers), oldest first within a lane.
  assert.deepEqual(keys((await inbox(db, ADA, '&sort=lane')).body), ['jobs:100', 'jobs:101', 'jobs:102', 'lp:200', 'product_testers:300']);
  // By who (Abe, Fay ×4), oldest first within a person.
  assert.deepEqual(keys((await inbox(db, ADA, '&sort=who')).body), ['product_testers:300', 'jobs:100', 'lp:200', 'jobs:101', 'jobs:102']);
});

test('inbox: a filter it does not read is refused; an Admin cannot name an HQ lane', async () => {
  const db = fixture();
  for (const bad of ['&lane=nope', '&group=hr', '&age=old', '&assigned=someone', '&sort=random', `&q=${'x'.repeat(101)}`, '&lane=grants']) {
    const r = await inbox(db, ADA, bad);
    assert.deepEqual([r.status, r.body?.error], [400, 'bad_filter'], bad);
  }
  assert.equal((await inbox(db, SUPER, '&lane=grants')).status, 200, 'a Super Admin may');
  assert.equal((await inbox(db, FOUNDER)).status, 403);
});

test('inbox: each lane carries its group and its split by age band; a failed lane has no split', async () => {
  const db = fixture();
  const lanes = (await inbox(db, ADA)).body.lanes;
  const jobs = lanes.find((l: any) => l.key === 'jobs');
  assert.deepEqual([jobs.group, jobs.bands], ['community', { ok: 0, due_soon: 1, past: 1, unknown: 1 }]);
  assert.deepEqual(lanes.find((l: any) => l.key === 'kyc').bands, { ok: 0, due_soon: 0, past: 0, unknown: 0 }, 'a measured empty lane splits to zeros');
  db.exec('DROP TABLE lp_applications');
  const lp = (await inbox(db, ADA)).body.lanes.find((l: any) => l.key === 'lp');
  assert.deepEqual([lp.count, lp.bands], [null, null]);
  assert.match(lp.bands_reason, /could not be read/);
});

test('inbox: the groups are the page model\'s, lane by lane', () => {
  const model = readFileSync(resolve(ROOT, 'frontend/src/pages/admin/approvals/approvalsModel.js'), 'utf8');
  const fromModel: Record<string, string> = {};
  for (const m of model.matchAll(/\{ key: '([a-z_]+)', group: '([a-z]+)'/g)) fromModel[m[1]] = m[2];
  const hqBlock = model.slice(model.indexOf('export const HQ_LANES'), model.indexOf('export const isHqLane'));
  for (const m of hqBlock.matchAll(/\{ key: '([a-z_]+)'/g)) fromModel[m[1]] = 'hq';
  assert.deepEqual(Object.keys(fromModel).length, 29);
  assert.deepEqual({ ...LANE_GROUP }, fromModel);
  // And every lane the Worker reads has a group.
  for (const s of [...APPROVAL_SOURCES, ...HQ_APPROVAL_SOURCES]) assert.ok(INBOX_GROUPS.includes(LANE_GROUP[s.key]), s.key);
});

// ───────────────────────────────────────────── one item

test('one item: the row, its assignee, its lane and its history; gone or hidden is a 404', async () => {
  const db = fixture();
  const r = await call(db, ADA, 'GET', '/api/admin/approvals/items/jobs/101');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.item.lane, r.body.item.id, r.body.item.what, r.body.item.sla], ['jobs', 101, r.body.item.what, 'due_soon']);
  assert.deepEqual(r.body.item.assignee, { user_id: ADA, name: 'Ada Admin' });
  assert.deepEqual([r.body.lane.group, r.body.lane.decided_on, r.body.lane.notifies, r.body.lane.hq], ['community', 'Jobs', 'The host', false]);
  assert.equal(r.body.history.available, true);
  assert.equal(r.body.decides, false);
  const gone = await call(db, ADA, 'GET', '/api/admin/approvals/items/jobs/999');
  assert.deepEqual([gone.status, gone.body?.error], [404, 'item_not_waiting']);
  db.exec("UPDATE job_postings SET status = 'published' WHERE id = 100");
  assert.equal((await call(db, ADA, 'GET', '/api/admin/approvals/items/jobs/100')).body?.error, 'item_not_waiting', 'decided since');
  const hidden = await call(db, ADA, 'GET', '/api/admin/approvals/items/grants/401');
  assert.deepEqual([hidden.status, hidden.body?.error], [404, 'item_not_found'], 'an Admin is not told what HQ holds');
  const sup = await call(db, SUPER, 'GET', '/api/admin/approvals/items/grants/401');
  assert.deepEqual([sup.status, sup.body.lane.hq, sup.body.lane.decided_on], [200, true, 'Licences › Program grants › Requests']);
  for (const bad of ['/items/nope/1', '/items/jobs/0', '/items/jobs/x']) {
    assert.equal((await call(db, ADA, 'GET', `/api/admin/approvals${bad}`)).status, 404, bad);
  }
  db.exec('DROP TABLE job_postings');
  const down = await call(db, ADA, 'GET', '/api/admin/approvals/items/jobs/101');
  assert.deepEqual([down.status, down.body?.error], [503, 'lane_unreadable'], 'a lane that failed is not "gone"');
});

// ───────────────────────────────────────────── the two lanes

test('lanes: a tester application waits in Product testers; a program request is HQ\'s grants lane, not Support\'s', async () => {
  const db = fixture();
  const plain = (await inbox(db, ADA)).body;
  assert.deepEqual(plain.items.filter((it: any) => it.lane === 'product_testers').map((it: any) => [it.id, it.who]), [[300, 'Abe Applicant']]);
  assert.equal(plain.lanes.find((l: any) => l.key === 'product_testers').count, 1, 'the active tester is not waiting');
  const sup = (await inbox(db, SUPER)).body;
  assert.deepEqual(sup.items.filter((it: any) => it.lane === 'grants').map((it: any) => [it.id, it.what]), [[401, 'Program grant · Founder circles']]);
  assert.deepEqual(sup.items.filter((it: any) => it.lane === 'support').map((it: any) => it.id), [400], 'Support keeps only its own');
  assert.equal(sup.total, plain.total + 2);
  // The lanes' literal kinds are D983's three, on both sides.
  const kindsIn = (sql: string) => {
    const clause = /kind (?:NOT )?IN \(([^)]*)\)/.exec(sql)?.[1] ?? '';
    return [...clause.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  };
  for (const key of ['grants', 'support']) {
    const s = HQ_APPROVAL_SOURCES.find((x) => x.key === key)!;
    assert.deepEqual(kindsIn(s.countSql), [...PROGRAM_REQUEST_KINDS], `${key} count`);
    assert.deepEqual(kindsIn(s.rowsSql), [...PROGRAM_REQUEST_KINDS], `${key} rows`);
  }
});

// ───────────────────────────────────────────── a removed tester's places

function withPlaces(db: DatabaseSync) {
  db.exec(`
    INSERT INTO testing_programmes (id, uid, owner_kind, created_by, product_name, places, status) VALUES
      (1, 'tp-live', 'hq', ${SUPER}, 'Ledger Lite', 5, 'testing'),
      (2, 'tp-open', 'hq', ${SUPER}, 'Cap Table Pro', 5, 'open'),
      (3, 'tp-done', 'hq', ${SUPER}, 'Old Beta', 5, 'closed');
    INSERT INTO testing_applications (id, uid, programme_id, user_id, status) VALUES
      (10, 'ta-picked', 1, ${TESTER}, 'picked'),
      (11, 'ta-applied', 2, ${TESTER}, 'applied'),
      (12, 'ta-closed', 3, ${TESTER}, 'picked'),
      (13, 'ta-other', 1, ${APPLICANT}, 'picked');
  `);
}
const appStatus = (db: DatabaseSync) => Object.fromEntries((db.prepare('SELECT id, status FROM testing_applications ORDER BY id').all() as any[]).map((r) => [r.id, r.status]));

test('removing a tester ends their open program places, in the same write; a closed programme\'s pick is its record', async () => {
  const db = fixture();
  withPlaces(db);
  const r = await call(db, SUPER, 'POST', '/api/admin/product-testers/301/remove', { reason: 'Left the company.' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.places_ended, 2);
  assert.deepEqual(appStatus(db), { 10: 'withdrawn', 11: 'withdrawn', 12: 'picked', 13: 'picked' });
  const events = db.prepare("SELECT programme_id, application_id, actor_user_id, action, detail FROM testing_events ORDER BY application_id").all() as any[];
  assert.deepEqual(events.map((e) => [e.programme_id, e.application_id, e.actor_user_id, e.action, JSON.parse(e.detail).reason]),
    [[1, 10, SUPER, 'place_ended', 'tester_removed'], [2, 11, SUPER, 'place_ended', 'tester_removed']]);
});

test('a pause keeps the places; a removal that does not land ends none', async () => {
  const db = fixture();
  withPlaces(db);
  const paused = await call(db, SUPER, 'POST', '/api/admin/product-testers/301/pause', { reason: 'Away for a month.' });
  assert.equal(paused.status, 200);
  assert.equal('places_ended' in paused.body, false);
  assert.deepEqual(appStatus(db), { 10: 'picked', 11: 'applied', 12: 'picked', 13: 'picked' });
  // Another admin resumes in between: this removal's conditional update misses, and nothing ends.
  const raw = d1Over(db);
  const racing = {
    ...raw,
    prepare(sql: string) {
      if (/^\s*UPDATE product_testers SET status/.test(sql)) db.exec("UPDATE product_testers SET status = 'active' WHERE id = 301");
      return raw.prepare(sql);
    },
    batch: (s: any[]) => raw.batch(s),
  };
  const r = await call(db, SUPER, 'POST', '/api/admin/product-testers/301/remove', { reason: 'Left the company.' }, racing);
  assert.deepEqual([r.status, r.body?.error], [409, 'tester_changed']);
  assert.deepEqual(appStatus(db), { 10: 'picked', 11: 'applied', 12: 'picked', 13: 'picked' });
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM testing_events').get() as any).n, 0);
});

// ───────────────────────────────────────────── co-marketing

function withPitches(db: DatabaseSync) {
  db.exec(`
    INSERT INTO partners (id, name, company, email) VALUES (1, 'Pia Partner', 'Partner Co', 'pia-partner@example.test');
    INSERT INTO comarketing_pitches (id, uid, partner_id, submitter_user_id, title, summary, asset_type, status, created_at, updated_at) VALUES
      (1, 'pitch-new', 1, ${PARTNER}, 'Hiring your first engineer', 'A webinar.', 'webinar', 'proposed', '${stamp(30)}', '${stamp(30)}'),
      (2, 'pitch-done', 1, ${PARTNER}, 'The LP letter', 'A blog.', 'blog', 'approved', '${stamp(90)}', '${stamp(20)}');
    UPDATE comarketing_pitches SET reviewed_by_user_id = ${BEA}, reviewed_at = '2026-10-20 09:00:00' WHERE id = 2;
  `);
}

test('co-marketing: one pitch for an admin, with its partner and who decided it; a member and an unknown pitch are refused', async () => {
  const db = fixture();
  withPitches(db);
  const r = await call(db, ADA, 'GET', '/api/comarketing/admin/pitches/pitch-done');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.uid, r.body.status, r.body.partner_company], ['pitch-done', 'approved', 'Partner Co']);
  assert.deepEqual(r.body.decided, { status: 'approved', by: { id: BEA, name: 'Bea Admin' }, at: '2026-10-20 09:00:00' });
  assert.equal((await call(db, ADA, 'GET', '/api/comarketing/admin/pitches/pitch-new')).body.decided, null, 'undecided says so');
  assert.equal((await call(db, FOUNDER, 'GET', '/api/comarketing/admin/pitches/pitch-done')).status, 403);
  const none = await call(db, ADA, 'GET', '/api/comarketing/admin/pitches/nope');
  assert.deepEqual([none.status, none.body?.error], [404, 'pitch_not_found']);
});

test('co-marketing: a decided pitch answers 409 pitch_decided with who decided, and is not overwritten', async () => {
  const db = fixture();
  withPitches(db);
  const again = await call(db, ADA, 'POST', '/api/comarketing/admin/pitches/pitch-done/approve', {});
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'pitch_decided');
  assert.deepEqual(again.body.decided.by, { id: BEA, name: 'Bea Admin' });
  assert.match(again.body.message, /Bea Admin approved it on 2026-10-20/);
  const decline = await call(db, ADA, 'POST', '/api/comarketing/admin/pitches/pitch-done/reject', { notes: 'Not the right audience.' });
  assert.deepEqual([decline.status, decline.body.error], [409, 'pitch_decided']);
  assert.match(decline.body.message, /cannot be declined now/);

  // Two admins at once: Bea approves between Ada's read and her write. Ada's write lands on nothing.
  const raw = d1Over(db);
  const racing = {
    ...raw,
    prepare(sql: string) {
      if (/UPDATE comarketing_pitches SET status=/.test(sql)) {
        db.exec(`UPDATE comarketing_pitches SET status = 'approved', reviewed_by_user_id = ${BEA}, reviewed_at = '2026-10-25 10:00:00' WHERE id = 1`);
      }
      return raw.prepare(sql);
    },
    batch: (s: any[]) => raw.batch(s),
  };
  const lost = await call(db, ADA, 'POST', '/api/comarketing/admin/pitches/pitch-new/reject', { notes: 'Not the right audience.' }, racing);
  assert.deepEqual([lost.status, lost.body?.error, lost.body?.decided?.by?.id], [409, 'pitch_decided', BEA]);
  const row = db.prepare('SELECT status, reviewed_by_user_id, review_notes FROM comarketing_pitches WHERE id = 1').get() as any;
  assert.deepEqual([row.status, row.reviewed_by_user_id, row.review_notes], ['approved', BEA, null], 'Bea\'s decision stands');

  // D1043 (#2891): publishing needs its HTTPS link.
  const ok = await call(db, ADA, 'POST', '/api/comarketing/admin/pitches/pitch-done/publish', { published_url: 'https://example.com/pitch' });
  assert.equal(ok.status, 200, 'a legal next step still goes through');
});
