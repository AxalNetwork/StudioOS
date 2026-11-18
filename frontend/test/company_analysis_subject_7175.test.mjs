/**
 * D7175 (#7175, canvas D7041, boards RS-13) — Research › Companies analysis:
 * a fixed subject from setup to results, and no finding without a source.
 *
 * The readings run in Node; the setup form and the results page are mounted
 * with the API stubbed, so what they draw is held, not what their source says.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/company_analysis_subject_7175.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { Routes, Route } from 'react-router-dom';
import CompanyAnalysis from '../src/pages/research/CompanyAnalysis.jsx';
import CompetitorAnalysis from '../src/components/CompetitorAnalysis.jsx';
import { api } from '../src/lib/api.js';
import { researchCompaniesApi } from '../src/lib/api/researchCompanies.js';
import { analysisHref, buildCompetitorsRedirect } from '../src/lib/companyDirectoryView.js';
import {
  analysisTiles, candidateSupport, classificationWord, evidenceLabel, findingsOf, isSubjectName, reviseHref, sourceChip, subjectCard,
} from '../src/pages/research/companyAnalysisRead.js';
import { mountContracts } from './_contracts_dom.mjs';

const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');

// Fictional sample data, as the canvas's boards use (.example sites).
const RECORD = { item: { uid: 'q90410231', name: 'Halden Grid', website: 'https://halden-grid.example', website_status: 'not_verified', website_verified_at: null, source_name: 'Wikidata', source_url: 'https://www.wikidata.org/wiki/Q90410231', as_of: '2026-09-30', sector: 'Energy storage' } };
const SOURCES = [
  { id: 's1', candidate_id: 'c1', url: 'https://ferrouspower.example/', kind: 'homepage', status: 200 },
  { id: 's2', candidate_id: 'c2', url: 'https://truckwise.example/customers', kind: 'about', status: 503 },
  { id: 's3', candidate_id: 'c2', url: 'https://truckwise.example/', kind: 'homepage', status: 200 },
];

test('the profile button carries the uid and the name, never the website as a known competitor', () => {
  assert.equal(analysisHref({ uid: 'q90410231', name: 'Halden Grid', website: 'https://halden-grid.example' }),
    '/research/companies?tab=analyses&company=q90410231&name=Halden+Grid');
  assert.equal(analysisHref({ name: 'No Uid Co' }), '/research/companies?tab=analyses&market=No+Uid+Co');
  assert.equal(buildCompetitorsRedirect('?company=q1&name=Halden+Grid'), '/research/companies?tab=analyses&company=q1&name=Halden+Grid');
});

test('a finding cites only fetched sources, numbered as the export numbers them; one with none says so', () => {
  const f = findingsOf({ findings: [
    { text: 'Ferrous Power sells 4-hour systems.', kind: 'fact', source_ids: ['s1', 's3', 's1'] },
    { text: 'Truckwise customers are carriers.', kind: 'fact', source_ids: ['s2'] },
    { text: 'Price is the difference.', kind: 'interpretation', source_ids: ['s3'] },
    { text: '   ', source_ids: ['s1'] },
  ] }, SOURCES);
  assert.deepEqual(f.facts.map((x) => [x.cites, x.noSource]), [[[1, 2], false], [[], true]]);
  assert.deepEqual(f.interpretation.map((x) => x.cites), [[2]]);
  assert.deepEqual(findingsOf({}, SOURCES), { facts: [], interpretation: [] });
});

test('each competitor shows its sources, read or Unavailable, and an unread one is unconfirmed', () => {
  assert.deepEqual(sourceChip(SOURCES[1], undefined), { n: null, ok: false, label: 'about · Unavailable · 503', url: SOURCES[1].url });
  assert.equal(sourceChip({ kind: 'homepage', status: 0 }).label, 'homepage · Unavailable · timed out');
  const truckwise = candidateSupport({ id: 'c2', category: 'direct', domain: 'truckwise.example' }, SOURCES);
  assert.deepEqual([truckwise.fetched, truckwise.tried, truckwise.unconfirmed], [1, 2, false]);
  assert.deepEqual(truckwise.chips.map((c) => c.n), [null, 2]);
  const portside = candidateSupport({ id: 'c3', category: 'adjacent', domain: 'portside.example' }, [{ id: 's9', candidate_id: 'c3', status: 0 }]);
  assert.equal(classificationWord({ category: 'adjacent' }, portside), 'Adjacent · unconfirmed');
  const routebook = candidateSupport({ id: 'c4', category: 'adjacent' }, SOURCES);
  assert.deepEqual([routebook.unconfirmed, routebook.notAttempted], [true, true]);
  assert.equal(classificationWord({ category: 'direct' }, truckwise), 'Direct');
});

test('the evidence words and the Sources fetched tile name the reads tried', () => {
  assert.equal(evidenceLabel({ status: 'supported' }), 'Supported · every finding names a source');
  assert.equal(evidenceLabel({ status: 'partial', findings: 4, findings_with_source: 2 }), 'Partial · 2 of 4 findings have a source');
  assert.equal(evidenceLabel({ status: 'insufficient' }), 'Insufficient evidence');
  assert.equal(evidenceLabel({ status: 'no_candidates' }), 'No candidates');
  assert.equal(evidenceLabel({ status: 'unavailable' }), 'Sources unavailable');
  assert.equal(evidenceLabel(null), null);
  const tiles = analysisTiles({ status: 'complete', candidates: [{}, {}], sources: SOURCES });
  assert.deepEqual(tiles[3], { k: 'Sources fetched', v: '2', sub: '2 of 3 tried · public URLs' });
});

test('the subject card names its state in words: loading, unavailable, not found, not verified, not recorded, verified', () => {
  assert.equal(subjectCard({ loading: true }, 'Halden Grid').state, 'loading');
  assert.deepEqual(subjectCard({ error: { status: 503 } }, 'Halden Grid'), { state: 'unavailable', name: 'Halden Grid' });
  assert.equal(subjectCard({ error: { status: 404 } }).state, 'missing');
  const ok = subjectCard({ data: RECORD });
  assert.deepEqual([ok.state, ok.host, ok.websiteStatus, ok.sector], ['ok', 'halden-grid.example', 'not_verified', 'Energy storage']);
  assert.equal(subjectCard({ data: { item: { ...RECORD.item, website: '' } } }).websiteStatus, 'not_recorded');
  assert.equal(subjectCard({ data: { item: { ...RECORD.item, website_status: 'verified', website_verified_at: '2026-11-16' } } }).websiteStatus, 'verified');
});

test('the Known competitors field refuses the subject by name, uid and site', () => {
  const s = { name: 'Halden Grid', uid: 'q90410231', website: 'https://halden-grid.example' };
  for (const t of ['halden  grid', 'Q90410231', 'www.halden-grid.example', 'https://halden-grid.example/about']) assert.equal(isSubjectName(s, t), true, t);
  for (const t of ['Ferrous Power', 'halden', '']) assert.equal(isSubjectName(s, t), false, t);
  assert.equal(isSubjectName(null, 'Halden Grid'), false);
});

test('Revise the search keeps the subject and the inputs', () => {
  const href = reviseHref({ subject_uid: 'q1', inputs: { market: 'Enzyme assays', region_focus: 'Global', depth: 'quick', geography: '', subject: { name: 'Larkspur Bio' } } });
  assert.equal(href, '/research/companies?tab=analyses&company=q1&name=Larkspur+Bio&market=Enzyme+assays&region=Global&depth=quick');
});

// ---------------------------------------------------------------------------
// Mounted.
// ---------------------------------------------------------------------------

async function mount(element, url) {
  const m = await mountContracts(element, url);
  const settle = async () => { for (let i = 0; i < 5; i += 1) await m.flush(); };
  await settle();
  const button = (label) => m.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === label);
  const byId = (id) => m.nodes().find((n) => m.props(n)?.id === id);
  return { ...m, settle, button, byId };
}

function stubSetup({ record = RECORD, projects = [{ id: 7, name: 'Tidewater Systems', sector: 'Heat pumps' }, { id: 8, name: 'Tidewater Heat pilot' }] } = {}) {
  const saved = { competitors: api.competitors, listProjects: api.listProjects, getProject: api.getProject, get: researchCompaniesApi.get };
  const calls = [];
  api.competitors = { ...saved.competitors, list: async () => ({ analyses: [] }), analyze: async (body) => { calls.push(body); return { id: 'new-run' }; } };
  api.listProjects = async () => projects;
  api.getProject = async (pid) => ({ id: pid, name: 'Tidewater Systems', sector: 'Heat pumps', target_customer: 'Housing associations' });
  researchCompaniesApi.get = async () => { if (record instanceof Error) throw record; return record; };
  return { calls, restore: () => { Object.assign(api, { competitors: saved.competitors, listProjects: saved.listProjects, getProject: saved.getProject }); researchCompaniesApi.get = saved.get; } };
}

test('setup from a profile: the subject card, the market from its sector, no startup chosen, no website as a competitor', async () => {
  const net = stubSetup();
  const m = await mount(React.createElement(CompetitorAnalysis, { chromeless: true, linkToDossier: false }),
    '/research/companies?tab=analyses&company=q90410231&name=Halden+Grid&website=https%3A%2F%2Fhalden-grid.example');
  try {
    const text = m.text();
    assert.match(text, /Subject · from the directory/);
    assert.match(text, /Halden Grid/);
    assert.match(text, /halden-grid\.example ↗/);
    assert.match(text, /Not verified/);
    assert.match(text, /Wikidata · CC0 · as of 2026-09-30/);
    assert.match(text, /The subject is never listed as a competitor\./);
    assert.equal(m.props(m.byId('ca-market')).value, 'Energy storage', 'the market starts from the sector label');
    assert.equal(m.props(m.byId('ca-known')).value, '', 'the website is not a known competitor');
    assert.equal(m.props(m.byId('ca-startup')).value, '', 'the startups arriving choose nothing');
    assert.match(text, /2 startups available\. Nothing is chosen for you\./);
    // Choosing a startup keeps the subject and fills nothing until asked.
    await act(async () => { m.props(m.byId('ca-startup')).onChange({ target: { value: '7' } }); }); await m.settle();
    assert.match(m.text(), /The subject is still Halden Grid\./);
    assert.equal(m.props(m.byId('ca-customer')).value, '');
    await act(async () => { m.props(m.button('Fill empty fields')).onClick(); }); await m.settle();
    assert.equal(m.props(m.byId('ca-customer')).value, 'Housing associations', 'Fill empty fields fills an empty field');
    assert.equal(m.props(m.byId('ca-market')).value, 'Energy storage', 'and never one already filled');
    // The subject typed as a known competitor is refused, and the run waits.
    await act(async () => { m.props(m.byId('ca-known')).onChange({ target: { value: 'Ferrous Power, halden-grid.example' } }); }); await m.settle();
    assert.match(m.text(), /halden-grid\.example: the subject cannot be its own competitor\. Remove it to run\./);
    assert.equal(m.props(m.button('Run competitor analysis')).disabled, true);
    await act(async () => { m.props(m.byId('ca-known')).onChange({ target: { value: 'Ferrous Power' } }); }); await m.settle();
    await act(async () => { m.props(m.button('Run competitor analysis')).onClick(); }); await m.settle();
    assert.equal(net.calls.length, 1);
    assert.deepEqual([net.calls[0].subject_uid, net.calls[0].project_id, net.calls[0].known_competitors], ['q90410231', '7', 'Ferrous Power']);
  } finally { await m.unmount(); net.restore(); }
});

test('setup: a subject record that cannot be read says Unavailable with Retry, and the run waits for it', async () => {
  const net = stubSetup({ record: Object.assign(new Error('Unreadable'), { status: 503 }) });
  const m = await mount(React.createElement(CompetitorAnalysis, { chromeless: true, linkToDossier: false }),
    '/research/companies?tab=analyses&company=q90410231&name=Halden+Grid');
  try {
    assert.match(m.text(), /Unavailable/);
    assert.match(m.text(), /Name from the link you followed; nothing else is shown until the record is read\./);
    assert.ok(m.button('Retry'), 'Retry is offered');
    await act(async () => { m.props(m.byId('ca-market')).onChange({ target: { value: 'Grid storage' } }); }); await m.settle();
    assert.equal(m.props(m.button('Run competitor analysis')).disabled, true);
    assert.equal(net.calls.length, 0);
  } finally { await m.unmount(); net.restore(); }
});

test('setup from Saved analyses has no subject and an editable market', async () => {
  const net = stubSetup();
  const m = await mount(React.createElement(CompetitorAnalysis, { chromeless: true, linkToDossier: false }), '/research/companies?tab=analyses');
  try {
    assert.match(m.text(), /None · custom market\. Only the market you type is searched\./);
    assert.match(m.text(), /Editable\. A custom market has no subject company\./);
    await act(async () => { m.props(m.byId('ca-market')).onChange({ target: { value: 'Enzyme assays' } }); }); await m.settle();
    await act(async () => { m.props(m.button('Run competitor analysis')).onClick(); }); await m.settle();
    assert.equal(net.calls[0].subject_uid, undefined);
    assert.equal(net.calls[0].mode, 'custom');
  } finally { await m.unmount(); net.restore(); }
});

const RESULT = {
  id: 'run-b', title: 'Northwind Labs · competitors', status: 'complete', mode: 'custom', subject_uid: 'q90410231',
  inputs: { market: 'Dispatch software', depth: 'quick', region_focus: 'North America' },
  candidates: [
    { id: 'c1', name: 'Ferrous Power', domain: 'ferrouspower.example', category: 'direct', origin: 'known', relevance_score: 76, summary: 'Same customer and same product' },
    { id: 'c2', name: 'Truckwise', domain: 'truckwise.example', category: 'direct', origin: 'discovered', relevance_score: 63, summary: 'Same product' },
  ],
  sources: SOURCES, signals: [],
  output: {
    market_summary: 'Dispatch for carriers.',
    findings: [
      { text: 'Ferrous Power prices per truck.', kind: 'fact', source_ids: ['s1'] },
      { text: 'Routebook is the cheapest option.', kind: 'fact', source_ids: [] },
      { text: 'Price is the clearest difference.', kind: 'interpretation', source_ids: ['s3'] },
    ],
    gaps: ['No public prices'], wedge: '', next_actions: ['Does Truckwise publish its customers?'], notes: '',
    excluded: [{ name: 'Halden Grid', domain: 'halden-grid.example', uid: 'q90410231', reason: 'subject' }],
  },
  evidence: { status: 'partial', candidates: 2, sources_tried: 3, sources_fetched: 2, sources_failed: 1, findings: 2, findings_with_source: 1 },
};

function stubResults(analysis) {
  const saved = { competitors: api.competitors, get: researchCompaniesApi.get };
  const calls = [];
  api.competitors = { ...saved.competitors, get: async () => analysis, refresh: async (id) => { calls.push(['refresh', id]); return analysis; } };
  researchCompaniesApi.get = async () => RECORD;
  return { calls, restore: () => { api.competitors = saved.competitors; researchCompaniesApi.get = saved.get; } };
}
const resultsPage = (id) => mount(React.createElement(Routes, null,
  React.createElement(Route, { path: '/research/companies/:id', element: React.createElement(CompanyAnalysis) })), `/research/companies/${id}`);

test('results: the subject bar, cited findings, interpretation apart, questions apart, the excluded subject and each row\'s sources', async () => {
  const net = stubResults(RESULT);
  const m = await resultsPage('run-b');
  try {
    const text = m.text();
    assert.match(text, /Subject.*Halden Grid.*halden-grid\.example ↗.*Not verified/s);
    assert.match(text, /Partial · 1 of 2 findings have a source/);
    assert.match(text, /Source factFerrous Power prices per truck\.1/);
    assert.match(text, /Run statementNo source in this runRoutebook is the cheapest option\./);
    assert.match(text, /Interpretation, kept apart from the facts/);
    assert.match(text, /Suggested research questionsQuestions, not findings · they never run on their own/);
    assert.match(text, /Excluded from candidates Halden Grid · halden-grid\.example — the subject\./);
    assert.match(text, /about · Unavailable · 503/);
    // D7176's origin words (companyAnalysisDraft.js ORIGIN_WORD), one vocabulary on the page.
    assert.match(text, /Named in inputs/);
    assert.doesNotMatch(text, /Next steps the run listed/);
    // The partial bar's Retry re-reads the sources.
    assert.match(text, /2 of 3 sources fetched/);
    await act(async () => { m.props(m.button('Retry the read')).onClick(); }); await m.settle();
    assert.deepEqual(net.calls, [['refresh', 'run-b']]);
  } finally { await m.unmount(); net.restore(); }
});

test('results: Insufficient evidence states no gaps, classifications or wedge, and offers Add a source and Revise the search', async () => {
  const empty = {
    ...RESULT, id: 'run-c', candidates: [], sources: [],
    output: { market_summary: '', findings: [], gaps: [], wedge: '', next_actions: ['Would a narrower market return companies?'], notes: '' },
    evidence: { status: 'insufficient', candidates: 0, sources_tried: 0, sources_fetched: 0, sources_failed: 0, findings: 0, findings_with_source: 0 },
  };
  const net = stubResults(empty);
  const m = await resultsPage('run-c');
  try {
    const text = m.text();
    assert.match(text, /This run found no companies and read no sources/);
    assert.match(text, /states no market gaps, no competitor classifications and no wedge/);
    assert.ok(m.button('Add a source'));
    const revise = m.nodes().find((n) => n.tagName === 'A' && textOf(n).trim() === 'Revise the search');
    assert.match(m.props(revise).href, /company=q90410231.*market=Dispatch\+software/);
    assert.doesNotMatch(text, /Gaps & opportunities/);
    assert.doesNotMatch(text, /Suggested wedge/);
    assert.doesNotMatch(text, /Market summary/);
    const questions = m.nodes().find((n) => n.tagName === 'TEXTAREA' && m.props(n)?.['aria-label'] === 'Suggested research questions');
    assert.equal(m.props(questions).value, 'Would a narrower market return companies?');
    assert.deepEqual(analysisTiles(empty).map((t) => t.v), ['0', '0', '0', '0'], 'measured zeros');
  } finally { await m.unmount(); net.restore(); }
});

test('results: every read failed is Sources unavailable with Retry, not a search that found nothing', async () => {
  const failed = {
    ...RESULT, id: 'run-d', sources: [{ id: 'x1', candidate_id: 'c1', url: 'https://ferrouspower.example/', kind: 'homepage', status: 0 }],
    evidence: { status: 'unavailable', candidates: 2, sources_tried: 1, sources_fetched: 0, sources_failed: 1, findings: 0, findings_with_source: 0 },
  };
  const net = stubResults(failed);
  const m = await resultsPage('run-d');
  try {
    assert.match(m.text(), /2 companies found; 1 of 1 site reads failed\. Classifications are drawn unconfirmed\./);
    assert.doesNotMatch(m.text(), /No candidates/);
    await act(async () => { m.props(m.button('Retry · Refresh sources')).onClick(); }); await m.settle();
    assert.deepEqual(net.calls, [['refresh', 'run-d']]);
  } finally { await m.unmount(); net.restore(); }
});
