/** D6514 (#6514): scanner SARIF has a separate bounded input budget; invalid input never publishes a baseline. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const MIB = 1024 * 1024;
const sarif = JSON.stringify({ runs: [{ results: [{ ruleId: 'js/synthetic',
  locations: [{ physicalLocation: { artifactLocation: { uri: 'private/synthetic-source.ts' } } }],
  message: { text: 'PRIVATE_SYNTHETIC_EXCERPT' },
}] }] });

function fixture(run) {
  const dir = mkdtempSync(join(tmpdir(), 'codeql-snapshot-6514-'));
  const input = join(dir, 'input.sarif'), output = join(dir, 'snapshot.json');
  const scan = () => spawnSync(process.execPath, ['scripts/scan-scope.mjs', 'snapshot', 'codeql', input, output], {
    encoding: 'utf8', env: { ...process.env, GITHUB_REPOSITORY: 'synthetic/repo', GITHUB_RUN_ID: '123' },
  });
  const padded = bytes => {
    writeFileSync(input, sarif);
    const spaces = Buffer.alloc(MIB, ' ');
    for (let left = bytes - Buffer.byteLength(sarif); left > 0; left -= Math.min(left, spaces.length)) {
      appendFileSync(input, spaces.subarray(0, Math.min(left, spaces.length)));
    }
  };
  try { run({ input, output, scan, padded }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

test('valid SARIF beyond the event/state budget retains the same opaque findings', () => fixture(({ input, output, scan, padded }) => {
  writeFileSync(input, sarif);
  const small = scan();
  assert.equal(small.status, 0, small.stderr);
  const expected = JSON.parse(readFileSync(output, 'utf8'));
  rmSync(output);
  padded(8 * MIB + 1);
  const large = scan();
  assert.equal(large.status, 0, large.stderr);
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), expected);
  assert.equal(expected.current.length, 1);
  assert.equal(expected.current[0].rule, 'js/synthetic');
  assert.doesNotMatch(readFileSync(output, 'utf8'), /private|PRIVATE_SYNTHETIC_EXCERPT/);
}));

test('the SARIF byte ceiling is inclusive and its overflow fails without a partial snapshot', () => fixture(({ output, scan, padded }) => {
  padded(64 * MIB);
  assert.equal(scan().status, 0);
  rmSync(output);
  padded(64 * MIB + 1);
  const result = scan();
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(output), false);
  assert.match(result.stderr, /byte limit/);
  assert.doesNotMatch(result.stderr, /private|PRIVATE_SYNTHETIC_EXCERPT/);
}));

test('malformed JSON and missing finding identity remain failures without leaking input', () => fixture(({ input, output, scan }) => {
  for (const content of ['PRIVATE_SYNTHETIC_EXCERPT is not JSON', JSON.stringify({ runs: [{ results: [{ ruleId: 'js/synthetic' }] }] })]) {
    writeFileSync(input, content);
    const result = scan();
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(output), false);
    assert.doesNotMatch(result.stderr, /PRIVATE_SYNTHETIC_EXCERPT/);
  }
}));
