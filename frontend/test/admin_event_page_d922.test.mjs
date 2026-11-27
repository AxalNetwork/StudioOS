/**
 * D922 (#2705) — one event's page at /admin/events/:id, complete: the host
 * line, the type pill and format word, the second row of tiles, "Seats taken
 * over time", the funnel, who registered, invitations, payments, reminders,
 * the history, and the notes on Cancel and Unpublish.
 *
 * What this file holds the page to:
 *   · every figure comes from part 3's summary (D918), block by block, and a
 *     block that failed says so in its own card while the others draw;
 *   · the funnel's Confirmed is confirmed plus attended, and Attended before
 *     the event is held is "Not held yet", never 0;
 *   · invitations by source are the three that are minted, in the canvas's
 *     words; Investors, Founders and Host's contacts are not drawn;
 *   · refunds are "Not recorded", with the reason;
 *   · the history is newest first, its actors "the host" or "an admin", and
 *     the change after approval is the amber row;
 *   · Cancel and Unpublish carry a note to the Worker, and only when written;
 *   · the page never reads the roster.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import AdminEventsPage from '../src/pages/admin/AdminEventsPage.jsx';
import { EVENT_TYPES } from '../src/lib/eventTypes.js';
import {
  COULD_NOT_READ, DAY_MS, NOT_HELD, NOTE_MAX, READING, SEATS_CHART_LABEL, cancelCopy, formatWord, funnelOf, historyRows, hostLine,
  invitationRows, paymentRows, registrantRows, reminderRows, seatsSeries, summaryBlock, summaryTiles, typeWord, unpublishCopy,
} from '../src/pages/admin/events/eventsDeskModel.js';

const h = React.createElement;
const NOW = Date.parse('2026-10-24T12:00:00Z');
const iso = (days, from = NOW) => new Date(from + days * DAY_MS).toISOString();

/* ------------------------------------------------------------------ *
 * Fixtures, in the shapes the Worker sends (`adminEventsReads.ts`)
 * ------------------------------------------------------------------ */

const ev = (id, o = {}) => ({
  id, slug: `ev-${id}`, title: `Event ${id}`, type: 'meetup', summary: null, description: null,
  starts_at: iso(10), ends_at: null, timezone: 'UTC', location_kind: 'in_person', location_text: 'Main room',
  capacity: 40, waitlist_enabled: true, approval_required: false, visibility: 'public', status: 'published',
  featured: false, price_cents: 4000, currency: 'usd', created_at: '2026-10-01 09:00:00', admin_published: true, audience_rules: {},
  ...o,
});
const on = (data) => ({ available: true, ...data });
const off = (reason = 'The invitations could not be read.') => ({ available: false, unreadable: true, reason });

// GET /api/admin/events/:id/summary
const SUMMARY = {
  event_id: 41,
  host: on({ host: { name: 'Ada Host', role: 'founder' }, venture: { name: 'Acme Labs' } }),
  registrations: on({ by_status: { registered: 5, confirmed: 3, attended: 2, waitlisted: 4, cancelled: 1, declined: 6, other: 0 }, seats_taken: 10, capacity: 40, ended: false, show_up: null }),
  by_source: on({ counts: { invitation: 3, free_seat: 2, signed_up: 5 }, added_by_admin: { recorded: false, reason: 'An admin adding someone is not marked apart.' } }),
  by_role: on({ counts: { founder: 4, investor: 0, advisor: 0, partner: 3, exploring: 0, admin: 0, guest: 2, not_recorded: 1 } }),
  payments: on({ price_cents: 4000, currency: 'usd', by_payment_status: {}, paid: { count: 3, by_currency: [{ currency: 'usd', count: 3, amount_cents: 12000, amount_not_recorded: 0 }] }, payment_pending: 2, refunds: { recorded: false, reason: 'A refunded ticket is not marked here. HQ refunds a ticket’s payment in Revenue › Billing.' } }),
  free_seats: on({ count: 2 }),
  checkins: on({ count: 0 }),
  invitations: on({ total: 9, free_seat: 2, by_status: { pending: 4, accepted: 3, declined: 1, revoked: 1, other: 0 }, by_source: { manual: 5, auto_partner: 3, auto_lp: 1, other: 0 } }),
  reminders: on({ sent: 0, by_kind: { reminder_24h: 0, reminder_1h: 0, other: 0 } }),
  seats_by_day: on({ days: [{ day: '2026-10-20', seats: 4, total: 4 }, { day: '2026-10-22', seats: 6, total: 10 }], registered_at_not_recorded: 1, counted_by: 'registered_at' }),
};
const ready = (data) => ({ status: 'ready', data });
const blockOf = (key, summary = SUMMARY) => summaryBlock(ready(summary), key);

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('each summary block answers alone: loading, ready, or unreadable with its reason', () => {
  assert.deepEqual(summaryBlock({ status: 'loading' }, 'payments'), { state: 'loading' });
  assert.equal(summaryBlock({ status: 'error' }, 'payments').state, 'unreadable');
  assert.equal(blockOf('payments').state, 'ready');
  assert.deepEqual(blockOf('invitations', { ...SUMMARY, invitations: off('No.') }), { state: 'unreadable', reason: 'No.' });
  assert.equal(blockOf('nothing').state, 'unreadable', 'a block the answer lacks is not read as zero');
});

