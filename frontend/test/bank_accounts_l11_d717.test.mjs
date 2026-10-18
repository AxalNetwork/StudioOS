/**
 * D717 (#1782) decision 12, #1856 — the Bank accounts console restyled to the
 * canvas's board L11, rendered with effects run on the minimal DOM the
 * Contracts tests use, with `bankAccountsApi` and `adminMercuryApi` replaced
 * by recorders.
 *
 *   · four entity cards, in the order Holdings, Management, GP, Fund I;
 *   · the Purposes cell's words, and the Fund I box while the Fund has no account;
 *   · the connection pill per entity, and a failed connections read;
 *   · the unmatched receipts: one credit read per connected entity, counts from
 *     `total`, never a 0 for an unknown, five newest rows, text only;
 *   · what a notice refuses, in the Worker's sentences;
 *   · the Reveal and Add account dialogs;
 *   · no token form, and the plain Admin's one sentence.
 *
 * Every name, figure and account number is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/bank_accounts_l11_d717.test.mjs
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { bankAccountsApi } from '../src/lib/api/bankAccounts.js';
import { adminMercuryApi } from '../src/lib/api/adminMercury.js';
import { entityRows } from '../src/pages/account/mercuryModel.js';
import { AXAL_ENTITIES } from '../src/lib/legalDocFormat.js';
import BankAccountsPanel, {
  BANK_ACCOUNTS_HOLDER_ONLY, MERCURY_PRESET, REVEAL_MS, NOTICE_REFUSAL_LINES,
  connectionPill, purposesText, receiptDate, unmatchedLine,
} from '../src/pages/admin/consoles/BankAccountsConsole.jsx';

const NUMBER = '5500661122';
const HOLDER = { id: 901, role: 'admin', is_super_admin: 1 };
const PLAIN = { id: 902, role: 'admin', is_super_admin: 0 };
const SOURCE = readFileSync(resolve(process.cwd(), 'frontend/src/pages/admin/consoles/BankAccountsConsole.jsx'), 'utf8');

let seq = 0;
function account(over) {
  seq += 1;
  const last4 = String(1000 + seq * 11).slice(-4);
  return {
    uid: `0000dddd-0000-4000-8000-00000000000${seq}`, label: 'Operating', bank_name: 'Column N.A.',
    account_kind: 'checking', account_last4: last4, account_masked: `••••${last4}`, purposes: [],
    status: 'active', retired_at: null, retired_reason: null, ...over,
  };
}
const HOLDINGS = account({ entity_key: 'holdings', entity_name: 'Axal VC Holdings LLC', purposes: ['platform_licence_fee'] });
const GP = account({ entity_key: 'gp', entity_name: 'Axal VC GP LLC', purposes: ['management_fee'], account_last4: NUMBER.slice(-4), account_masked: `••••${NUMBER.slice(-4)}` });
const GP_RESERVE = account({ entity_key: 'gp', entity_name: 'Axal VC GP LLC', label: 'Reserve', account_kind: 'savings' });
const MANAGEMENT = account({ entity_key: 'management', entity_name: 'Axal VC Management LLC' });
const FUND = account({ entity_key: 'fund', entity_name: 'Axal VC Spin-Out Lab Fund I LP', purposes: ['capital_contribution', 'gp_commitment'] });

const SENTINELS = ['no_active_account', 'holder_not_payee', 'savings_account', 'fund_account_missing']
  .map((code, i) => ({ code, message: `SENTINEL-${i + 1}` }));
const LIST = {
  // Out of order on purpose: the cards keep Holdings, Management, GP, Fund I.
  accounts: [GP_RESERVE, GP, MANAGEMENT, HOLDINGS],
  coverage: [
    { purpose: 'capital_contribution', label: 'Capital contributions', payee: 'fund', ok: false, code: 'fund_account_missing', message: 'FUND-MISSING-SENTENCE' },
    { purpose: 'management_fee', label: 'Management fee', payee: 'gp', ok: true, account_uid: GP.uid, account_masked: GP.account_masked },
  ],
  fund_i: { id: 7, name: 'Spin-Out Lab Fund I' },
  refusals: SENTINELS,
};

const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();
const CONNECTIONS = {
  entities: [
    { entity_key: 'holdings', connection: { status: 'active', last_synced_at: hoursAgo(3), last_error: null } },
    { entity_key: 'management', connection: null },
    { entity_key: 'gp', connection: { status: 'error', last_synced_at: hoursAgo(30), last_error: 'unauthorized' } },
    { entity_key: 'fund', connection: null },
  ],
};
const tx = (uid, day, cents, counterparty, memo) => ({ uid, created_on: day, amount_cents: cents, counterparty_name: counterparty, memo });
const PAGES = {
  holdings: { total: 3, items: [tx('h1', '2026-10-01', 120000, 'Synthetic Co', 'fee'), tx('h2', '2026-10-12', 5000, 'Other Co', null), tx('h3', null, 700, 'Undated Co', null)] },
  gp: { total: 4, items: [tx('g1', '2026-10-15', 250000, '<b>Bold LP</b>', '<i>memo</i>'), tx('g2', '2026-09-30', 100, 'Old Co', null), tx('g3', '2026-10-10', 999, 'Mid Co', null), tx('g4', '2026-10-11', 50, 'Late Co', null)] },
};

const ORIGINAL = { ...bankAccountsApi };
const MERCURY = { ...adminMercuryApi };
const pending = () => new Promise(() => {});
function stub(bank, merc) {
  const calls = { bank: [], mercury: [] };
  for (const k of Object.keys(ORIGINAL)) {
    bankAccountsApi[k] = (...args) => { calls.bank.push([k, ...args]); return k in bank ? bank[k](...args) : pending(); };
  }
  for (const k of Object.keys(MERCURY)) {
    adminMercuryApi[k] = (...args) => { calls.mercury.push([k, ...args]); return k in merc ? merc[k](...args) : pending(); };
  }
  return calls;
}
const restore = () => { Object.assign(bankAccountsApi, ORIGINAL); Object.assign(adminMercuryApi, MERCURY); };
const el = () => React.createElement(AuthProvider, null, React.createElement(BankAccountsPanel));
const DEFAULT_MERCURY = {
  connections: async () => CONNECTIONS,
  transactions: async ({ entity }) => PAGES[entity] || { total: 0, items: [] },
};

async function mounted({ user = HOLDER, bank = {}, mercury = DEFAULT_MERCURY } = {}) {
  const calls = stub({ list: async () => LIST, ...bank }, mercury);
  const v = await mountContracts(el(), '/admin?tab=bank-accounts', user);
  await v.flush();
  await v.flush();
  return { v, calls };
}

const textOf = (node) => (!node ? '' : node.nodeType === 3 ? node.textContent || ''
  : node.childNodes?.length ? node.childNodes.map(textOf).join('') : node.textContent || '');
const byId = (v, id) => v.nodes().filter((n) => v.props(n)?.['data-testid'] === id);
const one = (v, id) => byId(v, id)[0];
/** Opens the Manage strip on the row that prints `acct`'s masked number. */
async function manage(v, acct) {
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const row = byId(v, 'bank-account-row').find((r) => textOf(r).includes(acct.account_masked));
  const button = walk(row).find((n) => n.tagName === 'BUTTON' && textOf(n) === 'Manage');
  await act(async () => { v.props(button).onClick(); });
}
const cardIds = (v) => v.nodes().map((n) => v.props(n)?.['data-testid']).filter((t) => /^bank-accounts-entity-/.test(t || ''));

