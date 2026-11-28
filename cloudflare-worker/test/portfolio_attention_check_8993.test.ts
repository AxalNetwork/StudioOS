/**
 * D8993 (#8993): the daily portfolio check. A missed report, or a founder-reported
 * runway under six months, raises D6218's Needs-attention notice for the
 * company's holders, once per piece of evidence; a source it cannot read raises
 * nothing and is named.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/portfolio_attention_check_8993.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { ATTENTION_TYPE } from '../src/services/portfolioAttentionAlerts.ts';
import { runPortfolioAttentionCheck } from '../src/services/portfolioAttentionCheck.ts';
import { INVESTOR_GRANT } from '../src/routes/portfolio_updates.ts';

const HOLDER = 10, SEAT = 11, WATCHER = 12, PENDING = 13, OTHER_CO = 14, FOUNDER = 15, INACTIVE = 16;
const P = 1, Q = 2, FUND = 7;
// 27 Nov 2026: the last completed quarter is 2026-Q3, which ended 30 Sep; the firm default makes it due 30 Oct.
const TODAY = Date.parse('2026-11-27T05:45:00Z');
const at = (day: string) => Date.parse(`${day}T05:45:00Z`);

function fixture() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  db.exec(`
    INSERT INTO users (id, email, name, role, is_active, investor_seat_primary_user_id) VALUES
      (${HOLDER}, 'h@example.invalid', 'Holder', 'investor', 1, NULL),
      (${SEAT}, 's@example.invalid', 'Seat member', 'investor', 1, ${HOLDER}),
      (${WATCHER}, 'w@example.invalid', 'Watcher', 'investor', 1, NULL),
      (${PENDING}, 'p@example.invalid', 'Pending', 'investor', 1, NULL),
      (${OTHER_CO}, 'o@example.invalid', 'Other company', 'investor', 1, NULL),
      (${FOUNDER}, 'f@example.invalid', 'Founder', 'founder', 1, NULL),
      (${INACTIVE}, 'i@example.invalid', 'Inactive seat', 'investor', 0, ${HOLDER});
    INSERT INTO projects (id, uid, name) VALUES (${P}, 'proj-p-uid', 'Acme Robotics'), (${Q}, 'proj-q-uid', 'Other Co');
    INSERT INTO deals (id, project_id) VALUES (100, ${P}), (200, ${Q});
    INSERT INTO investor_introductions (uid, investor_user_id, project_id, status, quarter) VALUES
      ('i1', ${HOLDER}, ${P}, 'accepted', '2026-Q4'), ('i2', ${WATCHER}, ${P}, 'accepted', '2026-Q4'),
      ('i3', ${PENDING}, ${P}, 'accepted', '2026-Q4'), ('i4', ${OTHER_CO}, ${Q}, 'accepted', '2026-Q4');
    INSERT INTO commitments (deal_id, investor_user_id, amount, status) VALUES
      (100, ${HOLDER}, 1000, 'confirmed'), (100, ${PENDING}, 500, 'pending'), (200, ${OTHER_CO}, 700, 'confirmed'),
      (100, ${FOUNDER}, 1, 'confirmed');
    INSERT INTO vc_funds (id, name) VALUES (${FUND}, 'Fund I');
    INSERT INTO portfolio_positions (uid, fund_id, project_id, round_name, invested_amount) VALUES
      ('pos-p', ${FUND}, ${P}, 'Seed', 1000), ('pos-q', NULL, ${Q}, 'Seed', 700);
    -- P last reported for Q2 in July; Q has reported for Q3 (a month inside the quarter counts, D1057).
    INSERT INTO portfolio_updates (id, uid, project_id, author_user_id, period, title, status, submitted_at) VALUES
      (1, 'u-p-q2', ${P}, ${FOUNDER}, '2026-Q2', 'Q2', 'submitted', '2026-07-10 09:00:00'),
      (2, 'u-q-aug', ${Q}, ${FOUNDER}, '2026-08', 'August', 'submitted', '2026-09-02 09:00:00');
  `);
  const env = { DB: d1Over(db) } as any;
  const inbox = () => db.prepare(`SELECT user_id, type, title, body, link, payload FROM notifications_inbox ORDER BY id`).all() as any[];
  const ledger = () => db.prepare(`SELECT project_id, user_id, reason, evidence_key, checked_on FROM portfolio_attention_checks ORDER BY id`).all() as any[];
  return { db, env, inbox, ledger };
}

/** A founder update on P that HOLDER may read: shared with them as an investor recipient. */
function sharedUpdate(db: DatabaseSync, id: number, uid: string, kpis: object, submittedAt: string, period = '2026-Q4', status = 'submitted') {
  db.prepare(`INSERT INTO portfolio_updates (id, uid, project_id, author_user_id, period, title, kpis_json, status, submitted_at)
              VALUES (?, ?, ?, ?, ?, 'Update', ?, ?, ?)`).run(id, uid, P, FOUNDER, period, JSON.stringify(kpis), status, submittedAt);
  db.prepare(`INSERT INTO update_recipients (update_id, audience, user_id) VALUES (?, 'investor', ?)`).run(id, HOLDER);
}
const reasons = (rows: any[]) => rows.map((r) => `${r.user_id}:${JSON.parse(r.payload).reason}`);

