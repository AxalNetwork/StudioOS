// D1212 (#3178, part 7 of #2420) — the connected calendars at
// /calendar/connected (CAL9), Google's panel (CAL10), the disconnect dialog
// with "Keep the copies" or "Remove the copies first" (CAL10d), Subscribe with
// the private link, Copy and Make a new link (CAL11), and the phone (CAL21).
// Google, Outlook and Calendly are stubbed: no test reaches a provider host.
// Every value is invented.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/calendar_connected_d1212.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CalendarPage from '../src/pages/CalendarPage.jsx';
import { calendarConnectionsApi } from '../src/lib/api/calendarConnections.js';
import {
  STATES, connectedOf, connectionRow, connectorState, disconnectRefusal, googleAbilities, gmailStillGranted, maskedLink,
  pillText, subscribeState, weekStrip,
} from '../src/pages/calendarConnectedModel.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const GMAIL = 'https://www.googleapis.com/auth/gmail.readonly';
const CAL = 'https://www.googleapis.com/auth/calendar';

const GOOGLE = { configured: true, connected: true, google_email: 'member@example.com', last_synced_at: '2026-11-10 09:12:00', scope: `${CAL} ${GMAIL}`, meet_transcripts: 'not_set_up', sync_error: null, sync_error_read: true };
const OUTLOOK_OFF = { configured: true, connected: false, microsoft_email: null, last_synced_at: null, scope: null, sync_error: null, sync_error_read: true };
const CONNECTIONS = { ok: true, items: [{ uid: 'c1', provider_key: 'calendly', status: 'active', last_synced_at: null, last_error: null }] };
// A link the test makes up; only the masked form may ever be drawn.
const LINK = 'https://axal.example/api/calendar/feed/calendar.ics?token=invented-token-value';

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the addresses and the six states, in the canvas order, each with its pill', () => {
  assert.equal(connectedOf('/calendar/connected'), 'list');
  assert.equal(connectedOf('/calendar/connected/'), 'list');
  assert.equal(connectedOf('/calendar/connected/google'), 'google');
  assert.equal(connectedOf('/calendar/week'), null);
  assert.deepEqual(STATES.map((s) => pillText(s.key)), ['◌ Checking', '– Not set up on Axal yet', '– Not connected', '✓ Connected', '! Last copy failed · Reconnect', '✕ Could not be read']);
  assert.equal(pillText('failed', { sync_error: { at: '2026-11-10T10:12:00Z' } }).replace(/\d\d:\d\d/, 'HH:MM'), '! Last copy failed · HH:MM · Reconnect');
});

test('each row says what it does in its state, and never shows a provider\'s own error text', () => {
  const g = connectionRow('google', 'connected', GOOGLE);
  assert.ok(g.sub.startsWith('Copies your StudioOS meetings, sessions and events to your Google calendar. Last copy 10 Nov'));
  assert.deepEqual(g.actions.map((a) => a.label), ['Copy now', 'Manage']);
  assert.equal(g.actions[1].to, '/calendar/connected/google');
  assert.ok(connectionRow('google', 'connected', { ...GOOGLE, last_synced_at: null }).sub.includes('No copy has run yet.'), 'no copy is not a time');
  assert.ok(connectionRow('google', 'connected', { ...GOOGLE, sync_error_read: false }).sub.includes('could not be read'), 'an unread sync state is said');
  const failed = connectionRow('google', 'failed', { ...GOOGLE, sync_error: { code: 'connection_refused', message: 'Google refused the saved connection. Reconnect it.', at: '2026-11-10T10:12:00Z' } });
  assert.ok(failed.sub.startsWith('Google refused the saved connection. Reconnect it. The 10 Nov'));
  assert.equal(failed.actions[0].label, 'Reconnect');
  assert.equal(connectionRow('microsoft', 'off', OUTLOOK_OFF).sub, 'Not connected. Nothing is written to Outlook until you connect.');
  assert.deepEqual(connectionRow('microsoft', 'connected', OUTLOOK_OFF).actions.map((a) => a.key), ['sync', 'disconnect']);
  assert.ok(connectionRow('google', 'unreadable').sub.includes('This is not a claim that it is not.'));
  assert.deepEqual(connectionRow('google', 'unconfigured').actions, [], 'nothing to press when it cannot be offered');
  assert.equal(connectionRow('calendly', 'connected').sub, 'Brings your Calendly bookings in. They are not copied back out.');
  assert.equal(connectionRow('calendly', 'connected').actions[0].to, '/account/connectors/calendly');
  assert.equal(connectionRow('zoom', 'off').actions[0].label, 'Open its connector page ↗');
  // Calendly's and Zoom's state from the connections list.
  assert.equal(connectorState(undefined, 'zoom'), 'reading');
  assert.equal(connectorState(null, 'zoom'), 'unreadable', 'an unread list is not "not connected"');
  assert.equal(connectorState(CONNECTIONS.items, 'calendly'), 'connected');
  assert.equal(connectorState(CONNECTIONS.items, 'zoom'), 'off');
  assert.equal(connectorState([{ provider_key: 'zoom', status: 'active', last_error: 'raw provider text' }], 'zoom'), 'failed');
  assert.ok(!connectionRow('zoom', 'failed').sub.includes('raw provider text'));
});

