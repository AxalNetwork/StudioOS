// D1035 (#2876, part 5 of #2387) — My events' drawers and dialogs: the ticket
// at /my/events/ticket/[id] (MEV3, MEV3a–d), the hosted event at
// /my/events/hosting/[id] (MEV5, MEV5b), the publish dialogs (MEV6a–c), the
// cancel dialogs (MEV7a–b) and MEV17. Fixtures are worked out by hand in the
// shapes `GET /api/events` (D1032), `GET /api/events/:id` and
// `GET /api/calendar/event-links/:id` (D1033) send.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/my_events_drawers_d1035.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { useEffect } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { h, mountForm, sourceModule, textOf } from './_form_d695.mjs';
import { hostAction, tabOf } from '../src/pages/events/myEventsModel.js';
import {
  EXPLORER_CLOSED, MY_EVENTS_OPEN_TO_EXPLORERS, NOT_HOST, NO_PLACE, agendaRows, cancelEventDialog, cancelPlaceDialog, cancelledLine,
  drawerOf, gateOf, hostedPath, hostedTiles, joinLinkOf, mapsUrl, nextStep, placeFromDetail, placeIn, publishDialog, seatLine,
  tabUnder, ticketCard, ticketPath, ticketState, whoMayRegister,
} from '../src/pages/events/eventDrawersModel.js';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-10T12:00:00Z');
const at = (iso, end = null) => ({ starts_at: iso, ends_at: end, timezone: 'UTC' });
const DAY = 864e5;
const ahead = (days) => new Date(Date.now() + days * DAY).toISOString();

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the addresses: each drawer at its own, over the tab it opens from', () => {
  assert.equal(ticketPath(7), '/my/events/ticket/7');
  assert.equal(hostedPath(7), '/my/events/hosting/7');
  assert.deepEqual(drawerOf('/my/events/ticket/7'), { kind: 'ticket', id: 7 });
  assert.deepEqual(drawerOf('/my/events/hosting/7/'), { kind: 'hosted', id: 7 });
  assert.deepEqual(drawerOf('/my/events/ticket/abc'), { kind: 'ticket', id: null }, 'a bad id still opens the drawer, which says not found');
  assert.equal(drawerOf('/my/events/hosting'), null, 'the Hosting tab is not a drawer');
  assert.equal(drawerOf('/my/events/past'), null);
  assert.equal(tabOf('/my/events/ticket/7'), 'upcoming');
  assert.equal(tabOf('/my/events/hosting/7'), 'hosting');
  assert.equal(tabUnder({ kind: 'hosted' }), 'hosting');
  assert.equal(tabUnder({ kind: 'ticket' }), 'upcoming');
});

test('the ticket\'s four states with no code, in the canvas\'s words (MEV3a–d)', () => {
  const pay = { id: 5, title: 'Pricing Workshop', ...at('2026-11-19T10:00:00Z'), reg_status: 'confirmed', payment_status: 'pending', amount_cents: 4000, currency: 'usd' };
  assert.equal(ticketState(pay, NOW), 'pay');
  const p = ticketCard(pay, NOW);
  assert.equal(p.pill.label, 'Pay to confirm · $40');
  assert.equal(p.note, 'Your seat is held until you pay $40. The check-in code appears after payment.');
  assert.deepEqual(p.action, { label: 'Pay now', to: '/events/5' }, 'Pay now opens the existing checkout on the event page');

  const wait = { id: 2, ...at('2026-11-26T18:00:00Z'), reg_status: 'waitlisted', reg_waitlist_position: 3 };
  const w = ticketCard(wait, NOW);
  assert.equal(w.pill.label, 'Waitlist · #3');
  assert.match(w.note, /^You’re third on the waitlist\./);
  assert.equal(w.action.label, 'Leave the waitlist');
  assert.equal(ticketCard({ ...wait, reg_waitlist_position: 14 }, NOW).note.split('.')[0], 'You’re #14 on the waitlist');

  const host = { id: 3, ...at('2026-12-17T18:00:00Z'), reg_status: 'registered', payment_status: null };
  assert.equal(ticketCard(host, NOW).pill.label, 'Waiting for the host');
  assert.equal(ticketCard(host, NOW).foot, 'No check-in code until the host approves.');

  const declined = { id: 6, ...at('2027-04-16T18:00:00Z'), reg_status: 'declined', decision_reason: 'This session is for founders only.' };
  assert.equal(ticketCard(declined, NOW).pill.label, 'Declined by the host');
  assert.equal(ticketCard(declined, NOW).note, 'The host declined: ‘This session is for founders only.’');
  assert.match(ticketCard({ ...declined, decision_reason: null }, NOW).note, /No reason is recorded/);

  const going = { id: 1, ...at('2026-11-12T18:00:00Z'), reg_status: 'confirmed', payment_status: 'paid', checkin_code: 'K7Q2' };
  assert.equal(ticketState(going, NOW), 'going');
  assert.equal(ticketCard(going, NOW), null, 'a seat shows its code, not a state card');
  assert.equal(ticketState({ ...going, status: 'cancelled' }, NOW), 'event_cancelled');
  assert.equal(ticketState({ ...going, ...at('2026-10-01T18:00:00Z') }, NOW), 'ended');
});

