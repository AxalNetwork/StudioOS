// D1607 (#3731, #2409 part 5) — PostHog on Raise's Fundraising readiness,
// Investor narrative and Pitch deck: each draws its tracked metrics with Sync
// from PostHog; no other Raise module draws a PostHog part. The API is
// injected; every value is invented.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/raise_posthog_d1607.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import RaisePosthog, { RAISE_POSTHOG_MODULES } from '../src/pages/cycles/RaisePosthog.jsx';

const h = React.createElement;
const READ = { ok: true, link: { linked: true, active: true, mine: true, uid: 'int-fixture' }, tracked: [{ uid: 'a'.repeat(32), name: 'Weekly active users', role_words: 'Active users', unit: 'count', value: 1240, as_of: '2026-10-30' }], facts: [], proposals: [] };

async function mounted(el) {
  const restore = installDocument();
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  document.getElementById = () => null;
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, el)));
  await act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => nodes().find((n) => pr(n)['data-testid'] === id);
  return { by, pr, async click(id) { await act(async () => pr(by(id)).onClick?.()); await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }, async close() { await act(async () => root.unmount()); restore(); } };
}

const api = () => { const calls = []; return { calls, fromPosthog: async (...a) => { calls.push(['from', ...a]); return READ; }, sync: async (...a) => { calls.push(['sync', ...a]); return {}; } }; };

test('each of the three Raise modules reads its own PostHog module and syncs Raise', async () => {
  assert.deepEqual(RAISE_POSTHOG_MODULES, { 'fundraising-readiness': 'fundraising_readiness', 'investor-narrative': 'investor_narrative', 'pitch-deck': 'pitch_deck' });
  for (const [slug, module] of Object.entries(RAISE_POSTHOG_MODULES)) {
    const a = api();
    const ui = await mounted(h(RaisePosthog, { slug, projectId: 1, api: a }));
    try {
      assert.ok(ui.by('cycle-part-posthog'), slug);
      assert.deepEqual(a.calls[0], ['from', 'raise', 1, module]);
      await ui.click('posthog-sync');
      assert.deepEqual(a.calls.at(-2), ['sync', 'raise', 1]);
    } finally { await ui.close(); }
  }
});

test('another Raise module draws nothing and reads nothing', async () => {
  const a = api();
  const ui = await mounted(h(RaisePosthog, { slug: 'cap-table', projectId: 1, api: a }));
  try {
    assert.equal(ui.by('cycle-part-posthog'), undefined);
    assert.deepEqual(a.calls, []);
  } finally { await ui.close(); }
});

test('wiring: Readiness and Narrative draw it beside From Mercury; every other Raise module passes through the same line', () => {
  const route = readFileSync(new URL('../src/pages/cycles/CycleRoute.jsx', import.meta.url), 'utf8');
  for (const slug of ['fundraising-readiness', 'investor-narrative']) assert.ok(route.includes(`<RaisePosthog slug="${slug}" projectId={ctx.projectId} />`), slug);
  assert.ok(route.includes('<RaisePosthog slug={m.slug} projectId={ctx.projectId} />'));
});
