/**
 * #4802 (acceptance: "Subprocessor notice states distinguish scheduled,
 * sending, delivered, failed, unknown, and recovery-required outcomes where
 * supported") — the Trust workspace reads D4683's per-notice state.
 *
 * #4803 slice 4 drew notices before D4683 (#5328) gave each one the Worker's
 * own word and the counts behind it. A stuck notice (an interrupted send, the
 * attempt limit, or its date passed with deliveries owed) read "In progress";
 * it now reads Recovery required. A notice that started with subscribers
 * untold reads Missed, and the block is never Healthy while one does. A row
 * from a Worker before D4683 (no `state`) keeps slice 4's words.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/security_trust_notices_4802.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { noticesBlock } from '../src/pages/hq/security/trustModel.js';

const ROW = (over = {}) => ({
  uid: 'n1', name: 'Resend', starts_at: '2026-12-01', started: false, notice_due_by: '2026-11-01',
  sending: 0, unknown: 0, sent: 30, late: 0, resent_after_interruption: 0, failed: 0, exhausted: 0, not_sent: 0,
  state: 'delivered', ...over,
});
const READ = (rows, mail = true) => ({ subscribers: { confirmed: 30, pending: 0 }, notices: { available: true, mail_configured: mail, rows } });

test('each D4683 state has its own word and vocabulary state', () => {
  // Mutations checked: the map dropped (needs_attention read "In progress"); missed drawn as action_required.
  const b = noticesBlock(READ([
    ROW({ uid: 'a', state: 'delivered' }),
    ROW({ uid: 'b', state: 'in_progress', sending: 2 }),
    ROW({ uid: 'c', state: 'needs_attention', unknown: 1 }),
    ROW({ uid: 'd', state: 'missed', started: true, not_sent: 3 }),
  ]));
  assert.deepEqual(b.rows.map((r) => [r.uid, r.state, r.word]), [
    ['a', 'healthy', 'Sent'],
    ['b', 'pending', 'In progress'],
    ['c', 'action_required', 'Recovery required'],
    ['d', 'failed', 'Missed'],
  ]);
  assert.equal(b.state, 'failed', 'a missed notice let the block read better than Failed');
});

test('an interrupted send is counted as outcome unknown, and the operator is told what happens next', () => {
  const [r] = noticesBlock(READ([ROW({ state: 'needs_attention', unknown: 2, sent: 28 })])).rows;
  assert.deepEqual(r.counts, [['Queued', 0], ['Sending', 0], ['Outcome unknown', 2], ['Sent', 28], ['Failed', 0]]);
  assert.match(r.notes.join(' '), /2 interrupted: whether they left is unknown/);
  assert.match(r.notes.join(' '), /may get the notice twice/);
});

test('the attempt limit, late sends and resends after an interruption each get a line; a clean notice gets none', () => {
  // Mutation checked: notes built from `failed` instead of `exhausted` (a retryable failure read as final).
  const [r] = noticesBlock(READ([ROW({ state: 'needs_attention', failed: 3, exhausted: 1, late: 2, resent_after_interruption: 1 })])).rows;
  assert.equal(r.notes.length, 3);
  assert.match(r.notes[0], /^1 reached the attempt limit and will not be retried\.$/);
  assert.match(r.notes[1], /^2 went out after the notice date/);
  assert.match(r.notes[2], /^1 sent after an interruption/);
  assert.deepEqual(noticesBlock(READ([ROW()])).rows[0].notes, []);
});

test('a stuck notice is never Healthy at block level, and the block follows its worst notice', () => {
  assert.equal(noticesBlock(READ([ROW(), ROW({ uid: 'x', state: 'needs_attention', unknown: 1 })])).state, 'action_required');
  assert.equal(noticesBlock(READ([ROW(), ROW({ uid: 'y', state: 'in_progress', sending: 1 })])).state, 'healthy');
  assert.equal(noticesBlock(READ([ROW({ state: 'in_progress', sending: 1 })], false)).state, 'action_required', 'mail off with a notice owed read as fine');
});

test('a row from a Worker before D4683 keeps slice 4\'s words', () => {
  const { state, unknown, exhausted, late, resent_after_interruption, notice_due_by, ...older } = ROW({ failed: 2 });
  void state; void unknown; void exhausted; void late; void resent_after_interruption; void notice_due_by;
  const [r] = noticesBlock(READ([older])).rows;
  assert.deepEqual([r.state, r.word], ['action_required', 'Some failed']);
  assert.deepEqual(r.counts, [['Queued', 0], ['Sending', 0], ['Sent', 30], ['Failed', 2]]);
  assert.deepEqual(r.notes, []);
});
