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
 * This list used to read `app.axal.vc` plus three `axal.vc/...` path routes
 * (`/api/*`, `/landing/*`, `/p/*`): the PAGES cutover's table, written into
 * `wrangler.toml` and into this file by `e1de44c2` ("Stop apex Pages and
 * Worker asset skew", 2026-08-31 10:51Z), under which Cloudflare Pages served
 * the apex — correct at the time. (Attribution fixed 2026-09-03 from git; an
 * earlier version of this comment credited `e1de44c2` with the flip below.)
 * The flip came in `1d320dda9` (2026-09-01 09:08Z, author "Replit Agent",
 * message "Remove stale documentation asset files"): it replaced the three
 * path routes with a whole-host `axal.vc` custom domain in both tables,
 * leaving `axal.vc` and `app.axal.vc` as Workers Custom Domains, and touched
 * neither this file nor any documentation — a deployed-config change in a
 * commit whose message is about something else. The toml and this guard
 * therefore shipped disagreeing, and this test was red on `main` until #374
 * (2026-09-01) rewrote it. The toml is the deployed truth (the deploy log's
 * "Deployed studioos triggers: axal.vc (custom domain), app.axal.vc (custom
 * domain)" lines confirm it); this list matches it.
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

test('D1439: the record-card prefixes are [assets] run_worker_first globs in both lists, never route patterns', () => {
  // Mutation checked: a glob dropped from the production list → the per-list check fails; an `axal.vc/events/*` route → the pattern check fails.
  const CARD_GLOBS = ['/events/*', '/articles/*', '/jobs/*', '/u/*', '/startups/*', '/partners/*', '/authors/*', '/insights/public/*'];
  const lists = [...wrangler.matchAll(/^run_worker_first = (\[.*\])$/gm)].map((m) => JSON.parse(m[1]));
  assert.equal(lists.length, 2, 'the top-level and production [assets] blocks');
  for (const list of lists) for (const g of CARD_GLOBS) assert.ok(list.includes(g), `${g} runs the Worker first`);
  for (const table of TABLES) {
    for (const p of patterns(table)) assert.ok(!CARD_GLOBS.some((g) => p.endsWith(g)), `${p} would be a path-scoped route`);
  }
  // The Worker answers them from the one list it exports, so the toml and the code cannot drift.
  const service = readFileSync(resolve(root, 'cloudflare-worker/src/services/socialCards.ts'), 'utf8');
  const exported = /SOCIAL_CARD_GLOBS = \[([^\]]+)\]/.exec(service)?.[1].match(/'[^']+'/g)?.map((s) => s.slice(1, -1));
  assert.deepEqual(exported, CARD_GLOBS);
});

test('#3916 (D1439 Part D): the token-link prefixes are [assets] run_worker_first globs in both lists; /verify/* is not', () => {
  // Mutation checked: `/join/*` dropped from the top-level list → the per-list check fails; `/verify/*` added → the verify check fails.
  const PRIVATE_GLOBS = ['/esign/*', '/deck/share/*', '/share/*', '/invite/*', '/join/*'];
  const lists = [...wrangler.matchAll(/^run_worker_first = (\[.*\])$/gm)].map((m) => JSON.parse(m[1]));
  assert.equal(lists.length, 2, 'the top-level and production [assets] blocks');
  for (const list of lists) {
    for (const g of PRIVATE_GLOBS) assert.ok(list.includes(g), `${g} runs the Worker first`);
    assert.ok(!list.some((g) => g.startsWith('/verify')), 'certificate verification keeps the home card');
  }
  for (const table of TABLES) {
    for (const p of patterns(table)) assert.ok(!PRIVATE_GLOBS.some((g) => p.endsWith(g)), `${p} would be a path-scoped route`);
  }
  const service = readFileSync(resolve(root, 'cloudflare-worker/src/services/socialCards.ts'), 'utf8');
  const exported = /PRIVATE_LINK_GLOBS = \[([^\]]+)\]/.exec(service)?.[1].match(/'[^']+'/g)?.map((s) => s.slice(1, -1));
  assert.deepEqual(exported, PRIVATE_GLOBS);
});
