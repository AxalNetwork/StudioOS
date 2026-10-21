/**
 * D840 part 3 (#2348) — the founder's own Mercury feeds their Grow modules.
 *
 * The pure readers (`services/mercury/growFeeds.ts`) first. Ids, names and
 * amounts are invented.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/mercury_grow_d840.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import cycleGrow from '../src/routes/cycle_grow.ts';
import { DURABILITY_ITEMS, checklist } from '../src/services/growCycle.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { signedInFake, FAKE_ACC_A, fakeTx } from './_mercury_mcp_fake.mjs';
import { openMercuryReads } from '../src/services/mercury/reads.ts';
import { ensureProjectMetricsSchema } from '../src/routes/progress.ts';
import {
  landGrow, readGrow, growFromMercury, acceptPartnerProposal, dismissPartnerProposal, deleteGrowFact, isTeamViewer, TEAM_ONLY,
} from '../src/services/mercury/growFeeds.ts';
import {
  channelOf, channelSpend, cashFacts, debitsByMonth, fullMonths, hiresAffordable, invoiceTally, isMarketing, isPayroll,
  matchPaidInvoices, monthEnd, partnerPayments, revenueMonths, type GrowInvoice, type GrowLine,
} from '../src/services/mercury/growFeeds.ts';

const line = (over: Partial<GrowLine>): GrowLine => ({
  transaction_id: crypto.randomUUID(), amount_cents: -1000, posted_on: '2026-09-10', created_on: '2026-09-10',
  posted: true, internal: false, voided: false, counterparty_name: 'Vendor', category: null, financing: false, ...over,
});
const invoice = (over: Partial<GrowInvoice>): GrowInvoice => ({
  id: crypto.randomUUID(), amount_cents: 250000, state: 'paid', customer_name: 'Customer Co', issued_on: '2026-09-01',
  due_on: '2026-09-30', paid_on: '2026-09-12', recurring: false, ...over,
});

test('pure: the full months before today, oldest first, and a month\'s last day', () => {
  assert.deepEqual(fullMonths('2026-10-21', 3), ['2026-07', '2026-08', '2026-09']);
  assert.equal(fullMonths('2026-01-05', 12)[0], '2025-01');
  assert.equal(monthEnd('2026-02'), '2026-02-28');
  assert.equal(monthEnd('2028-02'), '2028-02-29');
});

test('pure: a month\'s money in excludes financing; a month with no posted line has no figures, never 0', () => {
  const rows = revenueMonths([
    line({ amount_cents: 300000, counterparty_name: 'Customer Co' }),
    line({ amount_cents: 9000000, financing: true }),
    line({ amount_cents: -100000 }),
    line({ amount_cents: 50000, internal: true }),
  ], ['2026-08', '2026-09']);
  assert.deepEqual(rows[0], { month: '2026-08', cash_in_cents: null, net_burn_cents: null });
  assert.deepEqual(rows[1], { month: '2026-09', cash_in_cents: 300000, net_burn_cents: -200000 });
});

test('pure: a credit lands as a paid invoice only when the match is one to one', () => {
  const a = line({ amount_cents: 250000, posted_on: '2026-09-12' });
  const inv = invoice({});
  assert.equal(matchPaidInvoices([a], [inv]).get(a.transaction_id)?.id, inv.id);
  // Two credits of the same amount: neither lands.
  const b = line({ amount_cents: 250000, posted_on: '2026-09-14' });
  assert.equal(matchPaidInvoices([a, b], [inv]).size, 0);
  // Two invoices fit one credit: it stays a pick.
  assert.equal(matchPaidInvoices([a], [inv, invoice({})]).size, 0);
  // An open invoice, a different amount, a credit before the invoice or long after it was paid: no match.
  assert.equal(matchPaidInvoices([a], [invoice({ state: 'open' })]).size, 0);
  assert.equal(matchPaidInvoices([a], [invoice({ amount_cents: 250001 })]).size, 0);
  assert.equal(matchPaidInvoices([line({ amount_cents: 250000, posted_on: '2026-08-31' })], [inv]).size, 0);
  assert.equal(matchPaidInvoices([line({ amount_cents: 250000, posted_on: '2026-09-23' })], [inv]).size, 0);
  assert.equal(matchPaidInvoices([line({ amount_cents: 250000, posted_on: '2026-09-22' })], [inv]).size, 1);
  // Pending, financing and debits never match.
  assert.equal(matchPaidInvoices([line({ amount_cents: 250000, posted: false })], [inv]).size, 0);
  assert.equal(matchPaidInvoices([line({ amount_cents: 250000, financing: true })], [inv]).size, 0);
  assert.equal(matchPaidInvoices([line({ amount_cents: -250000 })], [inv]).size, 0);
});

test('pure: invoices by state; an open invoice past due is overdue', () => {
  const t = invoiceTally([
    invoice({ amount_cents: 100 }),
    invoice({ state: 'open', amount_cents: 200, due_on: '2026-10-30' }),
    invoice({ state: 'open', amount_cents: 300, due_on: '2026-10-01' }),
    invoice({ state: 'overdue', amount_cents: 400 }),
    invoice({ state: 'other', amount_cents: 500 }),
  ], '2026-10-21');
  assert.deepEqual(t, [
    { state: 'paid', count: 1, amount_cents: 100 },
    { state: 'open', count: 1, amount_cents: 200 },
    { state: 'overdue', count: 2, amount_cents: 700 },
  ]);
});

test('pure: payroll is a payroll category or a payroll provider; marketing is its category', () => {
  assert.equal(isPayroll({ category: 'Payroll', counterparty_name: 'Someone' }), true);
  assert.equal(isPayroll({ category: null, counterparty_name: 'Gusto, Inc.' }), true);
  assert.equal(isPayroll({ category: 'Software', counterparty_name: 'Gustoso Pizza' }), false);
  assert.equal(isMarketing({ category: 'Advertising' }), true);
  assert.equal(isMarketing({ category: 'Software' }), false);
  const months = ['2026-08', '2026-09'];
  const rows = debitsByMonth([
    line({ amount_cents: -800000, category: 'Payroll' }),
    line({ amount_cents: -200000, counterparty_name: 'Gusto' }),
    line({ amount_cents: -999, counterparty_name: 'Gusto', posted: false }),
    line({ amount_cents: 5000, counterparty_name: 'Gusto' }),
  ], months, isPayroll);
  assert.deepEqual(rows, [{ month: '2026-08', cents: null }, { month: '2026-09', cents: 1000000 }]);
});

test('pure: a payee lands on a channel only when it names exactly one', () => {
  const channels = [
    { uid: 'c-google', name: 'Google Ads', utm_source: 'google' },
    { uid: 'c-meta', name: 'Meta', utm_source: 'facebook' },
    { uid: 'c-x', name: 'X', utm_source: 'x' },
  ];
  assert.equal(channelOf('GOOGLE ADS', channels), 'c-google');
  assert.equal(channelOf('Google', channels), 'c-google');
  assert.equal(channelOf('Facebook Ads', channels), 'c-meta');
  assert.equal(channelOf('Xerox', channels), null, 'a key under three letters never matches');
  assert.equal(channelOf('Googleplex', channels), null, 'a key must end on a word');
  assert.equal(channelOf('Meta Google', [...channels, { uid: 'c-mg', name: 'Meta Google', utm_source: null }]), 'c-mg', 'the longest key wins');
  assert.equal(channelOf('Google', [...channels, { uid: 'c-g2', name: 'Google', utm_source: null }]), null, 'two channels: none');
  const spend = channelSpend([
    line({ amount_cents: -30000, category: 'Advertising', counterparty_name: 'Google Ads' }),
    line({ amount_cents: -20000, category: 'Advertising', counterparty_name: 'Google Ads' }),
    line({ amount_cents: -10000, category: 'Software', counterparty_name: 'Google Ads' }),
    line({ amount_cents: -5000, category: 'Advertising', counterparty_name: 'Unknown Media' }),
  ], ['2026-09'], channels);
  assert.deepEqual(spend, [{ month: '2026-09', channel_uid: 'c-google', cents: 50000 }]);
});

test('pure: cash, treasury and runway from the three full months before today', () => {
  const lines = ['2026-07-10', '2026-08-10', '2026-09-10'].map((d) => line({ amount_cents: -100000, posted_on: d }));
  const f = cashFacts(lines, [{ kind: 'checking', available_cents: 1200000 }, { kind: 'savings', available_cents: null }], 5000000, '2026-10-21', false);
  assert.deepEqual(f, { cash_cents: 1200000, treasury_cents: 5000000, runway_months: 12, runway_reason: null, average_net_burn_cents: 100000 });
  const short = cashFacts(lines.slice(1), [{ kind: 'checking', available_cents: 1200000 }], null, '2026-10-21', false);
  assert.equal(short.runway_months, null);
  assert.match(String(short.runway_reason), /fewer than three full months/);
  assert.match(String(cashFacts(lines, [], null, '2026-10-21', false).runway_reason), /no available balance/);
  assert.match(String(cashFacts(lines, [{ kind: 'checking', available_cents: 1 }], null, '2026-10-21', true).runway_reason), /more lines than one read/);
});

test('pure: hires affordable keeps twelve months of runway; each missing input says why', () => {
  // $240k cash: $20k a month for 12 months; burn $10k leaves $10k; $5k a head → 2.
  assert.deepEqual(hiresAffordable({ cash_cents: 240_000_00, average_net_burn_cents: 10_000_00, payroll_cents: 15_000_00, headcount: 3 }),
    { value: 2, reason: null, cost_per_head_cents: 5_000_00 });
  assert.equal(hiresAffordable({ cash_cents: 6_000_00, average_net_burn_cents: 10_000_00, payroll_cents: 15_000_00, headcount: 3 }).value, 0, 'never negative');
  assert.match(String(hiresAffordable({ cash_cents: null, average_net_burn_cents: 1, payroll_cents: 1, headcount: 1 }).reason), /no available balance/);
  assert.match(String(hiresAffordable({ cash_cents: 1, average_net_burn_cents: null, payroll_cents: 1, headcount: 1 }).reason), /three full months/);
  assert.match(String(hiresAffordable({ cash_cents: 1, average_net_burn_cents: 1, payroll_cents: null, headcount: 1 }).reason), /no payroll/);
  assert.match(String(hiresAffordable({ cash_cents: 1, average_net_burn_cents: 1, payroll_cents: 1, headcount: 0 }).reason), /roster/);
});

test('pure: payments to an Axal partner\'s company are summed for a proposal; anything else is not', () => {
  const partners = [{ uid: 'p1', company: 'Brightlane Advisory LLC' }, { uid: 'p2', company: 'Twin Co' }, { uid: 'p3', company: 'Twin Co.' }];
  const out = partnerPayments([
    line({ amount_cents: -120000, counterparty_name: 'BRIGHTLANE ADVISORY', posted_on: '2026-08-02' }),
    line({ amount_cents: -30000, counterparty_name: 'Brightlane Advisory, LLC', posted_on: '2026-09-02' }),
    line({ amount_cents: -50000, counterparty_name: 'Brightlane Advisory', posted: false }),
    line({ amount_cents: 70000, counterparty_name: 'Brightlane Advisory' }),
    line({ amount_cents: -40000, counterparty_name: 'Twin Co' }),
    line({ amount_cents: -40000, counterparty_name: 'Brightlane Advisory Group' }),
  ], partners);
  assert.deepEqual(out, [{ partner_uid: 'p1', company: 'Brightlane Advisory LLC', paid_cents: 150000, payments: 2, since: '2026-08-02' }]);
});


// ═════════════════════════════════════════════════════════════ against the fake MCP server

const here = dirname(fileURLToPath(import.meta.url));
const M = resolve(here, '../sql/migrations');
const file = (p: string) => readFileSync(resolve(M, readdirSync(M).find((f) => f.startsWith(`${p}_`))!), 'utf8');
const ddl = (p: string) => file(p).split(/;\s*\n/).map((x) => x.replace(/^\s*--.*$/gm, '').trim())
  .filter((x) => /^CREATE\s+(TABLE|INDEX|UNIQUE INDEX)/i.test(x)).map((x) => `${x};`).join('\n');

const TODAY = '2026-10-21';
const PID = 7; const INTEGRATION = 41;
const FOUNDER = 1; const COFOUNDER = 2; const ADMIN = 3; const PARTNER = 4; const ADVISOR = 5; const INVESTOR = 6;
export const viewers = {
  founder: { id: FOUNDER, founder_id: 10 }, cofounder: { id: COFOUNDER, founder_id: 11 }, admin: { id: ADMIN, founder_id: null },
  partner: { id: PARTNER, founder_id: null }, advisor: { id: ADVISOR, founder_id: 12 }, investor: { id: INVESTOR, founder_id: null },
};

async function growDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const baseline = readFileSync(resolve(here, '../sql/schema_baseline.sql'), 'utf8');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT, spinout_lab_active INTEGER);
           CREATE TABLE projects (id INTEGER PRIMARY KEY, uid TEXT, name TEXT, founder_id INTEGER, company_id INTEGER, entity_id INTEGER, deleted_at TEXT);
           CREATE TABLE user_company_links (id INTEGER PRIMARY KEY, company_id INTEGER, user_id INTEGER);
           CREATE TABLE documents (id INTEGER PRIMARY KEY, project_id INTEGER);
           CREATE TABLE activity_logs (id INTEGER PRIMARY KEY, project_id INTEGER, action TEXT, details TEXT, user_id INTEGER, entity_type TEXT, entity_id TEXT, actor TEXT);
           CREATE TABLE integrations (id INTEGER PRIMARY KEY, uid TEXT, user_id INTEGER, provider_key TEXT, status TEXT, credentials_enc TEXT, config_json TEXT);
           CREATE TABLE waitlist_signups (id INTEGER PRIMARY KEY, project_id INTEGER, email TEXT, audience TEXT, created_at TEXT DEFAULT (datetime('now')));
           CREATE TABLE spinout_lab_milestones (id INTEGER PRIMARY KEY, user_id INTEGER, week INTEGER, milestone_key TEXT, completed_at TEXT);`);
  for (const t of ['partners', 'raise_prospects', 'deals', 'commitments', 'entities', 'compliance_events']) db.exec(tableFromBaseline(baseline, t));
  for (const p of ['034', '119', '127', '132', '326']) db.exec(ddl(p));
  db.exec(ddl('125')); db.exec(file('437'));
  db.exec(file('311'));
  db.exec('ALTER TABLE contacts ADD COLUMN utm_json TEXT');
  db.exec(file('443'));
  db.exec(file('462'));
  db.exec(file('507'));
  db.exec(file('445'));
  db.exec(file('477'));
  db.exec(file('490'));
  const env = { JWT_SECRET: 'unit-test-jwt-secret-0123456789-abcdef', ENVIRONMENT: 'development', DB: d1Over(db) } as any;
  await ensureProjectMetricsSchema(env);
  db.exec(file('521'));
  const u = db.prepare('INSERT INTO users (id, role, founder_id, name, email) VALUES (?, ?, ?, ?, ?)');
  u.run(FOUNDER, 'founder', 10, 'Fay', 'fay@co.example');
  u.run(COFOUNDER, 'founder', 11, 'Cole', 'cole@co.example');
  u.run(ADMIN, 'admin', null, 'Ann', 'ann@axal.example');
  u.run(PARTNER, 'partner', null, 'Pat', 'pat@axal.example');
  u.run(ADVISOR, 'founder', 12, 'Ada', 'ada@else.example');
  u.run(INVESTOR, 'investor', null, 'Ivy', 'ivy@fund.example');
  db.prepare(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (?, ?, 'investor', 'accepted')`).run(PID, INVESTOR);
  db.prepare(`INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (?, 'p7', 'Venture', 10, 70)`).run(PID);
  db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (70, ?)').run(COFOUNDER);
  db.prepare(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (?, ?, 'advisor', 'accepted')`).run(PID, ADVISOR);
  db.prepare(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (?, ?, 'cofounder', 'accepted')`).run(PID, COFOUNDER);
  db.prepare(`INSERT INTO integrations (id, uid, user_id, provider_key, status) VALUES (?, 'mi', ?, 'mercury', 'active')`).run(INTEGRATION, FOUNDER);
  db.prepare(`INSERT INTO partners (name, email, company, status) VALUES ('Pat', 'pat@axal.example', 'Brightlane Advisory LLC', 'active')`).run();
  db.prepare(`INSERT INTO growth_channels (uid, project_id, name, utm_source) VALUES ('ch-google', ?, 'Google Ads', 'google')`).run(PID);
  for (const name of ['Ena', 'Eli']) {
    db.prepare(`INSERT INTO company_people (uid, company_id, name, person_type, status, created_by) VALUES (?, 70, ?, 'employee', 'active', 1)`).run(`cp-${name}`, name);
  }
  db.prepare(`INSERT INTO contacts (uid, project_id, name, email, audience, utm_json, created_at) VALUES ('ct1', ?, 'Buyer', 'buyer@else.example', 'customer', '{"utm_source":"google"}', '2026-09-20 10:00:00')`).run(PID);
  return { db, env };
}

let n = 0;
const tx = (amount: number, on: string, counterparty: string, extra: Record<string, unknown> = {}) => ({
  id: fakeTx(++n), accountId: FAKE_ACC_A, amount, counterpartyName: counterparty, createdAt: `${on}T09:00:00Z`, postedAt: `${on}T12:00:00Z`,
  status: 'sent', kind: 'externalTransfer', ...extra,
});

/** Three full months of a small venture's lines, an invoice paid in September, and a partner paid in August. */
function growFake() {
  const s = signedInFake();
  n = 0;
  s.fake.state.data.transactions = [
    ...['2026-07', '2026-08', '2026-09'].flatMap((m) => [
      tx(-8000, `${m}-15`, 'Gusto'),
      tx(-1000, `${m}-10`, 'Google Ads', { mercuryCategory: 'Advertising' }),
      tx(-1000, `${m}-01`, 'Landlord Co', { mercuryCategory: 'Facilities Expenses' }),
    ]),
    tx(3000, '2026-07-20', 'Other Customer'),
    tx(3000, '2026-08-20', 'Other Customer'),
    tx(2500, '2026-09-05', 'Customer Co'),
    tx(-1500, '2026-08-03', 'Brightlane Advisory, LLC'),
    tx(-700, '2026-09-28', 'Pending Vendor', { status: 'pending', postedAt: null }),
  ];
  return s;
}

