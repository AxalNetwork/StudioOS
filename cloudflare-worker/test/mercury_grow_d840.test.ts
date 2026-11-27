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
import '../src/routes/cycle_grow.ts';
import { DURABILITY_ITEMS, checklist } from '../src/services/growCycle.ts';
import { GROW_FEED_KINDS, MERCURY_FEEDS, mercuryFedModules } from '../src/integrations/mercuryFeeds.ts';
import { fedCounts } from '../src/integrations/fed.ts';
import { fakeTx } from './_mercury_mcp_fake.mjs';
import {
  growFromMercury, acceptPartnerProposal, dismissPartnerProposal, deleteGrowFact, isTeamViewer, TEAM_ONLY,
} from '../src/services/mercury/growFeeds.ts';
import {
  channelOf, channelSpend, cashFacts, debitsByMonth, fullMonths, hiresAffordable, invoiceTally, isMarketing, isPayroll, matchPaidInvoices, monthEnd, partnerPayments, revenueMonths, type GrowInvoice, type GrowLine,
} from '../src/services/mercury/growFeeds.ts';
import {
  TODAY, PID, INTEGRATION, FOUNDER, COFOUNDER, ADMIN, PARTNER, ADVISOR, INVESTOR, viewers, growDb, growFake, syncOnce, call, signedInRow,
} from './_mercury_grow_fixture.ts';

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
  const months = db.prepare(`SELECT snapshot_date, cash_in_cents, net_burn, cash_balance FROM project_metrics WHERE project_id = ? AND source = 'mercury' ORDER BY snapshot_date`).all(PID) as any[];
  assert.deepEqual(months.map((m) => [m.snapshot_date, m.cash_in_cents, m.net_burn, m.cash_balance]), [
    ['2026-07-31', 300000, 7000, null], ['2026-08-31', 300000, 8500, null], ['2026-09-30', 250000, 7500, null],
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
  assert.equal(((await growFromMercury(env, PID, 'partner-network', viewers.cofounder, TODAY)) as any).can_sync, false, 'only the founder syncs');
  assert.equal(part.can_sync, true);
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
  assert.equal(made.length, 1, 'a decided proposal creates no second partner');
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
      // D889 (#2438): a partner with no tie to the venture reads nothing of it either.
      if (who === PARTNER) { assert.equal(theirs.status, 403, `untied partner on ${slug}`); continue; }
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

test('the page lists exactly what is built: each Grow feed lands only the kinds the sync writes', async () => {
  // Mutation checked: drop distribution from MERCURY_FEEDS → the module list fails; land a kind the list does not name → the ledger check fails.
  const grow = MERCURY_FEEDS.filter((f) => f.key.startsWith('grow_'));
  assert.deepEqual(grow.map((f) => f.module).sort(), Object.keys(GROW_FEED_KINDS).sort());
  for (const m of Object.keys(GROW_FEED_KINDS)) assert.ok(mercuryFedModules('founder').includes(m), m);
  const { db, env } = await growDb();
  await syncOnce(env);
  const id = (db.prepare('SELECT id FROM mercury_partner_proposals').get() as any).id;
  await acceptPartnerProposal(env, PID, id, {}, FOUNDER, async (name) => {
    db.prepare(`INSERT INTO growth_partners (uid, project_id, name, type) VALUES ('gp-x', ?, ?, 'other')`).run(PID, name); return 'gp-x';
  });
  const landed = db.prepare('SELECT DISTINCT module, kind FROM connector_fed_items').all() as any[];
  for (const r of landed) assert.ok((GROW_FEED_KINDS[r.module] ?? []).includes(r.kind), `${r.module}/${r.kind} is not on the list`);
  const modules = new Set(landed.map((r) => r.module));
  for (const m of Object.keys(GROW_FEED_KINDS)) assert.ok(modules.has(m), `${m} is on the list but nothing landed there`);
  // "Now fed by" counts each Grow module from the ledger.
  const counts = await fedCounts(env, INTEGRATION, 'mercury', 'founder');
  for (const m of Object.keys(GROW_FEED_KINDS)) assert.ok((counts.find((c) => c.module === m)?.count ?? 0) > 0, `${m} counted`);
});

test('route: the founder syncs Grow from their own signed-in Mercury; nobody else can, and a pasted token is told to sign in', async () => {
  const { db, env } = await growDb();
  const s = growFake();
  await signedInRow(db, env, s);
  const off = s.fake.install();
  try {
    for (const who of [COFOUNDER, ADMIN, PARTNER, ADVISOR, INVESTOR]) {
      const r = await call(env, who, 'POST', '/api/cycles/grow/mercury/sync', { project: PID });
      assert.equal(r.status, 403, `${who} → ${r.status}`);
    }
    assert.equal(s.fake.calls.length, 0, 'a refused sync reaches no Mercury');
    const ok = await call(env, FOUNDER, 'POST', '/api/cycles/grow/mercury/sync', { project: PID });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual({ months: ok.body.counts.metric_months, credits: ok.body.counts.invoice_credits, proposals: ok.body.counts.partner_proposals },
      { months: 3, credits: 1, proposals: 1 });
    assert.doesNotMatch(JSON.stringify(ok.body), /610000|1000000|800000/, 'the answer carries counts, never a figure');
    assert.ok(db.prepare(`SELECT 1 FROM activity_logs WHERE action = 'grow_mercury_synced' AND user_id = ?`).get(FOUNDER));
    assert.ok((db.prepare('SELECT last_synced_at FROM integrations WHERE id = ?').get(INTEGRATION) as any).last_synced_at);
    // A pasted token cannot read invoices or treasury.
    db.prepare(`UPDATE integrations SET auth_type = 'api_key' WHERE id = ?`).run(INTEGRATION);
    const token = await call(env, FOUNDER, 'POST', '/api/cycles/grow/mercury/sync', { project: PID });
    assert.deepEqual([token.status, token.body.error], [409, 'mercury_sign_in_required']);
    db.prepare(`UPDATE integrations SET status = 'disconnected' WHERE id = ?`).run(INTEGRATION);
    const none = await call(env, FOUNDER, 'POST', '/api/cycles/grow/mercury/sync', { project: PID });
    assert.deepEqual([none.status, none.body.error], [404, 'mercury_not_connected']);
  } finally { off(); }
});

test('route: a Mercury that fails says so and writes nothing, with no figure in the answer or the log', async () => {
  const { db, env } = await growDb();
  const s = growFake();
  await signedInRow(db, env, s);
  s.fake.state.status = 500;
  const off = s.fake.install();
  const logged: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { logged.push(a.map(String).join(' ')); };
  try {
    const r = await call(env, FOUNDER, 'POST', '/api/cycles/grow/mercury/sync', { project: PID });
    assert.deepEqual([r.status, r.body.error], [502, 'mercury_read_failed']);
    assert.equal(db.prepare('SELECT 1 FROM mercury_grow_facts').get(), undefined);
    assert.equal(db.prepare(`SELECT 1 FROM project_metrics WHERE source = 'mercury'`).get(), undefined);
    assert.doesNotMatch(logged.join('\n'), /\d{4,}/, 'no figure reaches the log');
  } finally { off(); console.error = orig; }
});
