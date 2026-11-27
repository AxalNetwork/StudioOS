/** D7815 (#7815): comparison reconciliation and route-bound fund refreshes on the actual React pages. */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import React, { act } from 'react';
import { Route, Routes, useNavigate } from 'react-router-dom';
import { mountContracts } from './_contracts_dom.mjs';
import { ProjectComparisons } from '../src/pages/research/ProjectComparisons.jsx';
import FundCatalogProfile from '../src/pages/research/FundCatalogProfile.jsx';
import FundDossier from '../src/pages/research/FundDossier.jsx';
import { api } from '../src/lib/api.js';
import { researchProjectComparisonsApi } from '../src/lib/api/researchProjectComparisons.js';
import { researchFundsApi } from '../src/lib/api/researchFunds.js';
import { researchMyFundsApi } from '../src/lib/api/researchMyFunds.js';
import { writeLastResults } from '../src/pages/research/companyDirectoryState.js';
beforeEach(t => { t.mock.method(globalThis, 'fetch', async () => { throw new Error('Synthetic fixture: network disabled'); }); });
const h = React.createElement;
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const walk = node => [node, ...(node?.childNodes || []).flatMap(walk)];
const tid = (m, id) => walk(document.body).find(n => m.props(n)?.['data-testid'] === id);
const props = (m, id) => { const node = tid(m, id); assert.ok(node, id); return m.props(node); };
const textOf = node => !node ? '' : node.childNodes?.length ? node.childNodes.map(textOf).join('') : node.textContent || '';
const button = (m, label) => walk(document.body).find(n => n.tagName === 'BUTTON' && textOf(n) === label);
const until = async (m, condition) => { const end = performance.now() + 5000; while (!condition()) { if (performance.now() > end) assert.fail('Expected UI condition did not settle'); await m.flush(); } };
const catalog = id => ({ item: { uid: id, name: `Vehicle ${id}`, provenance: {}, proposed: {}, source_name: 'Synthetic list' }, history: {}, reports: [], reports_status: 'ok' });
const dossier = id => ({ uid: id, name: `Dossier ${id}`, thesis: 'Synthetic thesis', note: 'Synthetic private note', source_url: 'https://example.test/source', updated_at: '2026-11-22T00:00:00Z', identity_review_needed: true });
async function routed(Component, path, initial) {
  let navigate;
  function Controls() { navigate = useNavigate(); return null; }
  const m = await mountContracts(h(React.Fragment, null, h(Controls), h(Routes, null, h(Route, { path, element: h(Component) }))), initial);
  return { ...m, async go(url) { await act(async () => { navigate(url); }); } };
}
const comparisonRead = { status: 'ok', value: { project: { uid: 'p1', title: 'Project one' }, directory: { company: 'ok', fund: 'ok' }, limits: { members: 6 }, attributes: {}, subjects: [{ uid: 'c1', name: 'Company one', kind: 'company', state: 'listed' }, { uid: 'c2', name: 'Company two', kind: 'company', state: 'listed' }], comparisons: [] } };
test('D7815 a lost project comparison answer reconciles or retries the exact same request, never a second comparison', async t => {
  const sent = [], requestIds = []; let checks = 0, changed = 0;
  t.mock.method(researchProjectComparisonsApi, 'create', async (project, body) => { sent.push({ project, body }); if (sent.length === 1) throw new Error('Synthetic lost response'); return { item: { uid: 'comparison-one' }, repeat: true }; });
  t.mock.method(researchProjectComparisonsApi, 'saveStatus', async id => { requestIds.push(id); checks++; return checks === 1 ? { state: 'not_found' } : { state: 'saved', item: { uid: 'comparison-one', title: 'Existing comparison', members: 2 } }; });
  const m = await mountContracts(h(ProjectComparisons, { projectUid: 'p1', read: comparisonRead, onChanged: () => changed++ }));
  try {
    await act(async () => { props(m, 'pick-company-c1').onChange(); props(m, 'pick-company-c2').onChange(); });
    await act(async () => { await props(m, 'form-new-comparison').onSubmit({ preventDefault() {} }); });
    assert.match(m.text(), /Outcome unknown/);
    assert.doesNotMatch(m.text(), /Nothing was created/);
    assert.equal(props(m, 'button-new-comparison').disabled, true);
    assert.equal(props(m, 'pick-company-c1').disabled, true);
    await act(async () => { await props(m, 'button-project-comparison-status').onClick(); });
    assert.match(m.text(), /safe to try again/);
    await act(async () => { await props(m, 'form-new-comparison').onSubmit({ preventDefault() {} }); });
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[1], sent[0]);
    assert.equal(requestIds[0], sent[0].body.request_id);
    assert.match(sent[0].body.request_id, /^[a-zA-Z0-9-]{16,80}$/);
    assert.equal(changed, 1);
  } finally { await m.unmount(); }
});
test('D7815 both Companies links return to this tab’s last query', async () => {
  const m = await mountContracts(h(ProjectComparisons, { projectUid: 'p1', read: comparisonRead, onChanged() {} }));
  const old = globalThis.sessionStorage; const values = new Map();
  globalThis.sessionStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  try {
    writeLastResults(sessionStorage, '/research/companies?q=grid&page=3', 'Synthetic query');
    // Remount reads the tab store, just as opening the Comparisons tab does.
    await m.unmount();
    const next = await mountContracts(h(ProjectComparisons, { projectUid: 'p1', read: comparisonRead, onChanged() {} }));
    try {
      const links = next.nodes().filter(n => n.tagName === 'A').map(n => next.props(n));
      assert.equal(links.filter(p => p.href === '/research/companies?q=grid&page=3').length, 2);
    } finally { await next.unmount(); }
  } finally { globalThis.sessionStorage = old; }
});
for (const withdrawn of [false, true]) test(`D7815 a late ${withdrawn ? 'withdrawn' : 'successful'} initial fund read cannot replace the route’s fund`, async t => {
  const old = defer();
  t.mock.method(researchFundsApi, 'get', id => id === 'a' ? old.promise : Promise.resolve(catalog(id)));
  t.mock.method(researchMyFundsApi, 'list', async () => ({ items: [] }));
  const m = await routed(FundCatalogProfile, '/research/funds/catalog/:id', '/research/funds/catalog/a');
  try {
    await m.go('/research/funds/catalog/b'); await until(m, () => m.text().includes('Vehicle b'));
    await act(async () => { if (withdrawn) old.reject(Object.assign(new Error('Withdrawn'), { status: 410 })); else old.resolve(catalog('a')); });
    assert.match(m.text(), /Vehicle b/);
    assert.doesNotMatch(m.text(), /Vehicle a/);
    assert.equal(tid(m, 'fund-catalog-removed'), undefined);
  } finally { await m.unmount(); }
});
for (const phase of ['reread', 'save']) test(`D7815 a late ${phase} withdrawal cannot clear or notify the next fund`, async t => {
  const pending = defer(); let reads = 0, writes = 0;
  t.mock.method(researchFundsApi, 'get', async id => { if (id === 'a' && ++reads === 2 && phase === 'reread') return pending.promise; return catalog(id); });
  t.mock.method(researchMyFundsApi, 'list', async () => ({ items: [] }));
  t.mock.method(api.research, 'fundCreate', async () => { writes++; return pending.promise; });
  const m = await routed(FundCatalogProfile, '/research/funds/catalog/:id', '/research/funds/catalog/a');
  try {
    await until(m, () => tid(m, 'fund-catalog-add')); let action;
    await act(async () => { action = props(m, 'fund-catalog-add').onClick(); });
    if (phase === 'save') await until(m, () => writes === 1);
    await m.go('/research/funds/catalog/b'); await until(m, () => m.text().includes('Vehicle b'));
    await act(async () => { pending.reject(Object.assign(new Error('Withdrawn'), { status: 410 })); await action; });
    assert.match(m.text(), /Vehicle b/);
    assert.equal(tid(m, 'fund-catalog-removed'), undefined);
    assert.equal(tid(m, 'fund-catalog-notice'), undefined);
    assert.equal(writes, phase === 'save' ? 1 : 0);
  } finally { await m.unmount(); }
});
for (const operation of ['link', 'own', 'brief']) test(`D7815 the dossier ${operation} refresh answered after navigation cannot replace the next dossier`, async t => {
  const pending = defer(); let oldReads = 0, refreshing = false;
  t.mock.method(api.research, 'fundGet', async id => { if (id === 'a' && ++oldReads > 1) { refreshing = true; return pending.promise; } return dossier(id); });
  t.mock.method(api.research, 'fundUpdate', async () => dossier('a'));
  t.mock.method(api.research, 'zoneDrafts', async () => ({ items: operation === 'brief' ? [{ uid: 'draft-one', body: 'Synthetic brief', accepted: false }] : [] }));
  t.mock.method(api.research, 'zoneDraftAccept', async () => ({ item: { uid: 'draft-one', body: 'Synthetic brief', accepted: true } }));
  t.mock.method(researchFundsApi, 'list', async () => ({ items: [{ uid: 'vehicle-one', name: 'Public vehicle' }] }));
  t.mock.method(researchMyFundsApi, 'list', async () => ({ items: [], catalogue_links: [] }));
  const m = await routed(FundDossier, '/research/funds/:uid', '/research/funds/a');
  try {
    await until(m, () => m.text().includes('Dossier a'));
    if (operation === 'brief') {
      await until(m, () => button(m, 'Write into the note'));
      await act(async () => { m.props(button(m, 'Write into the note')).onClick(); });
    } else {
      const choose = walk(document.body).find(n => n.tagName === 'BUTTON' && /Choose the record|Link to a catalogue/.test(n.textContent || walk(n).filter(x => x.nodeType === 3).map(x => x.textContent).join('')));
      assert.ok(choose, 'identity chooser');
      await act(async () => { m.props(choose).onClick(); });
      await until(m, () => walk(document.body).some(n => m.props(n)?.type === 'radio' && m.props(n)?.value === (operation === 'own' ? 'own' : 'vehicle-one')));
      const radio = walk(document.body).find(n => m.props(n)?.type === 'radio' && m.props(n)?.value === (operation === 'own' ? 'own' : 'vehicle-one'));
      await act(async () => { m.props(radio).onChange(); });
      const label = operation === 'own' ? 'Keep as my own record' : 'Link to Public vehicle';
      await until(m, () => button(m, label));
      await act(async () => { m.props(button(m, label)).onClick(); });
    }
    await until(m, () => refreshing);
    await m.go('/research/funds/b'); await until(m, () => m.text().includes('Dossier b'));
    await act(async () => { pending.resolve({ ...dossier('a'), note: 'Late old dossier answer' }); });
    assert.match(m.text(), /Dossier b/);
    assert.doesNotMatch(m.text(), /Late old dossier answer/);
    assert.doesNotMatch(m.text(), /Dossier a/);
  } finally { await m.unmount(); }
});

