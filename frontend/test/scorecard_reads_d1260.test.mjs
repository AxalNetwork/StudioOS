// D1260 (#3283, part 7 of #2428; owner question 8 A) — Screening and venture
// risk read the scorecard; the ten layers are Risk's sub-rows; the method page
// cites the model in force. No investor page reads a score outside
// /api/venture-scores.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/scorecard_reads_d1260.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { NOT_REVIEWED, riskLayerOf, scopeOf, scopesOf } from '../src/components/scoring/scorecard/scorecardModel.js';
import { ScopeDrawer } from '../src/components/scoring/scorecard/Scorecard.jsx';
import VentureRiskPanel, { layerReviewBody } from '../src/components/VentureRiskPanel.jsx';
import { liveLine } from '../src/pages/scoring/ScoringMethodPage.jsx';
import investorDealsBoard from '../src/workspaces/boards/investorDeals.js';
import { ventureScoresApi } from '../src/lib/api/ventureScores.js';
import { api } from '../src/lib/api.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

/** Every score read that is not the scorecard's: the Lab scorer, its cohort benchmark, venture risk's automatic layers, founder risk. */
const OTHER_SCORE_READS = [/\bgetScores\(/, /\bgetCohortBenchmark\(/, /\bventureRiskByProject\b/, /\bventureRiskRecompute\b/, /\bgetFounderRisk/, /['`]\/scoring\/(?!method)/, /\/venture-risk\/by-project/, /\btotal_score\b/, /\bscore_snapshots\b/];
/** The pages and parts an investor reads: their own pages, the deal room, the scorecard, venture risk and the deals board. */
const INVESTOR_FILES = [
  ...walk('frontend/src/pages/investor').filter((p) => /\.(jsx?|mjs)$/.test(p)),
  ...walk('frontend/src/components/scoring').filter((p) => /\.(jsx?|mjs)$/.test(p)),
  'frontend/src/components/VentureRiskPanel.jsx', 'frontend/src/pages/DealRoomPage.jsx', 'frontend/src/workspaces/boards/investorDeals.js',
];

test('no investor page reads a score outside /api/venture-scores', () => {
  assert.ok(INVESTOR_FILES.length > 20, 'the investor pages were not found');
  for (const f of INVESTOR_FILES) {
    const src = codeOnly(read(f));
    for (const bad of OTHER_SCORE_READS) assert.doesNotMatch(src, bad, `${f} reads a score outside the scorecard (${bad})`);
  }
  // The client no longer offers venture risk's automatic read at all; the analyst's write stays.
  const client = codeOnly(read('frontend/src/lib/api.js'));
  assert.doesNotMatch(client, /ventureRiskByProject:|ventureRiskRecompute:/);
  assert.match(client, /ventureRiskSetLayer: \(projectId, layerKey, body\) =>/);
  // The shared project page reads the Lab scorer for staff and the founder, never for an investor.
  const project = codeOnly(read('frontend/src/pages/ProjectDetail.jsx'));
  assert.match(project, /\(isInvestor \? Promise\.resolve\(\[\]\) : api\.getScores\(id\)/, 'the project page reads the Lab scorer for an investor');
  assert.match(project, /\{isInvestor \? \(\s*<div[^>]*data-testid="project-score-investor"/, 'an investor sees the Latest Score card');
  // The panel and Screening read the scorecard's own client.
  assert.match(read('frontend/src/components/VentureRiskPanel.jsx'), /ventureScoresApi\.venture\(projectId\)/);
  assert.match(read('frontend/src/pages/investor/deals/ScreeningZone.jsx'), /useScopeStrips\(/);
});

test('a layer is an analyst\'s review or Not reviewed, never 0; layers ride on Risk alone', () => {
  assert.deepEqual(riskLayerOf({ key: 'market', label: 'Market Risk', state: 'reviewed', score: 72, band: 'low', reviewed_on: '2026-10-20' }),
    { key: 'market', label: 'Market Risk', reviewed: true, score: 72, band: 'Low risk', reviewed_on: '2026-10-20', note: null, text: '72 · Low risk' });
  const not = riskLayerOf({ key: 'timing', label: 'Timing Risk', state: 'not_reviewed', score: 0, band: 'high' });
  assert.deepEqual([not.reviewed, not.score, not.band, not.text], [false, null, null, NOT_REVIEWED], 'an unreviewed layer drew a figure');
  assert.equal(riskLayerOf({ key: 'x', state: 'reviewed', score: 40, band: 'medium', note: '  staff note ' }).note, 'staff note');
  const layers = [{ key: 'market', state: 'reviewed', score: 72, band: 'low' }];
  assert.equal(scopeOf({ scope: 'risk', state: 'scored', value: 60, band: 'Fair', confidence_word: 'Medium', layers }).layers.length, 1);
  assert.equal(scopeOf({ scope: 'team', state: 'scored', value: 60, band: 'Fair', confidence_word: 'Medium', layers }).layers, null, 'layers on a scope other than Risk');
  assert.equal(scopeOf({ scope: 'risk', state: 'scored', value: 60, band: 'Fair', confidence_word: 'Medium' }).layers, null);
});

async function mount(el) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, null, el)); });
  await settle();
  const nodes = () => { const w = (n) => [n, ...(n.childNodes || []).flatMap(w)]; return w(container); };
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => nodes().find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  return {
    by, pr, text: () => txt(container).replace(/\s+/g, ' ').trim(),
    async click(id) { await act(async () => { await pr(by(id)).onClick?.({ preventDefault() {} }); }); await settle(); },
    async change(id, value) { await act(async () => { pr(by(id)).onChange?.({ target: { value } }); }); await settle(); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

const LAYERS = [
  { key: 'founder', label: 'Founder Risk', state: 'reviewed', score: 20, band: 'high', reviewed_on: '2026-10-22', note: 'PRIVATE STAFF NOTE' },
  { key: 'market', label: 'Market Risk', state: 'reviewed', score: 72, band: 'low', reviewed_on: '2026-10-20' },
  { key: 'timing', label: 'Timing Risk', state: 'not_reviewed', score: null, band: null, reviewed_on: null },
];

test('the Risk drawer draws the layers as sub-rows, Not reviewed included, the note where the read carries one', async () => {
  const s = scopesOf([{ scope: 'risk', state: 'scored', value: 61, band: 'Fair', confidence_word: 'Medium', inputs: [], layers: LAYERS }]).find((x) => x.key === 'risk');
  const view = await mount(h(ScopeDrawer, { s, model: '1.0', onClose() {} }));
  try {
    assert.ok(view.by('scorecard-risk-layers'), 'the layers are not drawn');
    assert.match(view.text(), /Market Risk 72 · Low risk · 2026-10-20/);
    assert.match(view.text(), /Timing Risk Not reviewed/);
    assert.match(view.text(), /PRIVATE STAFF NOTE/);
    assert.doesNotMatch(view.text(), /Timing Risk 0/);
  } finally { await view.close(); }
});

test('the venture-risk panel reads the scorecard\'s Risk scope and layers; refused and failed reads say so; a review is a dialog', async () => {
  const saved = { venture: ventureScoresApi.venture, set: api.ventureRiskSetLayer, clear: api.ventureRiskClearLayer };
  const calls = [];
  let reads = 0;
  try {
    ventureScoresApi.venture = async (id) => { reads += 1; calls.push(['read', id]); return { scopes: [{ scope: 'risk', state: 'scored', value: 61, band: 'Fair', confidence_word: 'Medium', inputs: [], layers: LAYERS }] }; };
    api.ventureRiskSetLayer = async (...a) => { calls.push(['set', ...a]); return {}; };
    let view = await mount(h(VentureRiskPanel, { projectId: 10, canWrite: true }));
    assert.match(view.text(), /Risk 61 Medium risk · medium confidence/);
    assert.match(view.text(), /2 of 3 layers reviewed/);
    assert.match(view.text(), /Timing Risk Not reviewed/);
    assert.doesNotMatch(view.text(), /Overall derisking|Recompute/, 'the old automatic panel is back');
    await view.click('venture-risk-review-timing');
    assert.ok(view.by('risk-layer-review-timing'), 'a review opens no dialog');
    await view.click('risk-layer-review-save');
    assert.match(view.text(), /Give a score, a note, or both\./, 'an empty review was sent');
    assert.equal(calls.filter((c) => c[0] === 'set').length, 0);
    await view.change('risk-layer-review-score', '64');
    await view.click('risk-layer-review-save');
    assert.deepEqual(calls.find((c) => c[0] === 'set'), ['set', 10, 'timing', { analyst_score: 64, status: 'open', analyst_note: null }]);
    assert.equal(reads, 2, 'the scorecard is not read again after a review');
    await view.close();

    view = await mount(h(VentureRiskPanel, { projectId: 10, canWrite: false }));
    assert.equal(view.by('venture-risk-review-market'), undefined, 'a reader without the write sees Review');
    await view.close();

    ventureScoresApi.venture = async () => { throw Object.assign(new Error('x'), { status: 403, data: { message: 'Investors read a scorecard through a deal they are on.' } }); };
    view = await mount(h(VentureRiskPanel, { projectId: 10 }));
    assert.match(view.text(), /Investors read a scorecard through a deal they are on\. Your deals/);
    assert.doesNotMatch(view.text(), /\d+ of \d+ layers/);
    await view.close();

    ventureScoresApi.venture = async () => { throw Object.assign(new Error('x'), { status: 503 }); };
    view = await mount(h(VentureRiskPanel, { projectId: 10 }));
    assert.ok(view.by('venture-risk-unreadable'));
    assert.match(view.text(), /That is not a score of zero\. Try again/);
    await view.close();

    ventureScoresApi.venture = async () => ({ scopes: [{ scope: 'risk', state: 'not_enough', reason: 'Too few inputs recorded', layers: LAYERS.slice(2) }] });
    view = await mount(h(VentureRiskPanel, { projectId: 10 }));
    assert.ok(view.by('venture-risk-no-value'));
    assert.match(view.text(), /Too few inputs recorded ?\. Missing is never 0\./);
    await view.close();
  } finally {
    ventureScoresApi.venture = saved.venture; api.ventureRiskSetLayer = saved.set; api.ventureRiskClearLayer = saved.clear;
  }
  assert.deepEqual(layerReviewBody({ score: '101' }), { error: 'A score is a number from 0 to 100, or leave it empty.' });
  assert.deepEqual(layerReviewBody({ score: '', note: 'watch the churn' }).body, { analyst_score: null, status: 'open', analyst_note: 'watch the churn' });
});

test('the method page names the model in force; the deals board lists Screening\'s deals with no score', () => {
  assert.equal(liveLine({ live: { version: '1.0', published_at: null, default_live: true } }),
    'Model v1.0 is in force. It has scored every venture since the scorecard shipped; no later version is published.');
  assert.equal(liveLine({ live: { version: '1.1', published_at: '2026-10-26 09:00:00', default_live: false } }), 'Model v1.1 is in force, published 2026-10-26.');
  assert.equal(liveLine({ live: { version: '1.1', published_at: null, default_live: false } }), 'Model v1.1 is in force. The day it was published is not recorded.');
  assert.equal(liveLine({}), null);
  const method = read('frontend/src/pages/scoring/ScoringMethodPage.jsx');
  assert.match(method, /ventureScoresApi\.models\(\)/);
  assert.doesNotMatch(method, /It is not published yet/);
  assert.match(method, /reads \$\{i\.source\}/, 'an input no longer cites the store it reads');
  const section = investorDealsBoard('investor', {}).sections.find((s) => s.slug === 'screening');
  const desk = { desk: { available: true, rows: [{ deal_id: 1, company: 'Synthetic', sector: 'fintech', deal_status: 'active' }] } };
  assert.deepEqual(section.columns, ['Company', 'Sector', 'Deal status']);
  assert.deepEqual(section.rows(desk)[0][0], 'Synthetic');
  assert.doesNotMatch(JSON.stringify(section.rows(desk)), /score|tier/i);
});
