// D1034 (#2875) — My events' four tabs complete: Needs you, the month
// calendar and Month view, Hosting's counts, filters, menu and pages,
// Discover's chips, filters and actions, Past's chart, filters and years, and
// the states. The model is tested on a fixed clock; the page is mounted at
// each address on stubbed reads (`GET /api/events`, `/invitations`,
// `/api/calendar/my-events/feed`, `GET /api/public/events`, `/eligibility`).
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/my_events_tabs_d1034.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Routes, Route } from 'react-router-dom';
import { h, mountForm, propsOf, sourceModule, textOf } from './_form_d695.mjs';
import {
  dayLabel, discoverMonths, discoverRow, hostCounts, hostMenu, hostingView, invitationDialog, monthCells, needsYouRows,
  pageOf, pastAll, pastChart, pastView, pastYears, registerDialog, tabCountsFull, typeChips,
} from '../src/pages/events/myEventsTabsModel.js';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const pagePath = 'pages/events/MyEventsPage.jsx';
const page = read('frontend/src/' + pagePath);
const NOW = Date.parse('2026-11-10T12:00:00Z');
const iso = (t) => new Date(t).toISOString();
const DAY = 864e5;

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('Needs you: Pay to confirm, Sent back with its note, each invitation, Off the waitlist; four drawn, the total kept', () => {
  const attending = [
    { id: 1, registration_id: 101, title: 'Pricing Workshop', starts_at: iso(NOW + 9 * DAY), reg_status: 'confirmed', payment_status: 'pending', amount_cents: 4000, currency: 'usd' },
    { id: 2, registration_id: 102, title: 'Operators Social', starts_at: iso(NOW + 20 * DAY), reg_status: 'confirmed', payment_status: 'pending', promoted_at: iso(NOW - DAY) },
    { id: 3, registration_id: 103, title: 'Old Paid', starts_at: iso(NOW - 5 * DAY), reg_status: 'confirmed', payment_status: 'pending' },
  ];
  const hosting = [{ id: 10, title: 'Founder Breakfast', status: 'rejected', review_note: 'Add the venue address.' }];
  const invitations = [1, 2].map((k) => ({ invitation_id: k, comp: k === 1, host_name: 'Ada Host', event: { id: 50 + k, title: `Roundtable ${k}`, starts_at: iso(NOW + 16 * DAY) } }));
  const r = needsYouRows({ hosting, attending, invitations, now: NOW });
  assert.deepEqual(r.rows.map((x) => x.kind), ['pay', 'sent', 'invitation', 'invitation']);
  assert.equal(r.total, 5, 'the promoted row is counted though a fifth is not drawn');
  assert.equal(r.rows[0].text, 'Your seat at Pricing Workshop is held until you pay $40.');
  assert.equal(r.rows[1].text, 'Founder Breakfast was sent back by an admin: ‘Add the venue address.’');
  assert.equal(r.rows[2].text, 'Ada Host invited you to Roundtable 1 · Free seat.');
  assert.ok(!r.rows.some((x) => x.key === 'pay-102'), 'a promoted place that owes payment is one row, not two');
  assert.ok(!r.rows.some((x) => x.key === 'pay-103'), 'a past event asks nothing');
  const accept = invitationDialog(invitations[1], 'accept');
  assert.match(accept.lines.join(' '), /Ada Host sees that you accepted/);
  assert.match(accept.lines.join(' '), /If the event is full, the invitation stays open/);
  assert.equal(invitationDialog(invitations[0], 'decline').action, 'Decline');
});

test('the month: six weeks, Monday first, today marked, going and hosting counted by the member\'s day', () => {
  const items = [
    { key: 'a', kind: 'going', event: { starts_at: '2026-11-12T18:00:00Z' } },
    { key: 'b', kind: 'hosting', event: { starts_at: '2026-11-12T20:00:00Z' } },
    { key: 'c', kind: 'waitlist', event: { starts_at: '2026-11-26T18:00:00Z' } },
  ];
  const cells = monthCells({ year: 2026, month: 10 }, items, NOW, 'UTC');
  assert.equal(cells.length, 42);
  assert.equal(cells[0].key, '2026-10-26', '1 November 2026 is a Sunday, so the grid opens on Monday 26 October');
  assert.equal(cells.filter((c) => c.today).map((c) => c.key).join(), '2026-11-10');
  const twelfth = cells.find((c) => c.key === '2026-11-12');
  assert.deepEqual([twelfth.going, twelfth.hosting, twelfth.items.length], [1, 1, 2]);
  assert.equal(cells.find((c) => c.key === '2026-11-26').going, 0, 'a waitlist place is not a Going dot');
  assert.equal(dayLabel(twelfth, 'November'), '12 November: 2 events: going to 1, hosting 1');
  // The same instant, read in Tokyo, is the next day.
  assert.equal(monthCells({ year: 2026, month: 10 }, [items[1]], NOW, 'Asia/Tokyo').find((c) => c.key === '2026-11-13').hosting, 1);
});

