/**
 * D1187 (#3116, part 6 of #2389) — Bank accounts on a phone, as BNK12 draws it
 * at 390 wide:
 *
 *   · BNK12a: Add an account first and full width; each account a card with
 *     its entity, label and ending, its ⋯ menu, the Mercury and state pills,
 *     its payments and Current; the dialogs as bottom sheets;
 *   · BNK12b, BNK12d: one account as a full-height sheet whose bar holds
 *     Reveal, or Hide now while the number shows; Reveal itself full screen;
 *   · BNK12c: Cash's tiles two across, its chips and tables within the width;
 *   · every control 44px tall on a phone, and nothing wider than the screen.
 *
 * The phone is a stubbed `matchMedia`. Every name, figure and number is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/bank_accounts_phone_d1187.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { bankAccountsApi } from '../src/lib/api/bankAccounts.js';
import { adminMercuryApi } from '../src/lib/api/adminMercury.js';
import BankAccountsPanel from '../src/pages/admin/consoles/BankAccountsConsole.jsx';
import { PHONE_BELOW_SM, accountPath } from '../src/pages/admin/consoles/bankAccountsModel.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const HOLDER = { id: 901, role: 'admin', is_super_admin: 1 };
const READ_AT = '2026-10-21T08:00:00Z';
const money = (cents, reason = null) => ({ cents, reason });
const OPS = {
  uid: '0000eeee-0000-4000-8000-000000000001', entity_key: 'holdings', entity_name: 'Axal VC Holdings LLC', label: 'Operating',
  bank_name: 'Column N.A.', bank_address: '1 Synthetic Way', beneficiary_name: 'Axal VC Holdings LLC', beneficiary_address: '2 Synthetic Way',
  account_kind: 'checking', account_last4: '4821', account_masked: '••••4821', routing_number: '011000015', routing_number_alt: null,
  swift_code: 'SYNTUS33', intermediary_swift_code: null, purposes: ['platform_licence_fee'], status: 'active', retired_at: null, retired_reason: null,
  created_at: '2026-10-12 11:41:00', updated_at: '2026-10-12 11:42:00', recorded_by_name: 'Synthetic Admin',
  mercury: { account_uid: 'a'.repeat(32), kind: 'checking', connected: true, current: money(41256018), available: money(40990000), read_at: READ_AT, reason: null },
  notice_preview: [], notice_preview_reason: null,
};
const GP = { ...OPS, uid: '0000eeee-0000-4000-8000-000000000004', entity_key: 'gp', entity_name: 'Axal VC GP LLC', account_last4: '3318', account_masked: '••••3318',
  purposes: ['management_fee'], mercury: { account_uid: null, kind: null, connected: null, current: money(null, 'unmatched'), available: money(null, 'unmatched'), read_at: null, reason: 'unmatched' } };
const LIST = {
  accounts: [OPS, GP],
  coverage: [
    { purpose: 'management_fee', label: 'Management fee', payee: 'gp', ok: true, account_uid: GP.uid, account_masked: GP.account_masked },
    { purpose: 'platform_licence_fee', label: 'Platform licence fee', payee: 'holdings', ok: true, account_uid: OPS.uid, account_masked: OPS.account_masked },
  ],
  fund_i: { id: 12, name: 'Synthetic Fund I' }, refusals: [],
};
const CONNECTIONS = { entities: [
  { entity_key: 'holdings', connection: { status: 'active', last_synced_at: READ_AT, last_error: null } },
  { entity_key: 'management', connection: null },
  { entity_key: 'gp', connection: { status: 'active', last_synced_at: READ_AT, last_error: null } },
  { entity_key: 'fund', connection: null },
] };

const ORIGINAL = { ...bankAccountsApi };
const MERCURY = { ...adminMercuryApi };
const pending = () => new Promise(() => {});
function stub() {
  const bank = { list: async () => LIST, history: async () => ({ rows: [], total: 0 }) };
  const merc = { connections: async () => CONNECTIONS, accounts: async () => ({ ok: true, items: [] }), transactions: async () => ({ total: 0, items: [] }), balances: async () => ({ items: [] }) };
  for (const k of Object.keys(ORIGINAL)) bankAccountsApi[k] = (...a) => (k in bank ? bank[k](...a) : pending());
  for (const k of Object.keys(MERCURY)) adminMercuryApi[k] = (...a) => (k in merc ? merc[k](...a) : pending());
}
const restore = () => { Object.assign(bankAccountsApi, ORIGINAL); Object.assign(adminMercuryApi, MERCURY); };

/** A phone answers every query below 640px; a desktop answers none. */
function screen(phone) {
  const queries = [];
  globalThis.matchMedia = (q) => { queries.push(q); return { matches: phone, media: q, addEventListener() {}, removeEventListener() {} }; };
  return queries;
}
async function mounted(url = '/admin/platform/bank-accounts', { phone = true } = {}) {
  const queries = screen(phone);
  stub();
  const v = await mountContracts(React.createElement(AuthProvider, null, React.createElement(BankAccountsPanel)), url, HOLDER);
  await v.flush();
  await v.flush();
  return { v, queries };
}
const done = async (v) => { await v.unmount(); restore(); delete globalThis.matchMedia; };
const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
const byId = (v, id) => v.nodes().filter((n) => v.props(n)?.['data-testid'] === id);
const one = (v, id) => byId(v, id)[0];
const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
const cls = (v, node) => String(v.props(node)?.className || '');