test('Google: what it can do, the old Gmail grant, and the disconnect refusals in words', () => {
  const ab = googleAbilities(GOOGLE);
  assert.deepEqual(ab.map((a) => a.value || a.pill || a.link), ['Always', 'Allowed', '– Not set up on Axal yet', 'Open ↗']);
  assert.equal(googleAbilities({ ...GOOGLE, scope: 'openid' })[1].value, 'Not allowed', 'reading the calendar follows the scope');
  assert.equal(googleAbilities({ ...GOOGLE, meet_transcripts: 'granted' })[2].value, 'Allowed');
  assert.equal(gmailStillGranted(GOOGLE), true);
  assert.equal(gmailStillGranted({ ...GOOGLE, scope: CAL }), false);
  assert.equal(gmailStillGranted({ ...GOOGLE, connected: false }), false);
  assert.equal(disconnectRefusal({ code: 'copies_not_removed' }).local, false);
  assert.equal(disconnectRefusal({ data: { error: { code: 'google_revocation_failed' } } }).local, true);
  assert.equal(disconnectRefusal(new Error('x')).text, 'It could not be disconnected. Try again.');
});

test('Subscribe: the link is hidden, and its state is never a guess', () => {
  assert.equal(maskedLink(LINK), 'https://axal.example/api/calendar/feed/••••••••.ics');
  assert.ok(!maskedLink(LINK).includes('invented-token-value'));
  assert.equal(subscribeState(undefined, null), 'reading');
  assert.equal(subscribeState(null, null), 'unreadable');
  assert.equal(subscribeState({ subscribed: false }, null), 'off');
  assert.equal(subscribeState({ subscribed: true }, null), 'on');
  assert.equal(subscribeState(null, { url: LINK }), 'made');
});

test('the week strip runs Monday to Sunday, marks the day chosen and today, and counts only what was read', () => {
  const anchor = new Date(2026, 10, 10);
  const items = [{ kind: 'ic_meeting', start_at: new Date(2026, 10, 12, 14).toISOString() }, { kind: 'founder_checkin', start_at: new Date(2026, 10, 12, 16).toISOString() }];
  const s = weekStrip(anchor, items, new Date(2026, 10, 10));
  assert.deepEqual(s.map((d) => `${d.letter}${d.day}`), ['M9', 'T10', 'W11', 'T12', 'F13', 'S14', 'S15']);
  assert.equal(s[1].selected, true); assert.equal(s[1].isToday, true);
  assert.deepEqual(s[3].kinds, ['ic_meeting', 'founder_checkin']);
  assert.equal(s[3].label, '12 November, 2 items');
  assert.equal(s[0].label, '9 November, 0 items');
  assert.equal(weekStrip(anchor, null)[3].label, '12 November', 'no count when the list was not read');
});