test('Hosting: the counts in the canvas\'s words, a missing read never a zero, filters, sorts and pages', () => {
  assert.deepEqual(hostCounts({ capacity: 60, counts: { seats_taken: 42, waitlisted: 6, pending_approvals: 3, invitations_open: 12 } }),
    { taken: 42, cap: 60, pct: 70, line: '42 of 60 taken', extra: '6 waitlist · 3 to approve · 12 invitations open' });
  assert.equal(hostCounts({ capacity: null, counts: { seats_taken: 14, pending_approvals: 2 } }).line, 'No cap · 14 taken');
  assert.equal(hostCounts({ capacity: 60, counts: { seats_taken: 0 } }).line, '0 of 60 taken', 'the read\'s 0 is a count');
  assert.equal(hostCounts({ capacity: 60 }), null, 'no counts sent: not read, never 0');
  assert.equal(hostCounts({ capacity: 60, counts: { waitlisted: 2 } }), null, 'counts with no seats figure: not read, never 0 taken');
  const ev = (id, days, o = {}) => ({ id, title: `Event ${id}`, starts_at: iso(NOW + days * DAY), status: 'published', visibility: 'public', ...o });
  const hosting = [ev(1, 5), ev(2, -5), ev(3, 9, { status: 'draft', visibility: 'private' }), ev(4, -20, { status: 'draft' }), ev(5, 2, { status: 'cancelled' })];
  const ids = (v) => v.groups.flatMap((g) => g.rows.map((e) => e.id));
  assert.deepEqual(ids(hostingView(hosting, { when: 'upcoming', sort: 'soonest' }, NOW)).sort(), [1, 3, 4, 5], 'a draft whose date passed still needs its host');
  assert.deepEqual(ids(hostingView(hosting, { when: 'past', sort: 'soonest' }, NOW)).sort(), [2, 4]);
  assert.deepEqual(ids(hostingView(hosting, { when: 'all', status: 'published', sort: 'soonest' }, NOW)), [2, 1]);
  assert.deepEqual(ids(hostingView(hosting, { when: 'all', status: 'published', sort: 'latest' }, NOW)), [1, 2]);
  assert.deepEqual(ids(hostingView(hosting, { when: 'all', visibility: 'private' }, NOW)), [3]);
  const many = Array.from({ length: 30 }, (_, i) => ev(100 + i, i + 1));
  const p2 = hostingView(many, { when: 'upcoming', sort: 'soonest', page: 2 }, NOW);
  assert.equal(p2.page.label, '26–30 of 30');
  assert.equal(ids(p2).length, 5);
  assert.equal(pageOf([], 1).label, '0 of 0');
  assert.equal(pageOf(many, 9).page, 2, 'a page past the end is held to the last');
  const menu = hostMenu(ev(7, 3, { slug: 'demo' }), NOW).map((m) => m.label);
  assert.deepEqual(menu, ['Edit details', 'Who may register', 'Registrations', 'Agenda', 'Copy link', 'Download roster (CSV)', 'Cancel event']);
  assert.ok(!hostMenu(ev(8, -3), NOW).some((m) => m.key === 'cancel'), 'an event that has ended cannot be cancelled');
});

