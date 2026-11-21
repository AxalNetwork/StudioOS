/** D6397 (#6397): a navigation handoff opens the existing call preparation form once, with recorded scope and blank inputs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FundAdminConsoleView } from '../src/pages/admin/fundAdmin/FundAdminConsole.jsx';
import { mountContracts } from './_contracts_dom.mjs';
const h = React.createElement;
const USER = { id: 902, role: 'admin', name: 'Synthetic Admin' };
function Location() { const location = useLocation(); const navigate = useNavigate(); return h(React.Fragment, null, h('output', { 'data-testid': 'handoff-location' }, location.search), h('button', { onClick: () => navigate('/admin/fund-admin/calls?fund=8&new=1') }, 'Other fund')); }
function stubs(allowed = true) {
  const reads = []; let writes = 0;
  const ledger = { summary: { committed_cents: 100000, called_cents: 0, received_cents: 0, outstanding_cents: 0 }, calls: [], unnumbered: [] };
  const apis = {
    fundAdmin: {
      access: async () => ({ super_admin: false, acts: [{ act: 'capital_call.preview', allowed, sentence: 'Preview unavailable.' }, { act: 'capital_call.issue', allowed: false, sentence: 'A Super Admin issues capital calls.' }] }),
      overview: async () => ({ as_of: '2026-11-14', funds: { state: 'ok', items: [{ fund_id: 7, name: 'Chosen Fund', committed_cents: 100000 }, { fund_id: 8, name: 'Other Fund', committed_cents: 100000 }] }, entities: { state: 'ok', items: [] }, fees: { state: 'ok', items: [] }, drafts: { state: 'ok', items: [] }, matches: { state: 'ok', items: [] } }),
    },
    calls: { ledger: async id => { reads.push(id); return ledger; }, preview: async () => { writes++; throw new Error('unexpected preview'); }, issue: async () => { writes++; throw new Error('unexpected issue'); } },
  };
  return { apis, reads, get writes() { return writes; } };
}
const by = (m, id) => m.nodes().find(node => m.props(node)?.['data-testid'] === id);
test('call preparation navigation consumes its flag and opens only the chosen fund with empty amount and date', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1794657600000 });
  const s = stubs();
  const m = await mountContracts(h(React.Fragment, null, h(FundAdminConsoleView, { user: USER, apis: s.apis }), h(Location)), '/admin/fund-admin/calls?fund=7&new=1', USER);
  try {
    assert.ok(by(m, 'calls-new-dialog'));
    assert.equal(m.props(by(m, 'calls-new-amount')).value, '');
    assert.equal(m.props(by(m, 'calls-new-due')).value, '');
    assert.match(m.text(), /Chosen Fund/);
    assert.ok(s.reads.every(id => id === 7));
    assert.equal(m.props(by(m, 'handoff-location')).children, '?fund=7');
    assert.equal(s.writes, 0);
    await m.fill('Amount ($)', '123');
    await m.click('Other fund');
    assert.ok(s.reads.includes(8));
    assert.equal(m.props(by(m, 'calls-new-amount')).value, '', 'another fund never inherits typed amount');
    assert.equal(m.props(by(m, 'handoff-location')).children, '?fund=8');
    await m.click('Cancel');
    assert.equal(Boolean(by(m, 'calls-new-dialog')), false, 'closing does not reopen a consumed handoff');
  } finally { await m.unmount(); }
});
test('a refused preview and ordinary call navigation do not open the handoff', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1794657600000 });
  for (const [allowed, query] of [[false, '?fund=7&new=1'], [true, '?fund=7'], [true, '?fund=999&new=1'], [true, '?new=1']]) {
    const s = stubs(allowed);
    const m = await mountContracts(h(FundAdminConsoleView, { user: USER, apis: s.apis }), '/admin/fund-admin/calls' + query, USER);
    try { assert.equal(Boolean(by(m, 'calls-new-dialog')), false); assert.equal(s.writes, 0); }
    finally { await m.unmount(); }
  }
});
