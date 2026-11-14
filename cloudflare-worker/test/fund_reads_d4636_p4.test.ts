/**
 * D4636 part 4 (#4636) — the owner's decision of 2026-11-13: a fund's GP of
 * record passes the positions licence gate for their OWN funds' positions and
 * marks, without an investor licence. Part 3 added the GP arm behind
 * `canViewLpData`; this part admits a caller who fails that gate but runs at
 * least one fund (`managedFundIds`) to the five reads, scoped to their funds'
 * companies only, with no held rows. A caller with neither still gets 403.
 *
 * Real schema (`loadSchema`), real routes, synthetic fixtures only:
 *   ADMIN    platform admin
 *   NGP      partner (no investor licence), GP of record of fund 10; also has
 *            a dealroom seat and a confirmed commitment on venture 9, which
 *            only an investor licence would make a holding
 *   FGP      founder (no investor licence), GP of record of fund 30
 *   IGP      investor, institutional, GP of record of fund 20 (part 3's case)
 *   HOLDER   investor with a confirmed commitment in venture 8
 *   PARTNER  partner, no fund
 *   FOUNDER  founder, no fund
 *
 * Venture 6 has a round from fund 30; venture 7 one from fund 10 and one from
 * fund 20; venture 8 one from fund 20 (and is HOLDER's); venture 9 a
 * firm-level round.
 *
 * Each assertion that guards this part names the mutation checked against it
 * (`mutation:`); D4636-p4.md §3 records the results.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/fund_reads_d4636_p4.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import positions from '../src/routes/positions.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d4636-part4-0123456789';
const ADMIN = 1, NGP = 2, FGP = 3, IGP = 4, HOLDER = 5, PARTNER = 6, FOUNDER = 7;
const AS_OF = '2026-11-12';

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const u = db.prepare(`INSERT INTO users (id, role, founder_id, name, email, is_active, investor_tier, investor_subscription_status)
    VALUES (?, ?, NULL, ?, ?, 1, ?, 'active')`);
  u.run(ADMIN, 'admin', 'Ada', 'ada@axal.example', 'free');
  u.run(NGP, 'partner', 'Nia', 'nia@fund.example', 'free');
  u.run(FGP, 'founder', 'Fay', 'fay@fund.example', 'free');
  u.run(IGP, 'investor', 'Ivo', 'ivo@fund.example', 'institutional');
  u.run(HOLDER, 'investor', 'Hal', 'hal@angel.example', 'professional');
  u.run(PARTNER, 'partner', 'Pat', 'pat@partner.example', 'free');
  u.run(FOUNDER, 'founder', 'Fin', 'fin@startup.example', 'free');
  db.exec(`
    INSERT INTO projects (id, uid, name, founder_id) VALUES
      (6, 'p6', 'Venture Six', 60), (7, 'p7', 'Venture Seven', 70), (8, 'p8', 'Venture Eight', 80), (9, 'p9', 'Venture Nine', 90);
    INSERT INTO vc_funds (id, name, gp_user_id) VALUES (10, 'Fund Ten', ${NGP}), (20, 'Fund Twenty', ${IGP}), (30, 'Fund Thirty', ${FGP});
    INSERT INTO deals (id, project_id) VALUES (70, 7), (80, 8), (90, 9);
    INSERT INTO investor_dealroom_members (investor_user_id, deal_id) VALUES (${HOLDER}, 80), (${NGP}, 90);
    INSERT INTO commitments (id, deal_id, investor_user_id, amount, status) VALUES
      (1, 80, ${HOLDER}, 1000, 'confirmed'), (2, 90, ${NGP}, 50, 'confirmed');
    INSERT INTO portfolio_positions (uid, fund_id, project_id, round_name, invested_amount, ownership_pct, position_date, created_by, closing_line_uid) VALUES
      ('pos6', 30, 6, 'Pre-seed', 600, 6, '2026-02-01', ${ADMIN}, NULL),
      ('pos7a', 10, 7, 'Seed', 500, 5, '2026-01-10', ${ADMIN}, 'line-7a'),
      ('pos7b', 20, 7, 'Series A', 2000, 9, '2026-05-01', ${ADMIN}, 'line-7b'),
      ('pos8', 20, 8, 'Seed', 800, 8, '2026-02-10', ${ADMIN}, NULL),
      ('pos9', NULL, 9, 'Seed', 300, 3, '2026-03-10', ${ADMIN}, NULL);
    INSERT INTO portfolio_marks (uid, fund_id, project_id, as_of_date, fmv, basis) VALUES
      ('m6f30', 30, 6, '2026-06-30', 650, 'gp_estimate'),
      ('m7firm', NULL, 7, '2026-03-31', 700, 'gp_estimate'),
      ('m7f10', 10, 7, '2026-06-30', 900, 'round_price'),
      ('m7f20', 20, 7, '2026-09-30', 5000, 'round_price'),
      ('m8', 20, 8, '2026-06-30', 400, 'gp_estimate'),
      ('m9', NULL, 9, '2026-06-30', 350, 'gp_estimate');
    INSERT INTO portfolio_distributions (uid, fund_id, project_id, distribution_date, amount, kind) VALUES
      ('d7f10', 10, 7, '2026-07-01', 100, 'secondary'),
      ('d7f20', 20, 7, '2026-07-01', 999, 'secondary'),
      ('d8f20', 20, 8, '2026-07-01', 50, 'secondary');
  `);
  return db;
}

const app = new Hono<any>();
app.route('/api/positions', positions);

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

const FIVE_READS = ['/positions', '/positions/marks', '/positions/analytics', `/positions/kpi-compliance?as_of=${AS_OF}`, '/positions/p7'];

// ── 1. A GP of record without an investor licence ───────────────────────────

test('positions list: a GP of record without an investor licence reads their fund\'s rounds and nothing held', async () => {
  const db = fixture();
  // mutation: the old licence gate on the list answers 403 here.
  const gp = await call(db, NGP, '/positions');
  assert.equal(gp.status, 200);
  // mutation: reading the held scope without the licence (null: every row) lists 6, 7, 8 and 9.
  assert.deepEqual(pids(gp.body.items), [7], 'fund 10\'s company only: not fund 30\'s, fund 20\'s, the held 8 or the firm-level 9');
  const seven = gp.body.items[0];
  assert.equal(seven.total_invested, 500, 'fund 10\'s round only');
  assert.equal(seven.rounds, 1);
  assert.equal(seven.latest_round, 'Seed');
  assert.equal(seven.fmv, 900, 'carried at fund 10\'s own mark');
  assert.equal(seven.mark_fund_id, 10);
  assert.equal(gp.body.fund_scope.rule, 'gp_of_record');
  assert.deepEqual(gp.body.fund_scope.fund_ids, [10]);

  const fgp = await call(db, FGP, '/positions');
  assert.equal(fgp.status, 200, 'a founder who runs a fund passes too');
  assert.deepEqual(pids(fgp.body.items), [6]);
  assert.deepEqual(fgp.body.fund_scope.fund_ids, [30]);
});

test('positions marks, analytics and KPI compliance: a GP without a licence reads their fund\'s records only', async () => {
  const db = fixture();
  // mutation: the old licence gate on /marks answers 403; the held scope read without the licence lists every mark.
  const marks = await call(db, NGP, '/positions/marks');
  assert.equal(marks.status, 200);
  assert.deepEqual(uids(marks.body.items), ['m7f10', 'm7firm']);
  assert.equal(marks.body.projects, 1);

  // mutation: the old gate on /analytics answers 403; the held scope without the licence sums every round.
  const analytics = await call(db, NGP, '/positions/analytics');
  assert.equal(analytics.status, 200);
  assert.equal(analytics.body.position_count, 1);
  assert.equal(analytics.body.paid_in, 500);
  assert.equal(analytics.body.distributed, 100);
  assert.equal(analytics.body.nav, 900);

  // mutation: the old gate on /kpi-compliance answers 403; the held scope without the licence lists every company.
  const kpi = await call(db, NGP, `/positions/kpi-compliance?as_of=${AS_OF}`);
  assert.equal(kpi.status, 200);
  assert.deepEqual(pids(kpi.body.companies), [7]);

  assert.deepEqual(uids((await call(db, FGP, '/positions/marks')).body.items), ['m6f30']);
});

test('position detail: a GP without a licence reads their fund\'s company in the investor projection; any other company is 403', async () => {
  const db = fixture();
  // mutation: the old licence gate on the detail answers 403 here.
  const gp = await call(db, NGP, '/positions/p7');
  assert.equal(gp.status, 200);
  assert.deepEqual(uids(gp.body.rounds), ['pos7a'], 'not fund 20\'s round');
  const round = gp.body.rounds[0];
  assert.equal('created_by' in round, false, 'the investor projection');
  assert.equal('closing_line_uid' in round, false);
  assert.equal('id' in round, false);
  assert.deepEqual(uids(gp.body.marks), ['m7f10', 'm7firm']);
  assert.deepEqual(uids(gp.body.distributions), ['d7f10']);
  assert.equal(gp.body.rollup.invested, 500);

  // mutation: the held scope read without the licence (null) admits each of these as a holder.
  assert.equal((await call(db, NGP, '/positions/p6')).status, 403, 'another fund\'s company');
  assert.equal((await call(db, NGP, '/positions/p8')).status, 403, 'a company held by an investor and another fund');
  assert.equal((await call(db, NGP, '/positions/p9')).status, 403, 'a firm-level round, though they have a confirmed commitment in it');
  assert.equal((await call(db, NGP, '/positions/nope')).status, 404, 'admitted, so an unknown company is not found');

  assert.equal((await call(db, FGP, '/positions/p6')).status, 200);
  assert.equal((await call(db, FGP, '/positions/p7')).status, 403);
});

// ── 2. Neither a licence nor a fund: 403, as before ──────────────────────────

test('positions: a caller with neither an investor licence nor a fund gets 403 on all five reads', async () => {
  const db = fixture();
  for (const who of [PARTNER, FOUNDER]) {
    // mutation: admitting a caller without the licence whether or not they run a fund answers 200 (empty) here.
    for (const path of FIVE_READS) {
      const res = await call(db, who, path);
      assert.equal(res.status, 403, `${who} ${path}`);
      assert.equal(res.body.detail, 'Forbidden');
    }
    // mutation: gating the detail after the company lookup answers 404 here, telling which uids exist.
    assert.equal((await call(db, who, '/positions/nope')).status, 403, 'refused before the lookup');
  }
});

test('positions: a GP without a licence who is no longer GP of record is refused on the next read', async () => {
  const db = fixture();
  assert.equal((await call(db, NGP, '/positions')).status, 200);
  db.prepare('UPDATE vc_funds SET gp_user_id = ? WHERE id = 10').run(ADMIN);
  for (const path of FIVE_READS) {
    assert.equal((await call(db, NGP, path)).status, 403, path);
  }
});

// ── 3. Licensed callers unchanged ─────────────────────────────────────────────

test('positions: an investor who is also a GP, a holder and an admin read as in part 3', async () => {
  const db = fixture();
  const igp = await call(db, IGP, '/positions');
  assert.equal(igp.status, 200);
  assert.deepEqual(pids(igp.body.items), [7, 8]);
  assert.equal(igp.body.items.find((x: any) => x.project_id === 7).total_invested, 2000);
  assert.equal(igp.body.scope.rule, 'confirmed_commitment');
  assert.deepEqual(igp.body.fund_scope.fund_ids, [20]);
  assert.deepEqual(uids((await call(db, IGP, '/positions/marks')).body.items), ['m7f20', 'm7firm', 'm8']);
  assert.deepEqual(uids((await call(db, IGP, '/positions/p7')).body.rounds), ['pos7b']);
  assert.equal((await call(db, IGP, '/positions/p6')).status, 403);
  assert.deepEqual(pids((await call(db, IGP, `/positions/kpi-compliance?as_of=${AS_OF}`)).body.companies), [7, 8]);

  // mutation: forcing `held` to [] for licensed callers too drops the holder's company.
  const holder = await call(db, HOLDER, '/positions');
  assert.deepEqual(pids(holder.body.items), [8]);
  assert.equal(holder.body.fund_scope, null);
  assert.equal((await call(db, HOLDER, '/positions/p8')).status, 200);
  assert.equal((await call(db, HOLDER, '/positions/p7')).status, 403);

  const admin = await call(db, ADMIN, '/positions');
  assert.deepEqual(pids(admin.body.items), [6, 7, 8, 9]);
  assert.equal(admin.body.scope.rule, 'all_positions');
  assert.equal(admin.body.fund_scope, null);
  assert.equal((await call(db, ADMIN, '/positions/p9')).status, 200);
});
