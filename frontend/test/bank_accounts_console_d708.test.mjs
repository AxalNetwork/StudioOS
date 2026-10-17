/**
 * D708 (#1773) — the Bank accounts console, rendered with effects run on the
 * minimal DOM the Contracts tests use, with `bankAccountsApi` replaced by
 * recorders.
 *
 *   · the Super Admin sees the masked rows, where each payment goes and the
 *     Fund I line, and the console reads only `bankAccountsApi.list`;
 *   · no full number is in the DOM before a reveal, and none 30 seconds after,
 *     and nothing the reveal answered is written to storage;
 *   · anyone else gets one sentence, no controls, and no read is made;
 *   · a failed read draws ConsoleUnreadable;
 *   · it sits after Payments on HQ · Platform.
 *
 * The account number is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/bank_accounts_console_d708.test.mjs
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { bankAccountsApi } from '../src/lib/api/bankAccounts.js';
import BankAccountsPanel, { BANK_ACCOUNTS_HOLDER_ONLY, MERCURY_PRESET, REVEAL_MS } from '../src/pages/admin/consoles/BankAccountsConsole.jsx';
import { ADMIN_PLACEMENT } from '../src/lib/adminPlacement.js';
import { HQ_STRIPS } from '../src/lib/hqStrips.js';

const NUMBER = '3300447799';
const HOLDER = { id: 901, role: 'admin', is_super_admin: 1 };
const PLAIN = { id: 902, role: 'admin', is_super_admin: 0 };

const ACCOUNT = {
  uid: '0000cccc-0000-4000-8000-000000000001', entity_key: 'gp', entity_name: 'Axal VC GP LLC', label: 'GP operating',
  bank_name: 'Column N.A.', bank_address: MERCURY_PRESET.bank_address, beneficiary_name: 'Axal VC GP LLC',
  beneficiary_address: MERCURY_PRESET.beneficiary_address, account_kind: 'checking', account_last4: NUMBER.slice(-4),
  account_masked: `••••${NUMBER.slice(-4)}`, routing_number: '121145433', routing_number_alt: '121145307',
  swift_code: 'CLNOUS66MER', intermediary_swift_code: 'CHASUS33XXX', purposes: ['management_fee'], status: 'active',
  retired_at: null, retired_reason: null, created_at: '2026-10-17', updated_at: '2026-10-17',
};
const LIST = {
  accounts: [ACCOUNT],
  coverage: [
    { purpose: 'capital_contribution', label: 'Capital contributions', payee: 'fund', ok: false, code: 'fund_account_missing',
      message: "Axal VC Spin-Out Lab Fund I LP has no bank account for capital contributions yet, so no payment instructions can be given. Do not send money until Axal adds the Fund's account." },
    { purpose: 'management_fee', label: 'Management fee', payee: 'gp', ok: true, account_uid: ACCOUNT.uid, account_masked: ACCOUNT.account_masked },
  ],
  fund_i: { id: 7, name: 'Spin-Out Lab Fund I' },
};

const ORIGINAL = { ...bankAccountsApi };
function stub(answers) {
  const calls = [];
  for (const k of Object.keys(ORIGINAL)) {
    bankAccountsApi[k] = (...args) => { calls.push(k); return k in answers ? answers[k](...args) : new Promise(() => {}); };
  }
  return calls;
}
const restore = () => Object.assign(bankAccountsApi, ORIGINAL);
const el = () => React.createElement(AuthProvider, null, React.createElement(BankAccountsPanel));

async function mounted(user, answers) {
  const calls = stub(answers);
  const v = await mountContracts(el(), '/admin?tab=bank-accounts', user);
  await v.flush();
  return { v, calls };
}

test('the Super Admin sees the masked rows, the coverage and the Fund I line, read through list alone', async () => {
  const { v, calls } = await mounted(HOLDER, { list: async () => LIST });
  try {
    const text = v.text();
    assert.match(text, /GP operating/);
    assert.match(text, new RegExp(ACCOUNT.account_masked));
    assert.match(text, /Do not send money until Axal adds the Fund's account\./);
    assert.match(text, /Fund I is Spin-Out Lab Fund I \(fund #7\)/);
    assert.ok(!text.includes(NUMBER), 'the full number is in the DOM before a reveal');
    assert.deepEqual(calls, ['list']);
  } finally { await v.unmount(); restore(); }
});

test('with no fund carrying the slug, the console says so', async () => {
  const { v } = await mounted(HOLDER, { list: async () => ({ ...LIST, fund_i: null }) });
  try {
    assert.match(v.text(), /No fund carries the spinout-fund-i slug/);
  } finally { await v.unmount(); restore(); }
});

test('a reveal shows the number for 30 seconds, then only the last four, and stores nothing', async () => {
  const { v, calls } = await mounted(HOLDER, {
    list: async () => LIST,
    reveal: async () => ({ account: { ...ACCOUNT, account_number: NUMBER } }),
  });
  const writes = [];
  const realSet = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = (k, val) => { writes.push([k, String(val)]); return realSet(k, val); };
  try {
    await v.click('Reveal number');
    await v.fill('Why you need the number', 'Checking against Mercury');
    const form = v.nodes().find((n) => n.tagName === 'FORM');
    mock.timers.enable({ apis: ['setTimeout'] });
    await act(async () => { v.props(form).onSubmit({ preventDefault() {} }); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    assert.ok(v.text().includes(NUMBER), 'the revealed number is not shown');
    assert.deepEqual(calls.filter((c) => c === 'reveal'), ['reveal']);
    await act(async () => { mock.timers.tick(REVEAL_MS - 1); });
    assert.ok(v.text().includes(NUMBER), 'the number went before 30 seconds');
    await act(async () => { mock.timers.tick(1); });
    assert.ok(!v.text().includes(NUMBER), 'the number is still in the DOM 30 seconds after the reveal');
    assert.match(v.text(), new RegExp(ACCOUNT.account_masked));
    assert.deepEqual(writes.filter(([, val]) => val.includes(NUMBER)), [], 'the number was written to storage');
  } finally {
    mock.timers.reset();
    globalThis.localStorage.setItem = realSet;
    await v.unmount(); restore();
  }
});

test('anyone but the Super Admin gets one sentence, no controls, and no read', async () => {
  const { v, calls } = await mounted(PLAIN, { list: async () => LIST });
  try {
    assert.equal(v.text().trim(), BANK_ACCOUNTS_HOLDER_ONLY);
    assert.equal(v.nodes().filter((n) => ['BUTTON', 'INPUT', 'FORM', 'SELECT'].includes(n.tagName)).length, 0);
    assert.deepEqual(calls, []);
  } finally { await v.unmount(); restore(); }
});

test('a failed read draws ConsoleUnreadable, never an empty registry', async () => {
  const { v } = await mounted(HOLDER, { list: async () => { throw new Error('read failed'); } });
  try {
    assert.match(v.text(), /The bank accounts could not be read\. This is not a sign that there are none\.\s*Try again/);
    assert.doesNotMatch(v.text(), /No account has been added yet/);
  } finally { await v.unmount(); restore(); }
});

test('the Mercury preset fills in the public identifiers and no account number', () => {
  assert.deepEqual(
    [MERCURY_PRESET.bank_name, MERCURY_PRESET.routing_number, MERCURY_PRESET.routing_number_alt, MERCURY_PRESET.swift_code, MERCURY_PRESET.intermediary_swift_code],
    ['Column N.A.', '121145433', '121145307', 'CLNOUS66MER', 'CHASUS33XXX'],
  );
  assert.equal('account_number' in MERCURY_PRESET, false);
  const src = readFileSync(resolve(process.cwd(), 'frontend/src/pages/admin/consoles/BankAccountsConsole.jsx'), 'utf8');
  assert.match(src, /import \{ AXAL_ENTITIES \} from '..\/..\/..\/lib\/legalDocFormat'/, 'the beneficiary must come from the imported AXAL_ENTITIES');
  assert.doesNotMatch(src, /localStorage|sessionStorage/, 'the console touches browser storage');
});

test('placement: Bank accounts is an HQ · Platform sub-nav item, after Payments', () => {
  const entry = ADMIN_PLACEMENT.find((e) => e.key === 'tab:bank-accounts');
  assert.ok(entry, 'no placement for the bank-accounts tab');
  assert.deepEqual([entry.tier, entry.row, entry.form], ['HQ', 'Platform', 'sub-nav']);
  const strip = HQ_STRIPS.Platform.map((i) => i.label);
  assert.equal(strip[strip.indexOf('Payments') + 1], 'Bank accounts');
  const page = readFileSync(resolve(process.cwd(), 'frontend/src/pages/AdminPage.jsx'), 'utf8');
  const sections = page.slice(page.indexOf('const ADMIN_SECTIONS = ['), page.indexOf('];', page.indexOf('const ADMIN_SECTIONS = [')));
  const values = [...sections.matchAll(/\{ value: '([\w-]+)'/g)].map((m) => m[1]);
  assert.equal(values[values.indexOf('payments') + 1], 'bank-accounts');
});
