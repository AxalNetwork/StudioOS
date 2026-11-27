/**
 * D757 (#1926) — Google Meet transcripts, the screens: what each state of the
 * Calendar status read's `meet_transcripts` says, "Allow transcript import"
 * only when `available` (on the Google Meet card and on Record a session's
 * Schedule panel), the return banners, and the old "cannot import" sentence
 * gone from the source.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/meet_transcripts_d757.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';

import { MeetTranscripts, MeetingChannelCard } from '../src/pages/account/ChannelsGroup.jsx';
import {
  ALLOW_MEET_LABEL, MEET_ENGINE_LINE, MEET_RETURN_WORDS, MEET_TRANSCRIPT_COPY, meetTranscriptsCopy, meetTranscriptsReturn, meetTranscriptsState,
} from '../src/pages/account/channelsModel.js';
import { SchedulePanel } from '../src/pages/founder/InterviewChannels.jsx';

const h = React.createElement;
const OLD = 'Axal cannot import Google Meet transcripts yet';

async function mount(element) {
  const restoreDoc = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, null, element)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join(' ') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byTestId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  return {
    text: () => textOf(container).replace(/\s+/g, ' '),
    textOf: (id) => textOf(byTestId(id)).replace(/\s+/g, ' ').trim(),
    byTestId,
    props,
    flush,
    async click(id) { const n = byTestId(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await props(n).onClick?.({ stopPropagation() {}, preventDefault() {} }); }); await flush(); },
    async unmount() { await act(async () => root.unmount()); restoreDoc(); },
  };
}
const statusApi = (meet, extra = {}) => ({ googleStatus: async () => ({ connected: true, meet_transcripts: meet }), ...extra });

// ------------------------------------------------------------------ the model

test('the state is read from meet_transcripts; anything else is unread, never a "no"', () => {
  for (const s of ['granted', 'available', 'not_set_up']) assert.equal(meetTranscriptsState({ meet_transcripts: s }), s);
  for (const r of [null, undefined, {}, { meet_transcripts: 'missing' }, { meet_transcripts: true }]) assert.equal(meetTranscriptsState(r), null);
});

test('each state says D757 §2.12’s words, the engine sentence always, and the button only when available', () => {
  assert.equal(MEET_TRANSCRIPT_COPY.not_set_up, "Importing Meet transcripts isn't set up on Axal yet. You can still hold the call: use the recorder in Axal during it, or paste the conversation afterwards.");
  assert.equal(MEET_TRANSCRIPT_COPY.available, 'Google Meet calls are scheduled on your Google Calendar connection. Needs a Google Workspace plan with Meet transcripts, and transcripts turned on in the call.');
  assert.equal(MEET_TRANSCRIPT_COPY.granted, 'Meet transcripts are imported into the interview after the call.');
  assert.equal(MEET_ENGINE_LINE, 'Eadwyn writes a draft summary and suggests findings for your Validate modules; you accept each one.');
  assert.equal(ALLOW_MEET_LABEL, 'Allow transcript import');
  for (const s of ['granted', 'available', 'not_set_up', null]) {
    const c = meetTranscriptsCopy(s);
    assert.equal(c.engine, MEET_ENGINE_LINE, String(s));
    assert.equal(c.button, s === 'available', String(s));
    assert.equal(c.line, s ? MEET_TRANSCRIPT_COPY[s] : '', String(s));
  }
});

test('the return banners: a transcript grant, and a grant without the permission; an ordinary connect says nothing', () => {
  assert.equal(meetTranscriptsReturn('?google=connected&meet=granted'), 'Meet transcripts can now be imported.');
  assert.equal(meetTranscriptsReturn('?google=error&reason=meet_scope_missing'), 'Google did not grant transcript access. Try again, and tick the transcript permission.');
  assert.deepEqual(MEET_RETURN_WORDS, { ok: 'Meet transcripts can now be imported.', meet_scope_missing: 'Google did not grant transcript access. Try again, and tick the transcript permission.' });
  for (const s of ['', '?google=connected', '?google=error&reason=access_denied', '?meet=granted', '?google=error&meet=granted', undefined, null]) {
    assert.equal(meetTranscriptsReturn(s), '', String(s));
  }
});

test('the old "cannot import" sentence is gone from frontend/src', () => {
  const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const hits = walk('frontend/src').filter((p) => /\.(jsx?|mjs|md)$/.test(p) && readFileSync(p, 'utf8').includes(OLD));
  assert.deepEqual(hits, []);
});

// ------------------------------------------------------------------ the screens

test('MeetTranscripts offers the button only when available, and it asks Google with its return', async () => {
  for (const s of ['granted', 'not_set_up']) {
    const m = await mount(h(MeetTranscripts, { api: statusApi(s), search: '' }));
    try {
      await m.flush();
      assert.ok(m.byTestId(`meet-transcripts-${s}`), s);
      assert.ok(m.text().includes(MEET_TRANSCRIPT_COPY[s]), s);
      assert.ok(m.text().includes(MEET_ENGINE_LINE), s);
      assert.equal(m.byTestId('button-allow-meet-transcripts'), undefined, s);
    } finally { await m.unmount(); }
  }
  const asked = [];
  const m = await mount(h(MeetTranscripts, { api: statusApi('available', { allowMeetTranscripts: async (r) => { asked.push(r); } }), returnTo: 'record', search: '' }));
  try {
    await m.flush();
    assert.ok(m.text().includes(MEET_TRANSCRIPT_COPY.available));
    assert.equal(m.textOf('button-allow-meet-transcripts'), 'Allow transcript import');
    await m.click('button-allow-meet-transcripts');
    assert.deepEqual(asked, ['record']);
  } finally { await m.unmount(); }
});

test('a refused consent says the Worker’s sentence; an unread status says only the engine sentence', async () => {
  const refused = statusApi('available', { allowMeetTranscripts: async () => { throw new Error("Importing Meet transcripts isn't set up on Axal yet."); } });
  const m = await mount(h(MeetTranscripts, { api: refused, search: '' }));
  try {
    await m.flush();
    await m.click('button-allow-meet-transcripts');
    assert.equal(m.textOf('meet-transcripts-error'), "Importing Meet transcripts isn't set up on Axal yet.");
    assert.equal(m.props(m.byTestId('button-allow-meet-transcripts')).disabled, false, 'it can be pressed again');
  } finally { await m.unmount(); }
  const u = await mount(h(MeetTranscripts, { api: { googleStatus: async () => { throw new Error('down'); } }, search: '' }));
  try {
    await u.flush();
    assert.ok(u.byTestId('meet-transcripts-engine'));
    for (const s of ['granted', 'available', 'not_set_up']) assert.equal(u.byTestId(`meet-transcripts-${s}`), undefined);
    assert.equal(u.byTestId('button-allow-meet-transcripts'), undefined);
  } finally { await u.unmount(); }
});

test('the return banner is drawn from the page’s ?google= return', async () => {
  const m = await mount(h(MeetTranscripts, { api: statusApi('granted'), search: '?google=connected&meet=granted' }));
  try {
    await m.flush();
    assert.equal(m.textOf('meet-transcripts-return'), 'Meet transcripts can now be imported.');
  } finally { await m.unmount(); }
  const x = await mount(h(MeetTranscripts, { api: statusApi('available'), search: '?google=error&reason=meet_scope_missing' }));
  try {
    await x.flush();
    assert.equal(x.textOf('meet-transcripts-return'), 'Google did not grant transcript access. Try again, and tick the transcript permission.');
  } finally { await x.unmount(); }
});

test('the Google Meet card draws it and returns to Connectors; the Zoom card does not', async () => {
  const asked = [];
  const api = statusApi('available', { allowMeetTranscripts: async (r) => { asked.push(r); } });
  const meet = { provider: 'google_meet', state: 'connected', label: 'Connected', tone: 'ok', why: '', account: 'a@example.test', connectorKey: 'google' };
  const m = await mount(h(MeetingChannelCard, { card: meet, api }));
  try {
    await m.flush();
    await m.click('button-allow-meet-transcripts');
    assert.deepEqual(asked, ['integrations']);
  } finally { await m.unmount(); }
  const off = await mount(h(MeetingChannelCard, { card: { ...meet, state: 'unavailable' }, api }));
  try { await off.flush(); assert.equal(off.byTestId('meet-transcripts'), undefined, 'not when Meet is not on here'); } finally { await off.unmount(); }
  const zoom = await mount(h(MeetingChannelCard, { card: { ...meet, provider: 'zoom', connectorKey: 'zoom' }, api }));
  try { await zoom.flush(); assert.equal(zoom.byTestId('meet-transcripts'), undefined); } finally { await zoom.unmount(); }
});

test('the Schedule panel draws it for Meet only, returning to Record a session', async () => {
  const asked = [];
  const api = statusApi('available', {
    meetings: async () => ({ meetings: [], providers: [{ provider: 'zoom', available: true, connected: true }, { provider: 'google_meet', available: true, connected: true }] }),
    allowMeetTranscripts: async (r) => { asked.push(r); },
  });
  const form = (provider) => ({ provider, date: '2099-01-05', time: '10:00', duration: 30, topic: '', consent: 'pre_agreed' });
  const z = await mount(h(SchedulePanel, { interview: { id: 7 }, api, initialForm: form('zoom') }));
  try { await z.flush(); assert.equal(z.byTestId('meet-transcripts'), undefined); } finally { await z.unmount(); }
  const m = await mount(h(SchedulePanel, { interview: { id: 7 }, api, initialForm: form('google_meet') }));
  try {
    await m.flush();
    assert.ok(m.text().includes(MEET_TRANSCRIPT_COPY.available));
    await m.click('button-allow-meet-transcripts');
    assert.deepEqual(asked, ['record']);
  } finally { await m.unmount(); }
});

// ------------------------------------------------------------------ the client

test('allowMeetTranscripts posts to the consent route with its return, then goes to Google’s URL only', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.document ??= { cookie: '' };
  const { allowMeetTranscripts, channelsApi } = await import('../src/lib/api/channels.js');
  const calls = [];
  const orig = globalThis.fetch;
  let answer = { redirect_url: 'https://accounts.google.com/o/oauth2/v2/auth?scope=x' };
  globalThis.fetch = async (url, init = {}) => {
    calls.push([init.method || 'GET', String(url).replace(/^.*\/api/, '')]);
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const went = [];
    await allowMeetTranscripts('record', (u) => went.push(u));
    assert.deepEqual(went, ['https://accounts.google.com/o/oauth2/v2/auth?scope=x']);
    await channelsApi.googleStatus();
    answer = { redirect_url: 'https://evil.example/' };
    await assert.rejects(allowMeetTranscripts('integrations', (u) => went.push(u)), /consent page/);
    assert.equal(went.length, 1, 'never a URL that is not Google’s');
    await assert.rejects(allowMeetTranscripts('elsewhere', () => {}), /Unknown return/);
  } finally { globalThis.fetch = orig; }
  assert.deepEqual(calls, [
    ['POST', '/calendar/google/meet-transcripts/connect?return_to=record'],
    ['GET', '/calendar/google/status'],
    ['POST', '/calendar/google/meet-transcripts/connect?return_to=integrations'],
  ]);
});
