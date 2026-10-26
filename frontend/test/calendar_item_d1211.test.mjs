// D1211 (#3177, part 6 of #2420) — the Calendar's item drawer at
// /calendar/item/:kind/:id (CAL4, CAL5, CAL18), New IC meeting and New
// check-in with the pickers and Meet (CAL7, CAL8), and Reschedule and Cancel
// (CAL19). The components run against a stubbed fetch through the real
// clients; no provider host is reached. Fixtures are worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { h, mountForm, sourceModule } from './_form_d695.mjs';
import {
  IC_PLAN, NOT_PARTY, SAYS, copyLines, goingLine, itemOf, itemPath, joinOpen, newMenu, noChangeLine, refusalOf, startError, whenLine, whenShort, zoneLabel,
} from '../src/pages/calendarItemModel.js';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, statusText: String(status), headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const HOUR = 3_600_000;
const iso = (ms) => new Date(ms).toISOString();
const T0 = Date.now();
const EMAIL = /@example\.test/;

const IC = {
  id: 'ic_meeting:40', kind: 'ic_meeting', source_id: 40, title: 'Acme Robotics · Seed — IC',
  start_at: iso(T0 + 48 * HOUR), end_at: iso(T0 + 49 * HOUR), status: 'confirmed',
  location_kind: 'video', location_uri: 'https://meet.google.com/abc-defg-hij', notes: 'Traction. Terms. Vote.',
  family: 'meetings', my_role: { code: 'organiser', words: 'Organiser' }, can: { rsvp: false, reschedule: true, cancel: true, copy: true },
  all_day: false, href: '/deals/200', cancel_reason: null, deal_name: 'Acme Robotics', project_name: null, time_zone: null,
  pushed_to: ['google'], my_rsvp: 'accepted',
  people: [
    { name: 'Ada', profile: 'Investor', stands: 'Organiser', answer: 'Going' },
    { name: 'Bea', profile: 'Investor', stands: 'Invited', answer: 'Maybe' },
    { name: 'Cy', profile: 'Admin', stands: 'Invited', answer: 'Not answered yet' },
  ],
};
const INVITED = { ...IC, my_role: { code: 'invited', words: 'Invited' }, can: { rsvp: true, reschedule: false, cancel: false, copy: true }, my_rsvp: 'tentative' };
const GONE = { ...IC, status: 'cancelled', cancel_reason: 'Moved to next week', can: { rsvp: false, reschedule: false, cancel: false, copy: false } };
const CHECKIN = {
  ...IC, id: 'founder_checkin:50', kind: 'founder_checkin', source_id: 50, title: 'Northwind weekly', end_at: iso(T0 + 48.5 * HOUR),
  href: '/projects/20', deal_name: null, project_name: 'Northwind Labs', notes: null, my_rsvp: null,
  people: [{ name: 'Fay', profile: 'Founder', stands: 'Founder', answer: null }, { name: 'Gus', profile: 'Advisor', stands: 'With the founder', answer: null }],
};
const ADVISOR = { ...CHECKIN, id: 'advisor_booking:60', kind: 'advisor_booking', source_id: 60, title: 'Pricing', status: 'pending', href: '/advisors/abc', project_name: null, can: { rsvp: false, reschedule: false, cancel: false, copy: true }, people: [] };
const CALENDLY = { ...ADVISOR, id: 'calendly_event:70', kind: 'calendly_event', source_id: 70, title: 'Intro', status: 'confirmed', location_uri: null, href: null, can: { rsvp: false, reschedule: false, cancel: false, copy: false } };
const EXPERT = { ...ADVISOR, id: 'expert_booking:80', kind: 'expert_booking', source_id: 80, title: 'Expert session', status: 'confirmed', href: '/wellbeing', people: [] };

/** The Worker, stubbed: what each call answers, and what was sent. */
function serve(routes) {
  const sent = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    const method = options.method || 'GET';
    sent.push({ url: u, method, body: options.body ? JSON.parse(options.body) : null });
    for (const [pattern, answer] of routes) {
      if (pattern.test(`${method} ${u}`)) { const [body, status] = typeof answer === 'function' ? answer(u, options) : answer; return response(body, status); }
    }
    return response({ detail: 'Not found' }, 404);
  };
  return { sent, restore: () => { globalThis.fetch = previous; } };
}
const spaced = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(spaced).join(' ') : n.textContent || '');

