/** D7889: operator supervisor actions and job environment isolation, without live enrollment. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextSupervisorAction, isolatedJobEnvironment } from '../ci/runners/ephemeral-supervisor.mjs';
const NOW = 1_000_000;

test('ephemeral supervision never forwards broad credentials and drains before unregister/teardown, with bounded enrollment', () => {
  assert.deepEqual(isolatedJobEnvironment({ PATH: '/tools', LANG: 'C', GH_TOKEN: 'synthetic', JELASTIC_TOKEN: 'synthetic', APP_PRIVATE_KEY: 'synthetic' }), { PATH: '/tools', LANG: 'C' });
  const state = { machineCreatedAt: NOW, enrollmentAttempts: 0, jobsCompleted: 0, jobSlotConsumed: false };
  const observed = { eligibilityRemoved: false, assignment: 'none', registered: false };
  const policy = { approved: true, imageVerified: true, issuerVerified: true, killSwitch: false, draining: false,
    lastAdmissionAt: NOW + 100_000, maxLifetimeMs: 600_000, minEnrollmentMs: 10_000, maxEnrollmentAttempts: 3, enrollmentExpiresAt: null };
  assert.equal(nextSupervisorAction(state, observed, { ...policy, approved: false }, NOW).action, 'blocked');
  assert.equal(nextSupervisorAction(state, observed, policy, NOW).action, 'request-short-lived-enrollment');
  assert.equal(nextSupervisorAction(state, observed, { ...policy, enrollmentExpiresAt: NOW + 20_000 }, NOW).jobs, 1);
  assert.deepEqual(nextSupervisorAction(state, { ...observed, registered: true }, policy, NOW), { action: 'run-once', jobs: 1, ephemeral: true, nextJobSlotConsumed: true });
  assert.equal(nextSupervisorAction(state, observed, { ...policy, draining: true }, NOW).action, 'remove-eligibility');
  assert.equal(nextSupervisorAction(state, { ...observed, eligibilityRemoved: true, assignment: 'owned' }, { ...policy, draining: true }, NOW).action, 'wait');
  assert.equal(nextSupervisorAction(state, { ...observed, eligibilityRemoved: true, registered: true }, { ...policy, draining: true }, NOW).action, 'unregister');
  assert.equal(nextSupervisorAction(state, { ...observed, eligibilityRemoved: true }, { ...policy, draining: true }, NOW).action, 'ready-for-provider-teardown');
  assert.equal(nextSupervisorAction({ ...state, enrollmentAttempts: 3 }, observed, policy, NOW).reason, 'enrollment_retry_limit');
});

test('completed one-job machines drain and unknown registration observations cannot authorize teardown', () => {
  const state = { machineCreatedAt: NOW, enrollmentAttempts: 0, jobsCompleted: 1, jobSlotConsumed: false };
  const observed = { eligibilityRemoved: false, assignment: 'none', registered: false };
  const policy = { approved: true, imageVerified: true, issuerVerified: true, killSwitch: false, draining: false,
    lastAdmissionAt: NOW + 100_000, maxLifetimeMs: 600_000, minEnrollmentMs: 10_000, maxEnrollmentAttempts: 3, enrollmentExpiresAt: null };
  assert.equal(nextSupervisorAction(state, observed, policy, NOW).action, 'remove-eligibility');
  assert.equal(nextSupervisorAction(state, { ...observed, eligibilityRemoved: true }, policy, NOW).action, 'ready-for-provider-teardown');
  for (const field of ['registered', 'eligibilityRemoved']) {
    for (const value of [undefined, null, 'false', 0]) {
      assert.throws(() => nextSupervisorAction(state, { ...observed, [field]: value }, policy, NOW), /invalid_supervisor_contract/);
    }
  }
});

test('one-job admission consumes a durable slot before launch and approvals are strict booleans', () => {
  const state = { machineCreatedAt: NOW, enrollmentAttempts: 0, jobsCompleted: 0, jobSlotConsumed: false };
  const observed = { eligibilityRemoved: false, assignment: 'none', registered: true };
  const policy = { approved: true, imageVerified: true, issuerVerified: true, killSwitch: false, draining: false,
    lastAdmissionAt: NOW + 100_000, maxLifetimeMs: 600_000, minEnrollmentMs: 10_000, maxEnrollmentAttempts: 3, enrollmentExpiresAt: null };
  const launch = nextSupervisorAction(state, observed, policy, NOW);
  assert.equal(launch.nextJobSlotConsumed, true);
  assert.equal(nextSupervisorAction({ ...state, jobSlotConsumed: launch.nextJobSlotConsumed }, { ...observed, registered: false }, policy, NOW).action, 'remove-eligibility');
  for (const field of ['approved', 'imageVerified', 'issuerVerified']) {
    for (const value of ['false', 1, undefined]) {
      assert.equal(nextSupervisorAction(state, observed, { ...policy, [field]: value }, NOW).action, 'blocked');
    }
  }
});
