/**
 * D931 (#2715) — GET /api/admin/community/overview: Admin › Community's
 * period figures, as counts.
 *
 * On node:sqlite with the tables cut from `schema_baseline.sql`, plus
 * migration 550 run as written. The service runs on a fixed clock (a
 * Wednesday) so each figure is worked out by hand in the fixture; the router
 * runs on the real clock for the gate and the 400.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/admin_community_d931.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import adminCommunityRoute from '../src/routes/admin_community.ts';
import {
  ACTIVE_MEMBERS_REASON, CIRCLE_DISCUSSIONS_REASON, DAYS_OPEN_REASON, EVENTS_PENDING_REASON, MIN_CHECKIN_COHORT,
  communityOverview, parseCommunityWeeks, participationRole,
} from '../src/services/communityOverview.ts';
import { submitForReview } from '../src/services/jobBoardCommon.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const NOW = Date.parse('2026-10-21T12:00:00Z'); // a Wednesday; the 4-week window is 2026-09-28 to 2026-10-26
const HOUR = 3_600_000;
const at = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

const SQL = resolve(process.cwd(), 'cloudflare-worker/sql');
const BASELINE = readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8');
function ddl(name: string): string {
  const i = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(i >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(i, BASELINE.indexOf(');', i) + 2);
}

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = x.map((v) => (v === undefined ? null : v)); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() { const r = db.prepare(sql).run(...b); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
      };
      return api;
    },
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run()); return out; },
  };
}

const TABLES = ['users', 'super_admins', 'user_sessions', 'projects', 'job_postings', 'job_applications', 'circles',
  'network_profiles', 'experts', 'expert_bookings', 'wellbeing_daily_pulses'];

/**
 * The fixture. Every applicant has a name and an email so the walk below can
 * prove none leaves the read.
 *
 * Applications in the window (2026-09-28 to 2026-10-26), seven:
 *   week 09-28: a guest on 101 (10-01), the advisor on 101 (09-29)      → 2
 *   week 10-05: the investor on 101 (10-06)                              → 1
 *   week 10-12: the partner on 102 (10-13), the admin on 103 (10-14)     → 2
 *   week 10-19: the founder on 101 (10-20), the explorer on 102 (10-21)  → 2 (to date)
 * The period before (2026-08-31 to 2026-09-28): one, the explorer on 101 (09-10).
 */
