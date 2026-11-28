// D5814: the owner's diagnostic panel on a Teams result: Teams' notice row in order, when each stage ran, and where it stops.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MeetingBotDiagnosePanel, { DiagnosisTable } from '../src/pages/hq/MeetingBotDiagnosePanel.jsx';
import { adminMeetingBotsApi } from '../src/lib/api/adminMeetingBots.js';
import { mountContracts } from './_contracts_dom.mjs';

const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
const row = (stage, result, code, extra = {}) => ({ stage, result, code, facts: {}, fix: null, delivery: 'ok', ...extra });
const teams = (rows, extra = {}) => ({ id: '00000000-0000-4000-8000-000000005814', platform: 'teams', created_at: '2026-11-28T00:00:00.000Z', done: true,
  stops_at: null, unrecorded: [], screenshot: false, probe_bytes: null, rows, ...extra });
const denied = teams([row('site', 'pass', 'bot_host_answered', { facts: { version: 'a1b2c3d4e5f6' } }),
  row('config', 'pass', 'configured', { facts: { teams_switch: 'off', link_kind: 'personal', link_host: 'teams.live.com' } }),
  row('container', 'pass', 'command_received', { elapsed_s: 2 }), row('browser', 'pass', 'launched', { elapsed_s: 4 }),
  row('egress', 'pass', 'hosts_reached', { elapsed_s: 4, facts: { 'teams.microsoft.com': 302, 'teams.cloud.microsoft': 302, 'teams.live.com': 302 } }),
  row('join', 'pass', 'asked_to_join', { elapsed_s: 19, facts: { link_kind: 'personal' } }),
  row('admission', 'fail', 'not_admitted', { elapsed_s: 47, facts: { step: 'teams_denied' }, fix: 'The host denied the request. Admit Eadwyn AI when it asks.' }),
  row('notice', 'skipped', 'not_admitted', { elapsed_s: 47 }), row('audio', 'skipped', 'not_admitted', { elapsed_s: 47 }), row('last_run', 'skipped', 'no_runs')],
{ stops_at: 'admission', screenshot: true });

test('a Teams table names the notice between admission and audio, the link’s kind, and when each stage ran', () => {
  const html = renderToStaticMarkup(React.createElement(DiagnosisTable, { diagnosis: denied }));
  const order = ['The site reaches the bot', 'Google, Zoom or Teams setup', 'Egress to the meeting hosts', 'Join attempt', 'Admission', 'Recording notice in the chat', 'Audio frames and first chunk', 'Your last real run'];
  let at = -1;
  for (const name of order) { const next = html.indexOf(name); assert.ok(next > at, name); at = next; }
  for (const phrase of ['teams_denied', 'personal', 'teams.cloud.microsoft', 'after 47 s', 'after 19 s', 'Admit Eadwyn AI when it asks.']) assert.ok(html.includes(phrase), phrase);
  // The Worker's own rows carry no time; only the container's do.
  assert.ok(!/data-stage="site"[^]*?after \d+ s[^]*?data-stage="config"/.test(html));
  assert.ok(!html.includes('undefined') && !html.includes('null') && !html.includes('NaN'));
});

test('the panel takes a Teams link and says where the Teams check stops', async () => {
  const original = { ...adminMeetingBotsApi }, sent = [];
  adminMeetingBotsApi.diagnose = async (url) => { sent.push(url); return { diagnosis: structuredClone(denied) }; };
  adminMeetingBotsApi.diagnosisScreenshot = async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
  const m = await mountContracts(React.createElement(MeetingBotDiagnosePanel), '/admin/platform/meeting-bots');
  try {
    const intro = textOf(m.nodes().find((n) => m.props(n)?.['data-testid'] === 'meeting-bot-diagnose'));
    assert.ok(intro.includes('Microsoft Teams') && intro.includes('posts its recording notice in the chat before it listens'));
    const input = m.nodes().find((n) => n.tagName === 'INPUT');
    assert.equal(m.props(input).placeholder, 'Google Meet, Zoom or Teams');
    await act(async () => m.props(input).onChange({ target: { value: ' https://teams.live.com/meet/synthetic5814 ' } }));
    await act(async () => m.props(m.nodes().find((n) => n.tagName === 'FORM')).onSubmit({ preventDefault() {} }));
    for (let i = 0; i < 4; i++) await m.flush();
    assert.deepEqual(sent, ['https://teams.live.com/meet/synthetic5814']);
    assert.ok(textOf(m.nodes().find((n) => m.props(n)?.['data-testid'] === 'meeting-bot-diagnose')).includes('Stops at: Admission.'));
  } finally { await m.unmount(); Object.assign(adminMeetingBotsApi, original); }
});
