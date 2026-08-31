/** Durable coverage for the deliberately narrow Worker route table. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const wrangler = readFileSync(resolve(root, 'wrangler.toml'), 'utf8');

const APEX = 'axal.vc/';
const TABLES = ['routes', 'env.production.routes'];
const EXPECTED = [
  'app.axal.vc',
  'axal.vc/api/*',
  'axal.vc/landing/*',
  'axal.vc/p/*',
];

/**
 * Every `pattern` in every array-of-tables, keyed by header.
 *
 * The first version of this built a RegExp out of the table name and stripped
 * the wildcard marker with `String.replace`. CodeQL and Semgrep both flagged
 * it and both were right about the shape, even though neither input is
 * attacker-controlled: the escaping handled dots but not backslashes, and a
 * string `.replace` silently rewrites one occurrence rather than classifying.
 *
 * A line scanner tracking the current `[[header]]` needs neither a constructed
 * pattern nor an escape step, and it reads the file the way TOML actually
 * nests.
 */
function routeTables() {
  const tables = new Map();
  let current = null;
  for (const raw of wrangler.split('\n')) {
    const line = raw.trim();
    const arrayHeader = /^\[\[([^\]]+)\]\]$/.exec(line);
    if (arrayHeader) { current = arrayHeader[1]; continue; }
    // A plain `[table]` header ends the array-of-tables it followed.
    if (line.startsWith('[')) { current = null; continue; }
    const pat = /^pattern\s*=\s*"([^"]+)"/.exec(line);
    if (pat && current) {
      if (!tables.has(current)) tables.set(current, []);
      tables.get(current).push(pat[1]);
    }
  }
  return tables;
}

const TABLE_PATTERNS = routeTables();
const patterns = (table) => TABLE_PATTERNS.get(table) ?? [];

test('the two route tables are identical', () => {
  assert.deepEqual(
    patterns('env.production.routes'), patterns('routes'),
    'the production table has drifted from the top-level table',
  );
});

test('only the three durable apex path routes are Worker-routed', () => {
  for (const t of TABLES) {
    assert.deepEqual(
      patterns(t),
      EXPECTED,
      `${t} must contain only the custom domain and durable apex route allowlist`,
    );
    const apexPaths = patterns(t).filter((p) => p.startsWith(APEX));
    assert.deepEqual(
      apexPaths,
      EXPECTED.slice(1),
      `${t} contains an unexpected axal.vc path route`,
    );
  }
});

test('the apex wildcard and assets prefix remain on Cloudflare Pages', () => {
  for (const table of TABLES) {
    assert.equal(patterns(table).includes('axal.vc/*'), false);
    assert.equal(patterns(table).includes('axal.vc/assets/*'), false);
  }
});
