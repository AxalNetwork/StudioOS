/**
 * D6068 (#6068, under #4863) — Home's "Claims backed" tile and Story's
 * Mismatch dot, from the module read's `parts.narrative.claims` (the Worker's
 * `services/narrative/claimTally.ts`, D1264's claim store for the newest
 * version).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/narrative_claims_tile_6068.test.mjs
 */
import './_cycleSteps.mjs'; // D4574 (#4574, H5): CycleRoute's lazy steps, loaded before it mounts
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import { CLAIMS_UNREADABLE, CLAIMS_WAIT, claimsTile, homeTiles } from '../src/pages/raise/narrative/narrativeModel.js';
import { SECTIONS, mismatchSections, sectionDot } from '../src/pages/raise/narrative/storyModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const tally = (o = {}) => ({ state: 'ok', version: 4, backed: 3, total: 5, checked_at: '2026-11-14T09:00:00Z', mismatch_sections: ['traction'], ...o });
const PART = (claims) => ({ state: 'ok', versions: [{ version: 4, audience: 'Seed fund' }], newest: { version: 4, compared: 2, mismatches: [] }, claims });
const tileOf = (part) => homeTiles(part).find((t) => t.key === 'claims');

test('D6068: Claims backed reads "n of m" for the newest version once claims are checked', () => {
  assert.deepEqual(tileOf(PART(tally())), { key: 'claims', label: 'Claims backed', value: '3 of 5', sub: 'Backed by a record, in v4', waits: false });
  assert.equal(tileOf(PART(tally({ backed: 0 }))).value, '0 of 5', 'a real zero of a checked total');
});

test('D6068: Claims backed is a dash with the reason when the read failed or nothing was checked, never 0 for unknown', () => {
  assert.deepEqual(tileOf(PART({ state: 'unreadable', version: 4, reason: 'The claims could not be read' })),
    { key: 'claims', label: 'Claims backed', value: '—', sub: CLAIMS_UNREADABLE, waits: true });
  assert.deepEqual(tileOf(PART(tally({ backed: 0, total: 0, mismatch_sections: [] }))),
    { key: 'claims', label: 'Claims backed', value: '—', sub: 'Nothing checked yet in v4', waits: true });
  // A part with no tally (no version, or a Worker before D6068), or a tally whose counts are not numbers, waits.
  for (const claims of [undefined, null, { state: 'ok', version: 4 }, tally({ backed: null }), tally({ total: 'x' })]) {
    const t = claimsTile(claims, { version: 4 });
    assert.deepEqual([t.value, t.sub, t.waits], ['—', CLAIMS_WAIT, true], JSON.stringify(claims));
  }
});

test('D6068: a section with an open Mismatch shows the Mismatch dot; Empty still wins, and the tally is the newest version\'s only', () => {
  assert.equal(sectionDot({ body: 'Words.' }, [], null, true), 'Mismatch');
  assert.equal(sectionDot({ body: 'Words.' }, [], null, false), 'Written');
  assert.equal(sectionDot({ body: 'Words.' }, [], null), 'Written', 'no tally is no Mismatch');
  assert.equal(sectionDot({ body: null }, [], null, true), 'Empty', 'a cleared section has no claim to show');
  assert.deepEqual([...mismatchSections(PART(tally({ mismatch_sections: ['traction', 'solution'] })), 4)], ['traction', 'solution']);
  assert.deepEqual([...mismatchSections(PART(tally()), '4')], ['traction'], 'the version from the address is a string');
  assert.deepEqual([...mismatchSections(PART(tally()), 3)], [], 'an older version is not the tally\'s');
  assert.deepEqual([...mismatchSections(PART({ state: 'unreadable', version: 4 }), 4)], []);
  assert.deepEqual([...mismatchSections(null, 4)], []);
  assert.deepEqual([...mismatchSections(PART(tally()), null)], []);
});

/* ------------------------------------------------------------------ *
 * Story, mounted: the rail's dot reads the module read's tally
 * ------------------------------------------------------------------ */

const NARRATIVE = {
  version: 4,
  meta: { state: 'ok', live: false, investor_type: 'seed_fund', deck_version: null, start_from: 'live', based_on_version: null, check_against: null, revision: 1 },
  sections: { state: 'ok', items: SECTIONS.map((s, i) => ({
    key: s.key, label: s.label, store: s.store, deck_key: null, position: i, audience_note: null, source: null, updated_at: null,
    body: { problem: 'Finance teams close by hand.', traction: 'We serve 42 paying customers.' }[s.key] ?? null,
  })) },
  positioning: { state: 'ok', core: [], overrides: [], effective: [] },
  bindings: { state: 'ok', items: [] },
};
const OPTIONS = { versions: [{ value: '4', label: 'v4 · seed fund' }, { value: '3', label: 'v3 · angel' }] };
const MODULE = (claims) => ({ module: { slug: 'investor-narrative', name: 'Investor narrative', records_title: 'Versions' }, card: { state: 'empty', reason: 'x' },
  records: { cols: [], rows: [], total: 0, page: 1, page_size: 25 }, parts: { narrative: PART(claims) } });

async function railDots(url, module) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  globalThis.fetch = async (u) => {
    const s = String(u);
    if (s.includes('/form-options')) return response(OPTIONS);
    if (/\/cycles\/raise\/narrative\/\d+\?/.test(s)) return response(NARRATIVE);
    if (s.includes('/decks/sources')) return response({ project_id: 3, coverage: {}, items: [] });
    if (s.includes('/cycles/raise/modules/')) return module;
    return response({});
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
      h(Route, { path: '/raise/:slug', element: h(CycleRoute, { cycle: 'raise' }) }),
      h(Route, { path: '/raise/:slug/:id', element: h(CycleRoute, { cycle: 'raise', record: true }) }),
    ))));
    await act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)); });
    const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
    const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
    const ids = walk(container).map((n) => props(n)['data-testid']).filter(Boolean);
    const rail = ids.filter((id) => id.startsWith('story-rail-') || id.startsWith('section-dot-'));
    // Each rail row is its key, then its dot.
    const out = {};
    rail.forEach((id, i) => { if (id.startsWith('story-rail-') && rail[i + 1]?.startsWith('section-dot-')) out[id.slice('story-rail-'.length)] = rail[i + 1].slice('section-dot-'.length); });
    return out;
  } finally {
    await act(async () => root.unmount()); Object.assign(globalThis, previous); restore();
  }
}

test('D6068: Story draws the Mismatch dot on the section the claim store names, for the newest version only', async () => {
  const dots = await railDots('/raise/investor-narrative/story?project_id=3&version=4', response(MODULE(tally())));
  assert.equal(dots.traction, 'Mismatch');
  assert.equal(dots.problem, 'Written');
  assert.equal(dots.solution, 'Empty');
  // An older version, or a module read that failed, draws no Mismatch.
  assert.equal((await railDots('/raise/investor-narrative/story?project_id=3&version=3', response(MODULE(tally())))).traction, 'Written');
  assert.equal((await railDots('/raise/investor-narrative/story?project_id=3&version=4', response({ detail: 'x' }, 500))).traction, 'Written');
});
