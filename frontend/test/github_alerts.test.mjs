/**
 * GitHub health alerts to Slack (scripts/lib/githubAlerts.mjs, the CLI
 * scripts/github-alerts.mjs, the loader scripts/future-clock.mjs and the
 * workflow .github/workflows/github-alerts.yml). Found on 2026-11-09: two
 * date-bound tests (D5052, D5039) broke every PR, the reviewer called no model
 * while its check read green, and the Actions queue backed up.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  ALERT_KINDS, failingTests, futureClockMessage, mainState, message, queueState, reviewState, transition,
} from '../../scripts/lib/githubAlerts.mjs';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');

test('transition: open once, close once, nothing on repeats or on an unknown state', () => {
  assert.equal(transition(true, false), 'open');
  assert.equal(transition(true, true), 'none');
  assert.equal(transition(false, true), 'close');
  assert.equal(transition(false, false), 'none');
  assert.equal(transition(null, true), 'none');
  assert.equal(transition(null, false), 'none');
});

test('mainState: failure and timeout are red, success is green, cancelled says nothing', () => {
  assert.equal(mainState('failure'), true);
  assert.equal(mainState('timed_out'), true);
  assert.equal(mainState('success'), false);
  assert.equal(mainState('cancelled'), null);
  assert.equal(mainState('skipped'), null);
  assert.equal(mainState(undefined), null);
});

test('reviewState: no model called is blocked, a review or a duplicate is working, the rest say nothing', () => {
  assert.equal(reviewState('budget_refused'), true);
  assert.equal(reviewState('configuration_error'), true);
  assert.equal(reviewState('reviewed'), false);
  assert.equal(reviewState('duplicate'), false);
  for (const o of ['api_error', 'empty_diff', 'disabled', 'skipped', '', undefined]) assert.equal(reviewState(o), null, String(o));
});

test('queueState: backed up on either threshold', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const thresholds = { queued: 40, oldestMinutes: 45 };
  assert.deepEqual(queueState({ queued: 3, oldestCreatedAt: '2026-11-09T11:50:00Z', now, thresholds }), { active: false, queued: 3, waitedMin: 10 });
  assert.equal(queueState({ queued: 40, oldestCreatedAt: '2026-11-09T11:59:00Z', now, thresholds }).active, true);
  assert.equal(queueState({ queued: 2, oldestCreatedAt: '2026-11-09T11:00:00Z', now, thresholds }).active, true);
  assert.deepEqual(queueState({ queued: 0, oldestCreatedAt: null, now, thresholds }), { active: false, queued: 0, waitedMin: 0 });
});

test('failingTests: test names from TAP, de-duplicated, file entries and passes left out, capped', () => {
  const tap = [
    'ok 1 - passes',
    'not ok 2 - D5052 policy is current',
    '  not ok 3 - promotions list today # TODO',
    'not ok 4 - D5052 policy is current',
    'not ok 5 - test/licence_agreement_policies_d5052.test.ts',
  ].join('\n');
  assert.deepEqual(failingTests(tap), { names: ['D5052 policy is current', 'promotions list today'], more: 0 });
  const many = Array.from({ length: 20 }, (_, i) => `not ok ${i + 1} - t${i}`).join('\n');
  assert.deepEqual(failingTests(many, 15).more, 5);
  assert.deepEqual(failingTests(''), { names: [], more: 0 });
});

test('messages: one per transition, recovery for every kind, nothing for a clean future clock', () => {
  for (const kind of Object.keys(ALERT_KINDS)) {
    assert.ok(message(kind, 'open', { sha: 'abcdef1234', queued: 50, waitedMin: 60, outcome: 'budget_refused' }).length > 0, kind);
    assert.match(message(kind, 'close', { issueUrl: 'https://github.com/x/y/issues/1' }), /recovered/);
  }
  assert.match(message('main-red', 'open', { sha: 'abcdef1234567', runUrl: 'https://r' }), /`abcdef12`.*<https:\/\/r\|run>/);
  assert.equal(futureClockMessage({ days: 7, failures: { names: [], more: 0 } }), '');
  assert.match(futureClockMessage({ days: 7, failures: { names: ['a'], more: 2 } }), /3 test\(s\) fail with the clock 7 days ahead[\s\S]*• a[\s\S]*2 more/);
});

test('future-clock.mjs moves Date.now() and new Date() ahead, and leaves new Date(x) alone', () => {
  const code = 'const a=Date.now();const b=new Date().getTime();const c=new Date(0).getTime();console.log(JSON.stringify({a,b,c,real:performance.timeOrigin+performance.now()}))';
  const loader = resolve(root, 'scripts/future-clock.mjs');
  const run = (days) => {
    const r = spawnSync(process.execPath, [`--import=${loader}`, '-e', code], { env: { ...process.env, FUTURE_CLOCK_DAYS: days }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const day = 86_400_000;
  const shifted = run('7');
  assert.ok(Math.abs(shifted.a - shifted.real - 7 * day) < 60_000, `Date.now() off by ${shifted.a - shifted.real}`);
  assert.ok(Math.abs(shifted.b - shifted.real - 7 * day) < 60_000);
  assert.equal(shifted.c, 0);
  const plain = run('0');
  assert.ok(Math.abs(plain.a - plain.real) < 60_000);
});

test('the workflow wires each alert, and the reviewer alert sits in claude-review.yml', () => {
  const wf = read('.github/workflows/github-alerts.yml');
  assert.match(wf, /cron: '\*\/15 \* \* \* \*'/);
  assert.match(wf, /node scripts\/github-alerts\.mjs main-red/);
  assert.match(wf, /node scripts\/github-alerts\.mjs queue/);
  assert.match(wf, /node scripts\/github-alerts\.mjs future-clock/);
  assert.match(wf, /--import=\$GITHUB_WORKSPACE\/scripts\/future-clock\.mjs/);
  assert.match(wf, /FUTURE_CLOCK_DAYS: '7'/);
  assert.match(wf, /SLACK_GITHUB_WEBHOOK_URL: \$\{\{ secrets\.SLACK_GITHUB_WEBHOOK_URL \}\}/);
  // Every CI test part runs ahead: the matrix names the same parts CI does.
  const parts = /part: \[([^\]]+)\]/.exec(wf)[1].split(',').map((s) => s.trim());
  assert.deepEqual(parts.filter((p) => /^(frontend|worker)-/.test(p)).length, 8);

  const review = read('.github/workflows/claude-review.yml');
  assert.match(review, /outcome: \$\{\{ steps\.review\.outputs\.outcome \}\}/);
  assert.match(review, /node scripts\/github-alerts\.mjs review-blocked/);
});

test('an alert never fails its run: the CLI catches and exits 0', () => {
  const r = spawnSync(process.execPath, [resolve(root, 'scripts/github-alerts.mjs'), 'nonsense'], { env: { ...process.env, GITHUB_TOKEN: '', SLACK_GITHUB_WEBHOOK_URL: '' }, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /::warning::github-alerts: unknown mode/);
});