test('your seat, the place and the join link, only as the reads sent them', () => {
  assert.deepEqual(seatLine({ comp: true, comp_source: 'startup_founder' }), { text: 'Free seat · Startup founder', sub: 'Given by an invitation.' });
  assert.equal(seatLine({ comp: true, comp_source: null, comp_source_recorded: false }).text, 'Free seat');
  assert.match(seatLine({ comp: true, comp_source: null }).sub, /Which rule is not recorded/, 'a rule comp is never guessed');
  assert.deepEqual(seatLine({ comp: false, amount_cents: 4000, currency: 'usd', payment_status: 'paid' }), { text: 'Paid ticket · $40', sub: 'Paid.' });
  assert.equal(seatLine({ comp: false, price_cents: 0 }).text, 'Free event');
  assert.equal(mapsUrl({ location_kind: 'in_person', location_text: 'Rua Exemplo 10, Lisbon' }), 'https://www.google.com/maps/search/?api=1&query=Rua%20Exemplo%2010%2C%20Lisbon');
  assert.equal(mapsUrl({ location_kind: 'virtual', location_text: 'Zoom' }), null);
  assert.equal(joinLinkOf({ location_kind: 'virtual', location_url: 'https://example.test/join' }), 'https://example.test/join');
  assert.equal(joinLinkOf({ location_kind: 'virtual', location_url: null }), null, 'no link sent, none drawn');
  assert.equal(joinLinkOf({ location_kind: 'in_person', location_url: 'https://maps.test' }), null);
  assert.deepEqual(agendaRows([{ id: 1, title: 'Welcome', starts_at: '2026-11-12T18:00:00Z', speaker_name: 'Ana', speaker_title: 'Host' }], 'UTC'),
    [{ key: 1, at: '18:00', title: 'Welcome', speaker: 'Ana · Host' }]);
});

test('the place: Upcoming first, then Past\'s page, then the event read', () => {
  const list = { attending: [{ id: 1, reg_status: 'confirmed' }], past: { places: [{ id: 6, reg_status: 'declined' }] } };
  assert.equal(placeIn(list, 1).reg_status, 'confirmed');
  assert.equal(placeIn(list, '6').reg_status, 'declined');
  assert.equal(placeIn(list, 9), null);
  const p = placeFromDetail({ event: { id: 9, title: 'Old' }, registration: { id: 90, status: 'attended', payment_status: 'paid', waitlist_position: null } });
  assert.equal(p.reg_status, 'attended');
  assert.equal(p.registration_id, 90);
  assert.equal(placeFromDetail({ event: { id: 9 }, registration: null }), null, 'no registration, no place');
});

test('the publish gate and what to do next, for each status (MEV5b)', () => {
  assert.match(gateOf({ status: 'published', visibility: 'public' }).text, /Approved by an admin ✓ → On the public calendar/);
  assert.equal(gateOf({ status: 'pending_review', visibility: 'public' }).tone, 'warn');
  assert.match(gateOf({ status: 'published', visibility: 'private' }).text, /Reached by invitation only/);
  assert.match(gateOf({ status: 'published', visibility: 'unlisted' }).text, /Anyone with the link can register/);
  assert.equal(gateOf({ status: 'cancelled', visibility: 'public' }), null);

  const draft = { id: 12, ...at('2026-12-10T18:00:00Z'), status: 'draft', visibility: 'public' };
  assert.deepEqual(nextStep(draft, null, NOW).actions.map((a) => a.label), ['Edit details', 'Send for review']);
  assert.deepEqual(nextStep({ ...draft, visibility: 'private' }, null, NOW).actions.map((a) => a.label), ['Edit details', 'Publish']);
  assert.match(nextStep({ ...draft, ...at('2026-11-05T18:00:00Z') }, null, NOW).title, /start date has passed/);
  assert.equal(nextStep({ ...draft, status: 'rejected', review_note: 'Add the venue address.' }, null, NOW).note, '‘Add the venue address.’');
  assert.equal(nextStep({ ...draft, status: 'pending_review', submitted_at: '2026-11-05T10:00:00Z' }, null, NOW).title, 'Submitted 5 Nov.');
  const pub = { ...draft, status: 'published' };
  assert.equal(nextStep(pub, { seats_taken: 4 }, NOW).title, 'Registration is open.');
  const today = { ...pub, ...at('2026-11-10T17:00:00Z', '2026-11-10T20:00:00Z') };
  const t = nextStep(today, { seats_taken: 42, checked_in: 31 }, NOW);
  assert.equal(t.title, 'Check-in is open.');
  assert.equal(t.progress.text, '31 of 42 checked in');
  assert.equal(t.actions[0].to, '/events/12/manage/check-in');
  assert.equal(nextStep({ ...pub, ...at('2026-11-01T17:00:00Z') }, { seats_taken: 42, checked_in: 31 }, NOW).title, '31 of 42 came.');
  assert.match(nextStep({ ...pub, ...at('2026-11-01T17:00:00Z') }, null, NOW).title, /not read here/, 'no counts, no number');
});

