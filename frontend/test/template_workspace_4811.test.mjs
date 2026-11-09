// D4811 (#4811) part 10 — a template's workspace (board CT-07 for a template;
// CT-09/CT-10 overlays) at /admin/contracts/templates/doc/:slug, and the
// search filter row (CT-13). The workspace reads the library row, its saved
// versions and its preview; what no store holds says Not recorded and why.
// The filters narrow the returned results; unknown is never "recent". Made-up data.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { Routes, Route } from 'react-router-dom';
import { api, contractsApi } from '../src/lib/api.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import Desk from '../src/pages/admin/contracts/ContractsDesk.jsx';
import { TEMPLATE_TABS, savedLine, templateRow, templateVersionMarkers, usageLine, versionRows } from '../src/pages/admin/contracts/TemplateWorkspace.jsx';
import { EMPTY_FILTERS, activeFilterCount, applyFilters, filterOptions } from '../src/pages/admin/contracts/contractSearchModel.js';
import { mountContracts } from './_contracts_dom.mjs';
import { adminLegalReviewsApi } from '../src/lib/api/adminLegalReviews.js';
// D4811 part 16: the Legal Review tab and the Overview's "Last review" read the review record; none is recorded here.
adminLegalReviewsApi.list = async (kind, ref) => ({ object: { kind, ref, title: 'x', version: 1, sha256: 'a'.repeat(64) }, reviews: [], counsel: [], viewer: { id: 2, counsel: false, super_admin: false } });


const never = () => new Promise(() => {});
const originals = { ...api }, contractOriginals = { ...contractsApi };
function setup({ api: apiAnswers = {}, contracts = {} } = {}) {
  const calls = [];
  for (const key of Object.keys(originals)) if (typeof originals[key] === 'function') api[key] = (...args) => { calls.push([key, args]); return (apiAnswers[key] || never)(...args); };
  for (const key of Object.keys(contractOriginals)) contractsApi[key] = (...args) => { calls.push([key, args]); return (contracts[key] || never)(...args); };
  return calls;
}
const restore = () => { Object.assign(api, originals); Object.assign(contractsApi, contractOriginals); };
const user = { id: 2, role: 'admin', name: 'Admin', is_super_admin: 1 };
const safety = (o = {}) => ({ restricted: false, restricted_reason: null, incomplete: false, incomplete_reason: null, ...o });
const row = (o = {}) => ({ slug: 'initial_lpa', title: 'Initial Limited Partnership Agreement', category: 'gp', layer_label: 'GP / Fund', version: 3, is_active: 1, is_stub: 0,
  published_version: 2, usage_count: 4, merge_fields: ['fund_name', 'gp_name'], updated_at: '2026-11-01T10:00:00Z', updated_by: 7, safety: safety(), ...o });
const versions = { current: { version: 3, updated_at: '2026-11-01T10:00:00Z', updated_by: 7 },
  versions: [{ version: 2, created_at: '2026-10-01T10:00:00Z', created_by: 5 }, { version: 1, created_at: '2026-09-01T10:00:00Z', created_by: null }] };
const page = () => React.createElement(AuthProvider, null, React.createElement(Routes, null,
  React.createElement(Route, { path: '/admin/contracts/templates/doc/:slug', element: React.createElement(Desk, { section: 'template' }) })));
const nodeText = (node) => (!node ? '' : node.nodeType === 3 ? node.textContent || '' : node.childNodes?.length ? node.childNodes.map(nodeText).join('') : node.textContent || '');
const tabButton = (view, key) => view.nodes().find((n) => n.tagName === 'BUTTON' && view.props(n)?.id === `tw-tab-${key}`);

test('the rules: six tabs; the row from the library; versions newest first with Current, Published and Superseded; saves; usage', () => {
  assert.deepEqual(TEMPLATE_TABS.map(([, l]) => l), ['Overview', 'Document', 'Versions', 'Legal Review', 'Activity', 'Related']);
  assert.equal(templateRow({ items: [row({ slug: 'a' }), row()] }, 'initial_lpa').slug, 'initial_lpa');
  assert.equal(templateRow({ items: [row()] }, 'gone'), null);
  assert.equal(templateRow(null, 'initial_lpa'), null);
  const rows = versionRows(versions);
  assert.deepEqual(rows.map((r) => [r.version, r.current]), [[3, true], [2, false], [1, false]]);
  assert.deepEqual(versionRows({ current: { version: 3 }, versions: [{ version: 3 }, { version: 2 }] }).map((r) => r.version), [3, 2], 'the current text is listed once');
  assert.deepEqual(versionRows(null), []);
  assert.deepEqual(versionRows({ current: { version: 3 }, versions: [{ version: 1 }, { version: 2 }] }).map((r) => r.version), [3, 2, 1], 'newest first whatever order the store answers in');
  assert.deepEqual(templateVersionMarkers(rows[0], 2), ['Current']);
  assert.deepEqual(templateVersionMarkers(rows[1], 2), ['Published']);
  assert.deepEqual(templateVersionMarkers(rows[2], 2), ['Superseded']);
  assert.deepEqual(templateVersionMarkers(rows[2], null), [], 'never published: nothing is superseded');
  assert.equal(savedLine(rows[1]), 'Saved v2 · Admin #5');
  assert.equal(savedLine(rows[2]), 'Saved v1 · saver not recorded');
  assert.equal(usageLine(row()), '4 agreements made from it');
  assert.equal(usageLine(row({ usage_count: 1 })), '1 agreement made from it');
  assert.equal(usageLine(row({ usage_count: 0 })), '0 agreements made from it', 'a counted zero is a zero');
  assert.equal(usageLine(row({ usage_count: undefined })), null, 'an unreturned count is unknown, never 0');
});

