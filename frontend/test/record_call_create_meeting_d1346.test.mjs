// D1346 (#3554): Record a Session › Call — creating the meeting, whether
// Eadwyn AI can join, the copy per platform, and the device options only when
// this device records. D1362: one Start does it all — it creates the meeting
// when no link is pasted, saves the call, sends Eadwyn AI where it can join,
// and opens the meeting in a new tab.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import RecordLightbox from '../src/pages/founder/RecordLightbox.jsx';
import {
  BOT_UNAVAILABLE, BOT_UNREADABLE, TEAMS_CREATE_NOTE, TEAMS_NO_CAPTURE, botState, botTranscriptLine, callStartNote, callStartPlan, createMeetingOffer, createdLink, meetingHref,
} from '../src/pages/founder/recordSetup.js';
import { BOT_ENGINE, RECORD_ENGINE } from '../src/lib/validateSourceWording.js';

const h = React.createElement;
const ZOOM_LINK = 'https://zoom.us/j/85746065432?pwd=abc';
const MEET_LINK = 'https://meet.google.com/abc-mnop-xyz';
const TEAMS_LINK = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_fixture%40thread.v2/0';
const BOT_OFF = { available: false, platforms: { zoom: false, google_meet: false, teams: false }, limit_minutes: 30, price: { bot_microusd_per_minute: null, transcription_microusd_per_minute: null } };
const BOT_ON = { available: true, platforms: { zoom: true, google_meet: true, teams: true }, limit_minutes: 120, price: { bot_microusd_per_minute: 2790, transcription_microusd_per_minute: 6500 } };
const CONNECTED = { providers: [{ provider: 'zoom', available: true }, { provider: 'google_meet', available: true }], connections: { zoom: { status: 'active' }, google_meet: { status: 'active' } } };
const UNCONNECTED = { providers: [{ provider: 'zoom', available: true }, { provider: 'google_meet', available: true }], connections: {} };
const models = { live: [{ model: 'live-a', label: 'Live A', price_usd_per_minute: 0.001, choosable: true }], final: [{ model: 'final-a', label: 'Final A', price_usd_per_minute: 0.002, choosable: true }], defaults: { live: null, final: 'final-a' } };

const by = (m, id) => m.nodes().find((n) => m.props(n)?.['data-testid'] === id);
async function press(m, id) { await act(async () => { await m.props(by(m, id)).onClick?.({ preventDefault() {} }); }); }
async function change(m, id, value) { await act(async () => { await m.props(by(m, id)).onChange({ target: { value } }); }); }

function setup({ bot = BOT_OFF, channels = CONNECTED, instant, botAvailability } = {}) {
  const made = [], sent = [], device = [], reads = [];
  const channelsSource = {
    async overview() { return channels; },
    async saveZoomCall(id, body) { device.push(['saveZoomCall', id, body]); return { session_id: 16 }; },
    async attachCalendarMeet(id, body) { device.push(['attachCalendarMeet', id, body]); return { session_id: 17, bot: bot.platforms?.google_meet ? { status: 'joining' } : null }; },
    async instantMeeting(provider, minutes) { made.push([provider, minutes]); return instant ? instant(provider) : { provider, join_url: provider === 'zoom' ? ZOOM_LINK : provider === 'teams' ? TEAMS_LINK : MEET_LINK }; },
    ...(botAvailability ? { async botAvailability() { reads.push(1); return botAvailability(reads.length); } } : {}),
  };
  const props = {
    projectId: 10, interview: { id: 1, interviewee_name: 'Fixture person' }, initialMode: 'video', initialModels: models,
    initialBoard: { hypotheses: [] }, channels, initialConsent: 'written', onClose() {}, onStarted() {}, channelsSource,
    ...(botAvailability ? {} : { initialBot: bot }),
    sessions: { async create() { return { session: { id: 15, channel: 'video' } }; }, async sendBot(id, body) { sent.push(body); return { bot: { status: 'joining' } }; } },
    recorder: { prepare() {}, release() {}, begin() { device.push('begin'); }, getSnapshot() { return {}; }, isCapturing() { return false; }, canShareTab: true },
  };
  return { props, made, sent, device, reads };
}

/** D1362: Start opens one tab inside the press and points it at the meeting once the call is saved. */
function tabs() {
  const opened = [];
  const prev = globalThis.open;
  globalThis.open = (url, target) => { const tab = { url, target, closed: false, opener: {}, location: { href: url || '' }, close() { this.closed = true; } }; opened.push(tab); return tab; };
  return { opened, restore() { globalThis.open = prev; } };
}