test('a missed report notifies each holder of the company once, naming the period, the due day, the days late and the last report', async () => {
  const f = fixture();
  const r = await runPortfolioAttentionCheck(f.env, TODAY);
  assert.deepEqual([r.period, r.missed_report, r.short_runway, r.unreadable], ['2026-Q3', 2, 0, []]);
  const rows = f.inbox();
  assert.deepEqual(rows.map((x) => x.user_id), [HOLDER, SEAT]);
  for (const x of rows) {
    assert.equal(x.type, ATTENTION_TYPE);
    assert.equal(x.title, 'Acme Robotics needs attention');
    assert.equal(x.body, 'Report for 2026-Q3 overdue by 28 days: due 2026-10-30, last reported 2026-07-10. Source: Reporting.');
    assert.equal(x.link, '/portfolio/companies/proj-p-uid');
    assert.deepEqual(JSON.parse(x.payload), {
      project_uid: 'proj-p-uid', reason: 'missed_report', checked_on: '2026-11-27', period: '2026-Q3', due_date: '2026-10-30',
      days_overdue: 28, due_basis: 'firm_default', last_reported_at: '2026-07-10',
    });
  }
  // Q reported for Q3, so its holder is told nothing; nobody but P's holders is told about P.
  assert.equal(rows.some((x) => [WATCHER, PENDING, OTHER_CO, FOUNDER, INACTIVE].includes(x.user_id)), false);
});

test('no missed report: before the due day passes, once the report arrives, under a longer duty or fund term, or outside the reporting population', async () => {
  // The due day itself is not late (D6204).
  let f = fixture();
  assert.equal((await runPortfolioAttentionCheck(f.env, at('2026-10-30'))).missed_report, 0);
  assert.equal((await runPortfolioAttentionCheck(f.env, at('2026-10-31'))).missed_report, 2);

  f = fixture();
  f.db.exec(`INSERT INTO portfolio_updates (uid, project_id, author_user_id, period, title, status, submitted_at)
             VALUES ('u-p-sep', ${P}, ${FOUNDER}, '2026-09', 'September', 'submitted', '2026-10-20 09:00:00')`);
  assert.equal((await runPortfolioAttentionCheck(f.env, TODAY)).missed_report, 0, 'a report that counts for the period');

  f = fixture();
  f.db.exec(`INSERT INTO portfolio_updates (uid, project_id, author_user_id, period, title, status) VALUES ('u-p-draft', ${P}, ${FOUNDER}, '2026-Q3', 'Draft', 'draft')`);
  assert.equal((await runPortfolioAttentionCheck(f.env, TODAY)).missed_report, 2, 'a draft is not a report');

  // The holder's own duty gives 60 days (due 29 Nov); the seat member holds no duty and takes the default.
  f = fixture();
  f.db.exec(`INSERT INTO reporting_duties (closing_id, closing_line_id, closing_line_uid, project_id, holder_user_id, kind, cadence, due_days,
                                           source_document, source_clause, source_kind, starts_on)
             VALUES (1, 1, 'cl-1', ${P}, ${HOLDER}, 'quarterly_kpi', 'quarterly', 60, 'SPA', '7.1', 'closing_template', '2026-01-01')`);
  await runPortfolioAttentionCheck(f.env, TODAY);
  assert.deepEqual(f.inbox().map((x) => x.user_id), [SEAT]);

  // A fund the holder runs as GP of record, at the institutional tier, with its own 90-day term.
  f = fixture();
  f.db.exec(`UPDATE vc_funds SET gp_user_id = ${HOLDER} WHERE id = ${FUND};
             UPDATE users SET investor_tier = 'institutional', investor_subscription_status = 'active' WHERE id = ${HOLDER};
             INSERT INTO portfolio_reporting_rule_sets (fund_id, rules_json, due_days, effective_month, effective_quarter)
             VALUES (${FUND}, '[]', 90, '2026-01', '2026-Q1')`);
  await runPortfolioAttentionCheck(f.env, TODAY);
  assert.deepEqual(f.inbox().map((x) => x.user_id), [SEAT]);
  // Below the institutional tier the fund is not theirs to run, so the default applies, as kpi-compliance reads it.
  f.db.exec(`UPDATE users SET investor_tier = 'free' WHERE id = ${HOLDER}`);
  await runPortfolioAttentionCheck(f.env, TODAY);
  assert.deepEqual(f.inbox().map((x) => x.user_id), [SEAT, HOLDER]);

  f = fixture();
  f.db.exec(`DELETE FROM portfolio_positions WHERE project_id = ${P}`);
  assert.equal((await runPortfolioAttentionCheck(f.env, TODAY)).missed_report, 0, 'no position, no reporting obligation');
});

