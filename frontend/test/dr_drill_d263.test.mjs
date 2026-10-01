/**
 * D263 — the restore drill, run against a fake `wrangler`.
 *
 * The drill failed four runs out of four and was about to fail a fifth on its
 * first command: it called `wrangler r2 object list`, which wrangler 4.131
 * does not have, and hid the error. Nothing it did was visible to the
 * platform, because it wrote nothing. These tests RUN scripts/dr-drill.sh
 * with a fake `wrangler` first on PATH that records every argument list and
 * answers like the real one, then assert what the script did: the marker it
 * wrote on every exit, `--remote` on every R2 call, the throwaway database
 * deleted on failure, and the exit code the marker cannot change. Same shape
 * as magic_link_probe.test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, chmodSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const SCRIPT = resolve(process.cwd(), 'scripts/dr-drill.sh');
const SRC = readFileSync(SCRIPT, 'utf8');
const WF = readFileSync(resolve(process.cwd(), '.github/workflows/dr-drill.yml'), 'utf8');
const KEY = 'd1/studioos-db/backup-2026-09-30.sql';

/**
 * A fake wrangler. Behaviour is chosen by env: FAIL_HEARTBEAT, FAIL_RESTORE,
 * FAIL_MARKER, ZERO_USERS. Every call is appended to calls.log as one
 * JSON array; the marker put copies its --file to marker.json.
 */
function fakeWrangler(dir) {
  const src = `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(join(dir, 'calls.log'))}, JSON.stringify(a) + '\\n');
const has = (x) => a.includes(x);
const fileArg = () => a[a.indexOf('--file') + 1];
const e = process.env;
if (a[0] === 'r2' && a[2] === 'get' && a[3].endsWith('/heartbeat-d1.json')) {
  if (e.FAIL_HEARTBEAT) { console.error('✘ [ERROR] The specified key does not exist.'); process.exit(1); }
  process.stdout.write(JSON.stringify({ at: '2026-09-30T02:10:00Z', source: 'gha', kind: 'd1', key: ${JSON.stringify(KEY)}, size_bytes: 4096 }));
  process.exit(0);
}
if (a[0] === 'r2' && a[2] === 'get') { fs.writeFileSync(fileArg(), 'CREATE TABLE users(id);'); process.exit(0); }
if (a[0] === 'r2' && a[2] === 'put') {
  if (e.FAIL_MARKER) { console.error('✘ [ERROR] put refused'); process.exit(1); }
  fs.copyFileSync(fileArg(), ${JSON.stringify(join(dir, 'marker.json'))});
  process.exit(0);
}
if (a[0] === 'd1' && a[1] === 'create') process.exit(0);
if (a[0] === 'd1' && a[1] === 'delete') process.exit(0);
if (a[0] === 'd1' && a[1] === 'execute' && has('--file')) process.exit(e.FAIL_RESTORE ? 1 : 0);
if (a[0] === 'd1' && a[1] === 'execute' && has('--command')) {
  const sql = a[a.indexOf('--command') + 1];
  if (/COUNT/.test(sql)) { console.log(JSON.stringify([{ results: [{ users: e.ZERO_USERS ? 0 : 3, projects: 2 }] }])); process.exit(0); }
  const names = ['users', 'projects', 'deals', 'score_snapshots', 'activity_logs', 'documents'];
  console.log(JSON.stringify([{ results: names.map((name) => ({ name })) }]));
  process.exit(0);
}
console.error('fake wrangler: unexpected call ' + a.join(' '));
process.exit(64);
`;
  writeFileSync(join(dir, 'wrangler'), src);
  chmodSync(join(dir, 'wrangler'), 0o755);
}