test('the client: D1209\'s routes, the copies kept unless asked', async () => {
  const restore = installDocument();
  const previous = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (u, o = {}) => { sent.push(`${o.method || 'GET'} ${String(u).replace(/^.*\/api/, '')}`); return response({ ok: true }); };
  try {
    await calendarConnectionsApi.disconnectGoogle();
    await calendarConnectionsApi.disconnectGoogle({ removeCopies: true });
    await calendarConnectionsApi.disconnectMicrosoft({ removeCopies: true });
    await calendarConnectionsApi.subscription();
    await calendarConnectionsApi.makeSubscription();
    await calendarConnectionsApi.turnOffSubscription();
    assert.deepEqual(sent, ['DELETE /calendar/google', 'DELETE /calendar/google?remove_copies=1', 'DELETE /calendar/microsoft?remove_copies=1',
      'GET /calendar/subscription', 'POST /calendar/subscription', 'DELETE /calendar/subscription']);
  } finally { globalThis.fetch = previous; restore(); }
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

async function mounted(url, { phone = false, google = GOOGLE, outlook = OUTLOOK_OFF, connections = CONNECTIONS, over = {} } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia, clipboard: globalThis.navigator?.clipboard };
  const sent = [];
  globalThis.fetch = async (u, o = {}) => {
    const path = String(u).replace(/^.*\/api/, '');
    const line = `${o.method || 'GET'} ${path}`;
    sent.push(line);
    for (const [k, v] of Object.entries(over)) if (line.startsWith(k)) return v();
    if (path.startsWith('/calendar/events')) return response({ items: [], sources: [] });
    if (path.startsWith('/calendar/google/status')) return google ? response(google) : response({ detail: 'down' }, 503);
    if (path.startsWith('/calendar/microsoft/status')) return response(outlook);
    if (path.startsWith('/connectors')) return connections ? response(connections) : response({ error: 'connections_unreadable' }, 503);
    if (path.startsWith('/calendar/subscription')) return response({ subscribed: false, created_at: null, last_used_at: null });
    return response({});
  };
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify({ id: 3, role: 'founder', name: 'F', email: 'f@example.com' }));
  const seen = { location: null };
  const Spy = () => { seen.location = useLocation(); return null; };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const page = h(React.Fragment, null, h(CalendarPage), h(Spy));
  const paths = ['/calendar', '/calendar/week', '/calendar/agenda', '/calendar/connected', '/calendar/connected/google'];
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, ...paths.map((path) => h(Route, { key: path, path, element: page }))))));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  return {
    sent, by, pr, seen, flush,
    text: (id) => { if (id) assert.ok(by(id), `no ${id}`); return txt(id ? by(id) : container).replace(/\s+/g, ' ').trim(); },
    async click(id) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => pr(n).onClick?.({ preventDefault() {}, stopPropagation() {} })); await flush(); },
    async pick(id) { const n = by(id); assert.ok(n, `no ${id}`); const input = walk(n).find((x) => x.tagName === 'INPUT'); await act(async () => pr(input).onChange?.({ target: { checked: true } })); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); localStorage.removeItem('user'); restore(); },
  };
}

test('CAL9: /calendar/connected lists the four calendars in their states, the six states and what each option does', async () => {
  const v = await mounted('/calendar/connected');
  try {
    assert.ok(v.by('cal-connected'));
    assert.equal(v.text('cal-conn-google-pill'), '✓ Connected');
    assert.equal(v.text('cal-conn-microsoft-pill'), '– Not connected');
    assert.equal(v.text('cal-conn-calendly-pill'), '✓ Connected');
    assert.equal(v.text('cal-conn-zoom-pill'), '– Not connected');
    assert.equal(v.pr(v.by('cal-conn-zoom-page')).href, '/account/connectors/zoom');
    assert.ok(v.text('cal-conn-states').includes('Could not be read'));
    assert.ok(v.text('cal-conn-options').includes('A private link any calendar app can follow. Read only.'));
    assert.ok(!/member@example\.com|f@example\.com/.test(v.text('cal-connected')), 'no email on the list');
    assert.ok(v.sent.includes('GET /connectors'));
  } finally { await v.close(); }
});

test('CAL9: an unread status or connections list says so, and Try again reads it again', async () => {
  const v = await mounted('/calendar/connected', { google: null, connections: null });
  try {
    assert.equal(v.text('cal-conn-google-pill'), '✕ Could not be read');
    assert.equal(v.text('cal-conn-calendly-pill'), '✕ Could not be read', 'an unread list is not "not connected"');
    const before = v.sent.filter((s) => s.includes('/google/status')).length;
    await v.click('cal-conn-google-retry');
    assert.equal(v.sent.filter((s) => s.includes('/google/status')).length, before + 1);
  } finally { await v.close(); }
});

