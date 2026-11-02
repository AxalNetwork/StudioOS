/**
 * D1485 (#3979) — the page's side of Google and Outlook events and "Copy new
 * Axal sessions to…":
 *
 *   1. CAL9's `reconnect` state comes from the events read's `sources`, says
 *      what it means and offers Reconnect first.
 *   2. "Copy new Axal sessions to…" offers only connected calendars and says
 *      why a refusal happened.
 *   3. An external item opens its own read-only sheet by the provider's id,
 *      an Axal item its drawer, and the sheet's one action is Open in Google
 *      or Open in Outlook, only for an https link.
 *   4. The page wires each of these.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  STATES, connectionRow, copyTargetChoices, copyTargetRefusal, externalReadError, pillText,
} from '../src/pages/calendarConnectedModel.js';
import { externalAction, externalItemOf, externalPath, itemPath, openPath } from '../src/pages/calendarItemModel.js';

const read = (p) => readFileSync(p, 'utf8');

test('1: reconnect is read from the events read, per provider, and offers Reconnect first', () => {
  const sources = [
    { kind: 'manual', ok: true, error: null },
    { kind: 'external_google', ok: false, error: 'reconnect' },
    { kind: 'external_microsoft', ok: false, error: 'rate_limited' },
  ];
  assert.equal(externalReadError(sources, 'google'), 'reconnect');
  assert.equal(externalReadError(sources, 'microsoft'), 'rate_limited');
  assert.equal(externalReadError([{ kind: 'external_google', ok: true, error: null }], 'google'), null);
  assert.equal(externalReadError([], 'google'), null, 'no connection is no source, not a failure');
  assert.equal(externalReadError(null, 'google'), null);
  assert.equal(externalReadError([{ kind: 'external_google', ok: false }], 'google'), 'unreadable');
  assert.ok(STATES.some((s) => s.key === 'reconnect'));
  assert.equal(pillText('reconnect'), '! Reconnect to show its events');
  for (const key of ['google', 'microsoft']) {
    const row = connectionRow(key, 'reconnect', {});
    assert.match(row.sub, /expired or was withdrawn/);
    assert.deepEqual(row.actions[0], { key: 'connect', label: 'Reconnect', primary: true });
  }
});

test('2: Copy new Axal sessions to… offers only what is connected, and says why a choice was refused', () => {
  const by = (g, m) => Object.fromEntries(copyTargetChoices(g, m).map((o) => [o.key, o.ok]));
  assert.deepEqual(copyTargetChoices('connected', 'off').map((o) => o.key), ['all', 'google', 'microsoft', 'none']);
  assert.deepEqual(by('connected', 'off'), { all: true, google: true, microsoft: false, none: true });
  assert.deepEqual(by('off', 'failed'), { all: true, google: false, microsoft: true, none: true });
  assert.deepEqual(by('reconnect', 'unreadable'), { all: true, google: false, microsoft: false, none: true });
  assert.match(copyTargetRefusal({ data: { code: 'provider_not_connected' } }), /not connected/);
  assert.equal(copyTargetRefusal(new Error('x')), 'The choice could not be saved. Try again.');
});

test('3: an external item opens its own sheet by the provider\'s id; its one action needs an https link', () => {
  const ext = { kind: 'external_google', source_id: 0, source_uid: 'abc/def ghi', url: 'https://calendar.google.com/event?eid=1' };
  assert.equal(openPath(ext), '/calendar/external/external_google/abc%2Fdef%20ghi');
  assert.deepEqual(externalItemOf(openPath(ext)), { kind: 'external_google', id: 'abc/def ghi' });
  assert.equal(openPath({ kind: 'manual', source_id: 7 }), itemPath('manual', 7));
  assert.equal(externalItemOf('/calendar/external/manual/7'), null, 'an Axal kind opens the external sheet');
  assert.equal(externalItemOf('/calendar/item/manual/7'), null);
  assert.equal(externalItemOf('/calendar/external/external_microsoft/%E0%A4%A'), null, 'a malformed id threw');
  assert.deepEqual(externalItemOf(externalPath('external_microsoft', '%E0')), { kind: 'external_microsoft', id: '%E0' });
  assert.deepEqual(externalAction(ext), { label: 'Open in Google', url: ext.url });
  assert.deepEqual(externalAction({ kind: 'external_microsoft', url: 'https://outlook.office365.com/x' }), { label: 'Open in Outlook', url: 'https://outlook.office365.com/x' });
  assert.equal(externalAction({ kind: 'external_google', url: 'javascript:alert(1)' }), null);
  assert.equal(externalAction({ kind: 'external_google' }), null);
});

test('4: the page wires the state, the choice, the sheet and its route', () => {
  const page = read('frontend/src/pages/CalendarPage.jsx');
  const connected = read('frontend/src/pages/CalendarConnected.jsx');
  const drawer = read('frontend/src/pages/CalendarItemDrawer.jsx');
  const app = read('frontend/src/App.jsx');
  assert.match(page, /const gState = providerState\(google, googleResult, externalReadError\(sources, 'google'\)\);/);
  assert.match(page, /const mState = providerState\(microsoft, microsoftResult, externalReadError\(sources, 'microsoft'\)\);/);
  assert.match(page, /if \(readError === 'reconnect'\) return 'reconnect';/);
  assert.match(page, /<ExternalItemSheet kind=\{external\.kind\}/);
  assert.match(page, /ev\.kind === external\.kind && ev\.source_uid === external\.id/);
  assert.match(connected, /<CopyTarget gState=\{gState\} mState=\{mState\} \/>/);
  assert.match(connected, /calendarSourcesApi\.setCopyTarget\(next\)/);
  assert.match(connected, /Copy new Axal sessions to…/);
  // The sheet offers one thing: no Reschedule, Cancel, RSVP or copy.
  const sheet = drawer.slice(drawer.indexOf('export function ExternalItemSheet'), drawer.indexOf('export default function CalendarItemDrawer'));
  assert.ok(sheet.length > 200, 'the sheet was not found');
  assert.doesNotMatch(sheet, /reschedule|cancel|rsvp|copyOut|pushOneToExternal/i);
  assert.match(sheet, /rel="noopener noreferrer"/);
  assert.match(app, /<Route path="\/calendar\/external\/:kind\/:id" element=\{guard\(\['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'\], <CalendarPage \/>\)\} \/>/);
});