test('Discover: three months, types with counts, and each row\'s action from what eligibility says', () => {
  const months = discoverMonths(NOW, 'UTC');
  assert.deepEqual(months.map((m) => m.key), ['2026-11', '2026-12', '2027-01']);
  assert.equal(months[0].from, iso(NOW), 'this month reads from now');
  assert.equal(months[1].from, '2026-12-01T00:00:00.000Z');
  assert.deepEqual(typeChips([{ type: 'demo_day' }, { type: 'workshop' }, { type: 'demo_day' }]), [{ key: 'demo_day', label: 'Demo Day', count: 2 }, { key: 'workshop', label: 'Workshop', count: 1 }]);
  const ev = { id: 5, slug: 'demo', title: 'Demo Day', price_cents: 0 };
  const ok = (data) => ({ status: 'ready', data });
  assert.deepEqual(discoverRow(ev, { held: new Set([5]) }).action, { label: 'Show ticket', ticket: true });
  assert.equal(discoverRow(ev, { invitation: { comp: true } }).action.label, 'Accept');
  assert.equal(discoverRow(ev, { elig: { status: 'loading' } }).action.to, '/events/demo', 'never Register blind');
  assert.match(discoverRow(ev, { elig: { status: 'error' } }).note, /could not be read/);
  assert.equal(discoverRow(ev, { elig: ok({ eligible: false, reason: 'Your role or persona is outside this event’s audience.' }) }).price, 'Not open to your profile');
  assert.equal(discoverRow(ev, { elig: ok({ eligible: false, reason: 'An invitation is required.' }) }).note, 'Invitation only');
  const free = discoverRow({ ...ev, price_cents: 4000 }, { elig: ok({ eligible: true, comp_eligible: true, comp_source: 'invested_lp', capacity: 60, seats_taken: 52 }) });
  assert.equal(free.price, 'Free for you · Invested LP · 8 left');
  assert.ok(free.action.register, 'a free seat registers here');
  const paid = discoverRow({ ...ev, price_cents: 4000, currency: 'usd' }, { elig: ok({ eligible: true, comp_eligible: false }) });
  assert.deepEqual(paid.action, { label: 'Register', to: '/events/demo' }, 'a paid seat is taken where it is paid for');
  const full = discoverRow(ev, { elig: ok({ eligible: true, is_full: true, waitlist_enabled: true }) });
  assert.equal(full.price, 'Free · Full · waitlist open');
  assert.equal(full.action.label, 'Join the waitlist');
  assert.equal(discoverRow(ev, { elig: ok({ eligible: true, is_full: true, waitlist_enabled: false }) }).action, null);
  assert.match(registerDialog(ev, full, null).lines.join(' '), /You join the waitlist/);
});

test('Past: outcomes in the canvas\'s words, the hosted result, filters, years, and the chart that never invents a zero', () => {
  const places = [
    { id: 1, registration_id: 1, title: 'Office Hours', starts_at: '2026-11-05T10:00:00Z', outcome: 'attended' },
    { id: 2, registration_id: 2, title: 'Roundtable', starts_at: '2026-09-24T10:00:00Z', outcome: 'ended' },
    { id: 3, registration_id: 3, title: 'Social', starts_at: '2026-08-27T10:00:00Z', outcome: 'event_cancelled' },
    { id: 4, registration_id: 4, title: 'Circle', starts_at: '2026-04-16T10:00:00Z', outcome: 'declined' },
    { id: 5, registration_id: 5, title: 'Webinar', starts_at: '2025-02-12T10:00:00Z', outcome: 'cancelled' },
  ];
  const hosting = [
    { id: 9, title: 'Breakfast', starts_at: '2026-10-02T08:00:00Z', status: 'published', counts: { checked_in: 31, seats_taken: 42 } },
    { id: 8, title: 'Walk', starts_at: '2026-12-28T08:00:00Z', status: 'cancelled' },
  ];
  const rows = pastAll(places, hosting, NOW);
  assert.deepEqual(rows.map((r) => r.result.label), ['Checked in', 'Hosted · 31 of 42 came', 'Registered, not checked in', 'Event cancelled', 'Declined by the host', 'You cancelled']);
  assert.ok(!rows.some((r) => r.event.id === 8), 'a cancelled event still ahead stays under Hosting');
  assert.deepEqual(pastYears(rows), [2026, 2025]);
  assert.deepEqual(pastView(rows, { filters: ['cancelled'], year: 2026 }).map((r) => r.event.id), [3, 4]);
  assert.deepEqual(pastView(rows, { filters: ['went', 'hosted'] }).map((r) => r.event.id), [1, 9]);
  assert.deepEqual(pastView(rows, { q: 'webi' }).map((r) => r.event.id), [5]);

  const chart = pastChart(rows, { year: 2026, now: NOW });
  assert.equal(chart.summary, 'You went to 1 event and hosted 1 so far this year.');
  assert.deepEqual(chart.rows[9].values, [0, 1], 'October: hosted one');
  assert.deepEqual(chart.rows[10], { label: 'Nov', toDate: true, blank: false, values: [1, 0] });
  assert.equal(chart.rows[11].blank, true, 'December has not come yet');
  assert.deepEqual(chart.table.rows[11], ['Dec', 'not yet', 'not yet']);
  assert.equal(chart.table.rows[10][0], 'Nov (so far)');
  // Past read only back to September: the months before are not recorded, never zero.
  const partial = pastChart(rows, { year: 2026, now: NOW, complete: false, oldest: '2026-09-24T10:00:00Z' });
  assert.deepEqual(partial.rows[3].values, [null, null]);
  assert.deepEqual(partial.rows[8].values, [0, 0], 'September is reached');
  assert.match(partial.summary, /not recorded/);
  assert.equal(pastChart(rows, { year: 2025, now: NOW }).foot, null, 'a finished year has no "so far"');
});

