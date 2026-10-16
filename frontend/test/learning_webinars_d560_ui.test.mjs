/**
 * D560 (#1161) on the Learning screens (D562, stage 3): the webinar page, the
 * Webinars tab and "Upcoming webinars", and the Super Admin's webinar studio.
 *
 * THE FIXTURES ARE BUILT BY D560'S OWN CODE where it is pure:
 * `memberWebinar` shapes every member payload at the clock each case stands
 * at, so a join link is in a fixture exactly when the route would send it;
 * `recordingOf` builds the recording; `refusalBody` each refusal. The
 * envelopes around them are copied from `routes/learning_webinars.ts` and
 * `routes/admin_learning_webinars.ts`. Every call goes through the real client
 * against a stubbed `fetch`, so the method, path and body are the page's own.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/learning_webinars_d560_ui.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';

import { memberWebinar, recordingOf } from '../../cloudflare-worker/src/services/learningWebinars.ts';
import { refusalBody } from '../../cloudflare-worker/src/util/refusal.ts';
import {
  attendanceCounts, matchesWebinar, nextRereadAt, ownZoneLine, wallTimeToInstant, webinarBody, webinarForm, webinarRow,
  webinarStudioRows,
} from '../src/pages/learning/webinarModel.js';
import {
  attachRecording, cancelRegistration, markAttendance, readStudioWebinar, readStudioWebinars, readWebinar, readWebinars,
  registerForWebinar, saveWebinar, setWebinarStatus,
} from '../src/pages/learning/webinarReads.js';
import WebinarPanel from '../src/pages/learning/WebinarPanel.jsx';
import {
  UpcomingWebinars, UpcomingWebinarsList, WEBINAR_LIST_CAP, WebinarList, WebinarPage, WebinarView, WebinarsTab, WebinarsTabPanel, webinarCoverage,
} from '../src/pages/learning/LearningWebinars.jsx';
import WebinarStudio, {
  WebinarAttendance, WebinarEditor, WebinarRecording, WebinarStatusActions, WebinarStudioList, WebinarStudioTable, cancelQuestion,
} from '../src/pages/learning/WebinarStudio.jsx';

// The viewer's zone; each case that is about the viewer's locale or zone passes its own.
process.env.TZ = 'UTC';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const html = (el, path = '/learning') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, el));
// `&amp;` is decoded last, so `&amp;quot;` reads as `&quot;`, never as a quote.
const flat = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
function tagOf(markup, id) {
  const at = markup.indexOf(`data-testid="${id}"`);
  if (at < 0) return '';
  return markup.slice(markup.lastIndexOf('<', at), markup.indexOf('>', at) + 1);
}
/** An element's opening tag and its visible text, up to its own closing tag. */
const elementOf = (markup, id) => {
  const tag = tagOf(markup, id);
  if (!tag) return { tag: '', label: '' };
  const name = tag.slice(1).split(/[\s>]/)[0];
  const at = markup.indexOf(tag) + tag.length;
  return { tag, label: flat(markup.slice(at, markup.indexOf(`</${name}>`, at))).trim() };
};
const count = (markup, needle) => markup.split(needle).length - 1;
/** The visible text of each list item carrying this test id. */
const rowsOf = (markup, id) => [...markup.matchAll(/<li[^>]*data-testid="([^"]*)"[^>]*>([\s\S]*?)<\/li>/g)]
  .filter((m) => m[1] === id).map((m) => flat(m[2]).trim());

// ── Fixtures, built by D560's own code ────────────────────────────────────

const MIN = 60 * 1000;
const JOIN = 'https://meet.example.test/room-42';
const ICS = '/api/learning/webinars/w1/calendar.ics';
const START = Date.parse('2026-10-20T16:00:00.000Z');
const END = Date.parse('2026-10-20T17:00:00.000Z');
const DAY_BEFORE = START - 24 * 60 * MIN;
const HOUR_BEFORE = START - 60 * MIN;
const IN_WINDOW = START - 10 * MIN;
const LIVE = START + 10 * MIN;
const AFTER = END + 60 * MIN;

/** A stored webinar (`WEBINAR_COLS`): an hour, set in Oslo, 50 seats, a join link. */
const ROW = {
  id: 7, uid: 'w1', title: 'Raising in the Nordics', abstract: 'A live session with HQ.', host_name: 'Ada Host',
  starts_at: '2026-10-20T16:00:00.000Z', ends_at: '2026-10-20T17:00:00.000Z', timezone: 'Europe/Oslo', join_url: JOIN,
  capacity: 50, recording_item_uid: null, visibility: 'open', status: 'published', created_by: 1,
  created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-02T10:00:00.000Z', published_at: '2026-10-02T10:00:00.000Z',
};
/** What a member is sent at `now`: `memberWebinar`, which gates the join link. */
const shaped = (row, now, { registered = false, count: registeredCount = 12 } = {}) => memberWebinar(row, { registeredCount, registered, now });
/** `registrationView` (routes/learning_webinars.ts). */
const NOT_REGISTERED = { registered: false, registered_at: null, attended: null };
// 02:00 UTC on 5 October is still 4 October in New York: the date a viewer reads depends on their zone.
const REGISTERED = { registered: true, registered_at: '2026-10-05T02:00:00.000Z', attended: null };
/** `GET /webinars/:uid`: `{ webinar, registration, recording, ics_href }`. */
const detailReply = (webinar, registration = NOT_REGISTERED, recording = null) => ({ webinar, registration, recording, ics_href: `/api/learning/webinars/${webinar.uid}/calendar.ics` });
/** A row of `GET /webinars?when=…`: `memberWebinar` without `join_url`, with `registered` and `recording`. */
function listRow(row, now, { registered = false, count: registeredCount = 12, recording = null } = {}) {
  const { join_url: _never, ...shown } = shaped(row, now, { registered, count: registeredCount });
  return { ...shown, registered, recording };
}
const envWith = (item) => ({ DB: { prepare: () => ({ bind: () => ({ first: async () => item }) }) } });
/** `recordingOf`: a published video attached, and none. */
const RECORDED = await recordingOf(envWith({ uid: 'v-rec', kind: 'video', status: 'published', visibility: 'open' }), { ...ROW, recording_item_uid: 'v-rec' });
const NOT_AVAILABLE = await recordingOf(envWith(null), ROW);
/** `refusal.ts`'s body, with each route's own sentence. */
const refused = (status, code, message) => ({ status, body: refusalBody({ code, message }) });

