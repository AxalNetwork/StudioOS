/**
 * D1311 (#2398, #2408) — Build's connector parts: one line per connector, each
 * in its own boundary, mounted by CycleRoute through buildPartsMap. The order
 * the owner's canvases draw them is the contract in
 * build_parts_contract_5507.test.mjs (#5507, D5507), not this file's.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/build_parts_d1311.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { BUILD_PARTS, PartBoundary, buildPartsMap } from '../src/pages/cycles/buildParts.jsx';
import { cycleRouteText } from './_cycleBands.mjs'; // D5615: CycleRoute.jsx and its cycle entries in defs/

const text = (n) => n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '';

// #5507: every module's complete, ordered list of parts is owned by
// build_parts_contract_5507.test.mjs (D5507); each provider's own suite
// asserts where its part sits and what it mounts. This file keeps the
// registry's mechanics: the boundary, the map's shape and CycleRoute's wiring.

test('CycleRoute takes Build\'s parts from the module registry, and from nowhere else', () => {
  assert.match(cycleRouteText(), /parts: toFnMap\(buildPartsMap\(\)\),/);
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
