/**
 * D4613 (#4613) — the Ask form says what it is, what it is doing and what went
 * wrong to assistive technology; an answer's cited sources are shown apart
 * from passages it never cites, with an unverified reference said so; a
 * re-indexed source is marked; and "Add to my funds" sends one request
 * however often it is pressed.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_ask_a11y_4613.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { Routes, Route } from 'react-router-dom';
import AskZone from '../src/pages/research/AskZone.jsx';
import FundCatalogProfile from '../src/pages/research/FundCatalogProfile.jsx';
import { api } from '../src/lib/api.js';
import { researchFundsApi } from '../src/lib/api/researchFunds.js';
import { RailPageProvider } from '../src/ui/railCrumbs.js';
import {
  citationAvailability, referenceNote, splitCitations, REFERENCE_LIMIT,
} from '../src/pages/research/researchStates.js';
import { mountContracts } from './_contracts_dom.mjs';

const h = React.createElement;
const byTid = (ui, id) => ui.nodes().find((n) => ui.props(n)?.['data-testid'] === id) || null;
const byId = (ui, id) => ui.nodes().find((n) => ui.props(n)?.id === id) || null;
const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');

const REV = '2026-11-09 10:00:00.000';
const ANSWERED = {
  uid: 'a', question: 'Which rules?', reason: 'answered', answer: 'C5 in Germany [1], and pricing [7].', cost_usd: 0.004,
  citations: [
    { n: 1, title: 'BSI C5', document_uid: 'd-1', revision: REV, chunk: 0, page: 4, passage: 'The C5 criteria catalogue', passage_truncated: false, cited: true },
    { n: 2, title: 'Pricing memo', document_uid: 'd-2', revision: REV, chunk: 1, page: null, passage: 'Prices rose twice', passage_truncated: false, cited: false },
  ],
  reference_check: { status: 'invalid_refs', cited: [1], invalid: [7], uncited: [2], claim_support: 'not_verified' },
};

test('splitCitations: cited first, uncited as retrieved; a citation with no mark is never counted as support', () => {
  const { cited, retrieved } = splitCitations(ANSWERED);
  assert.deepEqual(cited.map((x) => x.i), [0]);
  assert.deepEqual(retrieved.map((x) => x.i), [1]);
  // Mutation checked: `ct?.cited !== false` for cited → the unmarked row reads as cited.
  const legacy = splitCitations({ citations: [{ n: 1, title: 'old' }] });
  assert.deepEqual([legacy.cited.length, legacy.retrieved.length], [0, 1]);
});

test('referenceNote names an invalid reference as unverified, and never calls a resolved one verified', () => {
  assert.match(referenceNote(ANSWERED).text, /cites \[7\], which is not among the sources it was given\. That reference is unverified\./);
  assert.match(referenceNote({ reason: 'answered', reference_check: { status: 'invalid_refs', invalid: [5, 9] } }).text, /\[5\], \[9\], which are not .* Those references are unverified/);
  assert.match(referenceNote({ reason: 'answered', reference_check: { status: 'none_cited', invalid: [] } }).text, /cites none of its sources/);
  assert.equal(referenceNote({ reason: 'answered', reference_check: { status: 'resolved', invalid: [] } }), null);
  assert.equal(referenceNote({ reason: 'no_source', reference_check: { status: 'no_answer' } }), null);
  assert.doesNotMatch(REFERENCE_LIMIT, /\bverified\b/);
  assert.match(REFERENCE_LIMIT, /not a check that the passage supports the sentence/);
});

test('a source whose document was indexed again after the answer reads as changed; unknown is not changed', () => {
  const lib = new Set(['d-1']);
  const ct = { document_uid: 'd-1', revision: REV };
  // Mutation checked: drop the revision comparison → this reads Available.
  assert.equal(citationAvailability(ct, lib, new Map([['d-1', '2026-11-10 08:00:00.000']])), 'changed');
  assert.equal(citationAvailability(ct, lib, new Map([['d-1', REV]])), 'available');
  assert.equal(citationAvailability(ct, lib, new Map([['d-1', null]])), 'available');
  assert.equal(citationAvailability({ document_uid: 'd-1' }, lib, new Map([['d-1', REV]])), 'available');
  assert.equal(citationAvailability(ct, lib), 'available');
  assert.equal(citationAvailability({ document_uid: 'd-9', revision: REV }, lib, new Map()), 'gone');
});

async function mountAsk({ items = [ANSWERED], askImpl, indexedAt = REV } = {}) {
  const original = { research: api.research, aiPricing: api.aiPricing };
  const asked = [];
  api.aiPricing = async () => null;
  api.research = {
    ...original.research,
    documents: async () => ({ indexed: 2, items: [
      { uid: 'd-1', title: 'BSI C5', index_state: 'indexed', in_ask: true, indexed_at: indexedAt },
      { uid: 'd-2', title: 'Pricing memo', index_state: 'indexed', in_ask: true, indexed_at: REV },
    ] }),
    askSessions: async () => ({ session: { uid: 's-1' }, items, totals: { asked: items.length, answered: items.length, no_source: 0, cost_usd: 0 } }),
    ask: async (q) => { asked.push(q); return askImpl ? askImpl(q) : { reason: 'answered', session_uid: 's-1' }; },
  };
  const m = await mountContracts(h(RailPageProvider, { role: 'founder' }, h(AskZone)), '/research/ask');
  const settle = async () => { for (let i = 0; i < 4; i += 1) await m.flush(); };
  await settle();
  return { ...m, asked, settle, async close() { await m.unmount(); api.research = original.research; api.aiPricing = original.aiPricing; } };
}

const type = async (m, value) => { await act(async () => { m.props(byId(m, 'ask-question')).onChange({ target: { value } }); }); };

test('the question field keeps its label, is described by its help, and the form has a polite status region', async () => {
  const m = await mountAsk();
  try {
    const field = byId(m, 'ask-question');
    const label = m.nodes().find((n) => n.tagName === 'LABEL' && m.props(n)?.htmlFor === 'ask-question');
    assert.equal(textOf(label), 'What do you want to know?');
    assert.equal(m.props(field)['aria-describedby'], 'ask-question-help');
    assert.match(textOf(byId(m, 'ask-question-help')), /Ctrl\+Enter/);
    const status = byTid(m, 'ask-status');
    assert.deepEqual([m.props(status).role, m.props(status)['aria-live']], ['status', 'polite']);
  } finally { await m.close(); }
});

test('Ctrl+Enter in the field submits; the status announces the answer; plain Enter does not submit', async () => {
  let release;
  const m = await mountAsk({ askImpl: () => new Promise((r) => { release = () => r({ reason: 'answered', session_uid: 's-1' }); }) });
  try {
    await type(m, 'Which SOWs cap revisions?');
    let submitted = 0;
    const event = (extra) => ({ key: 'Enter', preventDefault() {}, currentTarget: { form: { requestSubmit: () => { submitted += 1; } } }, ...extra });
    await act(async () => { m.props(byId(m, 'ask-question')).onKeyDown(event({})); });
    assert.equal(submitted, 0, 'plain Enter adds a line, it does not send');
    // Mutation checked: drop the onKeyDown handler → nothing submits.
    await act(async () => { m.props(byId(m, 'ask-question')).onKeyDown(event({ ctrlKey: true })); });
    await act(async () => { m.props(byId(m, 'ask-question')).onKeyDown(event({ metaKey: true })); });
    assert.equal(submitted, 2);
    // Submit through the form, then watch the busy state and the announcement.
    const form = byTid(m, 'ask-form');
    let done;
    await act(async () => { done = m.props(form).onSubmit({ preventDefault() {} }); });
    assert.equal(m.props(byTid(m, 'ask-form'))['aria-busy'], true);
    assert.equal(textOf(byTid(m, 'ask-status')), 'Reading your library…');
    await act(async () => { release(); await done; });
    await m.settle();
    // Mutation checked: never set the success announcement → the region still says Reading.
    assert.equal(textOf(byTid(m, 'ask-status')), 'Answer added to this session.');
    assert.equal(m.props(byTid(m, 'ask-form'))['aria-busy'], undefined);
    assert.deepEqual(m.asked, ['Which SOWs cap revisions?']);
  } finally { await m.close(); }
});

test('a failed question is an alert tied to the field, and the field is marked invalid', async () => {
  const m = await mountAsk({ askImpl: () => { throw Object.assign(new Error('The question could not be sent.'), { status: 500 }); } });
  try {
    await type(m, 'Anything?');
    await act(async () => { await m.props(byTid(m, 'ask-form')).onSubmit({ preventDefault() {} }); });
    await m.settle();
    const err = byTid(m, 'ask-error');
    assert.deepEqual([m.props(err).role, m.props(err).id, textOf(err)], ['alert', 'ask-question-error', 'The question could not be sent.']);
    // Mutation checked: describedby without the error id → the reader never hears the error with the field.
    assert.equal(m.props(byId(m, 'ask-question'))['aria-describedby'], 'ask-question-help ask-question-error');
    assert.equal(m.props(byId(m, 'ask-question'))['aria-invalid'], true);
    assert.equal(textOf(byTid(m, 'ask-status')), '', 'the polite region does not repeat the alert');
  } finally { await m.close(); }
});

test('the answer lists cited sources apart from retrieved ones, says [7] is unverified, and opens each passage', async () => {
  const m = await mountAsk({ indexedAt: '2026-11-10 08:00:00.000' });
  try {
    // Mutation checked: render every citation in one list → the groups are gone.
    assert.match(textOf(byTid(m, 'ask-sources-cited-a')), /Sources cited · 1\[1\] BSI C5/);
    assert.match(textOf(byTid(m, 'ask-sources-retrieved-a')), /Retrieved, not cited · 1\[2\] Pricing memo/);
    assert.doesNotMatch(textOf(byTid(m, 'ask-sources-cited-a')), /Pricing memo/, 'an uncited passage is not listed as cited');
    assert.match(textOf(byTid(m, 'ask-reference-note-a')), /\[7\].*unverified/);
    assert.match(textOf(byTid(m, 'ask-sources-a')), /It is not a check that the passage supports the sentence/);
    // d-1 was indexed again after this answer read it.
    assert.match(textOf(byTid(m, 'ask-sources-cited-a')), /↻ Re-indexed since this answer/);
    await act(async () => { m.props(byTid(m, 'ask-source-inspect-a-0')).onClick(); });
    assert.match(textOf(byTid(m, 'ask-source-sheet')), /Cited source 1/);
    assert.equal(textOf(byTid(m, 'ask-source-sheet-revision')), 'Indexed version read: 2026-11-09 10:00');
    assert.ok(byTid(m, 'ask-source-sheet-changed'), 'the sheet says the document changed since');
    assert.equal(byTid(m, 'ask-source-sheet-uncited'), null);
    assert.equal(m.props(byTid(m, 'ask-source-sheet-open')).href, '/research/library#document-d-1');
    await act(async () => { m.props(byTid(m, 'ask-source-inspect-a-1')).onClick(); });
    assert.match(textOf(byTid(m, 'ask-source-sheet')), /Retrieved passage 2/);
    assert.ok(byTid(m, 'ask-source-sheet-uncited'), 'an uncited passage is said to be context, not support');
  } finally { await m.close(); }
});

const FUND = { uid: 'northwind2', name: 'Northwind Ventures II', website: 'https://northwind.test', source_name: 'EuroTech VC Funds (public spreadsheet)', source_url: 'https://example.org', as_of: '2026-10-04' };

async function mountCatalog(createImpl) {
  const original = { research: api.research, get: researchFundsApi.get };
  const sent = [];
  researchFundsApi.get = async () => ({ item: FUND, reports: [], reports_status: 'ok', source_boundary: 'Public list.' });
  api.research = { ...original.research, funds: async () => ({ items: [] }), fundCreate: async (body) => { sent.push(body); return createImpl(body); } };
  const m = await mountContracts(h(Routes, null, h(Route, { path: '/research/funds/catalog/:id', element: h(FundCatalogProfile, { role: 'founder' }) })), '/research/funds/catalog/northwind2');
  for (let i = 0; i < 6; i += 1) await m.flush();
  return { ...m, sent, async close() { await m.unmount(); api.research = original.research; researchFundsApi.get = original.get; } };
}

test('Add to my funds: two presses in one frame send one request, carrying the catalogue uid', async () => {
  let release;
  const m = await mountCatalog(() => new Promise((r) => { release = () => r({ uid: 'f-1', name: FUND.name, existing: false }); }));
  try {
    const button = byTid(m, 'fund-catalog-add');
    assert.ok(button, 'the add button renders');
    const onClick = m.props(button).onClick;
    // Both presses read the same render, which is the race a state flag alone loses.
    await act(async () => { onClick(); onClick(); });
    // Mutation checked: drop the ref latch → two requests.
    assert.equal(m.sent.length, 1);
    assert.equal(m.sent[0].catalogue_uid, 'northwind2');
    assert.equal(m.props(byTid(m, 'fund-catalog-add')).disabled, true);
    assert.match(textOf(byTid(m, 'fund-catalog-add')), /Adding…/);
    await act(async () => { release(); });
    for (let i = 0; i < 3; i += 1) await m.flush();
    const notice = byTid(m, 'fund-catalog-notice');
    assert.deepEqual([m.props(notice).role, textOf(notice)], ['status', 'Added to My funds.']);
  } finally { await m.close(); }
});

test('Add to my funds answered by an earlier add says it is already there; a failure is an alert', async () => {
  const again = await mountCatalog(async () => ({ uid: 'f-1', name: FUND.name, existing: true }));
  try {
    await act(async () => { await again.props(byTid(again, 'fund-catalog-add')).onClick(); });
    for (let i = 0; i < 3; i += 1) await again.flush();
    assert.equal(textOf(byTid(again, 'fund-catalog-notice')), 'Already on My funds.');
  } finally { await again.close(); }
  const failed = await mountCatalog(async () => { throw new Error('That fund did not save.'); });
  try {
    await act(async () => { await failed.props(byTid(failed, 'fund-catalog-add')).onClick(); });
    for (let i = 0; i < 3; i += 1) await failed.flush();
    const notice = byTid(failed, 'fund-catalog-notice');
    assert.deepEqual([failed.props(notice).role, textOf(notice)], ['alert', 'That fund did not save.']);
    // The latch is released: the add can be tried again.
    assert.equal(failed.props(byTid(failed, 'fund-catalog-add')).disabled, false);
  } finally { await failed.close(); }
});
