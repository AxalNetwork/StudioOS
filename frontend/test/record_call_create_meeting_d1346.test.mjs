// D1346 (#3554): Record a Session › Call — "Create the meeting for me", Send
// Eadwyn AI disabled up front when the bot is not available, the copy per
// platform, and the device options only when this device records.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import RecordLightbox from '../src/pages/founder/RecordLightbox.jsx';
import {
  BOT_UNAVAILABLE, BOT_UNREADABLE, TEAMS_PASTE, botState, botTranscriptLine, createMeetingOffer, createdLink,
} from '../src/pages/founder/recordSetup.js';
import { BOT_ENGINE, RECORD_ENGINE } from '../src/lib/validateSourceWording.js';

const h = React.createElement;
const ZOOM_LINK = 'https://zoom.us/j/85746065432?pwd=abc';
const MEET_LINK = 'https://meet.google.com/abc-mnop-xyz';
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
    async instantMeeting(provider, minutes) { made.push([provider, minutes]); return instant ? instant(provider) : { provider, join_url: provider === 'zoom' ? ZOOM_LINK : MEET_LINK }; },
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

test('the rules: what is offered per platform, which link fills, and the bot state never guesses', () => {
  assert.deepEqual(createMeetingOffer('video', 'zoom', CONNECTED), { kind: 'create', connected: true, connectHref: null, connectLabel: 'Connect Zoom to create the meeting here' });
  assert.deepEqual(createMeetingOffer('video', 'google_meet', UNCONNECTED), { kind: 'create', connected: false, connectHref: '/account/connectors', connectLabel: 'Connect Google to create the meeting here' });
  assert.equal(createMeetingOffer('video', 'zoom', null).connected, null, 'an unread connection is not "not connected"');
  assert.deepEqual(createMeetingOffer('video', 'teams', CONNECTED), { kind: 'paste', sentence: TEAMS_PASTE });
  assert.equal(createMeetingOffer('phone', 'whatsapp', CONNECTED), null);
  assert.equal(createMeetingOffer('video', 'zoom', { providers: [{ provider: 'zoom', available: false }], connections: {} }).kind, 'unavailable');
  assert.equal(createdLink('zoom', { join_url: ZOOM_LINK }), ZOOM_LINK);
  assert.equal(createdLink('zoom', { join_url: 'https://evil.example/j/1' }), null, 'a link off the provider host fills nothing');
  assert.equal(createdLink('google_meet', { join_url: 'http://meet.google.com/abc-mnop-xyz' }), null);
  assert.equal(createdLink('zoom', null), null);
  assert.deepEqual(botState(undefined, 'zoom'), { state: 'loading', canSend: false, sentence: 'Checking whether Eadwyn AI can join…' });
  assert.deepEqual(botState(null, 'zoom'), { state: 'unreadable', canSend: false, sentence: BOT_UNREADABLE });
  assert.deepEqual(botState(BOT_OFF, 'zoom'), { state: 'unavailable', canSend: false, sentence: BOT_UNAVAILABLE });
  assert.equal(botState({ ...BOT_ON, platforms: { ...BOT_ON.platforms, zoom: false } }, 'zoom').canSend, false, 'per platform');
  assert.equal(botState(BOT_ON, 'google_meet').canSend, true);
  assert.equal(BOT_UNAVAILABLE, 'Eadwyn AI can’t join calls yet on Axal. Record this device instead, or paste the link to keep it for later.');
  assert.match(botTranscriptLine(BOT_ON).price, /\$0\.0028 a minute.*\$0\.0065 a minute.*120 minutes/);
  assert.match(botTranscriptLine(BOT_OFF).price, /not priced yet.*not priced yet/, 'never $0 for an unmeasured price');
});

test('bot not deployed: Send Eadwyn AI is disabled up front with the sentence, and Start records this device', async () => {
  const s = setup();
  const m = await mountContracts(h(RecordLightbox, s.props));
  try {
    await press(m, 'record-provider-zoom');
    const off = by(m, 'record-bot-send-off');
    assert.ok(off, 'drawn before any press');
    assert.equal(m.props(off).disabled, true);
    assert.equal(m.props(off)['aria-describedby'], 'record-bot-state');
    assert.match(m.text(), /Eadwyn AI can’t join calls yet on Axal\. Record this device instead, or paste the link to keep it for later\./);
    await change(m, 'record-link', ZOOM_LINK);
    assert.equal(by(m, 'record-device'), undefined, 'no second device button: Start is the device');
    assert.ok(by(m, 'record-live'), 'the device options are shown, since this device records');
    await press(m, 'record-start');
    assert.deepEqual(s.sent, [], 'no bot is sent');
    assert.deepEqual(s.device, ['begin']);
  } finally { await m.unmount(); }
});