test('the rules: what is offered per platform, which link fills, and the bot state never guesses', () => {
  assert.deepEqual(createMeetingOffer('video', 'zoom', CONNECTED), { kind: 'create', connected: true, connectHref: null, connectLabel: 'Connect Zoom to create the meeting here' });
  assert.deepEqual(createMeetingOffer('video', 'google_meet', UNCONNECTED), { kind: 'create', connected: false, connectHref: '/account/connectors/google', connectLabel: 'Connect Google Calendar to create a Meet meeting here' });
  assert.equal(createMeetingOffer('video', 'zoom', null).connected, null, 'an unread connection is not "not connected"');
  // D1359: Teams is created on the Microsoft calendar connection; the Worker decides whether it is connected.
  assert.deepEqual(createMeetingOffer('video', 'teams', CONNECTED), { kind: 'create', connected: null, connectHref: null, connectLabel: 'Connect Microsoft to create the meeting here', note: TEAMS_CREATE_NOTE });
  assert.equal(createMeetingOffer('phone', 'whatsapp', CONNECTED), null);
  assert.equal(createMeetingOffer('video', 'zoom', { providers: [{ provider: 'zoom', available: false }], connections: {} }).kind, 'unavailable');
  assert.equal(createdLink('zoom', { join_url: ZOOM_LINK }), ZOOM_LINK);
  assert.equal(createdLink('zoom', { join_url: 'https://evil.example/j/1' }), null, 'a link off the provider host fills nothing');
  assert.equal(createdLink('google_meet', { join_url: 'http://meet.google.com/abc-mnop-xyz' }), null);
  assert.equal(createdLink('zoom', null), null);
  // Open the meeting's href is a parsed https URL on the provider's own host, never the typed text.
  assert.equal(meetingHref('zoom', ` ${ZOOM_LINK} `), ZOOM_LINK);
  assert.equal(meetingHref('teams', 'https://teams.microsoft.com/l/meetup-join/x'), 'https://teams.microsoft.com/l/meetup-join/x');
  for (const [p, bad] of [['zoom', 'javascript:alert(1)'], ['zoom', 'http://zoom.us/j/1'], ['google_meet', 'https://evil.example/abc'], ['teams', 'https://teams.evil.example/x'], ['teams', 'data:text/html,x'], ['whatsapp', ZOOM_LINK]]) {
    assert.equal(meetingHref(p, bad), null, `${p} ${bad}`);
  }
  assert.deepEqual(botState(undefined, 'zoom'), { state: 'loading', canSend: false, sentence: 'Checking whether Eadwyn AI can join…' });
  assert.deepEqual(botState(null, 'zoom'), { state: 'unreadable', canSend: false, sentence: BOT_UNREADABLE });
  assert.deepEqual(botState(BOT_OFF, 'zoom'), { state: 'unavailable', canSend: false, sentence: BOT_UNAVAILABLE });
  assert.equal(botState({ ...BOT_ON, platforms: { ...BOT_ON.platforms, zoom: false } }, 'zoom').canSend, false, 'per platform');
  assert.equal(botState(BOT_ON, 'google_meet').canSend, true);
  // D1358: no "Record this device" for a meeting.
  assert.equal(BOT_UNAVAILABLE, 'Eadwyn AI can’t join calls yet on Axal.');
  assert.match(botTranscriptLine(BOT_ON).price, /\$0\.0028 a minute.*\$0\.0065 a minute.*120 minutes/);
  assert.match(botTranscriptLine(BOT_OFF).price, /not priced yet.*not priced yet/, 'never $0 for an unmeasured price');
});

