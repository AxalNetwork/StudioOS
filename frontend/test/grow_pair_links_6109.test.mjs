/**
 * #6109 — the two Grow pairs link to each other, with the venture kept, and
 * each page says which half it is.
 *
 *   · Talent → Team expansion ("Roles and hiring plan"), and Team expansion → Talent;
 *   · Partnerships → Partner network ("Partner records"), and Partner network → Partnerships;
 *   · Team expansion's door to /build/team ("Open team roster and hiring plan");
 *   · the module pages' headings are "Talent · Roles" and "Partnerships · Partners";
 *   · each with a canonical `?project_id=`, a legacy `?project=` and no project;
 *   · no route, slug or deep link changes (D4862);
 *   · Bulk reject names the gap that is left: no bulk form of the stage writer.
 *
 * Every venture is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/grow_pair_links_6109.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import FounderGrowTalent from '../src/pages/founder/FounderGrowTalent.jsx';
import FounderGrowPartnerships from '../src/pages/founder/FounderGrowPartnerships.jsx';
import grow from '../src/pages/cycles/defs/grow.jsx';
import { moduleToolLinks, projectSearch } from '../src/pages/cycles/founderToolNavigation.js';
import { CycleHeader } from '../src/pages/cycles/CycleOverview.jsx';
import { GROW_AREAS, growArea, growModuleTitle } from '../src/pages/cycles/growOverviewModel.js';
import { founderZoneActions } from '../src/workspaces/founderZoneActions.js';

const h = React.createElement;
const founder = { role: 'founder', tier: 'pro', subscription_tier: 'pro' };
const QUERIES = [
  ['canonical', '?project_id=19', '?project_id=19'],
  ['legacy', '?project=19', '?project_id=19'],
  ['absent', '', '?project_id=41'],
];

async function mountPage(Page, path) {
  const restore = installDocument();
  const store = new Map();
  const previous = { fetch: globalThis.fetch, localStorage: globalThis.localStorage, matchMedia: globalThis.matchMedia };
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (u) => {
    const url = String(u);
    if (/\/api\/projects(\?|$)/.test(url)) return json({ items: [{ id: 41, name: 'Example One' }, { id: 19, name: 'Example Two' }] });
    if (/\/api\/jobs(\?|$)/.test(url)) return json({ jobs: [] });
    if (/\/api\/comarketing\/founder\/by-project\//.test(url)) return json({ pitches: [], attributions: [] });
    return json({});
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [path] }, h(Page))));
  await act(async () => { for (let i = 0; i < 16; i += 1) await new Promise((r) => setImmediate(r)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  return {
    href: (id) => byId(id)?.getAttribute?.('href') ?? byId(id)?.attributes?.href ?? props(byId(id)).href ?? null,
    async close() {
      await act(async () => root.unmount());
      Object.assign(globalThis, previous);
      restore();
    },
  };
}

// Mutation checked: the Talent link dropped (fails); its venture dropped (fails); the legacy ?project= ignored (fails).
test('Talent links to Team expansion with the venture kept: canonical, legacy and absent', async () => {
  for (const [name, q, expected] of QUERIES) {
    const v = await mountPage(FounderGrowTalent, '/grow/talent' + q);
    try {
      assert.equal(v.href('link-grow-talent-roles'), '/grow/team-expansion' + expected, name);
    } finally { await v.close(); }
  }
});

// Mutation checked: the Partnerships link dropped (fails); pointed at co-marketing (fails).
test('Partnerships links to Partner network\'s records with the venture kept: canonical, legacy and absent', async () => {
  for (const [name, q, expected] of QUERIES) {
    const v = await mountPage(FounderGrowPartnerships, '/grow/partnerships' + q);
    try {
      assert.equal(v.href('link-grow-partnerships-records'), '/grow/partner-network' + expected, name);
    } finally { await v.close(); }
  }
});

// Mutation checked: the Partner network tool removed (fails); Team expansion's tool removed (fails); the /build/team door removed (fails).
test('Team expansion and Partner network link back to their desks; Team expansion opens the roster and plan', () => {
  for (const [name, search, expected] of [
    ['canonical', '?project_id=19', '?project_id=19'],
    ['legacy', '?project=19', '?project_id=19'],
    ['absent', '', ''],
  ]) {
    const q = projectSearch(search);
    assert.deepEqual(grow.tools.get('team-expansion')(q), { label: 'Open Talent: roles and applicants', href: '/grow/talent' + expected }, name);
    assert.deepEqual(grow.tools.get('partner-network')(q), { label: 'Open Partnerships: pitches and attributions', href: '/grow/partnerships' + expected }, name);
    const doors = moduleToolLinks('grow', 'team-expansion', founder, search);
    assert.ok(doors.some((d) => d.label === 'Open team roster and hiring plan' && d.href === '/build/team' + expected), `${name}: ${JSON.stringify(doors)}`);
  }
  // Partner network's existing door stays.
  assert.ok(moduleToolLinks('grow', 'partner-network', founder, '?project_id=19').some((d) => d.href === '/grow/partner-network/co-marketing?project_id=19'));
  // Only a founder or an admin is offered the door, as every founder tool.
  assert.deepEqual(moduleToolLinks('grow', 'team-expansion', { role: 'investor' }, ''), []);
});

// Mutation checked: the heading reverted to the area name (fails); the record back-link name reverted (fails).
test('the two module pages\' headings say which half they are; the tab still lights the desk', () => {
  assert.equal(growModuleTitle('team-expansion'), 'Talent · Roles');
  assert.equal(growModuleTitle('partner-network'), 'Partnerships · Partners');
  assert.equal(growModuleTitle('talent'), 'Talent', 'the desk keeps its own name');
  assert.equal(growModuleTitle('distribution'), 'Distribution');
  assert.equal(grow.moduleName('team-expansion'), 'Talent · Roles');
  assert.equal(grow.moduleName('partner-network'), 'Partnerships · Partners');
  for (const [slug, title, tab] of [['team-expansion', 'Talent · Roles', 'Talent'], ['partner-network', 'Partnerships · Partners', 'Partnerships']]) {
    const html = renderToStaticMarkup(h(MemoryRouter, null, h(CycleHeader, { cycle: 'grow', cards: [], active: slug, title: 'ignored', search: '?project_id=19' })));
    assert.match(html, new RegExp(`<h1[^>]*>${title}</h1>`), slug);
    assert.equal(growArea(slug).name, tab, `${slug} still lights ${tab}`);
  }
});

test('no route, slug or deep link changes (D4862)', () => {
  assert.deepEqual(GROW_AREAS.map((a) => [a.key, a.path, a.aliases.join(',')]), [
    ['', '/grow', ''], ['focus', '/grow/focus', 'revenue-and-traction'], ['customers', '/grow/customers', 'product-improvement'],
    ['distribution', '/grow/distribution', 'launch'], ['talent', '/grow/talent', 'team-expansion'],
    ['partnerships', '/grow/partnerships', 'partner-network'], ['markets', '/grow/market-expansion', 'market-expansion'],
    ['company', '/grow/durable-company-building', 'durable-company-building,brand'],
  ]);
});

// Mutation checked: the old "no endpoint sets an application status" wording restored (fails).
test('Bulk reject names the gap that is left: one stage at a time exists, no bulk form does', () => {
  const action = founderZoneActions('grow/talent', { query: '' }).find((a) => a.label === 'Bulk reject');
  assert.ok(action, 'Bulk reject is still a stated gap');
  const said = JSON.stringify(action);
  assert.doesNotMatch(said, /no endpoint sets an application status/);
  assert.match(said, /nothing declines several at once/);
  const src = readFileSync(new URL('../src/workspaces/founderZoneActions.js', import.meta.url), 'utf8');
  assert.match(src, /unbuilt: 'one application’s stage can be set to declined, but no endpoint declines several at once/);
  const route = readFileSync(new URL('../../cloudflare-worker/src/routes/cycle_grow.ts', import.meta.url), 'utf8');
  assert.match(route, /r\.patch\('\/applications\/:id\/stage'/, 'the one-at-a-time writer the wording names');
  assert.doesNotMatch(route, /applications\/(bulk|stages)|applications'\s*,\s*write\(.*bulk/i, 'a bulk writer exists now: make Bulk reject a handler');
});
