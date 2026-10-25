/**
 * D946 (#2751) — the Spin-Out Lab participants read (SL7, SL8), the Lab-only
 * filter on the 83(b) and formation desks (SL10), and the gate arithmetic the
 * read shares with the founder's workspace.
 *
 * On a database built from the baseline and every migration, as production
 * builds it. The read runs on a fixed clock (Tuesday 10 November 2026, Week 2
 * of the November cohort) so each row is worked out by hand; the routes run on
 * the real clock for the gates and the 400s.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/lab_participants_d946.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import adminCohort from '../src/routes/admin_cohort.ts';
import admin83b from '../src/routes/admin_83b_review.ts';
import adminIncorporations from '../src/routes/admin_incorporations.ts';
import {
  LabReadError, REQUIRED_ITEMS, parseParticipantQuery, participantDetail, participantsPage,
} from '../src/services/labParticipants.ts';
import { gateFromRows, getCohortGate } from '../src/services/cohortTiming.ts';
import { MILESTONES } from '../src/services/spinoutLabCatalog.ts';
import { ensureIncorporationsSchema } from '../src/services/incorporations.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const NOW = Date.parse('2026-11-10T12:00:00Z');

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

/** A copy of BUILT's schema, empty of rows, with foreign keys off for the fixture. */
function fresh(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  const objs = BUILT.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
                               ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as any[];
  for (const o of objs) { try { db.exec(o.sql); } catch { /* views and triggers naming absent objects */ } }
  db.exec('PRAGMA foreign_keys = OFF');
  return db;
}

const SUPER = 1, ADMIN = 2, MEMBER = 3;
// Founders: on track, at risk (with an open case), in grace, failed, graduated, admitted only, legacy, outsider.
const A = 10, B = 11, C = 12, D = 13, E = 14, F = 15, G = 16, H = 17;
const NAMES: Record<number, string> = {
  [A]: 'Ada Ontrack', [B]: 'Ben Atrisk', [C]: 'Cy Grace', [D]: 'Dee Failed', [E]: 'Eve Graduate',
  [F]: 'Fay Admitted', [G]: 'Gus Legacy', [H]: 'Hal Outside',
};

const W1 = ['project_created', 'customer_interview_logged_1', 'customer_interview_logged_2', 'customer_interview_logged_3'];
const W2 = ['okrs_created', 'brand_basics_filled', 'pitch_deck_drafted'];

