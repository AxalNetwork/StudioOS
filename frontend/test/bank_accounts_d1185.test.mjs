/**
 * D1185 (#3114, part 4 of #2389) — Bank accounts' Accounts tab as the canvas
 * draws it (BNK1, BNK7), one account's lightbox at `/account/:uid` (BNK2), and
 * the dialogs that replaced D717's inline forms (BNK6):
 *
 *   · the pure rules (`bankAccountsModel.js`): the balance and Mercury cells
 *     from D1184's join, the accounts Mercury reads that the registry does not
 *     hold, the coverage head, what Change payments and Retire make refuse,
 *     the notice preview, the lightbox's lines and history, the card lines;
 *   · mounted, with `bankAccountsApi` and `adminMercuryApi` as recorders:
 *     the entity rows, Add from Mercury, Relabel, Change payments and Retire
 *     each through its dialog, the lightbox and its blocks failing alone;
 *   · Reveal through the real `request()` on a stubbed fetch: a reason first,
 *     then the Worker's step-up, sent again once the code is in;
 *   · the wiring: the route, the rail beside Payments, the loading words.
 *
 * Every name, figure and account number is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/bank_accounts_d1185.test.mjs
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
import { pageFor } from '../src/lib/railPages.js';
import { consoleBoard } from '../src/pages/admin/ConsolePages.jsx';
import BankAccountsPanel, { REVEAL_MS } from '../src/pages/admin/consoles/BankAccountsConsole.jsx';
import {
  READING, RAIL_NOTE, accountHistory, accountPath, accountUidOf, balanceCell, cardLine, coverageSummary, fromMercuryError,
  lineState, mercuryPill, noticePreview, notInRegistry, paymentsEffect, refusalText, retireEffect, sparkPath,
} from '../src/pages/admin/consoles/bankAccountsModel.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const HOLDER = { id: 901, role: 'admin', is_super_admin: 1 };
const NUMBER = '6600773344';
const READ_AT = '2026-10-21T08:00:00Z';
const money = (cents, reason = null) => ({ cents, reason });
const matched = (uid, current, available = current) => ({ account_uid: uid, kind: 'checking', connected: true, current: money(current), available: money(available), read_at: READ_AT, reason: null });
const absent = (reason) => ({ account_uid: null, kind: null, connected: null, current: money(null, reason), available: money(null, reason), read_at: null, reason });

const M_OPS = 'a'.repeat(32);
const M_CARD = 'c'.repeat(32);
const OPS = {
  uid: '0000eeee-0000-4000-8000-000000000001', entity_key: 'holdings', entity_name: 'Axal VC Holdings LLC', label: 'Operating',
  bank_name: 'Column N.A.', bank_address: '1 Synthetic Way', beneficiary_name: 'Axal VC Holdings LLC', beneficiary_address: '2 Synthetic Way',
  account_kind: 'checking', account_last4: NUMBER.slice(-4), account_masked: `••••${NUMBER.slice(-4)}`,
  routing_number: '011000015', routing_number_alt: null, swift_code: 'SYNTUS33', intermediary_swift_code: null,
  purposes: ['platform_licence_fee', 'territory_licence_fee'], status: 'active', retired_at: null, retired_reason: null,
  created_at: '2026-10-12 11:41:00', updated_at: '2026-10-12 11:42:00', recorded_by_name: 'Synthetic Admin',
  mercury: matched(M_OPS, 41256018, 40990000),
  notice_preview: [
    { ok: true, purpose: 'platform_licence_fee', instructions: { beneficiary_name: 'Axal VC Holdings LLC', bank_name: 'Column N.A.', routing_number: '011000015', swift_code: 'SYNTUS33', account_masked: `••••${NUMBER.slice(-4)}` }, warning: 'SENTINEL-PAY-WARNING' },
    { ok: false, code: 'account_not_selected', message: 'A notice does not print this account for this purpose.' },
  ],
  notice_preview_reason: null,
};
const RESERVE = {
  ...OPS, uid: '0000eeee-0000-4000-8000-000000000002', label: 'Reserve', account_kind: 'savings', account_last4: '1937', account_masked: '••••1937',
  purposes: [], mercury: matched('b'.repeat(32), 0), notice_preview: [], notice_preview_reason: 'no_notice_purpose',
};
const OLD = { ...OPS, uid: '0000eeee-0000-4000-8000-000000000003', label: 'Old operating', account_last4: '5540', account_masked: '••••5540', purposes: [], status: 'retired', retired_at: '2026-10-12 11:40:00', retired_reason: 'Moved to the new operating account', mercury: absent('unmatched'), notice_preview: [], notice_preview_reason: 'account_retired' };
const GP = { ...OPS, uid: '0000eeee-0000-4000-8000-000000000004', entity_key: 'gp', entity_name: 'Axal VC GP LLC', label: 'Operating', account_last4: '3318', account_masked: '••••3318', purposes: ['management_fee'], mercury: absent('unmatched') };
const LIST = {
  accounts: [OPS, RESERVE, OLD, GP],
  coverage: [
    { purpose: 'capital_contribution', label: 'Capital contributions', payee: 'fund', ok: false, code: 'fund_account_missing', message: 'SENTINEL-FUND-MISSING' },
    { purpose: 'gp_commitment', label: 'GP commitment', payee: 'fund', ok: false, code: 'fund_account_missing', message: 'SENTINEL-FUND-MISSING-2' },
    { purpose: 'management_fee', label: 'Management fee', payee: 'gp', ok: true, account_uid: GP.uid, account_masked: GP.account_masked },
    { purpose: 'platform_licence_fee', label: 'Platform licence fee', payee: 'holdings', ok: true, account_uid: OPS.uid, account_masked: OPS.account_masked },
    { purpose: 'territory_licence_fee', label: 'Territory licence fee', payee: 'holdings', ok: true, account_uid: OPS.uid, account_masked: OPS.account_masked },
  ],
  fund_i: { id: 12, name: 'Synthetic Fund I' },
  refusals: [],
};
const MERCURY_ITEMS = [
  { uid: M_OPS, entity_key: 'holdings', kind: 'checking', last_four: NUMBER.slice(-4), nickname: 'Ops', registered: false, current: money(41256018), available: money(40990000), balance_read_at: READ_AT },
  // Cached `registered: true`, but no registry account ends in 9012: it is still not in the registry.
  { uid: M_CARD, entity_key: 'holdings', kind: 'checking', last_four: '9012', nickname: 'Card account', registered: true, current: money(321040), available: money(null, 'not_recorded'), balance_read_at: READ_AT },
];
const CONNECTIONS = {
  entities: [
    { entity_key: 'holdings', connection: { status: 'active', last_synced_at: READ_AT, last_error: null } },
    { entity_key: 'management', connection: null },
    { entity_key: 'gp', connection: { status: 'active', last_synced_at: READ_AT, last_error: null } },
    { entity_key: 'fund', connection: null },
  ],
};
const LINES = { total: 3, items: [
  { uid: 't1', amount_cents: 2500000, created_on: '2026-10-21', counterparty_name: 'Synthetic LP', match: { uid: 'm1', state: 'confirmed' }, not_ours: null },
  { uid: 't2', amount_cents: -124000, created_on: '2026-10-20', counterparty_name: 'Synthetic Vendor', match: null, not_ours: null },
  { uid: 't3', amount_cents: 1200000, created_on: '2026-10-18', counterparty_name: '<b>Synthetic Studio</b>', match: null, not_ours: null },
] };
const HISTORY = { rows: [
  { id: 'reveal:3', action: 'reveal', kind: 'reveal', time: '2026-10-21T09:14:00Z', actor_name: 'Synthetic Admin', account_uid: OPS.uid, context: 'admin' },
  { id: 'admin_audit:9', action: 'bank_account_updated', kind: 'bank_account', time: '2026-10-12T11:42:00Z', actor_name: 'Synthetic Admin', account_uid: OPS.uid },
  { id: 'admin_audit:8', action: 'bank_account_added', kind: 'bank_account', time: '2026-10-12T11:41:00Z', actor_name: null, account_uid: 'another-account' },
], total: 3 };
const SERIES = { items: [{ account_uid: M_OPS, points: [
  { date: '2026-10-18', current: money(40000000) }, { date: '2026-10-19', current: money(40500000) },
  { date: '2026-10-21', current: money(41256018) },
] }] };

// ── the pure rules ───────────────────────────────────────────────────────────

test('the Balance cell: Current with when it was read; a measured zero; Not recorded with its reason; unreadable; retired', () => {
  assert.deepEqual(balanceCell(OPS), { text: '$412,560.18', tone: 'figure', sub: 'as of 21 Oct 2026, 08:00 UTC' });
  assert.equal(balanceCell(OPS, 'available').text, '$409,900.00');
  assert.equal(balanceCell(RESERVE).text, '$0.00', 'a measured zero became something else');
  assert.deepEqual(balanceCell({ ...OPS, mercury: { ...OPS.mercury, current: money(null, 'not_recorded') } }), { text: 'Not recorded', tone: 'muted', tip: 'Mercury sent no balance for this account' });
  assert.equal(balanceCell({ ...OPS, mercury: absent('unmatched') }).tip, 'Mercury reads no account with this ending for this entity');
  assert.equal(balanceCell({ ...OPS, mercury: absent('ambiguous') }).tip, 'Mercury reads more than one account with this ending for this entity');
  assert.equal(balanceCell({ ...OPS, mercury: absent('unreadable') }).text, 'Could not be read');
  assert.equal(balanceCell(OLD).text, '—');
  assert.equal(balanceCell({ ...OPS, mercury: undefined }).text, 'Not read');
  for (const a of [{ ...OPS, mercury: absent('unmatched') }, { ...OPS, mercury: absent('unreadable') }, { ...OPS, mercury: undefined }]) {
    assert.doesNotMatch(balanceCell(a).text, /\$0/, 'an unknown balance read as zero');
  }
});

test('the Mercury cell, and the accounts Mercury reads that the registry does not hold, by entity and ending', () => {
  assert.equal(mercuryPill(OPS).text, 'Matched');
  assert.equal(mercuryPill(GP, { connected: true }).text, 'Not seen in Mercury');
  assert.equal(mercuryPill(GP, { connected: false }).text, 'Not connected');
  assert.equal(mercuryPill({ ...OPS, mercury: absent('ambiguous') }).text, 'More than one in Mercury');
  assert.equal(mercuryPill({ ...OPS, mercury: absent('unreadable') }).text, 'Not read');
  const extra = notInRegistry(LIST.accounts, MERCURY_ITEMS);
  assert.deepEqual(extra.map((m) => m.uid), [M_CARD], 'the cached registered flag decided, or the matched account was listed');
  // The same ending at another entity is not this entity's account.
  assert.deepEqual(notInRegistry([OPS], [{ ...MERCURY_ITEMS[0], entity_key: 'gp' }]).map((m) => m.entity_key), ['gp']);
  // A retired registry account does not hold its ending.
  assert.equal(notInRegistry([{ ...OPS, status: 'retired' }], [MERCURY_ITEMS[0]]).length, 1);
});

test('Where each payment goes: how many print, and the warning when the Fund has no account', () => {
  assert.deepEqual(coverageSummary(LIST.coverage), {
    meta: '3 of 5 can print',
    warning: '2 of 5 payments cannot be printed. Fund I capital calls cannot issue until the Fund has an account.',
    fundMissing: true,
  });
  assert.equal(coverageSummary(LIST.coverage.filter((c) => c.ok)).warning, null);
});

test('Change payments says what each change prints or refuses, and stops a purpose another account takes', () => {
  const add = paymentsEffect({ ...GP, purposes: [] }, ['management_fee'], [GP]);
  assert.deepEqual(add.lines, [{ tone: 'info', text: 'Adding Management fee: management-fee invoices will print ••••3318.' }]);
  const drop = paymentsEffect(OPS, ['territory_licence_fee'], LIST.accounts);
  assert.deepEqual(drop.lines, [{ tone: 'warn', text: 'Removing Platform licence fee: licence-fee invoices refuse to print until another Holdings checking account takes it.' }]);
  assert.equal(drop.changed, true);
  const second = { ...OPS, uid: 'other', label: 'Second', account_masked: '••••7777', purposes: [] };
  const taken = paymentsEffect(second, ['platform_licence_fee'], [OPS, second]);
  assert.deepEqual(taken.blocked, ['platform_licence_fee']);
  assert.match(taken.lines[0].text, /Operating ••••3344 takes it now\. Remove it there first\./);
  assert.equal(paymentsEffect(OPS, [...OPS.purposes], LIST.accounts).changed, false);
});

test('Retire says the notices that will refuse; none when the account takes no payment', () => {
  assert.equal(retireEffect(OPS), 'This account takes Platform licence fee and Territory licence fee. After you retire it, those invoices refuse to print until another account takes them.');
  assert.equal(retireEffect(GP), 'This account takes Management fee. After you retire it, its invoices refuse to print until another account takes it.');
  assert.equal(retireEffect({ ...OPS, entity_key: 'fund', purposes: ['capital_contribution', 'management_fee'] }), 'This account takes Capital contributions and Management fee. After you retire it, those notices and invoices refuse to print until another account takes them.');
  assert.equal(retireEffect(RESERVE), null);
  assert.equal(retireEffect(OLD), null);
});

test('the lightbox address, the notice preview, the lines, the history and the series', () => {
  assert.equal(accountPath('ab c'), '/admin/platform/bank-accounts/account/ab%20c');
  assert.equal(accountUidOf('/admin/platform/bank-accounts/account/ab%20c'), 'ab c');
  assert.equal(accountUidOf('/admin/platform/bank-accounts'), null);
  assert.equal(accountUidOf('/admin/platform/bank-accounts/account/x/y'), null);
  const p = noticePreview(OPS);
  assert.equal(p.kind, 'items');
  assert.deepEqual(p.items[0].rows.find(([k]) => k === 'Account'), ['Account', '••••3344']);
  assert.equal(p.items[0].warning, 'SENTINEL-PAY-WARNING');
  assert.deepEqual(p.items[1], { ok: false, purpose: 'Territory licence fee', line: 'A notice reads: A notice does not print this account for this purpose.' });
  assert.equal(noticePreview(RESERVE).line, 'No notice prints this account: it takes no payment.');
  assert.equal(noticePreview(OLD).line, 'A retired account prints on no notice.');
  assert.equal(noticePreview({ ...OPS, notice_preview: undefined }).kind, 'unread');
  assert.deepEqual(LINES.items.map((t) => lineState(t).text), ['Matched', 'Not a receipt', 'Unmatched']);
  const h = accountHistory(HISTORY.rows, OPS.uid);
  assert.deepEqual(h.map((r) => r.event), ['Reveal', 'Changed'], 'another account\'s row was drawn');
  assert.equal(accountHistory([{ ...HISTORY.rows[0], actor_name: null }], OPS.uid)[0].by, 'Who is not recorded');
  const s = sparkPath(SERIES.items[0].points);
  assert.equal(s.gaps, 1, 'a missing day was drawn as a line');
  assert.equal((s.d.match(/M/g) || []).length, 2);
  assert.equal(sparkPath([SERIES.items[0].points[0]]), null);
});

test('the entity card\'s line (BNK7), the Add from Mercury ending, and a cancelled step-up in words', () => {
  assert.equal(cardLine({ connected: false }), 'Connect Mercury to see this entity’s balances. The registry works without it.');
  assert.equal(cardLine({ connected: true, error: 'SENTINEL-ERROR', state: { text: 'Needs attention' } }), 'SENTINEL-ERROR');
  assert.equal(cardLine({ connected: true, state: { text: 'Connected' }, lastSyncedAt: READ_AT }), 'Last synced 21 Oct 2026, 08:00 UTC.');
  assert.equal(cardLine({ connected: true, state: { text: 'Connected' }, lastSyncedAt: null }), 'Not synced yet.');
  assert.equal(cardLine(null), null);
  assert.equal(fromMercuryError('1234569012', '1234569012', '9012'), null);
  assert.equal(fromMercuryError('1234561111', '1234561111', '9012'), 'It must end in 9012.');
  assert.equal(fromMercuryError('1234569012', '1234569013', '9012'), 'The two copies of the account number differ. Type it again.');
  assert.equal(refusalText({ status: 403, code: 'step_up_required', message: 'x' }), 'The authenticator code was not entered, so nothing changed.');
  assert.equal(refusalText({ status: 409, data: { message: 'SENTINEL-WORKER' } }), 'SENTINEL-WORKER');
});

// ── mounted ──────────────────────────────────────────────────────────────────

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
const DEFAULT_MERCURY = {
  connections: async () => CONNECTIONS,
  accounts: async () => ({ ok: true, items: MERCURY_ITEMS }),
  transactions: async ({ account }) => (account ? LINES : { total: 0, items: [] }),
  balances: async () => SERIES,
};
async function mounted({ url = '/admin/platform/bank-accounts', bank = {}, mercury = {} } = {}) {
  const calls = stub({ list: async () => LIST, history: async () => HISTORY, ...bank }, { ...DEFAULT_MERCURY, ...mercury });
  const v = await mountContracts(React.createElement(AuthProvider, null, React.createElement(BankAccountsPanel)), url, HOLDER);
  await v.flush();
  await v.flush();
  return { v, calls };
}
const textOf = (node) => (!node ? '' : node.nodeType === 3 ? node.textContent || ''
  : node.childNodes?.length ? node.childNodes.map(textOf).join('') : node.textContent || '');
const byId = (v, id) => v.nodes().filter((n) => v.props(n)?.['data-testid'] === id);
const one = (v, id) => byId(v, id)[0];
const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
async function menu(v, acct, item) {
  const row = byId(v, 'bank-account-row').find((r) => textOf(r).includes(acct.account_masked) && textOf(r).includes(acct.label));
  const button = walk(row).find((n) => n.tagName === 'BUTTON' && v.props(n)?.['aria-label'] === `Manage ${acct.label} ${acct.account_masked}`);
  await act(async () => { v.props(button).onClick(); });
  await v.click(item);
}
const isDisabled = (v, label) => v.props(v.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === label)).disabled;
const check = async (v, root, label, checked) => {
  const box = walk(root).find((n) => n.tagName === 'INPUT' && v.props(n)?.type === 'checkbox' && textOf(n.parentNode).includes(label));
  await act(async () => { v.props(box).onChange({ target: { checked } }); });
};

test('Accounts: each row\'s ending, payments, balance and Mercury; the retired folded; Mercury\'s card account not in the registry', async () => {
  const { v, calls } = await mounted();
  try {
    const holdings = textOf(one(v, 'bank-accounts-entity-holdings'));
    assert.match(holdings, /^HoldingsAxal VC Holdings LLC/);
    assert.match(holdings, /Last synced 21 Oct 2026, 08:00 UTC\./);
    assert.match(holdings, /••••3344Platform licence fee · Territory licence fee\$412,560\.18as of 21 Oct 2026, 08:00 UTCMatchedActive/);
    assert.match(holdings, /Reserve: never printed on a notice\$0\.00/);
    assert.ok(!holdings.includes('Old operatingChecking'), 'a retired account was drawn unfolded');
    assert.match(holdings, /Show 1 retired account ▾Old operating ••••5540 · retired 12 Oct 2026 · ‘Moved to the new operating account’/);
    const extra = byId(v, 'bank-accounts-not-in-registry').map(textOf);
    assert.equal(extra.length, 1);
    assert.match(extra[0], /^Mercury also reads ••••9012 Card accountIt is not in the registry, so no notice prints it and no receipt is matched to it\.\$3,210\.40/);
    assert.match(textOf(one(v, 'bank-accounts-entity-gp')), /Not seen in Mercury/);
    assert.match(textOf(one(v, 'bank-accounts-coverage-card')), /3 of 5 can print2 of 5 payments cannot be printed\./);
    assert.match(textOf(one(v, 'bank-accounts-coverage-card')), /Platform licence feeHoldings · Operating ••••3344Paid here/);
    assert.match(textOf(one(v, 'bank-accounts-coverage-card')), /GP commitmentA notice reads: SENTINEL-FUND-MISSING-2Fund I · —Refused/);
    assert.ok(!v.text().includes(NUMBER), 'a full number is in the DOM before a reveal');
    assert.ok(calls.mercury.some(([k]) => k === 'accounts'));
    await v.click('Show 1 retired account ▾');
    assert.match(textOf(one(v, 'bank-accounts-entity-holdings')), /Old operatingChecking••••5540/);
  } finally { await v.unmount(); restore(); }
});

test('a failed Mercury accounts read is its own block; the registry and the rows stay', async () => {
  const { v } = await mounted({ mercury: { accounts: async () => { throw new Error('down'); } } });
  try {
    assert.ok(one(v, 'bank-accounts-held-unreadable'));
    assert.equal(byId(v, 'bank-accounts-not-in-registry').length, 0);
    assert.match(textOf(one(v, 'bank-accounts-entity-holdings')), /\$412,560\.18/);
  } finally { await v.unmount(); restore(); }
});

test('Add it to the registry: the ending Mercury reads, the full number typed, and the Mercury uid sent for the Worker to check', async () => {
  const { v, calls } = await mounted({ bank: { addFromMercury: async () => ({ account: {} }) } });
  try {
    await v.click('Add it to the registry');
    const dialog = one(v, 'bank-accounts-add-mercury-dialog');
    assert.equal(v.props(dialog)['aria-label'], 'Add an account');
    assert.equal(textOf(one(v, 'bank-accounts-add-mercury-line')), 'Mercury reads ••••9012 for Holdings. Type the full number from Mercury’s account page. It must end in 9012.');
    assert.equal(isDisabled(v, 'Save account'), true);
    await v.fill('Account number', '5566771111');
    await v.fill('Account number again', '5566771111');
    assert.match(textOf(one(v, 'bank-accounts-add-mercury-problem')), /It must end in 9012\./);
    assert.equal(isDisabled(v, 'Save account'), true, 'a number with another ending could be sent');
    await v.fill('Account number', '5566779012');
    await v.fill('Account number again', '5566779012');
    await v.click('Save account');
    await v.flush();
    const [, uid, body] = calls.bank.find(([k]) => k === 'addFromMercury');
    assert.equal(uid, M_CARD);
    assert.equal(body.entity_key, 'holdings');
    assert.equal(body.account_kind, 'checking');
    assert.equal(body.label, 'Operating');
    assert.deepEqual(body.purposes, []);
    assert.ok(!('account_last4' in body) && !('last_four' in body), 'an ending was submitted for the Worker to trust');
    assert.equal(byId(v, 'bank-accounts-add-mercury-dialog').length, 0);
    assert.match(v.text(), /Account added\. Give it its payments from Change payments\./);
  } finally { await v.unmount(); restore(); }
});

test('Retire: a dialog, never an inline form; a reason first; it says the invoices will refuse; the reason sent', async () => {
  const { v, calls } = await mounted({ bank: { retire: async () => ({ account: {} }) } });
  try {
    assert.equal(byId(v, 'bank-account-row').flatMap(walk).filter((n) => ['FORM', 'INPUT', 'TEXTAREA'].includes(n.tagName)).length, 0, 'a row drew an inline form');
    await menu(v, OPS, 'Retire');
    const dialog = one(v, 'bank-accounts-retire-dialog');
    assert.equal(v.props(dialog)['aria-label'], 'Retire Holdings · Operating ••••3344?');
    assert.equal(textOf(one(v, 'bank-accounts-retire-effect')), 'This account takes Platform licence fee and Territory licence fee. After you retire it, those invoices refuse to print until another account takes them.');
    assert.equal(isDisabled(v, 'Retire account'), true);
    await v.fill('Reason', '   ');
    assert.equal(isDisabled(v, 'Retire account'), true);
    await v.fill('Reason', 'Moved to a synthetic account');
    await v.click('Retire account');
    await v.flush();
    assert.deepEqual(calls.bank.filter(([k]) => k === 'retire'), [['retire', OPS.uid, 'Moved to a synthetic account']]);
    assert.match(v.text(), /Account retired\./);
    assert.equal(calls.bank.filter(([k]) => k === 'list').length, 2, 'the registry was not read again');
  } finally { await v.unmount(); restore(); }
  const reserve = await mounted();
  try {
    await menu(reserve.v, RESERVE, 'Retire');
    assert.equal(byId(reserve.v, 'bank-accounts-retire-effect').length, 0, 'a reserve claimed notices refuse');
  } finally { await reserve.v.unmount(); restore(); }
});

test('Change payments and Relabel: each says its effect, sends only what changes, and keeps a refusal in the dialog', async () => {
  const { v, calls } = await mounted({ bank: {
    update: async (_uid, body) => { if (body.label === 'Refused') { const e = new Error('x'); e.data = { message: 'SENTINEL-REFUSED' }; throw e; } return { account: {} }; },
  } });
  try {
    await menu(v, OPS, 'Change payments');
    const dialog = one(v, 'bank-accounts-payments-dialog');
    assert.match(textOf(one(v, 'bank-accounts-payments-effect')), /Nothing changes yet\./);
    assert.equal(isDisabled(v, 'Save payments'), true);
    await check(v, dialog, 'Platform licence fee', false);
    assert.equal(textOf(one(v, 'bank-accounts-payments-effect')), 'Removing Platform licence fee: licence-fee invoices refuse to print until another Holdings checking account takes it.');
    await v.click('Save payments');
    await v.flush();
    assert.deepEqual(calls.bank.filter(([k]) => k === 'update').map(([, uid, b]) => [uid, b]), [[OPS.uid, { purposes: ['territory_licence_fee'] }]]);
    assert.match(v.text(), /Payments saved\./);

    await menu(v, GP, 'Relabel');
    assert.equal(v.props(one(v, 'bank-accounts-relabel-dialog'))['aria-label'], 'Relabel GP · Operating ••••3318');
    assert.equal(isDisabled(v, 'Save label'), true, 'an unchanged label could be saved');
    await v.fill('Label', '');
    assert.equal(isDisabled(v, 'Save label'), true);
    await v.fill('Label', 'Refused');
    await v.click('Save label');
    await v.flush();
    assert.ok(one(v, 'bank-accounts-relabel-dialog'), 'a refusal closed the dialog');
    assert.ok(v.nodes().some((n) => v.props(n)?.role === 'alert' && textOf(n) === 'SENTINEL-REFUSED'));
  } finally { await v.unmount(); restore(); }
});

test('the lightbox at /account/:uid: instructions, payments, the notice preview, Mercury, the latest lines and this account\'s history', async () => {
  const { v, calls } = await mounted({ url: accountPath(OPS.uid) });
  try {
    const box = one(v, 'bank-account-lightbox');
    assert.ok(box, 'no lightbox at the account\'s address');
    assert.match(textOf(box), /Account · Holdings/);
    assert.match(textOf(one(v, 'bank-account-instructions')), /Alternate ABANot recorded/);
    assert.match(textOf(one(v, 'bank-account-instructions')), /Added12 Oct 2026 · by Synthetic Admin/);
    assert.match(textOf(one(v, 'bank-account-payments')), /^Payment.*Platform licence fee · Territory licence fee\. Licence-fee invoices print this account\./);
    assert.match(textOf(one(v, 'bank-account-notice')), /Account••••3344.*SENTINEL-PAY-WARNING.*A notice reads: A notice does not print this account for this purpose\./);
    assert.match(textOf(one(v, 'bank-account-in-mercury')), /Current\$412,560\.18Available\$409,900\.00as of 21 Oct 2026, 08:00 UTC/);
    assert.ok(one(v, 'bank-account-spark'));
    assert.deepEqual(byId(v, 'bank-account-line').map(textOf).map((t) => t.replace(/\d+ Oct 2026/, 'D')), [
      'Synthetic LPD+$25,000.00Matched', 'Synthetic VendorD−$1,240.00Not a receipt', '<b>Synthetic Studio</b>D+$12,000.00Unmatched']);
    assert.ok(!walk(box).some((n) => n.tagName === 'B'), 'a counterparty rendered as HTML');
    assert.deepEqual(byId(v, 'bank-account-history-row').map((n) => textOf(n)).map((t) => t.split('2026')[0]), ['Synthetic Admin21 Oct ', 'Synthetic Admin12 Oct ']);
    assert.deepEqual(calls.mercury.filter(([k]) => k === 'balances').map(([, a]) => a), [{ account: M_OPS, range: '90d' }]);
    assert.deepEqual(calls.mercury.filter(([k, a]) => k === 'transactions' && a.account).map(([, a]) => a), [{ account: M_OPS }]);
    assert.ok(!v.text().includes(NUMBER));
    await v.click('Close');
    assert.equal(byId(v, 'bank-account-lightbox').length, 0, 'Close left the lightbox open');
    await menu(v, GP, 'Open');
    await v.flush();
    assert.match(textOf(one(v, 'bank-account-lightbox')), /Account · GP/);
    assert.match(textOf(one(v, 'bank-account-lines')), /No Mercury account is matched to this one, so no line is read\./);
  } finally { await v.unmount(); restore(); }
});

test('the lightbox\'s blocks fail alone; a savings account has no preview or series; an unknown address says so', async () => {
  const { v } = await mounted({ url: accountPath(OPS.uid), bank: { history: async () => { throw new Error('down'); } }, mercury: { balances: async () => { throw new Error('down'); } } });
  try {
    assert.match(textOf(one(v, 'bank-account-history')), /This account’s history could not be read/);
    assert.match(textOf(one(v, 'bank-account-in-mercury')), /The balance over 90 days could not be read.*\$412,560\.18|\$412,560\.18.*The balance over 90 days could not be read/);
    assert.equal(byId(v, 'bank-account-line').length, 3, 'one failed block blanked another');
    assert.match(textOf(one(v, 'bank-account-instructions')), /Beneficiary/);
  } finally { await v.unmount(); restore(); }
  const sav = await mounted({ url: accountPath(RESERVE.uid) });
  try {
    assert.equal(byId(sav.v, 'bank-account-notice').length, 0);
    assert.ok(!sav.calls.mercury.some(([k]) => k === 'balances'), 'a savings account read a series');
    assert.match(textOf(one(sav.v, 'bank-account-payments')), /Reserve: never printed on a notice\. A savings account takes no payments\./);
  } finally { await sav.v.unmount(); restore(); }
  const gone = await mounted({ url: accountPath('no-such-account') });
  try {
    assert.ok(one(gone.v, 'bank-account-missing'));
  } finally { await gone.v.unmount(); restore(); }
});

// Reveal through the real `request()`: the Worker answers step_up_required once.
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('Reveal: a reason first, then the step-up, sent again once; shown for 30 seconds in the row and the lightbox; a cancelled code changes nothing', async () => {
  const realFetch = globalThis.fetch;
  const realDispatch = globalThis.dispatchEvent;
  const reveals = [];
  let first = true;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url), 'http://x').pathname;
    if (path.endsWith(`/admin/bank-accounts/${OPS.uid}/reveal`)) {
      reveals.push(JSON.parse(init.body));
      if (first) { first = false; return json({ code: 'step_up_required', message: 'step up', ttl_minutes: 15 }, 403); }
      return json({ account: { ...OPS, account_number: NUMBER } });
    }
    return json({});
  };
  let answer = true;
  const asked = [];
  globalThis.dispatchEvent = (ev) => {
    if (ev.type === 'studioos:step_up_required') { asked.push(ev.detail.ttlMinutes); ev.detail.ack = true; setTimeout(() => ev.detail.done(answer), 0); }
    return true;
  };
  const { v } = await mounted({ url: accountPath(OPS.uid), bank: { reveal: (...a) => ORIGINAL.reveal(...a) } });
  try {
    await v.click('Reveal full number…');
    assert.equal(isDisabled(v, 'Reveal for 30 seconds'), true, 'a reveal could be sent without a reason');
    await v.fill('Reason', 'Checking a synthetic wire');
    mock.timers.enable({ apis: ['setTimeout'] });
    await v.click('Reveal for 30 seconds');
    for (let i = 0; i < 6; i += 1) await act(async () => { mock.timers.tick(1); await Promise.resolve(); await Promise.resolve(); });
    assert.deepEqual(asked, [15], 'the step-up was not asked for');
    assert.deepEqual(reveals, [{ reason: 'Checking a synthetic wire' }, { reason: 'Checking a synthetic wire' }]);
    assert.match(textOf(one(v, 'bank-account-lightbox-revealed')), new RegExp(`${NUMBER}Shown for 30 seconds\\. It is not kept on this device\\.Reason recorded at \\d\\d:\\d\\d UTC: ‘Checking a synthetic wire’`));
    assert.ok(byId(v, 'bank-account-revealed').length >= 2, 'the number is not in the row and the lightbox');
    await act(async () => { mock.timers.tick(REVEAL_MS); });
    assert.ok(!v.text().includes(NUMBER), 'the number outlived 30 seconds');
    mock.timers.reset();
    first = true; answer = false;
    await v.click('Reveal full number…');
    await v.fill('Reason', 'Checking a synthetic wire');
    await v.click('Reveal for 30 seconds');
    for (let i = 0; i < 6; i += 1) await v.flush();
    assert.match(textOf(one(v, 'bank-accounts-reveal-dialog')), /The authenticator code was not entered, so nothing changed\./);
    assert.ok(!v.text().includes(NUMBER));
  } finally {
    mock.timers.reset();
    globalThis.fetch = realFetch;
    globalThis.dispatchEvent = realDispatch;
    await v.unmount(); restore();
  }
});

// ── the wiring ───────────────────────────────────────────────────────────────

test('the wiring: the lightbox route behind hqOnly, the rail beside Payments, the loading words, no inline form', async () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<Route path="\/admin\/platform\/bank-accounts\/account\/:uid" element=\{guard\(\['admin'\], hqOnly\(<BankAccountsPage \/>\)\)\} \/>/);
  const rail = read('frontend/src/lib/railPages.js');
  const pay = rail.indexOf("own('/admin/platform/payments'");
  const bank = rail.indexOf("off('/admin/platform/bank-accounts', key(SA, 'Platform', 'Bank accounts'))");
  assert.ok(pay > 0 && bank > pay && bank - pay < 400, 'the rail entry is not beside Payments');
  for (const p of ['/admin/platform/bank-accounts', '/admin/platform/bank-accounts/cash', accountPath(OPS.uid)]) {
    assert.equal(pageFor(p, 'super_admin')?.key, 'Super Admin · Platform · Bank accounts', p);
  }
  assert.equal(consoleBoard('/admin/platform/bank-accounts', 'super_admin'), null, 'an off-canvas key took a canvas board');
  const pages = read('frontend/src/pages/admin/ConsolePages.jsx');
  assert.match(pages, /<BankAccountsRail>\s*<ConsolePage crumb=\{\{ \.\.\.PLATFORM, current: 'Bank accounts' \}\}/, 'the rail does not frame the whole page');
  assert.match(read('frontend/src/pages/admin/consoles/BankAccountsConsole.jsx'), /<AdminBoardFrame workspace="Bank accounts" note=\{RAIL_NOTE\}/);
  assert.match(RAIL_NOTE, /never sees an account number, a balance or a transaction\.$/);
  const consoleSrc = read('frontend/src/pages/admin/consoles/BankAccountsConsole.jsx');
  assert.doesNotMatch(consoleSrc, /<form\b|Loading admin console|CONSOLE_LOADING/);
  assert.doesNotMatch(read('frontend/src/pages/admin/consoles/BankAccountDialogs.jsx') + read('frontend/src/pages/admin/consoles/BankAccountLightbox.jsx'), /localStorage|sessionStorage|window\.confirm|window\.alert|dangerouslySetInnerHTML/);
  const calls = stub({}, {});
  const v = await mountContracts(React.createElement(AuthProvider, null, React.createElement(BankAccountsPanel)), '/admin/platform/bank-accounts', HOLDER);
  try {
    assert.equal(textOf(one(v, 'bank-accounts-reading')), READING);
    assert.equal(READING, 'Reading the bank accounts…');
    assert.ok(calls.bank.some(([k]) => k === 'list'));
  } finally { await v.unmount(); restore(); }
});