test('the host line, the type pill and the format word', () => {
  assert.deepEqual(hostLine(blockOf('host')), { text: 'Hosted by Ada Host · Founder · Acme Labs', recorded: true });
  assert.equal(hostLine(blockOf('host', { ...SUMMARY, host: on({ host: { name: 'Ada Host', role: null }, venture: null }) })).text, 'Hosted by Ada Host');
  assert.equal(hostLine(blockOf('host', { ...SUMMARY, host: on({ host: { name: ' ', role: 'investor' }, venture: null }) })).text, 'Hosted by A member · Investor');
  assert.deepEqual(hostLine(blockOf('host', { ...SUMMARY, host: on({ host: null, venture: null }) })), { text: 'Host not recorded', recorded: false });
  assert.equal(hostLine({ state: 'loading' }), null);
  assert.equal(typeWord(ev(1), EVENT_TYPES), 'Meetup');
  assert.equal(typeWord(ev(1, { type: 'lp_briefing' }), EVENT_TYPES), 'LP Briefing');
  assert.equal(typeWord(ev(1, { type: 'nonsense' }), EVENT_TYPES), null);
  assert.deepEqual(['in_person', 'virtual', 'hybrid', 'elsewhere'].map((k) => formatWord(ev(1, { location_kind: k }))), ['In person', 'Online', 'Hybrid', null]);
});

test('the second row of tiles: Paid tickets, Free seats, Invitations, each from its own block', () => {
  const [paid, free, inv] = summaryTiles(ready(SUMMARY));
  assert.deepEqual([paid.label, paid.value, paid.sub], ['Paid tickets', '3', '$120']);
  assert.deepEqual([free.label, free.value, free.sub], ['Free seats', '2', 'From audience rules or free invitations']);
  assert.deepEqual([inv.label, inv.value, inv.sub], ['Invitations', '9', 'sent · 3 accepted']);
  assert.ok(summaryTiles({ status: 'loading' }).every((t) => t.value === READING));
  const one = summaryTiles(ready({ ...SUMMARY, free_seats: off('Down.') }));
  assert.deepEqual(one.map((t) => Boolean(t.failed)), [false, true, false], 'one failed block, one failed tile');
  assert.equal(one[1].value, COULD_NOT_READ);
  const none = summaryTiles(ready({ ...SUMMARY, payments: on({ ...SUMMARY.payments, paid: { count: 0, by_currency: [] } }) }))[0];
  assert.deepEqual([none.value, none.sub], ['0', 'None paid yet']);
  const freeEvent = summaryTiles(ready({ ...SUMMARY, payments: on({ ...SUMMARY.payments, price_cents: 0, paid: { count: 0, by_currency: [] } }) }))[0];
  assert.equal(freeEvent.sub, 'A free event');
  const unknown = summaryTiles(ready({ ...SUMMARY, payments: on({ ...SUMMARY.payments, paid: { count: 2, by_currency: [{ currency: 'eur', count: 2, amount_cents: 3000, amount_not_recorded: 1 }] } }) }))[0];
  assert.match(unknown.sub, /^€30 \+ 1 not recorded$/, 'an amount nothing stored is said, not summed as 0');
});

