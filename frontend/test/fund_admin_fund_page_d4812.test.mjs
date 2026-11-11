// D4812 part 3 (#4812, board FA-04) — the fund page leads with its identity
// and six figures, then local navigation; the GP of record and the ledger
// administrator are named, and changed through the reusable person picker,
// whose eligibility is the Worker's and whose confirmation names the change.
//
// Every name, id and amount here is invented.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fund_admin_fund_page_d4812.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { FundAdminConsoleView } from '../src/pages/admin/fundAdmin/FundAdminConsole.jsx';
import { ROLES, checkChange, fundNav, identityLine, keyFigures } from '../src/pages/admin/fundAdmin/fundPageModel.js';

const h = React.createElement;
const SUPER = { id: 1, role: 'admin', is_super_admin: 1 };
const ADMIN = { id: 2, role: 'admin', is_super_admin: 0 };
const ACCESS = (sa) => ({ super_admin: sa, acts: [
  { act: 'fund.gp_of_record', tier: 'super_admin', allowed: sa, sentence: "A Super Admin changes a fund's general partner of record." },
  { act: 'fund_ledger.administrator', tier: 'super_admin', allowed: sa, sentence: "A Super Admin assigns a fund's ledger administrator." },
  { act: 'fund.economics', tier: 'super_admin', allowed: sa, sentence: "A Super Admin changes a fund's carry or management fee." },
  { act: 'fund.write', tier: 'admin', allowed: true, sentence: null },
] });
const FUND = { id: 7, name: 'Spin-Out Fund I', status: 'active', vintage_year: 2026, fund_size_cents: 2500000000, carried_interest: 0.2, management_fee: 0.02, gp_user_id: 1, fund_admin_user_id: 51, lp_count: 31 };
const OVERVIEW = { as_of: '2026-11-09', entities: { state: 'ok', items: [] }, funds: { state: 'ok', items: [{ fund_id: 7, name: 'Spin-Out Fund I', committed_cents: 1840000000, called_cents: 870000000, received_cents: 857500000, outstanding_cents: 12500000, overdue_lines: 0, next_due_date: null }] },
  fees: { state: 'ok', items: [] }, drafts: { state: 'ok', items: [] }, matches: { state: 'ok', items: [] } };
const PERSON = (id, name, kind, eligible, extra = {}) => ({ id, name, kind, eligible, reason: eligible ? null : `Not eligible: ${kind} cannot hold this.`, current: false, ...extra });
const PEOPLE = {
  gp: (sa) => ({ role: 'gp', current: PERSON(1, 'Guillaume L.', 'HQ admin', true, { current: true }), candidates: sa ? [PERSON(1, 'Guillaume L.', 'HQ admin', true, { current: true }), PERSON(60, 'R. Haddad', 'HQ admin', true), PERSON(51, 'M. Okafor', 'Investor account', false)] : null }),
  ledger: (sa) => ({ role: 'ledger', current: PERSON(51, 'M. Okafor', 'Investor account', true, { current: true }), candidates: sa ? [PERSON(51, 'M. Okafor', 'Investor account', true, { current: true }), PERSON(52, 'A. Lund', 'Investor account', true), PERSON(60, 'R. Haddad', 'HQ admin', false)] : null }),
};

/* ------------------------------------------------------------------ the model */

test('six key figures, each a figure, Not recorded with its reason, or Unreadable — never 0', () => {
  const ready = { status: 'ready', data: { as_of: '2026-11-09', nav_cents: 1020000000, distributed_cents: null, unavailable: { distributed_cents: 'No paid distribution is recorded.' } } };
  const f = Object.fromEntries(keyFigures(FUND, OVERVIEW.funds.items[0], ready).map((x) => [x.key, x]));
  assert.deepEqual(Object.keys(f), ['target', 'committed', 'called', 'nav', 'distributed', 'lps']);
  assert.deepEqual([f.target.value, f.committed.value, f.called.value, f.nav.value, f.lps.value], ['$25,000,000.00', '$18,400,000.00', '$8,700,000.00', '$10,200,000.00', '31']);
  assert.equal(f.nav.note, 'latest marks to 2026-11-09');
  assert.deepEqual([f.distributed.state, f.distributed.reason], ['not_recorded', 'No paid distribution is recorded.']);
  const bad = Object.fromEntries(keyFigures({ ...FUND, fund_size_cents: null }, null, { status: 'unreadable' }).map((x) => [x.key, x.state]));
  assert.deepEqual([bad.target, bad.committed, bad.nav], ['not_recorded', 'not_recorded', 'unreadable']);
});

