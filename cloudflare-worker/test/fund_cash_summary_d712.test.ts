/**
 * D712 (#1777) PR 2 — what the reporting queue reads from #1774 and #1775:
 * the monthly cash and reconciliation summary, the Fund's cash, the unmatched
 * counts, the management fee statements and the admission dates.
 *
 * The store is the baseline's tables plus migrations 312, 417, 418, 472, 473,
 * 474 and 476, read from their files. Every account number here is invented;
 * the minimisation case syncs a stub Mercury body through D710's own path.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import reporting from '../src/routes/fund_reporting.ts';
import funds from '../src/routes/funds.ts';
import { runReportingSchedule } from '../src/services/fundReportDrafts.ts';
import { FEE_STATEMENT_FIELDS, feeStatementFigures, quarterPeriod } from '../src/services/fundReportBuild.ts';
import { VOIDED_STATUSES, NO_FUND_ACCOUNT, UNMATCHED_CAP } from '../src/services/fundCashSummary.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import {
  JTI, SUPER as M_SUPER, ADMIN as M_ADMIN, TOKEN, account, appFor, call as mercuryCall, envFor, freshDb, mercuryStub, settled, tokenFor, withRegistry,
} from './_mercury_fixture.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const baseline = read('../sql/schema_baseline.sql');
const mig = (f: string) => read(`../sql/migrations/${f}`);
const TABLES = ['users', 'super_admins', 'user_sessions', 'activity_logs', 'vc_funds', 'limited_partners', 'fund_report_periods',
  'capital_calls', 'fund_distributions', 'portfolio_positions', 'user_company_links', 'admin_audit_log', 'integrations'];
const SCHEMA = TABLES.map((t) => stripForeignKeys(tableFromBaseline(baseline, t))).join('\n')
  + '\nCREATE UNIQUE INDEX idx_fund_report_periods_fund_period ON fund_report_periods(fund_id, period);\n'
  + ['312_fund_call_ledger.sql', '417_fund_position_valuations.sql', '418_fund_ledger.sql', '472_entity_bank_accounts.sql',
    '473_fund_management_fees.sql', '474_mercury_entity_connections.sql', '476_fund_report_drafts.sql', '483_mercury_not_ours.sql'].map(mig).join('\n');

const SECRET = ['d712', 'pr2', 'fixture', 'secret'].join('-');
const ADMIN = 1, SUPER2 = 3, LP_A = 5, LP_B = 6, LP_C = 7;
const FUND_I = 'spinout-fund-i';

function fixture() {
  const { DB, db } = makeD1(SCHEMA);
  const u = db.prepare("INSERT INTO users (id, role, name, email, investor_tier, investor_subscription_status) VALUES (?, ?, ?, ?, 'free', 'active')");
  for (const [id, role, name] of [[ADMIN, 'admin', 'Plain Admin'], [SUPER2, 'admin', 'Super Two'], [LP_A, 'investor', 'Ana LP'],
    [LP_B, 'investor', 'Ben LP'], [LP_C, 'investor', 'Cy LP']] as const) u.run(id, role, name, `user${id}@example.test`);
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER2})`);
  db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, 'totp-super2', 'totp', datetime('now'))").run(SUPER2);
  db.exec(`
    INSERT INTO vc_funds (id, name, slug, gp_user_id, status) VALUES (10, 'Fund I', '${FUND_I}', NULL, 'investing');
    INSERT INTO limited_partners (id, fund_id, user_id, name, commitment_amount, invested_amount, status, created_at) VALUES
      (101, 10, ${LP_A}, 'Ana LP', 1000.00, 0, 'committed', '2026-01-10 09:00:00'),
      (102, 10, ${LP_B}, 'Ben LP', 3000.00, 0, 'committed', '2026-01-10 09:00:00'),
      (103, 10, ${LP_C}, 'Cy LP', 1000.00, 0, 'committed', '2026-01-10 09:00:00');
  `);
  const env = { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  const app = new Hono<any>();
  app.route('/api/fund-reporting', reporting);
  app.route('/api/funds', funds);
  async function call(who: number, method: string, path: string, body?: unknown, jti?: string) {
    const token = await new SignJWT({ user_id: who, ...(jti ? { jti } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt()
      .setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await withThrownResponses(() => app.request(`/api${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env));
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json, text };
  }
  const one = (sql: string, ...a: unknown[]) => ({ ...(db.prepare(sql).get(...a) as any) });
  const all = (sql: string, ...a: unknown[]) => (db.prepare(sql).all(...a) as any[]).map((r) => ({ ...r }));
  let seq = 0;
  const connect = (entity: string) => db.prepare(
    "INSERT INTO mercury_entity_connections (uid, entity_key, status, credentials_enc, connected_by) VALUES (?, ?, 'active', 'v1.fixture-not-ciphertext', ?)",
  ).run(`conn-${entity}`, entity, SUPER2).lastInsertRowid as number;
  const acct = (conn: number, entity: string, kind: string, last4: string, registered = 1) => db.prepare(
    'INSERT INTO mercury_accounts (uid, mercury_account_id, connection_id, entity_key, kind, last_four, nickname, registered) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(`acc-${last4}`, `m-acc-${last4}`, conn, entity, kind, last4, `${kind} ${last4}`, registered).lastInsertRowid as number;
  const snap = (account: number, date: string, cents: number) => db.prepare(
    'INSERT INTO mercury_balance_snapshots (account_id, as_of_date, current_cents) VALUES (?, ?, ?)').run(account, date, cents);
  const txn = (account: number, cents: number, created: string, posted: string | null, status = 'sent', extra: { memo?: string; counterparty?: string; kind?: string } = {}) => {
    seq += 1;
    return db.prepare(
      `INSERT INTO mercury_transactions (uid, mercury_transaction_id, account_id, amount_cents, created_on, posted_on, counterparty_name, memo, status, kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(`txn-${seq}`, `m-txn-${seq}`, account, cents, created, posted, extra.counterparty ?? 'Example Counterparty', extra.memo ?? null, status, extra.kind ?? 'externalTransfer').lastInsertRowid as number;
  };
  const confirmMatch = (txnId: number, cents: number) => db.prepare(
    "INSERT INTO mercury_matches (uid, transaction_id, target_kind, target_id, state, origin, amount_cents) VALUES (?, ?, 'capital_call_line', 1, 'confirmed', 'manual', ?)",
  ).run(`match-${txnId}`, txnId, cents);
  /** An issued #1774 fee period with a line per LP given, as its own flow would leave it. */
  const feePeriod = (quarter: string, lines: Array<[lp: number, cents: number]>, status = 'issued') => {
    const terms = db.prepare(
      `INSERT INTO fund_mgmt_fee_terms (uid, fund_id, fee_start_date, investment_period_end, effective_from, lpa_reference, status, confirmed_at)
       VALUES (?, 10, '2026-01-01', '2030-12-31', '2026-01-01', 'LPA §8.1 (fixture)', 'confirmed', datetime('now'))`,
    ).run(`terms-${quarter}`).lastInsertRowid;
    const net = lines.reduce((s, [, c]) => s + c, 0);
    const q = quarterPeriod(`Q${quarter.slice(5)} ${quarter.slice(0, 4)}`)!;
    const period = db.prepare(
      `INSERT INTO fund_fee_periods (uid, fund_id, quarter, window_start, window_end, terms_id, status, digest, gross_cents, catch_up_cents,
         offset_pool_cents, offset_applied_cents, offset_carried_cents, net_cents, remittance_reference)
       VALUES (?, 10, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)`,
    ).run(`fp-${quarter}`, quarter, q.start, q.end, terms, status, 'a'.repeat(64), net, net, `AXAL-MF-${quarter}-F10`).lastInsertRowid;
    for (const [lp, cents] of lines) {
      db.prepare(
        `INSERT INTO fund_fee_lines (uid, period_id, fund_id, limited_partner_id, commitment_cents, committed_days, invested_days,
           gross_fee_cents, net_fee_cents, reference_code, status)
         VALUES (?, ?, 10, ?, 100000, 92, 0, ?, ?, ?, ?)`,
      ).run(`fl-${quarter}-${lp}`, period, lp, cents, cents, `AXAL-MF-${quarter}-L${lp}`, status);
    }
  };
  return { db, env, call, one, all, connect, acct, snap, txn, confirmMatch, feePeriod };
}
type F = ReturnType<typeof fixture>;

