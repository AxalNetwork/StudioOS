/**
 * #4713 (D4713, Practice audit 4/6): Earnings and availability cannot be
 * corrupted by stale asynchronous responses, and priced work is never labelled
 * as money received. Every record below is made up.
 *
 *   · the period gate lets only the latest period's request commit;
 *   · the received figure is the collected net, an absence when unread;
 *   · a note is dirty only when it differs from the filed one;
 *   · mounted Earnings: responses arriving in reverse order leave figures and
 *     labels aligned, the old note goes at once on a period change, a save
 *     targets the period of the note on screen, and a dirty note is resolved
 *     before the period changes;
 *   · Sessions: no rules editor before a successful read, and a save names the
 *     revision it read.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/practice_financial_4713.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { createPeriodGate, noteIsDirty, periodWindow, receivedCents } from '../src/pages/advisor/practice/earningsLedger.js';
import EarningsZone from '../src/pages/advisor/practice/EarningsZone.jsx';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('the period gate: only the latest period request may commit', () => {
  // Mutation checked: isCurrent always true → the stale token commits.
  const g = createPeriodGate();
  const q4 = g.begin('2026-Q4');
  assert.equal(g.isCurrent(q4), true);
  const q3 = g.begin('2026-Q3');
  assert.equal(g.isCurrent(q4), false, 'the period the reader left');
  assert.equal(g.isCurrent(q3), true);
  assert.equal(g.key, '2026-Q3');
  const again = g.begin('2026-Q3');
  assert.equal(g.isCurrent(q3), false, 'a reload of the same period supersedes the first');
  assert.equal(g.isCurrent(again), true);
  assert.equal(g.isCurrent(null), false);
});

test('received is the collected net; absent is an absence, never 0', () => {
  assert.equal(receivedCents({ collected: { net_cents: 8500 } }), 8500);
  assert.equal(receivedCents({ collected: { net_cents: 0 } }), 0, 'a real zero is a zero');
  assert.equal(receivedCents(undefined), null);
  assert.equal(receivedCents({}), null);
  assert.equal(receivedCents({ collected: {} }), null);
});

test('a note is dirty only when its text differs from the filed one', () => {
  assert.equal(noteIsDirty(null, ''), false);
  assert.equal(noteIsDirty(null, '   '), false);
  assert.equal(noteIsDirty(null, 'A new read'), true);
  assert.equal(noteIsDirty({ body: 'Filed' }, 'Filed'), false);
  assert.equal(noteIsDirty({ body: 'Filed' }, ' Filed '), false);
  assert.equal(noteIsDirty({ body: 'Filed' }, 'Filed, then edited'), true);
});

// ---------------------------------------------------------------- mounted

const json = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const ledgerBody = (gross, collectedNet) => ({
  currency: 'USD', clients: [{ client_user_id: 1, client_name: 'Meridian Labs', sessions: 1, gross_cents: gross, cut_cents: 0, net_cents: gross, unpriced_sessions: 0, retainer_cents: null, engagement_shape: null }],
  totals: { gross_cents: gross, cut_cents: 0, net_cents: gross, sessions: 1, priced_sessions: 1, unpriced_sessions: 0 },
  figures: { priced: { net_cents: gross, sessions: 1 }, billed: { net_cents: gross, sessions: 1 }, collected: { net_cents: collectedNet, sessions: collectedNet ? 1 : 0 }, written_off: { net_cents: 0, sessions: 0 }, outstanding: { net_cents: gross - collectedNet, sessions: 1 } },
  recorded_payouts: { available: true, paid_cents: 0, payouts: 0 },
  concentration: { client_name: 'Meridian Labs', pct: 100 }, take_rate: { bps: 1500, source: 'setting', updated_at: null }, equity_clients: 0, settlement: 'none',
});

async function mount(handle) {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify({ id: 90, role: 'advisor', name: 'Ada' }));
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia, confirm: globalThis.confirm };
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
  await act(async () => root.render(h(MemoryRouter, null, h(EarningsZone))));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  const buttonWith = (re) => walk(document.body).find((n) => typeof props(n)?.onClick === 'function' && re.test(textOf(n)));
  return {
    seen, settle, text: () => textOf(document.body), byTestId, props, buttonWith, set: (g) => { globalThis.confirm = g; },
    async press(re) { const b = buttonWith(re); assert.ok(b, `no button ${re}`); await act(async () => { props(b).onClick({ preventDefault() {} }); }); await settle(); },
    async type(id, value) { const n = byTestId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange({ target: { value } }); }); await settle(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

function world() {
  const q4 = periodWindow('this_quarter', new Date());
  const q3 = periodWindow('last_quarter', new Date());
  const pending = {};
  const defer = (key) => new Promise((resolve) => { pending[key] = resolve; });
  const handle = async (c) => {
    if (c.path === '/api/advisors/me/ledger') {
      const which = c.query.includes(encodeURIComponent(q3.from)) || c.query.includes(q3.from) ? 'q3' : 'q4';
      return defer(`ledger:${which}`);
    }
    if (c.path.startsWith('/api/advisors/me/period-notes/')) {
      const key = decodeURIComponent(c.path.split('/').pop());
      if (c.method === 'GET') return defer(`note:${key}`);
      return json({ note: { body: c.body?.body, source: c.body?.source, figures: c.body?.figures } });
    }
    if (c.path === '/api/advisors/me/earnings') return json({ currency: 'USD', billed_cents: 0, collected_cents: 0, outstanding_cents: 0, written_off_cents: 0, unpriced_count: 0, by_state: [], settlement: 'none', take_rate: { bps: 1500 } });
    if (c.path === '/api/advisors/me/payout-account') return json({ state: 'pending', settlement: 'none' });
    if (c.path === '/api/advisors/me/payouts') return json({ items: [] });
    return json({});
  };
  return { q3, q4, pending, handle };
}

test('mounted Earnings: ledger responses arriving in reverse order leave figures and labels aligned; the old period\'s numbers never show under the new label', async () => {
  // Mutation checked: the gate removed from loadLedger → the late Q4 response paints under the Q3 label.
  const w = world();
  const m = await mount(w.handle);
  try {
    await m.press(new RegExp(w.q3.label));            // Q4 requests are still in flight
    w.pending['ledger:q3'](json(ledgerBody(30_000, 10_000)));   // Q3 answers first
    await m.settle();
    assert.match(m.text(), /Meridian Labs/);
    assert.match(m.text(), new RegExp(`${w.q3.label} priced`));
    assert.match(m.text(), /\$300/, 'Q3 figures');
    w.pending['ledger:q4'](json(ledgerBody(99_000, 99_000)));   // the Q4 answer lands late
    await m.settle();
    assert.doesNotMatch(m.text(), /\$990/, 'the stale period is dropped');
    assert.match(m.text(), /\$300/);
    assert.match(m.text(), /Recorded as received/);
    assert.doesNotMatch(m.text(), /You received/, 'priced work is not "received"');
  } finally { await m.close(); }
});

test('mounted Earnings: switching periods clears the old note at once; a save names the period of the note on screen', async () => {
  // Mutation checked: Accept keyed by the chip rather than the shown note's period → the PUT goes to the wrong key.
  const w = world();
  const m = await mount(w.handle);
  try {
    w.pending['ledger:q4'](json(ledgerBody(50_000, 0)));
    w.pending[`note:${w.q4.key}`](json({ note: { body: 'Q4 narrative', source: 'advisor', figures: null } }));
    await m.settle();
    assert.ok(m.text().includes('Q4 narrative'), 'the Q4 note is shown');
    await m.press(new RegExp(w.q3.label));
    assert.ok(!m.text().includes('Q4 narrative'), 'the old note is gone while the new period loads');
    const accept = m.buttonWith(/^Accept$/);
    assert.ok(!accept || m.props(accept).disabled, 'no Accept while the new period\'s note is unread');
    w.pending['ledger:q3'](json(ledgerBody(30_000, 0)));
    await m.settle();
    // Even a handler that fires anyway (a race the disabled attribute cannot stop) files nothing
    // for a period whose note has not been read.
    await m.type('input-aiband-d4', 'typed while Q3 loads');
    const fire = m.buttonWith(/^Accept$/);
    if (fire) await act(async () => { await m.props(fire).onClick({ preventDefault() {} }); });
    await m.settle();
    assert.equal(m.seen.some((c) => c.method === 'PUT'), false, 'nothing is filed before the shown period\'s note is read');
    w.pending[`note:${w.q3.key}`](json({ note: null }));
    await m.settle();
    await m.type('input-aiband-d4', 'A Q3 read');
    await m.press(/^Accept$/);
    const put = m.seen.find((c) => c.method === 'PUT' && c.path.includes('/period-notes/'));
    assert.ok(put, 'the note was saved');
    assert.equal(decodeURIComponent(put.path.split('/').pop()), w.q3.key, 'filed against the period it was written for');
    assert.equal(m.seen.filter((c) => c.method === 'PUT').length, 1);
    assert.equal(m.seen.some((c) => c.method === 'DELETE'), false);
  } finally { await m.close(); }
});

test('mounted Earnings: a dirty note must be resolved before the period changes', async () => {
  // Mutation checked: changeView ignoring `dirty` → the period switches and the typed note is lost.
  const w = world();
  const m = await mount(w.handle);
  try {
    w.pending['ledger:q4'](json(ledgerBody(50_000, 0)));
    w.pending[`note:${w.q4.key}`](json({ note: null }));
    await m.settle();
    await m.type('input-aiband-d4', 'Unfiled thoughts on Q4');
    let asked = 0;
    m.set(() => { asked += 1; return false; });
    await m.press(new RegExp(w.q3.label));
    assert.equal(asked, 1, 'asked before switching');
    assert.equal(m.seen.filter((c) => c.path === '/api/advisors/me/ledger').length, 1, 'declined: the period did not change, no Q3 read');
    assert.equal(m.byTestId('input-aiband-d4') ? m.props(m.byTestId('input-aiband-d4')).value : null, 'Unfiled thoughts on Q4', 'the draft is still there');
    m.set(() => true);
    await m.press(new RegExp(w.q3.label));
    assert.equal(m.seen.filter((c) => c.path === '/api/advisors/me/ledger').length, 2, 'confirmed: the period changed');
  } finally { await m.close(); }
});

test('Sessions: no rules editor before a successful read, and a save names the revision it read', () => {
  // Mutation checked: rulesRead seeded true → the editor shows while the read is in flight.
  const src = read('pages/advisor/practice/SessionsZone.jsx');
  assert.match(src, /useState\('loading'\)/, 'the rules start unread');
  assert.match(src, /setRulesRead\(r != null \? 'read' : 'unreadable'\)/);
  assert.match(src, /\{loadingRules \? null : read \? \(/, 'no editor while loading or unreadable');
  assert.match(src, /expected_revision: rules\?\.revision \?\? ''/);
  assert.doesNotMatch(src, /\[rulesRead, setRulesRead\] = useState\(true\)/, 'the old always-readable seed is gone');
});