test('Seats taken over time: the running total by registration date, the capacity and Today', () => {
  const s = seatsSeries(blockOf('seats_by_day'), ev(1), NOW);
  assert.deepEqual(s.points, [{ day: '2026-10-20', total: 4 }, { day: '2026-10-22', total: 10 }]);
  assert.equal(s.capacity, 40);
  assert.equal(s.today, '2026-10-24');
  assert.equal(s.todayAfter, true, 'today is after the last registration day');
  assert.equal(s.undated, 1);
  assert.equal(s.alt, '10 seats taken by 22 Oct 2026, of 40.');
  assert.match(SEATS_CHART_LABEL, /^By the date each current seat holder registered\./);
  const inside = seatsSeries(blockOf('seats_by_day'), ev(1), Date.parse('2026-10-21T12:00:00Z'));
  assert.deepEqual([inside.today, inside.todayAfter], ['2026-10-21', false]);
  const before = seatsSeries(blockOf('seats_by_day'), ev(1), Date.parse('2026-10-19T12:00:00Z'));
  assert.equal(before.today, null, 'no Today marker before the series starts');
  assert.equal(seatsSeries(blockOf('seats_by_day'), ev(1, { capacity: null }), NOW).capacity, null, 'no cap, no capacity line');
  const empty = seatsSeries(blockOf('seats_by_day', { ...SUMMARY, seats_by_day: on({ days: [], registered_at_not_recorded: 0 }) }), ev(1), NOW);
  assert.equal(empty.alt, 'No seat holder has a registration date yet.');
  assert.equal(seatsSeries({ state: 'unreadable' }, ev(1), NOW), null);
});

test('the funnel: Confirmed is confirmed plus attended; Attended waits for the event; the rest beside it', () => {
  const f = funnelOf(blockOf('registrations'), ev(1), NOW);
  assert.deepEqual(f.steps.map((s) => [s.label, s.value]), [['Registered', 10], ['Confirmed', 5], ['Attended', 2]], 'attended > 0 is drawn even before the end');
  const upcoming = funnelOf(blockOf('registrations', { ...SUMMARY, registrations: on({ by_status: { registered: 5, confirmed: 3, attended: 0 } }) }), ev(1), NOW);
  assert.deepEqual(upcoming.steps.map((s) => s.value), [8, 3, 0]);
  assert.deepEqual([upcoming.steps[2].text, upcoming.steps[2].dash], [NOT_HELD, true], 'Not held yet, never 0');
  const cancelled = funnelOf(blockOf('registrations', { ...SUMMARY, registrations: on({ by_status: { registered: 1 } }) }), ev(1, { status: 'cancelled', starts_at: iso(-5) }), NOW);
  assert.equal(cancelled.steps[2].text, 'Not held');
  const held = funnelOf(blockOf('registrations', { ...SUMMARY, registrations: on({ by_status: { confirmed: 4, attended: 0 } }) }), ev(1, { starts_at: iso(-3) }), NOW);
  assert.deepEqual([held.steps[2].value, held.steps[2].text], [0, undefined], 'held with no one at the door is a real 0');
  assert.deepEqual(f.beside.map((b) => [b.label, b.value]), [['Waitlisted', 4], ['Cancelled', 1], ['Declined', 6]]);
  assert.equal(funnelOf({ state: 'unreadable' }, ev(1), NOW), null);
});

