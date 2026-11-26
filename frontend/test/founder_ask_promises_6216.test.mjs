/**
 * #6216 (D6215) — the founder's sent update lists the support recipients
 * promised against each ask, then its Delivered, Withdrawn or Cancelled, and
 * says Unavailable when the promises could not be read. Synthetic data only.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/founder_ask_promises_6216.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { SentUpdateView, promiseLines } from '../src/pages/founder/SentUpdatePage.jsx';

const PROMISE = { investor: 'Investor A', kind: 'customer', promised_at: '2026-11-06', delivered_at: null, withdrawn_at: null, cancelled_at: null };
const PAGE = {
  uid: 'u1', title: 'October update', sent_at: '2026-10-01T09:00:00Z', sent_to: { investors: 2, team: 0, network: 0 },
  recipients: [], reminders_readable: true, promises_readable: true,
  asks: [
    { uid: 'a1', kind: 'customer', text: 'A grocery buyer', replies: [], can_ask_again: false, reminder: null,
      promises: [PROMISE, { ...PROMISE, investor: 'Investor B', kind: 'intro', delivered_at: '2026-11-09' }] },
    { uid: 'a2', kind: 'hire', text: 'A VP Sales', replies: [], can_ask_again: false, reminder: null, promises: [] },
  ],
};
const render = (data) => renderedText(renderToStaticMarkup(React.createElement(MemoryRouter, null,
  React.createElement(SentUpdateView, { data }))));

test('a promise reads "[Investor] promised support · [kind] · [date]", then its later state', () => {
  assert.deepEqual(promiseLines(PROMISE), ['Investor A promised support · Customer · 6 Nov']);
  assert.deepEqual(promiseLines({ ...PROMISE, delivered_at: '2026-11-09' }), ['Investor A promised support · Customer · 6 Nov', 'Delivered 9 Nov']);
  assert.deepEqual(promiseLines({ ...PROMISE, withdrawn_at: '2026-11-10' })[1], 'Withdrawn 10 Nov');
  assert.deepEqual(promiseLines({ ...PROMISE, cancelled_at: '2026-11-11' })[1], 'Cancelled 11 Nov');
  assert.deepEqual(promiseLines({ ...PROMISE, investor: null, kind: 'unknown', promised_at: null }), ['An investor promised support · Other']);
});

test('the author sees each ask’s promises; an ask with none shows no promise row', () => {
  const text = render(PAGE);
  assert.match(text, /A grocery buyer.*Investor A promised support · Customer · 6 Nov.*Investor B promised support · Introduction · 6 Nov.*Delivered 9 Nov.*A VP Sales/s);
  assert.match(text, /Hours and outcome are not shown here/);
  assert.equal((renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(SentUpdateView, { data: PAGE }))).match(/data-testid="sent-promise"/g) || []).length, 2);
  assert.doesNotMatch(text, /Promises against these asks: Unavailable/);
});

test('unreadable promises say Unavailable rather than drawing none; a recipient never sees promises', () => {
  const broken = render({ ...PAGE, promises_readable: false, asks: PAGE.asks.map(({ promises, ...a }) => a) });
  assert.match(broken, /Promises against these asks: Unavailable/);
  assert.doesNotMatch(broken, /promised support/);
  const { recipients, ...recipientView } = PAGE;
  assert.doesNotMatch(render(recipientView), /promised support|Investor A/);
});