function fixture(db: DatabaseSync) {
  db.exec(`INSERT INTO users (id, uid, email, name, role, is_active) VALUES
    (${SUPER}, 'u-super', 'super@example.test', 'Sam Super', 'admin', 1),
    (${ADMIN}, 'u-admin', 'admin@example.test', 'Ari Admin', 'admin', 1),
    (${MEMBER}, 'u-member', 'member@example.test', 'Mo Member', 'founder', 1);
    INSERT INTO super_admins (user_id) VALUES (${SUPER});`);
  for (const id of [A, B, C, D, E, F, G, H]) {
    db.prepare(`INSERT INTO users (id, uid, email, name, role, is_active, founder_id) VALUES (?, ?, ?, ?, 'founder', 1, ?)`)
      .run(id, `u-${id}`, `founder${id}@example.test`, NAMES[id], id * 10);
    db.prepare('INSERT INTO projects (id, name, founder_id, sector) VALUES (?, ?, ?, ?)').run(id, `Co ${id}`, id * 10, 'Health');
  }
  // In the Lab: A–E active in November's cohort, E graduated, F admitted only, G started before any cycle.
  db.exec(`UPDATE users SET spinout_lab_active = 1, spinout_lab_started_at = '2026-11-01 05:00:00', spinout_lab_week = 2 WHERE id IN (${A}, ${B}, ${C}, ${D});
    UPDATE users SET spinout_lab_active = 1, spinout_lab_started_at = '2025-01-03 05:00:00' WHERE id = ${G};
    UPDATE users SET spinout_lab_started_at = '2026-10-01 04:00:00', is_incorporated = 1 WHERE id = ${E};
    INSERT INTO user_spinout_flags (user_id, spinout_lab_admitted, spinout_lab_cohort) VALUES (${F}, 1, 'Cohort 5'), (${A}, 1, 'Cohort 5');
    INSERT INTO cohort_cycles (id, year, month, start_at, end_at, status, app_status) VALUES
      (1, 2026, 11, '2026-11-01 04:00:00', '2026-11-29 05:00:00', 'active', 'closed'),
      (2, 2026, 10, '2026-10-01 04:00:00', '2026-10-29 04:00:00', 'completed', 'closed');
    INSERT INTO week_windows (cohort_cycle_id, week_number, unlock_at, deadline_at) VALUES
      (1, 1, '2026-11-01 04:00:00', '2026-11-08 05:00:00'), (1, 2, '2026-11-08 05:00:00', '2026-11-15 05:00:00'),
      (1, 3, '2026-11-15 05:00:00', '2026-11-22 05:00:00'), (1, 4, '2026-11-22 05:00:00', '2026-11-29 05:00:00');
    INSERT INTO company_week_status (user_id, cohort_cycle_id, week_number, status, grace_until, decided_at, decided_by) VALUES
      (${A}, 1, 1, 'passed', NULL, '2026-11-08 05:00:00', 'system'),
      (${B}, 1, 1, 'passed', NULL, '2026-11-08 05:00:00', 'system'),
      (${C}, 1, 1, 'grace', '2026-11-11 05:00:00', '2026-11-08 06:00:00', 'admin:2'),
      (${D}, 1, 1, 'failed', NULL, '2026-11-08 05:00:00', 'system');`);
  const ms = (who: number, keys: string[], week: number, at: string) => {
    for (const k of keys) db.prepare('INSERT INTO spinout_lab_milestones (user_id, week, milestone_key, completed_at) VALUES (?, ?, ?, ?)').run(who, week, k, at);
  };
  ms(A, W1, 1, '2026-11-05 10:00:00'); ms(A, W2, 2, '2026-11-09 10:00:00');
  ms(A, ['market_sizing_completed'], 2, '2026-11-09 11:00:00'); // optional: not a required item
  ms(B, W1, 1, '2026-11-05 10:00:00'); ms(B, ['okrs_created'], 2, '2026-11-09 10:00:00');
  ms(C, W1.slice(0, 2), 1, '2026-11-05 10:00:00');
  ms(D, W1.slice(0, 1), 1, '2026-11-05 10:00:00');
  ms(E, [...W1], 1, '2026-10-05 10:00:00'); ms(E, ['incorporation_completed'], 4, '2026-10-26 10:00:00');
  // Outsider H has a milestone but is not in the Lab by the rule.
  ms(H, ['project_created'], 1, '2026-11-02 10:00:00');
  db.exec(`INSERT INTO spinout_moderation_cases (user_id, status, reason_code, opened_by, opened_at) VALUES
    (${B}, 'under_review', 'conduct', ${ADMIN}, '2026-11-09 08:00:00');
    INSERT INTO spinout_moderation_cases (user_id, status, reason_code, opened_by, opened_at, resolved_at) VALUES
    (${A}, 'under_review', 'conduct', ${ADMIN}, '2026-11-02 08:00:00', '2026-11-03 08:00:00');`);
}