async function syncOnce(env: any, s = growFake()) {
  const reads = await openMercuryReads({ accessToken: s.accessToken, fetcher: s.fake.fetch });
  try {
    const read = await readGrow(env, reads, FOUNDER, TODAY);
    return { counts: await landGrow(env, INTEGRATION, { id: PID, founder_user_id: FOUNDER }, read, TODAY), fake: s.fake, read };
  } finally { await reads.close(); }
}

test('fake: a sync reads only through the allowlisted tools and writes nothing to Mercury', async () => {
  const { env } = await growDb();
  const { fake, read } = await syncOnce(env);
  const tools = fake.calls.filter((c: any) => c.tool).map((c: any) => c.tool);
  assert.deepEqual([...new Set(tools)].sort(), ['getAccounts', 'getTreasury', 'listCustomers', 'listInvoices', 'listTransactions']);
  assert.equal(read.capped, false);
  assert.equal(read.treasury_cents, 1000000);
  assert.deepEqual(read.invoices, [{ id: '55555555-5555-4555-8555-555555555555', amount_cents: 250000, state: 'paid', customer_name: 'Customer Co',
    issued_on: '2026-09-02', due_on: '2026-10-02', paid_on: null, recurring: false }]);
});

test('revenue and traction: a monthly mercury snapshot per full month, and the paid invoice\'s credit lands; the others stay picks', async () => {
  const { db, env } = await growDb();
  const { counts } = await syncOnce(env);
  const months = db.prepare(`SELECT snapshot_date, cash_in, net_burn, cash_balance FROM project_metrics WHERE project_id = ? AND source = 'mercury' ORDER BY snapshot_date`).all(PID) as any[];
  assert.deepEqual(months.map((m) => [m.snapshot_date, m.cash_in, m.net_burn, m.cash_balance]), [
    ['2026-07-31', 3000, 7000, null], ['2026-08-31', 3000, 8500, null], ['2026-09-30', 2500, 7500, null],
  ], 'cash on hand is never written to project_metrics');
  const entries = db.prepare(`SELECT customer, amount_cents, received_on, source, source_ref, revenue_type FROM revenue_entries WHERE project_id = ?`).all(PID) as any[];
  assert.deepEqual(entries.map((e) => ({ ...e })), [{ customer: 'Customer Co', amount_cents: 250000, received_on: '2026-09-05', source: 'mercury', source_ref: fakeTx(12), revenue_type: 'one_time' }]);
  const ledger = db.prepare(`SELECT kind, external_id, local_table FROM connector_fed_items WHERE module = 'revenue_and_traction' ORDER BY kind, external_id`).all() as any[];
  assert.deepEqual(ledger.map((l) => l.kind), ['credit', 'invoices_open', 'invoices_overdue', 'invoices_paid', 'metric_month', 'metric_month', 'metric_month']);
  assert.equal(counts.metric_months, 3);
  assert.equal(counts.invoice_credits, 1);
  // A second sync updates, never duplicates.
  const ledgerRows = () => (db.prepare(`SELECT COUNT(*) AS c FROM connector_fed_items`).get() as any).c;
  const before = ledgerRows();
  await syncOnce(env);
  assert.equal((db.prepare(`SELECT COUNT(*) AS c FROM project_metrics WHERE source = 'mercury'`).get() as any).c, 3);
  assert.equal((db.prepare(`SELECT COUNT(*) AS c FROM revenue_entries`).get() as any).c, 1);
  assert.equal(ledgerRows(), before);
});

