/**
 * #4834 (D4834, Practice UX 6/6): Earnings to Practice v2 PX-07/PX-08/PX-10.
 * Every record below is made up.
 *
 *   · nothing is labelled "You received"; the cards say "Recorded", and
 *     "Paid out" is a card only over recorded paid payouts;
 *   · not recorded is never 0, on a card or a ledger line;
 *   · unreadable payout data says "Payout information could not be read" with
 *     Try again, never "No payouts recorded";
 *   · switching period with unsaved note text asks first (Stay · Discard ·
 *     Save note), and Save files the note against the period it was written for;
 *   · an older period's late answer never lands under the newer heading;
 *   · no advisor profile is "Earnings unavailable", with a Learn why;
 *   · the phone section row: Overview first, the canvas's order, scrolling.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/practice_earnings_4834.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { installDocument } from './_contracts_dom.mjs';
import {
  customWindow, earningsCards, noAdvisorProfile, periodWindow, pricedBasis, ratePct,
} from '../src/pages/advisor/practice/earningsLedger.js';
import EarningsZone from '../src/pages/advisor/practice/EarningsZone.jsx';
import SourceState from '../src/pages/advisor/practice/SourceState.jsx';
import ZoneNav from '../src/workspaces/ZoneNav.jsx';
import { bucketForPath } from '../src/workspaces/shellConfig.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

// ─────────────────────────────────────────────────────────────── the module

const STATES = (over = {}) => ({
  billed: { sessions: 2, gross_cents: 270_000 },
  collected: { sessions: 3, gross_cents: 570_000 },
  written_off: { sessions: 0, gross_cents: 0 },
  paid_out_cents: 0, paid_out_count: 0, ...over,
});
const TOTALS = { gross_cents: 840_000, cut_cents: 84_000, net_cents: 756_000, sessions: 13, priced_sessions: 12, unpriced_sessions: 1 };

test('the cards are recorded billed, recorded collected, outstanding and platform fees — never "received"', () => {
  // Mutation checked: a card labelled "You received" over collected.net_cents → the label check fails.
  const cards = earningsCards({ totals: TOTALS, states: STATES(), lines: { unfrozen: 0 } });
  assert.deepEqual(cards.map((c) => c.label), ['Recorded billed', 'Recorded collected', 'Outstanding', 'Platform fees']);
  for (const c of cards) assert.doesNotMatch(`${c.label} ${c.basis}`, /receiv/i);
  assert.equal(cards[0].cents, 840_000);
  assert.equal(cards[1].cents, 570_000, 'collected is what was marked collected, gross');
  assert.equal(cards[2].cents, 270_000);
  assert.equal(cards[3].cents, 84_000);
  assert.equal(cards[0].basis, 'From 12 priced sessions · 1 session has no recorded price.');
});

test('"Paid out" is a card only over recorded paid payouts; unread payouts say so, never $0', () => {
  // Mutation checked: the count gate removed → a $0 Paid out card appears over no payouts.
  const none = earningsCards({ totals: TOTALS, states: STATES() });
  assert.equal(none.some((c) => c.key === 'paid_out'), false, 'no payout recorded: no card');
  const paid = earningsCards({ totals: TOTALS, states: STATES({ paid_out_cents: 243_000, paid_out_count: 1 }) });
  const card = paid.find((c) => c.key === 'paid_out');
  assert.equal(card.cents, 243_000);
  assert.equal(card.basis, '1 payout with a paid date in this period.');
  const unread = earningsCards({ totals: TOTALS, states: STATES({ paid_out_cents: null, paid_out_count: null }) })
    .find((c) => c.key === 'paid_out');
  assert.equal(unread.unread, true);
  assert.equal(unread.cents, null);
  assert.match(unread.basis, /^Payout information could not be read\.$/);
});

test('not recorded stays absent: a missing figure is null, a missing rate is null, never 0', () => {
  // Mutation checked: `?? 0` on a card's cents → the absent figure becomes 0.
  const cards = earningsCards({ totals: { ...TOTALS, cut_cents: null }, states: STATES({ collected: {} }) });
  assert.equal(cards.find((c) => c.key === 'fees').cents, null);
  assert.equal(cards.find((c) => c.key === 'collected').cents, null);
  assert.equal(ratePct(null), null);
  assert.equal(ratePct(''), null);
  assert.equal(ratePct(1500), '15%');
  assert.equal(ratePct(1250), '12.50%');
  assert.equal(earningsCards(null).length, 0, 'no ledger: no cards, not zero cards of $0');
  assert.equal(pricedBasis({}), null);
  assert.equal(pricedBasis({ priced_sessions: 1, unpriced_sessions: 0 }), 'From 1 priced session.');
  assert.equal(pricedBasis({ priced_sessions: 3, unpriced_sessions: 2 }), 'From 3 priced sessions · 2 sessions have no recorded price.');
});

test('a record priced before rates were stamped is named on the fees card', () => {
  const fees = earningsCards({ totals: TOTALS, states: STATES(), lines: { unfrozen: 2 } }).find((c) => c.key === 'fees');
  assert.match(fees.basis, /2 records priced before rates were recorded are counted at today’s rate/);
});

test('the periods: months wrap at January, Quarter and Year are the current ones, a custom range is inclusive and has no note key', () => {
  const jan = periodWindow('last_month', new Date(2026, 0, 12));
  assert.equal(jan.key, '2025-12');
  assert.equal(jan.label, 'December 2025');
  assert.equal(jan.from, '2025-12-01T00:00:00.000Z');
  assert.equal(jan.until, '2026-01-01T00:00:00.000Z');
  assert.equal(periodWindow('this_month', new Date(2026, 10, 10)).key, '2026-11');
  assert.equal(periodWindow('quarter', new Date(2026, 10, 10)).key, '2026-Q4');
  assert.equal(periodWindow('year', new Date(2026, 10, 10)).label, '2026');
  const c = customWindow('2026-11-03', '2026-11-09');
  assert.deepEqual(c, { key: null, label: 'Nov 3 – Nov 9, 2026', from: '2026-11-03T00:00:00.000Z', until: '2026-11-10T00:00:00.000Z' });
  assert.equal(customWindow('2026-11-09', '2026-11-03'), null, 'backwards');
  assert.equal(customWindow('2026-02-30', '2026-03-01'), null, 'a day that does not exist');
  assert.equal(customWindow('', '2026-03-01'), null);
});

test('a "no advisor profile" refusal is told apart from a failed read', () => {
  assert.equal(noAdvisorProfile(new Error('No advisor profile attached to your account')), true);
  assert.equal(noAdvisorProfile(new Error('synthetic read failure')), false);
  assert.equal(noAdvisorProfile(null), false);
});

test('SourceState: the five states in PX-08’s words', () => {
  // Mutation checked: unreadable without its Try again → the retry check fails.
  const html = (el) => renderToStaticMarkup(el);
  const unread = html(h(SourceState, { kind: 'unreadable', source: 'Payout information', onRetry: () => {} }));
  assert.match(unread, /role="alert"/);
  assert.match(unread, /Payout information could not be read\./);
  assert.match(unread, />Try again</);
  assert.match(html(h(SourceState, { kind: 'loading', source: 'Sessions' })), /role="status"[^>]*aria-busy="true"|aria-busy="true"[^>]*role="status"/);
  assert.match(html(h(SourceState, { kind: 'loading', source: 'Sessions' })), /Loading sessions…/);
  assert.match(html(h(SourceState, { kind: 'not_recorded' }, 'never stored')), /Not recorded<span[^>]*> · never stored/);
  assert.match(html(h(SourceState, { kind: 'withheld' })), /Withheld · Not shared with you/);
  assert.match(html(h(SourceState, { kind: 'empty', title: 'No sessions yet.' }, 'Share your link.')), /No sessions yet\./);
});

// ─────────────────────────────────────────────────────────────── mounted

const json = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const LINE = (over) => ({
  id: 1, client_name: 'Acme', topic: 'Strategy review', status: 'completed', session_at: '2026-11-04T14:00:00.000Z',
  created_at: '2026-11-01T10:00:00.000Z', amount_cents: 25_000, billing_state: 'collected', collected_cents: 25_000,
  take_rate_bps: 1000, platform_fee_cents: 2_500, net_cents: 22_500, ...over,
});
const ledgerBody = (gross = 25_000, over = {}) => ({
  currency: 'USD', settlement: 'none', take_rate: { bps: 1000 },
  totals: { gross_cents: gross, cut_cents: gross / 10, net_cents: gross * 0.9, sessions: 2, priced_sessions: 1, unpriced_sessions: 1 },
  states: { billed: { sessions: 0, gross_cents: 0 }, collected: { sessions: 1, gross_cents: gross }, written_off: { sessions: 0, gross_cents: 0 }, paid_out_cents: 0, paid_out_count: 0 },
  lines: {
    read: true, listed: 2, total: 2, complete: true, unfrozen: 0, other: null,
    items: [LINE({ amount_cents: gross, collected_cents: gross }), LINE({ id: 2, client_name: 'Kite Labs', topic: 'Workshop', amount_cents: null, billing_state: 'unpriced', collected_cents: null, take_rate_bps: null, platform_fee_cents: null, net_cents: null })],
  },
  ...over,
});

async function mount(handle) {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify({ id: 90, role: 'advisor', name: 'Ada' }));
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
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
    seen, settle, text: () => textOf(document.body), byTestId, props, textOf, buttonWith,
    async press(re) { const b = buttonWith(re); assert.ok(b, `no button ${re}`); await act(async () => { await props(b).onClick({ preventDefault() {} }); }); await settle(); },
    async type(id, value) { const n = byTestId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange({ target: { value } }); }); await settle(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

const thisMonth = () => periodWindow('this_month', new Date());
const lastMonth = () => periodWindow('last_month', new Date());

function world({ payouts = 'ok', account = 'ok', ledger = () => ledgerBody(), notes = {} } = {}) {
  return async (c) => {
    if (c.path === '/api/advisors/me/ledger') return json(ledger(c));
    if (c.path === '/api/advisors/me/payout-account') return account === 'fail' ? json({ detail: 'x' }, 500) : json({ started: true, state: 'verified', settlement: 'none', provider: 'stripe' });
    if (c.path === '/api/advisors/me/payouts') return payouts === 'fail' ? json({ detail: 'x' }, 500) : json({ items: [] });
    if (c.path.startsWith('/api/advisors/me/period-notes/')) {
      const key = decodeURIComponent(c.path.split('/').pop());
      if (c.method === 'PUT') return json({ note: { body: c.body.body, source: c.body.source, updated_at: '2026-11-10T14:02:00Z' } });
      return json({ note: notes[key] ? { body: notes[key], source: 'advisor' } : null });
    }
    return json({});
  };
}

test('mounted: nothing is "received"; an unpriced line reads Not recorded, never $0', async () => {
  // Mutation checked: the price cell falling back to money(0) → "$0" shows on the unpriced line.
  const m = await mount(world());
  try {
    assert.doesNotMatch(m.text(), /[Yy]ou received/);
    assert.match(m.text(), /Recorded billed\$250/);
    assert.match(m.text(), /Recorded collected\$250/);
    assert.equal(m.byTestId('earnings-card-paid_out'), undefined, 'no payout recorded: no Paid out card');
    const unpriced = m.textOf(m.byTestId('ledger-line-2'));
    assert.match(unpriced, /Kite Labs/);
    assert.match(unpriced, /Not recorded/);
    assert.doesNotMatch(unpriced, /\$0/);
    const priced = m.textOf(m.byTestId('ledger-line-1'));
    assert.match(priced, /\$250.*Collected.*\$250.*10%.*\$25.*\$225/);
    // The phone form carries the same records as stacked cards.
    assert.ok(m.byTestId('ledger-record-1'));
    assert.ok(m.byTestId('ledger-record-2'));
  } finally { await m.close(); }
});

test('mounted: unreadable payout data says it could not be read, with Try again, never "No payouts recorded"', async () => {
  // Mutation checked: the unread history falling through to the empty branch → "No payouts recorded" shows.
  const m = await mount(world({ payouts: 'fail' }));
  try {
    const box = m.textOf(m.byTestId('payouts-unreadable'));
    assert.match(box, /Payout information could not be read\./);
    assert.match(box, /Try again/);
    assert.doesNotMatch(m.text(), /No payouts recorded/);
    // One failing source does not blank the page.
    assert.match(m.text(), /Recorded billed\$250/);
    assert.ok(m.byTestId('payout-state'), 'the payout setup still reads');
  } finally { await m.close(); }
  const ok = await mount(world());
  try { assert.match(ok.text(), /No payouts recorded/, 'a history that answered with none says none'); } finally { await ok.close(); }
});

test('mounted: switching period with unsaved text asks first; Save files it against its own period, then switches', async () => {
  // Mutation checked: changeView ignoring `dirty` → no dialog, the period switches and the text is lost.
  const m = await mount(world());
  try {
    await m.type('input-period-note', 'Chase Northstar on 18 Nov.');
    await m.press(/^Last month$/);
    const dlg = m.byTestId('earnings-unsaved');
    assert.ok(dlg, 'the dialog opened');
    assert.equal(m.props(dlg).role, 'dialog');
    assert.equal(m.props(dlg)['aria-modal'], 'true');
    assert.equal(m.props(dlg)['aria-label'], 'You have unsaved changes');
    assert.match(m.textOf(dlg), new RegExp(`Your note for ${thisMonth().label} hasn’t been saved\\. Switching to ${lastMonth().label} will not carry it over\\.`));
    assert.equal(m.seen.filter((c) => c.path === '/api/advisors/me/ledger').length, 1, 'nothing read for the new period yet');
    // A click on the backdrop is the same as Escape: Stay.
    await act(async () => { m.props(m.byTestId('earnings-unsaved-backdrop')).onMouseDown({ target: 1, currentTarget: 1 }); });
    await m.settle();
    assert.equal(m.byTestId('earnings-unsaved'), undefined, 'closing is Stay');
    assert.equal(m.props(m.byTestId('input-period-note')).value, 'Chase Northstar on 18 Nov.');
    await m.press(/^Last month$/);
    assert.ok(m.byTestId('earnings-unsaved'), 'asked again: the text is still unsaved');
    assert.equal(m.seen.some((c) => c.method === 'PUT'), false, 'nothing filed by asking');
  } finally { await m.close(); }
});

test('mounted: the dialog’s Save files the note for the period it was written for, then the period changes', async () => {
  const m = await mount(world());
  try {
    await m.type('input-period-note', 'Chase Northstar on 18 Nov.');
    await m.press(/^Last month$/);
    await act(async () => { await m.props(m.byTestId('unsaved-save')).onClick(); });
    await m.settle();
    const put = m.seen.find((c) => c.method === 'PUT');
    assert.ok(put, 'saved');
    assert.equal(decodeURIComponent(put.path.split('/').pop()), thisMonth().key, 'filed against the period it was written for');
    assert.equal(put.body.period_key, thisMonth().key);
    assert.equal(m.byTestId('earnings-unsaved'), undefined);
    assert.equal(m.textOf(m.byTestId('earnings-period')), lastMonth().label, 'then the period changed');
    assert.doesNotMatch(m.text(), /Chase Northstar/, 'the old period’s note does not appear under the new heading');
  } finally { await m.close(); }
});

test('mounted: an older period’s late answer never lands under the newer heading', async () => {
  // Mutation checked: the ticket check removed from loadLedger → the late $990 paints under last month.
  const held = {};
  const m = await mount(world({
    ledger: (c) => {
      if (c.query.includes(encodeURIComponent(lastMonth().from)) || c.query.includes(lastMonth().from)) return ledgerBody(30_000);
      return { then: (res) => { held.resolve = () => res(ledgerBody(99_000)); } };
    },
  }));
  try {
    await m.press(/^Last month$/);
    assert.match(m.text(), /Recorded billed\$300/);
    held.resolve?.();
    await m.settle();
    assert.doesNotMatch(m.text(), /\$990/);
    assert.equal(m.textOf(m.byTestId('earnings-period')), lastMonth().label);
  } finally { await m.close(); }
});

test('mounted: no advisor profile is "Earnings unavailable" with a Learn why, and no figure', async () => {
  // Mutation checked: the unavailable branch removed → the generic unreadable box shows instead.
  const m = await mount(async (c) => {
    if (c.path.startsWith('/api/advisors/me/')) return json({ detail: 'No advisor profile attached to your account' }, 400);
    return json({});
  });
  try {
    const box = m.byTestId('earnings-unavailable');
    assert.ok(box);
    assert.match(m.textOf(box), /Earnings unavailable/);
    assert.match(m.textOf(box), /No advisor profile is attached to this account\./);
    assert.match(m.textOf(box), /Learn why/);
    assert.doesNotMatch(m.text(), /\$\d/);
  } finally { await m.close(); }
});

// ─────────────────────────────────────────────────────────────── phone row

test('the Practice section row: Overview first, the canvas’s order, one line that scrolls on a phone', () => {
  // Mutation checked: `order` dropped from PRACTICE_ROW → Delivery comes before Sessions and the order check fails.
  const canvas = readFileSync(new URL('../../design/incoming/Practice v2 Page.dc.html', import.meta.url), 'utf8');
  const zones = JSON.parse(canvas.match(/const ZONES = (\[[^\]]+\]);/)[1].replace(/'/g, '"'));
  assert.deepEqual(zones, ['Overview', 'Opportunities', 'Engagements', 'Sessions', 'Delivery', 'Earnings']);

  const routes = read('workspaces/advisor/AdvisorBucketRoutes.jsx');
  const row = routes.slice(routes.indexOf('const PRACTICE_ROW'), routes.indexOf('});', routes.indexOf('const PRACTICE_ROW')));
  assert.match(row, /overview: 'Overview'/);
  assert.match(row, /scroll: true/);
  const order = JSON.parse(row.match(/order: (\[[^\]]+\])/)[1].replace(/'/g, '"'));
  assert.deepEqual(order, zones.slice(1).map((z) => z.toLowerCase()));
  assert.match(routes, /zoneRow=\{prefix === '\/practice' \? PRACTICE_ROW : null\}/);

  const bucket = bucketForPath('advisor', '/practice/earnings');
  const html = renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/practice/earnings'] },
    h(ZoneNav, { bucket, role: 'advisor', row: { overview: 'Overview', order, scroll: true } })));
  const labels = [...html.matchAll(/data-testid="link-zone-([a-z-]+)"/g)].map((x) => x[1]);
  assert.deepEqual(labels, ['overview', ...order]);
  assert.match(html, /data-testid="zone-nav-scroll"/);
  assert.match(html, /flex-nowrap overflow-x-auto/);
  assert.match(html, /min-h-\[44px\]/, '44px targets on a phone');
  assert.match(html, /aria-current="page"[^>]*data-testid="link-zone-earnings"|data-testid="link-zone-earnings"[^>]*aria-current="page"/);

  // Without the opt-in, every other workspace's row is unchanged.
  const plain = renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/practice/earnings'] }, h(ZoneNav, { bucket, role: 'advisor' })));
  assert.doesNotMatch(plain, /link-zone-overview|zone-nav-scroll/);
  assert.match(plain, /class="flex gap-1\.5 flex-wrap /);
});
