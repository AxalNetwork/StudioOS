// D1270 (#2381) — HQ › Platform › Promo codes (PRM1–PRM13): Codes and Usage as
// addresses, one code's drawer at its own address, the filters in the address,
// the canvas's state words in promoState's order, the redeemed figure called a
// lower bound, and "Not read here yet" on every block no read carries.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/promo_codes_d1270.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { PromoDrawer, PromoNotes, PromoUsage } from '../src/pages/admin/promos/PromoParts.jsx';
import { BASE, STATE_WORD, WAITS, codeHref, codesHref, stateOf, viewOf } from '../src/pages/admin/promos/promoModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const NOW = Date.parse('2026-10-26T12:00:00Z');

test('the address: Codes, Usage, one code’s drawer, and the filters', () => {
  assert.deepEqual(viewOf(BASE), { tab: 'codes', id: null, filters: { state: null, applies: null } });
  assert.equal(viewOf(`${BASE}/usage`).tab, 'usage');
  assert.deepEqual(viewOf(`${BASE}/promo_1AbC`, '?state=paused&applies=plans'), { tab: 'codes', id: 'promo_1AbC', filters: { state: 'paused', applies: 'plans' } });
  assert.equal(viewOf(`${BASE}/a.b`).id, null);
  assert.deepEqual(viewOf(BASE, '?state=odd&applies=all').filters, { state: null, applies: 'all' });
  assert.equal(codesHref({ state: 'active', applies: 'plans' }), `${BASE}?state=active&applies=plans`);
  assert.equal(codesHref({}), BASE);
  assert.equal(codeHref('promo_9'), `${BASE}/promo_9`);
  assert.equal(codeHref('../x'), BASE);
});

test('states in promoState’s order: off, then expired, then at its cap, then active; paused and ended only once recorded', () => {
  assert.equal(stateOf({ active: 0, expires_at: '2020-01-01' }, NOW), 'off');
  assert.equal(stateOf({ active: 1, expires_at: '2026-10-01T00:00:00Z' }, NOW), 'expired');
  assert.equal(stateOf({ active: 1, max_redemptions: 5, times_redeemed: 5 }, NOW), 'at_cap');
  assert.equal(stateOf({ active: 1, max_redemptions: 5, times_redeemed: null }, NOW), 'active');
  assert.equal(stateOf({ active: 0, paused_at: '2026-10-20' }, NOW), 'paused');
  assert.equal(stateOf({ active: 0, paused_at: '2026-10-20', ended_at: '2026-10-21' }, NOW), 'ended');
  assert.deepEqual(Object.values(STATE_WORD), ['Active', 'Paused', 'Ended', 'Expired', 'At its cap', 'Switched off']);
  for (const [k, w] of Object.entries(WAITS)) assert.ok(!/\b0\b|\bnone\b/i.test(w), k);
});

test('rendered: Usage waits, the drawer opens from its address and closes to the list, and Redeemed is a lower bound', () => {
  assert.ok(html(h(PromoUsage)).includes('data-testid="promo-wait-usage"'));
  assert.equal(html(h(PromoDrawer, { id: null })), '');
  const d = html(h(PromoDrawer, { id: 'promo_9' }));
  assert.ok(d.includes('data-testid="promo-drawer"') && d.includes(`href="${BASE}"`) && d.includes('promo-wait-drawer'));
  assert.match(html(h(PromoNotes)), /lower bound/);
});

test('the wiring: the routes, HQ only, the tabs, the row door, the canvas and the docs', () => {
  const app = read('frontend/src/App.jsx');
  for (const p of ['/admin/platform/promo-codes/usage', '/admin/platform/promo-codes/:id']) {
    assert.ok(app.includes(`<Route path="${p}" element={guard(['admin'], hqOnly(<PromoCodesPage />))} />`), p);
  }
  assert.ok(app.indexOf('path="/admin/platform/promo-codes/usage"') < app.indexOf('path="/admin/platform/promo-codes/:id"'), 'the static tab first');
  const pages = read('frontend/src/pages/admin/ConsolePages.jsx');
  assert.match(pages, /<ConsolePage hqOnly crumb=\{\{ \.\.\.PLATFORM, current: 'Promo codes' \}\}/);
  assert.ok(pages.includes('<HeaderTab to="/admin/platform/promo-codes/usage" data-testid="promo-tab-usage">Usage</HeaderTab>'));
  assert.ok(pages.includes("{view.tab === 'usage' ? <PromoUsage /> : ("));
  assert.ok(read('frontend/src/pages/admin/consoles/PromoCodesConsole.jsx').includes('<Link to={`/admin/platform/promo-codes/${p.id}`} className="underline">{p.code}</Link>'));
  for (const f of ['Promo Codes Page.dc.html', 'Promo codes · Boards.dc.html']) assert.ok(existsSync(`design/incoming/${f}`), f);
  assert.ok(read('design/incoming/Promo codes · Boards.dc.html').includes('name="Promo Codes Page"'));
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/.test(read('design/incoming/Promo Codes Page.dc.html')), 'no asset uuid is left in the page');
  assert.ok(existsSync('documentation/architecture/decisions/D1270.md'));
  assert.ok(existsSync('documentation/audits/PROMO_CODES_MAP_2026-10-26.md'));
});