function db0() { const db = fresh(); fixture(db); return db; }
const env = (db: DatabaseSync) => ({ DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' }) as any;
const page = (db: DatabaseSync, params: Record<string, string> = {}) => {
  const p = parseParticipantQuery((k) => params[k]);
  assert.ok(p.ok, JSON.stringify(p));
  return participantsPage(env(db), (p as any).query, NOW);
};
const byUid = (items: any[]) => new Map(items.map((x) => [x.uid, x]));

const SEEN: string[] = [];
async function call(app: any, db: DatabaseSync, who: number, path: string) {
  const role = who === MEMBER ? 'founder' : 'admin';
  const token = await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res: Response = await app.request(path, { headers: { Authorization: `Bearer ${token}` } }, env(db))
    .catch((e: unknown) => { if (e instanceof Response) return e; throw e; });
  const text = await res.text();
  if (path.startsWith('/participants')) SEEN.push(text);
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = null; }
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------

test('each row: week, day, days left, progress, this week, deadline, missing and the open case', async () => {
  const r = await page(db0(), { limit: '100' });
  const m = byUid(r.items);
  assert.deepEqual([...m.keys()].sort(), [A, B, C, D, E, F, G].map((x) => `u-${x}`).sort(), 'the outsider is not a participant');

  const a = m.get(`u-${A}`);
  assert.deepEqual({ w: a.week, d: a.day, left: a.days_left, tw: a.this_week, dl: a.deadline_at, miss: a.missing, cohort: a.cohort },
    { w: 2, d: 10, left: 19, tw: 'on_track', dl: '2026-11-15 05:00:00', miss: [], cohort: '2026-11' });
  assert.deepEqual(a.progress, { done: 7, required: REQUIRED_ITEMS });
  assert.equal(a.moderation, null, 'a resolved case is not open');

  const b = m.get(`u-${B}`);
  assert.equal(b.this_week, 'at_risk');
  assert.deepEqual(b.missing, ['brand_basics_filled', 'pitch_deck_drafted']);
  assert.deepEqual(b.moderation, { state: 'under_review', since: '2026-11-09 08:00:00' });

  const c = m.get(`u-${C}`);
  assert.deepEqual({ tw: c.this_week, week: c.week, grace: c.grace_until, dl: c.deadline_at },
    { tw: 'grace', week: 1, grace: '2026-11-11 05:00:00', dl: '2026-11-08 05:00:00' }, 'a grace week holds the founder at it');

  const d = m.get(`u-${D}`);
  assert.deepEqual({ tw: d.this_week, paused: d.paused, fw: d.failed_week, week: d.week }, { tw: 'failed', paused: true, fw: 1, week: 1 });

  const e = m.get(`u-${E}`);
  assert.deepEqual({ tw: e.this_week, st: e.status, left: e.days_left, inc: e.incorporated }, { tw: 'graduated', st: 'graduated', left: null, inc: true });
  assert.deepEqual({ tw: m.get(`u-${F}`).this_week, st: m.get(`u-${F}`).status }, { tw: 'not_in_cohort', st: 'admitted' });
  assert.deepEqual({ tw: m.get(`u-${G}`).this_week, cohort: m.get(`u-${G}`).cohort }, { tw: 'not_in_cohort', cohort: null }, 'a start no cycle holds');
  assert.equal(JSON.stringify(r).includes('@example.test'), false, 'no email leaves the read');
});

test('standing, Needs a decision, filters and the total', async () => {
  const db = db0();
  const all = await page(db);
  assert.deepEqual(all.standing, {
    on_track: 1, at_risk: 1, grace: 1, failed: 1, graduated: 1, not_in_cohort: 2, everyone: 7, needs_decision: 3,
  });
  assert.equal(all.total, 7);
  const needs = await page(db, { needs: '1' });
  assert.deepEqual(needs.items.map((x: any) => x.uid).sort(), [`u-${B}`, `u-${C}`, `u-${D}`]);
  assert.equal(needs.standing.everyone, 7, 'the toggles count what every other filter keeps');
  const nov = await page(db, { cohort: '2026-11' });
  assert.equal(nov.total, 4);
  assert.deepEqual((await page(db, { this_week: 'at_risk' })).items.map((x: any) => x.uid), [`u-${B}`]);
  assert.deepEqual((await page(db, { week: '1' })).items.map((x: any) => x.uid).sort(), [`u-${C}`, `u-${D}`]);
  assert.deepEqual((await page(db, { status: 'graduated' })).items.map((x: any) => x.uid), [`u-${E}`]);
  assert.deepEqual((await page(db, { incorporated: 'yes' })).items.map((x: any) => x.uid), [`u-${E}`]);
  assert.deepEqual((await page(db, { q: 'co 12' })).items.map((x: any) => x.uid), [`u-${C}`], 'search reads the company too');
  assert.deepEqual((await page(db, { q: 'ben' })).items.map((x: any) => x.uid), [`u-${B}`]);
});

test('sorts and paging', async () => {
  const db = db0();
  const days = await page(db, { sort: 'days_left', cohort: '2026-11' });
  assert.ok(days.items.every((x: any) => x.days_left === 19));
  assert.deepEqual(days.items.map((x: any) => x.name), ['Ada Ontrack', 'Ben Atrisk', 'Cy Grace', 'Dee Failed'], 'ties break by name');
  const prog = await page(db, { sort: 'progress', cohort: '2026-11' });
  assert.deepEqual(prog.items.map((x: any) => x.progress.done), [1, 2, 5, 7], 'least done first');
  const cohort = await page(db, { sort: 'cohort' });
  assert.equal(cohort.items[0].cohort, '2026-11');
  assert.equal(cohort.items[cohort.items.length - 1].cohort, null, 'no cohort last');
  const p1 = await page(db, { sort: 'name', limit: '3' });
  const p2 = await page(db, { sort: 'name', limit: '3', offset: '3' });
  assert.deepEqual([...p1.items, ...p2.items].map((x: any) => x.name), ['Ada Ontrack', 'Ben Atrisk', 'Cy Grace', 'Dee Failed', 'Eve Graduate', 'Fay Admitted']);
  assert.equal(p2.total, 7);
});

test('a read past the participants cap says truncated', async () => {
  const db = db0();
  assert.equal((await page(db)).truncated, false);
  db.exec(`WITH RECURSIVE n(i) AS (SELECT 1000 UNION ALL SELECT i + 1 FROM n WHERE i < 6000)
    INSERT INTO users (id, uid, email, name, role, is_active, spinout_lab_active) SELECT i, 'bulk-' || i, 'bulk' || i || '@example.test', 'Bulk', 'founder', 1, 1 FROM n;`);
  const r = await page(db, { limit: '1' });
  assert.equal(r.truncated, true);
  assert.equal(r.total, 5000);
});

test('a failed inner read nulls only what it feeds, and a filter on it is refused', async () => {
  const db = db0();
  db.exec('DROP TABLE spinout_moderation_cases');
  const r = await page(db);
  assert.equal(r.total, 7);
  assert.ok(r.unreadable.moderation);
  assert.ok(r.items.every((x: any) => x.moderation === undefined), 'unread, never "no case"');
  assert.equal(r.items.find((x: any) => x.uid === `u-${B}`).this_week, 'at_risk', 'the rest stands');

  const db2 = db0();
  db2.exec('ALTER TABLE spinout_lab_milestones RENAME COLUMN completed_at TO done_at'); // the list's rule still reads it; the milestones read fails
  const r2 = await page(db2);
  assert.ok(r2.unreadable.milestones);
  const b = r2.items.find((x: any) => x.uid === `u-${B}`);
  assert.deepEqual({ p: b.progress, tw: b.this_week, miss: b.missing }, { p: null, tw: null, miss: null });
  assert.equal(r2.items.find((x: any) => x.uid === `u-${F}`).status, null, 'admitted or graduated cannot be told apart');
  assert.equal(r2.standing.not_read > 0, true);
  await assert.rejects(() => page(db2, { needs: '1' }), (e: any) => e instanceof LabReadError && e.status === 503);
  await assert.rejects(() => page(db2, { sort: 'progress' }), (e: any) => e instanceof LabReadError && e.status === 503);

  const db3 = db0();
  db3.exec('DROP TABLE users');
  await assert.rejects(() => page(db3), (e: any) => e instanceof LabReadError && e.code === 'lab_participants_unreadable');
});

test('the route: admin only, every bad filter a 400, the list failing a 503', async () => {
  const db = db0();
  const ok = await call(adminCohort, db, ADMIN, '/participants');
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.total, 7);
  assert.equal((await call(adminCohort, db, MEMBER, '/participants')).status, 403);
  for (const [q, code] of [['cohort=2026-13', 'bad_cohort'], ['status=paused', 'bad_status'], ['week=5', 'bad_week'],
    ['this_week=done', 'bad_this_week'], ['incorporated=maybe', 'bad_incorporated'], ['sort=email', 'bad_sort'],
    ['limit=0', 'bad_page'], ['limit=101', 'bad_page'], ['offset=-1', 'bad_page'], ['needs=yes', 'bad_needs']]) {
    const r = await call(adminCohort, db, ADMIN, `/participants?${q}`);
    assert.equal(r.status, 400, q);
    assert.equal(r.body.code, code, q);
  }
  const broken = fresh();
  broken.exec(`INSERT INTO users (id, uid, email, name, role, is_active) VALUES (${ADMIN}, 'u-admin', 'a@example.test', 'A', 'admin', 1);`);
  broken.exec('DROP TABLE user_spinout_flags');
  const r = await call(adminCohort, broken, ADMIN, '/participants');
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'lab_participants_unreadable');
});

