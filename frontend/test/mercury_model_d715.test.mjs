/**
 * D715 (#1780) PR 1a — `pages/account/mercuryModel.js`: the four entity rows in
 * decision 4's order with their state and error words and the Fund's note,
 * decision 8's member rows, and decision 9's and 10's words. The
 * `adminMercuryApi` half of this test comes with PR 1b.
 *
 * Fixtures use invented account endings, and the preview is a placeholder.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/mercury_model_d715.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ENTITY_KEYS, entityRow, entityRows, entityState, entityErrorWords, accountLine, UNREGISTERED_NOTE, FUND_NOTE,
  orgNameDiffersSentence, ENTITY_FEEDS, ENTITY_AUDIT_FOOT, ADMIN_ONLY, BRANCH_MANAGED, TOKEN_HELP, OPEN_BANKING,
  confirmReadOnlyLabel, DISCONNECT_REASON_MIN, ENTITY_DISCONNECT_NOTE, retryAfterSentence,
  MEMBER_GROUPS, NEVER_ROWS, landsWords, READS_ROW, MEMBER_REPLACE, MEMBER_DISCONNECT_NOTE,
  PERSONAL_DOES, PERSONAL_LAST_SYNC, PERSONAL_COMPANIES, PERSONAL_FEEDS_FALLBACK, personalAttention, personalToolBanner,
  NOT_OFFERED, notOfferedSentence, USE_WORDS,
} from '../src/pages/account/mercuryModel.js';

const SRC = readFileSync('frontend/src/pages/account/mercuryModel.js', 'utf8');

const conn = (over = {}) => ({
  uid: 'c-1', status: 'active', mercury_org_name: 'Fixture Holdings Org', org_name_differs: false,
  connected_at: '2026-10-01 10:00:00', last_synced_at: '2026-10-17 09:00:00', last_error: null, last_error_at: null,
  ...over,
});

test('decision 4: the four entities in order Holdings, Management, GP, Fund, named from AXAL_ENTITIES', () => {
  assert.deepEqual(ENTITY_KEYS, ['holdings', 'management', 'gp', 'fund']);
  const rows = entityRows({ entities: [
    { entity_key: 'fund', connection: null },
    { entity_key: 'gp', connection: null },
    { entity_key: 'management', connection: conn() },
    { entity_key: 'holdings', connection: null },
  ] });
  assert.deepEqual(rows.map((r) => r.key), ['holdings', 'management', 'gp', 'fund']);
  assert.deepEqual(rows.map((r) => r.name), ['Axal VC Holdings LLC', 'Axal VC Management LLC', 'Axal VC GP LLC', 'Axal VC Spin-Out Lab Fund I LP']);
  assert.deepEqual(entityRows(null).map((r) => r.state.text), ['Not connected', 'Not connected', 'Not connected', 'Not connected'], 'an empty read is four unconnected rows');
  assert.equal(entityRow('lp', conn()), null, 'no row for a key that is not one of the four');
  assert.equal(entityRow('constructor'), null);
});

test('decision 4: the state words — null, active, error, disconnected, and an unknown status is Not recorded', () => {
  assert.equal(entityState(null).text, 'Not connected');
  assert.equal(entityState(conn()).text, 'Connected');
  assert.equal(entityState(conn({ status: 'error' })).text, 'Needs attention');
  assert.equal(entityState(conn({ status: 'disconnected' })).text, 'Disconnected');
  const odd = entityState(conn({ status: 'paused' }));
  assert.equal(odd.text, 'Not recorded');
  assert.ok(odd.reason);
  assert.equal(entityRow('gp', conn({ status: 'disconnected' })).connected, false);
});

test('decision 4: the error words for D710\'s codes, and a sentence or markup is never printed', () => {
  assert.equal(entityErrorWords(null), null);
  assert.equal(entityErrorWords('unauthorized'), 'Mercury refused the token. Only the Super Admin can replace it.');
  assert.equal(entityErrorWords('rate_limited'), 'Mercury did not answer the last sync. The next hourly sync tries again.');
  assert.equal(entityErrorWords('timeout'), 'Mercury did not answer the last sync. The next hourly sync tries again.');
  assert.equal(entityErrorWords('http_error'), 'The last sync failed (http_error).');
  assert.equal(entityErrorWords('Mercury said: internal detail <b>x</b>'), 'The last sync failed.');
  assert.equal(entityErrorWords('constructor'), 'The last sync failed (constructor).', 'a prototype name is a code, not a lookup');
});

test('decision 4: accounts as kind and "ending NNNN" with the nickname, and an unregistered one says it feeds no match', () => {
  assert.deepEqual(accountLine({ kind: 'checking', last_four: '0101', nickname: 'Operating', registered: true }),
    { text: 'Checking ending 0101', nickname: 'Operating', note: null });
  assert.deepEqual(accountLine({ kind: 'savings', last_four: '0202', nickname: null, registered: false }),
    { text: 'Savings ending 0202', nickname: null, note: UNREGISTERED_NOTE });
  assert.equal(UNREGISTERED_NOTE, 'Not in the bank-account registry, so it feeds no match.');
  assert.equal(accountLine({ kind: 'checking', last_four: '12345678' }).text, 'Checking · last four not recorded', 'never more than four digits');
});

test('decision 4: a row reads only the connection\'s named columns — no balance, Mercury account id or token beyond the preview', () => {
  const row = entityRow('holdings', conn({
    current_cents: 987654321, available_cents: 123456789, mercury_account_id: 'acct-fixture-secret-id',
    credentials_enc: 'fixture-not-a-token-1', token_preview: '••••ab12',
    accounts: [{ kind: 'checking', last_four: '0303', nickname: 'Fixture', registered: true, current_cents: 5550000, mercury_account_id: 'acct-fixture-2' }],
  }));
  const out = JSON.stringify(row);
  for (const leak of ['987654321', '123456789', 'acct-fixture', 'fixture-not-a-token-1', '5550000']) assert.ok(!out.includes(leak), `the row carries ${leak}`);
  assert.equal(row.tokenPreview, '••••ab12', 'the preview is passed on; the sheet decides who sees it');
  assert.deepEqual(row.accounts.map((a) => a.text), ['Checking ending 0303']);
  assert.equal(row.lastSyncedAt, '2026-10-17 09:00:00', 'raw, for agoLabel');
  assert.equal(row.orgName, 'Fixture Holdings Org');
});

test('decision 4: a missing value is Not recorded, never 0 — accounts before the read carries them, and an unnamed organization', () => {
  const row = entityRow('management', conn({ mercury_org_name: null }));
  assert.equal(row.accounts, null);
  assert.equal(row.accountsReason, 'Not recorded');
  assert.equal(row.orgName, null);
  assert.equal(row.orgNameReason, 'Not recorded');
  const none = entityRow('management', null);
  assert.equal(none.accountsReason, null, 'an unconnected entity has nothing to record');
  assert.equal(none.error, null);
});

test('decision 4 and 6: the Fund\'s note, the org-name sentence, and the fixed sentences', () => {
  assert.equal(entityRow('fund').note, FUND_NOTE);
  assert.equal(entityRow('gp').note, null);
  assert.equal(FUND_NOTE, 'Connect the Fund once its own Mercury account is open. Until then, nothing on the GP\'s or Management\'s accounts is booked as Fund cash.');
  assert.equal(entityRow('gp', conn({ org_name_differs: true, mercury_org_name: 'Fixture Org' })).orgNameDiffers,
    orgNameDiffersSentence('Fixture Org', 'Axal VC GP LLC'));
  assert.equal(orgNameDiffersSentence('Fixture Org', 'Axal VC GP LLC'), 'Mercury names this organization Fixture Org. StudioOS matched it to Axal VC GP LLC by its account endings.');
  assert.equal(entityRow('gp', conn()).orgNameDiffers, null);
  assert.equal(ENTITY_FEEDS, 'What it feeds: balances and transactions for reconciliation, and the monthly cash and reconciliation drafts. Drafts wait in the review queue. Nothing reaches an LP from here.');
  assert.equal(ENTITY_AUDIT_FOOT, 'Opening this sheet is recorded in the admin audit log.');
  assert.equal(ADMIN_ONLY, 'Only the Super Admin connects, replaces or disconnects an entity\'s Mercury.');
  assert.equal(BRANCH_MANAGED, 'Axal\'s entity accounts are managed from HQ.');
  assert.equal(TOKEN_HELP, 'How to create a Read Only token');
  assert.deepEqual(OPEN_BANKING, { text: 'Open Banking', href: '/admin/fund-admin?tab=banking' });
  assert.equal(confirmReadOnlyLabel('Axal VC Holdings LLC'), 'This is a Read Only token from Axal VC Holdings LLC\'s Mercury organization.');
});

test('decisions 5 and 7: Sync now\'s wait from Retry-After, and Disconnect\'s note and ten-character reason', () => {
  assert.equal(retryAfterSentence(240), 'Try again in 4 minutes.');
  assert.equal(retryAfterSentence(30), 'Try again in 1 minute.');
  assert.equal(retryAfterSentence(null), '');
  assert.equal(retryAfterSentence('soon'), '');
  assert.equal(DISCONNECT_REASON_MIN, 10);
  assert.equal(ENTITY_DISCONNECT_NOTE, 'Transactions already read stay. The stored token is erased. Delete the token in Mercury too: StudioOS never calls Mercury\'s token endpoints.');
});

test('decision 8: the member\'s groups, the three "never" rows, where it lands, how it reads, the banner and the disconnect note', () => {
  assert.deepEqual(MEMBER_GROUPS, { uses: 'What StudioOS uses it for', never: 'What it never does', lands: 'Where it lands', reads: 'How it reads' });
  assert.deepEqual(NEVER_ROWS, [
    'It never sends, transfers or requests money, and never changes anything in Mercury.',
    'It is never used for fund administration and never shows an Axal entity\'s accounts. StudioOS refuses a token from an Axal entity\'s Mercury organization.',
    'It reads your Mercury only when you connect it and while you open an import or a match. It keeps only the lines you import or match, never your balance, memos or counterparty names.',
  ]);
  assert.equal(landsWords('founder'), 'Only the venture you import into');
  assert.equal(landsWords('partner'), 'Only your own invoices, payouts and settlements');
  for (const role of ['investor', 'advisor', 'admin', 'constructor']) assert.equal(landsWords(role), null, role);
  assert.equal(READS_ROW, 'Only when you ask. No scheduled sync.');
  assert.equal(MEMBER_REPLACE, 'Replace the token with a Read Only one from your own Mercury organization.');
  assert.equal(MEMBER_DISCONNECT_NOTE, 'Revenue rows you imported and matches you confirmed stay. The stored token is deleted. Delete it in Mercury too.');
});

test('decision 9: the personal row\'s words, and the attention words matched on the code last_error starts with', () => {
  assert.equal(PERSONAL_DOES, 'Reads on request');
  assert.equal(PERSONAL_LAST_SYNC, 'Read on request');
  assert.equal(PERSONAL_COMPANIES, 'You');
  assert.equal(PERSONAL_FEEDS_FALLBACK, 'Your own payments');
  assert.equal(personalAttention('mercury_entity_account: org belongs to an entity'), 'An Axal entity\'s Mercury');
  assert.equal(personalAttention('write_scope_refused'), 'Token can write');
  assert.equal(personalAttention('unauthorized'), 'Token refused');
  assert.equal(personalAttention('401 from Mercury'), 'Token refused');
  assert.equal(personalAttention('timeout'), 'Last read failed');
  assert.equal(personalAttention(null), 'Last read failed');
  assert.equal(personalToolBanner('write_scope_refused'), 'Mercury needs attention: Token can write. Replace its token from its sheet.', 'not lower-cased');
});

test('decision 10: a "mercury" search with no row says it is not offered, and a branch admin reads the HQ sentence; neither is a request', () => {
  assert.equal(NOT_OFFERED, 'Mercury is not offered to your profile. Axal\'s admins use it for fund administration, and founders and partners for their own revenue and partner deals.');
  assert.equal(notOfferedSentence(), NOT_OFFERED);
  assert.equal(notOfferedSentence({ branchAdmin: true }), BRANCH_MANAGED);
  assert.doesNotMatch(NOT_OFFERED + BRANCH_MANAGED, /request/i);
});

test('the model is pure and stands alone: no React, no fetch, no import of connectorsModel.js, and no use keys guessed', () => {
  assert.doesNotMatch(SRC, /from ['"]react['"]/);
  assert.doesNotMatch(SRC, /from ['"][^'"]*connectorsModel/);
  assert.doesNotMatch(SRC, /\bfetch\(|\brequest\(|from ['"][^'"]*lib\/api/);
  // PR 3b: the use keys are exactly the Worker's PersonalUse type, which the status route serves; none guessed.
  const worker = readFileSync('cloudflare-worker/src/services/mercuryPersonal.ts', 'utf8');
  const type = /export type PersonalUse = ([^;]+);/.exec(worker)[1];
  const served = [...type.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(Object.keys(USE_WORDS).sort(), served);
  assert.doesNotMatch(SRC, /\b(send|transfer|wire|pay)\w*\s*\(/i, 'nothing here moves money');
});

// ── PR 1b: adminMercuryApi (decision 11) ─────────────────────────────────────

test('decision 11: adminMercuryApi has one method per #1775 route (and D749\'s two), each under /api/admin/mercury, and nothing that moves money', async () => {
  const { adminMercuryApi } = await import('../src/lib/api/adminMercury.js');
  const api = await import('../src/lib/api.js');
  assert.equal(api.adminMercuryApi, adminMercuryApi, 'api.js re-exports it in its module block');
  assert.deepEqual(Object.keys(adminMercuryApi).sort(), [
    'accounts', 'confirmMatch', 'connect', 'connections', 'disconnect', 'markNotOurs', 'matches', 'proposeMatch', 'rejectMatch', 'sync',
    'transactions', 'withdrawNotOurs',
  ]);
  globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.document ??= { cookie: '' };
  const seen = [];
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ ok: true }), text: async () => '{"ok":true}' };
  };
  try {
    await adminMercuryApi.connections();
    await adminMercuryApi.connect('gp', 'fixture-not-a-token-1');
    await adminMercuryApi.disconnect('fund', 'Closing this account for good');
    await adminMercuryApi.sync('holdings');
    await adminMercuryApi.accounts({ entity: 'gp' });
    await adminMercuryApi.transactions({ entity: 'gp', from: '2026-09-01', to: '', page: 2 });
    await adminMercuryApi.matches({ state: 'proposed' });
    await adminMercuryApi.proposeMatch({ transaction_uid: 't-1', target_kind: 'capital_call_line', target_id: 7 });
    await adminMercuryApi.confirmMatch('m-1');
    await adminMercuryApi.rejectMatch('m-2', 'Not this line at all');
    await adminMercuryApi.markNotOurs('t-2', { reason: 'other', note: 'A wire meant for another fund' });
    await adminMercuryApi.withdrawNotOurs('n-1', 'It was ours after all');
  } finally { globalThis.fetch = savedFetch; }
  const path = (u) => new URL(u, 'https://axal.test').pathname + new URL(u, 'https://axal.test').search;
  assert.deepEqual(seen.map((c) => `${c.method} ${path(c.url)}`), [
    'GET /api/admin/mercury/connections',
    'PUT /api/admin/mercury/connections/gp',
    'DELETE /api/admin/mercury/connections/fund',
    'POST /api/admin/mercury/connections/holdings/sync',
    'GET /api/admin/mercury/accounts?entity=gp',
    'GET /api/admin/mercury/transactions?entity=gp&from=2026-09-01&page=2',
    'GET /api/admin/mercury/matches?state=proposed',
    'POST /api/admin/mercury/matches',
    'POST /api/admin/mercury/matches/m-1/confirm',
    'POST /api/admin/mercury/matches/m-2/reject',
    'POST /api/admin/mercury/transactions/t-2/not-ours',
    'POST /api/admin/mercury/not-ours/n-1/withdraw',
  ]);
  assert.deepEqual(seen[10].body, { reason: 'other', note: 'A wire meant for another fund' });
  assert.deepEqual(seen[11].body, { reason: 'It was ours after all' });
  assert.deepEqual(seen[1].body, { api_token: 'fixture-not-a-token-1', confirm_read_only: true }, 'the confirmation is always sent; no webhook or settings field');
  assert.deepEqual(seen[2].body, { reason: 'Closing this account for good' });
  for (const c of seen) assert.doesNotMatch(c.url, /send|transfer|pay|wire/i, c.url);
  const src = readFileSync('frontend/src/lib/api/adminMercury.js', 'utf8');
  assert.doesNotMatch(src.replace(/^\/\/.*$/gm, ''), /send|transfer|wire|\bpay/i, 'no money-moving name in the code');
});

test('PR 1b: entityRows reads the connections read as the Worker now serves it, accounts included', () => {
  const rows = entityRows({ ok: true, entities: [
    { entity_key: 'holdings', name: 'Axal VC Holdings LLC', connection: null },
    { entity_key: 'management', name: 'Axal VC Management LLC', connection: null },
    { entity_key: 'gp', name: 'Axal VC GP LLC', connection: conn({ accounts: [
      { kind: 'checking', last_four: '1111', nickname: 'checking 1111', registered: true },
      { kind: 'checking', last_four: '5555', nickname: null, registered: false },
    ] }) },
    { entity_key: 'fund', name: 'Axal VC Spin-Out Lab Fund I LP', connection: null },
  ] });
  const gp = rows[2];
  assert.deepEqual(gp.accounts.map((a) => [a.text, a.note]), [['Checking ending 1111', null], ['Checking ending 5555', UNREGISTERED_NOTE]]);
  assert.equal(gp.accountsReason, null);
});

test('PR 3b: mercuryPersonalApi.status reads GET /api/mercury/personal/status, and api.js re-exports it', async () => {
  const { mercuryPersonalApi } = await import('../src/lib/api/mercuryPersonal.js');
  const api = await import('../src/lib/api.js');
  assert.equal(api.mercuryPersonalApi, mercuryPersonalApi);
  globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.document ??= { cookie: '' };
  const seen = [];
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push(`${init.method || 'GET'} ${new URL(String(url), 'https://axal.test').pathname}`);
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ uses: [] }), text: async () => '{"uses":[]}' };
  };
  try { await mercuryPersonalApi.status(); } finally { globalThis.fetch = savedFetch; }
  assert.deepEqual(seen, ['GET /api/mercury/personal/status']);
});
