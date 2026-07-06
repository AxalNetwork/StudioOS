import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAccessFounderResource } from '../src/auth';

// Audit M2 — canAccessFounderResource is the IDOR predicate for founder-owned
// resources. It used to blanket-bypass admin/partner/investor; investors are
// now denied (their only founder-data path is the NDA-gated masked view).
const mk = (role: string, founder_id: number | null = null) =>
  ({ id: 1, role, founder_id }) as any;

test('admin and partner retain broad founder-resource access', () => {
  assert.equal(canAccessFounderResource(mk('admin'), 42), true);
  assert.equal(canAccessFounderResource(mk('partner'), 42), true);
  // staff pass even when the resource has no owner founder
  assert.equal(canAccessFounderResource(mk('admin'), null), true);
  assert.equal(canAccessFounderResource(mk('partner'), null), true);
});

test('founder may only access their own founder row', () => {
  assert.equal(canAccessFounderResource(mk('founder', 42), 42), true);
  assert.equal(canAccessFounderResource(mk('founder', 7), 42), false);
  assert.equal(canAccessFounderResource(mk('founder', null), 42), false);
});

test('investor is denied — no blanket bypass (masked paths gate separately)', () => {
  assert.equal(canAccessFounderResource(mk('investor'), 42), false);
  // even if an investor somehow carried a matching founder_id
  assert.equal(canAccessFounderResource(mk('investor', 42), 42), false);
  assert.equal(canAccessFounderResource(mk('investor'), null), false);
});

test('guest and unknown roles are denied', () => {
  assert.equal(canAccessFounderResource(mk('guest'), 42), false);
  assert.equal(canAccessFounderResource(mk('advisor'), 42), false);
});

test('null ownerFounderId denies all non-staff roles', () => {
  assert.equal(canAccessFounderResource(mk('founder', 5), null), false);
  assert.equal(canAccessFounderResource(mk('investor'), null), false);
  assert.equal(canAccessFounderResource(mk('guest'), null), false);
});
