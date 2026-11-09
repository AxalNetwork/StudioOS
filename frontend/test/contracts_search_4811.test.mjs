// D4811 (#4811) part 4 — cross-object legal search (board CT-13): one box
// over templates, agreements and governance; each result names its object
// type, context, lifecycle state and version; current versions by default and
// historical ones on request; ↑/↓ and Enter open a result where it lives; a
// store that could not be read is said, never shown as no match. Made-up data.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { api, contractsApi } from '../src/lib/api.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import Desk from '../src/pages/admin/contracts/ContractsDesk.jsx';
import { resultBadge, resultOverlays, resultTarget, summaryLine, versionLine } from '../src/pages/admin/contracts/contractSearchModel.js';
import { mountContracts } from './_contracts_dom.mjs';

const originals = { ...api }, contractOriginals = { ...contractsApi };
const never = () => new Promise(() => {});
function setup(contractAnswers = {}) {
  const calls = [];
  for (const key of Object.keys(originals)) if (typeof originals[key] === 'function') api[key] = () => never();
  for (const key of Object.keys(contractOriginals)) contractsApi[key] = (...args) => { calls.push([key, args]); return (contractAnswers[key] || never)(...args); };
  return calls;
}
const restore = () => { Object.assign(api, originals); Object.assign(contractsApi, contractOriginals); };
const user = { id: 2, role: 'admin', name: 'Admin', is_super_admin: 1 };
const element = () => React.createElement(AuthProvider, null, React.createElement(Desk));
const wait = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const safety = (o = {}) => ({ restricted: false, restricted_reason: null, incomplete: false, incomplete_reason: null, ...o });

const tpl = { type: 'template', key: 'template:initial_lpa', title: 'Initial Limited Partnership Agreement', context: 'gp', status: null, version: 3, historical: false,
  updated_at: null, template: { slug: 'initial_lpa', is_active: 1, published_version: 3, safety: safety() } };
const old = { ...tpl, key: 'template:initial_lpa:v1', version: 1, historical: true, status: 'superseded' };
const ar = { ...tpl, key: 'template:ar_lpa', title: 'Amended and Restated LPA', version: 1, template: { slug: 'ar_lpa', is_active: 1, published_version: null, safety: safety({ restricted: true, incomplete: true }) } };
const agr = { type: 'agreement', key: 'agreement:documents:doc-lpa', title: 'Subscription Booklet & LPA', context: 'Helvetia Capital', status: 'signed', version: null, historical: false,
  updated_at: null, agreement: { uid: 'doc-lpa', source: 'documents', raw_status: 'signed' } };
const gov = { type: 'governance', key: 'governance:g1', title: 'GP LLC Operating Agreement', context: 'Axal VC GP LLC', status: 'executed', version: 2, historical: false,
  updated_at: null, governance: { uid: 'g1', entity_key: 'gp' } };

test('the words: each object in its own lifecycle; a template carries its overlays; versions say current or historical', () => {
  assert.equal(resultBadge(tpl).label, 'Approved for use');
  assert.equal(resultBadge(old).label, 'Superseded', 'an older version than the publication');
  assert.equal(resultBadge(ar).label, 'Under legal review');
  assert.deepEqual(resultOverlays(ar), ['restricted', 'incomplete']);
  assert.deepEqual(resultOverlays(agr), []);
  assert.equal(resultBadge(agr).label, 'Executed');
  assert.equal(resultBadge(gov).label, 'Executed');
  assert.equal(resultBadge({ ...agr, status: 'mystery' }), null, 'an unknown state is not guessed');
  assert.equal(versionLine(tpl), 'v3');
  assert.equal(versionLine(old), 'v1 · Historical');
  assert.equal(versionLine(agr), null);
  assert.equal(versionLine({ ...gov, version: null }), 'No file yet');
  assert.deepEqual(resultTarget(tpl), { kind: 'tab', tab: 'templates', filters: { open: 'initial_lpa' } });
  assert.deepEqual(resultTarget(agr), { kind: 'agreement', uid: 'doc-lpa', title: 'Subscription Booklet & LPA' });
  assert.deepEqual(resultTarget({ ...agr, agreement: { uid: 'x', source: 'licence_agreement' } }), { kind: 'tab', tab: 'agreements', filters: { q: 'Subscription Booklet & LPA' } });
  assert.deepEqual(resultTarget(gov), { kind: 'path', to: '/admin/contracts/governance?entity=gp' });
  assert.equal(summaryLine({ total: 3, items: [1, 2, 3], historical: false, hidden_historical: 6, unreadable: [], governance_scope: 'hq' }),
    '3 results · current versions only · 6 historical versions hidden');
  assert.equal(summaryLine({ total: 60, items: new Array(50), historical: true, hidden_historical: 0, unreadable: ['governance'], governance_scope: 'hq' }),
    '60 results, first 50 shown · historical versions included · Governance records could not be read');
});

