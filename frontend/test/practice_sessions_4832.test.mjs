/**
 * #4832 (D4832, Practice UX 4/6) — Sessions, operations first and scheduling
 * setup second, built to board PX-05 of the Practice v2 canvas (D4874).
 *
 *   · the chip row is Upcoming · Past · Cancelled over the bookings, and Past is
 *     time that has passed (or a session closed as held / no-show), never a
 *     wider forward window;
 *   · a card's price is what the booking records: Free is a recorded $0,
 *     Included is D5316's state, Unpriced is no amount; Collected is separate;
 *   · Open holds the price record, with the Included control wired to
 *     PATCH /api/advisors/me/bookings/:id/billing and D5316's two refusals;
 *   · Share booking link copies the one active link, or says why it cannot;
 *   · Edit availability waits visibly until the stored rules are read, and its
 *     Save is disabled until then;
 *   · Scheduling setup is its own section, after the feed.
 * Every record below is made up, and every instant is fixed.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/practice_sessions_4832.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import SessionsZone from '../src/pages/advisor/practice/SessionsZone.jsx';
import {
  SESSION_TABS, moneyState, offerText, priceClass, sessionCounts, sessionTab, sessionsFor, shareTarget, whenLine,
} from '../src/pages/advisor/practice/sessionFeed.js';

const h = React.createElement;
const json = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

// A fixed reading instant for the pure rules; the mounted page reads the real
// clock, so its fixtures sit decades either side of any day the suite runs.
const NOW = Date.parse('2026-11-16T12:00:00Z');

// ---------------------------------------------------------------- pure rules

test('Past is time that has passed, not a wider window; Cancelled is cancelled whenever it was', () => {
  assert.deepEqual(SESSION_TABS, ['upcoming', 'past', 'cancelled']);
  const tab = (b) => sessionTab(b, NOW);
  // Ends before now: Past, even though it was never closed.
  assert.equal(tab({ status: 'confirmed', startsAt: ('2026-11-16T10:00:00Z'), endsAt: ('2026-11-16T11:00:00Z') }), 'past');
  // Started, not ended: still Upcoming (it is the session in progress).
  assert.equal(tab({ status: 'confirmed', startsAt: ('2026-11-16T11:30:00Z'), endsAt: ('2026-11-16T12:30:00Z') }), 'upcoming');
  // With no end recorded, the start decides.
  assert.equal(tab({ status: 'confirmed', startsAt: ('2026-11-16T11:00:00Z') }), 'past');
  // Tomorrow is Upcoming, however wide a window would have been.
  assert.equal(tab({ status: 'pending', startsAt: ('2026-11-17T09:00:00Z') }), 'upcoming');
  // Closed as held or no-show: it happened.
  assert.equal(tab({ status: 'completed', startsAt: ('2026-11-18T09:00:00Z') }), 'past');
  assert.equal(tab({ status: 'no_show' }), 'past');
  // Cancelled (or declined) in the future or the past.
  assert.equal(tab({ status: 'cancelled', startsAt: ('2026-12-01T09:00:00Z') }), 'cancelled');
  assert.equal(tab({ status: 'cancelled', startsAt: ('2026-10-01T09:00:00Z') }), 'cancelled');
  // No time at all, not closed: Upcoming, so it cannot fall out of sight.
  assert.equal(tab({ status: 'confirmed' }), 'upcoming');
  assert.equal(tab(null), null);
});

test('each tab orders as a calendar reads, and the counts cover every booking', () => {
  const rows = [
    { id: 1, status: 'confirmed', startsAt: '2026-11-20T09:00:00Z' },
    { id: 2, status: 'confirmed', startsAt: '2026-11-18T09:00:00Z' },
    { id: 3, status: 'confirmed' },
    { id: 4, status: 'completed', startsAt: '2026-11-01T09:00:00Z' },
    { id: 5, status: 'completed', startsAt: '2026-11-10T09:00:00Z' },
    { id: 6, status: 'cancelled', startsAt: '2026-11-19T09:00:00Z' },
  ];
  assert.deepEqual(sessionsFor(rows, 'upcoming', NOW).map((b) => b.id), [2, 1, 3], 'soonest first, untimed last');
  assert.deepEqual(sessionsFor(rows, 'past', NOW).map((b) => b.id), [5, 4], 'most recent first');
  assert.deepEqual(sessionsFor(rows, 'cancelled', NOW).map((b) => b.id), [6]);
  assert.deepEqual(sessionCounts(rows, NOW), { upcoming: 3, past: 2, cancelled: 1 });
  assert.deepEqual(sessionCounts(null, NOW), { upcoming: 0, past: 0, cancelled: 0 });
});

test('a price is what the booking records: a missing price is never Free, and Collected is a separate state', () => {
  assert.deepEqual(priceClass({ amount_cents: null, billing_state: 'unpriced' }), { key: 'unpriced', label: 'Unpriced', detail: 'No price recorded' });
  assert.equal(priceClass({}).key, 'unpriced', 'an absent amount');
  assert.equal(priceClass({ amount_cents: '' }).key, 'unpriced', 'an empty amount');
  assert.equal(priceClass({ amount_cents: 'abc' }).key, 'unpriced', 'an unreadable amount');
  assert.deepEqual(priceClass({ amount_cents: 0, billing_state: 'billed' }), { key: 'free', label: 'Free', detail: '$0 recorded' });
  assert.equal(priceClass({ amount_cents: 25000, billing_state: 'billed' }).key, 'priced');
  assert.match(priceClass({ amount_cents: 25000 }).detail, /^\$250(\.00)? recorded price$/);
  assert.deepEqual(priceClass({ amount_cents: null, billing_state: 'included' }).label, 'Included');
  assert.equal(moneyState({ billing_state: 'collected' }).label, 'Collected');
  assert.equal(moneyState({ billing_state: 'written_off' }).label, 'Written off');
  assert.equal(moneyState({ billing_state: 'billed' }).label, 'Billed');
  assert.equal(moneyState({ billing_state: 'unpriced' }), null);
  assert.equal(moneyState({ billing_state: 'included' }), null, 'Included is a price state, not a money state');
});

test('the card line names the offer it was booked on, and a time in the reader\'s day', () => {
  assert.equal(offerText({ offer: { name: 'Strategy Session', duration_minutes: 60, pricing: 'price', price_cents: 25000 } }), 'Strategy Session · 60 min');
  assert.equal(offerText({ offer: { name: 'Intro', duration_minutes: null } }), 'Intro');
  assert.equal(offerText({ offer: null }), null);
  assert.equal(offerText({ offer: { name: '  ' } }), null);
  assert.equal(whenLine({}, NOW), null, 'no start, no line');
  const local = new Date(NOW);
  local.setHours(14, 0, 0, 0);
  const start = local.toISOString();
  const end = new Date(local.getTime() + 3_600_000).toISOString();
  assert.equal(whenLine({ startsAt: start, endsAt: end }, NOW), 'Today · 14:00–15:00');
  assert.match(whenLine({ startsAt: new Date(local.getTime() + 86_400_000).toISOString() }, NOW), /^Tomorrow · 14:00$/);
  assert.match(whenLine({ startsAt: new Date(local.getTime() + 5 * 86_400_000).toISOString() }, NOW), /^\w{3}, \d+ \w{3} · 14:00$|^\w{3} \d+ \w{3} · 14:00$|^\w{3}, \w{3} \d+ · 14:00$/);
});

test('Share booking link copies one active link, and otherwise says why it cannot', () => {
  assert.deepEqual(shareTarget([], false), { kind: 'unreadable' });
  assert.deepEqual(shareTarget([], true), { kind: 'none' });
  assert.deepEqual(shareTarget([{ slug: 'a', is_active: false }], true), { kind: 'none' }, 'a disabled link is not shared');
  const one = { slug: 'ada/founders', is_active: true };
  assert.deepEqual(shareTarget([one, { slug: 'b', is_active: false }], true), { kind: 'one', link: one });
  assert.deepEqual(shareTarget([one, { slug: 'c', is_active: true }], true), { kind: 'many', count: 2 }, 'never picks one of several');
});

// ---------------------------------------------------------------- mounted

async function mount(handle) {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify({ id: 90, role: 'advisor', name: 'Ada' }));
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const navDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const copied = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async (t) => { copied.push(t); } } } });
  const seen = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u), 'http://x');
    const call = { method: (init.method || 'GET').toUpperCase(), path: url.pathname, body: init.body ? JSON.parse(init.body) : null };
    seen.push(call);
    return handle(call);
  };
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };
  await act(async () => root.render(h(MemoryRouter, null, h(SessionsZone))));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const all = () => walk(document.body);
  const byTestId = (id) => all().find((n) => props(n)?.['data-testid'] === id);
  const buttonWith = (re, scope = document.body) => walk(scope).find((n) => n.tagName === 'BUTTON' && re.test(textOf(n).trim()));
  return {
    seen, copied, settle, text: (n = document.body) => textOf(n), byTestId, props, buttonWith, all,
    writes: () => seen.filter((c) => c.method !== 'GET'),
    async press(re, scope) {
      const b = buttonWith(re, scope); assert.ok(b, `no button ${re}`);
      await act(async () => { props(b).onClick({ preventDefault() {}, stopPropagation() {} }); }); await settle();
    },
    async submit(id) { const n = byTestId(id); assert.ok(n, `no ${id}`); await act(async () => { await props(n).onSubmit({ preventDefault() {} }); }); await settle(); },
    async close() {
      await act(async () => root.unmount());
      Object.assign(globalThis, previous);
      if (navDesc) Object.defineProperty(globalThis, 'navigator', navDesc); else delete globalThis.navigator;
      restore();
    },
  };
}

const RULES = { weekly_paid_cap: 4, buffer_minutes: 15, min_notice_hours: 24, blackouts: [], timezone: 'UTC', configured: true, revision: 'r-7' };
const base = (over = {}) => (c) => {
  if (over[c.path]) return over[c.path](c);
  if (c.path === '/api/advisors/me/bookings') return json({ items: [] });
  if (c.path === '/api/advisors/me/slots') return json({ items: [] });
  if (c.path === '/api/advisors/me/availability') return json(RULES);
  if (c.path === '/api/advisors/me/session-types' || c.path === '/api/advisors/me/booking-links') return json({ items: [] });
  return json({});
};

const OFFER = { session_type_id: 1, name: 'Strategy Session', duration_minutes: 60, pricing: 'price', price_cents: 25000, cadence_note: null };
const BOOKINGS = [
  { id: 1, status: 'confirmed', topic: 'Strategy review', founder_name: 'Acme', slot_starts_at: '2037-01-05T14:00:00Z', slot_ends_at: '2037-01-05T15:00:00Z', amount_cents: null, billing_state: 'unpriced', offer: OFFER },
  { id: 2, status: 'pending', topic: 'Pricing workshop', founder_name: 'Northstar', slot_starts_at: '2037-01-06T14:00:00Z', slot_ends_at: '2037-01-06T15:30:00Z', amount_cents: null, billing_state: 'unpriced', offer: null },
  { id: 3, status: 'completed', topic: 'Kickoff', founder_name: 'Kite Labs', slot_starts_at: '2020-03-02T10:00:00Z', slot_ends_at: '2020-03-02T11:00:00Z', amount_cents: 25000, billing_state: 'collected', take_rate_bps: 1000, platform_cut_cents: 2500, offer: OFFER },
  { id: 4, status: 'confirmed', topic: 'Intro call', founder_name: 'Lumen', slot_starts_at: '2020-03-03T10:00:00Z', slot_ends_at: '2020-03-03T10:30:00Z', amount_cents: 0, billing_state: 'billed', take_rate_bps: 1000, platform_cut_cents: 0, offer: null },
  { id: 5, status: 'cancelled', advisor_decision: 'declined', topic: 'Ask me anything', founder_name: 'Orbit', slot_starts_at: '2037-02-01T10:00:00Z', slot_ends_at: '2037-02-01T11:00:00Z', amount_cents: null, billing_state: 'unpriced' },
];

test('mounted: the feed comes first, with Upcoming · Past · Cancelled counted over every booking', async () => {
  // Mutation checked: sessionTab reading the START instead of the end; the
  // closed-as-held branch dropped; a closable session other than a confirmed one;
  // a declined request read as plain Cancelled.
  const m = await mount(base({ '/api/advisors/me/bookings': () => json({ items: BOOKINGS }) }));
  try {
    for (const label of [/^Upcoming 2$/, /^Past 2$/, /^Cancelled 1$/]) assert.ok(m.buttonWith(label), `chip ${label}`);
    assert.ok(m.byTestId('session-card-1') && m.byTestId('session-card-2'), 'upcoming cards');
    assert.equal(m.byTestId('session-card-3'), undefined, 'a past session is not upcoming');
    const one = m.text(m.byTestId('session-card-1'));
    assert.match(one, /Acme · Strategy review/);
    assert.match(one, /Strategy Session · 60 min · No price recorded/);
    assert.match(one, /Unpriced/);
    assert.match(one, /Confirmed/);
    for (const label of [/^Open$/, /^Complete$/, /^No-show$/, /^Cancel session$/]) {
      assert.ok(m.buttonWith(label, m.byTestId('session-card-1')), `the confirmed card offers ${label}`);
    }
    assert.equal(m.buttonWith(/^Complete$/, m.byTestId('session-card-2')), undefined, 'a request is not closed from here');
    assert.match(m.text(m.byTestId('session-card-2')), /Session type not recorded/);

    await m.press(/^Past 2$/);
    assert.ok(m.byTestId('past-means'), 'Past says what it means');
    const three = m.text(m.byTestId('session-card-3'));
    assert.match(three, /Priced/);
    assert.match(three, /Collected/);
    const four = m.text(m.byTestId('session-card-4'));
    assert.match(four, /\$0 recorded/);
    assert.match(four, /Free/);
    assert.ok(m.buttonWith(/^Complete$/, m.byTestId('session-card-4')), 'a confirmed session whose time passed is closed from Past');
    assert.equal(m.byTestId('session-card-1'), undefined);

    await m.press(/^Cancelled 1$/);
    assert.match(m.text(m.byTestId('session-card-5')), /Declined/);

    // The operations come before the configuration.
    const order = m.all().map((n) => m.props(n)?.['data-testid']).filter(Boolean);
    assert.ok(order.indexOf('sessions-feed') >= 0 && order.indexOf('scheduling-setup') > order.indexOf('sessions-feed'),
      'Scheduling setup is below the feed');
    assert.match(m.text(m.byTestId('scheduling-setup')), /Scheduling setup[\s\S]*Availability[\s\S]*Session types[\s\S]*Booking links/);
  } finally { await m.close(); }
});

test('mounted: an unreadable bookings read says so, and the chips carry no counts', async () => {
  const m = await mount(base({ '/api/advisors/me/bookings': () => json({ detail: 'boom' }, 500) }));
  try {
    assert.ok(m.buttonWith(/^Upcoming$/), 'no count on a read that failed');
    assert.equal(m.buttonWith(/^Upcoming 0$/), undefined, 'never a zero');
    assert.match(m.text(m.byTestId('sessions-feed')), /could not be read|Unavailable/i);
    assert.equal(m.byTestId('sessions-empty-upcoming'), undefined, 'no empty claim over a failed read');
  } finally { await m.close(); }
});

test('mounted: Open holds the price record, and Included is recorded through the billing route', async () => {
  // Mutation checked: the Included button offered on a priced line; the body
  // sent without billing_state 'included'; the priced_line refusal unmapped.
  let refusal = null;
  const m = await mount(base({
    '/api/advisors/me/bookings': () => json({ items: BOOKINGS }),
    '/api/advisors/me/bookings/1/billing': () => (refusal ? json({ code: refusal, detail: 'Private server detail' }, 409) : json({ id: 1 })),
  }));
  try {
    await m.press(/^Open$/, m.byTestId('session-card-1'));
    const detail = m.byTestId('session-detail-1');
    assert.ok(detail, 'Open shows the detail');
    assert.match(m.text(detail), /What each session was worth/);
    await m.press(/^Included in an engagement$/, detail);
    assert.deepEqual(m.writes().map((c) => [c.method, c.path, c.body]),
      [['PATCH', '/api/advisors/me/bookings/1/billing', { billing_state: 'included' }]]);

    refusal = 'priced_line';
    await m.press(/^Included in an engagement$/, m.byTestId('session-detail-1'));
    assert.match(m.text(), /This session has a price\. Clear it first/);
    assert.ok(!m.text().includes('Private server detail'), 'never the Worker\'s words');

    // A priced session is not offered Included at all (#4713's frozen terms).
    await m.press(/^Past 2$/);
    await m.press(/^Open$/, m.byTestId('session-card-4'));
    assert.equal(m.buttonWith(/^Included in an engagement$/, m.byTestId('session-detail-4')), undefined);
    assert.ok(m.buttonWith(/^Clear the price$/, m.byTestId('session-detail-4')), 'the confirmed reprice path stays');
  } finally { await m.close(); }
});

test('mounted: an included session reads Included, never Unpriced or Free', async () => {
  const included = { ...BOOKINGS[0], billing_state: 'included' };
  const m = await mount(base({ '/api/advisors/me/bookings': () => json({ items: [included] }) }));
  try {
    const card = m.text(m.byTestId('session-card-1'));
    assert.match(card, /Included in an engagement · not billed/);
    assert.doesNotMatch(card, /Unpriced|Free/);
    assert.equal(m.text(m.byTestId('sessions-feed')).includes('unpriced'), false, 'not counted unpriced');
  } finally { await m.close(); }
});

test('mounted: the header offers Block time and Share booking link, which copies the one active link', async () => {
  // Mutation checked: Share copying a disabled link; Share choosing among several.
  let items = [{ id: 7, slug: 'ada/founders', is_active: true, audience: 'public', opens_count: 8, booking_count: 3 },
    { id: 8, slug: 'ada/old', is_active: false, audience: 'public', opens_count: null, booking_count: null }];
  const m = await mount(base({ '/api/advisors/me/booking-links': () => json({ items }) }));
  try {
    await m.press(/^Block time$/);
    assert.ok(m.byTestId('advisor-block-form'), 'Block time opens the block form');
    await m.press(/^Share booking link$/);
    assert.deepEqual(m.copied, ['https://axal.vc/b/ada/founders']);
    assert.match(m.text(), /Copied https:\/\/axal\.vc\/b\/ada\/founders\./);
  } finally { await m.close(); }

  items = [];
  const none = await mount(base({ '/api/advisors/me/booking-links': () => json({ items }) }));
  try {
    await none.press(/^Share booking link$/);
    assert.deepEqual(none.copied, []);
    assert.match(none.text(), /You have no active booking link yet/);
  } finally { await none.close(); }

  const broken = await mount(base({ '/api/advisors/me/booking-links': () => json({ detail: 'x' }, 500) }));
  try {
    await broken.press(/^Share booking link$/);
    assert.deepEqual(broken.copied, []);
    assert.match(broken.text(), /Your booking links could not be read/);
  } finally { await broken.close(); }
});

test('mounted: Edit availability waits visibly for the stored rules, and Save is disabled until they land', async () => {
  // Mutation checked: the waiting editor's Save enabled; the saving form drawn
  // while the read is in flight; no editor withheld on an unreadable read.
  let release;
  const pending = new Promise((r) => { release = r; });
  const m = await mount(base({ '/api/advisors/me/availability': async (c) => (c.method === 'GET' ? pending : json({ ok: true })) }));
  try {
    await m.press(/^Edit availability$/);
    const waiting = m.byTestId('availability-editor-loading');
    assert.ok(waiting, 'the editor opens and says it is waiting');
    assert.match(m.text(waiting), /Save stays disabled until it has loaded/);
    const save = m.buttonWith(/^Save availability$/, waiting);
    assert.equal(m.props(save).disabled, true, 'Save cannot replace rules it has not read');
    assert.equal(m.byTestId('availability-editor'), undefined, 'no saving form yet');

    release(json(RULES));
    await m.settle();
    assert.equal(m.byTestId('availability-editor-loading'), undefined);
    assert.ok(m.byTestId('availability-editor'), 'the form arrives with the rules');
    assert.match(m.text(m.byTestId('availability-rules')), /24 h[\s\S]*15 min[\s\S]*4 paid \/ week/);
    await m.submit('availability-editor');
    const put = m.writes().find((c) => c.path === '/api/advisors/me/availability');
    assert.ok(put, 'saved');
    assert.equal(put.body.expected_revision, 'r-7');
    assert.equal(put.body.weekly_paid_cap, 4, 'the stored rules, not defaults');
  } finally { await m.close(); }

  const broken = await mount(base({ '/api/advisors/me/availability': () => json({ detail: 'x' }, 500) }));
  try {
    assert.equal(broken.buttonWith(/^Edit availability$/), undefined, 'no editor over rules that could not be read');
    assert.match(broken.text(), /Rules not recorded/);
  } finally { await broken.close(); }
});