test('a runway under six months in the newest update the holder may read notifies them once, with the figure, the period and the date', async () => {
  const f = fixture();
  sharedUpdate(f.db, 10, 'u-runway', { runway_months: 4 }, '2026-10-05 09:00:00');
  const r = await runPortfolioAttentionCheck(f.env, TODAY);
  assert.equal(r.short_runway, 1);
  const rows = f.inbox().filter((x) => JSON.parse(x.payload).reason === 'short_runway');
  // The seat member is not a recipient of this update, so it is not theirs to be told about.
  assert.deepEqual(rows.map((x) => x.user_id), [HOLDER]);
  assert.equal(rows[0].title, 'Acme Robotics needs attention');
  assert.equal(rows[0].body, 'Runway of 4 months in the founder update for 2026-Q4, submitted 2026-10-05: under six months. Source: Founder updates.');
  assert.equal(rows[0].link, '/portfolio/companies/proj-p-uid');
  assert.deepEqual(JSON.parse(rows[0].payload), {
    project_uid: 'proj-p-uid', reason: 'short_runway', checked_on: '2026-11-27', update_uid: 'u-runway', runway_months: 4,
    period: '2026-Q4', submitted_at: '2026-10-05',
  });
  // An update shared with every investor reaches the seat member too; the older key `runway` is read as the Overview reads it.
  const g = fixture();
  g.db.exec(`INSERT INTO portfolio_updates (id, uid, project_id, author_user_id, period, title, kpis_json, status, submitted_at, audience_json)
             VALUES (10, 'u-all', ${P}, ${FOUNDER}, '2026-Q4', 'Update', '{"runway":"1"}', 'submitted', '2026-10-05 09:00:00', '{"investors":true}')`);
  await runPortfolioAttentionCheck(g.env, TODAY);
  assert.deepEqual(g.inbox().filter((x) => JSON.parse(x.payload).reason === 'short_runway').map((x) => [x.user_id, x.body]), [
    [HOLDER, 'Runway of 1 month in the founder update for 2026-Q4, submitted 2026-10-05: under six months. Source: Founder updates.'],
    [SEAT, 'Runway of 1 month in the founder update for 2026-Q4, submitted 2026-10-05: under six months. Source: Founder updates.'],
  ]);
});

test('the runway read uses the updates route\'s own investor grant, word for word', () => {
  const src = readFileSync(new URL('../src/services/portfolioAttentionCheck.ts', import.meta.url), 'utf8');
  assert.ok(src.includes(`AND ${INVESTOR_GRANT})\n      WHERE rn = 1`), 'the grant is the last condition of the runway read');
});

