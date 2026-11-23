/**
 * D5834 (#5834) — QuickBooks Online read-only reports, part 1: the report
 * client and the sync into the D5833 store.
 *
 * Over the synthetic QuickBooks fixtures and real SQLite built from every
 * migration, with an injected fetch (no network):
 *   · only ProfitAndLoss and BalanceSheet for the bound realm, GET only; no
 *     other path, method or realm can be asked for;
 *   · sandbox and production on their own hosts, chosen by the connection;
 *   · 401, 403 (scope denial), 429 with its wait, 5xx, faults, oversized bodies;
 *   · two realms on one account, and the wrong venture;
 *   · an interrupted sync keeps what it wrote, does not advance last_synced_at,
 *     and a retry duplicates nothing;
 *   · a disconnect stops syncing and leaves a pinned revision readable;
 *   · no statement, figure or identifier reaches a log or `last_error`.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/quickbooks_reports_5834.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { StatementRefusal } from '../src/services/financialStatements/contract.ts';
import { fetchReport, HOSTS, MAX_REPORT_BYTES, QuickBooksFailure, REPORT_PATHS, reportUrl } from '../src/services/financialStatements/quickbooksClient.ts';
import { MAX_STATEMENTS, syncQuickBooks } from '../src/services/financialStatements/quickbooksSync.ts';
import { pinRevision, readPins, readRevision } from '../src/services/financialStatements/store.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/accounting/${name}.json`, import.meta.url), 'utf8');
const BS = fixture('quickbooks_balance_sheet'), PL = fixture('quickbooks_profit_and_loss');
const REALM_A = '9130350000000001', REALM_B = '9130350000000002';
const PL_PERIOD = { start: '2026-01-01', end: '2026-09-30' }, BS_PERIOD = { as_of: '2026-09-30' };

type Call = { url: string; init: RequestInit | undefined };
/** A fetch that answers each allowed report from a fixture, or from `override`, and records every call. */
function intuit(override?: (url: URL, n: number) => Response | null) {
  const calls: Call[] = [];
  const fn = (async (input: any, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url: String(input), init });
    const o = override?.(url, calls.length);
    if (o) return o;
    if (url.pathname.endsWith('/reports/BalanceSheet')) return new Response(BS, { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.pathname.endsWith('/reports/ProfitAndLoss')) return new Response(PL, { status: 200, headers: { 'Content-Type': 'application/json' } });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { fn, calls };
}
const failsWith = async (p: Promise<unknown>, code: string) => assert.rejects(p, (e: any) => (e instanceof QuickBooksFailure || e instanceof StatementRefusal) && e.code === code, code);
const deps = (f: typeof fetch) => ({ fetch: f, accessToken: async () => 'token-test' });

// ── The client ──────────────────────────────────────────────────────────────
test('client: the allowlist is exactly the two report paths, for the bound realm, on the connection’s host', () => {
  assert.deepEqual(Object.values(REPORT_PATHS).sort(), ['reports/BalanceSheet', 'reports/ProfitAndLoss']);
  const pl = new URL(reportUrl('sandbox', REALM_A, 'profit_and_loss', PL_PERIOD, 'accrual'));
  assert.equal(pl.origin, HOSTS.sandbox);
  assert.equal(pl.pathname, `/v3/company/${REALM_A}/reports/ProfitAndLoss`);
  assert.deepEqual(Object.fromEntries(pl.searchParams), { start_date: '2026-01-01', end_date: '2026-09-30', accounting_method: 'Accrual', minorversion: '75' });
  const bs = new URL(reportUrl('production', REALM_A, 'balance_sheet', BS_PERIOD, 'cash'));
  assert.equal(bs.origin, HOSTS.production);
  assert.equal(bs.pathname, `/v3/company/${REALM_A}/reports/BalanceSheet`);
  assert.equal(bs.searchParams.get('end_date'), '2026-09-30');
  assert.equal(bs.searchParams.get('accounting_method'), 'Cash');
  // An unknown basis leaves the company default; the report header then says which it used.
  assert.equal(new URL(reportUrl('sandbox', REALM_A, 'balance_sheet', BS_PERIOD, 'unknown')).searchParams.has('accounting_method'), false);
  assert.notEqual(HOSTS.sandbox, HOSTS.production);
});

test('client: no other report, transaction, query or write path can be named, and a realm cannot smuggle a path', () => {
  for (const r of ['Invoice', 'TransactionList', 'query', 'GeneralLedger', 'constructor', '__proto__', '../Invoice'])
    assert.throws(() => reportUrl('sandbox', REALM_A, r as any, PL_PERIOD, 'accrual'), (e: any) => e.code === 'report_not_allowed', r);
  for (const realm of ['', 'abc', `${REALM_A}/invoice`, '../1', `${REALM_A}?x=1`, '1'.repeat(21)])
    assert.throws(() => reportUrl('sandbox', realm, 'balance_sheet', BS_PERIOD, 'accrual'), (e: any) => e.code === 'realm_invalid', realm);
  for (const envName of ['staging', 'constructor', ''])
    assert.throws(() => reportUrl(envName as any, REALM_A, 'balance_sheet', BS_PERIOD, 'accrual'), (e: any) => e.code === 'environment_invalid');
  // Periods are checked by shape, by calendar and by order.
  for (const [report, period] of [['profit_and_loss', BS_PERIOD], ['balance_sheet', PL_PERIOD], ['profit_and_loss', { start: '2026-09-30', end: '2026-01-01' }],
    ['balance_sheet', { as_of: '2026-02-30' }], ['balance_sheet', { as_of: '2026-9-30' }]] as const)
    assert.throws(() => reportUrl('sandbox', REALM_A, report as any, period as any, 'accrual'), (e: any) => e.code === 'period_invalid', JSON.stringify(period));
  assert.throws(() => reportUrl('sandbox', REALM_A, 'balance_sheet', BS_PERIOD, 'modified_cash' as any), (e: any) => e.code === 'basis_invalid');
});

test('client: every request is a body-less GET that refuses redirects; the source names no other method', async () => {
  const { fn, calls } = intuit();
  await fetchReport({ fetch: fn, accessToken: 't', environment: 'sandbox' }, REALM_A, 'balance_sheet', BS_PERIOD, 'accrual');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init?.method, 'GET');
  assert.equal(calls[0].init?.body, undefined);
  assert.equal(calls[0].init?.redirect, 'error');
  assert.equal((calls[0].init?.headers as any).Authorization, 'Bearer t');
  for (const f of ['quickbooksClient.ts', 'quickbooksSync.ts']) {
    const src = readFileSync(new URL(`../src/services/financialStatements/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\b(POST|PUT|PATCH|DELETE)\b/, f);
    assert.doesNotMatch(src, /console\./, f);
  }
});

test('client: 401, 403, 429, 5xx, a fault, a refused status, unreadable and oversized bodies each refuse with a code only', async () => {
  const run = (res: () => Response) => fetchReport({ fetch: (async () => res()) as any, accessToken: 't', environment: 'sandbox' }, REALM_A, 'profit_and_loss', PL_PERIOD, 'accrual');
  await failsWith(run(() => new Response('{"Fault":{}}', { status: 401 })), 'quickbooks_unauthorized');
  await failsWith(run(() => new Response('{"Fault":{}}', { status: 403 })), 'quickbooks_scope_denied');
  await assert.rejects(run(() => new Response('', { status: 429, headers: { 'Retry-After': '12' } })), (e: any) => e.code === 'quickbooks_rate_limited' && e.retry_after_s === 12);
  await assert.rejects(run(() => new Response('', { status: 429 })), (e: any) => e.code === 'quickbooks_rate_limited' && e.retry_after_s === null);
  await failsWith(run(() => new Response('', { status: 503 })), 'quickbooks_unavailable');
  await failsWith(run(() => new Response('{}', { status: 400 })), 'quickbooks_refused');
  await failsWith(run(() => new Response('{"Fault":{"Error":[{"Message":"secret detail"}]}}', { status: 200 })), 'quickbooks_fault');
  await failsWith(run(() => new Response('<html>', { status: 200 })), 'report_invalid');
  await failsWith(run(() => new Response('{}', { status: 200, headers: { 'Content-Length': String(MAX_REPORT_BYTES + 1) } })), 'report_too_large');
  await failsWith(run(() => new Response(`"${'x'.repeat(MAX_REPORT_BYTES)}"`, { status: 200 })), 'report_too_large');
  await failsWith(fetchReport({ fetch: (async () => { throw new Error('dns'); }) as any, accessToken: 't', environment: 'sandbox' }, REALM_A, 'profit_and_loss', PL_PERIOD, 'accrual'), 'quickbooks_unreachable');
  await failsWith(fetchReport({ fetch: (async () => new Response(PL)) as any, accessToken: '', environment: 'sandbox' }, REALM_A, 'profit_and_loss', PL_PERIOD, 'accrual'), 'quickbooks_unauthorized');
  // The refusal never carries the body.
  await assert.rejects(run(() => new Response('{"Fault":{"Error":[{"Message":"secret detail"}]}}', { status: 200 })), (e: any) => !String(e.message).includes('secret'));
});

// ── The sync, over real SQLite ──────────────────────────────────────────────
const FOUNDER = 1, COFOUNDER = 2, STRANGER = 4, PROJECT = 50, OTHER_PROJECT = 51;
const user = (id: number, founder_id: number | null) => ({ id, role: 'founder', founder_id, licences: ['founder'] } as any);
const founder = user(FOUNDER, 10), cofounder = user(COFOUNDER, 20), stranger = user(STRANGER, 40);
function world() {
  const db = new DatabaseSync(':memory:', { ...SCHEMA_OPTIONS });
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, founder_id) VALUES (?, ?, ?, ?, ?)');
  for (const x of [founder, cofounder, stranger]) u.run(x.id, 'founder', `Person ${x.id}`, `p${x.id}@example.test`, x.founder_id);
  db.prepare('INSERT INTO projects (id, name, founder_id) VALUES (?, ?, ?)').run(PROJECT, 'Venture', 10);
  db.prepare('INSERT INTO projects (id, name, founder_id) VALUES (?, ?, ?)').run(OTHER_PROJECT, 'Other', 40);
  db.prepare("INSERT INTO project_members (project_id, user_id, role, status) VALUES (?, ?, 'cofounder', 'accepted')").run(PROJECT, COFOUNDER);
  const i = db.prepare("INSERT INTO integrations (id, uid, user_id, provider_key, status, auth_type, external_account_id, config_json) VALUES (?, ?, ?, 'quickbooks', ?, 'oauth2', ?, ?)");
  i.run(1, 'int-qb-founder', FOUNDER, 'active', REALM_A, JSON.stringify({ project_id: PROJECT, environment: 'sandbox' }));
  i.run(2, 'int-qb-cofounder', COFOUNDER, 'active', REALM_B, JSON.stringify({ project_id: PROJECT, environment: 'production' }));
  i.run(4, 'int-qb-stranger', STRANGER, 'active', REALM_A, JSON.stringify({ project_id: OTHER_PROJECT, environment: 'sandbox' }));
  return { db, env: { DB: d1Over(db) } as any };
}
const as = (u: any, projectId = PROJECT) => ({ user: u, projectId });
const BOTH = { statements: [{ report: 'balance_sheet' as const, period: BS_PERIOD }, { report: 'profit_and_loss' as const, period: PL_PERIOD }], basis: 'accrual' as const };
const count = (db: DatabaseSync, t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as any).n;
const conn = (db: DatabaseSync, id: number) => ({ ...(db.prepare('SELECT last_synced_at, last_error FROM integrations WHERE id = ?').get(id) as any) });

test('sync: both statements land as revisions for the bound realm; a retry writes nothing new', async () => {
  const w = world();
  const { fn, calls } = intuit();
  const out = await syncQuickBooks(w.env, as(founder), 1, BOTH, deps(fn));
  assert.equal(out.state, 'complete');
  assert.deepEqual(out.written.map(x => [x.report, x.state, x.revision]), [['balance_sheet', 'created', 1], ['profit_and_loss', 'created', 1]]);
  assert.ok(calls.every(c => c.url.startsWith(`${HOSTS.sandbox}/v3/company/${REALM_A}/reports/`)));
  assert.ok(calls.every(c => new URL(c.url).searchParams.get('accounting_method') === 'Accrual'));
  const cash = intuit();
  await syncQuickBooks(w.env, as(founder), 1, { ...BOTH, basis: 'cash' }, deps(cash.fn));
  assert.deepEqual(cash.calls.map(c => new URL(c.url).searchParams.get('accounting_method')), ['Cash', 'Cash']);
  const rows = w.db.prepare('SELECT DISTINCT entity_key, integration_id FROM financial_statement_snapshots').all() as any[];
  assert.deepEqual(rows.map(r => [r.entity_key, r.integration_id]), [[REALM_A, 1]]);
  assert.ok(conn(w.db, 1).last_synced_at); assert.equal(conn(w.db, 1).last_error, null);
  const before = [count(w.db, 'financial_statement_snapshots'), count(w.db, 'financial_statement_lines')];
  const again = await syncQuickBooks(w.env, as(founder), 1, BOTH, deps(fn));
  assert.deepEqual(again.written.map(x => x.state), ['unchanged', 'unchanged']);
  assert.deepEqual([count(w.db, 'financial_statement_snapshots'), count(w.db, 'financial_statement_lines')], before);
});

test('sync: a corrected report from QuickBooks appends a new revision', async () => {
  const w = world();
  await syncQuickBooks(w.env, as(founder), 1, BOTH, deps(intuit().fn));
  const corrected = BS.replace(/"value": "(\d+)\.(\d\d)"/, (_m, a, b) => `"value": "${Number(a) + 1}.${b}"`);
  assert.notEqual(corrected, BS);
  const { fn } = intuit((u) => (u.pathname.endsWith('BalanceSheet') ? new Response(corrected, { status: 200 }) : null));
  const out = await syncQuickBooks(w.env, as(founder), 1, BOTH, deps(fn));
  assert.deepEqual(out.written.map(x => [x.report, x.state, x.revision]), [['balance_sheet', 'created', 2], ['profit_and_loss', 'unchanged', 1]]);
});

test('sync: two realms on one venture stay apart, each on its own connection’s host', async () => {
  const w = world();
  const a = intuit(), b = intuit();
  await syncQuickBooks(w.env, as(founder), 1, BOTH, deps(a.fn));
  await syncQuickBooks(w.env, as(cofounder), 2, BOTH, deps(b.fn));
  assert.ok(a.calls.every(c => c.url.startsWith(`${HOSTS.sandbox}/v3/company/${REALM_A}/`)));
  assert.ok(b.calls.every(c => c.url.startsWith(`${HOSTS.production}/v3/company/${REALM_B}/`)));
  const rows = w.db.prepare('SELECT entity_key, COUNT(*) AS n FROM financial_statement_snapshots GROUP BY entity_key ORDER BY entity_key').all() as any[];
  assert.deepEqual(rows.map(r => [r.entity_key, r.n]), [[REALM_A, 2], [REALM_B, 2]]);
  // One member cannot sync through another's connection, whichever realm it holds.
  await failsWith(syncQuickBooks(w.env, as(founder), 2, BOTH, deps(a.fn)), 'connection_not_found');
});

test('sync: the wrong venture, an unbound realm or environment, and a stranger are refused before anything is fetched', async () => {
  const w = world();
  const { fn, calls } = intuit();
  // The founder's connection is bound to PROJECT; the stranger's to OTHER_PROJECT.
  await failsWith(syncQuickBooks(w.env, as(stranger), 4, BOTH, deps(fn)), 'project_not_found');
  await failsWith(syncQuickBooks(w.env, as(stranger, OTHER_PROJECT), 1, BOTH, deps(fn)), 'connection_not_found');
  w.db.prepare("INSERT INTO project_members (project_id, user_id, role, status) VALUES (?, ?, 'cofounder', 'accepted')").run(OTHER_PROJECT, FOUNDER);
  await failsWith(syncQuickBooks(w.env, as(founder, OTHER_PROJECT), 1, BOTH, deps(fn)), 'realm_not_bound_to_venture');
  w.db.prepare("UPDATE integrations SET config_json = ? WHERE id = 1").run(JSON.stringify({ project_id: PROJECT, environment: 'staging' }));
  await failsWith(syncQuickBooks(w.env, as(founder), 1, BOTH, deps(fn)), 'environment_not_bound');
  w.db.prepare("UPDATE integrations SET config_json = 'not json' WHERE id = 1").run();
  await failsWith(syncQuickBooks(w.env, as(founder), 1, BOTH, deps(fn)), 'realm_not_bound_to_venture');
  w.db.prepare("UPDATE integrations SET external_account_id = NULL WHERE id = 1").run();
  await failsWith(syncQuickBooks(w.env, as(founder), 1, BOTH, deps(fn)), 'realm_not_bound');
  // Requests outside the allowlist or the limit.
  await failsWith(syncQuickBooks(w.env, as(cofounder), 2, { statements: [{ report: 'Invoice' as any, period: PL_PERIOD }], basis: 'accrual' }, deps(fn)), 'report_not_allowed');
  await failsWith(syncQuickBooks(w.env, as(cofounder), 2, { statements: [], basis: 'accrual' }, deps(fn)), 'statements_invalid');
  await failsWith(syncQuickBooks(w.env, as(cofounder), 2, { statements: Array(MAX_STATEMENTS + 1).fill(BOTH.statements[0]), basis: 'accrual' }, deps(fn)), 'statements_invalid');
  await failsWith(syncQuickBooks(w.env, as(cofounder), 2, { ...BOTH, basis: 'mixed' as any }, deps(fn)), 'basis_invalid');
  assert.equal(calls.length, 0);
  assert.equal(count(w.db, 'financial_statement_snapshots'), 0);
});

test('sync: scope denial, 401 and 429 write nothing and record only the code; last_synced_at stays put', async () => {
  for (const [status, code, retry] of [[403, 'quickbooks_scope_denied', null], [401, 'quickbooks_unauthorized', null], [429, 'quickbooks_rate_limited', 30]] as const) {
    const w = world();
    const { fn } = intuit(() => new Response(`{"Fault":{"Error":[{"Detail":"${REALM_A} secret"}]}}`, { status, headers: { 'Retry-After': '30' } }));
    const out: any = await syncQuickBooks(w.env, as(founder), 1, BOTH, deps(fn));
    assert.equal(out.state, 'incomplete');
    assert.deepEqual(out.failed, { report: 'balance_sheet', code, retry_after_s: retry });
    assert.deepEqual(out.written, []);
    assert.equal(count(w.db, 'financial_statement_snapshots'), 0);
    assert.deepEqual(conn(w.db, 1), { last_synced_at: null, last_error: code });
  }
});

test('sync: an interrupted sync keeps what it wrote; the retry completes without duplicating it', async () => {
  const w = world();
  const fail = intuit((u) => (u.pathname.endsWith('ProfitAndLoss') ? new Response('', { status: 503 }) : null));
  const first: any = await syncQuickBooks(w.env, as(founder), 1, BOTH, deps(fail.fn));
  assert.equal(first.state, 'incomplete');
  assert.deepEqual(first.written.map((x: any) => [x.report, x.state]), [['balance_sheet', 'created']]);
  assert.equal(first.failed.code, 'quickbooks_unavailable');
  assert.deepEqual(conn(w.db, 1), { last_synced_at: null, last_error: 'quickbooks_unavailable' });
  // A token source that fails mid-way is an interruption too.
  let n = 0;
  const flaky = { fetch: intuit().fn, accessToken: async () => { n += 1; if (n === 2) throw new QuickBooksFailure('quickbooks_unauthorized'); return 't'; } };
  const second: any = await syncQuickBooks(w.env, as(founder), 1, BOTH, flaky);
  assert.deepEqual([second.state, second.failed.code, second.written.map((x: any) => x.state)], ['incomplete', 'quickbooks_unauthorized', ['unchanged']]);
  const done = await syncQuickBooks(w.env, as(founder), 1, BOTH, deps(intuit().fn));
  assert.deepEqual(done.written.map(x => [x.report, x.state, x.revision]), [['balance_sheet', 'unchanged', 1], ['profit_and_loss', 'created', 1]]);
  assert.equal(count(w.db, 'financial_statement_snapshots'), 2);
  assert.ok(conn(w.db, 1).last_synced_at); assert.equal(conn(w.db, 1).last_error, null);
});

test('sync: a report of the wrong kind, or one the adapter cannot read, is refused and not written', async () => {
  const w = world();
  const swapped = intuit((u) => (u.pathname.endsWith('BalanceSheet') ? new Response(PL, { status: 200 }) : null));
  const out: any = await syncQuickBooks(w.env, as(founder), 1, BOTH, deps(swapped.fn));
  assert.equal(out.failed.code, 'report_mismatch');
  const junk = intuit(() => new Response('{"Header":{"ReportName":"Invoice"}}', { status: 200 }));
  assert.equal(((await syncQuickBooks(w.env, as(founder), 1, BOTH, deps(junk.fn))) as any).failed.code, 'report_invalid');
  assert.equal(count(w.db, 'financial_statement_snapshots'), 0);
});

test('sync: a disconnect stops syncing, and a pinned revision stays readable', async () => {
  const w = world();
  const out = await syncQuickBooks(w.env, as(founder), 1, BOTH, deps(intuit().fn));
  const bs = out.written.find(x => x.report === 'balance_sheet')!;
  await pinRevision(w.env, as(founder), bs.uid, 'Board pack Q3');
  w.db.prepare("UPDATE integrations SET status = 'disconnected' WHERE id = 1").run();
  const { fn, calls } = intuit();
  await failsWith(syncQuickBooks(w.env, as(founder), 1, BOTH, deps(fn)), 'connection_not_found');
  assert.equal(calls.length, 0);
  const pins = await readPins(w.env, as(founder));
  assert.deepEqual(pins.map((p: any) => [p.purpose, p.snapshot_uid, p.superseded_by]), [['Board pack Q3', bs.uid, null]]);
  const rev: any = await readRevision(w.env, as(founder), bs.uid);
  assert.equal(rev.entity_key, REALM_A);
  assert.ok(rev.lines.length > 0);
});

test('sync: nothing is logged, and last_error never holds a figure or an identifier', async () => {
  const w = world();
  const seen: string[] = [];
  const keep = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const k of Object.keys(keep) as (keyof typeof keep)[]) (console as any)[k] = (...a: unknown[]) => { seen.push(a.map(String).join(' ')); };
  try {
    await syncQuickBooks(w.env, as(founder), 1, BOTH, deps(intuit().fn));
    await syncQuickBooks(w.env, as(founder), 1, BOTH, deps(intuit(() => new Response(`{"Fault":"${REALM_A}"}`, { status: 200 })).fn));
  } finally { Object.assign(console, keep); }
  assert.deepEqual(seen, []);
  assert.match(conn(w.db, 1).last_error, /^[a-z_]+$/);
});
