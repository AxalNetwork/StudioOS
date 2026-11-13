/**
 * D778 part 6 (#2103) — the founder's transcriptions name their option on the
 * press: `transcribe:recording` (an interview's attached recording, and a
 * stopped session's Transcribe) and `transcribe:voice-answer` (the Studio
 * mic). Each sends `X-Rail-Option` with the run itself, keeping the mounted
 * rail's page, rather than waiting for the busy render to hand the option to
 * the rail. `transcribe:session` runs in the processing job, which has no
 * request: the Worker names it (`founder_transcribe_d778.test.ts`).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/founder_transcribe_d778.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import { interviewSessionsApi } from '../src/lib/api/interviewSessions.js';
import { clearRailPage, railPressHeaders, setRailPage } from '../src/lib/railPage.js';
import InterviewRecording from '../src/workspaces/founder/InterviewRecording.jsx';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('Transcribe on an interview\'s recording sends its own option with the run, keeping the mounted rail\'s page', async () => {
  // Mutation checked: drop the press headers → the request carries no option.
  for (const mounted of [null, 'validate']) {
    const token = mounted ? setRailPage(mounted, 'draft:old') : null;
    const restore = installDocument();
    const orig = api.transcribeInterview;
    const calls = [];
    api.transcribeInterview = async (...args) => { calls.push(args); return { transcript: 'We reconcile by hand.', usage: null }; };
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(React.createElement(InterviewRecording, { interview: { id: 31, recording_r2_key: 'validate-audio/x.webm', transcript: null }, fillsOn: true }));
      });
      const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
      const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
      const button = walk(container).find((n) => props(n)['data-testid'] === 'action-transcribe-31');
      assert.ok(button, 'the Transcribe press is drawn');
      await act(async () => { await props(button).onClick(); });
      assert.equal(calls.length, 1);
      assert.equal(calls[0][0], 31);
      assert.equal(calls[0][1]['X-Rail-Option'], encodeURIComponent('transcribe:recording'));
      assert.equal(calls[0][1]['X-Rail-Page'], mounted || undefined, 'the mounted page holds the Manual switch; with none the Worker names the inventory\'s');
    } finally {
      await act(async () => root.unmount());
      api.transcribeInterview = orig;
      restore();
      if (token) clearRailPage(token);
    }
  }
});

test('a stopped session\'s Transcribe and the Studio mic name their options on the request itself', () => {
  // Mutation checked: drop either page's press headers → its pin fails.
  assert.match(read('pages/founder/InterviewSessionPage.jsx'),
    /await api\.transcribe\(session\.id, session\.final_model, railPressHeaders\('transcribe:recording'\)\)/);
  assert.match(read('components/advisor/PersonalAdvisor.jsx'),
    /await api\.advisor\.transcribe\(b64, mime, railPressHeaders\('transcribe:voice-answer'\)\)/);
});

test('the three existing API methods send the press\'s headers on the request itself', async () => {
  // Mutation checked: drop `headers` from any of the three → its request carries no option.
  const restore = installDocument();
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push({ url: String(url), init }); return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    await api.transcribeInterview(31, railPressHeaders('transcribe:recording'));
    await interviewSessionsApi.transcribe(5, 'model-x', railPressHeaders('transcribe:recording'));
    await api.advisor.transcribe('AAAA', 'audio/webm', railPressHeaders('transcribe:voice-answer'));
    const by = (end) => seen.find((s) => s.url.endsWith(end));
    assert.equal(by('/interviews/31/transcribe').init.headers['X-Rail-Option'], 'transcribe%3Arecording');
    const session = by('/sessions/5/transcribe');
    assert.equal(session.init.headers['X-Rail-Option'], 'transcribe%3Arecording');
    assert.deepEqual(JSON.parse(session.init.body), { model: 'model-x' });
    const mic = by('/advisor/transcribe');
    assert.equal(mic.init.headers['X-Rail-Option'], 'transcribe%3Avoice-answer');
    assert.deepEqual(JSON.parse(mic.init.body), { audio: 'AAAA', mime: 'audio/webm' });
  } finally { globalThis.fetch = realFetch; restore(); }
});
