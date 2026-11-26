/** D8754: scheduled backup and monitoring health from run records, and its once-per-episode alert. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APPROVAL_GRACE_MS, BACKUP_MAX_AGE_MS, WATCHED, opsScheduleHealth, workflowHealth } from './opsScheduleHealth.mjs';
import { createHealthMonitor, safeHealthFacts } from '../health-alert-episodes.mjs';
import { message } from './githubAlerts.mjs';

const H = 3_600_000;
const backup = WATCHED.find((w) => w.workflow === 'backup-d1.yml');
const probe = WATCHED.find((w) => w.workflow === 'magic-link-insert-probe.yml');
const drift = WATCHED.find((w) => w.workflow === 'admin-drift.yml');
const run = (id, createdAt, status, conclusion = null, patch = {}) =>
  ({ id, head_branch: 'main', event: 'schedule', created_at: new Date(createdAt).toISOString(), status, conclusion, ...patch });

// The record that opened #8754: the last success on 21 November, then four daily runs waiting on the reviewer.
const NOW = Date.parse('2026-11-26T09:00:00Z');
const RECORD = [
  run(45601802222, Date.parse('2026-11-25T11:09:36Z'), 'waiting'),
  run(45392739036, Date.parse('2026-11-24T12:21:36Z'), 'waiting'),
  run(45158038475, Date.parse('2026-11-23T10:39:04Z'), 'waiting'),
  run(45008680536, Date.parse('2026-11-22T09:40:26Z'), 'waiting'),
  run(44890546972, Date.parse('2026-11-21T09:38:36Z'), 'completed', 'success'),
];

test('the 22 to 25 November backup record is an approval wait and a stale backup, 119 hours old', () => {
  const r = workflowHealth(backup, RECORD, null, NOW);
  assert.deepEqual(r.reasons, ['approval_pending', 'backup_stale']);
  assert.equal(r.waiting, 4);
  assert.equal(r.ageHours, 119);
  assert.equal(r.readable, true);
});

test('a backup that succeeded today is healthy; one older than 26 hours is stale even with no run waiting', () => {
  assert.deepEqual(workflowHealth(backup, [run(1, NOW - 7 * H, 'completed', 'success')], null, NOW).reasons, []);
  const old = workflowHealth(backup, [run(2, NOW - BACKUP_MAX_AGE_MS - H, 'completed', 'success')], null, NOW);
  assert.deepEqual(old.reasons, ['schedule_missed', 'backup_stale']);
  // Failed since its last success: stale once that success passes 26 hours.
  const failing = [run(4, NOW - 3 * H, 'completed', 'failure'), run(3, NOW - 27 * H, 'completed', 'success')];
  assert.deepEqual(workflowHealth(backup, failing, ['Export D1 → SQL'], NOW).reasons, ['backup_stale']);
});

test('a run waits up to an hour before it counts as a pending approval', () => {
  const fresh = [run(5, NOW - APPROVAL_GRACE_MS + 60_000, 'waiting'), run(4, NOW - 20 * H, 'completed', 'success')];
  assert.deepEqual(workflowHealth(backup, fresh, null, NOW).reasons, []);
  const late = [run(5, NOW - APPROVAL_GRACE_MS - 60_000, 'waiting'), run(4, NOW - 20 * H, 'completed', 'success')];
  assert.deepEqual(workflowHealth(backup, late, null, NOW).reasons, ['approval_pending']);
});

test('a failure at the workflow\'s own secret guard is a missing credential; any other failure is not', () => {
  const failed = [run(6, NOW - 2 * H, 'completed', 'failure'), run(5, NOW - 20 * H, 'completed', 'success')];
  assert.deepEqual(workflowHealth(backup, failed, ['Preflight — assert required secrets are set'], NOW).reasons, ['credentials_missing']);
  assert.deepEqual(workflowHealth(backup, failed, ['Export D1 → SQL'], NOW).reasons, []);
  const driftFailed = [run(7, NOW - 2 * H, 'completed', 'failure')];
  assert.deepEqual(workflowHealth(drift, driftFailed, ['Read with GET only; fail closed when the token cannot read an expected setting'], NOW).reasons, ['credentials_missing']);
  // The probe names no guard step: its failures are latency or evidence verdicts (#8755), not credentials.
  assert.deepEqual(workflowHealth(probe, [run(8, NOW - 2 * H, 'completed', 'failure')], ['Observe the scheduled application check'], NOW).reasons, []);
  // Unread failed steps: no observation.
  assert.equal(workflowHealth(backup, failed, null, NOW).readable, false);
});

test('a schedule that stops firing is missed within its window; pull-request and branch runs do not count', () => {
  assert.deepEqual(workflowHealth(probe, [run(9, NOW - 10 * H, 'completed', 'success')], null, NOW).reasons, ['schedule_missed']);
  assert.deepEqual(workflowHealth(probe, [run(9, NOW - 3 * H, 'completed', 'success')], null, NOW).reasons, []);
  const others = [run(10, NOW - H, 'completed', 'success', { event: 'pull_request' }), run(11, NOW - H, 'completed', 'success', { head_branch: 'feature' })];
  assert.deepEqual(workflowHealth(backup, others, null, NOW).reasons, ['schedule_missed', 'backup_stale']);
  assert.deepEqual(workflowHealth(drift, [run(12, NOW - 7 * 24 * H, 'completed', 'success')], null, NOW).reasons, []);
});

test('the whole: active on any reason, null when unreadable and nothing is wrong, false only when every read is healthy', () => {
  const ok = (spec) => workflowHealth(spec, [run(1, NOW - H, 'completed', 'success')], null, NOW);
  assert.equal(opsScheduleHealth([ok(backup), ok(probe), ok(drift)]).active, false);
  const bad = opsScheduleHealth([workflowHealth(backup, RECORD, null, NOW), ok(probe), ok(drift)]);
  assert.deepEqual(bad, { active: true, reasons: ['approval_pending', 'backup_stale'], workflows: ['backup-d1.yml'], ageHours: 119 });
  const unread = workflowHealth(probe, null, null, NOW);
  assert.equal(opsScheduleHealth([ok(backup), unread, ok(drift)]).active, null);
  assert.equal(opsScheduleHealth([workflowHealth(backup, RECORD, null, NOW), unread]).active, true, 'a known problem is not hidden by an unread one');
  assert.equal(opsScheduleHealth([]).active, null);
});

function fixture() {
  const rows = [];
  const sent = [];
  const api = async (path, init = {}) => {
    if (init.method === 'POST' && path.endsWith('/issues')) {
      const body = JSON.parse(init.body);
      rows.push({ number: rows.length + 1, title: body.title, body: body.body, state: 'open', labels: [], user: { login: 'github-actions[bot]' }, html_url: `https://github.com/AxalNetwork/StudioOS/issues/${rows.length + 1}` });
      return structuredClone(rows.at(-1));
    }
    const m = path.match(/\/issues\/(\d+)$/);
    if (m && init.method === 'PATCH') {
      const row = rows[Number(m[1]) - 1];
      Object.assign(row, JSON.parse(init.body));
      return structuredClone(row);
    }
    if (m) return structuredClone(rows[Number(m[1]) - 1]);
    return structuredClone(rows.filter((row) => path.includes('state=all') || row.state === 'open'));
  };
  const monitor = createHealthMonitor({ repo: 'AxalNetwork/StudioOS', api, now: () => NOW,
    deliver: async (value) => { sent.push(value); return { state: 'acknowledged', receipt: { transport: 'webhook', status: 200 } }; } });
  return { rows, sent, monitor };
}

test('the alert opens once, stays open through unreadable checks, and closes on a healthy read', async () => {
  const f = fixture();
  const bad = opsScheduleHealth([workflowHealth(backup, RECORD, null, NOW)]);
  for (const source of [1, 2, 3]) await f.monitor.apply('ops-schedules', bad.active, { opsReasons: bad.reasons, opsWorkflows: bad.workflows, ageHours: bad.ageHours }, source);
  assert.equal(f.rows.length, 1);
  assert.equal(f.sent.length, 1);
  assert.equal(f.rows[0].title, '[alert] scheduled production operations not running');
  assert.match(f.sent[0].text, /approval_pending, backup_stale/);
  assert.match(f.sent[0].text, /119 h old/);
  await f.monitor.apply('ops-schedules', null, {}, 4);
  assert.equal(f.rows[0].state, 'open');
  await f.monitor.apply('ops-schedules', false, {}, 5);
  assert.equal(f.rows[0].state, 'closed');
  assert.equal(f.sent.length, 2);
});

test('only named reasons and workflow files reach the alert, never other text', () => {
  const facts = safeHealthFacts({ opsReasons: ['approval_pending', 'rm -rf', 'approval_pending'], opsWorkflows: ['backup-d1.yml', '../secret', 'x.yml'], ageHours: 119, token: 'private' });
  assert.deepEqual(facts, { ageHours: 119, opsReasons: ['approval_pending'], opsWorkflows: ['backup-d1.yml', 'x.yml'] });
  assert.match(message('ops-schedules', 'open', {}), /\(unavailable\)/);
});

test('the hourly job reads run records only: no environment, no production secret, actions: read', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/github-alerts.yml', import.meta.url), 'utf8');
  const job = workflow.split('\n  ops-schedules:\n')[1].split('\n  queue-deadline:\n')[0];
  assert.match(job, /github\.event\.schedule == '7 \* \* \* \*'/);
  assert.match(job, /actions: read/);
  assert.match(job, /github-alerts\.mjs ops-schedules/);
  assert.doesNotMatch(job, /environment:/);
  assert.deepEqual([...job.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]), ['SLACK_GITHUB_WEBHOOK_URL']);
});
