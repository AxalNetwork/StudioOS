// D4493 (#4493): the sequence builder's pills, fixed blocked reasons, no SMS step, no AI voice, the hold line, drafts that only the pressed Send sends, and no "Fill" text.
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/distribution_sequences_4493.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { mountContracts } from './_contracts_dom.mjs';
import SequenceBuilder, { SequenceNeedsYouRow } from '../src/pages/cycles/distribution/SequenceBuilder.jsx';
import ConsentByStep from '../src/pages/cycles/distribution/ConsentByStep.jsx';
import { AI_VOICE, BLOCKED_STEPS, NO_SMS, consentCaption, consentPill, dueButton, dueCount, sequenceHoldLine, sequenceSubtitle, stepPill } from '../src/pages/cycles/distribution/sequenceModel.js';

const h = React.createElement;
const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
const button = (ui, label) => ui.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === label);
const flat = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const LINE = 'To stop these emails, open: https://app.example.test/api/grow/optout/token';
const steps = [
  { position: 1, channel: 'email', wait_days: 0, subject: 'Late shipments', body: 'You said a late shipment costs a day a week.', recording: null, blocked_reason: null, updated_at: 'a' },
  { position: 2, channel: 'linkedin', wait_days: 3, subject: null, body: 'Following up on my note', recording: null, blocked_reason: 'Needs LinkedIn’s approval.', updated_at: 'a' },
  { position: 3, channel: 'voice', wait_days: 4, subject: 'A quick note', body: '', recording: { seconds: 24 }, blocked_reason: null, updated_at: 'a' },
  { position: 4, channel: 'whatsapp', wait_days: 5, subject: null, body: 'x', recording: null, blocked_reason: 'Only to contacts who wrote first or opted in · after counsel’s review.', updated_at: 'a' },
];
const consent = (email, voice) => [{ position: 1, channel: 'email', basis: email }, { position: 2, channel: 'linkedin', basis: 'blocked' }, { position: 3, channel: 'voice', basis: voice }, { position: 4, channel: 'whatsapp', basis: 'blocked' }];
const enrolments = [
  { enrolment_uid: 'e1', sequence_uid: 's1', contact_uid: 'c1', contact_name: 'Prospect A', position: 1, channel: 'email', state: 'due', reason: null, skipped: [], consent: consent('opted_in', 'opted_in') },
  { enrolment_uid: 'e2', sequence_uid: 's1', contact_uid: 'c2', contact_name: 'Prospect D', position: 1, channel: 'email', state: 'waiting', reason: 'If no reply in 3 days', skipped: [], consent: consent('wrote_first', 'none') },
  { enrolment_uid: 'e3', sequence_uid: 's1', contact_uid: 'c3', contact_name: 'Prospect I', position: null, channel: null, state: 'blocked', reason: 'Not sent: Prospect I has no consent recorded for email. The step was skipped.', skipped: [], consent: consent('none', 'none') },
];
const detail = { sequence: { uid: 's1', name: 'Ops leads outreach', state: 'active' }, steps, enrolments, counts: { enrolled: 3, due: 1, stopped: 0 }, quiet_hours: { quiet_from: '20:00', quiet_to: '08:00' }, suppressions: 14 };
function fakes(over = {}) {
  const calls = [];
  const api = {
    list: async () => ({ sequences: [{ uid: 's1', name: 'Ops leads outreach' }] }),
    get: async () => detail,
    due: async () => ({ rows: enrolments.map(({ consent: _c, ...r }) => r) }),
    draft: async (...a) => { calls.push(['draft', ...a]); return { draft: { uid: 'd'.repeat(32), to: 'prospect-a@example.test', name: 'Prospect A', subject: 'Late shipments', body: `Hello\n\n${LINE}`, required_line: LINE, attachment: null } }; },
    ...over.api,
  };
  const askApi = {
    quote: async () => ({ estimate: { hold_microusd: 60000, model: 'm' }, sources: [] }),
    run: async (b) => { calls.push(['run', b]); return { proposals: [{ uid: 'p1', status: 'proposed', payload: { kind: 'sequence', values: { name: 'Sign-ups who went furthest', steps: [{ subject: 'Setup', body: 'You said setup takes weeks.', wait_days: 0 }] } } }] }; },
    decide: async (uid, b) => { calls.push(['decide', uid, b]); return { proposal: {} }; },
    ...over.askApi,
  };
  const mail = { accounts: async () => ({ accounts: [{ uid: 'm1', status: 'active', address: 'me@example.test' }] }), confirmSend: async () => { calls.push(['confirm']); return { nonce: 'n' }; }, send: async (b) => { calls.push(['send', b]); return { sent: { uid: 'x' } }; } };
  const prospects = { list: async () => ({ columns: [{ cards: [{ uid: 'c1', name: 'Prospect A' }] }] }) };
  return { calls, api, askApi, mail, prospects };
}

