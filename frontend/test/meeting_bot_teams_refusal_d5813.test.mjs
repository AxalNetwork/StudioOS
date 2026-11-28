/**
 * D5813 (#5813, D1451 part 3): the Teams run states and the three recognised
 * tenant refusals in the member's run view — the bot card, the session page's
 * one failure panel, and the Teams connector's shared capability copy. All
 * reads are synthetic; no link, passcode or provider page is real.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { mountContracts } from './_contracts_dom.mjs';
import { renderedText } from './_renderedText.mjs';
import MeetingBotPanel, { MeetingBotStatus } from '../src/pages/founder/MeetingBotPanel.jsx';
import InterviewSessionPage from '../src/pages/founder/InterviewSessionPage.jsx';
import { SessionFailure } from '../src/pages/founder/SessionLifecycle.jsx';
import { failureView, lifecycle } from '../src/pages/founder/sessionLifecycle.js';
import { TEAMS_BLOCKED, TEAMS_BOT_GUEST, TEAMS_BOT_OFF, botView } from '../src/pages/founder/meetingBotSession.js';
import { teamsCapabilityRows } from '../src/pages/account/teamsConnector.js';
import { setRecorder } from '../src/contexts/ActiveRecordingContext.jsx';

const h = React.createElement;
const NOW = Date.parse('2026-11-28T12:00:00Z');
const by = (m, id) => m.nodes().find((n) => m.props(n)?.['data-testid'] === id);
const all = (m, id) => m.nodes().filter((n) => m.props(n)?.['data-testid'] === id);
// Synthetic private values a run might carry; none may ever be drawn.
const PRIVATE = ['https:/', 'teams.microsoft.com', 'meet', 'synthetic-private'].join('/');
const PASSCODE = 'SYNTH-PASSCODE-0000';
const DETAILS = { guests_off: 'platform_blocked@teams_anonymous_blocked', bot_blocked: 'platform_blocked@teams_bot_blocked', captcha: 'platform_blocked@teams_captcha' };
const teamsBot = (over = {}) => ({ uid: 'synthetic', platform: 'teams', status: 'failed', failure_code: 'runtime_failed', failure_category: null, blocked: null, started_at: null, participant_count: null, ...over });
const refusedBot = (reason) => teamsBot({ blocked: reason, failure_detail: DETAILS[reason], meeting_url: PRIVATE, passcode: PASSCODE });
const GENERIC = 'Eadwyn AI could not record this call. Check the meeting before trying again.';

test('D5813: each recognised refusal has its own sentence, cause, organizer action and fallback', () => {
  for (const reason of ['guests_off', 'bot_blocked', 'captcha']) {
    const v = botView({ bot: refusedBot(reason) });
    assert.equal(v.state, 'failed');
    assert.equal(v.blocked, reason);
    assert.equal(v.failure, TEAMS_BLOCKED[reason].failure);
    assert.equal(v.cause, TEAMS_BLOCKED[reason].cause);
    assert.equal(v.organizer, TEAMS_BLOCKED[reason].organizer);
    assert.equal(v.fallback, true);
    assert.equal(v.poll, false, 'a refused run is terminal: no more polling');
    assert.equal(v.canStop, false);
    assert.match(v.failure, /Nothing was recorded\./);
  }
  assert.equal(botView({ bot: refusedBot('captcha') }).organizer, null, 'a captcha has no organizer setting, only the fallback');
  assert.match(botView({ bot: refusedBot('guests_off') }).organizer, /anonymous users join/);
  assert.match(botView({ bot: refusedBot('bot_blocked') }).organizer, /Teams admin/);
});

test('D5813: an unknown or misplaced reason stays generic', () => {
  for (const blocked of ['tenant_policy', 'GUESTS_OFF', '__proto__', 'toString', 'constructor', '', 7, null, undefined]) {
    const v = botView({ bot: teamsBot({ blocked, failure_detail: 'platform_blocked@teams_unknown' }) });
    assert.equal(v.blocked, null, String(blocked));
    assert.equal(v.failure, GENERIC, String(blocked));
    assert.equal(v.fallback, false);
    assert.equal(v.organizer, null);
  }
  // The right word on another platform, a run that has not failed, or the service's own failure is not a Teams refusal.
  assert.equal(botView({ bot: teamsBot({ platform: 'google_meet', blocked: 'captcha' }) }).blocked, null);
  for (const status of ['joining', 'waiting_room', 'recording', 'processing', 'done', 'stopped']) {
    assert.equal(botView({ bot: teamsBot({ status, blocked: 'captcha' }) }).blocked, null, status);
  }
  const infra = botView({ bot: teamsBot({ failure_code: 'runtime_unavailable', failure_category: 'infrastructure', blocked: 'captcha' }) });
  assert.equal(infra.blocked, null);
  assert.match(infra.failure, /recording service did not start/);
});

test('D5813: honest words for the lobby, admission and notice, capture, processing, completion, stop, timeout and failure', () => {
  const v = (over) => botView({ bot: teamsBot(over) });
  assert.match(v({ status: 'joining' }).note, /opening the Teams meeting in a browser as a guest named Eadwyn AI, with its microphone and camera off/);
  const lobby = v({ status: 'waiting_room' });
  assert.equal(lobby.label, 'Waiting to be admitted');
  assert.match(lobby.note, /in the Teams lobby\. The organizer admits it from the lobby\. Nothing is recorded until it is admitted and has posted its recording notice/);
  assert.match(botView({ bot: { ...teamsBot({ status: 'waiting_room' }), platform: 'google_meet' } }).note, /^Admit Eadwyn AI from the call’s waiting room/);
  assert.equal(botView({ bot: { ...teamsBot({ status: 'waiting_room' }), platform: 'zoom', waiting_for: 'founder' } }).note, null, 'Zoom waiting for the founder keeps its own line');
  assert.match(v({ status: 'recording' }).note, /posted its recording notice in the meeting chat and is recording/);
  assert.match(v({ status: 'processing' }).note, /being saved and processed/);
  assert.equal(v({ status: 'done' }).note, 'The recording was saved and processed.');
  assert.equal(v({ status: 'stopped', failure_code: 'time_limit' }).failure, 'Eadwyn AI stopped at this plan’s call time limit.');
  // The lobby timeout and a lobby denial: Teams' own word, never a refusal reason.
  for (const code of ['admission_refused', 'not_admitted']) {
    const t = v({ failure_code: code });
    assert.match(t.failure, /not admitted from the Teams lobby/);
    assert.equal(t.blocked, null);
  }
  assert.match(botView({ bot: { ...teamsBot({ failure_code: 'admission_refused' }), platform: 'zoom' } }).failure, /check the waiting room/);
  assert.match(v({ failure_code: 'notice_failed' }).failure, /could not post its recording notice in the meeting chat, so it left without recording/);
  assert.match(v({ failure_code: 'heartbeat_timeout' }).failure, /connection to Eadwyn AI was interrupted/);
  assert.equal(v({ failure_code: 'runtime_failed' }).failure, GENERIC);
});

test('D5813: the mounted bot card per refusal — one alert, the organizer action, upload and paste, no detail, link or passcode', async () => {
  for (const reason of ['guests_off', 'bot_blocked', 'captcha']) {
    const m = await mountContracts(h(MeetingBotStatus, { snapshot: { read: { bot: refusedBot(reason) } }, participants: null, recordHref: '/validate/record?interview=7&project_id=10' }), '/validate/session/15');
    try {
      const text = m.text();
      assert.equal(m.props(by(m, 'meeting-bot-panel'))['data-state'], 'failed');
      assert.equal(m.props(by(m, 'bot-failure'))['data-blocked'], reason);
      assert.equal(all(m, 'bot-failure').length, 1);
      assert.ok(text.includes(TEAMS_BLOCKED[reason].failure));
      assert.equal(!!by(m, 'bot-organizer-action'), reason !== 'captcha');
      if (TEAMS_BLOCKED[reason].organizer) assert.ok(text.includes(TEAMS_BLOCKED[reason].organizer));
      assert.equal(m.props(by(m, 'bot-fallback-upload')).href, '/validate/record/calls/upload');
      assert.equal(m.props(by(m, 'bot-fallback-paste')).href, '/validate/record?interview=7&project_id=10');
      assert.ok(text.includes(TEAMS_BOT_GUEST) && text.includes(TEAMS_BOT_OFF));
      for (const secret of [DETAILS[reason], 'teams_', 'runtime_failed', PRIVATE, 'synthetic-private', PASSCODE]) assert.equal(text.includes(secret), false, secret);
      assert.equal(by(m, 'bot-stop'), undefined);
    } finally { await m.unmount(); }
  }
  // An unknown reason: the generic sentence, no organizer action and no refusal fallback.
  const u = await mountContracts(h(MeetingBotStatus, { snapshot: { read: { bot: teamsBot({ blocked: 'tenant_policy', failure_detail: 'platform_blocked@teams_unknown' }) } }, participants: null }));
  try {
    assert.ok(u.text().includes(GENERIC));
    assert.equal(by(u, 'bot-blocked-actions'), undefined);
    assert.equal(u.text().includes('teams_unknown'), false);
    assert.equal(u.text().includes('tenant_policy'), false);
  } finally { await u.unmount(); }
  // The session page hides the card's failure (D1455): its one panel says it instead.
  const hidden = await mountContracts(h(MeetingBotStatus, { snapshot: { read: { bot: refusedBot('captcha') } }, participants: null, hideFailure: true }));
  try { assert.equal(by(hidden, 'bot-failure'), undefined); assert.equal(by(hidden, 'bot-blocked-actions'), undefined); } finally { await hidden.unmount(); }
});

test('D5813: the lobby, capture and completion lines render without an alert', () => {
  for (const [status, line] of [['waiting_room', /Teams lobby/], ['recording', /posted its recording notice/], ['done', /saved and processed/], ['joining', /guest named Eadwyn AI/]]) {
    const out = renderToStaticMarkup(h(MemoryRouter, null, h(MeetingBotStatus, { snapshot: { read: { bot: teamsBot({ status, started_at: NOW - 5000 }) } }, participants: null, now: NOW })));
    assert.match(renderedText(out), line, status);
    assert.equal(out.includes('role="alert"'), false, status);
    assert.match(out, /data-testid="bot-note"/);
    assert.match(out, /dark:text-gray-400/);
  }
});

test('D5813: a retried read after a refusal shows one terminal state and stops polling', async () => {
  const reads = [{ bot: teamsBot({ status: 'waiting_room' }) }, { bot: refusedBot('bot_blocked') }, { bot: refusedBot('bot_blocked') }];
  let n = 0;
  const getBot = async () => reads[Math.min(n++, reads.length - 1)];
  const { createBotSession } = await import('../src/pages/founder/meetingBotSession.js');
  const s = createBotSession({ getBot, sendBot: async () => null, stopBot: async () => null });
  await s.refresh();
  assert.equal(botView(s.getSnapshot().read).state, 'waiting_room');
  assert.equal(botView(s.getSnapshot().read).poll, true);
  await s.refresh(); await s.refresh();
  const v = botView(s.getSnapshot().read);
  assert.deepEqual([v.state, v.blocked, v.poll, v.canStop], ['failed', 'bot_blocked', false, false]);
  const out = renderToStaticMarkup(h(MemoryRouter, null, h(MeetingBotStatus, { snapshot: s.getSnapshot(), participants: null })));
  assert.equal((out.match(/role="alert"/g) || []).length, 1, 'one failure, never the lobby line beside it');
  assert.equal(renderedText(out).includes('Teams lobby'), false);
  assert.equal((out.match(/data-testid="bot-blocked-actions"/g) || []).length, 1);
  // The mounted card, read once: the refusal, and no poll timer left to read again.
  n = 1;
  const m = await mountContracts(h(MeetingBotPanel, { sessionId: 15, api: { getBot, botParticipants: async () => ({ participants: null }) } }));
  try {
    await m.flush();
    assert.equal(all(m, 'bot-failure').length, 1);
    assert.equal(m.props(by(m, 'bot-failure'))['data-blocked'], 'bot_blocked');
  } finally { await m.unmount(); }
});

/** The session page, mounted at its route, over a stubbed API. */
async function sessionPage(getBot, { get } = {}) {
  const snapshot = {};
  setRecorder({ subscribe: () => () => {}, getSnapshot: () => snapshot, isCapturing: () => false, follow() {}, adopt: async () => null });
  const session = { id: 15, uid: 'synthetic', project_id: 10, interview_id: 7, submitted_via: 'meeting_bot', status: 'draft', channel: 'video', consent_status: 'given', setup_complete_at: '2026-11-28 10:00:00', client_key: null };
  const api = {
    get: get || (async () => ({ session, interview: { id: 7, interviewee_name: 'Synthetic person' }, segments: [], marks: [], chunks: [], processing: null })),
    receipt: async () => ({ items: [] }), models: async () => null, getBot, botParticipants: async () => ({ participants: null }),
  };
  // The contract DOM's <html> has no classList; the page reads it for its theme (light here).
  const Page = () => { document.documentElement.classList ??= { contains: () => false }; return h(InterviewSessionPage, { api }); };
  const m = await mountContracts(h(Routes, null, h(Route, { path: '/validate/session/:id', element: h(Page) })), '/validate/session/15');
  await m.flush(); await m.flush();
  return m;
}

