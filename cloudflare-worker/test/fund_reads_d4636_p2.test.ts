/**
 * D4636 part 2 (#4636) — the other fund and portfolio reads, held to the
 * D4636 role table: `/api/positions*`, `/api/portfolio/*`, `/api/lp-reports`
 * and `/api/fund-reporting`. For each read handler, an allowed caller and a
 * refused one, and the projection where it differs by role.
 *
 * Real schema (`loadSchema`), real routes, synthetic fixtures only:
 *   ADMIN       platform admin
 *   GP          investor, institutional, GP of record of fund 10
 *   FORMER      investor, institutional, authored fund 10's draft, not its GP
 *   LOW_GP      investor, free tier, GP of record of fund 20
 *   LP          investor, limited partner of fund 10
 *   HOLDER      investor with a confirmed commitment in venture 7 (and a dealroom on it)
 *   STRANGER    investor with no relationship
 *   PARTNER     partner
 *   FOUNDER     founder of venture 7
 *   ADVISOR     advisor
 *
 * Each assertion that guards a change in this part names the mutation that
 * was checked against it (`mutation:`).
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/fund_reads_d4636_p2.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import positions from '../src/routes/positions.ts';
import portfolio from '../src/routes/portfolio.ts';
import lpReports from '../src/routes/lp_reports.ts';
import fundReporting from '../src/routes/fund_reporting.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d4636-part2-0123456789';
const ADMIN = 1, GP = 2, FORMER = 3, LOW_GP = 4, LP = 5, HOLDER = 6, STRANGER = 7, PARTNER = 8, FOUNDER = 9, ADVISOR = 10;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const u = db.prepare(`INSERT INTO users (id, role, founder_id, name, email, is_active, investor_tier, investor_subscription_status)
    VALUES (?, ?, ?, ?, ?, 1, ?, 'active')`);
  u.run(ADMIN, 'admin', null, 'Ada', 'ada@axal.example', 'free');
  u.run(GP, 'investor', null, 'Gus', 'gus@fund.example', 'institutional');
  u.run(FORMER, 'investor', null, 'Fern', 'fern@fund.example', 'institutional');
  u.run(LOW_GP, 'investor', null, 'Lou', 'lou@fund.example', 'free');
  u.run(LP, 'investor', null, 'Lia', 'lia@lp.example', 'free');
  u.run(HOLDER, 'investor', null, 'Hal', 'hal@angel.example', 'professional');
  u.run(STRANGER, 'investor', null, 'Sam', 'sam@else.example', 'institutional');
  u.run(PARTNER, 'partner', null, 'Pat', 'pat@partner.example', 'free');
  u.run(FOUNDER, 'founder', 70, 'Fay', 'fay@co.example', 'free');
  u.run(ADVISOR, 'advisor', null, 'Avi', 'avi@adv.example', 'free');
  db.exec(`
    INSERT INTO projects (id, uid, name, founder_id) VALUES (7, 'p7', 'Venture Seven', 70), (8, 'p8', 'Venture Eight', 80);
    INSERT INTO vc_funds (id, name, gp_user_id) VALUES (10, 'Fund Ten', ${GP}), (20, 'Fund Twenty', ${LOW_GP});
    INSERT INTO limited_partners (id, fund_id, user_id, name, email) VALUES (101, 10, ${LP}, 'Lia', 'lia@lp.example');
    INSERT INTO lp_reports (uid, fund_id, period, status, created_by) VALUES
      ('d10', 10, '2026-Q3', 'draft', ${FORMER}),
      ('p10', 10, '2026-Q2', 'published', ${GP}),
      ('d20', 20, '2026-Q3', 'draft', ${LOW_GP}),
      ('p20', 20, '2026-Q2', 'published', ${LOW_GP});
    INSERT INTO deals (id, project_id) VALUES (70, 7), (80, 8);
    INSERT INTO investor_dealroom_members (investor_user_id, deal_id) VALUES (${HOLDER}, 70);
    INSERT INTO commitments (id, deal_id, investor_user_id, amount, status) VALUES (1, 70, ${HOLDER}, 1000, 'confirmed');
    INSERT INTO portfolio_positions (uid, fund_id, project_id, round_name, invested_amount, ownership_pct, position_date, created_by, closing_line_uid)
      VALUES ('pos7', 10, 7, 'Seed', 500, 5, '2026-01-10', ${ADMIN}, 'line-7'), ('pos8', 10, 8, 'Seed', 800, 8, '2026-02-10', ${ADMIN}, NULL);
    INSERT INTO portfolio_marks (uid, project_id, as_of_date, fmv, basis) VALUES ('m7', 7, '2026-06-30', 900, 'round_price'), ('m8', 8, '2026-06-30', 400, 'gp_estimate');
    INSERT INTO portfolio_health_snapshots (uid, project_id, snapshot_date, score, badge) VALUES ('h7', 7, '2026-11-01', 70, 'green'), ('h8', 8, '2026-11-01', 30, 'red');
    INSERT INTO portfolio_update_chases (uid, project_id, chased_by) VALUES ('c7', 7, ${HOLDER}), ('c7b', 7, ${ADMIN}), ('c8', 8, ${ADMIN});
    INSERT INTO fund_reserve_allocations (uid, fund_id, project_id) VALUES ('ra7', 10, 7);
  `);
  return db;
}

const app = new Hono<any>();
app.route('/api/positions', positions);
app.route('/api/portfolio', portfolio);
app.route('/api/lp-reports', lpReports);
app.route('/api/fund-reporting', fundReporting);

async function call(db: DatabaseSync, userId: number, path: string) {
  const role = (db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any)?.role ?? 'founder';
  const token = await new SignJWT({ user_id: userId, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  let res: Response;
  try {
    res = await app.fetch(new Request(`http://t/api${path}`, { headers: { Authorization: `Bearer ${token}` } }),
      { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  } catch (e) {
    // index.ts answers a thrown Response with itself (util/thrownResponse.ts).
    if (e instanceof Response) res = e; else throw e;
  }
  const text = await res.text();
  let body: any = null; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

const uids = (items: any[]) => items.map((x) => x.uid).sort();
const pids = (items: any[]) => items.map((x) => Number(x.project_id)).sort();

// ── /api/positions ──────────────────────────────────────────────────────────

test('positions list, marks, analytics and KPI compliance: an admin reads the book, a holder their held company, others nothing or 403', async () => {
  const db = fixture();
  const admin = await call(db, ADMIN, '/positions');
  assert.equal(admin.status, 200);
  assert.deepEqual(pids(admin.body.items), [7, 8]);
  assert.equal(admin.body.scope.rule, 'all_positions');

  const holder = await call(db, HOLDER, '/positions');
  assert.equal(holder.status, 200);
  assert.deepEqual(pids(holder.body.items), [7]);
  assert.equal(holder.body.scope.rule, 'confirmed_commitment');
  assert.deepEqual(pids((await call(db, HOLDER, '/positions/marks')).body.items), [7]);
  assert.equal((await call(db, HOLDER, '/positions/analytics')).body.position_count, 1);
  assert.deepEqual(pids((await call(db, HOLDER, '/positions/kpi-compliance?as_of=2026-11-12')).body.companies), [7]);

  // An LP of the fund that recorded the positions holds no company by that alone (D1057's held scope).
  // The fund's GP of record reads them through the GP arm (D4636 part 3, fund_reads_d4636_p3).
  for (const who of [STRANGER, LP]) {
    assert.deepEqual((await call(db, who, '/positions')).body.items, [], `list ${who}`);
    assert.deepEqual((await call(db, who, '/positions/marks')).body.items, [], `marks ${who}`);
    assert.equal((await call(db, who, '/positions/analytics')).body.position_count, 0, `analytics ${who}`);
    assert.deepEqual((await call(db, who, '/positions/kpi-compliance?as_of=2026-11-12')).body.companies, [], `kpi ${who}`);
  }
  for (const who of [PARTNER, FOUNDER, ADVISOR]) {
    for (const p of ['/positions', '/positions/marks', '/positions/analytics', '/positions/kpi-compliance', '/positions/p7']) {
      assert.equal((await call(db, who, p)).status, 403, `${who} ${p}`);
    }
  }
});

test('position detail: a holder reads their company in the investor projection; an admin reads the whole row; anyone else is refused', async () => {
  const db = fixture();
  const holder = await call(db, HOLDER, '/positions/p7');
  assert.equal(holder.status, 200);
  assert.equal(holder.body.rounds.length, 1);
  const round = holder.body.rounds[0];
  assert.equal(round.uid, 'pos7');
  assert.equal(round.invested_amount, 500);
  assert.equal(round.ownership_pct, 5);
  // mutation: reading `SELECT *` for every caller again fails these three.
  assert.equal('created_by' in round, false, 'the recording account is not in the investor projection');
  assert.equal('closing_line_uid' in round, false, 'nor the closing line');
  assert.equal('id' in round, false, 'nor the internal row id');
  assert.equal(holder.body.rollup.invested, 500);

  const admin = await call(db, ADMIN, '/positions/p7');
  assert.equal(admin.status, 200);
  assert.equal(admin.body.rounds[0].created_by, ADMIN);
  assert.equal(admin.body.rounds[0].closing_line_uid, 'line-7');

  assert.equal((await call(db, HOLDER, '/positions/p8')).status, 403, 'a company the holder does not hold');
  assert.equal((await call(db, STRANGER, '/positions/p7')).status, 403);
  assert.equal((await call(db, LOW_GP, '/positions/p7')).status, 403);
});

test('positions: a withdrawn commitment applies to the next read', async () => {
  const db = fixture();
  assert.equal((await call(db, HOLDER, '/positions/p7')).status, 200);
  db.exec("UPDATE commitments SET status = 'withdrawn' WHERE id = 1");
  assert.equal((await call(db, HOLDER, '/positions/p7')).status, 403);
  assert.deepEqual((await call(db, HOLDER, '/positions')).body.items, []);
});

// ── /api/portfolio ──────────────────────────────────────────────────────────

test('portfolio health: an admin reads every venture, an investor the related ones, a founder their own; an advisor is refused', async () => {
  const db = fixture();
  const admin = await call(db, ADMIN, '/portfolio/health');
  assert.equal(admin.status, 200);
  assert.deepEqual(pids(admin.body.items), [7, 8]);
  // A partner reads the ventures where they hold an accepted seat (D4636 part 3, fund_reads_d4636_p3); PARTNER holds none.
  assert.deepEqual((await call(db, PARTNER, '/portfolio/health')).body.items, []);
  assert.deepEqual(pids((await call(db, HOLDER, '/portfolio/health')).body.items), [7]);
  assert.deepEqual(pids((await call(db, FOUNDER, '/portfolio/health')).body.items), [7]);
  assert.deepEqual((await call(db, STRANGER, '/portfolio/health')).body.items, []);
  assert.equal((await call(db, ADVISOR, '/portfolio/health')).status, 403);

  assert.equal((await call(db, HOLDER, '/portfolio/health/p7')).status, 200);
  assert.equal((await call(db, HOLDER, '/portfolio/health/p8')).status, 403);
  assert.equal((await call(db, FOUNDER, '/portfolio/health/p8')).status, 403);
  assert.equal((await call(db, PARTNER, '/portfolio/health/p8')).status, 403);
  assert.equal((await call(db, ADVISOR, '/portfolio/health/p7')).status, 403);
});

test('portfolio chases: an admin reads the log, an investor their own chases on companies they may see; others are refused', async () => {
  const db = fixture();
  assert.deepEqual(uids((await call(db, ADMIN, '/portfolio/chases')).body.items), ['c7', 'c7b', 'c8']);
  assert.deepEqual(uids((await call(db, HOLDER, '/portfolio/chases')).body.items), ['c7'], 'not another account\'s chase of the same company');
  assert.deepEqual((await call(db, STRANGER, '/portfolio/chases')).body.items, []);
  for (const who of [PARTNER, FOUNDER, ADVISOR]) assert.equal((await call(db, who, '/portfolio/chases')).status, 403, `chases ${who}`);
});

test('portfolio coverage: admin and partner read it; narrowing to one fund goes through the fund operating gate', async () => {
  const db = fixture();
  const admin = await call(db, ADMIN, '/portfolio/coverage?fund_id=10');
  assert.equal(admin.status, 200);
  assert.deepEqual(admin.body.fund, { id: 10, name: 'Fund Ten' });
  assert.deepEqual(admin.body.companies.map((x: any) => x.uid), ['p7']);
  assert.equal((await call(db, PARTNER, '/portfolio/coverage')).status, 200);

  // mutation: reading the fund row without `requireFundGp` answers 200 with the fund's name and allocations.
  const partner = await call(db, PARTNER, '/portfolio/coverage?fund_id=10');
  assert.equal(partner.status, 404, 'a fund the partner does not run reads as not found');
  assert.equal(JSON.stringify(partner.body).includes('Fund Ten'), false);
  assert.equal((await call(db, PARTNER, '/portfolio/coverage?fund_id=999')).status, 404, 'the same answer as a fund that does not exist');

  for (const who of [GP, HOLDER, FOUNDER, ADVISOR]) assert.equal((await call(db, who, '/portfolio/coverage')).status, 403, `coverage ${who}`);
});

// ── /api/lp-reports ─────────────────────────────────────────────────────────

test('lp reports list: an admin reads every report; the GP of record every report of their fund; an LP the published ones, in the LP projection', async () => {
  const db = fixture();
  const admin = await call(db, ADMIN, '/lp-reports');
  assert.equal(admin.status, 200);
  assert.deepEqual(uids(admin.body.items), ['d10', 'd20', 'p10', 'p20']);
  assert.ok(admin.body.items.every((x: any) => 'created_by' in x));

  // mutation: the old `created_by = ?` arm in place of the operating-gate arm hides d10 from the GP.
  const gp = await call(db, GP, '/lp-reports');
  assert.deepEqual(uids(gp.body.items), ['d10', 'p10'], 'every report of the fund they run, drafts included');
  assert.ok(gp.body.items.every((x: any) => 'created_by' in x), 'the whole row');

  const lp = await call(db, LP, '/lp-reports');
  assert.deepEqual(uids(lp.body.items), ['p10']);
  // mutation: returning the dto unprojected fails this.
  assert.equal('created_by' in lp.body.items[0], false, 'the LP projection');
  assert.equal(lp.body.items[0].fund.name, 'Fund Ten');

  // mutation: restoring the `created_by = ?` arm lists d10 to its author again.
  assert.deepEqual(uids((await call(db, FORMER, '/lp-reports')).body.items), [], 'authorship alone reads nothing');
  // mutation: an operating-gate arm without the tier (bare gp_user_id) lists d20 and p20 to LOW_GP.
  assert.deepEqual(uids((await call(db, LOW_GP, '/lp-reports')).body.items), [], 'a GP below the institutional tier does not read as manager');
  assert.deepEqual((await call(db, STRANGER, '/lp-reports')).body.items, []);
  for (const who of [PARTNER, FOUNDER, ADVISOR]) assert.equal((await call(db, who, '/lp-reports')).status, 403, `list ${who}`);
});

test('lp report detail follows the same rule as the list', async () => {
  const db = fixture();
  assert.equal((await call(db, ADMIN, '/lp-reports/d20')).status, 200);
  const gp = await call(db, GP, '/lp-reports/d10');
  assert.equal(gp.status, 200, 'the GP of record reads a draft of their fund that someone else wrote');
  assert.equal(gp.body.created_by, FORMER);

  const lp = await call(db, LP, '/lp-reports/p10');
  assert.equal(lp.status, 200);
  assert.equal('created_by' in lp.body, false, 'the LP projection'); // mutation: unprojected detail fails this.
  assert.equal((await call(db, LP, '/lp-reports/d10')).status, 404, 'an LP never reads a draft');

  // mutation: restoring the author arm answers 200 here.
  assert.equal((await call(db, FORMER, '/lp-reports/d10')).status, 404);
  assert.equal((await call(db, LOW_GP, '/lp-reports/d20')).status, 404);
  assert.equal((await call(db, STRANGER, '/lp-reports/p10')).status, 403);
  assert.equal((await call(db, PARTNER, '/lp-reports/p10')).status, 403);
});

test('lp reports: a changed GP of record applies to the next read', async () => {
  const db = fixture();
  db.prepare('UPDATE vc_funds SET gp_user_id = ? WHERE id = 10').run(FORMER);
  assert.deepEqual(uids((await call(db, FORMER, '/lp-reports')).body.items), ['d10', 'p10']);
  assert.equal((await call(db, FORMER, '/lp-reports/d10')).status, 200);
  assert.deepEqual(uids((await call(db, GP, '/lp-reports')).body.items), []);
  assert.equal((await call(db, GP, '/lp-reports/d10')).status, 404);
});

// ── /api/fund-reporting ─────────────────────────────────────────────────────

test('fund reporting queue: an admin reads it; a GP of record, an LP and everyone else are refused', async () => {
  const db = fixture();
  const admin = await call(db, ADMIN, '/fund-reporting/drafts');
  assert.equal(admin.status, 200);
  for (const who of [GP, LP, HOLDER, PARTNER, FOUNDER]) {
    for (const p of ['/fund-reporting/drafts', '/fund-reporting/drafts/none', '/fund-reporting/drafts/none/export']) {
      assert.equal((await call(db, who, p)).status, 403, `${who} ${p}`);
    }
  }
});
