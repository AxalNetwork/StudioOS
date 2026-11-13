/**
 * D5157 part 2 (#5157) — a Research Project's Findings tab (RS-02 C, RS-12)
 * and the Overview's Most recent findings: the kinds as words, proposals that
 * wait on Accept / Edit / Discard, the citation panel with the recorded
 * passage, and honest states (an unreadable read is never an empty list).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_project_findings_5157.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { Route, Routes } from 'react-router-dom';
import ResearchProject from '../src/pages/research/ResearchProject.jsx';
import { researchProjectsApi } from '../src/lib/api/researchProjects.js';
import { researchProjectFindingsApi } from '../src/lib/api/researchProjectFindings.js';
import {
  citationPanel, findingDraftBody, findingDraftErrors, findingsBadge, findingsView, recentFindings,
} from '../src/pages/research/researchFindings.js';
import { mountContracts } from './_contracts_dom.mjs';

const h = React.createElement;
const ok = (value) => ({ status: 'ok', value });
const byTid = (ui, id) => ui.nodes().find((n) => ui.props(n)?.['data-testid'] === id) || null;
const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
const settle = async (m) => { for (let i = 0; i < 5; i += 1) await m.flush(); };
const press = async (m, id) => { await act(async () => { m.props(byTid(m, id)).onClick({ preventDefault() {}, stopPropagation() {} }); }); await settle(m); };
const change = async (m, id, value) => { await act(async () => { m.props(byTid(m, id)).onChange({ target: { value } }); }); await settle(m); };
const submit = async (m, id) => { await act(async () => { m.props(byTid(m, id)).onSubmit({ preventDefault() {} }); }); await settle(m); };

const CITE_LIVE = { n: 1, document_uid: 'd1', title: 'EU Data Act.pdf', passage: 'This Regulation shall apply from 12 September 2025.', page: 4, answer_uid: 'ans-1', availability: 'available', in_evidence: true, index_state: 'indexed', in_ask: true, source_year: 2023 };
const CITE_GONE = { n: 2, document_uid: 'd2', title: 'Power prices.xlsx', passage: 'Nordic power is cheap.', page: 1, answer_uid: 'ans-1', availability: 'removed', in_evidence: false, index_state: 'indexed', in_ask: true, source_year: 2021 };
const FINDINGS = {
  project: { uid: 'p1', status: 'in_progress' },
  items: [
    { uid: 'f-mine', kind: 'conclusion', text: 'Entry is viable only with a power-cost advantage.', proposed_text: null, state: null, answer_uid: null, decided_at: '2026-11-12 10:00:00', citations: [] },
    { uid: 'f-fact', kind: 'source_fact', text: 'The Data Act applies from 12 September 2025.', proposed_text: null, state: null, answer_uid: null, decided_at: '2026-11-11 10:00:00', citations: [CITE_LIVE] },
    { uid: 'f-edit', kind: 'interpretation', text: 'Growth is Nordic.', proposed_text: 'Capacity growth appears concentrated in Nordic sites [2].', state: 'edited', answer_uid: 'ans-0', decided_at: '2026-11-10 10:00:00', citations: [CITE_GONE] },
    { uid: 'f-gone', kind: 'interpretation', text: 'Discarded words.', proposed_text: 'Discarded words.', state: 'discarded', answer_uid: 'ans-9', decided_at: '2026-11-09 10:00:00', citations: [] },
  ],
  proposals: [
    { answer_uid: 'ans-1', question: 'When does the Data Act apply?', text: 'It applies from 12 September 2025 [1].', created_at: '2026-11-12 09:00:00', citations: [CITE_LIVE] },
  ],
  passages: [{ answer_uid: 'ans-1', n: 1, question: 'When does the Data Act apply?', document_uid: 'd1', title: 'EU Data Act.pdf', passage: 'This Regulation shall apply from 12 September 2025.', page: 4 }],
  evidence: [{ uid: 'd1', title: 'EU Data Act.pdf' }],
};
const PROJECT = { uid: 'p1', title: 'European AI Infrastructure', question: 'Q', objective: null, scope: null, exclusions: null, status: 'in_progress', archived_at: null, created_at: '2026-11-08 10:00:00', updated_at: '2026-11-12 10:00:00' };
const READ = { item: PROJECT, evidence: [], passages_unattributed: 0, collections: [], sessions: [], answers: [] };

test('the view: proposals first, kinds as words, discarded kept apart and never counted as kept', () => {
  assert.equal(findingsView({ status: 'loading' }).state, 'loading');
  assert.equal(findingsView({ status: 'failed' }).state, 'unreadable');
  const view = findingsView(ok(FINDINGS));
  assert.deepEqual(view.cards.map((c) => [c.key, c.kindWord.label, c.state?.label ?? null]), [
    ['proposal-ans-1', 'Eadwyn interpretation', 'Needs review'],
    ['f-mine', 'Your conclusion', null],
    ['f-fact', 'Source fact', null],
    ['f-edit', 'Eadwyn interpretation', 'Edited by you'],
  ]);
  // Mutation checked: count discarded with the rest → all is 5 and interpretation 3.
  assert.deepEqual(view.counts, { all: 4, source_fact: 1, interpretation: 2, conclusion: 1, discarded: 1 });
  assert.deepEqual(findingsView(ok(FINDINGS), 'discarded').cards.map((c) => c.key), ['f-gone']);
  assert.deepEqual(findingsView(ok(FINDINGS), 'interpretation').cards.map((c) => c.key), ['proposal-ans-1', 'f-edit']);
  const edited = view.cards.find((c) => c.key === 'f-edit');
  assert.equal(edited.proposedText, 'Capacity growth appears concentrated in Nordic sites [2].');
  assert.deepEqual(view.cards.map((c) => [c.editable, c.deletable, c.decidable]), [[false, false, true], [true, true, false], [false, true, false], [false, false, true]]);
  assert.equal(findingsView(ok({ items: [], proposals: [] })).empty, true);
});

test('recent findings and the tab badge: kept findings only, and no number while the read is not ok', () => {
  const recent = recentFindings(ok(FINDINGS));
  assert.deepEqual([recent.cards.map((c) => c.key), recent.waiting, recent.total], [['f-mine', 'f-fact'], 1, 3]);
  assert.equal(recentFindings({ status: 'failed' }).state, 'unreadable');
  assert.equal(findingsBadge(ok(FINDINGS)), 3);
  // Mutation checked: a failed read badged as 0 → this is 0.
  assert.equal(findingsBadge({ status: 'failed' }), null);
  assert.equal(findingsBadge(ok({ items: [], proposals: [] })), 0);
});

test('the citation panel reads what was recorded; a removed source keeps its passage and opens nothing', () => {
  const live = citationPanel(CITE_LIVE);
  assert.deepEqual([live.availability.label, live.year, live.index.label, live.answer.label, live.openHref], ['Available', 2023, 'Indexed', 'Answerable', '/research/library#document-d1']);
  const gone = citationPanel(CITE_GONE);
  // Mutation checked: open a removed source → openHref is the Library link.
  // Mutation checked: read year or index state from a removed source → they are drawn.
  assert.deepEqual([gone.availability.label, gone.passage, gone.openHref, gone.year, gone.index], ['Source removed', 'Nordic power is cheap.', null, null, null]);
  assert.match(gone.note, /no longer in your Library/);
  assert.match(citationPanel({ n: 3, availability: 'not_recorded', title: 'Old' }).note, /recorded before Ask kept the document/);
});

test('the form: a source fact needs its passage; a conclusion stands alone', () => {
  assert.ok(findingDraftErrors({ kind: 'source_fact', text: 'Fact' }).passage);
  assert.ok(findingDraftErrors({ kind: 'conclusion', text: '  ' }).text);
  assert.deepEqual(findingDraftErrors({ kind: 'conclusion', text: 'Mine' }), {});
  assert.deepEqual(findingDraftBody({ kind: 'source_fact', text: ' Fact ', passage: 'ans-1:2', documents: [] }), { kind: 'source_fact', text: 'Fact', citations: [{ answer_uid: 'ans-1', n: 2 }] });
  assert.deepEqual(findingDraftBody({ kind: 'conclusion', text: 'Mine', documents: [] }), { kind: 'conclusion', text: 'Mine' });
});

function mount(path, findings = {}, project = {}) {
  const real = { ...researchProjectsApi };
  const realFindings = { ...researchProjectFindingsApi };
  Object.assign(researchProjectsApi, { read: async () => READ, ...project });
  Object.assign(researchProjectFindingsApi, { list: async () => FINDINGS, ...findings });
  const tree = h(Routes, null,
    h(Route, { path: '/research/projects/:uid', element: h(ResearchProject, { tab: 'overview' }) }),
    h(Route, { path: '/research/projects/:uid/findings', element: h(ResearchProject, { tab: 'findings' }) }));
  return mountContracts(tree, path, { id: 1, role: 'founder' }).then((m) => ({
    m, restore() { Object.assign(researchProjectsApi, real); Object.assign(researchProjectFindingsApi, realFindings); },
  }));
}

test('Findings tab: an unreadable read says Unavailable with Retry, never No findings yet', async () => {
  let fail = true;
  let calls = 0;
  const { m, restore } = await mount('/research/projects/p1/findings', { list: async () => { calls += 1; if (fail) throw new Error('down'); return { items: [], proposals: [] }; } });
  try {
    await settle(m);
    assert.match(textOf(byTid(m, 'findings-unreadable')), /Unavailable/);
    // Mutation checked: draw the empty state for a failed read → findings-empty appears here.
    assert.equal(Boolean(byTid(m, 'findings-empty')), false);
    assert.equal(Boolean(byTid(m, 'project-tab-count-findings')), false, 'no badge without a read');
    fail = false;
    await press(m, 'button-findings-retry');
    assert.equal(calls, 2);
    assert.match(textOf(byTid(m, 'findings-empty')), /No findings yet/);
  } finally { await m.unmount(); restore(); }
});

test('Findings tab: Accept and Edit send the decision on the proposal’s answer; nothing else is sent', async () => {
  const decided = [];
  const { m, restore } = await mount('/research/projects/p1/findings', { decide: async (...args) => { decided.push(args); return {}; } });
  try {
    await settle(m);
    assert.match(textOf(byTid(m, 'finding-kind-proposal-ans-1')), /^Eadwyn interpretation$/);
    assert.match(textOf(byTid(m, 'finding-proposal-ans-1')), /Needs review.*It applies from 12 September 2025.*From your Ask question/);
    assert.equal(textOf(byTid(m, 'project-tab-count-findings')), '3');
    await press(m, 'button-accept-proposal-ans-1');
    assert.deepEqual(decided, [['p1', 'ans-1', 'accept', undefined]]);
    await press(m, 'button-edit-proposal-ans-1');
    await change(m, 'input-edit-finding-proposal-ans-1', 'It applies from September 2025.');
    await submit(m, 'form-edit-finding-proposal-ans-1');
    assert.deepEqual(decided[1], ['p1', 'ans-1', 'edit', 'It applies from September 2025.']);
    // Your conclusion is edited as text, never through a decision.
    assert.equal(Boolean(byTid(m, 'button-accept-f-mine')), false);
    assert.ok(byTid(m, 'button-edit-f-mine'));
    assert.equal(Boolean(byTid(m, 'button-edit-f-fact')), false, 'a source fact is deleted, not rewritten');
  } finally { await m.unmount(); restore(); }
});

test('Findings tab: a citation opens its passage; a removed source says so and opens nothing', async () => {
  const { m, restore } = await mount('/research/projects/p1/findings');
  try {
    await settle(m);
    await press(m, 'cite-f-fact-1');
    assert.match(textOf(byTid(m, 'citation-panel')), /Source 1.*EU Data Act\.pdf.*Available.*2023.*Not recorded.*This Regulation shall apply/);
    assert.ok(byTid(m, 'citation-panel-open'));
    await press(m, 'cite-f-edit-2');
    assert.match(textOf(byTid(m, 'citation-panel-note')), /no longer in your Library/);
    assert.equal(Boolean(byTid(m, 'citation-panel-open')), false);
    assert.match(textOf(byTid(m, 'finding-proposed-f-edit')), /Capacity growth appears concentrated/);
    await press(m, 'button-close-citation');
    assert.equal(Boolean(byTid(m, 'citation-panel')), false);
  } finally { await m.unmount(); restore(); }
});

test('Findings tab: a source fact is saved on a chosen passage; Delete asks first', async () => {
  const created = [];
  const removed = [];
  const { m, restore } = await mount('/research/projects/p1/findings', {
    create: async (uid, body) => { created.push([uid, body]); return { item: { uid: 'new' } }; },
    remove: async (uid, fid) => { removed.push([uid, fid]); return { ok: true }; },
  });
  try {
    await settle(m);
    await press(m, 'button-new-source-fact');
    await change(m, 'input-finding-text', 'The Data Act applies from 12 September 2025.');
    await submit(m, 'form-new-source_fact');
    assert.deepEqual(created, [], 'no passage chosen, nothing sent');
    await act(async () => { m.props(byTid(m, 'input-passage-ans-1:1')).onChange(); });
    await settle(m);
    await submit(m, 'form-new-source_fact');
    assert.deepEqual(created, [['p1', { kind: 'source_fact', text: 'The Data Act applies from 12 September 2025.', citations: [{ answer_uid: 'ans-1', n: 1 }] }]]);
    await press(m, 'button-delete-f-mine');
    // Mutation checked: delete on the first press → removed is non-empty here.
    assert.deepEqual(removed, []);
    assert.ok(byTid(m, 'confirm-delete-f-mine'));
    await press(m, 'button-delete-confirm-f-mine');
    assert.deepEqual(removed, [['p1', 'f-mine']]);
  } finally { await m.unmount(); restore(); }
});

test('an archived project shows its findings and offers no decision or new finding', async () => {
  const { m, restore } = await mount('/research/projects/p1/findings', {}, { read: async () => ({ ...READ, item: { ...PROJECT, status: 'archived', archived_at: '2026-11-12 11:00:00' } }) });
  try {
    await settle(m);
    assert.ok(byTid(m, 'finding-f-mine'));
    // Mutation checked: ignore `archived` on the card → Accept is drawn here.
    assert.equal(Boolean(byTid(m, 'button-accept-proposal-ans-1')), false);
    assert.equal(Boolean(byTid(m, 'button-new-conclusion')), false);
    assert.equal(Boolean(byTid(m, 'button-delete-f-mine')), false);
  } finally { await m.unmount(); restore(); }
});

test('Overview: Most recent findings shows kept findings and what waits; an unreadable read says Unavailable', async () => {
  let r = await mount('/research/projects/p1');
  try {
    await settle(r.m);
    assert.match(textOf(byTid(r.m, 'project-findings')), /Your conclusion.*Entry is viable.*Source fact.*Data Act applies.*1 Eadwyn interpretation needs your review/);
    assert.equal(r.m.props(byTid(r.m, 'link-all-findings')).href, '/research/projects/p1/findings');
  } finally { await r.m.unmount(); r.restore(); }
  r = await mount('/research/projects/p1', { list: async () => { throw new Error('down'); } });
  try {
    await settle(r.m);
    assert.match(textOf(byTid(r.m, 'project-findings-unreadable')), /Unavailable/);
    assert.equal(Boolean(byTid(r.m, 'project-findings-empty')), false);
  } finally { await r.m.unmount(); r.restore(); }
});
