/** #7587: a failed Start releases the mic, preserves saved chunks and offers the existing session; no automatic write or paid retry.
 *
 * From frontend/test/README.md (moved by #6472): D7587: recording Start recovery, microphone
 * release, preserved queued audio and explicit session navigation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createRecorder, startRefused } from '../src/lib/activeRecording.js';
import { memoryQueue } from '../src/lib/interviewCapture.js';
import RecordingView from '../src/pages/founder/RecordingView.jsx';
import { installDocument } from './_contracts_dom.mjs';
const sentence = 'The recording could not start. Return to the session and try again.';

test('generic start failures explain recovery; real consent/session-active refusals retain their fields', () => {
  for (const message of ['Request failed', 'Internal server error', 'Internal Server Error', '']) {
    assert.deepEqual(startRefused(new Error(message)), { text: sentence, sessionId: null });
  }
  assert.deepEqual(startRefused({ message: 'Record consent first.', data: { session_id: 99 } }), { text: 'Record consent first.', sessionId: null });
  assert.deepEqual(startRefused({ message: 'Already recording.', code: 'session_active', data: { session_id: 99 } }), { text: 'Already recording.', sessionId: 99 });
});

test('a refused Start stops only its microphone and keeps local audio for the same session', async () => {
  let stopped = 0, posted = 0;
  const track = { kind: 'audio', stop() { stopped++; }, addEventListener() {} };
  const queue = memoryQueue();
  await queue.put({ sessionId: 7, seq: 0, blob: new Blob(['synthetic audio']) });
  const recorder = createRecorder({ queue, browser: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) },
    api: { action: async (id, action) => { assert.deepEqual([id, action], [7, 'start']); posted++; throw Error('Request failed'); } } });
  assert.equal(await recorder.begin({ session: { id: 7, status: 'draft', channel: 'in_person' } }), 'refused');
  const state = recorder.getSnapshot();
  assert.equal(state.error, sentence);
  assert.deepEqual(state.refused, { text: sentence, sessionId: null });
  assert.equal(state.session.id, 7);
  assert.equal(recorder.isCapturing(), false);
  assert.ok(stopped > 0);
  assert.equal(posted, 1, 'no automatic retry of an uncertain Start');
  assert.equal((await queue.list(7)).length, 1, 'no saved audio discarded');
});

test('the phone refusal has a working Back to session action; active-session conflicts still lead to the other recording', async () => {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container), opened = [];
  const props = node => Object.entries(node || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const walk = node => [node, ...(node.childNodes || []).flatMap(walk)];
  const by = id => walk(container).find(node => props(node)['data-testid'] === id);
  const st = { phase: 'denied', session: { id: 7, status: 'draft', channel: 'in_person' }, refused: { text: sentence, sessionId: null }, error: sentence };
  const draw = state => act(async () => root.render(React.createElement(RecordingView, { st: state, now: 0, onOpen: href => opened.push(href) })));
  try {
    await draw(st);
    assert.ok(by('button-refused-session'));
    assert.equal(by('recording-error'), undefined, 'the refusal is announced once, in its recovery card');
    assert.equal(by('button-retry-mic'), undefined, 'API refusal is not a microphone denial');
    await act(async () => props(by('button-refused-session')).onClick());
    assert.deepEqual(opened, ['/validate/session/7']);
    await draw({ ...st, refused: { text: 'Already recording.', sessionId: 99 } });
    assert.equal(by('button-refused-session'), undefined);
    await act(async () => props(by('button-refused-live')).onClick());
    assert.equal(opened.at(-1), '/validate/record/live?session=99');
  } finally { await act(async () => root.unmount()); restore(); }
});
