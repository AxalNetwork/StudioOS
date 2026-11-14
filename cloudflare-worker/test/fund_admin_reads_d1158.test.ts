/**
 * D1158 (#3065) — the three fund admin reads:
 *
 *   · `GET /api/fund-admin/lps`: an admin on HQ in their own session reads it;
 *     a founder, a partner, an investor, a support session and a branch admin
 *     do not. Audited first. One row per LP of each administered fund; an LP
 *     with no ledger line reads null with its reason; filters, search, sort and
 *     pages run on the Worker; totals equal the sum of the rows.
 *   · `GET /api/fund-performance/:id/positions`: the latest mark per position,
 *     or `marked: false` with a reason; the fund's GP and admins only.
 *   · `GET /api/fund-performance/:id/history?step=quarter`: point-in-time
 *     performance per quarter end since the first call; a quarter with an
 *     unmarked position carries its reason, never 0.
 *
 * Mercury stays stubbed (#1779): `fetch` throws and is counted. Every name,
 * email and figure here is invented.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/fund_admin_reads_d1158.test.ts
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import fundAdmin from '../src/routes/fund_admin.ts';
import fundPerformance from '../src/routes/fund_performance.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { NO_LEDGER_LINE, UNREADABLE } from '../src/services/fundAdminLps.ts';
import { NO_CALL, quarterEnds } from '../src/services/fundPositionsHistory.ts';
import { splitStatements, tableFromBaseline } from './_baseline.mjs';
import { ADMIN, SUPER, FOUNDER, PARTNER, INVESTOR, JTI, envFor, freshDb, one, tokenFor } from './_mercury_fixture.ts';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');

const app = new Hono<any>();
app.route('/api/fund-admin', fundAdmin);
app.route('/api/fund-performance', fundPerformance);
app.onError((err: any, c) => {
  const status = AUTH_ERROR_STATUSES[err?.message ?? ''];
  return c.json({ detail: err?.message }, status ?? 500);
});

let fetches = 0;
const realFetch = globalThis.fetch;
beforeEach(() => { fetches = 0; globalThis.fetch = (async () => { fetches += 1; throw new Error('no network in D1158'); }) as any; });
afterEach(() => { globalThis.fetch = realFetch; assert.equal(fetches, 0, 'fetch was called'); });

const TODAY = new Date().toISOString().slice(0, 10);
const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const NOT_LIVE = 'f'.repeat(64);

function seeded() {
  const db = freshDb();
  for (const t of ['fund_distributions', 'lp_applications']) db.exec(tableFromBaseline(BASELINE, t).replace(/\s+REFERENCES\s+\w+\s*\([^)]*\)/gi, ''));
  db.exec('ALTER TABLE limited_partners ADD COLUMN lp_type TEXT;');
  // 478's two stores this read joins; its catalog stub and triggers are not needed here.
  for (const stmt of splitStatements(read('cloudflare-worker/sql/migrations/478_fund_notices_booklets.sql'))) {
    if (/^\s*(--[^\n]*\n\s*)*CREATE TABLE IF NOT EXISTS (legal_notices|fund_subscription_booklets) /.test(stmt)) db.exec(stmt.replace(/\s+REFERENCES\s+\w+\s*\([^)]*\)/gi, ''));
  }
  db.exec(`
INSERT INTO vc_funds (id, name, gp_user_id, slug) VALUES (1, 'Fund I', NULL, 'spinout-fund-i'), (2, 'Outside Fund', ${FOUNDER}, NULL), (3, 'Fund III', ${ADMIN}, NULL);
UPDATE users SET kyc_status = 'approved' WHERE id = ${INVESTOR};
UPDATE users SET kyc_status = NULL WHERE id = ${PARTNER};
INSERT INTO limited_partners (id, fund_id, user_id, name, email, commitment_amount, invested_amount, status, lpa_signed, lp_type) VALUES
  (10, 1, ${INVESTOR}, 'Ignored LP name', NULL, 1000, 0, 'active', 1, 'individual'),
  (11, 1, NULL, 'LP Bravo', 'bravo@example.test', 500, 0, 'committed', 0, NULL),
  (12, 1, NULL, 'LP Charlie', 'charlie@example.test', 0, 0, 'committed', 0, 'institution'),
  (20, 2, NULL, 'Outside LP', 'outside@example.test', 900, 0, 'active', 1, NULL),
  (30, 3, ${PARTNER}, NULL, NULL, 300, 0, 'active', 1, 'corporate');
INSERT INTO fund_capital_calls (id, uid, fund_id, call_number, amount_cents, due_date, line_count, issued_by)
  VALUES (1, 'call-1', 1, 1, 60000, '${days(-10)}', 2, ${SUPER});
INSERT INTO capital_calls (id, limited_partner_id, amount, amount_cents, status, due_date, fund_call_id) VALUES
  (100, 10, 400, 40000, 'pending', '${days(-10)}', 1),
  (101, 11, 200, 20000, 'pending', '${days(5)}', 1),
  (200, 20, 300, 30000, 'pending', '${days(-3)}', NULL),
  (300, 30, 300, 30000, 'pending', '${days(-3)}', NULL);
INSERT INTO capital_call_receipts (uid, capital_call_id, limited_partner_id, fund_id, amount_cents, received_on, reference, source, recorded_by)
  VALUES ('r-1', 101, 11, 1, 5000, '${TODAY}', 'fixture-ref-1', 'receipt', ${ADMIN});
INSERT INTO fund_distributions (fund_id, lp_id, amount_cents, distribution_type, status, distributed_at) VALUES
  (1, 10, 7000, 'profit_share', 'paid', '${TODAY}'), (1, 11, 9999, 'profit_share', 'pending', NULL), (2, 20, 8888, 'profit_share', 'paid', '${TODAY}');
INSERT INTO legal_notices (uid, notice_type, source_ref, fund_id, limited_partner_id, sender_entity, amount_cents, reference, figures_json, figures_sha256, created_at) VALUES
  ('n-old', 'capital_call_notice', 'call_line:99', 1, 10, 'fund', 1000, 'CALL-1-OLD', '{}', '${NOT_LIVE}', '2026-01-01 00:00:00'),
  ('n-new', 'capital_call_notice', 'call_line:100', 1, 10, 'fund', 40000, 'CALL-1-A', '{}', '${NOT_LIVE}', '2026-02-01 00:00:00');
INSERT INTO lp_applications (id, user_id, fund_slug, investor_type, status) VALUES (1, ${INVESTOR}, 'spinout-fund-i', 'individual', 'approved');
INSERT INTO fund_subscription_booklets (uid, application_id, status, frozen_json, digest, submitted_at)
  VALUES ('b-1', 1, 'submitted', '{}', '${NOT_LIVE}', '2026-03-01 00:00:00');
-- A later, withdrawn booklet on the same application: the live one is the state.
INSERT INTO fund_subscription_booklets (uid, application_id, status, withdrawn_by, withdrawn_reason)
  VALUES ('b-2', 1, 'withdrawn', ${ADMIN}, 'Fixture withdrawal reason');
`);
  return db;
}

async function get(db: any, path: string, as: number, opts: { jti?: string; impersonated?: boolean; env?: Record<string, unknown> } = {}) {
  const res: Response = await (app.request(path, {
    headers: { Authorization: `Bearer ${await tokenFor(as, opts)}` },
  }, envFor(db, opts.env)) as Promise<Response>).catch((e: unknown) => { if (e instanceof Response) return e; throw e; });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body, text };
}
const lps = (db: any, qs = '', as = ADMIN, opts: any = { jti: JTI.adminTotp }) => get(db, `/api/fund-admin/lps${qs}`, as, opts);
const ids = (body: any) => body.items.map((r: any) => r.limited_partner_id);
const auditCount = (db: any) => Number(one(db, "SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'fund_lps_read'").n);

// ---------------------------------------------------------------- /lps

test('lps: a founder, a partner and an investor get 403; a support session and a branch admin are refused, unaudited; Admin and Super Admin read', async () => {
  const db = seeded();
  for (const user of [FOUNDER, PARTNER, INVESTOR]) assert.equal((await lps(db, '', user, {})).status, 403, `user ${user}`);
  const support = await lps(db, '', SUPER, { jti: JTI.superFresh, impersonated: true });
  assert.deepEqual([support.status, support.body?.code], [403, 'support_session_refused']);
  const branch = await lps(db, '', ADMIN, { jti: JTI.adminTotp, env: { BRANCH_CODE: 'fr' } });
  assert.equal(branch.status, 403, 'a branch admin');
  assert.equal(branch.body?.items, undefined);
  assert.equal(auditCount(db), 0, 'a refused read is not audited as a read');
  for (const [user, jti] of [[ADMIN, JTI.adminTotp], [SUPER, JTI.superFresh]] as const) {
    const r = await lps(db, '', user, { jti });
    assert.equal(r.status, 200, `${user}: ${r.text}`);
  }
  assert.equal(auditCount(db), 2);
});

test('lps: the audit row is written first; a failing audit answers 503 with no rows', async () => {
  const db = seeded();
  db.exec(`CREATE TRIGGER audit_down BEFORE INSERT ON admin_audit_log BEGIN SELECT RAISE(ABORT, 'audit down'); END;`);
  const down = await lps(db);
  assert.deepEqual([down.status, down.body?.code], [503, 'audit_unavailable']);
  assert.equal(down.body?.items, undefined);
  assert.doesNotMatch(down.text, /bravo@example\.test|Fund I/);
});

test('lps: one row per LP of each administered fund, never the outside GP\'s; an LP with no ledger line reads null with its reason', async () => {
  const db = seeded();
  const { body } = await lps(db);
  assert.deepEqual(body.funds, [{ id: 1, name: 'Fund I' }, { id: 3, name: 'Fund III' }]);
  assert.deepEqual(ids(body).sort(), [10, 11, 12, 30]);
  const by = Object.fromEntries(body.items.map((r: any) => [r.limited_partner_id, r]));

  // No ledger line: null, never 0, with the reason under each key.
  const c = by[12];
  assert.deepEqual([c.called_cents, c.received_cents, c.outstanding_cents, c.overdue_lines], [null, null, null, null]);
  for (const k of ['called_cents', 'received_cents', 'outstanding_cents', 'overdue_lines']) assert.equal(c.unavailable[k], NO_LEDGER_LINE, k);
  assert.equal(c.commitment_cents, null);
  assert.equal(c.unavailable.commitment_cents, 'No commitment is recorded for this LP.');

  const a = by[10];
  assert.deepEqual(
    [a.name, a.email, a.fund_name, a.has_account, a.lp_type, a.lpa_signed, a.kyc_status],
    ['User 905', 'user905@example.test', 'Fund I', true, 'individual', true, 'approved']);
  assert.deepEqual([a.commitment_cents, a.called_cents, a.received_cents, a.outstanding_cents, a.distributed_cents, a.overdue_lines],
    [100000, 40000, 0, 40000, 7000, 1]);
  assert.deepEqual(a.last_notice, { uid: 'n-new', notice_type: 'capital_call_notice', reference: 'CALL-1-A', amount_cents: 40000, issued_at: '2026-02-01 00:00:00' });
  assert.deepEqual(a.booklet, { state: 'submitted', application_status: 'approved', submitted_at: '2026-03-01 00:00:00', uid: 'b-1' });
  assert.deepEqual(a.unavailable, {});

  const b = by[11];
  assert.deepEqual([b.called_cents, b.received_cents, b.outstanding_cents, b.overdue_lines], [20000, 5000, 15000, 0]);
  assert.equal(b.distributed_cents, null, 'a pending distribution is not paid');
  assert.equal(b.unavailable.distributed_cents, 'No paid distribution is recorded for this LP.');
  assert.deepEqual([b.kyc_status, b.unavailable.kyc_status], [null, 'This LP has no account, so no identity check is recorded.']);
  assert.deepEqual([b.lp_type, b.unavailable.lp_type], [null, 'No LP type is recorded.']);
  assert.deepEqual([b.last_notice, b.unavailable.last_notice], [null, 'No notice has been issued to this LP.']);
  assert.deepEqual([b.booklet, b.unavailable.booklet], [null, 'This LP has no account, so no application links it to a booklet.']);

  const d = by[30];
  assert.deepEqual([d.kyc_status, d.unavailable.kyc_status], [null, 'No identity check is recorded for this LP\'s account.']);
  assert.deepEqual([d.booklet, d.unavailable.booklet], [null, 'This fund takes no applications, so it has no booklet.']);
  assert.deepEqual([d.called_cents, d.outstanding_cents, d.overdue_lines], [30000, 30000, 1], 'a legacy unnumbered line counts');

  // An approved application with no booklet yet reads not_started.
  db.exec(`INSERT INTO lp_applications (id, user_id, fund_slug, investor_type, status) VALUES (2, ${PARTNER}, 'spinout-fund-i', 'individual', 'approved');
           INSERT INTO limited_partners (id, fund_id, user_id, commitment_amount, status) VALUES (13, 1, ${PARTNER}, 100, 'committed');`);
  const again = (await lps(db, '?q=user904')).body.items.find((r: any) => r.limited_partner_id === 13);
  assert.deepEqual(again.booklet, { state: 'not_started', application_status: 'approved', submitted_at: null, uid: null });
});

test('lps: totals equal the sum of the rows across every page, with the rows that hold no figure counted', async () => {
  const db = seeded();
  const whole = (await lps(db)).body;
  const paged: any[] = [];
  const first = (await lps(db, '?per_page=1')).body;
  assert.equal(first.pages, 4);
  assert.deepEqual(first.totals, whole.totals, 'totals cover every page, not the one returned');
  for (let page = 1; page <= first.pages + 1; page++) paged.push(...(await lps(db, `?per_page=1&page=${page}`)).body.items);
  assert.equal(paged.length, whole.total_rows);
  assert.equal(whole.totals.rows, 4);
  for (const k of ['commitment_cents', 'called_cents', 'received_cents', 'outstanding_cents', 'distributed_cents']) {
    const held = paged.filter((r) => r[k] !== null);
    assert.equal(whole.totals[k], held.reduce((s, r) => s + r[k], 0), k);
    assert.equal(whole.totals.not_recorded[k] ?? 0, paged.length - held.length, k);
  }
  assert.deepEqual([whole.totals.called_cents, whole.totals.distributed_cents], [90000, 7000]);
  assert.deepEqual(whole.totals.not_recorded, { commitment_cents: 1, called_cents: 1, received_cents: 1, outstanding_cents: 1, distributed_cents: 3 });

  // D1162: FND5's tiles and chart count every row the filters keep.
  assert.deepEqual(first.tally, whole.tally, 'the tally covers every page');
  assert.deepEqual(whole.tally, {
    lpa_pending: 2, identity_pending: 0, identity_not_recorded: 3, overdue_lines: 2,
    by_type: [
      { lp_type: 'individual', lps: 1, commitment_cents: 100000 },
      { lp_type: 'corporate', lps: 1, commitment_cents: 30000 },
      { lp_type: 'institution', lps: 1, commitment_cents: null },
      { lp_type: null, lps: 1, commitment_cents: 50000 },
    ],
  });
  db.exec(`UPDATE users SET kyc_status = 'pending' WHERE id = ${PARTNER}`);
  assert.equal((await lps(db)).body.tally.identity_pending, 1, 'a recorded check that is not approved is pending');
  assert.equal((await lps(db, '?fund=3')).body.tally.lpa_pending, 0, 'a signed LPA is not pending');
  db.exec(`UPDATE users SET kyc_status = NULL WHERE id = ${PARTNER}`);

  // Totals follow the filters, not the page.
  const one3 = (await lps(db, '?fund=3&per_page=1')).body;
  assert.deepEqual([one3.totals.rows, one3.totals.called_cents, one3.totals.distributed_cents], [1, 30000, null]);
});

test('lps: filters, search, sort and pages run on the Worker; a bad filter is refused; an outside fund is not administered', async () => {
  const db = seeded();
  const q = async (qs: string) => ids((await lps(db, qs)).body);
  assert.deepEqual(await q('?fund=3'), [30]);
  assert.deepEqual(await q('?lpa=signed'), [30, 10]);
  assert.deepEqual(await q('?lpa=unsigned'), [11, 12]);
  assert.deepEqual(await q('?identity=approved'), [10]);
  assert.deepEqual(await q('?identity=not_recorded'), [11, 12, 30]);
  assert.deepEqual(await q('?booklet=submitted'), [10]);
  assert.deepEqual(await q('?booklet=not_recorded'), [11, 12, 30]);
  assert.deepEqual(await q('?outstanding=1'), [11, 30, 10]);
  assert.deepEqual(await q('?overdue=1'), [30, 10]);
  assert.deepEqual(await q('?q=BRAVO@example'), [11]);
  assert.deepEqual(await q('?q=charlie'), [12]);
  assert.deepEqual(await q('?sort=called&dir=desc'), [10, 30, 11, 12], 'no figure sorts last');
  assert.deepEqual(await q('?sort=called&dir=asc'), [11, 30, 10, 12], 'no figure sorts last either way');
  assert.deepEqual(await q('?sort=fund&dir=desc'), [30, 10, 11, 12]);
  assert.deepEqual(await q(''), [11, 12, 30, 10], 'by name by default');
  assert.deepEqual(await q('?per_page=2&page=2'), [30, 10]);
  const p = (await lps(db, '?per_page=3')).body;
  assert.deepEqual([p.page, p.per_page, p.pages, p.total_rows], [1, 3, 2, 4]);

  for (const bad of ['?fund=x', '?lpa=yes', '?identity=DROP', '?booklet=lost', '?outstanding=yes', '?sort=email', '?dir=up', '?page=0', '?per_page=201', `?q=${'x'.repeat(101)}`]) {
    const r = await lps(db, bad);
    assert.deepEqual([r.status, r.body?.code], [400, 'invalid_lp_query'], bad);
  }
  const outside = await lps(db, '?fund=2');
  assert.deepEqual([outside.status, outside.body?.code], [404, 'fund_not_administered']);
  assert.doesNotMatch(outside.text, /outside@example/);
});

test('lps (D1162): ?lp= answers that one LP\'s row for the drawer, audited with its id; a bad id is refused', async () => {
  const db = seeded();
  const r = (await lps(db, '?lp=12')).body;
  assert.deepEqual(ids(r), [12]);
  assert.equal(r.items[0].called_cents, null, 'no ledger line is null, never 0');
  assert.equal(r.items[0].unavailable.called_cents, NO_LEDGER_LINE);
  assert.deepEqual(ids((await lps(db, '?lp=20')).body), [], 'an outside fund\'s LP is not in the roster');
  assert.deepEqual(ids((await lps(db, '?lp=30&fund=1')).body), [], 'the fund filter still applies');
  const audit = one(db, "SELECT filters_json FROM admin_audit_log WHERE action = 'fund_lps_read' ORDER BY id DESC LIMIT 1");
  assert.match(String(audit.filters_json), /"lp_id":30/);
  for (const bad of ['?lp=x', '?lp=0', '?lp=-1']) {
    const res = await lps(db, bad);
    assert.deepEqual([res.status, res.body?.code], [400, 'invalid_lp_query'], bad);
  }
});

test('lps: a store that cannot be read makes only its own figures Unreadable', async () => {
  const db = seeded();
  db.exec('DROP TABLE legal_notices;');
  const { status, body } = await lps(db, '?fund=1&sort=name');
  assert.equal(status, 200);
  const a = body.items.find((r: any) => r.limited_partner_id === 10);
  assert.deepEqual([a.last_notice, a.unavailable.last_notice], [null, UNREADABLE]);
  assert.deepEqual([a.called_cents, a.distributed_cents, a.booklet?.state], [40000, 7000, 'submitted']);

  db.exec('DROP TABLE capital_call_receipts;');
  const noLedger = (await lps(db, '?fund=1')).body.items.find((r: any) => r.limited_partner_id === 10);
  assert.deepEqual([noLedger.called_cents, noLedger.unavailable.called_cents], [null, UNREADABLE]);
  assert.equal(noLedger.distributed_cents, 7000);
});

// ---------------------------------------------------------- positions & history

function perfSeeded() {
  const db = seeded();
  db.exec(tableFromBaseline(BASELINE, 'portfolio_positions').replace(/\s+REFERENCES\s+\w+\s*\([^)]*\)/gi, ''));
  db.exec('CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT);');
  db.exec(read('cloudflare-worker/sql/migrations/417_fund_position_valuations.sql').replace(/\s+REFERENCES\s+\w+\s*\([^)]*\)/gi, ''));
  db.exec(`
UPDATE users SET investor_tier = 'institutional', investor_subscription_status = 'active' WHERE id IN (${INVESTOR}, ${PARTNER});
UPDATE users SET role = 'investor' WHERE id = ${PARTNER};
INSERT INTO vc_funds (id, name, gp_user_id) VALUES (4, 'GP Fund', ${INVESTOR}), (5, 'Empty Fund', ${INVESTOR});
INSERT INTO projects (id, name) VALUES (70, 'Fixture Robotics'), (71, 'Fixture Bio');
INSERT INTO portfolio_positions (id, uid, fund_id, project_id, round_name, invested_amount, position_date, created_at) VALUES
  (201, 'pos-201', 4, 70, 'Seed', 500, '2025-01-15', '2025-01-15 09:00:00'),
  (202, 'pos-202', 4, 71, 'Pre-Seed', 250, '2025-05-01', '2025-05-01 09:00:00'),
  (203, 'pos-203', 1, 70, 'Series A', 999, '2025-01-01', '2025-01-01 09:00:00');
INSERT INTO fund_position_valuations (position_id, valuation_date, value_cents, source, recorded_by) VALUES
  (201, '2025-03-01', 100000, 'Initial mark', ${INVESTOR}),
  (201, '2025-08-01', 150000, 'Priced round', ${ADMIN}),
  (202, '2025-12-01', 30000, 'Board deck', ${INVESTOR}),
  (203, '2025-02-01', 777777, 'Other fund', ${ADMIN});
INSERT INTO fund_capital_calls (id, uid, fund_id, call_number, amount_cents, due_date, line_count, issued_by, created_at) VALUES
  (41, 'call-41', 4, 1, 50000, '2025-03-01', 1, ${SUPER}, '2025-02-10 10:00:00'),
  (42, 'call-42', 4, 2, 30000, '2025-08-01', 1, ${SUPER}, '2025-07-10 10:00:00');
INSERT INTO fund_distributions (fund_id, lp_id, amount_cents, distribution_type, status, distributed_at) VALUES
  (4, 10, 1000, 'profit_share', 'paid', '2025-09-15');
`);
  return db;
}
const perf = (db: any, path: string, as = ADMIN, opts: any = { jti: JTI.adminTotp }) => get(db, `/api/fund-performance${path}`, as, opts);

test('positions: each position with its latest mark; an unmarked position says so; only the fund\'s', async () => {
  const db = perfSeeded();
  db.exec(`DELETE FROM fund_position_valuations WHERE position_id = 202;`);
  const { status, body } = await perf(db, '/4/positions');
  assert.equal(status, 200);
  assert.deepEqual(body.items.map((p: any) => p.id), [201, 202]);
  const [a, b] = body.items;
  assert.deepEqual([a.company_name, a.round_name, a.invested_amount, a.marked, a.value_cents, a.valuation_date, a.source, a.recorded_by],
    ['Fixture Robotics', 'Seed', 500, true, 150000, '2025-08-01', 'Priced round', { id: ADMIN, name: `User ${ADMIN}` }]);
  assert.deepEqual(a.unavailable, {});
  assert.deepEqual([b.marked, b.value_cents, b.valuation_date, b.source, b.recorded_by], [false, null, null, null, null]);
  assert.match(b.unavailable.value_cents, /No valuation is recorded/);
  assert.equal(body.unmarked, 1);
});

test('positions and history: the fund\'s GP and admins read; another investor, a founder and a bad id do not', async () => {
  const db = perfSeeded();
  for (const path of ['/4/positions', '/4/history?step=quarter']) {
    assert.equal((await perf(db, path, INVESTOR, {})).status, 200, `GP ${path}`);
    assert.equal((await perf(db, path)).status, 200, `admin ${path}`);
    const other = await perf(db, path, PARTNER, {});
    assert.equal(other.status, 404, `another investor ${path}`);
    assert.doesNotMatch(other.text, /Fixture Robotics|150000/);
    assert.ok([403, 404].includes((await perf(db, path, FOUNDER, {})).status), `founder ${path}`);
  }
  assert.equal((await perf(db, '/0/positions')).status, 404);
  assert.equal((await perf(db, '/x/history')).status, 404);
});

test('history: point-in-time performance per quarter end since the first call; a quarter with an unmarked position carries its reason', async () => {
  const db = perfSeeded();
  const { status, body } = await perf(db, '/4/history?step=quarter');
  assert.equal(status, 200);
  assert.equal(body.first_call, '2025-02-10');
  assert.deepEqual(body.items.map((q: any) => q.quarter_end), quarterEnds('2025-02-10', TODAY));
  const at = (end: string) => body.items.find((q: any) => q.quarter_end === end);

  const q1 = at('2025-03-31');
  assert.deepEqual([q1.quarter, q1.nav_cents, q1.paid_in_cents, q1.rvpi], ['Q1 2025', 100000, 50000, 2], 'only 201 is held; only call 1 is issued');
  assert.equal(q1.distributed_cents, null);
  assert.match(q1.unavailable.distributed_cents, /No complete paid distribution/);

  // 202 is held from May and first marked in December: Q2 and Q3 cannot read NAV.
  for (const end of ['2025-06-30', '2025-09-30']) {
    const q = at(end);
    assert.equal(q.nav_cents, null, end);
    assert.match(q.unavailable.nav_cents, /Every attributed position needs a dated valuation/, end);
    assert.equal(q.rvpi, null, end);
    assert.ok(q.unavailable.rvpi, end);
  }
  assert.deepEqual([at('2025-09-30').paid_in_cents, at('2025-09-30').distributed_cents], [80000, 1000]);
  const q4 = at('2025-12-31');
  assert.deepEqual([at('2025-06-30').quarter, at('2025-09-30').quarter, q4.quarter], ['Q2 2025', 'Q3 2025', 'Q4 2025']);
  assert.deepEqual([q4.nav_cents, q4.paid_in_cents, q4.distributed_cents, q4.tvpi], [180000, 80000, 1000, 181000 / 80000]);
  assert.equal(q4.unavailable.nav_cents, undefined);
});

test('history: a fund with no call has no quarter, with its reason; only step=quarter is read', async () => {
  const db = perfSeeded();
  const empty = await perf(db, '/5/history?step=quarter');
  assert.deepEqual([empty.status, empty.body.items, empty.body.reason, empty.body.first_call], [200, [], NO_CALL, null]);
  const month = await perf(db, '/4/history?step=month');
  assert.deepEqual([month.status, month.body?.error], [400, 'invalid_history_step']);
});

test('quarterEnds walks quarter ends from the first call through today', () => {
  assert.deepEqual(quarterEnds('2025-02-10', '2025-06-30'), ['2025-03-31', '2025-06-30']);
  assert.deepEqual(quarterEnds('2025-12-31', '2026-03-30'), ['2025-12-31']);
  assert.deepEqual(quarterEnds('2025-10-01', '2025-12-30'), []);
});