test('D5813: the session page draws one failure panel per refusal, with the organizer action, fallbacks and the original interview', async () => {
  for (const reason of ['guests_off', 'bot_blocked', 'captcha']) {
    const m = await sessionPage(async () => ({ bot: refusedBot(reason) }));
    try {
      const panel = by(m, 'session-failure');
      assert.ok(panel, m.text());
      assert.equal(all(m, 'session-failure').length, 1);
      assert.equal(m.props(panel)['data-blocked'], reason);
      const text = m.text();
      assert.ok(text.includes(TEAMS_BLOCKED[reason].failure));
      assert.ok(text.includes(TEAMS_BLOCKED[reason].cause));
      assert.equal(text.includes('The meeting link changed or expired'), false, 'the generic causes give way to the known one');
      assert.equal(!!by(m, 'session-failure-organizer'), reason !== 'captcha');
      assert.equal(m.props(by(m, 'session-failure-upload')).href, '/validate/record/calls/upload');
      assert.equal(m.props(by(m, 'session-failure-paste')).href, '/validate/record?interview=7&project_id=10');
      assert.equal(m.props(by(m, 'session-failure-retry')).href, '/validate/record?interview=7&project_id=10');
      assert.equal(m.props(by(m, 'session-failure-interview')).href, '/validate/customer-research/7?project_id=10');
      // The card does not repeat the failure; the page's panel is the one place it is said.
      assert.equal(by(m, 'bot-failure'), undefined);
      for (const secret of [DETAILS[reason], 'teams_', PRIVATE, 'synthetic-private', PASSCODE]) assert.equal(text.includes(secret), false, secret);
    } finally { await m.unmount(); }
  }
  // An unknown reason: the generic title and the step's causes, no organizer action or refusal fallback.
  const u = await sessionPage(async () => ({ bot: teamsBot({ blocked: 'tenant_policy', failure_detail: 'platform_blocked@teams_unknown' }) }));
  try {
    assert.ok(u.text().includes(GENERIC));
    assert.equal(by(u, 'session-failure-organizer'), undefined);
    assert.equal(by(u, 'session-failure-fallback'), undefined);
    assert.equal(m_props(u, 'session-failure-interview'), '/validate/customer-research/7?project_id=10', 'every failed join still leads back to the interview');
    assert.equal(u.text().includes('teams_unknown'), false);
  } finally { await u.unmount(); }
});
const m_props = (m, id) => m.props(by(m, id))?.href;

