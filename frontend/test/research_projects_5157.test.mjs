/**
 * D5157 (#5157) — My Research and the Research Project workspace (RS-02 A
 * Overview, B Evidence): honest states, the create form, the evidence table
 * and Archive through Scope → Review → Result.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_projects_5157.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { Route, Routes } from 'react-router-dom';
import MyResearch from '../src/pages/research/MyResearch.jsx';
import ResearchProject from '../src/pages/research/ResearchProject.jsx';
import { newResearchHref } from '../src/pages/founder/FounderResearchDesk.jsx';
import { api } from '../src/lib/api.js';
import { researchProjectsApi } from '../src/lib/api/researchProjects.js';
import { researchProjectFindingsApi } from '../src/lib/api/researchProjectFindings.js';
import {
  PROJECT_TABS, archiveScope, draftBody, draftErrors, evidenceLine, evidenceOrigin, evidenceRows, newFromSearch,
  progressFractions, projectList, recentProjects,
} from '../src/pages/research/researchProjects.js';
import { SHELLS } from '../src/workspaces/shellConfig.js';
import { mountContracts } from './_contracts_dom.mjs';

const h = React.createElement;
const ok = (value) => ({ status: 'ok', value });
const byTid = (ui, id) => ui.nodes().find((n) => ui.props(n)?.['data-testid'] === id) || null;
const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
const settle = async (m) => { for (let i = 0; i < 5; i += 1) await m.flush(); };
const press = async (m, id) => { await act(async () => { m.props(byTid(m, id)).onClick({ preventDefault() {}, stopPropagation() {} }); }); await settle(m); };

const PROJECT = { uid: 'p1', title: 'European AI Infrastructure', question: 'Can a seed company enter EU GPU capacity?', objective: null, scope: 'EU-27', exclusions: null, status: 'in_progress', archived_at: null, created_at: '2026-11-08 10:00:00', updated_at: '2026-11-09 14:02:00' };
const READ = {
  item: PROJECT,
  evidence: [
    { uid: 'd1', title: 'EU Data Act.pdf', kind: 'legal', source_year: 2023, index_state: 'indexed', in_ask: true, direct: true, via_collections: ['EU regulation'], passages_used: 3 },
    { uid: 'd2', title: 'Investor memo (scan).pdf', kind: 'document', source_year: null, index_state: 'failed', index_note: 'Text could not be extracted', in_ask: false, direct: false, via_collections: ['EU regulation'], passages_used: 0 },
  ],
  passages_unattributed: 0,
  collections: [{ uid: 'c1', name: 'EU regulation', documents: 2 }],
  sessions: [],
  answers: [],
};

test('counts: a recorded zero says so; a missing count is Not recorded, never zero', () => {
  // Mutation checked: drop the Number.isFinite guard → an absent count reads "No evidence yet".
  assert.equal(evidenceLine(undefined), 'Not recorded');
  assert.equal(evidenceLine({ evidence: 0, answerable: 0 }), 'No evidence yet');
  assert.equal(evidenceLine({ evidence: 3, answerable: 1 }), '3 sources · 1 answerable in Ask');
  assert.equal(projectList({ status: 'failed' }).state, 'unreadable');
  assert.equal(recentProjects({ status: 'loading' }).state, 'loading');
  const list = projectList(ok({ items: [{ uid: 'a', title: 'A', status: 'in_progress', counts: { evidence: 0, answerable: 0, sessions: 0, answers: 0 } }, { uid: 'b', status: 'mystery' }], archived_count: 2 }));
  assert.deepEqual(list.cards.map((c) => [c.uid, c.status.label, c.evidence, c.ask]), [
    ['a', 'In progress', 'No evidence yet', 'No Ask history yet'],
    ['b', 'Not recorded', 'Not recorded', 'Not recorded'],
  ]);
  assert.equal(list.archivedCount, 2);
});

test('evidence rows keep index state and answerability apart and name where each came from', () => {
  const rows = evidenceRows(READ);
  assert.deepEqual(rows.map((r) => [r.n, r.index.label, r.answer.label, r.origin, r.note, r.passages]), [
    [1, 'Indexed', 'Answerable', 'Added to this project · Via EU regulation', null, 3],
    [2, 'Failed', 'Not answerable', 'Via EU regulation', 'Text could not be extracted', 0],
  ]);
  assert.equal(evidenceOrigin({}), 'Not recorded');
  const progress = progressFractions(READ);
  assert.deepEqual(progress.answerable, { n: 1, of: 2 });
  assert.equal(progress.keyQuestions.state, 'not_recorded');
  assert.deepEqual(PROJECT_TABS.filter((t) => t.built).map((t) => t.slug), ['overview', 'evidence', 'findings']);
});

test('the form: question required, title optional on create, empty text clears on edit', () => {
  assert.ok(draftErrors({ question: '  ' }, { creating: true }).question);
  assert.deepEqual(draftErrors({ question: 'Q', title: '' }, { creating: true }), {});
  assert.ok(draftErrors({ question: 'Q', title: '' }).title, 'an edit cannot blank the title');
  assert.ok(draftErrors({ question: 'Q', scope: 'x'.repeat(1001) }).scope);
  assert.deepEqual(draftBody({ question: ' Q ', title: '', objective: ' O ', scope: '', exclusions: '' }, { creating: true }), { question: 'Q', objective: 'O' });
  // Mutation checked: send nothing for an emptied field on edit → a cleared scope is never cleared.
  assert.deepEqual(draftBody({ question: 'Q', title: 'T', objective: '', scope: '', exclusions: 'E' }), { question: 'Q', title: 'T', objective: null, scope: null, exclusions: 'E' });
  assert.deepEqual(newFromSearch('?new=1&question=EU%20GPUs'), { open: true, question: 'EU GPUs' });
  assert.equal(newResearchHref('  EU GPUs  '), '/research/projects?new=1&question=EU%20GPUs');
  assert.equal(newResearchHref(''), '/research/projects?new=1');
});

test('archive scope names what stays, with the project’s own counts', () => {
  const lines = archiveScope(READ);
  assert.match(lines[1], /2 sources, 1 collection, 0 Ask sessions/);
  assert.match(lines.join(' '), /not changed or deleted/);
  assert.match(lines.join(' '), /restore/);
});

test('My Research is the founder shell’s first research zone', () => {
  const zones = (role) => SHELLS[role].rows.find((r) => r.label === 'Research').zones;
  assert.deepEqual([zones('founder')[0].slug, zones('founder')[0].label], ['projects', 'My Research']);
  assert.equal(zones('investor').some((z) => z.slug === 'projects'), false);
});

function stubProjects(over) {
  const real = { ...researchProjectsApi };
  Object.assign(researchProjectsApi, over);
  return () => Object.assign(researchProjectsApi, real);
}

test('My Research: an unreadable list is not an empty one, and Retry reads again', async () => {
  let fail = true;
  let calls = 0;
  const restore = stubProjects({ list: async () => { calls += 1; if (fail) throw new Error('down'); return { items: [], archived_count: 0 }; } });
  const m = await mountContracts(h(MyResearch), '/research/projects', { id: 1, role: 'founder' });
  try {
    await settle(m);
    assert.ok(byTid(m, 'projects-unreadable'));
    // Mutation checked: render the empty state on a failed read → "No research yet" appears here.
    assert.equal(Boolean(byTid(m, 'projects-empty')), false, 'a failed read is not an empty list');
    fail = false;
    await press(m, 'button-projects-retry');
    assert.equal(calls, 2);
    assert.match(textOf(byTid(m, 'projects-empty')), /No research yet.*Start with a question/);
  } finally { await m.unmount(); restore(); }
});

test('My Research: New research from the desk opens the form with the question; Create sends it once', async () => {
  const sent = [];
  const restore = stubProjects({
    list: async () => ({ items: [], archived_count: 0 }),
    create: async (body) => { sent.push(body); return { item: { ...PROJECT, uid: 'new1' } }; },
  });
  const tree = h(Routes, null,
    h(Route, { path: '/research/projects', element: h(MyResearch) }),
    h(Route, { path: '/research/projects/:uid', element: h('p', { 'data-testid': 'landed' }, 'workspace') }));
  const m = await mountContracts(tree, `/research/projects?new=1&question=${encodeURIComponent('Is EU GPU capacity enterable?')}`, { id: 1, role: 'founder' });
  try {
    await settle(m);
    const q = byTid(m, 'input-project-question');
    assert.equal(m.props(q).value, 'Is EU GPU capacity enterable?');
    await act(async () => { m.props(byTid(m, 'form-new-research')).onSubmit({ preventDefault() {} }); });
    await settle(m);
    assert.deepEqual(sent, [{ question: 'Is EU GPU capacity enterable?' }]);
    assert.ok(byTid(m, 'landed'), 'a created project opens its workspace');
  } finally { await m.unmount(); restore(); }
});

function mountProject(path, over = {}) {
  const restore = stubProjects({ read: async () => READ, ...over });
  const realDocs = api.research.documents;
  const realCols = api.research.collections;
  const realFindings = researchProjectFindingsApi.list;
  researchProjectFindingsApi.list = async () => ({ items: [], proposals: [], passages: [], evidence: [] });
  api.research.documents = async () => ({ items: [] });
  api.research.collections = async () => ({ items: [] });
  const tree = h(Routes, null,
    h(Route, { path: '/research/projects', element: h('p', { 'data-testid': 'my-research-landed' }, 'list') }),
    h(Route, { path: '/research/projects/:uid', element: h(ResearchProject, { tab: 'overview' }) }),
    h(Route, { path: '/research/projects/:uid/evidence', element: h(ResearchProject, { tab: 'evidence' }) }));
  return mountContracts(tree, path, { id: 1, role: 'founder' }).then((m) => ({
    m, restore() { restore(); api.research.documents = realDocs; api.research.collections = realCols; researchProjectFindingsApi.list = realFindings; },
  }));
}

test('Overview: unwritten fields read Not recorded; key questions are not stored; findings read their store (part 2)', async () => {
  const { m, restore } = await mountProject('/research/projects/p1');
  try {
    await settle(m);
    assert.match(textOf(byTid(m, 'project-objective-text')), /Not recorded/);
    assert.match(textOf(byTid(m, 'project-scope')), /EU-27/);
    assert.match(textOf(byTid(m, 'project-progress-answerable')), /1\s*of 2/);
    assert.match(textOf(byTid(m, 'project-findings')), /No findings kept yet/);
    assert.equal(m.props(byTid(m, 'project-tab-findings'))['aria-disabled'], undefined);
  } finally { await m.unmount(); restore(); }
});

test('Evidence: both states per row; a failed source gives its reason', async () => {
  const { m, restore } = await mountProject('/research/projects/p1/evidence');
  try {
    await settle(m);
    assert.match(textOf(byTid(m, 'evidence-row-d1')), /EU Data Act\.pdf.*Added to this project.*✓ Indexed.*✓ Answerable.*3/);
    assert.match(textOf(byTid(m, 'evidence-row-d2')), /Failed.*Text could not be extracted/);
    assert.equal(Boolean(byTid(m, 'button-remove-d2')), false, 'a source from a collection is not removed one by one');
  } finally { await m.unmount(); restore(); }
});

test('Archive: Scope, then Review, and only Confirm archives', async () => {
  const archived = [];
  const { m, restore } = await mountProject('/research/projects/p1', { archive: async (uid) => { archived.push(uid); return { item: { ...PROJECT, status: 'archived' } }; } });
  try {
    await settle(m);
    await press(m, 'button-archive-project');
    assert.match(textOf(byTid(m, 'archive-scope')), /not changed or deleted/);
    await press(m, 'button-archive-review');
    assert.ok(byTid(m, 'archive-review'));
    // Mutation checked: archive on Review → this is ['p1'] before Confirm.
    assert.deepEqual(archived, [], 'nothing is archived before Confirm');
    await press(m, 'button-archive-confirm');
    assert.deepEqual(archived, ['p1']);
    assert.match(textOf(byTid(m, 'archive-result')), /Archived/);
    await press(m, 'button-archive-done');
    assert.ok(byTid(m, 'my-research-landed'));
  } finally { await m.unmount(); restore(); }
});

test('a project that is not yours, or gone, is No such project — not an error', async () => {
  const { m, restore } = await mountProject('/research/projects/zz', { read: async () => { const e = new Error('not_found'); e.status = 404; throw e; } });
  try {
    await settle(m);
    assert.ok(byTid(m, 'project-not-found'));
    assert.equal(Boolean(byTid(m, 'project-unreadable')), false);
  } finally { await m.unmount(); restore(); }
});
