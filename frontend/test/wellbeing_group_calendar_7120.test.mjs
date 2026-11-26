/**
 * D7120 part 3 (#7120): the member's own calendar entry for a group seat, downloaded from My group seats. The entry
 * is text, read with the member's own credentials by `wellbeingGroupSessionsApi.calendarFile`. Confidentiality: the
 * request names only the seat, the file name never names the session, and the page says the entry lists no one else.
 * The entry's contents (no attendee, no organiser, "Private appointment" unless named) are the Worker's, tested in
 * cloudflare-worker/test/wellbeing_group_sessions_7120.test.ts. Sample data only.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/wellbeing_group_calendar_7120.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { installDocument } from './_contracts_dom.mjs';
import { calendarEntry, calendarRefusal } from '../src/pages/wellbeing/groupSessionsModel.js';
import { CalendarDownload } from '../src/pages/wellbeing/GroupSessions.jsx';
import { wellbeingGroupSessionsApi } from '../src/lib/api/wellbeingGroupSessions.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const SEAT = (over = {}) => ({ uid: 'r1', status: 'reserved', calendar: 'discreet', session: { uid: 'gs1', title: 'Synthetic circle', state: 'open' }, ...over });
const ICS = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'SUMMARY:Private appointment', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');

async function withFetch(answer, run) {
  const restore = installDocument();
  const prev = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return answer(); };
  try { return await run(calls); } finally { globalThis.fetch = prev; restore(); }
}

test('a reserved seat with a calendar choice offers its entry; released, cancelled or "none" offer nothing', () => {
  assert.match(calendarEntry(SEAT()).note, /“Private appointment”.*It lists no one else\./);
  assert.match(calendarEntry(SEAT({ calendar: 'named' })).note, /the session’s title\. It lists no one else\./);
  // Mutation checked: the 'none' check dropped → a member who chose no entry is offered one.
  assert.equal(calendarEntry(SEAT({ calendar: 'none' })), null);
  assert.equal(calendarEntry(SEAT({ status: 'cancelled' })), null, 'a released seat has no entry (the Worker 404s)');
  // Mutation checked: the session state check dropped → a cancelled session is offered a download.
  assert.equal(calendarEntry(SEAT({ session: { state: 'cancelled' } })), null);
  assert.equal(calendarEntry(null), null);
});

test('the download reads the entry as text with the member’s credentials, naming only the seat', async () => {
  await withFetch(() => new Response(ICS, { status: 200, headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="appointment.ics"' } }), async (calls) => {
    localStorage.setItem('token', 'synthetic-token');
    const out = await wellbeingGroupSessionsApi.calendarFile('r/1');
    assert.equal(out.text, ICS);
    assert.equal(out.filename, 'appointment.ics', 'the Worker’s name, never the session’s');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/wellbeing/group-reservations/r%2F1/calendar.ics', 'only the seat’s id, encoded');
    assert.equal(calls[0].init.credentials, 'include');
    assert.equal(calls[0].init.method, undefined, 'a read');
    assert.equal(calls[0].init.body, undefined, 'nothing is sent');
    assert.equal(calls[0].init.headers.Accept, 'text/calendar');
    // Mutation checked: rawRequestHeaders dropped → the member's token is not sent and the Worker refuses.
    assert.equal(calls[0].init.headers.Authorization, 'Bearer synthetic-token');
  });
});

test('a refusal or an answer that is not a calendar is said in words; the seat is unchanged', async () => {
  await withFetch(() => new Response(JSON.stringify({ error: 'calendar_entry_not_found', message: 'There is no calendar entry for this reservation.' }), { status: 404, headers: { 'Content-Type': 'application/json' } }), async () => {
    const e = await wellbeingGroupSessionsApi.calendarFile('r1').then(() => null, (x) => x);
    assert.equal(e.status, 404);
    assert.equal(e.code, 'calendar_entry_not_found');
    // Mutation checked: `|| e?.code` dropped from calendarRefusal → the raw fetch's code is not read.
    assert.equal(calendarRefusal(e), 'There is no calendar entry for this seat any more. Your seat is unchanged.');
  });
  // The app shell answered instead of the Worker (a 200 that is not a calendar): never saved as an .ics.
  await withFetch(() => new Response('<!doctype html><html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }), async () => {
    // Mutation checked: the VCALENDAR check dropped → the page would save HTML as appointment.ics.
    const e = await wellbeingGroupSessionsApi.calendarFile('r1').then(() => null, (x) => x);
    assert.equal(e?.code, 'calendar_unreadable');
    assert.equal(calendarRefusal(e), 'The calendar entry couldn’t be downloaded. Your seat is unchanged; try again.');
  });
});

test('the seat row draws the download with its line, and nothing for a seat without an entry', () => {
  const out = renderToStaticMarkup(h(CalendarDownload, { uid: 'r1', entry: calendarEntry(SEAT()) }));
  assert.match(out, /Download calendar entry \(\.ics\)/);
  assert.match(out, /It lists no one else\./);
  assert.doesNotMatch(out, /Synthetic circle/, 'the discreet seat’s download names no session');
  assert.equal(renderToStaticMarkup(h(CalendarDownload, { uid: 'r1', entry: null })), '');
});

test('wiring: My group seats offers each seat’s own entry; the file is saved from the text, under the Worker’s name', () => {
  const src = read('frontend/src/pages/wellbeing/GroupSessions.jsx');
  assert.match(src, /<CalendarDownload uid=\{row\.uid\} entry=\{calendarEntry\(r\)\} \/>/);
  assert.match(src, /wellbeingGroupSessionsApi\.calendarFile\(uid\)/);
  assert.match(src, /new Blob\(\[text\], \{ type: 'text\/calendar' \}\)/);
  assert.match(src, /a\.download = filename;/);
});