test('CAL9: a persisted sync failure reads as Last copy failed on a cold load', async () => {
  const v = await mounted('/calendar/connected', { google: { ...GOOGLE, sync_error: { code: 'copy_refused', message: 'Some sessions were not copied. Copy again.', at: '2026-11-10T10:12:00Z' } } });
  try {
    assert.ok(v.text('cal-conn-google-pill').startsWith('! Last copy failed'));
    assert.ok(v.text('cal-conn-google-sub').startsWith('Some sessions were not copied. Copy again.'));
    assert.ok(v.by('cal-conn-google-connect'), 'Reconnect is offered');
  } finally { await v.close(); }
});

test('CAL10: Google\'s panel shows the member\'s own account, what it can do, the Gmail note and Disconnect', async () => {
  const v = await mounted('/calendar/connected/google');
  try {
    assert.equal(v.text('cal-google-account'), 'member@example.com', 'the member\'s own Google account is the one email drawn');
    assert.ok(v.text('cal-google-write').includes('Always'));
    assert.ok(v.text('cal-google-meet').includes('Not set up on Axal yet'));
    assert.ok(v.text('cal-google-gmail').includes('An older connection also allowed reading Gmail. Axal VC never used it.'));
    await v.click('calendar-remove-gmail-access');
    assert.ok(v.by('cal-gmail'), 'removing Gmail asks first, in a dialog');
    assert.ok(!v.sent.some((s) => s.includes('remove-gmail-access')), 'nothing is sent before it is confirmed');
  } finally { await v.close(); }
});

test('CAL10d: Disconnect keeps the copies by default, or removes them first when chosen', async () => {
  let v = await mounted('/calendar/connected/google', { over: { 'DELETE /calendar/google': () => response({ ok: true, copies: 'kept' }) } });
  try {
    await v.click('cal-google-disconnect');
    assert.ok(v.text('cal-disconnect').includes('Disconnect Google?'));
    assert.ok(v.text('cal-disconnect').includes('Keep the copies already in your calendar'));
    await v.click('cal-disconnect-go');
    assert.ok(v.sent.includes('DELETE /calendar/google'), 'kept by default');
    assert.ok(v.text('cal-google-said').includes('Its copies stay in your calendar.'));
  } finally { await v.close(); }
  v = await mounted('/calendar/connected/google', { over: { 'DELETE /calendar/google': () => response({ error: { code: 'copies_not_removed', message: 'x' } }, 502) } });
  try {
    await v.click('cal-google-disconnect');
    await v.pick('cal-disconnect-remove');
    await v.click('cal-disconnect-go');
    assert.ok(v.sent.includes('DELETE /calendar/google?remove_copies=1'));
    assert.ok(v.text('cal-disconnect-refused').startsWith('Some copies could not be removed'));
    assert.equal(v.by('calendar-force-disconnect'), undefined, 'a refused copy is not a refused revocation');
  } finally { await v.close(); }
  v = await mounted('/calendar/connected/google', { over: { 'DELETE /calendar/google': () => response({ error: { code: 'google_revocation_failed', message: 'x' } }, 502) } });
  try {
    await v.click('cal-google-disconnect');
    await v.click('cal-disconnect-go');
    assert.ok(v.by('calendar-force-disconnect'), 'a refused revocation offers Disconnect locally');
  } finally { await v.close(); }
});

test('CAL9: Outlook disconnects through the same dialog', async () => {
  const v = await mounted('/calendar/connected', { outlook: { ...OUTLOOK_OFF, connected: true }, over: { 'DELETE /calendar/microsoft': () => response({ ok: true, copies: 'removed' }) } });
  try {
    await v.click('cal-conn-microsoft-disconnect');
    assert.ok(v.text('cal-disconnect').includes('Disconnect Outlook?'));
    await v.pick('cal-disconnect-remove');
    await v.click('cal-disconnect-go');
    assert.ok(v.sent.includes('DELETE /calendar/microsoft?remove_copies=1'));
    assert.ok(v.text('cal-conn-microsoft-said').includes('Its copies were removed first.'));
  } finally { await v.close(); }
});

