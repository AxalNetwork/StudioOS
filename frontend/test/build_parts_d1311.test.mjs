/**
 * D1311 (#2398, #2408) — Build's connector parts, in the order the owner's
 * Lovable and Vercel canvases draw them, one line per connector, each in its
 * own boundary.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/build_parts_d1311.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { BUILD_PARTS, PartBoundary, builtParts, buildPartsMap } from '../src/pages/cycles/buildParts.jsx';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const text = (n) => n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '';
const order = (slug) => BUILD_PARTS[slug].map(([key]) => key);

test('each module lists its connectors in the canvases\' order', () => {
  // VC1: the Hosting block after Tools history and GitHub's Code system.
  assert.deepEqual(order('operating-systems'), ['tools', 'vercel']);
  // VC4a: Runs on under GitHub's From GitHub; D1314: Google's and Notion's proposals after.
  assert.deepEqual(order('solution-design'), ['github', 'vercel', 'google', 'notion']);
  // VC2 and LV7: From Lovable under From GitHub; Vercel's Live strip between.
  assert.deepEqual(order('prototype-mvp'), ['github', 'vercel', 'lovable', 'notion']);
  // VC3: "The Deploys strip sits above GitHub's Releases strip."
  // Mutation checked: put github first → this fails.
  assert.deepEqual(order('product-roadmap'), ['vercel', 'github', 'google', 'notion']);
  assert.deepEqual(order('company-creation'), ['github', 'vercel']);
  assert.deepEqual(order('founding-team'), ['github']);
});

test('a part not built yet is a null on its own line, named with the task that builds it', () => {
  const src = read('frontend/src/pages/cycles/buildParts.jsx');
  for (const [issue, decision, component] of [
    ['#2962', 'D1097', 'RunsOnFromVercel'], ['#2962', 'D1097', 'HostingFromVercel'],
    ['#2963', 'D1098', 'MvpFromVercel'], ['#2963', 'D1098', 'RoadmapFromVercel'],
    ['#2964', 'D1099', 'CompanyFromVercel'], ['#2948', 'D1083', 'FromLovable'],
    ['#2958', 'D1093', 'FromGoogle'], ['#2953', 'D1088', 'FromNotion'],
  ]) {
    assert.ok(src.includes(`${issue} (${decision}), ${component}`), `${component} names ${issue}`);
  }
  // The unbuilt ones are left out of what draws; GitHub's stay.
  assert.deepEqual(builtParts('product-roadmap').map(([k]) => k), ['github']);
  assert.deepEqual(builtParts('prototype-mvp').map(([k]) => k), ['github']);
  // CycleRoute takes Build's parts from here, and from nowhere else.
  assert.match(read('frontend/src/pages/cycles/CycleRoute.jsx'), /parts: toFnMap\(buildPartsMap\(\)\),/);
});

async function mount(element) {
  const restore = installDocument();
  const container = document.createElement('div');
  const root = createRoot(container);
  const quiet = console.error; console.error = () => {};
  await act(async () => root.render(element));
  console.error = quiet;
  return { container, async done() { await act(async () => root.unmount()); restore(); } };
}

test('a part that throws reads Unreadable; the parts beside it stay drawn', async () => {
  const Boom = () => { throw new Error('bad read'); };
  const w = await mount(React.createElement(React.Fragment, null,
    React.createElement(PartBoundary, { key: 'a', name: 'x-vercel' }, React.createElement(Boom)),
    React.createElement(PartBoundary, { key: 'b', name: 'x-github' }, React.createElement('p', null, 'From GitHub'))));
  try {
    const t = text(w.container);
    // Mutation checked: render children unguarded → the whole fragment unmounts and neither shows.
    assert.match(t, /This part could not be read\. The rest of this page is current\./);
    assert.match(t, /From GitHub/);
  } finally { await w.done(); }
});

test('buildPartsMap gives one function per module, as toFnMap takes it', () => {
  const map = buildPartsMap();
  assert.deepEqual(Object.keys(map).sort(), Object.keys(BUILD_PARTS).sort());
  for (const fn of Object.values(map)) assert.equal(typeof fn, 'function');
});