test('who registered: by profile in the canvas order, and by how the seat was got', () => {
  const w = registrantRows(blockOf('by_role'), blockOf('by_source'));
  assert.deepEqual(w.profile.map((r) => [r.label, r.value]), [['Founder', 4], ['Investor', 0], ['Operating Partner', 3], ['Guest (no account)', 2], ['Profile not recorded', 1]]);
  assert.deepEqual(w.source.map((r) => [r.label, r.value]), [['Signed up', 5], ['Invitation', 3], ['Free seat', 2]]);
  assert.equal(w.added, 'An admin adding someone is not marked apart.');
  const half = registrantRows({ state: 'unreadable' }, blockOf('by_source'));
  assert.equal(half.profile, null);
  assert.ok(half.source, 'each half answers alone');
});

test('invitations: by status, and by the three sources that are minted', () => {
  const inv = invitationRows(blockOf('invitations'));
  assert.equal(inv.total, 9);
  assert.deepEqual(inv.status.map((r) => [r.label, r.value]), [['Pending', 4], ['Accepted', 3], ['Declined', 1], ['Revoked', 1]]);
  assert.deepEqual(inv.source.map((r) => [r.key, r.label, r.value]), [
    ['manual', 'Sent by the host or an admin', 5], ['auto_partner', 'Official partners', 3], ['auto_lp', 'Invested LPs', 1],
  ]);
  assert.doesNotMatch(JSON.stringify(inv), /Investors|Founders|Host’s contacts|Host's contacts/, 'the canvas sources no store mints');
  const other = invitationRows(blockOf('invitations', { ...SUMMARY, invitations: on({ total: 1, by_status: {}, by_source: { other: 1 } }) }));
  assert.deepEqual(other.source.at(-1), { key: 'other', label: 'Another source', value: 1 });
  assert.equal(invitationRows({ state: 'unreadable' }), null);
});

test('payments: price, paid, pending; refunds are Not recorded with the reason', () => {
  const p = paymentRows(blockOf('payments'));
  assert.deepEqual(p.map((r) => [r.label, r.value]), [['Price', '$40'], ['Paid', '3 · $120'], ['Payment pending', '2'], ['Refunds', 'Not recorded']]);
  assert.equal(p[3].unrecorded, true);
  assert.match(p[3].reason, /Revenue › Billing/);
  assert.equal(paymentRows(blockOf('payments', { ...SUMMARY, payments: on({ ...SUMMARY.payments, paid: { count: 0, by_currency: [] } }) }))[1].value, '0');
});

test('reminders: due from the start, sent from the summary', () => {
  const upcoming = reminderRows(blockOf('reminders'), ev(1, { starts_at: '2026-11-10T18:00:00Z' }), NOW);
  assert.deepEqual(upcoming.map((r) => r.label), ['24-hour reminder', '1-hour reminder']);
  assert.match(upcoming[0].line, /^Not sent yet · due Mon 9 Nov · 18:00$/);
  assert.match(upcoming[1].line, /^Not sent yet · due Tue 10 Nov · 17:00$/);
  const sent = reminderRows(blockOf('reminders', { ...SUMMARY, reminders: on({ by_kind: { reminder_24h: 12, reminder_1h: 0 } }) }), ev(1, { starts_at: iso(0.02) }), NOW);
  assert.deepEqual([sent[0].line, sent[0].sent], ['Sent to 12', true]);
  assert.match(sent[1].line, /^Not sent · was due /, 'due and passed, not sent');
  const cancelled = reminderRows(blockOf('reminders'), ev(1, { status: 'cancelled' }), NOW);
  assert.ok(cancelled.every((r) => r.line === 'Not sent: the event is cancelled'));
  assert.equal(reminderRows({ state: 'loading' }, ev(1), NOW), null);
});

test('history: newest first, the host or an admin, the amber change after approval, Created last', () => {
  const hist = historyRows(ready({ event_id: 1, history: {
    created_at: '2026-10-01 09:00:00', submitted_at: '2026-10-02 09:00:00', approved_at: '2026-10-03 09:00:00', changed_after_approval_at: '2026-10-04 09:00:00',
    items: [
      { at: '2026-10-02 09:00:00', action: 'event_submitted', actor: 'host' },
      { at: '2026-10-03 09:00:00', action: 'event_approved', actor: 'admin' },
      { at: '2026-10-04 09:00:00', action: 'event_updated', actor: 'host', fields: ['starts_at', 'title'] },
      { at: '2026-10-05 09:00:00', action: 'event_rejected', actor: 'admin', reason: 'Add a room' },
      { at: '2026-10-06 09:00:00', action: 'event_capacity_override', actor: 'admin', capacity: null },
      { at: '2026-10-07 09:00:00', action: 'event_featured', actor: 'admin', featured: false },
    ],
  } }));
  assert.equal(hist.state, 'ready');
  const texts = hist.rows.map((r) => r.text);
  assert.deepEqual(texts.slice(0, 3), ['No longer featured, by an admin', 'Capacity set to no cap by an admin', 'Sent back by an admin: ‘Add a room’']);
  assert.ok(texts.includes('Edited by the host: starts at, title'));
  assert.ok(texts.includes('Submitted for review by the host'));
  assert.equal(texts.at(-1), 'Created');
  assert.equal(hist.rows.at(-1).date, '1 Oct 2026');
  const amber = hist.rows.filter((r) => r.amber);
  assert.deepEqual(amber.map((r) => r.text), ['The host changed the event after it was approved']);
  assert.doesNotMatch(JSON.stringify(hist), /Ada|@/, 'actors are never names');
  assert.equal(historyRows({ status: 'error' }).state, 'unreadable');
  assert.equal(historyRows(ready({ history: off('Down.') })).state, 'unreadable');
  assert.deepEqual(historyRows(ready({ history: { created_at: '2026-10-01 09:00:00', items: [] } })).rows.map((r) => r.text), ['Created']);
});

test('Cancel: the note to registrants and the paid box from the summary; Unpublish: the note to the host', () => {
  const c = cancelCopy(ev(1), blockOf('payments'));
  assert.equal(c.noteLabel, 'Note to registrants · optional');
  assert.match(c.lines[1], /told in StudioOS, with your note\./);
  assert.equal(c.paid, '3 paid tickets ($120) are not refunded automatically. HQ refunds them in Revenue › Billing.');
  assert.equal(cancelCopy(ev(1), blockOf('payments', { ...SUMMARY, payments: on({ ...SUMMARY.payments, paid: { count: 0, by_currency: [] } }) })).paid, null, 'no one paid, no refund box');
  assert.match(cancelCopy(ev(1), { state: 'unreadable' }).paid, /could not be counted here/);
  assert.match(cancelCopy(ev(1), { state: 'loading' }).paid, /still being counted/);
  assert.equal(cancelCopy(ev(1, { price_cents: 0 }), { state: 'unreadable' }).paid, null, 'a free event has no refund box');
  assert.doesNotMatch(JSON.stringify(c), /cannot be undone/);
  const u = unpublishCopy(ev(1));
  assert.equal(u.noteLabel, 'Note to the host · optional');
  assert.match(u.body, /The host is told, with your note\.$/);
  assert.equal(NOTE_MAX, 1000, 'the Worker caps a note at 1,000 characters (D917)');
});

/* ------------------------------------------------------------------ *
 * Mounted against a stubbed Worker
 * ------------------------------------------------------------------ */

const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const LIVE = Date.now();

function worker({ event, summary = SUMMARY, history = null }) {
  return (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const m = url.match(/\/api\/admin\/events\/(\d+)\/(\w+)$/);
    if (method === 'POST' && m) return response({ event: { id: Number(m[1]) } });
    if (url.includes('/api/admin/events/analytics')) return response({ summary: {}, events: [] });
    if (/\/api\/admin\/events\/\d+$/.test(url)) return response({ event });
    if (/\/api\/events\/\d+\/agenda$/.test(url)) return response({ agenda: [] });
    if (/\/summary$/.test(url)) return summary instanceof Function ? summary() : response(summary);
    if (/\/history$/.test(url)) return history instanceof Function ? history() : response(history || { history: { created_at: event.created_at, items: [] } });
    return response({});
  };
}

async function mounted(url, handle) {
  const restore = installDocument();
  const make = document.createElement.bind(document);
  document.createElement = (tag) => {
    const n = make(tag);
    n.focus = function focus() { document.activeElement = this; };
    n.contains = function contains(other) { for (let x = other; x; x = x.parentNode) if (x === this) return true; return false; };
    return n;
  };
  document.addEventListener = () => {};
  document.removeEventListener = () => {};
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), method: String(options.method || 'GET'), body: options.body }); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AdminEventsPage))));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    requests,
    text: () => text(container),
    textOf: (id) => text(byId(id)),
    testIds: () => nodes().map((n) => props(n)['data-testid']).filter(Boolean),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); assert.ok(!p.disabled, `${id} is disabled`); await act(async () => { p.onClick({ preventDefault() {}, stopPropagation() {} }); }); await flush(); },
    async press(label) {
      const node = nodes().find((n) => String(n.tagName).toUpperCase() === 'BUTTON' && text(n).trim() === label);
      assert.ok(node, `no button "${label}"`);
      await act(async () => { props(node).onClick({ preventDefault() {}, stopPropagation() {} }); });
      await flush();
    },
    async change(id, target) { await act(async () => { props(byId(id)).onChange({ target }); }); },
    props: (id) => props(byId(id)),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

