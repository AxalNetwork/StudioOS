/**
 * D6281 (#6281): the Evidence Library's search, its four RS-06 filters kept in
 * the URL, drop-to-upload, and Upload document as the header's primary action.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_library_search_6281.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { useLocation } from 'react-router-dom';
import LibraryZone from '../src/pages/research/LibraryZone.jsx';
import { api } from '../src/lib/api.js';
import {
  NOT_RECORDED, answerabilityKeyOf, fileTypeOf, filterLibrary, isFiltered, libraryFiltersFrom,
  libraryOptions, librarySearchFor, uploadRefusal,
} from '../src/pages/research/researchStates.js';
import { mountContracts } from './_contracts_dom.mjs';

const h = React.createElement;
const doc = (uid, index_state, extra = {}) => ({
  uid, title: `Doc ${uid}`, kind: 'document', source: 'own', index_state, content_type: 'application/pdf',
  in_ask: ['indexed', 'partial'].includes(index_state), chunk_count: null, ...extra,
});
const DOCS = [
  doc('alpha', 'indexed', { title: 'Nordic power prices' }),
  doc('beta', 'failed', { title: 'Investor memo (scan)', content_type: 'application/msword' }),
  doc('gamma', 'pending', { title: 'Hyperscaler capex notes', content_type: 'text/csv' }),
  doc('delta', 'indexed', { title: 'Client deck', source: 'client', in_ask: false, content_type: null }),
];
const byTid = (ui, id) => ui.nodes().find((n) => ui.props(n)?.['data-testid'] === id) || null;
const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
const params = (s) => new URLSearchParams(s);

test('Type is the stored file type; a document with none recorded is Not recorded, never PDF', () => {
  assert.deepEqual(DOCS.map((d) => fileTypeOf(d).label), ['PDF', 'Word', 'CSV', NOT_RECORDED]);
  assert.equal(fileTypeOf({ content_type: 'application/pdf; charset=binary' }).key, 'pdf');
  // Only the types some document carries are offered, Not recorded last.
  assert.deepEqual(libraryOptions(DOCS).type.map((o) => o.label), ['CSV', 'PDF', 'Word', NOT_RECORDED]);
  assert.deepEqual(libraryOptions(DOCS).index.map((o) => o.key), ['indexed', 'pending', 'failed']);
});

test('search narrows by title; each filter narrows on its own column; an empty value is no filter', () => {
  const f = (s, members = null) => filterLibrary(DOCS, libraryFiltersFrom(params(s)), members).map((d) => d.uid);
  assert.deepEqual(f(''), ['alpha', 'beta', 'gamma', 'delta']);
  // Mutation checked: search the kind instead of the title → 'memo' finds nothing.
  assert.deepEqual(f('q=MEMO'), ['beta'], 'search is by title, case-insensitive');
  assert.deepEqual(f('type=word'), ['beta']);
  assert.deepEqual(f('type=unrecorded'), ['delta']);
  assert.deepEqual(f('index=indexed'), ['alpha', 'delta']);
  // The client's indexed document is not answerable: the filter reads `in_ask`, like the column.
  assert.deepEqual(f('answerable=answerable'), ['alpha']);
  assert.equal(answerabilityKeyOf(DOCS[3]), 'not');
  assert.deepEqual(f('index=indexed&answerable=not'), ['delta']);
  assert.deepEqual(f('collection=c1', ['gamma']), ['gamma']);
  assert.deepEqual(f('collection=c1', null), [], 'an unread collection keeps nothing rather than everything');
  assert.deepEqual(f('q=&type='), ['alpha', 'beta', 'gamma', 'delta']);
});

test('the URL after a change keeps every other parameter and drops an emptied one', () => {
  const next = librarySearchFor(params('tab=x&q=memo&view=all'), { type: 'pdf', q: '' });
  assert.equal(next.toString(), 'tab=x&type=pdf', '`view=all` is the default and is not written');
  assert.equal(librarySearchFor(params(''), { view: 'unindexed' }).toString(), 'view=unindexed');
  assert.equal(isFiltered(libraryFiltersFrom(params('view=all'))), false);
  assert.equal(isFiltered(libraryFiltersFrom(params('index=failed'))), true);
});

test('a dropped file is refused before upload for the Worker’s two reasons, in words', () => {
  assert.equal(uploadRefusal({ name: 'memo.pdf', type: 'application/pdf', size: 1000 }), null);
  assert.equal(uploadRefusal({ name: 'notes.md', type: 'text/markdown', size: 10 }), null);
  // Mutation checked: accept any type → the Keynote file passes.
  assert.match(uploadRefusal({ name: 'Market map.key', type: 'application/x-iwork-keynote-sffkey', size: 10 }),
    /^Market map\.key can’t be added: its type \(application\/x-iwork-keynote-sffkey\) can’t be read\. Upload a PDF, Word, PowerPoint, text, markdown or CSV file\.$/);
  assert.match(uploadRefusal({ name: 'nameless', type: '', size: 10 }), /its type can’t be read/);
  assert.match(uploadRefusal({ name: 'big.pdf', type: 'application/pdf', size: 20 * 1024 * 1024 + 1 }), /over the 20 MB limit/);
  assert.equal(uploadRefusal({ name: 'edge.pdf', type: 'application/pdf', size: 20 * 1024 * 1024 }), null);
});

function Where() { return h('span', { 'data-testid': 'where' }, useLocation().search); }

async function mount(url, uploads = []) {
  const original = { ...api.research };
  api.research.documents = async () => ({ items: DOCS, answerable: 1, not_answerable: 3, indexed: 2, from_clients: 1 });
  api.research.collections = async () => ({ items: [{ uid: 'c1', name: 'Energy', document_uids: ['alpha', 'gamma'] }] });
  api.research.askSessions = async () => ({ items: [], totals: { asked: 0 } });
  api.research.upload = async (fd) => { uploads.push(fd); return { ok: true }; };
  const oldMedia = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const m = await mountContracts(h(React.Fragment, null, h(LibraryZone, { role: 'founder' }), h(Where)), url, { id: 1, role: 'founder' });
  for (let i = 0; i < 4; i += 1) await m.flush();
  m.restore = async () => { await m.unmount(); globalThis.matchMedia = oldMedia; Object.assign(api.research, original); };
  return m;
}
const cardTitles = (m) => (byTid(m, 'library-cards')?.childNodes || []).map((li) => textOf(li.childNodes[0].childNodes[0]));

test('filters come from the URL, so a reload lands on the same list; a change is written back', async () => {
  const m = await mount('/research/library?q=notes&tab=keep');
  try {
    assert.deepEqual(cardTitles(m), ['Hyperscaler capex notes']);
    await m.fill('Index state', 'failed');
    assert.equal(textOf(byTid(m, 'where')), '?q=notes&tab=keep&index=failed', 'the change is in the URL, other parameters kept');
    // Nothing is both "notes" and Failed.
    assert.match(textOf(byTid(m, 'library-no-match')), /No document matches/);
    assert.equal(byTid(m, 'library-cards'), null, 'no empty table that reads like an empty library');
    // Mutation checked: Clear that leaves `index` → the no-match card stays.
    await m.click('Clear');
    assert.equal(textOf(byTid(m, 'where')), '?tab=keep');
    assert.equal(cardTitles(m).length, 4);
    await m.fill('In collection', 'c1');
    assert.deepEqual(cardTitles(m), ['Nordic power prices', 'Hyperscaler capex notes']);
    assert.equal(textOf(byTid(m, 'where')), '?tab=keep&collection=c1');
  } finally { await m.restore(); }
});

test('Upload document is the header’s primary action; a drop sends the same upload, and a refused file is never sent', async () => {
  const uploads = [];
  const m = await mount('/research/library', uploads);
  try {
    assert.equal(textOf(byTid(m, 'library-upload-primary')).trim(), 'Upload document');
    const drop = byTid(m, 'library-drop');
    const fire = async (files) => { await act(async () => { await m.props(drop).onDrop({ preventDefault() {}, dataTransfer: { files } }); }); for (let i = 0; i < 3; i += 1) await m.flush(); };
    await fire([new File(['x'], 'Market map.key', { type: 'application/x-iwork-keynote-sffkey' })]);
    assert.equal(uploads.length, 0, 'an unsupported type is refused before upload');
    assert.match(m.text(), /Market map\.key can’t be added: its type .* can’t be read\. Upload a PDF, Word, PowerPoint, text, markdown or CSV file\. Nothing was sent\./);
    await fire([new File(['a'], 'a.pdf', { type: 'application/pdf' }), new File(['b'], 'b.pdf', { type: 'application/pdf' })]);
    assert.equal(uploads.length, 0, 'two files at once are not half-sent');
    await fire([new File(['%PDF'], 'memo.pdf', { type: 'application/pdf' })]);
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].get('file').name, 'memo.pdf');
    assert.equal(uploads[0].get('kind'), 'document', 'the drop uses the form’s chosen kind, like the form');
    assert.match(m.text(), /Added\. Reading it now/);
  } finally { await m.restore(); }
});
