/**
 * D4807 (#4807) — a mentor with an additional Advisor licence is not flagged as
 * having lost the role; a real role loss still is; a deactivated account is
 * reported as inactive, not as a lost role. Names are invented.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isStaleRow } from '../src/pages/admin/programs/programsModel.js';

const row = (o) => ({ is_active: 1, advisor_is_active: true, advisor_role: 'founder', ...o });

test('secondary Advisor licence: eligible, not stale', () => {
  assert.equal(isStaleRow(row({ advisor_eligible: true })), false);
});
test('role lost and no licence: stale', () => {
  assert.equal(isStaleRow(row({ advisor_eligible: false })), true);
});
test('deactivated account is not read as a lost role', () => {
  assert.equal(isStaleRow(row({ advisor_eligible: false, advisor_is_active: false })), false);
});
test('an older read without advisor_eligible falls back to the primary role', () => {
  assert.equal(isStaleRow(row({})), true);
  assert.equal(isStaleRow(row({ advisor_role: 'advisor' })), false);
});
