/**
 * #4715 item 8 — the Practice sequences that run on the page:
 *
 *   5. period switch before the response returns: Earnings opens on this
 *      quarter, the reader switches to last quarter while this quarter's reads
 *      are still in flight, and the late answers for the old period must not
 *      land on the new one;
 *   6. empty account → first engagement: the empty state, then the first
 *      engagement added from it, on the board.
 *
 * (1–4 and 7 run through the Worker in cloudflare-worker/test/practice_sequences_4715.test.ts.)
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/practice_sequences_4715.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { periodWindow } from '../src/pages/advisor/practice/earningsLedger.js';

const h = React.createElement;
const json = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

async function mount(Component, handle) {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify({ id: 90, role: 'advisor', name: 'Ada' }));
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia, confirm: globalThis.window?.confirm };
  const seen = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u), 'http://x');
    const call = { method: (init.method || 'GET').toUpperCase(), path: url.pathname, query: url.search, body: init.body ? JSON.parse(init.body) : null };
    seen.push(call);
    return handle(call);
  };
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => root.render(h(MemoryRouter, null, h(Component))));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const button = (label) => walk(document.body).find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === label);
  return {
    seen, settle, text: () => textOf(document.body),
    async press(label) { const b = button(label); assert.ok(b, `no button ${label}`); assert.ok(!props(b).disabled, `${label} is enabled`); await act(async () => { props(b).onClick({ preventDefault() {} }); }); await settle(); },
    async typeInto(placeholder, value) { const n = walk(document.body).find((x) => props(x)?.placeholder === placeholder); assert.ok(n, `no input ${placeholder}`); await act(async () => { props(n).onChange({ target: { value } }); }); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, { fetch: previous.fetch, matchMedia: previous.matchMedia }); restore(); },
  };
}

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

test('5. period switch before the response returns: the old period’s late answers do not land on the new one', async () => {
  const { default: EarningsZone } = await import('../src/pages/advisor/practice/EarningsZone.jsx');
  const now = new Date();
  // #4834 (D4834): Practice v2 opens on this month; the switch is to last month.
  const thisQ = periodWindow('this_month', now);
  const lastQ = periodWindow('last_month', now);
  const held = { [thisQ.key]: deferred() };
  const note = (key, body) => ({ note: { body, source: 'advisor', period_key: key, updated_at: '2026-10-01T00:00:00Z' } });
  const m = await mount(EarningsZone, async (c) => {
    if (c.path === '/api/advisors/me/earnings') return json({ billed_cents: 0, collected_cents: 0, written_off_cents: 0, unpriced_count: 0 });
    if (c.path === '/api/advisors/me/payout-account') return json({ state: 'none' });
    if (c.path === '/api/advisors/me/payouts') return json({ items: [] });
    if (c.path.startsWith('/api/advisors/me/period-notes/')) {
      const key = decodeURIComponent(c.path.split('/').pop());
      if (held[key]) { await held[key].promise; return json(note(key, `Synthetic note for ${key}`)); }
      return json(note(key, `Synthetic note for ${key}`));
    }
    if (c.path === '/api/advisors/me/ledger') return json({ items: [], totals: {} });
    return json({});
  });
  try {
    // This month's note is still in flight; the reader moves to last month.
    await m.press('Last month');
    assert.match(m.text(), new RegExp(`Synthetic note for ${lastQ.key}`));
    // Now the old period's answer arrives.
    held[thisQ.key].resolve();
    await m.settle();
    assert.match(m.text(), new RegExp(`Synthetic note for ${lastQ.key}`), 'the period on screen keeps its own note');
    assert.doesNotMatch(m.text(), new RegExp(`Synthetic note for ${thisQ.key}`), 'the late answer for the old period is dropped');
  } finally { await m.close(); }
});

test('6. empty account → first engagement: the empty state, then the first card, from one press', async () => {
  const { default: EngagementsZone } = await import('../src/pages/advisor/practice/EngagementsZone.jsx');
  const items = [];
  const m = await mount(EngagementsZone, async (c) => {
    if (c.path === '/api/advisors/me/engagements' && c.method === 'POST') {
      const row = { id: 1, client_name: c.body.client_name, shape: c.body.shape, lane: 'drafting', cycles: 0, outcome: null, founder_user_id: null, updated_at: '2026-10-01T00:00:00Z' };
      items.push(row);
      return json(row, 201);
    }
    if (c.path === '/api/advisors/me/engagements') return json({ items, totals: { active: 0, decided: 0 }, page: { offset: 0, limit: 400, total: items.length, next_offset: null } });
    if (c.path === '/api/advisors/me/bookings') return json({ items: [], page: { offset: 0, limit: 200, total: 0, next_offset: null } });
    return json({});
  });
  try {
    assert.match(m.text(), /No engagement is on file/);
    await m.press('Record an engagement'); // the empty state's own button (D4687)
    await m.typeInto('Meridian Labs', 'First Synthetic Co');
    await m.press('Add to Drafting');
    const post = m.seen.find((c) => c.method === 'POST');
    assert.equal(post.body.client_name, 'First Synthetic Co');
    assert.doesNotMatch(m.text(), /No engagement is on file/, 'the empty state leaves once the first one exists');
    assert.match(m.text(), /First Synthetic Co/);
  } finally { await m.close(); }
});
