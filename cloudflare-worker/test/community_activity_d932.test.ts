/**
 * D932 (#2716) — Admin · Community's Recent activity:
 * GET /api/admin/community/activity, merged across five sources and paged,
 * with no member named.
 *
 * Real SQLite behind the real route. The audit rows are written the way the
 * consoles write them (report_type and filters_json as `routes/admin_events.ts`,
 * `admin_jobs.ts`, `admin_circles.ts` and `logAdminAction` do), and the
 * wellbeing rows by the real verify and hide routes.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/community_activity_d932.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import communityRoute from '../src/routes/admin_community.ts';
import wellbeingRoute from '../src/routes/wellbeing.ts';
import { ACTIVITY_LIMIT_MAX, ACTIVITY_WINDOW_MAX } from '../src/services/communityActivity.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 1;
const MEMBER = 2;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

/** People whose details must never reach a row. */
const PEOPLE = ['Ada Admin', 'ada@admin.example', 'Mo Member', 'mo@member.example', 'Rae Registrant', 'rae@reg.example', 'Dr Elena Expert'];

function seed(opts: { drop?: string[] } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'super_admins', 'user_sessions', 'admin_audit_log', 'events', 'event_registrations', 'job_postings', 'circles', 'experts']) db.exec(ddl(t));
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@admin.example');
  u.run(MEMBER, 'founder', 'Mo Member', 'mo@member.example');
  const ev = db.prepare(`INSERT INTO events (id, slug, title, starts_at, status, host_user_id) VALUES (?, ?, ?, '2026-11-01 18:00:00', ?, ?)`);
  ev.run(10, 'demo-night', 'Demo Night', 'published', MEMBER);
  ev.run(11, 'founder-dinner', 'Founder Dinner', 'cancelled', MEMBER);
  ev.run(12, 'pitch-100', 'Pitch 100% Live', 'pending_review', MEMBER);
  const job = db.prepare(`INSERT INTO job_postings (id, slug, title, status, host_user_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)`);
  job.run(20, 'cto', 'Founding CTO', 'published', MEMBER, '2026-10-20 09:00:00');
  job.run(21, 'designer', 'Product Designer', 'pending_review', MEMBER, '2026-10-21 10:00:00');
  job.run(22, 'ops', 'Ops Lead', 'closed', MEMBER, '2026-10-19 11:00:00');
  job.run(23, 'draft', 'Draft Role', 'draft', MEMBER, '2026-10-22 11:00:00'); // a draft is not activity
  db.prepare(`INSERT INTO circles (id, slug, name, published, featured) VALUES (30, 'climate', 'Climate Founders', 1, 1)`).run();
  const audit = db.prepare(`INSERT INTO admin_audit_log (admin_user_id, action, report_type, filters_json, exported_at) VALUES (?, ?, ?, ?, ?)`);
  audit.run(ADMIN, 'event_approved', 'events', JSON.stringify({ event_id: 10 }), '2026-10-22 08:00:00');
  audit.run(ADMIN, 'event_cancelled', 'events', JSON.stringify({ event_id: 11 }), '2026-10-23 08:00:00');
  audit.run(ADMIN, 'event_featured', 'events', JSON.stringify({ event_id: 10, featured: true }), '2026-10-23 09:00:00');
  audit.run(ADMIN, 'event_capacity_override', 'events', JSON.stringify({ event_id: 10, capacity: 40 }), '2026-10-23 09:30:00'); // not a listed act
  audit.run(MEMBER, 'event_submitted', null, JSON.stringify({ event_id: 12 }), '2026-10-21 12:00:00');
  audit.run(ADMIN, 'job_approved', 'jobs', JSON.stringify({ posting_id: 20 }), '2026-10-20 09:00:00');
  audit.run(ADMIN, 'circle_published', 'circles', JSON.stringify({ circle_id: 30 }), '2026-10-18 10:00:00');
  audit.run(ADMIN, 'circle_featured', 'circles', JSON.stringify({ circle_id: 30, featured: true }), '2026-10-18 11:00:00');
  audit.run(ADMIN, 'expert_verified', 'wellbeing', JSON.stringify({ expert_uid: 'exp-1' }), '2026-10-17 10:00:00');
  audit.run(ADMIN, 'analytics_export', 'users', '{}', '2026-10-24 10:00:00'); // not community
  const reg = db.prepare(`INSERT INTO event_registrations (event_id, user_id, email, name, status, registered_at) VALUES (?, ?, ?, ?, ?, ?)`);
  reg.run(10, MEMBER, 'mo@member.example', 'Mo Member', 'registered', '2026-10-24 09:00:00');
  reg.run(10, null, 'rae@reg.example', 'Rae Registrant', 'registered', '2026-10-24 09:30:00');
  reg.run(10, null, 'x@reg.example', 'X Y', 'cancelled', '2026-10-24 10:15:00');
  reg.run(10, null, 'z@reg.example', 'Z W', 'registered', '2026-10-23 07:00:00');
  db.prepare(`INSERT INTO experts (uid, name, verified) VALUES ('exp-2', 'Dr Elena Expert', 0)`).run();
  for (const t of opts.drop || []) db.exec(`DROP TABLE ${t}`);
  return db;
}

