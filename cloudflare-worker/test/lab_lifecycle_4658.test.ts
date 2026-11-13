/**
 * D4658 (#4658) — Spin-Out Lab lifecycle transitions are atomic and
 * recoverable. Real services and routes over the migrated schema
 * (node:sqlite); every value is invented.
 *
 *   · progress is monotonic: a request that read a stale week cannot write a
 *     lower one, and a closed sprint stays closed;
 *   · a terminal enrollment is never reopened: by a start that read before the
 *     exit, or by a moderation reinstatement;
 *   · the cycle activation survives an interruption at its persistence
 *     boundary, converges, completes only when every applicant is done, and a
 *     repeated run duplicates neither state nor notification;
 *   · approval and withdrawal: one wins, the other is a 409, and the answers
 *     and interview follow the winner;
 *   · a notification is durable delivery work: a failed or cut-off send is
 *     retried once per tick, never twice, and abandoned after the maximum.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/lab_lifecycle_4658.test.ts
 */
import test, { after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { insertRow } from './_lab_evidence.ts';
import spinoutLab from '../src/routes/spinout_lab.ts';
import { recordMilestone, startLab } from '../src/services/labLifecycle.ts';
import { runCohortApplicationsTick, retryCohortNotifications, NOTIFY_MAX_ATTEMPTS } from '../src/services/cohortApplications.ts';
import { decideApplicant, APPLICANT_BY_ID_SQL } from '../src/services/labDecisions.ts';

afterAll(() => removeMigratedDatabases());
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 1, FOUNDER = 2, OTHER = 3;
const DEC_START = '2026-12-01 05:00:00';
const TICK = new Date('2026-12-01T05:01:00Z');

function world(): DatabaseSync {
  const db = migratedDatabase();
  const u = db.prepare(`INSERT INTO users (id, role, name, email, is_active, spinout_lab_active, spinout_lab_week) VALUES (?, ?, 'Synthetic', ?, 1, 0, 1)`);
  u.run(ADMIN, 'admin', 'admin@example.test'); u.run(FOUNDER, 'founder', 'f@example.test'); u.run(OTHER, 'founder', 'o@example.test');
  db.prepare(`INSERT INTO cohort_cycles (id, year, month, start_at, end_at, status, app_status, force_proceed) VALUES (12, 2026, 12, ?, '2026-12-29 05:00:00', 'scheduled', 'reviewing', 1)`).run(DEC_START);
  for (const [id, user] of [[1, FOUNDER], [2, OTHER]]) {
    db.prepare(`INSERT INTO spinout_applications (id, user_id, company_name, idea, status, answers_json) VALUES (?, ?, 'Synthetic', 'An idea', 'pending', '{"a":1}')`).run(id, user);
    db.prepare(`INSERT INTO cohort_applicants (id, application_id, user_id, cohort_cycle_id, status) VALUES (?, ?, ?, 12, 'approved')`).run(id, id, user);
  }
  return db;
}

/** A binding whose batch fails the first `n` times, as an isolate that dies mid-activation would. */
function flakyEnv(db: DatabaseSync, opts: { failBatches?: number; failNotify?: boolean } = {}) {
  const DB: any = d1Over(db);
  let left = opts.failBatches ?? 0;
  const batch = DB.batch.bind(DB);
  DB.batch = async (list: any[]) => { if (left > 0) { left -= 1; throw new Error('D1_ERROR: synthetic interruption'); } return batch(list); };
  return { DB, JWT_SECRET, ENVIRONMENT: 'development', __failNotify: !!opts.failNotify } as any;
}

const quiet = async <T>(fn: () => Promise<T>) => {
  const w = console.warn, e = console.error, i = console.info; console.warn = () => {}; console.error = () => {}; console.info = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = e; console.info = i; }
};
const one = (db: DatabaseSync, sql: string, ...b: unknown[]) => ({ ...(db.prepare(sql).get(...(b as never[])) as object) }) as any;

