// #6133 retires the Investor Studio match-score surfaces previously covered by D4623.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { investorTiles } from '../src/pages/studio/tiles/investorTiles.jsx';
import { quickStats } from '../src/pages/investor/investorStudioParts.jsx';
import { fallbackLayout } from '../src/pages/studio/studioFallback.js';
import { deriveStudio } from '../src/pages/studio/useStudioLayout.js';

test('old dashboard responses never draw match scores or the score-row intro link', () => {
  const dashboard = { ai_scored_opportunities: [{ id: 9, score: 82 }], quick_stats: { ai_score_avg: 82 } };
  const lifecycle = { counts: { watching: 3, dealrooms: 2 } };
  const quick = quickStats({ dashboard, lifecycle, dealCount: 7 });
  for (const previewing of [true, false]) {
    const tiles = investorTiles({ user: {}, dashboard, previewing, lifecycle, quick });
    assert.equal(tiles.scored_opportunities, undefined);
  }
  const markup = renderToStaticMarkup(React.createElement(React.Fragment, null, investorTiles({ user: {}, lifecycle, quick }).quick_stats.body));
  for (const label of ['Deals in flow', 'Watching', 'Active deal rooms']) assert.match(markup, new RegExp(label));
  assert.deepEqual([...quick.dealFlow.rows, ...quick.lifecycle.rows].map(([label, count]) => [label, count]),
    [['Deals in flow', 7], ['Watching', 3], ['Active deal rooms', 2]]);
  assert.doesNotMatch(markup, /Avg AI match|Request intro|82/);
});

test('a saved layout from an older Worker and the fallback omit the retired tile', () => {
  const legacy = { key: 'scored_opportunities', size: '1/2' };
  const saved = [{ key: 'deal_lifecycle', size: 'full' }, legacy, { key: 'quick_stats', size: '1/2' }];
  const studio = deriveStudio({
    profile: 'investor', viewer: { role: 'investor' }, layout: { layout: saved }, modules: { modules: saved },
  });
  assert.equal(studio.layoutRead, 'ready');
  assert.deepEqual(studio.shown, [saved[0], saved[2]]);
  assert.deepEqual(studio.catalogue, studio.shown);
  assert.ok(!fallbackLayout('investor').some(({ key }) => key === legacy.key));
});
