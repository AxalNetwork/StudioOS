/**
 * D513 — coldView, a viewer's reminder day, and a write failure on the book.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { coldView, coldestDays, reminderDue, COLD_AFTER_DAYS } from '../src/lib/networkBook.js';

globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.document ??= { cookie: '', getElementById: () => null };

const { default: InvestorNetworkWorkspace } = await import('../src/pages/investor/InvestorNetworkWorkspace.jsx');

const NOW = Date.parse('2026-10-04T06:00:00.000Z');
const day = (n) => new Date(NOW - n * 86400000).toISOString();

test('coldView keeps only ties past the window, and coldestDays is their oldest', () => {
  const rows = [
    { id: 1, last_interaction_at: day(10), strength_score: 90 },
    { id: 2, last_interaction_at: day(COLD_AFTER_DAYS + 5), strength_score: 90 },
    { id: 3, last_interaction_at: null, strength_score: 10 },
    { id: 4, last_interaction_at: day(COLD_AFTER_DAYS + 40), strength_score: 99 },
  ];
  assert.deepEqual(coldView(rows, NOW).map((r) => r.id), [2, 4]);
  assert.equal(coldestDays(rows, NOW), COLD_AFTER_DAYS + 40);
  assert.equal(coldestDays([{ id: 1, last_interaction_at: day(1) }], NOW), null);
});

test('a date-only reminder is due on the viewer’s calendar day, both sides of UTC', () => {
  const remind = '2026-10-04';
  assert.equal(reminderDue(remind, NOW, 'Asia/Tokyo'), true, 'Tokyo is already on 4 Oct');
  assert.equal(reminderDue(remind, NOW, 'America/Los_Angeles'), false, 'Los Angeles is still on 3 Oct');
  assert.equal(reminderDue('2026-10-04T23:59:59.000Z', NOW, 'Asia/Tokyo'), false, 'an instant is not the calendar day');
});

test('the relationships zone shows a write failure and the coldest tile', () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/network/relationships'] },
    createElement(InvestorNetworkWorkspace, {
      zone: 'relationships',
      embedded: true,
      initialActionError: 'The touch could not be recorded.',
    })));
  assert.match(html, /status-relationship-write/);
  assert.match(html, /The touch could not be recorded/);
  assert.match(html, /tile-coldest/);
  assert.doesNotMatch(html, /introductions-desk/);
});
