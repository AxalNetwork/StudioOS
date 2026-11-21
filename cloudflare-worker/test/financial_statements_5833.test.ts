/**
 * D5833 (#5833) — the shared financial statement and revision contract.
 *
 * Pure contract and adapters over synthetic QuickBooks and Xero fixtures, then
 * the store over real SQLite built from every migration:
 *   · exact signed amounts; zero, absent and unreadable kept apart; no rounding;
 *   · different fiscal periods, currencies and bases; missing lines and basis;
 *   · an unchanged resync, duplicate and concurrent delivery, and a correction
 *     that leaves a pinned revision traceable;
 *   · venture and member guards on every read and write;
 *   · a P&L net loss never becomes burn; ledger figures are never summed with
 *     other sources; the Use of Funds runway read is unchanged.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/financial_statements_5833.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { canonicalize, cashChange, fingerprint, parseAmount, sideBySide, supportedFigure, StatementRefusal } from '../src/services/financialStatements/contract.ts';
import { fromQuickBooks } from '../src/services/financialStatements/quickbooks.ts';
import { fromXero, xeroDate } from '../src/services/financialStatements/xero.ts';
import { pinRevision, readLatest, readPins, readRevision, writeSnapshot } from '../src/services/financialStatements/store.ts';
import { runwayToday } from '../src/services/useOfFunds/read.ts';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/accounting/${name}.json`, import.meta.url), 'utf8'));
const QB_BS = fixture('quickbooks_balance_sheet'), QB_PL = fixture('quickbooks_profit_and_loss');
const XERO_BS = fixture('xero_balance_sheet'), XERO_PL = fixture('xero_profit_and_loss');
const qbBs = (body = QB_BS, as_of = '2026-09-30') => fromQuickBooks(body, { realm_id: '9130350000000001', requested: { as_of } });
const qbPl = () => fromQuickBooks(QB_PL, { realm_id: '9130350000000001', requested: { start: '2026-04-01', end: '2026-09-30' } });
const xeroBs = () => fromXero(XERO_BS, { tenant_id: 'tenant-1', requested: { as_of: '2026-03-31' }, basis: 'accrual', currency: 'gbp' });
const xeroPl = () => fromXero(XERO_PL, { tenant_id: 'tenant-1', requested: { start: '2025-04-01', end: '2026-03-31' }, basis: 'unknown', currency: 'GBP' });
const line = (s: ReturnType<typeof canonicalize>, key: string) => s.lines.find(l => l.source_key === key)!;

test('amounts: exact, signed, never rounded; zero, absent and unreadable stay distinct', () => {
  assert.deepEqual(parseAmount('184210.07', 2), { state: 'value', amount: '184210.07', amount_minor: '18421007', reason: null });
  assert.deepEqual(parseAmount('-1250.4', 2), { state: 'value', amount: '-1250.40', amount_minor: '-125040', reason: null });
  assert.equal(parseAmount('(4210.00)', 2).amount_minor, '-421000');
  assert.equal(parseAmount('+7', 2).amount, '7.00');
  for (const z of ['0', '0.00', '-0.00', '(0)']) assert.deepEqual(parseAmount(z, 2), { state: 'zero', amount: '0.00', amount_minor: '0', reason: null }, z);
  for (const a of ['', '   ', null, undefined]) assert.equal(parseAmount(a, 2).state, 'absent');
  for (const u of ['n/a', '1,000.00', '1e5', '(-5)', '12.', true, {}]) assert.equal(parseAmount(u, 2).state, 'unreadable', String(u));
  // No rounding: a non-zero digit past the precision is unreadable; trailing zeros are fine.
  assert.equal(parseAmount('1.005', 2).state, 'unreadable');
  assert.equal(parseAmount('1.000', 2).amount, '1.00');
  // JPY reports to whole yen.
  assert.deepEqual(parseAmount('1500000.00', 0), { state: 'value', amount: '1500000', amount_minor: '1500000', reason: null });
  assert.equal(parseAmount('1500000.5', 0).state, 'unreadable');
  // Past 2^53, still exact.
  assert.equal(parseAmount('92233720368547758.07', 2).amount_minor, '9223372036854775807');
  // A JSON number has passed through a float: only an integer is accepted.
  assert.equal(parseAmount(12, 2).amount, '12.00');
  assert.equal(parseAmount(0.1, 2).state, 'unreadable');
});

test('QuickBooks balance sheet: cash is the BankAccounts total, accounts keyed by id, as-of from the report', () => {
  const s = canonicalize(qbBs());
  assert.equal(s.report, 'balance_sheet'); assert.equal(s.basis, 'accrual'); assert.equal(s.currency, 'USD'); assert.equal(s.precision, 2);
  assert.deepEqual(s.returned, { as_of: '2026-09-30' }); assert.equal(s.window_key, 'as_of:2026-09-30'); assert.equal(s.period_mismatch, false);
  assert.equal(line(s, 'group:BankAccounts').kind, 'cash_total');
  assert.equal(line(s, 'group:BankAccounts').amount, '232959.67');
  assert.equal(line(s, 'account:37').kind, 'cash_account');
  assert.equal(line(s, 'account:37').amount_minor, '-125040');
  assert.equal(line(s, 'account:84').state, 'zero');
  assert.equal(line(s, 'account:33').state, 'absent');
  assert.equal(line(s, 'account:84').kind, 'other');
  const cash = supportedFigure(s, 'cash_balance');
  assert.equal(cash.state, 'recorded');
  assert.equal((cash as any).amount_minor, '23295967', 'the provider total, not a sum Axal made');
  assert.equal(supportedFigure(s, 'revenue').state, 'not_supported');
});

test('QuickBooks P&L: cash basis, a fiscal half-year, a net loss that is profit and never burn', () => {
  const s = canonicalize(qbPl());
  assert.equal(s.basis, 'cash'); assert.deepEqual(s.returned, { start: '2026-04-01', end: '2026-09-30' });
  assert.equal((supportedFigure(s, 'revenue') as any).amount, '40890.50');
  const profit = supportedFigure(s, 'profit') as any;
  assert.equal(profit.amount_minor, '-5951975'); assert.equal(profit.basis, 'cash');
  assert.equal(supportedFigure(s, 'cash_balance').state, 'not_supported');
  const burn = cashChange(s as any, s as any);
  assert.equal(burn.state, 'not_supported');
  assert.match((burn as any).reason, /profit-and-loss result is not cash burn/);
  // A different fiscal window is a different statement identity.
  assert.notEqual(s.window_key, canonicalize(fromQuickBooks(QB_PL, { realm_id: '9130350000000001', requested: { start: '2026-01-01', end: '2026-09-30' } })).window_key);
});

test('Xero: currency and basis come from the request, only the first column is read, parentheses are negative', () => {
  const s = canonicalize(xeroBs());
  assert.equal(s.currency, 'GBP'); assert.deepEqual(s.returned, { as_of: '2026-03-31' });
  assert.equal(line(s, 'section:Bank:total').kind, 'cash_total');
  assert.equal(line(s, 'section:Bank:total').amount, '88120.45', 'the requested date, not the comparison column');
  assert.equal(line(s, 'account:7a9c1d6f-2e3b-4c4d-8f90-1b2c3d4e5f60').state, 'absent');
  assert.equal(line(s, 'account:6f8b0c5e-1d2a-4b3c-9e8f-0a1b2c3d4e5f').kind, 'cash_account');
  assert.equal(line(s, 'account:8b0d2e70-3f4c-4d5e-9a01-2c3d4e5f6071').amount, '-4210.00');
  const p = canonicalize(xeroPl());
  assert.equal(p.basis, 'unknown');
  assert.deepEqual(p.returned, { start: '2025-04-01', end: '2026-03-31' });
  assert.equal(line(p, 'account:be3051a3-6c7f-4081-ad34-5f60718293a4').state, 'unreadable');
  assert.equal((supportedFigure(p, 'revenue') as any).amount, '210340.00');
  assert.equal((supportedFigure(p, 'profit') as any).amount, '10469.88');
  assert.equal(line(p, 'section:Less Operating Expenses:total').kind, 'expense_total');
  assert.equal(xeroDate('1 April 2025'), '2025-04-01'); assert.equal(xeroDate('31 Foo 2025'), null);
});

test('missing lines, missing basis and a returned period that differs from the request', () => {
  const empty = structuredClone(QB_BS);
  empty.Header.Option = [{ Name: 'NoReportData', Value: 'true' }];
  delete empty.Header.ReportBasis;
  const s = canonicalize(qbBs(empty));
  assert.equal(s.lines.length, 0); assert.equal(s.basis, 'unknown');
  assert.equal(supportedFigure(s, 'cash_balance').state, 'not_recorded');
  const noCash = structuredClone(QB_BS);
  noCash.Rows.Row[0].Rows.Row[0].Rows.Row[0].Summary.ColData[1].value = '';
  assert.equal(supportedFigure(canonicalize(qbBs(noCash)), 'cash_balance').state, 'absent');
  const shifted = canonicalize(qbBs(QB_BS, '2026-10-31'));
  assert.equal(shifted.period_mismatch, true, 'the provider answered for another date');
  assert.equal(shifted.window_key, 'as_of:2026-10-31', 'identity is the requested window');
  for (const [mutate, code] of [
    [(i: any) => { i.currency = 'XX'; }, 'currency_invalid'],
    [(i: any) => { i.basis = 'modified_cash'; }, 'basis_invalid'],
    [(i: any) => { i.requested = { as_of: '2026-02-30' }; }, 'requested_period_invalid'],
    [(i: any) => { i.lines.push({ ...i.lines[0] }); }, 'line_key_duplicate'],
    [(i: any) => { i.entity_key = 'realm 1; DROP'; }, 'entity_invalid'],
  ] as const) {
    const input = qbBs(); mutate(input);
    assert.throws(() => canonicalize(input), (e: any) => e instanceof StatementRefusal && e.code === code, code);
  }
});

test('the fingerprint covers what the source said and nothing else', async () => {
  const a = await fingerprint(canonicalize(qbBs()));
  assert.equal(await fingerprint(canonicalize(qbBs())), a);
  const corrected = structuredClone(QB_BS);
  corrected.Rows.Row[0].Rows.Row[0].Rows.Row[0].Rows.Row[0].ColData[1].value = '184210.08';
  assert.notEqual(await fingerprint(canonicalize(qbBs(corrected))), a);
  const retimed = structuredClone(QB_BS); retimed.Header.Time = '2026-11-02T00:00:00Z';
  assert.equal(await fingerprint(canonicalize(qbBs(retimed))), a, 'the read time is not content');
});

test('a ledger figure is set beside other sources, never summed with them', () => {
  const period = { start: '2026-04-01', end: '2026-09-30' };
  const out = sideBySide({ label: 'Total Income', amount_minor: '4089050', currency: 'USD', period }, [
    { source: 'stripe', label: 'Stripe receipts', amount_minor: '4100000', currency: 'usd', period },
    { source: 'mercury', label: 'Mercury deposits', amount_minor: '3900000', currency: 'EUR', period },
    { source: 'stripe', label: 'Stripe receipts, Q3 only', amount_minor: '2000000', currency: 'USD', period: { start: '2026-07-01', end: '2026-09-30' } },
    { source: 'manual', label: 'Typed revenue', amount_minor: null, currency: 'USD', period },
  ]);
  assert.equal(out.ledger.source, 'ledger');
  assert.deepEqual(out.others.map(o => [o.source, o.comparable, o.difference_minor]), [['stripe', true, '10950'], ['mercury', false, null], ['stripe', false, null], ['manual', false, null]]);
  assert.equal(JSON.stringify(out).includes('8189050'), false, 'no total of ledger and Stripe');
  assert.equal('total' in out, false);
});

test('cash change needs two balance sheets of one entity, basis and currency', () => {
  const earlier = { ...canonicalize(qbBs()) };
  const laterBody = structuredClone(QB_BS);
  laterBody.Header.EndPeriod = '2026-10-31';
  laterBody.Rows.Row[0].Rows.Row[0].Rows.Row[0].Summary.ColData[1].value = '201000.00';
  const later = canonicalize(qbBs(laterBody, '2026-10-31'));
  const change = cashChange(earlier as any, later as any) as any;
  assert.deepEqual([change.state, change.from, change.to, change.change_minor], ['recorded', '2026-09-30', '2026-10-31', '-3195967']);
  assert.equal(cashChange(later as any, earlier as any).state, 'not_supported');
  assert.equal(cashChange(earlier as any, { ...later, currency: 'CAD' } as any).state, 'not_supported');
  assert.equal(cashChange(earlier as any, { ...later, basis: 'cash' } as any).state, 'not_supported');
});

// ── The store, over real SQLite ─────────────────────────────────────────────
const FOUNDER = 1, COFOUNDER = 2, ADVISOR = 3, STRANGER = 4, PROJECT = 50, OTHER_PROJECT = 51;
const user = (id: number, founder_id: number | null, role = 'founder') => ({ id, role, founder_id, licences: [role] } as any);
const founder = user(FOUNDER, 10), cofounder = user(COFOUNDER, 20), advisor = user(ADVISOR, 30), stranger = user(STRANGER, 40);
function world() {
  const db = new DatabaseSync(':memory:', { ...SCHEMA_OPTIONS });
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, founder_id) VALUES (?, ?, ?, ?, ?)');
  for (const x of [founder, cofounder, advisor, stranger]) u.run(x.id, 'founder', `Person ${x.id}`, `p${x.id}@example.test`, x.founder_id);
  db.prepare('INSERT INTO projects (id, name, founder_id) VALUES (?, ?, ?)').run(PROJECT, 'Venture', 10);
  db.prepare('INSERT INTO projects (id, name, founder_id) VALUES (?, ?, ?)').run(OTHER_PROJECT, 'Other', 40);
  const m = db.prepare("INSERT INTO project_members (project_id, user_id, role, status) VALUES (?, ?, ?, 'accepted')");
  m.run(PROJECT, COFOUNDER, 'cofounder'); m.run(PROJECT, ADVISOR, 'advisor');
  const i = db.prepare("INSERT INTO integrations (id, uid, user_id, provider_key, status, auth_type) VALUES (?, ?, ?, ?, ?, 'oauth2')");
  i.run(1, 'int-qb-founder', FOUNDER, 'quickbooks', 'active');
  i.run(2, 'int-xero-founder', FOUNDER, 'xero', 'active');
  i.run(3, 'int-qb-cofounder', COFOUNDER, 'quickbooks', 'active');
  i.run(4, 'int-qb-stranger', STRANGER, 'quickbooks', 'active');
  i.run(5, 'int-xero-advisor', ADVISOR, 'xero', 'disconnected');
  return { db, env: { DB: d1Over(db) } as any };
}
const as = (u: any, projectId = PROJECT) => ({ user: u, projectId });
/** Holds the first `n` reads of the latest revision until all `n` writers have made one, so they truly race. */
function raced(env: any, n: number) {
  let waiting: (() => void)[] = [];
  const barrier = () => new Promise<void>(release => { waiting.push(release); if (waiting.length === n) { waiting.forEach(r => r()); waiting = []; n = 0; } });
  return { DB: { ...env.DB, batch: env.DB.batch.bind(env.DB), prepare(sql: string) {
    const stmt = env.DB.prepare(sql);
    if (!/ORDER BY revision DESC LIMIT 1/.test(sql)) return stmt;
    return { bind: (...args: unknown[]) => { const b = stmt.bind(...args); return { first: async () => { const row = await b.first(); if (n) await barrier(); return row; } }; } };
  } } } as any;
}
const count = (db: DatabaseSync, t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as any).n;
const refused = async (p: Promise<unknown>, code: string) => assert.rejects(p, (e: any) => e instanceof StatementRefusal && e.code === code, code);