const LIVE_EVENT = ev(41, { title: 'Demo night', starts_at: iso(6, LIVE), ends_at: iso(6.1, LIVE) });

test('mounted: the summary and history are read; every card draws its counts; the roster is never read', async () => {
  const view = await mounted('/admin/events/41', worker({ event: LIVE_EVENT }));
  try {
    for (const path of ['/api/admin/events/41/summary', '/api/admin/events/41/history']) assert.ok(view.requests.some((r) => r.url === path), path);
    assert.ok(!view.requests.some((r) => r.url.includes('/roster')), 'counts only, never the roster');
    assert.equal(view.textOf('events-event-host'), 'Hosted by Ada Host · Founder · Acme Labs');
    assert.match(view.textOf('events-event-place'), /^In person · Main room$/);
    assert.match(view.text(), /Meetup/, 'the type pill');
    assert.match(view.textOf('events-event-tile-paid'), /Paid tickets3\$120/);
    assert.match(view.textOf('events-event-tile-free'), /Free seats2From audience rules or free invitations/);
    assert.match(view.textOf('events-event-tile-invitations'), /Invitations9sent · 3 accepted/);
    const seats = view.textOf('events-event-seats');
    assert.match(seats, /Seats taken over time/);
    assert.match(seats, /Capacity 40/);
    assert.match(seats, /Today/);
    assert.match(seats, /1 seat holder has no registration date and is not drawn\./);
    const funnel = view.textOf('events-event-funnel');
    assert.match(funnel, /Registered.*10.*Confirmed.*5.*Attended.*2/s);
    assert.match(view.textOf('events-event-funnel-beside'), /Waitlisted 4Cancelled 1Declined 6/);
    assert.match(view.textOf('events-event-who'), /Operating Partner/);
    assert.match(view.textOf('events-who-added'), /Added by an adminNot recorded/);
    assert.match(view.textOf('events-invite-src-manual'), /Sent by the host or an admin5/);
    assert.match(view.textOf('events-invite-src-auto_partner'), /Official partners3/);
    assert.match(view.textOf('events-invite-src-auto_lp'), /Invested LPs1/);
    assert.ok(!view.testIds().includes('events-invite-src-other'), 'no other source, no row');
    assert.match(view.textOf('events-pay-refunds'), /RefundsNot recorded.*Revenue › Billing/s);
    assert.match(view.textOf('events-reminder-reminder_24h'), /24-hour reminderNot sent yet · due/);
    assert.match(view.textOf('events-history-created'), /^Created1 Oct 2026$/);
  } finally { await view.close(); }
});

