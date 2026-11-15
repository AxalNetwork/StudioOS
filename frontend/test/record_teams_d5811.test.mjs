/**
 * D5811 (#5811) — Record a session › Call › Microsoft Teams: the chip reads the
 * member's own capability row, "Create the meeting for me" only fills the link,
 * a personal account keeps the draft and is told to paste, capture that is not
 * possible offers the upload and the paste, and the setup survives the trip to
 * Account › Connectors › Microsoft Teams and back for this member only.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/record_teams_d5811.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import RecordLightbox from '../src/pages/founder/RecordLightbox.jsx';
import {
  TEAMS_CHECKING, TEAMS_CONNECT_HREF, TEAMS_NO_CAPTURE, TEAMS_UNAVAILABLE, TEAMS_UNREADABLE, createMeetingOffer, teamsChipStatus,
} from '../src/pages/founder/recordSetup.js';
import { clearRecordDraft, pendingRecordReturn, readRecordDraft, recordReturnPath, safeRecordReturn, saveRecordDraft } from '../src/pages/founder/recordDraft.js';

const h = React.createElement;
const TEAMS_LINK = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_fixture%40thread.v2/0';
const BOT_OFF = { available: false, platforms: { zoom: false, google_meet: false, teams: false }, limit_minutes: 30, price: {} };
const BOT_ON = { available: true, platforms: { zoom: true, google_meet: true, teams: true }, limit_minutes: 120, price: {} };
const CHANNELS = { providers: [{ provider: 'zoom', available: true }, { provider: 'google_meet', available: true }], connections: {} };
const models = { live: [], final: [{ model: 'final-a', label: 'Final A', price_usd_per_minute: 0.002, choosable: true }], defaults: { live: null, final: 'final-a' } };
const caps = (teams) => ({ providers: { teams: { create_available: true, connected: true, can_create_meeting: true, can_join_as_bot: false, ...teams } } });

function memoryStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

const by = (m, id) => m.nodes().find((n) => m.props(n)?.['data-testid'] === id);
async function press(m, id) { await act(async () => { await m.props(by(m, id)).onClick?.({ preventDefault() {} }); }); }
async function change(m, id, value) { await act(async () => { await m.props(by(m, id)).onChange({ target: { value } }); }); }

function setup({ bot = BOT_OFF, capsRead = caps({}), instant, consent = 'written', memberId = 7, interview = { id: 1, interviewee_name: 'Fixture person' } } = {}) {
  const made = [], sent = [], sessionsMade = [], capReads = [];
  const channelsSource = {
    async overview() { return CHANNELS; },
    async instantMeeting(provider, minutes) { made.push([provider, minutes]); return instant ? instant(provider) : { provider, join_url: TEAMS_LINK }; },
    async meetingCapabilities() { capReads.push(1); return typeof capsRead === 'function' ? capsRead(capReads.length) : capsRead; },
  };
  const props = {
    projectId: 10, interview, initialMode: 'video', initialModels: models, initialBoard: { hypotheses: [] }, channels: CHANNELS,
    initialConsent: consent, onClose() {}, onStarted() {}, channelsSource, initialBot: bot, memberId,
    sessions: { async create(id, body) { sessionsMade.push(body); return { session: { id: 15, channel: 'video' } }; }, async sendBot(id, body) { sent.push(body); return { bot: { status: 'joining' } }; } },
    recorder: { prepare() {}, release() {}, begin() {}, getSnapshot() { return {}; }, isCapturing() { return false; } },
  };
  return { props, made, sent, sessionsMade, capReads };
}

function withStore(fn) {
  return async () => {
    const prev = globalThis.sessionStorage;
    const store = memoryStore();
    globalThis.sessionStorage = store;
    try { await fn(store); } finally { globalThis.sessionStorage = prev; }
  };
}

test('the chip and the offer read the capability row; a read still out or failed is never "not connected"', () => {
  assert.deepEqual(teamsChipStatus(undefined), { word: 'Checking', disabled: false });
  assert.deepEqual(teamsChipStatus(null), { word: 'Unreadable', disabled: false });
  assert.deepEqual(teamsChipStatus(caps({ connected: null })), { word: 'Unreadable', disabled: false });
  assert.deepEqual(teamsChipStatus(caps({})), { word: 'Connected', disabled: false });
  assert.deepEqual(teamsChipStatus(caps({ connected: false })), { word: 'Ready', disabled: false }, 'a pasted link needs no sign-in');
  const offer = (c) => createMeetingOffer('video', 'teams', CHANNELS, c);
  assert.deepEqual(offer(undefined), { kind: 'checking', sentence: TEAMS_CHECKING });
  assert.deepEqual(offer(null), { kind: 'unreadable', sentence: TEAMS_UNREADABLE });
  assert.deepEqual(offer(caps({ connected: null, can_create_meeting: false })), { kind: 'unreadable', sentence: TEAMS_UNREADABLE });
  assert.deepEqual(offer(caps({ create_available: false, can_create_meeting: false })), { kind: 'unavailable', sentence: TEAMS_UNAVAILABLE });
  assert.equal(offer(caps({})).button, true);
  assert.deepEqual([offer(caps({ connected: false, can_create_meeting: false })).connectHref, offer(caps({ connected: false, can_create_meeting: false })).button], [TEAMS_CONNECT_HREF, undefined]);
  assert.equal(TEAMS_CONNECT_HREF, '/account/connectors/teams');
  assert.doesNotMatch(TEAMS_NO_CAPTURE, /import (its|the) transcript after|imports? it/i, 'no promise of a Teams transcript import');
});

test('the draft: this member and this venture only, an hour at most, and Back goes to /validate/record alone', () => {
  const store = memoryStore();
  const t = 1_000_000;
  assert.equal(saveRecordDraft(7, { projectId: 10, interviewId: 4, name: 'A', company: 'B', mode: 'video', provider: 'teams', link: TEAMS_LINK, minutes: 45 }, t, store), true);
  const d = readRecordDraft(7, { projectId: 10 }, t + 1, store);
  assert.deepEqual([d.name, d.company, d.mode, d.provider, d.link, d.minutes, d.interviewId], ['A', 'B', 'video', 'teams', TEAMS_LINK, 45, 4]);
  assert.equal('consent' in d, false, 'consent is never kept');
  assert.equal(readRecordDraft(7, { projectId: 11 }, t + 1, store), null, 'never into another venture');
  assert.ok(store.m.size, 'and kept for its own');
  assert.equal(pendingRecordReturn(7, t + 1, store), '/validate/record?project_id=10&interview=4');
  assert.equal(readRecordDraft(null, {}, t + 1, store), null);
  assert.ok(store.m.size, 'a member not known yet leaves it alone');
  assert.equal(readRecordDraft(8, {}, t + 1, store), null);
  assert.equal(store.m.size, 0, 'another member’s read removes it');
  saveRecordDraft(7, { projectId: 10, mode: 'video' }, t, store);
  assert.equal(readRecordDraft(7, {}, t + 61 * 60_000, store), null, 'an hour old is gone');
  assert.equal(saveRecordDraft(null, { projectId: 10 }, t, store), false, 'no member, nothing kept');
  saveRecordDraft(7, { projectId: 10, mode: 'video' }, t, store);
  clearRecordDraft(store);
  assert.equal(store.m.size, 0);
  assert.equal(recordReturnPath(10), '/validate/record?project_id=10');
  assert.equal(recordReturnPath('x', 4), '/validate/record');
  for (const bad of ['/validate/record?project_id=10&next=//evil.example', 'https://evil.example/validate/record', '//evil.example', '/validate/record?project_id=0', '/account', null]) {
    assert.equal(safeRecordReturn(bad), null, String(bad));
  }
});

test('Teams is selectable: its chip is not disabled and choosing it draws the link and the create button', withStore(async () => {
  const s = setup({ capsRead: caps({}) });
  const m = await mountContracts(h(RecordLightbox, s.props));
  try {
    const chip = by(m, 'record-provider-teams');
    assert.notEqual(m.props(chip).disabled, true);
    await press(m, 'record-provider-teams');
    assert.equal(m.props(by(m, 'record-provider-teams'))['aria-checked'], true);
    assert.ok(m.text().includes('Microsoft Teams · Connected'));
    assert.ok(by(m, 'record-link'));
    assert.ok(by(m, 'record-create-teams'), 'Create the meeting for me');
  } finally { await m.unmount(); }
}));

test('Create the meeting for me fills the link and starts nothing: no session, no bot', withStore(async () => {
  const s = setup({ bot: BOT_ON, capsRead: caps({ can_join_as_bot: true }) });
  const m = await mountContracts(h(RecordLightbox, s.props));
  try {
    await press(m, 'record-provider-teams');
    await press(m, 'record-create-teams');
    assert.deepEqual(s.made, [['teams', 30]]);
    assert.equal(m.props(by(m, 'record-link')).value, TEAMS_LINK);
    assert.deepEqual([s.sessionsMade.length, s.sent.length], [0, 0], 'creating a link records nothing');
    assert.equal(by(m, 'record-create-teams'), undefined, 'the link is there now');
    // Start, with consent given and Eadwyn AI allowed for this member, sends it, and forgets any kept setup.
    saveRecordDraft(7, { projectId: 99, mode: 'video', provider: 'teams' });
    await press(m, 'record-start');
    assert.deepEqual(s.sent, [{ meeting_url: TEAMS_LINK }]);
    assert.equal(readRecordDraft(7), null, 'a Start that lands forgets the kept setup');
  } finally { await m.unmount(); }
}));

test('a personal account is refused in Microsoft’s place: the draft stays and the member is told to paste', withStore(async () => {
  const personal = 'This Microsoft account cannot create Teams meetings from Axal: that needs a work or school Microsoft 365 account. Create the meeting in Microsoft Teams and paste its link.';
  const s = setup({ instant: () => { throw Object.assign(new Error(personal), { code: 'teams_personal_account' }); } });
  const m = await mountContracts(h(RecordLightbox, { ...s.props, interview: null }));
  try {
    await change(m, 'record-name', 'Kept name');
    await press(m, 'record-provider-teams');
    await press(m, 'record-create-teams');
    assert.ok(m.text().includes(personal));
    assert.equal(m.props(by(m, 'record-name')).value, 'Kept name');
    assert.equal(m.props(by(m, 'record-link')).value, '');
    await change(m, 'record-link', TEAMS_LINK);
    assert.equal(m.props(by(m, 'record-link')).value, TEAMS_LINK, 'paste still works');
    assert.deepEqual([s.sessionsMade.length, s.sent.length], [0, 0]);
  } finally { await m.unmount(); }
}));

test('no way to capture it here: Start is off and the upload and paste-transcript options are offered', withStore(async () => {
  const s = setup({ bot: BOT_OFF, capsRead: caps({ connected: false, can_create_meeting: false }) });
  const m = await mountContracts(h(RecordLightbox, s.props));
  try {
    await press(m, 'record-provider-teams');
    assert.equal(by(m, 'record-create-teams'), undefined, 'no create without a connection');
    assert.equal(m.props(by(m, 'record-create-connect')).href, '/account/connectors/teams');
    await change(m, 'record-link', TEAMS_LINK);
    assert.ok(m.text().includes(TEAMS_NO_CAPTURE));
    assert.equal(m.props(by(m, 'record-teams-upload')).href, '/validate/record/calls/upload');
    await press(m, 'record-start');
    assert.deepEqual([s.sessionsMade.length, s.sent.length], [0, 0]);
    await press(m, 'record-teams-paste');
    assert.ok(by(m, 'record-conversation'), 'the paste box');
  } finally { await m.unmount(); }
}));

test('without consent Eadwyn AI is not sent, even with a link and the bot allowed', withStore(async () => {
  const s = setup({ bot: BOT_ON, consent: '', capsRead: caps({ can_join_as_bot: true }) });
  const m = await mountContracts(h(RecordLightbox, s.props));
  try {
    await press(m, 'record-provider-teams');
    await change(m, 'record-link', TEAMS_LINK);
    await press(m, 'record-start');
    assert.deepEqual([s.sessionsMade.length, s.sent.length], [0, 0]);
  } finally { await m.unmount(); }
}));

test('an unreadable read says so, and Try again reads again', withStore(async () => {
  const s = setup({ capsRead: (n) => (n === 1 ? null : caps({})) });
  const m = await mountContracts(h(RecordLightbox, s.props));
  try {
    await press(m, 'record-provider-teams');
    assert.ok(m.text().includes(TEAMS_UNREADABLE));
    assert.ok(m.text().includes('Microsoft Teams · Unreadable'), 'never "not connected"');
    await press(m, 'record-caps-retry');
    assert.equal(s.capReads.length, 2);
    assert.ok(m.text().includes('Microsoft Teams · Connected'));
  } finally { await m.unmount(); }
}));

test('back in focus it reads again; a late answer never overwrites a newer one, and the typed link stays', withStore(async () => {
  let release;
  const slow = new Promise((r) => { release = r; });
  const focus = [];
  const s = setup({ capsRead: (n) => {
    if (n === 1) { globalThis.addEventListener = (type, fn) => { if (type === 'focus') focus.push(fn); }; return slow; }
    return caps({});
  } });
  const m = await mountContracts(h(RecordLightbox, s.props));
  try {
    await press(m, 'record-provider-teams');
    await change(m, 'record-link', TEAMS_LINK);
    assert.equal(focus.length, 1, 'the read is tied to the tab coming back');
    await act(async () => { await focus[0](); });
    assert.ok(m.text().includes('Microsoft Teams · Connected'));
    await act(async () => { release(null); await slow; });
    assert.ok(m.text().includes('Microsoft Teams · Connected'), 'the first, late answer is dropped');
    assert.equal(m.props(by(m, 'record-link')).value, TEAMS_LINK);
  } finally { await m.unmount(); }
}));

test('the same-tab round trip: Connect keeps the setup, coming back restores it for this member and starts nothing; Cancel forgets it', withStore(async (store) => {
  const out = setup({ capsRead: caps({ connected: false, can_create_meeting: false }), consent: '' });
  const m = await mountContracts(h(RecordLightbox, out.props));
  try {
    await press(m, 'record-provider-teams');
    await change(m, 'record-link', TEAMS_LINK);
    await press(m, 'record-create-connect');
  } finally { await m.unmount(); }
  assert.equal(pendingRecordReturn(7), '/validate/record?project_id=10&interview=1');
  assert.doesNotMatch([...store.m.keys()].join(' '), /teams\.microsoft/, 'the link is a value, never a key');
  const other = setup({ memberId: 8, capsRead: caps({}) });
  const o = await mountContracts(h(RecordLightbox, other.props));
  try {
    assert.equal(o.props(by(o, 'record-link')).value, '', 'another member gets none of it');
    assert.notEqual(o.props(by(o, 'record-provider-teams'))['aria-checked'], true);
  } finally { await o.unmount(); }
  assert.equal(store.m.size, 0, 'and the other member’s read removed it');
  // Back again as member 7, after Microsoft's sign-in.
  saveRecordDraft(7, { projectId: 10, interviewId: 1, mode: 'video', provider: 'teams', link: TEAMS_LINK, minutes: 45 });
  const back = setup({ capsRead: caps({}), consent: '' });
  const r = await mountContracts(h(RecordLightbox, back.props));
  try {
    assert.equal(r.props(by(r, 'record-provider-teams'))['aria-checked'], true);
    assert.equal(r.props(by(r, 'record-link')).value, TEAMS_LINK);
    assert.equal(store.m.size, 0, 'restored once, then forgotten');
    assert.deepEqual([back.sessionsMade.length, back.sent.length, back.made.length], [0, 0, 0], 'coming back records nothing');
  } finally { await r.unmount(); }
  const c = setup({ capsRead: caps({ connected: false, can_create_meeting: false }) });
  const cm = await mountContracts(h(RecordLightbox, c.props));
  try {
    await press(cm, 'record-provider-teams');
    await press(cm, 'record-create-connect');
    assert.equal(store.m.size, 1, 'kept by Connect');
    await press(cm, 'record-cancel');
    assert.equal(store.m.size, 0, 'Cancel forgets it');
  } finally { await cm.unmount(); }
}));
