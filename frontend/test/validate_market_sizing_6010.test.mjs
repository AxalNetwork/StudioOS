/**
 * D6010 (#6010) — Validate › Market intelligence opens market sizing to every
 * founder of the venture: the route and its gate, the venture the page reads
 * from the query (and never another in its place), the module's two tool
 * links, the Lab-only copy the page leaves out when opened from Validate, and
 * the part under the table that shows the stored positioning and assumptions
 * marks and the sources, "Not recorded" when absent and never 0.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/validate_market_sizing_6010.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { readRoutesSource } from './_routesSource.mjs';
import { ventureFromSearch, pickMarketProject } from '../src/pages/SpinoutLabMarketPage.jsx';
import { MarketReadinessView, markedOn, sourceUrl, sizingHref } from '../src/pages/cycles/ValidateMarketReadiness.jsx';
import validate from '../src/pages/cycles/defs/validate.jsx';
import { fnOf } from '../src/pages/cycles/adapters/index.js';
import CycleModulePage from '../src/pages/cycles/CycleModulePage.jsx';

const read = (f) => readFileSync(resolve(process.cwd(), f), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/validate/market-intelligence?project=7'] }, el));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('D6010: /validate/market-intelligence/sizing renders the sizing page from Validate, behind Validate\'s own gate', () => {
  const routes = readRoutesSource();
  const line = routes.split('\n').find((l) => l.includes('path="/validate/market-intelligence/sizing"'));
  assert.ok(line, 'the route exists');
  assert.ok(line.includes("guard(labRoles(['admin', 'founder']), <SpinoutLabMarketPage from=\"validate\" />)"), line);
  // The Lab's own door keeps its Lab gate.
  const lab = routes.split('\n').find((l) => l.includes('path="/spinout-lab/market"'));
  assert.ok(lab.includes("guard(labRoles(['admin']), <SpinoutLabMarketPage />)"), lab);
});

test('D6010: the page sizes the venture in the query, and only that one', () => {
  assert.equal(ventureFromSearch('?project=7'), 7);
  assert.equal(ventureFromSearch('?project_id=12'), 12);
  assert.equal(ventureFromSearch('?project=7x'), null);
  assert.equal(ventureFromSearch('?project=0'), null);
  assert.equal(ventureFromSearch(''), null);
  const mine = [{ id: 3, founder_id: 1 }, { id: 7, founder_id: 1 }];
  assert.equal(pickMarketProject(mine, { founder_id: 1 }, { fromValidate: true, ventureId: 7 }).id, 7);
  // A venture not in the caller's list is none — never the first one in its place.
  assert.equal(pickMarketProject(mine, { founder_id: 1 }, { fromValidate: true, ventureId: 9 }), null);
  assert.equal(pickMarketProject(mine, { founder_id: 1 }, { fromValidate: true, ventureId: null }), null);
  // From the Lab, the Lab's pick as before.
  assert.ok(pickMarketProject(mine, { founder_id: 1 }), 'the Lab still picks a venture');
});

test('D6010: from Validate the page reads no Lab state and draws no Lab gate, week lock or week copy', () => {
  const src = read('frontend/src/pages/SpinoutLabMarketPage.jsx');
  assert.match(src, /fromValidate \? Promise\.resolve\(\{\}\) : spinoutLab\.state\(\)/);
  assert.match(src, /if \(!fromValidate && !state\.active && !state\.is_incorporated && !isAdmin\)/);
  assert.match(src, /const deckUnlocked = fromValidate \|\| /);
  assert.match(src, /const advisorsUnlocked = fromValidate \|\| /);
  assert.match(src, /const week = fromValidate \? null : /);
  assert.match(src, /fromValidate \? 'Investor signals reviewed' : 'Investor signals reviewed \(Week 3\)'/);
  assert.match(src, /backLabel: 'Back to Market intelligence'/);
});

test('D6010: Market intelligence draws Size the market beside Open the competitor tracker, for its venture', () => {
  const links = fnOf(validate.tools, 'market-intelligence')('?project=7&sort=name');
  assert.deepEqual(links, [
    { label: 'Open the competitor tracker', href: '/build/competitors' },
    { label: 'Size the market', href: '/validate/market-intelligence/sizing?project=7' },
  ]);
  const out = html(h(CycleModulePage, { cycle: 'validate', slug: 'market-intelligence', data: { module: { name: 'Market intelligence' } }, tool: links }));
  const tools = [...out.matchAll(/data-testid="cycle-module-tool"[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(tools, ['Open the competitor tracker', 'Size the market']);
  assert.match(out, /href="\/validate\/market-intelligence\/sizing\?project=7"/);
  assert.equal(sizingHref(7), '/validate/market-intelligence/sizing?project=7');
});

test('D6010: the stored checks under the table read "Not recorded" when absent, never 0', () => {
  const out = text(html(h(MarketReadinessView, { projectId: 7, status: 'ready', read: { positioning_map: null, assumptions_reviewed: null, sources: [] } })));
  assert.match(out, /Positioning map Not recorded/);
  assert.match(out, /Assumptions reviewed Not recorded/);
  assert.match(out, /Sources Not recorded/);
  assert.doesNotMatch(out, /\b0\b/);
});

test('D6010: the stored checks show the dates marked and each source', () => {
  const out = html(h(MarketReadinessView, { projectId: 7, status: 'ready', read: {
    positioning_map: '2026-11-02 10:00:00', assumptions_reviewed: '2026-11-03T09:00:00Z',
    sources: [
      { id: 1, title: 'Synthetic report', url: 'https://example.com/r', kind: 'Report', created_at: '2026-11-01 08:00:00' },
      { id: 2, title: 'Synthetic call', url: 'javascript:alert(1)', kind: 'Interview', created_at: '2026-11-04 08:00:00' },
    ],
  } }));
  const t = text(out);
  assert.match(t, /Positioning map Marked 2026-11-02/);
  assert.match(t, /Assumptions reviewed Marked 2026-11-03/);
  assert.equal((out.match(/data-testid="validate-market-source"/g) || []).length, 2);
  assert.match(out, /href="https:\/\/example.com\/r"/);
  assert.doesNotMatch(out, /javascript:/, 'a non-web address is drawn as text');
  assert.equal(markedOn(null), null);
  assert.equal(sourceUrl('ftp://x'), null);
});

test('D6010: a failed read of the stored checks says unreadable and claims none', () => {
  const out = text(html(h(MarketReadinessView, { projectId: 7, status: 'unreadable', read: null })));
  assert.match(out, /could not be read/);
  assert.doesNotMatch(out, /Not recorded/);
});

test('D6010: the card\'s next step is the sizing door, and the module draws the stored checks under its table', () => {
  const card = read('cloudflare-worker/src/services/cycleValidate.ts');
  const body = card.slice(card.indexOf('export async function marketCard'), card.indexOf('async function loadDemand'));
  assert.doesNotMatch(body, /href\(ctx, 'market-intelligence'\)/, 'no step links back to the page that cannot do it');
  assert.equal((body.match(/href: sizingHref\(ctx\)/g) || []).length, 4);
  const defs = read('frontend/src/pages/cycles/defs/validate.jsx');
  assert.match(defs, /<MarketReadiness projectId=\{ctx\.projectId\} \/>/);
});
