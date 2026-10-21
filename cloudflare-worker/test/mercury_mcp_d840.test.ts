/**
 * D840 (#2346) — the MCP client and the typed reads, against the fake server.
 *
 *  1. `MERCURY_READ_TOOLS` is pinned, and names no send, request, transfer,
 *     approval, create, edit or update tool.
 *  2. A session initializes, carries the server's session id, and offers only
 *     the listed tools the server lists.
 *  3. A tool off the list, or one the server does not offer, is refused before
 *     any request.
 *  4. Each typed read returns parsed data and drops account and routing
 *     numbers, the EIN, emails, addresses and download links.
 *  5. An event-stream answer reads the same as a JSON one.
 *  6. A 401 at open tries the refresh once; the budget bounds the requests.
 *  7. Only `reads.ts` imports `mcp.ts`, and no token reaches a log.
 *  8. The feeds' reader gives the same organization, accounts and lines on the MCP path.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/mercury_mcp_d840.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { MERCURY_READ_TOOLS, MCP_REQUEST_BUDGET, openMercuryMcp } from '../src/services/mercury/mcp.ts';
import { mcpBankReader, openMercuryReads, scopePermission } from '../src/services/mercury/reads.ts';
import { FAKE_ACC_A, FAKE_ACC_B, FAKE_WRITE_TOOLS, fakeTx, signedInFake } from './_mercury_mcp_fake.mjs';

test('1. the read-tool list is pinned and names no tool that writes or moves money', () => {
  assert.deepEqual([...MERCURY_READ_TOOLS], [
    'getOrganization', 'getAccounts', 'getAccount', 'listTransactions', 'getTransactionById', 'getCashflowSummary',
    'getTreasury', 'getAccountStatements', 'listInvoices', 'listCustomers', 'getRecipients', 'getSafeRequests', 'listCategories',
  ]);
  assert.ok(Object.isFrozen(MERCURY_READ_TOOLS));
  for (const t of MERCURY_READ_TOOLS) assert.doesNotMatch(t, /send|request(?!s$)|transfer|approv|create|edit|update|delete|pay/i, t);
  for (const t of FAKE_WRITE_TOOLS) assert.ok(!MERCURY_READ_TOOLS.includes(t), t);
});

test('2. a session initializes, keeps the session id, and offers only listed tools the server lists', async () => {
  const { fake, accessToken } = signedInFake();
  const s = await openMercuryMcp({ accessToken, fetcher: fake.fetch });
  assert.deepEqual(fake.calls.map((c) => c.rpc), ['initialize', 'notifications/initialized', 'tools/list']);
  assert.ok(fake.calls.every((c) => c.method === 'POST' && c.redirect === 'manual' && c.authorized));
  assert.equal(fake.calls[1].session, 'fake-session-1');
  assert.deepEqual([...s.offered], [...MERCURY_READ_TOOLS]);
  for (const w of FAKE_WRITE_TOOLS) assert.ok(!s.offered.includes(w), w);
  await s.callTool('getOrganization');
  assert.equal(fake.calls.at(-1)!.session, 'fake-session-1');
});

test('3. a tool off the list, or not offered by the server, is refused before any request', async () => {
  const { fake, accessToken } = signedInFake();
  const s = await openMercuryMcp({ accessToken, fetcher: fake.fetch });
  const before = fake.calls.length;
  for (const name of [...FAKE_WRITE_TOOLS, 'getUsers', 'getAttachment', 'listCards']) {
    await assert.rejects(() => s.callTool(name, {}), (e: any) => e.code === 'path_not_allowed', name);
  }
  assert.equal(fake.calls.length, before, 'no request was made');
  fake.state.tools = ['getOrganization'];
  const narrow = await openMercuryMcp({ accessToken, fetcher: fake.fetch });
  const n = fake.calls.length;
  await assert.rejects(() => narrow.callTool('getAccounts'), (e: any) => e.code === 'path_not_allowed');
  assert.equal(fake.calls.length, n);
  assert.deepEqual(fake.toolCalls(), []);
});

test('4. every typed read returns parsed data, and no number, EIN, email, address or link survives', async () => {
  const { fake, accessToken } = signedInFake();
  fake.state.data.transactions = [
    { id: fakeTx(1), accountId: FAKE_ACC_A, amount: 125.5, postedAt: '2026-09-03T12:00:00Z', createdAt: '2026-09-03T10:00:00Z', status: 'sent', kind: 'externalTransfer', counterpartyName: 'Customer Co', externalMemo: 'ref 123456789012' },
    { id: fakeTx(2), accountId: FAKE_ACC_B, amount: -40, postedAt: '2026-09-04T12:00:00Z', createdAt: '2026-09-04T10:00:00Z', status: 'sent', kind: 'debitCardTransaction', counterpartyName: 'Vendor Co' },
  ];
  const r = await openMercuryReads({ accessToken, fetcher: fake.fetch });
  const out: Record<string, unknown> = {
    organization: await r.organization(),
    accounts: await r.accounts(),
    account: await r.account(FAKE_ACC_A),
    transactions: await r.transactions({ accountIds: [FAKE_ACC_A] }),
    transaction: await r.transaction(fakeTx(2)),
    missing: await r.transaction(fakeTx(99)),
    cashflow: await r.cashflowSummary({ monthsBack: 3 }),
    treasury: await r.treasury(),
    statements: await r.statements(FAKE_ACC_A),
    invoices: await r.invoices(),
    customers: await r.customers(),
    recipients: await r.recipients(),
    safes: await r.safeRequests(),
    categories: await r.categories(),
  };
  assert.deepEqual(out.organization, { id: 'org-mcp-own', legal_name: 'Own Venture Inc' });
  assert.deepEqual((out.accounts as any[]).map((a) => [a.last_four, a.available_cents]), [['4242', 110000], ['1357', 500000]]);
  assert.equal((out.account as any).last_four, '4242');
  const txs = (out.transactions as any).transactions;
  assert.deepEqual(txs.map((t: any) => [t.amount_cents, t.mercury_account_id]), [[12550, FAKE_ACC_A]]);
  assert.equal(txs[0].memo, 'ref ••••9012');
  assert.equal((out.transaction as any).amount_cents, -4000);
  assert.equal((out.transaction as any).mercury_account_id, FAKE_ACC_B);
  assert.equal(out.missing, null);
  assert.deepEqual((out.cashflow as any).months, [{ month: '2026-09', incoming_cents: 500000, outgoing_cents: -200000, cashflow_cents: 300000 }]);
  assert.equal((out.treasury as any[])[0].current_cents, 1000000);
  assert.deepEqual((out.statements as any[])[0], { id: '44444444-4444-4444-8444-444444444444', account_id: FAKE_ACC_A, period_start: '2026-09-01', period_end: '2026-09-30', ending_balance_cents: 120050, transaction_count: 3 });
  assert.equal((out.invoices as any[])[0].amount_cents, 250000);
  assert.deepEqual((out.customers as any[])[0], { id: '66666666-6666-4666-8666-666666666666', name: 'Customer Co' });
  assert.equal((out.recipients as any[])[0].last_paid_on, '2026-09-15');
  assert.equal((out.safes as any[])[0].amount_cents, 2500000);
  assert.equal((out.categories as any[])[0].name, 'Software');
  const all = JSON.stringify(out);
  for (const banned of ['routing-fixture-only', 'recipient-account-fixture', 'ein-fixture-only', 'billing@example.invalid', 'example.invalid', 'line1']) {
    assert.ok(!all.includes(banned), banned);
  }
  assert.deepEqual(fake.toolCalls().filter((t) => !MERCURY_READ_TOOLS.includes(t)), []);
});

test('5. an event-stream answer reads as a JSON one', async () => {
  const { fake, accessToken } = signedInFake({ stream: true });
  const r = await openMercuryReads({ accessToken, fetcher: fake.fetch });
  assert.deepEqual(await r.organization(), { id: 'org-mcp-own', legal_name: 'Own Venture Inc' });
});

test('6. a 401 at open refreshes once and retries; another 401 stays unauthorized; the budget bounds a session', async () => {
  const { fake, accessToken } = signedInFake();
  let refreshed = 0;
  const fresh = 'fake-access-refreshed';
  const r = await openMercuryReads({ accessToken: 'fake-access-stale', fetcher: fake.fetch, refresh: async () => { refreshed += 1; fake.state.access.add(fresh); return fresh; } });
  assert.equal(refreshed, 1);
  assert.equal((await r.organization()).legal_name, 'Own Venture Inc');
  await assert.rejects(() => openMercuryReads({ accessToken: 'fake-access-stale', fetcher: fake.fetch, refresh: async () => null }), (e: any) => e.code === 'unauthorized');
  await assert.rejects(() => openMercuryReads({ accessToken: 'fake-access-stale', fetcher: fake.fetch }), (e: any) => e.code === 'unauthorized');

  const s = await openMercuryMcp({ accessToken, fetcher: fake.fetch });
  for (let i = s.requests; i < MCP_REQUEST_BUDGET; i++) await s.callTool('listCategories');
  const n = fake.calls.length;
  await assert.rejects(() => s.callTool('listCategories'), (e: any) => e.code === 'rate_limited');
  assert.equal(fake.calls.length, n, 'the request past the budget was not made');
  fake.state.status = 429;
  await assert.rejects(() => openMercuryMcp({ accessToken, fetcher: fake.fetch }), (e: any) => e.code === 'rate_limited' && e.status === 429);
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

test('7. only reads.ts imports mcp.ts, and no token reaches a log', async () => {
  const ROOT = process.cwd();
  const importers = walk(resolve(ROOT, 'cloudflare-worker/src'))
    .filter((p) => /from\s+['"][^'"]*mercury\/mcp['"]|from\s+['"]\.\/mcp['"]|import\(['"][^'"]*mercury\/mcp['"]\)/.test(readFileSync(p, 'utf8')))
    .map((p) => relative(ROOT, p));
  assert.deepEqual(importers, ['cloudflare-worker/src/services/mercury/reads.ts']);

  const logged: string[] = [];
  const keep = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  for (const k of Object.keys(keep) as Array<keyof typeof keep>) (console as any)[k] = (...a: unknown[]) => { logged.push(a.map(String).join(' ')); };
  const { fake, accessToken } = signedInFake();
  try {
    const r = await openMercuryReads({ accessToken, fetcher: fake.fetch });
    await r.accounts();
    await assert.rejects(() => openMercuryReads({ accessToken: 'fake-access-not-live', fetcher: fake.fetch }));
  } finally { Object.assign(console, keep); }
  for (const line of logged) {
    assert.ok(!line.includes(accessToken) && !line.includes('fake-access'), 'a token was logged');
  }
});

test('8. the feeds\' reader on the MCP path: organization, accounts, a page and one line, account by account', async () => {
  const { fake, accessToken } = signedInFake();
  fake.state.data.transactions = [1, 2, 3].map((n) => ({ id: fakeTx(n), accountId: n === 3 ? FAKE_ACC_B : FAKE_ACC_A, amount: n * 10, postedAt: `2026-09-0${n}T12:00:00Z`, createdAt: `2026-09-0${n}T10:00:00Z`, status: 'sent', kind: 'externalTransfer', counterpartyName: 'Customer Co' }));
  const reader = mcpBankReader({ accessToken, fetcher: fake.fetch, scopes: ['read', 'offline_access'] });
  const org = await reader.readOrganization();
  assert.equal(org.permission, 'read_only');
  assert.deepEqual(org.accounts.map((a) => a.mercury_account_id), [FAKE_ACC_A, FAKE_ACC_B]);
  const p1 = await reader.transactionsPage(FAKE_ACC_A, { start: '2026-09-01', limit: 1, cursor: null });
  assert.deepEqual(p1.transactions.map((t) => t.mercury_transaction_id), [fakeTx(1)]);
  const p2 = await reader.transactionsPage(FAKE_ACC_A, { start: '2026-09-01', limit: 1, cursor: p1.next });
  assert.deepEqual(p2.transactions.map((t) => t.mercury_transaction_id), [fakeTx(2)]);
  assert.equal(p2.next, null);
  assert.equal(await reader.transaction(FAKE_ACC_A, fakeTx(3)), null, 'a line on another account is not this account\'s');
  assert.equal((await reader.transaction(FAKE_ACC_B, fakeTx(3)))!.amount_cents, 3000);
  assert.equal(fake.calls.filter((c) => c.rpc === 'initialize').length, 1, 'one session for the whole request');
  assert.equal(scopePermission(['read']), 'read_only');
  assert.equal(scopePermission(['read', 'write']), 'above_read_only');
  assert.equal(scopePermission(['offline_access']), 'above_read_only');
  assert.equal(scopePermission([]), 'not_reported');
  assert.ok(fake.calls.every((c) => c.method === 'POST'), 'POST only, never a DELETE');
});