const UPCOMING_REPLY = {
  when: 'upcoming',
  webinars: [
    listRow(ROW, DAY_BEFORE, { registered: true }),
    listRow({ ...ROW, id: 8, uid: 'w2', title: 'Term sheets, live', host_name: 'Bo Host', capacity: null }, DAY_BEFORE, { count: 3 }),
    listRow({ ...ROW, id: 9, uid: 'w3', title: 'Pricing a round', capacity: 20 }, DAY_BEFORE, { count: 20 }),
    listRow({ ...ROW, id: 10, uid: 'w4', title: 'Board basics', status: 'cancelled' }, DAY_BEFORE),
  ],
};
const PAST_REPLY = {
  when: 'past',
  webinars: [
    listRow({ ...ROW, id: 11, uid: 'p1', title: 'Cap tables, live', recording_item_uid: 'v-rec' }, AFTER, { recording: RECORDED }),
    listRow({ ...ROW, id: 12, uid: 'p2', title: 'Hiring a CFO' }, AFTER, { recording: NOT_AVAILABLE }),
  ],
};

/** The admin `detail()`: the stored row without its id, `registered_count`, and the registrations by name and uid. */
const { id: _id, ...STORED } = ROW;
const REGISTRATIONS = [
  { uid: 'u-mia', name: 'Mia Member', registered_at: '2026-10-05T09:00:00.000Z', attended: true },
  { uid: 'u-pia', name: 'Pia Peer', registered_at: '2026-10-05T10:00:00.000Z', attended: null },
  { uid: 'u-tom', name: 'Tom Third', registered_at: '2026-10-06T10:00:00.000Z', attended: false },
];
const adminDetail = (over = {}, registrations = REGISTRATIONS) => ({ webinar: { ...STORED, ...over, registered_count: registrations.length }, registrations });
/** `GET /api/admin/learning/items` rows (D557's `ITEM_SELECT`). */
const item = (uid, kind, title, status) => ({
  uid, kind, title, summary: null, body: null, video_source: kind === 'video' ? 'url' : null, video_url: null, duration_seconds: null,
  thumbnail_url: null, transcript: null, topic: null, level: null, visibility: 'open', status, created_by: 1,
  created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-01T10:00:00.000Z', published_at: null,
});
const ITEMS = { status: 'ready', rows: [
  item('v-rec', 'video', 'Raising in the Nordics, recorded', 'published'),
  item('v-draft', 'video', 'Board basics, recorded', 'draft'),
  item('v-old', 'video', 'An archived video', 'archived'),
  item('r-terms', 'reading', 'Term sheet glossary', 'published'),
] };

/** The real client against a stubbed fetch: each call recorded, each reply taken in turn. */
async function withFetch(replies, run) {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.document ??= { cookie: '' };
  const calls = [];
  const queue = [...replies];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ method: init.method || 'GET', path: String(url).replace(/^.*\/api/, ''), body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const next = queue.shift() ?? { status: 200, body: {} };
    const reply = next.status ? next : { status: 200, body: next };
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
  };
  try { await run(); } finally { globalThis.fetch = orig; }
  return calls;
}
const route = (calls) => calls.map((c) => `${c.method} ${c.path}`);

const panel = (props) => html(h(WebinarPanel, { status: 'ready', locale: 'en-GB', ...props }));

// ── The member's reads and writes ─────────────────────────────────────────

test('the member reads: both lists and one webinar, each mapped from its reply', async () => {
  let upcoming; let past; let one;
  const calls = await withFetch([UPCOMING_REPLY, PAST_REPLY, detailReply(shaped(ROW, IN_WINDOW, { registered: true }), REGISTERED)], async () => {
    upcoming = await readWebinars('upcoming');
    past = await readWebinars('past');
    one = await readWebinar('w1');
  });
  assert.deepEqual(route(calls), ['GET /learning/webinars?when=upcoming', 'GET /learning/webinars?when=past', 'GET /learning/webinars/w1']);
  // Each row kept whole, with where it opens and its calendar file; no list carries a join link.
  assert.deepEqual(upcoming.rows.map((r) => [r.uid, r.href, r.icsHref]), [
    ['w1', '/learning/webinars/w1', '/api/learning/webinars/w1/calendar.ics'],
    ['w2', '/learning/webinars/w2', '/api/learning/webinars/w2/calendar.ics'],
    ['w3', '/learning/webinars/w3', '/api/learning/webinars/w3/calendar.ics'],
    ['w4', '/learning/webinars/w4', '/api/learning/webinars/w4/calendar.ics'],
  ]);
  assert.deepEqual([upcoming.when, past.when, upcoming.rows[1].seats_left, upcoming.rows[2].seats_left], ['upcoming', 'past', null, 0]);
  assert.deepEqual(past.rows.map((r) => r.recording), [RECORDED, NOT_AVAILABLE]);
  assert.ok([...upcoming.rows, ...past.rows].every((r) => !('join_url' in r)), 'a list row carries a join link');
  // One webinar: the route's link inside its window, the registration, the .ics from the client's own builder.
  assert.deepEqual([one.webinar.join_url, one.webinar.join, one.registration.registered, one.recording, one.icsHref], [JOIN, 'open', true, null, ICS]);
  // A reply in the wrong shape is a failed read; a 404 keeps its status for "no such webinar".
  await withFetch([{ items: [] }, { webinar: null }, refused(404, 'not_found', 'No such webinar.')], async () => {
    await assert.rejects(readWebinars('upcoming'), /The webinar list came back in a shape this page cannot read\./);
    await assert.rejects(readWebinar('w1'), /The webinar came back in a shape this page cannot read\./);
    await assert.rejects(readWebinar('gone'), (err) => err.status === 404 && err.message === 'No such webinar.');
  });
});

test('Register and Cancel registration read the webinar again; a refusal arrives in the route\'s words, with no read behind it', async () => {
  let fresh;
  const registered = await withFetch([
    { status: 201, body: { registration: REGISTERED } },
    detailReply(shaped(ROW, IN_WINDOW, { registered: true, count: 13 }), REGISTERED),
  ], async () => { fresh = await registerForWebinar('w1'); });
  assert.deepEqual(route(registered), ['POST /learning/webinars/w1/registration', 'GET /learning/webinars/w1']);
  assert.equal(registered[0].body, undefined, 'registering sends no body');
  // The seats and, inside the window, the link come from the read, not from the registration reply.
  assert.deepEqual([fresh.registration.registered, fresh.webinar.seats_left, fresh.webinar.join_url], [true, 37, JOIN]);
  const cancelled = await withFetch([{ registration: NOT_REGISTERED }, detailReply(shaped(ROW, DAY_BEFORE, { count: 12 }))], async () => {
    fresh = await cancelRegistration('w1');
  });
  assert.deepEqual(route(cancelled), ['DELETE /learning/webinars/w1/registration', 'GET /learning/webinars/w1']);
  assert.deepEqual([fresh.registration.registered, fresh.webinar.seats_left], [false, 38]);
  // The route's refusals, as they came: full, ended, cancelled, not registered.
  for (const [write, reply] of [
    [registerForWebinar, refused(409, 'full', 'This webinar is full.')],
    [registerForWebinar, refused(409, 'ended', 'This webinar has ended.')],
    [registerForWebinar, refused(409, 'cancelled', 'This webinar was cancelled.')],
    [cancelRegistration, refused(409, 'ended', 'This webinar has ended; its registrations are its attendance record.')],
    [cancelRegistration, refused(404, 'not_registered', 'You are not registered.')],
  ]) {
    const calls = await withFetch([reply], async () => {
      await assert.rejects(write('w1'), (err) => err.message === reply.body.message && err.code === reply.body.error && err.status === reply.status);
    });
    assert.equal(calls.length, 1, `${reply.body.error}: a refused write was followed by a read`);
  }
});