async function mount(element, routes, opts = {}) {
  const net = serve(routes);
  const ui = await mountForm(element, { modal: true, ...opts });
  const settle = async () => { for (let i = 0; i < 5; i += 1) await ui.flush(); };
  await settle();
  const press = async (n) => { assert.ok(n, 'no such node'); assert.ok(!ui.props(n).disabled, 'it is enabled'); await act(async () => { await ui.props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); };
  const type = async (n, value) => { assert.ok(n, 'no such field'); await act(async () => ui.props(n).onChange({ target: { value, checked: value } })); await settle(); };
  const waitFinder = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 260)); }); await settle(); };
  return {
    ...ui, sent: net.sent, settle, press, type, waitFinder,
    say: (n) => { assert.ok(n, 'no such node'); return spaced(n).replace(/\s+/g, ' ').trim(); },
    all: (id) => ui.nodes().filter((n) => ui.props(n)['data-testid'] === id),
    count: (id) => ui.nodes().filter((n) => ui.props(n)['data-testid'] === id).length,
    async unmount() { await ui.unmount(); net.restore(); },
  };
}
const drawerModule = () => sourceModule(read('frontend/src/pages/CalendarItemDrawer.jsx'), 'pages/CalendarItemDrawer.jsx');
const newModule = () => sourceModule(read('frontend/src/pages/CalendarNewDialogs.jsx'), 'pages/CalendarNewDialogs.jsx');
const ITEM = (item) => [/GET .*\/api\/calendar\/item\//, [{ item }, 200]];

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the drawer\'s address, its words and its rules', () => {
  assert.equal(itemPath('ic_meeting', 40), '/calendar/item/ic_meeting/40');
  assert.deepEqual(itemOf('/calendar/item/ic_meeting/40'), { kind: 'ic_meeting', id: '40' });
  assert.equal(itemOf('/calendar/week'), null);
  assert.equal(itemOf('/calendar/item/ic_meeting/x'), null);

  const at = { start_at: '2026-11-12T14:00:00Z', end_at: '2026-11-12T15:00:00Z' };
  assert.equal(zoneLabel('Europe/Lisbon', new Date(at.start_at)), 'Lisbon time (UTC+0)');
  assert.equal(zoneLabel('Europe/Berlin', new Date(at.start_at)), 'Berlin time (UTC+1)');
  assert.equal(whenLine(at, 'Europe/Lisbon'), 'Thu 12 Nov · 14:00–15:00 · 60 min · Lisbon time (UTC+0).');
  assert.equal(whenLine({ ...at, time_zone: 'Europe/Berlin' }, 'Europe/Lisbon'),
    'Thu 12 Nov · 14:00–15:00 · 60 min · Lisbon time (UTC+0). 15:00 Berlin time (UTC+1).', 'a recorded zone shows its own time');
  assert.equal(whenLine({ start_at: at.start_at, end_at: null }, 'Europe/Lisbon'), 'Thu 12 Nov · 14:00 · its end is not recorded · Lisbon time (UTC+0).');
  assert.equal(whenLine({}, 'Europe/Lisbon'), 'Not recorded');
  assert.equal(whenShort(at, 'Europe/Lisbon'), 'Thu 12 Nov · 14:00–15:00');

  const start = Date.parse(at.start_at);
  const live = { ...at, location_uri: 'https://meet.google.com/abc-defg-hij' };
  assert.equal(joinOpen(live, start - 16 * 60_000), false);
  assert.equal(joinOpen(live, start - 15 * 60_000), true, 'Join opens 15 minutes before');
  assert.equal(joinOpen(live, Date.parse(at.end_at)), false, 'and closes at the end');
  assert.equal(joinOpen({ ...live, status: 'cancelled' }, start), false);
  assert.equal(joinOpen(at, start), false, 'no link, no Join');

  assert.equal(goingLine(IC.people), '1 of 3 going');
  assert.equal(goingLine(CHECKIN.people), null, 'a kind that records no answers says no count');
  assert.deepEqual(copyLines(IC).map((c) => [c.name, c.copied]), [['Google', true], ['Outlook', false]]);

  assert.equal(startError(''), null);
  assert.equal(startError('2000-01-01T10:00'), 'Choose a time from now on.');
  assert.equal(startError('2999-01-01T10:00'), null);
  assert.deepEqual(refusalOf({ status: 402, message: 'tier' }), { plan: true, text: IC_PLAN });
  assert.equal(refusalOf({ status: 409, message: 'Google is not connected.' }).text, 'Google is not connected.');

  assert.deepEqual(newMenu('investor').map((x) => x.key), ['ic', 'checkin', 'event']);
  assert.deepEqual(newMenu('founder').map((x) => x.key), ['checkin', 'interview', 'advisor', 'event']);
  assert.deepEqual(newMenu('advisor').map((x) => x.key), ['checkin', 'event']);
  assert.ok(newMenu('founder').filter((x) => x.to).every((x) => x.label.endsWith('↗') && x.sub), 'items that leave the page carry ↗ and say where');

  assert.equal(noChangeLine(GONE), 'No actions on a cancelled meeting.');
  assert.equal(noChangeLine(CALENDLY), 'StudioOS cannot change or cancel this booking.');
  assert.equal(noChangeLine(ADVISOR), 'No cancel here. The booking page handles it.');
  assert.equal(noChangeLine(IC), null);
  for (const words of Object.values(SAYS)) assert.doesNotMatch(words, /\btold\b|notif/i, 'no dialog claims a message the Worker does not send');
});

