/**
 * D7120 part 2 (#7120): group seats on the Wellness home (canvas WLM-07, WLM-07B, WLM-08) on part 1's routes.
 * A seat is free, never oversold and confidential: a count, never a name.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/wellbeing_group_sessions_7120.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import * as M from '../src/pages/wellbeing/groupSessionsModel.js';
import { GroupSeatPanel, MyGroupSeats } from '../src/pages/wellbeing/GroupSessions.jsx';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-22T10:00:00Z');

const SESSION = (over = {}) => ({
  uid: 'gs1', title: 'Synthetic circle', support_type: { key: 'mindfulness', label: 'Mindfulness and grounding' },
  facilitator: { uid: 'f1', name: 'Synthetic Facilitator', headline: 'Teacher' }, format: 'group', language: 'en', timezone: 'UTC',
  starts_at: '2026-11-25T18:00:00Z', ends_at: '2026-11-25T19:00:00Z', duration_minutes: 60, free: true, capacity: 8, seats_left: 3,
  state: 'open', bookable: true, cancelled: null,
  cancellation: { hours: 2, cutoff_at: '2026-11-25T16:00:00Z', rule: 'You can cancel until 2 hours before it starts. It is free, so there is nothing to refund.' },
  what_facilitator_learns: 'Your name and email, so they can let you in. Nothing from your reflections, choices or other bookings.',
  what_other_members_learn: 'Nothing. Members never see who else reserved, and your calendar entry lists no one else.',
  my_reservation: null, ...over,
});

// ── The model ───────────────────────────────────────────────────────────────────────────────────────────────

test('model: when in the member’s zone, seats as a count, and what each state allows', () => {
  assert.equal(M.sessionWhen(SESSION(), 'UTC'), 'Wed 25 Nov · 18:00–19:00');
  assert.equal(M.sessionWhen(SESSION(), 'Europe/Lisbon'), 'Wed 25 Nov · 18:00–19:00');
  assert.equal(M.sessionWhen(SESSION(), 'Asia/Tokyo'), 'Thu 26 Nov · 03:00–04:00');
  assert.equal(M.sessionWhen({ starts_at: '2026-11-25 18:00:00' }, 'UTC'), 'Wed 25 Nov · 18:00', 'a D1 timestamp reads as UTC');
  assert.equal(M.sessionWhen({ starts_at: 'soon' }, 'UTC'), null);
  assert.equal(M.seatsLine(SESSION()), '3 of 8 open');
  assert.equal(M.seatsLine(SESSION({ seats_left: 0 })), 'Full · 0 of 8 open');
  assert.deepEqual(M.seatAction(SESSION()), { kind: 'open' });
  assert.equal(M.seatAction(SESSION({ state: 'full', seats_left: 0 })).kind, 'full');
  assert.equal(M.seatAction(SESSION({ seats_left: 0 })).kind, 'full', 'no seat left is full whatever the state says');
  assert.match(M.seatAction(SESSION({ state: 'cancelled', cancelled: { reason: 'Facilitator unwell' } })).line, /Facilitator unwell.*nothing to refund/);
  assert.equal(M.seatAction(SESSION({ my_reservation: { uid: 'r1', status: 'reserved' } })).kind, 'reserved');
  assert.equal(M.seatAction(SESSION({ my_reservation: { uid: 'r1', status: 'cancelled' } })).kind, 'open', 'a released seat can be reserved again');
  assert.equal(M.seatAction(SESSION({ state: 'started' })).kind, 'closed');
});

test('model: a D1 timestamp is UTC whatever the device zone is', () => {
  const was = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    assert.equal(M.sessionWhen({ starts_at: '2026-11-25 18:00:00' }, 'UTC'), 'Wed 25 Nov · 18:00', 'never read as the device’s local time');
  } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
});

test('model: refusals say nothing was reserved or charged; a row is releasable only before the cut-off', () => {
  const err = (code, extra = {}) => Object.assign(new Error('raw'), { data: { error: code, ...extra } });
  assert.match(M.seatRefusal(err('session_full')), /Someone reserved the last seat first\. Nothing was reserved for you, and nothing was charged\./);
  assert.equal(M.isFull(err('session_full')), true);
  assert.match(M.seatRefusal(err('cancellation_window_closed', { cutoff_at: '2026-11-25T16:00:00Z' })), /until Wed 25 Nov · 16:00 UTC\. Your seat is still reserved/);
  assert.doesNotMatch(M.seatRefusal(new Error('raw socket')), /socket/);
  const r = { uid: 'r1', status: 'reserved', session: SESSION() };
  assert.deepEqual([M.reservationRow(r, 'UTC', NOW).releasable, M.reservationRow(r, 'UTC', NOW).status.word], [true, 'Seat reserved']);
  assert.equal(M.reservationRow(r, 'UTC', Date.parse('2026-11-25T17:00:00Z')).releasable, false, 'after the cut-off');
  assert.equal(M.reservationRow(r, 'UTC', Date.parse('2026-11-26T00:00:00Z')).status.word, 'Held');
  const off = M.reservationRow({ ...r, session: SESSION({ state: 'cancelled', cancelled: { reason: 'Unwell' } }) }, 'UTC', NOW);
  assert.deepEqual([off.status.word, off.reason, off.releasable], ['Cancelled by the facilitator', 'Unwell', false]);
  assert.equal(M.reservationRow({ ...r, status: 'cancelled' }, 'UTC', NOW).status.word, 'Seat released');
  assert.deepEqual(M.CALENDAR.map((c) => c.key), ['discreet', 'named', 'none']);
});

// ── Rendering ───────────────────────────────────────────────────────────────────────────────────────────────

const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
async function mount(tree, routes) {
  const restore = installDocument();
  const prev = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (u, opts = {}) => {
    const key = `${opts.method || 'GET'} ${String(u).replace(/^.*\/api/, '').replace(/\?.*$/, '')}`;
    asked.push({ key, body: opts.body ? JSON.parse(opts.body) : null });
    const hit = routes[key];
    const out = typeof hit === 'function' ? await hit(opts) : hit;
    if (out && out.__status) return response({ error: out.code, message: 'refused' }, out.__status);
    return response(out ?? {});
  };
  localStorage.setItem('user', JSON.stringify({ id: 6, role: 'founder', name: 'Synthetic' }));
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  const flush = async () => { for (let i = 0; i < 14; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };
  await act(async () => root.render(h(MemoryRouter, null, tree)));
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(document.body).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : (n.childNodes || []).map(txt).join(' ') || n.textContent || '');
  return {
    asked, has: (id) => !!by(id), text: (id) => txt(by(id)).replace(/\s+/g, ' ').trim(), all: () => txt(document.body).replace(/\s+/g, ' '),
    click: async (id) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onClick({ preventDefault() {} }); }); await flush(); },
    change: async (id) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onChange({}); }); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = prev; localStorage.removeItem('user'); restore(); },
  };
}

test('seat panel: what the facilitator and other members learn; Reserve sends the calendar choice; then Reserved', async () => {
  let reserved = false;
  const v = await mount(h(GroupSeatPanel, { uid: 'gs1' }), {
    'GET /wellbeing/group-sessions/gs1': () => SESSION(reserved ? { my_reservation: { uid: 'r1', status: 'reserved', calendar: 'named' }, seats_left: 2 } : {}),
    'POST /wellbeing/group-sessions/gs1/reserve': () => { reserved = true; return { reserved: true }; },
  });
  try {
    assert.equal(v.text('group-seat-seats'), '3 of 8 open');
    assert.equal(v.text('group-seat-price'), 'Free');
    assert.match(v.text('group-seat-facilitator-learns'), /Your name and email/);
    assert.match(v.text('group-seat-members-learn'), /Nothing\. Members never see who else reserved/);
    assert.doesNotMatch(v.all(), /reserved by|attendee/i, 'no other member is ever named');
    await v.change('group-seat-calendar-named');
    await v.click('button-group-reserve');
    const post = v.asked.find((a) => a.key === 'POST /wellbeing/group-sessions/gs1/reserve');
    assert.deepEqual(post.body, { calendar: 'named' });
    assert.match(v.text('group-seat-reserved'), /Your seat is reserved\..*Nothing was charged/);
    assert.equal(v.has('button-group-reserve'), false);
  } finally { await v.close(); }
});

test('seat panel: the last seat taken first says nothing was reserved, and re-reads to Full; a cancelled session says so', async () => {
  let reads = 0;
  const v = await mount(h(GroupSeatPanel, { uid: 'gs1' }), {
    'GET /wellbeing/group-sessions/gs1': () => (++reads === 1 ? SESSION({ seats_left: 1 }) : SESSION({ seats_left: 0, state: 'full' })),
    'POST /wellbeing/group-sessions/gs1/reserve': { __status: 409, code: 'session_full' },
  });
  try {
    await v.click('button-group-reserve');
    assert.match(v.text('group-seat-error'), /Someone reserved the last seat first/);
    assert.equal(v.has('group-seat-full'), true, 'the panel re-reads and says it is full');
    assert.equal(v.text('group-seat-seats'), 'Full · 0 of 8 open');
  } finally { await v.close(); }
  const off = await mount(h(GroupSeatPanel, { uid: 'gs1' }), { 'GET /wellbeing/group-sessions/gs1': SESSION({ state: 'cancelled', cancelled: { at: 'x', reason: 'Facilitator unwell' } }) });
  try {
    assert.match(off.text('group-seat-cancelled'), /Facilitator unwell/);
    assert.equal(off.has('button-group-reserve'), false);
  } finally { await off.close(); }
});

test('my group seats: Release asks first, then releases; a closed window is refused in words; a failed read is not empty', async () => {
  let released = false;
  const v = await mount(h(MyGroupSeats), {
    'GET /wellbeing/group-reservations/mine': () => ({ reservations: [{ uid: 'r1', status: released ? 'cancelled' : 'reserved', calendar: 'discreet', session: SESSION({ starts_at: '2099-11-25T18:00:00Z', ends_at: '2099-11-25T19:00:00Z', cancellation: { hours: 2, cutoff_at: '2099-11-25T16:00:00Z', rule: 'r' } }) }] }),
    'POST /wellbeing/group-reservations/r1/cancel': () => { released = true; return { status: 'cancelled', seat_released: true }; },
  });
  try {
    assert.equal(v.text('group-seat-status-r1'), 'Seat reserved');
    await v.click('button-group-release-r1');
    assert.equal(v.asked.some((a) => a.key.startsWith('POST')), false, 'Release asks first');
    await v.click('button-group-release-confirm-r1');
    assert.equal(v.text('group-seat-status-r1'), 'Seat released');
  } finally { await v.close(); }
  const closed = await mount(h(MyGroupSeats), {
    'GET /wellbeing/group-reservations/mine': { reservations: [{ uid: 'r2', status: 'reserved', session: SESSION({ starts_at: '2099-11-25T18:00:00Z', cancellation: { cutoff_at: '2099-11-25T16:00:00Z' } }) }] },
    'POST /wellbeing/group-reservations/r2/cancel': { __status: 409, code: 'cancellation_window_closed' },
  });
  try {
    await closed.click('button-group-release-r2');
    await closed.click('button-group-release-confirm-r2');
    assert.match(closed.text('group-seats-error'), /Your seat is still reserved/);
  } finally { await closed.close(); }
  const bad = await mount(h(MyGroupSeats), { 'GET /wellbeing/group-reservations/mine': { __status: 503, code: 'reservations_unreadable' } });
  try { assert.match(bad.text('group-seats-unreadable'), /couldn’t be read/); } finally { await bad.close(); }
});

test('wiring: a group suggestion opens its seats, the home lists the member’s seats, dark pairs, and no name of another member', () => {
  const sug = read('frontend/src/pages/wellbeing/WellnessSuggestions.jsx');
  assert.match(sug, /data-testid=\{`rec-seats-\$\{item\.uid\}`\}>See seats</);
  assert.match(sug, /<GroupSeatPanel uid=\{item\.uid\}/);
  const page = read('frontend/src/pages/WellbeingPage.jsx');
  assert.match(page, /<MyGroupSeats version=\{seatsVersion\} \/>/);
  const src = read('frontend/src/pages/wellbeing/GroupSessions.jsx');
  for (const m of src.matchAll(/className=\{?[`"]([^`"]*)/g)) if (/\bbg-white\b/.test(m[1])) assert.match(m[1], /dark:bg-/, m[1]);
  assert.doesNotMatch(src, /attendees|\.attendee/, 'the member screens never read an attendee list');
});
