/**
 * D945 (#2750) — Spin-Out Lab part 3: move to another cohort, bulk decisions,
 * and admit without an application (routes/admin_lab_writes.ts), mounted on
 * node:sqlite with the baseline and the migrations the Lab's routes read.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import admin from '../src/routes/admin.ts';
import cohort from '../src/routes/admin_cohort.ts';
import { AUTH_ERROR_STATUSES, branchSuspendedBody } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';

const KEY = 'test'.repeat(16);
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
globalThis.fetch = async () => new Response('Providers are stubbed', { status: 599 });

/** Cycle 1 (Jan 2035) and 3 (Mar 2035) open, 2 (Feb 2035) reviewing. Founders 2–5; applicants 1 and 2 pending in cycle 1. */
function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(baseline);
  for (const m of ['313_lab_host_applications', '315_spinout_application_lifecycle', '316_spinout_application_interviews', '256_branch_local_copies']) {
    db.exec(readFileSync(new URL(`../sql/migrations/${m}.sql`, import.meta.url), 'utf8'));
  }
  for (const [id, role] of [[1, 'admin'], [2, 'founder'], [3, 'founder'], [4, 'founder'], [5, 'founder'], [6, 'admin']] as const) {
    db.prepare('INSERT INTO users(id,role,name,email,is_active) VALUES(?,?,?,?,1)').run(id, role, 'Synthetic', `synthetic${id}@example.test`);
  }
  db.exec(`INSERT INTO cohort_cycles(id,year,month,start_at,end_at,app_status) VALUES
    (1,2035,1,'2035-01-01 05:00:00','2035-02-01 05:00:00','open'),
    (2,2035,2,'2035-02-01 05:00:00','2035-03-01 05:00:00','reviewing'),
    (3,2035,3,'2035-03-01 05:00:00','2035-04-01 05:00:00','open')`);
  for (const [id, user] of [[1, 2], [2, 3]]) {
    db.prepare("INSERT INTO spinout_applications(id,user_id,company_name,idea) VALUES(?,?,'Synthetic','Synthetic')").run(id, user);
    db.prepare('INSERT INTO cohort_applicants(id,application_id,user_id,cohort_cycle_id) VALUES(?,?,?,1)').run(id, id, user);
  }
  db.exec("INSERT INTO cohort_settings(key,value) VALUES('max_cohort_size','1')");
  const env: any = { DB: d1Over(db), JWT_SECRET: KEY, ENVIRONMENT: 'test' };
  return { db, env };
}
const app = new Hono<any>();
app.route('/api/admin/cohort', cohort);
app.route('/api/admin', admin);
app.onError((e: any, c) => {
  const status = AUTH_ERROR_STATUSES[e.message];
  return status === 423 ? c.json(branchSuspendedBody(e), 423) : c.json({ error: status ? e.message : 'Request failed' }, status || 500);
});
async function post(w: any, path: string, body: unknown, who: number | null = 1) {
  const jwt = who ? await new SignJWT({ user_id: who, role: who === 1 ? 'admin' : 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(KEY)) : null;
  const res = await app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(body) }, w.env);
  return { status: res.status, body: await res.json() as any };
}
const TABLES = ['cohort_applicants', 'spinout_applications', 'cohort_cycle_events', 'activity_logs', 'cohort_app_notification_ledger', 'user_spinout_flags'];
function rows(w: any) {
  return JSON.stringify(Object.fromEntries(TABLES.map(t => [t, w.db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()])));
}
const one = (w: any, sql: string, ...a: any[]) => w.db.prepare(sql).get(...a) as any;
const count = (w: any, sql: string, ...a: any[]) => Number(one(w, sql, ...a).n);
const movePath = (id = 1) => `/api/admin/cohort/applications/${id}/move`;
const BULK = '/api/admin/cohort/applications/bulk-decide';
const ADMIT = '/api/admin/cohort/applications/admit';

// ---------------------------------------------------------------------------
// Move to another cohort
// ---------------------------------------------------------------------------

