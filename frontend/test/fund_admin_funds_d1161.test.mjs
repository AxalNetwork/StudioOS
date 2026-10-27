/**
 * D1161 (#3068, part 4 of #2388) — the Funds tab (FND3) and one fund's page
 * (FND4) in the fund administration console:
 *
 *   - a fund with no carry or fee reads "Not recorded", never 20% or 2%, and
 *     New fund refuses a blank rate rather than store the default;
 *   - an Admin reads "A Super Admin changes a fund's carry or management
 *     fee." where Change would be; the Super Admin's Change sends a reason;
 *   - a failed funds read says so, never "No funds yet";
 *   - "Run by an outside GP" is collapsed, the LPA's View and Regenerate,
 *     and Edit fund facts, each in an in-page dialog.
 *
 * Every name, id and amount here is invented; the console's APIs are stubs.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fund_admin_funds_d1161.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';

import { FundAdminConsoleView } from '../src/pages/admin/fundAdmin/FundAdminConsole.jsx';
import {
  FUNDS_EMPTY, checkEconomics, checkFacts, checkNewFund, dollarsToCents, filterFunds, fundIdFrom, fundTiles, lpaCard, lpaRefusal,
  percentToFraction, providersBody, rateText, sizeText, splitFunds,
} from '../src/pages/admin/fundAdmin/fundsModel.js';

const h = React.createElement;
const ECONOMICS = 'A Super Admin changes a fund’s carry or management fee.';
const GP = 'A Super Admin changes a fund’s general partner of record.';
const LEDGER = 'A Super Admin assigns a fund’s ledger administrator.';

const access = (superAdmin) => ({
  super_admin: superAdmin,
  acts: [
    { act: 'fund.create', tier: 'admin', allowed: true, sentence: null },
    { act: 'fund.write', tier: 'admin', allowed: true, sentence: null },
    { act: 'fund.economics', tier: 'super_admin', allowed: superAdmin, sentence: ECONOMICS },
    { act: 'fund.gp_of_record', tier: 'super_admin', allowed: superAdmin, sentence: GP },
    { act: 'fund_ledger.administrator', tier: 'super_admin', allowed: superAdmin, sentence: LEDGER },
  ],
});
const OVERVIEW = () => ({
  as_of: '2026-10-27',
  entities: { state: 'ok', items: [] },
  funds: { state: 'ok', items: [
    { fund_id: 7, name: 'Example Fund I', committed_cents: 800000000, called_cents: 400000000, received_cents: 372000000, outstanding_cents: 28000000, overdue_lines: 3, next_due_date: null },
    { fund_id: 8, name: 'Example Opportunity Fund', committed_cents: 0, called_cents: 0, received_cents: 0, outstanding_cents: 0, overdue_lines: 0, next_due_date: null },
  ] },
  fees: { state: 'ok', items: [] },
  drafts: { state: 'ok', items: [] },
  matches: { state: 'ok', items: [] },
});
const FUND = (over = {}) => ({
  id: 7, name: 'Example Fund I', status: 'active', vintage_year: 2025, fund_size_cents: 1000000000, lp_count: 6,
  carried_interest: 0.2, management_fee: 0.02, gp_user_id: 40, gp_name: 'Ada Partner', gp_title: 'Managing Partner', gp_email: null,
  gp_entity: 'Example GP LLC', fund_admin: 'Example Admin Firm', auditor: null, legal_counsel: 'Example Law', custodian: null,
  valuation_policy: null, slug: 'example-fund-i', lpa_doc_id: 31, fund_admin_user_id: null, ...over,
});
const FUNDS = () => [
  FUND(),
  // No carry or fee recorded: a read from another path, as the overview's rollup can give.
  FUND({ id: 8, name: 'Example Opportunity Fund', status: 'fundraising', vintage_year: 2026, fund_size_cents: 0, lp_count: 14, carried_interest: null, management_fee: undefined, gp_user_id: null, gp_name: null, gp_entity: null, lpa_doc_id: null, slug: 'example-opportunity' }),
  FUND({ id: 9, name: 'Example Partner Fund', vintage_year: 2025, gp_user_id: 41, gp_entity: 'Outside GP LLC', gp_name: null, slug: 'example-partner' }),
];

function stubs(over = {}) {
  const calls = [];
  const rec = (name, fallback) => (...args) => { calls.push([name, ...args]); return (over[name] || fallback)(...args); };
  return {
    calls,
    apis: {
      fundAdmin: {
        access: rec('access', async () => access(false)),
        overview: rec('overview', async () => OVERVIEW()),
      },
      funds: {
        list: rec('list', async () => ({ ok: true, items: FUNDS() })),
        get: rec('get', async (id) => ({ ok: true, fund: FUNDS().find((f) => f.id === Number(id)), lpa: { id: 31, type: 'lpa', status: 'draft', version: 3, updated_at: '2026-03-14T10:00:00Z' } })),
        create: rec('create', async (body) => ({ ok: true, fund: { id: 12, ...body }, lpa_status: 'blocked_no_gp' })),
        update: rec('update', async (id, body) => ({ ok: true, fund: { ...FUND(), ...body } })),
        regenerateLpa: rec('regenerateLpa', async () => ({ ok: true })),
        downloadLpa: rec('downloadLpa', async () => undefined),
      },
    },
  };
}

const ADMIN = { id: 2, role: 'admin', is_super_admin: 0 };
const SUPER = { id: 1, role: 'admin', is_super_admin: 1 };

async function mount(user, apis, url) {
  const restore = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.dispatchEvent = () => true;
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const at = { path: '', search: '' };
  function Probe() { const l = useLocation(); at.path = l.pathname; at.search = l.search; return null; }
  const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(FundAdminConsoleView, { user, apis }), h(Probe))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const need = (id) => { const n = by(id); if (!n) throw new Error(`Missing ${id}`); return n; };
  return {
    at, by,
    text: (id) => txt(id ? need(id) : container).replace(/\s+/g, ' ').trim(),
    props: (id) => pr(need(id)),
    async click(id) { await act(async () => { await pr(need(id)).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async type(id, value) { await act(async () => { pr(need(id)).onChange({ target: { value } }); }); await settle(); },
    async submit(id) {
      let n = need(id); const all = walk(container); const up = (x) => all.find((p) => (p.childNodes || []).includes(x));
      while (n && n.tagName?.toLowerCase() !== 'form') n = up(n);
      await act(async () => { await pr(n).onSubmit({ preventDefault() {} }); }); await settle();
    },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}
const as = (user, over = {}) => stubs({ access: async () => access(Number(user.is_super_admin) === 1), ...over });
const named = (s, name) => s.calls.filter((c) => c[0] === name);

// ------------------------------------------------------------------ the model

test('a rate no read gives is Not recorded, never 20% or 2%; a recorded zero is a rate', () => {
  for (const v of [null, undefined, '', 'abc', 1.5, -0.1]) assert.equal(rateText(v), null, String(v));
  assert.equal(rateText(0.2), '20.00%');
  assert.equal(rateText(0.025), '2.50%');
  assert.equal(rateText(0), '0.00%');
  assert.equal(sizeText(0), null, 'the store writes 0 when no size was given');
  assert.equal(sizeText(1000000000), '$10,000,000.00');
});

test('New fund asks for both rates: a blank is refused, never stored as the default', () => {
  const base = { name: 'Example Fund III', vintage: '2027', size: '$20,000,000.00', status: 'fundraising', carry: '20', fee: '2' };
  assert.match(checkNewFund({ ...base, carry: '' }).error, /carry .* never filled in for you/);
  assert.match(checkNewFund({ ...base, fee: '  ' }).error, /management fee .* never filled in for you/);
  assert.match(checkNewFund({ ...base, name: ' ' }).error, /Name the fund/);
  assert.match(checkNewFund({ ...base, vintage: '27' }).error, /four digits/);
  assert.match(checkNewFund({ ...base, carry: '101' }).error, /carry/);
  assert.deepEqual(checkNewFund(base).body, { name: 'Example Fund III', status: 'fundraising', vintage_year: 2027, fund_size_cents: 2000000000, carried_interest: 0.2, management_fee: 0.02 });
  const lean = checkNewFund({ name: 'X', carry: '0', fee: '1.75%', status: 'nonsense' }).body;
  assert.deepEqual(lean, { name: 'X', status: 'fundraising', carried_interest: 0, management_fee: 0.0175 }, 'no size or vintage is sent when none is given');
  assert.equal(percentToFraction('12.345'), null);
  assert.equal(dollarsToCents('1,000.5'), 100050);
  assert.equal(dollarsToCents('1.234'), null);
});

test('splitFunds: the overview names the administered funds; with no overview it cannot tell', () => {
  const s = splitFunds(FUNDS(), OVERVIEW());
  assert.deepEqual(s.administered.map((f) => f.id), [7, 8]);
  assert.deepEqual(s.outside.map((f) => f.id), [9]);
  assert.equal(s.known, true);
  const u = splitFunds(FUNDS(), { funds: { state: 'unreadable', items: [] } });
  assert.deepEqual([u.administered.length, u.outside.length, u.known], [3, 0, false]);
});

test('filterFunds: search, status and sort; a fund with no size or vintage sorts last', () => {
  const rows = FUNDS();
  assert.deepEqual(filterFunds(rows, { q: 'outside' }).map((f) => f.id), [9], 'the GP entity is searched');
  assert.deepEqual(filterFunds(rows, { status: 'fundraising' }).map((f) => f.id), [8]);
  assert.deepEqual(filterFunds(rows, { sort: 'size' }).map((f) => f.id), [7, 9, 8]);
  assert.deepEqual(filterFunds(rows, { sort: 'vintage' }).map((f) => f.id), [8, 7, 9]);
  assert.deepEqual(filterFunds(rows, { sort: 'name' }).map((f) => f.id), [7, 8, 9]);
});

test('checkEconomics needs a reason of 10 to 500 characters and a changed rate', () => {
  const f = FUND();
  assert.match(checkEconomics({ carry: '25', fee: '2', reason: 'short' }, f).error, /reason of 10 to 500/);
  assert.match(checkEconomics({ carry: '25', fee: '2', reason: 'x'.repeat(501) }, f).error, /reason/);
  assert.match(checkEconomics({ carry: '20', fee: '2', reason: 'Side letter agreed.' }, f).error, /Neither rate changed/);
  assert.match(checkEconomics({ carry: '', fee: '2', reason: 'Side letter agreed.' }, f).error, /carry/);
  assert.deepEqual(checkEconomics({ carry: '25', fee: '2', reason: '  Side letter agreed.  ' }, f).body, { carried_interest: 0.25, management_fee: 0.02, reason: 'Side letter agreed.' });
  assert.ok(checkEconomics({ carry: '20', fee: '2', reason: 'First recorded rates.' }, { carried_interest: null, management_fee: null }).body, 'recording rates on a fund with none is a change');
});

test('providersBody sends only what changed, a cleared fact as null; checkFacts likewise', () => {
  const f = FUND();
  assert.deepEqual(providersBody({ fund_admin: 'Example Admin Firm', auditor: 'Example Audit', legal_counsel: '', custodian: '', valuation_policy: '' }, f).body,
    { auditor: 'Example Audit', legal_counsel: null });
  assert.match(providersBody({ fund_admin: 'Example Admin Firm', legal_counsel: 'Example Law' }, f).error, /Nothing changed/);
  assert.deepEqual(checkFacts({ name: 'Example Fund I', vintage: '', size: '10000000.00', status: 'closed' }, f).body, { status: 'closed', vintage_year: null });
  assert.match(checkFacts({ name: 'Example Fund I', vintage: '2025', size: '10000000', status: 'active' }, f).error, /Nothing changed/);
  assert.equal('fund_size_cents' in (checkFacts({ name: 'Renamed', vintage: '2025', size: '', status: 'active' }, f).body), false, 'a blank size is left as stored');
});

test('the LPA card, the tiles and the address: never a zero for a figure no read gives', () => {
  assert.equal(lpaCard(FUND(), { version: 3, status: 'draft' }).title, 'Version 3');
  assert.equal(lpaCard(FUND({ lpa_doc_id: null, gp_user_id: null }), null).state, 'blocked');
  assert.equal(lpaCard(FUND({ lpa_doc_id: null }), null).state, 'pending');
  assert.equal(lpaRefusal({ code: 'no_gp_of_record' }, 'x'), 'Name the fund’s general partner of record before an LPA is drafted.');
  assert.equal(lpaRefusal({ code: 'other' }, 'fallback'), 'fallback');
  const outside = fundTiles(FUND({ fund_size_cents: 0 }), null);
  assert.ok(outside.every((t) => !/\$0\.00/.test(String(t.v))), 'no zeros for a fund the overview does not list');
  assert.equal(outside.find((t) => t.k === 'Fund size').v, 'Not recorded');
  const tiles = fundTiles(FUND(), OVERVIEW().funds.items[0]);
  assert.equal(tiles.find((t) => t.k === 'Outstanding').note, '3 lines overdue');
  assert.equal(fundIdFrom('/admin/fund-admin/funds/7'), 7);
  for (const p of ['/admin/fund-admin/funds', '/admin/fund-admin/funds/0', '/admin/fund-admin/funds/7/x', '/admin/fund-admin/funds/abc']) assert.equal(fundIdFrom(p), null, p);
});

// ------------------------------------------------------------------ the Funds tab

test('the table: a fund with no carry or fee reads Not recorded; the outside GP card is collapsed', async () => {
  const s = as(ADMIN);
  const v = await mount(ADMIN, s.apis, '/admin/fund-admin/funds');
  try {
    assert.ok(v.by('fund-admin-panel-funds'), 'the panel keeps its id');
    assert.equal(v.text('funds-carry-8'), 'Not recorded');
    assert.equal(v.text('funds-fee-8'), 'Not recorded');
    assert.equal(v.text('funds-carry-7'), '20.00%');
    assert.doesNotMatch(v.text('funds-row-8'), /20\.00%|2\.00%|\$0\.00/);
    assert.match(v.text('funds-row-8'), /No general partner of record/);
    assert.match(v.text('funds-row-8'), /Pending/);
    assert.match(v.text('funds-row-7'), /✓ On file/);
    assert.ok(!v.by('funds-row-9'), 'a fund an outside GP runs is not in the table');
    assert.match(v.text('funds-outside'), /Run by an outside GP · 1/);
    assert.ok(!v.by('funds-outside-9'), 'collapsed');
    await v.click('funds-outside-toggle');
    assert.match(v.text('funds-outside-9'), /run by Outside GP LLC/);
    assert.equal(v.props('funds-open-7').to ?? v.props('funds-open-7').href, '/admin/fund-admin/funds/7');
    assert.equal(v.by('fund-admin-primary') && v.text('fund-admin-primary'), 'New fund');
    assert.ok(!v.by('fund-admin-filter'), 'the Funds tab lists every fund, so the fund filter is not drawn');
  } finally { await v.close(); }
});

test('a failed funds read says so, never "No funds yet"; an empty read says there is none', async () => {
  const s = as(ADMIN, { list: async () => { throw new Error('boom'); } });
  const v = await mount(ADMIN, s.apis, '/admin/fund-admin/funds');
  try {
    assert.match(v.text('funds-unreadable'), /Unreadable: The funds could not be read\. This is not a claim that there are none\./);
    assert.doesNotMatch(v.text(), /No funds yet|No fund is recorded yet/);
    assert.ok(!v.by('funds-empty'));
  } finally { await v.close(); }
  const e = await mount(ADMIN, as(ADMIN, { list: async () => ({ ok: true, items: [] }) }).apis, '/admin/fund-admin/funds');
  try { assert.ok(e.text('funds-empty').endsWith(FUNDS_EMPTY)); } finally { await e.close(); }
  const u = await mount(ADMIN, as(ADMIN, { overview: async () => { throw new Error('down'); } }).apis, '/admin/fund-admin/funds');
  try {
    assert.ok(u.by('funds-split-unknown'));
    assert.ok(u.by('funds-row-9'), 'with no overview every fund stays listed');
    assert.ok(!u.by('funds-outside'));
  } finally { await u.close(); }
});

test('New fund opens in place, refuses a blank rate, and sends fractions and cents', async () => {
  const s = as(ADMIN);
  const v = await mount(ADMIN, s.apis, '/admin/fund-admin/funds?new=1');
  try {
    assert.ok(v.by('funds-new-dialog'));
    await v.type('funds-new-name', 'Example Fund III');
    await v.type('funds-new-size', '20,000,000');
    await v.type('funds-new-fee', '2');
    await v.submit('funds-new-submit');
    assert.match(v.text('funds-new-error'), /carry .* never filled in/);
    assert.equal(named(s, 'create').length, 0, 'nothing is written');
    await v.type('funds-new-carry', '20');
    await v.submit('funds-new-submit');
    assert.deepEqual(named(s, 'create')[0][1], { name: 'Example Fund III', status: 'fundraising', fund_size_cents: 2000000000, carried_interest: 0.2, management_fee: 0.02 });
    assert.equal(v.at.path, '/admin/fund-admin/funds/12', 'the new fund opens');
  } finally { await v.close(); }
});

test('a 0% carry is sent as recorded, never swapped for the default', async () => {
  const s = as(ADMIN);
  const v = await mount(ADMIN, s.apis, '/admin/fund-admin/funds?new=1');
  try {
    await v.type('funds-new-name', 'Example Evergreen');
    await v.type('funds-new-carry', '0');
    await v.type('funds-new-fee', '0');
    await v.submit('funds-new-submit');
    assert.deepEqual(named(s, 'create')[0][1], { name: 'Example Evergreen', status: 'fundraising', carried_interest: 0, management_fee: 0 });
  } finally { await v.close(); }
});

// ------------------------------------------------------------------ one fund

test('an Admin sees the economics sentence where Change would be, and the people acts\' sentences', async () => {
  const s = as(ADMIN);
  const v = await mount(ADMIN, s.apis, '/admin/fund-admin/funds/7');
  try {
    assert.equal(v.text('fund-economics-refused'), ECONOMICS);
    assert.ok(!v.by('fund-economics-change'), 'never a disabled button');
    assert.equal(v.text('fund-gp-refused'), GP);
    assert.equal(v.text('fund-ledger-admin-refused'), LEDGER);
    assert.ok(v.by('fund-providers-edit'), 'service providers are an Admin\'s');
    assert.ok(v.by('fund-lpa-regenerate'));
    assert.equal(v.text('fund-carry'), '20.00%');
    assert.match(v.text('fund-tile-outstanding'), /\$280,000\.00 3 lines overdue/);
    assert.match(v.text('fund-waterfall'), /Not recorded: the distribution job has no hurdle or tiers\./);
    assert.match(v.text('fund-lpa-state'), /Version 3/);
    assert.equal(v.text('fund-admin-primary'), 'Edit fund facts');
    assert.equal(v.text('fund-admin-tab-funds').startsWith('Funds'), true);
    assert.equal(named(s, 'get')[0][1], 7);
  } finally { await v.close(); }
});

test('a fund with no carry reads Not recorded on its page; the outside GP fund shows no zeros', async () => {
  const v = await mount(ADMIN, as(ADMIN).apis, '/admin/fund-admin/funds/8');
  try {
    assert.equal(v.text('fund-carry'), 'Not recorded');
    assert.equal(v.text('fund-fee'), 'Not recorded');
    assert.match(v.text('fund-gp-none'), /No general partner of record/);
    assert.match(v.text('fund-lpa-state'), /No LPA is drafted until the fund has a general partner of record/);
    assert.ok(!v.by('fund-lpa-view'), 'nothing to view');
    assert.equal(v.text('fund-tile-fund-size'), 'Fund size Not recorded');
  } finally { await v.close(); }
  const o = await mount(ADMIN, as(ADMIN).apis, '/admin/fund-admin/funds/9');
  try { assert.doesNotMatch(o.text('fund-tiles'), /\$0\.00/); } finally { await o.close(); }
});

test('the Super Admin\'s Change asks a reason, then sends it with both rates', async () => {
  const s = as(SUPER);
  const v = await mount(SUPER, s.apis, '/admin/fund-admin/funds/7');
  try {
    assert.match(v.text('fund-economics'), /A change asks a reason, then your authenticator code\./);
    await v.click('fund-economics-change');
    assert.equal(v.props('fund-economics-carry').value, '20.00');
    await v.type('fund-economics-carry', '25');
    await v.submit('fund-economics-submit');
    assert.match(v.text('fund-economics-error'), /reason of 10 to 500/);
    assert.equal(named(s, 'update').length, 0);
    await v.type('fund-economics-reason', 'Side letter agreed at first close.');
    await v.submit('fund-economics-submit');
    assert.deepEqual(named(s, 'update')[0].slice(1), [7, { carried_interest: 0.25, management_fee: 0.02, reason: 'Side letter agreed at first close.' }]);
    assert.ok(!v.by('fund-economics-dialog'));
    assert.match(v.text('fund-notice'), /reason is kept on the audit record/);
    assert.equal(named(s, 'get').length, 2, 'the fund is read again');
  } finally { await v.close(); }
});

test('the LPA: View downloads; Regenerate asks first and says why it is refused in our words', async () => {
  const err = Object.assign(new Error('raw server text'), { status: 409, code: 'no_gp_of_record' });
  const s = as(ADMIN, { regenerateLpa: async () => { throw err; } });
  const v = await mount(ADMIN, s.apis, '/admin/fund-admin/funds/7');
  try {
    await v.click('fund-lpa-view');
    assert.deepEqual(named(s, 'downloadLpa')[0].slice(1), [7]);
    await v.click('fund-lpa-regenerate');
    assert.match(v.text('fund-regenerate-dialog'), /A new LPA draft replaces the current draft\. Signed LPAs are kept\./);
    assert.equal(named(s, 'regenerateLpa').length, 0, 'asked first');
    await v.click('fund-regenerate-submit');
    assert.equal(v.text('fund-regenerate-error'), 'Name the fund’s general partner of record before an LPA is drafted.');
    assert.ok(v.by('fund-regenerate-dialog'), 'the dialog stays open on a refusal');
  } finally { await v.close(); }
});

test('Service providers and Edit fund facts save what changed, in place', async () => {
  const s = as(ADMIN);
  const v = await mount(ADMIN, s.apis, '/admin/fund-admin/funds/7?edit=facts');
  try {
    assert.ok(v.by('fund-facts-dialog'));
    await v.type('fund-facts-status', 'closed');
    await v.submit('fund-facts-submit');
    assert.deepEqual(named(s, 'update')[0].slice(1), [7, { status: 'closed' }]);
    assert.equal(v.at.search, '', 'the dialog\'s address closes with it');
    await v.click('fund-providers-edit');
    await v.type('fund-providers-auditor', 'Example Audit');
    await v.submit('fund-providers-submit');
    assert.deepEqual(named(s, 'update')[1].slice(1), [7, { auditor: 'Example Audit' }]);
  } finally { await v.close(); }
});

test('a failed fund read says so; a missing fund says there is none at this address', async () => {
  const v = await mount(ADMIN, as(ADMIN, { get: async () => { throw new Error('down'); } }).apis, '/admin/fund-admin/funds/7');
  try { assert.match(v.text('fund-unreadable'), /This fund could not be read\. Nothing on it is shown until it reads\./); } finally { await v.close(); }
  const m = await mount(ADMIN, as(ADMIN, { get: async () => { throw Object.assign(new Error('not found'), { status: 404 }); } }).apis, '/admin/fund-admin/funds/70');
  try { assert.match(m.text('fund-unreadable'), /No fund is recorded at this address\./); } finally { await m.close(); }
});

test('the source: the wait card is gone, and the dialogs are in-page Lightboxes', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const consoleSrc = read('../src/pages/admin/fundAdmin/FundAdminConsole.jsx');
  assert.doesNotMatch(consoleSrc, /WaitCard|fund-admin-wait-/);
  assert.match(consoleSrc, /data-testid=\{`fund-admin-panel-\$\{view\}`\}/);
  for (const f of ['FundsTab.jsx', 'FundPage.jsx']) {
    const src = read(`../src/pages/admin/fundAdmin/${f}`);
    assert.doesNotMatch(src, /window\.(confirm|prompt|alert)/, f);
    assert.match(src, /<Lightbox /, f);
  }
});