// ── The studio's calls ────────────────────────────────────────────────────

const FORM = {
  title: 'Raising in the Nordics', abstract: 'A live session with HQ.', host_name: 'Ada Host', date: '2026-10-20', time: '18:00',
  length: '60', timezone: 'Europe/Oslo', capacity: '50', join_url: JOIN, visibility: 'open',
};

test('the studio\'s calls go out with the right method, path and body', async () => {
  let list; let one;
  const calls = await withFetch([
    { webinars: [{ ...STORED, registered_count: 3 }] }, adminDetail(),
    { status: 201, body: adminDetail({ status: 'draft' }, []) }, adminDetail(),
    adminDetail({ status: 'published' }), adminDetail({ status: 'draft' }), adminDetail({ status: 'cancelled' }),
    adminDetail({ recording_item_uid: 'v-rec' }), adminDetail(),
    adminDetail(), adminDetail(), adminDetail(),
  ], async () => {
    list = await readStudioWebinars();
    one = await readStudioWebinar('w1');
    await saveWebinar({ uid: null, form: FORM });
    await saveWebinar({ uid: 'w1', form: { ...FORM, capacity: '', join_url: '', timezone: '', time: '16:30', length: '90' } });
    await setWebinarStatus('w1', 'publish');
    await setWebinarStatus('w1', 'unpublish');
    await setWebinarStatus('w1', 'cancel');
    await attachRecording('w1', 'v-rec');
    await attachRecording('w1', null);
    await markAttendance('w1', 'u-mia', true);
    await markAttendance('w1', 'u-tom', false);
    await markAttendance('w1', 'u-pia', null);
  });
  assert.deepEqual(route(calls), [
    'GET /admin/learning/webinars',
    'GET /admin/learning/webinars/w1',
    'POST /admin/learning/webinars',
    'PATCH /admin/learning/webinars/w1',
    'POST /admin/learning/webinars/w1/publish',
    'POST /admin/learning/webinars/w1/unpublish',
    'POST /admin/learning/webinars/w1/cancel',
    'PUT /admin/learning/webinars/w1/recording',
    'PUT /admin/learning/webinars/w1/recording',
    'PATCH /admin/learning/webinars/w1/registrations/u-mia',
    'PATCH /admin/learning/webinars/w1/registrations/u-tom',
    'PATCH /admin/learning/webinars/w1/registrations/u-pia',
  ]);
  assert.deepEqual([list.rows[0].registered_count, one.registrations.map((r) => r.uid)], [3, ['u-mia', 'u-pia', 'u-tom']]);
  // Scheduled: 18:00 on Oslo's clock is 16:00 UTC; the end is the start plus the length.
  assert.deepEqual(calls[2].body, {
    title: 'Raising in the Nordics', abstract: 'A live session with HQ.', host_name: 'Ada Host',
    starts_at: '2026-10-20T16:00:00.000Z', ends_at: '2026-10-20T17:00:00.000Z', timezone: 'Europe/Oslo',
    join_url: JOIN, capacity: '50', visibility: 'open',
  });
  // Saved: no zone is UTC's clock and is sent as null; an empty capacity is no limit and an empty link none, both null.
  assert.deepEqual(calls[3].body, {
    title: 'Raising in the Nordics', abstract: 'A live session with HQ.', host_name: 'Ada Host',
    starts_at: '2026-10-20T16:30:00.000Z', ends_at: '2026-10-20T18:00:00.000Z', timezone: null,
    join_url: null, capacity: null, visibility: 'open',
  });
  for (const i of [4, 5, 6]) assert.equal(calls[i].body, undefined, 'a status change sends no body');
  assert.deepEqual([calls[7].body, calls[8].body], [{ item_uid: 'v-rec' }, { item_uid: null }]);
  assert.deepEqual(calls.slice(9).map((c) => c.body), [{ attended: true }, { attended: false }, { attended: null }]);
  // A reply in the wrong shape is a failed read; a refusal keeps the route's words.
  await withFetch([{ webinars: null }, { webinar: STORED }, refused(400, 'needs_time', 'A webinar needs its start and end before it is published.')], async () => {
    await assert.rejects(readStudioWebinars(), /The webinar list came back in a shape this page cannot read\./);
    await assert.rejects(readStudioWebinar('w1'), /The webinar came back in a shape this page cannot read\./);
    await assert.rejects(setWebinarStatus('w1', 'publish'), (err) => err.message === 'A webinar needs its start and end before it is published.' && err.code === 'needs_time');
  });
});

test('the schedule is read on its own zone\'s clock and sent as UTC; what the page cannot convert is refused before anything is sent', async () => {
  // New York, the day the clocks go forward: 03:30 EDT is 07:30 UTC, and 02:30 never happens.
  assert.equal(wallTimeToInstant('2026-03-08', '03:30', 'America/New_York'), '2026-03-08T07:30:00.000Z');
  assert.equal(wallTimeToInstant('2026-10-20', '12:00', 'America/New_York'), '2026-10-20T16:00:00.000Z');
  assert.throws(() => wallTimeToInstant('2026-03-08', '02:30', 'America/New_York'), /02:30 on 2026-03-08 does not exist in America\/New_York: the clocks change then\./);
  assert.throws(() => wallTimeToInstant('2026-02-30', '10:00', 'UTC'), /2026-02-30 is not a date\./);
  for (const [form, message] of [
    [{ ...FORM, timezone: 'Mars/Olympus' }, /timezone is an IANA zone, such as Europe\/Paris\./],
    [{ ...FORM, time: '' }, /A start needs both its date and its time\./],
    [{ ...FORM, length: '1h' }, /Length is a whole number of minutes, such as 60\./],
    [{ ...FORM, date: '', time: '', length: '60' }, /A length needs the start’s date and time\./],
    [{ ...FORM, date: '2026-03-29', time: '02:30', timezone: 'Europe/Oslo' }, /does not exist in Europe\/Oslo/],
  ]) {
    const sent = await withFetch([], async () => { await assert.rejects(saveWebinar({ uid: 'w1', form }), message); });
    assert.deepEqual(sent, [], `${message}: a time the page cannot read went to the route anyway`);
  }
  // A draft may have no time yet: nothing is invented. Visibility is never sent empty: the route takes open or program.
  const untimed = webinarBody({ ...FORM, date: '', time: '', length: '', visibility: '' });
  assert.deepEqual([untimed.starts_at, untimed.ends_at, untimed.visibility], [null, null, 'open']);
});

