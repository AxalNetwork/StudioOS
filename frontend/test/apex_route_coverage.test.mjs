/** Durable coverage for the deliberately narrow Worker route table. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const wrangler = readFileSync(resolve(root, 'wrangler.toml'), 'utf8');

const APEX = 'axal.vc/';
const TABLES = ['routes', 'env.production.routes'];

/**
 * The whole production surface, as two Workers Custom Domains.
 *
 * This list used to read `app.axal.vc` plus three `axal.vc/...` path routes,
 * which was the table from BEFORE the apex cutover. `e1de44c2` ("Stop apex
 * Pages and Worker asset skew") completed that cutover: it deleted every
 * path route from `wrangler.toml`, leaving `axal.vc` and `app.axal.vc` as
 * whole-host custom domains, and rewrote this file in the same commit — but
 * the rewrite kept the old four-entry allowlist, so the toml and the guard
 * shipped disagreeing with each other and this test has been red on `main`
 * ever since. The toml is the deployed truth; this list now matches it.
 *
 * The cutover is the point, not an implementation detail. Serving the apex
 * and `app.axal.vc` from one Worker means one asset build behind both, which
 * is what ends the skew where each host sat at a different `docs/` bundle.
 * `custom_domain = true` binds the whole host, so the SPA asset binding
 * answers every unmatched path; a path-scoped route would take those URLs
 * away from the assets binding and break the SPA fallback, which is why the
 * third test below still refuses `axal.vc/*` and `axal.vc/assets/*`.
 */
const EXPECTED = [
  'axal.vc',
  'app.axal.vc',
];

/** No path-scoped apex route survives the cutover — derived, not hardcoded. */
const EXPECTED_APEX_PATHS = EXPECTED.filter((p) => p.startsWith(APEX));

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

test('both hosts are bound as custom domains and nothing else is Worker-routed', () => {
  for (const t of TABLES) {
    assert.deepEqual(
      patterns(t),
      EXPECTED,
      `${t} must contain only the two production custom domains`,
    );
    const apexPaths = patterns(t).filter((p) => p.startsWith(APEX));
    assert.deepEqual(
      apexPaths,
      EXPECTED_APEX_PATHS,
      `${t} contains an unexpected axal.vc path route`,
    );
  }
});

test('every entry is a whole-host custom domain, never a path route', () => {
  // The pairing matters as much as the pattern list: a `pattern` without
  // `custom_domain = true` is a zone route, and a zone route on either host
  // is what steals URLs from the assets binding.
  let current = null;
  let pending = null;
  const kinds = new Map();
  for (const raw of wrangler.split('\n')) {
    const line = raw.trim();
    const arrayHeader = /^\[\[([^\]]+)\]\]$/.exec(line);
    if (arrayHeader) { current = arrayHeader[1]; pending = null; continue; }
    if (line.startsWith('[')) { current = null; pending = null; continue; }
    if (!current || !TABLES.includes(current)) continue;
    const pat = /^pattern\s*=\s*"([^"]+)"/.exec(line);
    if (pat) { pending = `${current}:${pat[1]}`; kinds.set(pending, false); continue; }
    if (pending && /^custom_domain\s*=\s*true\b/.test(line)) kinds.set(pending, true);
  }
  for (const [entry, isCustomDomain] of kinds) {
    assert.equal(isCustomDomain, true, `${entry} is a zone route, not a custom domain`);
  }
});

test('the apex wildcard and assets prefix remain off the route table', () => {
  for (const table of TABLES) {
    assert.equal(patterns(table).includes('axal.vc/*'), false);
    assert.equal(patterns(table).includes('axal.vc/assets/*'), false);
  }
});
