/**
 * D712 (#1777) — the fund reporting queue over real SQLite: migration 476's
 * seals, the roles, the Super Admin issue, the quarterly pack, the audited
 * reads, the schedule and the LP reads.
 *
 * The store is the baseline's tables plus migrations 312, 417, 418 and 476,
 * read from their files. TOTP sessions follow `secret_consoles_d223.test.ts`:
 * a fresh `totp` session satisfies TOTP and step-up; a two-day-old one is TOTP
 * without a fresh step-up.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import reporting, { draftCsv } from '../src/routes/fund_reporting.ts';
import funds from '../src/routes/funds.ts';
import { runReportingSchedule, sha256Hex } from '../src/services/fundReportDrafts.ts';
import { allocate, quarterPeriod } from '../src/services/fundReportBuild.ts';

const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const mig = (f: string) => readFileSync(new URL(`../sql/migrations/${f}`, import.meta.url), 'utf8');
const TABLES = ['users', 'super_admins', 'user_sessions', 'activity_logs', 'vc_funds', 'limited_partners', 'fund_report_periods',
  'capital_calls', 'fund_distributions', 'portfolio_positions', 'user_company_links'];
const SCHEMA = TABLES.map((t) => stripForeignKeys(tableFromBaseline(baseline, t))).join('\n')
  + '\nCREATE UNIQUE INDEX idx_fund_report_periods_fund_period ON fund_report_periods(fund_id, period);\n'
  + ['312_fund_call_ledger.sql', '417_fund_position_valuations.sql', '418_fund_ledger.sql', '476_fund_report_drafts.sql'].map(mig).join('\n');
const SECRET = ['d712', 'fixture', 'signing', 'secret', 'only'].join('-');

const ADMIN = 1, SUPER = 2, SUPER2 = 3, OUTSIDE_GP = 4, LP = 5, FOUNDER = 6, PARTNER = 7, PLAIN_TOTP = 8;
const Q = quarterPeriod('Q3 2026')!;

function fixture() {
  const { DB, db } = makeD1(SCHEMA);
  const u = db.prepare("INSERT INTO users (id, role, name, email, investor_tier, investor_subscription_status) VALUES (?, ?, ?, ?, ?, 'active')");
  for (const [id, role, name, tier] of [[ADMIN, 'admin', 'Plain Admin', 'free'], [SUPER, 'admin', 'Super One', 'free'], [SUPER2, 'admin', 'Super Two', 'free'],
    [OUTSIDE_GP, 'investor', 'Outside GP', 'institutional'], [LP, 'investor', 'Lena LP', 'free'], [FOUNDER, 'founder', 'Fay Founder', 'free'],
    [PARTNER, 'partner', 'Pat Partner', 'free'], [PLAIN_TOTP, 'admin', 'Totp Admin', 'free']] as const) {
    u.run(id, role, name, `user${id}@example.test`, tier);
  }
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER}), (${SUPER2})`);
  const s = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, ?, datetime('now', ?))");
  s.run(SUPER, 'totp-super', 'totp', '+0 seconds');
  s.run(SUPER, 'totp-stale', 'totp', '-2 days');
  s.run(SUPER2, 'totp-super2', 'totp', '+0 seconds');
  s.run(PLAIN_TOTP, 'totp-plain', 'totp', '+0 seconds');
  s.run(ADMIN, 'pw-plain', 'password', '+0 seconds');
  db.exec(`
    INSERT INTO vc_funds (id, name, gp_user_id, status) VALUES (10, 'Fund A', NULL, 'investing'), (20, 'Fund B', ${OUTSIDE_GP}, 'investing'), (30, 'Fund C', ${SUPER}, 'investing');
    INSERT INTO limited_partners (id, fund_id, user_id, name, commitment_amount, invested_amount, status, created_at) VALUES
      (101, 10, ${LP}, 'Lena LP', 1000.00, 300.00, 'committed', '2026-01-10 09:00:00'),
      (102, 10, NULL, 'Second LP', 2000.00, 0, 'active', '2026-02-01 09:00:00'),
      (103, 10, NULL, 'No commitment', 0, 0, 'committed', '2026-02-01 09:00:00'),
      (104, 10, NULL, 'Withdrawn', 500.00, 0, 'withdrawn', '2026-02-01 09:00:00'),
      (105, 10, NULL, 'Admitted later', 500.00, 0, 'committed', '2026-12-01 09:00:00'),
      (201, 20, NULL, 'Outside fund LP', 1000.00, 0, 'committed', '2026-01-10 09:00:00');
    INSERT INTO capital_calls (id, limited_partner_id, amount, amount_cents, created_at) VALUES (1, 101, 300.00, 30000, '2026-08-01 09:00:00');
    INSERT INTO capital_call_receipts (uid, capital_call_id, limited_partner_id, fund_id, amount_cents, received_on, recorded_by)
      VALUES ('rcpt-1', 1, 101, 10, 30000, '2026-08-10', ${ADMIN});
    INSERT INTO fund_distributions (fund_id, lp_id, amount_cents, distribution_type, status, distributed_at) VALUES (10, 101, 5000, 'profit_share', 'paid', '2026-09-15 10:00:00');
    INSERT INTO portfolio_positions (id, uid, project_id, round_name, fund_id, invested_amount) VALUES (1, 'pos-1', 1, 'Seed', 10, 100);
    INSERT INTO fund_position_valuations (position_id, valuation_date, value_cents, source, recorded_by) VALUES (1, '2026-09-01', 100001, 'Board mark', ${ADMIN});
  `);
  const env = { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  const app = new Hono<any>();
  app.route('/api/fund-reporting', reporting);
  app.route('/api/funds', funds);
  async function call(who: number, method: string, path: string, body?: unknown, opts: { jti?: string; envExtra?: Record<string, unknown>; impersonatedBy?: number } = {}) {
    const claims: Record<string, unknown> = { user_id: who, ...(opts.jti ? { jti: opts.jti } : {}), ...(opts.impersonatedBy ? { impersonated_by: opts.impersonatedBy } : {}) };
    const token = await new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await app.request(`/api${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { ...env, ...(opts.envExtra || {}) });
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json, headers: res.headers };
  }
  const one = (sql: string, ...a: unknown[]) => ({ ...(db.prepare(sql).get(...a) as any) });
  const all = (sql: string, ...a: unknown[]) => (db.prepare(sql).all(...a) as any[]).map((r) => ({ ...r }));
  return { db, env, call, one, all };
}

type F = ReturnType<typeof fixture>;
const live = (f: F) => f.all("SELECT uid, kind, subject_key, status, revision FROM fund_report_drafts WHERE status IN ('draft', 'prepared') ORDER BY id");
const reportOf = (f: F) => f.one("SELECT * FROM fund_report_drafts WHERE kind = 'lp_quarterly_report' AND fund_id = 10 AND status IN ('draft', 'prepared')");
const writeLetter = (f: F) => f.db.prepare("UPDATE fund_report_periods SET notes = json_set(notes, '$.letter', json_array('The GP letter.'), '$._receipt.write_uid', ?) WHERE fund_id = 10 AND period = 'Q3 2026'").run(`rev-${Math.random()}`);

async function built(f: F) {
  const r = await f.call(ADMIN, 'POST', '/fund-reporting/build', { kind: 'lp_quarterly_report', period_label: 'Q3 2026', fund_id: 10 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
async function prepared(f: F, who = ADMIN) {
  await built(f);
  writeLetter(f);
  const rep = reportOf(f);
  const r = await f.call(who, 'POST', `/fund-reporting/drafts/${rep.uid}/prepare`, { figures_sha256: rep.figures_sha256 }, { jti: who === SUPER ? 'totp-super' : undefined });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return reportOf(f);
}

// ── Migration 476's seals ───────────────────────────────────────────────────

test('476 refuses a DELETE, an edit of the figures, any change to an issued row, a skipped state and an issue by the preparer', async () => {
  const f = fixture();
  await built(f);
  const r = reportOf(f);
  assert.throws(() => f.db.prepare('DELETE FROM fund_report_drafts WHERE id = ?').run(r.id), /append-only/);
  assert.throws(() => f.db.prepare("UPDATE fund_report_drafts SET figures_json = '{}' WHERE id = ?").run(r.id), /frozen/);
  assert.throws(() => f.db.prepare("UPDATE fund_report_drafts SET figures_sha256 = ? WHERE id = ?").run('0'.repeat(64), r.id), /frozen/);
  assert.throws(() => f.db.prepare("UPDATE fund_report_drafts SET status = 'issued', prepared_by = 1, issued_by = 2, issued_at = 'x' WHERE id = ?").run(r.id), /not allowed/);
  f.db.prepare("UPDATE fund_report_drafts SET status = 'prepared', prepared_by = 1, prepared_at = 'x' WHERE id = ?").run(r.id);
  assert.throws(() => f.db.prepare("UPDATE fund_report_drafts SET status = 'issued', issued_by = 1, issued_at = 'y' WHERE id = ?").run(r.id), /cannot issue|CHECK/);
  f.db.prepare("UPDATE fund_report_drafts SET status = 'issued', issued_by = 2, issued_at = 'y' WHERE id = ?").run(r.id);
  assert.throws(() => f.db.prepare("UPDATE fund_report_drafts SET narrative_revision = 'z' WHERE id = ?").run(r.id), /cannot change/);
  const ev = f.one('SELECT id FROM fund_report_draft_events LIMIT 1').id;
  assert.throws(() => f.db.prepare("UPDATE fund_report_draft_events SET note = 'x' WHERE id = ?").run(ev), /append-only/);
  assert.throws(() => f.db.prepare('DELETE FROM fund_report_draft_events WHERE id = ?').run(ev), /append-only/);
});

// ── Roles ───────────────────────────────────────────────────────────────────

test('a founder, a partner and an investor get 403 on every route; a branch Worker gets HQ only', async () => {
  const f = fixture();
  await built(f);
  const uid = reportOf(f).uid;
  const routes: Array<[string, string]> = [['GET', '/fund-reporting/drafts'], ['GET', `/fund-reporting/drafts/${uid}`], ['GET', `/fund-reporting/drafts/${uid}/export`],
    ['POST', '/fund-reporting/build'], ['POST', `/fund-reporting/drafts/${uid}/rebuild`], ['POST', `/fund-reporting/drafts/${uid}/prepare`],
    ['POST', `/fund-reporting/drafts/${uid}/return`], ['POST', `/fund-reporting/drafts/${uid}/correct`], ['POST', `/fund-reporting/drafts/${uid}/issue`]];
  for (const who of [FOUNDER, PARTNER, OUTSIDE_GP, LP]) {
    for (const [m, p] of routes) assert.equal((await f.call(who, m, p, m === 'GET' ? undefined : {})).status, 403, `${who} ${m} ${p}`);
  }
  const branch = await f.call(ADMIN, 'GET', '/fund-reporting/drafts', undefined, { envExtra: { BRANCH_CODE: 'nyc' } });
  assert.equal(branch.status, 403);
  assert.match(JSON.stringify(branch.body), /HQ only/);
  assert.equal(f.one("SELECT COUNT(*) AS n FROM fund_report_draft_events WHERE action <> 'built'").n, 0, 'no refused call left a row');
});

test('a plain Admin builds, reads, prepares, returns and exports; the list carries no figures and no digest', async () => {
  const f = fixture();
  const b = await built(f);
  assert.deepEqual(b.results.map((x: any) => x.result), ['built']);
  assert.deepEqual(live(f).map((r: any) => r.subject_key).sort(), ['fund:10', 'lp:101', 'lp:102']);
  const list = await f.call(ADMIN, 'GET', '/fund-reporting/drafts?fund_id=10');
  assert.equal(list.body.items.length, 3);
  assert.equal(list.body.administered, true);
  assert.doesNotMatch(JSON.stringify(list.body), /figures|sha256|Lena/);
  assert.equal((await f.call(ADMIN, 'GET', '/fund-reporting/drafts?fund_id=20')).body.administered, false);
  const rep = reportOf(f);
  const read = await f.call(ADMIN, 'GET', `/fund-reporting/drafts/${rep.uid}`);
  assert.equal(read.status, 200);
  assert.equal(read.body.figures_sha256, rep.figures_sha256);
  assert.equal(read.body.figures_sha256, await sha256Hex(rep.figures_json));
  writeLetter(f);
  assert.equal((await f.call(ADMIN, 'POST', `/fund-reporting/drafts/${rep.uid}/prepare`, { figures_sha256: rep.figures_sha256 })).status, 200);
  assert.deepEqual(live(f).map((r: any) => r.status), ['prepared', 'prepared', 'prepared'], 'the pack prepares as one');
  assert.equal((await f.call(ADMIN, 'POST', `/fund-reporting/drafts/${rep.uid}/return`, { reason: 'short' })).status, 400);
  assert.equal((await f.call(ADMIN, 'POST', `/fund-reporting/drafts/${rep.uid}/return`, { reason: 'The letter needs the Q3 marks.' })).status, 200);
  assert.deepEqual(live(f).map((r: any) => r.status), ['draft', 'draft', 'draft'], 'the pack returns as one');
  assert.equal(f.one("SELECT COUNT(*) AS n FROM fund_report_draft_events WHERE action = 'returned' AND note = 'The letter needs the Q3 marks.'").n, 3);
  const csv = await f.call(ADMIN, 'GET', `/fund-reporting/drafts/${rep.uid}/export`);
  assert.equal(csv.status, 200);
  assert.match(String(csv.body), /^"DRAFT, not issued"\r\n/);
  assert.match(String(csv.headers.get('content-disposition')), new RegExp(`filename="lp_quarterly_report-Q3-2026-${rep.uid}\\.csv"`));
  assert.deepEqual(f.all('SELECT action FROM fund_report_draft_events WHERE draft_id = ? ORDER BY id', rep.id).map((e: any) => e.action),
    ['built', 'viewed', 'prepared', 'returned', 'exported']);
});

test('the export defuses a formula cell and quotes every cell', () => {
  const out = draftCsv({ status: 'issued', kind: 'entity_cash_monthly', period_label: '2026-09', uid: 'a'.repeat(32) },
    { unmatched: [{ counterparty: '=HYPERLINK("x")', memo: '+1 "quoted"', amount_cents: -1500 }] });
  assert.doesNotMatch(out, /DRAFT/);
  assert.match(out, /"'=HYPERLINK\(""x""\)"/);
  assert.match(out, /"'\+1 ""quoted"""/);
  assert.match(out, /"unmatched\.0\.amount_cents","-1500"/);
});

// ── Issue ───────────────────────────────────────────────────────────────────

test('a plain Admin issuing gets super_admin_required, never a TOTP or step-up demand, and nothing is written', async () => {
  const f = fixture();
  const rep = await prepared(f);
  const before = [f.all('SELECT status FROM fund_report_drafts'), f.one('SELECT COUNT(*) AS n FROM fund_report_draft_events').n, f.one('SELECT status FROM fund_report_periods').status];
  for (const [who, jti] of [[PLAIN_TOTP, 'totp-plain'], [ADMIN, 'pw-plain'], [ADMIN, undefined]] as const) {
    const r = await f.call(who, 'POST', `/fund-reporting/drafts/${rep.uid}/issue`, { figures_sha256: rep.figures_sha256 }, { jti });
    assert.deepEqual([r.status, r.body.code, r.body.detail], [403, 'super_admin_required', 'Super admin required']);
  }
  assert.deepEqual([f.all('SELECT status FROM fund_report_drafts'), f.one('SELECT COUNT(*) AS n FROM fund_report_draft_events').n, f.one('SELECT status FROM fund_report_periods').status], before);
});

test('a Super Admin without a fresh step-up gets step_up_required; the preparer cannot issue; a support session neither prepares nor issues', async () => {
  const f = fixture();
  await built(f);
  writeLetter(f);
  const rep = reportOf(f);
  const support = await f.call(SUPER, 'POST', `/fund-reporting/drafts/${rep.uid}/prepare`, { figures_sha256: rep.figures_sha256 }, { jti: 'totp-super', impersonatedBy: ADMIN });
  assert.deepEqual([support.status, support.body.error], [403, 'support_session']);
  assert.equal((await f.call(SUPER, 'POST', `/fund-reporting/drafts/${rep.uid}/prepare`, { figures_sha256: rep.figures_sha256 }, { jti: 'totp-super' })).status, 200);
  const stale = await f.call(SUPER2, 'POST', `/fund-reporting/drafts/${rep.uid}/issue`, { figures_sha256: rep.figures_sha256 });
  assert.equal(stale.status, 403);
  assert.match(JSON.stringify(stale.body), /TOTP required|step_up_required/);
  const staleSuper = await f.call(SUPER, 'POST', `/fund-reporting/drafts/${rep.uid}/issue`, { figures_sha256: rep.figures_sha256 }, { jti: 'totp-stale' });
  assert.deepEqual([staleSuper.status, staleSuper.body.code], [403, 'step_up_required']);
  const self = await f.call(SUPER, 'POST', `/fund-reporting/drafts/${rep.uid}/issue`, { figures_sha256: rep.figures_sha256 }, { jti: 'totp-super' });
  assert.deepEqual([self.status, self.body.error], [409, 'same_preparer']);
  const supported = await f.call(SUPER2, 'POST', `/fund-reporting/drafts/${rep.uid}/issue`, { figures_sha256: rep.figures_sha256 }, { jti: 'totp-super2', impersonatedBy: ADMIN });
  assert.deepEqual([supported.status, supported.body.error], [403, 'support_session']);
  assert.equal(f.one("SELECT COUNT(*) AS n FROM fund_report_drafts WHERE status = 'issued'").n, 0);
});

test('issuing a pack issues the report, every statement and the period together, with the frozen figures as its snapshot', async () => {
  const f = fixture();
  const rep = await prepared(f);
  const r = await f.call(SUPER2, 'POST', `/fund-reporting/drafts/${rep.uid}/issue`, { figures_sha256: rep.figures_sha256 }, { jti: 'totp-super2' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.issued.length, 3);
  const rows = f.all('SELECT status, issued_by, issued_at FROM fund_report_drafts');
  assert.ok(rows.every((x: any) => x.status === 'issued' && x.issued_by === SUPER2 && x.issued_at === r.body.issued_at));
  const period = f.one('SELECT status, issued_by, issued_at, snapshot_json FROM fund_report_periods');
  assert.deepEqual([period.status, period.issued_by, period.issued_at], ['issued', SUPER2, r.body.issued_at]);
  assert.equal(period.snapshot_json, rep.figures_json);
  assert.equal(f.one("SELECT COUNT(*) AS n FROM fund_report_draft_events WHERE action = 'issued'").n, 3);
  assert.equal(f.one("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'fund_report_period_issued'").n, 1);
});

test('with one statement not prepared, or no GP letter, an issue changes no row', async () => {
  for (const breakIt of ['statement', 'letter'] as const) {
    const f = fixture();
    const rep = await prepared(f);
    if (breakIt === 'statement') {
      f.db.prepare("UPDATE fund_report_drafts SET status = 'draft', prepared_by = NULL, prepared_at = NULL WHERE kind = 'lp_capital_statement' AND limited_partner_id = 102").run();
    } else {
      f.db.prepare("UPDATE fund_report_periods SET notes = json_set(notes, '$.letter', json_array()) WHERE fund_id = 10").run();
      // The same narrative revision, so only the missing letter refuses it.
    }
    const before = f.all('SELECT uid, status FROM fund_report_drafts ORDER BY id');
    const r = await f.call(SUPER2, 'POST', `/fund-reporting/drafts/${rep.uid}/issue`, { figures_sha256: rep.figures_sha256 }, { jti: 'totp-super2' });
    assert.equal(r.status, 409, breakIt);
    assert.equal(r.body.error, breakIt === 'letter' ? 'letter_required' : 'draft_state');
    assert.deepEqual(f.all('SELECT uid, status FROM fund_report_drafts ORDER BY id'), before);
    assert.equal(f.one('SELECT status FROM fund_report_periods').status, 'draft');
    assert.equal(f.one("SELECT COUNT(*) AS n FROM fund_report_draft_events WHERE action = 'issued'").n, 0);
  }
});

test('a stale digest refuses prepare and issue; a letter changed since prepare refuses issue', async () => {
  const f = fixture();
  await built(f);
  writeLetter(f);
  const rep = reportOf(f);
  const wrong = 'f'.repeat(64);
  assert.equal((await f.call(ADMIN, 'POST', `/fund-reporting/drafts/${rep.uid}/prepare`, { figures_sha256: wrong })).body.error, 'content_changed');
  assert.equal((await f.call(ADMIN, 'POST', `/fund-reporting/drafts/${rep.uid}/prepare`, { figures_sha256: rep.figures_sha256 })).status, 200);
  assert.equal((await f.call(SUPER2, 'POST', `/fund-reporting/drafts/${rep.uid}/issue`, { figures_sha256: wrong }, { jti: 'totp-super2' })).body.error, 'content_changed');
  writeLetter(f);
  const moved = await f.call(SUPER2, 'POST', `/fund-reporting/drafts/${rep.uid}/issue`, { figures_sha256: rep.figures_sha256 }, { jti: 'totp-super2' });
  assert.deepEqual([moved.status, moved.body.error], [409, 'content_changed']);
  assert.equal(f.one("SELECT COUNT(*) AS n FROM fund_report_drafts WHERE status = 'issued'").n, 0);
});

test('a rebuild supersedes the pack and starts the next revision as drafts, from a draft or a prepared pack', async () => {
  const f = fixture();
  const rep = await prepared(f);
  const r = await f.call(ADMIN, 'POST', `/fund-reporting/drafts/${rep.uid}/rebuild`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.superseded.length, 3);
  assert.deepEqual(live(f).map((x: any) => [x.status, x.revision]), [['draft', 2], ['draft', 2], ['draft', 2]]);
  assert.equal(f.one("SELECT COUNT(*) AS n FROM fund_report_drafts WHERE status = 'superseded'").n, 3);
  const again = reportOf(f);
  assert.equal((await f.call(ADMIN, 'POST', `/fund-reporting/drafts/${again.uid}/rebuild`)).status, 200);
  for (const k of ['fund:10', 'lp:101', 'lp:102']) {
    assert.equal(f.one("SELECT COUNT(*) AS n FROM fund_report_drafts WHERE subject_key = ? AND status IN ('draft', 'prepared')", k).n, 1, k);
  }
});

test('unmatched transactions need a typed acknowledgement, stored on the issued row with the count', async () => {
  for (const count of [2, 0]) {
    const f = fixture();
    const figures = JSON.stringify({ schema: 'entity_cash_monthly/fixture', unmatched_count: count });
    const sha = await sha256Hex(figures);
    f.db.prepare(`INSERT INTO fund_report_drafts (uid, kind, audience, subject_key, entity_key, period_label, period_start, period_end, status, figures_json, figures_sha256, prepared_by, prepared_at)
      VALUES (?, 'entity_cash_monthly', 'admins', 'entity:gp', 'gp', '2026-09', '2026-09-01', '2026-09-30', 'prepared', ?, ?, ?, '2026-10-03')`).run('c'.repeat(32), figures, sha, ADMIN);
    const issue = (b: Record<string, unknown>) => f.call(SUPER2, 'POST', `/fund-reporting/drafts/${'c'.repeat(32)}/issue`, { figures_sha256: sha, ...b }, { jti: 'totp-super2' });
    if (count === 2) {
      for (const b of [{}, { acknowledgement: '   ' }]) {
        const r = await issue(b);
        assert.deepEqual([r.status, r.body.error], [409, 'acknowledgement_required']);
      }
      assert.deepEqual([(await issue({ acknowledgement: 'x'.repeat(501) })).status], [400]);
      assert.equal(f.one('SELECT status FROM fund_report_drafts').status, 'prepared');
      assert.equal(f.one('SELECT COUNT(*) AS n FROM fund_report_draft_events').n, 0);
      assert.equal((await issue({ acknowledgement: '  Two card refunds, checked against the statement.  ' })).status, 200);
      assert.deepEqual(f.one("SELECT note, unmatched_count FROM fund_report_draft_events WHERE action = 'issued'"),
        { note: 'Two card refunds, checked against the statement.', unmatched_count: 2 });
    } else {
      assert.equal((await issue({ acknowledgement: 'Nothing to say.' })).status, 200);
      assert.deepEqual(f.one("SELECT note, unmatched_count FROM fund_report_draft_events WHERE action = 'issued'"), { note: null, unmatched_count: null });
    }
  }
});

// ── Figures (decisions 8 and 9) ─────────────────────────────────────────────

test('the LPs\' shares sum to the fund figure to the cent; open books make fees and liabilities Not recorded; NAV waits on the Fund\'s bank account', async () => {
  const f = fixture();
  await built(f);
  const st = (lp: number) => JSON.parse(f.one("SELECT figures_json FROM fund_report_drafts WHERE kind = 'lp_capital_statement' AND limited_partner_id = ? AND status IN ('draft', 'prepared')", lp).figures_json);
  const a = st(101), b = st(102);
  assert.equal(a.allocated.investment_value.cents + b.allocated.investment_value.cents, 100001);
  assert.deepEqual([a.allocated.investment_value.cents, b.allocated.investment_value.cents], [33333, 66668], 'the residual cent goes to the larger commitment');
  assert.match(a.allocated.management_fee.reason, /books for Q3 2026 are not closed/);
  assert.match(a.allocated.liabilities.reason, /books for Q3 2026 are not closed/);
  assert.deepEqual(a.nav, { cents: null, reason: 'Not recorded: the Fund has no bank account on record' });
  assert.deepEqual(a.allocated.cash, { cents: null, reason: 'Not recorded: the Fund has no bank account on record' });
  assert.deepEqual([a.commitment.cents, a.called_in_quarter.cents, a.contributed_in_quarter.cents, a.paid_in.cents, a.unfunded.cents, a.distributions_in_quarter.cents],
    [100000, 30000, 30000, 30000, 70000, 5000]);
  assert.equal(a.distributions_basis, 'date recorded when marked paid');
  assert.equal(a.admission.reason, 'Admission date: Not recorded');
  assert.equal(a.roll_forward, null, 'the roll-forward needs both NAVs');
  assert.deepEqual(a.ratios.dpi, { value: 0.1667 });
  assert.equal(a.ratios.tvpi.value, null);
  // LPs outside the pack: no commitment, withdrawn, admitted after the quarter.
  assert.equal(f.one("SELECT COUNT(*) AS n FROM fund_report_drafts WHERE limited_partner_id IN (103, 104, 105)").n, 0);
  const report = JSON.parse(reportOf(f).figures_json);
  assert.equal(report.lp_count, 2);
  assert.deepEqual(report.statements.map((s: any) => s.uid).sort(), f.all("SELECT uid FROM fund_report_drafts WHERE kind = 'lp_capital_statement'").map((x: any) => x.uid).sort());
  assert.doesNotMatch(reportOf(f).figures_json, /Lena|Second LP/, 'the report never names an LP');
  // Receipts that do not tie to the recorded invested amount: neither is picked.
  f.db.exec('UPDATE limited_partners SET invested_amount = 250.00 WHERE id = 101');
  assert.equal((await f.call(ADMIN, 'POST', `/fund-reporting/drafts/${reportOf(f).uid}/rebuild`)).status, 200);
  const untied = st(101);
  assert.deepEqual([untied.paid_in.cents, untied.unfunded.cents], [null, null]);
  assert.match(untied.paid_in.reason, /do not tie/);
  assert.deepEqual(untied.ties, { ties: false, receipts_cents: 30000, recorded_invested_cents: 25000 });
});

test('with the quarter\'s books closed, fees, expenses and liabilities are recorded and split exactly', async () => {
  const f = fixture();
  f.db.exec(`
    INSERT INTO fund_accounting_periods (id, fund_id, label, start_date, end_date, closed, recorded_by) VALUES
      (1, 10, 'Jul-Aug', '2026-07-01', '2026-08-31', 1, ${ADMIN}), (2, 10, 'Sep', '2026-09-01', '2026-09-30', 1, ${ADMIN});
    INSERT INTO fund_ledger_accounts (id, fund_id, code, name, category, recorded_by) VALUES (1, 10, 'PAY', 'Payable', 'liability', ${ADMIN}), (2, 10, 'EXP', 'Expense', 'expense', ${ADMIN});
    INSERT INTO fund_ledger_entries (id, fund_id, period_id, entry_date, description, kind, posted, debit_cents, credit_cents, line_count, recorded_by) VALUES
      (1, 10, 1, '2026-08-15', 'Legal', 'expense', 1, 1001, 1001, 2, ${ADMIN}), (2, 10, 2, '2026-09-30', 'Fee', 'fee_accrual', 1, 5000, 5000, 2, ${ADMIN});
    INSERT INTO fund_ledger_lines (fund_id, entry_id, account_id, debit_cents, credit_cents) VALUES (10, 1, 2, 1001, 0), (10, 1, 1, 0, 1001), (10, 2, 2, 5000, 0), (10, 2, 1, 0, 5000);
  `);
  await built(f);
  const st = (lp: number) => JSON.parse(f.one("SELECT figures_json FROM fund_report_drafts WHERE kind = 'lp_capital_statement' AND limited_partner_id = ?", lp).figures_json).allocated;
  for (const key of ['expenses', 'management_fee', 'liabilities']) {
    const sum = st(101)[key].cents + st(102)[key].cents;
    assert.equal(sum, { expenses: 1001, management_fee: 5000, liabilities: 6001 }[key], key);
  }
  // An open month in the quarter makes them Not recorded again.
  f.db.exec('UPDATE fund_accounting_periods SET closed = 0 WHERE id = 2');
  assert.equal((await f.call(ADMIN, 'POST', `/fund-reporting/drafts/${reportOf(f).uid}/rebuild`)).status, 200);
  assert.equal(JSON.parse(f.one("SELECT figures_json FROM fund_report_drafts WHERE kind = 'lp_capital_statement' AND limited_partner_id = 101 AND status = 'draft'").figures_json).allocated.expenses.cents, null);
});

test('allocate: a missing figure is Not recorded for every LP, zero is zero, and a split always sums exactly', () => {
  const lps = [{ id: 1, commitment_amount: 1 }, { id: 2, commitment_amount: 1 }, { id: 3, commitment_amount: 1 }];
  assert.deepEqual([...allocate({ cents: null, reason: 'r' }, lps).values()].map((l) => l.cents), [null, null, null]);
  assert.deepEqual([...allocate({ cents: 0 }, lps).values()].map((l) => l.cents), [0, 0, 0]);
  const split = [...allocate({ cents: 100 }, lps).values()].map((l) => l.cents as number);
  assert.equal(split.reduce((a, b) => a + b, 0), 100);
  assert.equal([...allocate({ cents: -100 }, lps).values()].reduce((a, l) => a + (l.cents as number), 0), -100);
});

// ── Audited reads ────────────────────────────────────────────────────────────

test('a read writes its viewed row before it answers, and a failed write answers 503 with no figures', async () => {
  const f = fixture();
  await built(f);
  const rep = reportOf(f);
  f.db.exec("CREATE TRIGGER refuse_view BEFORE INSERT ON fund_report_draft_events WHEN NEW.action IN ('viewed', 'exported') BEGIN SELECT RAISE(ABORT, 'fixture'); END;");
  for (const path of [`/fund-reporting/drafts/${rep.uid}`, `/fund-reporting/drafts/${rep.uid}/export`]) {
    const r = await f.call(ADMIN, 'GET', path);
    assert.equal(r.status, 503);
    assert.doesNotMatch(JSON.stringify(r.body), /figures|commitment|sha256/);
  }
  f.db.exec('DROP TRIGGER refuse_view');
  assert.equal((await f.call(ADMIN, 'GET', `/fund-reporting/drafts/${rep.uid}`)).status, 200);
  assert.equal(f.one("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'fund_report_draft_viewed'").n, 1);
});

// ── The schedule (decision 12) ───────────────────────────────────────────────

test('the schedule builds each administered fund once, skips an outside GP\'s fund, and runs at 05:20 UTC on HQ only', async () => {
  const f = fixture();
  const early = await runReportingSchedule(f.env, new Date('2026-10-03T05:20:00Z'));
  assert.equal(early.due, false, 'not due before the 5th day after the quarter');
  const first = await runReportingSchedule(f.env, new Date('2026-10-17T05:20:00Z'));
  assert.deepEqual(first.results.map((r) => [r.fund_id, r.result]), [[10, 'built'], [30, 'no_lps']]);
  const second = await runReportingSchedule(f.env, new Date('2026-10-18T05:20:00Z'));
  assert.deepEqual(second.results.map((r) => r.result), ['exists', 'no_lps']);
  assert.equal(f.one('SELECT COUNT(*) AS n FROM fund_report_drafts WHERE fund_id = 20').n, 0);
  assert.equal(f.one("SELECT COUNT(*) AS n FROM fund_report_draft_events WHERE action = 'built' AND actor IS NULL").n, 3);
  const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.match(index, /if \(hqCadences && now\.getUTCHours\(\) === 5 && now\.getUTCMinutes\(\) === 20\) \{\s*\n\s*try \{\s*\n\s*const \{ runReportingSchedule \}/);
  assert.equal((index.match(/getUTCHours\(\) === 5 && now\.getUTCMinutes\(\) === 20\)/g) || []).length, 1, '05:20 holds one block');
});

test('a period issued outside the queue is never built, and an open quarter is refused', async () => {
  const f = fixture();
  f.db.exec("INSERT INTO fund_report_periods (fund_id, period, period_start, period_end, status, notes) VALUES (10, 'Q3 2026', '2026-07-01', '2026-09-30', 'issued', '{}')");
  const r = await built(f);
  assert.deepEqual(r.results.map((x: any) => x.result), ['issued_outside_queue']);
  const open = await f.call(ADMIN, 'POST', '/fund-reporting/build', { kind: 'lp_quarterly_report', period_label: 'Q4 2026', fund_id: 10 });
  assert.deepEqual([open.status, open.body.error], [409, 'period_open']);
  const outside = await f.call(ADMIN, 'POST', '/fund-reporting/build', { kind: 'lp_quarterly_report', period_label: 'Q3 2026', fund_id: 20 });
  assert.deepEqual([outside.status, outside.body.error], [409, 'not_administered']);
});

// ── The LP's reads and a correction ──────────────────────────────────────────

test('the LP portal returns the caller\'s own issued statements, never another\'s or a draft; the per-LP report shows no draft figures', async () => {
  const f = fixture();
  await built(f);
  let portal = await f.call(LP, 'GET', '/funds/lp-portal');
  assert.equal(portal.status, 200);
  assert.deepEqual([portal.body.capital_statements, portal.body.capital_statements_recorded], [[], true], 'a draft never reaches the LP');
  const rep = await (async () => { writeLetter(f); const r = reportOf(f); await f.call(ADMIN, 'POST', `/fund-reporting/drafts/${r.uid}/prepare`, { figures_sha256: r.figures_sha256 }); return reportOf(f); })();
  const adminView = await f.call(ADMIN, 'GET', '/funds/10/lp-report/101');
  assert.equal(adminView.body.statement_drafts.length, 1);
  assert.doesNotMatch(JSON.stringify(adminView.body.statement_drafts), /figures|sha256/);
  assert.equal((await f.call(SUPER2, 'POST', `/fund-reporting/drafts/${rep.uid}/issue`, { figures_sha256: rep.figures_sha256 }, { jti: 'totp-super2' })).status, 200);
  portal = await f.call(LP, 'GET', '/funds/lp-portal');
  assert.deepEqual(portal.body.capital_statements.map((s: any) => s.limited_partner_id), [101]);
  assert.equal(portal.body.capital_statements[0].figures.lp.id, 101);
  assert.doesNotMatch(JSON.stringify(portal.body.capital_statements), /Second LP/);
  const issuedPeriod = portal.body.report_periods.find((p: any) => p.period === 'Q3 2026');
  assert.equal(issuedPeriod.figures.lp_count, 2);
  assert.equal('statements' in issuedPeriod.figures, false);
});

test('a correction leaves the original issued and names it, with a correcting period', async () => {
  const f = fixture();
  const rep = await prepared(f);
  assert.equal((await f.call(SUPER2, 'POST', `/fund-reporting/drafts/${rep.uid}/issue`, { figures_sha256: rep.figures_sha256 }, { jti: 'totp-super2' })).status, 200);
  const r = await f.call(ADMIN, 'POST', `/fund-reporting/drafts/${rep.uid}/correct`);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.period, 'Q3 2026 · correction 1');
  assert.equal(f.one('SELECT status FROM fund_report_drafts WHERE uid = ?', rep.uid).status, 'issued');
  const fix = reportOf(f);
  assert.equal(fix.corrects_draft_id, rep.id);
  const period = f.one('SELECT period, status, notes FROM fund_report_periods WHERE id = ?', fix.report_period_id);
  assert.deepEqual([period.period, period.status, JSON.parse(period.notes)._receipt.corrects_period_id], ['Q3 2026 · correction 1', 'draft', rep.report_period_id]);
  assert.equal((await f.call(ADMIN, 'POST', `/fund-reporting/drafts/${rep.uid}/correct`)).status, 409, 'one open correction at a time');
});

test('no file this task adds reads a secret or a bank provider', () => {
  const files = ['../src/routes/fund_reporting.ts', '../src/services/fundReportDrafts.ts', '../src/services/fundReportBuild.ts'];
  for (const file of files) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /integrations\/secrets|integrations\/providers\//, file);
  }
  assert.ok(readdirSync(new URL('../sql/migrations/', import.meta.url)).includes('476_fund_report_drafts.sql'));
});
