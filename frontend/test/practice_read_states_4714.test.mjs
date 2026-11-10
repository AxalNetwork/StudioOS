/**
 * #4714 (D4714) part 1 — Practice says what it read, and only that.
 *
 *   · Opportunities dates a row "Decided" only from advisor_decided_at, else
 *     "Last changed" from updated_at; the median decision is computed from
 *     recorded decision times and says how many answers it covers;
 *   · Earnings: a payout account, payout history or period note that could
 *     not be read says so, offers Try again, and offers no action over it;
 *   · Delivery: an engagements read that failed is said beside the picker;
 *   · the slot counts never call an hour with no recorded price free.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/practice_read_states_4714.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { decisionMoment, medianDecision, spanText } from '../src/pages/advisor/practice/opportunityLog.js';
import OpportunitiesZone from '../src/pages/advisor/practice/OpportunitiesZone.jsx';
import EarningsZone from '../src/pages/advisor/practice/EarningsZone.jsx';
import DeliveryZone from '../src/pages/advisor/practice/DeliveryZone.jsx';

const h = React.createElement;
const json = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const fail = () => json({ detail: 'synthetic read failure' }, 500);

test('decisionMoment: "decided" only from the decision time; else the last change', () => {
  assert.deepEqual(decisionMoment({ advisor_decided_at: '2026-10-02T10:00:00Z', updated_at: '2026-10-09T10:00:00Z' }),
    { kind: 'decided', at: '2026-10-02T10:00:00Z' }, 'a later billing edit does not move the decision');
  assert.deepEqual(decisionMoment({ updated_at: '2026-10-09T10:00:00Z' }), { kind: 'changed', at: '2026-10-09T10:00:00Z' });
  assert.equal(decisionMoment({}), null);
});

test('medianDecision: over the answers with a recorded time, saying how many', () => {
  const at = (h) => new Date(Date.UTC(2026, 9, 1, h)).toISOString();
  const rows = [
    { advisor_decision: 'accepted', created_at: at(0), advisor_decided_at: at(1) },
    { advisor_decision: 'declined', created_at: at(0), advisor_decided_at: at(3) },
    { advisor_decision: 'accepted', created_at: at(0), advisor_decided_at: at(5) },
    { advisor_decision: 'accepted', created_at: at(0), advisor_decided_at: null },
    { advisor_decision: null, created_at: at(0), updated_at: at(9) },
  ];
  assert.deepEqual(medianDecision(rows), { ms: 3 * 3600e3, counted: 3, answered: 4 });
  assert.deepEqual(medianDecision([{ advisor_decision: 'accepted', created_at: at(0) }]), { ms: null, counted: 0, answered: 1 });
  assert.deepEqual(medianDecision([]), { ms: null, counted: 0, answered: 0 });
  assert.equal(medianDecision(rows.slice(0, 2)).ms, 2 * 3600e3, 'even count: the mean of the middle two');
  assert.deepEqual([spanText(30 * 60e3), spanText(3 * 3600e3), spanText(72 * 3600e3), spanText(null)], ['30 min', '3 h', '3 d', null]);
});

async function mount(Component, handle) {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify({ id: 90, role: 'advisor', name: 'Ada' }));
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const seen = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u), 'http://x');
    const call = { method: (init.method || 'GET').toUpperCase(), path: url.pathname };
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
  const byTestId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  const buttonWith = (re) => walk(document.body).find((n) => n.tagName === 'BUTTON' && re.test(textOf(n).trim()));
  return {
    seen, settle, text: () => textOf(document.body), byTestId, buttonWith, textOf,
    async press(re) { const b = buttonWith(re); assert.ok(b, `no button ${re}`); await act(async () => { props(b).onClick({ preventDefault() {} }); }); await settle(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

test('mounted Opportunities: "Decided" from the decision time, "Last changed" otherwise; the median says what it covers', async () => {
  const past = (d) => new Date(Date.now() - d * 86400e3).toISOString();
  const bookings = [
    { id: 1, status: 'confirmed', client_name: 'Decided Client', created_at: '2026-10-01T09:00:00Z', advisor_decision: 'accepted', advisor_decided_at: '2026-10-01T11:00:00Z', updated_at: '2026-10-20T09:00:00Z', slot_starts_at: past(3) },
    { id: 2, status: 'confirmed', client_name: 'Legacy Client', created_at: '2026-09-01T09:00:00Z', advisor_decision: 'accepted', advisor_decided_at: null, updated_at: '2026-09-05T09:00:00Z', slot_starts_at: past(30) },
  ];
  const m = await mount(OpportunitiesZone, async (c) => {
    if (c.path === '/api/advisors/me/bookings') return json({ items: bookings });
    if (c.path === '/api/advisors/me/services') return json({ items: [] });
    return json({});
  });
  try {
    const decided = m.textOf(m.byTestId('when-1'));
    const legacy = m.textOf(m.byTestId('when-2'));
    assert.match(decided, /^Decided /, 'row 1 is dated by its decision');
    assert.doesNotMatch(decided, /20/, 'not by its later billing edit');
    assert.match(legacy, /^Last changed /, 'row 2 has no decision time, so it is dated as a change');
    assert.match(m.text(), /Median decision2 h/, 'the median of the one recorded answer');
    assert.match(m.text(), /Over 1 of 2 answers with a recorded time/);
  } finally { await m.close(); }
});

const earningsWorld = (broken) => {
  const state = { broken: new Set(broken) };
  const handle = async (c) => {
    const key = c.path === '/api/advisors/me/payout-account' ? 'account'
      : c.path === '/api/advisors/me/payouts' ? 'payouts'
        : c.path.startsWith('/api/advisors/me/period-notes/') && c.method === 'GET' ? 'note' : null;
    if (key && state.broken.has(key)) return fail();
    if (c.path === '/api/advisors/me/ledger') return json({ currency: 'USD', clients: [], totals: { gross_cents: 0, cut_cents: 0, net_cents: 0, sessions: 0, priced_sessions: 0, unpriced_sessions: 0 }, states: { collected: { net_cents: 0, sessions: 0 }, billed: { gross_cents: 0, sessions: 0 }, written_off: { gross_cents: 0, sessions: 0 }, refunds_owed: { amount_cents: 0 }, refunded: { amount_cents: 0 }, paid_out_cents: 0, void_sessions: 0 }, recorded_payouts: { available: true, paid_cents: 0, payouts: 0 }, concentration: null, take_rate: { bps: 1500, source: 'setting', updated_at: null }, equity_clients: 0, settlement: 'none', lines: { read: true, listed: 0, total: 0, complete: true, unfrozen: 0, items: [], other: null } });
    if (c.path === '/api/advisors/me/earnings') return json({ currency: 'USD', billed_cents: 0, collected_cents: 0, outstanding_cents: 0, written_off_cents: 0, unpriced_count: 0, by_state: [], settlement: 'none', take_rate: { bps: 1500 } });
    if (key === 'account') return json({ state: 'pending', settlement: 'none' });
    if (key === 'payouts') return json({ items: [] });
    if (key === 'note') return json({ note: { body: 'A filed note.', source: 'advisor' } });
    return json({});
  };
  return { state, handle };
};

test('mounted Earnings: an unread account, history or note says so and offers nothing over it; Try again reads again', async () => {
  const w = earningsWorld(['account', 'payouts', 'note']);
  const m = await mount(EarningsZone, w.handle);
  try {
    assert.ok(m.byTestId('payout-unreadable'), 'the account says it could not be read');
    // #4834 (D4834): no state pill is drawn as the reader's over an unread account.
    assert.equal(m.byTestId('payout-state'), undefined, 'no payout state is claimed as yours');
    assert.equal(m.byTestId('button-connect-payout'), undefined, 'no Connect over an account it never read');
    assert.ok(m.byTestId('payouts-unreadable'));
    assert.match(m.text(), /Payout information could not be read\./);
    assert.doesNotMatch(m.text(), /No payouts recorded/, 'an unread history is not "none"');
    assert.ok(m.byTestId('note-unreadable'));
    assert.equal(m.byTestId('input-period-note'), undefined, 'nothing to type over a note it never read');
    assert.equal(m.buttonWith(/^Save note$/), undefined, 'and nothing to file over it');
    assert.equal(m.buttonWith(/^Draft it$/), undefined);

    w.state.broken.clear();
    await m.press(/^Try again$/);
    assert.equal(m.byTestId('payout-unreadable'), undefined);
    assert.equal(m.byTestId('payouts-unreadable'), undefined);
    assert.equal(m.byTestId('note-unreadable'), undefined);
    assert.ok(m.byTestId('payout-state'));
    assert.ok(m.byTestId('button-connect-payout'));
    assert.match(m.text(), /No payouts recorded/);
    assert.match(m.text(), /A filed note\./, 'the note it can now read is the one on file');
  } finally { await m.close(); }
});

test('mounted Earnings: one failed source leaves the others drawn', async () => {
  const m = await mount(EarningsZone, earningsWorld(['payouts']).handle);
  try {
    assert.ok(m.byTestId('payouts-unreadable'));
    assert.equal(m.byTestId('payout-unreadable'), undefined);
    assert.ok(m.byTestId('button-connect-payout'));
    assert.match(m.text(), /A filed note\./);
  } finally { await m.close(); }
});

test('mounted Delivery: an engagements read that failed is said beside the picker, not offered as "none"', async () => {
  let broken = true;
  const m = await mount(DeliveryZone, async (c) => {
    if (c.path === '/api/advisors/me/deliverables') return json({ items: [], totals: {} });
    if (c.path === '/api/advisors/me/engagements') return broken ? fail() : json({ items: [{ id: 5, client_name: 'Linked Co', founder_user_id: 7 }] });
    if (c.path === '/api/advisors/me/bookings') return json({ items: [] });
    return json({});
  });
  try {
    await m.press(/^Record a work product$/);
    assert.ok(m.byTestId('delivery-engagements-unreadable'));
    broken = false;
    await m.press(/^Try again$/);
    assert.equal(m.byTestId('delivery-engagements-unreadable'), undefined);
    assert.match(m.text(), /Linked Co/);
  } finally { await m.close(); }
});

test('mounted Engagements: unread bookings do not read as "nobody has booked you"', async () => {
  const { default: EngagementsZone } = await import('../src/pages/advisor/practice/EngagementsZone.jsx');
  let broken = true;
  const m = await mount(EngagementsZone, async (c) => {
    if (c.path === '/api/advisors/me/engagements') return json({ items: [{ id: 3, client_name: 'Unlinked Co', lane: 'signed', founder_user_id: null, status: 'active' }], totals: { active: 1 } });
    if (c.path === '/api/advisors/me/bookings') return broken ? fail() : json({ items: [] });
    return json({});
  });
  try {
    assert.match(m.text(), /Your bookings could not be read/);
    assert.doesNotMatch(m.text(), /Nobody has booked you yet/);
  } finally { await m.close(); }
  broken = false;
  const n = await mount(EngagementsZone, async (c) => {
    if (c.path === '/api/advisors/me/engagements') return json({ items: [{ id: 3, client_name: 'Unlinked Co', lane: 'signed', founder_user_id: null, status: 'active' }], totals: { active: 1 } });
    if (c.path === '/api/advisors/me/bookings') return json({ items: [] });
    return json({});
  });
  try { assert.match(n.text(), /Nobody has booked you yet/, 'a read that answered with none still says none'); } finally { await n.close(); }
});