const draftOf = (f: F, kind: string, subject: string) => f.one(
  "SELECT * FROM fund_report_drafts WHERE kind = ? AND subject_key = ? AND status IN ('draft', 'prepared') ORDER BY id DESC LIMIT 1", kind, subject);
const figuresOf = (f: F, kind: string, subject: string) => JSON.parse(draftOf(f, kind, subject).figures_json);
const buildCash = (f: F, entity?: string) => f.call(ADMIN, 'POST', '/fund-reporting/build',
  { kind: 'entity_cash_monthly', period_label: '2026-09', ...(entity ? { entity_key: entity } : {}) });
const nowQuarter = () => { const d = new Date(); return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`; };
const feeCode = (label: string) => `${label.slice(3)}Q${label.slice(1, 2)}`;

/** The GP and the Fund, each with a registered checking account; September's flows on both. */
function seedSeptember(f: F) {
  const gp = f.acct(f.connect('gp'), 'gp', 'checking', '1111');
  const gpSav = f.acct(Number(f.one("SELECT id FROM mercury_entity_connections WHERE entity_key = 'gp'").id), 'gp', 'savings', '2222');
  const fund = f.acct(f.connect('fund'), 'fund', 'checking', '4444');
  f.snap(gp, '2026-08-31', 100_000); f.snap(gp, '2026-09-30', 5_345_000);
  f.snap(gpSav, '2026-08-31', 1_000); f.snap(gpSav, '2026-09-30', 900);
  f.snap(fund, '2026-08-31', 1_027_700); f.snap(fund, '2026-09-30', 777_700);
  // An LP paid the GP's account by mistake: listed in the GP's summary, never booked as Fund cash.
  const stray = f.txn(gp, 5_000_000, '2026-09-10', '2026-09-10', 'sent', { counterparty: 'Ana LP', memo: '=SUM(A1) call 2' });
  // The Fund pays the GP's fee: one intercompany pair, two days apart.
  f.txn(fund, -250_000, '2026-09-12', '2026-09-12', 'sent', { kind: 'internalTransfer' });
  f.txn(gp, 250_000, '2026-09-14', '2026-09-14', 'sent', { kind: 'internalTransfer' });
  f.txn(gp, -5_000, '2026-09-20', '2026-09-20');
  // Pending at month end: one never posted, one posted after; a failed one is not pending.
  f.txn(gp, 700, '2026-09-29', null, 'pending');
  f.txn(gp, 300, '2026-09-30', '2026-10-02');
  f.txn(gp, 999, '2026-09-28', null, 'failed');
  return { gp, gpSav, fund, stray };
}

// ── Minimisation ─────────────────────────────────────────────────────────────

test('an account or routing number in the bank\'s body never reaches a draft, an export or a log line', async () => {
  const digits = '908172631111', routing = '000000017';
  const db = freshDb();
  for (const t of ['fund_report_periods']) db.exec(stripForeignKeys(tableFromBaseline(baseline, t)));
  db.exec(mig('476_fund_report_drafts.sql'));
  withRegistry(db, [['gp', 'checking', '1111']]);
  const stub = mercuryStub({
    accounts: [account('acc-gp-chk', 'checking', '1111')], org: { id: 'org-1', legalBusinessName: 'Axal VC GP LLC' },
    txns: { 'acc-gp-chk': [{ id: 'tx-1', amount: 1500.25, createdAt: '2026-09-03T10:00:00Z', postedAt: '2026-09-04T10:00:00Z', status: 'sent',
      kind: 'incomingDomesticWire', counterpartyName: 'Example LP', externalMemo: 'wire for call 2', accountNumber: digits, routingNumber: routing }] },
  });
  const logs: string[] = [];
  const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  for (const k of ['log', 'info', 'warn', 'error'] as const) (console as any)[k] = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
  try {
    const env = envFor(db);
    const r = await mercuryCall(appFor({ fetcher: stub.fetcher }), env, 'PUT', '/connections/gp', M_SUPER,
      { jti: JTI.superFresh, body: { api_token: TOKEN, confirm_read_only: true } });
    assert.equal(r.status, 200, r.text);
    await settled(db);
    assert.ok((db.prepare('SELECT COUNT(*) AS n FROM mercury_transactions').get() as any).n >= 1, 'the stub line was stored');
    const app = new Hono<any>(); app.route('/api/fund-reporting', reporting);
    const req = async (method: string, path: string, body?: unknown) => withThrownResponses(async () => app.request(`/api${path}`, {
      method, headers: { Authorization: `Bearer ${await tokenFor(M_ADMIN)}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env));
    const built = await (await req('POST', '/fund-reporting/build', { kind: 'entity_cash_monthly', period_label: '2026-09', entity_key: 'gp' })).json() as any;
    assert.equal(built.results[0].result, 'built', JSON.stringify(built));
    const uid = built.results[0].uid;
    const view = await (await req('GET', `/fund-reporting/drafts/${uid}`)).text();
    const csv = await (await req('GET', `/fund-reporting/drafts/${uid}/export`)).text();
    const stored = JSON.stringify(db.prepare('SELECT * FROM fund_report_drafts').all());
    assert.match(view, /Example LP/, 'the line is in the summary');
    for (const out of [view, csv, stored, logs.join('\n')]) {
      assert.ok(!out.includes(digits) && !out.includes(routing) && !out.includes('90817263'), 'no account or routing number');
      assert.doesNotMatch(out, /accountNumber|routingNumber/);
    }
  } finally {
    Object.assign(console, orig);
  }
});