test('a stored webinar reads back into the form on its own clock; a new one starts on the viewer\'s zone', () => {
  assert.deepEqual(webinarForm({ ...STORED, ends_at: '2026-10-20T17:30:00.000Z', capacity: null, join_url: null }), {
    title: 'Raising in the Nordics', abstract: 'A live session with HQ.', host_name: 'Ada Host', date: '2026-10-20', time: '18:00',
    length: '90', timezone: 'Europe/Oslo', capacity: '', join_url: '', visibility: 'open',
  });
  // No zone stored is UTC's clock, as the route shows it.
  assert.deepEqual([webinarForm({ ...STORED, timezone: null }).time, webinarForm({ ...STORED, timezone: null }).timezone], ['16:00', '']);
  assert.deepEqual(webinarForm(null, 'Asia/Tokyo'), {
    title: '', abstract: '', host_name: '', date: '', time: '', length: '', timezone: 'Asia/Tokyo', capacity: '', join_url: '', visibility: 'open',
  });
  // A round trip: the form a webinar reads back into sends that webinar's own times.
  const back = webinarBody(webinarForm(STORED));
  assert.deepEqual([back.starts_at, back.ends_at, back.timezone, back.capacity], [STORED.starts_at, STORED.ends_at, 'Europe/Oslo', '50']);
});

// ── The webinar page ──────────────────────────────────────────────────────

test('the webinar page, from memberWebinar: upcoming, registered, in the window, live, past, cancelled, a draft', () => {
  // Upcoming, not registered: in the viewer's zone, the seats the route counts, register and the calendar file.
  const up = panel({ webinar: shaped(ROW, DAY_BEFORE), registration: NOT_REGISTERED, icsHref: ICS, now: DAY_BEFORE, onRegister: () => {} });
  assert.deepEqual([
    elementOf(up, 'text-webinar-when').label, elementOf(up, 'text-webinar-zone').label, elementOf(up, 'text-webinar-host').label,
    elementOf(up, 'button-webinar-register').label, /disabled=""/.test(tagOf(up, 'button-webinar-register')), tagOf(up, 'link-webinar-ics').includes(`href="${ICS}"`),
  ], [
    'Tue, 20 Oct 2026, 16:00 UTC · 1 h 00 min', 'Set in Europe/Oslo: Tue, 20 Oct 2026, 18:00 CEST', 'Host Ada Host · capacity 50 · 12 registered · 38 seats left',
    'Register', false, true,
  ]);
  // Registered, an hour out: no link yet, and the registration can be cancelled.
  const early = panel({ webinar: shaped(ROW, HOUR_BEFORE, { registered: true }), registration: REGISTERED, now: HOUR_BEFORE, onUnregister: () => {} });
  assert.deepEqual([elementOf(early, 'button-webinar-unregister').label, tagOf(early, 'link-webinar-join'), elementOf(early, 'text-webinar-note').label, elementOf(early, 'text-webinar-registered').label],
    ['Cancel registration', '', 'The join link appears here 15 minutes before the start.', 'Registered 5 Oct 2026']);
  // In the window: the route's link, opened in a new tab.
  const open = panel({ webinar: shaped(ROW, IN_WINDOW, { registered: true }), registration: REGISTERED, now: IN_WINDOW, onUnregister: () => {} });
  assert.deepEqual([tagOf(open, 'link-webinar-join').includes(`href="${JOIN}"`), elementOf(open, 'button-webinar-unregister').label], [true, 'Cancel registration']);
  // Live: when it started and ends, the link, and the registration can still be cancelled before the end.
  const live = panel({ webinar: shaped(ROW, LIVE, { registered: true }), registration: REGISTERED, now: LIVE, onUnregister: () => {} });
  assert.deepEqual([elementOf(live, 'text-webinar-when').label, tagOf(live, 'link-webinar-join').includes(`href="${JOIN}"`), Boolean(tagOf(live, 'button-webinar-unregister'))],
    ['Started 16:00 UTC · ends 17:00 UTC', true, true]);
  // Past: the route's recording, no seats left counted, and the member's own attendance.
  const past = panel({ webinar: shaped({ ...ROW, recording_item_uid: 'v-rec' }, AFTER, { registered: true }), registration: { ...REGISTERED, attended: true }, recording: RECORDED, now: AFTER });
  assert.deepEqual([tagOf(past, 'link-webinar-recording').includes('href="/learning/videos/v-rec"'), /seats left/.test(flat(past)), elementOf(past, 'text-webinar-attended').label],
    [true, false, 'You attended.']);
  const unmarked = panel({ webinar: shaped(ROW, AFTER, { registered: true }), registration: REGISTERED, recording: NOT_AVAILABLE, now: AFTER });
  assert.deepEqual([elementOf(unmarked, 'text-webinar-note').label, elementOf(unmarked, 'text-webinar-attended').label], ['Recording not available', 'Your attendance is not recorded.']);
  // A cancelled webinar and a draft (which only the Super Admin can open) both arrive with `join: 'cancelled'`:
  // the status tells them apart, and neither offers a registration, the room or the calendar file.
  const off = panel({ webinar: shaped({ ...ROW, status: 'cancelled' }, DAY_BEFORE, { registered: true }), registration: REGISTERED, icsHref: ICS, now: DAY_BEFORE, onRegister: () => {}, onUnregister: () => {} });
  const draft = panel({ webinar: shaped({ ...ROW, status: 'draft' }, DAY_BEFORE), registration: NOT_REGISTERED, icsHref: ICS, now: DAY_BEFORE, onRegister: () => {} });
  assert.deepEqual([
    [off, draft].map((m) => /data-phase="(\w+)"/.exec(tagOf(m, 'webinar-panel'))?.[1]),
    [off, draft].map((m) => flat(m).trim().split(' Raising in the Nordics')[0]),
    elementOf(off, 'text-webinar-note').label, elementOf(draft, 'text-webinar-note').label,
    [off, draft].some((m) => /button-webinar-register|button-webinar-unregister|link-webinar-ics|link-webinar-join/.test(m)),
  ], [['cancelled', 'draft'], ['Webinar Cancelled', 'Webinar Draft'], 'This webinar was cancelled.', 'This webinar is a draft. Members cannot see it until it is published.', false]);
});