test('the model keeps the fixed copy: consent pills, blocked reasons, no SMS step, no AI voice and the hold line', () => {
  assert.deepEqual(['opted_in', 'wrote_first', 'none'].map((b) => consentPill(b).label), ['Opted in', 'Wrote first', 'No consent']);
  assert.deepEqual(BLOCKED_STEPS.map((b) => [b.channel, b.reason]), [['linkedin', 'Needs LinkedIn’s approval.'], ['whatsapp', 'Only to contacts who wrote first or opted in · after counsel’s review.'], ['telegram', 'Only to contacts who wrote first or opted in · after counsel’s review.']]);
  assert.equal(NO_SMS, 'There is no SMS step.');
  assert.equal(AI_VOICE, 'Not offered');
  assert.equal(stepPill({ channel: 'email' }).label, 'Consent: email');
  assert.equal(stepPill({ channel: 'whatsapp' }).label, 'Blocked · no consent');
  assert.equal(sequenceHoldLine({ hold_microusd: 60000 }), 'Holds up to $0.06 · you pay what it uses · an AI voice is always disclosed in the message');
  assert.match(sequenceHoldLine(null), /^Hold not recorded/);
  assert.equal(sequenceSubtitle(detail), 'Quiet hours 20:00–08:00 · suppression list 14 · one-click opt-out in every message');
  assert.equal(sequenceSubtitle({}), 'Quiet hours: Not recorded · suppression list: Not recorded · one-click opt-out in every message');
  assert.equal(dueCount(null), null, 'an unreadable due read is never zero');
  assert.equal(dueButton(2), '2 steps due · Review and send');
  assert.deepEqual(consentCaption(enrolments, steps), ['Prospect D gets no voice note: no consent to a voice note was recorded.', 'Prospect I is skipped: no consent to email was recorded.']);
});

test('the builder draws the pills, blocked steps with their reasons, the SMS line, AI voice Not offered and no "Fill"', async () => {
  const f = fakes(); let ui;
  try {
    ui = await mountContracts(h(SequenceBuilder, { projectId: 7, canWrite: true, api: f.api, askApi: f.askApi, mail: f.mail, prospects: f.prospects }), '/grow/distribution/prospects', { id: 1, role: 'founder' });
    for (let i = 0; i < 4; i++) await ui.flush();
    const text = ui.text();
    for (const s of ['Sequence · Ops leads outreach', 'Quiet hours 20:00–08:00 · suppression list 14 · one-click opt-out in every message', '3 prospects · stops when someone replies or opts out.',
      'Consent: email', 'Blocked · needs approval', 'Blocked · no consent', 'Needs LinkedIn’s approval.', 'Only to contacts who wrote first or opted in · after counsel’s review.',
      'There is no SMS step.', 'AI voice · disclosed', 'Not offered', 'Your own recording', '0:24', 'Preview', 'From your own mailbox · up to 20 sends an hour',
      '1 step due · Review and send', 'Ask Eadwyn for a sequence', 'Consent by step', 'A step on a channel without consent is blocked, with its reason.',
      'Opted in', 'Wrote first', 'No consent', 'Prospect I is skipped: no consent to email was recorded.', 'Not sent: Prospect I has no consent recorded for email. The step was skipped.']) {
      assert.ok(text.includes(s), `missing: ${s}`);
    }
    assert.doesNotMatch(text, /\bFill\b/);
    assert.doesNotMatch(text, /text-to-speech/i);
    // The blocked channels cannot be added.
    for (const label of ['LinkedIn message', 'WhatsApp', 'Telegram']) assert.equal(ui.props(button(ui, label)).disabled, true, label);
    assert.ok(!ui.nodes().some((n) => n.tagName === 'BUTTON' && /SMS/.test(textOf(n))), 'no SMS step can be pressed');
    // A due step becomes a draft; nothing sends until the confirmed press.
    await ui.click('1 step due · Review and send'); await ui.flush();
    await ui.click('Review and send'); for (let i = 0; i < 3; i++) await ui.flush();
    assert.deepEqual(f.calls.filter((c) => c[0] === 'draft'), [['draft', 'e1', 7]]);
    assert.ok(!f.calls.some((c) => c[0] === 'send' || c[0] === 'confirm'));
    await ui.click('Send'); await ui.flush();
    assert.ok(!f.calls.some((c) => c[0] === 'send'), 'Send only opens the confirmation');
    await ui.click('Send email'); for (let i = 0; i < 3; i++) await ui.flush();
    const sent = f.calls.find((c) => c[0] === 'send')[1];
    assert.equal(sent.draft_uid, 'd'.repeat(32)); assert.equal(sent.to, 'prospect-a@example.test'); assert.ok(sent.body.includes(LINE));
    assert.equal(f.calls.filter((c) => c[0] === 'send').length, 1);
  } finally { await ui?.unmount(); }
});