test('a row the founder deleted stays deleted through the next sync', async () => {
  const { db, env } = await growDb();
  await syncOnce(env);
  db.prepare(`DELETE FROM project_metrics WHERE source = 'mercury' AND snapshot_date = '2026-08-31'`).run();
  db.prepare(`DELETE FROM revenue_entries WHERE source = 'mercury'`).run();
  const payroll = db.prepare(`SELECT id FROM mercury_grow_facts WHERE kind = 'payroll' AND period = '2026-09'`).get() as any;
  assert.equal(await deleteGrowFact(env, PID, payroll.id), 'team-expansion');
  assert.equal(await deleteGrowFact(env, PID, payroll.id), null, 'gone once');
  const { counts } = await syncOnce(env);
  assert.equal(counts.kept_deleted, 3);
  assert.equal(db.prepare(`SELECT 1 FROM project_metrics WHERE source = 'mercury' AND snapshot_date = '2026-08-31'`).get(), undefined);
  assert.equal(db.prepare(`SELECT 1 FROM revenue_entries`).get(), undefined);
  assert.equal(db.prepare(`SELECT 1 FROM mercury_grow_facts WHERE kind = 'payroll' AND period = '2026-09'`).get(), undefined);
  assert.ok(db.prepare(`SELECT 1 FROM mercury_grow_facts WHERE kind = 'payroll' AND period = '2026-08'`).get(), 'the rest still update');
  const unlinked = db.prepare(`SELECT COUNT(*) AS c FROM connector_fed_items WHERE local_id IS NULL`).get() as any;
  assert.equal(unlinked.c, 3, 'each deleted row keeps its ledger row with no local_id');
});