test('D5813: another member’s session draws no run, reason or detail', async () => {
  const refusal = Object.assign(new Error('Session not found'), { status: 404 });
  const m = await sessionPage(async () => { throw refusal; }, { get: async () => { throw refusal; } });
  try {
    assert.equal(by(m, 'session-failure'), undefined);
    assert.equal(by(m, 'meeting-bot-panel'), undefined);
    for (const word of ['captcha', 'anonymous', 'Teams admin', 'teams_']) assert.equal(m.text().includes(word), false, word);
  } finally { await m.unmount(); }
  // A bot read refused by the Worker (404 for someone else's session) is Unreadable, never a refusal.
  const card = await mountContracts(h(MeetingBotPanel, { sessionId: 15, api: { getBot: async () => { throw refusal; }, botParticipants: async () => { throw refusal; } } }));
  try {
    await card.flush();
    assert.match(card.text(), /Unreadable/);
    assert.equal(by(card, 'bot-blocked-actions'), undefined);
  } finally { await card.unmount(); }
});

test('D5813: failureView only takes a refusal for a bot failure, and SessionFailure keeps the old retry for everything else', () => {
  const refused = botView({ bot: refusedBot('guests_off') });
  const life = lifecycle({ bot: refusedBot('guests_off') });
  const f = failureView(life, { botFailure: refused.failure, blocked: refused });
  assert.deepEqual([f.blocked, f.fallback, f.causes], ['guests_off', true, [TEAMS_BLOCKED.guests_off.cause]]);
  assert.equal(f.retry, 'new-session');
  const proc = failureView(lifecycle({ processing: { stage: 'failed', failed_stage: 'transcribing' } }), { blocked: refused });
  assert.deepEqual([proc.blocked, proc.fallback, proc.organizer], [null, false, null], 'a processing failure is never a Teams refusal');
  const infra = failureView(lifecycle({ bot: teamsBot({ failure_category: 'infrastructure' }) }), { blocked: refused });
  assert.equal(infra.blocked, null);
});

test('D5813: the Teams connector and the run view share one capability sentence', () => {
  const caps = (on) => ({ providers: { teams: { connected: true, create_available: true, can_create_meeting: true, can_join_as_bot: on } } });
  assert.equal(teamsCapabilityRows(null, caps(true))[2].note, TEAMS_BOT_GUEST);
  assert.equal(teamsCapabilityRows(null, caps(false))[2].note, TEAMS_BOT_OFF);
  assert.match(TEAMS_BOT_GUEST, /does not need your Microsoft connection/);
});

test('D5813: SessionFailure without a refusal keeps D1455’s note and no fallback block', async () => {
  const m = await mountContracts(h(SessionFailure, { failure: { title: 'Eadwyn AI was not admitted.', causes: ['x'], retry: 'new-session' }, retryHref: '/validate/record?interview=5' }));
  try {
    assert.equal(by(m, 'session-failure-fallback'), undefined);
    assert.match(m.text(), /Record a session also takes the call’s recording or transcript/);
  } finally { await m.unmount(); }
});
