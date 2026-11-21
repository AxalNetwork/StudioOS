/**
 * #6204 (D6204) — `GET /api/positions/kpi-compliance` names each obligation's due date and how late a
 * company is. Owner answer of 2026-11-16: per book, default 30 — the caller's reporting duty's own
 * `due_days` after the period ends, else 30 days. Real schema, synthetic fixtures only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/reporting_due_6204.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import positions from '../src/routes/positions.ts';
import { addDays, reportDue, REPORT_DUE_DEFAULT_DAYS } from '../src/services/portfolioMetrics.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-6204-0123456789-abcdef';
const ADMIN = 1, HOLDER = 6, OTHER = 7;
const AS_OF = '2026-11-12';

function fixture({ duties = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const u = db.prepare(`INSERT INTO users (id, role, name, email, is_active, investor_tier, investor_subscription_status) VALUES (?, ?, ?, ?, 1, ?, 'active')`);
  u.run(ADMIN, 'admin', 'Ada', 'ada@axal.example', 'free');
  u.run(HOLDER, 'investor', 'Hal', 'hal@angel.example', 'professional');
  u.run(OTHER, 'investor', 'Oli', 'oli@angel.example', 'professional');
  db.exec(`
    INSERT INTO projects (id, uid, name, founder_id) VALUES (7, 'p7', 'Venture Seven', 70), (8, 'p8', 'Venture Eight', 80), (9, 'p9', 'Venture Nine', 90);
    INSERT INTO deals (id, project_id) VALUES (70, 7);
    INSERT INTO investor_dealroom_members (investor_user_id, deal_id) VALUES (${HOLDER}, 70);
    INSERT INTO commitments (id, deal_id, investor_user_id, amount, status) VALUES (1, 70, ${HOLDER}, 1000, 'confirmed');
    INSERT INTO portfolio_positions (uid, project_id, round_name, invested_amount, position_date)
      VALUES ('pos7', 7, 'Seed', 500, '2026-01-10'), ('pos8', 8, 'Seed', 800, '2026-02-10'), ('pos9', 9, 'Seed', 900, '2026-02-10');
    INSERT INTO portfolio_updates (uid, project_id, author_user_id, title, status, period, submitted_at)
      VALUES ('u9', 9, 90, 'Q3', 'submitted', '2026-Q3', '2026-10-20T10:00:00.000Z');
  `);
  if (!duties) db.exec('DROP TABLE reporting_duties');
  else {
    const d = db.prepare(`INSERT INTO reporting_duties (closing_id, closing_line_id, closing_line_uid, project_id, holder_user_id, kind, cadence, due_rule, due_days,
      source_document, source_clause, source_kind, starts_on, status) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, 'IRA', '§1.1', 'closing_template', '2026-01-01', ?)`);
    let line = 0;
    const duty = (project: number, holder: number, kind: string, cadence: string, rule: string, days: number, status = 'active') => { line += 1; d.run(line, `l${line}`, project, holder, kind, cadence, rule, days, status); };
    duty(7, HOLDER, 'quarterly_kpi', 'quarterly', 'after_end', 45);       // Hal's own term
    duty(7, OTHER, 'quarterly_kpi', 'quarterly', 'after_end', 10);        // another investor's, stricter
    duty(8, OTHER, 'monthly_financials', 'monthly', 'after_end', 5);      // another cadence
    duty(8, OTHER, 'quarterly_kpi', 'quarterly', 'after_end', 1, 'ended'); // ended
    duty(8, OTHER, 'annual_budget', 'quarterly', 'before_start', 2);      // not an after-end term
  }
  return db;
}

const app = new Hono<any>();
app.route('/api/positions', positions);
async function call(db: DatabaseSync, userId: number, path: string) {
  const role = (db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any)?.role;
  const token = await new SignJWT({ user_id: userId, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  let res: Response;
  try {
    res = await app.fetch(new Request(`http://t/api${path}`, { headers: { Authorization: `Bearer ${token}` } }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  } catch (e) { if (e instanceof Response) res = e; else throw e; }
  return { status: res.status, body: await res.json() as any };
}
const due = (body: any) => Object.fromEntries(body.companies.map((x: any) => [x.project_id, [x.due_date, x.due_days, x.due_basis, x.days_overdue, x.overdue]]));

// Mutation checked: the default not 30 (fails); due counted from the period start (fails); days overdue off by one (fails);
// a reported company overdue (fails); a company before its due day overdue (fails); an unreadable duty read given a date (fails).
test('reportDue: the duty term or the firm default after the period ends; late only when unreported and past it', () => {
  assert.equal(REPORT_DUE_DEFAULT_DAYS, 30);
  assert.equal(addDays('2026-09-30', 30), '2026-10-30');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('not a date', 1), null);
  assert.deepEqual(reportDue('2026-09-30', null, false, '2026-11-12'),
    { due_date: '2026-10-30', due_days: 30, due_basis: 'firm_default', due_reason: null, days_overdue: 13, overdue: true });
  assert.deepEqual(reportDue('2026-09-30', 45, false, '2026-11-12'),
    { due_date: '2026-11-14', due_days: 45, due_basis: 'reporting_duty', due_reason: null, days_overdue: null, overdue: false });
  assert.equal(reportDue('2026-09-30', 43, false, '2026-11-12').days_overdue, null, 'on the due day itself it is not late');
  assert.equal(reportDue('2026-09-30', 42, false, '2026-11-12').days_overdue, 1, 'the day after is one day late');
  assert.equal(reportDue('2026-09-30', 0, false, '2026-11-12').due_basis, 'reporting_duty', 'a recorded 0 is a term, not the default');
  assert.equal(reportDue('2026-09-30', 10, true, '2026-11-12').overdue, false, 'a company that reported is never overdue');
  const unread = reportDue('2026-09-30', undefined, false, '2026-11-12');
  assert.equal(unread.due_date, null);
  assert.match(unread.due_reason!, /could not be read/);
  assert.equal(unread.overdue, false);
  assert.match(reportDue(null, 10, false, '2026-11-12').due_reason!, /no end date/);
});

// Mutation checked: another investor's term applied to the holder (fails); MIN dropped for the admin (fails); an ended, a
// before-start or another cadence's duty counted (fails); overdue_project_ids not the overdue set (fails).
test('kpi-compliance: each company carries its due day from the caller\'s book, else the default, and the Worker\'s overdue set', async () => {
  const db = fixture();
  const admin = await call(db, ADMIN, `/positions/kpi-compliance?as_of=${AS_OF}&period=2026-Q3`);
  assert.equal(admin.status, 200);
  assert.deepEqual(due(admin.body), {
    7: ['2026-10-10', 10, 'reporting_duty', 33, true],   // the whole book: the earliest term on the company
    8: ['2026-10-30', 30, 'firm_default', 13, true],     // no quarterly after-end duty in force
    9: ['2026-10-30', 30, 'firm_default', null, false],  // reported
  });
  assert.equal(admin.body.overdue_count, 2);
  assert.deepEqual(admin.body.overdue_project_ids, [7, 8]);
  assert.equal(admin.body.due_default_days, 30);
  assert.equal(admin.body.due_read, 'ok');

  const holder = await call(db, HOLDER, `/positions/kpi-compliance?as_of=${AS_OF}&period=2026-Q3`);
  assert.equal(holder.status, 200);
  assert.deepEqual(due(holder.body), { 7: ['2026-11-14', 45, 'reporting_duty', null, false] }, 'the holder\'s own term: not yet due');
  assert.equal(holder.body.overdue_count, 0);
  assert.deepEqual(holder.body.overdue_project_ids, [], 'unreported but not yet due is not in the overdue set');
});

// Mutation checked: a failed duties read falling back to the default (fails); the read failure failing the whole route (fails).
test('kpi-compliance: a duties read that fails claims no due date and no overdue company', async () => {
  const db = fixture({ duties: false });
  const r = await call(db, ADMIN, `/positions/kpi-compliance?as_of=${AS_OF}&period=2026-Q3`);
  assert.equal(r.status, 200);
  assert.equal(r.body.due_read, 'unreadable');
  for (const x of r.body.companies) {
    assert.equal(x.due_date, null);
    assert.equal(x.overdue, false);
    assert.match(x.due_reason, /could not be read/);
  }
  assert.equal(r.body.overdue_count, 0);
});
