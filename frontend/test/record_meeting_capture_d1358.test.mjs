// D1358: Record a Session › Call. A Zoom, Google Meet or Teams call is captured
// by the platform (Eadwyn AI joining, or the provider's transcript imported
// after the call), never by this browser's microphone or a shared tab. These
// are the pure rule (`callCapture`) and the two client methods it uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOT_UNAVAILABLE, IMPORT_NOTE, IMPORT_START, TEAMS_NO_CAPTURE, botState, callCapture, modeNote,
} from '../src/pages/founder/recordSetup.js';

const ZOOM = 'https://acme.zoom.us/j/12345678';
const MEET = 'https://meet.google.com/abc-defg-hij';
const TEAMS = 'https://teams.microsoft.com/l/meetup-join/abc';
const CONNECTED = { connections: { zoom: { status: 'active' }, google_meet: { status: 'active' } } };
const NONE = { connections: {} };
const BOT_ON = botState({ platforms: { zoom: true, google_meet: true, teams: true } }, 'zoom');
const BOT_OFF = botState({ platforms: { zoom: false, google_meet: false, teams: false } }, 'zoom');
const BOT_LOADING = botState(undefined, 'zoom');
const cap = (over) => callCapture({ mode: 'video', provider: 'zoom', link: ZOOM, channels: CONNECTED, bot: BOT_OFF, botLink: true, ...over });

test('only a meeting is decided here: in person and a call on this phone\'s speaker stay on the device', () => {
  for (const mode of ['in_person', 'phone', 'text']) assert.deepEqual(callCapture({ mode, provider: 'phone_speaker' }), { kind: 'device' }, mode);
});

test('the bot first, where it is deployed for the link\'s platform', () => {
  assert.deepEqual(cap({ bot: BOT_ON }), { kind: 'bot' });
  assert.deepEqual(cap({ bot: BOT_ON, provider: 'teams', link: TEAMS }), { kind: 'bot' }, 'Teams too, once the bot can join it');
  assert.notEqual(cap({ bot: BOT_ON, botLink: false }).kind, 'bot', 'a link the bot cannot join');
});

test('without the bot, a connected Zoom or Meet call is saved for import after it ends, with what the provider needs', () => {
  assert.deepEqual(cap({}), { kind: 'import', note: IMPORT_NOTE.zoom });
  assert.deepEqual(cap({ provider: 'google_meet', link: MEET }), { kind: 'import', note: IMPORT_NOTE.google_meet });
  assert.match(IMPORT_NOTE.zoom, /does not record this call.*cloud recording/);
  assert.match(IMPORT_NOTE.google_meet, /does not record this call.*transcription turned on/);
  assert.equal(IMPORT_START, 'Save for import after the call');
});

test('nothing can capture it: Start is off with the reason, and never the browser', () => {
  assert.deepEqual(cap({ link: '' }), { kind: 'none', reason: 'Paste the meeting link, or create the meeting.' });
  assert.deepEqual(cap({ link: 'https://evil.example/j/1' }), { kind: 'none', reason: null }, 'the field says what is wrong with the link');
  assert.deepEqual(cap({ provider: 'teams', link: TEAMS }), { kind: 'none', reason: TEAMS_NO_CAPTURE });
  assert.match(TEAMS_NO_CAPTURE, /upload its recording or paste its transcript/);
  assert.deepEqual(cap({ channels: NONE }), { kind: 'none', reason: 'Connect Zoom in Account › Connectors so Axal can import this call’s transcript after it ends.' });
  assert.match(cap({ provider: 'google_meet', link: MEET, channels: NONE }).reason, /^Connect Google/);
  assert.match(cap({ channels: null }).reason, /^Unreadable:/, 'an unread connection is not "not connected"');
  assert.deepEqual(cap({ channels: NONE, bot: BOT_LOADING }), { kind: 'none', reason: 'Checking whether Eadwyn AI can join…' });
  for (const over of [{}, { link: '' }, { provider: 'teams', link: TEAMS }, { channels: NONE }, { bot: BOT_ON }]) {
    assert.notEqual(cap(over).kind, 'device', JSON.stringify(over));
  }
});

test('the copy no longer offers this device for a meeting', () => {
  assert.equal(BOT_UNAVAILABLE, 'Eadwyn AI can’t join calls yet on Axal.');
  assert.match(modeNote('video'), /This device’s microphone is not used\./);
  assert.doesNotMatch(modeNote('video'), /records the call’s audio|On a phone it records/);
  assert.match(modeNote('phone'), /It records this device’s microphone/, 'the phone on speaker still does');
});

test('the clients: saveZoomCall posts the attach with consent and no session; meetingCapabilities reads its route', async () => {
  const { channelsApi } = await import('../src/lib/api/channels.js');
  globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  const seen = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (url, init) => { seen.push([String(url), init?.method ?? 'GET', JSON.parse(init?.body || 'null')]); return { ok: true, status: 201, headers: { get: () => 'application/json' }, json: async () => ({ ok: 1 }), text: async () => '{"ok":1}' }; };
  try {
    await channelsApi.saveZoomCall(41, { join_url: ZOOM, consent: { status: 'given', method: 'verbal' } });
    await channelsApi.meetingCapabilities();
  } finally { globalThis.fetch = saved; }
  assert.match(seen[0][0], /\/founder\/validate\/interviews\/41\/meetings$/);
  assert.equal(seen[0][1], 'POST');
  assert.deepEqual(seen[0][2], { attach: { join_url: ZOOM }, consent: { status: 'given', method: 'verbal' }, provider: 'zoom' });
  assert.equal(seen[0][2].session_id, undefined, 'no session: the Worker opens the call\'s own');
  assert.match(seen[1][0], /\/founder\/validate\/meetings\/capabilities$/);
  assert.equal(seen[1][1], 'GET');
});
