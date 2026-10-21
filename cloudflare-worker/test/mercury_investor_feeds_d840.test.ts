/**
 * D840 part 4 (#2349) — the investor's sections, fed from the investor's own
 * Mercury, read-only, against part 1's fake MCP server (`_mercury_mcp_fake.mjs`).
 *
 * Each row of the issue's table is driven here:
 *   - no investor balance reaches another person (founder, admin, another investor);
 *   - a proposal writes nothing until Accept;
 *   - a deleted fact and a dismissed proposal stay so across a sync;
 *   - the page lists exactly what is built.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/mercury_investor_feeds_d840.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Hono } from 'hono';
import { tableFromBaseline } from './_baseline.mjs';
import { signedInFake, FAKE_ACC_A, FAKE_ACC_B, FAKE_READ_TOOLS, fakeTx } from './_mercury_mcp_fake.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { openMercuryReads } from '../src/services/mercury/reads.ts';
import { createMercuryInvestor, openOwnInvestorMercuryWith, type OpenInvestorMercury } from '../src/routes/mercury_investor.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { callLineFits } from '../src/services/mercury/match.ts';
import { MERCURY_FEEDS, PORTFOLIO_NOTE } from '../src/integrations/mercuryFeeds.ts';
import { ADMIN, FOUNDER, INVESTOR, FUND_ADMIN, envFor, freshDb, one, rows, tokenFor } from './_mercury_fixture.ts';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const migration = (f: string) => read(`cloudflare-worker/sql/migrations/${f}`);
const noFks = (sql: string) => sql.replace(/\s+REFERENCES\s+"?\w+"?\s*\([^)]*\)(\s+ON\s+(DELETE|UPDATE)\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION))*/gi, '');

const OTHER_INVESTOR = FUND_ADMIN; // an investor too; never the owner below
const INTEGRATION = 70;
const FUND = 11;
const TODAY = '2026-10-15';