test('D945 move: open cohorts only, a reason, one audit row and one cycle event, the founder told', async () => {
  const w = world();
  try {
    const before = rows(w);
    for (const [body, code] of [
      [{ cycle_id: 3 }, 'reason_required'],
      [{ cycle_id: 3, reason: '   ' }, 'reason_required'],
      [{ reason: 'Synthetic' }, 'invalid_cohort'],
      [{ cycle_id: 1, reason: 'Synthetic' }, 'same_cohort'],
      [{ cycle_id: 2, reason: 'Synthetic' }, 'cohort_not_open'],
      [{ cycle_id: 99, reason: 'Synthetic' }, 'cohort_not_found'],
    ] as const) {
      const r = await post(w, movePath(), body);
      assert.ok(r.status >= 400 && r.status < 500, JSON.stringify(r));
      assert.equal(r.body.error, code);
      assert.equal(rows(w), before, `${code} wrote nothing`);
    }
    assert.equal((await post(w, movePath(99), { cycle_id: 3, reason: 'Synthetic' })).status, 404);

    const r = await post(w, movePath(), { cycle_id: 3, reason: 'Founder asked for March' });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(r.body.from_cohort, 'January 2035');
    assert.equal(r.body.cohort, 'March 2035');
    assert.equal(r.body.founder_told, true);
    const moved = one(w, 'SELECT * FROM cohort_applicants WHERE id = ?', r.body.applicant_id);
    assert.equal(moved.cohort_cycle_id, 3);
    assert.equal(moved.status, 'pending');
    assert.equal(moved.rolled_from_cycle_id, 1);
    assert.equal(moved.application_id, 1);
    const old = one(w, 'SELECT * FROM cohort_applicants WHERE id = 1');
    assert.equal(old.status, 'rolled_forward');
    assert.equal(old.decided_by, 'admin:1');
    assert.equal(old.decision_reason, 'Moved to March 2035: Founder asked for March');
    const events = w.db.prepare('SELECT * FROM cohort_cycle_events').all() as any[];
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, 'applicant_moved');
    assert.equal(events[0].cohort_cycle_id, 3);
    assert.match(events[0].details, /from January 2035 to March 2035: Founder asked for March/);
    const audit = w.db.prepare("SELECT * FROM activity_logs WHERE action = 'cohort_applicant_moved'").all() as any[];
    assert.equal(audit.length, 1);
    assert.equal(audit[0].user_id, 1);
    assert.doesNotMatch(audit[0].actor, /@/, 'the admin is kept as a hash');
    assert.equal(count(w, "SELECT COUNT(*) AS n FROM cohort_app_notification_ledger WHERE user_id = 2 AND cohort_cycle_id = 3 AND notif_type = 'moved_cohort'"), 1);
    assert.equal(one(w, 'SELECT cohort FROM spinout_applications WHERE id = 1').cohort, 'March 2035');

    // The queue follows: the legacy decide resolves the moved row, not the old one.
    const decided = await post(w, '/api/admin/spinout-applications/1/decide', { decision: 'accepted', reason: 'Synthetic' });
    assert.equal(decided.status, 200, JSON.stringify(decided));
    assert.equal(decided.body.cohort, 'March 2035');
    assert.equal(one(w, 'SELECT status FROM cohort_applicants WHERE id = ?', r.body.applicant_id).status, 'approved');
    assert.equal(one(w, 'SELECT status FROM cohort_applicants WHERE id = 1').status, 'rolled_forward');

    // A carried-forward row cannot move again, and nothing moves back into a cohort it left.
    const again = await post(w, movePath(), { cycle_id: 3, reason: 'Synthetic' });
    assert.equal(again.status, 409); assert.equal(again.body.error, 'not_movable');
    w.db.exec("UPDATE cohort_cycles SET app_status = 'open' WHERE id = 2");
    const hop = await post(w, movePath(r.body.applicant_id), { cycle_id: 2, reason: 'Synthetic', confirm_over_places: true });
    assert.equal(hop.status, 200, JSON.stringify(hop));
    const back = await post(w, movePath(hop.body.applicant_id), { cycle_id: 1, reason: 'Synthetic' });
    assert.equal(back.status, 409); assert.equal(back.body.error, 'already_in_cohort');
  } finally { w.db.close(); }
});

