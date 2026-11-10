/**
 * #4702 (D4702, Practice audit 4/6): the Practice overview, the detail pages,
 * the exports and the historical views use the same populations and
 * definitions. Every record below is made up.
 *
 *   · the overview's Engagements and Delivery sections summarise
 *     advisor_engagements and advisor_deliverables, not bookings, so three
 *     bookings, two contracts and four work products give three different counts;
 *   · an old unanswered request is "expired" on the overview exactly as on
 *     Opportunities (one classifier);
 *   · Past sessions asks for the window that just ended and shows real rows;
 *   · review coverage never turns an unread session into "No review";
 *   · the ledger says what it covers, and its CSV carries the summed rest;
 *   · a client cancelling an accepted session does not lower the acceptance rate.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/practice_reporting_4702.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import advisorPracticeBoard from '../src/workspaces/boards/advisorPractice.js';
import SessionsZone from '../src/pages/advisor/practice/SessionsZone.jsx';
import DeliveryZone from '../src/pages/advisor/practice/DeliveryZone.jsx';
import EarningsZone from '../src/pages/advisor/practice/EarningsZone.jsx';
import { windowFrom } from '../src/pages/advisor/practice/sessionGrid.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const json = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

// ---------------------------------------------------------------- the overview

const DAY = 86_400_000;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString();
const section = (slug) => advisorPracticeBoard('advisor', {}).sections.find((s) => s.slug === slug);

test('the overview counts contracts and work products, not bookings: different stores give different counts', () => {
  // Mutation checked: the engagements section back on confirmed bookings → "1 client" instead of "3 active engagements".
  const bookings = { items: [
    { id: 1, status: 'confirmed', client_user_id: 5, client_name: 'Meridian Labs', topic: 'Pricing', slot_starts_at: iso(3) },
    { id: 2, status: 'completed', client_user_id: 5, client_name: 'Meridian Labs', topic: 'Roadmap', slot_starts_at: iso(-9) },
  ] };
  const engagements = { items: [
    { id: 1, client_name: 'Meridian Labs', lane: 'signed', term_ends_at: iso(60) },
    { id: 2, client_name: 'Halverton', lane: 'renewal_due', term_ends_at: iso(10) },
    { id: 3, client_name: 'Aperture', lane: 'signed', term_ends_at: null },
    { id: 4, client_name: 'Verwood', lane: 'drafting' },
  ], totals: { active: 3, renewal_due: 1 } };
  const deliverables = { items: [
    { id: 1, client_name: 'Meridian Labs', title: 'Q4 review', state: 'opened' },
    { id: 2, client_name: 'Meridian Labs', title: 'Pricing memo', state: 'sent' },
    { id: 3, client_name: 'Halverton', title: 'Board brief', state: 'not_started' },
    { id: 4, client_name: 'Aperture', title: 'Hiring plan', state: 'not_started' },
  ], totals: { work_products: 4, sent: 2, opened: 1 } };

  const eng = section('engagements');
  assert.equal(eng.source, 'engagements');
  assert.equal(eng.summary(engagements), '3 active engagements · 1 renewal due');
  assert.deepEqual(eng.rows(engagements).map((r) => r[0]), ['Meridian Labs', 'Halverton', 'Aperture'], 'drafting is not an engagement');
  const del = section('delivery');
  assert.equal(del.source, 'deliverables');
  assert.equal(del.summary(deliverables), '4 work products · 2 sent · 1 opened');
  assert.deepEqual(del.rows(deliverables).map((r) => [r[1], r[2]]), [['Q4 review', 'Opened'], ['Pricing memo', 'Sent'], ['Board brief', 'Not started'], ['Hiring plan', 'Not started']]);
  // The same bookings still feed Sessions, and read differently from both.
  assert.match(section('sessions').summary(bookings), /2 sessions/);
  assert.notEqual(eng.summary(engagements), section('sessions').summary(bookings));
  // The board reads each store its page reads.
  const api = { listMyAdvisorBookings: () => 'b', listMyAdvisorEngagements: () => 'e', listMyAdvisorDeliverables: () => 'd', getMyAdvisorEarnings: () => 'x' };
  const src = advisorPracticeBoard('advisor', api).sources;
  assert.deepEqual([src.bookings(), src.engagements(), src.deliverables()], ['b', 'e', 'd']);
});

test('an old unanswered request is expired on the overview, the same as on Opportunities', () => {
  // Mutation checked: counting every pending row as awaiting → "2 awaiting you" and no expired.
  const bookings = { items: [
    { id: 1, status: 'pending', client_name: 'Old Request', topic: 'A', slot_starts_at: iso(-20) },
    { id: 2, status: 'pending', client_name: 'New Request', topic: 'B', slot_starts_at: iso(4) },
    { id: 3, status: 'pending', client_name: 'No Slot Time', topic: 'C', slot_starts_at: null },
  ] };
  const opp = section('opportunities');
  assert.equal(opp.summary(bookings), '2 awaiting you · 1 expired unanswered');
  assert.deepEqual(opp.rows(bookings).map((r) => [r[0], r[2]]), [
    ['New Request', 'Awaiting a decision'], ['No Slot Time', 'Awaiting a decision'], ['Old Request', 'Expired unanswered'],
  ]);
  // One classifier: the board and the page import the same function, and neither re-implements it.
  assert.match(read('workspaces/boards/advisorPractice.js'), /import \{ classifyBooking \} from '\.\.\/\.\.\/pages\/advisor\/practice\/opportunityLog\.js';/);
  assert.match(read('pages/advisor/practice/OpportunitiesZone.jsx'), /classifyBooking, ?|classifyBooking \}/);
});

// ---------------------------------------------------------------- mounted pages

async function mount(Page, handle) {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify({ id: 90, role: 'advisor', name: 'Ada' }));
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia, createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
  const seen = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u), 'http://x');
    const call = { method: (init.method || 'GET').toUpperCase(), path: url.pathname, query: url.search, params: Object.fromEntries(url.searchParams), body: init.body ? JSON.parse(init.body) : null };
    seen.push(call);
    return handle(call);
  };
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => root.render(h(MemoryRouter, null, h(Page))));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  const buttonWith = (re) => walk(document.body).find((n) => typeof props(n)?.onClick === 'function' && re.test(textOf(n)));
  return {
    seen, settle, text: () => textOf(document.body), byTestId, props, buttonWith,
    async press(re) { const b = buttonWith(re); assert.ok(b, `no button ${re}`); await act(async () => { props(b).onClick({ preventDefault() {} }); }); await settle(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); URL.createObjectURL = previous.createObjectURL; URL.revokeObjectURL = previous.revokeObjectURL; restore(); },
  };
}

const sessionsBase = (c) => {
  if (c.path === '/api/advisors/me/availability') return json({ weekly_paid_cap: null, buffer_minutes: null, min_notice_hours: null, blackouts: [], timezone: null, configured: false, revision: '' });
  if (c.path === '/api/advisors/me/bookings') return json({ items: [], total: 0 });
  if (c.path === '/api/advisors/me/session-types' || c.path === '/api/advisors/me/booking-links') return json({ items: [] });
  return json({});
};

test('Past sessions asks for the window that just ended and shows the real rows', async () => {
  // Mutation checked: no `from` for the past view → the forward window is requested and the page shows nothing.
  const past = { id: 7, starts_at: iso(-5), ends_at: new Date(Date.now() - 5 * DAY + 3_600_000).toISOString(), capacity: 1, taken: 1, notes: 'Last week\'s call', is_cancelled: 0 };
  const m = await mount(SessionsZone, (c) => {
    if (c.path === '/api/advisors/me/slots') {
      // The server answers [from, from + days): a forward window holds nothing that is over.
      const from = c.params.from ? Date.parse(c.params.from) : Date.now();
      const days = Number(c.params.days);
      return json({ items: Date.parse(past.starts_at) >= from && Date.parse(past.starts_at) < from + days * DAY ? [past] : [] });
    }
    return sessionsBase(c);
  });
  try {
    assert.ok(!m.text().includes('Last week'), 'the default window is forward, so a finished slot is not in it');
    await m.press(/^Past sessions$/);
    const reqs = m.seen.filter((c) => c.path === '/api/advisors/me/slots');
    const asked = reqs.at(-1);
    assert.equal(asked.params.days, '31');
    const ageDays = (Date.now() - Date.parse(asked.params.from)) / DAY;
    assert.ok(Math.abs(ageDays - 31) < 0.01, `from is 31 days ago (was ${ageDays})`);
    assert.ok(m.text().includes('Last week'), 'and the finished session is on the page');
  } finally { await m.close(); }
  const first = (await (async () => { const n = Date.now(); return windowFrom('past', 31, n); })());
  assert.equal(windowFrom('two_weeks', 14), undefined);
  assert.equal(windowFrom('month', 31), undefined);
  assert.equal(windowFrom('unpaid_held', 31), undefined);
  assert.ok(Date.parse(first) < Date.now());
});

const WORK_PRODUCT = { id: 1, title: 'Q4 review', client_name: 'Meridian Labs', state: 'sent', version_count: 1, latest_version: { version: 1, sent_at: iso(-1), link_url: 'https://docs.example/q4' } };

test('Delivery review coverage: the tiles are database counts over every held session; a failed coverage read is unknown, never "No review"', async () => {
  // Mutation checked: a failed coverage read treated as an empty one → "No review" and "0 reviewed".
  const sessions = Array.from({ length: 3 }, (_, i) => ({ id: 10 + i, topic: `Session ${i}`, founder_name: 'Fran', slot_starts_at: iso(-3 - i) }));
  const ok = await mount(DeliveryZone, (c) => {
    if (c.path === '/api/advisors/me/bookings') return json({ items: sessions, total: 25 });
    if (c.path === '/api/advisors/me/review-coverage') {
      return json({ held: 25, reviewed: 2, awaiting: 23, ratings: { count: 3, sum: 12 }, items_complete: true,
        items: [{ booking_id: 10, reviews: 2, advisor_filed: true, rating: 4.5 }, { booking_id: 11, reviews: 0, advisor_filed: false, rating: null }] });
    }
    if (c.path === '/api/advisors/me/deliverables') return json({ items: [WORK_PRODUCT], totals: { work_products: 1 } });
    return json({ items: [] });
  });
  try {
    assert.match(ok.text(), /Sessions held25/);
    assert.match(ok.text(), /Reviewed2/);
    assert.match(ok.text(), /23 without a review/);
    assert.match(ok.text(), /4\.0/, 'the average is over all 3 reviews, not the ones on screen');
    assert.match(ok.text(), /Showing the 3 newest of 25 held sessions/);
    assert.ok(ok.byTestId('row-pr3-session-11').childNodes, 'a listed session');
    assert.match(ok.text(), /No review/, 'listed with zero reviews is a real "No review"');
    assert.match(ok.text(), /Reviews not read/, 'session 12 was not in the coverage list, so it is unknown');
  } finally { await ok.close(); }
  const down = await mount(DeliveryZone, (c) => {
    if (c.path === '/api/advisors/me/bookings') return json({ items: sessions, total: 3 });
    if (c.path === '/api/advisors/me/review-coverage') return json({ detail: 'down' }, 500);
    if (c.path === '/api/advisors/me/deliverables') return json({ items: [WORK_PRODUCT], totals: { work_products: 1 } });
    return json({ items: [] });
  });
  try {
    assert.doesNotMatch(down.text(), /No review/);
    assert.match(down.text(), /review coverage could not be read/);
    assert.match(down.text(), /Reviews not read/);
    assert.equal(down.buttonWith(/Review this session/), undefined, 'no form over reviews that were not read');
  } finally { await down.close(); }
});

test('Delivery: the work-product list renders without waiting on the held sessions or their reviews', async () => {
  // Mutation checked: awaiting the secondary reads before setState → the list is still a skeleton while coverage is pending.
  let release;
  const gate = new Promise((r) => { release = r; });
  const m = await mount(DeliveryZone, async (c) => {
    if (c.path === '/api/advisors/me/deliverables') {
      return json({ items: [{ id: 1, title: 'Q4 review', client_name: 'Meridian Labs', state: 'sent', version_count: 1, latest_version: { version: 1, sent_at: iso(-1), link_url: 'https://docs.example/q4' } }], totals: { work_products: 1 } });
    }
    if (c.path === '/api/advisors/me/review-coverage') { await gate; return json({ held: 0, reviewed: 0, awaiting: 0, ratings: { count: 0, sum: 0 }, items: [], items_complete: true }); }
    if (c.path === '/api/advisors/me/bookings') return json({ items: [], total: 0 });
    return json({ items: [] });
  });
  try {
    assert.match(m.text(), /Q4 review/, 'the list is on screen');
    assert.match(m.text(), /Reading your held sessions/, 'while the coverage read is still pending');
  } finally { release(); await m.close(); }
});

const ledger = (over = {}) => ({
  currency: 'USD', from: null, until: null,
  clients: [{ client_user_id: 1, client_name: 'Meridian Labs', sessions: 5, gross_cents: 50_000, cut_cents: 7_500, net_cents: 42_500, unpriced_sessions: 0, retainer_cents: 400_000, engagement_shape: 'retainer' }],
  clients_other: { clients: 150, sessions: 300, gross_cents: 120_000, cut_cents: 18_000, net_cents: 102_000, unpriced_sessions: 12 },
  totals: { gross_cents: 170_000, cut_cents: 25_500, net_cents: 144_500, sessions: 305, priced_sessions: 293, unpriced_sessions: 12 },
  completeness: { basis: 'x', sessions: 305, clients: { listed: 1, total: 151, complete: false }, engagements: { read: true, complete: true } },
  concentration: { client_name: 'Meridian Labs', pct: 29 }, take_rate: { bps: 1500, source: 'setting', updated_at: null }, equity_clients: 0, settlement: 'none',
  // #4834 (D4834): the Practice v2 ledger lists records, capped, with the rest
  // summed in one row (the same #4702 rule the client list followed).
  states: { billed: { sessions: 293, gross_cents: 170_000 }, collected: { sessions: 0, gross_cents: 0 }, written_off: { sessions: 0, gross_cents: 0 }, paid_out_cents: 0, paid_out_count: 0 },
  lines: {
    read: true, listed: 1, total: 305, complete: false, unfrozen: 0,
    items: [{ id: 1, client_name: 'Meridian Labs', topic: 'Strategy review', billing_state: 'billed', amount_cents: 50_000, collected_cents: null, take_rate_bps: 1500, platform_fee_cents: 7_500, net_cents: 42_500, created_at: '2026-11-03T10:00:00.000Z' }],
    other: { records: 304, gross_cents: 120_000, fee_cents: 18_000, net_cents: 102_000 },
  },
  ...over,
});

test('Earnings says what the ledger covers, lists the summed rest, and its CSV carries it', async () => {
  // Mutation checked: the summed-records row dropped from the CSV → the file's rows no longer add to its Total.
  let blobText = '';
  const m = await mount(EarningsZone, (c) => {
    if (c.path === '/api/advisors/me/ledger') return json(ledger());
    if (c.path === '/api/advisors/me/earnings') return json({ currency: 'USD', billed_cents: 0, collected_cents: 0, outstanding_cents: 0, written_off_cents: 0, unpriced_count: 0, by_state: [], settlement: 'none', take_rate: { bps: 1500 } });
    if (c.path === '/api/advisors/me/payout-account') return json({ state: 'pending', settlement: 'none' });
    if (c.path === '/api/advisors/me/payouts') return json({ items: [] });
    if (c.path.startsWith('/api/advisors/me/period-notes/')) return json({ note: null });
    return json({});
  });
  const realBlob = globalThis.Blob;
  try {
    assert.match(m.text(), /The newest 1 of 305 records are listed and the rest are summed in one row; the cards count all 305/);
    assert.ok(m.byTestId('ledger-line-other'), 'the rest is one row');
    assert.match(m.text(), /304 older records, summed/);
    assert.match(m.text(), /Engagement retainers are contract values per cycle, not billed records/);
    globalThis.Blob = class { constructor(parts) { blobText = parts.join(''); } };
    URL.createObjectURL = () => 'blob:x'; URL.revokeObjectURL = () => {};
    const makeNode = document.createElement.bind(document);
    document.createElement = (tag) => { const n = makeNode(tag); if (String(tag).toLowerCase() === 'a') { n.click = () => {}; n.remove = () => {}; } return n; };
    const exportBtn = m.buttonWith(/Export/i);
    if (exportBtn) await act(async () => { m.props(exportBtn).onClick({ preventDefault() {} }); });
  } finally { globalThis.Blob = realBlob; await m.close(); }
  assert.ok(blobText, 'the export ran and produced a file');
  {
    const rows = blobText.split('\r\n');
    assert.ok(rows.some((r) => r.startsWith('"304 older records, summed"')), 'the export carries the summed rest');
    // The price column: the fourth cell, read past quoted cells' commas.
    const cells = (r) => [...r.matchAll(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g)].map((m) => m[1]);
    const gross = (r) => Number(cells(r)[3]);
    const total = rows.find((r) => r.startsWith('Total'));
    const body = rows.slice(1, rows.indexOf(total));
    assert.equal(body.reduce((a, r) => a + gross(r), 0), gross(total), 'the rows add to the Total');
  }
});

test('a client cancelling an accepted session does not reduce the acceptance rate (the page and the board share the definition)', () => {
  const log = read('pages/advisor/practice/opportunityLog.js');
  assert.match(log, /if \(v\.advisor_decision === 'accepted'\) return 'accepted';/);
  assert.match(log, /export function acceptanceRate\(counts\)/);
  assert.match(read('pages/advisor/practice/OpportunitiesZone.jsx'), /const acceptRate = acceptanceRate\(counts\);/);
});
