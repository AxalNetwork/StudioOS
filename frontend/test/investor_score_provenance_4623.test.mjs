// #4623 (Studio audit 5/5, part 1): the investor's match-score module says what its scores are.
// Its rows are `match_scores`, written only by the matching engine D378 retired. So:
//   · every score is labelled historical, and the module says nothing recalculates them;
//   · it shows the calculation time and method the engine recorded (`created_at`, `model`), and
//     "Not recorded" for what it did not (the inputs, always; anything else absent);
//   · the dashboard's answer time is never its calculation date, and no model id is drawn;
//   · loading, a failed read and an empty list are their own states; an unknown score is never 0.
// Synthetic rows only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { HISTORICAL_NOTE, Opportunity, investorTiles, scoreProvenance } from '../src/pages/studio/tiles/investorTiles.jsx';
import { quickStats } from '../src/pages/investor/investorStudioParts.jsx';
import { fallbackTitle } from '../src/pages/studio/studioFallback.js';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';

const html = (node) => renderToStaticMarkup(React.createElement(MemoryRouter, null, node));
const lifecycle = { stages: [] };
const tilesFor = (extra) => investorTiles({
  user: { id: 1 }, dashboard: {}, lifecycle, records: { portfolio: {}, events: {} }, failures: {}, stages: [],
  quick: quickStats({ dashboard: {}, lifecycle, dealCount: 0 }), refreshContext: () => {}, retryLifecycle: () => {}, retrySources: () => {}, ...extra,
});
const recorded = { id: 71, deal_id: 12, deal_name: 'Synthetic Robotics', sector: 'deep_tech', stage: 'seed', score_type: 'deal_flow', score: 82.4, model: 'rule-based', created_at: '2026-09-20 14:05:00' };

test('a recorded score shows its calculation time (read as UTC), its method and its kind; its inputs are Not recorded', () => {
  const p = scoreProvenance(recorded);
  assert.equal(p.kind, 'Deal flow');
  assert.equal(p.method, 'Rule-based');
  assert.match(p.calculated, /2026/);
  assert.match(p.calculated, /14:05 UTC$/, 'D1’s zone-less stamp is UTC, not the viewer’s time');
  const text = renderedText(html(React.createElement(Opportunity, { item: recorded, index: 0 })));
  assert.match(text, /^82/);
  assert.match(text, /Deal flow · deep tech · seed/);
  assert.match(text, /Historical · Calculated .*2026.*14:05 UTC · Method Rule-based · Inputs Not recorded/);
});

test('missing metadata reads Not recorded, each part on its own, never a date or a method it was not given', () => {
  const bare = { id: 72, deal_id: 13, score: 40 };
  assert.deepEqual(scoreProvenance(bare), { kind: null, calculated: null, method: null });
  const text = renderedText(html(React.createElement(Opportunity, { item: bare, index: 0 })));
  assert.match(text, /Historical · Calculated Not recorded · Method Not recorded · Inputs Not recorded/);
  assert.match(text, /Deal name not recorded/);
  assert.match(text, /Details not recorded/);
  assert.equal(scoreProvenance({ created_at: 'not a time' }).calculated, null, 'an unreadable stamp is not a date');
  assert.equal(scoreProvenance({ model: '   ' }).method, null);
  assert.equal(scoreProvenance({ score_type: 'co_invest' }).kind, 'Co-invest');
});

test('a language-model score says so, and the model id is never drawn', () => {
  const lm = { ...recorded, id: 73, model: '@cf/synthetic/model-x' };
  assert.equal(scoreProvenance(lm).method, 'Language model');
  const markup = html(React.createElement(Opportunity, { item: lm, index: 0 }));
  assert.doesNotMatch(markup, /@cf|model-x/);
});

test('the answer time of the dashboard is never the calculation date', () => {
  const realNow = Date.now;
  Date.now = () => Date.parse('2026-11-09T10:00:00Z');
  try {
    const dashboard = { generated_at: '2026-11-09T10:00:00Z', fetched_at: '2026-11-09T10:00:00Z', ai_scored_opportunities: [{ id: 74, deal_id: 14, score: 55 }] };
    const spec = tilesFor({ dashboard, opportunities: dashboard.ai_scored_opportunities }).scored_opportunities;
    const text = renderedText(html(spec.body));
    assert.match(text, /Calculated Not recorded/);
    assert.doesNotMatch(text, /Nov|2026-11|10:00/, 'nothing drawn from the response or the clock');
  } finally { Date.now = realNow; }
  const mod = codeOnly(readFileSync(new URL('../src/pages/studio/tiles/investorTiles.jsx', import.meta.url), 'utf8'));
  const block = mod.slice(mod.indexOf('export function scoreProvenance'), mod.indexOf('export function PortfolioRows'));
  assert.doesNotMatch(block, /Date\.now|new Date\(\)|generated_at|fetched_at/);
});

