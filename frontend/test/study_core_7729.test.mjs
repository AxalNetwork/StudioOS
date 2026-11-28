/**
 * D7729 (#7729, canvas D7703-p2 RST-01 to RST-03) — the market study's frame,
 * its Scope section, and New market research carrying the market into the
 * study. The plain `?new=1&question=` cases stay in
 * research_markets_part2_7171.test.mjs and research_projects_5157.test.mjs.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/study_core_7729.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { Route, Routes } from 'react-router-dom';
import MyResearch, { NewResearchForm } from '../src/pages/research/MyResearch.jsx';
import ResearchProject from '../src/pages/research/ResearchProject.jsx';
import { api } from '../src/lib/api.js';
import { researchProjectsApi } from '../src/lib/api/researchProjects.js';
import { researchStudiesApi } from '../src/lib/api/researchStudies.js';
import { researchMarketsApi } from '../src/lib/api/researchMarkets.js';
import { researchProjectFindingsApi } from '../src/lib/api/researchProjectFindings.js';
import { newMarketResearchHref, researchOrigin } from '../src/pages/research/marketDirectoryExport.js';
import { readMarketQuery } from '../src/pages/research/marketDirectoryQuery.js';
import { newFromSearch, originBody } from '../src/pages/research/researchProjects.js';
import { SECTIONS } from '../src/pages/research/study/StudyFrame.jsx';
import {
  STUDY_SECTIONS, geographyOffer, scopeBody, scopeDraft, scopeErrors, segmentBody, segmentDraft, segmentErrors, studySections,
} from '../src/pages/research/study/studyModel.js';
import { advisorZoneActions } from '../src/workspaces/advisorZoneActions.js';
import { partnerZoneActions } from '../src/workspaces/partnerZoneActions.js';
import { mountContracts } from './_contracts_dom.mjs';

const h = React.createElement;
const byTid = (ui, id) => ui.nodes().find((n) => ui.props(n)?.['data-testid'] === id) || null;
const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
const settle = async (m) => { for (let i = 0; i < 6; i += 1) await m.flush(); };
const press = async (m, id) => { await act(async () => { m.props(byTid(m, id)).onClick({ preventDefault() {}, stopPropagation() {} }); }); await settle(m); };
const type = async (m, id, value) => { await act(async () => { m.props(byTid(m, id)).onChange({ target: { value, type: 'text' } }); }); };
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

function stub(obj, over) {
  const real = { ...obj };
  Object.assign(obj, over);
  return () => Object.assign(obj, real);
}

const ORIGIN = { market: 'dental-practice-software', sector: null, country: ['DE', 'FR'], fresh: '30', src: 'named' };

// ---- New market research carries the market ----------------------------------------------

test('the href keeps the question first and carries the origin after it; no slug carries none', () => {
  // Mutation checked: drop the `origin?.market` guard → the second assertion gains `&market=…`.
  assert.equal(newMarketResearchHref('Dental software', ORIGIN),
    '/research/projects?new=1&question=Dental%20software&market=dental-practice-software&country=DE&country=FR&fresh=30&src=named');
  assert.equal(newMarketResearchHref('Dental software', { ...ORIGIN, market: '' }), '/research/projects?new=1&question=Dental%20software');
  assert.equal(newMarketResearchHref('AI', { market: 'enterprise-ai', sector: 'Enterprise AI', country: [] }),
    '/research/projects?new=1&question=AI&market=enterprise-ai&sector=Enterprise%20AI');
});

test('the origin is the open row: its slug and tracked sector, and the filters only from the Market directory tab', () => {
  const items = [{ slug: 'm-1', name: 'Market 1', mi_sector: 'Vertical SaaS' }, { slug: 'm-2', name: 'Market 2', mi_sector: null }];
  const p = (s) => new URLSearchParams(s);
  assert.deepEqual(researchOrigin(readMarketQuery(p('open=m-1&country=DE&country=FR&fresh=30&src=named')), items),
    { market: 'm-1', sector: 'Vertical SaaS', country: ['DE', 'FR'], fresh: '30', src: 'named' });
  // Mutation checked: ignore `view.tab` → the listed tab's filters ride along here.
  assert.deepEqual(researchOrigin(readMarketQuery(p('tab=listed&open=m-2&country=DE&fresh=30')), items),
    { market: 'm-2', sector: null, country: [], fresh: '', src: '' }, 'a market with no tracked sector carries none');
  assert.equal(researchOrigin(readMarketQuery(p('q=dental&country=DE')), items), null, 'no open row: the search only');
  assert.match(read('frontend/src/pages/research/MarketHeaderOps.jsx'), /newMarketResearchHref\(subject, origin\)/);
});

test('newFromSearch reads the origin back with the Markets checks and drops anything else', () => {
  const href = newMarketResearchHref('Dental software', { ...ORIGIN, sector: 'Vertical SaaS' });
  const got = newFromSearch(href.slice(href.indexOf('?')));
  assert.deepEqual(got, {
    open: true, question: 'Dental software',
    origin: { market: 'dental-practice-software', sector: 'Vertical SaaS', country: ['DE', 'FR'], fresh: '30', src: 'named' },
  });
  // Mutation checked: return the raw params → 'DEU', 'weekly', 'everything' and the script survive.
  const bad = newFromSearch('?new=1&question=Q&market=m-1&country=DEU&country=fr&fresh=weekly&src=everything&sector=%3Cscript%3E&tracked_sector=x');
  assert.deepEqual(bad.origin, { market: 'm-1', sector: null, country: ['FR'], fresh: null, src: null });
  assert.equal(newFromSearch('?new=1&question=Q&market=Not%20A%20Slug&country=DE').origin, null, 'an unreadable slug is no origin');
  assert.equal(newFromSearch(`?new=1&market=${'a'.repeat(65)}`).origin, null, 'longer than the Worker accepts');
  const many = newFromSearch(`?new=1&market=m-1&${Array.from({ length: 25 }, (_, i) => `country=${String.fromCharCode(65 + i)}A`).join('&')}`);
  assert.equal(many.origin.country.length, 20);
  // The body sends what the Worker accepts and never the sector (it reads its own).
  assert.deepEqual(originBody(got.origin), { market_slug: 'dental-practice-software', country: ['DE', 'FR'], fresh: '30', src: 'named' });
  assert.equal(originBody(null), null);
});

test('the action stays disabled for advisor and partner (D7171-p2)', () => {
  for (const actions of [advisorZoneActions, partnerZoneActions]) {
    const nmr = actions('research/markets', { handlers: {}, view: {} }).find((a) => a.label === 'New market research');
    assert.equal(nmr?.disabled, true);
  }
});

const studyRead = (over = {}) => ({ study: null, venture: null, segments: [], archived_segments: [], ...over });

test('the form started from a market says what it carries and creates project and study in one request', async () => {
  const sent = [];
  let fail = true;
  const restore = [
    stub(researchProjectsApi, { list: async () => ({ items: [], archived_count: 0 }), create: async () => { throw new Error('create must not be called'); } }),
    stub(researchMarketsApi, { get: async () => ({ item: { name: 'Dental practice software' } }) }),
    stub(researchStudiesApi, {
      createWithStudy: async (body) => {
        sent.push(body);
        if (fail) { const e = new Error('Nothing was saved: every write of this save was undone.'); e.status = 500; e.code = 'save_rolled_back'; throw e; }
        return { project: { uid: 'new1' }, ...studyRead() };
      },
    }),
  ];
  const href = newMarketResearchHref('Dental software', ORIGIN);
  const tree = h(Routes, null,
    h(Route, { path: '/research/projects', element: h(MyResearch) }),
    h(Route, { path: '/research/projects/:uid/study/:section?', element: h('p', { 'data-testid': 'landed' }, 'study') }));
  const m = await mountContracts(tree, href, { id: 1, role: 'founder' });
  try {
    await settle(m);
    const block = textOf(byTid(m, 'new-research-origin'));
    assert.match(block, /Started from.*Market Dental practice software · tracked sector.*None/);
    assert.match(block, /where listed companies are based · companies based in Germany, France/);
    assert.match(block, /Customer geography is chosen on Scope/);
    assert.match(textOf(byTid(m, 'button-create-project')), /Create project and study/);
    await act(async () => { m.props(byTid(m, 'form-new-research')).onSubmit({ preventDefault() {} }); });
    await settle(m);
    assert.equal(Boolean(byTid(m, 'landed')), false, 'a failure creates nothing and stays on the form');
    assert.match(textOf(byTid(m, 'status-project-create-failed')), /Nothing was created\..*undone\..*What you typed is kept/);
    assert.equal(m.props(byTid(m, 'input-project-question')).value, 'Dental software');
    fail = false;
    await act(async () => { m.props(byTid(m, 'form-new-research')).onSubmit({ preventDefault() {} }); });
    await settle(m);
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[1].project, { question: 'Dental software' });
    assert.deepEqual(sent[1].origin, { market_slug: 'dental-practice-software', country: ['DE', 'FR'], fresh: '30', src: 'named' });
    // Mutation checked: a fresh id per press → these differ and the Worker could create twice.
    assert.equal(sent[0].request_id, sent[1].request_id, 'one request id per form');
    assert.match(sent[1].request_id, /^[A-Za-z0-9-]{8,64}$/);
    assert.ok(byTid(m, 'landed'), 'the created study opens');
  } finally { await m.unmount(); restore.forEach((r) => r()); }
});

test('without an origin the form (as in Add to research) still calls create exactly as before', async () => {
  const sent = [];
  const restore = [
    stub(researchProjectsApi, { create: async (body) => { sent.push(body); return { item: { uid: 'p9' } }; } }),
    stub(researchStudiesApi, { createWithStudy: async () => { throw new Error('with-study must not be called'); } }),
  ];
  let created = null;
  const m = await mountContracts(h(NewResearchForm, { initialQuestion: 'Q?', onCreated: (item) => { created = item; } }), '/research/companies', { id: 1, role: 'founder' });
  try {
    await settle(m);
    assert.equal(Boolean(byTid(m, 'new-research-origin')), false);
    assert.match(textOf(byTid(m, 'button-create-project')), /^Create project$/);
    await act(async () => { m.props(byTid(m, 'form-new-research')).onSubmit({ preventDefault() {} }); });
    await settle(m);
    assert.deepEqual(sent, [{ question: 'Q?' }]);
    assert.equal(created?.uid, 'p9');
  } finally { await m.unmount(); restore.forEach((r) => r()); }
});

// ---- The frame ---------------------------------------------------------------------------

test('seven sections in order; a section is built when its file exists, with no other edit', () => {
  assert.deepEqual(STUDY_SECTIONS.map((s) => s.file), ['ScopeAndQuestions', 'CustomersAndDemand', 'SizeAndScenarios', 'CompetitionAndPricing', 'EntryAndRisks', 'EvidenceAndFindings', 'ReportAndMonitoring']);
  assert.deepEqual(SECTIONS.filter((s) => s.built).map((s) => s.slug), ['scope'], 'the glob finds the one file this issue adds');
  const Fake = () => null;
  // Mutation checked: key the lookup by slug instead of file → `size` stays unbuilt.
  const later = studySections({ './sections/ScopeAndQuestions.jsx': { default: Fake }, './sections/SizeAndScenarios.jsx': { default: Fake } });
  assert.deepEqual(later.filter((s) => s.built).map((s) => [s.n, s.slug]), [[1, 'scope'], [3, 'size']]);
  assert.equal(studySections({ './sections/SizeAndScenarios.jsx': {} }).find((s) => s.slug === 'size').built, false, 'a file with no component is not built');
  const frame = read('frontend/src/pages/research/study/StudyFrame.jsx');
  const globs = frame.match(/import\.meta\.glob\([^)]*\)/g);
  assert.deepEqual(globs, ["import.meta.glob('./sections/*.jsx', { eager: true })"], 'one literal glob the test loader expands');
  assert.match(read('frontend/src/routes/researchProjects.jsx'), /path="\/research\/projects\/:uid\/study\/:section\?"/);
});

function mountStudy(path, { study = async () => studyRead(), project = {}, over = {} } = {}) {
  const PROJECT = { uid: 'p1', title: 'Dental study', question: 'Is it a market?', objective: null, scope: 'Germany', exclusions: null, status: 'in_progress', archived_at: null, updated_at: '2026-11-20 10:00:00', ...project };
  const restore = [
    stub(researchProjectsApi, { read: async () => ({ item: PROJECT, evidence: [], collections: [], sessions: [], answers: [] }) }),
    stub(researchProjectFindingsApi, { list: async () => ({ items: [], proposals: [], passages: [], evidence: [] }) }),
    stub(researchStudiesApi, { read: study, ...over }),
    stub(api.research, { documents: async () => ({ items: [] }), collections: async () => ({ items: [] }) }),
  ];
  const tree = h(Routes, null,
    h(Route, { path: '/research/projects/:uid', element: h(ResearchProject, { tab: 'overview' }) }),
    h(Route, { path: '/research/projects/:uid/study/:section?', element: h(ResearchProject, { tab: 'study' }) }));
  return mountContracts(tree, path, { id: 1, role: 'founder' }).then((m) => ({ m, restore: () => restore.forEach((r) => r()) }));
}

test('a project with no study reads None with one start action; nothing is saved on the way', async () => {
  const saves = [];
  const { m, restore } = await mountStudy('/research/projects/p1/study', { over: { save: async (...a) => { saves.push(a); } } });
  try {
    await settle(m);
    assert.ok(byTid(m, 'project-tab-study'), 'Study is a tab');
    assert.match(textOf(byTid(m, 'study-none')), /None.*This project has no study.*Nothing is saved until you save Scope/);
    assert.equal(m.props(byTid(m, 'button-start-study')).href, '/research/projects/p1/study/scope');
    assert.match(textOf(byTid(m, 'study-from-overview')), /Is it a market\?.*Not recorded.*Germany/);
    assert.deepEqual(saves, []);
  } finally { await m.unmount(); restore(); }
});

test('a failed study read is Unavailable with Try again, never None', async () => {
  let fail = true;
  const { m, restore } = await mountStudy('/research/projects/p1/study', { study: async () => { if (fail) throw new Error('down'); return studyRead(); } });
  try {
    await settle(m);
    // Mutation checked: treat a failed read as `study: null` → study-none renders here.
    assert.ok(byTid(m, 'study-unreadable'));
    assert.equal(Boolean(byTid(m, 'study-none')), false);
    assert.match(textOf(byTid(m, 'study-unreadable')), /not the same as having no study/);
    fail = false;
    const retry = m.nodes().find((n) => m.props(n)?.['data-state-retry'] === '');
    await act(async () => { m.props(retry).onClick({}); });
    await settle(m);
    assert.ok(byTid(m, 'study-none'));
  } finally { await m.unmount(); restore(); }
});

test('the six sections not built are drawn as not built', async () => {
  const study = { product: 'Booking', product_boundary: null, business_model: null, decision: null, horizon_months: null, origin: null, version: 0 };
  const { m, restore } = await mountStudy('/research/projects/p1/study', { study: async () => studyRead({ study }) });
  try {
    await settle(m);
    const nav = textOf(byTid(m, 'study-sections'));
    assert.match(nav, /1 · Scope and questions2 · Customers and demandNot built yet3 · Size and scenariosNot built yet/);
    assert.match(textOf(byTid(m, 'study-home-scope')), /No segment yet/);
    assert.match(textOf(byTid(m, 'study-home-report')), /Not built yet/);
  } finally { await m.unmount(); restore(); }
  const two = await mountStudy('/research/projects/p1/study/size', { study: async () => studyRead({ study }) });
  try {
    await settle(two.m);
    assert.match(textOf(byTid(two.m, 'study-not-built-size')), /Not built yet.*Size and scenarios is not built yet/);
  } finally { await two.m.unmount(); two.restore(); }
});

// ---- Scope -------------------------------------------------------------------------------

test('scope: every field is sent, horizon is checked, an empty study is refused before it is sent', () => {
  const d = scopeDraft(null, null);
  assert.ok(scopeErrors(d).empty);
  assert.equal(scopeErrors(d, { hasOrigin: true }).empty, undefined, 'a study from Markets has its origin');
  assert.ok(scopeErrors({ ...d, horizon_months: '121' }).horizon_months);
  assert.ok(scopeErrors({ ...d, horizon_months: '2.5' }).horizon_months);
  assert.deepEqual(scopeBody({ ...d, product: ' Booking ', horizon_months: '24' }, 0),
    { version: 0, product: 'Booking', product_boundary: null, business_model: null, decision: null, horizon_months: 24, venture_id: null });
  // A venture you can no longer read cannot be sent back, so a save would drop it: blocked until unlinked.
  const hidden = scopeDraft({ product: 'X' }, { linked: true, state: 'no_access' });
  // Mutation checked: drop the `venture.id === undefined` check → no error and the PUT clears the link.
  assert.ok(scopeErrors(hidden).venture);
  assert.equal(scopeErrors({ ...hidden, venture: { state: 'none', id: null } }).venture, undefined);
  assert.equal(scopeBody(scopeDraft({ product: 'X' }, { linked: true, state: 'readable', id: 7, name: 'V' }), 3).venture_id, 7);
});

test('segments: customer countries start empty, codes need a scheme, the body sends every field', () => {
  const blank = segmentDraft(null);
  assert.equal(blank.customer_countries, '');
  assert.ok(segmentErrors(blank).name);
  assert.ok(segmentErrors({ ...blank, name: 'S', industry_codes: '86.23' }).industry_scheme);
  assert.ok(segmentErrors({ ...blank, name: 'S', customer_countries: 'Germany' }).customer_countries);
  const body = segmentBody({ ...blank, name: ' Solo ', customer_countries: 'de, fr de', industry_scheme: 'nace_rev2', industry_codes: '86.23' }, 2);
  assert.deepEqual(body.customer_countries, ['DE', 'FR']);
  assert.deepEqual(body.industry_codes, ['86.23']);
  assert.equal(body.version, 2);
  assert.equal(body.buyer, null);
  assert.equal(body.validate_segment_id, null);
});

test('owner answer Q5 A: the offer names one segment with no customer countries; none without a country filter', () => {
  const study = { origin: { markets_company_location_filters: { country: ['DE'] } } };
  const segs = [{ uid: 'a', customer_countries: [] }, { uid: 'b', beachhead: true, customer_countries: [] }, { uid: 'c', customer_countries: ['FR'] }];
  assert.equal(geographyOffer(study, segs).segment.uid, 'b', 'the beachhead first');
  assert.equal(geographyOffer({ origin: { markets_company_location_filters: { country: [] } } }, segs), null);
  assert.equal(geographyOffer(study, [segs[2]]), null, 'a segment with countries is never overwritten');
});

const FROM_MARKETS = {
  product: null, product_boundary: null, business_model: null, decision: null, horizon_months: null, version: 0,
  origin: {
    market: { slug: 'dental-practice-software', name: 'Dental practice software' }, tracked_sector: { state: 'none' },
    markets_company_location_filters: { label: 'Company-location filters used in Markets. They describe where companies are based, not where the study’s customers are.', q: null, country: ['DE', 'FR'], fresh: '30', src: null },
  },
};
const SEG = { uid: 's1', name: 'Solo practices', beachhead: true, customer_countries: [], industry_codes: [], validate_segment: null, version: 0, archived: false };

test('Scope: a study started from Markets shows the origin as company location and no customer geography until Use', async () => {
  const saved = [];
  let current = studyRead({ study: FROM_MARKETS, segments: [SEG] });
  const { m, restore } = await mountStudy('/research/projects/p1/study/scope', {
    study: async () => current,
    over: { saveSegment: async (uid, segUid, body) => { saved.push([segUid, body]); current = studyRead({ study: FROM_MARKETS, segments: [{ ...SEG, customer_countries: body.customer_countries, version: 1 }] }); return { segment: {} }; } },
  });
  try {
    await settle(m);
    const origin = textOf(byTid(m, 'study-origin'));
    assert.match(origin, /Market Dental practice software · tracked sector.*None/);
    assert.match(origin, /Markets filters: where listed companies are based · companies based in Germany, France/);
    assert.match(origin, /not where the study’s customers are/);
    // A segment's countries are its own: none chosen until Use is pressed.
    assert.match(textOf(byTid(m, 'segment-countries-s1')), /None chosen/);
    assert.match(textOf(byTid(m, 'geography-offer')), /Use Germany, France as customer geography for Solo practices\?/);
    assert.deepEqual(saved, [], 'nothing is written until Use is pressed');
    await press(m, 'button-use-geography');
    assert.deepEqual(saved.map(([u, b]) => [u, b.customer_countries, b.version]), [['s1', ['DE', 'FR'], 0]]);
    assert.match(textOf(byTid(m, 'segment-countries-s1')), /Germany, France/);
    assert.equal(Boolean(byTid(m, 'geography-offer')), false);
  } finally { await m.unmount(); restore(); }
});

test('Scope: the first save creates with version 0; someone saving first keeps the edits and writes nothing', async () => {
  const puts = [];
  let conflict = false;
  const { m, restore } = await mountStudy('/research/projects/p1/study/scope', {
    over: {
      save: async (uid, body) => {
        puts.push(body);
        if (conflict) { const e = new Error('This study or its project changed. Read it again before saving.'); e.status = 409; e.code = 'study_changed'; throw e; }
        return studyRead({ study: { ...FROM_MARKETS, origin: null, product: body.product, decision: body.decision, version: 0 } });
      },
    },
  });
  try {
    await settle(m);
    assert.ok(byTid(m, 'study-not-saved'));
    await press(m, 'button-save-scope');
    // Mutation checked: skip scopeErrors → an empty PUT is sent here.
    assert.deepEqual(puts, [], 'an empty study is not sent');
    await type(m, 'input-study-product', 'Online booking');
    await type(m, 'input-study-decision', 'Enter Germany or not');
    await press(m, 'button-save-scope');
    assert.deepEqual(puts[0], { version: 0, product: 'Online booking', product_boundary: null, business_model: null, decision: 'Enter Germany or not', horizon_months: null, venture_id: null });
    assert.match(textOf(byTid(m, 'study-live')), /Scope saved\./);
    conflict = true;
    await type(m, 'input-study-product', 'Online booking and recall');
    await press(m, 'button-save-scope');
    assert.ok(byTid(m, 'study-conflict'));
    assert.equal(m.props(byTid(m, 'input-study-product')).value, 'Online booking and recall', 'the edits are kept');
  } finally { await m.unmount(); restore(); }
});

test('Scope: an archived project is read-only, and a refusal is shown in the Worker’s words', async () => {
  const study = { ...FROM_MARKETS, product: 'Online booking', horizon_months: 24 };
  const arch = await mountStudy('/research/projects/p1/study/scope', { project: { status: 'archived', archived_at: '2026-11-21 09:00:00' }, study: async () => studyRead({ study, segments: [SEG] }) });
  try {
    await settle(arch.m);
    assert.ok(byTid(arch.m, 'study-archived'));
    // Mutation checked: render the form when archived → Save scope and inputs appear.
    assert.equal(Boolean(byTid(arch.m, 'button-save-scope')), false);
    assert.equal(Boolean(byTid(arch.m, 'input-study-product')), false);
    assert.match(textOf(byTid(arch.m, 'study-product-read')), /Online booking.*24 months/);
    assert.equal(Boolean(byTid(arch.m, 'button-edit-segment-s1')), false);
    assert.equal(Boolean(byTid(arch.m, 'link-edit-on-overview')), false);
    // Mutation checked: drop `archived` from the offer's guard → the Q5 offer is drawn on a read-only study.
    assert.equal(Boolean(byTid(arch.m, 'geography-offer')), false);
  } finally { await arch.m.unmount(); arch.restore(); }
  const refused = await mountStudy('/research/projects/p1/study/scope', {
    study: async () => studyRead({ study: { ...study, origin: null } }),
    over: { save: async () => { const e = new Error('Restore this project before changing its study.'); e.status = 409; e.code = 'project_archived'; throw e; } },
  });
  try {
    await settle(refused.m);
    await press(refused.m, 'button-save-scope');
    assert.match(textOf(byTid(refused.m, 'status-scope-failed')), /Refused.*Restore this project before changing its study\..*Your edits are kept/);
  } finally { await refused.m.unmount(); refused.restore(); }
});

test('Scope: the venture shows what the study records; one you cannot read shows no name and blocks a save until unlinked', async () => {
  const puts = [];
  const study = { ...FROM_MARKETS, origin: null, product: 'Online booking' };
  const { m, restore } = await mountStudy('/research/projects/p1/study/scope', {
    study: async () => studyRead({ study, venture: { linked: true, state: 'no_access', message: 'A venture is linked that you can no longer read.' } }),
    over: { save: async (uid, body) => { puts.push(body); return studyRead({ study: { ...study, version: 1 } }); } },
  });
  try {
    await settle(m);
    assert.match(textOf(byTid(m, 'study-venture-no-access')), /Cannot read.*No name is shown/);
    await press(m, 'button-save-scope');
    assert.deepEqual(puts, []);
    assert.ok(byTid(m, 'scope-venture-error'));
    await press(m, 'button-unlink-venture');
    await press(m, 'button-save-scope');
    assert.equal(puts.length, 1);
    assert.equal(puts[0].venture_id, null);
  } finally { await m.unmount(); restore(); }
  assert.doesNotMatch(read('frontend/src/pages/research/study/sections/ScopeAndQuestions.jsx'), /projects\.length > 1/, 'no startup picker');
});
