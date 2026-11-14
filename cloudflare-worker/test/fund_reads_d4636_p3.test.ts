/**
 * D4636 part 3 (#4636) — the owner's answers of 2026-11-13 on D4636-p2 §3:
 *   1. a partner's portfolio health and coverage reads narrow to the ventures
 *      where they hold an accepted seat (the update reads' partner rule);
 *   2. a fund's GP of record reads the positions attributed to the funds they
 *      run in `/api/positions*`, through the fund operating gate's scope;
 *   3. a holder's positions stay company-scoped.
 *
 * Real schema (`loadSchema`), real routes, synthetic fixtures only:
 *   ADMIN     platform admin
 *   GP        investor, institutional, GP of record of fund 10
 *   GP2       investor, institutional, GP of record of fund 20
 *   HOLDER    investor with a confirmed commitment in venture 7
 *   STRANGER  investor, institutional, no fund and no holding
 *   SEATED    partner with an accepted seat on venture 7 (and an invited one on 8)
 *   PARTNER   partner with no seat
 *
 * Venture 7 has a round from each fund; venture 8 one from fund 20; venture 9
 * a firm-level round (no fund).
 *
 * Each assertion that guards a change in this part names the mutation that
 * was checked against it (`mutation:`); D4636-p3.md §4 records the results.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/fund_reads_d4636_p3.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import positions from '../src/routes/positions.ts';
import portfolio from '../src/routes/portfolio.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d4636-part3-0123456789';
const ADMIN = 1, GP = 2, GP2 = 3, HOLDER = 4, STRANGER = 5, SEATED = 6, PARTNER = 7;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const u = db.prepare(`INSERT INTO users (id, role, founder_id, name, email, is_active, investor_tier, investor_subscription_status)
    VALUES (?, ?, NULL, ?, ?, 1, ?, 'active')`);
  u.run(ADMIN, 'admin', 'Ada', 'ada@axal.example', 'free');
  u.run(GP, 'investor', 'Gus', 'gus@fund.example', 'institutional');
  u.run(GP2, 'investor', 'Gil', 'gil@fund.example', 'institutional');
  u.run(HOLDER, 'investor', 'Hal', 'hal@angel.example', 'professional');
  u.run(STRANGER, 'investor', 'Sam', 'sam@else.example', 'institutional');
  u.run(SEATED, 'partner', 'Pia', 'pia@partner.example', 'free');
  u.run(PARTNER, 'partner', 'Pat', 'pat@partner.example', 'free');
  db.exec(`
    INSERT INTO projects (id, uid, name, founder_id) VALUES (7, 'p7', 'Venture Seven', 70), (8, 'p8', 'Venture Eight', 80), (9, 'p9', 'Venture Nine', 90);
    INSERT INTO vc_funds (id, name, gp_user_id) VALUES (10, 'Fund Ten', ${GP}), (20, 'Fund Twenty', ${GP2});
    INSERT INTO deals (id, project_id) VALUES (70, 7), (80, 8);
    INSERT INTO investor_dealroom_members (investor_user_id, deal_id) VALUES (${HOLDER}, 70);
    INSERT INTO commitments (id, deal_id, investor_user_id, amount, status) VALUES (1, 70, ${HOLDER}, 1000, 'confirmed');
    INSERT INTO portfolio_positions (uid, fund_id, project_id, round_name, invested_amount, ownership_pct, position_date, created_by, closing_line_uid) VALUES
      ('pos7a', 10, 7, 'Seed', 500, 5, '2026-01-10', ${ADMIN}, 'line-7a'),
      ('pos7b', 20, 7, 'Series A', 2000, 9, '2026-05-01', ${ADMIN}, 'line-7b'),
      ('pos8', 20, 8, 'Seed', 800, 8, '2026-02-10', ${ADMIN}, NULL),
      ('pos9', NULL, 9, 'Seed', 300, 3, '2026-03-10', ${ADMIN}, NULL);
    INSERT INTO portfolio_marks (uid, fund_id, project_id, as_of_date, fmv, basis) VALUES
      ('m7firm', NULL, 7, '2026-03-31', 700, 'gp_estimate'),
      ('m7f10', 10, 7, '2026-06-30', 900, 'round_price'),
      ('m7f20', 20, 7, '2026-09-30', 5000, 'round_price'),
      ('m8', 20, 8, '2026-06-30', 400, 'gp_estimate'),
      ('m9', NULL, 9, '2026-06-30', 350, 'gp_estimate');
    INSERT INTO portfolio_distributions (uid, fund_id, project_id, distribution_date, amount, kind) VALUES
      ('d7f10', 10, 7, '2026-07-01', 100, 'secondary'),
      ('d7f20', 20, 7, '2026-07-01', 999, 'secondary');
    INSERT INTO portfolio_health_snapshots (uid, project_id, snapshot_date, score, badge) VALUES
      ('h7', 7, '2026-11-01', 70, 'green'), ('h8', 8, '2026-11-01', 30, 'red'), ('h9', 9, '2026-11-01', 50, 'yellow');
    INSERT INTO project_members (project_id, user_id, role, status) VALUES
      (7, ${SEATED}, 'advisor', 'accepted'), (8, ${SEATED}, 'advisor', 'invited');
  `);
  return db;
}

const app = new Hono<any>();
app.route('/api/positions', positions);
app.route('/api/portfolio', portfolio);

async function call(db: DatabaseSync, userId: number, path: string) {
  const role = (db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any)?.role ?? 'founder';
  const token = await new SignJWT({ user_id: userId, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  let res: Response;
  try {
    res = await app.fetch(new Request(`http://t/api${path}`, { headers: { Authorization: `Bearer ${token}` } }),
      { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  } catch (e) {
    if (e instanceof Response) res = e; else throw e;
  }
  const text = await res.text();
  let body: any = null; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

const pids = (items: any[]) => items.map((x) => Number(x.project_id)).sort();
const uids = (items: any[]) => items.map((x) => x.uid).sort();

// ── 1. Partner reads narrow to their seats ──────────────────────────────────

test('portfolio health: a partner reads the ventures where they hold an accepted seat; a partner without one reads none; an admin reads all', async () => {
  const db = fixture();
  db.exec(`INSERT INTO portfolio_health_snapshots (uid, project_id, snapshot_date, score, badge) VALUES
    ('h-old-red', 8, '2026-07-01', 30, 'red'), ('h-watch', 8, '2026-08-01', 50, 'yellow'),
    ('h-first-red', 8, '2026-09-01', 30, 'red'), ('h-next-red', 8, '2026-10-01', 30, 'red')`);
  const admin = await call(db, ADMIN, '/portfolio/health');
  assert.deepEqual(pids(admin.body.items), [7, 8, 9]);
  const statusChange = (projectId: number) => {
    const item = admin.body.items.find((row: { project_id: number }) => row.project_id === projectId);
    return [item.previous_status, item.status_changed_at];
  };
  assert.deepEqual(statusChange(8), ['yellow', '2026-09-01']);
  assert.deepEqual(statusChange(7), [null, null]);

  // mutation: a partner returning null (every venture) again fails this and the next three.
  const seated = await call(db, SEATED, '/portfolio/health');
  assert.equal(seated.status, 200);
  assert.deepEqual(pids(seated.body.items), [7], 'the accepted seat, not the invited one');
  assert.equal(seated.body.population.projects_visible, 1);

  const none = await call(db, PARTNER, '/portfolio/health');
  assert.equal(none.status, 200, 'an empty portfolio, not a refusal');
  assert.deepEqual(none.body.items, []);

  assert.equal((await call(db, SEATED, '/portfolio/health/p7')).status, 200);
  assert.equal((await call(db, SEATED, '/portfolio/health/p8')).status, 403);
  assert.equal((await call(db, PARTNER, '/portfolio/health/p7')).status, 403);
  assert.equal((await call(db, ADMIN, '/portfolio/health/p9')).status, 200);
});

test('portfolio health: a seat that is no longer accepted applies to the next read', async () => {
  const db = fixture();
  assert.deepEqual(pids((await call(db, SEATED, '/portfolio/health')).body.items), [7]);
  db.exec(`UPDATE project_members SET status = 'removed' WHERE project_id = 7 AND user_id = ${SEATED}`);
  // mutation: a seat scope that ignores `status` keeps venture 7 (and adds 8) here.
  assert.deepEqual((await call(db, SEATED, '/portfolio/health')).body.items, []);
  assert.equal((await call(db, SEATED, '/portfolio/health/p7')).status, 403);
});

test('portfolio coverage: a partner reads the seated ventures only; without a seat, none; an admin reads all', async () => {
  const db = fixture();
  const admin = await call(db, ADMIN, '/portfolio/coverage');
  assert.equal(admin.status, 200);
  assert.deepEqual(uids(admin.body.companies), ['p7', 'p8', 'p9']);

  // mutation: dropping the seat filter on coverage lists all three to both partners.
  const seated = await call(db, SEATED, '/portfolio/coverage');
  assert.equal(seated.status, 200);
  assert.deepEqual(uids(seated.body.companies), ['p7']);
  assert.equal(seated.body.company_count, 1);

  const none = await call(db, PARTNER, '/portfolio/coverage');
  assert.equal(none.status, 200);
  assert.deepEqual(none.body.companies, []);
  assert.equal(none.body.company_count, 0);
});

// ── 2. A GP of record reads their fund's positions ──────────────────────────

test('positions list: the GP of record reads the rounds of the funds they run, a holder their company, an admin every position', async () => {
  const db = fixture();
  const admin = await call(db, ADMIN, '/positions');
  assert.deepEqual(pids(admin.body.items), [7, 8, 9]);
  assert.equal(admin.body.fund_scope, null);

  // mutation: positions without the GP arm (D1057's held scope only) list nothing to GP.
  const gp = await call(db, GP, '/positions');
  assert.equal(gp.status, 200);
  assert.deepEqual(pids(gp.body.items), [7]);
  const seven = gp.body.items[0];
  // mutation: a company-wide GP arm (every round of a company the fund is in) answers 2500 and 'Series A'.
  assert.equal(seven.total_invested, 500, 'fund 10\'s round only');
  assert.equal(seven.rounds, 1);
  assert.equal(seven.latest_round, 'Seed');
  // mutation: the firm-scope mark for a company read as GP carries fund 20's 5000.
  assert.equal(seven.fmv, 900, 'carried at fund 10\'s own mark');
  assert.equal(seven.mark_fund_id, 10);
  assert.deepEqual(gp.body.fund_scope.fund_ids, [10]);
  assert.equal(gp.body.fund_scope.rule, 'gp_of_record');

  const gp2 = await call(db, GP2, '/positions');
  assert.deepEqual(pids(gp2.body.items), [7, 8]);
  assert.equal(gp2.body.items.find((x: any) => x.project_id === 7).total_invested, 2000);

  // A firm-level round (no fund) is no GP's.
  assert.deepEqual((await call(db, STRANGER, '/positions')).body.items, []);
});

test('positions marks, analytics and KPI compliance: the GP arm reads its funds\' records and the firm-level marks', async () => {
  const db = fixture();
  // mutation: the marks predicate without the fund clause for GP-only companies lists m7f20 to GP.
  const marks = await call(db, GP, '/positions/marks');
  assert.equal(marks.status, 200);
  assert.deepEqual(uids(marks.body.items), ['m7f10', 'm7firm']);
  assert.deepEqual(uids((await call(db, GP2, '/positions/marks')).body.items), ['m7f20', 'm7firm', 'm8']);

  // mutation: analytics without the GP arm answers position_count 0; with company-wide rows, paid_in 2500.
  const analytics = await call(db, GP, '/positions/analytics');
  assert.equal(analytics.status, 200);
  assert.equal(analytics.body.position_count, 1);
  assert.equal(analytics.body.paid_in, 500);
  // mutation: distributions read without the fund clause count fund 20's 999.
  assert.equal(analytics.body.distributed, 100);
  assert.equal(analytics.body.nav, 900);

  // mutation: KPI compliance without the GP arm lists no company to GP.
  const kpi = await call(db, GP, '/positions/kpi-compliance?as_of=2026-11-12');
  assert.equal(kpi.status, 200);
  assert.deepEqual(pids(kpi.body.companies), [7]);

  assert.deepEqual((await call(db, STRANGER, '/positions/marks')).body.items, []);
  assert.deepEqual((await call(db, STRANGER, '/positions/kpi-compliance?as_of=2026-11-12')).body.companies, []);
  assert.equal((await call(db, STRANGER, '/positions/analytics')).body.position_count, 0);
});

test('position detail: the GP of record reads their funds\' rounds of a company in the investor projection; another fund\'s company is refused', async () => {
  const db = fixture();
  // mutation: the detail gate without the GP arm answers 403 here.
  const gp = await call(db, GP, '/positions/p7');
  assert.equal(gp.status, 200);
  // mutation: detail rounds without the fund clause list pos7b too.
  assert.deepEqual(uids(gp.body.rounds), ['pos7a']);
  const round = gp.body.rounds[0];
  assert.equal('created_by' in round, false, 'the investor projection');
  assert.equal('closing_line_uid' in round, false);
  assert.equal('id' in round, false);
  // mutation: detail marks/distributions without the fund clause list fund 20's records.
  assert.deepEqual(uids(gp.body.marks), ['m7f10', 'm7firm']);
  assert.deepEqual(uids(gp.body.distributions), ['d7f10']);
  assert.equal(gp.body.rollup.invested, 500);

  assert.equal((await call(db, GP, '/positions/p8')).status, 403, 'a company only another fund holds');
  assert.equal((await call(db, GP, '/positions/p9')).status, 403, 'a firm-level round');
  assert.equal((await call(db, STRANGER, '/positions/p7')).status, 403);
  assert.deepEqual(uids((await call(db, GP2, '/positions/p7')).body.rounds), ['pos7b']);
});

test('positions: a GP whose tier lapsed, or who is no longer GP of record, loses the arm on the next read', async () => {
  const db = fixture();
  assert.equal((await call(db, GP, '/positions/p7')).status, 200);

  // mutation: a GP arm on the bare gp_user_id (no tier check) keeps these.
  db.prepare("UPDATE users SET investor_tier = 'free' WHERE id = ?").run(GP);
  assert.deepEqual((await call(db, GP, '/positions')).body.items, []);
  assert.deepEqual((await call(db, GP, '/positions/marks')).body.items, []);
  assert.equal((await call(db, GP, '/positions/analytics')).body.position_count, 0);
  assert.deepEqual((await call(db, GP, '/positions/kpi-compliance?as_of=2026-11-12')).body.companies, []);
  assert.equal((await call(db, GP, '/positions/p7')).status, 403);

  db.prepare("UPDATE users SET investor_tier = 'institutional' WHERE id = ?").run(GP);
  assert.equal((await call(db, GP, '/positions/p7')).status, 200);
  // mutation: a GP scope cached past the request keeps GP reading fund 10.
  db.prepare('UPDATE vc_funds SET gp_user_id = ? WHERE id = 10').run(STRANGER);
  assert.deepEqual((await call(db, GP, '/positions')).body.items, []);
  assert.equal((await call(db, GP, '/positions/p7')).status, 403);
  assert.deepEqual(pids((await call(db, STRANGER, '/positions')).body.items), [7], 'the new GP of record reads it');
});

// ── 3. Holders unchanged ────────────────────────────────────────────────────

test('positions: a holder keeps every round of the company they hold, and a GP who also holds a company reads it as held', async () => {
  const db = fixture();
  const holder = await call(db, HOLDER, '/positions');
  assert.deepEqual(pids(holder.body.items), [7]);
  assert.equal(holder.body.items[0].total_invested, 2500, 'company-scoped: both funds\' rounds');
  assert.equal(holder.body.scope.rule, 'confirmed_commitment');
  assert.equal(holder.body.fund_scope, null);
  const detail = await call(db, HOLDER, '/positions/p7');
  assert.deepEqual(uids(detail.body.rounds), ['pos7a', 'pos7b']);
  assert.deepEqual(uids(detail.body.marks), ['m7f10', 'm7f20', 'm7firm']);
  assert.deepEqual(uids(detail.body.distributions), ['d7f10', 'd7f20']);
  assert.deepEqual(uids((await call(db, HOLDER, '/positions/marks')).body.items), ['m7f10', 'm7f20', 'm7firm']);
  assert.equal((await call(db, HOLDER, '/positions/p8')).status, 403);

  // GP holds venture 7 through a confirmed commitment of their own as well.
  db.exec(`INSERT INTO investor_dealroom_members (investor_user_id, deal_id) VALUES (${GP}, 70);
           INSERT INTO commitments (id, deal_id, investor_user_id, amount, status) VALUES (2, 70, ${GP}, 50, 'confirmed');`);
  // mutation: applying the fund clause to a held company lists only pos7a here.
  assert.deepEqual(uids((await call(db, GP, '/positions/p7')).body.rounds), ['pos7a', 'pos7b']);
  assert.equal((await call(db, GP, '/positions')).body.items[0].total_invested, 2500);
});
