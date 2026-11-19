/**
 * #4645 (D4645-p2) — the sent update shows each ask's reminder round as the
 * Worker recorded it, "Check delivery" resumes that round, and a press whose
 * answer was lost is repeated once with the same key so it finds its round
 * instead of opening a second one. Synthetic data only.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/sent_update_reminders_4645.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { SentUpdateView, reminderLine, reminderOpen, reminderOutcome, pressAskAgain } from '../src/pages/founder/SentUpdatePage.jsx';

const ROUND = {
  reminder_uid: 'round-1', asked_again_at: '2026-11-18T09:00:00Z', recipients: 4, notified: 1, failed: 1,
  unconfirmed: 1, pending: 0, skipped: 1, settled: false, states: { failed: 0, declined: 1 },
};
const SETTLED = { ...ROUND, notified: 3, unconfirmed: 0, failed: 0, skipped: 1, settled: true, states: { failed: 0, declined: 0 } };

const PAGE = {
  uid: 'u1', title: 'October update', sent_at: '2026-10-01T09:00:00Z', sent_to: { investors: 4, team: 0, network: 0 },
  recipients: [], reminders_readable: true,
  asks: [
    { uid: 'a1', kind: 'market', text: 'Spain', replies: [], can_ask_again: false, reminder: ROUND },
    { uid: 'a2', kind: 'hire', text: 'Engineer', replies: [], can_ask_again: true, reminder: null },
  ],
};
const render = (data, extra = {}) => renderToStaticMarkup(React.createElement(MemoryRouter, null,
  React.createElement(SentUpdateView, { data, onAskAgain: () => {}, onCheckReminder: () => {}, ...extra })));

test('a round\'s line says what was recorded, and nothing when there is no round', () => {
  assert.equal(reminderLine(ROUND), 'Asked again 18 Nov · 4 recipients · 1 in their inbox · 1 not confirmed · 1 not delivered · 1 no longer due');
  assert.equal(reminderLine({ ...SETTLED, skipped: 0 }), 'Asked again 18 Nov · 4 recipients · 3 in their inbox');
  assert.equal(reminderLine(null), null);
  assert.equal(reminderLine({ ...ROUND, notified: null }), null, 'a missing count is not drawn as a zero');
});

test('Check delivery is offered while a round has work left or a failure before sending', () => {
  assert.equal(reminderOpen(ROUND), true);
  assert.equal(reminderOpen(SETTLED), false);
  assert.equal(reminderOpen({ ...SETTLED, states: { failed: 1 } }), true);
  const text = renderedText(render(PAGE));
  assert.match(text, /Asked again 18 Nov · 4 recipients · 1 in their inbox · 1 not confirmed/);
  assert.match(text, /Check delivery/);
  assert.match(text, /Send the unconfirmed again/);
  assert.match(text, /not guaranteed exactly once/, 'the page does not promise exactly-once email or push');
  const settled = renderedText(render({ ...PAGE, asks: [{ ...PAGE.asks[0], reminder: SETTLED }] }));
  assert.doesNotMatch(settled, /Check delivery/);
  assert.match(renderedText(render({ ...PAGE, reminders_readable: false })), /Reminder progress: Unreadable/);
});

test('the outcome sentence keeps unconfirmed apart from failed and says nothing is re-sent unasked', () => {
  const s = reminderOutcome({ recipients: 3, notified: 1, failed: 1, unconfirmed: 1, pending: 0, skipped: 0 });
  assert.match(s, /^Recipients: 3\. In-app reminders recorded: 1\. Failed: 1\./);
  assert.match(s, /Not confirmed: 1\..*nothing is sent to them again unless you choose to/);
  assert.equal(reminderOutcome({ recipients: 'x' }), 'Reminder delivery counts are unavailable.');
});

test('a lost answer is repeated once with the same key; a refusal is not repeated; a resume carries no key', async () => {
  const calls = [];
  const lost = { askAgain: async (uid, body) => { calls.push(body); if (calls.length === 1) throw Object.assign(new Error('network'), {}); return { recovered: true }; } };
  assert.deepEqual(await pressAskAgain(lost, 'a1'), { recovered: true });
  assert.equal(calls.length, 2);
  assert.ok(calls[0].request_key && calls[0].request_key.length >= 8);
  assert.equal(calls[1].request_key, calls[0].request_key, 'the repeat finds the same round');

  const refusedCalls = [];
  const refused = { askAgain: async (uid, body) => { refusedCalls.push(body); throw Object.assign(new Error('no'), { status: 409 }); } };
  await assert.rejects(pressAskAgain(refused, 'a1'));
  assert.equal(refusedCalls.length, 1);

  const resumed = [];
  await pressAskAgain({ askAgain: async (uid, body) => { resumed.push(body); return {}; } }, 'a1', { reminder_uid: 'round-1' });
  assert.deepEqual(resumed, [{ reminder_uid: 'round-1' }]);
});