// ── The summary (decision 10) ───────────────────────────────────────────────

test('the summary: balances from the snapshots, posted flows, the tie difference, pending at month end and the intercompany pair', async () => {
  const f = fixture();
  seedSeptember(f);
  const r = await buildCash(f);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body.results.map((x: any) => [x.subject, x.result]), [['entity:fund', 'built'], ['entity:gp', 'built']]);
  const row = draftOf(f, 'entity_cash_monthly', 'entity:gp');
  assert.deepEqual([row.audience, row.entity_key, row.period_label, row.fund_id], ['admins', 'gp', '2026-09', null]);
  const gp = figuresOf(f, 'entity_cash_monthly', 'entity:gp');
  const [chk, sav] = gp.accounts;
  assert.deepEqual([chk.last_four, chk.opening, chk.closing, chk.inflows_cents, chk.outflows_cents], ['1111', { cents: 100_000 }, { cents: 5_345_000 }, 5_250_000, 5_000]);
  assert.deepEqual(chk.tie, { difference_cents: 0, ties: true });
  assert.deepEqual(sav.tie, { difference_cents: 100, ties: false, label: 'Does not tie' });
  assert.deepEqual(gp.pending, { count: 2, sum_cents: 1_000, as_of: '2026-09-30' }, 'never posted, or posted after; a failed line is not pending');
  assert.deepEqual(gp.intercompany.map((p: any) => [p.direction, p.counterpart_entity, p.amount_cents, p.debit.date, p.credit.date]),
    [['in', 'fund', 250_000, '2026-09-12', '2026-09-14']]);
  assert.deepEqual(figuresOf(f, 'entity_cash_monthly', 'entity:fund').intercompany.map((p: any) => p.direction), ['out']);
  // Every posted line is unmatched: D710 matches credits only, and none is confirmed.
  assert.equal(gp.unmatched_count, 3);
  assert.deepEqual(Object.keys(gp.reconciliation.unmatched[0]).sort(),
    ['account_last_four', 'amount_cents', 'counterparty_name', 'date', 'kind', 'memo', 'status', 'transaction']);
});