test('the tab counts: a number from a read, a dash with its reason when the read did not come', () => {
  const attending = [{ id: 1, starts_at: iso(NOW + DAY) }, { id: 2, starts_at: iso(NOW - DAY) }];
  const hosting = [{ id: 9, starts_at: iso(NOW - DAY), status: 'published' }, { id: 8, starts_at: iso(NOW + DAY), status: 'draft' }];
  const full = tabCountsFull({ attending, hosting, past: { places: [], total: 4 }, ok: true }, NOW);
  assert.deepEqual([full.upcoming.value, full.hosting.value, full.past.value], [1, 2, 5]);
  assert.deepEqual(tabCountsFull({ attending, hosting, past: null, ok: true }, NOW).past, { value: null, why: 'Could not be read' }, 'MEV16a');
  const failed = tabCountsFull({ ok: false }, NOW);
  assert.ok(Object.values(failed).every((c) => c.value === null && c.why === 'Could not be read'), 'MEV16b');
  assert.equal(tabCountsFull({ loading: true }, NOW).upcoming.value, null);
});

/* ------------------------------------------------------------------ *
 * The page, mounted on stubbed reads
 * ------------------------------------------------------------------ */

const key = '__myEventsD1034';
const now = Date.now();
const soon = (d, hour = 18) => { const t = new Date(now + d * DAY); t.setUTCHours(hour, 0, 0, 0); return t.toISOString(); };
const ATTENDING = [
  { id: 1, registration_id: 11, title: 'Pricing Workshop', starts_at: soon(2), timezone: 'UTC', location_kind: 'virtual', reg_status: 'confirmed', payment_status: 'pending', amount_cents: 4000, currency: 'usd' },
  { id: 2, registration_id: 12, title: 'Operators Social', starts_at: soon(4), timezone: 'UTC', location_kind: 'in_person', reg_status: 'confirmed', payment_status: 'none' },
  { id: 3, registration_id: 13, title: 'Climate Roundtable', starts_at: soon(4, 20), timezone: 'UTC', reg_status: 'waitlisted', reg_waitlist_position: 2 },
];
const HOSTING = [
  { id: 10, title: 'Open Demo Night', starts_at: soon(3), timezone: 'UTC', status: 'published', visibility: 'public', capacity: 60, counts: { seats_taken: 42, waitlisted: 6, pending_approvals: 3, invitations_open: 0, checked_in: 0 } },
  { id: 11, title: 'Office Hours', starts_at: soon(6), timezone: 'UTC', status: 'published', visibility: 'unlisted', capacity: null, counts: { seats_taken: 14, waitlisted: 0, pending_approvals: 2, invitations_open: 0, checked_in: 0 } },
  { id: 12, title: 'Founder Breakfast', starts_at: soon(-40), timezone: 'UTC', status: 'published', visibility: 'public', counts: { seats_taken: 42, checked_in: 31 } },
  { id: 13, title: 'Hiring Night', starts_at: soon(8), timezone: 'UTC', status: 'rejected', visibility: 'public', review_note: 'Add the venue address.' },
  { id: 14, title: 'Uncounted Meetup', starts_at: soon(9), timezone: 'UTC', status: 'published', visibility: 'public' },
];
const PAST = { places: [
  { id: 20, registration_id: 21, title: 'Demo Day · Cohort 5', starts_at: soon(-20), timezone: 'UTC', outcome: 'attended' },
  { id: 22, registration_id: 23, title: 'Founders’ Circle', starts_at: soon(-25), timezone: 'UTC', outcome: 'declined' },
  { id: 24, registration_id: 25, title: 'SAFE basics', starts_at: soon(-30), timezone: 'UTC', outcome: 'cancelled' },
], total: 3 };
// The invitation's own id differs from its event's, so answering by the wrong one is caught.
const INVITATION = { invitation_id: 77, comp: true, host_name: 'Ada Host', event: { id: 70, slug: 'lp-briefing', title: 'LP Briefing', starts_at: soon(5), timezone: 'UTC', price_cents: 0 } };