test('store: a write is atomic, an unchanged resync writes nothing, a correction appends a revision', async () => {
  const w = world();
  const first = await writeSnapshot(w.env, as(founder), 1, qbBs());
  assert.equal(first.state, 'created'); assert.equal(first.revision, 1);
  const lines = count(w.db, 'financial_statement_lines');
  assert.equal(lines, canonicalize(qbBs()).lines.length);
  const again = await writeSnapshot(w.env, as(founder), 1, qbBs());
  assert.deepEqual(again, { state: 'unchanged', uid: first.uid, revision: 1 });
  assert.equal(count(w.db, 'financial_statement_snapshots'), 1); assert.equal(count(w.db, 'financial_statement_lines'), lines);

  const corrected = structuredClone(QB_BS);
  corrected.Rows.Row[0].Rows.Row[0].Rows.Row[0].Summary.ColData[1].value = '232959.68';
  const second = await writeSnapshot(w.env, as(founder), 1, qbBs(corrected)) as any;
  assert.deepEqual([second.state, second.revision, second.supersedes], ['created', 2, first.uid]);
  // A→B→A is a third revision, not a return to the first.
  const third = await writeSnapshot(w.env, as(founder), 1, qbBs()) as any;
  assert.deepEqual([third.state, third.revision, third.supersedes], ['created', 3, second.uid]);

  const latest = await readLatest(w.env, as(founder));
  assert.equal(latest.length, 1);
  assert.deepEqual([latest[0].uid, latest[0].revision, latest[0].revisions, latest[0].superseded_by], [third.uid, 3, 3, null]);
  assert.equal(latest[0].lines.find((l: any) => l.source_key === 'group:BankAccounts')!.amount, '232959.67');
  // A failed batch leaves nothing behind.
  const before = [count(w.db, 'financial_statement_snapshots'), count(w.db, 'financial_statement_lines')];
  w.db.exec("CREATE TRIGGER fail_line BEFORE INSERT ON financial_statement_lines WHEN NEW.position = 3 BEGIN SELECT RAISE(ABORT, 'boom'); END");
  await assert.rejects(writeSnapshot(w.env, as(founder), 1, qbPl()), /boom/);
  assert.deepEqual([count(w.db, 'financial_statement_snapshots'), count(w.db, 'financial_statement_lines')], before);
});