test('durable company-building: cash, treasury and runway, from Mercury with their date, to the team only', async () => {
  const { env } = await growDb();
  await syncOnce(env);
  const part: any = await growFromMercury(env, PID, 'durable-company-building', viewers.founder, TODAY);
  assert.equal(part.state, 'ok');
  assert.deepEqual([part.cash.cents, part.treasury.cents], [610000, 1000000]);
  // Burn: July 7,000, August 8,500, September 7,500 → 7,666.67 a month; cash 6,100 → 0.8 months.
  assert.equal(part.runway.months, 0.8);
  assert.equal(part.runway.source, `From Mercury, as of ${TODAY}`);
  assert.deepEqual(await growFromMercury(env, PID, 'durable-company-building', viewers.cofounder, TODAY).then((p: any) => p.state), 'ok', 'a member of the founder\'s company');
});

test('no balance is shown outside the founder\'s company', async () => {
  const { env } = await growDb();
  await syncOnce(env);
  for (const who of ['admin', 'partner', 'advisor', 'investor'] as const) {
    assert.equal(await isTeamViewer(env, viewers[who], PID), false, who);
    for (const slug of ['revenue-and-traction', 'durable-company-building', 'team-expansion', 'distribution', 'partner-network'] as const) {
      const part = await growFromMercury(env, PID, slug, viewers[who], TODAY);
      assert.deepEqual(part, { state: 'team_only', reason: TEAM_ONLY }, `${who} on ${slug}`);
    }
  }
});