test('D945 move: an approved founder keeps the approval and takes a place in the new cohort, per D943', async () => {
  const w = world();
  try {
    w.db.exec("UPDATE cohort_applicants SET status = 'approved', decided_by = 'admin:1', decision_reason = 'Strong team' WHERE id = 1");
    w.db.prepare("INSERT INTO spinout_applications(id,user_id,company_name,idea) VALUES(3,4,'Synthetic','Synthetic')").run();
    w.db.exec("INSERT INTO cohort_applicants(id,application_id,user_id,cohort_cycle_id,status) VALUES(3,3,4,3,'activated')");
    for (const confirm_over_places of [undefined, false, 'true', 1]) {
      const before = rows(w);
      const r = await post(w, movePath(), { cycle_id: 3, reason: 'Synthetic', confirm_over_places });
      assert.equal(r.status, 409, JSON.stringify(r)); assert.equal(r.body.error, 'over_places');
      assert.equal(rows(w), before);
    }
    const r = await post(w, movePath(), { cycle_id: 3, reason: 'Synthetic', confirm_over_places: true });
    assert.equal(r.status, 200, JSON.stringify(r));
    const moved = one(w, 'SELECT * FROM cohort_applicants WHERE id = ?', r.body.applicant_id);
    assert.equal(moved.status, 'approved');
    assert.equal(moved.decision_reason, 'Strong team', 'the decision carries with the founder');
    assert.match(one(w, 'SELECT details FROM cohort_cycle_events').details, /confirm_over_places=true/);
    // A waitlisted founder takes no place, so a full cohort still takes them.
    w.db.exec("UPDATE cohort_applicants SET status = 'waitlisted' WHERE id = 2");
    assert.equal((await post(w, movePath(2), { cycle_id: 3, reason: 'Synthetic' })).status, 200);
    for (const status of ['activated', 'withdrawn', 'rejected']) {
      w.db.prepare('UPDATE cohort_applicants SET status = ? WHERE id = 3').run(status);
      const x = await post(w, movePath(3), { cycle_id: 1, reason: 'Synthetic' });
      assert.equal(x.status, 409, status); assert.equal(x.body.error, 'not_movable');
    }
  } finally { w.db.close(); }
});

test('D945 move: a failed audit write moves nothing, and the target closing mid-move is refused', async () => {
  const w = world();
  try {
    const db = w.env.DB;
    const before = rows(w);
    w.env.DB = { ...db, prepare(sql: string) { return db.prepare(sql.startsWith('INSERT INTO cohort_cycle_events') ? 'INSERT INTO missing_d945 VALUES(1)' : sql); } };
    assert.equal((await post(w, movePath(), { cycle_id: 3, reason: 'Synthetic' })).status, 500);
    assert.equal(rows(w), before);
    // The target is read as open, then closes before the batch.
    w.env.DB = { ...db, prepare(sql: string) {
      if (sql.startsWith('INSERT OR IGNORE INTO cohort_applicants')) w.db.exec("UPDATE cohort_cycles SET app_status = 'reviewing' WHERE id = 3");
      return db.prepare(sql);
    } };
    const r = await post(w, movePath(), { cycle_id: 3, reason: 'Synthetic' });
    assert.equal(r.status, 409, JSON.stringify(r)); assert.equal(r.body.error, 'cohort_not_open');
    assert.equal(count(w, 'SELECT COUNT(*) AS n FROM cohort_applicants WHERE cohort_cycle_id = 3'), 0);
    assert.equal(one(w, 'SELECT status FROM cohort_applicants WHERE id = 1').status, 'pending');
  } finally { w.db.close(); }
});

// ---------------------------------------------------------------------------
// Bulk decisions
// ---------------------------------------------------------------------------

