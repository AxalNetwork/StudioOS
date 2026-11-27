// D5610: shadow is PR-only, publishes a record, and never controls the gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const wf = readFileSync('.github/workflows/ci.yml', 'utf8');
const job = wf.slice(wf.indexOf('  selection-shadow:'), wf.indexOf('  classify:'));
test('shadow runs after suite on every PR and never on merge_group', () => {
  assert.match(job, /name: selection \(shadow\)/);
  assert.match(job, /needs: suite/);
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