test('store: duplicate and concurrent delivery, and distinct identities', async () => {
  const w = world();
  const race = raced(w.env, 3);
  const same = await Promise.all([1, 2, 3].map(() => writeSnapshot(race, as(founder), 1, qbBs())));
  assert.equal(count(w.db, 'financial_statement_snapshots'), 1);
  assert.equal(new Set(same.map(r => r.uid)).size, 1);
  assert.deepEqual(same.map(r => r.state).sort(), ['created', 'unchanged', 'unchanged']);
  const corrected = structuredClone(QB_BS);
  corrected.Rows.Row[0].Rows.Row[0].Rows.Row[0].Summary.ColData[1].value = '1.00';
  const race2 = raced(w.env, 2);
  const racing = await Promise.all([writeSnapshot(race2, as(founder), 1, qbBs(corrected)), writeSnapshot(race2, as(cofounder), 3, qbBs(corrected))]);
  assert.deepEqual(racing.map(r => r.revision).sort(), [2, 2], 'one created revision 2, the other found it');
  assert.deepEqual(racing.map(r => r.state).sort(), ['created', 'unchanged']);
  // Two different corrections racing: both land, as revisions 3 and 4, each superseding the one before.
  const a = structuredClone(QB_BS), b = structuredClone(QB_BS);
  a.Rows.Row[0].Rows.Row[0].Rows.Row[0].Summary.ColData[1].value = '2.00';
  b.Rows.Row[0].Rows.Row[0].Rows.Row[0].Summary.ColData[1].value = '3.00';
  const race3 = raced(w.env, 2);
  const both = await Promise.all([writeSnapshot(race3, as(founder), 1, qbBs(a)), writeSnapshot(race3, as(founder), 1, qbBs(b))]) as any[];
  assert.deepEqual(both.map(r => [r.state, r.revision]).sort(), [['created', 3], ['created', 4]]);
  const chain = w.db.prepare("SELECT revision, (SELECT revision FROM financial_statement_snapshots p WHERE p.id = s.supersedes_id) AS prev FROM financial_statement_snapshots s WHERE report = 'balance_sheet' ORDER BY revision").all() as any[];
  assert.deepEqual(chain.map(r => [r.revision, r.prev]), [[1, null], [2, 1], [3, 2], [4, 3]]);
  // Window, basis, currency, report and provider each make a separate statement.
  await writeSnapshot(w.env, as(founder), 1, qbPl());
  await writeSnapshot(w.env, as(founder), 2, xeroBs());
  await writeSnapshot(w.env, as(founder), 2, xeroPl());
  await writeSnapshot(w.env, as(founder), 2, { ...xeroPl(), basis: 'cash' });
  await writeSnapshot(w.env, as(founder), 1, qbBs(QB_BS, '2026-06-30'));
  const latest = await readLatest(w.env, as(founder));
  assert.equal(latest.length, 6);
  assert.deepEqual((await readLatest(w.env, as(founder), { report: 'profit_and_loss' })).map(s => `${s.provider}:${s.basis}`).sort(), ['quickbooks:cash', 'xero:cash', 'xero:unknown']);
});

