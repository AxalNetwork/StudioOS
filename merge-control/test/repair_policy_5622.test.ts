import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eligible } from '../src/lib/repairPolicy.ts';

const now = Date.UTC(2026, 10, 12);
const digest = {
  event: 'pull_request',
  verdict: 'pr_failure',
  headSha: 'a'.repeat(40),
  fingerprint: 'fixture-failure',
};
const state = {
  digest,
  lastPushAt: now - 30 * 60_000,
  attemptsForFingerprint: 1,
  dailyBudgetRemainingCents: 25,
  killSwitch: false,
  openAlertTitles: [],
  recentInfraFailures: 2,
  infraFailureLimit: 3,
};

test('a PR-only failure is eligible after 30 minutes with a spare attempt and budget', () => {
  assert.equal(eligible(state, now), true);
});

test('the digest must be for a PR failure at an identified head', () => {
  for (const changes of [
    { event: 'merge_group' }, { event: 'push' }, { verdict: 'inherited_main_failure' },
    { verdict: 'main_health_unknown' }, { verdict: 'infra_failure' },
    { headSha: '' }, { fingerprint: '' },
  ]) {
    assert.equal(eligible({ ...state, digest: { ...digest, ...changes } }, now), false);
  }
  assert.equal(eligible({ ...state, digest: null }, now), false);
});

test('a recent push, a third attempt, spent budget or a kill switch blocks repair', () => {
  for (const changes of [
    { lastPushAt: state.lastPushAt + 1 }, { lastPushAt: now + 1 },
    { lastPushAt: Number.NaN }, { attemptsForFingerprint: 2 },
    { attemptsForFingerprint: -1 }, { dailyBudgetRemainingCents: 0 }, { killSwitch: true },
  ]) {
    assert.equal(eligible({ ...state, ...changes }, now), false);
  }
});

test('each incident and the configured infra failure threshold opens the breaker', () => {
  for (const title of [
    '[alert] main is red', '[alert] the Actions queue is backed up', '[alert] merge queue stalled',
  ]) {
    assert.equal(eligible({ ...state, openAlertTitles: [title] }, now), false);
  }
  assert.equal(eligible({ ...state, recentInfraFailures: 3 }, now), false);
  assert.equal(eligible({ ...state, openAlertTitles: null }, now), false);
  assert.equal(eligible({ ...state, infraFailureLimit: 0 }, now), false);
  assert.equal(eligible({ ...state, openAlertTitles: ['[alert] unrelated'] }, now), true);
});
