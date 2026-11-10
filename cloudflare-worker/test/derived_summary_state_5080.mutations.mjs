/** D5080 mutation checks: completeness must change when a source fails. */
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('..', import.meta.url));
const sourcePath = join(root, 'src/services/derivedSummaryState.ts');
test('the focused suite kills a mutation that treats failed sources as answered', () => {
  const dir = mkdtempSync(join(tmpdir(), 'd5080-'));
  try {
    const source = readFileSync(sourcePath, 'utf8').replace(
      "const failed = (state: SourceState) => state === 'unreadable' || state === 'unavailable';",
      'const failed = (_state: SourceState) => false;',
    );
    assert.notEqual(source, readFileSync(sourcePath, 'utf8'));
    writeFileSync(join(dir, 'derivedSummaryState.ts'), source);
    writeFileSync(join(dir, 'assert.mjs'), [
      "import assert from 'node:assert/strict';",
      "import { derivedSummary } from './derivedSummaryState.ts';",
      "assert.equal(derivedSummary([], [{ key: 'prospects', state: 'recorded' }, { key: 'commitments', state: 'unreadable' }]).state, 'partial');",
    ].join('\n'));
    const run = spawnSync(process.execPath, ['--experimental-strip-types', join(dir, 'assert.mjs')], { encoding: 'utf8' });
    assert.notEqual(run.status, 0, 'the mutated contract unexpectedly passed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