function seeded(pulseMembers = 8) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of TABLES) db.exec(ddl(t));
  db.exec(readFileSync(resolve(SQL, 'migrations/550_job_postings_submitted_at.sql'), 'utf8'));

  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  // users.role admits no `mentor` (its CHECK); participationRole's own test covers it.
  const roles: Array<[number, string]> = [[1, 'founder'], [2, 'investor'], [3, 'advisor'], [4, 'partner'], [5, 'exploring'], [6, 'admin']];
  for (const [id, role] of roles) u.run(id, role, `Person${id} Private`, `person${id}@secret.example`);

  db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(10, 'Acme Robotics');
  const p = db.prepare(`INSERT INTO job_postings (id, slug, host_user_id, project_id, title, status, submitted_at, created_at)
                        VALUES (?, ?, 1, ?, ?, ?, ?, '2026-01-01 09:00:00')`);
  p.run(101, 'staff-eng', 10, 'Staff Engineer', 'published', null);
  p.run(102, 'designer', null, 'Designer', 'published', null);
  p.run(103, 'ops-lead', null, 'Ops Lead', 'pending_review', at(NOW - 100 * HOUR));
  p.run(104, 'pm', null, 'PM', 'pending_review', at(NOW - 10 * HOUR));
  p.run(105, 'analyst', null, 'Analyst', 'pending_review', null); // submitted before migration 550
  p.run(106, 'draft', null, 'Draft role', 'draft', null);
  p.run(107, 'closed', null, 'Closed role', 'closed', null);
  p.run(108, 'odd', null, 'Odd role', 'archived', null);

  const a = db.prepare(`INSERT INTO job_applications (posting_id, user_id, name, email, created_at) VALUES (?, ?, ?, ?, ?)`);
  a.run(101, null, 'Guest Private', 'guest@secret.example', '2026-10-01 10:00:00');
  a.run(101, 3, 'Person3 Private', 'person3@secret.example', '2026-09-29 10:00:00');
  a.run(101, 2, 'Person2 Private', 'person2@secret.example', '2026-10-06 10:00:00');
  a.run(102, 4, 'Person4 Private', 'person4@secret.example', '2026-10-13 10:00:00');
  a.run(103, 6, 'Person6 Private', 'person6@secret.example', '2026-10-14 10:00:00');
  a.run(101, 1, 'Person1 Private', 'person1@secret.example', '2026-10-20 10:00:00');
  a.run(102, 5, 'Person5 Private', 'person5@secret.example', '2026-10-21 10:00:00');
  a.run(101, 5, 'Person5 Private', 'person5+old@secret.example', '2026-09-10 10:00:00'); // the period before
  a.run(102, 2, 'Person2 Private', 'person2+old@secret.example', '2026-08-01 10:00:00'); // before both

  const c = db.prepare('INSERT INTO circles (slug, name, type, access, members, featured, published) VALUES (?, ?, ?, ?, ?, ?, ?)');
  c.run('c1', 'Builders', 'founder', 'public', 40, 1, 1);
  c.run('c2', 'Backers', 'investor', 'private', 12, 0, 1);
  c.run('c3', 'Draft circle', 'founder', 'public', 5, 0, 0);

  const nwk = db.prepare('INSERT INTO network_profiles (name, kind, is_active) VALUES (?, ?, ?)');
  nwk.run('Mentor Private', 'mentor', 1);
  nwk.run('Advisor Private', 'advisor', 1);
  nwk.run('Partner Private', 'partner', 0);
  nwk.run('Investor Private', 'investor', 1);

  const e = db.prepare('INSERT INTO experts (id, uid, name, verified, is_active, hidden_by_admin) VALUES (?, ?, ?, ?, ?, ?)');
  e.run(1, 'real-1', 'Expert1 Private', 1, 1, 0);
  e.run(2, 'real-2', 'Expert2 Private', 0, 1, 0);
  e.run(3, 'real-3', 'Expert3 Private', 1, 1, 1);
  e.run(4, 'real-4', 'Expert4 Private', 1, 0, 0);
  e.run(5, 'seed_sample', 'Sample Private', 1, 1, 0);
  const b = db.prepare('INSERT INTO expert_bookings (expert_id, user_id, created_at) VALUES (?, ?, ?)');
  b.run(1, 1, '2026-10-07 10:00:00');
  b.run(2, 2, '2026-10-20 10:00:00');
  b.run(5, 3, '2026-10-08 10:00:00'); // a sample expert: never counted
  b.run(1, 4, '2026-09-15 10:00:00'); // the period before

  const w = db.prepare('INSERT INTO wellbeing_daily_pulses (user_id, day, mood_enc) VALUES (?, ?, ?)');
  for (let i = 0; i < pulseMembers; i++) {
    w.run(100 + i, '2026-10-05', 'ciphertext-not-to-be-read');
    w.run(100 + i, '2026-10-06', 'ciphertext-not-to-be-read'); // the same member twice is one member
  }
  w.run(999, '2026-09-01', 'ciphertext-not-to-be-read'); // before the window
  return db;
}

const env = (db: InstanceType<typeof DatabaseSync>) => ({ DB: makeD1(db), ENVIRONMENT: 'development' }) as any;
const read = (db = seeded(), weeks: 4 | 12 | 52 = 4) => communityOverview(env(db), weeks, NOW);