test('the module is labelled historical and says nothing recalculates it', () => {
  const spec = tilesFor({ opportunities: [recorded, { ...recorded, id: 75, deal_id: 15 }] }).scored_opportunities;
  assert.equal(spec.state, 'ready');
  assert.equal(spec.note, '2 historical');
  const text = renderedText(html(spec.body));
  assert.ok(text.includes(HISTORICAL_NOTE));
  assert.match(HISTORICAL_NOTE, /^Historical: .*retired matching engine.*nothing recalculates them/);
  assert.doesNotMatch(text, /Eadwyn proposes/, 'the retired engine’s scores are not Eadwyn’s');
  assert.equal(fallbackTitle('scored_opportunities'), 'Historical match scores');
  const catalogue = readFileSync(new URL('../../cloudflare-worker/src/services/studioModules.ts', import.meta.url), 'utf8');
  assert.match(catalogue, /key: 'scored_opportunities', profile: 'investor', title: 'Historical match scores'/);
});

test('loading, a failed read and an empty list are their own states', () => {
  assert.equal(tilesFor({ dashboard: undefined }).scored_opportunities.state, 'loading');
  const retry = () => {};
  const failed = tilesFor({ dashboardUnavailable: 'unreadable', refreshContext: retry }).scored_opportunities;
  assert.equal(failed.state, 'unreadable');
  assert.equal(failed.onRetry, retry);
  const empty = tilesFor({ opportunities: [] }).scored_opportunities;
  assert.equal(empty.state, 'empty');
  assert.match(empty.empty, /^No historical match scores are recorded for you\. The matching engine that wrote them is retired\.$/);
});

test('an unknown score is Unscored, never 0; a score with no deal links to no project, one with a deal to that project', () => {
  const referral = { id: 76, deal_id: null, target_user_id: 9, score_type: 'referral', score: null, created_at: '2026-09-01 08:00:00' };
  const markup = html(React.createElement(Opportunity, { item: referral, index: 0 }));
  const text = renderedText(markup);
  assert.match(text, /^Unscored/);
  assert.doesNotMatch(text, /^0/);
  assert.match(text, /No deal recorded/);
  assert.match(text, /Referral/);
  assert.doesNotMatch(markup, /href="\/projects\//, 'the row id is not a project id');
  const deal = html(React.createElement(Opportunity, { item: recorded, index: 0 }));
  assert.match(deal, /href="\/projects\/12"/);
  assert.doesNotMatch(deal, /href="\/projects\/71"/);
});

test('an administrator’s preview still withholds the module', () => {
  assert.equal(tilesFor({ previewing: true }).scored_opportunities.state, 'withheld');
});

// D4623 part 2: the quick stats' "Avg AI match" averages the same historical rows, so it is labelled the same way.
test('part 2: the quick stats’ Avg AI match is marked Historical; a missing average is Not recorded, never 0', async () => {
  const { StatGroup } = await import('../src/pages/investor/investorStudioParts.jsx');
  const draw = (dashboard, extra = {}) => renderedText(html(React.createElement(StatGroup, {
    group: quickStats({ dashboard, lifecycle, dealCount: 3, ...extra }).dealFlow, what: 'x', claim: 'y', onRetry: () => {},
  })));
  const scored = draw({ quick_stats: { ai_score_avg: 75 }, source_status: { scoresMine: 'ready' } });
  assert.match(scored, /Avg AI match\s*Historical · 75/);
  // The deal-flow total is not a historical figure, and is not marked.
  assert.match(scored, /Deals in flow\s*3/);
  assert.doesNotMatch(scored, /Deals in flow\s*Historical/);
  const markup = html(React.createElement(StatGroup, { group: quickStats({ dashboard: { quick_stats: { ai_score_avg: 75 } }, lifecycle, dealCount: 3 }).dealFlow, what: 'x', claim: 'y' }));
  assert.match(markup, /data-testid="text-investor-stat-avg-ai-match-historical"/);
  // None recorded: Not recorded with its reason, no Historical figure and no 0.
  const none = draw({ quick_stats: { ai_score_avg: null } });
  assert.match(none, /Avg AI match\s*Not recorded/);
  assert.doesNotMatch(none, /Avg AI match\s*Historical|Avg AI match\s*0\b/);
  const reason = quickStats({ dashboard: { quick_stats: {} }, lifecycle, dealCount: 3 }).dealFlow.rows.find(([label]) => label === 'Avg AI match')[2];
  assert.match(reason, /historical match score/i);
  assert.doesNotMatch(reason, /\byet\b/, 'nothing calculates a new score, so none is promised');
  // A read that failed says so, and is not marked historical either.
  const failed = draw({ quick_stats: { ai_score_avg: null }, source_status: { scoresMine: 'unreadable' } });
  assert.match(failed, /Avg AI match\s*Could not be read/);
  assert.doesNotMatch(failed, /Historical/);
});