test('the four entity cards are Holdings, Management, GP, Fund I, whatever order list answers', async () => {
  const { v } = await mounted();
  try {
    assert.deepEqual(cardIds(v), ['holdings', 'management', 'gp', 'fund'].map((k) => `bank-accounts-entity-${k}`));
    const names = ['holdings', 'management', 'gp', 'fund'].map((k) => textOf(one(v, `bank-accounts-entity-${k}`)));
    names.forEach((t, i) => assert.ok(t.startsWith(AXAL_ENTITIES[['holdings', 'management', 'gp', 'fund'][i]].name), t));
  } finally { await v.unmount(); restore(); }
});

test('the Purposes cell: labels joined by " · ", the reserve words, the no-purpose words; no Stripe purpose', async () => {
  assert.equal(purposesText(FUND), 'Capital contributions · GP commitment');
  assert.equal(purposesText(GP_RESERVE), 'Reserve: never printed on a notice');
  assert.equal(purposesText(MANAGEMENT), 'No notice purpose');
  const { v } = await mounted();
  try {
    const gp = textOf(one(v, 'bank-accounts-entity-gp'));
    assert.match(gp, /Management fee/);
    assert.match(gp, /Reserve: never printed on a notice/);
    assert.match(textOf(one(v, 'bank-accounts-entity-management')), /No notice purpose/);
    assert.match(textOf(one(v, 'bank-accounts-entity-holdings')), /Platform licence fee/);
    assert.match(gp, /Management fee: paid into ••••/);
    assert.doesNotMatch(v.text(), /Stripe payouts|Management invoices/);
    assert.ok(!v.text().includes(NUMBER), 'a full number is in the DOM before a reveal');
  } finally { await v.unmount(); restore(); }
});