test('team expansion: payroll by month, and hires affordable as a computed figure, never a plan', async () => {
  const { env } = await growDb();
  await syncOnce(env);
  const part: any = await growFromMercury(env, PID, 'team-expansion', viewers.founder, TODAY);
  assert.deepEqual(part.payroll.map((p: any) => [p.month, p.cents]), [['2026-07', 800000], ['2026-08', 800000], ['2026-09', 800000]]);
  // Cash 6,100 / 12 = 508.33 a month, under the 7,666.67 burn: no room → 0.
  assert.equal(part.hires_affordable.value, 0);
  assert.equal(part.hires_affordable.kind, 'computed');
  assert.equal(part.hires_affordable.cost_per_head_cents, 400000);
  assert.match(part.hires_affordable.words, /not a plan/);
});

test('distribution: marketing spend by month; spend and CAC only for the channel a payee names', async () => {
  const { env } = await growDb();
  await syncOnce(env);
  const part: any = await growFromMercury(env, PID, 'distribution', viewers.founder, TODAY);
  assert.deepEqual(part.spend.map((p: any) => [p.month, p.cents]), [['2026-07', 100000], ['2026-08', 100000], ['2026-09', 100000]]);
  assert.equal(part.month, '2026-09');
  assert.deepEqual(part.channels.map((c: any) => [c.channel_uid, c.spend_cents, c.customers, c.cac_cents]), [['ch-google', 100000, 1, 100000]]);
});

