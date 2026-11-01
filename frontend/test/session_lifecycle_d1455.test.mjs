/**
 * D1455 (#3710) — the session page's one status (REC1, REC6), its one failure
 * panel (REC2) and its cost as money (REC5).
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/session_lifecycle_d1455.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { STEPS, failureView, lifecycle, money, stepLine } from '../src/pages/founder/sessionLifecycle.js';
import { SessionFailure, SessionStepper } from '../src/pages/founder/SessionLifecycle.jsx';

const h = React.createElement;
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const states = (v) => Object.fromEntries(v.steps.map((s) => [s.key, s.state]));

test('REC1: a bot call has nine steps; a session without a bot starts at Recording', () => {
  assert.deepEqual(STEPS.map((s) => s.label), ['Scheduled', 'Joining', 'Waiting to be admitted', 'Recording', 'Uploading', 'Transcribing', 'Summarising', 'Placing', 'Ready']);
  assert.equal(lifecycle({ bot: { status: 'queued' } }).steps.length, 9);
  assert.deepEqual(lifecycle({ session: { status: 'recording' } }).steps.map((s) => s.key), ['recording', 'uploading', 'transcribing', 'summarising', 'placing', 'ready']);
});

test('REC1: each bot status and processing stage is one current step, earlier steps done, later ones to do', () => {
  for (const [status, step] of [['queued', 'scheduled'], ['joining', 'joining'], ['waiting_room', 'waiting'], ['recording', 'recording']]) {
    const v = lifecycle({ bot: { status } });
    assert.equal(v.current, step, status);
    assert.equal(states(v)[step], 'current');
    assert.equal(v.failed, false);
  }
  const t = lifecycle({ bot: { status: 'processing' }, processing: { stage: 'transcribing' } });
  assert.equal(t.current, 'transcribing');
  assert.deepEqual([states(t).recording, states(t).uploading, states(t).transcribing, states(t).placing], ['done', 'done', 'current', 'todo']);
  const ready = lifecycle({ bot: { status: 'done' }, processing: { stage: 'done' } });
  assert.equal(ready.current, 'ready');
  assert.equal(states(ready).ready, 'done');
  assert.equal(lifecycle({ session: { status: 'reviewed' } }).current, 'ready', 'a reviewed session with no processing read is Ready');
});

test('REC1: a bot failure marks the step its code belongs to; an unknown code fails at Joining', () => {
  const at = (code) => lifecycle({ bot: { status: 'failed', failure_code: code } });
  assert.equal(at('not_admitted').failedAt, 'waiting');
  assert.equal(at('admission_refused').failedAt, 'waiting');
  assert.equal(at('schedule_missed').failedAt, 'scheduled');
  assert.equal(at('meeting_ended').failedAt, 'recording');
  assert.equal(at('no_audio').failedAt, 'recording');
  assert.equal(at('link_invalid').failedAt, 'joining');
  assert.equal(at('something_new').failedAt, 'joining');
  assert.equal(at('toString').failedAt, 'joining', 'an inherited key is no code');
  const v = at('not_admitted');
  assert.deepEqual([v.kind, states(v).joining, states(v).waiting, states(v).recording], ['bot', 'done', 'failed', 'todo']);
});

test('REC1, W2: a failed processing run marks failed_stage when the Worker sends it, and marks no step when it does not', () => {
  const marked = lifecycle({ session: { status: 'stopped' }, processing: { stage: 'failed', failed_stage: 'summarising' } });
  assert.deepEqual([marked.kind, marked.failedAt, states(marked).summarising, states(marked).transcribing], ['processing', 'summarising', 'failed', 'done']);
  const unmarked = lifecycle({ session: { status: 'stopped' }, processing: { stage: 'failed' } });
  assert.equal(unmarked.failed, true);
  assert.equal(unmarked.failedAt, null, 'never guessed from the sentence');
  assert.ok(unmarked.steps.every((s) => s.state === 'todo'));
  assert.equal(stepLine(unmarked), 'Failed at a step not recorded');
  assert.equal(lifecycle({ processing: { stage: 'failed', failed_stage: 'shredding' } }).failedAt, null, 'a stage the page does not know is not marked');
});

test('REC1: an unknown status is Unreadable, never Ready', () => {
  for (const input of [{ bot: { status: 'unreadable' } }, { bot: { status: 'teleporting' } }, { session: { status: 'draft' } }, {}]) {
    const v = lifecycle(input);
    assert.equal(v.unreadable, true, JSON.stringify(input));
    assert.notEqual(v.current, 'ready');
    assert.equal(stepLine(v), 'Unreadable');
  }
  // An unreadable bot read still shows a processing stage that was read.
  assert.equal(lifecycle({ bot: { status: 'unreadable' }, processing: { stage: 'placing' } }).current, 'placing');
});

test('REC6: on a phone the stepper reads "n of m · step"', () => {
  assert.equal(stepLine(lifecycle({ bot: { status: 'recording' } })), '4 of 9 · Recording');
  assert.equal(stepLine(lifecycle({ bot: { status: 'failed', failure_code: 'not_admitted' } })), '3 of 9 · Waiting to be admitted · failed');
  assert.equal(stepLine(lifecycle({ session: { status: 'recording' } })), '1 of 6 · Recording');
});

test('REC2: one failure in plain words, its causes, and the right Try again', () => {
  const bot = lifecycle({ bot: { status: 'failed', failure_code: 'not_admitted' } });
  const f = failureView(bot, { botFailure: 'Eadwyn AI was not admitted. Ask the host to check the waiting room.' });
  assert.equal(f.title, 'Eadwyn AI was not admitted. Ask the host to check the waiting room.');
  assert.equal(f.retry, 'new-session', 'a failed join opens a fresh session (the Worker refuses session_in_use)');
  assert.ok(f.causes.length > 0);
  const proc = failureView(lifecycle({ processing: { stage: 'failed', failed_stage: 'transcribing' } }), {});
  assert.deepEqual([proc.title, proc.retry], ['Processing stopped. Your audio is safe.', 'process']);
  assert.equal(failureView(lifecycle({ processing: { stage: 'failed' } }), { processingError: 'Transcribing stopped unexpectedly.' }).title, 'Transcribing stopped unexpectedly.');
  assert.equal(failureView(lifecycle({ bot: { status: 'recording' } })), null, 'nothing failed, no panel');
});

test('REC2: the panel draws Try again as a press for processing and as a new session for a bot; codes only under See details', () => {
  const proc = html(h(SessionFailure, { failure: { title: 'Processing stopped. Your audio is safe.', causes: [], retry: 'process' }, retryHref: '/validate/record?interview=5', details: [['Processing', 'failed'], ['Failed at', 'transcribing']], onRetry() {} }));
  assert.match(proc, /<button[^>]*data-testid="session-failure-retry"[^>]*>Try again</);
  assert.match(proc, /session-failure-import/);
  assert.match(proc, /<summary[^>]*>See details<\/summary>[\s\S]*transcribing/);
  const bot = html(h(SessionFailure, { failure: { title: 'Eadwyn AI was not admitted.', causes: ['Nobody admitted Eadwyn AI from the lobby'], retry: 'new-session' }, retryHref: '/validate/record?interview=5' }));
  assert.match(bot, /<a[^>]*data-testid="session-failure-retry"[^>]*>Try again with a new session</);
  assert.match(bot, /data-testid="session-failure-retry" href="\/validate\/record\?interview=5"/);
  assert.doesNotMatch(bot, /session-failure-import/, 'one link, not two to the same place');
  assert.match(bot, /Nobody admitted Eadwyn AI from the lobby/);
  assert.equal(html(h(SessionFailure, { failure: null })), '');
});

test('REC1: the stepper marks the current and the failed step for the eye and for a reader', () => {
  const out = html(h(SessionStepper, { view: lifecycle({ bot: { status: 'recording' } }) }));
  assert.match(out, /data-current="recording"/);
  assert.match(out, /data-step="recording" data-state="current" aria-current="step"/);
  const failed = html(h(SessionStepper, { view: lifecycle({ processing: { stage: 'failed' } }) }));
  assert.match(failed, /data-failed="unrecorded"/);
  assert.match(html(h(SessionStepper, { view: lifecycle({}) })), /Unreadable: this session’s status could not be read/);
});

test('REC5: money in two decimals, the full value kept; null is not money, and a sub-cent charge is never $0.00', () => {
  assert.deepEqual(money(420_000), { text: '$0.42', full: '$0.4200' });
  assert.deepEqual(money(49_570_000), { text: '$49.57', full: '$49.5700' });
  assert.deepEqual(money(0), { text: '$0.00', full: '$0.0000' });
  assert.deepEqual(money(1_500), { text: '< $0.01', full: '$0.0015' });
  for (const bad of [null, undefined, '', 'x', Number.NaN]) assert.equal(money(bad), null, String(bad));
});

test('REC2, REC5: the session page wires one panel, hides the bot card\'s red line, and says "Nothing was charged" for an empty receipt', () => {
  const page = readFileSync(new URL('../src/pages/founder/InterviewSessionPage.jsx', import.meta.url), 'utf8');
  assert.match(page, /<SessionStepper view=\{life\} \/>/);
  assert.match(page, /<SessionFailure failure=\{failure\}/);
  assert.match(page, /<MeetingBotPanel [^>]*onRead=\{setBotRead\} hideFailure \/>/);
  assert.match(page, /\(recordingOther \|\| imported\) && !failure &&/, 'the separate "Processing stopped" card is not drawn beside the panel');
  assert.match(page, /Nothing was charged for this session\./);
  assert.match(page, /onClick=\{runAgain\}|onRetry=\{runAgain\}/);
  assert.match(page, /api\.process\(session\.id\)/);
  assert.match(page, /const failure = life && !recordingOther \?/, '#1588: no Try again while this tab records another session');
});