test('mounted: one failed block fails its own card; the others still draw', async () => {
  const view = await mounted('/admin/events/41', worker({ event: LIVE_EVENT, summary: { ...SUMMARY, invitations: off(), payments: off('Payments down.') } }));
  try {
    assert.match(view.textOf('events-event-invitations'), /could not be read/i);
    assert.match(view.textOf('events-event-payments'), /could not be read/i);
    assert.match(view.textOf('events-event-tile-invitations'), /could not be read/i);
    assert.match(view.textOf('events-event-tile-paid'), /could not be read/i);
    assert.match(view.textOf('events-event-tile-free'), /Free seats2/);
    assert.match(view.textOf('events-event-funnel'), /Registered/);
    assert.match(view.textOf('events-event-reminders'), /24-hour reminder/);
    assert.doesNotMatch(view.textOf('events-event-invitations'), /Pending/, 'a failed block draws no zeros');
  } finally { await view.close(); }
});

test('mounted: a failed summary and history fail their cards, never the event', async () => {
  const view = await mounted('/admin/events/41', worker({ event: LIVE_EVENT, summary: () => response({ error: 'down' }, 500), history: () => response({ error: 'down' }, 500) }));
  try {
    assert.match(view.text(), /Demo night/);
    for (const id of ['events-event-seats', 'events-event-funnel', 'events-event-who', 'events-event-invitations', 'events-event-payments', 'events-event-reminders', 'events-event-history']) {
      assert.match(view.textOf(id), /could not be read/i, id);
    }
    assert.ok(!view.testIds().includes('events-event-host'), 'no host line is guessed');
    assert.match(view.textOf('events-event-gate'), /On the public calendar/, 'the event itself still draws');
  } finally { await view.close(); }
});