test('Ask Eadwyn for a sequence quotes the hold line, and Accept creates a draft sequence through the drafting task', async () => {
  const f = fakes(); let ui; let lists = 0;
  f.api.list = async () => { lists += 1; return { sequences: [{ uid: 's1', name: 'Ops leads outreach' }] }; };
  try {
    ui = await mountContracts(h(SequenceBuilder, { projectId: 7, canWrite: true, api: f.api, askApi: f.askApi, mail: f.mail, prospects: f.prospects }), '/grow/distribution/prospects', { id: 1, role: 'founder' });
    for (let i = 0; i < 4; i++) await ui.flush();
    await ui.click('Ask Eadwyn for a sequence'); for (let i = 0; i < 3; i++) await ui.flush();
    assert.ok(ui.text().includes('Holds up to $0.06 · you pay what it uses · an AI voice is always disclosed in the message'));
    await ui.click('Draft the sequence');
    for (let i = 0; i < 3; i++) await ui.flush();
    assert.deepEqual(f.calls.find((c) => c[0] === 'run')[1].kinds, ['sequence']);
    assert.ok(ui.text().includes('Accept sequence · proposal'));
    assert.ok(ui.text().includes('You said setup takes weeks.'));
    const before = lists;
    await ui.click('Accept'); for (let i = 0; i < 3; i++) await ui.flush();
    assert.deepEqual(f.calls.find((c) => c[0] === 'decide').slice(1), ['p1', { project: 7, decision: 'accept' }]);
    assert.ok(lists > before, 'the list is read again after Accept');
    assert.doesNotMatch(ui.text(), /\bFill\b/);
  } finally { await ui?.unmount(); }
});

test('a reader cannot write, Needs-you counts only real due rows, and every new component is dark-mode and 44px', async () => {
  const f = fakes(); let ui;
  try {
    ui = await mountContracts(h(SequenceBuilder, { projectId: 7, canWrite: false, api: f.api, askApi: f.askApi, mail: f.mail, prospects: f.prospects }), '/grow/distribution/prospects', { id: 1, role: 'founder' });
    for (let i = 0; i < 4; i++) await ui.flush();
    for (const label of ['Ask Eadwyn for a sequence', 'Pause', 'Add email step', 'Add voice note step']) assert.equal(ui.props(button(ui, label)).disabled, true, label);
  } finally { await ui?.unmount(); }
  const row = (reading) => flat(renderToStaticMarkup(h(MemoryRouter, null, h(SequenceNeedsYouRow, { reading, search: '?project_id=7' }))));
  assert.match(row({ state: 'ready', rows: [{ state: 'due' }, { state: 'due' }, { state: 'held' }] }), /Sequence · 2 steps are due/);
  assert.equal(row({ state: 'ready', rows: [] }), '');
  assert.match(row({ state: 'unreadable', rows: null }), /Unreadable: due sequence steps could not be counted/);
  const table = renderToStaticMarkup(h(ConsentByStep, { steps, enrolments }));
  assert.match(flat(table), /Prospect Email 1 LinkedIn message 1 Voice note 1 WhatsApp 1/);
  for (const file of ['SequenceBuilder.jsx', 'ConsentByStep.jsx']) {
    const src = readFileSync(new URL(`../src/pages/cycles/distribution/${file}`, import.meta.url), 'utf8');
    assert.match(src, /dark:/, file);
    assert.doesNotMatch(src, /\bFill\b|window\.(alert|confirm|prompt)|\balert\(|advis/i, file);
  }
  const builder = readFileSync(new URL('../src/pages/cycles/distribution/SequenceBuilder.jsx', import.meta.url), 'utf8');
  assert.match(builder, /min-h-\[44px\]/);
  assert.match(builder, /useDistributionState/);
  assert.doesNotMatch(builder, /speechSynthesis|tts|MeloTTS/i);
  // The retired band is gone from the route; its rail row moved to the drafting task's row.
  const route = readFileSync(new URL('../src/pages/cycles/CycleRoute.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(route, /surface: 'grow\/customers'|accept: 'Accept sequence'/);
  const rail = readFileSync(new URL('../src/lib/railOptions/founder.js', import.meta.url), 'utf8');
  assert.match(rail, /key: 'draft:grow\/customers', route: '\/grow\/distribution\/prospects', label: 'Ask Eadwyn for a sequence'[^\n]*\n\s*at: \[\['frontend\/src\/pages\/cycles\/distribution\/SequenceBuilder\.jsx', 'askApi\.run\('\]\]/);
});
