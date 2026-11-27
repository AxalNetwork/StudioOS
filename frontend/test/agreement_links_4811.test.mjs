// D4811 (#4811) part 19 — related-document links that name agreements (board
// CT-11): a related agreement opens its workspace; the link form offers
// agreements found by search on the desk's list (legacy documents and
// envelopes only); a workspace lists the records that govern it, a
// confidential one restricted, none said as none, outside HQ said as HQ's.
// Made-up data.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { contractsApi } from '../src/lib/api.js';
import { adminGovernanceApi } from '../src/lib/api/adminGovernance.js';
import RelatedDocuments, { GoverningList, relationHref, relationTitle } from '../src/pages/admin/contracts/RelatedDocuments.jsx';
import { mountContracts } from './_contracts_dom.mjs';

const govOriginals = { ...adminGovernanceApi }, contractOriginals = { ...contractsApi };
const restore = () => { Object.assign(adminGovernanceApi, govOriginals); Object.assign(contractsApi, contractOriginals); };
const walk = (x) => (x.nodeType === 3 || !x.childNodes?.length ? x.textContent || '' : x.childNodes.map(walk).join(''));

test('the rules: an agreement opens its workspace; a missing one says so', () => {
  assert.equal(relationHref({ kind: 'agreement', ref: 'doc lpa' }), '/admin/contracts/agreements/doc/doc%20lpa');
  assert.equal(relationHref({ kind: 'governance', ref: 'g1' }), '/admin/contracts/governance/doc/g1');
  assert.equal(relationHref({ kind: 'template', ref: 'lpa' }), null);
  assert.equal(relationHref({ kind: 'agreement', ref: null }), null);
  assert.equal(relationTitle({ kind: 'agreement', missing: true }), 'Agreement no longer on the desk');
});

test('the link form finds agreements on the desk and links one; only stores with a stable uid are offered', async () => {
  const calls = [];
  contractsApi.agreements = async (p) => { calls.push(['agreements', p]); return { items: [
    { uid: 'doc-lpa', source: 'documents', title: 'Fund I LPA', project_name: 'Fund I' },
    { uid: 'pairwise:1', source: 'pairwise_nda', title: 'Mutual NDA' },
    { uid: 'env-sub', source: 'esign', title: 'Subscription Agreement' }] }; };
  adminGovernanceApi.relate = async (uid, body) => { calls.push(['relate', uid, body]); return { relation: {} }; };
  adminGovernanceApi.linkable = async () => ({ templates: [] });
  const read = { loading: false, error: false, data: { uid: 'g1', dependants: [], governed_by: [], banner: { affected: 0 } }, retry() {} };
  const view = await mountContracts(React.createElement(RelatedDocuments, { uid: 'g1', read, entities: [], onChanged() {}, affectedOnly: false, onShowAll() {} }));
  try {
    const kind = view.nodes().find((n) => n.tagName === 'SELECT' && walk(n.parentNode).startsWith('Kind'));
    await act(async () => { view.props(kind).onChange({ target: { value: 'agreement' } }); });
    await view.flush();
    const find = view.nodes().find((n) => n.tagName === 'INPUT' && view.props(n)?.placeholder === 'Title, company, recipient');
    await act(async () => { view.props(find).onChange({ target: { value: 'LPA' } }); });
    await view.flush();
    assert.deepEqual(calls.filter(([k]) => k === 'agreements').at(-1)[1], { q: 'LPA', limit: 25 });
    const doc = view.nodes().find((n) => n.tagName === 'SELECT' && walk(n.parentNode).startsWith('Document'));
    const labels = walk(doc);
    assert.match(labels, /Fund I LPA · Fund I/);
    assert.match(labels, /Subscription Agreement/);
    assert.doesNotMatch(labels, /Mutual NDA/, 'a pairwise NDA has no stable uid to link');
    await act(async () => { view.props(doc).onChange({ target: { value: 'doc-lpa' } }); });
    const form = view.nodes().find((n) => n.tagName === 'FORM');
    await act(async () => { await view.props(form).onSubmit({ preventDefault() {} }); });
    assert.deepEqual(calls.find(([k]) => k === 'relate'), ['relate', 'g1', { kind: 'agreement', ref: 'doc-lpa' }]);
  } finally { await view.unmount(); restore(); }
});

test('a workspace lists who governs it: named, restricted, none, or kept at HQ', async () => {
  adminGovernanceApi.governing = async () => ({ governing: [
    { id: 1, kind: 'governance', ref: 'g1', title: 'GP OA', status: 'approved', state: 'review_suggested', flag_version: 2 },
    { id: 2, kind: 'governance', ref: null, title: null, restricted: true, state: 'current' }] });
  let view = await mountContracts(React.createElement(GoverningList, { kind: 'agreement', refId: 'doc-lpa' }));
  try {
    await view.flush();
    assert.match(view.text(), /GP OA/);
    assert.ok(view.nodes().some((n) => n.tagName === 'A' && view.props(n)?.href === '/admin/contracts/governance/doc/g1'));
    assert.match(view.text(), /◷ May require review/);
    assert.match(view.text(), /Restricted record · Super Admin only/);
  } finally { await view.unmount(); }
  adminGovernanceApi.governing = async () => ({ governing: [] });
  view = await mountContracts(React.createElement(GoverningList, { kind: 'template', refId: 'lpa' }));
  try { await view.flush(); assert.match(view.text(), /No governance record names this template as one it governs\./); } finally { await view.unmount(); }
  adminGovernanceApi.governing = async () => Promise.reject(Object.assign(new Error('HQ only'), { status: 403 }));
  view = await mountContracts(React.createElement(GoverningList, { kind: 'template', refId: 'lpa' }));
  try { await view.flush(); assert.match(view.text(), /Corporate Governance is kept at HQ\./); } finally { await view.unmount(); restore(); }
});
