/**
 * D572 part 3b (#1183) — the payout destination (a label and the last 4
 * characters) on the request form, the history and the admin queue, and the
 * leaderboard by metric and period with its change.
 *
 * The worker half is pinned on real SQLite in
 * `cloudflare-worker/test/partner_earnings_3b_d572.test.ts`.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/partner_leaderboard_d572.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import {
  BOARD_METRICS, changeText, destinationCheck, destinationLine, payoutOptions, payoutRequestBody,
} from '../src/lib/partnerEarnings.js';
import { PayoutRequestForm, PayoutHistory } from '../src/pages/partner/earnings/PartnerEarnings.jsx';
import { PayoutQueue } from '../src/pages/admin/AdminCommissions.jsx';
import { LeaderboardTable, ViewerStanding, boardFilters } from '../src/pages/partner/earnings/PartnerLeaderboard.jsx';

const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (el) => renderedText(html(el)).replace(/\s+/g, ' ');

// ── The destination ───────────────────────────────────────────────────────

test('the form\'s destination rule is the route\'s', () => {
  assert.deepEqual(destinationCheck({}), { state: 'none' });
  assert.deepEqual(destinationCheck({ label: ' Main account ', last4: 'ab12' }), { state: 'ok', label: 'Main account', last4: 'AB12' });
  assert.equal(destinationCheck({ label: 'Main', last4: '' }).state, 'incomplete');
  assert.equal(destinationCheck({ label: '', last4: '1234' }).state, 'incomplete');
  assert.equal(destinationCheck({ label: 'x'.repeat(61), last4: '1234' }).state, 'bad_label');
  assert.equal(destinationCheck({ label: 'x'.repeat(60), last4: '1234' }).state, 'ok');
  for (const bad of ['123', '12345', '12-4', '12 4']) assert.equal(destinationCheck({ label: 'Main', last4: bad }).state, 'bad_last4', bad);
});

test('the request body carries the destination only when it is whole', () => {
  const o = { cents: 75000, currency: 'USD' };
  assert.deepEqual(payoutRequestBody(o, 'wire', '', { label: 'Main account', last4: '4821' }),
    { amount_cents: 75000, currency: 'USD', payout_method: 'wire', destination_label: 'Main account', destination_last4: '4821' });
  assert.deepEqual(payoutRequestBody(o, 'wire', '', { label: 'Main account', last4: '' }),
    { amount_cents: 75000, currency: 'USD', payout_method: 'wire' });
  assert.deepEqual(payoutRequestBody(o, 'wire', ''), { amount_cents: 75000, currency: 'USD', payout_method: 'wire' });
});

const COMMISSIONS = [
  { id: 1, amount_cents: 50000, currency: 'USD', status: 'accrued', source_type: 'purchase', created_at: '2026-09-01 10:00:00' },
  { id: 2, amount_cents: 25000, currency: 'USD', status: 'accrued', source_type: 'purchase', created_at: '2026-09-02 10:00:00' },
];

test('the form asks where it is sent, refuses half a destination, and confirms it', () => {
  const plan = payoutOptions(COMMISSIONS);
  const form = html(h(PayoutRequestForm, { state: 'ready', plan, draft: { method: 'wire', destLabel: 'Main', destLast4: '' } }));
  assert.match(form, /data-testid="input-payout-dest-label"/);
  assert.match(form, /data-testid="input-payout-dest-last4"/);
  assert.match(renderedText(form), /Name the destination and give its last 4 characters/);
  assert.match(form, /<button[^>]*disabled=""[^>]*data-testid="button-review-payout"/, 'half a destination can be sent for review');
  const ok = html(h(PayoutRequestForm, { state: 'ready', plan, draft: { method: 'wire', destLabel: 'Main', destLast4: '4821' } }));
  assert.doesNotMatch(ok, /text-payout-dest-error/);
  assert.doesNotMatch(ok, /<button[^>]*disabled=""[^>]*data-testid="button-review-payout"/);
  const confirm = text(h(PayoutRequestForm, { state: 'ready', plan, stage: 'confirm', draft: { optionIndex: 1, method: 'wire', destLabel: 'Main', destLast4: 'ab12' } }));
  assert.match(confirm, /Sent to\s*Main ···· AB12/);
});

const PAYOUTS = [
  { id: 1, uid: 'p1', amount_cents: 50000, currency: 'USD', status: 'requested', payout_method: 'wire', destination_label: 'Main account', destination_last4: '4821', created_at: '2026-10-04 10:00:00', commission_ids: [1] },
  { id: 2, uid: 'p2', amount_cents: 25000, currency: 'USD', status: 'requested', payout_method: 'crypto', destination_label: null, destination_last4: null, created_at: '2026-10-03 10:00:00', commission_ids: [2] },
];

test('the history and the admin queue name the destination, or say none was named', () => {
  assert.equal(destinationLine(PAYOUTS[0]), 'Main account ···· 4821');
  assert.equal(destinationLine(PAYOUTS[1]), null);
  assert.equal(destinationLine({ destination_label: 'Main account', destination_last4: null }), null, 'half a destination is not shown as one');
  const history = html(h(PayoutHistory, { state: 'ready', rows: PAYOUTS }));
  assert.match(renderedText(history.slice(history.indexOf('row-payout-1'), history.indexOf('row-payout-2'))), /to Main account ···· 4821/);
  assert.match(renderedText(history.slice(history.indexOf('row-payout-2'))), /destination not named/);
  const queue = html(h(PayoutQueue, { state: 'ready', rows: PAYOUTS.map((p) => ({ ...p, name: 'Pat Partner' })), view: 'all' }));
  assert.match(queue, /data-testid="text-queue-dest-1">to Main account ···· 4821/);
  assert.doesNotMatch(queue, /text-queue-dest-2/);
  assert.match(renderedText(queue.slice(queue.indexOf('row-queue-2'))), /destination not named/);
});

// ── The leaderboard ───────────────────────────────────────────────────────

test('a change reads as a move, no change, new, or nothing to compare', () => {
  assert.deepEqual(changeText(2), { text: '▲ 2', dir: 'up' });
  assert.deepEqual(changeText(-3), { text: '▼ 3', dir: 'down' });
  assert.deepEqual(changeText(0), { text: 'No change', dir: 'same' });
  assert.deepEqual(changeText('new'), { text: 'New', dir: 'new' });
  assert.equal(changeText(null), null);
  assert.equal(changeText('2'), null, 'a string is not a move');
});

const BOARD = {
  metric: 'referrals', period: 'quarter', period_key: '2026-Q4', total_ranked: 30,
  rows: [
    { rank: 1, role: 'founder', value: 9, change: 2, is_viewer: false },
    { rank: 2, role: 'partner', value: 4, change: 0, is_viewer: true },
    { rank: 3, role: 'investor', value: 3, change: 'new', is_viewer: false },
  ],
  viewer: { ranked: true, rank: 2, role: 'partner', value: 4, change: 0, is_viewer: true },
  compare: { available: true, date: '2026-09-28', days: 7 },
};

test('the board shows each row\'s rank, role, count and change, and the viewer\'s own', () => {
  const markup = html(h(LeaderboardTable, { state: 'ready', data: BOARD }));
  const t = renderedText(markup).replace(/\s+/g, ' ');
  assert.match(t, /Ranked by referrals made/);
  assert.match(t, /3 of 30 ranked/);
  assert.match(t, /Referrals made/);
  assert.match(markup, /data-testid="row-board-viewer"[^>]*class="[^"]*bg-amber-50/);
  assert.deepEqual([...markup.matchAll(/data-dir="([a-z]+)"/g)].map((m) => m[1]), ['up', 'same', 'new']);
  assert.match(t, /Change is against the standing stored on 2026-09-28, at least 7 days ago\./);
  const viewer = text(h(ViewerStanding, { state: 'ready', data: BOARD }));
  assert.match(viewer, /Your rank\s*2 of 30 ranked, with referrals made of 4\. Change: No change/);
});

test('with nothing to compare, the change says why; an unranked viewer is told the reason', () => {
  const none = { ...BOARD, compare: { available: false, reason: 'No standing from at least 7 days ago is stored yet.' } };
  const markup = html(h(LeaderboardTable, { state: 'ready', data: none }));
  assert.doesNotMatch(markup, /data-dir=/);
  assert.equal((markup.match(/Not recorded/g) || []).length, 3, 'each row says it has no change');
  assert.match(renderedText(markup), /No standing from at least 7 days ago is stored yet\./);
  const v = text(h(ViewerStanding, { state: 'ready', data: { ...BOARD, viewer: { ranked: false, reason: 'You chose not to appear in the directory, so you are not ranked.' } } }));
  assert.match(v, /Not ranked You chose not to appear in the directory/);
  assert.equal(html(h(ViewerStanding, { state: 'loading', data: null })), '');
  assert.match(text(h(LeaderboardTable, { state: 'unreadable', data: null, onRetry: () => {} })), /This is not a claim that nobody is ranked/);
  assert.match(text(h(LeaderboardTable, { state: 'ready', data: { ...BOARD, rows: [] } })), /Nobody is ranked yet/);
});

test('the chips: every metric live, introductions disabled with its reason, and the score has no quarter', () => {
  const score = boardFilters('score', 'all', () => {}, () => {});
  const by = (id) => score.find((f) => f.testid === id);
  for (const m of BOARD_METRICS) assert.ok(!by(`chip-metric-${m.key}`).disabled, `${m.key} is not selectable`);
  assert.equal(by('chip-metric-score').active, true);
  assert.equal(by('chip-metric-introductions').disabled, true);
  assert.match(by('chip-metric-introductions').title, /No store records an introduction/);
  assert.equal(by('chip-period-quarter').disabled, true);
  assert.match(by('chip-period-quarter').title, /standing, not a tally/);
  const refs = boardFilters('referrals', 'quarter', () => {}, () => {});
  assert.equal(refs.find((f) => f.testid === 'chip-period-quarter').active, true);
  assert.ok(!refs.find((f) => f.testid === 'chip-period-quarter').disabled);
  const picked = [];
  refs.find((f) => f.testid === 'chip-metric-commissions').onSelect();
  boardFilters('referrals', 'all', (k) => picked.push(k), () => {}).find((f) => f.testid === 'chip-metric-commissions').onSelect();
  assert.deepEqual(picked, ['commissions']);
});
