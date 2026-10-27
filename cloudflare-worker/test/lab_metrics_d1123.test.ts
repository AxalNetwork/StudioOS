/**
 * D1123 (#3003, migration 602) — the Spin-Out Lab's two recorded metrics:
 *
 *   - an interview's outcome (held or missed), recorded by an admin once its
 *     time has passed, is what SL1's "Interviewed" counts; an interview from
 *     before recording began, with no outcome, keeps its cohort Not recorded;
 *   - the founders who reached each week, written by the scheduler at each
 *     deadline and by every week decision, with a coverage row per week whose
 *     deadline job began with the ledger in place.
 *
 * node:sqlite with the baseline and the migrations the Lab's routes read.
 */
import test, { mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import cohort from '../src/routes/admin_cohort.ts';
import { applyWeekDecision, cycleWeekWindows, runCohortTimingTick } from '../src/services/cohortTiming.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';

const KEY = 'test'.repeat(16);
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
globalThis.fetch = async () => new Response('Providers are stubbed', { status: 599 });
afterEach(() => mock.timers.reset());

const iso = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const OCT = cycleWeekWindows(2026, 10);

/** October 2026 (id 10): founders 2–4 started in it, applications 1–3 in its pool. Recording began 20 Oct. */
function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(baseline);
  for (const m of ['313_lab_host_applications', '315_spinout_application_lifecycle', '316_spinout_application_interviews', '256_branch_local_copies', '602_lab_interview_outcome_and_reached_weeks']) {
    db.exec(readFileSync(new URL(`../sql/migrations/${m}.sql`, import.meta.url), 'utf8'));
  }
  db.exec("UPDATE lab_metric_capture SET started_at = '2026-10-20 00:00:00'");
  for (const [id, role] of [[1, 'admin'], [2, 'founder'], [3, 'founder'], [4, 'founder']] as const) {
    db.prepare('INSERT INTO users(id,role,name,email,is_active) VALUES(?,?,?,?,1)').run(id, role, 'Synthetic', `synthetic${id}@example.test`);
  }
  db.prepare("INSERT INTO cohort_cycles(id,year,month,start_at,end_at,status,app_status) VALUES(10,2026,10,?,?,'active','closed')")
    .run(iso(OCT[0].unlockMs), iso(OCT[3].deadlineMs));
  for (const w of OCT) db.prepare('INSERT INTO week_windows(cohort_cycle_id,week_number,unlock_at,deadline_at) VALUES(10,?,?,?)').run(w.week, iso(w.unlockMs), iso(w.deadlineMs));
  db.prepare("UPDATE users SET spinout_lab_active = 1, spinout_lab_started_at = ? WHERE id IN (2,3,4)").run(iso(OCT[0].unlockMs + 3600_000));
  for (const id of [1, 2, 3]) {
    db.prepare("INSERT INTO spinout_applications(id,user_id,company_name,idea) VALUES(?,?,'Synthetic','Synthetic')").run(id, id + 1);
    db.prepare("INSERT INTO cohort_applicants(id,application_id,user_id,cohort_cycle_id,status) VALUES(?,?,?,10,'pending')").run(id, id, id + 1);
  }
  const env: any = { DB: d1Over(db), JWT_SECRET: KEY, ENVIRONMENT: 'test' };
  return { db, env };
}
const app = new Hono<any>();
app.route('/api/admin/cohort', cohort);
app.onError((e: any, c) => {
  const status = AUTH_ERROR_STATUSES[e.message];
  return c.json({ error: status ? e.message : 'Request failed' }, status || 500);
});
async function call(w: any, path: string, body?: unknown, who = 1) {
  const jwt = await new SignJWT({ user_id: who, role: who === 1 ? 'admin' : 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(KEY));
  const res = await app.request(path, body === undefined ? { headers: { Authorization: `Bearer ${jwt}` } }
    : { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` }, body: JSON.stringify(body) }, w.env);
  return { status: res.status, body: await res.json() as any };
}
const october = (r: any) => r.body.blocks.cohorts.items.find((c: any) => c.cohort === '2026-10');
const interview = (w: any, app: number, at: string, status = 'scheduled') =>
  w.db.prepare('INSERT INTO spinout_application_interviews(application_id,user_id,scheduled_at,status) VALUES(?,?,?,?)').run(app, app + 1, at, status);
const outcome = (w: any, applicant: number, value: unknown) => call(w, `/api/admin/cohort/applications/${applicant}/interview/outcome`, { outcome: value });

/* ------------------------------------------------------------------ *
 * Interview outcomes
 * ------------------------------------------------------------------ */

test('an outcome is recorded once, only after its time, as held or missed, by an admin; a recorded interview is never cancelled', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 25, 12) });
  const w = world();
  interview(w, 1, '2026-10-24 15:00:00');
  interview(w, 2, '2026-10-30 15:00:00');
  assert.equal((await outcome(w, 1, 'maybe')).status, 400);
  assert.equal((await outcome(w, 1, 'held', )).status, 200);
  const row = w.db.prepare('SELECT outcome, outcome_by, outcome_at FROM spinout_application_interviews WHERE application_id = 1').get() as any;
  assert.equal(row.outcome, 'held'); assert.equal(row.outcome_by, 1); assert.ok(row.outcome_at);
  const again = await outcome(w, 1, 'missed');
  assert.deepEqual([again.status, again.body.code ?? again.body.error], [409, 'outcome_recorded']);
  const early = await outcome(w, 2, 'held');
  assert.deepEqual([early.status, early.body.code ?? early.body.error], [409, 'interview_not_yet']);
  assert.equal((await outcome(w, 3, 'held')).status, 409, 'no interview at all');
  assert.equal((await call(w, '/api/admin/cohort/applications/1/interview/outcome', { outcome: 'held' }, 2)).status, 403, 'a founder may not');
  // Cancel and a new time leave the recorded interview as it was.
  assert.equal((await call(w, '/api/admin/cohort/applications/1/interview/cancel', {})).status, 409);
  assert.equal((await call(w, '/api/admin/cohort/applications/1/interview', { scheduled_at: '2026-11-02T15:00:00Z' })).status, 201);
  assert.deepEqual(w.db.prepare('SELECT status, outcome FROM spinout_application_interviews WHERE application_id = 1 ORDER BY id').all().map((r: any) => [r.status, r.outcome]),
    [['scheduled', 'held'], ['scheduled', null]]);
  const log = w.db.prepare("SELECT details FROM activity_logs WHERE action = 'cohort_interview_outcome'").all() as any[];
  assert.equal(log.length, 1); assert.match(log[0].details, /recorded applicant #1's interview as held/);
  w.db.close();
});

test('Interviewed counts held interviews by application; one from before recording, with no outcome, keeps the cohort Not recorded until it is answered', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 25, 12) });
  const w = world();
  interview(w, 1, '2026-10-18 15:00:00'); // before recording began
  interview(w, 2, '2026-10-21 15:00:00');
  interview(w, 3, '2026-10-22 15:00:00');
  interview(w, 3, '2026-10-10 15:00:00', 'cancelled'); // cancelled: never an interview
  let r = await call(w, '/api/admin/cohort/overview?cohort=2026-10');
  assert.equal(october(r).interviewed.recorded, false);
  assert.match(october(r).interviewed.reason, /^1 interview before 2026-10-20, when outcomes began to be recorded, has no recorded outcome\./);
  assert.equal((await outcome(w, 1, 'missed')).status, 200);
  r = await call(w, '/api/admin/cohort/overview?cohort=2026-10');
  assert.deepEqual(october(r).interviewed, { available: true, value: 0, awaiting: 2 }, 'a missed one is answered, not interviewed; two are due');
  assert.equal((await outcome(w, 2, 'held')).status, 200);
  r = await call(w, '/api/admin/cohort/overview?cohort=2026-10');
  assert.deepEqual(october(r).interviewed, { available: true, value: 1, awaiting: 1 });
  assert.deepEqual(r.body.blocks.funnel.steps.interviewed, { available: true, value: 1, awaiting: 1 });
  // The drawer reads the outcome.
  const one = await call(w, '/api/admin/cohort/applications/2');
  assert.equal(one.body.interview.latest.outcome, 'held');
  // A database that never started recording says so.
  w.db.exec('DELETE FROM lab_metric_capture');
  r = await call(w, '/api/admin/cohort/overview?cohort=2026-10');
  assert.match(october(r).interviewed.reason, /not recorded on this database yet/);
  w.db.exec('DROP TABLE lab_metric_capture');
  r = await call(w, '/api/admin/cohort/overview?cohort=2026-10');
  assert.equal(october(r).interviewed.available, false, 'unreadable, never a zero');
  w.db.close();
});

/* ------------------------------------------------------------------ *
 * Reached weeks
 * ------------------------------------------------------------------ */

test('the deadline job records who reached each week: blocked founders did not; passed counts only those who reached; a week before coverage is Not recorded', async () => {
  // Just after Week 2's deadline.
  mock.timers.enable({ apis: ['Date'], now: OCT[1].deadlineMs + 60_000 });
  const w = world();
  // Founder 3 failed Week 1 and founder 4 passed Weeks 1 and 2, both decided before this deploy.
  w.db.exec(`INSERT INTO company_week_status(user_id,cohort_cycle_id,week_number,status) VALUES (3,10,1,'failed'),(4,10,1,'passed'),(4,10,2,'passed')`);
  await runCohortTimingTick(w.env, new Date(OCT[1].deadlineMs + 60_000));
  const reached = w.db.prepare('SELECT week_number, user_id, source FROM spinout_week_reached ORDER BY week_number, user_id').all().map((r: any) => [r.week_number, r.user_id, r.source]);
  // Week 1: all three were in it. Week 2: 2 failed Week 1 at its deadline and 3 had failed it, so only 4 reached it.
  assert.deepEqual(reached, [[1, 2, 'deadline'], [1, 3, 'deadline'], [1, 4, 'deadline'], [2, 4, 'deadline']]);
  assert.deepEqual(w.db.prepare('SELECT week_number FROM spinout_week_reach_coverage ORDER BY 1').all().map((r: any) => r.week_number), [1, 2]);
  const r = await call(w, '/api/admin/cohort/overview?cohort=2026-10');
  const weeks = october(r).weeks.items;
  assert.deepEqual(weeks[0].reached, { available: true, value: 3, passed: 1 });
  assert.deepEqual(weeks[1].reached, { available: true, value: 1, passed: 1 });
  assert.equal(weeks[2].reached.recorded, false);
  assert.match(weeks[2].reached.reason, /before reached weeks were recorded/);
  w.db.close();
});

test('a deadline job resumed from before the ledger covers nothing; an admin decision is a reach; the first reach is kept', async () => {
  mock.timers.enable({ apis: ['Date'], now: OCT[0].deadlineMs + 60_000 });
  const w = world();
  w.db.exec(`CREATE TABLE IF NOT EXISTS scheduled_jobs_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, job_type TEXT NOT NULL, cohort_cycle_id INTEGER, week_number INTEGER, idempotency_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'completed', notes TEXT, ran_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  w.db.exec(`INSERT INTO scheduled_jobs_audit(job_type,cohort_cycle_id,week_number,idempotency_key,status) VALUES ('week_deadline',10,1,'week_deadline:10:1','started')`);
  await runCohortTimingTick(w.env, new Date(OCT[0].deadlineMs + 60_000));
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM spinout_week_reach_coverage').get().n, 0, 'a resumed job may have decided founders before the ledger');
  let r = await call(w, '/api/admin/cohort/overview?cohort=2026-10');
  assert.equal(october(r).weeks.items[0].reached.recorded, false);
  // An admin passes founder 2's Week 2 by hand: founder 2 reached Week 2.
  await applyWeekDecision(w.env, { userId: 2, cycleId: 10, week: 2, toStatus: 'passed', reason: 'Synthetic override', triggeredBy: 'admin', adminUserId: 1 });
  const first = w.db.prepare('SELECT source, reached_at FROM spinout_week_reached WHERE user_id = 2 AND week_number = 2').get() as any;
  assert.equal(first.source, 'admin');
  await applyWeekDecision(w.env, { userId: 2, cycleId: 10, week: 2, toStatus: 'failed', reason: 'Synthetic override', triggeredBy: 'scheduler' });
  assert.deepEqual(w.db.prepare('SELECT source FROM spinout_week_reached WHERE user_id = 2 AND week_number = 2').all().map((x: any) => x.source), ['admin'], 'the first reach is kept');
  w.db.exec(`INSERT INTO spinout_week_reach_coverage(cohort_cycle_id, week_number) VALUES (10, 2)`);
  r = await call(w, '/api/admin/cohort/overview?cohort=2026-10');
  assert.deepEqual(october(r).weeks.items[1].reached, { available: true, value: 1, passed: 0 }, 'passed counts the decision now in force');
  // A ledger that cannot be read is Unreadable, never a zero.
  w.db.exec('DROP TABLE spinout_week_reached');
  r = await call(w, '/api/admin/cohort/overview?cohort=2026-10');
  assert.equal(october(r).weeks.items[1].reached.available, false);
  w.db.close();
});

test('every new statement is bound: no interpolated SQL in the routes or the scheduler writes', () => {
  for (const f of ['../src/routes/admin_lab.ts', '../src/routes/admin_cohort.ts', '../src/services/cohortTiming.ts']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    for (const t of ['spinout_week_reached', 'spinout_week_reach_coverage', 'lab_metric_capture', 'outcome = ?']) {
      for (let i = src.indexOf(t); i >= 0; i = src.indexOf(t, i + 1)) {
        const stmt = src.slice(src.lastIndexOf('`', i), src.indexOf('`', i) + 1);
        assert.doesNotMatch(stmt, /\$\{/, `${f}: ${t} is in an interpolated statement`);
      }
    }
  }
});
