// D6318 (#6318) — PostHog and Mercury show what the Grow sync actually returned.
//
// From frontend/test/README.md (moved by #6472): D6318: PostHog and Mercury report incomplete and
// completed syncs, including Mercury's in-place refresh.
import './_cycleSteps.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import FromPosthog from '../src/pages/cycles/FromPosthog.jsx';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { mercurySyncSentence } from '../src/pages/cycles/growFromMercury.js';

const h = React.createElement;
const founder = { id: 3, role: 'founder', name: 'Fixture founder' };
const response = (data) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => data, text: async () => JSON.stringify(data) });

async function mount(element, url = '/') {
  const restore = installDocument();
  const previous = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(founder));
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, element))); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    by, text: (id) => text(by(id)).replace(/\s+/g, ' '), role: (id) => props(by(id)).role,
    async click(id) { assert.ok(by(id), `missing ${id}`); await act(async () => { props(by(id)).onClick(); }); },
    async close() { await act(async () => root.unmount()); globalThis.matchMedia = previous; restore(); },
  };
}

test('D6318: PostHog announces partial, unread-only and completed syncs from their receipts', async () => {
  const receipts = [
    { facts: 1, updated: 2, proposals: 1, unread: ['metric:private-id'], partial: true },
    { facts: 0, updated: 0, proposals: 0, unread: ['surveys'], partial: false },
    { facts: 2, updated: 0, proposals: 0, unread: [], partial: false },
  ];
  const read = { link: { linked: true, active: true, mine: true }, tracked: [], facts: [], proposals: [] };
  const api = { fromPosthog: async () => read };
  const v = await mount(h(FromPosthog, { section: 'grow', projectId: 8, module: 'revenue_and_traction', api, onSync: async () => receipts.shift() }));
  try {
    await v.click('posthog-sync');
    assert.equal(v.role('posthog-sync-note'), 'status');
    assert.match(v.text('posthog-sync-note'), /1 new figure, 2 updated, 1 proposal to review.*could not read 1 item.*read limit or connection issue.*Sync again to carry on/);
    assert.doesNotMatch(v.text('posthog-sync-note'), /private-id/);
    await v.click('posthog-sync');
    assert.match(v.text('posthog-sync-note'), /saved no new or updated figures or proposals.*could not read 1 item.*Sync again to carry on/);
    await v.click('posthog-sync');
    assert.equal(v.text('posthog-sync-note'), 'PostHog synced 2 new figures.');
  } finally { await v.close(); }
});

test('D6318: Mercury reports its transaction limit and keeps the status through the module refresh', async (t) => {
  const counts = { metric_months: 0, facts: 2, invoice_credits: 1, partner_proposals: 0, partial: true };
  const module = { card: { name: 'Durable company-building', state: 'active' }, records: { rows: [], cols: [] },
    // D6122 part 2: the Worker's `parts.can_write` says this viewer writes Company (cash is the team's alone).
    parts: { can_write: true, from_mercury: { state: 'not_recorded', can_sync: true } } };
  const refresh = Promise.withResolvers();
  let moduleReads = 0;
  t.mock.method(globalThis, 'fetch', async (u) => {
    const path = new URL(String(u), 'http://test.invalid').pathname;
    if (path === '/api/auth/me') return response(founder);
    if (path === '/api/cycles/grow/modules/durable-company-building') {
      moduleReads += 1;
      return moduleReads === 1 ? response(module) : refresh.promise;
    }
    if (path === '/api/cycles/grow/mercury/sync') return response({ ok: true, counts });
    if (path.includes('ventures') || path.includes('projects')) return response({ items: [{ id: 8, uid: 'venture-8', name: 'Fixture Venture' }] });
    return response({});
  });
  const v = await mount(h(CycleRoute, { cycle: 'grow', slug: 'durable-company-building' }), '/grow/durable-company-building?project=8');
  try {
    await v.click('mercury-sync');
    assert.equal(moduleReads, 2);
    assert.equal(v.role('mercury-sync-note'), 'status');
    assert.match(v.text('mercury-sync-note'), /2 other figures, 1 invoice credit.*transaction read limit.*monthly transaction totals and partner payments.*Sync again to carry on/);
    await act(async () => { refresh.resolve(response(module)); });
    assert.equal(v.text('mercury-sync-note'), mercurySyncSentence(counts));
    assert.equal(mercurySyncSentence({ ...counts, partial: false }), 'Mercury synced 2 other figures, 1 invoice credit.');
  } finally { await v.close(); }
});
