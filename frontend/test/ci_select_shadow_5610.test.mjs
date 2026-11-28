// D5610: shadow is PR-only, publishes a record, and never controls the gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { STALE_COMMITS } from '../../scripts/lib/selectTests.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const wf = readFileSync('.github/workflows/ci.yml', 'utf8');
const job = wf.slice(wf.indexOf('  selection-shadow:'), wf.indexOf('  classify:'));
test('shadow runs after suite on every PR and never on merge_group', () => {
  assert.match(job, /name: selection \(shadow\)/);
  assert.match(job, /needs: \[suite, classify\]/);
  assert.match(job, /if: always\(\) && github.event_name == 'pull_request'/);
  assert.match(job, /continue-on-error: true/);
  assert.match(job, /exit 0/);
  assert.match(job, /name: selection-shadow-\$\{\{ github.run_id \}\}/);
  const gate = wf.slice(wf.indexOf('  gate:'), wf.indexOf('  selection-shadow:'));
  assert.doesNotMatch(gate, /needs:[^\n]*selection-shadow/);
});
test('missing traces and failure artifacts create a full, unscored record', () => {
  const dir = mkdtempSync(join(tmpdir(), 's38-shadow-'));
  try {
    const output = join(dir, 'record.json');
    const r = spawnSync(process.execPath, ['scripts/select-tests.mjs', '--deps', join(dir, 'missing.json'), '--failures', dir, '--output', output], { encoding: 'utf8', env: { ...process.env, BASE_SHA: '0'.repeat(40) } });
    assert.equal(r.status, 0, r.stderr);
    const record = JSON.parse(readFileSync(output));
    assert.equal(record.mode, 'full');assert.equal(record.scoring, 'unscored');assert.equal(record.misses, null);
    assert.ok(record.files.length > 3000);
    const report = spawnSync(process.execPath, ['scripts/select-tests.mjs', '--report', dir], { encoding: 'utf8' });
    assert.equal(report.status, 0);assert.equal(JSON.parse(report.stdout).unscored, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('D5610-p3: the shadow waits for the verdict and reads only this attempt\'s classified record', () => {
  // `classify` must stay outside the gate too, and must not wait on the shadow (no cycle).
  const classify = wf.slice(wf.indexOf('  classify:'), wf.indexOf('\n  # ---', wf.indexOf('  classify:')));
  assert.doesNotMatch(classify, /selection-shadow/);
  assert.match(job, /name: ci-failures-classified-attempt-\$\{\{ github\.run_attempt \}\}/);
  assert.doesNotMatch(job, /pattern: ci-failures-\*/);
});
test('D5610-p3: the trace lookup is by exact name along the base line, never a capped artifact page', () => {
  assert.match(job, /BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(job, new RegExp(`git rev-list --first-parent --max-count=${STALE_COMMITS + 1} "\\$BASE_SHA"`));
  assert.match(job, /actions\/artifacts\?name=test-deps-\$sha&/);
  assert.doesNotMatch(job, /actions\/artifacts\?per_page/);
  assert.doesNotMatch(job, /commits\?sha=main/);
});
test('D5610-p3: --trace-artifact picks the newest trace at or before the base from the lookup files', () => {
  const dir = mkdtempSync(join(tmpdir(), 's38-trace-'));
  try {
    const [base, parent, newer] = ['b', 'a', 'c'].map((c) => c.repeat(40));
    writeFileSync(join(dir, 'line.txt'), `${base}\n${parent}\n`);
    mkdirSync(join(dir, 'lookup'));
    const row = (id, sha) => ({ id, name: `test-deps-${sha}`, created_at: '2026-11-27T10:00:00Z', expired: false, workflow_run: { head_sha: sha } });
    writeFileSync(join(dir, 'lookup', `${base}.json`), JSON.stringify({ total_count: 0, artifacts: [] }));
    writeFileSync(join(dir, 'lookup', `${parent}.json`), JSON.stringify({ total_count: 1, artifacts: [row(42, parent)] }));
    writeFileSync(join(dir, 'lookup', `${newer}.json`), JSON.stringify({ total_count: 1, artifacts: [row(43, newer)] }));
    const r = spawnSync(process.execPath, ['scripts/select-tests.mjs', '--trace-artifact', join(dir, 'line.txt'), join(dir, 'lookup')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { id: 42, created_at: '2026-11-27T10:00:00Z', sha: parent, ageCommits: 1 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