/** The whole admitted state of one founder, across the five tables the activation writes. */
const admittedState = (db: DatabaseSync, user: number) => ({
  applicant: one(db, 'SELECT status FROM cohort_applicants WHERE user_id = ?', user).status,
  application: one(db, 'SELECT status FROM spinout_applications WHERE user_id = ?', user).status,
  admitted: one(db, 'SELECT COALESCE(MAX(spinout_lab_admitted), 0) AS a FROM user_spinout_flags WHERE user_id = ?', user).a,
  active: one(db, 'SELECT spinout_lab_active AS a FROM users WHERE id = ?', user).a,
  enrollments: one(db, 'SELECT COUNT(*) AS n FROM spinout_lab_enrollments WHERE user_id = ?', user).n,
  notices: one(db, "SELECT COUNT(*) AS n FROM cohort_app_notification_ledger WHERE user_id = ? AND notif_type = 'workspace_live'", user).n,
});

test('#4658 the activation is all-or-nothing per applicant, resumes, and completes only when every applicant is done', async () => {
  const db = world();
  try {
    // The first applicant's batch is interrupted.
    // Mutation checked: the old sequence ('activated' first, effects after) → FOUNDER is 'activated' but never admitted.
    await quiet(() => runCohortApplicationsTick(flakyEnv(db, { failBatches: 1 }), TICK));
    const first = admittedState(db, FOUNDER);
    assert.deepEqual(first, { applicant: 'approved', application: 'pending', admitted: 0, active: 0, enrollments: 0, notices: 0 },
      'an interrupted applicant has none of the effects, not some');
    assert.equal(admittedState(db, OTHER).applicant, 'activated', 'the others were still done');
    // Mutation checked: completeJobRun despite a failure → the job is done and FOUNDER is never activated.
    assert.equal(one(db, "SELECT status FROM scheduled_jobs_audit WHERE idempotency_key = 'apps_activate:12'").status, 'started');
    assert.equal(one(db, 'SELECT app_status FROM cohort_cycles WHERE id = 12').app_status, 'reviewing');
    // The next tick resumes and converges.
    await quiet(() => runCohortApplicationsTick(flakyEnv(db), new Date(TICK.getTime() + 60_000)));
    for (const who of [FOUNDER, OTHER]) {
      assert.deepEqual(admittedState(db, who), { applicant: 'activated', application: 'accepted', admitted: 1, active: 1, enrollments: 1, notices: 1 }, `user ${who}`);
    }
    assert.equal(one(db, "SELECT status FROM scheduled_jobs_audit WHERE idempotency_key = 'apps_activate:12'").status, 'completed');
    assert.equal(one(db, 'SELECT app_status FROM cohort_cycles WHERE id = 12').app_status, 'active');
    // Further runs duplicate nothing.
    await quiet(() => runCohortApplicationsTick(flakyEnv(db), new Date(TICK.getTime() + 120_000)));
    assert.deepEqual(admittedState(db, FOUNDER), { applicant: 'activated', application: 'accepted', admitted: 1, active: 1, enrollments: 1, notices: 1 });
  } finally { db.close(); }
});

test('#4658 a resumed activation re-applies an already-activated applicant\'s effects', async () => {
  const db = world();
  try {
    // An older Worker flipped FOUNDER to 'activated' and died before the rest.
    db.exec(`UPDATE cohort_applicants SET status = 'activated' WHERE user_id = ${FOUNDER}`);
    db.exec(`INSERT INTO scheduled_jobs_audit (job_type, cohort_cycle_id, idempotency_key, status) VALUES ('apps_activate', 12, 'apps_activate:12', 'started')`);
    await quiet(() => runCohortApplicationsTick(flakyEnv(db), TICK));
    assert.deepEqual(admittedState(db, FOUNDER), { applicant: 'activated', application: 'accepted', admitted: 1, active: 1, enrollments: 1, notices: 1 });
  } finally { db.close(); }
});

test('#4658 a graduate is never reopened by the activation', async () => {
  const db = world();
  try {
    db.exec(`UPDATE users SET is_incorporated = 1 WHERE id = ${FOUNDER}`);
    await quiet(() => runCohortApplicationsTick(flakyEnv(db), TICK));
    assert.equal(admittedState(db, FOUNDER).active, 0);
  } finally { db.close(); }
});

/** A Sql tag over the binding whose read of the user returns `stale` instead of the row. */
function staleSql(db: DatabaseSync, stale: Record<string, unknown> | null) {
  const d1: any = d1Over(db);
  const sql: any = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    if (stale && /^SELECT (spinout_lab_active, spinout_lab_week|is_incorporated) FROM users WHERE id = \?$/.test(text)) return [stale];
    return (await d1.prepare(text).bind(...values).all()).results;
  };
  sql.end = async () => {};
  return sql;
}

