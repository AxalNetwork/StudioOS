/**
 * D5532 part 2 (#5532): the production Worker never uploads source maps.
 *
 * Wrangler 4.x loads and uploads source maps whenever `upload_source_maps` is
 * unset; only an explicit `false` skips them. Cloudflare refuses a publish
 * whose maps exceed 15 MiB gzipped (code 10021), and every publish from
 * 2026-11-13 failed that way. This pins the key at the top level (which
 * `--env production` inherits) and forbids any section turning it back on.
 *
 *   node --test cloudflare-worker/test/worker_source_maps_5532.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const toml = readFileSync(resolve(import.meta.dirname, '../../wrangler.toml'), 'utf8');
const lines = toml.split(/\r?\n/);
const firstTable = lines.findIndex((line) => /^\s*\[/.test(line));
const keyLines = lines.map((line, i) => ({ line: line.trim(), i })).filter(({ line }) => /^upload_source_maps\s*=/.test(line));

test('D5532: upload_source_maps = false is a top-level key, above the first table', () => {
  const top = keyLines.filter(({ i }) => i < firstTable);
  assert.deepEqual(top.map(({ line }) => line), ['upload_source_maps = false']);
});

test('D5532: no section of wrangler.toml turns source-map upload back on', () => {
  assert.deepEqual(keyLines.filter(({ line }) => !/^upload_source_maps\s*=\s*false\b/.test(line)).map(({ line, i }) => `${i + 1}: ${line}`), []);
  assert.doesNotMatch(readFileSync(resolve(import.meta.dirname, '../../.github/workflows/cloudflare-worker-deploy.yml'), 'utf8'), /--upload-source-maps/);
});

test('D5532: the installed Wrangler skips source maps only for an explicit false', () => {
  // The behaviour this config depends on, read from the pinned Wrangler itself.
  const cli = readFileSync(resolve(import.meta.dirname, '../node_modules/wrangler/wrangler-dist/cli.js'), 'utf8');
  assert.match(cli, /const sourceMaps = uploadSourceMaps === false \? void 0 : loadSourceMaps\(/);
  assert.match(cli, /uploadSourceMaps: config2\.upload_source_maps,/);
});