test('partner network: a payment to an Axal partner is a proposal that needs Accept; Dismiss stays dismissed', async () => {
  const { db, env } = await growDb();
  await syncOnce(env);
  const part: any = await growFromMercury(env, PID, 'partner-network', viewers.founder, TODAY);
  assert.equal(part.can_decide, true);
  assert.equal(part.proposals.length, 1);
  const p = part.proposals[0];
  assert.equal(p.state, 'pending');
  assert.equal(p.sentence, 'You paid Brightlane Advisory LLC $1,500 since 2026-08-03: link to this partnership?');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM growth_partners').get().c, 0, 'nothing is written before Accept');
  assert.equal(db.prepare(`SELECT 1 FROM connector_fed_items WHERE module = 'partner_network'`).get(), undefined);
  // The co-founder sees it but cannot decide; nobody else sees it.
  assert.equal(((await growFromMercury(env, PID, 'partner-network', viewers.cofounder, TODAY)) as any).can_decide, false);
  const made: string[] = [];
  const create = async (name: string) => {
    const uid = `gp-${made.length + 1}`; made.push(name);
    db.prepare(`INSERT INTO growth_partners (uid, project_id, name, type) VALUES (?, ?, ?, 'other')`).run(uid, PID, name);
    return uid;
  };
  assert.equal(await acceptPartnerProposal(env, PID, p.id, {}, FOUNDER, create), 'ok');
  assert.deepEqual(made, ['Brightlane Advisory LLC']);
  const link = db.prepare(`SELECT module, kind, local_table FROM connector_fed_items WHERE module = 'partner_network'`).get() as any;
  assert.deepEqual({ ...link }, { module: 'partner_network', kind: 'partner_payment', local_table: 'growth_partners' });
  assert.equal(await acceptPartnerProposal(env, PID, p.id, {}, FOUNDER, create), 'decided');
  // A second proposal, dismissed, stays dismissed through a sync.
  db.prepare(`INSERT INTO partners (name, email, company, status) VALUES ('Quin', 'q@axal.example', 'Landlord Co', 'active')`).run();
  await syncOnce(env);
  const second = db.prepare(`SELECT id FROM mercury_partner_proposals WHERE partner_company = 'Landlord Co'`).get() as any;
  assert.equal(await dismissPartnerProposal(env, PID, second.id, FOUNDER), 'ok');
  await syncOnce(env);
  assert.equal((db.prepare('SELECT state FROM mercury_partner_proposals WHERE id = ?').get(second.id) as any).state, 'dismissed');
  assert.equal(await dismissPartnerProposal(env, PID, 999, FOUNDER), 'not_found');
});