test('the window is the Monday weeks to date, and the period before is the same length', async () => {
  const r = await read();
  assert.deepEqual(r.week_starts, ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19']);
  assert.equal(r.current_week, '2026-10-19');
  assert.deepEqual(r.window, { from: '2026-09-28 00:00:00', to: '2026-10-26 00:00:00' });
  assert.deepEqual(r.previous, { from: '2026-08-31 00:00:00', to: '2026-09-28 00:00:00' });
  assert.equal((await read(seeded(), 12)).week_starts.length, 12);
  assert.equal((await read(seeded(), 52)).week_starts.length, 52);
});

test('queue: the jobs waiting, Overdue after 72 hours from submission, and a wait not recorded is not a wait of 0', async () => {
  const q = (await read()).blocks.queue;
  assert.equal(q.overdue_hours, 72);
  assert.deepEqual(q.jobs, {
    available: true, pending: 3, overdue: 1, wait_not_recorded: 1,
    oldest_submitted_at: at(NOW - 100 * HOUR), oldest_wait_hours: 100,
  });
});

test('jobs: applications in the window and before, weekly with the current week to date, postings by status, the top five', async () => {
  const j = (await read()).blocks.jobs as any;
  assert.equal(j.available, true);
  assert.deepEqual(j.applications, { window: 7, previous: 1 });
  assert.deepEqual(j.weekly, [
    { week: '2026-09-28', count: 2, to_date: false },
    { week: '2026-10-05', count: 1, to_date: false },
    { week: '2026-10-12', count: 2, to_date: false },
    { week: '2026-10-19', count: 2, to_date: true },
  ]);
  assert.deepEqual(j.by_status, { draft: 1, pending_review: 3, published: 2, rejected: 0, closed: 1, other: 1 });
  assert.deepEqual(j.top, [
    { title: 'Staff Engineer', company: 'Acme Robotics', status: 'published', applications: 4 },
    { title: 'Designer', company: null, status: 'published', applications: 2 },
    { title: 'Ops Lead', company: null, status: 'pending_review', applications: 1 },
  ]);
  assert.deepEqual(j.days_open, { recorded: false, reason: DAYS_OPEN_REASON });
});

test('participation by role: one key per role, Operating Partner is `partner`, no account is a guest', async () => {
  const p = (await read()).blocks.participation_by_role as any;
  assert.deepEqual(p.jobs, {
    available: true,
    by_role: { founder: 1, investor: 1, advisor: 1, operating_partner: 1, explorer: 1, guest: 1, other: 1 },
  });
  assert.equal(participationRole('mentor', true), 'advisor');
  assert.equal(participationRole('partner', true), 'operating_partner');
  assert.equal(participationRole('explorer', true), 'explorer');
  assert.equal(participationRole('founder', false), 'guest');
  assert.equal(participationRole('', true), 'other');
});

test('circles: totals by state, type and access, and the members as entered, typed', async () => {
  assert.deepEqual((await read()).blocks.circles, {
    available: true, total: 3, published: 2, draft: 1, featured: 1,
    by_type: { founder: 2, investor: 1 }, by_access: { public: 2, private: 1 },
    members_entered: { value: 57, typed: true },
  });
});

test('network: by kind with mentor as advisor, active and inactive', async () => {
  assert.deepEqual((await read()).blocks.network, {
    available: true, by_kind: { advisor: 2, partner: 1, investor: 1 }, active: 3, inactive: 1,
  });
});

test('wellbeing: experts by state and bookings without the sample experts; the check-in band', async () => {
  const w = (await read()).blocks.wellbeing as any;
  assert.deepEqual(w.experts, { available: true, verified: 1, unverified: 1, hidden: 1, inactive: 1 });
  assert.deepEqual(w.bookings, {
    available: true, window: 2, previous: 1,
    weekly: [
      { week: '2026-09-28', count: 0, to_date: false },
      { week: '2026-10-05', count: 1, to_date: false },
      { week: '2026-10-12', count: 0, to_date: false },
      { week: '2026-10-19', count: 1, to_date: true },
    ],
  });
  assert.deepEqual(w.checkins, { available: true, withheld: false, min_cohort: 7, band: { at_least: 5, under: 10 } });
});

test('wellbeing: a cohort under seven withholds the band', async () => {
  assert.equal(MIN_CHECKIN_COHORT, 7);
  const six = (await read(seeded(6))).blocks.wellbeing as any;
  assert.deepEqual(six.checkins, { available: true, withheld: true, min_cohort: 7, band: null });
  const seven = (await read(seeded(7))).blocks.wellbeing as any;
  assert.deepEqual(seven.checkins.band, { at_least: 5, under: 10 });
});

test('the check-in band never reads an answer column', () => {
  const src = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/services/communityOverview.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); // the code, not what its comments say
  assert.doesNotMatch(src, /_enc\b|_plain\b|decrypt/, 'the read names no answer column and decrypts nothing');
  assert.doesNotMatch(src, /\/api\/wellbeing\/aggregate/);
});