test('the four tiles: counts from the list, Checked in a dash until the day, never a 0 for what was not read', () => {
  const ev = { ...at('2026-11-20T18:00:00Z'), capacity: 60 };
  const counts = { seats_taken: 42, waitlisted: 6, pending_approvals: 3, checked_in: 0 };
  assert.deepEqual(hostedTiles(ev, counts, NOW).map((x) => [x.key, x.value, x.sub || null]), [
    ['seats', '42 of 60', null], ['waitlist', '6', null], ['approve', '3', null], ['checked', '—', 'Not held yet']]);
  assert.equal(hostedTiles({ ...ev, ...at('2026-11-10T09:00:00Z', '2026-11-10T22:00:00Z') }, counts, NOW)[3].value, '0', 'on the day, a real 0');
  assert.equal(hostedTiles({ ...ev, capacity: null }, counts, NOW)[0].sub, 'No seat limit');
  assert.ok(hostedTiles(ev, null, NOW).every((x) => x.value === null), 'counts not read: Not read here yet, never 0');
});

test('who may register, from the audience rules', () => {
  assert.deepEqual(whoMayRegister({ audience_rules: { mode: 'selected', roles: ['founder', 'investor'], comp_official_partners: true, comp_invested_lps: true } }),
    ['Selected profiles: Founder, Investor', 'Free seats for: Official partners, Invested LPs']);
  assert.deepEqual(whoMayRegister({ audience_rules: {}, approval_required: true }), ['Everyone with an account', 'No free seats by rule', 'The host approves each registration']);
  assert.deepEqual(whoMayRegister({ audience_rules: { mode: 'invite_only' } }), ['Invite only', 'No free seats by rule']);
  assert.equal(whoMayRegister({}), null, 'not sent, not read');
});

test('the publish dialogs (MEV6a–c): what changes and who is told', () => {
  const pub = publishDialog({ id: 1, title: 'Pricing Workshop', status: 'draft', visibility: 'public' }, null);
  assert.equal(pub.title, 'Send Pricing Workshop for review?');
  assert.equal(pub.action, 'Send for review');
  assert.ok(pub.lines.includes('Admins see it in their review queue. No one else is told.'));
  const unl = publishDialog({ title: 'Operators Social', status: 'draft', visibility: 'unlisted' }, null);
  assert.equal(unl.title, 'Publish Operators Social?');
  assert.equal(unl.lines[0], 'It goes live now. Anyone with the link can register. It is not listed on the public calendar.');
  const pri = publishDialog({ title: 'LP Briefing', status: 'rejected', visibility: 'private' }, { invitations_open: 12 });
  assert.ok(pri.lines.includes('12 invitations are waiting for this.'));
  assert.ok(publishDialog({ title: 'x', status: 'draft', visibility: 'private' }, null).lines.includes('How many invitations are waiting is not read here.'));
  assert.equal(publishDialog({ status: 'published', visibility: 'public' }, null), null, 'only a draft or a sent-back event');
  assert.deepEqual(hostAction({ id: 12, ...at('2026-12-10T18:00:00Z'), status: 'draft', visibility: 'public' }, NOW), { label: 'Send for review', dialog: 'publish' });
  assert.deepEqual(hostAction({ id: 12, ...at('2026-12-10T18:00:00Z'), status: 'draft', visibility: 'private' }, NOW), { label: 'Publish', dialog: 'publish' });
  assert.deepEqual(hostAction({ id: 11, ...at('2026-11-01T18:00:00Z'), status: 'draft', visibility: 'private' }, NOW), { label: 'Edit details', to: '/events/11/edit' }, 'a draft whose date passed');
});

