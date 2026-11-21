/**
 * D6218 (#6218): the Portfolio Needs-attention notice has its row in Settings ›
 * Notifications, so a member can turn it off, and the bell and /inbox name it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NOTIFICATION_EVENTS, labelForType } from '../src/lib/notificationTypes.js';

const WORKER_TYPE = /export const ATTENTION_TYPE = '([a-z_]+)'/.exec(
  readFileSync(new URL('../../cloudflare-worker/src/services/portfolioAttentionAlerts.ts', import.meta.url), 'utf8'),
)?.[1];

test('the Worker\'s type has a Settings row, unlocked on every channel, so the member can turn it off', () => {
  assert.equal(WORKER_TYPE, 'portfolio_needs_attention');
  const row = NOTIFICATION_EVENTS.find((e) => e.key === WORKER_TYPE);
  assert.ok(row, 'no Settings row for the Worker\'s notification type');
  assert.equal(row.label, 'A company I hold needs attention');
  assert.deepEqual(row.lockedChannels || [], []);
});

test('the bell and /inbox label the type, not the raw key', () => {
  assert.equal(labelForType(WORKER_TYPE), 'A company I hold needs attention');
});