test('D1362 the plan: import on a connected Zoom or Meet (with Eadwyn AI when it can join), the bot alone otherwise, never a guess', () => {
  const offer = (p, ch = CONNECTED) => createMeetingOffer('video', p, ch);
  const plan = (p, link, botRead, ch = CONNECTED) => callStartPlan({ mode: 'video', provider: p, link, channels: ch, bot: botState(botRead, p), botLink: !!link, offer: offer(p, ch) });
  assert.deepEqual(plan('zoom', '', BOT_OFF), { kind: 'import', create: true, bot: false });
  assert.deepEqual(plan('zoom', ZOOM_LINK, BOT_ON), { kind: 'import', create: false, bot: true });
  assert.deepEqual(plan('teams', '', BOT_ON), { kind: 'bot', create: true, bot: true });
  assert.deepEqual(plan('teams', TEAMS_LINK, BOT_ON), { kind: 'bot', create: false, bot: true });
  assert.deepEqual(plan('teams', '', BOT_OFF), { kind: 'none', create: false, reason: TEAMS_NO_CAPTURE });
  assert.deepEqual(plan('google_meet', '', BOT_OFF, UNCONNECTED), { kind: 'none', create: false, reason: 'Connect Google Calendar to create a Meet meeting here, or paste the meeting link.' });
  assert.equal(plan('zoom', 'https://evil.example/j/1', BOT_ON).kind, 'none', 'a bad link starts nothing');
  assert.equal(callStartPlan({ mode: 'phone', provider: 'whatsapp', link: '', channels: CONNECTED, bot: null, botLink: false, offer: null }), null);
  assert.match(callStartNote(plan('zoom', '', BOT_OFF), 'zoom'), /^Start creates the Zoom meeting on your account, opens it\. When the call ends, Axal imports Zoom’s own transcript into this interview\. Eadwyn AI can’t join Zoom calls on Axal yet\.$/);
  assert.match(callStartNote(plan('zoom', ZOOM_LINK, BOT_ON), 'zoom'), /^Start opens the Zoom meeting and sends Eadwyn AI to join\./);
  assert.equal(callStartNote({ kind: 'none' }, 'zoom'), null);
});

test('bot not deployed: no Send button, the plan says so, and Start saves the call for import and opens it, never this device (D1358, D1362)', async () => {
  const s = setup();
  const t = tabs();
  const m = await mountContracts(h(RecordLightbox, s.props));
  try {
    await press(m, 'record-provider-zoom');
    assert.equal(by(m, 'record-bot-send-off'), undefined, 'one Start, no second button');
    assert.equal(by(m, 'record-create-meeting-button'), undefined, 'Start creates the meeting');
    assert.equal(by(m, 'record-open-meeting'), undefined, 'Start opens the meeting');
    assert.match(m.text(), /Eadwyn AI can’t join Zoom calls on Axal yet\./);
    assert.doesNotMatch(m.text(), /Record this device|Save for import after the call|Send Eadwyn AI/);
    await change(m, 'record-link', ZOOM_LINK);
    assert.equal(by(m, 'record-device'), undefined, 'no device button for a meeting');
    assert.equal(by(m, 'record-live'), undefined, 'no device options: this device does not record a meeting');
    assert.ok(by(m, 'record-import-note'));
    assert.equal(m.props(by(m, 'record-start')).children, 'Start Call');
    await press(m, 'record-start');
    assert.deepEqual(s.sent, [], 'no bot is sent from here');
    assert.deepEqual(s.made, [], 'a pasted link is not created again');
    assert.deepEqual(s.device, [['saveZoomCall', 1, { join_url: ZOOM_LINK, consent: { status: 'given', method: 'written' } }]], 'saved for import; the recorder never begins');
    assert.equal(t.opened.length, 1, 'one tab, opened inside the press');
    assert.equal(t.opened[0].location.href, ZOOM_LINK, 'pointed at the meeting once the call is saved');
    assert.equal(t.opened[0].opener, null);
  } finally { t.restore(); await m.unmount(); }
});

test('bot deployed: a Meet call is saved for import and the Worker sends Eadwyn AI', async () => {
  const s = setup({ bot: BOT_ON });
  const t = tabs();
  const m = await mountContracts(h(RecordLightbox, s.props));
  try {
    await press(m, 'record-provider-google_meet');
    await change(m, 'record-link', MEET_LINK);
    assert.equal(m.props(by(m, 'record-start')).children, 'Start Call');
    assert.equal(by(m, 'record-live'), undefined, 'no live captions for a bot run');
    assert.equal(by(m, 'record-final'), undefined, 'no final-transcript choice for a bot run');
    assert.ok(by(m, 'record-bot-transcript'));
    assert.match(m.text(), /Eadwyn AI’s time: \$0\.0028 a minute\. Its transcript: \$0\.0065 a minute\. A call stops at 120 minutes on your plan\./);
    assert.match(m.text(), /Start opens the Google Meet meeting and sends Eadwyn AI to join\./);
    await press(m, 'record-start');
    assert.deepEqual(s.device, [['attachCalendarMeet', 1, { join_url: MEET_LINK, consent: { status: 'given', method: 'written' } }]]);
    assert.deepEqual(s.sent, [], 'the Worker sends Eadwyn AI with the save (D1360)');
    assert.equal(t.opened[0].location.href, MEET_LINK);
  } finally { t.restore(); await m.unmount(); }

});