test('the cancel dialogs (MEV7a–b): the paid box only for a paid seat or event, and who is told', () => {
  const seat = { id: 1, title: 'Founder Breakfast', ...at('2026-11-26T08:00:00Z'), reg_status: 'confirmed', payment_status: 'paid', amount_cents: 1500 };
  const d = cancelPlaceDialog(seat, NOW);
  assert.equal(d.title, 'Cancel your place at Founder Breakfast?');
  assert.equal(d.paidBox, 'StudioOS does not refund a place you cancel. Ask the studio team about a refund.');
  assert.equal(cancelPlaceDialog({ ...seat, payment_status: null, amount_cents: null }, NOW).paidBox, null, 'a free seat has no box');
  assert.equal(cancelPlaceDialog({ ...seat, payment_status: 'pending' }, NOW).paidBox, null, 'a seat not yet paid has no box');
  assert.equal(cancelPlaceDialog({ ...seat, reg_status: 'waitlisted' }, NOW).action, 'Leave the waitlist');
  assert.equal(cancelPlaceDialog({ ...seat, reg_status: 'declined' }, NOW), null, 'a declined place has nothing to cancel');
  assert.equal(cancelPlaceDialog({ ...seat, ...at('2026-10-01T08:00:00Z') }, NOW), null, 'nor one that ended');

  const ev = { id: 13, title: 'Operators Social', ...at('2026-11-20T18:00:00Z'), status: 'published', price_cents: 4000 };
  const e = cancelEventDialog(ev, { seats_taken: 48, waitlisted: 6 }, NOW);
  assert.equal(e.title, 'Cancel Operators Social?');
  assert.equal(e.sub, 'This cannot be undone.');
  assert.ok(e.lines.includes('48 people registered and 6 people waitlisted get a notice.'));
  assert.match(e.paidBox, /paid to the studio, not to you/);
  assert.equal(cancelEventDialog({ ...ev, price_cents: 0 }, { seats_taken: 0, waitlisted: 0 }, NOW).paidBox, null);
  assert.ok(cancelEventDialog({ ...ev, price_cents: 0 }, { seats_taken: 0, waitlisted: 0 }, NOW).lines.includes('No one holds a place yet, so no one gets a notice.'));
  assert.ok(cancelEventDialog(ev, null, NOW).lines.includes('Everyone who holds a place or a waitlist spot gets a notice.'), 'counts not read: no number');
  assert.equal(cancelEventDialog({ ...ev, status: 'cancelled' }, null, NOW), null);
  assert.equal(cancelledLine({ paid_tickets: { count: 5, by_currency: [{ currency: 'usd', amount_cents: 20000 }] } }), 'Event cancelled. 5 paid tickets ($200) went to the Events desk for refunds.');
  assert.equal(cancelledLine({ paid_tickets: { count: 0, by_currency: [] } }), 'Event cancelled. No paid tickets to refund.');
});

test('MEV17: the words, and the Explorer card kept for a closed My events', () => {
  assert.equal(NOT_HOST, 'Only the host and studio admins manage this event.');
  assert.equal(EXPLORER_CLOSED.title, 'Events open once your profile is set.');
  assert.equal(MY_EVENTS_OPEN_TO_EXPLORERS, true, 'D1030 opened My events to Explorers (MEV2)');
});

/* ------------------------------------------------------------------ *
 * The page, mounted at each address on stubbed reads
 * ------------------------------------------------------------------ */

const key = '__myEventsD1035';
const LIST = () => ({
  attending: [
    { id: 1, slug: 'pricing', title: 'Pricing Workshop', ...at(ahead(5)), location_kind: 'virtual', location_url: 'https://example.test/join', reg_status: 'confirmed', payment_status: 'paid', amount_cents: 4000, currency: 'usd', comp: false, checkin_code: 'K7Q2-9X4M' },
    { id: 2, title: 'Investor Fireside', ...at(ahead(12)), location_kind: 'in_person', location_text: 'Rua Exemplo 10', reg_status: 'waitlisted', reg_waitlist_position: 3, comp: false, checkin_code: null },
    { id: 5, title: 'Office Hours', ...at(ahead(20)), location_kind: 'virtual', reg_status: 'confirmed', payment_status: 'pending', amount_cents: 1500, currency: 'eur', comp: false, checkin_code: null },
  ],
  past: { places: [{ id: 6, title: 'Founders Circle', ...at(ahead(40)), reg_status: 'declined', decision_reason: 'This session is for founders only.' }], total: 1, limit: 20, offset: 0 },
  hosting: [
    { id: 13, slug: 'demo-night', title: 'Open Demo Night', host_user_id: 2, ...at(ahead(9)), status: 'published', visibility: 'public', capacity: 60, price_cents: 0,
      audience_rules: { mode: 'selected', roles: ['founder'], comp_invested_lps: true }, counts: { seats_taken: 42, waitlisted: 6, pending_approvals: 3, checked_in: 0, invitations_open: 0 } },
    { id: 18, title: 'LP Briefing', host_user_id: 2, ...at(ahead(30)), status: 'draft', visibility: 'private', capacity: 20, price_cents: 0, audience_rules: {},
      counts: { seats_taken: 0, waitlisted: 0, pending_approvals: 0, checked_in: 0, invitations_open: 12 } },
  ],
});