test('seats as the route returns them: a limit with seats left, no limit, and full', () => {
  const seatsLine = (webinar, now = DAY_BEFORE) => elementOf(panel({ webinar, registration: NOT_REGISTERED, now, onRegister: () => {} }), 'text-webinar-host').label;
  assert.equal(seatsLine(shaped(ROW, DAY_BEFORE, { count: 49 })), 'Host Ada Host · capacity 50 · 49 registered · 1 seat left');
  // `capacity: null` is no limit (D560): never "0 seats" and never "not recorded".
  assert.equal(seatsLine(shaped({ ...ROW, capacity: null }, DAY_BEFORE, { count: 3 })), 'Host Ada Host · no seat limit · 3 registered');
  const full = panel({ webinar: shaped({ ...ROW, capacity: 20 }, DAY_BEFORE, { count: 20 }), registration: NOT_REGISTERED, now: DAY_BEFORE, onRegister: () => {} });
  assert.deepEqual([elementOf(full, 'text-webinar-host').label, elementOf(full, 'button-webinar-register').label, /disabled=""/.test(tagOf(full, 'button-webinar-register'))],
    ['Host Ada Host · capacity 20 · 20 registered · no seats left', 'Full', true]);
});

test('times in the viewer\'s locale and zone, with the webinar\'s own zone beside them', () => {
  const opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
  // No locale passed: the runtime's own, which is the viewer's in a browser.
  const viewer = panel({ webinar: shaped(ROW, DAY_BEFORE), registration: NOT_REGISTERED, now: DAY_BEFORE, locale: undefined });
  assert.ok(elementOf(viewer, 'text-webinar-when').label.startsWith(new Intl.DateTimeFormat(undefined, opts).format(new Date(START))));
  const ny = panel({ webinar: shaped(ROW, DAY_BEFORE), registration: REGISTERED, now: DAY_BEFORE, locale: 'en-US', timeZone: 'America/New_York' });
  // A viewer in Oslo reads the webinar's own time, so it is said once.
  const oslo = panel({ webinar: shaped(ROW, DAY_BEFORE), now: DAY_BEFORE, timeZone: 'Europe/Oslo' });
  assert.deepEqual([elementOf(ny, 'text-webinar-when').label, elementOf(ny, 'text-webinar-zone').label, elementOf(oslo, 'text-webinar-when').label, tagOf(oslo, 'text-webinar-zone')], [
    'Tue, Oct 20, 2026, 12:00 PM EDT · 1 h 00 min',
    'Set in Europe/Oslo: Tue, Oct 20, 2026, 6:00 PM GMT+2',
    'Tue, 20 Oct 2026, 18:00 CEST · 1 h 00 min',
    '',
  ]);
  assert.equal(elementOf(ny, 'text-webinar-registered').label, 'Registered Oct 4, 2026');
  assert.equal(ownZoneLine({ starts_at: ROW.starts_at, timezone: 'Europe/Paris' }, { locale: 'en-GB', timeZone: 'Europe/Berlin' }), null);
});