function prepare(o = {}) {
  const calls = { list: [], public: [], answers: [], register: [], feed: [], links: [], elig: [] };
  globalThis[key] = {
    user: o.user || { id: 2, role: 'founder' },
    toasts: [],
    calls,
    api: {
      list: o.list || (async (p) => { calls.list.push(p); return { hosting: HOSTING, attending: ATTENDING, past: o.past === undefined ? PAST : o.past }; }),
      suggested: async () => ({ events: [] }),
      invitations: o.invitations || (async () => ({ invitations: [INVITATION] })),
      answerInvitation: async (id, action) => { calls.answers.push([id, action]); return { ok: true }; },
      feedStatus: o.feedStatus || (async () => ({ subscribed: false, created_at: null, last_used_at: null })),
      makeFeed: async () => { calls.feed.push('make'); return { url: 'https://axal.example.test/api/calendar/feed/my-events.ics?token=fixture-token', webcal_url: 'webcal://axal.example.test/api/calendar/feed/my-events.ics?token=fixture-token' }; },
      removeFeed: async () => { calls.feed.push('remove'); return { revoked: true }; },
      calendarLinks: async (id) => { calls.links.push(id); return { google: `https://calendar.example.test/${id}`, outlook: `https://outlook.example.test/${id}`, ics: `/api/events/${id}/ics` }; },
      eligibility: o.eligibility || (async (id) => { calls.elig.push(id); return { eligible: true, comp_eligible: id === 31, comp_source: 'invested_lp', capacity: 60, seats_taken: 52, is_full: id === 33, waitlist_enabled: true }; }),
      register: async (id) => { calls.register.push(id); return { ok: true }; },
      icsUrl: (id) => `/api/events/${id}/ics`,
    },
    publicApi: { list: o.publicList || (async (p) => {
      calls.public.push(p);
      if (p.limit === 1) return { events: [], total: p.from.startsWith(new Date(now).toISOString().slice(0, 7)) ? 4 : 2 };
      return { total: 4, events: [
        { id: 31, slug: 'demo-day', title: 'Demo Day · Cohort 6', type: 'demo_day', starts_at: soon(2), timezone: 'UTC', price_cents: 4000, currency: 'usd' },
        { id: 32, slug: 'workshop', title: 'Pricing Workshop', type: 'workshop', starts_at: soon(3), timezone: 'UTC', price_cents: 0 },
        { id: 33, slug: 'fireside', title: 'Investor Fireside', type: 'fireside', starts_at: soon(4), timezone: 'UTC', price_cents: 0 },
        { id: 70, slug: 'lp-briefing', title: 'LP Briefing', type: 'lp_briefing', starts_at: soon(5), timezone: 'UTC', price_cents: 0 },
      ] };
    }) },
  };
  return calls;
}
function stub(source) {
  return source
    .replace(/import \{ eventsApi \} from [^;]+;/, `const eventsApi = globalThis.${key}.api;`)
    .replace(/import \{ eventsPublic \} from [^;]+;/, `const eventsPublic = globalThis.${key}.publicApi;`)
    .replace(/import \{ adminEvents \} from [^;]+;/, 'const adminEvents = { list: async () => ({ total: 0 }) };')
    .replace(/import \{ useAuth \} from [^;]+;/, `const useAuth = () => ({ user: globalThis.${key}.user });`)
    .replace(/import \{ useToast \} from [^;]+;/, `const __toast = { toast: null, showToast: (t) => globalThis.${key}.toasts.push(t) }; const useToast = () => __toast;`)
    .replace(/import PageExplainer[^;]+;/, 'const PageExplainer = () => null;')
    .replace(/import EventQRCode[^;]+;/, 'const EventQRCode = ({ value }) => <canvas data-ticket-code={value} />;')
    .replace(/import \{ usePhoneWidth \} from [^;]+;/, 'const usePhoneWidth = () => false;');
}
async function mount(url, source = page) {
  const Page = (await sourceModule(stub(source), pagePath)).default;
  const ui = await mountForm(h(Routes, { location: url }, h(Route, { path: '/my/events/*', element: h(Page) }), h(Route, { path: '/my/events', element: h(Page) })), { modal: true });
  for (let i = 0; i < 4; i++) await ui.flush();
  const ids = () => ui.nodes().map((n) => propsOf(n)['data-testid']).filter(Boolean);
  const one = (id) => ui.nodes().find((n) => propsOf(n)['data-testid'] === id);
  const all = (id) => ui.nodes().filter((n) => propsOf(n)['data-testid'] === id);
  const press = async (id, i = 0) => { const n = all(id)[i]; assert.ok(n, `pressable: ${id}`); await ui.render; await propsOf(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); for (let k = 0; k < 3; k++) await ui.flush(); };
  const pick = async (id, value) => { const n = one(id); assert.ok(n, `select: ${id}`); await propsOf(n).onChange({ target: { value } }); for (let k = 0; k < 3; k++) await ui.flush(); };
  return { ...ui, ids, one, all, press, pick, count: (id) => all(id).length, textIn: (id) => textOf(one(id)) };
}

