/**
 * #8776 (D8776-p3, BLR05B) — the other links that open `/build/roadmap` are named after, and land on, the view
 * that page actually opens.
 *
 *   1. the pure rule: `?from=home&step=<key>` is an origin the page can name (only the keys it knows), and Back
 *      goes Home for it, while an item or the board's own address still wins;
 *   2. the landing opened from Home's checklist: "Back to Home", the row named in the context row, at zero items
 *      too, and a link with no venture says it showed the reader's first;
 *   3. the four sources (`routes/progress.ts`, `services/onboardingChecklist.ts`, `routes/assistant.ts`,
 *      `lib/siteDoors.js`): no label promises a roadmap view the page does not open.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/roadmap_links_8776.test.mjs
 *
 * Every venture, item and person here is synthetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { textOf, propsOf } from './_form_d695.mjs';
import FounderBuildRoadmap from '../src/pages/founder/FounderBuildRoadmap.jsx';
import { api } from '../src/lib/api.js';
import { DOORS } from '../src/lib/siteDoors.js';
import { CHECKLIST_STEPS, DOOR, landingBack, linkOrigin } from '../src/pages/cycles/roadmapShortcut.js';

const h = React.createElement;
const repo = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

async function landing(entry, { items = [], projects = [{ id: 412, name: '[Atlas Orchard]' }] } = {}) {
  const original = { ...api };
  api.listProjects = async () => projects;
  api.roadmapGraph = async () => ({
    project: projects[0], items, dependencies: [], scenarios: [], store_ready: true, can_write: true,
    stats: { items: items.length, quarters: 0, dependencies: 0, unresolved: 0, blocked: 0, scenarios: 0 },
  });
  const restore = installDocument('', { focus: true });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [entry] }, h(FounderBuildRoadmap))); });
  for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); });
  const walk = (node) => [node, ...(node.childNodes || []).flatMap(walk)];
  const by = (id) => walk(container).find((n) => propsOf(n)['data-testid'] === id);
  return {
    by,
    async close() { await act(async () => root.unmount()); restore(); Object.assign(api, original); },
  };
}

test('1. a Home checklist origin is named only for the rows the page knows, and Back goes Home', () => {
  // Mutation checked: `from` ignored (linkOrigin always null) → the Home origin is null; an unknown step echoed
  // → the context names "x"; the origin placed above the item → Back to Home wins over Back to [Harvest log].
  assert.deepEqual(linkOrigin('home', 'roadmap_set'), { href: '/studio', back: 'Back to Home', context: 'Home · checklist “Set a 90-day roadmap”' });
  assert.equal(linkOrigin('home', 'okrs').context, 'Home · checklist “Add 3 quarterly OKRs”');
  assert.equal(linkOrigin('home', 'x').context, 'Home', 'a step the page does not know is never echoed');
  assert.equal(linkOrigin('home', 'toString').context, 'Home', 'an inherited key is not a step');
  for (const from of [null, '', 'https://evil.example', '/studio', 'board']) assert.equal(linkOrigin(from, 'roadmap_set'), null);
  assert.deepEqual(Object.keys(CHECKLIST_STEPS), ['roadmap_set', 'mvp_shipped', 'launch_checklist', 'okrs']);

  const home = linkOrigin('home', 'roadmap_set');
  assert.deepEqual(landingBack({ projectId: 412, origin: home }), { href: '/studio', label: 'Back to Home', focus: null });
  assert.equal(landingBack({ projectId: 412, origin: home, item: { id: 57, objective: '[Harvest log]' } }).label, 'Back to [Harvest log]');
  assert.equal(landingBack({ projectId: 412, origin: home, from: '/build/product-roadmap?project_id=412&view=board' }).label, 'Back to Product roadmap');
  assert.equal(landingBack({ projectId: 412 }).href, '/build/product-roadmap?project_id=412');
});

test('2. opened from Home\'s checklist: Back to Home and the row named, at zero items too', async () => {
  // Mutation checked: the context row kept to the populated page → text-roadmap-from is missing at zero; the
  // origin not passed to landingBack → "Back to Product roadmap"; `kept` always true → the venture claims the link.
  const zero = await landing('/build/roadmap?project_id=412&view=quarters&from=home&step=roadmap_set');
  try {
    const back = zero.by('link-roadmap-back');
    assert.match(textOf(back), /Back to Home/);
    assert.equal(propsOf(back).href, '/studio');
    assert.equal(textOf(zero.by('text-roadmap-from')), 'Home · checklist “Set a 90-day roadmap”');
    assert.match(textOf(zero.by('text-roadmap-project').parentNode), /Kept from the link you followed/);
    assert.equal(textOf(zero.by('link-roadmap-add-first')), 'Add the first item', 'the one first action stays');
  } finally { await zero.close(); }

  const items = [{ id: 57, objective: '[Harvest log]', quarter: 'Q1 2027', kanban_status: 'next', state: 'blocked', state_label: 'Blocked', blocks: [], blocked_by: [] }];
  const okrs = await landing('/build/roadmap?view=quarters&from=home&step=okrs', { items });
  try {
    assert.equal(textOf(okrs.by('text-roadmap-from')), 'Home · checklist “Add 3 quarterly OKRs”');
    assert.match(textOf(okrs.by('text-roadmap-project').parentNode), /Your first venture; the link named none/);
    assert.equal(propsOf(okrs.by('link-roadmap-back')).href, '/studio');
  } finally { await okrs.close(); }

  const plain = await landing('/build/roadmap?project_id=412&view=quarters', { items });
  try {
    assert.equal(textOf(plain.by('text-roadmap-from')), 'Product roadmap', 'with no origin the page reads as before');
    assert.match(textOf(plain.by('link-roadmap-back')), /Back to Product roadmap/);
  } finally { await plain.close(); }
});

test('3. every other link that opens /build/roadmap names that page and its view', () => {
  // Mutation checked: a checklist row put back to the bare `/build/roadmap` → its href lacks view=quarters;
  // "Roadmap & OKRs" restored → the stale label is found; the site door's "Roadmap" restored → the label differs.
  const progress = repo('cloudflare-worker/src/routes/progress.ts');
  for (const key of ['roadmap_set', 'mvp_shipped', 'launch_checklist']) {
    assert.match(progress, new RegExp(`href: roadmapChecklistHref\\(projectId, '${key}'\\)`), `${key} carries its view and origin`);
  }
  assert.doesNotMatch(progress, /href: '\/build\/roadmap'/, 'no checklist row opens the bare page');
  const onboarding = repo('cloudflare-worker/src/services/onboardingChecklist.ts');
  assert.match(onboarding, /ROADMAP_OKRS_ROUTE = '\/build\/roadmap\?view=quarters&from=home&step=okrs'/);
  assert.doesNotMatch(onboarding, /route: '\/build\/roadmap'/);
  const assistant = repo('cloudflare-worker/src/routes/assistant.ts');
  assert.doesNotMatch(assistant, /Roadmap & OKRs/);
  assert.match(assistant, new RegExp(`url: '/build/roadmap\\?view=quarters', label: '${DOOR}'`));
  assert.match(assistant, /url: '\/build\/product-roadmap', label: 'Product roadmap'/);
  assert.ok(assistant.indexOf("'okr'") < assistant.indexOf("'product roadmap'"), 'the narrower entry matches first');
  const door = Object.values(DOORS).flatMap((d) => d.live || []).find((d) => d.route === '/build/roadmap');
  assert.equal(door?.t, DOOR, 'the site names the page it opens');
});