test('#4658 progress is monotonic: a request that read a stale week cannot write a lower one', async () => {
  const db = world();
  try {
    db.exec(`UPDATE users SET spinout_lab_active = 1, spinout_lab_week = 3 WHERE id = ${FOUNDER}`);
    for (const k of ['project_created', 'customer_interview_logged_1', 'customer_interview_logged_2', 'customer_interview_logged_3']) {
      db.prepare('INSERT INTO spinout_lab_milestones (user_id, week, milestone_key) VALUES (?, 1, ?)').run(FOUNDER, k);
    }
    // This request read the founder at week 1 (before a competing request advanced them to 3).
    // Mutation checked: `SET spinout_lab_week = ?` → the week drops back to 2.
    const r = await recordMilestone(staleSql(db, { spinout_lab_active: 1, spinout_lab_week: 1 }), FOUNDER, 'project_created');
    assert.ok(r.ok);
    assert.equal(one(db, 'SELECT spinout_lab_week AS w FROM users WHERE id = ?', FOUNDER).w, 3);
    // A sprint that closed meanwhile is not advanced either.
    db.exec(`UPDATE users SET spinout_lab_active = 0, spinout_lab_week = 1 WHERE id = ${FOUNDER}`);
    await recordMilestone(staleSql(db, { spinout_lab_active: 1, spinout_lab_week: 1 }), FOUNDER, 'project_created');
    assert.equal(one(db, 'SELECT spinout_lab_week AS w FROM users WHERE id = ?', FOUNDER).w, 1);
  } finally { db.close(); }
});

test('#4658 a terminal enrollment is never reopened: by a start that read before the exit, or by a reinstatement', async () => {
  const db = world();
  try {
    db.exec(`UPDATE users SET spinout_lab_active = 0, is_incorporated = 1 WHERE id = ${FOUNDER}`);
    // Mutation checked: startLab's update without the is_incorporated guard → the graduate is active again.
    const r = await startLab(staleSql(db, { is_incorporated: 0 }), FOUNDER);
    assert.deepEqual([r.ok, (r as any).status], [false, 409]);
    assert.equal(one(db, 'SELECT spinout_lab_active AS a FROM users WHERE id = ?', FOUNDER).a, 0);
    // The moderation route's reinstatement statement, as written in the route.
    const src = readFileSync(new URL('../src/routes/spinout_moderation.ts', import.meta.url), 'utf8');
    const stmt = /'(UPDATE users SET spinout_lab_active = \? WHERE id = \?[^']*)'/.exec(src)![1];
    // Mutation checked: the route's old `WHERE id = ?` → the graduate is reopened.
    db.prepare(stmt).run(...([1, FOUNDER, 1].slice(0, (stmt.match(/\?/g) || []).length) as never[]));
    assert.equal(one(db, 'SELECT spinout_lab_active AS a FROM users WHERE id = ?', FOUNDER).a, 0, 'a graduate stays closed');
    db.prepare(stmt).run(...([1, OTHER, 1].slice(0, (stmt.match(/\?/g) || []).length) as never[]));
    assert.equal(one(db, 'SELECT spinout_lab_active AS a FROM users WHERE id = ?', OTHER).a, 1, 'a founder mid-sprint is reinstated');
  } finally { db.close(); }
});

