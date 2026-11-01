// D1565 (#3812, PD-8 · pd35) — "Share, one link per investor": the table in
// ShareDialog, read through the adapter, its words, Withdraw behind its
// confirm, a failed read with Try again, and the watermark preview.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_investor_links_d1565.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import InvestorLinksTable, { capWords, expiryWords, ndaWords, versionWords, viewsWords } from '../src/pages/raise/pitch/InvestorLinksTable.jsx';
import ShareDialog from '../src/pages/raise/pitch/ShareDialog.jsx';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const DECK = { id: 6, version: 3, created_at: '2026-10-21 09:00:00' };
const ROW = (over = {}) => ({
  id: 11, investor: { label: '[Pat Partner]', fund: '[Fund A]', prospect_id: 7 }, version: { variant: null },
  nda: { state: 'accepted', accepted_at: '2026-10-30 10:00:00' }, expires_at: '2026-11-14 09:00:00', view_cap: { limit: 5, used: 2 },
  watermark: 'Prepared for [Pat Partner] · [Fund A]', status: 'live', withdrawn_at: null, analytics: { views: 2, last_viewed_at: '2026-10-31 08:00:00', read_seconds: 120 }, ...over,
});

async function mount(element, handle) {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify({ id: 1, role: 'founder', name: '[Fay Founder]' }));
  const previous = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (u, init = {}) => {
    const key = `${(init.method || 'GET').toUpperCase()} ${new URL(String(u), 'http://x').pathname}`;
    seen.push(key);
    return (handle[key] || (() => response({ ok: true })))(init);
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => root.render(element));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  return {
    seen, text: () => textOf(document.body), has: (id) => Boolean(byId(id)),
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick(); }); await settle(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = previous; restore(); },
  };
}

test('pd35\'s words: NDA accepted with its date or not yet, No cap, Never, the variant, the views', () => {
  assert.equal(ndaWords({ state: 'accepted', accepted_at: '2026-10-30 10:00:00' }), 'Accepted 2026-10-30');
  assert.equal(ndaWords({ state: 'not_accepted' }), 'Not accepted yet');
  assert.equal(ndaWords({ state: 'not_required' }), 'Not required');
  assert.equal(capWords({ limit: null, used: 3 }), 'No cap', 'no limit is "No cap", never 0');
  assert.equal(capWords({ limit: 5, used: 2 }), '2 of 5');
  assert.equal(expiryWords({ expires_at: null }), 'Never');
  assert.equal(versionWords({ version: { variant: { name: '[For Fund A]' } } }, DECK), 'v3 · [For Fund A]');
  assert.equal(versionWords({ version: { variant: null } }, DECK), 'v3');
  assert.equal(viewsWords({ views: 1, last_viewed_at: null }), '1 view');
});

test('the table reads the version\'s links; Withdraw asks first and keeps the row', async () => {
  let withdrawn = false;
  const handle = {
    'GET /api/decks/6/investor-links': () => response({ deck_id: 6, version: 3, links: [ROW({ status: withdrawn ? 'withdrawn' : 'live' })] }),
    'POST /api/decks/6/investor-links/11/withdraw': () => { withdrawn = true; return response({ ok: true, link: ROW({ status: 'withdrawn' }) }); },
  };
  const v = await mount(h(InvestorLinksTable, { deck: DECK }), handle);
  try {
    const text = v.text();
    for (const words of ['[Pat Partner]', '[Fund A]', 'Prepared for [Pat Partner] · [Fund A]', 'v3', 'Accepted 2026-10-30', 'Until 2026-11-14', '2 of 5', '2 views']) {
      assert.ok(text.includes(words), words);
    }
    await v.click('investor-link-withdraw-11');
    assert.ok(v.has('investor-link-withdraw-confirm'));
    assert.match(v.text(), /Withdraw this link\?/);
    assert.match(v.text(), /Analytics so far are kept\./);
    assert.ok(!v.seen.includes('POST /api/decks/6/investor-links/11/withdraw'), 'nothing is withdrawn before the confirm');
    await v.click('investor-link-withdraw-yes');
    assert.ok(v.seen.includes('POST /api/decks/6/investor-links/11/withdraw'));
    assert.match(v.text(), /Withdrawn/);
    assert.ok(v.text().includes('2 views'), 'the analytics stay');
  } finally { await v.close(); }
});

test('pd9c: a failed read says "Views on your links could not be read." with Try again, never "none"', async () => {
  let calls = 0;
  const v = await mount(h(InvestorLinksTable, { deck: DECK }), {
    'GET /api/decks/6/investor-links': () => { calls += 1; return calls === 1 ? response({ error: 'boom' }, 500) : response({ links: [] }); },
  });
  try {
    assert.match(v.text(), /Views on your links could not be read\./);
    assert.doesNotMatch(v.text(), /No investor has a link/);
    await v.click('investor-links-retry');
    assert.equal(calls, 2);
    assert.match(v.text(), /No investor has a link to this version yet\./);
  } finally { await v.close(); }
});

test('ShareDialog draws the table above the new link, and the new link previews its watermark', async () => {
  const v = await mount(h(ShareDialog, { projectId: 5, deck: DECK, onClose() {} }), {
    'GET /api/decks/6/investor-links': () => response({ links: [ROW()] }),
    'GET /api/cycles/raise/modules/pitch-deck/form-options': () => response({ prospects: [{ value: 7, label: '[Pat Partner]' }] }),
  });
  try {
    assert.ok(v.has('investor-links'));
    assert.ok(v.has('investor-link-11'));
    assert.match(v.text(), /Watermark: Prepared for \[Pat Partner\]/);
  } finally { await v.close(); }
});
