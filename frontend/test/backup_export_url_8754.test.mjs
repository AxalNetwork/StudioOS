// D8754 (#8754): `wrangler d1 export` prints a one-hour pre-signed link that downloads the whole production export,
// and this repository's run logs are public. The backup's export step withholds every URL wrangler prints.
//
// Run alone: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/backup_export_url_8754.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const YAML = createRequire(join(ROOT, 'cloudflare-worker', 'package.json'))('yaml');
const workflow = YAML.parse(readFileSync(join(ROOT, '.github/workflows/backup-d1.yml'), 'utf8'));
const steps = workflow.jobs.backup.steps;
const exporting = steps.filter((s) => /\bwrangler\s+d1\s+export\b/.test(s.run || ''));

/** The sed expression the export step pipes wrangler's output through, read from the workflow itself. */
function redaction(run) {
  const m = run.match(/\|\s*sed -E '([^']+)'/);
  assert.ok(m, 'the export step pipes wrangler through sed -E');
  return m[1];
}

test('only one step exports, and it fails when wrangler fails even through the pipe', () => {
  assert.equal(exporting.length, 1);
  const { run } = exporting[0];
  assert.match(run, /^set -o pipefail$/m);
  assert.ok(run.indexOf('set -o pipefail') < run.indexOf('wrangler d1 export'));
  // Both streams go through the redaction: a URL on stderr is withheld too.
  assert.match(run, /--output "\$\{BACKUP_FILENAME\}" 2>&1 \\\n\s*\| sed -E/);
});

test('the pre-signed export link wrangler prints is withheld, and the rest of its output is kept', () => {
  const expression = redaction(exporting[0].run);
  // The shape of the line that reached a public log on 2026-11-26, with every value invented.
  const leaked = [
    '🌀 Exporting SQL to backup-2026-11-26.sql',
    'You can also download your export from the following URL manually. This link will be valid for one hour: '
      + 'https://0123456789abcdef.eu.r2.cloudflarestorage.com/d1-sqlio-outgoing/abc.sql?X-Amz-Expires=3600&X-Amz-Signature=deadbeef',
    '🌀 Downloaded to backup-2026-11-26.sql successfully!',
    'see http://example.invalid/x and s3://bucket/key',
  ].join('\n');
  const r = spawnSync('sed', ['-E', expression], { input: leaked, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /X-Amz-|cloudflarestorage|https?:\/\/|s3:\/\//);
  assert.match(r.stdout, /valid for one hour: \[URL withheld\]$/m);
  assert.match(r.stdout, /Downloaded to backup-2026-11-26\.sql successfully!/);
  assert.match(r.stdout, /see \[URL withheld\] and \[URL withheld\]$/m);
});