test('Start with no link creates the meeting, fills the link, saves the call and opens it: Zoom and Meet', async () => {
  for (const [provider, url, save] of [['zoom', ZOOM_LINK, 'saveZoomCall'], ['google_meet', MEET_LINK, 'attachCalendarMeet']]) {
    const s = setup();
    const t = tabs();
    const m = await mountContracts(h(RecordLightbox, s.props));
    try {
      await press(m, `record-provider-${provider}`);
      assert.match(m.props(by(m, 'record-link')).placeholder, /leave it empty: Start creates the meeting/);
      await press(m, 'record-start');
      assert.deepEqual(s.made, [[provider, 30]], 'one create, the estimated length');
      assert.equal(m.props(by(m, 'record-link')).value, url, 'the link fills the field');
      assert.deepEqual(s.device.map((d) => [d[0], d[2].join_url]), [[save, url]]);
      assert.equal(t.opened[0].location.href, url);
    } finally { t.restore(); await m.unmount(); }
  }
});

test('not connected: Start waits for a connection and links to it', async () => {
  const s = setup({ channels: UNCONNECTED });
  const m = await mountContracts(h(RecordLightbox, s.props));
  try {
    await press(m, 'record-provider-google_meet');
    assert.equal(m.props(by(m, 'record-start'))['aria-disabled'], true);
    assert.equal(m.props(by(m, 'record-create-connect')).href, '/account/connectors/google');
    assert.match(m.text(), /Connect Google Calendar to create a Meet meeting here, or paste the meeting link\./);
    assert.equal(by(m, 'record-connect-link'), undefined, 'the Meet chip itself asks for no connection');
    await press(m, 'record-start');
    assert.deepEqual([s.made, s.device, s.sent], [[], [], []], 'a Start that is off does nothing');
  } finally { await m.unmount(); }
});

test('upcoming call providers stay visible but cannot be selected', async () => {
  const s = setup({ bot: BOT_ON });
  const m = await mountContracts(h(RecordLightbox, s.props));
  try {
    for (const [provider, label] of [['teams', 'Microsoft Teams'], ['signal', 'Signal'], ['whatsapp', 'WhatsApp'], ['telegram', 'Telegram']]) {
      const option = by(m, `record-provider-${provider}`);
      assert.equal(m.props(option).disabled, true);
      assert.ok(m.text().includes(`${label} · Coming soon`));
      await press(m, `record-provider-${provider}`);
      assert.equal(m.props(option)['aria-checked'], false);
    }
    assert.deepEqual([s.made, s.device, s.sent], [[], [], []]);
  } finally { await m.unmount(); }
});

test('a refused or odd create fills nothing, saves nothing and says so; the Worker’s sentence is kept', async () => {
  const s = setup({ instant: () => { throw new Error('Connect Zoom in Account › Connectors first, then create the meeting.'); } });
  const t = tabs();
  const m = await mountContracts(h(RecordLightbox, s.props));
  try {
    await press(m, 'record-provider-zoom');
    await press(m, 'record-start');
    assert.equal(m.props(by(m, 'record-link')).value, '');
    assert.match(m.text(), /Connect Zoom in Account › Connectors first, then create the meeting\./);
    assert.deepEqual(s.device, []);
    assert.equal(t.opened[0].closed, true);
  } finally { t.restore(); await m.unmount(); }
  const odd = setup({ instant: () => ({ join_url: 'https://evil.example/x' }) });
  const u = tabs();
  const k = await mountContracts(h(RecordLightbox, odd.props));
  try {
    await press(k, 'record-provider-zoom');
    await press(k, 'record-start');
    assert.equal(k.props(by(k, 'record-link')).value, '');
    assert.match(k.text(), /The meeting could not be created\. Create it in Zoom and paste its link\./);
    assert.deepEqual(odd.device, []);
    assert.equal(u.opened[0].closed, true, 'nothing off the provider host is ever opened');
  } finally { u.restore(); await k.unmount(); }
});

test('the copy per platform: a meeting is Eadwyn AI’s line; the phone on speaker keeps the device line', async () => {
  const s = setup();
  const m = await mountContracts(h(RecordLightbox, s.props));
  try {
    for (const p of ['zoom', 'google_meet']) {
      await press(m, `record-provider-${p}`);
      assert.equal(m.props(by(m, 'record-source-note')).children, BOT_ENGINE, p);
    }
    await press(m, 'record-provider-phone_speaker');
    assert.equal(m.props(by(m, 'record-source-note')).children, RECORD_ENGINE);
    assert.equal(by(m, 'record-start-plan'), undefined, 'no meeting plan on the phone');
  } finally { await m.unmount(); }
});

