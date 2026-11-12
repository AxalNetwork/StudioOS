import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const workflow = readFileSync(new URL('../../.github/workflows/pr-preview.yml', import.meta.url), 'utf8');
const job = workflow.slice(workflow.indexOf('\n  delete:\n'));
const script = job.split('\n        run: |\n')[1].replace(/^ {10}/gm, '');

function cleanup(results, name = 'studioos-pr-123') {
  const dir = mkdtempSync(join(tmpdir(), 'pr-preview-cleanup-'));
  try {
    const record = join(dir, 'attempts');
    writeFileSync(record, '');
    for (const [file, body] of Object.entries({
      timeout: 'shift 2; exec "$@"',
      sleep: 'echo "sleep:$1"',
      npx: [
        'test "$*" = "--yes wrangler@4.125.0 delete $PREVIEW_NAME --force" || exit 2',
        'echo attempt >> "$FIXTURE_ATTEMPTS"',
        'count=$(awk \'END {print NR}\' "$FIXTURE_ATTEMPTS")',
        'case "$(cut -d, -f "$count" <<< "$FIXTURE_RESULTS")" in',
        '  ok) echo "Successfully deleted $PREVIEW_NAME"; exit 0 ;;',
        '  transient) echo "DELETE /accounts/***/workers/services/$PREVIEW_NAME -> 503 Service Unavailable"; exit 1 ;;',
        '  absent) echo "This Worker does not exist. [code: 10007]"; exit 1 ;;',
        '  refused) echo "Authentication error [code: 10000]"; exit 1 ;;',
        '  missing-command) echo "npm package not found"; exit 1 ;;',
        'esac',
      ].join('\n'),
    })) {
      const path = join(dir, file);
      writeFileSync(path, '#!/bin/bash\n' + body + '\n');
      chmodSync(path, 0o700);
    }
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
      encoding: 'utf8',
      env: {
        ...process.env, PATH: dir + ':' + process.env.PATH, PREVIEW_NAME: name,
        FIXTURE_ATTEMPTS: record, FIXTURE_RESULTS: results.join(','),
      },
    });
    return { ...result, attempts: readFileSync(record, 'utf8').split('\n').filter(Boolean).length };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('preview close cleanup retries a Cloudflare 503, including a lost successful response', () => {
  for (const second of ['ok', 'absent']) {
    const run = cleanup(['transient', second]);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.equal(run.attempts, 2);
    assert.match(run.stdout, /sleep:5/);
  }
  const absent = cleanup(['absent']);
  assert.equal(absent.status, 0, absent.stdout);
  assert.equal(absent.attempts, 1);
});

test('preview close cleanup bounds retries and reports the preview and next action', () => {
  const run = cleanup(['transient', 'transient', 'transient']);
  assert.equal(run.status, 1, run.stdout);
  assert.equal(run.attempts, 3);
  assert.match(run.stdout, /sleep:5[\s\S]*sleep:10/);
  assert.match(run.stdout, /studioos-pr-123 cleanup failed after 3\/3 attempts\. Retry this job/);
});

test('preview close cleanup fails immediately on permanent errors and rejects non-preview names', () => {
  for (const error of ['refused', 'missing-command']) {
    const run = cleanup([error]);
    assert.equal(run.status, 1, run.stdout);
    assert.equal(run.attempts, 1);
    assert.doesNotMatch(run.stdout, /sleep:/);
    assert.match(run.stdout, /studioos-pr-123 cleanup failed on attempt 1\/3/);
  }
  const invalid = cleanup(['ok'], 'studioos');
  assert.equal(invalid.status, 1, invalid.stdout);
  assert.equal(invalid.attempts, 0);
});
