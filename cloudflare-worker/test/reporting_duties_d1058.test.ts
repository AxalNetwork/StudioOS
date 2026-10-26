/**
 * D1058 (#2928, part 2 of #2427) — reporting duties, periods and events over
 * migration 579, `createReportingDuties`, the daily step, and `/api/reporting`:
 *
 *   · the periods: labels, ends and due days for each cadence, a budget owed
 *     before its year, and late and missing worked out on read;
 *   · duties from signed paper only: a completed envelope's clauses, else the
 *     closing's template; a blank term takes owner question 4's default and
 *     says so; a withdrawn line, an open closing and a SAFE make none; a second
 *     run writes nothing;
 *   · the daily step: duties a closing missed, every period that has come
 *     (once), and the team's reminders, each claimed once, never to an
 *     investor, never for a waived period, never a stale burst;
 *   · the desk for the venture's team (an advisor and an admin read, only the
 *     owner and co-founders write); the investor's view, ask and waive, scoped
 *     to the caller: another investor's duty, name or period is never seen.
 *
 * Every bank, e-sign and mail call stays stubbed: `fetch` throws and is
 * counted. Every name and figure is invented.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/reporting_duties_d1058.test.ts
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import reporting from '../src/routes/reporting.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import {
  DEFAULT_DUE_DAYS, addDays, createReportingDuties, documentKey, firstPeriod, nextPeriod, openPeriods, periodOf, periodState,
  periodsDue, reminderWords, rightsOf, runReportingDaily, sendReminders, cleanReminders,
} from '../src/services/reportingDuties.ts';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIG = (f: string) => read(`cloudflare-worker/sql/migrations/${f}`);
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const app = new Hono<any>();
app.route('/api/reporting', reporting);
app.onError((err: any, c) => {
  if (err instanceof Response) return err;
  const status = AUTH_ERROR_STATUSES[err?.message ?? ''];
  return c.json({ detail: err?.message }, status ?? 500);
});

let fetches = 0;
const realFetch = globalThis.fetch;
beforeEach(() => { fetches = 0; globalThis.fetch = (async () => { fetches += 1; throw new Error('no network in D1058'); }) as any; });
afterEach(() => { globalThis.fetch = realFetch; assert.equal(fetches, 0, 'fetch was called'); });

const ADMIN = 1, FOUNDER = 3, OTHER_FOUNDER = 4, INV_A = 6, INV_B = 7, INV_C = 8, COFOUNDER = 9, ADVISOR = 10;
const ROLE: Record<number, string> = { 1: 'admin', 3: 'founder', 4: 'founder', 6: 'investor', 7: 'investor', 8: 'investor', 9: 'founder', 10: 'advisor' };
const TODAY = new Date().toISOString().slice(0, 10);
const CLOSED = addDays(TODAY, -100);

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of ['312_fund_call_ledger.sql', '335_deal_transfers_and_closing_checklists.sql', '340_deal_transfer_company.sql',
    '410_safe_issuances.sql', '599_deal_currency.sql', '337_portfolio_update_chases.sql']) db.exec(MIG(f));
  db.exec('ALTER TABLE raise_prospects ADD COLUMN amount_cents INTEGER');
  db.exec(MIG('612_closings.sql'));
  db.exec(MIG('579_reporting_duties.sql'));
  db.exec(`
    INSERT INTO founders (id, name, email) VALUES (31, 'Fay Founder', 'fay@example.test'), (32, 'Otis Other', 'otis@example.test');
    INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES
      (1, 'admin', 'Ada Admin', 'ada@example.test', NULL, 1), (3, 'founder', 'Fay Founder', 'fay@example.test', 31, 1),
      (4, 'founder', 'Otis Other', 'otis@example.test', 32, 1), (6, 'investor', 'Ivy Alpha', 'ivy@example.test', NULL, 1),
      (7, 'investor', 'Ben Beta', 'ben@example.test', NULL, 1), (8, 'investor', 'Cal Gamma', 'cal@example.test', NULL, 1),
      (9, 'founder', 'Cora Cofounder', 'cora@example.test', NULL, 1), (10, 'advisor', 'Avi Advisor', 'avi@example.test', NULL, 1);
    INSERT INTO projects (id, uid, name, founder_id) VALUES (7, 'proj-seven', 'Fixture Venture', 31), (8, 'proj-eight', 'Other Venture', 32);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (7, 9, 'cofounder', 'accepted'), (7, 10, 'advisor', 'accepted');
    INSERT INTO deals (id, uid, project_id, status, instrument) VALUES (41, 'd-41', 7, 'active', 'spa'), (42, 'd-42', 8, 'active', 'safe'), (43, 'd-43', 8, 'active', 'safe');
    INSERT INTO commitments (id, uid, deal_id, investor_user_id, amount, status) VALUES
      (101, 'cm-a', 41, 6, 250000, 'confirmed'), (102, 'cm-b', 41, 7, 125000, 'confirmed'), (103, 'cm-c', 41, 8, 50000, 'withdrawn'),
      (104, 'cm-o', 42, 8, 70000, 'confirmed'), (105, 'cm-s', 43, 8, 10000, 'confirmed');
    INSERT INTO esign_envelopes (id, envelope_uuid, user_id, deal_id, document_type, document_title, document_body, body_sha256, status, created_by) VALUES
      (501, 'env-a', 6, 41, 'voting_rights', 'Investors Rights Agreement', 'signed body', 'sha-a', 'completed', 1),
      (502, 'env-b', 7, 41, 'voting_rights', 'Investors Rights Agreement', 'unsigned body', 'sha-b', 'sent', 1);
    INSERT INTO closings (id, uid, deal_id, project_id, template_slug, status, closed_at, created_by) VALUES
      (1, 'cl-one', 41, 7, 'term_sheet_v1', 'closed', '${CLOSED} 10:00:00', 1),
      (2, 'cl-open', 42, 8, 'voting_rights_v1', 'open', NULL, 1),
      (3, 'cl-safe', 43, 8, 'safe_v1', 'closed', '${CLOSED} 10:00:00', 1);
    INSERT INTO closing_lines (id, uid, closing_id, commitment_id, investor_user_id, amount_cents, envelope_id, status, created_by) VALUES
      (11, 'ln-a', 1, 101, 6, 25000000, 501, 'received', 1),
      (12, 'ln-b', 1, 102, 7, 12500000, 502, 'received', 1),
      (13, 'ln-c', 1, 103, 8, 5000000, NULL, 'withdrawn', 1),
      (14, 'ln-o', 2, 104, 8, 7000000, NULL, 'received', 1),
      (15, 'ln-s', 3, 105, 8, 1000000, NULL, 'received', 1);
    -- A line still only sent (an invariant D1215 keeps off a closed closing; here it proves only Received is owed).
    INSERT INTO closing_lines (id, uid, closing_id, prospect_id, investor_user_id, amount_cents, envelope_id, status, created_by) VALUES
      (16, 'ln-p', 1, 77, 8, 900000, NULL, 'sent', 1);
  `);
  return db;
}

const env = (db: DatabaseSync) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
async function token(user: number) {
  return new SignJWT({ user_id: user, role: ROLE[user] }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
async function call(db: DatabaseSync, method: string, path: string, as: number, body?: unknown) {
  const res = await app.request(path, {
    method, headers: { Authorization: `Bearer ${await token(as)}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env(db));
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}
const all = (db: DatabaseSync, sql: string) => JSON.parse(JSON.stringify(db.prepare(sql).all()));
const one = (db: DatabaseSync, sql: string) => JSON.parse(JSON.stringify(db.prepare(sql).get()));

async function ready() {
  const db = freshDb();
  await createReportingDuties(env(db), 1);
  await openPeriods(env(db), TODAY);
  return db;
}

// ---------------------------------------------------------------- periods

test('periods: each cadence\'s label, end and due day; a budget is owed before its year', () => {
  assert.deepEqual(periodOf('monthly', 'after_end', 30, '2026-02-10'), { label: '2026-02', start: '2026-02-01', end: '2026-02-28', due_on: '2026-03-30' });
  assert.deepEqual(periodOf('quarterly', 'after_end', 45, '2026-08-01'), { label: '2026-Q3', start: '2026-07-01', end: '2026-09-30', due_on: '2026-11-14' });
  assert.deepEqual(periodOf('annual', 'after_end', 120, '2026-05-05'), { label: 'FY2026', start: '2026-01-01', end: '2026-12-31', due_on: '2027-04-30' });
  assert.deepEqual(periodOf('annual', 'before_start', 30, '2027-03-01'), { label: 'B2027', start: '2027-01-01', end: '2027-12-31', due_on: '2026-12-02' });
  // A duty that starts after this year's budget was due owes next year's first.
  assert.equal(firstPeriod('annual', 'before_start', 30, '2026-07-01').label, 'B2027');
  assert.equal(nextPeriod('quarterly', 'after_end', 45, periodOf('quarterly', 'after_end', 45, '2026-11-01')).label, '2027-Q1');
  // Periods open the day after they end; a budget 30 days before it is due.
  const monthly = periodsDue({ cadence: 'monthly', due_rule: 'after_end', due_days: 30, starts_on: '2026-07-15' }, '2026-10-01');
  assert.deepEqual(monthly.map((p) => p.label), ['2026-07', '2026-08', '2026-09']);
  // B2027 is due 2 Dec 2026, so it opens on 2 Nov.
  assert.deepEqual(periodsDue({ cadence: 'annual', due_rule: 'before_start', due_days: 30, starts_on: '2026-07-01' }, '2026-11-02').map((p) => p.label), ['B2027']);
  assert.deepEqual(periodsDue({ cadence: 'annual', due_rule: 'before_start', due_days: 30, starts_on: '2026-07-01' }, '2026-11-01'), []);
});

test('late and missing are worked out on read, never a zero or a stored flag', () => {
  const p = { due_on: '2026-10-30' };
  assert.deepEqual(periodState(p, '2026-11-29', '2026-10-01'), { state: 'upcoming', days_late: null, days_left: 29 });
  assert.deepEqual(periodState(p, '2026-11-29', '2026-10-16'), { state: 'due', days_late: null, days_left: 14 });
  assert.deepEqual(periodState(p, '2026-11-29', '2026-10-30'), { state: 'due', days_late: null, days_left: 0 });
  assert.deepEqual(periodState(p, '2026-11-29', '2026-11-05'), { state: 'late', days_late: 6, days_left: null });
  assert.deepEqual(periodState(p, '2026-11-29', '2026-11-29'), { state: 'missing', days_late: 30, days_left: null }, 'missing once the next period is due');
  assert.equal(periodState({ ...p, met_update_id: 5 }, '2026-11-29', '2026-12-30').state, 'sent');
  assert.equal(periodState({ ...p, waived_at: '2026-11-02' }, '2026-11-29', '2026-12-30').state, 'waived');
});

test('rights: the clauses of the signed documents, one per kind, with owner question 4\'s defaults named', () => {
  assert.equal(documentKey('voting_rights_v1'), 'voting_rights');
  assert.equal(documentKey('  Term_Sheet  '), 'term_sheet');
  assert.equal(documentKey('bad key!'), null);
  const ira = rightsOf([{ key: 'voting_rights', envelope: { id: 1, body_sha256: 'x' } }]);
  assert.deepEqual(ira.map((r) => [r.kind, r.due_rule, r.due_days, r.defaulted]), [
    ['monthly_financials', 'after_end', 30, []], ['quarterly_kpi', 'after_end', 45, ['due_days']],
    ['annual_audited', 'after_end', 120, []], ['annual_budget', 'before_start', 30, []]]);
  const ts = rightsOf([{ key: 'term_sheet' }]);
  assert.deepEqual(ts.map((r) => [r.kind, r.due_days, r.defaulted]),
    [['monthly_financials', DEFAULT_DUE_DAYS.monthly_financials, ['due_days']], ['annual_audited', 120, ['due_days']], ['annual_budget', 30, ['due_days']]]);
  // The IRA is preferred over the term sheet for a kind both give.
  assert.equal(rightsOf([{ key: 'term_sheet' }, { key: 'voting_rights', envelope: { id: 9, body_sha256: 's' } }])[0].document, 'voting_rights');
  assert.deepEqual(rightsOf([{ key: 'safe' }, { key: 'pro_rata_information_rights_side_letter' }]), [], 'no clause, no duty');
});

// ---------------------------------------------------------------- creation

test('createReportingDuties: a signed envelope\'s clauses, else the closing\'s template; withdrawn, open and SAFE make none; once only', async () => {
  const db = freshDb();
  const r = await createReportingDuties(env(db), 1);
  assert.deepEqual(r, { created: 7, reason: null });
  const rows = all(db, 'SELECT holder_user_id, kind, source_kind, source_document, body_sha256, source_envelope_id, defaulted_json, due_days, starts_on, closing_line_uid FROM reporting_duties ORDER BY holder_user_id, id');
  const a = rows.filter((x: any) => x.holder_user_id === INV_A), b = rows.filter((x: any) => x.holder_user_id === INV_B);
  assert.deepEqual(a.map((x: any) => x.kind), ['monthly_financials', 'quarterly_kpi', 'annual_audited', 'annual_budget']);
  assert.ok(a.every((x: any) => x.source_kind === 'signed_envelope' && x.body_sha256 === 'sha-a' && x.source_envelope_id === 501 && x.closing_line_uid === 'ln-a'));
  assert.deepEqual(b.map((x: any) => x.kind), ['monthly_financials', 'annual_audited', 'annual_budget'], 'an unsigned envelope is not read: the template is');
  assert.ok(b.every((x: any) => x.source_kind === 'closing_template' && x.body_sha256 === null && x.source_document === 'term_sheet'));
  assert.ok(b.every((x: any) => JSON.parse(x.defaulted_json).includes('due_days')));
  assert.ok(rows.every((x: any) => x.starts_on === CLOSED));
  assert.ok(!rows.some((x: any) => x.holder_user_id === INV_C), 'a withdrawn line, and one only sent, are owed nothing');
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM reporting_events WHERE event = 'duty_created'").n, 7);
  assert.deepEqual(await createReportingDuties(env(db), 1), { created: 0, reason: null }, 'a second run writes nothing');
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM reporting_events WHERE event = 'duty_created'").n, 7, 'and no second event');
  assert.deepEqual(await createReportingDuties(env(db), 2), { created: 0, reason: 'closing_not_closed' });
  assert.deepEqual(await createReportingDuties(env(db), 3), { created: 0, reason: 'no_information_rights' });
  assert.deepEqual(await createReportingDuties(env(db), 99), { created: 0, reason: 'closing_not_closed' });
});

test('579: one duty per line and kind, unique periods, append-only events with no figure column', async () => {
  const db = await ready();
  assert.throws(() => db.exec("INSERT INTO reporting_duties (closing_id, closing_line_id, closing_line_uid, project_id, kind, cadence, due_days, source_document, source_clause, source_kind, starts_on) VALUES (1, 11, 'ln-a', 7, 'monthly_financials', 'monthly', 30, 'x', 'x', 'signed_envelope', '2026-01-01')"), /UNIQUE/);
  const p = one(db, 'SELECT duty_id, period_label FROM reporting_periods LIMIT 1');
  assert.throws(() => db.exec(`INSERT INTO reporting_periods (duty_id, period_label, period_start, period_end, due_on) VALUES (${p.duty_id}, '${p.period_label}', '2026-01-01', '2026-01-31', '2026-03-02')`), /UNIQUE/);
  assert.throws(() => db.exec("UPDATE reporting_events SET event = 'sent'"), /append-only/);
  assert.throws(() => db.exec('DELETE FROM reporting_events'), /append-only/);
  assert.deepEqual(all(db, 'PRAGMA table_info(reporting_events)').map((c: any) => c.name),
    ['id', 'project_id', 'duty_id', 'period_id', 'actor_user_id', 'event', 'ref', 'created_at'], 'no amount or figure column');
  assert.throws(() => db.exec("INSERT INTO reporting_duties (closing_id, closing_line_id, closing_line_uid, project_id, kind, cadence, due_days, source_document, source_clause, source_kind, starts_on) VALUES (1, 12, 'ln-b', 7, 'quarterly_kpi', 'quarterly', 1.5, 'x', 'x', 'signed_envelope', '2026-01-01')"), /CHECK/);
});

// ---------------------------------------------------------------- the daily step

test('the daily step: duties a closing missed, every period that has come once, and nothing again on a second run', async () => {
  const db = freshDb();
  // A closing closed more than 45 days ago is past the catch-up window.
  assert.equal((await runReportingDaily(env(db), Date.parse(`${TODAY}T05:40:00Z`))).duties, 0);
  const recent = addDays(TODAY, -40);
  db.exec(`UPDATE closings SET closed_at = '${recent} 10:00:00' WHERE id = 1`);
  const first = await runReportingDaily(env(db), Date.parse(`${TODAY}T05:40:00Z`));
  assert.equal(first.duties, 7, 'the closed closing with no duty is caught');
  // Forty days back always spans a month end, so each holder's monthly duty has opened at least one period.
  const monthlyA = periodsDue({ cadence: 'monthly', due_rule: 'after_end', due_days: 30, starts_on: recent }, TODAY).length;
  assert.ok(monthlyA >= 1);
  assert.ok(first.periods >= monthlyA * 2);

  assert.equal(one(db, "SELECT COUNT(*) AS n FROM reporting_events WHERE event = 'period_opened'").n, first.periods);
  const again = await runReportingDaily(env(db), Date.parse(`${TODAY}T05:40:00Z`));
  assert.deepEqual([again.duties, again.periods, again.reminders], [0, 0, 0]);
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM reporting_events WHERE event = 'period_opened'").n, first.periods, 'no second event');
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM reporting_periods WHERE period_label LIKE '%-%' AND duty_id IN (SELECT id FROM reporting_duties WHERE kind = 'monthly_financials')").n, monthlyA * 2);
});

test('reminders: the team\'s, once per period and offset, never an investor, never a waived period, never a stale burst', async () => {
  const db = await ready();
  // A period due in 3 days: the 3-days-before reminder is today's.
  const target = one(db, "SELECT p.id, p.due_on FROM reporting_periods p JOIN reporting_duties d ON d.id = p.duty_id WHERE d.holder_user_id = 6 AND d.kind = 'monthly_financials' ORDER BY p.period_start DESC LIMIT 1");
  db.exec(`UPDATE reporting_periods SET due_on = '${addDays(TODAY, 3)}' WHERE id = ${target.id}`);
  // Every other open period is long past its reminders, so none is sent in a burst.
  db.exec(`UPDATE reporting_periods SET due_on = '${addDays(TODAY, -30)}' WHERE id <> ${target.id}`);
  db.exec("INSERT INTO reporting_reminder_settings (project_id, offsets_json, channels_json, recipients_json, updated_by) VALUES (7, '[14,3,0,-7]', '[\"in_app\"]', '[3,9,6]', 3)");
  const sent = await sendReminders(env(db), TODAY);
  assert.equal(sent, 1);
  assert.deepEqual(all(db, "SELECT period_id, ref FROM reporting_events WHERE event = 'reminder_sent'"), [{ period_id: target.id, ref: 'offset:3' }]);
  const to = all(db, "SELECT user_id FROM notifications_inbox WHERE type = 'reporting_reminder' ORDER BY user_id").map((n: any) => n.user_id);
  assert.deepEqual(to, [FOUNDER, COFOUNDER], 'the team only: an investor in the stored list is dropped');
  assert.equal(await sendReminders(env(db), TODAY), 0, 'claimed once');
  // A waived period gets none.
  db.exec(`UPDATE reporting_periods SET due_on = '${TODAY}', waived_at = '${TODAY}' WHERE id = ${target.id}`);
  assert.equal(await sendReminders(env(db), TODAY), 0);
  assert.match(reminderWords(3, '2026-11-14'), /due 14 Nov, in 3 days/);
  assert.match(reminderWords(-7, '2026-11-14'), /7 days late/);
});

test('reminder settings: offsets bounded, channels named, recipients from the team only', () => {
  const team = [3, 9];
  assert.deepEqual(cleanReminders({ offsets: [3, 14, 3], channels: ['email'], recipient_user_ids: [9] }, team), { offsets: [14, 3], channels: ['email'], recipients: [9] });
  for (const bad of [
    { offsets: [100], channels: ['in_app'], recipient_user_ids: [3] },
    { offsets: [1, 2, 3, 4, 5, 6, 7], channels: ['in_app'], recipient_user_ids: [3] },
    { offsets: [1], channels: ['sms'], recipient_user_ids: [3] },
    { offsets: [1], channels: ['in_app'], recipient_user_ids: [6] },
    { offsets: [1.5], channels: ['in_app'], recipient_user_ids: [3] },
  ]) assert.throws(() => cleanReminders(bad, team), (e: any) => Array.isArray(e) && e[0] === 400, JSON.stringify(bad));
});

// ---------------------------------------------------------------- the desk

test('the desk: the venture\'s team and an admin read it with the investors\' names; only the owner and co-founders write', async () => {
  const db = await ready();
  const desk = await call(db, 'GET', '/api/reporting/desk?project=7', FOUNDER);
  assert.equal(desk.status, 200, desk.text);
  assert.equal(desk.body.duties.length, 7);
  assert.deepEqual([...new Set(desk.body.duties.map((d: any) => d.holder?.name))].sort(), ['Ben Beta', 'Ivy Alpha']);
  assert.ok(desk.body.periods.every((p: any) => ['upcoming', 'due', 'late', 'missing', 'sent', 'waived'].includes(p.state)));
  assert.ok(desk.body.periods.some((p: any) => p.state === 'missing' || p.state === 'late'));
  assert.equal(desk.body.can_write, true);
  assert.deepEqual(desk.body.reminders.offsets, [14, 3, 0, -7], 'the defaults');
  assert.deepEqual(desk.body.reminders.team.map((u: any) => u.id), [FOUNDER, COFOUNDER]);
  for (const [who, write] of [[COFOUNDER, true], [ADVISOR, false], [ADMIN, false]] as const) {
    const r = await call(db, 'GET', '/api/reporting/desk?project=7', who);
    assert.deepEqual([r.status, r.body.can_write], [200, write], ROLE[who]);
  }
  for (const who of [INV_A, OTHER_FOUNDER]) assert.equal((await call(db, 'GET', '/api/reporting/desk?project=7', who)).status, 404, ROLE[who]);
  assert.equal((await call(db, 'GET', '/api/reporting/desk', FOUNDER)).status, 400);
});

test('the expected date: the owner or a co-founder, a date from today, a short note; an admin, an advisor and an investor are refused', async () => {
  const db = await ready();
  const late = (await call(db, 'GET', '/api/reporting/desk?project=7', FOUNDER)).body.periods.find((p: any) => p.state === 'late' || p.state === 'missing');
  const at = `/api/reporting/periods/${late.uid}/expected`;
  for (const who of [ADMIN, ADVISOR]) assert.equal((await call(db, 'POST', at, who, { expected_on: addDays(TODAY, 5) })).status, 403, ROLE[who]);
  assert.equal((await call(db, 'POST', at, INV_A, { expected_on: addDays(TODAY, 5) })).status, 404);
  assert.equal((await call(db, 'POST', at, FOUNDER, { expected_on: addDays(TODAY, -1) })).status, 400);
  assert.equal((await call(db, 'POST', at, FOUNDER, { expected_on: '2026-13-01' })).status, 400);
  assert.equal((await call(db, 'POST', at, FOUNDER, { expected_on: addDays(TODAY, 5), note: 'x'.repeat(281) })).status, 400);
  const ok = await call(db, 'POST', at, COFOUNDER, { expected_on: addDays(TODAY, 5), note: 'Waiting on the accountant' });
  assert.deepEqual([ok.status, ok.body.expected_on], [200, addDays(TODAY, 5)]);
  assert.equal(one(db, `SELECT expected_note FROM reporting_periods WHERE uid = '${late.uid}'`).expected_note, 'Waiting on the accountant');
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM reporting_events WHERE event = 'expected_set'").n, 1);
  db.exec(`UPDATE reporting_periods SET waived_at = '${TODAY}' WHERE uid = '${late.uid}'`);
  const closed = await call(db, 'POST', at, FOUNDER, { expected_on: addDays(TODAY, 6) });
  assert.deepEqual([closed.status, closed.body?.error], [409, 'period_closed'], 'a waived period needs no date');
});

test('PUT /reminders: the founders\' own, saved and read back', async () => {
  const db = await ready();
  const bad = await call(db, 'PUT', '/api/reporting/reminders', FOUNDER, { project: 7, offsets: [3], channels: ['in_app'], recipient_user_ids: [INV_A] });
  assert.equal(bad.status, 400);
  assert.equal((await call(db, 'PUT', '/api/reporting/reminders', ADMIN, { project: 7, offsets: [3], channels: ['in_app'], recipient_user_ids: [FOUNDER] })).status, 403);
  const ok = await call(db, 'PUT', '/api/reporting/reminders', FOUNDER, { project: 7, offsets: [7, 0], channels: ['in_app', 'email'], recipient_user_ids: [COFOUNDER] });
  assert.equal(ok.status, 200, ok.text);
  const desk = (await call(db, 'GET', '/api/reporting/desk?project=7', FOUNDER)).body;
  assert.deepEqual([desk.reminders.offsets, desk.reminders.recipient_user_ids, desk.reminders.saved], [[7, 0], [COFOUNDER], true]);
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM reporting_events WHERE event = 'reminders_set'").n, 1);
});

// ---------------------------------------------------------------- the investor

test('an investor reads only the duties owed to them: never another investor\'s duty, name or period', async () => {
  const db = await ready();
  const a = await call(db, 'GET', '/api/reporting/portfolio', INV_A);
  assert.equal(a.status, 200, a.text);
  assert.equal(a.body.companies.length, 1);
  assert.equal(a.body.companies[0].uid, 'proj-seven');
  assert.equal(a.body.companies[0].duties.length, 4);
  assert.ok(!/Ben Beta|ben@|holder|closing_line_uid|Ivy Alpha/.test(a.text), 'no holder, no other investor, not even their own name');
  const bPeriods = all(db, 'SELECT uid FROM reporting_periods WHERE duty_id IN (SELECT id FROM reporting_duties WHERE holder_user_id = 7)').map((p: any) => p.uid);
  assert.ok(!bPeriods.some((uid: string) => a.text.includes(uid)), 'none of B\'s periods');
  const b = await call(db, 'GET', '/api/reporting/portfolio', INV_B);
  assert.equal(b.body.companies[0].duties.length, 3);
  const c = await call(db, 'GET', '/api/reporting/portfolio', INV_C);
  assert.deepEqual(c.body.companies, []);
  assert.equal((await call(db, 'GET', '/api/reporting/companies/proj-seven', INV_C)).status, 404, 'a company that owes the caller nothing is not found');
  const co = await call(db, 'GET', '/api/reporting/companies/proj-seven', INV_A);
  assert.deepEqual([co.status, co.body.company.duties.length], [200, 4]);
  assert.equal((await call(db, 'GET', '/api/reporting/companies/bad%20uid', INV_A)).status, 404);
});

test('ask: once per period while late, a D464 chase and the team told; waive once; another investor\'s period is 404', async () => {
  const db = await ready();
  const periods = (await call(db, 'GET', '/api/reporting/portfolio', INV_A)).body.companies[0].periods;
  const late = periods.find((p: any) => p.state === 'late' || p.state === 'missing');
  const upcoming = periods.find((p: any) => p.state === 'upcoming' || p.state === 'due');
  if (upcoming) assert.deepEqual([(await call(db, 'POST', `/api/reporting/periods/${upcoming.uid}/ask`, INV_A)).body?.error], ['not_late']);
  assert.equal((await call(db, 'POST', `/api/reporting/periods/${late.uid}/ask`, INV_B)).status, 404, 'B cannot touch A\'s period');
  assert.equal((await call(db, 'POST', `/api/reporting/periods/${late.uid}/waive`, INV_B)).status, 404);
  const asked = await call(db, 'POST', `/api/reporting/periods/${late.uid}/ask`, INV_A);
  assert.equal(asked.status, 200, asked.text);
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM portfolio_update_chases WHERE project_id = 7 AND chased_by = 6').n, 1);
  assert.deepEqual(all(db, "SELECT user_id FROM notifications_inbox WHERE type = 'reporting_asked' ORDER BY user_id").map((n: any) => n.user_id), [FOUNDER, COFOUNDER]);
  const twice = await call(db, 'POST', `/api/reporting/periods/${late.uid}/ask`, INV_A);
  assert.deepEqual([twice.status, twice.body?.error], [409, 'already_asked']);
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM portfolio_update_chases').n, 1, 'one chase per period');
  const after = (await call(db, 'GET', '/api/reporting/portfolio', INV_A)).body.companies[0].periods.find((p: any) => p.uid === late.uid);
  assert.equal(after.asked, true);
  const desk = (await call(db, 'GET', '/api/reporting/desk?project=7', FOUNDER)).body;
  assert.deepEqual(desk.asks.map((x: any) => x.period_uid), [late.uid]);

  const waived = await call(db, 'POST', `/api/reporting/periods/${late.uid}/waive`, INV_A);
  assert.equal(waived.status, 200, waived.text);
  assert.equal((await call(db, 'POST', `/api/reporting/periods/${late.uid}/waive`, INV_A)).body?.error, 'already_waived');
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM reporting_events WHERE event = 'waived'").n, 1);
  const state = (await call(db, 'GET', '/api/reporting/portfolio', INV_A)).body.companies[0].periods.find((p: any) => p.uid === late.uid).state;
  assert.equal(state, 'waived');
  // A sent period has nothing to waive.
  const other = periods.find((p: any) => p.uid !== late.uid && (p.state === 'late' || p.state === 'missing'));
  db.exec("INSERT INTO portfolio_updates (id, uid, project_id, author_user_id, title, period, status) VALUES (900, 'pu-900', 7, 3, 'July update', '2026-07', 'submitted')");
  db.exec(`UPDATE reporting_periods SET met_update_id = 900, met_at = '${TODAY}' WHERE uid = '${other.uid}'`);
  assert.equal((await call(db, 'POST', `/api/reporting/periods/${other.uid}/waive`, INV_A)).body?.error, 'period_sent');
});

test('the wiring: mounted at /api/reporting, CAPITAL\'s close calls it, the cron runs it, the client has one line in api.js', () => {
  const index = read('cloudflare-worker/src/index.ts');
  assert.ok(index.includes("app.route('/api/reporting', reporting);"));
  assert.match(index, /runReportingDaily\(env, now\.getTime\(\)\)/);
  assert.match(read('cloudflare-worker/src/services/closings.ts'), /createReportingDuties\(env, closing\.id\)/);
  assert.ok(read('frontend/src/lib/api.js').includes("export * from './api/reporting.js';"));
  const src = read('cloudflare-worker/src/routes/reporting.ts') + read('cloudflare-worker/src/services/reportingDuties.ts');
  assert.ok(!/prepare\(`[^`]*\$\{/.test(src), 'no interpolation inside a prepared statement');
});