test('mounted: typing searches after the pause, results name type, context, state and version, and Enter opens the highlighted one', async () => {
  const calls = setup({ stats: never, agreements: async () => ({ total: 0, items: [] }),
    search: async ({ historical }) => ({ q: 'LPA', historical, total: 4, items: [tpl, ar, agr, gov], counts: { template: 2, agreement: 1, governance: 1 }, hidden_historical: 2, unreadable: [], governance_scope: 'hq', limit: 50 }) });
  const view = await mountContracts(element(), '/admin/contracts', user);
  try {
    await view.flush();
    const box = () => view.nodes().find((n) => n.tagName === 'INPUT' && view.props(n)?.role === 'combobox');
    assert.ok(box(), 'the search box is a combobox');
    await act(async () => { view.props(box()).onChange({ target: { value: 'L' } }); });
    await wait(300);
    assert.equal(calls.filter(([k]) => k === 'search').length, 0, 'one character does not search');
    await act(async () => { view.props(box()).onChange({ target: { value: 'LPA' } }); });
    await wait(100);
    assert.equal(calls.filter(([k]) => k === 'search').length, 0, 'nothing is sent before the 250 ms pause');
    await wait(200);
    assert.deepEqual(calls.filter(([k]) => k === 'search').at(-1)[1][0], { q: 'LPA', historical: false });
    const text = view.text();
    assert.match(text, /4 results · current versions only · 2 historical versions hidden/);
    assert.match(text, /Initial Limited Partnership AgreementTemplategp/);
    assert.match(text, /Subscription Booklet & LPAAgreementHelvetia Capital/);
    assert.match(text, /GP LLC Operating AgreementGovernanceAxal VC GP LLC/);
    assert.match(text, /Under legal review.*Restricted.*Incomplete/, 'the overlays sit beside the state');
    const options = view.nodes().filter((n) => view.props(n)?.role === 'option');
    assert.equal(options.length, 4);
    await act(async () => { view.props(box()).onKeyDown({ key: 'ArrowDown', preventDefault() {} }); });
    await act(async () => { view.props(box()).onKeyDown({ key: 'ArrowDown', preventDefault() {} }); });
    await act(async () => { view.props(box()).onKeyDown({ key: 'ArrowDown', preventDefault() {} }); });
    assert.equal(view.props(view.nodes().filter((n) => view.props(n)?.role === 'option')[2])['aria-selected'], true);
    await act(async () => { view.props(box()).onKeyDown({ key: 'Enter', preventDefault() {} }); });
    await view.flush();
    assert.deepEqual(calls.filter(([k]) => k === 'history').at(-1)?.[1], ['doc-lpa'], 'the highlighted agreement opens in the desk panel');
    // Historical versions on request.
    const toggle = view.nodes().find((n) => n.tagName === 'INPUT' && view.props(n)?.type === 'checkbox');
    await act(async () => { view.props(toggle).onChange({ target: { checked: true } }); });
    await wait(300);
    assert.deepEqual(calls.filter(([k]) => k === 'search').at(-1)[1][0], { q: 'LPA', historical: true });
  } finally { await view.unmount(); restore(); }
});

test('a failed search says so; an empty answer says what was searched; a template result opens the Templates tab on it', async () => {
  let fail = true;
  const calls = setup({ stats: never, agreements: async () => ({ total: 0, items: [] }),
    search: async ({ q }) => (fail ? Promise.reject(new Error('Search is unreadable. Try again.'))
      : q === 'zzz' ? { q, historical: false, total: 0, items: [], counts: {}, hidden_historical: 0, unreadable: [], governance_scope: 'hq' }
        : { q, historical: false, total: 1, items: [tpl], counts: {}, hidden_historical: 0, unreadable: [], governance_scope: 'hq' }) });
  const view = await mountContracts(element(), '/admin/contracts', user);
  try {
    await view.flush();
    const box = () => view.nodes().find((n) => n.tagName === 'INPUT' && view.props(n)?.role === 'combobox');
    await act(async () => { view.props(box()).onChange({ target: { value: 'LPA' } }); }); await wait(300);
    assert.match(view.text(), /Search is unreadable\. Try again\./);
    assert.doesNotMatch(view.text(), /No template, agreement or governance record matches/, 'a failure is never shown as no match');
    fail = false;
    await act(async () => { view.props(box()).onChange({ target: { value: 'zzz' } }); }); await wait(300);
    assert.match(view.text(), /No template, agreement or governance record matches “zzz”\./);
    await act(async () => { view.props(box()).onChange({ target: { value: 'initial' } }); }); await wait(300);
    await act(async () => { view.props(box()).onKeyDown({ key: 'Enter', preventDefault() {} }); });
    await view.flush();
    assert.ok(calls.some(([k]) => k === 'templates'), 'Enter on the top result opens the Templates tab');
  } finally { await view.unmount(); restore(); }
});