test('the drawer: the row, each week\'s items, tools unlocked, the case and the history, by clock or admin', async () => {
  const db = db0();
  const d = await participantDetail(env(db), `u-${C}`, NOW);
  assert.equal(d.participant.this_week, 'grace');
  assert.deepEqual(d.weeks!.map((w: any) => [w.week, w.status, w.unlocked]), [[1, 'grace', true], [2, 'pending', true], [3, 'pending', false], [4, 'pending', false]]);
  assert.deepEqual(d.weeks![0].required.map((x: any) => [x.key, x.completed]), [
    ['project_created', true], ['customer_interview_logged_1', true], ['customer_interview_logged_2', false], ['customer_interview_logged_3', false],
  ]);
  assert.equal(d.tools!.unlocked.length, 5, 'held at Week 1, so only its tools');
  assert.equal(d.tools!.total, MILESTONES.flatMap((w) => w.unlockedFeatures).length);
  assert.deepEqual(d.history, [{ at: '2026-11-08 06:00:00', week: 1, status: 'grace', by: 'admin' }]);
  const dd = await participantDetail(env(db), `u-${D}`, NOW);
  assert.deepEqual(dd.history, [{ at: '2026-11-08 05:00:00', week: 1, status: 'failed', by: 'clock' }]);
  const e = await participantDetail(env(db), `u-${E}`, NOW);
  assert.equal(e.tools!.unlocked.length, e.tools!.total, 'a graduate has every tool');
  assert.equal(e.weeks, null);
  await assert.rejects(() => participantDetail(env(db), `u-${H}`, NOW), (x: any) => x.status === 404, 'not a participant');
  const r = await call(adminCohort, db, ADMIN, `/participants/u-${B}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.participant.moderation, { state: 'under_review', since: '2026-11-09 08:00:00' });
  assert.equal((await call(adminCohort, db, ADMIN, '/participants/nobody')).body.code, 'not_a_participant');
});

test('gateFromRows is what getCohortGate answers, so the admin row and the founder\'s workspace agree', async () => {
  const db = db0();
  for (const who of [A, B, C, D]) {
    const gate = await getCohortGate(env(db), who, NOW);
    const windows = db.prepare('SELECT week_number, unlock_at, deadline_at FROM week_windows WHERE cohort_cycle_id = 1').all() as any[];
    const statuses = db.prepare('SELECT week_number, status, grace_until FROM company_week_status WHERE user_id = ? AND cohort_cycle_id = 1').all(who) as any[];
    const pure = gateFromRows(windows.reverse(), statuses, NOW);
    const { in_cohort, cycle_id, cycle_label, server_time, ...rest } = gate as any;
    assert.deepEqual(rest, pure, `founder ${who}`);
    const row = (await participantDetail(env(db), `u-${who}`, NOW)).participant;
    assert.deepEqual({ week: row.week, dl: row.deadline_at }, { week: pure.current_week, dl: pure.current_deadline_at });
  }
});

test('?scope=lab on the 83(b) and formation desks keeps only Lab ventures; all is unchanged; anything else is a 400', async () => {
  const db = db0();
  db.exec(`INSERT INTO section_83b_trackers (project_id, user_id, taxpayer_name, grant_date, deadline_date) VALUES
    (${E}, ${E}, 'Eve', '2026-10-01', '2026-10-31'), (${H}, ${H}, 'Hal', '2026-10-01', '2026-10-31');`);
  await ensureIncorporationsSchema(env(db));
  db.exec(`INSERT INTO incorporations (user_id, project_id, jurisdiction_id, company_name, amount_cents, status, paid_at) VALUES
    (${E}, ${E}, 'us-de', 'Eve Inc', 50000, 'paid', '2026-10-20 10:00:00'),
    (${H}, ${H}, 'us-de', 'Hal Inc', 50000, 'paid', '2026-10-21 10:00:00');`);
  const lab = await call(admin83b, db, ADMIN, '/?scope=lab');
  assert.equal(lab.status, 200, JSON.stringify(lab.body));
  assert.deepEqual(lab.body.startups.map((s: any) => s.project_id), [E]);
  assert.equal(lab.body.scope, 'lab');
  const all = await call(admin83b, db, ADMIN, '/');
  assert.deepEqual(all.body.startups.map((s: any) => s.project_id).sort(), [E, H]);
  assert.equal((await call(admin83b, db, ADMIN, '/?scope=hq')).status, 400);

  const labOrders = await call(adminIncorporations, db, ADMIN, '/?scope=lab');
  assert.equal(labOrders.status, 200, JSON.stringify(labOrders.body));
  assert.deepEqual(labOrders.body.orders.map((o: any) => o.company_name), ['Eve Inc']);
  const allOrders = await call(adminIncorporations, db, ADMIN, '/?scope=all');
  assert.deepEqual(allOrders.body.orders.map((o: any) => o.company_name), ['Hal Inc', 'Eve Inc']);
  const bad = await call(adminIncorporations, db, ADMIN, '/?scope=labs');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'bad_scope');
});

test('support sessions stay Super Admin only', async () => {
  const db = db0();
  db.exec(`INSERT INTO impersonation_sessions (admin_user_id, target_user_id, context, started_at, ended_at) VALUES
    (${ADMIN}, ${B}, 'Founder could not open the cap table', '2026-11-09 14:02:00', '2026-11-09 14:19:00');`);
  const sa = await call(adminCohort, db, SUPER, '/impersonation-audit');
  assert.equal(sa.status, 200);
  assert.equal(sa.body.sessions.length, 1);
  // A plain Admin is refused (403 through index.ts's error handler; this bare router surfaces the throw).
  const plain = await call(adminCohort, db, ADMIN, '/impersonation-audit');
  assert.notEqual(plain.status, 200);
  assert.equal(plain.body?.sessions, undefined);
});

test('no participants response in this file carries an email address', () => {
  assert.ok(SEEN.length > 0);
  assert.equal(SEEN.some((t) => /founder\d+@example\.test/.test(t)), false);
});