test('the availability is read once on open; unreadable says so with Try again, which reads it again', async () => {
  const s = setup({ botAvailability: (n) => { if (n === 1) throw new Error('down'); return BOT_ON; } });
  const m = await mountContracts(h(RecordLightbox, s.props));
  try {
    await m.flush?.();
    await press(m, 'record-provider-zoom');
    assert.equal(s.reads.length, 1, 'read on open, not after a press');
    assert.equal(m.props(by(m, 'record-bot-state'))['data-state'], 'unreadable');
    await press(m, 'record-bot-retry');
    await m.flush?.();
    assert.equal(s.reads.length, 2);
    await change(m, 'record-link', ZOOM_LINK);
    assert.equal(by(m, 'record-bot-state'), undefined);
    assert.match(m.text(), /sends Eadwyn AI to join/);
  } finally { await m.unmount(); }
});

// Keep a form mounted while its account connection changes in another tab.
function ReturnEvents({ listeners, children }) {
  React.useLayoutEffect(() => {
    const install = (target, prefix) => {
      const add = target.addEventListener;
      const remove = target.removeEventListener;
      target.addEventListener = (name, fn, ...args) => {
        listeners.set(`${prefix}:${name}`, fn);
        add.call(target, name, fn, ...args);
      };
      target.removeEventListener = (name, fn, ...args) => {
        if (listeners.get(`${prefix}:${name}`) === fn) listeners.delete(`${prefix}:${name}`);
        remove.call(target, name, fn, ...args);
      };
    };
    install(window, 'window'); install(document, 'document');
  }, []);
  return children;
}

test('Google connection refreshes on return, preserves the form, and clears disconnected or unreadable status', async () => {
  const s = setup({ bot: BOT_ON });
  delete s.props.channels;
  s.props.interview = null;
  let response = UNCONNECTED;
  let calls = 0;
  s.props.channelsSource.overview = async () => { calls++; if (response instanceof Error) throw response; return response; };
  const listeners = new Map();
  const m = await mountContracts(h(ReturnEvents, { listeners }, h(RecordLightbox, s.props)));
  try {
    await press(m, 'record-provider-google_meet');
    await change(m, 'record-name', 'Unsaved interview');
    assert.ok(by(m, 'record-create-connect'), 'initially asks to connect');
    response = CONNECTED;
    await act(async () => listeners.get('window:focus')());
    assert.equal(by(m, 'record-create-connect'), undefined, 'return recognises completed connection');
    assert.match(m.text(), /Start creates the Google Meet meeting on your account/);
    assert.equal(m.props(by(m, 'record-name')).value, 'Unsaved interview', 'refresh preserves entered fields');
    response = UNCONNECTED;
    document.visibilityState = 'hidden';
    const before = calls;
    await act(async () => listeners.get('document:visibilitychange')());
    assert.equal(calls, before, 'hidden tabs do not refresh');
    document.visibilityState = 'visible';
    await act(async () => listeners.get('document:visibilitychange')());
    assert.ok(by(m, 'record-create-connect'), 'return also recognises disconnection');
    response = CONNECTED;
    await act(async () => listeners.get('window:focus')());
    response = new Error('offline');
    await act(async () => listeners.get('window:focus')());
    assert.equal(by(m, 'record-create-connect'), undefined, 'unreadable is not a disconnected claim');
    assert.doesNotMatch(m.text(), /Google Meet · Connected/);
  } finally { await m.unmount(); }
  assert.equal(listeners.has('window:focus'), false, 'focus listener removed on close');
  assert.equal(listeners.has('document:visibilitychange'), false, 'visibility listener removed on close');
});

test('a late connection read cannot overwrite a newer return read', async () => {
  const s = setup({ bot: BOT_ON });
  delete s.props.channels;
  const pending = [];
  s.props.channelsSource.overview = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
  const listeners = new Map();
  const m = await mountContracts(h(ReturnEvents, { listeners }, h(RecordLightbox, s.props)));
  try {
    await press(m, 'record-provider-google_meet');
    await act(async () => { listeners.get('window:focus')(); });
    await act(async () => pending[1].resolve(CONNECTED));
    await act(async () => pending[0].resolve(UNCONNECTED));
    assert.equal(by(m, 'record-create-connect'), undefined, 'older response cannot restore Connect');
    await act(async () => { listeners.get('window:focus')(); listeners.get('window:focus')(); });
    await act(async () => pending[3].resolve(CONNECTED));
    await act(async () => pending[2].reject(new Error('late failure')));
    assert.match(m.text(), /Google Meet · Connected/, 'older error cannot erase the newer success');
  } finally { await m.unmount(); }
});