function drill(env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'd263-'));
  fakeWrangler(dir);
  writeFileSync(join(dir, 'calls.log'), '');
  const r = spawnSync('bash', [SCRIPT], {
    env: { PATH: `${dir}:${process.env.PATH}`, HOME: dir, BACKUP_BUCKET: 'studioos-backups', DR_DRILL_PREVIEW: '0', ...env },
    encoding: 'utf8',
  });
  const calls = readFileSync(join(dir, 'calls.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const markerPath = join(dir, 'marker.json');
  const marker = existsSync(markerPath) ? JSON.parse(readFileSync(markerPath, 'utf8')) : null;
  return { status: r.status, out: r.stdout + r.stderr, calls, marker };
}

test('D263 drill: a passing run writes a passed marker with the backup it restored, and exits 0', () => {
  const r = drill({ DRILL_SOURCE: 'gha', GITHUB_RUN_ID: '98765' });
  assert.equal(r.status, 0, r.out);
  assert.ok(r.marker, 'a passing run wrote no marker');
  assert.deepEqual(
    [r.marker.outcome, r.marker.exit_code, r.marker.step, r.marker.backup_key, r.marker.source, r.marker.run_id],
    ['passed', 0, 'teardown', KEY, 'gha', '98765'],
  );
  assert.match(r.marker.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(typeof r.marker.duration_s, 'number');
  assert.ok(r.calls.some((c) => c[0] === 'd1' && c[1] === 'delete'), 'the throwaway database was not deleted');
});

test('D263 drill: every R2 call names --remote, and the marker goes to drill-d1.json', () => {
  const r = drill();
  const r2 = r.calls.filter((c) => c[0] === 'r2');
  assert.ok(r2.length >= 3, 'the heartbeat read, the backup download and the marker put');
  for (const c of r2) assert.ok(c.includes('--remote'), `an R2 call without --remote reads local storage: ${c.join(' ')}`);
  const put = r2.filter((c) => c[2] === 'put');
  assert.deepEqual(put.map((c) => c[3]), ['studioos-backups/drill-d1.json']);
  // The key came from the heartbeat, not from a subcommand wrangler lacks.
  assert.equal(r2[0][3], 'studioos-backups/heartbeat-d1.json');
});

test('D263 drill: a failed restore exits 2, writes a failed marker naming the step, and still deletes the throwaway database', () => {
  const r = drill({ FAIL_RESTORE: '1' });
  assert.equal(r.status, 2, r.out);
  assert.deepEqual([r.marker?.outcome, r.marker?.step, r.marker?.exit_code, r.marker?.backup_key], ['failed', 'restore', 2, KEY]);
  assert.ok(r.calls.some((c) => c[0] === 'd1' && c[1] === 'delete'), 'a failed drill leaked its throwaway database');
});

test('D263 drill: an unreadable heartbeat fails at the first step, with no key and no database created', () => {
  const r = drill({ FAIL_HEARTBEAT: '1' });
  assert.equal(r.status, 1, r.out);
  assert.deepEqual([r.marker?.outcome, r.marker?.step, r.marker?.exit_code, r.marker?.backup_key], ['failed', 'find_backup', 1, null]);
  assert.ok(!r.calls.some((c) => c[0] === 'd1'), 'the drill went on past a missing key');
  assert.match(r.out, /The specified key does not exist/, 'wrangler\'s own error was thrown away');
});

test('D263 drill: a smoke failure exits 3 with a failed marker', () => {
  const r = drill({ ZERO_USERS: '1' });
  assert.equal(r.status, 3, r.out);
  assert.deepEqual([r.marker?.outcome, r.marker?.step], ['failed', 'smoke']);
});

test('D263 drill: a marker that cannot be written never changes the exit code', () => {
  assert.equal(drill({ FAIL_MARKER: '1' }).status, 0);
  assert.equal(drill({ FAIL_MARKER: '1', FAIL_RESTORE: '1' }).status, 2);
});

test('D263 drill: the script and its workflow no longer carry the four defects', () => {
  const code = SRC.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.doesNotMatch(code, /wrangler r2 object list/, 'a subcommand wrangler does not have');
  assert.doesNotMatch(code, /wrangler r2[^\n]*2>\/dev\/null/, 'wrangler\'s own error thrown away');
  assert.doesNotMatch(code, /npm run test:drift/, 'step 4c ran the whole repo suite against nothing restored');
  assert.doesNotMatch(code, /trap - EXIT/, 'the success path cleared the trap that writes the marker');
  assert.match(WF, /^\s+DR_DRILL_PREVIEW: '0'$/m, 'the preview step stays off until the preview env has real ids');
  // The pager step's `if:` reads a job-level flag it can see, not its own env.
  const notify = WF.slice(WF.indexOf('- name: Notify on failure'));
  assert.doesNotMatch(notify.split('\n')[1], /env\.PAGER_WEBHOOK_URL/, 'the pager step tests a variable its own if: cannot see');
  assert.match(WF, /^\s+PAGER_CONFIGURED: \$\{\{ secrets\.PAGER_WEBHOOK_URL != '' \}\}$/m);
});