test('the Fund I box shows, word for word and with no table, until the Fund has an active account', async () => {
  const BOX = 'No account on file. Capital calls can’t issue until the Fund has one.';
  const { v } = await mounted();
  try {
    const fund = one(v, 'bank-accounts-entity-fund');
    assert.ok(textOf(fund).includes(BOX));
    assert.match(textOf(fund), /^Axal VC Spin-Out Lab Fund I LP.*Fund I is Spin-Out Lab Fund I \(fund #7\)/);
    const tables = v.nodes().filter((n) => v.props(n)?.role === 'table' && textOf(fund).includes(textOf(n)) && v.props(n)?.['aria-label']?.startsWith('Axal VC Spin-Out'));
    assert.equal(tables.length, 0, 'the Fund card drew a table with no account');
    assert.match(textOf(fund), /FUND-MISSING-SENTENCE/);
  } finally { await v.unmount(); restore(); }
  const withFund = await mounted({ bank: { list: async () => ({ ...LIST, accounts: [...LIST.accounts, FUND] }) } });
  try {
    assert.ok(!withFund.v.text().includes(BOX), 'the box stays with an active Fund account');
    assert.match(textOf(one(withFund.v, 'bank-accounts-entity-fund')), /Capital contributions · GP commitment/);
  } finally { await withFund.v.unmount(); restore(); }
});

test('an entity with no account reads "No account on file."', async () => {
  const { v } = await mounted({ bank: { list: async () => ({ ...LIST, accounts: [GP] }) } });
  try {
    assert.match(textOf(one(v, 'bank-accounts-entity-holdings')), /No account on file\.$/);
    assert.match(textOf(one(v, 'bank-accounts-entity-management')), /No account on file\.$/);
  } finally { await v.unmount(); restore(); }
});

test('connectionPill: synced, not synced, error, not connected, and a failed read', () => {
  const rows = entityRows({
    entities: [
      { entity_key: 'holdings', connection: { status: 'active', last_synced_at: hoursAgo(3) } },
      { entity_key: 'management', connection: { status: 'active', last_synced_at: null } },
      { entity_key: 'gp', connection: { status: 'error', last_synced_at: null, last_error: 'timeout' } },
      { entity_key: 'fund', connection: null },
    ],
  });
  assert.deepEqual(rows.map(connectionPill), [
    { tone: 'ok', text: 'Connected, read-only, last synced 3 h ago' },
    { tone: 'ok', text: 'Connected, read-only, not synced yet' },
    { tone: 'warn', text: 'Needs attention' },
    { tone: 'warn', text: 'Not connected: add a read-only Mercury API token for Axal VC Spin-Out Lab Fund I LP' },
  ]);
  assert.deepEqual(connectionPill(null), { tone: 'neutral', text: 'Not read' });
});

test('on the page: each card\'s pill, Connect or Replace beside it, and the error words under an errored card', async () => {
  const { v } = await mounted();
  try {
    const pills = byId(v, 'bank-accounts-connection').map(textOf);
    assert.deepEqual(pills, [
      'Connected, read-only, last synced 3 h ago',
      'Not connected: add a read-only Mercury API token for Axal VC Management LLC',
      'Needs attention',
      'Not connected: add a read-only Mercury API token for Axal VC Spin-Out Lab Fund I LP',
    ]);
    const buttons = v.nodes().filter((n) => n.tagName === 'BUTTON').map(textOf);
    assert.equal(buttons.filter((b) => b === 'Replace').length, 2);
    assert.equal(buttons.filter((b) => b === 'Connect').length, 2);
    assert.match(textOf(one(v, 'bank-accounts-entity-gp')), /Mercury refused the token\./);
    assert.match(v.text(), /Opening this page is recorded in the admin audit log: one read of the Mercury connections, and one of each connected entity's unmatched receipts\./);
  } finally { await v.unmount(); restore(); }
});

test('a failed connections read: four Not read pills, the Unreadable line, no Connect or Replace, no transactions read', async () => {
  const { v, calls } = await mounted({ mercury: { connections: async () => { throw new Error('down'); } } });
  try {
    assert.deepEqual(byId(v, 'bank-accounts-connection').map(textOf), ['Not read', 'Not read', 'Not read', 'Not read']);
    assert.match(v.text(), /The Mercury connections could not be read\. This is not a claim that none is connected\./);
    const buttons = v.nodes().filter((n) => n.tagName === 'BUTTON').map(textOf);
    assert.ok(!buttons.includes('Connect') && !buttons.includes('Replace'));
    assert.deepEqual(calls.mercury.map(([k]) => k), ['connections']);
    assert.match(textOf(one(v, 'bank-accounts-unmatched-lines')), /Axal VC Holdings LLC: Not read/);
    assert.doesNotMatch(textOf(one(v, 'bank-accounts-unmatched')), /\b0 unmatched/);
  } finally { await v.unmount(); restore(); }
});

test('unmatched: one credit read per connected entity, counts from total, Not connected and Not read, never 0', async () => {
  const { v, calls } = await mounted({
    mercury: {
      connections: async () => CONNECTIONS,
      transactions: async ({ entity }) => { if (entity === 'gp') throw new Error('read failed'); return PAGES[entity]; },
    },
  });
  try {
    const reads = calls.mercury.filter(([k]) => k === 'transactions').map(([, a]) => a);
    assert.deepEqual(reads.sort((a, b) => a.entity.localeCompare(b.entity)), [
      { entity: 'gp', match: 'none', direction: 'credit' },
      { entity: 'holdings', match: 'none', direction: 'credit' },
    ]);
    const lines = byId(v, 'bank-accounts-unmatched-lines').map(textOf)[0];
    assert.equal(lines, 'Axal VC Holdings LLC: 3 unmatchedAxal VC Management LLC: Not connectedAxal VC GP LLC: Not readAxal VC Spin-Out Lab Fund I LP: Not connected');
  } finally { await v.unmount(); restore(); }
  assert.equal(unmatchedLine('X', { status: 'ready', total: undefined }), 'X: Not read');
  assert.equal(unmatchedLine('X', { status: 'unreadable' }), 'X: Not read');
  assert.equal(unmatchedLine('X', null), 'X: Not connected');
  assert.equal(unmatchedLine('X', { status: 'ready', total: 0 }), 'X: 0 unmatched');
});

test('unmatched rows: five newest across entities, text not HTML, every link to Reconciliation, no Match to or Not ours', async () => {
  const { v, calls } = await mounted();
  try {
    const rows = byId(v, 'bank-accounts-unmatched-row').map(textOf);
    assert.equal(rows.length, 5);
    assert.deepEqual(rows.map((r) => r.split('Axal')[0]), ['15 Oct', '12 Oct', '11 Oct', '10 Oct', '1 Oct']);
    assert.match(rows[0], /<b>Bold LP<\/b> · <i>memo<\/i>/);
    assert.match(rows[0], /\$2,500\.00/);
    assert.ok(!v.nodes().some((n) => n.tagName === 'B' || n.tagName === 'I'), 'a counterparty rendered as HTML');
    const links = v.nodes().filter((n) => n.tagName === 'A' && /Reconciliation/.test(textOf(n)));
    assert.equal(links.length, 6);
    assert.ok(links.every((a) => v.props(a).href === '/admin/fund-admin?tab=reconciliation'));
    assert.doesNotMatch(v.text(), /Match to…|Not ours/);
    assert.ok(!calls.mercury.some(([k]) => k === 'proposeMatch' || k === 'markNotOurs'));
    assert.match(v.text(), /Axal VC GP LLC: 4 unmatched/);
  } finally { await v.unmount(); restore(); }
  assert.equal(receiptDate('2026-10-12'), '12 Oct');
  assert.equal(receiptDate(null), 'Not recorded');
  assert.equal(receiptDate('2026-13-01'), 'Not recorded');
  assert.equal(receiptDate('12 Oct'), 'Not recorded');
});

test('with no unmatched receipt on any connected entity, "No unmatched receipt." replaces the table', async () => {
  const { v } = await mounted({ mercury: { connections: async () => CONNECTIONS, transactions: async () => ({ total: 0, items: [] }) } });
  try {
    assert.match(textOf(one(v, 'bank-accounts-unmatched')), /No unmatched receipt\./);
    assert.equal(byId(v, 'bank-accounts-unmatched-row').length, 0);
  } finally { await v.unmount(); restore(); }
});

test('what a notice refuses: the four lines in order, each followed by the Worker\'s own sentence; ambiguous adds a fifth', async () => {
  const ambiguous = { purpose: 'platform_licence_fee', label: 'Platform licence fee', payee: 'holdings', ok: false, code: 'ambiguous_account', message: 'SENTINEL-AMBIGUOUS' };
  const { v } = await mounted({ bank: { list: async () => ({ ...LIST, coverage: [...LIST.coverage, ambiguous] }) } });
  try {
    const items = byId(v, 'bank-accounts-refusal').map(textOf);
    assert.deepEqual(items, [
      'No account for this purpose.A notice reads: SENTINEL-1',
      'The account’s holder is not the payee.A notice reads: SENTINEL-2',
      'A reserve account can’t receive payments.A notice reads: SENTINEL-3',
      'Axal VC Spin-Out Lab Fund I LP has no account.A notice reads: SENTINEL-4',
      'SENTINEL-AMBIGUOUS',
    ]);
    assert.deepEqual(Object.keys(NOTICE_REFUSAL_LINES), ['no_active_account', 'holder_not_payee', 'savings_account', 'fund_account_missing']);
  } finally { await v.unmount(); restore(); }
  const old = await mounted({ bank: { list: async () => ({ ...LIST, refusals: undefined }) } });
  try {
    assert.deepEqual(byId(old.v, 'bank-accounts-refusal').map(textOf), Object.values(NOTICE_REFUSAL_LINES));
    assert.doesNotMatch(old.v.text(), /A notice reads:/);
  } finally { await old.v.unmount(); restore(); }
});

test('Reveal: exact title, body and field; disabled while empty; one call; shown for REVEAL_MS; never stored', async () => {
  const { v, calls } = await mounted({
    bank: { list: async () => LIST, reveal: async () => ({ account: { ...GP, account_number: NUMBER } }) },
  });
  const writes = [];
  const realLocal = globalThis.localStorage.setItem;
  const hadSession = 'sessionStorage' in globalThis;
  const realSession = globalThis.sessionStorage;
  globalThis.localStorage.setItem = (k, val) => { writes.push(String(val)); return realLocal(k, val); };
  globalThis.sessionStorage = { getItem: () => null, setItem: (_k, val) => { writes.push(String(val)); }, removeItem() {} };
  try {
    await manage(v, GP);
    await v.click('Reveal');
    const dialog = one(v, 'bank-accounts-reveal-dialog');
    assert.equal(v.props(dialog)['aria-label'], 'Reveal the full number?');
    assert.match(textOf(dialog), /^Reveal the full number\?/);
    assert.equal(textOf(one(v, 'bank-accounts-reveal-body')), `Axal VC GP LLC · Operating checking ${GP.account_masked}. Your reason is written to the audit log.`);
    const input = v.nodes().find((n) => n.tagName === 'INPUT' && v.props(n)?.placeholder === 'Why you need the full number');
    assert.equal(v.props(input).maxLength, 200);
    assert.equal(textOf(input.parentNode).trim(), 'Reason');
    await assert.rejects(v.click('Reveal for 30 seconds'), /Disabled button/);
    await v.fill('Reason', '   ');
    await assert.rejects(v.click('Reveal for 30 seconds'), /Disabled button/);
    await v.fill('Reason', 'Checking a wire');
    mock.timers.enable({ apis: ['setTimeout'] });
    await v.click('Reveal for 30 seconds');
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    assert.deepEqual(calls.bank.filter(([k]) => k === 'reveal'), [['reveal', GP.uid, 'Checking a wire']]);
    assert.equal(byId(v, 'bank-accounts-reveal-dialog').length, 0, 'the dialog stayed open');
    assert.ok(textOf(one(v, 'bank-accounts-entity-gp')).includes(NUMBER));
    assert.match(v.text(), /Shown for 30 seconds\. It is not kept on this device\./);
    await act(async () => { mock.timers.tick(REVEAL_MS - 1); });
    assert.ok(v.text().includes(NUMBER), 'the number went before REVEAL_MS');
    await act(async () => { mock.timers.tick(1); });
    assert.ok(!v.text().includes(NUMBER), 'the number is still shown at REVEAL_MS');
    assert.deepEqual(writes.filter((w) => w.includes(NUMBER)), [], 'the number was written to storage');
  } finally {
    mock.timers.reset();
    globalThis.localStorage.setItem = realLocal;
    if (hadSession) globalThis.sessionStorage = realSession; else delete globalThis.sessionStorage;
    await v.unmount(); restore();
  }
});

test('a refused reveal keeps the dialog open with the Worker\'s sentence', async () => {
  const { v } = await mounted({
    bank: { list: async () => LIST, reveal: async () => { const e = new Error('x'); e.data = { message: 'SENTINEL-REVEAL-REFUSED' }; throw e; } },
  });
  try {
    await manage(v, GP);
    await v.click('Reveal');
    await v.fill('Reason', 'Checking a wire');
    await v.click('Reveal for 30 seconds');
    await v.flush();
    assert.match(textOf(one(v, 'bank-accounts-reveal-dialog')), /SENTINEL-REVEAL-REFUSED/);
  } finally { await v.unmount(); restore(); }
});

const labelTexts = (v, root) => {
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  return walk(root).filter((n) => n.tagName === 'LABEL' && (n.childNodes || []).some((c) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(c.tagName)))
    .map((n) => (n.childNodes.find((c) => c.nodeType === 3)?.textContent ?? textOf(n)).trim());
};

test('Add account: the six fields, the note, Save account; the Mercury option sends the preset with Operating or Reserve', async () => {
  const { v, calls } = await mounted({ bank: { list: async () => LIST, add: async () => ({ ok: true }) } });
  try {
    await v.click('Add account');
    const dialog = one(v, 'bank-accounts-add-dialog');
    assert.ok(dialog, 'no Add account dialog');
    assert.equal(v.props(dialog)['aria-label'], 'Add account');
    assert.deepEqual(labelTexts(v, dialog).filter((t) => !['Capital contributions', 'GP commitment'].includes(t)),
      ['Beneficiary', 'Bank', 'Kind', 'Account number', 'Account number again']);
    assert.ok(v.nodes().some((n) => n.tagName === 'LEGEND' && textOf(n) === 'Purposes'));
    assert.match(textOf(dialog), /Saved encrypted\. The full number is not shown again, except through Reveal\./);
    assert.match(textOf(dialog), /Mercury · Column N\.A\. · ABA 121145433 · SWIFT CLNOUS66MER/);
    // The Fund has no active account, so it is the default beneficiary.
    const beneficiary = v.nodes().find((n) => n.tagName === 'SELECT' && textOf(n.parentNode).startsWith('Beneficiary'));
    assert.equal(v.props(beneficiary).value, 'fund');
    await v.fill('Account number', '7700112233');
    await v.fill('Account number again', '7700112233');
    await v.click('Save account');
    await v.flush();
    const [, body] = calls.bank.find(([k]) => k === 'add');
    assert.equal(body.label, 'Operating');
    assert.equal(body.entity_key, 'fund');
    assert.equal(body.beneficiary_name, AXAL_ENTITIES.fund.name);
    for (const k of ['bank_name', 'bank_address', 'beneficiary_address', 'routing_number', 'routing_number_alt', 'swift_code', 'intermediary_swift_code']) {
      assert.equal(body[k], MERCURY_PRESET[k], k);
    }
    assert.ok(!JSON.stringify(body).includes('Mercury (Column N.A.)'));
    assert.equal(byId(v, 'bank-accounts-add-dialog').length, 0, 'success left the dialog open');
    assert.match(v.text(), /Account added\./);
    assert.equal(calls.bank.filter(([k]) => k === 'list').length, 2, 'success did not reload the registry');

    await v.click('Add account');
    await v.fill('Beneficiary', 'gp');
    await v.fill('Kind', 'savings');
    await v.click('Save account');
    await v.flush();
    const second = calls.bank.filter(([k]) => k === 'add')[1][1];
    assert.equal(second.label, 'Reserve');
    assert.equal(second.beneficiary_name, AXAL_ENTITIES.gp.name);
    assert.deepEqual(second.purposes, []);
  } finally { await v.unmount(); restore(); }
});

test('Add account: the default is Holdings once the Fund has an account; Another bank shows the bank fields, no Label or beneficiary name', async () => {
  const { v, calls } = await mounted({ bank: { list: async () => ({ ...LIST, accounts: [...LIST.accounts, FUND] }), add: async () => ({}) } });
  try {
    await v.click('Add account');
    const beneficiary = v.nodes().find((n) => n.tagName === 'SELECT' && textOf(n.parentNode).startsWith('Beneficiary'));
    assert.equal(v.props(beneficiary).value, 'holdings');
    await v.fill('Bank', 'other');
    const labels = labelTexts(v, one(v, 'bank-accounts-add-dialog'));
    for (const t of ['Bank name', 'Bank address', 'Beneficiary address', 'ABA routing number']) assert.ok(labels.includes(t), t);
    assert.ok(!labels.some((t) => /^Label|legal name/.test(t)), labels.join('|'));
    await v.fill('Bank name', 'Synthetic Bank');
    await v.fill('ABA routing number', '011000015');
    await v.click('Save account');
    await v.flush();
    const [, body] = calls.bank.find(([k]) => k === 'add');
    assert.equal(body.bank_name, 'Synthetic Bank');
    assert.equal(body.routing_number, '011000015');
    assert.equal(body.beneficiary_name, AXAL_ENTITIES.holdings.name);
  } finally { await v.unmount(); restore(); }
});

test('a refused add keeps the dialog open with the Worker\'s sentence', async () => {
  const { v } = await mounted({ bank: { list: async () => LIST, add: async () => { const e = new Error('x'); e.data = { message: 'SENTINEL-ADD-REFUSED' }; throw e; } } });
  try {
    await v.click('Add account');
    await v.click('Save account');
    await v.flush();
    const dialog = one(v, 'bank-accounts-add-dialog');
    assert.ok(dialog, 'the dialog closed on a refusal');
    assert.ok(v.nodes().some((n) => v.props(n)?.role === 'alert' && textOf(n) === 'SENTINEL-ADD-REFUSED'));
  } finally { await v.unmount(); restore(); }
});

test('no token form: no token input, no connect or disconnect in the source, and Connect opens the Mercury sheet without a DOM to scroll', async () => {
  const hadRaf = 'requestAnimationFrame' in globalThis;
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  const { v, calls } = await mounted();
  try {
    const inputs = v.nodes().filter((n) => n.tagName === 'INPUT');
    for (const n of inputs) {
      const p = v.props(n);
      assert.ok(![p.name, p.id, p.placeholder, p['aria-label']].some((x) => /token/i.test(String(x ?? ''))));
    }
    assert.doesNotMatch(SOURCE, /api_token|\.connect\(|\.disconnect\(/);
    await v.click('Connect');
    await v.flush();
    assert.ok(one(v, 'mercury-entity-sheet'), 'Connect did not open the Mercury sheet');
    assert.ok(!calls.mercury.some(([k]) => k === 'connect' || k === 'disconnect'));
  } finally {
    if (!hadRaf) delete globalThis.requestAnimationFrame;
    await v.unmount(); restore();
  }
});

test('the plain Admin gets exactly one sentence, no control, and neither client is read', async () => {
  const { v, calls } = await mounted({ user: PLAIN });
  try {
    assert.equal(v.text().trim(), BANK_ACCOUNTS_HOLDER_ONLY);
    assert.equal(v.nodes().filter((n) => ['BUTTON', 'INPUT', 'FORM', 'SELECT'].includes(n.tagName)).length, 0);
    assert.deepEqual(calls, { bank: [], mercury: [] });
  } finally { await v.unmount(); restore(); }
});

test('the console source keeps the AXAL_ENTITIES line and never names browser storage', () => {
  assert.match(SOURCE, /^import \{ AXAL_ENTITIES \} from '\.\.\/\.\.\/\.\.\/lib\/legalDocFormat';$/m);
  assert.doesNotMatch(SOURCE, /localStorage|sessionStorage/);
});