test('mounted Upcoming: Needs you with Pay now and an invitation answered through its dialog', async () => {
  const calls = prepare();
  const ui = await mount('/my/events');
  try {
    assert.match(ui.textIn('my-events-needs'), /Your seat at Pricing Workshop is held until you pay \$40\./);
    assert.match(ui.textIn('my-events-needs'), /Hiring Night was sent back by an admin: ‘Add the venue address\.’/);
    assert.match(ui.textIn('my-events-needs'), /Ada Host invited you to LP Briefing · Free seat\./);
    assert.equal(ui.textIn('my-events-needs-total'), '3');
    await ui.press('my-events-invitation-accept');
    assert.ok(ui.one('my-events-invitation-dialog-body'), 'Accept opens a dialog first');
    assert.deepEqual(calls.answers, [], 'nothing is sent before the dialog is confirmed');
    await ui.press('my-events-invitation-dialog-go');
    assert.deepEqual(calls.answers, [[70, 'accept']]);
    assert.ok(globalThis[key].toasts.some((t) => /You accepted the invitation to LP Briefing\./.test(t.msg)));
  } finally { await ui.unmount(); }
});

test('mounted Upcoming: the mini calendar dots the days, a day click filters Going, and Subscribe makes the address once', async () => {
  const calls = prepare();
  const ui = await mount('/my/events');
  try {
    assert.ok(ui.one('my-events-calendar-today'), 'today is ringed');
    assert.ok(ui.count('my-events-calendar-day') >= 2);
    assert.equal(ui.count('my-events-going-row'), 2, 'the next event is drawn above; Going holds the rest');
    const day4 = ui.nodes().find((n) => propsOf(n).role === 'gridcell' && /going to 1/.test(propsOf(n)['aria-label'] || '') && propsOf(n)['aria-label'].startsWith(String(new Date(soon(4)).getUTCDate())));
    assert.ok(day4, 'the day with Operators Social');
    await propsOf(day4).onClick(); await ui.flush();
    assert.equal(ui.count('my-events-going-row'), 2, 'that day holds both places');
    const day6 = ui.nodes().find((n) => propsOf(n).role === 'gridcell' && propsOf(n)['aria-label']?.startsWith(`${new Date(soon(6)).getUTCDate()} `));
    await propsOf(day6).onClick(); await ui.flush();
    assert.ok(ui.one('my-events-going-day-none'), 'a day with only a hosted event leaves Going empty, and says so');
    await ui.press('my-events-calendar-clear');
    assert.equal(ui.count('my-events-going-row'), 2);

    await ui.press('my-events-subscribe-open');
    assert.ok(ui.one('my-events-subscribe-body'));
    assert.deepEqual(calls.feed, [], 'opening the dialog changes nothing');
    await ui.press('my-events-subscribe-make');
    assert.deepEqual(calls.feed, ['make']);
    assert.equal(propsOf(ui.one('my-events-subscribe-url')).value, 'https://axal.example.test/api/calendar/feed/my-events.ics?token=fixture-token');
    assert.ok(!ui.one('my-events-subscribe-make'), 'shown once: no second Make in the same dialog');
  } finally { await ui.unmount(); }
});

test('mounted Upcoming: the ⋯ menu offers Add to calendar with D1033\'s links; Hosting soon carries its counts', async () => {
  const calls = prepare();
  const ui = await mount('/my/events');
  try {
    await ui.press('my-events-place-menu');
    assert.deepEqual(ui.all('my-events-place-menu-items').length, 1);
    await ui.press('my-events-place-menu-calendar');
    assert.ok(ui.one('my-events-add-calendar-google'));
    assert.equal(propsOf(ui.one('my-events-add-calendar-ics')).href, `/api/events/${calls.links[0]}/ics`);
    assert.match(ui.textIn('my-events-hosting-soon'), /42 of 60 taken/);
    assert.match(ui.textIn('my-events-hosting-soon'), /6 waitlist · 3 to approve/);
    assert.match(ui.textIn('my-events-hosting-soon'), /2 of 5/);
  } finally { await ui.unmount(); }
});