function seed() {
  const db = freshDb();
  for (const t of ['commitments', 'deals', 'integrations', 'integration_logs', 'fund_report_periods']) db.exec(noFks(tableFromBaseline(BASELINE, t)));
  db.exec(noFks(tableFromBaseline(BASELINE, 'projects')));
  db.exec(migration('445_connector_fed_items.sql'));
  db.exec(migration('418_fund_ledger.sql'));
  db.exec(noFks(migration('522_mercury_investor_feeds.sql')));
  db.exec(`UPDATE users SET investor_tier = 'institutional', investor_subscription_status = 'active' WHERE id IN (${INVESTOR}, ${OTHER_INVESTOR})`);
  db.exec(`INSERT INTO integrations (id, uid, user_id, provider_key, status, auth_type) VALUES (${INTEGRATION}, 'int-own', ${INVESTOR}, 'mercury', 'active', 'oauth2')`);
  // A deal of a founder's project, with the investor's pending $25,000 commitment.
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (5, 'Fixture Venture', ${FOUNDER})`);
  db.exec(`INSERT INTO deals (id, project_id, status) VALUES (7, 5, 'active')`);
  db.exec(`INSERT INTO commitments (id, deal_id, investor_user_id, amount, status, created_at) VALUES (21, 7, ${INVESTOR}, 25000, 'pending', '2026-09-01 10:00:00')`);
  // A fund the investor is GP of and administers, with two LP lines owing $1,000 each.
  db.exec(`INSERT INTO vc_funds (id, name, slug, gp_user_id, fund_admin_user_id) VALUES (${FUND}, 'Own Fund', 'own-fund', ${INVESTOR}, ${INVESTOR}), (12, 'Other Fund', 'other-fund', ${OTHER_INVESTOR}, ${OTHER_INVESTOR})`);
  db.exec(`INSERT INTO limited_partners (id, user_id, fund_id, status, name) VALUES (31, NULL, ${FUND}, 'active', 'Alpha Holdings'), (32, NULL, ${FUND}, 'active', 'Beta Trust')`);
  db.exec(`INSERT INTO fund_capital_calls (id, uid, fund_id, call_number, amount_cents, due_date, line_count, created_at)
           VALUES (1, 'fc1', ${FUND}, 1, 200000, '2026-10-01', 2, '2026-09-01 00:00:00')`);
  db.exec(`INSERT INTO capital_calls (id, uid, limited_partner_id, amount, amount_cents, status, due_date, fund_call_id, created_at) VALUES
    (41, 'l41', 31, 1000, 100000, 'pending', '2026-10-01', 1, '2026-09-01 00:00:00'),
    (42, 'l42', 32, 1000, 100000, 'pending', '2026-10-01', 1, '2026-09-01 00:00:00')`);
  db.exec(`INSERT INTO fund_ledger_accounts (id, fund_id, code, name, category, recorded_by) VALUES
    (51, ${FUND}, '1000', 'Cash', 'asset', ${INVESTOR}), (52, ${FUND}, '6000', 'Software', 'expense', ${INVESTOR}), (53, 12, '1000', 'Cash', 'asset', ${OTHER_INVESTOR})`);
  db.exec(`INSERT INTO fund_accounting_periods (id, fund_id, label, start_date, end_date, recorded_by) VALUES (61, ${FUND}, 'Q3 2026', '2026-07-01', '2026-12-31', ${INVESTOR})`);
  db.exec(`INSERT INTO fund_report_periods (id, fund_id, period, period_start, period_end) VALUES (71, ${FUND}, '2026-Q3', '2026-07-01', '2026-09-30')`);
  return db;
}

/** Mercury's lines for these tests: invented ids, names and amounts. */
function lines() {
  return [
    // A $25,000 wire out: it funds commitment 21.
    { id: fakeTx(1), accountId: FAKE_ACC_A, amount: -25000, createdAt: '2026-09-05T00:00:00Z', postedAt: '2026-09-05T00:00:00Z', status: 'sent', kind: 'outgoingPayment', counterpartyName: 'Fixture Venture Inc', mercuryCategory: 'Investments' },
    // A $26,000 wire out the same week: not the commitment's amount, so it funds nothing.
    { id: fakeTx(7), accountId: FAKE_ACC_A, amount: -26000, createdAt: '2026-09-06T00:00:00Z', postedAt: '2026-09-06T00:00:00Z', status: 'sent', kind: 'outgoingPayment', counterpartyName: 'Elsewhere LLC', mercuryCategory: 'Investments' },
    // Two $1,000 credits, each fitting both open lines by amount and date: Beta's is Beta's by name; the other names no LP and is not proposed.
    { id: fakeTx(2), accountId: FAKE_ACC_A, amount: 1000, createdAt: '2026-09-10T00:00:00Z', postedAt: '2026-09-10T00:00:00Z', status: 'sent', kind: 'incomingDomesticWire', counterpartyName: 'BETA TRUST', mercuryCategory: null },
    { id: fakeTx(3), accountId: FAKE_ACC_B, amount: 1000, createdAt: '2026-09-11T00:00:00Z', postedAt: '2026-09-11T00:00:00Z', status: 'sent', kind: 'incomingDomesticWire', counterpartyName: 'Someone Else', mercuryCategory: null },
    // Card spending, categorised.
    { id: fakeTx(4), accountId: FAKE_ACC_A, amount: -120.5, createdAt: '2026-09-12T00:00:00Z', postedAt: '2026-09-12T00:00:00Z', status: 'sent', kind: 'debitCardTransaction', counterpartyName: 'Tool Co', mercuryCategory: 'Software' },
    // A move between the investor's own accounts: never anything.
    { id: fakeTx(5), accountId: FAKE_ACC_A, amount: -500, createdAt: '2026-09-13T00:00:00Z', postedAt: '2026-09-13T00:00:00Z', status: 'sent', kind: 'internalTransfer', counterpartyName: 'Own', mercuryCategory: null },
  ];
}

function harness(real = false) {
  const db = seed();
  const { fake, accessToken } = signedInFake();
  fake.state.data.transactions = lines();
  const opened: number[] = [];
  const realOpen = openOwnInvestorMercuryWith(fake.fetch as any);
  const open: OpenInvestorMercury = async (c, user) => {
    opened.push(Number(user.id));
    if (real) return realOpen(c, user);
    const reads = await openMercuryReads({ accessToken, fetcher: fake.fetch as any });
    return { integrationId: INTEGRATION, reader: reads };
  };
  const app = new Hono<any>();
  app.route('/api/mercury/investor', createMercuryInvestor({ open, today: () => TODAY }));
  app.onError((err: any, c) => {
    if (err instanceof Response) return err;
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
    if (s) return c.json({ detail: err.message }, s);
    throw err;
  });
  // The private FILES bucket, in memory.
  const files = new Map<string, Uint8Array>();
  const FILES = {
    put: async (k: string, v: Uint8Array) => { files.set(k, new Uint8Array(v)); },
    get: async (k: string) => (files.has(k) ? { body: files.get(k) } : null),
    delete: async (k: string) => { files.delete(k); },
  };
  const env = envFor(db, { FILES });
  async function call(method: string, path: string, as: number, opts: { body?: unknown; impersonated?: boolean; env?: any } = {}) {
    const res = await app.request(`/api/mercury/investor${path}`, {
      method,
      headers: { Authorization: `Bearer ${await tokenFor(as, { impersonated: opts.impersonated })}`, 'Content-Type': 'application/json' },
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    }, opts.env ?? env);
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body, text, type: res.headers.get('Content-Type') };
  }
  return { db, fake, call, opened, env, accessToken, files };
}

const ledger = (db: any, ext: string) => one(db, 'SELECT module, kind, local_table, local_id FROM connector_fed_items WHERE integration_id = ? AND external_id = ?', INTEGRATION, ext);

// ─────────────────────────────────────────────────────────── who

test('only the investor, on HQ, outside a support session: founder, admin, branch and support are refused before Mercury is read', async () => {
  const h = harness();
  for (const as of [FOUNDER, ADMIN]) {
    for (const [m, p] of [['GET', '/commit'], ['POST', '/sync'], ['GET', '/proposals?kind=closing'], ['GET', `/reporting?fund_id=${FUND}`]] as const) {
      const r = await h.call(m, p, as, { body: m === 'POST' ? { section: 'closing' } : undefined });
      assert.equal(r.status, 403, `${as} ${m} ${p}`);
      assert.equal(r.body.error, 'purpose_not_allowed');
    }
  }
  const support = await h.call('GET', '/commit', INVESTOR, { impersonated: true });
  assert.equal(support.status, 403);
  assert.equal(support.body.error, 'support_session_refused');
  const branch = await h.call('GET', '/commit', INVESTOR, { env: { ...h.env, BRANCH_CODE: 'lon' } });
  assert.equal(branch.status, 403);
  assert.equal(branch.body.error, 'hq_only');
  assert.deepEqual(h.opened, [], 'no refused caller opened a Mercury session');
});

test('the Fund sections need the institutional tier, as the Fund bucket does', async () => {
  const h = harness();
  h.db.exec(`UPDATE users SET investor_tier = 'free' WHERE id = ${INVESTOR}`);
  const r = await h.call('POST', '/sync', INVESTOR, { body: { section: 'calls', fund_id: FUND } });
  assert.equal(r.status, 402);
  assert.deepEqual(h.opened, []);
});

// ─────────────────────────────────────────────────────────── Deals · Commit (fact)

test('Commit: capacity is the available cash of the picked accounts, kept by last four, shown to the investor alone', async () => {
  const h = harness();
  const w = await h.call('POST', '/commit', INVESTOR, { body: { account_ids: [FAKE_ACC_A, FAKE_ACC_B] } });
  assert.equal(w.status, 200, w.text);
  // The fake's available balances: $1,100 and $5,000.
  assert.deepEqual(w.body.capacity, { ...w.body.capacity, available_cents: 610000, account_last_fours: ['1357', '4242'], as_of: TODAY });
  assert.equal(ledger(h.db, `capacity:${INVESTOR}`).module, 'deals_commit');
  assert.ok(!JSON.stringify(rows(h.db, 'SELECT * FROM mercury_investor_capacity')).includes(FAKE_ACC_A), 'no account id is stored');

  // Another investor reads their own (none); a founder and an admin are refused.
  assert.deepEqual((await h.call('GET', '/commit', OTHER_INVESTOR)).body, { capacity: null });
  for (const as of [FOUNDER, ADMIN]) {
    const r = await h.call('GET', '/commit', as);
    assert.equal(r.status, 403);
    assert.ok(!r.text.includes('610000'));
  }
});

test('Commit: a balance Mercury did not give fails closed and writes nothing', async () => {
  const h = harness();
  h.fake.state.data.accounts[1].availableBalance = null;
  const r = await h.call('POST', '/commit', INVESTOR, { body: { account_ids: [FAKE_ACC_A, FAKE_ACC_B] } });
  assert.equal(r.status, 502);
  assert.equal(r.body.error, 'balance_unreadable');
  assert.equal(rows(h.db, 'SELECT * FROM mercury_investor_capacity').length, 0);
});

test('Commit: a deleted capacity stays deleted across a sync; a sync refreshes a live one', async () => {
  const h = harness();
  await h.call('POST', '/commit', INVESTOR, { body: { account_ids: [FAKE_ACC_A] } });
  h.fake.state.data.accounts[0].availableBalance = 2000;
  assert.equal((await h.call('POST', '/sync', INVESTOR, { body: { section: 'commit' } })).body.written, 1);
  assert.equal(one(h.db, 'SELECT available_cents FROM mercury_investor_capacity').available_cents, 200000);
  assert.equal((await h.call('DELETE', '/commit', INVESTOR)).body.deleted, true);
  const opened = h.opened.length;
  assert.equal((await h.call('POST', '/sync', INVESTOR, { body: { section: 'commit' } })).body.written, 0);
  assert.equal(h.opened.length, opened, 'a sync after Delete reads nothing');
  assert.equal(rows(h.db, 'SELECT * FROM mercury_investor_capacity').length, 0);
  assert.equal(ledger(h.db, `capacity:${INVESTOR}`).local_id, null);
});

test('Commit: no other source file reads the investor tables, so no founder, admin or LP route can return a capacity or month-end cash', () => {
  const src = resolve(process.cwd(), 'cloudflare-worker/src');
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.ts$/.test(f)) files.push(p); } };
  walk(src);
  const readers = files.filter((f) => /mercury_investor_capacity|fund_month_end_cash|mercury_investor_proposals|mercury_investor_category_map/.test(readFileSync(f, 'utf8')))
    .map((f) => f.slice(src.length + 1)).sort();
  assert.deepEqual(readers, ['services/mercury/investorFeeds.ts']);
});

// ─────────────────────────────────────────────────────────── Deals · Closing (proposal)

test('Closing: the wire is proposed against the commitment; nothing is recorded until Accept, which cites the transaction', async () => {
  const h = harness();
  const s = await h.call('POST', '/sync', INVESTOR, { body: { section: 'closing', from: '2026-08-01', to: TODAY } });
  assert.equal(s.status, 200, s.text);
  assert.equal(s.body.proposed, 1);
  const [p] = (await h.call('GET', '/proposals?kind=closing', INVESTOR)).body.proposals;
  assert.deepEqual({ target_id: p.target_id, amount_cents: p.amount_cents, posted_on: p.posted_on, last: p.account_last_four, state: p.state },
    { target_id: 21, amount_cents: 2500000, posted_on: '2026-09-05', last: '4242', state: 'proposed' });
  assert.equal(one(h.db, 'SELECT status FROM commitments WHERE id = 21').status, 'pending', 'a proposal changes nothing');

  // Another investor cannot see or accept it.
  assert.deepEqual((await h.call('GET', '/proposals?kind=closing', OTHER_INVESTOR)).body.proposals, []);
  assert.equal((await h.call('POST', `/proposals/${p.uid}/accept`, OTHER_INVESTOR)).status, 404);

  const a = await h.call('POST', `/proposals/${p.uid}/accept`, INVESTOR);
  assert.equal(a.status, 200, a.text);
  assert.equal(a.body.result_ref, `mercury:${fakeTx(1)}`);
  assert.equal(one(h.db, 'SELECT state FROM mercury_investor_proposals WHERE uid = ?', p.uid).state, 'accepted');
  assert.equal((await h.call('POST', `/proposals/${p.uid}/accept`, INVESTOR)).status, 409);
});

test('Closing: a dismissed proposal stays dismissed across a sync', async () => {
  const h = harness();
  await h.call('POST', '/sync', INVESTOR, { body: { section: 'closing', from: '2026-08-01', to: TODAY } });
  const [p] = (await h.call('GET', '/proposals?kind=closing', INVESTOR)).body.proposals;
  assert.equal((await h.call('POST', `/proposals/${p.uid}/dismiss`, INVESTOR)).status, 200);
  const again = await h.call('POST', '/sync', INVESTOR, { body: { section: 'closing', from: '2026-08-01', to: TODAY } });
  assert.equal(again.body.proposed, 0);
  assert.deepEqual((await h.call('GET', '/proposals?kind=closing', INVESTOR)).body.proposals, []);
  assert.equal(ledger(h.db, `closing:${fakeTx(1)}`).local_id, null);
  // The ledger alone keeps it away, even with the proposal row gone.
  h.db.exec('DELETE FROM mercury_investor_proposals');
  assert.equal((await h.call('POST', '/sync', INVESTOR, { body: { section: 'closing', from: '2026-08-01', to: TODAY } })).body.proposed, 0);
});

// ─────────────────────────────────────────────────────────── Fund · Calls (proposal)

test('Calls: D710\'s rule, then the payer: Beta\'s credit is proposed for Beta\'s line, not the first that fits; the unnamed one is not proposed', async () => {
  const h = harness();
  const s = await h.call('POST', '/sync', INVESTOR, { body: { section: 'calls', fund_id: FUND, from: '2026-08-01', to: TODAY } });
  assert.equal(s.status, 200, s.text);
  const props = (await h.call('GET', `/proposals?kind=call&fund_id=${FUND}`, INVESTOR)).body.proposals;
  assert.deepEqual(props.map((p: any) => [p.target_id, p.amount_cents]), [[42, 100000]]);
  assert.equal(rows(h.db, 'SELECT * FROM capital_call_receipts').length, 0, 'a proposal records no receipt');

  const a = await h.call('POST', `/proposals/${props[0].uid}/accept`, INVESTOR);
  assert.equal(a.status, 200, a.text);
  const receipt = one(h.db, 'SELECT capital_call_id, amount_cents, received_on, reference, recorded_by FROM capital_call_receipts');
  assert.deepEqual({ ...receipt }, { capital_call_id: 42, amount_cents: 100000, received_on: '2026-09-10', reference: `mercury:${fakeTx(2)}`, recorded_by: INVESTOR });
});

test('Calls: another GP\'s fund is refused before Mercury is read', async () => {
  const h = harness();
  const r = await h.call('POST', '/sync', INVESTOR, { body: { section: 'calls', fund_id: 12 } });
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'fund_not_found');
  assert.deepEqual(h.opened, []);
});

test('Calls: the entity matcher\'s rule is the one reused, unchanged', () => {
  const line = { id: 1, outstanding_cents: 100000, from: '2026-09-01', to: '2026-12-30' };
  assert.equal(callLineFits(line, { amount_cents: 100000, posted_on: '2026-09-01' }), true);
  assert.equal(callLineFits(line, { amount_cents: 100000, posted_on: '2026-12-30' }), true);
  assert.equal(callLineFits(line, { amount_cents: 100001, posted_on: '2026-09-10' }), false);
  assert.equal(callLineFits(line, { amount_cents: 100000, posted_on: '2026-08-31' }), false);
  assert.equal(callLineFits(line, { amount_cents: 100000, posted_on: '2026-12-31' }), false);
});

// ─────────────────────────────────────────────────────────── Fund · Accounting (proposal)

test('Accounting: one proposal per line; Accept asks once for the category\'s accounts, posts a balanced entry, and reuses the mapping', async () => {
  const h = harness();
  const s = await h.call('POST', '/sync', INVESTOR, { body: { section: 'ledger', fund_id: FUND, from: '2026-08-01', to: TODAY } });
  assert.equal(s.status, 200, s.text);
  const props = (await h.call('GET', `/proposals?kind=ledger&fund_id=${FUND}`, INVESTOR)).body.proposals;
  assert.equal(props.length, 5, 'the internal transfer is not a ledger line');
  assert.equal(rows(h.db, 'SELECT * FROM fund_ledger_entries').length, 0, 'a proposal posts nothing');

  const card = props.find((p: any) => p.category === 'Software');
  const unmapped = await h.call('POST', `/proposals/${card.uid}/accept`, INVESTOR, { body: { period_id: 61 } });
  assert.equal(unmapped.status, 400);
  assert.equal(unmapped.body.error, 'category_unmapped');
  const foreign = await h.call('POST', `/proposals/${card.uid}/accept`, INVESTOR, { body: { period_id: 61, ledger_account_id: 52, cash_account_id: 53 } });
  assert.equal(foreign.body.error, 'invalid_accounts');
  const ok = await h.call('POST', `/proposals/${card.uid}/accept`, INVESTOR, { body: { period_id: 61, ledger_account_id: 52, cash_account_id: 51 } });
  assert.equal(ok.status, 200, ok.text);
  const lines = rows(h.db, 'SELECT account_id, debit_cents, credit_cents FROM fund_ledger_lines ORDER BY id').map((r) => ({ ...r }));
  assert.deepEqual(lines, [{ account_id: 52, debit_cents: 12050, credit_cents: 0 }, { account_id: 51, debit_cents: 0, credit_cents: 12050 }]);
  const map = (await h.call('GET', `/ledger/map?fund_id=${FUND}`, INVESTOR)).body;
  assert.deepEqual(map.map, [{ category: 'Software', ledger_account_id: 52, cash_account_id: 51 }]);
  assert.deepEqual(map.accounts.map((a: any) => a.id), [51, 52], 'only this fund\'s accounts');
  assert.deepEqual(map.periods.map((p: any) => p.id), [61]);
  // The mapping is reused: another Software line posts with no accounts given.
  h.fake.state.data.transactions.push({ id: fakeTx(6), accountId: FAKE_ACC_A, amount: -30, createdAt: '2026-09-20T00:00:00Z', postedAt: '2026-09-20T00:00:00Z', status: 'sent', kind: 'debitCardTransaction', counterpartyName: 'Tool Co', mercuryCategory: 'Software' });
  await h.call('POST', '/sync', INVESTOR, { body: { section: 'ledger', fund_id: FUND, from: '2026-08-01', to: TODAY } });
  const next = (await h.call('GET', `/proposals?kind=ledger&fund_id=${FUND}`, INVESTOR)).body.proposals.find((p: any) => p.amount_cents === -3000);
  assert.equal((await h.call('POST', `/proposals/${next.uid}/accept`, INVESTOR, { body: { period_id: 61 } })).status, 200);
  assert.equal(rows(h.db, 'SELECT * FROM fund_ledger_entries').length, 2);
  assert.equal((await h.call('GET', `/ledger/map?fund_id=12`, INVESTOR)).status, 404);
});

// ─────────────────────────────────────────────────────────── Fund · Reporting (fact and proposal)

test('Reporting: month-end cash is a fact; the statement is attached only on Accept; a deleted month stays deleted', async () => {
  const h = harness();
  const s = await h.call('POST', '/sync', INVESTOR, { body: { section: 'reporting', fund_id: FUND, from: '2026-08-01', to: TODAY } });
  assert.equal(s.status, 200, s.text);
  const rep = (await h.call('GET', `/reporting?fund_id=${FUND}`, INVESTOR)).body;
  // The fake gives each account the same September statement, ending at $1,200.50.
  assert.deepEqual(rep.month_end_cash.map((m: any) => [m.month, m.cash_cents, m.account_last_fours]), [['2026-09', 240100, ['1357', '4242']]]);
  assert.equal(rep.statements.length, 1, 'one statement id, one report period');
  assert.equal(rep.statements[0].state, 'proposed');

  assert.equal((await h.call('GET', `/reporting?fund_id=12`, INVESTOR)).status, 404);
  assert.equal((await h.call('GET', `/reporting?fund_id=${FUND}`, OTHER_INVESTOR)).status, 404);

  const uid = rep.statements[0].uid;
  assert.equal((await h.call('GET', `/proposals/${uid}/statement.pdf`, INVESTOR)).status, 404, 'nothing is attached before Accept');
  assert.equal(h.files.size, 0);

  // Accept reads the PDF from the investor's own Mercury and keeps it under the owner.
  const a = await h.call('POST', `/proposals/${uid}/accept`, INVESTOR);
  assert.equal(a.status, 200, a.text);
  assert.equal((await h.call('GET', `/reporting?fund_id=${FUND}`, INVESTOR)).body.statements[0].state, 'accepted');
  assert.deepEqual([...h.files.keys()], [`mercury-statements/${INVESTOR}/${uid}.pdf`]);
  const pdf = await h.call('GET', `/proposals/${uid}/statement.pdf`, INVESTOR);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.type, 'application/pdf');
  assert.ok(pdf.text.startsWith('%PDF'));
  assert.equal((await h.call('GET', `/proposals/${uid}/statement.pdf`, OTHER_INVESTOR)).status, 404, 'another investor gets nothing');
  assert.equal((await h.call('GET', `/proposals/${uid}/statement.pdf`, ADMIN)).status, 403, 'nor does an admin');

  assert.equal((await h.call('DELETE', `/reporting/cash/${rep.month_end_cash[0].id}`, INVESTOR)).status, 200);
  await h.call('POST', '/sync', INVESTOR, { body: { section: 'reporting', fund_id: FUND, from: '2026-08-01', to: TODAY } });
  assert.deepEqual((await h.call('GET', `/reporting?fund_id=${FUND}`, INVESTOR)).body.month_end_cash, []);
});

// ─────────────────────────────────────────────────────────── read-only, logs, the page

test('read-only: every section calls only read tools, and the logs hold counts, never a figure', async () => {
  const h = harness();
  await h.call('POST', '/commit', INVESTOR, { body: { account_ids: [FAKE_ACC_A, FAKE_ACC_B] } });
  for (const section of ['closing', 'calls', 'ledger', 'reporting']) {
    await h.call('POST', '/sync', INVESTOR, { body: { section, fund_id: FUND, from: '2026-08-01', to: TODAY } });
  }
  const tools = h.fake.toolCalls();
  assert.ok(tools.length > 0);
  assert.deepEqual(tools.filter((t: string) => !FAKE_READ_TOOLS.includes(t)), []);
  const logs = rows(h.db, 'SELECT event_type, response_summary FROM integration_logs');
  assert.ok(logs.length >= 5);
  for (const l of logs) {
    assert.match(l.response_summary, /^use=investor_\w+( \w+=\d+)*$/);
    for (const figure of ['610000', '6100', '25000', '2500000', '240100', '1200.5', '12050']) assert.ok(!l.response_summary.includes(figure), l.response_summary);
  }
});

test('the page lists exactly what is built: Trust and the five fed sections, from part 1\'s one list; Portfolio gets nothing', async () => {
  const h = harness();
  const r = await h.call('GET', '', INVESTOR);
  assert.deepEqual(r.body.sections.map((s: any) => [s.section, s.module, s.href, s.lands]), [
    ['Trust', null, '/trust', 'statement'],
    ['Deals · Commit', 'deals_commit', '/deals/commit', 'fact'],
    ['Deals · Closing', 'deals_closing', '/deals/closing', 'proposal'],
    ['Fund · Calls', 'fund_calls', '/funds/calls', 'proposal'],
    ['Fund · Accounting', 'fund_ledger', '/funds/ledger', 'proposal'],
    ['Fund · Reporting', 'fund_reporting', '/funds/reporting', 'fact'],
  ]);
  assert.equal(r.body.portfolio, PORTFOLIO_NOTE);
  assert.ok(!MERCURY_FEEDS.some((f) => /portfolio/i.test(String(f.module))));
  // Each ledger module a sync writes is one the list names, and the reverse.
  const src = read('cloudflare-worker/src/services/mercury/investorFeeds.ts');
  const written = [...src.matchAll(/^\s+\w+: '((?:deals|fund)_\w+)',$/gm)].map((m) => m[1]);
  assert.deepEqual([...new Set(written)].sort(), MERCURY_FEEDS.filter((f) => f.role === 'investor' && f.module).map((f) => f.module).sort());
});

// ─────────────────────────────────────────────────────────── the real opener (part 1's sign-in)

async function signedIn(h: any, over: Record<string, unknown> = {}) {
  const uid = 'int-own';
  const creds = { access_token: h.accessToken, scopes: ['read', 'offline_access'], expires_at: null, issuer: 'https://mcp.mercury.com', client_key: 'fixture-client', ...over };
  h.db.prepare("UPDATE integrations SET auth_type = 'oauth_mcp', credentials_enc = ? WHERE id = ?").run(await encryptCredentials(h.env, uid, creds as any), INTEGRATION);
}

test('the opener: a signed-in investor reads through Mercury\'s MCP server; a pasted token, a wider scope or an Axal entity is refused', async () => {
  let h = harness(true);
  await signedIn(h);
  const ok = await h.call('POST', '/commit', INVESTOR, { body: { account_ids: [FAKE_ACC_A] } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.capacity.available_cents, 110000);

  h = harness(true);
  h.db.exec(`UPDATE integrations SET auth_type = 'api_key' WHERE id = ${INTEGRATION}`);
  const token = await h.call('POST', '/commit', INVESTOR, { body: { account_ids: [FAKE_ACC_A] } });
  assert.equal(token.status, 409);
  assert.equal(token.body.error, 'mercury_signin_required');

  h = harness(true);
  await signedIn(h, { scopes: ['read', 'write'] });
  const wide = await h.call('POST', '/commit', INVESTOR, { body: { account_ids: [FAKE_ACC_A] } });
  assert.equal(wide.status, 403);
  assert.equal(wide.body.error, 'write_scope_refused');
  assert.deepEqual(h.fake.toolCalls(), [], 'nothing is read under a wider scope');

  h = harness(true);
  await signedIn(h);
  h.fake.state.data.organization.legalBusinessName = 'Axal VC GP LLC';
  const entity = await h.call('POST', '/commit', INVESTOR, { body: { account_ids: [FAKE_ACC_A] } });
  assert.equal(entity.status, 409);
  assert.equal(entity.body.error, 'mercury_entity_account');
  assert.equal(rows(h.db, 'SELECT * FROM mercury_investor_capacity').length, 0);

  h = harness(true);
  h.db.exec(`DELETE FROM integrations WHERE id = ${INTEGRATION}`);
  assert.equal((await h.call('GET', '/accounts', INVESTOR)).body.error, 'mercury_not_connected');
});

test('Reporting: a statement Mercury gives no PDF for is not attached, and stays proposed', async () => {
  const h = harness();
  delete (h.fake.state.data.statements.statements[0] as any).downloadUrl;
  await h.call('POST', '/sync', INVESTOR, { body: { section: 'reporting', fund_id: FUND, from: '2026-08-01', to: TODAY } });
  const [st] = (await h.call('GET', `/reporting?fund_id=${FUND}`, INVESTOR)).body.statements;
  const a = await h.call('POST', `/proposals/${st.uid}/accept`, INVESTOR);
  assert.equal(a.status, 409);
  assert.equal(a.body.error, 'statement_unavailable');
  assert.equal((await h.call('GET', `/reporting?fund_id=${FUND}`, INVESTOR)).body.statements[0].state, 'proposed');
  assert.equal(h.files.size, 0);
});
