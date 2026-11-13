/**
 * D533 (#1080) — Top movers on `/research/markets`, from the Research
 * overview's live heat grid (D536), to the Markets canvas's "Top movers".
 *
 * What this pins:
 *   - the largest changes on last month, rising and falling, four of each,
 *     each linked to its sector page;
 *   - a cell with no live row or no change is left out, never a change of 0;
 *   - a failed read is Unreadable, an index not computed is Not recorded with
 *     the Worker's reason, and nothing is ranked on a guess;
 *   - the page reads the overview and hands its read to the card.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_top_movers_d533.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { TopMovers, previousPeriod, topMovers } from '../src/pages/research/MarketDirectoryZone.jsx';

const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (el) => html(el).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const cell = (delta_pct) => ({ value: 50, delta_pct, source_count: 2 });
const none = { value: null, delta_pct: null, source_count: 0, reason: 'No live source yet for this sector' };
const HEAT = {
  status: 'ok', period_key: '2026-10', period_status: 'month_to_date',
  sectors: [
    { sector: 'Fintech / DeFi', dimensions: { demand: cell(12.5), supply: cell(-3), capital: cell(0), talent: none } },
    { sector: 'AI Infrastructure', dimensions: { demand: cell(30), supply: cell(-20.25), research: cell(null) } },
    { sector: 'DevTools', dimensions: { demand: cell(4), supply: cell(2), capital: cell(1), talent: cell(-1), sentiment: cell(8) } },
  ],
};
const ready = (heat) => ({ status: 'ready', data: { heat } });

test('movers rank the largest live changes, four each way, and leave out what did not change', () => {
  const { rising, falling } = topMovers(HEAT);
  assert.deepEqual(rising.map((r) => [r.sector, r.dimension, r.delta_pct]), [
    ['AI Infrastructure', 'demand', 30], ['Fintech / DeFi', 'demand', 12.5], ['DevTools', 'sentiment', 8], ['DevTools', 'demand', 4],
  ]);
  assert.deepEqual(falling.map((r) => [r.sector, r.dimension, r.delta_pct]), [
    ['AI Infrastructure', 'supply', -20.25], ['Fintech / DeFi', 'supply', -3], ['DevTools', 'talent', -1],
  ]);
  assert.equal(rising[1].slug, 'fintech-defi');
  assert.deepEqual(topMovers(HEAT, 1).rising.length, 1);
  assert.deepEqual(topMovers({ sectors: [{ sector: 'X', dimensions: { a: cell(0), b: none, c: cell(null) } }] }), { rising: [], falling: [] });
});

test('the period caption names this month against the one before', () => {
  assert.equal(previousPeriod('2026-10'), '2026-09');
  assert.equal(previousPeriod('2026-01'), '2025-12');
  assert.equal(previousPeriod('bad'), null);
});

test('the card prints each mover with its sign and its sector page', () => {
  const out = html(h(TopMovers, { overview: ready(HEAT) }));
  assert.match(out, /href="\/research\/markets\/sector\/ai-infrastructure"/);
  const t = text(h(TopMovers, { overview: ready(HEAT) }));
  assert.match(t, /Rising AI Infrastructure · demand ▲ 30% Fintech \/ DeFi · demand ▲ 12\.5%/);
  assert.match(t, /Falling AI Infrastructure · supply ▼ 20\.3% /);
  assert.match(t, /market_intel_indexes · global · 2026-10 against 2026-09/);
  assert.doesNotMatch(t, /capital ▲|capital ▼|talent ▲|research/, 'an unchanged or unrecorded cell is ranked');
  assert.doesNotMatch(t, /Not recorded|#1092/);
});

test('one side empty says so; no change at all is Not recorded, not a list of zeros', () => {
  const up = { ...HEAT, sectors: [{ sector: 'DevTools', dimensions: { demand: cell(4) } }] };
  assert.match(text(h(TopMovers, { overview: ready(up) })), /No live index fell on last month/);
  const down = { ...HEAT, sectors: [{ sector: 'DevTools', dimensions: { demand: cell(-4) } }] };
  const d = text(h(TopMovers, { overview: ready(down) }));
  assert.match(d, /Rising No live index rose on last month\. Falling DevTools · demand ▼ 4%/);
  const flat = { ...HEAT, sectors: [{ sector: 'DevTools', dimensions: { demand: cell(0), supply: none } }] };
  const t = text(h(TopMovers, { overview: ready(flat) }));
  assert.match(html(h(TopMovers, { overview: ready(flat) })), /title="No live index has a change on last month yet\."/);
  assert.match(t, /Not recorded/);
  assert.doesNotMatch(t, /Rising|0%/);
});

test('a failed read is Unreadable; an index not computed is Not recorded with the Worker\'s reason', () => {
  assert.match(text(h(TopMovers, { overview: { status: 'loading', data: null } })), /Loading the movers/);
  for (const overview of [{ status: 'unreadable', data: null }, ready({ status: 'unreadable', reason: 'x' })]) {
    const t = text(h(TopMovers, { overview }));
    assert.match(t, /could not be read/);
    assert.doesNotMatch(t, /Not recorded|Rising/);
  }
  const pending = html(h(TopMovers, { overview: ready({ status: 'not_recorded', reason: "Live observations are recorded, but this month's index has not been computed yet" }) }));
  assert.match(pending, /title="Live observations are recorded, but this month&#x27;s index has not been computed yet">Not recorded</);
  assert.doesNotMatch(pending, /Rising|could not be read/);
});

test('the page reads the overview and hands its read to the card', () => {
  const src = codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src/pages/research/MarketDirectoryZone.jsx'), 'utf8'));
  assert.match(src, /const \[overview, reloadOverview\] = useRead\(\(\) => researchOverviewApi\.get\(1\)\);/);
  assert.match(src, /<TopMovers overview=\{\{ \.\.\.overview, reload: reloadOverview \}\} \/>/);
  assert.match(src, /import \{ researchOverviewApi \} from '\.\.\/\.\.\/lib\/api\/researchOverview\.js';/);
});