const app = new Hono<any>();
app.route('/c', communityRoute);
app.route('/wb', wellbeingRoute);
app.onError((err: any, c) => {
  const s = ({ Unauthorized: 401, 'Admin required': 403 } as any)[err?.message];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});

async function call(db: InstanceType<typeof DatabaseSync>, path: string, opts: { as?: number; method?: string; body?: unknown } = {}) {
  const jwt = await new SignJWT({ user_id: opts.as ?? ADMIN, role: opts.as === MEMBER ? 'founder' : 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(path, {
    method: opts.method || 'GET',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) });
  return { status: res.status, body: await res.json() as any };
}
const get = (db: InstanceType<typeof DatabaseSync>, qs = '', as?: number) => call(db, `/c/activity${qs}`, { as });

/** Every key and string, so no person's details can hide in a nested field. */
function walk(v: unknown, keys: string[] = [], strings: string[] = []) {
  if (Array.isArray(v)) v.forEach((x) => walk(x, keys, strings));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x, keys, strings); }
  else if (typeof v === 'string') strings.push(v);
  return { keys, strings };
}
function assertNoPerson(body: unknown) {
  const { keys, strings } = walk(body);
  assert.deepEqual(keys.filter((k) => /^(?:id|uid|name|email|phone|[a-z_]*_(?:id|uid|name|email|phone))$/i.test(k)), [], 'no key names a person or a record');
  assert.deepEqual(strings.filter((s) => /@/.test(s)), [], 'no email');
  const text = JSON.stringify(body);
  for (const p of PEOPLE) assert.ok(!text.includes(p), `${p} reached the read`);
  assert.doesNotMatch(text, /exp-1|exp-2/, 'no expert uid');
}

test('every source answers: events, jobs, circles, daily registration counts and wellbeing, newest first', async () => {
  const { status, body } = await get(seed(), '?limit=50');
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body.unreadable, []);
  assert.deepEqual(body.sources, ['events', 'jobs', 'circles', 'event_registrations', 'wellbeing']);
  assert.deepEqual(body.rows.map((r: any) => [r.at, r.kind, r.actor, r.sentence]), [
    ['2026-10-24T10:15:00Z', 'events', 'member', '3 registrations for “Demo Night” on 2026-10-24.'],
    ['2026-10-23T09:00:00Z', 'events', 'admin', 'An admin featured “Demo Night”.'],
    ['2026-10-23T08:00:00Z', 'events', 'admin', 'An admin cancelled “Founder Dinner”.'],
    ['2026-10-23T07:00:00Z', 'events', 'member', '1 registration for “Demo Night” on 2026-10-23.'],
    ['2026-10-22T08:00:00Z', 'events', 'admin', 'An admin published “Demo Night”.'],
    ['2026-10-21T12:00:00Z', 'events', 'member', '“Pitch 100% Live” was submitted for review.'],
    ['2026-10-21T10:00:00Z', 'jobs', 'member', '“Product Designer” was submitted for review.'],
    ['2026-10-20T09:00:00Z', 'jobs', 'admin', 'An admin published “Founding CTO”.'],
    ['2026-10-19T11:00:00Z', 'jobs', 'member', '“Ops Lead” was closed.'],
    ['2026-10-18T11:00:00Z', 'circles', 'admin', 'An admin featured “Climate Founders”.'],
    ['2026-10-18T10:00:00Z', 'circles', 'admin', 'An admin published “Climate Founders”.'],
    ['2026-10-17T10:00:00Z', 'wellbeing', 'admin', 'An admin verified a wellbeing expert.'],
  ]);
  assert.equal(body.total, 12);
  const first = body.rows[0];
  assert.deepEqual(Object.keys(first).sort(), ['actor', 'at', 'count', 'href', 'icon', 'kind', 'sentence', 'title']);
  assert.equal(first.count, 3, 'a day\'s registrations are one row, counted, whatever their status now');
  assert.equal(first.href, '/admin/events');
  assert.equal(body.rows.find((r: any) => r.kind === 'wellbeing').href, '/admin?tab=wellbeing');
  assert.equal(body.rows.find((r: any) => r.kind === 'wellbeing').title, null, 'an expert is not named');
  assert.equal(body.rows.find((r: any) => r.sentence.includes('Product Designer')).dated_by, 'last_change');
  assertNoPerson(body);
});