test('mounted: Overview says each fact or why it is unknown; Versions and Activity from the saves; Related links its agreements', async () => {
  const calls = setup({ api: { adminTemplateStoreVersions: async () => versions }, contracts: { templates: async () => ({ items: [row()] }), stats: never } });
  const view = await mountContracts(page(), '/admin/contracts/templates/doc/initial_lpa', user);
  try {
    await view.flush();
    let text = view.text();
    assert.match(text, /Contracts › Templates › GP \/ Fund/);
    assert.match(text, /Initial Limited Partnership Agreement/);
    assert.match(text, /Current versionv3/);
    assert.match(text, /Published versionv2/);
    assert.match(text, /Merge fields2/);
    assert.match(text, /Used by4 agreements made from it/);
    assert.match(text, /Last reviewNot recorded.*No legal review has been recorded\./);
    assert.ok(view.nodes().some((n) => n.tagName === 'A' && view.props(n)?.href === '/admin/contracts?tab=templates&open=initial_lpa' && /Edit in editor/.test(nodeText(n))), 'Edit in editor opens the editor on it');
    assert.deepEqual(calls.filter(([k]) => k === 'adminTemplateStoreVersions').map(([, a]) => a), [['initial_lpa']]);
    await act(async () => { view.props(tabButton(view, 'versions')).onClick({}); }); await view.flush();
    text = view.text();
    assert.match(text, /v3Current/);
    assert.match(text, /v2Published/);
    assert.match(text, /v1Superseded/);
    await act(async () => { view.props(tabButton(view, 'activity')).onClick({}); }); await view.flush();
    assert.match(view.text(), /Saved v3 · Admin #7.*Saved v2 · Admin #5.*Saved v1 · saver not recorded/s);
    assert.match(view.text(), /Publish, withdraw and preview events are not listed here\./);
    await act(async () => { view.props(tabButton(view, 'related')).onClick({}); }); await view.flush();
    assert.match(view.text(), /4 agreements made from it/);
    assert.ok(view.nodes().some((n) => n.tagName === 'A' && view.props(n)?.href === '/admin/contracts?template=initial_lpa'), 'its agreements are one press away');
    await act(async () => { view.props(tabButton(view, 'legal-review')).onClick({}); }); await view.flush();
    assert.match(view.text(), /Not recorded.*No legal review has been requested for this document\./);
  } finally { await view.unmount(); restore(); }
});

test('mounted: a restricted, incomplete template says so with what is unavailable; a template no longer in the library says so; a failed read is unreadable', async () => {
  setup({ api: { adminTemplateStoreVersions: async () => versions }, contracts: { stats: never,
    templates: async () => ({ items: [row({ published_version: null, safety: safety({ restricted: true, restricted_reason: 'Counsel has not reviewed it.', incomplete: true }) })] }) } });
  let view = await mountContracts(page(), '/admin/contracts/templates/doc/initial_lpa', user);
  try {
    await view.flush();
    const text = view.text();
    assert.match(text, /Restricted — Legal review required Counsel has not reviewed it\. Not available: Generate agreement, Use template, Publish\./);
    assert.match(text, /Published versionNot recorded.*Not published\./);
    assert.match(text, /Safety stateRestricted · Incomplete/);
  } finally { await view.unmount(); restore(); }
  setup({ contracts: { stats: never, templates: async () => ({ items: [] }) } });
  view = await mountContracts(page(), '/admin/contracts/templates/doc/gone', user);
  try { await view.flush(); assert.match(view.text(), /This template is not in the library/); } finally { await view.unmount(); restore(); }
  setup({ contracts: { stats: never, templates: () => Promise.reject(new Error('Templates or their usage are unreadable. Try again.')) } });
  view = await mountContracts(page(), '/admin/contracts/templates/doc/initial_lpa', user);
  try { await view.flush(); assert.match(view.text(), /Unreadable\..*could not be read/); assert.doesNotMatch(view.text(), /not in the library/, 'a failed read is not "gone"'); } finally { await view.unmount(); restore(); }
});

test('the filter row: options from the results; type, state, entity and updated narrow them; unknown dates never count as recent', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const items = [
    { type: 'template', key: 't1', title: 'A', context: 'gp', status: null, version: 3, historical: false, updated_at: '2026-11-01T10:00:00Z', template: { slug: 'a', is_active: 1, published_version: 3, safety: safety() } },
    { type: 'agreement', key: 'a1', title: 'B', context: 'Helvetia Capital', status: 'signed', version: null, historical: false, updated_at: '2026-01-01 10:00:00', agreement: { uid: 'u', source: 'documents' } },
    { type: 'governance', key: 'g1', title: 'C', context: null, status: 'executed', version: 1, historical: false, updated_at: null, governance: { uid: 'g', entity_key: 'gp' } },
  ];
  const o = filterOptions(items);
  assert.deepEqual(o.types.map(([k]) => k), ['template', 'agreement', 'governance']);
  assert.deepEqual(o.contexts.map(([, l]) => l), ['gp', 'Helvetia Capital', 'No entity or company recorded'], 'the unrecorded context is offered last, by name');
  assert.equal(applyFilters(items, EMPTY_FILTERS, now).length, 3);
  assert.deepEqual(applyFilters(items, { ...EMPTY_FILTERS, type: 'agreement' }, now).map((r) => r.key), ['a1']);
  assert.deepEqual(applyFilters(items, { ...EMPTY_FILTERS, context: '__none__' }, now).map((r) => r.key), ['g1']);
  assert.deepEqual(applyFilters(items, { ...EMPTY_FILTERS, updated: '30' }, now).map((r) => r.key), ['t1'], 'an unknown update date is not recent');
  assert.deepEqual(applyFilters(items, { ...EMPTY_FILTERS, updated: '365' }, now).map((r) => r.key), ['t1', 'a1'], 'a D1-style date is read');
  const executed = o.states.find(([, l]) => /Executed/.test(l));
  assert.ok(executed, 'states are named in their own lifecycle words');
  const byState = applyFilters(items, { ...EMPTY_FILTERS, state: executed[0] }, now).map((r) => r.key);
  assert.ok(byState.includes('g1') && !byState.includes('t1'), 'the state filter keeps the executed record and drops the template');
  assert.equal(activeFilterCount(EMPTY_FILTERS), 0);
  assert.equal(activeFilterCount({ ...EMPTY_FILTERS, type: 'template', updated: '30' }), 2);
});

