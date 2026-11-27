/** D6428: include the synthetic-only Python recovery regressions in the standard Worker test runner.
 *
 * From cloudflare-worker/test/README.md (moved by #6472): D6428: runs synthetic-only Python
 * recovery regressions through the standard Worker test suite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('file recovery: approved classes, prefix locks, immutable snapshots, corruption and suppression', () => {
  const r=spawnSync('python3',['scripts/file_recovery_6428_test.py'],{encoding:'utf8'});
  assert.equal(r.status,0,r.stdout+r.stderr);
});