test('members are never named: an admin is "An admin", a member\'s act is the item or a count', async () => {
  const db = seed();
  db.prepare(`INSERT INTO admin_audit_log (admin_user_id, action, report_type, filters_json, exported_at) VALUES (?, 'event_submitted', NULL, ?, '2026-10-21 13:00:00')`)
    .run(ADMIN, JSON.stringify({ event_id: 10 }));
  const { body } = await get(db, '?limit=50');
  assert.ok(body.rows.some((r: any) => r.sentence === 'An admin submitted “Demo Night” for review.' && r.actor === 'admin'));
  for (const r of body.rows) {
    if (r.actor === 'admin') assert.match(r.sentence, /^An admin /);
    else assert.doesNotMatch(r.sentence, /admin/i);
  }
  assertNoPerson(body);
});

test('a source that fails is listed in unreadable, its rows are absent, and the others answer', async () => {
  const { status, body } = await get(seed({ drop: ['job_postings'] }), '?limit=50');
  assert.equal(status, 200);
  assert.deepEqual(body.unreadable.map((u: any) => u.source), ['jobs']);
  assert.match(body.unreadable[0].reason, /^The jobs store could not be read: .*job_postings/);
  assert.ok(!body.sources.includes('jobs'));
  assert.ok(body.rows.every((r: any) => r.kind !== 'jobs'), 'no job row is invented');
  assert.equal(body.total, 9, 'the failed source adds nothing to the total');
  const regs = await get(seed({ drop: ['event_registrations'] }), '?limit=50');
  assert.deepEqual(regs.body.unreadable.map((u: any) => u.source), ['event_registrations']);
  assert.ok(regs.body.rows.some((r: any) => r.kind === 'events'), 'the events audit still answers');
  const audit = await get(seed({ drop: ['admin_audit_log'] }), '?limit=50');
  assert.deepEqual(audit.body.unreadable.map((u: any) => u.source).sort(), ['circles', 'events', 'jobs', 'wellbeing']);
  assert.deepEqual(audit.body.rows.map((r: any) => r.count), [3, 1], 'only the registrations answer');
});

test('paging: pages are disjoint, in order, and add up to the whole; total does not move', async () => {
  const db = seed();
  const whole = (await get(db, '?limit=50')).body.rows.map((r: any) => r.sentence + r.at);
  const seen: string[] = [];
  for (let offset = 0; offset < 12; offset += 5) {
    const { body } = await get(db, `?limit=5&offset=${offset}`);
    assert.equal(body.total, 12);
    assert.equal(body.offset, offset);
    seen.push(...body.rows.map((r: any) => r.sentence + r.at));
  }
  assert.deepEqual(seen, whole);
  assert.equal((await get(db, '')).body.rows.length, 10, 'ten by default, as CM1 draws');
  assert.equal((await get(db, '?offset=40')).body.rows.length, 0);
});

test('the kind filter: events (with their registrations), jobs, circles, wellbeing, and admin actions', async () => {
  const db = seed();
  const kinds = async (k: string) => (await get(db, `?kind=${k}&limit=50`)).body;
  const ev = await kinds('events');
  assert.deepEqual([...new Set(ev.rows.map((r: any) => r.kind))], ['events']);
  assert.equal(ev.rows.length, 6);
  assert.equal(ev.total, 6);
  assert.deepEqual(ev.sources, ['events', 'event_registrations']);
  assert.equal((await kinds('jobs')).rows.length, 3);
  assert.equal((await kinds('circles')).rows.length, 2);
  assert.equal((await kinds('wellbeing')).rows.length, 1);
  const adm = await kinds('admin');
  assert.equal(adm.rows.length, 7);
  assert.ok(adm.rows.every((r: any) => r.actor === 'admin'), 'admin actions only');
  assert.deepEqual(adm.sources, ['events', 'jobs', 'circles', 'wellbeing'], 'registrations are members\' acts');
  assert.deepEqual([...new Set(adm.rows.map((r: any) => r.kind))].sort(), ['circles', 'events', 'jobs', 'wellbeing']);
});