for (const navigate of [false, true]) test(`D7815 a queued link ${navigate ? 'is dropped after navigation' : 'waits for the accepted-brief refresh and keeps both results'}`, async t => {
  const pending = defer(); let reads = 0; const updates = [];
  const latest = { ...dossier('a'), note: 'Synthetic accepted brief retained' };
  t.mock.method(api.research, 'fundGet', async id => { if (id === 'b') return dossier('b'); reads++; return reads === 1 ? dossier('a') : reads === 2 ? pending.promise : latest; });
  t.mock.method(api.research, 'fundUpdate', async (id, body) => { updates.push({ id, body }); return latest; });
  t.mock.method(api.research, 'zoneDrafts', async () => ({ items: [{ uid: 'draft-one', body: 'Synthetic brief', accepted: false }] }));
  t.mock.method(api.research, 'zoneDraftAccept', async () => ({ item: { uid: 'draft-one', body: 'Synthetic brief', accepted: true } }));
  t.mock.method(researchFundsApi, 'list', async () => ({ items: [{ uid: 'vehicle-one', name: 'Public vehicle' }] }));
  t.mock.method(researchMyFundsApi, 'list', async () => ({ items: [], catalogue_links: [] }));
  const m = await routed(FundDossier, '/research/funds/:uid', '/research/funds/a');
  try {
    await until(m, () => button(m, 'Write into the note'));
    await act(async () => { m.props(button(m, 'Write into the note')).onClick(); });
    await until(m, () => reads === 2);
    const choose = walk(document.body).find(n => n.tagName === 'BUTTON' && /Choose the record|Link to a catalogue/.test(textOf(n)));
    assert.ok(choose);
    await act(async () => m.props(choose).onClick());
    await until(m, () => walk(document.body).some(n => m.props(n)?.type === 'radio' && m.props(n)?.value === 'vehicle-one'));
    const radio = walk(document.body).find(n => m.props(n)?.type === 'radio' && m.props(n)?.value === 'vehicle-one');
    await act(async () => m.props(radio).onChange());
    await act(async () => { m.props(button(m, 'Link to Public vehicle')).onClick(); });
    assert.deepEqual(updates, [], 'the identity write must wait for the earlier refresh');
    if (navigate) { await m.go('/research/funds/b'); await until(m, () => m.text().includes('Dossier b')); }
    await act(async () => pending.resolve(latest));
    if (navigate) {
      await m.flush(); assert.deepEqual(updates, []); assert.match(m.text(), /Dossier b/);
      return;
    }
    await until(m, () => updates.length === 1 && reads === 3);
    assert.deepEqual(updates, [{ id: 'a', body: { catalogue_uid: 'vehicle-one' } }]);
    assert.match(m.text(), /Dossier a/);
    assert.ok(m.nodes().some(n => m.props(n)?.value === latest.note), 'the accepted brief remains in the note');
    assert.doesNotMatch(m.text(), /Your choice is kept in the sheet/);
  } finally { await m.unmount(); }
});