test('CAL11: Subscribe makes the link, shows it hidden, copies the real one, and makes a new one', async () => {
  const copied = [];
  const v = await mounted('/calendar', {
    over: {
      'POST /calendar/subscription': () => response({ url: LINK, webcal_url: LINK.replace('https', 'webcal'), created_at: '2026-11-10 10:00:00', replaced: false }, 201),
    },
  });
  try {
    assert.equal(v.by('cal-wait-feed'), undefined, 'the whole-calendar wait is retired');
    await v.click('cal-subscribe-open');
    assert.ok(v.text('cal-sub-none').startsWith('No link is on.'));
    await v.click('cal-sub-make');
    assert.equal(v.text('cal-sub-link').replace(' Copy', ''), 'https://axal.example/api/calendar/feed/••••••••.ics');
    assert.ok(!v.text().includes('invented-token-value'), 'the token is never drawn');
    Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: async (t) => { copied.push(t); } }, configurable: true });
    await v.click('cal-sub-copy');
    assert.deepEqual(copied, [LINK]);
    assert.ok(v.by('cal-sub-rotate') && v.by('cal-sub-off'));
    assert.equal(v.pr(v.by('cal-sub-download')).href.endsWith('/calendar/events.ics'), true);
  } finally { await v.close(); }
});

test('CAL1\'s rail: the summary and Manage, and no browser pop-up anywhere', async () => {
  const v = await mounted('/calendar');
  try {
    assert.ok(v.text('cal-connected-summary').includes('Google Calendar'));
    assert.equal(v.pr(v.by('cal-connected-manage')).href, '/calendar/connected');
  } finally { await v.close(); }
  for (const f of ['CalendarPage.jsx', 'CalendarConnected.jsx']) {
    assert.doesNotMatch(read(`frontend/src/pages/${f}`), /window\.(confirm|alert|prompt)\(/, f);
  }
});

test('CAL21: on a phone Agenda is the default with the week strip, Month shows dots, and the panels are pages', async () => {
  let v = await mounted('/calendar', { phone: true });
  try {
    assert.ok(v.by('cal-strip'), 'the strip is drawn over the agenda');
    assert.equal(v.by('cal-month'), undefined, 'bare /calendar is Agenda on a phone');
    assert.equal(v.pr(v.by('cal-view-month')).href, '/calendar?view=month');
  } finally { await v.close(); }
  v = await mounted('/calendar?view=month', { phone: true });
  try {
    assert.ok(v.by('cal-month'));
    assert.ok(v.by(`cal-mdots-${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`), 'Month shows dots');
  } finally { await v.close(); }
  v = await mounted('/calendar/connected', { phone: true });
  try {
    // The Lightbox's default phone form is full screen; a bottom sheet would carry data-phone="sheet".
    assert.ok(v.by('cal-connected-layer'), 'Connected calendars opens');
    assert.equal(v.pr(v.by('cal-connected-layer'))['data-phone'], undefined, 'a full page, not a bottom sheet');
  } finally { await v.close(); }
  const css = read('frontend/src/pages/calendarPage.css');
  assert.match(css, /@media \(max-width: 767px\) \{\n {2}\.cal-conn \.cal-btn, \.cal-conn-sum \.cal-btn, \.cal-dlg-btns \.cal-btn, \.cal-radio \{ min-height: 44px; \}/, 'phone targets are 44px');
  assert.match(css, /\.cal-strip-day \{ min-height: 60px;/);
  const conn = read('frontend/src/pages/CalendarConnected.jsx');
  assert.equal((conn.match(/phone="sheet"/g) || []).length, 3, 'the three dialogs are bottom sheets on a phone');
});

test('the colours are tokens, so dark mode covers them', () => {
  const css = read('frontend/src/pages/calendarPage.css');
  const block = css.slice(css.indexOf('/* D1212 (#3178)')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(block.length > 100);
  assert.doesNotMatch(block, /#[0-9a-f]{3,6}\b/i, 'a D1212 rule hardcodes a colour');
});
