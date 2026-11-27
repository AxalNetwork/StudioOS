/** D6653: include credential-isolated independent file recovery fixtures in the standard Worker runner.
 *
 * From cloudflare-worker/test/README.md (moved by #6472): D6653: include independent file recovery
 * Python fixtures in the standard Worker runner.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('independent file recovery, encryption transport and heartbeat fixtures', () => {
  const result = spawnSync('python3', ['scripts/file_recovery_6653_test.py'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