/* ------------------------------------------------------------------ *
 * CAL4: the IC meeting
 * ------------------------------------------------------------------ */

test('CAL4: the organiser\'s IC meeting — when, where, people, deal, agenda, copies, Reschedule and Cancel meeting', async () => {
  const { default: Drawer } = await drawerModule();
  let closed = 0;
  const ui = await mount(h(Drawer, { kind: 'ic_meeting', id: '40', canCopy: true, onClose: () => { closed += 1; } }), [ITEM(IC)]);
  try {
    assert.ok(ui.sent.some((s) => s.url.endsWith('/api/calendar/item/ic_meeting/40')), 'the drawer reads its own item');
    assert.ok(ui.by('cal-item-drawer'));
    assert.match(ui.say(ui.by('cal-item-drawer')), /IC meeting/);
    assert.equal(ui.say(ui.by('cal-item-role')), 'Organiser');
    assert.equal(ui.say(ui.by('cal-item-answer')), 'Going');
    assert.match(ui.say(ui.by('cal-item-when')), /\d+ min/);
    assert.ok(ui.say(ui.by('cal-item-where')).includes('meet.google.com/abc-defg-hij'), 'the link, without its scheme');
    assert.ok(ui.by('cal-item-join-quiet') && !ui.by('cal-item-join'), 'two days out, Join is quiet');
    assert.match(ui.say(ui.by('cal-item-people')), /People 1 of 3 going/);
    assert.equal(ui.count('cal-item-person'), 3);
    assert.match(ui.say(ui.all('cal-item-person')[1]), /Bea · Investor Invited · Maybe/);
    assert.match(ui.say(ui.by('cal-item-venture')), /Deal Acme Robotics In your deal room Open deal/);
    assert.equal(ui.props(ui.by('cal-item-open')).to ?? ui.props(ui.by('cal-item-open')).href, '/deals/200');
    assert.match(ui.say(ui.by('cal-item-notes')), /Agenda Traction\. Terms\. Vote\./);
    assert.equal(ui.say(ui.by('cal-item-copy-google')), '✓ Copied to Google');
    assert.equal(ui.say(ui.by('cal-item-copy-microsoft')), 'Outlook · Not copied');
    assert.ok(ui.by('cal-item-reschedule') && ui.by('cal-item-cancel'));
    assert.equal(ui.say(ui.by('cal-item-cancel')), 'Cancel meeting');
    assert.equal(ui.by('cal-item-rsvp'), undefined, 'the organiser is not asked to answer');
    assert.doesNotMatch(ui.text(), EMAIL);
    await ui.escape();
    assert.equal(closed, 1, 'Esc closes the drawer');
  } finally { await ui.unmount(); }
});