test('BNK12a: each account is a card, in the row\'s words, with Add an account first and full width', async () => {
  const { v, queries } = await mounted();
  try {
    assert.ok(queries.includes(PHONE_BELOW_SM), 'the console asked about the phone below sm');
    assert.equal(byId(v, 'bank-account-row').length, 0, 'a phone drew table rows');
    const cards = byId(v, 'bank-account-card').map(textOf);
    assert.equal(cards.length, 2);
    assert.match(cards[0], /^HoldingsOperating ••••4821⋯MatchedActivePlatform licence feeCurrent\$412,560\.18as of 21 Oct 2026, 08:00 UTC/);
    assert.match(cards[1], /^GPOperating ••••3318⋯Not seen in MercuryActiveManagement feeCurrentNot recorded/, 'an unknown balance is Not recorded, never $0');
    const actions = one(v, 'bank-accounts-actions');
    assert.match(cls(v, actions), /max-sm:flex-col-reverse/, 'Add an account is not first on a phone');
    assert.match(cls(v, one(v, 'bank-accounts-add')), /max-sm:w-full/);
    assert.ok(!v.text().includes('6600773344'));
  } finally { await done(v); }
});

test('BNK12a: a card\'s ⋯ opens every change; a change is a bottom sheet, Reveal a full-screen sheet', async () => {
  const { v } = await mounted();
  try {
    const card = byId(v, 'bank-account-card')[0];
    const more = walk(card).find((n) => n.tagName === 'BUTTON' && v.props(n)?.['aria-label'] === 'Manage Operating ••••4821');
    await act(async () => { v.props(more).onClick(); });
    const items = walk(one(v, 'bank-account-manage')).filter((n) => n.tagName === 'BUTTON').map(textOf);
    assert.deepEqual(items, ['Open', 'Relabel', 'Change payments', 'Reveal', 'Retire']);
    await v.click('Relabel');
    assert.equal(v.props(one(v, 'bank-accounts-relabel-dialog-layer'))?.['data-phone'], 'sheet', 'Relabel is not a bottom sheet');
    await v.click('Cancel');
    await act(async () => { v.props(walk(byId(v, 'bank-account-card')[0]).find((n) => n.tagName === 'BUTTON' && textOf(n) === '⋯')).onClick(); });
    await v.click('Reveal');
    const layer = one(v, 'bank-accounts-reveal-dialog-layer');
    assert.ok(layer, 'no reveal dialog');
    assert.equal(v.props(layer)['data-phone'], undefined, 'Reveal is a full-screen sheet (BNK12d), not a bottom sheet');
  } finally { await done(v); }
});