test('no runway notice: six months or more, no runway figure in the newest update, a draft, or an update not shared with the holder', async () => {
  const cases: Array<[string, (db: DatabaseSync) => void]> = [
    ['six months is not under six', (db) => sharedUpdate(db, 10, 'u-6', { runway_months: 6 }, '2026-10-05 09:00:00')],
    ['the newest update says nothing of runway, so an older figure is not read', (db) => {
      sharedUpdate(db, 10, 'u-old', { runway_months: 3 }, '2026-09-05 09:00:00');
      sharedUpdate(db, 11, 'u-new', { mrr: 1000 }, '2026-10-05 09:00:00');
    }],
    ['a figure that is not a number', (db) => sharedUpdate(db, 10, 'u-blank', { runway_months: '' }, '2026-10-05 09:00:00')],
    ['a draft', (db) => sharedUpdate(db, 10, 'u-draft', { runway_months: 2 }, '2026-10-05 09:00:00', '2026-Q4', 'draft')],
    ['not shared with the holder', (db) => db.exec(`INSERT INTO portfolio_updates (uid, project_id, author_user_id, period, title, kpis_json, status, submitted_at)
      VALUES ('u-private', ${P}, ${FOUNDER}, '2026-Q4', 'Private', '{"runway_months":2}', 'submitted', '2026-10-05 09:00:00')`)],
  ];
  for (const [name, seed] of cases) {
    const f = fixture();
    seed(f.db);
    assert.equal((await runPortfolioAttentionCheck(f.env, TODAY)).short_runway, 0, name);
  }
});

test('once per evidence: a second run the same day, or a later day, raises nothing; a new period or a new short update raises again', async () => {
  const f = fixture();
  sharedUpdate(f.db, 10, 'u-runway', { runway_months: 4 }, '2026-10-05 09:00:00');
  await runPortfolioAttentionCheck(f.env, TODAY);
  // Holder by holder: each holder's missed report, then their runway.
  assert.deepEqual(reasons(f.inbox()), [`${HOLDER}:missed_report`, `${HOLDER}:short_runway`, `${SEAT}:missed_report`]);
  const again = await runPortfolioAttentionCheck(f.env, TODAY);
  assert.deepEqual([again.missed_report, again.short_runway], [0, 0]);
  const tomorrow = await runPortfolioAttentionCheck(f.env, at('2026-11-28'));
  assert.deepEqual([tomorrow.missed_report, tomorrow.short_runway], [0, 0]);
  assert.equal(f.inbox().length, 3);
  assert.deepEqual(f.ledger().map((x) => [x.reason, x.evidence_key, x.checked_on]), [
    ['missed_report', '2026-Q3', '2026-11-27'], ['short_runway', 'u-runway', '2026-11-27'], ['missed_report', '2026-Q3', '2026-11-27'],
  ]);
  // A newer update, still short, is new evidence.
  sharedUpdate(f.db, 11, 'u-runway-2', { runway_months: 3 }, '2026-11-28 09:00:00');
  assert.equal((await runPortfolioAttentionCheck(f.env, at('2026-11-29'))).short_runway, 1);
  // Q4 unreported past its due day (30 Jan) is a new missed report: for P's holder and seat again, and for Q's holder.
  f.db.exec(`DELETE FROM portfolio_updates WHERE uid IN ('u-runway', 'u-runway-2')`);
  assert.equal((await runPortfolioAttentionCheck(f.env, at('2027-02-01'))).missed_report, 3);
  assert.deepEqual(f.inbox().slice(-3).map((x) => [x.user_id, x.body]), [
    [HOLDER, 'Report for 2026-Q4 overdue by 2 days: due 2027-01-30, last reported 2026-07-10. Source: Reporting.'],
    [SEAT, 'Report for 2026-Q4 overdue by 2 days: due 2027-01-30, last reported 2026-07-10. Source: Reporting.'],
    [OTHER_CO, 'Report for 2026-Q4 overdue by 2 days: due 2027-01-30, last reported 2026-09-02. Source: Reporting.'],
  ]);
});