test('mounted: the filter row narrows what is listed, says so in the summary, and Clear filters restores it', async () => {
  const items = [
    { type: 'template', key: 'template:a', title: 'Alpha LPA', context: 'gp', status: null, version: 1, historical: false, updated_at: null, template: { slug: 'a', is_active: 1, published_version: 1, safety: safety() } },
    { type: 'agreement', key: 'agreement:x', title: 'Beta LPA', context: 'Helvetia Capital', status: 'signed', version: null, historical: false, updated_at: null, agreement: { uid: 'x', source: 'documents' } },
  ];
  setup({ contracts: { stats: never, agreements: async () => ({ total: 0, items: [] }),
    search: async ({ q }) => ({ q, historical: false, total: 2, items, counts: {}, hidden_historical: 0, unreadable: [], governance_scope: 'hq' }) } });
  const view = await mountContracts(React.createElement(AuthProvider, null, React.createElement(Desk)), '/admin/contracts', user);
  try {
    await view.flush();
    const box = view.nodes().find((n) => n.tagName === 'INPUT' && view.props(n)?.role === 'combobox');
    await act(async () => { view.props(box).onChange({ target: { value: 'LPA' } }); });
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); }); await view.flush();
    const results = () => view.nodes().filter((n) => String(view.props(n)?.['data-testid'] || '').startsWith('search-result-')).map((n) => view.props(n)['data-testid']);
    assert.deepEqual(results(), ['search-result-template:a', 'search-result-agreement:x']);
    const select = (label) => view.nodes().find((n) => n.tagName === 'SELECT' && nodeText(n.parentNode).startsWith(label));
    await act(async () => { view.props(select('Type')).onChange({ target: { value: 'agreement' } }); }); await view.flush();
    assert.deepEqual(results(), ['search-result-agreement:x']);
    assert.match(view.text(), /filtered to 1 of 2 shown/);
    const clear = view.nodes().find((n) => n.tagName === 'BUTTON' && /Clear filters/.test(nodeText(n)));
    await act(async () => { view.props(clear).onClick({}); }); await view.flush();
    assert.equal(results().length, 2);
    await act(async () => { view.props(select('Entity or company')).onChange({ target: { value: 'nobody' } }); }); await view.flush();
    assert.match(view.text(), /No result passes these filters\./, 'an empty filter result is not "no match"');
  } finally { await view.unmount(); restore(); }
});