test('BNK12b: one account is a full-height sheet whose bar holds Reveal full number…', async () => {
  const { v } = await mounted(accountPath(OPS.uid));
  try {
    const box = one(v, 'bank-account-lightbox');
    assert.ok(box);
    // D1317: the account is the shared Sheet, full height at every width (`sheet.css` makes it full width below 640px).
    assert.match(cls(v, box), /\baxs-sheet\b.*\binset-y-0\b/, 'not full height on a phone');
    const bar = one(v, 'bank-account-phone-bar');
    assert.ok(bar, 'no phone bar');
    assert.match(textOf(bar), /^Reveal full number…Close$/);
    assert.match(cls(v, one(v, 'bank-account-phone-reveal')), /flex-1/);
    await act(async () => { v.props(one(v, 'bank-account-phone-reveal')).onClick(); });
    await v.flush();
    assert.ok(one(v, 'bank-accounts-reveal-dialog'), 'the bar\'s Reveal opens the reason first');
  } finally { await done(v); }
});

test('on a desktop nothing changes: table rows, no cards, the lightbox closes from its footer', async () => {
  const { v } = await mounted(accountPath(OPS.uid), { phone: false });
  try {
    assert.equal(byId(v, 'bank-account-card').length, 0);
    assert.equal(byId(v, 'bank-account-row').length, 2);
    assert.equal(byId(v, 'bank-account-phone-bar').length, 0);
  } finally { await done(v); }
});

test('every control is 44px tall on a phone, chips 40px, and the page holds nothing wider than 390', () => {
  const dialogs = read('frontend/src/pages/admin/consoles/BankAccountDialogs.jsx');
  for (const name of ['btnCls', 'primaryCls']) {
    const line = dialogs.split('\n').find((l) => l.startsWith(`export const ${name} =`));
    assert.match(line, /max-sm:min-h-\[44px\]/, `${name} is under 44px on a phone`);
  }
  assert.match(dialogs, /function Dialog\(\{[^}]*phone = 'sheet'/, 'dialogs are not bottom sheets by default');
  assert.match(dialogs, /<Lightbox label=\{title\} title=\{title\} sub=\{sub\} width=\{width\} onClose=\{onClose\} testId=\{testId\} phone=\{phone\}/);
  const cash = read('frontend/src/pages/admin/consoles/BankCashTab.jsx');
  assert.match(cash.split('\n').find((l) => l.startsWith('const CHIP =')), /max-sm:min-h-\[40px\]/);
  assert.match(cash, /<div className="overflow-x-auto" data-testid="bank-cash-monthly-table-wrap">/, 'the monthly table can push the page wide');
  assert.match(cash, /<div className="max-h-\[360px\] overflow-auto" data-testid="bank-cash-series-table">/);
  assert.match(cash, /className="block h-auto w-full" data-testid="bank-cash-series-svg"/, 'the chart does not scale to the width');
  assert.match(read('frontend/src/pages/admin/fundAdmin/parts.jsx'), /className=\{`grid grid-cols-2 gap-3 \$\{cols\}`\}/, 'Cash\'s tiles are not two across');
  // The shared sheet loses its 20px margin on a phone only if Tailwind can see `max-sm:p-0` as a whole word.
  const lightbox = read('frontend/src/ui/Lightbox.jsx');
  assert.match(lightbox, /p-5 max-sm:p-0 \$\{sheet \? 'max-sm:items-end' : ''\}/);
  assert.doesNotMatch(lightbox, /max-sm:[\w-]+\$\{/, 'a phone class glued to `${` is never generated');
  // No fixed width wider than the phone, outside an sm: or wider rule.
  for (const f of ['BankAccountsConsole.jsx', 'BankAccountDialogs.jsx', 'BankAccountLightbox.jsx', 'BankCashTab.jsx', 'BankHistoryTab.jsx']) {
    const src = read(`frontend/src/pages/admin/consoles/${f}`);
    for (const m of src.matchAll(/(?<![\w:-])(?:min-)?w-\[(\d+)px\]/g)) {
      assert.ok(Number(m[1]) <= 390, `${f}: ${m[0]} is wider than the phone`);
    }
    assert.ok(!/\b(alert|confirm|prompt)\(/.test(src), `${f}: a browser pop-up`);
  }
});