test('store: a pinned revision stays readable and points at its successor', async () => {
  const w = world();
  const first = await writeSnapshot(w.env, as(founder), 1, qbBs());
  const pin = await pinRevision(w.env, as(founder), first.uid, 'Seed data room, September close');
  assert.deepEqual(await pinRevision(w.env, as(founder), first.uid, 'Seed data room, September close'), pin, 'pinning twice is one pin');
  const corrected = structuredClone(QB_BS);
  corrected.Rows.Row[0].Rows.Row[0].Rows.Row[0].Summary.ColData[1].value = '230000.00';
  const second = await writeSnapshot(w.env, as(founder), 1, qbBs(corrected));
  const old = await readRevision(w.env, as(founder), first.uid);
  assert.equal(old.superseded_by, second.uid);
  assert.equal(old.lines.find(l => l.source_key === 'group:BankAccounts')!.amount, '232959.67', 'the pinned figure is what the source said then');
  const pins = await readPins(w.env, as(founder));
  assert.deepEqual(pins.map((p: any) => [p.snapshot_uid, p.revision, p.superseded_by]), [[first.uid, 1, second.uid]]);
  assert.throws(() => w.db.prepare("UPDATE financial_statement_lines SET amount = '1.00'").run(), /financial_statement_line_immutable/);
  assert.throws(() => w.db.prepare('UPDATE financial_statement_snapshots SET revision = 9').run(), /financial_statement_snapshot_immutable/);
});