test('mounted Month view: chips by kind, Add to calendar from a chip, and "+N more" opening the day', async () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ id: 80 + i, registration_id: 180 + i, title: `Session ${i}`, starts_at: soon(10, 9 + i), timezone: 'UTC', reg_status: 'confirmed', payment_status: 'none' }));
  prepare({ list: async () => ({ hosting: HOSTING, attending: [...ATTENDING, ...many], past: PAST }) });
  const ui = await mount('/my/events');
  try {
    await ui.press('my-events-going-view-month');
    assert.ok(ui.one('my-events-month'));
    for (const k of ['going', 'hosting', 'waitlist', 'invitation']) assert.ok(ui.count(`my-events-month-chip-${k}`) >= 1, k);
    if (new Date(soon(10)).getUTCMonth() === new Date(now).getUTCMonth()) {
      await ui.press('my-events-month-more');
      assert.equal(ui.count('my-events-month-day-chip'), 5, 'the day lists every chip');
    }
    await ui.press('my-events-month-chip-going');
    assert.ok(ui.one('my-events-month-chip-panel'));
    assert.ok(ui.one('my-events-add-calendar-subscribe'), 'Subscribe to all my events from the chip');
  } finally { await ui.unmount(); }
});

test('mounted Hosting: counts, "Not read here yet" when none came, the filters, sort and the ⋯ menu', async () => {
  prepare();
  const ui = await mount('/my/events/hosting');
  try {
    const rows = ui.all('my-events-hosted-row');
    assert.equal(rows.length, 4, 'When: Upcoming leaves the past breakfast out');
    assert.ok(ui.all('my-events-host-counts').some((n) => /42 of 60 taken/.test(textOf(n))));
    assert.ok(ui.all('my-events-host-counts').some((n) => /No cap · 14 taken/.test(textOf(n))));
    assert.equal(ui.count('my-events-host-counts-unread'), 1, 'the meetup with no counts says so');
    await ui.pick('my-events-host-when', 'past');
    assert.equal(ui.count('my-events-hosted-row'), 1);
    await ui.pick('my-events-host-when', 'all');
    await ui.pick('my-events-host-status', 'rejected');
    assert.equal(ui.count('my-events-hosted-row'), 1);
    await ui.pick('my-events-host-status', 'cancelled');
    assert.ok(ui.one('my-events-hosting-nomatch'), 'no match is said, with a way back');
    await ui.pick('my-events-host-status', '');
    await ui.pick('my-events-host-sort', 'latest');
    assert.match(textOf(ui.all('my-events-hosted-row')[0]), /Founder Breakfast|Uncounted Meetup|Hiring Night/);
    await ui.press('my-events-host-menu');
    const items = ui.nodes().filter((n) => /^my-events-host-menu-/.test(propsOf(n)['data-testid'] || '') && propsOf(n).role === 'menuitem').map((n) => textOf(n));
    assert.ok(items.includes('Download roster (CSV)') && items.includes('Registrations'));
  } finally { await ui.unmount(); }
});

test('mounted Discover: month chips with counts, type chips, eligibility\'s actions, Register through a dialog, Free for me', async () => {
  const calls = prepare();
  const ui = await mount('/my/events/discover');
  try {
    const thisMonth = new Date(now).toISOString().slice(0, 7);
    assert.match(ui.textIn(`my-events-discover-month-${thisMonth}`), /4/);
    for (const t of ['demo_day', 'workshop', 'fireside', 'lp_briefing']) assert.match(ui.textIn(`my-events-discover-type-${t}`), /1/, t);
    const prices = ui.all('my-events-discover-price-line').map((n) => textOf(n));
    assert.ok(prices.includes('Free for you · Invested LP · 8 left'), prices.join(' | '));
    assert.ok(prices.includes('Free · Full · waitlist open'));
    assert.ok(prices.some((p) => /^Invitation only/.test(p)), 'the invitation shows Accept');
    assert.ok(ui.one('my-events-discover-accept'));
    await ui.press('my-events-discover-register');
    assert.ok(ui.one('my-events-register-dialog-body'));
    assert.deepEqual(calls.register, []);
    await ui.press('my-events-register-dialog-go');
    assert.equal(calls.register.length, 1);
    await ui.press('my-events-discover-free');
    assert.equal(ui.count('my-events-discover-row'), 1, 'only the seat free for me');
    await ui.press('my-events-discover-free');
    await ui.press('my-events-discover-type-workshop');
    assert.equal(ui.count('my-events-discover-row'), 1);
    await ui.pick('my-events-discover-format', 'hybrid');
    assert.ok(calls.public.some((p) => p.format === 'hybrid' && p.limit === 100), 'Format goes to the read');
  } finally { await ui.unmount(); }
  prepare({ publicList: async (p) => { if (p.limit === 1) throw new Error('synthetic'); return { events: [], total: 0 }; } });
  const failed = await mount('/my/events/discover');
  try {
    assert.match(failed.textIn(`my-events-discover-month-${new Date(now).toISOString().slice(0, 7)}`), /—/, 'a failed count is a dash, never 0');
    assert.ok(failed.one('my-events-discover-none'));
  } finally { await failed.unmount(); }
});