test('a missing snapshot reads Not recorded with its date, and a voided line with a posted date counts nowhere', async () => {
  const f = fixture();
  const a = f.acct(f.connect('holdings'), 'holdings', 'checking', '7777');
  f.snap(a, '2026-09-30', 10);
  f.txn(a, 4_000, '2026-09-08', '2026-09-08', 'failed');
  await buildCash(f, 'holdings');
  const fig = figuresOf(f, 'entity_cash_monthly', 'entity:holdings');
  const [acct] = fig.accounts;
  assert.deepEqual(acct.opening, { cents: null, reason: 'Not recorded: no balance on record for 2026-08-31' });
  assert.equal(acct.tie.difference_cents, null);
  assert.deepEqual([acct.inflows_cents, fig.reconciliation.posted_count, fig.unmatched_count, fig.pending.count], [0, 0, 0, 0]);
});

test('an unregistered account never pairs as intercompany', async () => {
  const f = fixture();
  const fund = f.acct(f.connect('fund'), 'fund', 'checking', '4444');
  const gpConn = f.connect('gp');
  const stray = f.acct(gpConn, 'gp', 'checking', '3333', 0);
  const gp = f.acct(gpConn, 'gp', 'checking', '1111');
  f.txn(fund, -250_000, '2026-09-12', '2026-09-12');
  f.txn(stray, 250_000, '2026-09-13', '2026-09-13');
  f.txn(gp, 250_000, '2026-09-14', '2026-09-14');
  await buildCash(f, 'gp');
  assert.deepEqual(figuresOf(f, 'entity_cash_monthly', 'entity:gp').intercompany.map((x: any) => x.credit.account_last_four), ['1111']);
});

test('a Fund whose only registered account is savings has no cash on record', async () => {
  const f = fixture();
  const sav = f.acct(f.connect('fund'), 'fund', 'savings', '5555');
  f.snap(sav, '2026-09-30', 9_000);
  await f.call(ADMIN, 'POST', '/fund-reporting/build', { kind: 'lp_quarterly_report', period_label: 'Q3 2026', fund_id: 10 });
  const report = JSON.parse(f.one("SELECT figures_json FROM fund_report_drafts WHERE kind = 'lp_quarterly_report'").figures_json);
  assert.deepEqual(report.fund_figures.cash, { cents: null, reason: NO_FUND_ACCOUNT });
});

test('the unmatched list stops at 500 and counts the rest, and the count, cap included, needs the acknowledgement to issue', async () => {
  const f = fixture();
  const a = f.acct(f.connect('holdings'), 'holdings', 'checking', '7777');
  for (let i = 0; i < UNMATCHED_CAP + 2; i += 1) f.txn(a, 100 + i, '2026-09-05', '2026-09-05');
  const matched = f.txn(a, 50, '2026-09-06', '2026-09-06');
  f.confirmMatch(matched, 50);
  await buildCash(f, 'holdings');
  const fig = figuresOf(f, 'entity_cash_monthly', 'entity:holdings');
  assert.deepEqual([fig.reconciliation.unmatched.length, fig.reconciliation.unmatched_more, fig.unmatched_count], [500, 2, 502]);
  assert.deepEqual(fig.reconciliation.matched_by_kind, { capital_call_line: 1 });
  const row = draftOf(f, 'entity_cash_monthly', 'entity:holdings');
  assert.equal((await f.call(ADMIN, 'POST', `/fund-reporting/drafts/${row.uid}/prepare`, { figures_sha256: row.figures_sha256 })).status, 200);
  const bare = await f.call(SUPER2, 'POST', `/fund-reporting/drafts/${row.uid}/issue`, { figures_sha256: row.figures_sha256 }, 'totp-super2');
  assert.deepEqual([bare.status, bare.body.error], [409, 'acknowledgement_required']);
  assert.equal(f.one('SELECT status FROM fund_report_drafts WHERE uid = ?', row.uid).status, 'prepared');
  const ok = await f.call(SUPER2, 'POST', `/fund-reporting/drafts/${row.uid}/issue`,
    { figures_sha256: row.figures_sha256, acknowledgement: '  Checked the 502 lines against the bank PDF.  ' }, 'totp-super2');
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(f.one("SELECT note, unmatched_count FROM fund_report_draft_events WHERE action = 'issued'"),
    { note: 'Checked the 502 lines against the bank PDF.', unmatched_count: 502 });
});