test('D945 bulk: approve or waitlist up to 25 with one reason; anything else is refused whole', async () => {
  const w = world();
  try {
    const before = rows(w);
    const ids26 = Array.from({ length: 26 }, (_, i) => i + 1);
    for (const [body, code] of [
      [{ applicant_ids: [1, 2], status: 'rejected', reason: 'Synthetic' }, 'bad_status'],
      [{ applicant_ids: [1, 2], status: 'approved' }, 'reason_required'],
      [{ applicant_ids: [], status: 'waitlisted', reason: 'Synthetic' }, 'nothing_selected'],
      [{ status: 'waitlisted', reason: 'Synthetic' }, 'nothing_selected'],
      [{ applicant_ids: ids26, status: 'waitlisted', reason: 'Synthetic' }, 'too_many'],
      [{ applicant_ids: [1, 'x'], status: 'waitlisted', reason: 'Synthetic' }, 'invalid_applicant'],
      [{ applicant_ids: [1, 1], status: 'waitlisted', reason: 'Synthetic' }, 'duplicate_applicant'],
    ] as const) {
      const r = await post(w, BULK, body);
      assert.equal(r.status, 400, JSON.stringify(r)); assert.equal(r.body.error, code);
      assert.equal(rows(w), before);
    }
    const ok25 = await post(w, BULK, { applicant_ids: Array.from({ length: 25 }, (_, i) => i + 1), status: 'waitlisted', reason: 'Synthetic' });
    assert.equal(ok25.status, 200, '25 is allowed');
    assert.equal(ok25.body.decided, 2);
    assert.equal(ok25.body.refused, 23);
    assert.equal(ok25.body.results[2].error, 'applicant_not_found');
  } finally { w.db.close(); }
});

