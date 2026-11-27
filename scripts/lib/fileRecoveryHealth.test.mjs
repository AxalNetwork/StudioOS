/** D6653: freshness/failure, metadata privacy and once-per-episode alert fixtures. */
/** D6653: heartbeat freshness, failures, privacy and once-per-episode alert fixtures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileRecoveryHealth, latestFileSnapshotRun, FILE_BACKUP_INTERVAL_MS } from './fileRecoveryHealth.mjs';
import { createHealthMonitor, safeHealthFacts } from '../health-alert-episodes.mjs';
const now = Date.UTC(2026, 10, 18, 12);
const heartbeat = { schema_version: 1, kind: 'file_recovery', at: new Date(now).toISOString(), run_id: '100', run_attempt: 1,
  outcome: 'success', independent: 'verified', object_count: 2, byte_count: 80, newest_key_at: null, newest_key_at_status: 'unavailable' };
const state = (patch = {}) => fileRecoveryHealth({ enabled: true, independentRequired: true, observation: { read: 'ok', heartbeat }, now, ...patch });

test('synthetic proofs and branch runs cannot replace the live snapshot observation', () => {
  const snapshot = { id: 1, head_branch: 'main', event: 'schedule', path: '.github/workflows/file-recovery.yml', display_title: 'Approved file recovery snapshot' };
  const proof = { ...snapshot, id: 2, event: 'workflow_dispatch', display_title: 'Synthetic independent file proof' };
  assert.equal(latestFileSnapshotRun([proof, { ...snapshot, head_branch: 'feature' }, { ...snapshot, event: 'push' }, { ...snapshot, path: 'other.yml' }, snapshot]), snapshot);
  assert.equal(latestFileSnapshotRun([proof]), undefined);
});

test('healthy and exactly two intervals old are healthy; strictly older raises a missed run', () => {
  assert.deepEqual(state(), { active: false, reason: 'healthy', ageHours: 0, objectCount: 2, byteCount: 80 });
  assert.equal(state({ now: now + 2 * FILE_BACKUP_INTERVAL_MS }).active, false);
  assert.equal(state({ now: now + 2 * FILE_BACKUP_INTERVAL_MS + 1 }).reason, 'missed_run');
  assert.equal(state({ now: now + 2 * FILE_BACKUP_INTERVAL_MS + 1 }).active, true);
});
test('a failed heartbeat or same-run failure raises even when the heartbeat is fresh', () => {
  assert.equal(state({ observation: { read: 'ok', heartbeat: { ...heartbeat, outcome: 'failure', object_count: null, byte_count: null } } }).reason, 'run_reported_failure');
  for (const conclusion of ['failure', 'timed_out', 'cancelled', 'action_required']) {
    assert.equal(state({ latestRun: { id: 100, conclusion, updated_at: heartbeat.at } }).reason, 'run_failed');
  }
  assert.equal(state({ latestRun: { id: 99, conclusion: 'failure', updated_at: new Date(now - 1000).toISOString() } }).active, false);
});
test('unreadable evidence cannot recover; a proven failed run still raises without a heartbeat', () => {
  assert.deepEqual(state({ observation: { read: 'unavailable' } }), { active: null, reason: 'unavailable' });
  assert.equal(state({ observation: { read: 'missing' } }).reason, 'heartbeat_missing');
  assert.equal(state({ observation: { read: 'invalid' } }).reason, 'heartbeat_invalid');
  assert.equal(state({ observation: { read: 'unavailable' }, latestRun: { id: 101, conclusion: 'failure' } }).reason, 'run_failed');
  assert.equal(state({ enabled: false }).active, null);
});
test('invalid dates, future markers and invented counters cannot look healthy', () => {
  for (const patch of [{ at: 'not a date' }, { at: new Date(now + 6 * 60000).toISOString() }, { object_count: null }, { byte_count: -1 },
    { schema_version: 2 }, { run_id: '' }, { run_attempt: 0 }, { outcome: 'unknown' }]) {
    assert.equal(state({ observation: { read: 'ok', heartbeat: { ...heartbeat, ...patch } } }).reason, 'heartbeat_invalid');
  }
  assert.equal(state({ observation: { read: 'ok', heartbeat: { ...heartbeat, object_count: 0, byte_count: 0 } } }).active, false);
});
test('configured independence is required, but an explicitly unconfigured optional copy is distinct', () => {
  const observation = { read: 'ok', heartbeat: { ...heartbeat, independent: 'not_configured' } };
  assert.equal(state({ observation }).reason, 'copy_missing');
  assert.equal(state({ observation, independentRequired: false }).active, false);
});
function fixture() {
  const rows = [], sent = [];
  const api = async (path, init = {}) => {
    const body = init.body && JSON.parse(init.body);
    if (init.method === 'POST') { const row = { ...body, number: rows.length + 1, state: 'open', user: { login: 'github-actions[bot]' } }; rows.push(row); return structuredClone(row); }
    if (init.method === 'PATCH') {
      const index = rows.findIndex(row => row.number === Number(path.split('/').at(-1)));
      rows[index] = { ...rows[index], ...body };
      return structuredClone(rows[index]);
    }
    return structuredClone(rows.filter(row => path.includes('state=all') || row.state === 'open'));
  };
  const monitor = createHealthMonitor({ repo: 'AxalNetwork/StudioOS', api, now: () => now,
    deliver: async value => { sent.push(value); return { state: 'acknowledged', receipt: { transport: 'webhook', status: 200 } }; } });
  return { rows, sent, monitor };
}
test('a missed and a failed run each open once, repeat observations do not spam, healthy opens none', async () => {
  const f = fixture();
  await f.monitor.apply('file-backup', false, { backupReason: 'healthy' }, 1);
  assert.equal(f.rows.length, 0); assert.equal(f.sent.length, 0);
  const missed = state({ now: now + 2 * FILE_BACKUP_INTERVAL_MS + 1 });
  for (const source of [2, 3, 4]) await f.monitor.apply('file-backup', missed.active, { backupReason: missed.reason }, source);
  assert.equal(f.rows.length, 1); assert.equal(f.sent.length, 1); assert.match(f.rows[0].body, /missed_run/);
  assert.equal(f.rows[0].title, '[alert] file recovery backup unhealthy');
  assert.match(f.sent[0].text, /File recovery backup unhealthy/);
  await f.monitor.apply('file-backup', null, {}, 5); assert.equal(f.rows[0].state, 'open');
  await f.monitor.apply('file-backup', false, { backupReason: 'healthy' }, 6); assert.equal(f.rows[0].state, 'closed');
  for (const source of [7, 8]) await f.monitor.apply('file-backup', true, { backupReason: 'run_failed' }, source);
  assert.equal(f.rows.length, 2); assert.equal(f.sent.length, 3); assert.match(f.rows[1].body, /run_failed/);
});
test('only bounded metadata belongs in alert facts', () => {
  const facts = safeHealthFacts({ backupReason: 'run_failed', objectCount: 2, byteCount: 80, ageHours: 49,
    bucket: 'private', key: 'private', token: 'private', message: 'private' });
  assert.deepEqual(facts, { objectCount: 2, byteCount: 80, ageHours: 49, backupReason: 'run_failed' });
  assert.equal(safeHealthFacts({ backupReason: 'private key' }).backupReason, undefined);
});
test('the live checker and preview drills are isolated and failure heartbeat cleanup always run', () => {
  const read = name => readFileSync(new URL('../../' + name, import.meta.url), 'utf8');
  const snapshot = read('.github/workflows/file-recovery.yml');
  assert.match(snapshot, /id: primary/); assert.match(snapshot, /id: independent/);
  assert.match(snapshot, /Record run heartbeat, including failures\n\s+if: always\(\)/);
  assert.match(snapshot, /Remove private plaintext staging\n\s+if: always\(\)/);
  const proof = snapshot.slice(snapshot.indexOf('  synthetic-proof:'));
  assert.match(proof, /vars.FILE_DR_PREVIEW_ENABLED/); assert.match(proof, /vars.FILE_DR_PREVIEW_BUCKET/);
  assert.match(proof, /secrets.FILE_DR_PREVIEW_COPY_ACCESS_KEY_ID/); assert.match(proof, /secrets.FILE_DR_PREVIEW_RESTORE_ACCESS_KEY_ID/);
  assert.doesNotMatch(proof, /FILE_RECOVERY_SOURCE|CLOUDFLARE_API_TOKEN|secrets.FILE_DR_COPY_ACCESS_KEY_ID/);
  const monthly = read('.github/workflows/dr-drill.yml').split('  independent-file-drill:')[1];
  assert.match(monthly, /vars.FILE_DR_PREVIEW_BUCKET/); assert.match(monthly, /file-recovery-independent.py drill/);
  const alert = read('.github/workflows/github-alerts.yml').split('  file-backup:')[1];
  assert.match(alert, /github-alerts.mjs file-backup/); assert.match(alert, /FILE_RECOVERY_HEALTH_ACCESS_KEY_ID/);
  assert.doesNotMatch(alert, /FILE_RECOVERY_SOURCE|FILE_DR_COPY_SECRET|CLOUDFLARE_API_TOKEN/);
  const cli = read('scripts/github-alerts.mjs'); assert.match(cli, /mode === 'file-backup'/); assert.match(cli, /fileRecoveryHealth\(/);
});