async function withdraw(db: DatabaseSync, who: number) {
  const jwt = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await spinoutLab.request('/apply/withdraw', { method: 'POST', headers: { Authorization: `Bearer ${jwt}` } },
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
const admin = { id: ADMIN, role: 'admin', name: 'Admin', email: 'admin@example.test' } as any;
const approve = (db: DatabaseSync, applicantId: number, rowStatus: string) => {
  const row = { ...(db.prepare(APPLICANT_BY_ID_SQL).get(applicantId) as object), status: rowStatus } as any;
  return decideApplicant(flakyEnv(db), admin, row, { status: 'approved', reason: 'fit', confirmOverPlaces: true });
};

test('#4658 approval vs withdrawal: the withdrawal that lands first wins, the approval is a conflict', async () => {
  const db = world();
  try {
    db.exec(`UPDATE cohort_applicants SET status = 'pending' WHERE user_id = ${FOUNDER}`);
    insertRow(db, 'spinout_application_interviews', { application_id: 1, user_id: FOUNDER, scheduled_at: '2026-11-20 15:00:00', status: 'scheduled' });
    const w = await quiet(() => withdraw(db, FOUNDER));
    assert.equal(w.status, 200, JSON.stringify(w.body));
    // The admin's page still showed 'pending'.
    // Mutation checked: decideApplicant without the withdrawn guard → the withdrawn applicant is approved.
    const a = await quiet(() => approve(db, 1, 'pending'));
    assert.deepEqual([a.ok, (a as any).code], [false, 'decision_conflict']);
    assert.equal(one(db, 'SELECT status FROM cohort_applicants WHERE id = 1').status, 'withdrawn');
    assert.deepEqual(one(db, 'SELECT status, answers_json FROM spinout_applications WHERE id = 1'), { status: 'withdrawn', answers_json: null });
    assert.equal(one(db, 'SELECT status FROM spinout_application_interviews WHERE application_id = 1').status, 'cancelled');
  } finally { db.close(); }
});

test('#4658 approval vs withdrawal: the approval that lands first wins, the withdrawal is a conflict and deletes nothing', async () => {
  const db = world();
  try {
    db.exec(`UPDATE cohort_applicants SET status = 'pending' WHERE user_id = ${FOUNDER}`);
    insertRow(db, 'spinout_application_interviews', { application_id: 1, user_id: FOUNDER, scheduled_at: '2026-11-20 15:00:00', status: 'scheduled' });
    const a = await quiet(() => approve(db, 1, 'pending'));
    assert.equal(a.ok, true, JSON.stringify(a));
    // Mutation checked: the withdrawal's old separate statements → it withdraws and deletes the answers of an approved applicant.
    const w = await quiet(() => withdraw(db, FOUNDER));
    assert.deepEqual([w.status, w.body?.code ?? w.body?.error], [409, 'not_withdrawable']);
    assert.deepEqual(one(db, 'SELECT status, answers_json FROM spinout_applications WHERE id = 1'), { status: 'pending', answers_json: '{"a":1}' });
    assert.equal(one(db, 'SELECT status FROM cohort_applicants WHERE id = 1').status, 'approved');
    assert.equal(one(db, 'SELECT status FROM spinout_application_interviews WHERE application_id = 1').status, 'scheduled');
  } finally { db.close(); }
});

test('#4658 a notification is durable: a failed or cut-off send is retried once per tick, and abandoned at the maximum', async () => {
  const db = world();
  try {
    const now = Date.parse('2026-12-01T06:00:00Z');
    const ins = db.prepare(`INSERT INTO cohort_app_notification_ledger (user_id, cohort_cycle_id, notif_type, status, sent_at, title, body, link, email, attempts)
                            VALUES (?, 12, ?, ?, ?, 'Title', 'Body', '/spinout-lab', 0, ?)`);
    ins.run(FOUNDER, 'failed_once', 'failed', '2026-12-01 05:59:00', 1);
    ins.run(FOUNDER, 'cut_off', 'pending', '2026-12-01 05:00:00', 0);
    ins.run(FOUNDER, 'just_claimed', 'pending', '2026-12-01 05:59:30', 0);
    ins.run(FOUNDER, 'hopeless', 'failed', '2026-12-01 05:00:00', NOTIFY_MAX_ATTEMPTS);
    db.prepare(`INSERT INTO cohort_app_notification_ledger (user_id, cohort_cycle_id, notif_type, status) VALUES (?, 12, 'legacy_row', 'failed')`).run(FOUNDER);
    // Mutation checked: the retry sweep removed from the tick → 'failed_once' stays failed forever.
    const out = await quiet(() => retryCohortNotifications(flakyEnv(db), now));
    assert.deepEqual(out, { sent: 2, failed: 0, abandoned: 1 });
    const st = (k: string) => one(db, 'SELECT status, attempts FROM cohort_app_notification_ledger WHERE notif_type = ?', k);
    assert.deepEqual(st('failed_once'), { status: 'sent', attempts: 2 });
    assert.deepEqual(st('cut_off'), { status: 'sent', attempts: 1 });
    assert.deepEqual(st('just_claimed'), { status: 'pending', attempts: 0 }, 'a claim still in flight is left to its sender');
    assert.equal(st('hopeless').status, 'abandoned');
    assert.equal(st('legacy_row').status, 'failed', 'a row with no stored message cannot be resent and is left alone');
    // A second sweep sends nothing again.
    assert.deepEqual(await quiet(() => retryCohortNotifications(flakyEnv(db), now)), { sent: 0, failed: 0, abandoned: 0 });
  } finally { db.close(); }
});

test('#4658 a row left inconsistent by an older Worker (withdrawn application, undecided pool row) cannot be approved', async () => {
  const db = world();
  try {
    db.exec(`UPDATE cohort_applicants SET status = 'pending' WHERE user_id = ${FOUNDER}`);
    db.exec(`UPDATE spinout_applications SET status = 'withdrawn', answers_json = NULL WHERE id = 1`);
    // Mutation checked: decideApplicant without the withdrawn guard → the withdrawn applicant is approved.
    const a = await quiet(() => approve(db, 1, 'pending'));
    assert.deepEqual([a.ok, (a as any).code], [false, 'decision_conflict']);
    assert.equal(one(db, 'SELECT status FROM cohort_applicants WHERE id = 1').status, 'pending');
  } finally { db.close(); }
});

test('#4658 an approval that lands after the withdrawal read the pool, but before it wrote, still wins', async () => {
  const db = world();
  try {
    db.exec(`UPDATE cohort_applicants SET status = 'approved' WHERE user_id = ${FOUNDER}`);
    // The withdrawal's own pre-check read the pool row while it was still 'pending'.
    const DB: any = d1Over(db);
    const prep = DB.prepare.bind(DB);
    DB.prepare = (sql: string) => {
      if (/^SELECT status FROM cohort_applicants WHERE application_id = \? ORDER BY id DESC LIMIT 1$/.test(sql.trim())) {
        return { bind: () => ({ first: async () => ({ status: 'pending' }) }) };
      }
      return prep(sql);
    };
    const jwt = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    // Mutation checked: the batch without its NOT EXISTS → the approved applicant's application is withdrawn and its answers deleted.
    const res = await quiet(() => spinoutLab.request('/apply/withdraw', { method: 'POST', headers: { Authorization: `Bearer ${jwt}` } },
      { JWT_SECRET, ENVIRONMENT: 'development', DB } as any));
    assert.equal(res.status, 409);
    assert.deepEqual(one(db, 'SELECT status, answers_json FROM spinout_applications WHERE id = 1'), { status: 'pending', answers_json: '{"a":1}' });
    assert.equal(one(db, 'SELECT status FROM cohort_applicants WHERE id = 1').status, 'approved');
  } finally { db.close(); }
});

test('#4658 two sweeps never deliver one notification twice', async () => {
  const db = world();
  try {
    db.prepare(`INSERT INTO cohort_app_notification_ledger (user_id, cohort_cycle_id, notif_type, status, sent_at, title, body, link, email, attempts)
                VALUES (?, 12, 'raced', 'failed', '2026-12-01 05:00:00', 'Title', 'Body', '/spinout-lab', 0, 1)`).run(FOUNDER);
    // Another sweep re-claims and delivers the row after this one listed it.
    const DB: any = d1Over(db);
    const prep = DB.prepare.bind(DB);
    DB.prepare = (sql: string) => {
      const st = prep(sql);
      if (!/FROM cohort_app_notification_ledger\s+WHERE title IS NOT NULL/.test(sql)) return st;
      const bind = st.bind.bind(st);
      st.bind = (...a: unknown[]) => {
        const b = bind(...a); const all = b.all.bind(b);
        b.all = async () => { const r = await all(); db.exec("UPDATE cohort_app_notification_ledger SET status = 'sent', attempts = attempts + 1 WHERE notif_type = 'raced'"); return r; };
        return b;
      };
      return st;
    };
    // Mutation checked: no conditional re-claim → this sweep sends it again (sent = 1, attempts = 3).
    const out = await quiet(() => retryCohortNotifications({ DB, JWT_SECRET, ENVIRONMENT: 'development' } as any, Date.parse('2026-12-01T06:00:00Z')));
    assert.deepEqual(out, { sent: 0, failed: 0, abandoned: 0 });
    assert.deepEqual(one(db, "SELECT status, attempts FROM cohort_app_notification_ledger WHERE notif_type = 'raced'"), { status: 'sent', attempts: 2 });
  } finally { db.close(); }
});
