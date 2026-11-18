/**
 * D7176 (#7176, canvas D7042 boards RS-14 A1 to G) — Research › Companies saved
 * analyses: refresh, rerun and export never erase the researcher's work.
 *
 * The draft rules run in Node (`companyAnalysisDraft.js`); the page is mounted
 * with a stubbed client to show that an action's answer is merged into the
 * draft, that a rerun opens a review and replaces nothing, that export checks
 * the response before a file exists, and that every failure keeps the dossier.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_saved_analyses_7176.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { Routes, Route } from 'react-router-dom';
import CompanyAnalysis from '../src/pages/research/CompanyAnalysis.jsx';
import { fetchMarkdown } from '../src/components/CompetitorAnalysis.jsx';
import { api } from '../src/lib/api.js';
import { competitorReviewApi } from '../src/lib/api/competitorReview.js';
import {
  changesText, competitorsAfter, defaultSelection, dirtyFields, draftFrom, exportFilename, exportProblem, mergeDraft,
  outputFrom, reviewCounts,
} from '../src/pages/research/companyAnalysisDraft.js';
import { installDocument, mountContracts } from './_contracts_dom.mjs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const CANVAS = read('../../design/incoming/Research Companies Saved Analyses and Export Page.dc.html');
const page = read('../src/pages/research/CompanyAnalysis.jsx') + read('../src/pages/research/companyAnalysisDraft.js');
const component = read('../src/components/CompetitorAnalysis.jsx');
const h = React.createElement;

const record = (extra = {}) => ({
  id: 'an-1', title: 'Saved title', status: 'complete', mode: 'custom', version: 3, edited: true,
  updated_at: '2026-11-16T14:02:00.000Z', inputs: { market: 'Freight', depth: 'quick' },
  output: { market_summary: 'Run summary.', gaps: ['One gap'], wedge: 'A wedge.', next_actions: [], notes: 'My notes.', conclusion: 'My conclusion.', claim_refs: { kept: true } },
  sections_edited: { market_summary: '2026-11-14T10:00:00.000Z' },
  candidates: [
    { id: 'c1', name: 'Rival One', category: 'direct', origin: 'discovered', relevance_score: 70 },
    { id: 'c2', name: 'By Hand Co', category: 'direct', origin: 'manual', relevance_score: null },
  ],
  sources: [
    { id: 's1', candidate_id: 'c1', url: 'https://rival.example', kind: 'site', status: 200, origin: 'fetched', fetched_at: '2026-11-12T09:40:00.000Z' },
    { id: 's2', candidate_id: 'c2', url: 'https://press.example/news', kind: 'news', status: 200, origin: 'manual', fetched_at: '2026-11-14T10:12:00.000Z' },
  ],
  signals: [],
  ...extra,
});

const proposal = () => ({
  proposal_id: 'p-1', base_version: 3,
  candidates: {
    add: [{ id: 'n1', name: 'Newcomer', category: 'direct', origin: 'discovered' }, { id: 'n2', name: 'Second New', category: 'adjacent', origin: 'discovered' }],
    remove: [{ id: 'c1', name: 'Rival One', category: 'direct', origin: 'discovered' }],
  },
  output: {
    market_summary: { now: 'Run summary.', proposed: 'Rewritten summary.', changed: true, edited_at: '2026-11-14T10:00:00.000Z' },
    wedge: { now: 'A wedge.', proposed: 'A sharper wedge.', changed: true, edited_at: null },
    gaps: { now: ['One gap'], proposed: ['One gap'], changed: false, edited_at: null },
  },
  kept: { manual_candidates: [{ id: 'c2', name: 'By Hand Co' }], manual_sources: ['https://press.example/news'] },
});

// ------------------------------------------------------------------ the draft rules

test('an answer merges into the draft: a field you changed keeps your text, the rest take the server', () => {
  const before = record();
  const draft = { ...draftFrom(before), title: 'My unsaved title', notes: 'My notes, more' };
  const after = record({ title: 'Saved title', output: { ...before.output, wedge: 'Server wedge.' } });
  const merged = mergeDraft(draft, before, after);
  assert.equal(merged.title, 'My unsaved title');
  assert.equal(merged.notes, 'My notes, more');
  assert.equal(merged.wedge, 'Server wedge.', 'a field you did not touch kept the old text');
  assert.deepEqual(dirtyFields(merged, after), ['title', 'notes']);
  assert.deepEqual(dirtyFields(draftFrom(after), after), []);
});

test('a save sends the conclusion and notes and keeps every output key it does not edit', () => {
  const r = record();
  const out = outputFrom({ ...draftFrom(r), conclusion: '  New conclusion. ', gaps: 'a\n\n b ' }, r);
  assert.equal(out.conclusion, 'New conclusion.');
  assert.deepEqual(out.gaps, ['a', 'b']);
  assert.deepEqual(out.claim_refs, { kept: true }, 'a key another feature keeps in the output was dropped');
  assert.equal(changesText({ ...draftFrom(r), title: 'T2' }, r), 'Title:\nT2');
});

test('the review starts with additions and unedited rewrites ticked; removals and edited rewrites unticked (owner answer A)', () => {
  const p = proposal();
  const sel = defaultSelection(p);
  assert.deepEqual([...sel.add].sort(), ['n1', 'n2']);
  assert.deepEqual([...sel.remove], []);
  assert.deepEqual([...sel.output], ['wedge'], 'an edited section or an unchanged one started ticked');
  assert.deepEqual(reviewCounts(p, sel), { total: 5, selected: 3 });
  assert.equal(competitorsAfter(record(), sel), 4);
});

test('an export is a file only when the status is 2xx and the type is the format’s', () => {
  assert.deepEqual(exportProblem(503, 'text/html', 'md'), { kind: 'status', status: 503 });
  assert.deepEqual(exportProblem(200, 'application/json', 'md'), { kind: 'type', status: 200, type: 'application/json' });
  assert.equal(exportProblem(200, 'text/markdown; charset=utf-8', 'md'), null);
  assert.equal(exportProblem(200, 'application/json; charset=UTF-8', 'json'), null);
  assert.equal(exportFilename('an-1234567890', 4, 'md'), 'competitor-analysis-an-12345-v4.md');
});

test('fetchMarkdown throws on a 503 or a body that is not Markdown, so nothing is downloaded', async () => {
  const realFetch = globalThis.fetch;
  const restoreDom = installDocument();
  try {
    for (const [status, type] of [[503, 'text/html'], [200, 'application/json']]) {
      globalThis.fetch = async () => new Response('x', { status, headers: { 'content-type': type } });
      await assert.rejects(fetchMarkdown('/api/competitors/a/export?format=md'));
    }
    globalThis.fetch = async () => new Response('# ok', { status: 200, headers: { 'content-type': 'text/markdown; charset=utf-8' } });
    assert.equal(await fetchMarkdown('/api/competitors/a/export?format=md'), '# ok');
  } finally { globalThis.fetch = realFetch; restoreDom(); }
});

// ------------------------------------------------------------------ the page, mounted

function stubClient(first = record()) {
  const real = { ...api.competitors };
  const realApply = competitorReviewApi.apply;
  const calls = [];
  const pending = [];
  const wait = (name) => (...args) => { calls.push([name, ...args]); return new Promise((ok, no) => pending.push({ name, ok, no })); };
  Object.assign(api.competitors, {
    get: async () => first,
    save: wait('save'), refresh: wait('refresh'), rerun: wait('rerun'),
  });
  competitorReviewApi.apply = wait('apply');
  return { calls, pending, restore() { Object.assign(api.competitors, real); competitorReviewApi.apply = realApply; } };
}

async function mount(at = '/research/companies/an-1') {
  const oldMedia = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const ui = await mountContracts(h(Routes, null, h(Route, { path: '/research/companies/:id', element: h(CompanyAnalysis, { role: 'founder' }) })),
    at, { id: 1, role: 'founder' });
  const settle = async () => { for (let i = 0; i < 4; i += 1) await ui.flush(); };
  await settle();
  const textOf = (n) => (n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  // A menu item carries its version line under its label, so it is found by how it starts.
  const button = (label) => ui.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === label)
    || ui.nodes().find((n) => n.tagName === 'BUTTON' && ui.props(n)?.role === 'menuitem' && textOf(n).trim().startsWith(label));
  const field = (label) => ui.nodes().find((n) => ['INPUT', 'TEXTAREA'].includes(n.tagName) && ui.props(n)?.['aria-label'] === label);
  return {
    ui, settle, button, field,
    text: () => ui.text(),
    press: async (label) => { const b = button(label); assert.ok(b, `button ${label}`); assert.ok(!ui.props(b).disabled, `${label} is disabled`); await act(async () => { ui.props(b).onClick({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    type: async (label, value) => { await act(async () => ui.props(field(label)).onChange({ target: { value } })); await settle(); },
    answer: async (value, fail) => { await act(async () => { const p = fail ? null : value; const next = mountPending.shift(); if (fail) next.no(fail); else next.ok(p); }); await settle(); },
    close: async () => { await ui.unmount(); globalThis.matchMedia = oldMedia; },
  };
}
let mountPending = [];

test('page: an unsaved title survives a refresh, and the result says the list and your text are unchanged', async () => {
  const net = stubClient(); mountPending = net.pending;
  const m = await mount();
  try {
    await m.type('Analysis title', 'My unsaved title');
    assert.match(m.text(), /Unsaved changes/);
    await m.press('Refresh sources');
    assert.equal(net.calls[0][0], 'refresh');
    await m.answer(record({ refresh: { at: '2026-11-16T14:20:00.000Z', checked: 2, fetched: 1, not_fetched: 1, results: [{ id: 's1', ok: false, status: 503 }, { id: 's2', ok: true, status: 200 }] } }));
    // Mutation checked: `take(full)` instead of the merge → the saved title replaces the typed one.
    assert.equal(m.ui.props(m.field('Analysis title')).value, 'My unsaved title');
    assert.match(m.text(), /2 checked · 1 fetched again · 1 not fetched/);
    assert.match(m.text(), /your unsaved changes are still in the draft/);
    assert.match(m.text(), /Not fetched · 503/);
    assert.match(m.text(), /Stale · /, 'a source the refresh could not fetch is not dated as stale');
  } finally { await m.close(); net.restore(); }
});

test('page: a failed refresh says nothing changed and keeps the draft, with Retry refresh', async () => {
  const net = stubClient(); mountPending = net.pending;
  const m = await mount();
  try {
    await m.type('Conclusion', 'Typed, not saved');
    await m.press('Refresh sources');
    await m.answer(null, Object.assign(new Error('Refresh failed. Nothing changed.'), { status: 503 }));
    assert.match(m.text(), /Refresh failed\. Nothing changed\./);
    assert.ok(m.button('Retry refresh'));
    assert.equal(m.ui.props(m.field('Conclusion')).value, 'Typed, not saved');
  } finally { await m.close(); net.restore(); }
});

test('page: a rerun opens a review; Cancel keeps the exact draft; Accept sends the ticked ids with the base version', async () => {
  const net = stubClient(); mountPending = net.pending;
  const m = await mount();
  try {
    await m.type('Analysis title', 'Draft title');
    await m.press('Rerun discovery');
    await m.answer(proposal());
    assert.match(m.text(), /Review the rerun/);
    assert.match(m.text(), /Not part of this review/);
    assert.match(m.text(), /By Hand Co/);
    assert.match(m.text(), /3 of 5 changes selected · competitors would be 4/);
    assert.match(m.text(), /Taking this replaces your edit\. Your text stays in version 3\./);
    await m.press('Cancel · keep my draft');
    assert.doesNotMatch(m.text(), /Review the rerun/);
    assert.match(m.text(), /Rerun discarded\./);
    assert.equal(m.ui.props(m.field('Analysis title')).value, 'Draft title');

    await m.press('Rerun discovery');
    await m.answer(proposal());
    await m.press('Accept 3 selected changes');
    const apply = net.calls.find((c) => c[0] === 'apply');
    assert.equal(apply[1], 'an-1');
    assert.equal(apply[2], 3, 'the apply did not name the base version');
    assert.deepEqual({ ...apply[3], add: [...apply[3].add].sort() }, { proposal_id: 'p-1', add: ['n1', 'n2'], remove: [], output: ['wedge'] });
    await m.answer(record({ version: 4, title: 'Saved title', applied: { added: 2, removed: 0, rewritten: 1, version: 4 } }));
    assert.match(m.text(), /3 changes applied · saved as version 4/);
    assert.equal(m.ui.props(m.field('Analysis title')).value, 'Draft title', 'accepting replaced the unsaved title');
  } finally { await m.close(); net.restore(); }
});

test('page: a failed rerun replaces nothing — the status, the body and the draft stay', async () => {
  const net = stubClient(); mountPending = net.pending;
  const m = await mount();
  try {
    await m.type('Notes', 'Unsaved note');
    await m.press('Rerun discovery');
    await m.answer(null, Object.assign(new Error('Rerun failed. Nothing was replaced: the analysis is still version 3.'), { status: 503 }));
    assert.match(m.text(), /Rerun failed\. Nothing was replaced\./);
    assert.ok(m.button('Retry rerun'));
    assert.ok(m.button('Quick scan'));
    assert.match(m.text(), /Rival One/, 'the body was hidden');
    assert.equal(m.ui.props(m.field('Notes')).value, 'Unsaved note');
  } finally { await m.close(); net.restore(); }
});

test('page: a save names its version; a failed save keeps the draft with Retry save and Copy my changes', async () => {
  const net = stubClient(); mountPending = net.pending;
  const m = await mount();
  try {
    await m.type('Conclusion', 'New conclusion');
    await m.press('Save');
    assert.equal(net.calls[0][2].base_version, 3);
    assert.equal(net.calls[0][2].output.conclusion, 'New conclusion');
    assert.equal('candidates' in net.calls[0][2], false);
    await m.answer(null, Object.assign(new Error('The server did not answer.'), { status: 503 }));
    assert.match(m.text(), /Save failed\. Nothing was saved\./);
    assert.ok(m.button('Retry save'));
    assert.ok(m.button('Copy my changes'));
    assert.equal(m.ui.props(m.field('Conclusion')).value, 'New conclusion');
    await m.press('Retry save');
    await m.answer(null, Object.assign(new Error('This analysis was saved again since you opened it.'), { status: 409, data: { current_version: 4 } }));
    assert.match(m.text(), /Not saved: this analysis changed since you opened it\./);
    assert.ok(m.button('Load version 4, keep my changes'));
  } finally { await m.close(); net.restore(); }
});

test('page: export with a dirty draft asks first; a failed export downloads nothing; a good one names its version', async () => {
  const net = stubClient(); mountPending = net.pending;
  const realFetch = globalThis.fetch;
  const m = await mount();
  const files = [];
  const realCreate = document.createElement;
  document.createElement = function create(tag) { const n = realCreate.call(document, tag); if (tag === 'a') { n.click = () => files.push(n.download); n.remove = () => n.parentNode?.removeChild(n); } return n; };
  const answers = [];
  globalThis.fetch = async (url) => { answers.push(String(url)); return answers.next(); };
  try {
    await m.type('Analysis title', 'Dirty title');
    await m.press('Export ▾');
    await m.press('Markdown (.md)');
    assert.match(m.text(), /Export with unsaved changes\?/);
    assert.ok(m.button('Save, then export version 4'), 'save-then-export is not offered');
    answers.next = () => new Response('<h1>down</h1>', { status: 503, headers: { 'content-type': 'text/html' } });
    await m.press('Export saved version 3');
    assert.match(answers[0], /format=md&version=3$/);
    assert.match(m.text(), /Markdown export failed\. Nothing was downloaded\./);
    assert.deepEqual(files, [], 'a 503 was downloaded');
    assert.doesNotMatch(m.text(), /Downloaded version/);
    answers.next = () => new Response('{"a":1}', { status: 200, headers: { 'content-type': 'application/json' } });
    await m.press('Retry export');
    assert.match(m.text(), /The export did not return Markdown\. Nothing was downloaded\./);
    assert.deepEqual(files, []);
    answers.next = () => new Response('# md', { status: 200, headers: { 'content-type': 'text/markdown; charset=utf-8', 'X-Analysis-Version': '3' } });
    await m.press('Retry export');
    assert.deepEqual(files, ['competitor-analysis-an-1-v3.md']);
    assert.match(m.text(), /Downloaded version 3/);
    assert.equal(m.ui.props(m.field('Analysis title')).value, 'Dirty title', 'the export touched the draft');
  } finally { document.createElement = realCreate; globalThis.fetch = realFetch; await m.close(); net.restore(); }
});

// ------------------------------------------------------------------ the canvas, both ends

test('the page renders what the RS-14 boards draw', () => {
  for (const s of [
    'Refresh sources', 'Rerun discovery', 'Export ▾', 'Unsaved changes', 'Saving…', 'Save failed', 'Retry save', 'Copy my changes',
    'Your conclusion and notes', 'never written by a run', 'Generated by the run', 'Attached by you', 'Fetched',
    'Title, conclusion and notes. A refresh or rerun never writes these.',
    'Refreshing sources…', 'Retry refresh', 'Review the rerun', 'Nothing has changed yet. Pick what to take.',
    'Cancel · keep my draft', 'Not part of this review', 'A rerun never proposes changes to these. They stay whatever you choose.',
    'Rerun failed. Nothing was replaced.', 'Retry rerun', 'Quick scan', 'Markdown (.md)',
    'Exports write the saved version. Unsaved edits are never exported.', 'Export with unsaved changes?',
    'Nothing was downloaded.', 'Retry export', 'Dismiss', 'Actions ⋯', 'Searches again. You review every change before anything is replaced.',
    'Evidence', 'How it got here', 'Added by you', 'Named in inputs', 'Running discovery…', 'Rerun discarded.',
  ]) {
    assert.ok(CANVAS.includes(s), `the canvas no longer draws: ${s}`);
    assert.ok(page.includes(s), `the page no longer renders: ${s}`);
  }
});

test('no fixture from the canvas reaches the page', () => {
  assert.doesNotMatch(page, /Halden|Fenwick|Corran|Tidewater|Brekka|Saltmarsh|Ironvale|Skerry|Nordvolt|Quarry AI|Kestrel|Northwind|120 MWh|FCR-D/);
});

test('the saved list shows run state and the edited flag, and draws loading', () => {
  assert.match(component, /error: 'Last run failed'/);
  assert.match(component, /Edited since run/);
  assert.match(component, /\{savedState === 'loading' && \(/);
  assert.match(component, /Loading your saved analyses\./);
});

test('page: a rerun pressed in the Companies panel opens its review here, once', async () => {
  const net = stubClient(); mountPending = net.pending;
  const m = await mount({ pathname: '/research/companies/an-1', state: { rerunProposal: proposal() } });
  try {
    // Mutation checked: the handed proposal ignored → the page opens on the dossier.
    assert.match(m.text(), /Review the rerun/);
    await m.press('Cancel · keep my draft');
    assert.doesNotMatch(m.text(), /Review the rerun/);
    assert.equal(net.calls.length, 0, 'the handed proposal ran discovery again');
  } finally { await m.close(); net.restore(); }
});

test('the Companies panel hands a rerun proposal to the analysis page instead of replacing its draft', () => {
  assert.match(component, /if \(full\?\.proposal_id\) \{\n\s+navigate\(`\/research\/companies\/\$\{encodeURIComponent\(analysis\.id\)\}`, \{ state: \{ rerunProposal: full \} \}\);/);
});
