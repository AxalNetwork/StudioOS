// D4811 (#4811) part 7 — the Contracts desk's information architecture (CT-01,
// CT-92 "Tabs and URL", CT-93 "Keyboard"): four workflow tabs; NDAs and Partner
// deals as a radiogroup of Agreements categories; Forms and Document types
// under a Library disclosure; every old ?tab= address still opens its view.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { api, contractsApi } from '../src/lib/api.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import Desk from '../src/pages/admin/contracts/ContractsDesk.jsx';
import { AGREEMENT_CATEGORIES, LIBRARY_ITEMS, PRIMARY_TABS, isLibrary, primaryOf } from '../src/pages/admin/contracts/ContractsNav.jsx';
import { mountContracts } from './_contracts_dom.mjs';

const originals = { ...api }, contractOriginals = { ...contractsApi };
const never = () => new Promise(() => {});
function setup() {
  const calls = [];
  for (const key of Object.keys(originals)) if (typeof originals[key] === 'function') api[key] = (...a) => { calls.push([key, a]); return never(); };
  for (const key of Object.keys(contractOriginals)) contractsApi[key] = (...a) => { calls.push([key, a]); return never(); };
  return calls;
}
const restore = () => { Object.assign(api, originals); Object.assign(contractsApi, contractOriginals); };
const superAdmin = { id: 1, role: 'admin', name: 'Super', is_super_admin: 1 };
const admin = { id: 2, role: 'admin', name: 'Admin', is_super_admin: 0 };
const element = () => React.createElement(AuthProvider, null, React.createElement(Desk));
const walk = (x) => (x.nodeType === 3 || !x.childNodes?.length ? x.textContent || '' : x.childNodes.map(walk).join(''));
const nav = (view) => view.nodes().find((n) => n.tagName === 'NAV' && view.props(n)?.['aria-label'] === 'Contracts tabs');
const current = (view) => (nav(view)?.childNodes || []).filter((n) => view.props(n)?.['aria-current'] === 'page').map(walk);
const radios = (view) => view.nodes().filter((n) => view.props(n)?.role === 'radio');

test('the rules: four workflow tabs; the old views fold into Agreements or the Library', () => {
  assert.deepEqual(PRIMARY_TABS, ['agreements', 'templates', 'governance', 'closings']);
  assert.deepEqual(AGREEMENT_CATEGORIES.map(([k]) => k), ['agreements', 'ndas', 'partner-deals']);
  assert.deepEqual(LIBRARY_ITEMS.map(([k]) => k), ['forms', 'document-types']);
  for (const t of ['agreements', 'ndas', 'partner-deals']) assert.equal(primaryOf(t), 'agreements', t);
  assert.equal(primaryOf('templates'), 'templates');
  assert.equal(primaryOf('forms'), null, 'a Library view is under no workflow tab');
  assert.equal(primaryOf('agreements', { governance: true }), 'governance');
  assert.equal(isLibrary('document-types'), true);
  assert.equal(isLibrary('ndas'), false);
});

test('mounted: the row reads the four tabs; ?tab=ndas still opens NDAs, now as a checked Agreements category; arrows move the category', async () => {
  const calls = setup();
  const view = await mountContracts(element(), '/admin/contracts?tab=ndas', superAdmin);
  try {
    await view.flush();
    assert.equal(walk(nav(view)), 'AgreementsTemplatesCorporate GovernanceClosings', 'four workflow tabs, no peer NDAs, Forms or Document types');
    assert.deepEqual(current(view), ['Agreements'], 'an NDA view belongs to Agreements');
    assert.deepEqual(radios(view).map((n) => [walk(n), view.props(n)['aria-checked']]), [['All agreements', false], ['NDAs', true], ['Partner deals', false]]);
    assert.ok(calls.some(([k]) => k === 'adminListPairwiseNdas'), 'the NDA list itself is unchanged');
    const group = view.nodes().find((n) => view.props(n)?.role === 'radiogroup');
    await act(async () => { view.props(group).onKeyDown({ key: 'ArrowRight', preventDefault() {} }); });
    await view.flush();
    assert.deepEqual(radios(view).filter((n) => view.props(n)['aria-checked']).map(walk), ['Partner deals'], 'ArrowRight moves to the next category');
    await act(async () => { view.props(view.nodes().find((n) => view.props(n)?.role === 'radiogroup')).onKeyDown({ key: 'ArrowRight', preventDefault() {} }); });
    await view.flush();
    assert.deepEqual(radios(view).filter((n) => view.props(n)['aria-checked']).map(walk), ['All agreements'], 'and wraps');
  } finally { await view.unmount(); restore(); }
});

test('the Library: a disclosure with Forms and, for the Super Admin, Document types; ?tab=forms names it; no category row there', async () => {
  setup();
  let view = await mountContracts(element(), '/admin/contracts?tab=forms', superAdmin);
  try {
    await view.flush();
    const lib = () => view.nodes().find((n) => view.props(n)?.['data-testid'] === 'contracts-library');
    assert.match(walk(lib()), /^Library: Forms/);
    assert.equal(view.props(lib())['aria-expanded'], false);
    assert.equal(view.props(view.nodes().find((n) => view.props(n)?.id === 'contracts-library')).hidden, true, 'closed: the list is hidden');
    assert.deepEqual(current(view), [], 'no workflow tab is current on a Library view');
    assert.equal(radios(view).length, 0, 'the categories belong to Agreements only');
    await act(async () => { view.props(lib()).onClick({}); });
    assert.equal(view.props(lib())['aria-expanded'], true);
    const list = view.nodes().find((n) => view.props(n)?.id === 'contracts-library');
    assert.equal(view.props(list).hidden, false, 'the list shows once the disclosure opens');
    const items = view.nodes().filter((n) => n.tagName === 'BUTTON' && ['Forms', 'Document types'].includes(walk(n)));
    assert.deepEqual(items.map(walk), ['Forms', 'Document types']);
    assert.equal(view.props(items[0])['aria-current'], 'page');
  } finally { await view.unmount(); restore(); }
  setup();
  view = await mountContracts(element(), '/admin/contracts?tab=forms', admin);
  try {
    await view.flush();
    const lib = view.nodes().find((n) => view.props(n)?.['data-testid'] === 'contracts-library');
    await act(async () => { view.props(lib).onClick({}); });
    assert.equal(view.nodes().some((n) => n.tagName === 'BUTTON' && walk(n) === 'Document types'), false, 'Document types stays the Super Admin\'s');
  } finally { await view.unmount(); restore(); }
});