function prepare(o = {}) {
  const calls = [];
  globalThis[key] = {
    user: o.user || { id: 2, role: 'founder' },
    toasts: [],
    calls,
    api: {
      list: o.list || (async () => { calls.push(['list']); return LIST(); }),
      suggested: async () => ({ events: [] }),
      icsUrl: (id) => `/api/events/${id}/ics`,
      get: o.get || (async (id) => { calls.push(['get', id]); return { event: { id, title: 'Pricing Workshop' }, registration: null, agenda: [{ id: 1, title: 'Welcome', starts_at: ahead(5), speaker_name: 'Ana' }] }; }),
      calendarLinks: o.links || (async (id) => ({ event_id: id, google: 'https://calendar.google.test/x', outlook: 'https://outlook.test/x', ics: `/api/events/${id}/ics` })),
      cancelPlace: async (id) => { calls.push(['cancelPlace', id]); return { ok: true }; },
      submitReview: async (id) => { calls.push(['submitReview', id]); return { event: { id } }; },
      cancel: o.cancel || (async (id, note) => { calls.push(['cancel', id, note]); return { paid_tickets: { count: 0, by_currency: [] } }; }),
    },
  };
  globalThis[key].toast = { toast: null, showToast: (t) => globalThis[key].toasts.push(t) };
}

const drawersSource = read('frontend/src/pages/events/MyEventsDrawers.jsx')
  .replace(/import \{ eventsApi \} from [^;]+;/, `const eventsApi = globalThis.${key}.api;`)
  .replace(/import EventQRCode[^;]+;/, 'const EventQRCode = ({ value }) => <canvas data-ticket-code={value} />;');
const pageSource = read('frontend/src/pages/events/MyEventsPage.jsx')
  .replace(/import \{ eventsApi \} from [^;]+;/, `const eventsApi = globalThis.${key}.api;`)
  .replace(/import \{ eventsPublic \} from [^;]+;/, 'const eventsPublic = { list: async () => ({ events: [] }) };')
  .replace(/import \{ adminEvents \} from [^;]+;/, 'const adminEvents = { list: async () => ({ total: 0 }) };')
  .replace(/import \{ useAuth \} from [^;]+;/, `const useAuth = () => ({ user: globalThis.${key}.user });`)
  .replace(/import \{ useToast \} from [^;]+;/, `const useToast = () => globalThis.${key}.toast;`)
  .replace(/import PageExplainer[^;]+;/, 'const PageExplainer = () => null;')
  .replace(/import EventQRCode[^;]+;/, 'const EventQRCode = ({ value }) => <canvas data-ticket-code={value} />;')
  .replace(/import \{ usePhoneWidth \} from [^;]+;/, 'const usePhoneWidth = () => false;')
  .replace(/import \{ ExplorerClosedCard, HostedDrawer, PublishDialog, TicketDrawer \} from '\.\/MyEventsDrawers';/, `const { ExplorerClosedCard, HostedDrawer, PublishDialog, TicketDrawer } = globalThis.${key}.drawers;`);