test('identity and local navigation', () => {
  assert.equal(identityLine(FUND, { status: 'ready', data: PEOPLE.gp(false) }), 'Vintage 2026 · Active · GP: Guillaume L.');
  assert.equal(identityLine(FUND, { status: 'ready', data: { current: null } }), 'Vintage 2026 · Active · GP of record not named');
  assert.deepEqual(fundNav(7).map((n) => n.label), ['Overview', 'Investors', 'Capital', 'Portfolio', 'Documents', 'Settings']);
  assert.equal(fundNav(7)[2].to, '/admin/fund-admin/calls?fund=7');
});

test('a change is an eligible person not already in the role; the GP change keeps a reason', () => {
  const haddad = PERSON(60, 'R. Haddad', 'HQ admin', true);
  assert.equal(checkChange('gp', undefined, '').error, 'Choose a person.');
  assert.equal(checkChange('gp', { ...haddad, current: true }, 'x'.repeat(12)).error, 'R. Haddad already holds this role.');
  assert.match(checkChange('ledger', PERSON(60, 'R. Haddad', 'HQ admin', false), '').error, /Not eligible/);
  assert.equal(checkChange('gp', haddad, 'short').error, 'A reason is 10 to 500 characters.');
  assert.deepEqual(checkChange('gp', haddad, '  New fund manager. '), { body: { gp_user_id: 60, reason: 'New fund manager.' } });
  assert.deepEqual(checkChange('ledger', PERSON(52, 'A. Lund', 'Investor account', true), ''), { body: { user_id: 52 } });
  assert.deepEqual(checkChange('ledger', null, ''), { body: { user_id: null } }, 'the ledger administrator can be removed');
  assert.equal(checkChange('gp', null, 'x'.repeat(12)).error, 'A fund keeps a general partner of record.');
  assert.deepEqual(ROLES.ledger.effects('M. Okafor', 'A. Lund'), ['A. Lund can write this fund’s ledger.', 'M. Okafor no longer can.', 'HQ admins keep the books either way.']);
});

test('the unfinished copy is gone', () => {
  const page = readFileSync('frontend/src/pages/admin/fundAdmin/FundPage.jsx', 'utf8');
  assert.doesNotMatch(page, /is not drawn on this page yet|Their name is not read on this page/);
});

/* ------------------------------------------------------------------ mounted */

function stubs(sa, over = {}) {
  const calls = [];
  const rec = (name, f) => (...args) => { calls.push([name, ...args]); return (over[name] || f)(...args); };
  return {
    calls,
    apis: {
      auth: { stepUp: rec('stepUp', async () => ({ ok: true })) },
      fundAdmin: {
        access: rec('access', async () => ACCESS(sa)), overview: async () => OVERVIEW, activity: async () => ({ items: [] }),
        people: rec('people', async (fundId, role, q) => {
          const out = PEOPLE[role](sa);
          return q && out.candidates ? { ...out, candidates: out.candidates.filter((p) => p.name.includes(q)) } : out;
        }),
      },
      funds: {
        get: rec('get', async () => ({ ok: true, fund: FUND, lpa: null })),
        update: rec('update', async () => ({ ok: true })),
        list: async () => ({ items: [FUND] }),
      },
      ledger: { setAdministrator: rec('setAdministrator', async () => ({ ok: true })) },
      performance: { read: rec('perf', async () => ({ as_of: '2026-11-09', nav_cents: 1020000000, distributed_cents: 130000000, unavailable: {} })), list: async () => ({ items: [] }) },
      mercury: {}, fees: {}, reporting: { list: async () => ({ items: [] }) },
    },
  };
}

