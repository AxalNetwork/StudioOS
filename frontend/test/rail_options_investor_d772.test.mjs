/**
 * D772 (#2098) PR 1 — the investor's rail options inventory, held against the
 * canvas and the code, and the two investor boards that drew no rail.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/rail_options_investor_d772.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { INVESTOR_BOARD_FILES, INVESTOR_RAIL_OPTIONS, RAIL_OPTION_HANDLERS } from '../src/lib/railOptions/investor.js';

const h = React.createElement;
const SRC = (f) => resolve('frontend/src', f);
const read = (f) => readFileSync(SRC(f), 'utf8');
const CANVAS = JSON.parse(readFileSync(resolve('design/incoming/airail-every-page-data/canvas.json'), 'utf8'));

/** The canvas's investor boards as "Investor · <section>[ · <board>]", Home left out (it is not an I-board). */
const BOARDS = Object.entries(CANVAS.profiles.Investor).flatMap(([section, subs]) => (
  section === 'Home' ? [] : [`Investor · ${section}`, ...subs.map((s) => `Investor · ${section} · ${s}`)]));
const KINDS = new Set(Object.values(CANVAS.task_kind));

test('the canvas gives the investor 27 boards and fourteen kinds', () => {
  assert.equal(BOARDS.length, 27);
  assert.equal(KINDS.size, 14);
});

test('every row names a canvas board, a <verb>:<object> key unique on its page, a canvas kind and a handler', () => {
  assert.ok(INVESTOR_RAIL_OPTIONS.length > 0);
  const seen = new Set();
  for (const o of INVESTOR_RAIL_OPTIONS) {
    assert.ok(BOARDS.includes(o.page), `${o.page} is not an investor board`);
    assert.match(o.key, /^[a-z]+:[a-z0-9]+(?:-[a-z0-9]+)*$/, o.key);
    const id = `${o.page}|${o.key}`;
    assert.ok(!seen.has(id), `${id} twice`);
    seen.add(id);
    assert.ok(typeof o.label === 'string' && o.label.trim(), `${id} has no label`);
    assert.ok(KINDS.has(o.kind), `${id}: ${o.kind} is not one of the canvas's kinds`);
    assert.ok(RAIL_OPTION_HANDLERS.includes(o.handler), `${id}: ${o.handler}`);
  }
});

test('every listed option exists in the code, and on a file an investor board renders', () => {
  for (const o of INVESTOR_RAIL_OPTIONS) {
    assert.ok(INVESTOR_BOARD_FILES.includes(o.source.file), `${o.key}: ${o.source.file} is not an investor board file`);
    assert.ok(read(o.source.file).includes(o.source.match), `${o.page} ${o.key}: no ${o.source.match} in ${o.source.file}`);
  }
});

/** The model-running controls a file holds: each draft band's surface, and each research call that runs a model. */
function controlsIn(file) {
  const src = read(file);
  const found = [];
  for (const m of src.matchAll(/<ZoneDraft\b[^>]*?\bsurface="([^"]+)"/gs)) found.push(`surface="${m[1]}"`);
  for (const m of src.matchAll(/api\.research\.(ask|upload|reindex)\(/g)) found.push(`api.research.${m[1]}(`);
  return [...new Set(found)];
}

test('every draft band and model-running call on an investor board is a row', () => {
  const listed = new Set(INVESTOR_RAIL_OPTIONS.map((o) => `${o.source.file}|${o.source.match}`));
  let n = 0;
  for (const file of INVESTOR_BOARD_FILES) {
    assert.ok(existsSync(SRC(file)), `${file} is gone`);
    for (const c of controlsIn(file)) {
      n += 1;
      assert.ok(listed.has(`${file}|${c}`), `${file}: ${c} runs a model and is not in INVESTOR_RAIL_OPTIONS`);
    }
  }
  assert.equal(n, INVESTOR_RAIL_OPTIONS.length, 'one row per control found');
});

test('the handler follows the control: a band drafts, an ask is a form, a document goes up', () => {
  for (const o of INVESTOR_RAIL_OPTIONS) {
    const want = o.source.match.startsWith('surface=') ? 'draft' : o.source.match === 'api.research.ask(' ? 'form' : 'upload';
    assert.equal(o.handler, want, `${o.page} ${o.key}`);
  }
});

// ------------------------------------------------------------------ the boards that drew no rail

test('I8 Performance draws the investor rail in the shared frame; an admin\'s Performance tab is unchanged', async () => {
  const { default: PortfolioWorkspace } = await import('../src/pages/PortfolioWorkspace.jsx');
  const at = (activeRole) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/portfolio/performance'] }, h(PortfolioWorkspace, { activeRole })));
  assert.match(at('investor'), /data-testid="portfolio-performance-frame"/);
  assert.doesNotMatch(at('admin'), /portfolio-performance-frame/);
  assert.match(read('pages/PortfolioWorkspace.jsx'), /<WorkerRail workspace="Portfolio" role="investor"/);
});

test('I11 Axal VC Fund draws the investor rail in the shared frame; the chrome\'s other keys do not', async () => {
  const { default: InvestorWorkspacePage } = await import('../src/pages/investor/InvestorWorkspacePage.jsx');
  const fund = renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/spinout-lab/investor-workspace'] },
    h(InvestorWorkspacePage, { page: 'axal-vc-fund' })));
  assert.match(fund, /data-testid="axal-vc-fund-frame"/);
  assert.match(fund, /data-testid="investor-workspace-axal-vc-fund"/);
  const trust = renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/trust'] }, h(InvestorWorkspacePage, { page: 'trust' })));
  assert.doesNotMatch(trust, /axal-vc-fund-frame/);
  assert.match(read('pages/investor/InvestorWorkspacePage.jsx'), /<WorkerRail workspace="Axal VC Fund" role="investor"/);
});
