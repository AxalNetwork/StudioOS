/**
 * D445 — Approvals opens prefilled, Accounts names the seats it asks for,
 * and a member who is not an admin can be deactivated from the same table.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { approvalsHref, prefillFromSearch } from '../src/lib/escalationPrefill.js';
import { seatIncreaseRequest, canDeactivateMember } from '../src/pages/branch/BranchAccounts.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const APPROVALS = read('frontend/src/pages/branch/BranchApprovals.jsx');
const HOME = read('frontend/src/pages/branch/BranchHome.jsx');
const ACCOUNTS = read('frontend/src/pages/branch/BranchAccounts.jsx');
const SETTINGS = read('frontend/src/pages/branch/BranchSettings.jsx');

test('the approvals form reads the query once', () => {
  assert.match(APPROVALS, /useSearchParams/);
  assert.match(APPROVALS, /prefillFromSearch/);
  assert.match(APPROVALS, /eleven lanes/);
  assert.doesNotMatch(APPROVALS, /four local queues|four queues/i);
  assert.doesNotMatch(HOME, /four local queues|four queues/i);
  assert.match(HOME, /eleven lanes/);
});

test('a known kind and a trimmed subject come off the query, and an unknown kind does not', () => {
  const params = new URLSearchParams('kind=seat_increase&subject=+More+seats+');
  assert.deepEqual(prefillFromSearch(params), { kind: 'seat_increase', subject: 'More seats' });
  const unknown = new URLSearchParams('kind=licence_edit&subject=Rename');
  assert.deepEqual(prefillFromSearch(unknown), { kind: null, subject: 'Rename' });
  const long = 'x'.repeat(400);
  assert.equal(prefillFromSearch(new URLSearchParams({ subject: `  ${long}  ` })).subject.length, 300);
});

test('settings links are the same href the form reads', () => {
  const expected = [
    approvalsHref({ kind: 'other', subject: 'Change the subsidiary name' }),
    approvalsHref({ kind: 'other', subject: 'Change the territory' }),
    approvalsHref({ kind: 'content', subject: 'Brand kit' }),
    approvalsHref({ kind: 'other', subject: 'Data residency' }),
    approvalsHref({ kind: 'other', subject: 'Domain' }),
  ];
  for (const href of expected) {
    assert.ok(SETTINGS.includes(`actTo: '${href}'`), `${href} is not a settings destination`);
  }
  assert.match(SETTINGS, /actTo: '\/branch\/accounts'/);
});

test('a seat request names the type and the count, and leaves out a figure that is not a number', () => {
  const built = seatIncreaseRequest({ type: 'founder', more: '3', used: 2, licensed: 4 });
  assert.equal(built.kind, 'seat_increase');
  assert.equal(built.subject, '3 more founder seats');
  assert.match(built.detail, /using 2 of 4 founder seats/);
  assert.equal(seatIncreaseRequest({ type: 'investor', more: '1', used: 0, licensed: 1 }).subject, '1 more investor seat');
  const bare = seatIncreaseRequest({ type: 'partner', more: '2' });
  assert.equal(bare.subject, '2 more partner seats');
  assert.doesNotMatch(bare.detail, /using /);
  const omitted = seatIncreaseRequest({ type: 'founder', more: '2', used: Number.NaN, licensed: 4 });
  assert.equal(omitted.subject, '2 more founder seats');
  assert.doesNotMatch(omitted.detail, /using /);
  assert.equal(seatIncreaseRequest({ type: 'admin', more: '2', used: 0, licensed: 1 }), null);
  assert.equal(seatIncreaseRequest({ type: 'founder', more: '0' }), null);
  assert.equal(seatIncreaseRequest({ type: 'founder', more: '501' }), null);
  assert.equal(seatIncreaseRequest({ type: 'founder', more: '1.5' }), null);
  assert.equal(seatIncreaseRequest({ type: 'founder', more: '' }), null);
});

test('deactivation is offered on a non-admin row and nowhere an admin or the viewer would be refused', () => {
  const viewer = { id: 7, is_super_admin: 1 };
  assert.equal(canDeactivateMember({ id: 9, role: 'founder' }, viewer), true);
  assert.equal(canDeactivateMember({ id: 7, role: 'founder' }, viewer), false);
  assert.equal(canDeactivateMember({ id: 3, role: 'admin' }, viewer), false);
  assert.equal(canDeactivateMember({ id: 3, role: 'admin' }, { id: 7, is_super_admin: 0 }), false);
  assert.equal(canDeactivateMember(null, viewer), false);
  assert.match(ACCOUNTS, /adminToggleActive\(member\.id\)/);
  assert.doesNotMatch(ACCOUNTS, /adminToggleActive\([^)]*reason/);
  assert.match(ACCOUNTS, /Closed by a super admin\. This branch has none\./);
  assert.match(ACCOUNTS, /Forced password reset/);
  assert.match(ACCOUNTS, /branch-password-reset-absent/);
  assert.doesNotMatch(ACCOUNTS, /resetPassword|adminResetPassword|type="password"/);
  assert.match(ACCOUNTS, /myLicence\(/);
  assert.doesNotMatch(ACCOUNTS, /updateLicence|adminUpdateLicence|licenceUpdate/);
});