test('CAL4: an invitee answers Going, Maybe or Not going, and sees no Reschedule or Cancel', async () => {
  const { default: Drawer } = await drawerModule();
  let changed = 0;
  let answered = INVITED;
  const ui = await mount(h(Drawer, { kind: 'ic_meeting', id: '40', onClose() {}, onChanged: () => { changed += 1; } }), [
    [/POST .*\/api\/calendar\/ic-meetings\/40\/rsvp\?rsvp=accepted$/, () => { answered = { ...INVITED, my_rsvp: 'accepted' }; return [{ ok: true, rsvp: 'accepted' }, 200]; }],
    [/GET .*\/api\/calendar\/item\//, () => [{ item: answered }, 200]],
  ]);
  try {
    assert.equal(ui.props(ui.by('cal-item-rsvp-tentative'))['aria-pressed'], true);
    assert.equal(ui.by('cal-item-reschedule'), undefined);
    assert.equal(ui.by('cal-item-cancel'), undefined);
    await ui.press(ui.by('cal-item-rsvp-accepted'));
    assert.ok(ui.sent.some((s) => s.method === 'POST' && s.url.endsWith('/ic-meetings/40/rsvp?rsvp=accepted')));
    assert.equal(ui.props(ui.by('cal-item-rsvp-accepted'))['aria-pressed'], true, 'the answer is read back');
    assert.equal(changed, 1, 'the view behind re-reads');
    assert.equal(ui.by('cal-item-copy-now'), undefined, 'no calendar connected: no Copy, and the reason');
    assert.match(ui.say(ui.by('cal-item-copies')), /Connect Google or Outlook to copy this there\./);
  } finally { await ui.unmount(); }
});

test('CAL5: a cancelled meeting, a check-in, an advisor session, an expert session and a Calendly booking', async () => {
  const { default: Drawer } = await drawerModule();
  let ui = await mount(h(Drawer, { kind: 'ic_meeting', id: '41', onClose() {} }), [ITEM(GONE)]);
  try {
    assert.equal(ui.say(ui.by('cal-item-cancelled')), '✕ Cancelled');
    assert.equal(ui.say(ui.by('cal-item-cancel-reason')), 'Cancelled: ‘Moved to next week’');
    assert.equal(ui.say(ui.by('cal-item-why')), 'No actions on a cancelled meeting.');
    for (const id of ['cal-item-reschedule', 'cal-item-cancel', 'cal-item-rsvp', 'cal-item-copies', 'cal-item-join']) assert.equal(ui.by(id), undefined, id);
  } finally { await ui.unmount(); }

  ui = await mount(h(Drawer, { kind: 'founder_checkin', id: '50', onClose() {} }), [ITEM(CHECKIN)]);
  try {
    assert.match(ui.say(ui.by('cal-item-drawer')), /Check-in/);
    assert.match(ui.say(ui.by('cal-item-venture')), /Venture Northwind Labs Open venture/);
    assert.equal(ui.props(ui.by('cal-item-open')).to ?? ui.props(ui.by('cal-item-open')).href, '/projects/20');
    assert.match(ui.say(ui.by('cal-item-people')), /^People Fay · Founder Founder Gus · Advisor With the founder$/, 'no answers recorded, so no count and none invented');
    assert.equal(ui.say(ui.by('cal-item-cancel')), 'Cancel');
  } finally { await ui.unmount(); }

  ui = await mount(h(Drawer, { kind: 'founder_checkin', id: '50', onClose() {} }), [ITEM({ ...CHECKIN, can: { ...CHECKIN.can, reschedule: false } })]);
  try {
    assert.ok(ui.by('cal-item-cancel'));
    assert.equal(ui.by('cal-item-reschedule'), undefined, 'each action follows its own `can`');
  } finally { await ui.unmount(); }

  ui = await mount(h(Drawer, { kind: 'advisor_booking', id: '60', onClose() {} }), [ITEM(ADVISOR)]);
  try {
    assert.equal(ui.say(ui.by('cal-item-pending')), '◷ Waiting for confirmation');
    assert.equal(ui.say(ui.by('cal-item-open')), 'Open booking');
    assert.equal(ui.say(ui.by('cal-item-why')), 'No cancel here. The booking page handles it.');
    assert.equal(ui.by('cal-item-cancel'), undefined);
  } finally { await ui.unmount(); }

  ui = await mount(h(Drawer, { kind: 'expert_booking', id: '80', onClose() {} }), [ITEM(EXPERT)]);
  try {
    assert.equal(ui.say(ui.by('cal-item-private')), 'Only you see this. A private session shows no people list.');
    assert.equal(ui.by('cal-item-people'), undefined);
  } finally { await ui.unmount(); }

  ui = await mount(h(Drawer, { kind: 'calendly_event', id: '70', onClose() {} }), [ITEM(CALENDLY)]);
  try {
    assert.match(ui.say(ui.by('cal-item-where')), /No place recorded Calendly did not send a place for this booking\./);
    assert.equal(ui.say(ui.by('cal-item-why')), 'StudioOS cannot change or cancel this booking.');
  } finally { await ui.unmount(); }
});

test('CAL18: a meeting the reader is not part of shows nothing about it; a failed read says so, never "not found"', async () => {
  const { default: Drawer } = await drawerModule();
  let ui = await mount(h(Drawer, { kind: 'ic_meeting', id: '40', onClose() {} }), [[/GET .*\/item\//, [{ error: 'not_party', detail: NOT_PARTY }, 404]]]);
  try {
    assert.equal(ui.say(ui.by('cal-item-not-party')), NOT_PARTY);
    assert.match(ui.say(ui.by('cal-item-refused')), /Nothing about the meeting is shown\. Back to Calendar/);
    assert.equal(ui.by('cal-item-drawer'), undefined);
  } finally { await ui.unmount(); }
  ui = await mount(h(Drawer, { kind: 'ic_meeting', id: '40', onClose() {} }), [[/GET .*\/item\//, [{ error: 'unreadable', detail: 'This item could not be read. Try again.' }, 503]]]);
  try {
    assert.match(ui.say(ui.by('cal-item-state')), /could not be read/i);
    assert.equal(ui.by('cal-item-not-party'), undefined, 'a failed read is not a refusal');
  } finally { await ui.unmount(); }
});

/* ------------------------------------------------------------------ *
 * CAL19: Reschedule and Cancel
 * ------------------------------------------------------------------ */

test('CAL19: Reschedule refuses a past start inline, then moves the meeting with its new length and says what moves', async () => {
  const { default: Drawer } = await drawerModule();
  let reads = 0;
  const ui = await mount(h(Drawer, { kind: 'ic_meeting', id: '40', onClose() {} }), [
    [/PATCH .*\/api\/calendar\/ic-meetings\/40$/, (_u, o) => (JSON.parse(o.body).duration_min === 45 ? [{ detail: 'A cancelled meeting cannot be moved.' }, 409] : [{ ok: true }, 200])],
    [/GET .*\/item\//, () => { reads += 1; return [{ item: IC }, 200]; }],
  ]);
  try {
    await ui.press(ui.by('cal-item-reschedule'));
    const dialog = ui.by('cal-reschedule-dialog');
    assert.ok(dialog);
    assert.match(ui.say(dialog), /Reschedule Acme Robotics · Seed — IC Now .+\./);
    assert.equal(ui.say(ui.by('cal-reschedule-says')), SAYS.move);
    assert.equal(ui.props(ui.by('cal-reschedule-length')) && ui.all('cal-reschedule-length').length, 1);
    await ui.type(ui.by('cal-reschedule-start'), '2000-01-01T10:00');
    assert.equal(ui.say(ui.by('cal-reschedule-start-error')), 'Choose a time from now on.');
    assert.equal(ui.props(ui.by('cal-reschedule-save')).disabled, true);
    await ui.type(ui.by('cal-reschedule-start'), '2999-01-05T10:00');
    const lengths = ui.nodes().filter((n) => n.tagName === 'BUTTON' && /^\d+ min$/.test(ui.say(n)));
    assert.deepEqual(lengths.map((n) => ui.say(n)), ['30 min', '45 min', '60 min', '90 min']);
    assert.equal(ui.props(lengths[2])['aria-pressed'], true, 'the current length is chosen');
    await ui.press(lengths[1]);
    await ui.press(ui.by('cal-reschedule-save'));
    assert.equal(ui.say(ui.by('cal-reschedule-refused')), 'A cancelled meeting cannot be moved.', 'the Worker\'s sentence, in the dialog');
    await ui.press(lengths[3]);
    await ui.press(ui.by('cal-reschedule-save'));
    const patch = ui.sent.filter((s) => s.method === 'PATCH').at(-1);
    assert.deepEqual(patch.body, { start_at: new Date('2999-01-05T10:00').toISOString(), duration_min: 90 });
    assert.equal(ui.by('cal-reschedule-dialog'), undefined, 'the dialog closes');
    assert.equal(reads, 2, 'the drawer re-reads the moved meeting');
  } finally { await ui.unmount(); }
});

test('CAL19: Cancel says what is removed; an IC meeting takes a reason, a check-in has nowhere to keep one', async () => {
  const { default: Drawer } = await drawerModule();
  let ui = await mount(h(Drawer, { kind: 'ic_meeting', id: '40', onClose() {} }), [[/DELETE /, [{ ok: true }, 200]], ITEM(IC)]);
  try {
    await ui.press(ui.by('cal-item-cancel'));
    assert.match(ui.say(ui.by('cal-cancel-dialog')), /Cancel Acme Robotics · Seed — IC\? .+ · 3 invited\./);
    assert.equal(ui.say(ui.by('cal-cancel-says')), SAYS.cancel);
    assert.equal(ui.say(ui.by('cal-cancel-keep')), 'Keep meeting');
    await ui.type(ui.by('cal-cancel-reason'), 'Moved to next week');
    await ui.press(ui.by('cal-cancel-save'));
    assert.ok(ui.sent.some((s) => s.method === 'DELETE' && s.url.endsWith('/ic-meetings/40?reason=Moved%20to%20next%20week')));
  } finally { await ui.unmount(); }
  ui = await mount(h(Drawer, { kind: 'founder_checkin', id: '50', onClose() {} }), [[/DELETE /, [{ ok: true }, 200]], ITEM(CHECKIN)]);
  try {
    await ui.press(ui.by('cal-item-cancel'));
    assert.equal(ui.by('cal-cancel-reason'), undefined);
    assert.equal(ui.say(ui.by('cal-cancel-no-reason')), 'A check-in keeps no reason, so none is asked.');
    await ui.press(ui.by('cal-cancel-save'));
    assert.ok(ui.sent.some((s) => s.method === 'DELETE' && s.url.endsWith('/founder-checkins/50')));
  } finally { await ui.unmount(); }
});

/* ------------------------------------------------------------------ *
 * CAL7 and CAL8: New
 * ------------------------------------------------------------------ */

const PICK = [
  [/GET .*\/api\/calendar\/deals/, [{ items: [{ id: 200, name: 'Acme Robotics', status: 'open' }] }, 200]],
  [/GET .*\/api\/calendar\/people\?for=ic/, [{ for: 'ic', items: [{ uid: 'u-bea', name: 'Bea', profile: 'Investor', how: ['Invited to Acme Robotics'], ventures: [] }] }, 200]],
  [/GET .*\/api\/calendar\/people\?for=checkin/, [{ for: 'checkin', items: [{ uid: 'u-gus', name: 'Gus', profile: 'Advisor', how: ['Advisor to Northwind Labs'], ventures: [{ id: 20, name: 'Northwind Labs' }] }] }, 200]],
];

test('CAL7: New IC meeting — the deal first, its people by name, Meet when Google is connected, and a past start refused inline', async () => {
  const { NewIcDialog } = await newModule();
  let saved = 0;
  const ui = await mount(h(NewIcDialog, { meetAvailable: true, onClose() {}, onSaved: () => { saved += 1; } }), [
    [/POST .*\/api\/calendar\/ic-meetings$/, [{ id: 90 }, 200]], ...PICK,
  ]);
  try {
    assert.match(ui.say(ui.by('cal-ic-dialog')), /New IC meeting Only investors and admins can join an IC meeting\./);
    assert.equal(ui.props(ui.by('cal-ic-people-q')).disabled, true, 'people wait for the deal');
    assert.equal(ui.props(ui.by('cal-ic-save')).disabled, true);
    await ui.type(ui.by('cal-ic-title'), 'Acme Robotics · Seed — IC');
    await ui.type(ui.by('cal-ic-start'), '2000-01-01T10:00');
    assert.equal(ui.say(ui.by('cal-ic-start-error')), 'Choose a time from now on.');
    await ui.type(ui.by('cal-ic-start'), '2999-01-05T14:00');
    await ui.waitFinder();
    await ui.press(ui.by('cal-ic-deal-option'));
    assert.match(ui.say(ui.by('cal-ic-deal-chosen')), /Acme Robotics/);
    await ui.waitFinder();
    assert.ok(ui.sent.some((s) => /\/api\/calendar\/people\?for=ic&deal_id=200/.test(s.url)), 'the people come from the deal');
    assert.match(ui.say(ui.by('cal-ic-people-option')), /Bea · Investor Invited to Acme Robotics/);
    await ui.press(ui.by('cal-ic-people-option'));
    assert.match(ui.say(ui.by('cal-ic-people-chosen')), /Bea/);
    assert.ok(ui.say(ui.by('cal-ic-people')).includes(SAYS.create), 'the People note says what the create does');
    assert.equal(ui.props(ui.by('cal-ic-place-meet')).checked, true, 'Meet is on when Google is connected');
    assert.match(ui.say(ui.by('cal-ic-place')), /Add a Google Meet link The link is made on your Google account/);
    assert.equal(ui.by('cal-ic-place-link'), undefined);
    await ui.press(ui.by('cal-ic-save'));
    const body = ui.sent.find((s) => s.method === 'POST').body;
    assert.deepEqual(body, {
      title: 'Acme Robotics · Seed — IC', start_at: new Date('2999-01-05T14:00').toISOString(), duration_min: 60, deal_id: 200,
      attendee_uids: ['u-bea'], agenda: null, add_meet: true,
    });
    assert.equal(saved, 1);
    assert.doesNotMatch(JSON.stringify(ui.sent), /attendee_user_ids|deal id/i, 'nobody types a number');
  } finally { await ui.unmount(); }
});

test('CAL7: without Google the Meet switch is not drawn, a pasted link is sent, and the plan gate reads as CAL18', async () => {
  const { NewIcDialog } = await newModule();
  const ui = await mount(h(NewIcDialog, { meetAvailable: false, onClose() {}, onSaved() {} }), [
    [/POST .*\/api\/calendar\/ic-meetings$/, [{ error: 'tier_required', required: 'professional', message: 'Upgrade' }, 402]], ...PICK,
  ]);
  try {
    assert.equal(ui.by('cal-ic-place-meet'), undefined);
    assert.equal(ui.say(ui.by('cal-ic-place-no-meet')), 'Connect Google to add a Meet link here.');
    await ui.type(ui.by('cal-ic-title'), 'Plain IC');
    await ui.type(ui.by('cal-ic-start'), '2999-01-05T14:00');
    await ui.waitFinder();
    await ui.press(ui.by('cal-ic-deal-option'));
    await ui.type(ui.by('cal-ic-place-link'), 'https://example.org/room');
    await ui.press(ui.by('cal-ic-save'));
    const body = ui.sent.find((s) => s.method === 'POST').body;
    assert.equal(body.location_uri, 'https://example.org/room');
    assert.equal('add_meet' in body, false);
    assert.match(ui.say(ui.by('cal-ic-refused-plan')), /Creating IC meetings is part of Investor Professional\. Everything else on Calendar works on your plan\. See plans/);
  } finally { await ui.unmount(); }
});

test('CAL8: New check-in — a founder picks who it is with; anyone else picks the founder; the venture follows the person', async () => {
  const { NewCheckinDialog } = await newModule();
  for (const [role, field] of [['founder', 'counterpart_uid'], ['advisor', 'founder_uid']]) {
    const ui = await mount(h(NewCheckinDialog, { role, meetAvailable: true, onClose() {}, onSaved() {} }), [
      [/POST .*\/api\/calendar\/founder-checkins$/, [{ id: 91 }, 200]], ...PICK,
    ]);
    try {
      assert.match(ui.say(ui.by('cal-ck-dialog')), /New check-in Book a check-in with someone you work with\./);
      await ui.waitFinder();
      assert.match(ui.say(ui.by('cal-ck-with')), /Search is limited to people you work with\./);
      await ui.press(ui.by('cal-ck-with-option'));
      assert.equal(ui.props(ui.by('cal-ck-venture')).value, '20', 'their one shared venture is chosen');
      assert.equal(ui.props(ui.by('cal-ck-title')).value, 'Northwind Labs check-in');
      await ui.type(ui.by('cal-ck-start'), '2999-01-05T10:00');
      const lengths = ui.nodes().filter((n) => n.tagName === 'BUTTON' && /^\d+ min$/.test(ui.say(n))).map((n) => ui.say(n));
      assert.deepEqual(lengths, ['15 min', '30 min', '45 min', '60 min']);
      await ui.press(ui.by('cal-ck-save'));
      const body = ui.sent.find((s) => s.method === 'POST').body;
      assert.equal(body[field], 'u-gus', `${role}: ${field}`);
      assert.equal(Object.keys(body).filter((k) => /_uid$/.test(k)).length, 1);
      assert.equal(body.project_id, 20);
      assert.equal(body.duration_min, 30);
      assert.equal(body.add_meet, true);
    } finally { await ui.unmount(); }
  }
});

test('CAL8 A: the New menu by role, items that leave the page carrying ↗', async () => {
  const { NewMenu } = await newModule();
  const picked = [];
  const ui = await mount(h(NewMenu, { role: 'investor', onPick: (k) => picked.push(k) }), []);
  try {
    await ui.press(ui.by('cal-new'));
    assert.match(ui.say(ui.by('cal-new-menu')), /IC meeting Check-in Event ↗ Opens New event Items that leave the page carry ↗\./);
    await ui.press(ui.by('cal-new-ic'));
    assert.deepEqual(picked, ['ic']);
    assert.equal(ui.by('cal-new-menu'), undefined, 'the menu closes');
  } finally { await ui.unmount(); }
});

/* ------------------------------------------------------------------ *
 * The page
 * ------------------------------------------------------------------ */

test('the page: the drawer route, each row opening its item, no browser pop-up, and the old number fields gone', () => {
  const page = read('frontend/src/pages/CalendarPage.jsx');
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<Route path="\/calendar\/item\/:kind\/:id" element=\{guard\(\['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'\], <CalendarPage \/>\)\} \/>/);
  assert.match(page, /const opened = itemOf\(location\.pathname\);/);
  assert.match(page, /const behind = opened \? \(location\.state\?\.from \|\| '\/calendar'\) : location\.pathname;/, 'the drawer sits over the view it came from');
  assert.match(page, /<CalendarItemDrawer kind=\{opened\.kind\} id=\{opened\.id\}/);
  assert.match(page, /onClose=\{\(\) => navigate\(behind\)\}/);
  assert.match(page, /<Link to=\{itemPath\(ev\.kind, ev\.source_id\)\} state=\{\{ from \}\}/, 'each row opens its item');
  assert.match(page, /<NewMenu role=\{role\}/);
  assert.match(page, /<NewIcDialog meetAvailable=\{gState === 'connected'\}/);
  assert.match(page, /<CancelDialog item=/);
  assert.doesNotMatch(page, /window\.confirm\(`Cancel/, 'Cancel is a dialog, never a browser pop-up');
  assert.doesNotMatch(page, /attendee_user_ids|Founder user id|Deal id \(required\)/, 'nobody types a user number or a deal id');
  for (const file of ['CalendarItemDrawer.jsx', 'CalendarNewDialogs.jsx']) {
    const src = read(`frontend/src/pages/${file}`);
    assert.doesNotMatch(src, /window\.(confirm|alert|prompt)\(/, `${file}: no browser pop-up`);
    const boxes = src.match(/<Lightbox [^\n]+/g) || [];
    assert.ok(boxes.length >= 2 && boxes.every((b) => b.includes('phone="sheet"')), `${file}: every dialog is a sheet on a phone`);
  }
});