test('store: reads and writes are guarded by venture, member role and the writer\'s own connection', async () => {
  const w = world();
  const { uid } = await writeSnapshot(w.env, as(founder), 1, qbBs());
  // Co-founder writes through their own connection; an advisor reads only.
  assert.equal((await writeSnapshot(w.env, as(cofounder), 3, qbPl())).state, 'created');
  assert.equal((await readLatest(w.env, as(advisor))).length, 2);
  await refused(writeSnapshot(w.env, as(advisor), 5, xeroPl()), 'project_not_found');
  await refused(pinRevision(w.env, as(advisor), uid, 'x'), 'project_not_found');
  // A stranger sees nothing, by project or by revision uid.
  await refused(readLatest(w.env, as(stranger)), 'project_not_found');
  await refused(readRevision(w.env, as(stranger), uid), 'project_not_found');
  await refused(readRevision(w.env, as(stranger, OTHER_PROJECT), uid), 'snapshot_not_found');
  await refused(writeSnapshot(w.env, as(stranger), 4, qbBs()), 'project_not_found');
  // Someone else's connection, the wrong provider and a disconnected one are refused.
  await refused(writeSnapshot(w.env, as(cofounder), 1, qbBs()), 'connection_not_found');
  await refused(writeSnapshot(w.env, as(founder), 2, qbBs()), 'connection_not_found');
  w.db.prepare("UPDATE integrations SET status = 'disconnected' WHERE id = 1").run();
  await refused(writeSnapshot(w.env, as(founder), 1, qbPl()), 'connection_not_found');
  await refused(pinRevision(w.env, as(founder), uid, ' '), 'purpose_invalid');
});

test('store: statements never write runway inputs; the Use of Funds runway read is unchanged', async () => {
  const w = world();
  w.db.prepare("INSERT INTO project_metrics (project_id, cash_balance, net_burn, source, snapshot_date) VALUES (?, 120000, 15000, 'manual', '2026-09-30')").run(PROJECT);
  const scope = { projectId: PROJECT, user: founder, founderUserId: FOUNDER };
  const before = await runwayToday(w.env, scope as any, true);
  assert.equal(before.chosen?.value !== null, true);
  const tables = ['project_metrics', 'mercury_raise_facts', 'revenue_entries'];
  const counts = tables.map(t => count(w.db, t));
  await writeSnapshot(w.env, as(founder), 1, qbBs());
  await writeSnapshot(w.env, as(founder), 1, qbPl());
  await writeSnapshot(w.env, as(founder), 2, xeroPl());
  assert.deepEqual(tables.map(t => count(w.db, t)), counts);
  assert.deepEqual(await runwayToday(w.env, scope as any, true), before);
});
