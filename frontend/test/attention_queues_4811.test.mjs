// D4811 (#4811) part 11 — the overview's short queues under the metric strip
// (board CT-01) and the Link recipient repair (CT-02): stalled oldest first
// with its age (an unrecorded send has none), each repair with its action,
// templates and governance records waiting on review, a queue that could not
// be read says so, and Link goes Choose → Review → Result. Made-up data.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { api, contractsApi } from '../src/lib/api.js';
import { adminGovernanceApi } from '../src/lib/api/adminGovernance.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import Desk from '../src/pages/admin/contracts/ContractsDesk.jsx';
import { agreementRowSemantics } from '../src/lib/contractLifecycle.js';
import { repairOf, reviewItems, sentAge, stalledItem } from '../src/pages/admin/contracts/attentionQueues.js';
import { mountContracts } from './_contracts_dom.mjs';

const originals = { ...api }, contractOriginals = { ...contractsApi }, govOriginals = { ...adminGovernanceApi };
const never = () => new Promise(() => {});
function setup(contractAnswers = {}, govAnswers = {}) {
  const calls = [];
  for (const key of Object.keys(originals)) if (typeof originals[key] === 'function') api[key] = () => never();
  for (const key of Object.keys(contractOriginals)) contractsApi[key] = (...args) => { calls.push([key, args]); return (contractAnswers[key] || never)(...args); };
  for (const key of Object.keys(govOriginals)) adminGovernanceApi[key] = (...args) => { calls.push([`gov.${key}`, args]); return (govAnswers[key] || never)(...args); };
  return calls;
}
const restore = () => { Object.assign(api, originals); Object.assign(contractsApi, contractOriginals); Object.assign(adminGovernanceApi, govOriginals); };
const user = { id: 2, role: 'admin', name: 'Admin', is_super_admin: 1 };
const element = () => React.createElement(AuthProvider, null, React.createElement(Desk));
const wait = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const NOW = Date.parse('2026-11-09T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();
const nodeText = (n) => (n.nodeType === 3 || !(n.childNodes || []).length ? (n.textContent || '') : n.childNodes.map(nodeText).join(''));

const old = { uid: 'env-old', source: 'esign', title: 'Founder Collaboration Agreement', status: 'sent', sent_at: daysAgo(179), project_name: null, recipient_name: 'Norman Laudini' };
const fresh = { uid: 'env-new', source: 'esign', title: 'Subscription Agreement', status: 'sent', sent_at: daysAgo(10), project_name: 'Helvetia Capital AG' };
const nosend = { uid: 'env-nosend', source: 'esign', title: 'Service Agreement', status: 'sent', sent_at: null, project_name: 'Studio Vireo' };
const bare = { uid: 'doc-bare', source: 'documents', title: 'Co-founder Agreement', status: 'signed', project_name: 'Novacraft' };
const nda = { uid: 'pairwise:1', source: 'pairwise_nda', title: 'Mutual NDA', status: 'sent', project_name: null };

test('the rules: age from the recorded send only; stalled past 30 days; each repair names its action; NDAs are not unlinked', () => {
  assert.equal(sentAge(old, NOW), 179);
  assert.equal(sentAge(nosend, NOW), null, 'an unrecorded send has no age, never 0');
  assert.equal(stalledItem(old, NOW).stalled, true);
  assert.equal(stalledItem(fresh, NOW).stalled, false);
  assert.equal(stalledItem({ ...fresh, sent_at: daysAgo(30) }, NOW).stalled, false, 'thirty days is not yet stalled');
  assert.equal(stalledItem({ ...fresh, sent_at: daysAgo(31) }, NOW).stalled, true);
  assert.equal(stalledItem(nosend, NOW).stalled, false);
  assert.equal(stalledItem(old, NOW).party, 'Unlinked recipient · Norman Laudini');
  assert.deepEqual(repairOf(bare), { kind: 'evidence', problem: 'Marked signed · no execution evidence', action: { kind: 'open', label: 'Open the record' } });
  assert.equal(repairOf(old).action.kind, 'link');
  assert.equal(repairOf({ ...bare, project_name: null }).kind, 'evidence', 'a contradiction comes before a missing link');
  assert.equal(repairOf(nda), null, 'a pairwise NDA has no company link to make');
  assert.equal(repairOf({ ...old, status: 'void' }), null);
  assert.equal(repairOf(fresh), null);
  assert.deepEqual(agreementRowSemantics(nda).company, { none: true, label: 'No company link in this store' });
  assert.equal(agreementRowSemantics(old).company.unlinked, true);
  const items = reviewItems(
    [{ slug: 'initial_lpa', title: 'Initial LPA', published_version: 3, is_active: 1, safety: { restricted: false, incomplete: false } },
      { slug: 'ar_lpa', title: 'A&R LPA', layer_label: 'GP / Fund', version: 1, published_version: null, is_active: 1, safety: { restricted: true, incomplete: true } }],
    { entities: [{ key: 'gp', name: 'Axal VC GP LLC', documents: [{ uid: 'g1', title: 'Operating Agreement (A&R draft)', status: 'review', latest: { version: 3 } }, { uid: 'g2', title: 'Old', status: 'executed' }] }] });
  assert.deepEqual(items.map((i) => [i.type, i.title, i.context, i.overlays.join('+'), i.to]), [
    ['template', 'A&R LPA', 'GP / Fund · v1', 'restricted+incomplete', '/admin/contracts?tab=templates&open=ar_lpa'],
    ['governance', 'Operating Agreement (A&R draft)', 'Axal VC GP LLC · v3', '', '/admin/contracts/governance/doc/g1'],
  ]);
  assert.deepEqual(reviewItems([], null), []);
});

test('mounted: three queues under the strip; Link goes Choose → Review → Result and reloads the desk', async () => {
  let linked = false;
  const agreements = async (p) => {
    if (p.attention === 'repair') return linked ? { total: 1, items: [bare] } : { total: 2, items: [bare, old] };
    if (p.status === 'awaiting_signature') return { total: 3, items: [old, fresh, nosend] };
    return { total: 2, items: [{ ...old, id: 1 }, { ...nda, id: 2 }] };
  };
  const calls = setup({ stats: never, agreements, templates: async () => ({ items: [] }),
    deals: async () => ({ items: [{ id: 91, uid: 'deal-gamma', project_name: 'Gamma' }] }),
    link: async () => { linked = true; return { ok: true, project_name: 'Gamma' }; } },
  { list: async () => ({ entities: [{ key: 'gp', name: 'Axal VC GP LLC', documents: [{ uid: 'g1', title: 'Operating Agreement (A&R draft)', status: 'review', latest: { version: 3 } }] }] }) });
  const view = await mountContracts(element(), '/admin/contracts', user);
  try {
    await view.flush(); await view.flush();
    const q = (id) => view.nodes().find((n) => view.props(n)?.['data-testid'] === id);
    assert.ok(q('queue-stalled') && q('queue-repair') && q('queue-review'), 'three queues');
    assert.deepEqual(calls.find(([k, [p]]) => k === 'agreements' && p?.status === 'awaiting_signature')[1][0],
      { status: 'awaiting_signature', sort: 'sent_at', direction: 'asc', limit: 3 }, 'oldest send first, three rows');
    const stalledText = nodeText(q('queue-stalled'));
    assert.match(stalledText, /3 · oldest send first/);
    assert.match(stalledText, /Founder Collaboration Agreement.*\d+ d · stalled/);
    assert.match(stalledText, /Service Agreement.*send not recorded/);
    assert.doesNotMatch(stalledText, /Service Agreement[^·]*· 0 d/, 'an unrecorded send never reads as 0 days');
    const repairText = nodeText(q('queue-repair'));
    assert.match(repairText, /Marked signed · no execution evidence.*Open the record/);
    assert.match(repairText, /Recipient not linked to a company.*⚭ Link recipient/);
    assert.match(nodeText(q('queue-review')), /Operating Agreement \(A&R draft\).*Axal VC GP LLC · v3/);
    // The table's row repair (CT-02): a quiet dashed Link where a company link can be made, none on an NDA.
    const testIds = view.nodes().map((n) => view.props(n)?.['data-testid']).filter(Boolean);
    assert.ok(testIds.includes('agreement-link-env-old'));
    assert.ok(!testIds.includes('agreement-link-pairwise:1'), 'no Link on a pairwise NDA');
    assert.match(view.text(), /No company link in this store/);
    // Link: choose a deal, review, confirm.
    const linkButton = view.nodes().find((n) => view.props(n)?.['data-testid'] === 'repair-link-env-old');
    await act(async () => { view.props(linkButton).onClick(); });
    await wait(300);
    const dialog = () => view.nodes().find((n) => view.props(n)?.['data-testid'] === 'contracts-link-recipient');
    assert.ok(dialog(), 'the Link dialog opens');
    assert.throws(() => { if (view.props(view.nodes().find((n) => n.tagName === 'BUTTON' && nodeText(n) === 'Continue')).disabled) throw new Error('disabled'); }, /disabled/, 'Continue waits for a deal');
    const radio = view.nodes().find((n) => n.tagName === 'INPUT' && view.props(n)?.type === 'radio');
    await act(async () => { view.props(radio).onChange(); });
    await view.click('Continue');
    assert.match(nodeText(dialog()), /“Founder Collaboration Agreement” is linked to Gamma through deal deal-gamma/);
    assert.equal(calls.filter(([k]) => k === 'link').length, 0, 'nothing is sent before the confirmation');
    await view.click('Link recipient');
    await view.flush();
    assert.deepEqual(calls.find(([k]) => k === 'link')[1], ['env-old', 91]);
    assert.match(nodeText(dialog()), /Linked to Gamma\./);
    const before = calls.filter(([k, [p]]) => k === 'agreements' && p?.attention === 'repair').length;
    await view.click('Close');
    await view.flush();
    assert.ok(calls.filter(([k, [p]]) => k === 'agreements' && p?.attention === 'repair').length > before, 'the queues re-read after a link');
    assert.doesNotMatch(nodeText(q('queue-repair')), /Recipient not linked/);
  } finally { await view.unmount(); restore(); }
});

test('a refused link says why and offers the form again; an unreadable queue says so, never "nothing"', async () => {
  setup({ stats: never, templates: async () => Promise.reject(new Error('down')),
    agreements: async (p) => (p.attention === 'repair' ? { total: 1, items: [old] } : p.status === 'awaiting_signature' ? Promise.reject(new Error('down')) : { total: 0, items: [] }),
    deals: async () => ({ items: [{ id: 90, uid: 'deal-beta', project_name: 'Beta' }] }),
    link: async () => Promise.reject(new Error('This agreement is already linked. It is not relinked from here. Nothing was changed.')) },
  { list: async () => ({ entities: [] }) });
  const view = await mountContracts(element(), '/admin/contracts', user);
  try {
    await view.flush(); await view.flush();
    const q = (id) => view.nodes().find((n) => view.props(n)?.['data-testid'] === id);
    assert.match(nodeText(q('queue-stalled')), /Unreadable\. Awaiting signature could not be read\./);
    assert.doesNotMatch(nodeText(q('queue-stalled')), /Nothing is awaiting signature/);
    assert.match(nodeText(q('queue-review')), /Unreadable/);
    const linkButton = view.nodes().find((n) => view.props(n)?.['data-testid'] === 'repair-link-env-old');
    await act(async () => { view.props(linkButton).onClick(); });
    await wait(300);
    await act(async () => { view.props(view.nodes().find((n) => n.tagName === 'INPUT' && view.props(n)?.type === 'radio')).onChange(); });
    await view.click('Continue');
    await view.click('Link recipient');
    await view.flush();
    assert.match(view.text(), /already linked\. It is not relinked from here/);
    await view.click('Back to the form');
    assert.ok(view.nodes().some((n) => n.tagName === 'INPUT' && view.props(n)?.type === 'radio'), 'the form is back');
  } finally { await view.unmount(); restore(); }
});
