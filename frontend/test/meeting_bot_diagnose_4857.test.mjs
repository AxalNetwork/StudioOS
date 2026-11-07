// #4857: the console tells a failed check from a report that never arrived. "Not recorded" is never a pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MeetingBotDiagnosePanel, { DiagnosisTable } from '../src/pages/hq/MeetingBotDiagnosePanel.jsx';
import { adminMeetingBotsApi } from '../src/lib/api/adminMeetingBots.js';
import { mountContracts } from './_contracts_dom.mjs';

const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
const row = (stage, result, code, extra = {}) => ({ stage, result, code, facts: {}, fix: null, delivery: 'ok', ...extra });
const diagnosis = (rows, extra = {}) => ({ id: '00000000-0000-4000-8000-000000004857', platform: 'google_meet', created_at: '2026-11-07T00:00:00.000Z', done: true,
  stops_at: null, unrecorded: [], screenshot: false, probe_bytes: null, rows, ...extra });
const quiet = diagnosis([row('site', 'pass', 'bot_host_answered'), row('config', 'pass', 'configured'), row('container', 'pass', 'command_received'),
  row('browser', 'unrecorded', 'never_reported', { delivery: 'not_recorded', fix: 'This step’s report did not arrive. Press Try again.' }),
  row('egress', 'pass', 'hosts_reached', { delivery: 'late', attempts: 2 }), row('join', 'pass', 'asked_to_join'),
  row('admission', 'pass', 'admitted'), row('audio', 'pass', 'chunk_uploaded'), row('last_run', 'skipped', 'no_runs')], { unrecorded: ['browser'] });
const failed = diagnosis([row('site', 'pass', 'bot_host_answered'), row('join', 'fail', 'signin_wall', { fix: 'Allow guests in the call.' })], { stops_at: 'join' });

test('a failed check reads Fail with its fix; a report that did not arrive reads Not recorded and says it is not a failed check', () => {
  const html = renderToStaticMarkup(React.createElement(DiagnosisTable, { diagnosis: quiet }));
  assert.ok(html.includes('data-result="unrecorded"') && html.includes('Not recorded'));
  assert.ok(html.includes('not a failed check'));
  assert.ok(html.includes('Report arrived late, after 2 failed sends'));
  const bad = renderToStaticMarkup(React.createElement(DiagnosisTable, { diagnosis: failed }));
  assert.ok(bad.includes('data-result="fail"') && !bad.includes('Not recorded') && !bad.includes('not a failed check') && !bad.includes('arrived late'));
  // The browser row never shows a pass.
  assert.ok(!/data-stage="browser" data-result="pass"/.test(html));
  assert.ok(!html.includes('undefined') && !html.includes('null'));
});

async function mountWith(result) {
  const original = { ...adminMeetingBotsApi }, sent = [];
  adminMeetingBotsApi.diagnose = async (url) => { sent.push(url); return { diagnosis: structuredClone(result) }; };
  const m = await mountContracts(React.createElement(MeetingBotDiagnosePanel), '/admin/platform/meeting-bots');
  const input = m.nodes().find((n) => n.tagName === 'INPUT');
  await act(async () => m.props(input).onChange({ target: { value: 'https://meet.google.com/abc-defg-hij' } }));
  const submit = async () => { await act(async () => m.props(m.nodes().find((n) => n.tagName === 'FORM')).onSubmit({ preventDefault() {} })); for (let i = 0; i < 4; i++) await m.flush(); };
  await submit();
  const text = () => textOf(m.nodes().find((n) => m.props(n)?.['data-testid'] === 'meeting-bot-diagnose'));
  const tryAgain = () => m.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n) === 'Try again');
  return { m, sent, text, tryAgain, done: async () => { await m.unmount(); Object.assign(adminMeetingBotsApi, original); } };
}

test('unrecorded stages are a delivery failure with Try again, which asks again with the same link; it never says every stage passed', async () => {
  const p = await mountWith(quiet);
  try {
    const text = p.text();
    assert.ok(text.includes('No stage failed, but not every result was recorded.'));
    assert.ok(!text.includes('Every stage passed') && !text.includes('Stops at'));
    assert.ok(text.includes('Not recorded: The browser launches.'));
    assert.ok(text.includes('That is a reporting problem, not a failed check.'));
    assert.ok(p.tryAgain());
    await act(async () => p.m.props(p.tryAgain()).onClick());
    for (let i = 0; i < 4; i++) await p.m.flush();
    assert.deepEqual(p.sent, ['https://meet.google.com/abc-defg-hij', 'https://meet.google.com/abc-defg-hij']);
  } finally { await p.done(); }
});

test('a failed check shows where it stops and no delivery warning; a clean run shows neither', async () => {
  const bad = await mountWith(failed);
  try { assert.ok(bad.text().includes('Stops at: Join attempt.')); assert.equal(bad.tryAgain(), undefined); assert.ok(!bad.text().includes('reporting problem')); } finally { await bad.done(); }
  const ok = await mountWith(diagnosis([row('site', 'pass', 'bot_host_answered')]));
  try { assert.ok(ok.text().includes('Every stage passed.')); assert.equal(ok.tryAgain(), undefined); } finally { await ok.done(); }
});