test('the join link is the route\'s: drawn only when it arrives, and never built', () => {
  // Registered, inside the window, but no link was set: the route's `join` is `open` with no link.
  const unset = panel({ webinar: shaped({ ...ROW, join_url: null }, IN_WINDOW, { registered: true }), registration: REGISTERED, now: IN_WINDOW });
  assert.deepEqual([tagOf(unset, 'link-webinar-join'), /href="https:/.test(unset), elementOf(unset, 'text-webinar-note').label], ['', false, 'No join link has been set for this webinar yet.']);
  // Not registered, inside the window: the route sends no link, and the page asks the member to register.
  const outsider = panel({ webinar: shaped(ROW, LIVE), registration: NOT_REGISTERED, now: LIVE, onRegister: () => {} });
  // The join address appears nowhere on the page (counted, not a URL substring test).
  assert.deepEqual([tagOf(outsider, 'link-webinar-join'), count(outsider, JOIN), elementOf(outsider, 'text-webinar-note').label, elementOf(outsider, 'text-webinar-host').label],
    ['', 0, 'Register to receive the join link.', 'Host Ada Host · capacity 50 · 12 registered · 38 seats left']);
  // The recording link is the route's, and is drawn only inside Learning.
  const good = panel({ webinar: shaped(ROW, AFTER), registration: NOT_REGISTERED, recording: RECORDED, now: AFTER });
  const odd = panel({ webinar: shaped(ROW, AFTER), registration: NOT_REGISTERED, recording: { available: true, item_uid: 'x', href: 'javascript:alert(1)' }, now: AFTER });
  assert.deepEqual([tagOf(good, 'link-webinar-recording').includes('href="/learning/videos/v-rec"'), tagOf(odd, 'link-webinar-recording'), /javascript:/.test(odd)], [true, '', false]);
});

test('the page\'s view: a refusal in the route\'s words, no such webinar, loading and unreadable', () => {
  const state = { status: 'ready', webinar: shaped({ ...ROW, capacity: 20 }, DAY_BEFORE, { count: 20 }), registration: NOT_REGISTERED, recording: null, icsHref: ICS };
  const refusedView = html(h(WebinarView, { state, now: DAY_BEFORE, locale: 'en-GB', onRegister: () => {}, actionError: 'This webinar is full.' }));
  assert.deepEqual([elementOf(refusedView, 'text-webinar-refusal').label, tagOf(refusedView, 'text-webinar-refusal').includes('role="alert"')], ['This webinar is full.', true]);
  assert.ok(tagOf(refusedView, 'link-webinar-ics').includes(`href="${ICS}"`), 'the read\'s .ics link is not drawn');
  const ended = html(h(WebinarView, { state: { status: 'ready', webinar: shaped(ROW, AFTER), registration: NOT_REGISTERED, recording: RECORDED, icsHref: ICS }, now: AFTER }));
  assert.match(tagOf(ended, 'link-webinar-recording'), /href="\/learning\/videos\/v-rec"/, 'the read\'s recording is not drawn');
  const missing = html(h(WebinarView, { state: { status: 'missing', message: 'No such webinar.' } }));
  assert.deepEqual([/No such webinar/.test(flat(missing)), /It does not exist, or it is not open to you\./.test(flat(missing)), /href="\/learning\?tab=webinars"/.test(missing)], [true, true, true]);
  assert.match(html(h(WebinarView, { state: { status: 'loading' } })), /data-testid="webinar-panel"[^]*learning-loading/);
  assert.match(flat(html(h(WebinarView, { state: { status: 'unreadable' }, onRetry: () => {} }))), /The webinar could not be read\. This is not a claim that the webinar does not exist\. Retry/);
  assert.deepEqual(webinarCoverage({ status: 'ready', webinar: shaped(ROW, DAY_BEFORE), registration: REGISTERED }),
    ['One webinar: “Raising in the Nordics”', '12 registered of 50 seats', 'You are registered']);
  assert.deepEqual(webinarCoverage({ status: 'unreadable' }), []);
});

test('a page left open reads again as the join window opens, at the start and at the end', () => {
  const w = shaped(ROW, DAY_BEFORE);
  assert.deepEqual([nextRereadAt(w, HOUR_BEFORE), nextRereadAt(w, IN_WINDOW), nextRereadAt(w, LIVE), nextRereadAt(w, AFTER)], [START - 15 * MIN, START, END, null]);
  // Nothing to wait for on a cancelled webinar, or more than a day ahead.
  assert.deepEqual([nextRereadAt({ ...w, status: 'cancelled' }, HOUR_BEFORE), nextRereadAt(w, START - 3 * 24 * 60 * MIN)], [null, null]);
});

// ── The Webinars tab and "Upcoming webinars" ──────────────────────────────

const ready = (reply) => ({ status: 'ready', when: reply.when, rows: reply.webinars.map((w) => webinarRow(w, (uid) => `/api/learning/webinars/${uid}/calendar.ics`)) });

test('the Webinars tab: upcoming with where each stands, past with its recording, each list in its own state', () => {
  const markup = html(h(WebinarsTabPanel, { upcoming: ready(UPCOMING_REPLY), past: ready(PAST_REPLY), now: DAY_BEFORE, locale: 'en-GB' }));
  const upcoming = markup.slice(markup.indexOf('data-testid="list-webinars-upcoming"'), markup.indexOf('data-testid="list-webinars-past"'));
  assert.deepEqual(rowsOf(upcoming, 'row-webinar'), [
    'Tue, 20 Oct 2026, 16:00 UTC Raising in the Nordics Registered Host Ada Host · capacity 50 · 12 registered Add to calendar',
    'Tue, 20 Oct 2026, 16:00 UTC Term sheets, live Host Bo Host · no seat limit · 3 registered Add to calendar',
    'Tue, 20 Oct 2026, 16:00 UTC Pricing a round Full Host Ada Host · capacity 20 · 20 registered Add to calendar',
    'Tue, 20 Oct 2026, 16:00 UTC Board basics Cancelled Host Ada Host · capacity 50 · 12 registered',
  ]);
  assert.match(upcoming, /href="\/learning\/webinars\/w1"/);
  assert.match(upcoming, /href="\/api\/learning\/webinars\/w2\/calendar\.ics" download=""/);
  const past = markup.slice(markup.indexOf('data-testid="list-webinars-past"'));
  assert.match(tagOf(past, 'link-webinar-row-recording'), /href="\/learning\/videos\/v-rec"/);
  assert.equal(elementOf(past, 'text-webinar-row-recording').label, 'Recording not available');
  assert.equal(count(past, 'link-webinar-row-ics'), 0, 'a past webinar offers its calendar file');
  const oddRow = { ...ready(PAST_REPLY).rows[0], recording: { available: true, item_uid: 'x', href: 'javascript:alert(1)' } };
  assert.doesNotMatch(html(h(WebinarList, { state: { status: 'ready', rows: [oddRow] }, when: 'past' })), /javascript:/);
  assert.equal(count(markup, 'link-webinar-join'), 0, 'a list offers the room');
  // Live by the clock, and the search filters what the route sent (it takes no query).
  assert.match(flat(html(h(WebinarList, { state: ready(UPCOMING_REPLY), when: 'upcoming', now: LIVE, locale: 'en-GB' }))), /Raising in the Nordics Live Registered/);
  const byHost = html(h(WebinarList, { state: ready(UPCOMING_REPLY), when: 'upcoming', q: 'bo host', now: DAY_BEFORE }));
  assert.deepEqual([count(byHost, 'data-testid="row-webinar"'), /Term sheets, live/.test(flat(byHost))], [1, true]);
  assert.equal(matchesWebinar(UPCOMING_REPLY.webinars[0], 'WITH HQ'), true);
  assert.match(flat(html(h(WebinarList, { state: ready(UPCOMING_REPLY), when: 'upcoming', q: 'zeta' }))), /No upcoming webinar matches “zeta”/);
  // One list failing names itself and blanks nothing else; empty is not unreadable.
  const half = html(h(WebinarsTabPanel, { upcoming: { status: 'unreadable' }, past: ready(PAST_REPLY), onRetry: { upcoming: () => {} } }));
  assert.match(flat(half), /The upcoming webinars could not be read\. This is not a claim that none is scheduled\. Retry/);
  assert.match(flat(half), /Cap tables, live/);
  const otherHalf = flat(html(h(WebinarsTabPanel, { upcoming: ready(UPCOMING_REPLY), past: { status: 'unreadable' }, onRetry: { past: () => {} } })));
  assert.match(otherHalf, /Raising in the Nordics[^]*The past webinars could not be read\. This is not a claim that none has taken place\. Retry/);
  // The route answers at most 100 rows (`LIMIT 100`): a full list says it may not be every webinar.
  const many = (n) => ({ status: 'ready', rows: Array.from({ length: n }, (_, i) => webinarRow(listRow({ ...ROW, id: 100 + i, uid: `x${i}` }, AFTER), () => null)) });
  assert.equal(WEBINAR_LIST_CAP, 100);
  assert.equal(elementOf(html(h(WebinarList, { state: many(100), when: 'past', now: AFTER })), 'text-webinars-past-cap').label,
    'The newest 100 past webinars. The list stops at 100, so older ones are not shown here.');
  assert.equal(elementOf(html(h(WebinarList, { state: many(100), when: 'upcoming', now: DAY_BEFORE })), 'text-webinars-upcoming-cap').label,
    'The next 100 webinars. The list stops at 100, so later ones are not shown here.');
  assert.equal(tagOf(html(h(WebinarList, { state: many(99), when: 'past', now: AFTER })), 'text-webinars-past-cap'), '');
  const empty = flat(html(h(WebinarsTabPanel, { upcoming: { status: 'ready', rows: [] }, past: { status: 'ready', rows: [] } })));
  assert.match(empty, /No webinar scheduled[^]*No past webinar/);
  assert.match(html(h(WebinarsTabPanel, { upcoming: { status: 'loading' }, past: { status: 'idle' } })), /learning-loading[^]*learning-loading/);
});

test('"Upcoming webinars" on the home: the next three, each with a way to register on its page', () => {
  const markup = html(h(UpcomingWebinarsList, { state: ready(UPCOMING_REPLY), now: DAY_BEFORE, locale: 'en-GB' }));
  assert.deepEqual(rowsOf(markup, 'row-upcoming-webinar'), [
    '20 Oct, 16:00 UTC Raising in the Nordics Registered',
    '20 Oct, 16:00 UTC Term sheets, live Register →',
    '20 Oct, 16:00 UTC Pricing a round Full',
  ]);
  assert.match(tagOf(markup, 'link-upcoming-register'), /href="\/learning\/webinars\/w2"/);
  assert.match(flat(markup), /The next 3 of 4\. All webinars/);
  assert.match(tagOf(markup, 'link-all-webinars'), /href="\/learning\?tab=webinars"/);
  assert.match(flat(html(h(UpcomingWebinarsList, { state: { status: 'ready', rows: [] } }))), /No webinar scheduled/);
  assert.match(flat(html(h(UpcomingWebinarsList, { state: { status: 'unreadable' }, onRetry: () => {} }))), /The upcoming webinars could not be read\. This is not a claim that none is scheduled\./);
  assert.match(html(h(UpcomingWebinarsList, { state: { status: 'loading' } })), /learning-loading/);
});

test('the containers mount, read nothing on the server, and frame what they draw', () => {
  const pageMarkup = html(h(WebinarPage, { uid: 'w1' }), '/learning/webinars/w1');
  assert.match(tagOf(pageMarkup, 'link-learning-back'), /href="\/learning\?tab=webinars"/);
  assert.match(pageMarkup, /data-testid="webinar-panel"[^]*learning-loading/);
  assert.match(flat(pageMarkup), /Eadwyn AI .{0,24}?Learning/);
  assert.match(html(h(WebinarsTab, {})), /data-testid="webinars-tab"[^]*learning-loading[^]*learning-loading/);
  assert.match(html(h(UpcomingWebinars, {})), /data-testid="section-webinars"[^]*learning-loading/);
  assert.match(html(h(WebinarStudio, { uid: 'w1' }), '/learning/studio?webinar=w1'), /learning-loading/);
  assert.match(html(h(WebinarStudioList, {}), '/learning/studio'), /data-testid="studio-webinars"[^]*learning-loading/);
  // A new webinar: the scheduler, on the viewer's zone, created as a draft.
  const fresh = html(h(WebinarStudio, { uid: null }), '/learning/studio?new=webinar');
  assert.deepEqual([tagOf(fresh, 'input-webinar-timezone').includes('value="UTC"'), elementOf(fresh, 'button-webinar-save').label, /studio-webinar-status|studio-webinar-recording"|studio-webinar-attendance/.test(fresh)],
    [true, 'Create draft', false]);
});

// ── The studio ────────────────────────────────────────────────────────────

test('the studio editor: the schedule on the webinar\'s own clock, status actions by status, and the member\'s page', () => {
  const markup = html(h(WebinarEditor, { detail: adminDetail(), items: ITEMS, handlers: {}, locale: 'en-GB' }), '/learning/studio?webinar=w1');
  for (const [id, value] of [
    ['input-webinar-title', 'Raising in the Nordics'], ['input-webinar-date', '2026-10-20'], ['input-webinar-time', '18:00'],
    ['input-webinar-length', '60'], ['input-webinar-timezone', 'Europe/Oslo'], ['input-webinar-capacity', '50'], ['input-webinar-join-url', JOIN],
  ]) assert.ok(tagOf(markup, id).includes(`value="${value}"`), `${id} is not ${value}`);
  assert.match(flat(markup), /Tue, 20 Oct 2026, 16:00 UTC · capacity 50 · 3 registered · The member’s page/);
  assert.match(tagOf(markup, 'link-webinar-member-page'), /href="\/learning\/webinars\/w1"/);
  assert.equal(elementOf(markup, 'button-webinar-save').label, 'Save changes');
  const actions = (status) => ['publish', 'unpublish', 'cancel'].filter((a) => html(h(WebinarStatusActions, { status, onStatus: () => {} })).includes(`button-webinar-${a}"`));
  assert.deepEqual([actions('draft'), actions('published'), actions('cancelled')], [['publish'], ['unpublish', 'cancel'], ['publish', 'unpublish']]);
  // No limit stored: the capacity field is empty, and the summary says so.
  const unlimited = html(h(WebinarEditor, { detail: adminDetail({ capacity: null }), handlers: {} }));
  assert.deepEqual([tagOf(unlimited, 'input-webinar-capacity').includes('value=""'), /no seat limit/.test(flat(unlimited))], [true, true]);
});

test('cancelling asks first, with what it does to the registered members, and only the confirmation cancels', () => {
  const first = html(h(WebinarStatusActions, { status: 'published', registeredCount: 3, onStatus: () => {} }));
  assert.deepEqual([elementOf(first, 'button-webinar-cancel').label, tagOf(first, 'studio-confirm-cancel')], ['Cancel webinar', '']);
  assert.deepEqual([cancelQuestion(3), cancelQuestion(1), cancelQuestion(0), cancelQuestion(null)], [
    'Cancel this webinar? Its 3 registered members see it marked as cancelled, and nobody can register or join. You can publish it again.',
    'Cancel this webinar? Its one registered member sees it marked as cancelled, and nobody can register or join. You can publish it again.',
    'Cancel this webinar? Nobody has registered yet; members see it marked as cancelled, and nobody can register or join. You can publish it again.',
    'Cancel this webinar? Its registered members see it marked as cancelled, and nobody can register or join. You can publish it again.',
  ]);
  // A server render cannot click, so the wiring is read from the source, as the archive confirmation's is.
  const src = codeOnly(read('frontend/src/pages/learning/WebinarStudio.jsx'));
  assert.match(src, /onClick=\{\(\) => setConfirming\(true\)\} disabled=\{busy\} data-testid="button-webinar-cancel"/);
  assert.match(src, /onClick=\{\(\) => \{ setConfirming\(false\); onStatus\('cancel'\); \}\}/);
  assert.equal(count(src, "onStatus('cancel')"), 1, 'something else cancels without asking');
  assert.equal(count(src, "'cancel'"), 1, 'another path names the cancel action');
});

test('the recording: a video attached, a draft one said to be hidden, archived videos and readings left out', () => {
  const markup = html(h(WebinarRecording, { webinar: { ...STORED, recording_item_uid: 'v-draft' }, items: ITEMS, onAttach: () => {} }));
  assert.equal(elementOf(markup, 'studio-webinar-recording-current').label,
    'Attached: Board basics, recorded · Draft: members see “Recording not available” until it is published.');
  assert.deepEqual([...markup.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => [m[1], m[2]]), [
    ['', 'Choose a video…'], ['v-rec', 'Raising in the Nordics, recorded'], ['v-draft', 'Board basics, recorded (draft)'],
  ]);
  assert.deepEqual([elementOf(markup, 'button-webinar-attach').label, Boolean(tagOf(markup, 'button-webinar-detach'))], ['Replace', true]);
  const none = html(h(WebinarRecording, { webinar: STORED, items: ITEMS, onAttach: () => {} }));
  assert.deepEqual([elementOf(none, 'studio-webinar-recording-current').label, elementOf(none, 'button-webinar-attach').label, tagOf(none, 'button-webinar-detach')],
    ['No recording attached. Once the webinar has ended, members see “Recording not available”.', 'Attach', '']);
  // An attached item the list does not hold is named by its uid, never dropped.
  assert.match(flat(html(h(WebinarRecording, { webinar: { ...STORED, recording_item_uid: 'v-gone' }, items: ITEMS }))), /Attached: item v-gone/);
  assert.match(flat(html(h(WebinarRecording, { webinar: STORED, items: { status: 'ready', rows: [ITEMS.rows[3]] } }))), /No video to attach yet\. Add the recording as a video ?, then attach it here\./);
  assert.match(flat(html(h(WebinarRecording, { webinar: STORED, items: { status: 'unreadable' }, onRetryItems: () => {} }))), /The video list could not be read\. This is not a claim that there are no videos\./);
});

test('attendance: each registrant by name, marked attended, absent or not recorded, and not recorded is never counted absent', () => {
  const markup = html(h(WebinarAttendance, { registrations: REGISTRATIONS, onMark: () => {}, locale: 'en-GB' }));
  assert.match(flat(markup), /Registrations and attendance 3 registered · 1 attended · 1 did not attend · 1 not recorded/);
  assert.match(flat(markup.slice(markup.indexOf('registration-u-mia'))), /^[^]*?Mia Member Registered 5 Oct 2026 Attended Did not attend Not recorded/);
  const pressed = (uid) => ['attended', 'absent', 'unrecorded'].filter((k) => tagOf(markup, `button-attendance-${uid}-${k}`).includes('aria-pressed="true"'));
  assert.deepEqual([pressed('u-mia'), pressed('u-tom'), pressed('u-pia')], [['attended'], ['absent'], ['unrecorded']]);
  assert.deepEqual(attendanceCounts([{ attended: null }, { attended: undefined }, { attended: false }]), { registered: 3, attended: 0, absent: 1, unrecorded: 2 });
  const nobody = html(h(WebinarAttendance, { registrations: [] }));
  assert.match(flat(nobody), /No one has registered yet/);
  assert.doesNotMatch(flat(nobody), /0 registered/, 'an empty list was counted');
});

test('a refusal in the studio is shown in the route\'s words, beside the part it was made in', () => {
  const at = (where, message) => html(h(WebinarEditor, { detail: adminDetail(), items: ITEMS, handlers: {}, said: { where, error: message } }));
  const capacity = at('schedule', '3 members are registered; the capacity cannot be lower.');
  assert.deepEqual([elementOf(capacity, 'studio-webinar-error').label, count(capacity, 'role="alert"')], ['3 members are registered; the capacity cannot be lower.', 1]);
  const video = at('recording', 'A recording is a video item.');
  assert.deepEqual([elementOf(video, 'studio-webinar-recording-error').label, tagOf(video, 'studio-webinar-error')], ['A recording is a video item.', '']);
  assert.equal(elementOf(at('status', 'Only a published webinar is cancelled; unpublish a draft instead.'), 'studio-webinar-status-error').label,
    'Only a published webinar is cancelled; unpublish a draft instead.');
  assert.equal(elementOf(at('attendance', 'That user is not registered.'), 'studio-webinar-attendance-error').label, 'That user is not registered.');
  assert.equal(elementOf(html(h(WebinarEditor, { detail: adminDetail(), handlers: {}, said: { notice: 'Published.' } })), 'studio-webinar-notice').label, 'Published.');
});

test('the studio\'s list of webinars, and webinars as rows of the content table', () => {
  const rows = [{ ...STORED, registered_count: 3, recording_item_uid: 'v-rec' }, { ...STORED, uid: 'w2', title: 'Term sheets, live', capacity: null, status: 'draft', starts_at: null, ends_at: null, registered_count: 0 }];
  const markup = html(h(WebinarStudioTable, { status: 'ready', rows, locale: 'en-GB' }), '/learning/studio');
  assert.match(flat(markup.slice(markup.indexOf('studio-webinar-row-w1'))), /^[^]*?Raising in the Nordics Published 20 Oct, 16:00 UTC 3 registered · capacity 50 Recording attached/);
  assert.match(flat(markup.slice(markup.indexOf('studio-webinar-row-w2'))), /^[^]*?Term sheets, live Draft Start not recorded 0 registered · no seat limit No recording/);
  assert.match(tagOf(markup, 'link-studio-webinar-w1'), /href="\/learning\/studio\?webinar=w1"/);
  assert.match(tagOf(markup, 'link-studio-new-webinar'), /href="\/learning\/studio\?new=webinar"/);
  assert.match(flat(markup), /Webinars 2 webinars, drafts included/);
  assert.match(flat(html(h(WebinarStudioTable, { status: 'unreadable', rows: [], onRetry: () => {} }), '/learning/studio')), /The webinar list could not be read\. This is not a claim that none has been scheduled\./);
  assert.match(flat(html(h(WebinarStudioTable, { status: 'ready', rows: [] }), '/learning/studio')), /No webinar yet/);
  assert.deepEqual(webinarStudioRows(rows), [
    { kind: 'webinar', uid: 'w1', title: 'Raising in the Nordics', status: 'published', visibility: 'open', programs: null, updated_at: STORED.updated_at, href: '/learning/studio?webinar=w1' },
    { kind: 'webinar', uid: 'w2', title: 'Term sheets, live', status: 'draft', visibility: 'open', programs: null, updated_at: STORED.updated_at, href: '/learning/studio?webinar=w2' },
  ]);
});

test('only webinarReads.js calls the client for webinars, through methods the client declares', () => {
  const dir = 'frontend/src/pages/learning';
  for (const f of ['LearningWebinars.jsx', 'WebinarStudio.jsx', 'WebinarPanel.jsx', 'webinarModel.js']) {
    assert.doesNotMatch(codeOnly(read(`${dir}/${f}`)), /lib\/api(\/\w+(\.js)?)?'/, `${f} reads the client directly`);
  }
  const src = codeOnly(read(`${dir}/webinarReads.js`));
  // One literal pattern for both clients (never a RegExp built from a variable).
  const calls = [...src.matchAll(/\b(learningApi|adminLearningApi)\.(\w+)\b/g)];
  for (const [client, file] of [['learningApi', 'frontend/src/lib/api/learning.js'], ['adminLearningApi', 'frontend/src/lib/api/adminLearning.js']]) {
    const declared = read(file);
    const called = [...new Set(calls.filter((m) => m[1] === client).map((m) => m[2]))];
    assert.ok(called.length >= 4, `webinarReads.js calls no ${client} method`);
    for (const method of called) assert.ok(declared.includes(`  ${method}: (`), `${client}.${method} is not a method ${file} declares`);
  }
});