test('mounted: Cancel sends the note to registrants; Unpublish sends the note to the host; an empty note sends none', async () => {
  const view = await mounted('/admin/events/41', worker({ event: LIVE_EVENT }));
  try {
    await view.press('Cancel event');
    assert.match(view.textOf('events-cancel-dialog'), /Note to registrants · optional/);
    assert.match(view.textOf('events-cancel-paid'), /3 paid tickets \(\$120\)/);
    assert.equal(view.props('events-cancel-note').maxLength, NOTE_MAX);
    await view.change('events-cancel-note', { value: '  The venue flooded.  ' });
    assert.ok(view.props('events-cancel-go').disabled, 'the refund box comes first');
    await view.change('events-cancel-understood', { checked: true });
    await view.click('events-cancel-go');
    const cancel = view.requests.find((r) => r.method === 'POST' && r.url.endsWith('/cancel'));
    assert.deepEqual(JSON.parse(cancel.body), { note: 'The venue flooded.' }, 'trimmed');
  } finally { await view.close(); }

  const second = await mounted('/admin/events/41', worker({ event: LIVE_EVENT }));
  try {
    await second.press('Unpublish');
    assert.match(second.textOf('events-unpublish-dialog'), /The host is told, with your note\./);
    assert.match(second.textOf('events-unpublish-dialog'), /Note to the host · optional/);
    await second.click('events-unpublish-go');
    const un = second.requests.find((r) => r.method === 'POST' && r.url.endsWith('/unpublish'));
    assert.deepEqual(JSON.parse(un.body), {}, 'no note, no note field');
    assert.match(second.text(), /The host is told\./);
  } finally { await second.close(); }

  const free = ev(42, { title: 'Free supper', price_cents: 0, starts_at: iso(6, LIVE) });
  const third = await mounted('/admin/events/42', worker({ event: free, summary: { ...SUMMARY, payments: on({ ...SUMMARY.payments, price_cents: 0, paid: { count: 0, by_currency: [] } }) } }));
  try {
    await third.press('Cancel event');
    assert.ok(!third.testIds().includes('events-cancel-paid'), 'no one paid, no refund box');
    await third.change('events-cancel-note', { value: '   ' });
    await third.click('events-cancel-go');
    const cancel = third.requests.find((r) => r.method === 'POST' && r.url.endsWith('/cancel'));
    assert.deepEqual(JSON.parse(cancel.body), {}, 'a blank note sends none');
  } finally { await third.close(); }
});