test('bot deployed: Send is on, and the device options give way to the bot’s transcript line and price', async () => {
  const s = setup({ bot: BOT_ON });
  const m = await mountContracts(h(RecordLightbox, s.props));
  try {
    await press(m, 'record-provider-google_meet');
    await change(m, 'record-link', MEET_LINK);
    assert.equal(by(m, 'record-bot-send-off'), undefined);
    assert.equal(by(m, 'record-live'), undefined, 'no live captions for a bot run');
    assert.equal(by(m, 'record-final'), undefined, 'no final-transcript choice for a bot run');
    assert.ok(by(m, 'record-bot-transcript'));
    assert.match(m.text(), /Eadwyn AI’s time: \$0\.0028 a minute\. Its transcript: \$0\.0065 a minute\. A call stops at 120 minutes on your plan\./);
    await press(m, 'record-start');
    assert.deepEqual(s.sent, [{ meeting_url: MEET_LINK }]);
  } finally { await m.unmount(); }
});

test('Create the meeting for me: Zoom and Meet fill the link and offer Open the meeting in a new tab', async () => {
  for (const [provider, url] of [['zoom', ZOOM_LINK], ['google_meet', MEET_LINK]]) {
    const s = setup();
    const m = await mountContracts(h(RecordLightbox, s.props));
    try {
      await press(m, `record-provider-${provider}`);
      assert.equal(by(m, 'record-open-meeting'), undefined, 'nothing to open yet');
      await press(m, 'record-create-meeting-button');
      assert.deepEqual(s.made, [[provider, 30]], 'one create, the estimated length');
      assert.equal(m.props(by(m, 'record-link')).value, url, 'the link fills the field');
      const open = m.props(by(m, 'record-open-meeting'));
      assert.equal(open.href, url);
      assert.equal(open.target, '_blank');
      assert.equal(open.rel, 'noopener noreferrer');
    } finally { await m.unmount(); }
  }
});

test('not connected: the button waits for a connection and links to it; Teams is paste only', async () => {
  const s = setup({ channels: UNCONNECTED });
  const m = await mountContracts(h(RecordLightbox, s.props));
  try {
    await press(m, 'record-provider-google_meet');
    assert.equal(m.props(by(m, 'record-create-meeting-button')).disabled, true);
    assert.equal(m.props(by(m, 'record-create-connect')).href, '/account/connectors');
    assert.match(m.text(), /Connect Google to create the meeting here/);
    assert.equal(by(m, 'record-connect-link'), undefined, 'the Meet chip itself asks for no connection');
    await press(m, 'record-provider-teams');
    assert.equal(by(m, 'record-create-meeting-button'), undefined);
    assert.match(m.text(), /Create the meeting in Microsoft Teams and paste its link here\. Axal cannot create a Teams meeting yet\./);
  } finally { await m.unmount(); }
});

test('a refused or odd create fills nothing and says so; the Worker’s sentence is kept', async () => {
  const s = setup({ instant: () => { throw new Error('Connect Zoom in Account › Connectors first, then create the meeting.'); } });
  const m = await mountContracts(h(RecordLightbox, s.props));
  try {
    await press(m, 'record-provider-zoom');
    await press(m, 'record-create-meeting-button');
    assert.equal(m.props(by(m, 'record-link')).value, '');
    assert.match(m.text(), /Connect Zoom in Account › Connectors first, then create the meeting\./);
  } finally { await m.unmount(); }
  const odd = setup({ instant: () => ({ join_url: 'https://evil.example/x' }) });
  const k = await mountContracts(h(RecordLightbox, odd.props));
  try {
    await press(k, 'record-provider-zoom');
    await press(k, 'record-create-meeting-button');
    assert.equal(k.props(by(k, 'record-link')).value, '');
    assert.ok(by(k, 'record-create-error'));
  } finally { await k.unmount(); }
});

test('the copy per platform: a meeting is Eadwyn AI’s line; the phone on speaker keeps the device line', async () => {
  const s = setup();
  const m = await mountContracts(h(RecordLightbox, s.props));
  try {
    for (const p of ['zoom', 'google_meet', 'teams']) {
      await press(m, `record-provider-${p}`);
      assert.equal(m.props(by(m, 'record-source-note')).children, BOT_ENGINE, p);
    }
    await press(m, 'record-provider-phone_speaker');
    assert.equal(m.props(by(m, 'record-source-note')).children, RECORD_ENGINE);
    assert.equal(by(m, 'record-bot-send-off'), undefined, 'no bot on the phone');
  } finally { await m.unmount(); }
});

test('the availability is read once on open; unreadable keeps Send off and Try again reads it again', async () => {
  const s = setup({ botAvailability: (n) => { if (n === 1) throw new Error('down'); return BOT_ON; } });
  const m = await mountContracts(h(RecordLightbox, s.props));
  try {
    await m.flush?.();
    await press(m, 'record-provider-zoom');
    assert.equal(s.reads.length, 1, 'read on open, not after a press');
    assert.equal(m.props(by(m, 'record-bot-state'))['data-state'], 'unreadable');
    assert.ok(by(m, 'record-bot-send-off'));
    await press(m, 'record-bot-retry');
    await m.flush?.();
    assert.equal(s.reads.length, 2);
    await change(m, 'record-link', ZOOM_LINK);
    assert.equal(by(m, 'record-bot-send-off'), undefined);
    assert.match(m.text(), /Send Eadwyn AI/);
  } finally { await m.unmount(); }
});