test('the date range is inclusive at both ends, in UTC days', async () => {
  const db = seed();
  const day = (await get(db, '?from=2026-10-23&to=2026-10-23&limit=50')).body;
  assert.deepEqual(day.rows.map((r: any) => r.at), ['2026-10-23T09:00:00Z', '2026-10-23T08:00:00Z', '2026-10-23T07:00:00Z']);
  assert.equal(day.total, 3);
  assert.equal((await get(db, '?from=2026-10-24&limit=50')).body.total, 1);
  assert.equal((await get(db, '?to=2026-10-17&limit=50')).body.total, 1);
});

test('the title search is case-insensitive, matches literally, and drops untitled rows', async () => {
  const db = seed();
  const demo = (await get(db, '?q=demo%20NIGHT&limit=50')).body;
  assert.equal(demo.total, 4);
  assert.ok(demo.rows.every((r: any) => r.title === 'Demo Night'));
  const pct = (await get(db, '?q=100%25&limit=50')).body;
  assert.deepEqual(pct.rows.map((r: any) => r.title), ['Pitch 100% Live'], '% is a character, not a wildcard');
  assert.deepEqual((await get(db, '?q=%25&limit=50')).body.rows.map((r: any) => r.title), ['Pitch 100% Live'], 'a lone % matches only a title with one');
  assert.equal((await get(db, '?q=_&limit=50')).body.total, 0, '_ is a character too');
  assert.equal((await get(db, '?q=expert&limit=50')).body.total, 0, 'an untitled wellbeing row never matches');
  assert.equal((await get(db, '?q=demo&kind=admin&limit=50')).body.total, 2, 'filters combine');
});

test('a bad filter is a 400, and a member is refused', async () => {
  const db = seed();
  for (const [qs, code] of [
    ['?kind=people', 'bad_kind'], ['?from=2026-13-40', 'bad_date'], ['?from=yesterday', 'bad_date'],
    ['?from=2026-10-24&to=2026-10-01', 'bad_date'], ['?limit=0', 'bad_limit'], [`?limit=${ACTIVITY_LIMIT_MAX + 1}`, 'bad_limit'],
    ['?limit=2.5', 'bad_limit'], ['?offset=-1', 'bad_offset'], [`?offset=${ACTIVITY_WINDOW_MAX}`, 'bad_offset'],
  ]) {
    const r = await get(db, qs);
    assert.equal(r.status, 400, qs);
    assert.equal(r.body.code, code, qs);
  }
  assert.equal((await get(db, '', MEMBER)).status, 403);
});

test('verifying and hiding an expert are recorded as admin actions, without the expert\'s name', async () => {
  const db = seed();
  await call(db, '/wb/admin/experts/exp-2/verify', { method: 'POST', body: { verified: true } });
  await call(db, '/wb/admin/experts/exp-2/hide', { method: 'POST', body: { hidden: true } });
  await call(db, '/wb/admin/experts/exp-2/hide', { method: 'POST', body: { hidden: false } });
  await call(db, '/wb/admin/experts/exp-2/verify', { method: 'POST', body: { verified: false } });
  await call(db, '/wb/admin/experts/nobody/verify', { method: 'POST', body: { verified: true } });
  await call(db, '/wb/admin/experts/nobody/hide', { method: 'POST', body: { hidden: true } });
  const rows = db.prepare(`SELECT action, filters_json FROM admin_audit_log WHERE report_type = 'wellbeing' ORDER BY id`).all() as any[];
  assert.deepEqual(rows.map((r) => r.action), ['expert_verified', 'expert_verified', 'expert_hidden', 'expert_restored', 'expert_unverified'],
    'the seeded row, then the four acts; an unknown uid changes nothing and writes nothing');
  const { body } = await get(db, '?kind=wellbeing&limit=50');
  assert.deepEqual(body.rows.map((r: any) => r.sentence).sort(), [
    'An admin hid a wellbeing expert from the directory.',
    'An admin removed a wellbeing expert’s verification.',
    'An admin restored a wellbeing expert to the directory.',
    'An admin verified a wellbeing expert.',
    'An admin verified a wellbeing expert.',
  ]);
  assertNoPerson(body);
});
