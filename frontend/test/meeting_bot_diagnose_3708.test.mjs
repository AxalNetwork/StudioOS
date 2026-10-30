// #3708: the owner's diagnostic panel. One link in, one table out: each stage's result, its code, its facts and its fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import MeetingBotDiagnosePanel, { DiagnosisTable } from '../src/pages/hq/MeetingBotDiagnosePanel.jsx';
import { adminMeetingBotsApi } from '../src/lib/api/adminMeetingBots.js';
import { mountContracts } from './_contracts_dom.mjs';

const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
const row = (stage, result, code, extra = {}) => ({ stage, result, code, facts: {}, fix: null, ...extra });
const stopped = {
  id: '00000000-0000-4000-8000-0000000037a8', platform: 'google_meet', created_at: '2026-10-30T00:00:00.000Z', done: true, stops_at: 'join',
  screenshot: true, probe_bytes: null,
  rows: [row('site', 'pass', 'bot_host_answered', { facts: { version: 'a1b2c3d4e5f6' } }), row('config', 'pass', 'configured'), row('container', 'pass', 'command_received'),
    row('browser', 'pass', 'launched'), row('egress', 'pass', 'hosts_reached'),
    row('join', 'fail', 'signin_wall', { facts: { step: 'meet_page_signin' }, fix: 'Allow guests in the call.' }),
    row('admission', 'skipped', 'join_failed'), row('audio', 'skipped', 'join_failed'), row('last_run', 'skipped', 'no_runs')],
};

test('the table names every stage in order, with the failing row’s code, facts and fix', () => {
  const html = renderToStaticMarkup(React.createElement(DiagnosisTable, { diagnosis: stopped }));
  const order = ['The site reaches the bot', 'Google or Zoom setup', 'The container starts', 'The browser launches', 'Egress to the meeting hosts', 'Join attempt', 'Admission', 'Audio frames and first chunk', 'Your last real run'];
  let at = -1;
  for (const name of order) { const next = html.indexOf(name); assert.ok(next > at, name); at = next; }
  for (const phrase of ['signin_wall', 'meet_page_signin', 'Allow guests in the call.', 'a1b2c3d4e5f6']) assert.ok(html.includes(phrase), phrase);
  assert.ok(html.includes('data-result="fail"') && html.includes('data-result="skipped"'));
  assert.ok(!html.includes('undefined') && !html.includes('null'));
});

test('the panel sends only the trimmed link, says where it stops, and shows the owner’s screenshot', async () => {
  const original = { ...adminMeetingBotsApi }, sent = [], shots = [];
  adminMeetingBotsApi.diagnose = async (url) => { sent.push(url); return { diagnosis: structuredClone(stopped) }; };
  adminMeetingBotsApi.diagnosis = async () => { throw new Error('a done diagnostic is not polled'); };
  adminMeetingBotsApi.diagnosisScreenshot = async (id) => { shots.push(id); return new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }); };
  const m = await mountContracts(React.createElement(MeetingBotDiagnosePanel), '/admin/platform/meeting-bots');
  const settle = async () => { for (let i = 0; i < 4; i++) await m.flush(); };
  try {
    await settle();
    const input = m.nodes().find((n) => n.tagName === 'INPUT');
    await act(async () => m.props(input).onChange({ target: { value: '  https://meet.google.com/abc-defg-hij ' } }));
    const form = m.nodes().find((n) => n.tagName === 'FORM');
    await act(async () => m.props(form).onSubmit({ preventDefault() {} })); await settle();
    assert.deepEqual(sent, ['https://meet.google.com/abc-defg-hij']);
    const text = textOf(m.nodes().find((n) => m.props(n)?.['data-testid'] === 'meeting-bot-diagnose'));
    assert.ok(text.includes('Stops at: Join attempt.'));
    assert.deepEqual(shots, [stopped.id]);
    assert.ok(m.nodes().some((n) => n.tagName === 'IMG' && String(m.props(n).src).startsWith('blob:')));
  } finally { await m.unmount(); Object.assign(adminMeetingBotsApi, original); }
});

test('a refused start shows the Worker’s own sentence, and the page mounts the panel once', async () => {
  const original = { ...adminMeetingBotsApi };
  adminMeetingBotsApi.diagnose = async () => { throw new Error('Use a Zoom, Google Meet or Microsoft Teams meeting link.'); };
  const m = await mountContracts(React.createElement(MeetingBotDiagnosePanel), '/admin/platform/meeting-bots');
  try {
    await m.flush();
    const form = m.nodes().find((n) => n.tagName === 'FORM');
    await act(async () => m.props(form).onSubmit({ preventDefault() {} })); await m.flush();
    const alert = m.nodes().find((n) => m.props(n)?.role === 'alert');
    assert.equal(textOf(alert), 'Use a Zoom, Google Meet or Microsoft Teams meeting link.');
  } finally { await m.unmount(); Object.assign(adminMeetingBotsApi, original); }
  const page = readFileSync(new URL('../src/pages/hq/MeetingBotsPage.jsx', import.meta.url), 'utf8');
  assert.equal(page.split('<MeetingBotDiagnosePanel />').length, 2);
  const panel = readFileSync(new URL('../src/pages/hq/MeetingBotDiagnosePanel.jsx', import.meta.url), 'utf8');
  assert.ok(panel.includes('URL.revokeObjectURL'));
});