async function mount(user, s) {
  const restore = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.dispatchEvent = () => true;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/admin/fund-admin/funds/7'] }, h(FundAdminConsoleView, { user, apis: s.apis }))));
  const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const need = (id) => { const n = by(id); assert.ok(n, `no ${id}`); return n; };
  const formOf = (id) => { const all = walk(container); let n = need(id); while (n && n.tagName?.toLowerCase() !== 'form') n = all.find((p) => (p.childNodes || []).includes(n)); return n; };
  const radio = (id) => walk(need(id)).find((n) => n.tagName?.toLowerCase() === 'input');
  return {
    by, props: (id) => pr(by(id)), radio: (id) => pr(radio(id)),
    text: (id) => txt(id ? by(id) : container).replace(/\s+/g, ' ').trim(),
    async click(id) { await act(async () => { await pr(need(id)).onClick?.({ preventDefault() {}, stopPropagation() {}, button: 0 }); }); await flush(); },
    async pick(id) { await act(async () => { pr(radio(id)).onChange?.({ target: {} }); }); await flush(); },
    async type(id, value) { await act(async () => { pr(need(id)).onChange({ target: { value } }); }); await flush(); },
    async submit(id) { await act(async () => { await pr(formOf(id)).onSubmit({ preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

test('the page leads with identity and six figures, then local navigation, Economics and named roles', async () => {
  const v = await mount(SUPER, stubs(true));
  try {
    assert.match(v.text('fund-page'), /Spin-Out Fund I Vintage 2026 · Active · GP: Guillaume L\./);
    assert.match(v.text('fund-figures'), /Target size \$25,000,000\.00 Committed \$18,400,000\.00 Called \$8,700,000\.00 NAV \$10,200,000\.00 latest marks to 2026-11-09 Distributed \$1,300,000\.00 LPs 31/);
    assert.equal(v.props('fund-nav-overview')['aria-current'], 'page');
    assert.match(v.text('fund-gp-name'), /Guillaume L\. · HQ admin/);
    assert.match(v.text('fund-ledger-admin-name'), /M\. Okafor · Investor account/);
    assert.match(v.text('fund-reference'), /Service providers and GP documents/, 'reference facts fold away');
  } finally { await v.close(); }
});

test('the Super Admin changes the ledger administrator: an ineligible person cannot be chosen, the change is named, the code comes first', async () => {
  const s = stubs(true);
  const v = await mount(SUPER, s);
  try {
    await v.click('fund-ledger-admin-change');
    assert.match(v.text('picker-ledger-person-60'), /R\. Haddad HQ admin · Not eligible/);
    assert.equal(v.radio('picker-ledger-person-60').disabled, true, 'an ineligible person cannot be chosen');
    assert.equal(v.radio('picker-ledger-person-51').disabled, true, 'nor the current holder');
    assert.match(v.text('picker-ledger-person-51'), /Current/);
    await v.type('picker-ledger-search', 'Lund');
    await v.submit('picker-ledger-search-submit');
    assert.deepEqual(s.calls.filter(([n]) => n === 'people').at(-1), ['people', 7, 'ledger', 'Lund']);
    await v.pick('picker-ledger-person-52');
    await v.click('picker-ledger-next');
    assert.match(v.text('picker-ledger'), /Replace M\. Okafor with A\. Lund\?/);
    assert.match(v.text('picker-ledger-confirm'), /A\. Lund can write this fund’s ledger\. • M\. Okafor no longer can\./);
    assert.equal(v.text('picker-ledger-confirm-submit'), 'Make A. Lund ledger administrator');
    await v.type('picker-ledger-confirm-code', '123456');
    await v.submit('picker-ledger-confirm-submit');
    const step = s.calls.findIndex(([n]) => n === 'stepUp');
    const write = s.calls.findIndex(([n]) => n === 'setAdministrator');
    assert.ok(step >= 0 && step < write, 'the step-up runs before the change');
    assert.deepEqual(s.calls[write], ['setAdministrator', 7, 52]);
    assert.match(v.text('fund-notice'), /Ledger administrator: A\. Lund\./);
  } finally { await v.close(); }
});

test('the GP of record changes with a reason, sent with the person', async () => {
  const s = stubs(true);
  const v = await mount(SUPER, s);
  try {
    await v.click('fund-gp-change');
    await v.pick('picker-gp-person-60');
    await v.click('picker-gp-next');
    await v.type('picker-gp-confirm-code', '123456');
    await v.submit('picker-gp-confirm-submit');
    assert.equal(v.text('picker-gp-confirm-error'), 'A reason is 10 to 500 characters.');
    assert.ok(!s.calls.some(([n]) => n === 'update'));
    await v.type('picker-gp-reason', 'Guillaume steps back from Fund I.');
    await v.submit('picker-gp-confirm-submit');
    assert.deepEqual(s.calls.find(([n]) => n === 'update'), ['update', 7, { gp_user_id: 60, reason: 'Guillaume steps back from Fund I.' }]);
  } finally { await v.close(); }
});

test('an Admin reads the names and the act table\'s sentences, and is shown no candidates', async () => {
  const s = stubs(false);
  const v = await mount(ADMIN, s);
  try {
    assert.match(v.text('fund-gp-name'), /Guillaume L\./);
    assert.equal(v.text('fund-gp-refused'), "A Super Admin changes a fund's general partner of record.");
    assert.equal(v.text('fund-ledger-admin-refused'), "A Super Admin assigns a fund's ledger administrator.");
    assert.ok(!v.by('fund-gp-change') && !v.by('fund-ledger-admin-change'), 'never a disabled button');
  } finally { await v.close(); }
});

test('a failed names read says Unreadable, never "not named"', async () => {
  const v = await mount(SUPER, stubs(true, { people: async () => { throw new Error('down'); } }));
  try {
    assert.match(v.text('fund-gp-name'), /Unreadable/);
    assert.doesNotMatch(v.text('fund-page'), /GP of record not named/);
  } finally { await v.close(); }
});