test('mounted Past: the chart with its summary and Table, cancelled and declined places, filters, and the hosted result', async () => {
  prepare();
  const ui = await mount('/my/events/past');
  try {
    assert.ok(ui.one('my-events-past-chart-svg'));
    assert.match(ui.textIn('my-events-past-summary'), /You went to \d+ events? and hosted \d+/);
    const text = ui.textIn('my-events-past');
    for (const w of ['Checked in', 'Declined by the host', 'You cancelled', 'Hosted · 31 of 42 came']) assert.match(text, new RegExp(w), w);
    await ui.press('my-events-past-view-table');
    assert.ok(ui.one('my-events-past-table'));
    await ui.press('my-events-past-filter-cancelled');
    const shown = ui.all('my-events-past-row').map((n) => textOf(n));
    assert.ok(shown.length >= 1 && shown.every((t) => /Declined by the host|You cancelled|Event cancelled/.test(t)), shown.join(' | '));
    assert.ok(!ui.one('my-events-past-older'), 'everything was read');
  } finally { await ui.unmount(); }
});

test('mounted Past: a long Past offers its older places, and reads them on asking', async () => {
  const calls = prepare({ past: { ...PAST, total: 140 } });
  const ui = await mount('/my/events/past');
  try {
    assert.match(ui.textIn('my-events-past-older'), /3 of your 140 past places are read here/);
    await ui.press('my-events-past-older-read');
    assert.deepEqual(calls.list.at(-1), { pastLimit: 100, pastOffset: 3 });
    assert.deepEqual(calls.list[0], { pastLimit: 100 });
  } finally { await ui.unmount(); }
});

test('the states: Past alone unreadable is a dash on its tab (MEV16a); the whole list failing dashes every count (MEV16b); empty tabs (MEV14)', async () => {
  prepare({ past: null });
  const a = await mount('/my/events/past');
  try {
    assert.equal(a.textIn('my-events-count-past').startsWith('—'), true);
    assert.match(a.textIn('my-events-count-past'), /Could not be read/);
    assert.ok(a.one('my-events-past-unreadable'));
    assert.match(a.textIn('my-events-count-upcoming'), /^\d/, 'the other counts still read');
  } finally { await a.unmount(); }
  prepare({ list: async () => { throw new Error('down'); } });
  const b = await mount('/my/events');
  try {
    for (const t of ['upcoming', 'hosting', 'past']) assert.match(b.textIn(`my-events-count-${t}`), /^—/, t);
    assert.ok(b.one('my-events-unreadable'));
  } finally { await b.unmount(); }
  prepare({ list: async () => ({ hosting: [], attending: [], past: { places: [], total: 0 } }), invitations: async () => ({ invitations: [] }) });
  const c = await mount('/my/events');
  try {
    assert.ok(c.one('my-events-nothing'), 'MEV14a');
    assert.ok(c.one('my-events-subscribe'), 'Subscribe stays beside it');
  } finally { await c.unmount(); }
  const d = await mount('/my/events/hosting');
  try { assert.ok(d.one('my-events-hosting-none'), 'MEV14b'); } finally { await d.unmount(); }
  const e = await mount('/my/events/past');
  try { assert.ok(e.one('my-events-past-none'), 'MEV14c'); } finally { await e.unmount(); }
  prepare({ list: () => new Promise(() => {}) });
  const f = await mount('/my/events');
  try {
    assert.ok(f.one('my-events-loading'), 'MEV15');
    assert.ok(f.count('my-events-skeleton') >= 4);
    assert.match(f.textIn('my-events-count-upcoming'), /^—/, 'a count still reading is a dash, never 0');
  } finally { await f.unmount(); }
});

test('the source: one door to the Worker, every change through a dialog, no browser pop-up, dark on every block', () => {
  const tabs = read('frontend/src/pages/events/MyEventsTabs.jsx');
  assert.ok(!/from '\.\.\/\.\.\/lib\/(api|eventsApi)'/.test(tabs), 'the tabs file makes no read of its own');
  for (const src of [tabs, page]) assert.ok(!/\b(alert|confirm|prompt)\(/.test(src.replace(/\/\/.*$/gm, '')), 'no browser pop-up');
  assert.match(page, /pastLimit: PAST_READ/);
  assert.match(read('frontend/src/lib/eventsApi.js'), /feedStatus: \(\) => request\('\/calendar\/my-events\/feed'\)/);
  for (const cls of tabs.match(/bg-white(?![^'"`]*dark:bg)/g) || []) assert.fail(`a white block with no dark: ${cls}`);
});
