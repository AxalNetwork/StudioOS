/**
 * D1036 (#2877, part 6 of #2387) — the host pages' shared header (MEV12a),
 * `/events/new`'s own (MEV12b), the check-in route, and MEV13's waiting count.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/my_events_host_header_d1036.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { h, mountForm, sourceModule } from './_form_d695.mjs';
import HostHeader, { NewEventHeader } from '../src/pages/events/HostHeader.jsx';
import {
  GATE, NEW_EVENT_LINE, dayIn, gateLine, onEventDay, pendingCount, pillsOf, primaryOf, screenOf, waitingWords, whenLine, zoneWords,
} from '../src/pages/events/hostHeaderModel.js';

const read = (p) => readFileSync(new URL('../src/' + p, import.meta.url), 'utf8');
const APP = read('App.jsx');

// 17:00–20:00 in Berlin on Wed 21 Oct 2026 (CEST, UTC+2), in person.
const BERLIN = {
  id: 7, slug: 'founder-night', title: 'Founder Night', status: 'published', visibility: 'public',
  starts_at: '2026-10-21T15:00:00Z', ends_at: '2026-10-21T18:00:00Z', timezone: 'Europe/Berlin',
  location_kind: 'in_person', location_text: 'Venue, Berlin', approval_required: 1,
};
const NOON_BERLIN = Date.parse('2026-10-21T10:00:00Z');
const NEXT_DAY = Date.parse('2026-10-22T10:00:00Z');

// ---------------------------------------------------------------- the model

test('the event\'s day is its own zone\'s, start day through end day; no start is never its day', () => {
  assert.equal(onEventDay(BERLIN, NOON_BERLIN), true);
  assert.equal(onEventDay(BERLIN, NEXT_DAY), false);
  // 23:30 in Berlin on the 21st is 21:30 UTC: still the event's day there.
  assert.equal(onEventDay(BERLIN, Date.parse('2026-10-21T21:30:00Z')), true);
  // 00:30 on the 22nd in Berlin is 22:30 UTC on the 21st: no longer its day, though UTC says so.
  assert.equal(onEventDay(BERLIN, Date.parse('2026-10-21T22:30:00Z')), false);
  const twoDays = { ...BERLIN, ends_at: '2026-10-22T18:00:00Z' };
  assert.equal(onEventDay(twoDays, NEXT_DAY), true, 'every day of a two-day event');
  assert.equal(onEventDay({ ...BERLIN, starts_at: null }, NOON_BERLIN), false);
  assert.equal(dayIn(Date.parse('2026-10-21T22:30:00Z'), 'Europe/Berlin'), '2026-10-22');
});

test('MEV12a\'s line: "Today · 17:00–20:00 Berlin time · In person · the venue"; another day by its date', () => {
  assert.equal(whenLine(BERLIN, NOON_BERLIN), 'Today · 17:00–20:00 Berlin time · In person · Venue, Berlin');
  assert.equal(whenLine(BERLIN, NEXT_DAY), 'Wed 21 Oct · 17:00–20:00 Berlin time · In person · Venue, Berlin');
  assert.equal(whenLine({ ...BERLIN, ends_at: null, location_kind: 'virtual', location_text: '' }, NOON_BERLIN), 'Today · 17:00 Berlin time · Online');
  assert.equal(whenLine({ ...BERLIN, starts_at: null }), 'Date not recorded');
  assert.equal(zoneWords('America/New_York'), 'New York time');
  assert.equal(zoneWords('UTC'), 'UTC');
});

test('the publish gate is the canvas\'s four lines; a draft, sent-back or cancelled event has none', () => {
  assert.equal(gateLine(BERLIN).text, GATE.pub);
  assert.equal(gateLine({ ...BERLIN, status: 'pending_review' }).text, GATE.wait);
  assert.equal(gateLine({ ...BERLIN, status: 'pending_review' }).tone, 'warn');
  assert.equal(gateLine({ ...BERLIN, visibility: 'private' }).text, GATE.pri);
  assert.equal(gateLine({ ...BERLIN, visibility: 'unlisted' }).text, GATE.unl);
  for (const status of ['draft', 'rejected', 'cancelled']) assert.equal(gateLine({ ...BERLIN, status }), null, status);
  assert.deepEqual(pillsOf(BERLIN).map((p) => [p.text, p.tone]), [['✓ Published', 'good'], ['◎ Public', 'muted']]);
  assert.deepEqual(pillsOf({ status: 'rejected', visibility: 'private' }).map((p) => p.text), ['↩ Sent back', '◉ Private']);
});

test('one primary action for the status: publish on Details, Edit elsewhere, Check in on the day, none when cancelled', () => {
  const on = (event, screen, now = NOON_BERLIN, publishLabel = null) => primaryOf(event, { screen, now, publishLabel });
  assert.deepEqual(on(BERLIN, 'eligibility'), { kind: 'link', label: 'Check in', to: '/events/7/manage/check-in' });
  assert.deepEqual(on(BERLIN, 'check-in'), { kind: 'link', label: 'Open event page', to: '/events/founder-night' }, 'not "Check in" on Check-in itself');
  assert.deepEqual(on(BERLIN, 'registrations', NEXT_DAY), { kind: 'link', label: 'Open event page', to: '/events/founder-night' });
  const draft = { ...BERLIN, status: 'draft' };
  assert.deepEqual(on(draft, 'details', NOON_BERLIN, 'Send for review'), { kind: 'publish', label: 'Send for review' });
  assert.equal(on(draft, 'details'), null, 'Details offers the editor\'s action or nothing');
  assert.deepEqual(on(draft, 'agenda'), { kind: 'link', label: 'Edit details', to: '/events/7/edit' });
  assert.deepEqual(on({ ...BERLIN, status: 'rejected' }, 'registrations'), { kind: 'link', label: 'Edit and resend', to: '/events/7/edit' });
  assert.deepEqual(on({ ...BERLIN, status: 'pending_review' }, 'eligibility'), { kind: 'note', label: 'Waiting for an admin' });
  assert.equal(on({ ...BERLIN, status: 'cancelled' }, 'eligibility'), null);
  assert.equal(on({ ...BERLIN, slug: null }, 'eligibility', NEXT_DAY), null, 'no slug, no event page');
});

test('Registrations\' count is the Pending tab, null when the roster was not read; the screens; MEV13\'s words', () => {
  const roster = { registrations: [{ status: 'registered' }, { status: 'pending' }, { status: 'confirmed' }, { status: 'waitlisted' }] };
  assert.equal(pendingCount(roster, true), 2);
  assert.equal(pendingCount(roster, false), 1);
  assert.equal(pendingCount(null, true), null);
  assert.equal(pendingCount({ registrations: null }, true), null);
  assert.equal(screenOf('/events/7/edit'), 'details');
  assert.equal(screenOf('/events/7/manage'), 'eligibility');
  assert.equal(screenOf('/events/7/manage/registrations'), 'registrations');
  assert.equal(screenOf('/events/7/manage/agenda'), 'agenda');
  assert.equal(screenOf('/events/7/manage/check-in/'), 'check-in');
  assert.equal(waitingWords({ total: 3 }), '3 waiting.');
  assert.equal(waitingWords({ total: 0 }), 'None waiting.');
  assert.equal(waitingWords({}), null, 'no total is not a 0');
  assert.equal(waitingWords(null), null);
});

// ---------------------------------------------------------------- the header, drawn

const draw = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));

test('the header: crumb, title, pills, the day\'s Check in, the line, the gate, and literal tabs with Check-in on the day only', () => {
  const today = draw(h(HostHeader, { event: BERLIN, screen: 'registrations', pending: 2, now: NOON_BERLIN }));
  assert.match(today, /href="\/my\/events\/hosting"[^>]*>‹ My events · Hosting</);
  assert.match(today, /<h1[^>]*>Founder Night<\/h1>/);
  assert.match(today, /✓ Published/);
  assert.match(today, /href="\/events\/7\/manage\/check-in"[^>]*>Check in</);
  assert.match(today, /Today · 17:00–20:00 Berlin time · In person · Venue, Berlin/);
  assert.match(today, /Publish gate<\/span>Public ✓/);
  for (const [to, label] of [['/events/7/edit', 'Details'], ['/events/7/manage', 'Who may register'], ['/events/7/manage/registrations', 'Registrations'], ['/events/7/manage/agenda', 'Agenda'], ['/events/7/manage/check-in', 'Check-in']]) {
    assert.match(today, new RegExp(`href="${to}"[^>]*>${label}`), label);
  }
  assert.match(today, /aria-current="page" href="\/events\/7\/manage\/registrations"/);
  assert.match(today, /data-testid="host-header-pending">2</);
  const tomorrow = draw(h(HostHeader, { event: BERLIN, screen: 'eligibility', pending: null, now: NEXT_DAY }));
  assert.doesNotMatch(tomorrow, /Check-in</, 'no Check-in tab off the day');
  assert.doesNotMatch(tomorrow, /host-header-pending/, 'an unread roster is no number, never a 0');
  assert.match(tomorrow, />Open event page</);
  const waiting = draw(h(HostHeader, { event: { ...BERLIN, status: 'pending_review' }, screen: 'eligibility', now: NEXT_DAY }));
  assert.match(waiting, /Waiting for an admin/);
  assert.match(waiting, /Waiting for review →/);
  const source = read('pages/events/HostHeader.jsx');
  assert.doesNotMatch(source, /\.map\((?:\([^)]*\)|\w+)\s*=>\s*\(?\s*<Link/, 'a mapped link is invisible to the reachability walk');
});

test('/events/new: "‹ My events", "New event", Save draft and the visibility\'s action, MEV12b\'s line, no tabs', () => {
  const html = draw(h(NewEventHeader, { primaryLabel: 'Publish', onSaveDraft() {}, onPrimary() {} }));
  assert.match(html, /href="\/my\/events"[^>]*>‹ My events</);
  assert.match(html, /<h1[^>]*>New event<\/h1>/);
  assert.match(html, />Save draft</);
  assert.match(html, /data-testid="event-publish"[^>]*>Publish</);
  assert.ok(html.includes(NEW_EVENT_LINE));
  assert.doesNotMatch(html, /host-header-tabs/);
});

test('the routes: Check-in under the host guard, and a new event lands on its Details tab', () => {
  assert.match(APP, /<Route path="\/events\/:id\/manage\/check-in" element=\{guard\(\['admin', 'founder', 'partner', 'investor', 'advisor'\], <EventManagePage \/>\)\} \/>/);
  const editor = read('pages/events/EventEditorPage.jsx');
  assert.match(editor, /navigate\(`\/events\/\$\{newId\}\/edit`\)/);
  assert.doesNotMatch(editor, /navigate\(`\/events\/\$\{newId\}\/manage`\)/, 'not the manage page');
});

// ---------------------------------------------------------------- mounted

const key = '__hostHeaderD1036';
const managePath = 'pages/events/EventManagePage.jsx';
const editorPath = 'pages/events/EventEditorPage.jsx';
const myEventsPath = 'pages/events/MyEventsPage.jsx';

function stubManage(source) {
  return source
    .replace(/import \{ events \} from [^;]+;/, `const events = globalThis.${key}.api;`)
    .replace(/import \{ eventsApi \} from [^;]+;/, 'const eventsApi = { exportUrl: (id) => `/x/${id}` };')
    .replace(/import InvitePeopleModal[^;]+;/, 'const InvitePeopleModal = () => null;')
    .replace(/import CheckinScanner[^;]+;/, 'const CheckinScanner = ({ onDetect }) => <button type="button" onClick={() => onDetect("CODE-1")}>Scan fixture</button>;')
    .replace(/import '\.\/eventOrganiser\.css';/, '');
}
function manageApi(event) {
  const fixture = { calls: [] };
  fixture.api = {
    get: async () => ({ event, agenda: [] }),
    roster: async () => ({ registrations: [{ id: 1, status: 'registered', name: 'Ada' }], counts: { seats_taken: 1, waitlisted: 0, capacity: 10 } }),
    eligibility: async () => ({ eligible: true, reason: 'Open', requires_approval: true, is_full: false }),
    checkin: async (id, code) => { fixture.calls.push(['checkin', id, code]); return { ok: true, already_checked_in: false, registration: { name: 'Ada' } }; },
  };
  globalThis[key] = fixture;
  return fixture;
}
async function mountManage(url, source = read(managePath)) {
  const Page = (await sourceModule(stubManage(source), managePath)).default;
  const ui = await mountForm(h(Routes, { location: url }, h(Route, { path: '/events/:id/manage/*', element: h(Page) }), h(Route, { path: '/events/:id/manage', element: h(Page) })));
  await ui.flush();
  return ui;
}
const todayEvent = () => {
  const start = new Date(Date.now() + 60_000).toISOString();
  return { ...BERLIN, timezone: 'UTC', starts_at: start, ends_at: start, approval_required: 1 };
};

test('mounted Check-in: on the day it scans, says who was let in and reloads; off the day it opens nothing', async () => {
  const fixture = manageApi(todayEvent());
  let ui = await mountManage('/events/7/manage/check-in');
  try {
    assert.ok(ui.by('host-header'), 'the shared header is drawn');
    assert.match(ui.text(), /Check-in/);
    assert.ok(ui.by('event-checkin'));
    await ui.click('Open the scanner');
    await ui.click('Scan fixture');
    await ui.flush();
    assert.deepEqual(fixture.calls, [['checkin', '7', 'CODE-1']]);
    assert.equal(ui.text().includes('Checked in: Ada'), true);
    assert.match(ui.props(ui.by('host-header-pending')).children, /1/, 'Registrations counts the one waiting for a decision');
  } finally { await ui.unmount(); }
  manageApi({ ...BERLIN, timezone: 'UTC', starts_at: '2099-01-01T12:00:00Z', ends_at: '2099-01-01T14:00:00Z' });
  ui = await mountManage('/events/7/manage/check-in');
  try {
    assert.ok(ui.by('event-checkin-closed'));
    assert.equal(Boolean(ui.by('event-checkin')), false, 'no scanner off the day');
    assert.match(ui.text(), /Check-in opens on the event’s day/);
    assert.doesNotMatch(ui.text(), /Check-inCheck/, 'no Check-in tab off the day');
  } finally { await ui.unmount(); }
});

function stubEditor(source) {
  return source
    .replace(/import \{ eventsApi \} from [^;]+;/, `const eventsApi = globalThis.${key}.api;`)
    .replace(/import \{ useToast \} from [^;]+;/, `const useToast = () => globalThis.${key}.toast;`)
    .replace(/import PageExplainer[^;]+;/, 'const PageExplainer = () => null;');
}
test('mounted /events/new: its header, and the action creates the draft then submits it, after its dialog', async () => {
  const fixture = { calls: [], toasts: [] };
  fixture.toast = { toast: null, showToast: (t) => fixture.toasts.push(t) };
  fixture.api = {
    create: async (body) => { fixture.calls.push(['create', body.visibility]); return { id: 91 }; },
    submitReview: async (id) => { fixture.calls.push(['submitReview', id]); return { event: { status: 'published' } }; },
  };
  globalThis[key] = fixture;
  const Page = (await sourceModule(stubEditor(read(editorPath)), editorPath)).default;
  const ui = await mountForm(h(Routes, { location: '/events/new' }, h(Route, { path: '/events/new', element: h(Page) })), { modal: true });
  try {
    await ui.flush();
    assert.ok(ui.by('host-header-new'));
    assert.equal(Boolean(ui.by('host-header-tabs')), false);
    // A new event starts private, so its action is Publish.
    assert.equal(ui.text().includes('Send for review'), false);
    const title = ui.nodes().find((n) => n.tagName === 'INPUT' && ui.props(n).value === '' && ui.props(n).type !== 'datetime-local' && ui.props(n).type !== 'number');
    await act(async () => ui.props(title).onChange({ target: { value: 'Fixture night' } }));
    const when = ui.nodes().find((n) => n.tagName === 'INPUT' && ui.props(n).type === 'datetime-local');
    await act(async () => ui.props(when).onChange({ target: { value: '2099-01-01T12:00' } }));
    await ui.click('Publish');
    assert.ok(ui.by('event-publish-dialog'), 'the action opens its dialog');
    assert.equal(fixture.calls.length, 0, 'nothing is created before the confirm');
    await act(async () => ui.props(ui.by('event-publish-confirm')).onClick());
    await ui.flush();
    assert.deepEqual(fixture.calls, [['create', 'private'], ['submitReview', 91]]);
    assert.deepEqual(fixture.toasts.at(-1), { kind: 'success', msg: 'Event published.' });
  } finally { await ui.unmount(); }
});

function stubMyEvents(source) {
  return source
    .replace(/import \{ eventsApi \} from [^;]+;/, `const eventsApi = globalThis.${key}.api;`)
    .replace(/import \{ eventsPublic \} from [^;]+;/, 'const eventsPublic = { list: async () => ({ events: [] }) };')
    .replace(/import \{ adminEvents \} from [^;]+;/, `const adminEvents = globalThis.${key}.admin;`)
    .replace(/import \{ useAuth \} from [^;]+;/, `const useAuth = () => ({ user: globalThis.${key}.user });`)
    .replace(/import \{ useToast \} from [^;]+;/, `const useToast = () => globalThis.${key}.toast;`)
    .replace(/import PageExplainer[^;]+;/, 'const PageExplainer = () => null;')
    .replace(/import EventQRCode[^;]+;/, 'const EventQRCode = () => null;')
    .replace(/import \{ usePhoneWidth \} from [^;]+;/, 'const usePhoneWidth = () => false;');
}
async function hosting({ role, admin }) {
  const calls = [];
  globalThis[key] = {
    user: { id: 2, role },
    toast: { toast: null, showToast: () => {} },
    api: { list: async () => ({ hosting: [], attending: [] }), suggested: async () => ({ events: [] }), icsUrl: () => '' },
    admin: { list: async (q) => { calls.push(q); return admin(q); } },
  };
  const Page = (await sourceModule(stubMyEvents(read(myEventsPath)), myEventsPath)).default;
  const ui = await mountForm(h(Routes, { location: '/my/events/hosting' }, h(Route, { path: '/my/events/*', element: h(Page) })));
  await ui.flush(); await ui.flush();
  return { ui, calls };
}
test('mounted MEV13: an admin\'s line counts the review desk\'s waiting events; a failed read says so; a host is not asked', async () => {
  let { ui, calls } = await hosting({ role: 'admin', admin: async () => ({ total: 3, events: [] }) });
  try {
    assert.match(ui.props(ui.by('my-events-review-line')) && ui.text(), /You also review members’ public events\. 3 waiting\./);
    assert.deepEqual(calls, [{ status: 'pending_review', limit: 1 }]);
  } finally { await ui.unmount(); }
  ({ ui } = await hosting({ role: 'admin', admin: async () => { throw new Error('down'); } }));
  try {
    assert.match(ui.text(), /The waiting count could not be read\./);
    assert.doesNotMatch(ui.text(), /0 waiting/);
  } finally { await ui.unmount(); }
  ({ ui, calls } = await hosting({ role: 'founder', admin: async () => ({ total: 9 }) }));
  try {
    assert.equal(Boolean(ui.by('my-events-review-line')), false);
    assert.deepEqual(calls, [], 'a host who is not an admin is never asked');
  } finally { await ui.unmount(); }
});
