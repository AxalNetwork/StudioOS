import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HQ_SUPPORT_SLA_POLICY,
  HQ_TICKET_SLA_HOURS,
  ticketPriorityTier,
  ticketSlaBand,
  ticketSlaBandForPriority,
  tallySlaBands,
} from '../src/services/supportSlaPolicy';

test('HQ inherits three P-bands at 24/48/96 hours', () => {
  assert.equal(HQ_SUPPORT_SLA_POLICY.length, 3);
  assert.deepEqual(HQ_TICKET_SLA_HOURS, { P1: 24, P2: 48, P3: 96 });
});

test('priority maps to tiers the filing UI already stores', () => {
  assert.equal(ticketPriorityTier('urgent'), 'P1');
  assert.equal(ticketPriorityTier('high'), 'P2');
  assert.equal(ticketPriorityTier('medium'), 'P3');
  assert.equal(ticketPriorityTier('low'), 'P3');
  assert.equal(ticketPriorityTier(''), 'P3');
});

test('ticketSlaBand: a P1 can be on time, and the window is per limit (D459)', () => {
  // P1 limit 24h: the window is min(24, 24/2) = 12h, so a 5-hour-old P1 is on
  // time (b1f0027b had changed this line to (0, 24) to fit the code).
  assert.equal(ticketSlaBand(5, 24), 'ok');
  assert.equal(ticketSlaBand(0, 24), 'ok');
  assert.equal(ticketSlaBand(12, 24), 'due_soon', 'the last 12 hours, boundary included');
  assert.equal(ticketSlaBand(11.9, 24), 'ok');
  assert.equal(ticketSlaBand(25, 24), 'past');
  assert.equal(ticketSlaBand(5, 96), 'ok');
  assert.equal(ticketSlaBand(72, 96), 'due_soon', 'a 96h limit keeps the 24h window');
  assert.equal(ticketSlaBand(null, 24), null);
});

test('ticketSlaBandForPriority uses tier hours', () => {
  assert.equal(ticketSlaBandForPriority(50, 'high'), 'past'); // P2 48h
  assert.equal(ticketSlaBandForPriority(30, 'urgent'), 'past'); // P1 24h
});

test('tallySlaBands counts an undated ticket instead of leaving it out (D459)', () => {
  assert.deepEqual(
    tallySlaBands(['ok', 'past', null, 'due_soon']),
    { ok: 1, due_soon: 1, past: 1, undated: 1 },
  );
});