async function mount(url, { modal = false } = {}) {
  globalThis[key].drawers = await sourceModule(drawersSource, 'pages/events/MyEventsDrawers.jsx');
  const Page = (await sourceModule(pageSource, 'pages/events/MyEventsPage.jsx')).default;
  const where = { path: '/' };
  function Go() {
    const nav = useNavigate();
    const loc = useLocation();
    where.path = loc.pathname;
    useEffect(() => { nav(url); }, []);
    return null;
  }
  const ui = await mountForm(h(React.Fragment, null, h(Go), h(Routes, null, h(Route, { path: '/my/events/*', element: h(Page) }), h(Route, { path: '*', element: null }))), { modal });
  for (let i = 0; i < 4; i += 1) await ui.flush();
  const ids = () => ui.nodes().map((n) => ui.props(n)['data-testid']).filter(Boolean);
  const textIn = (id) => textOf(ui.by(id));
  const hrefs = () => ui.nodes().map((n) => ui.props(n).to || ui.props(n).href).filter(Boolean);
  const press = async (id) => { const n = ui.by(id); assert.ok(n, `no ${id}`); await ui.flush(); await (async () => { const { act } = await import('react'); await act(async () => { await ui.props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); })(); for (let i = 0; i < 4; i += 1) await ui.flush(); };
  return { ...ui, ids, has: (id) => ids().includes(id), textIn, hrefs, press, where };
}

test('the ticket at /my/events/ticket/1: the code, when and where, Add to calendar, the seat and the agenda (MEV3)', async () => {
  prepare();
  const ui = await mount('/my/events/ticket/1');
  try {
    assert.ok(ui.has('my-events-ticket-drawer'));
    assert.ok(ui.has('my-events'), 'the drawer sits over Upcoming');
    assert.equal(ui.textIn('my-events-ticket-code-text'), 'K7Q2-9X4M');
    assert.match(ui.textIn('my-events-ticket-code'), /Show this at the door\. The host scans it to check you in\./);
    assert.equal(ui.textIn('my-events-ticket-place'), 'Going');
    assert.ok(ui.has('my-events-ticket-join'), 'an online seat holder gets the join link');
    assert.deepEqual(ui.hrefs().filter((u) => u.startsWith('https://') && u.endsWith('.test/x')).sort(), ['https://calendar.google.test/x', 'https://outlook.test/x']);
    assert.ok(ui.hrefs().includes('/api/events/1/ics'));
    assert.equal(ui.textIn('my-events-ticket-seat'), 'Your seatPaid ticket · $40Paid.');
    assert.equal(ui.textIn('my-events-ticket-agenda-row').replace(/\d\d:\d\d/, 'HH:MM'), 'HH:MMWelcomeAna');
    assert.match(ui.textIn('my-events-ticket-host'), /not read here yet/);
    assert.ok(ui.hrefs().includes('/events/pricing'), 'Open event page');
  } finally { await ui.unmount(); }
});

test('the ticket\'s states drawn with no code: Pay to confirm, Waitlist, Declined (from Past)', async () => {
  prepare();
  let ui = await mount('/my/events/ticket/5');
  try {
    assert.ok(ui.has('my-events-ticket-state-pay'));
    assert.equal(ui.textIn('my-events-ticket-place'), 'Pay to confirm · €15');
    assert.ok(ui.hrefs().includes('/events/5'), 'Pay now opens the checkout on the event page');
    assert.ok(!ui.has('my-events-ticket-code-text'));
    assert.ok(!ui.has('my-events-ticket-join'), 'no join link before the seat is paid');
  } finally { await ui.unmount(); }
  ui = await mount('/my/events/ticket/2');
  try {
    assert.equal(ui.textIn('my-events-ticket-place'), 'Waitlist · #3');
    assert.equal(ui.textIn('my-events-ticket-cancel'), 'Leave the waitlist');
    assert.ok(ui.hrefs().some((x) => x.startsWith('https://www.google.com/maps/search/')), 'Open in maps for an in-person place');
  } finally { await ui.unmount(); }
  ui = await mount('/my/events/ticket/6');
  try {
    assert.equal(ui.textIn('my-events-ticket-place'), 'Declined by the host');
    assert.equal(ui.textIn('my-events-ticket-note'), 'The host declined: ‘This session is for founders only.’');
    assert.ok(!ui.has('my-events-ticket-cancel'), 'nothing to cancel');
  } finally { await ui.unmount(); }
});

test('a ticket the list does not hold: from the event read, else "You hold no place"; a failed calendar or agenda read fails alone', async () => {
  prepare({ get: async (id) => ({ event: { id, title: 'Old Meetup', ...at(ahead(3)), location_kind: 'virtual' }, registration: { id: 90, status: 'registered', payment_status: null }, agenda: [] }) });
  let ui = await mount('/my/events/ticket/44');
  try {
    assert.equal(ui.textIn('my-events-ticket-place'), 'Waiting for the host');
  } finally { await ui.unmount(); }
  prepare();
  ui = await mount('/my/events/ticket/44');
  try {
    assert.equal(ui.textIn('my-events-ticket-none').startsWith(NO_PLACE), true);
  } finally { await ui.unmount(); }
  prepare({ links: async () => { throw new Error('down'); }, get: async () => { throw Object.assign(new Error('down'), { status: 500 }); } });
  ui = await mount('/my/events/ticket/1');
  try {
    assert.ok(ui.has('my-events-ticket-calendar-unread'));
    assert.ok(ui.hrefs().includes('/api/events/1/ics'), 'the .ics stands');
    assert.ok(ui.has('my-events-ticket-agenda-unread'));
    assert.equal(ui.textIn('my-events-ticket-code-text'), 'K7Q2-9X4M', 'the rest of the ticket stands');
  } finally { await ui.unmount(); }
});

test('Cancel my place opens MEV7a; confirming cancels through DELETE, re-reads the list and goes back to Upcoming', async () => {
  prepare();
  const ui = await mount('/my/events/ticket/1');
  try {
    await ui.press('my-events-ticket-cancel');
    assert.ok(ui.has('my-events-cancel-place'));
    assert.match(ui.textIn('my-events-cancel-place-body'), /Your seat goes to the next person on the waitlist/);
    assert.equal(ui.textIn('my-events-cancel-place-paid'), '! StudioOS does not refund a place you cancel. Ask the studio team about a refund.');
    const before = globalThis[key].calls.filter((c) => c[0] === 'list').length;
    await ui.press('my-events-cancel-place-go');
    assert.deepEqual(globalThis[key].calls.find((c) => c[0] === 'cancelPlace'), ['cancelPlace', 1]);
    assert.ok(globalThis[key].calls.filter((c) => c[0] === 'list').length > before, 'the list is read again');
    assert.equal(ui.where.path, '/my/events');
    assert.equal(globalThis[key].toasts.at(-1).msg, 'Your place is cancelled.');
  } finally { await ui.unmount(); }
});

test('the hosted event at /my/events/hosting/13: gate, next step, tiles, who may register, host pages (MEV5)', async () => {
  prepare();
  const ui = await mount('/my/events/hosting/13');
  try {
    assert.ok(ui.has('my-events-hosted-drawer'));
    assert.ok(ui.has('my-events-tabs'), 'over Hosting');
    assert.match(ui.textIn('my-events-hosted-gate'), /On the public calendar/);
    assert.equal(ui.textIn('my-events-hosted-next-title'), 'Registration is open.');
    assert.match(ui.textIn('my-events-hosted-tile-seats'), /42 of 60/);
    assert.match(ui.textIn('my-events-hosted-tile-waitlist'), /6/);
    assert.match(ui.textIn('my-events-hosted-tile-approve'), /3/);
    assert.match(ui.textIn('my-events-hosted-tile-checked'), /—Not held yet/);
    assert.match(ui.textIn('my-events-hosted-who'), /Selected profiles: Founder/);
    assert.match(ui.textIn('my-events-hosted-who'), /Free seats for: Invested LPs/);
    for (const to of ['/events/13/edit', '/events/13/manage', '/events/13/manage/registrations', '/events/13/manage/agenda']) assert.ok(ui.hrefs().includes(to), to);
    assert.ok(!globalThis[key].calls.some((c) => c[0] === 'get'), 'a host\'s own event needs no second read');
  } finally { await ui.unmount(); }
});

test('Cancel event opens MEV7b with who is told and an optional note; confirming uses the host\'s cancel', async () => {
  prepare({ cancel: async (id, note) => { globalThis[key].calls.push(['cancel', id, note]); return { paid_tickets: { count: 2, by_currency: [{ currency: 'usd', amount_cents: 8000 }] } }; } });
  const ui = await mount('/my/events/hosting/13');
  try {
    await ui.press('my-events-hosted-cancel');
    assert.ok(ui.has('my-events-cancel-event'));
    assert.match(ui.textIn('my-events-cancel-event-body'), /42 people registered and 6 people waitlisted get a notice\./);
    assert.ok(!ui.has('my-events-cancel-event-paid'), 'a free event has no paid-ticket box');
    const { act } = await import('react');
    await act(async () => { ui.props(ui.by('my-events-cancel-event-note')).onChange({ target: { value: '  Venue fell through.  ' } }); });
    await ui.press('my-events-cancel-event-go');
    assert.deepEqual(globalThis[key].calls.find((c) => c[0] === 'cancel'), ['cancel', 13, 'Venue fell through.']);
    assert.equal(globalThis[key].toasts.at(-1).msg, 'Event cancelled. 2 paid tickets ($80) went to the Events desk for refunds.');
    assert.equal(ui.where.path, '/my/events/hosting');
  } finally { await ui.unmount(); }
});

test('a refused cancel stays in its dialog, says why, and changes nothing', async () => {
  prepare({ cancel: async () => { throw new Error('This event is already cancelled.'); } });
  const ui = await mount('/my/events/hosting/13');
  try {
    await ui.press('my-events-hosted-cancel');
    await ui.press('my-events-cancel-event-go');
    assert.equal(ui.textIn('my-events-cancel-event-refusal'), 'This event is already cancelled.');
    assert.ok(ui.has('my-events-cancel-event'), 'the dialog stays open');
    assert.equal(ui.where.path, '/my/events/hosting/13');
  } finally { await ui.unmount(); }
});

test('Publish from the drawer and from the Hosting row (MEV6c), through submit-review', async () => {
  prepare();
  let ui = await mount('/my/events/hosting/18');
  try {
    await ui.press('my-events-hosted-publish');
    assert.ok(ui.has('my-events-publish'));
    assert.match(ui.textIn('my-events-publish-body'), /Only people you invite can see it and register\./);
    assert.match(ui.textIn('my-events-publish-body'), /12 invitations are waiting for this\./);
    await ui.press('my-events-publish-go');
    assert.deepEqual(globalThis[key].calls.find((c) => c[0] === 'submitReview'), ['submitReview', 18]);
    assert.equal(ui.where.path, '/my/events/hosting');
  } finally { await ui.unmount(); }
  prepare();
  ui = await mount('/my/events/hosting');
  try {
    const row = ui.nodes().find((n) => ui.props(n)['data-testid'] === 'my-events-host-action' && n.tagName === 'BUTTON');
    assert.ok(row, 'the draft row\'s Publish is a button that opens the dialog');
    const { act } = await import('react');
    await act(async () => { ui.props(row).onClick(); });
    await ui.flush();
    assert.ok(ui.has('my-events-publish'));
    assert.ok(ui.hrefs().includes('/my/events/hosting/13'), 'a Hosting row opens its drawer');
  } finally { await ui.unmount(); }
});

test('MEV17: an event you do not host; an admin manages it with the counts said as not read', async () => {
  prepare({ get: async (id) => ({ event: { id, slug: 'roundtable', title: 'Climate Roundtable', host_user_id: 99, ...at(ahead(8)), status: 'published', visibility: 'public' }, registration: null, agenda: [] }) });
  let ui = await mount('/my/events/hosting/77');
  try {
    assert.match(ui.textIn('my-events-not-host'), /Only the host and studio admins manage this event\./);
    assert.match(ui.textIn('my-events-not-host'), /Climate Roundtable is not an event you host\./);
    assert.ok(!ui.has('my-events-hosted-cancel'));
  } finally { await ui.unmount(); }
  prepare({ user: { id: 5, role: 'admin' }, get: async (id) => ({ event: { id, title: 'Climate Roundtable', host_user_id: 99, ...at(ahead(8)), status: 'published', visibility: 'public', audience_rules: {} }, registration: null, agenda: [] }) });
  ui = await mount('/my/events/hosting/77');
  try {
    assert.ok(ui.has('my-events-hosted-body'), 'an admin manages it');
    assert.match(ui.textIn('my-events-hosted-tile-seats'), /Not read here yet/, 'never a 0 for counts not read');
  } finally { await ui.unmount(); }
  prepare({ get: async () => { throw Object.assign(new Error('forbidden'), { status: 403 }); } });
  ui = await mount('/my/events/hosting/78');
  try {
    assert.ok(ui.has('my-events-not-host'), 'a refused read is MEV17 too, with no title');
  } finally { await ui.unmount(); }
});

test('the drawers trap focus, close on Escape back to their tab and return focus to what opened them', async () => {
  prepare();
  const ui = await mount('/my/events/ticket/1', { modal: true });
  try {
    const opener = ui.opener;
    assert.ok(ui.has('my-events-ticket-drawer'));
    assert.notEqual(ui.doc.activeElement, opener, 'focus moved into the drawer');
    await ui.escape();
    for (let i = 0; i < 3; i += 1) await ui.flush();
    assert.equal(ui.where.path, '/my/events');
    assert.ok(!ui.has('my-events-ticket-drawer'));
    assert.equal(ui.doc.activeElement, opener, 'focus is back where it was');
  } finally { await ui.unmount(); }
});

test('the rows are wired: Show ticket on Upcoming, and Discover\'s held place', async () => {
  prepare();
  const ui = await mount('/my/events');
  try {
    assert.ok(ui.hrefs().includes('/my/events/ticket/1'), 'the next event\'s Show ticket');
    assert.ok(ui.hrefs().includes('/my/events/ticket/2'), 'a Going row\'s Show ticket');
  } finally { await ui.unmount(); }
});

test('the source: the two routes under My events\' guard, notices open the drawers, the clients name their Worker routes', () => {
  const app = read('frontend/src/App.jsx');
  for (const p of ['/my/events/ticket/:eventId', '/my/events/hosting/:eventId']) {
    assert.ok(app.includes(`<Route path="${p}" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <MyEventsPage />)} />`), p);
  }
  const links = read('cloudflare-worker/src/services/eventLinks.ts');
  assert.match(links, /return `\/my\/events\/ticket\/\$\{Number\(eventId\)\}`;/);
  assert.match(links, /return `\/my\/events\/hosting\/\$\{Number\(eventId\)\}`;/);
  const client = read('frontend/src/lib/eventsApi.js');
  assert.match(client, /cancelPlace: \(id\) => request\(`\/events\/\$\{id\}\/registration`, \{ method: 'DELETE' \}\)/);
  assert.match(client, /calendarLinks: \(id\) => request\(`\/calendar\/event-links\/\$\{encodeURIComponent\(String\(id\)\)\}`\)/);
  assert.match(read('cloudflare-worker/src/routes/calendar.ts'), /calendar\.get\('\/event-links\/:event_id'/);
  assert.match(read('cloudflare-worker/src/routes/events.ts'), /events\.delete\('\/:id\/registration'/);
  const drawers = read('frontend/src/pages/events/MyEventsDrawers.jsx');
  assert.doesNotMatch(drawers, /window\.confirm|window\.alert|\balert\(/, 'no browser pop-up');
});