// ═════════════════════════════════════════════════════════════ the routes

const app = new Hono<any>();
app.route('/api/cycles/grow', cycleGrow);
const ROLE: Record<number, string> = { [FOUNDER]: 'founder', [COFOUNDER]: 'founder', [ADMIN]: 'admin', [PARTNER]: 'partner', [ADVISOR]: 'founder', [INVESTOR]: 'investor' };
async function call(env: any, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
  const res = await app.fetch(new Request(`http://t${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env, { waitUntil() {}, passThroughOnException() {} } as any);
  return { status: res.status, body: await res.json() as any };
}

test('route: each fed module carries its Mercury part; the team reads figures, a reader outside the company reads none', async () => {
  const { env } = await growDb();
  await syncOnce(env);
  for (const slug of ['revenue-and-traction', 'durable-company-building', 'team-expansion', 'distribution', 'partner-network']) {
    const mine = await call(env, FOUNDER, 'GET', `/api/cycles/grow/modules/${slug}?project=${PID}`);
    assert.equal(mine.status, 200, slug);
    assert.equal(mine.body.parts.from_mercury.state, 'ok', slug);
    for (const who of [ADMIN, PARTNER, ADVISOR, INVESTOR]) {
      const theirs = await call(env, who, 'GET', `/api/cycles/grow/modules/${slug}?project=${PID}`);
      if (who === INVESTOR && theirs.status === 403) continue; // an investor may read nothing of the venture at all
      assert.equal(theirs.status, 200, `${who} reads ${slug}`);
      assert.deepEqual(theirs.body.parts.from_mercury, { state: 'team_only', reason: TEAM_ONLY }, `${who} on ${slug}`);
      assert.doesNotMatch(JSON.stringify(theirs.body), /610000|1000000|"cents":800000/, `no Mercury figure reaches ${who} on ${slug}`);
    }
  }
  const other = await call(env, FOUNDER, 'GET', `/api/cycles/grow/modules/market-expansion?project=${PID}`);
  assert.equal(other.body.parts?.from_mercury, undefined, 'Market expansion reads nothing from Mercury');
});

test('route: a Mercury part that cannot be read is unreadable, and the module still loads', async () => {
  const { db, env } = await growDb();
  db.exec('DROP TABLE mercury_grow_facts');
  const r = await call(env, FOUNDER, 'GET', `/api/cycles/grow/modules/team-expansion?project=${PID}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.parts.from_mercury, { state: 'unreadable', reason: 'Unreadable: the Mercury figures could not be read' });
  assert.ok(r.body.records);
});