test('D945 bulk: each applicant through the one decision path, places enforced, one audit row each', async () => {
  const w = world();
  try {
    const r = await post(w, BULK, { applicant_ids: [1, 2], status: 'approved', reason: 'Strong cohort' });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.deepEqual(r.body.results.map((x: any) => [x.applicant_id, x.ok, x.error ?? null]), [[1, true, null], [2, false, 'over_places']]);
    assert.equal(count(w, "SELECT COUNT(*) AS n FROM cohort_applicants WHERE status = 'approved'"), 1);
    assert.equal(count(w, 'SELECT COUNT(*) AS n FROM cohort_cycle_events'), 1);
    assert.equal(count(w, "SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'cohort_applicant_approved'"), 1);

    const c2 = await post(w, BULK, { applicant_ids: [2, 1], status: 'approved', reason: 'Strong cohort', confirm_over_places: true });
    assert.equal(c2.body.decided, 2, JSON.stringify(c2));
    assert.match(one(w, "SELECT details FROM cohort_cycle_events WHERE details LIKE 'Applicant #2 %'").details, /Strong cohort; confirm_over_places=true/);

    const wl = await post(w, BULK, { applicant_ids: [1, 2], status: 'waitlisted', reason: 'Places tight' });
    assert.equal(wl.body.decided, 2);
    const events = w.db.prepare("SELECT cohort_cycle_id, details FROM cohort_cycle_events WHERE event_type = 'applicant_waitlisted' ORDER BY id").all() as any[];
    assert.deepEqual(events.map(e => e.details.match(/^Applicant #(\d+)/)[1]), ['1', '2'], 'one cycle event each');
    assert.equal(count(w, "SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'cohort_applicant_waitlisted'"), 2, 'one audit row each');
    assert.equal(one(w, 'SELECT decision_reason FROM cohort_applicants WHERE id = 2').decision_reason, 'Places tight');
    // Nobody starts early.
    assert.equal(count(w, 'SELECT COUNT(*) AS n FROM users WHERE spinout_lab_active = 1'), 0);
  } finally { w.db.close(); }
});

test('D945 bulk: a terminal or admin applicant is refused on its own line; unreadable places refuse each approval', async () => {
  const w = world();
  try {
    w.db.exec("UPDATE cohort_applicants SET status = 'withdrawn' WHERE id = 1; UPDATE users SET role = 'admin' WHERE id = 3; UPDATE cohort_settings SET value = '5'");
    const r = await post(w, BULK, { applicant_ids: [1, 2], status: 'approved', reason: 'Synthetic' });
    assert.deepEqual(r.body.results.map((x: any) => x.error), ['applicant_terminal', 'admin_not_admissible']);
    w.db.exec("UPDATE users SET role = 'founder' WHERE id = 3");
    const db = w.env.DB;
    w.env.DB = { ...db, prepare(sql: string) { if (sql.startsWith('SELECT key, value FROM cohort_settings')) throw new Error('Synthetic unreadable settings'); return db.prepare(sql); } };
    const before = rows(w);
    const u = await post(w, BULK, { applicant_ids: [2], status: 'approved', reason: 'Synthetic' });
    assert.equal(u.body.results[0].error, 'cohort_settings_unreadable');
    assert.equal(rows(w), before);
  } finally { w.db.close(); }
});

// ---------------------------------------------------------------------------
// Admit without an application
// ---------------------------------------------------------------------------

test('D945 admit: creates the application and its approved place in an open cohort, so the queue and the calendar agree', async () => {
  const w = world();
  try {
    w.db.exec("UPDATE cohort_settings SET value = '5'");
    const r = await post(w, ADMIT, { user_id: 4, cycle_id: 3, reason: 'Referred by the TTO', company_name: 'Synthetic Co' });
    assert.equal(r.status, 201, JSON.stringify(r));
    assert.equal(r.body.cohort, 'March 2035');
    const appRow = one(w, 'SELECT * FROM spinout_applications WHERE id = ?', r.body.application_id);
    assert.equal(appRow.user_id, 4);
    assert.equal(appRow.company_name, 'Synthetic Co');
    assert.equal(appRow.status, 'pending', 'the scheduler accepts it on the 1st, as D943 does');
    assert.equal(appRow.cohort, 'March 2035');
    assert.equal(appRow.answers_json, null, 'no answers are made up');
    const ca = one(w, 'SELECT * FROM cohort_applicants WHERE id = ?', r.body.applicant_id);
    assert.equal(ca.application_id, r.body.application_id);
    assert.equal(ca.cohort_cycle_id, 3);
    assert.equal(ca.status, 'approved');
    assert.equal(ca.decided_by, 'admin:1');
    assert.equal(ca.decision_reason, 'Referred by the TTO');
    const ev = w.db.prepare('SELECT * FROM cohort_cycle_events').all() as any[];
    assert.equal(ev.length, 1);
    assert.equal(ev[0].event_type, 'applicant_admitted_without_application');
    assert.equal(ev[0].cohort_cycle_id, 3);
    assert.equal(count(w, "SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'cohort_applicant_admitted'"), 1);
    assert.equal(count(w, "SELECT COUNT(*) AS n FROM cohort_app_notification_ledger WHERE user_id = 4 AND notif_type IN ('decision_approved', 'decision_email_approved')"), 2);
    const u = one(w, 'SELECT spinout_lab_active, spinout_lab_started_at FROM users WHERE id = 4');
    assert.equal(Number(u.spinout_lab_active ?? 0), 0, 'nobody starts before the 1st');
    assert.equal(count(w, 'SELECT COUNT(*) AS n FROM user_spinout_flags'), 0, 'no free-text cohort label is written');
    // The founder's queue entry is the one an applicant would have: the cohort's decide reads it.
    const again = await post(w, `/api/admin/cohort/applications/${r.body.applicant_id}/decide`, { status: 'waitlisted', reason: 'Synthetic' });
    assert.equal(again.status, 200, JSON.stringify(again));
    const dup = await post(w, ADMIT, { user_id: 4, cycle_id: 1, reason: 'Synthetic' });
    assert.equal(dup.status, 409); assert.equal(dup.body.error, 'already_in_queue');
    assert.match(dup.body.message, /March 2035 cohort \(waitlisted\)/);
  } finally { w.db.close(); }
});

test('D945 admit: refusals write nothing', async () => {
  const w = world();
  try {
    w.db.exec("UPDATE users SET is_incorporated = 1 WHERE id = 5");
    const before = rows(w);
    for (const [body, status, code] of [
      [{ user_id: 4, cycle_id: 3 }, 400, 'reason_required'],
      [{ user_id: 4, reason: 'Synthetic' }, 400, 'invalid_cohort'],
      [{ cycle_id: 3, reason: 'Synthetic' }, 400, 'invalid_user'],
      [{ user_id: 4, cycle_id: 3, reason: 'Synthetic', cohort: 'Cohort 3' }, 400, 'cohort_label_unsupported'],
      [{ user_id: 4, cycle_id: 2, reason: 'Synthetic' }, 409, 'cohort_not_open'],
      [{ user_id: 4, cycle_id: 99, reason: 'Synthetic' }, 404, 'cohort_not_found'],
      [{ user_id: 99, cycle_id: 3, reason: 'Synthetic' }, 404, 'user_not_found'],
      [{ user_id: 6, cycle_id: 3, reason: 'Synthetic' }, 400, 'admin_not_admissible'],
      [{ user_id: 5, cycle_id: 3, reason: 'Synthetic' }, 409, 'lab_alumnus'],
      [{ user_id: 2, cycle_id: 3, reason: 'Synthetic' }, 409, 'already_in_queue'],
    ] as const) {
      const r = await post(w, ADMIT, body);
      assert.equal(r.status, status, `${code}: ${JSON.stringify(r)}`); assert.equal(r.body.error, code);
      assert.equal(rows(w), before, code);
    }
    w.db.exec('UPDATE users SET is_incorporated = 0, spinout_lab_active = 1 WHERE id = 5');
    assert.equal((await post(w, ADMIT, { user_id: 5, cycle_id: 3, reason: 'Synthetic' })).body.error, 'already_in_lab');
    // A rejected or carried-forward application is not live: the founder can be admitted.
    w.db.exec("UPDATE cohort_applicants SET status = 'rejected' WHERE id = 1");
    w.db.exec("UPDATE cohort_settings SET value = '5'");
    assert.equal((await post(w, ADMIT, { user_id: 2, cycle_id: 3, reason: 'Synthetic' })).status, 201);
  } finally { w.db.close(); }
});

test('D945 admit: places per D943, and two admissions of one founder cannot both land', async () => {
  const w = world();
  try {
    w.db.exec("UPDATE cohort_applicants SET status = 'approved', cohort_cycle_id = 3 WHERE id = 1");
    for (const confirm_over_places of [undefined, false, 'true', 1]) {
      const before = rows(w);
      const r = await post(w, ADMIT, { user_id: 4, cycle_id: 3, reason: 'Synthetic', confirm_over_places });
      assert.equal(r.status, 409, JSON.stringify(r)); assert.equal(r.body.error, 'over_places');
      assert.equal(rows(w), before);
    }
    const r = await post(w, ADMIT, { user_id: 4, cycle_id: 3, reason: 'Synthetic', confirm_over_places: true });
    assert.equal(r.status, 201, JSON.stringify(r));
    assert.match(one(w, 'SELECT details FROM cohort_cycle_events').details, /confirm_over_places=true/);

    w.db.exec("UPDATE cohort_settings SET value = '10'");
    // Both requests pass every check before either batch runs, so only the
    // batch's own statement can keep the second out.
    const db = w.env.DB;
    let arrived = 0;
    let release!: () => void;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const barrier = new Promise<void>((resolve, reject) => { release = resolve; timer = setTimeout(() => reject(new Error('Synthetic barrier timed out')), 30000); });
    w.env.DB = { ...db, async batch(stmts: any[]) {
      if (++arrived === 2) { clearTimeout(timer); release(); }
      await barrier;
      return db.batch(stmts);
    } };
    const both = await Promise.all([
      post(w, ADMIT, { user_id: 5, cycle_id: 3, reason: 'Synthetic' }),
      post(w, '/api/admin/users/5/spinout-admit', { cycle_id: 1, reason: 'Synthetic' }),
    ]);
    assert.deepEqual(both.map(x => x.status).sort(), [201, 409]);
    assert.equal(both.find(x => x.status === 409)?.body.error, 'already_in_queue');
    assert.equal(count(w, 'SELECT COUNT(*) AS n FROM cohort_applicants WHERE user_id = 5'), 1);
    assert.equal(count(w, 'SELECT COUNT(*) AS n FROM spinout_applications WHERE user_id = 5'), 1);
    assert.equal(arrived, 2, 'both admissions reached the batch');
  } finally { w.db.close(); }
});

test('D945 admit: a failed cycle-event write leaves no application and no place', async () => {
  const w = world();
  try {
    w.db.exec("UPDATE cohort_settings SET value = '5'");
    const db = w.env.DB;
    w.env.DB = { ...db, prepare(sql: string) { return db.prepare(sql.startsWith('INSERT INTO cohort_cycle_events') ? 'INSERT INTO missing_d945 VALUES(1)' : sql); } };
    const before = rows(w);
    assert.equal((await post(w, ADMIT, { user_id: 4, cycle_id: 3, reason: 'Synthetic' })).status, 500);
    assert.equal(rows(w), before);
  } finally { w.db.close(); }
});

test('D945: Users\' "Spin-Out admit" calls the same write and refuses the free-text label', async () => {
  const w = world();
  try {
    w.db.exec("UPDATE cohort_settings SET value = '5'");
    const before = rows(w);
    for (const body of [{}, { cohort: 'Cohort 3' }, { cohort: 'Cohort 3', cycle_id: 3, reason: 'Synthetic' }]) {
      const r = await post(w, '/api/admin/users/4/spinout-admit', body);
      assert.equal(r.status, 400, JSON.stringify(r));
      assert.equal(rows(w), before);
    }
    const r = await post(w, '/api/admin/users/4/spinout-admit', { cycle_id: 3, reason: 'Referred' });
    assert.equal(r.status, 201, JSON.stringify(r));
    assert.equal(r.body.already_admitted, false);
    assert.equal(one(w, 'SELECT status, cohort_cycle_id FROM cohort_applicants WHERE id = ?', r.body.applicant_id).status, 'approved');
    assert.equal(count(w, 'SELECT COUNT(*) AS n FROM user_spinout_flags'), 0);
  } finally { w.db.close(); }
});

// ---------------------------------------------------------------------------
// The branch freeze (D107)
// ---------------------------------------------------------------------------

const writes = [
  [movePath(), { cycle_id: 3, reason: 'Synthetic' }],
  [BULK, { applicant_ids: [1], status: 'waitlisted', reason: 'Synthetic' }],
  [ADMIT, { user_id: 4, cycle_id: 3, reason: 'Synthetic' }],
  ['/api/admin/users/4/spinout-admit', { cycle_id: 3, reason: 'Synthetic' }],
] as const;
for (const [path, body] of writes) test(`D945: ${path} freezes after authentication and works on an active branch`, async () => {
  const w = world();
  try {
    w.db.exec("UPDATE cohort_settings SET value = '5'");
    w.db.exec("INSERT INTO branch_licence(id,licence_uid,territory,status,pushed_at) VALUES(1,'synthetic','Synthetic','suspended',datetime('now'))");
    w.env.BRANCH_CODE = 'fr'; w.env.APP_URL = 'https://fr.axal.vc'; w.env.PUBLIC_BASE_URL = 'https://fr.axal.vc';
    const before = rows(w);
    assert.equal((await post(w, path, body, null)).status, 401);
    assert.equal((await post(w, path, body, 2)).status, 403);
    const frozen = await post(w, path, body);
    assert.equal(frozen.status, 423, JSON.stringify(frozen)); assert.equal(rows(w), before);
    w.db.exec("UPDATE branch_licence SET status = 'active'");
    const active = await post(w, path, body);
    assert.ok(active.status >= 200 && active.status < 300, JSON.stringify(active));
  } finally { w.db.close(); }
});
