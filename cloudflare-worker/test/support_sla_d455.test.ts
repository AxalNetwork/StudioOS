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

test('ticketSlaBand matches escalation due-soon window semantics on age', () => {
  // P1 limit 24h: due_soon is the last 24h before the limit, so any age > 0 is due_soon until past.
  assert.equal(ticketSlaBand(10, 24), 'due_soon');
  assert.equal(ticketSlaBand(25, 24), 'past');
  assert.equal(ticketSlaBand(0, 24), 'ok');
  assert.equal(ticketSlaBand(5, 96), 'ok');
  assert.equal(ticketSlaBand(null, 24), null);
});

test('ticketSlaBandForPriority uses tier hours', () => {
  assert.equal(ticketSlaBandForPriority(50, 'high'), 'past'); // P2 48h
  assert.equal(ticketSlaBandForPriority(30, 'urgent'), 'past'); // P1 24h
});

test('tallySlaBands ignores null ages', () => {
  assert.deepEqual(
    tallySlaBands(['ok', 'past', null, 'due_soon']),
    { ok: 1, due_soon: 1, past: 1 },
  );
});