test('opening or exporting a summary writes its event row, and a memo that starts with = is defused in the CSV', async () => {
  const f = fixture();
  seedSeptember(f);
  await buildCash(f, 'gp');
  const row = draftOf(f, 'entity_cash_monthly', 'entity:gp');
  assert.equal((await f.call(ADMIN, 'GET', `/fund-reporting/drafts/${row.uid}`)).status, 200);
  const csv = await f.call(ADMIN, 'GET', `/fund-reporting/drafts/${row.uid}/export`);
  assert.equal(csv.status, 200);
  assert.match(csv.text, /"'=SUM\(A1\) call 2"/);
  assert.doesNotMatch(csv.text, /(^|,)"=SUM/m);
  assert.deepEqual(f.all('SELECT action FROM fund_report_draft_events WHERE draft_id = ? ORDER BY id', row.id).map((e) => e.action), ['built', 'viewed', 'exported']);
});

test('a personal connection never reaches a summary, and no PR 2 file reads one', async () => {
  const f = fixture();
  seedSeptember(f);
  f.db.prepare(`INSERT INTO integrations (uid, user_id, provider_key, status, auth_type, credentials_enc, config_json)
    VALUES ('int-1', ?, 'mercury', 'active', 'api_key', 'v1.fixture-not-ciphertext', ?)`).run(LP_A, JSON.stringify({ marker: 'Personal Marker Co' }));
  await buildCash(f);
  assert.ok(!f.all('SELECT figures_json FROM fund_report_drafts').some((r) => r.figures_json.includes('Personal Marker')));
  for (const file of ['../src/services/fundCashSummary.ts', '../src/services/fundReportBuild.ts', '../src/services/fundReportDrafts.ts', '../src/routes/fund_reporting.ts']) {
    const src = read(file);
    assert.doesNotMatch(src, /\bintegrations\b(?!\/)/, `${file} queries integrations`);
    assert.doesNotMatch(src, /mercury_personal_matches|integrations\/secrets|integrations\/providers\//, file);
    assert.doesNotMatch(src, /from\s+['"][^'"]*mercury\/store['"]|import\(['"][^'"]*mercury\/store['"]\)/, `${file} imports D710's store`);
  }
});

test('the voided statuses are a copy of services/mercury/store.ts\'s list', () => {
  const store = read('../src/services/mercury/store.ts');
  const listed = /export const VOIDED_STATUSES = (\[[^\]]*\]);/.exec(store)?.[1];
  assert.ok(listed, 'the store still names its voided statuses');
  assert.deepEqual(VOIDED_STATUSES, JSON.parse(listed!.replace(/'/g, '"')));
});

test('a cash summary for an open month is refused, and an entity with no connection is refused', async () => {
  const f = fixture();
  f.connect('gp');
  const d = new Date();
  const open = await f.call(ADMIN, 'POST', '/fund-reporting/build', { kind: 'entity_cash_monthly', period_label: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` });
  assert.deepEqual([open.status, open.body.error], [409, 'period_open']);
  const none = await buildCash(f, 'holdings');
  assert.deepEqual([none.status, none.body.error], [404, 'no_connection']);
  assert.equal(f.one('SELECT COUNT(*) AS n FROM fund_report_drafts').n, 0);
});

test('a cash summary rebuilds as its next revision, and a correction leaves the issued one issued and names it', async () => {
  const f = fixture();
  seedSeptember(f);
  await buildCash(f, 'gp');
  const first = draftOf(f, 'entity_cash_monthly', 'entity:gp');
  const rb = await f.call(ADMIN, 'POST', `/fund-reporting/drafts/${first.uid}/rebuild`);
  assert.equal(rb.status, 200, JSON.stringify(rb.body));
  assert.equal(f.one('SELECT status FROM fund_report_drafts WHERE uid = ?', first.uid).status, 'superseded');
  const second = draftOf(f, 'entity_cash_monthly', 'entity:gp');
  assert.deepEqual([second.revision, second.status], [2, 'draft']);
  await f.call(ADMIN, 'POST', `/fund-reporting/drafts/${second.uid}/prepare`, { figures_sha256: second.figures_sha256 });
  const iss = await f.call(SUPER2, 'POST', `/fund-reporting/drafts/${second.uid}/issue`, { figures_sha256: second.figures_sha256, acknowledgement: 'Checked.' }, 'totp-super2');
  assert.equal(iss.status, 200, JSON.stringify(iss.body));
  const cor = await f.call(ADMIN, 'POST', `/fund-reporting/drafts/${second.uid}/correct`);
  assert.equal(cor.status, 201, JSON.stringify(cor.body));
  const fix = draftOf(f, 'entity_cash_monthly', 'entity:gp');
  assert.deepEqual([fix.revision, fix.corrects_draft_id, fix.status], [3, second.id, 'draft']);
  assert.equal(f.one('SELECT status FROM fund_report_drafts WHERE uid = ?', second.uid).status, 'issued');
});

// ── The Fund's cash and the report's unmatched count (decisions 9 and 3) ────

test('the Fund\'s cash is its registered accounts\' closing balance only; a GP-account fund flow stays out of it', async () => {
  const f = fixture();
  assert.equal((await f.call(ADMIN, 'POST', '/fund-reporting/build', { kind: 'lp_quarterly_report', period_label: 'Q3 2026', fund_id: 10 })).status, 201);
  const before = JSON.parse(f.one("SELECT figures_json FROM fund_report_drafts WHERE kind = 'lp_quarterly_report'").figures_json);
  assert.deepEqual(before.fund_figures.cash, { cents: null, reason: NO_FUND_ACCOUNT }, 'no Fund account yet');
  assert.equal(before.unmatched_count, 0);

  const g = fixture();
  const { fund } = seedSeptember(g);
  const lpPaid = g.txn(fund, 30_000, '2026-08-10', '2026-08-10');
  g.confirmMatch(lpPaid, 30_000);
  g.txn(fund, 12_000, '2026-07-15', '2026-07-15');
  assert.equal((await g.call(ADMIN, 'POST', '/fund-reporting/build', { kind: 'lp_quarterly_report', period_label: 'Q3 2026', fund_id: 10 })).status, 201);
  const report = JSON.parse(g.one("SELECT figures_json FROM fund_report_drafts WHERE kind = 'lp_quarterly_report'").figures_json);
  assert.deepEqual(report.fund_figures.cash, { cents: 777_700 }, "the Fund's account only, not the GP's $50,000");
  // The Fund's posted lines in Q3 with no confirmed match: July's credit and September's debit.
  assert.equal(report.unmatched_count, 2);
  const shares = g.all("SELECT figures_json FROM fund_report_drafts WHERE kind = 'lp_capital_statement'").map((r) => JSON.parse(r.figures_json).allocated.cash.cents);
  assert.equal(shares.reduce((s: number, c: number) => s + c, 0), 777_700, 'the shares sum to the Fund figure');
});

test('a fund that is not Fund I reads no bank data', async () => {
  const f = fixture();
  seedSeptember(f);
  f.db.exec("UPDATE vc_funds SET slug = 'another-fund' WHERE id = 10");
  await f.call(ADMIN, 'POST', '/fund-reporting/build', { kind: 'lp_quarterly_report', period_label: 'Q3 2026', fund_id: 10 });
  const report = JSON.parse(f.one("SELECT figures_json FROM fund_report_drafts WHERE kind = 'lp_quarterly_report'").figures_json);
  assert.deepEqual([report.fund_figures.cash, report.unmatched_count], [{ cents: null, reason: NO_FUND_ACCOUNT }, 0]);
});

// ── Admissions (decision 5's fallback, per LP) ──────────────────────────────

test('an LP admitted after the quarter end is left out; an admission date prints; an LP with none keeps created_at', async () => {
  const f = fixture();
  const admit = f.db.prepare("INSERT INTO fund_lp_admissions (uid, fund_id, limited_partner_id, admitted_on, source) VALUES (?, 10, ?, ?, 'Closing set (fixture)')");
  admit.run('adm-101', 101, '2026-02-01');
  admit.run('adm-103', 103, '2026-10-05');
  assert.equal((await f.call(ADMIN, 'POST', '/fund-reporting/build', { kind: 'lp_quarterly_report', period_label: 'Q3 2026', fund_id: 10 })).status, 201);
  const statements = f.all("SELECT limited_partner_id, figures_json FROM fund_report_drafts WHERE kind = 'lp_capital_statement' ORDER BY limited_partner_id");
  assert.deepEqual(statements.map((s) => s.limited_partner_id), [101, 102], 'Cy LP, admitted 2026-10-05, is not in Q3');
  assert.deepEqual(JSON.parse(statements[0].figures_json).admission, { date: '2026-02-01' });
  assert.deepEqual(JSON.parse(statements[1].figures_json).admission, { date: null, reason: 'Admission date: Not recorded' });
});

// ── Fee statements (#1774) ──────────────────────────────────────────────────

test('a fee statement freezes statementFor\'s named fields only: never a remittance block, a last four or a later field', () => {
  const p = quarterPeriod('Q3 2026')!;
  const statement = {
    quarter: '2026Q3', window: { start: '2026-07-01', end: '2026-09-30', days: 92 }, rate_bps: 200, lpa_reference: 'LPA §8.1', basis: [],
    gross_fee_cents: 500, catch_up_days: 0, catch_up_cents: 0, offset_cents: 0, net_fee_cents: 500, reference_code: 'AXAL-MF-2026Q3-L101',
    funding_call_line: null, status: 'issued', pay_to: { due: false, sentence: 'Nothing is due from you against this statement.' },
    remittance: { reference: 'AXAL-MF-2026Q3-F10', account_last_four: '4444', bank: 'Example Bank' },
  };
  const out = feeStatementFigures({ id: 10, name: 'Fund I' }, { id: 101, name: 'Ana LP' }, p, statement);
  assert.equal('remittance' in out, false);
  assert.doesNotMatch(JSON.stringify(out), /4444|account_last_four|last_four/);
  for (const k of FEE_STATEMENT_FIELDS) assert.ok(k in out, k);
  assert.equal(out.unmatched_count, 0);
});

test('fee statements: one per line of an issued period, built for the quarter in advance, issued to that LP only, and drafts never reach /lp-portal', async () => {
  const f = fixture();
  const q = nowQuarter();
  f.feePeriod(feeCode(q), [[101, 500], [102, 1500], [103, 500]]);
  const r = await f.call(ADMIN, 'POST', '/fund-reporting/build', { kind: 'mgmt_fee_statement', period_label: q, fund_id: 10 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body.results.map((x: any) => x.result), ['built', 'built', 'built'], 'an open quarter builds: the fee is billed in advance');
  const again = await f.call(ADMIN, 'POST', '/fund-reporting/build', { kind: 'mgmt_fee_statement', period_label: q, fund_id: 10 });
  assert.deepEqual(again.body.results, [], 'missing in every status: nothing to build twice');
  const rows = f.all("SELECT * FROM fund_report_drafts WHERE kind = 'mgmt_fee_statement' ORDER BY limited_partner_id");
  assert.deepEqual(rows.map((x) => [x.audience, x.subject_key, x.period_label, x.fund_id]), [101, 102, 103].map((lp) => ['lp', `fee:fl-${feeCode(q)}-${lp}`, q, 10]));
  const fig = JSON.parse(rows[0].figures_json);
  assert.deepEqual(fig.pay_to, { due: false, sentence: 'Nothing is due from you against this statement.' });
  assert.deepEqual([fig.net_fee_cents, fig.reference_code, fig.unmatched_count], [500, `AXAL-MF-${feeCode(q)}-L101`, 0]);
  assert.doesNotMatch(rows.map((x) => x.figures_json).join(), /remittance|last_four/);
  const csv = await f.call(ADMIN, 'GET', `/fund-reporting/drafts/${rows[0].uid}/export`);
  assert.match(csv.text, /"pay_to\.due","false"/);
  assert.doesNotMatch(csv.text, /remittance|last_four/);
  for (const row of rows.slice(0, 2)) {
    await f.call(ADMIN, 'POST', `/fund-reporting/drafts/${row.uid}/prepare`, { figures_sha256: row.figures_sha256 });
    const iss = await f.call(SUPER2, 'POST', `/fund-reporting/drafts/${row.uid}/issue`, { figures_sha256: row.figures_sha256 }, 'totp-super2');
    assert.equal(iss.status, 200, JSON.stringify(iss.body));
  }
  const ana = await f.call(LP_A, 'GET', '/funds/lp-portal');
  assert.equal(ana.status, 200, JSON.stringify(ana.body));
  assert.deepEqual(ana.body.fee_statements.map((s: any) => [s.uid, s.limited_partner_id]), [[rows[0].uid, 101]], "Ana's own, never Ben's");
  assert.deepEqual(ana.body.fee_statements[0].figures.pay_to, { due: false, sentence: 'Nothing is due from you against this statement.' });
  assert.equal(ana.body.fee_statements_recorded, true);
  const cy = await f.call(LP_C, 'GET', '/funds/lp-portal');
  assert.deepEqual(cy.body.fee_statements, [], "Cy's statement is a draft");
  assert.deepEqual(cy.body.capital_statements, [], 'a fee statement is not a capital statement');
});

test('a draft fee period builds no statement and sets no fee in the pack', async () => {
  const f = fixture();
  f.feePeriod('2026Q3', [[101, 500]], 'draft');
  const r = await f.call(ADMIN, 'POST', '/fund-reporting/build', { kind: 'mgmt_fee_statement', period_label: 'Q3 2026' });
  assert.deepEqual([r.status, r.body.results], [201, []]);
  await f.call(ADMIN, 'POST', '/fund-reporting/build', { kind: 'lp_quarterly_report', period_label: 'Q3 2026', fund_id: 10 });
  const report = JSON.parse(f.one("SELECT figures_json FROM fund_report_drafts WHERE kind = 'lp_quarterly_report'").figures_json);
  assert.match(report.fund_figures.management_fee.reason, /books for Q3 2026 are not closed/, "D628's rule, not the draft's fee");
});

test('with an issued fee period, the pack\'s fee is each LP\'s net fee line and the period\'s net; an LP with no line reads Not recorded', async () => {
  const f = fixture();
  f.feePeriod('2026Q3', [[101, 500], [102, 1500]]);
  assert.equal((await f.call(ADMIN, 'POST', '/fund-reporting/build', { kind: 'lp_quarterly_report', period_label: 'Q3 2026', fund_id: 10 })).status, 201);
  const fee = (lp: number) => JSON.parse(f.one("SELECT figures_json FROM fund_report_drafts WHERE kind = 'lp_capital_statement' AND limited_partner_id = ?", lp).figures_json).allocated.management_fee;
  assert.deepEqual([fee(101), fee(102)], [{ cents: 500 }, { cents: 1500 }], 'books open, fee recorded: billed in advance');
  assert.deepEqual(fee(103), { cents: null, reason: 'Not recorded: no management fee line for this LP in Q3 2026' });
  const report = JSON.parse(f.one("SELECT figures_json FROM fund_report_drafts WHERE kind = 'lp_quarterly_report'").figures_json);
  assert.deepEqual(report.fund_figures.management_fee, { cents: 2000 });
  assert.match(report.fund_figures.expenses.reason, /books for Q3 2026 are not closed/, 'expenses keep D628');
});

// ── The schedule ────────────────────────────────────────────────────────────

test('the schedule builds last month\'s summaries from the 3rd and any missing fee statement, before a pack is due, and nothing twice', async () => {
  const f = fixture();
  seedSeptember(f);
  f.feePeriod('2026Q4', [[101, 500]]);
  const second = await runReportingSchedule(f.env, new Date('2026-10-02T05:20:00Z'));
  assert.deepEqual([second.due, second.built.cash_summaries.length, second.built.fee_statements.map((x: any) => x.result)], [false, 0, ['built']]);
  const third = await runReportingSchedule(f.env, new Date('2026-10-03T05:20:00Z'));
  assert.deepEqual([third.due, third.quarter, third.results], [false, 'Q3 2026', []], "PR 1's fields stay as index.ts logs them");
  assert.deepEqual(third.built.cash_summaries.map((x: any) => [x.subject, x.period, x.result]),
    [['entity:fund', '2026-09', 'built'], ['entity:gp', '2026-09', 'built']]);
  const again = await runReportingSchedule(f.env, new Date('2026-10-04T05:20:00Z'));
  assert.deepEqual(again.built.cash_summaries.map((x: any) => x.result), ['exists', 'exists']);
  assert.deepEqual(again.built.fee_statements, []);
  assert.equal(f.one("SELECT COUNT(*) AS n FROM fund_report_drafts WHERE built_by IS NULL").n, 3);
});

// ── D749 (#1838): a credit marked Not ours ──────────────────────────────────

const markNotOurs = (f: F, txnId: number, reason: string, state: 'active' | 'needs_review' | 'withdrawn' = 'active') => f.db.prepare(
  `INSERT INTO mercury_not_ours (uid, transaction_id, reason, amount_cents, marked_by, state, withdrawn_at, withdraw_reason)
   SELECT ?, id, ?, amount_cents, ?, ?, ?, ? FROM mercury_transactions WHERE id = ?`,
).run(`mark-${txnId}-${state}`, reason, ADMIN, state, state === 'withdrawn' ? '2026-10-01 00:00:00' : null,
  state === 'withdrawn' ? 'It was ours after all' : null, txnId);

test('D749: an active Not ours mark leaves unmatched and is counted by reason; a needs_review mark stays unmatched', async () => {
  const f = fixture();
  const { stray } = seedSeptember(f);
  markNotOurs(f, stray, 'other_entity');
  assert.equal((await buildCash(f, 'gp')).status, 201);
  const gp = figuresOf(f, 'entity_cash_monthly', 'entity:gp');
  assert.equal(gp.unmatched_count, 2, 'three before the mark');
  assert.ok(!gp.reconciliation.unmatched.some((l: any) => l.amount_cents === 5_000_000), 'the marked credit is not listed');
  assert.deepEqual([gp.reconciliation.not_ours_count, gp.reconciliation.not_ours_by_reason], [1, { other_entity: 1 }]);
  assert.equal(gp.schema, 'entity_cash_monthly/1', 'the schema label stays');

  const g = fixture();
  const s = seedSeptember(g);
  markNotOurs(g, s.stray, 'other_entity', 'needs_review');
  assert.equal((await buildCash(g, 'gp')).status, 201);
  const review = figuresOf(g, 'entity_cash_monthly', 'entity:gp');
  assert.deepEqual([review.unmatched_count, review.reconciliation.not_ours_count, review.reconciliation.not_ours_by_reason], [3, 0, {}]);
});

test('D749: the quarterly report\'s unmatched count drops by one per active mark, and a withdrawn mark counts again', async () => {
  const report = async (f: F) => {
    assert.equal((await f.call(ADMIN, 'POST', '/fund-reporting/build', { kind: 'lp_quarterly_report', period_label: 'Q3 2026', fund_id: 10 })).status, 201);
    return JSON.parse(f.one("SELECT figures_json FROM fund_report_drafts WHERE kind = 'lp_quarterly_report'").figures_json).unmatched_count;
  };
  const f = fixture();
  const { fund } = seedSeptember(f);
  markNotOurs(f, f.txn(fund, 12_000, '2026-07-15', '2026-07-15'), 'duplicate');
  assert.equal(await report(f), 1, "September's debit only");
  const g = fixture();
  const s = seedSeptember(g);
  markNotOurs(g, g.txn(s.fund, 12_000, '2026-07-15', '2026-07-15'), 'duplicate', 'withdrawn');
  assert.equal(await report(g), 2);
});