test('the events parts answer unreadable until D918, and the blocks no store holds are not recorded', async () => {
  const b = (await read()).blocks as any;
  const pending = { available: false, unreadable: true, reason: EVENTS_PENDING_REASON };
  assert.deepEqual(b.events, pending);
  assert.deepEqual(b.queue.events, pending);
  assert.deepEqual(b.participation_by_role.events, pending);
  assert.deepEqual(b.active_members, { recorded: false, reason: ACTIVE_MEMBERS_REASON });
  assert.deepEqual(b.circle_discussions, { recorded: false, reason: CIRCLE_DISCUSSIONS_REASON });
});

test('a failed store fails its own blocks only, never as a zero', async () => {
  const db = seeded();
  db.exec('DROP TABLE job_applications');
  db.exec('DROP TABLE circles');
  const b = (await read(db)).blocks as any;
  for (const x of [b.jobs, b.participation_by_role.jobs, b.circles]) {
    assert.equal(x.available, false);
    assert.equal(x.unreadable, true);
    assert.match(x.reason, /could not be read on this database\. That is not the same as none\./);
    assert.equal(Object.keys(x).length, 3, 'a failed block carries no figure');
  }
  assert.equal(b.queue.jobs.available, true, 'the queue reads job_postings, which still answers');
  assert.equal(b.network.available, true);
  assert.equal(b.wellbeing.experts.available, true);
});

test('counts only: no name, email or account id anywhere in the answer', async () => {
  const r = await read();
  const text = JSON.stringify(r);
  assert.doesNotMatch(text, /@|Private|secret/);
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}[${i}]`));
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        assert.ok(!/^(email|name|user_id|host_user_id|id|uid)$/.test(k), `${path}.${k} is a person's detail`);
        walk(x, `${path}.${k}`);
      }
    }
  };
  walk(r, 'overview');
});

test('submitting a posting for review records when (migration 550)', async () => {
  const db = seeded();
  const posting = db.prepare('SELECT * FROM job_postings WHERE id = 106').get() as any;
  const out = await submitForReview(env(db), posting, { id: 1, role: 'founder' } as any);
  assert.equal(out.ok, true);
  const row = db.prepare('SELECT status, submitted_at FROM job_postings WHERE id = 106').get() as any;
  assert.equal(row.status, 'pending_review');
  assert.match(String(row.submitted_at), /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
});

test('weeks: 4, 12 or 52, and 4 when absent', () => {
  assert.equal(parseCommunityWeeks(undefined), 4);
  assert.equal(parseCommunityWeeks(''), 4);
  assert.equal(parseCommunityWeeks('12'), 12);
  assert.equal(parseCommunityWeeks('52'), 52);
  for (const bad of ['7', '4.0', '012', 'year', '-4']) assert.equal(parseCommunityWeeks(bad), null, bad);
});

// ---------------------------------------------------------------------------
// The route: the gate and the 400.
// ---------------------------------------------------------------------------

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 901;
const MEMBER = 903;

const app = new Hono<any>();
app.route('/api/admin/community', adminCommunityRoute);
app.onError((err: any, c) => {
  const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});

async function get(db: InstanceType<typeof DatabaseSync>, qs: string, as: number) {
  const t = await new SignJWT({ user_id: as, role: as === MEMBER ? 'founder' : 'admin', jti: `j-${as}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(`/api/admin/community/overview${qs}`, { headers: { Authorization: `Bearer ${t}` } },
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any);
  return { status: res.status, body: await res.json() as any };
}

function routeDb() {
  const db = seeded();
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(ADMIN, 'admin', 'Admin Private', 'admin@secret.example');
  u.run(MEMBER, 'founder', 'Member Private', 'member@secret.example');
  const ss = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))");
  for (const id of [ADMIN, MEMBER]) ss.run(id, `j-${id}`);
  return db;
}

test('the route: any admin reads, with no HQ gate; a member is refused; a bad weeks is a 400', async () => {
  const db = routeDb();
  const ok = await get(db, '?weeks=12', ADMIN);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.weeks, 12);
  assert.equal(ok.body.week_starts.length, 12);
  assert.equal((await get(db, '', ADMIN)).body.weeks, 4);
  assert.equal((await get(db, '', MEMBER)).status, 403);
  const bad = await get(db, '?weeks=7', ADMIN);
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body, { code: 'bad_weeks', detail: 'weeks must be 4, 12 or 52.' });
});
