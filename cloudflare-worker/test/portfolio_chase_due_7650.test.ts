/**
 * #7650 (D7650) — `POST /api/portfolio/chase` chases a company only when a
 * reporting obligation applies to it in the caller's book and the report for
 * its current period is due or overdue and unreported. Every other target is
 * skipped with a typed reason before any chase row or notification is written.
 * Real schema, synthetic fixtures only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/portfolio_chase_due_7650.test.ts
 *
 * The tests do not depend on today's date: a duty of 0 days after the period
 * ends makes the last completed period due on any day, and one of 366 days (the most a duty records)
 * keeps it not yet due on any day.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import portfolio from '../src/routes/portfolio.ts';
import { completedPeriod } from '../src/services/portfolioMetrics.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-7650-0123456789-abcdef';
const ADMIN = 1, HOLDER = 6, OUTSIDER = 7;
// Projects in HOLDER's deal rooms. 11-14 are held; 15 is seen but not held.
// The Worker reads the real clock; the fixtures are placed relative to it.
const NOW_ISO = new Date().toISOString(); // clock-ok: relative
const TODAY = NOW_ISO.slice(0, 10);
const PERIOD = completedPeriod('quarterly', TODAY);
const OVERDUE = 11, NOT_DUE = 12, REPORTED = 13, DEFAULTED = 14, SEEN_ONLY = 15;

function fixture({ duties = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const u = db.prepare(`INSERT INTO users (id, role, name, email, founder_id, is_active, investor_tier, investor_subscription_status)
                        VALUES (?, ?, ?, ?, ?, 1, ?, 'active')`);
  u.run(ADMIN, 'admin', 'Ada', 'ada@axal.example', null, 'free');
  u.run(HOLDER, 'investor', 'Hal', 'hal@angel.example', null, 'professional');
  u.run(OUTSIDER, 'investor', 'Oli', 'oli@angel.example', null, 'professional');
  const project = db.prepare(`INSERT INTO projects (id, uid, name, founder_id) VALUES (?, ?, ?, ?)`);
  const deal = db.prepare(`INSERT INTO deals (id, project_id) VALUES (?, ?)`);
  const room = db.prepare(`INSERT INTO investor_dealroom_members (investor_user_id, deal_id) VALUES (?, ?)`);
  const founder = db.prepare(`INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES (?, 'founder', ?, ?, ?, 1)`);
  for (const pid of [OVERDUE, NOT_DUE, REPORTED, DEFAULTED, SEEN_ONLY]) {
    project.run(pid, `p${pid}`, `Venture ${pid}`, 900 + pid);
    founder.run(100 + pid, `Founder ${pid}`, `f${pid}@venture.example`, 900 + pid);
    deal.run(pid * 10, pid);
    room.run(HOLDER, pid * 10);
  }
  const commit = db.prepare(`INSERT INTO commitments (deal_id, investor_user_id, amount, status) VALUES (?, ?, 1000, 'confirmed')`);
  const position = db.prepare(`INSERT INTO portfolio_positions (uid, project_id, round_name, invested_amount, position_date) VALUES (?, ?, 'Seed', 500, '2026-01-10')`);
  for (const pid of [OVERDUE, NOT_DUE, REPORTED, DEFAULTED]) {
    commit.run(pid * 10, HOLDER);
    position.run(`pos${pid}`, pid);
  }
  if (!duties) db.exec('DROP TABLE reporting_duties');
  else {
    const d = db.prepare(`INSERT INTO reporting_duties (closing_id, closing_line_id, closing_line_uid, project_id, holder_user_id, kind, cadence, due_rule, due_days,
      source_document, source_clause, source_kind, starts_on, status) VALUES (1, ?, ?, ?, ?, 'quarterly_kpi', 'quarterly', 'after_end', ?, 'IRA', '§1.1', 'closing_template', '2026-01-01', 'active')`);
    let line = 0;
    const duty = (pid: number, holder: number, days: number) => { line += 1; d.run(line, `l${line}`, pid, holder, days); };
    duty(OVERDUE, HOLDER, 0);
    duty(NOT_DUE, HOLDER, 366);
    duty(NOT_DUE, OUTSIDER, 0);   // another investor's stricter term is not this holder's
    duty(REPORTED, HOLDER, 0);
  }
  // REPORTED has submitted an update for the period being chased.
  const period = PERIOD;
  db.prepare(`INSERT INTO portfolio_updates (uid, project_id, author_user_id, title, status, period, submitted_at)
              VALUES ('u13', ?, ?, 'Update', 'submitted', ?, '2026-10-20T10:00:00.000Z')`).run(REPORTED, 100 + REPORTED, period);
  return db;
}

const app = new Hono<any>();
app.route('/api/portfolio', portfolio);
async function chase(db: DatabaseSync, userId: number, projectIds: number[]) {
  const role = (db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any)?.role;
  const token = await new SignJWT({ user_id: userId, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  let res: Response;
  try {
    res = await app.fetch(new Request('http://t/api/portfolio/chase', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_ids: projectIds }),
    }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  } catch (e) { if (e instanceof Response) res = e; else throw e; }
  return { status: res.status, body: await res.json() as any };
}
const reasons = (body: any) => Object.fromEntries(body.skips.map((s: any) => [s.project_id, s.reason]));
const chaseRows = (db: DatabaseSync) => db.prepare('SELECT project_id FROM portfolio_update_chases ORDER BY id').all().map((r: any) => r.project_id);
const notified = (db: DatabaseSync) => db.prepare("SELECT user_id FROM notifications_inbox WHERE type = 'portfolio_update_chase' ORDER BY id").all().map((r: any) => r.user_id);

test('each target that is not due and unreported is skipped with its reason, and nothing is written for it', async () => {
  const db = fixture();
  const r = await chase(db, HOLDER, [OVERDUE, NOT_DUE, REPORTED, SEEN_ONLY]);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.chased.map((c: any) => c.project_id), [OVERDUE], 'only the company whose report is due and unreported is chased');
  assert.deepEqual(reasons(r.body), { [NOT_DUE]: 'not_due', [REPORTED]: 'already_reported', [SEEN_ONLY]: 'no_obligation' });
  assert.deepEqual(r.body.skipped, [NOT_DUE, REPORTED, SEEN_ONLY], 'the existing field keeps its shape: the skipped ids');
  const notDue = r.body.skips.find((s: any) => s.project_id === NOT_DUE);
  assert.match(notDue.message, /not due yet/);
  assert.match(String(notDue.due_date), /^\d{4}-\d{2}-\d{2}$/, 'a not-due skip names its due date');
  assert.equal(notDue.period, PERIOD);
  assert.deepEqual(chaseRows(db), [OVERDUE], 'no chase row for a skipped company');
  assert.deepEqual(notified(db), [100 + OVERDUE], 'no notification for a skipped company');
});

test('an overdue company is chased once; a repeat inside the hour answers the existing row', async () => {
  const db = fixture();
  const first = await chase(db, HOLDER, [OVERDUE]);
  assert.equal(first.body.chased[0].already, false);
  assert.equal(first.body.chased[0].period, PERIOD);
  const second = await chase(db, HOLDER, [OVERDUE]);
  assert.equal(second.body.chased[0].already, true);
  assert.equal(second.body.chased[0].uid, first.body.chased[0].uid);
  assert.deepEqual(chaseRows(db), [OVERDUE]);
  assert.deepEqual(notified(db), [100 + OVERDUE], 'the founder is notified once');
});

test('the repeat window compares normalised times: an ISO-stamped chase two hours old does not hold back a new one', async () => {
  const db = fixture();
  const old = new Date(Date.parse(NOW_ISO) - 2 * 3600_000).toISOString();
  db.prepare('INSERT INTO portfolio_update_chases (uid, project_id, chased_by, created_at) VALUES (?, ?, ?, ?)').run('old-chase', OVERDUE, HOLDER, old);
  const r = await chase(db, HOLDER, [OVERDUE]);
  assert.equal(r.body.chased[0].already, false, 'a chase two hours old is outside the hour');
  assert.notEqual(r.body.chased[0].uid, 'old-chase');
  assert.deepEqual(chaseRows(db), [OVERDUE, OVERDUE]);
});

test('a company with no duty takes the firm default of 30 days, and is chased only once that has passed', async () => {
  const db = fixture();
  const r = await chase(db, HOLDER, [DEFAULTED]);
  const period = PERIOD!;
  const [y, q] = period.split('-Q').map(Number);
  const until = new Date(Date.UTC(y, q * 3, 0)).toISOString().slice(0, 10);
  const due = new Date(Date.parse(until) + 30 * 86_400_000).toISOString().slice(0, 10);
  if (due <= TODAY) assert.deepEqual(r.body.chased.map((c: any) => c.project_id), [DEFAULTED]);
  else assert.deepEqual([reasons(r.body)[DEFAULTED], r.body.skips[0].due_date], ['not_due', due]);
});

test('a failed obligation read refuses the target as unreadable, never as eligible', async () => {
  const db = fixture({ duties: false });
  const r = await chase(db, HOLDER, [OVERDUE]);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.chased, []);
  assert.deepEqual(reasons(r.body), { [OVERDUE]: 'unreadable' });
  assert.match(r.body.skips[0].message, /could not be read/);
  assert.deepEqual(chaseRows(db), []);
  assert.deepEqual(notified(db), []);
});

test('the tenancy refusal stands: a company outside the caller\'s book is skipped as no_obligation, with nothing written', async () => {
  const db = fixture();
  const r = await chase(db, OUTSIDER, [OVERDUE, 999]);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.chased, []);
  assert.deepEqual(reasons(r.body), { [OVERDUE]: 'no_obligation', 999: 'no_obligation' }, 'outside the book and not existing read the same');
  assert.deepEqual(chaseRows(db), []);
  assert.deepEqual(notified(db), []);
});

test('an admin chases any held company whose report is due, by the earliest term in the whole book', async () => {
  const db = fixture();
  const r = await chase(db, ADMIN, [OVERDUE, NOT_DUE, SEEN_ONLY]);
  assert.deepEqual(r.body.chased.map((c: any) => c.project_id), [OVERDUE, NOT_DUE], 'another holder\'s 0-day term applies across the whole book');
  assert.deepEqual(reasons(r.body), { [SEEN_ONLY]: 'no_obligation' }, 'a company with no position owes no report');
});