test('a holder who turned the type off gets no inbox row, and the evidence is spent all the same', async () => {
  const f = fixture();
  f.db.prepare(`UPDATE users SET notification_prefs = ? WHERE id = ?`).run(JSON.stringify({ [ATTENTION_TYPE]: { in_app: false, inapp: false, email: false } }), HOLDER);
  assert.equal((await runPortfolioAttentionCheck(f.env, TODAY)).missed_report, 2);
  assert.deepEqual(f.inbox().map((x) => x.user_id), [SEAT]);
  assert.equal(f.ledger().length, 2);
});

test('an unreadable source raises nothing from it, is named, and leaves the readable source working', async () => {
  // Founder updates unreadable: no report can be measured, no runway can be read; nothing is raised, both are named.
  let f = fixture();
  sharedUpdate(f.db, 10, 'u-runway', { runway_months: 4 }, '2026-10-05 09:00:00');
  f.db.exec('DROP TABLE portfolio_updates');
  let r = await runPortfolioAttentionCheck(f.env, TODAY);
  assert.deepEqual([r.missed_report, r.short_runway], [0, 0]);
  assert.deepEqual(r.unreadable, [
    { source: 'reports' }, { source: 'founder_updates', user_id: HOLDER }, { source: 'founder_updates', user_id: SEAT },
    { source: 'founder_updates', user_id: OTHER_CO },
  ]);
  assert.equal(f.inbox().length, 0);
  assert.equal(f.ledger().length, 0);

  // The reporting duties unreadable: no due day is claimed, so no report is called missed; the runway is still read.
  f = fixture();
  sharedUpdate(f.db, 10, 'u-runway', { runway_months: 4 }, '2026-10-05 09:00:00');
  f.db.exec(`INSERT INTO portfolio_updates (uid, project_id, author_user_id, period, title, status, submitted_at)
             VALUES ('u-old-q2', ${P}, ${FOUNDER}, '2026-Q2', 'Q2 again', 'submitted', '2026-07-11 09:00:00')`);
  f.db.exec('DELETE FROM portfolio_updates WHERE uid = \'u-runway\'');
  sharedUpdate(f.db, 12, 'u-runway-q2', { runway_months: 4 }, '2026-07-12 09:00:00', '2026-Q2');
  f.db.exec('DROP TABLE reporting_duties');
  r = await runPortfolioAttentionCheck(f.env, TODAY);
  assert.deepEqual([r.missed_report, r.short_runway], [0, 1]);
  assert.deepEqual(r.unreadable, [{ source: 'report_terms', user_id: HOLDER }, { source: 'report_terms', user_id: SEAT }]);
  assert.deepEqual(reasons(f.inbox()), [`${HOLDER}:short_runway`]);

  // The holders unreadable: the run throws, and the cron fails the task.
  f = fixture();
  f.db.exec('DROP TABLE commitments');
  await assert.rejects(runPortfolioAttentionCheck(f.env, TODAY));
  assert.equal(f.inbox().length, 0);
});

test('the cron runs the check daily at 05:45 UTC, and a run with an unreadable source fails the task', () => {
  const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const start = src.indexOf('if (now.getUTCHours() === 5 && now.getUTCMinutes() === 45) {');
  assert.ok(start > src.indexOf('async scheduled('), 'inside scheduled()');
  const block = src.slice(start, src.indexOf("taskFailed('portfolio attention check', e", start));
  assert.match(block, /await import\('\.\/services\/portfolioAttentionCheck'\)/);
  assert.match(block, /runPortfolioAttentionCheck\(env, now\.getTime\(\)\)/);
  assert.match(block, /if \(r\.unreadable\.length\) taskFailed\('portfolio attention check', 'portfolio_attention_unreadable'\);/);
});

test('migration: one row per company, holder, reason and evidence; only the two reasons', () => {
  const f = fixture();
  const sql = (f.db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'portfolio_attention_checks'`).get() as any).sql;
  assert.match(sql, /UNIQUE \(project_id, user_id, reason, evidence_key\)/);
  const add = (reason: string, key: string) => f.db.exec(`INSERT INTO portfolio_attention_checks (project_id, user_id, reason, evidence_key, checked_on) VALUES (1, 10, '${reason}', '${key}', '2026-11-27')`);
  add('missed_report', '2026-Q3');
  add('short_runway', '2026-Q3');
  assert.throws(() => add('missed_report', '2026-Q3'), /UNIQUE/);
  assert.throws(() => add('health', 'x'), /CHECK/);
});
