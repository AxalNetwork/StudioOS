/**
 * D6227 (#6227) — `GET /api/positions/:projectUid/activity`: one company's
 * joined activity, newest first, paged, scoped as `GET /api/positions/:uid`,
 * with a failed source reported as failed (#5847).
 *
 * Real schema (`loadSchema`), real routers, synthetic fixtures only:
 *   ADMIN     platform admin
 *   HOLDER    investor holding venture 7 (confirmed commitment)
 *   OTHER     a second investor holding venture 7
 *   STRANGER  investor holding nothing
 *
 * Each assertion that guards this change names the mutation checked against
 * it (`mutation:`); D6227.md records the results.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/position_activity_d6227.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import positions from '../src/routes/positions.ts';
import activity, { mount, decodeCursor, encodeCursor } from '../src/routes/position_activity.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d6227-activity-0123456789';
const ADMIN = 1, HOLDER = 2, OTHER = 3, STRANGER = 4;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const u = db.prepare(`INSERT INTO users (id, role, founder_id, name, email, is_active, investor_tier, investor_subscription_status)
    VALUES (?, ?, NULL, ?, ?, 1, ?, 'active')`);
  u.run(ADMIN, 'admin', 'Ada', 'ada@axal.example', 'free');
  u.run(HOLDER, 'investor', 'Hal', 'hal@angel.example', 'professional');
  u.run(OTHER, 'investor', 'Olga Otherinvestor', 'olga@angel.example', 'professional');
  u.run(STRANGER, 'investor', 'Sam', 'sam@else.example', 'professional');
  db.exec(`
    INSERT INTO projects (id, uid, name, founder_id) VALUES (7, 'p7', 'Venture Seven', 70), (8, 'p8', 'Venture Eight', 80);
    INSERT INTO deals (id, project_id) VALUES (70, 7);
    INSERT INTO investor_dealroom_members (investor_user_id, deal_id) VALUES (${HOLDER}, 70), (${OTHER}, 70);
    INSERT INTO commitments (id, deal_id, investor_user_id, amount, status) VALUES (1, 70, ${HOLDER}, 1000, 'confirmed'), (2, 70, ${OTHER}, 1000, 'confirmed');
    INSERT INTO portfolio_positions (uid, fund_id, project_id, round_name, invested_amount, ownership_pct, position_date, created_by) VALUES
      ('pos7a', NULL, 7, 'Seed', 500, 5, '2026-01-10', ${ADMIN}),
      ('pos7b', NULL, 7, 'Series A', 2000, 9, '2026-05-01', ${ADMIN}),
      ('pos8', NULL, 8, 'Seed', 800, 8, '2026-02-10', ${ADMIN});
    INSERT INTO portfolio_marks (uid, fund_id, project_id, as_of_date, fmv, basis, event) VALUES
      ('m7a', NULL, 7, '2026-03-31', 700, 'gp_estimate', NULL),
      ('m7b', NULL, 7, '2026-06-30', 2900, 'round_price', 'Series A');
    INSERT INTO portfolio_distributions (uid, fund_id, project_id, distribution_date, amount, kind) VALUES
      ('d7', NULL, 7, '2026-07-01', 100, 'secondary');
    INSERT INTO reporting_duties (id, uid, closing_id, closing_line_id, closing_line_uid, project_id, holder_user_id, kind, cadence, due_days, source_document, source_clause, source_kind, starts_on) VALUES
      (1, 'duty-h', 1, 1, 'line-h', 7, ${HOLDER}, 'quarterly_kpi', 'quarterly', 45, 'IRA', '1.1', 'closing_template', '2026-01-01'),
      (2, 'duty-o', 1, 2, 'line-o', 7, ${OTHER}, 'quarterly_kpi', 'quarterly', 45, 'IRA', '1.1', 'closing_template', '2026-01-01');
    INSERT INTO reporting_periods (id, uid, duty_id, period_label, period_start, period_end, due_on, waived_at, waived_by) VALUES
      (11, 'per-h1', 1, '2026-Q1', '2026-01-01', '2026-03-31', '2026-05-15', NULL, NULL),
      (12, 'per-h2', 1, '2026-Q2', '2026-04-01', '2026-06-30', '2026-08-14', '2026-08-20 09:00:00', ${HOLDER}),
      (21, 'per-o1', 2, '2026-Q1', '2026-01-01', '2026-03-31', '2026-05-15', NULL, NULL);
    INSERT INTO reporting_events (project_id, duty_id, period_id, actor_user_id, event, ref, created_at) VALUES
      (7, 1, 11, ${HOLDER}, 'asked', 'chase:a', '2026-05-20 10:00:00'),
      (7, 1, 12, ${HOLDER}, 'waived', NULL, '2026-08-20 09:00:00'),
      (7, 2, 21, ${OTHER}, 'asked', 'chase:o', '2026-05-21 10:00:00'),
      (7, 2, 21, ${OTHER}, 'waived', NULL, '2026-05-22 10:00:00');
    INSERT INTO portfolio_updates (id, uid, project_id, author_user_id, period, title, kind, revision, sent_at) VALUES
      (101, 'rep1', 7, 70, '2026-Q1', 'Q1', 'report', 1, '2026-06-01T12:00:00.000Z'),
      (102, 'rep1b', 7, 70, '2026-Q1', 'Q1', 'report', 2, '2026-06-10T12:00:00.000Z'),
      (103, 'rep-o', 7, 70, '2026-Q3', 'Q3 to Olga', 'report', 1, '2026-10-01T12:00:00.000Z'),
      (104, 'draft', 7, 70, '2026-Q4', 'Draft', 'report', 1, NULL);
    INSERT INTO update_recipients (update_id, audience, user_id) VALUES
      (101, 'investor', ${HOLDER}), (101, 'investor', ${OTHER}), (102, 'investor', ${HOLDER}), (103, 'investor', ${OTHER});
    INSERT INTO portfolio_support_entries (id, uid, project_id, kind, state, promised_at, delivered_at, summary, recorded_by, created_at) VALUES
      (31, 'sup1', 7, 'intro', 'delivered', '2026-04-01', '2026-04-15', 'Intro to a bank', ${OTHER}, '2026-04-01 08:00:00');
    INSERT INTO portfolio_support_entry_events (uid, entry_id, revision, action, from_state, to_state, changed_json, actor_user_id, created_at) VALUES
      ('sev1', 31, 2, 'amended', NULL, NULL, '["hours","outcome"]', ${OTHER}, '2026-04-20 08:00:00');
  `);
  return db;
}

const app = new Hono<any>();
for (const m of [mount].flat()) app.route(m.path, m.router);
app.route('/api/positions', positions);

async function call(db: DatabaseSync, userId: number, path: string, env: Record<string, unknown> = {}) {
  const role = (db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any)?.role ?? 'founder';
  const token = await new SignJWT({ user_id: userId, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  let res: Response;
  try {
    res = await app.fetch(new Request(`http://t/api${path}`, { headers: { Authorization: `Bearer ${token}` } }),
      { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...env } as any);
  } catch (e) {
    if (e instanceof Response) res = e; else throw e;
  }
  const text = await res.text();
  let body: any = null; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

const ids = (b: any) => b.items.map((x: any) => x.id);

test('mount: at /api/positions, ahead of the positions router', () => {
  assert.equal(mount.path, '/api/positions');
  assert.equal(mount.router, activity);
  assert.deepEqual(mount.before, [positions]);
});

test('ordering: every source merged newest first, each row with kind, date, label, source and link', async () => {
  const db = fixture();
  const res = await call(db, HOLDER, '/positions/p7/activity');
  assert.equal(res.status, 200);
  // mutation: sorting oldest first, or dropping any one source's read, fails this.
  assert.deepEqual(ids(res.body), [
    'waived:2', 'distribution:d7', 'mark:m7b', 'report_corrected:rep1b', 'report_received:rep1', 'asked:1',
    'investment:pos7b', 'support_amended:sev1', 'support_delivered:sup1', 'support_promised:sup1', 'mark:m7a', 'investment:pos7a',
  ]);
  const mark = res.body.items.find((x: any) => x.id === 'mark:m7b');
  assert.deepEqual(mark, {
    id: 'mark:m7b', kind: 'mark', at: '2026-06-30', date: '2026-06-30', source: 'marks',
    label: 'Valuation mark · round price · Series A', amount: 2900, link: { tab: 'financials', href: '/portfolio/companies/p7/financials' },
  });
  assert.equal(res.body.items[0].label, 'You waived the 2026-Q2 Quarterly KPI report');
  assert.equal(res.body.items[0].link.href, '/portfolio/companies/p7/reports');
  assert.equal(res.body.items.find((x: any) => x.id === 'support_amended:sev1').label, 'Support amended: Intro to a bank (hours, outcome)');
  assert.deepEqual(res.body.sources.map((s: any) => [s.source, s.state]), [
    ['investments', 'ok'], ['marks', 'ok'], ['distributions', 'ok'], ['reports', 'ok'], ['requests', 'ok'], ['support', 'ok'],
  ]);
  assert.equal(res.body.partial, false);
  assert.equal(res.body.page.total, 12);
  assert.equal(res.body.page.next_cursor, null);
  assert.deepEqual(res.body.project, { uid: 'p7', name: 'Venture Seven' });
});

test('pagination: pages follow the cursor without a repeat or a gap, and a forged cursor is a 400', async () => {
  const db = fixture();
  const full = ids((await call(db, HOLDER, '/positions/p7/activity')).body);
  const seen: string[] = [];
  let before = '';
  for (let i = 0; i < 10; i += 1) {
    const page = await call(db, HOLDER, `/positions/p7/activity?limit=5${before ? `&before=${before}` : ''}`);
    assert.equal(page.status, 200);
    seen.push(...ids(page.body));
    if (!page.body.page.next_cursor) break;
    before = page.body.page.next_cursor;
  }
  // mutation: an inclusive cursor (`<=`) repeats a row here; dropping the id tie-break loses one.
  assert.deepEqual(seen, full);
  // Two rows on one instant are ordered by id, so a page boundary between them is stable.
  db.exec(`INSERT INTO portfolio_marks (uid, project_id, as_of_date, fmv, basis) VALUES ('m7tie', 7, '2026-06-30', 1, 'cost')`);
  const p1 = await call(db, HOLDER, '/positions/p7/activity?limit=3');
  const p2 = await call(db, HOLDER, `/positions/p7/activity?limit=3&before=${p1.body.page.next_cursor}`);
  assert.deepEqual([...ids(p1.body), ...ids(p2.body)], ['waived:2', 'distribution:d7', 'mark:m7tie', 'mark:m7b', 'report_corrected:rep1b', 'report_received:rep1']);
  assert.equal((await call(db, HOLDER, '/positions/p7/activity?before=not!a!cursor')).status, 400);
  assert.equal((await call(db, HOLDER, `/positions/p7/activity?before=${encodeCursor('2026', 'x')}`)).status, 400);
  assert.deepEqual(decodeCursor(encodeCursor('2026-06-30', 'mark:m7b')), { at: '2026-06-30', id: 'mark:m7b' });
});

test('scoping: another holder\'s ask, waiver and report are absent, and no name or user id is returned', async () => {
  const db = fixture();
  const res = await call(db, HOLDER, '/positions/p7/activity');
  const got = ids(res.body);
  // mutation: dropping `e.actor_user_id = ?` brings in asked:3 and waived:4.
  assert.ok(!got.includes('asked:3') && !got.includes('waived:4'), 'another holder\'s ask and waiver are not read');
  // mutation: dropping the update_recipients EXISTS brings in rep-o.
  assert.ok(!got.includes('report_received:rep-o'), 'a report sent only to another investor is not read');
  assert.ok(!got.some((x: string) => x.endsWith(':draft')), 'an unsent report is not activity');
  const text = JSON.stringify(res.body);
  assert.ok(!/Olga|Otherinvestor|actor|recorded_by|user_id/.test(text), 'no name, actor or user id');

  const other = await call(db, OTHER, '/positions/p7/activity');
  assert.ok(ids(other.body).includes('asked:3') && ids(other.body).includes('report_received:rep-o'));
  assert.ok(!ids(other.body).includes('asked:1') && !ids(other.body).includes('report_corrected:rep1b'));
});

test('admission: the same answers as GET /api/positions/:uid', async () => {
  const db = fixture();
  for (const [who, uid] of [[HOLDER, 'p7'], [HOLDER, 'p8'], [STRANGER, 'p7'], [ADMIN, 'p8'], [HOLDER, 'nope']] as const) {
    const detail = await call(db, who, `/positions/${uid}`);
    const feed = await call(db, who, `/positions/${uid}/activity`);
    // mutation: skipping the visibility check answers 200 for HOLDER on p8 and STRANGER on p7.
    assert.equal(feed.status, detail.status, `user ${who} on ${uid}`);
  }
  assert.equal((await call(db, HOLDER, '/positions/p8/activity')).status, 403);
  const admin = await call(db, ADMIN, '/positions/p8/activity');
  assert.deepEqual(ids(admin.body), ['investment:pos8']);
  assert.equal(admin.body.sources.find((s: any) => s.source === 'support').state, 'ok');
});

test('a failed source is reported as failed, never dropped and never an empty list', async () => {
  const db = fixture();
  db.exec('ALTER TABLE portfolio_marks RENAME TO portfolio_marks_gone');
  const res = await call(db, HOLDER, '/positions/p7/activity');
  assert.equal(res.status, 200, 'the other sources still answer');
  const marks = res.body.sources.find((s: any) => s.source === 'marks');
  // mutation: answering a failed query with `results: []` (the #5847 defect) reads 'ok' here.
  assert.equal(marks.state, 'failed');
  assert.match(marks.reason, /^Unreadable: valuation marks could not be read/);
  assert.ok(!/no such table|SQLITE/i.test(JSON.stringify(res.body)), 'the database error is not returned');
  assert.equal(res.body.partial, true);
  assert.ok(!ids(res.body).some((x: string) => x.startsWith('mark:')));
  assert.ok(ids(res.body).includes('distribution:d7') && ids(res.body).includes('investment:pos7a'));
  assert.equal(res.body.sources.filter((s: any) => s.state === 'failed').length, 1);
});