test('route: only the founder accepts or dismisses; accept links one partner and records who', async () => {
  const { db, env } = await growDb();
  await syncOnce(env);
  const id = (db.prepare('SELECT id FROM mercury_partner_proposals').get() as any).id;
  for (const who of [COFOUNDER, ADMIN, PARTNER, ADVISOR, INVESTOR]) {
    const r = await call(env, who, 'POST', `/api/cycles/grow/mercury/partner-proposals/${id}/accept`, { project: PID });
    assert.ok([403].includes(r.status), `${who} → ${r.status}`);
  }
  assert.equal((db.prepare('SELECT state FROM mercury_partner_proposals WHERE id = ?').get(id) as any).state, 'pending');
  const ok = await call(env, FOUNDER, 'POST', `/api/cycles/grow/mercury/partner-proposals/${id}/accept`, { project: PID });
  assert.equal(ok.status, 200);
  const gp = db.prepare('SELECT name, type FROM growth_partners WHERE project_id = ?').all(PID) as any[];
  assert.deepEqual(gp.map((g) => [g.name, g.type]), [['Brightlane Advisory LLC', 'other']]);
  assert.ok(db.prepare(`SELECT 1 FROM activity_logs WHERE action = 'grow_mercury_partner_accepted' AND user_id = ?`).get(FOUNDER));
  const again = await call(env, FOUNDER, 'POST', `/api/cycles/grow/mercury/partner-proposals/${id}/dismiss`, { project: PID });
  assert.equal(again.status, 409);
  const none = await call(env, FOUNDER, 'POST', `/api/cycles/grow/mercury/partner-proposals/999/accept`, { project: PID });
  assert.equal(none.status, 404);
});

test('route: a team writer deletes a Mercury figure and it stays deleted; nobody else can', async () => {
  const { db, env } = await growDb();
  await syncOnce(env);
  const id = (db.prepare(`SELECT id FROM mercury_grow_facts WHERE kind = 'marketing_spend' AND period = '2026-07'`).get() as any).id;
  for (const who of [ADMIN, PARTNER, ADVISOR, INVESTOR]) {
    const r = await call(env, who, 'DELETE', `/api/cycles/grow/mercury/facts/${id}?project=${PID}`);
    assert.equal(r.status, 403, `${who}`);
  }
  const ok = await call(env, COFOUNDER, 'DELETE', `/api/cycles/grow/mercury/facts/${id}?project=${PID}`);
  assert.equal(ok.status, 200);
  assert.ok(db.prepare(`SELECT 1 FROM activity_logs WHERE action = 'grow_mercury_fact_deleted' AND user_id = ?`).get(COFOUNDER));
  await syncOnce(env);
  assert.equal(db.prepare(`SELECT 1 FROM mercury_grow_facts WHERE kind = 'marketing_spend' AND period = '2026-07'`).get(), undefined);
});

test('durable: Mercury ticks the runway item at twelve months, with its date and never its figure', async () => {
  const { db, env } = await growDb();
  assert.ok(DURABILITY_ITEMS.some((i) => i.key === 'runway_12_months' && i.mercury === 'runway'));
  await syncOnce(env);
  const item = () => checklist(env, PID).then((l) => l.find((i) => i.key === 'runway_12_months')!);
  assert.equal((await item()).done, false, '0.8 months is not twelve');
  db.prepare(`UPDATE mercury_grow_facts SET value = 12 WHERE kind = 'runway'`).run();
  const done = await item();
  assert.deepEqual([done.done, done.source, done.done_at], [true, `From Mercury, as of ${TODAY}`, TODAY]);
  assert.doesNotMatch(JSON.stringify(done), /\b12\b/, 'the figure is not in the checklist');
  db.prepare(`UPDATE mercury_grow_facts SET value = 11.9 WHERE kind = 'runway'`).run();
  assert.equal((await item()).done, false);
});

test('durable: the runway item counts only for a founder with Mercury, or once ticked by hand', async () => {
  // Mutation checked: drop the filter → the founder without Mercury gets nine items and the first assert fails;
  // filter without `mine` → the hand tick is dropped and the last assert fails.
  const { db, env } = await growDb();
  const keys = () => checklist(env, PID).then((l) => l.map((i) => i.key));
  assert.ok((await keys()).includes('runway_12_months'), 'an active Mercury connection: counted');
  db.prepare(`UPDATE integrations SET status = 'disconnected' WHERE id = ?`).run(INTEGRATION);
  const without = await keys();
  assert.equal(without.length, DURABILITY_ITEMS.length - 1, 'no Mercury: not in the list, so not in the total');
  assert.ok(!without.includes('runway_12_months'));
  db.prepare(`INSERT INTO durability_checklist (project_id, item_key, done_at) VALUES (?, 'runway_12_months', '2026-10-01')`).run(PID);
  const ticked = await checklist(env, PID).then((l) => l.find((i) => i.key === 'runway_12_months'));
  assert.deepEqual([ticked?.done, ticked?.source], [true, 'manual'], 'ticked by hand: counted');
});
