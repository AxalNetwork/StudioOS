/**
 * Apex route coverage (Phase 0).
 *
 * `wrangler.toml` has no `axal.vc/*` — the first apex-wide attempt was rolled
 * back after edge 504s (documentation/architecture/CLOUDFLARE-CUTOVER.md), so the apex is served by an
 * EXPLICIT route table instead. A path is served only if it is listed.
 *
 * That makes an omission invisible in exactly the wrong way. An unlisted path
 * still resolves today, because GitHub Pages serves `docs/` directly and the
 * prerendered file is sitting right there. It stops resolving the moment Pages
 * is decommissioned — which is the stated end state of the cutover. So the
 * failure does not appear when the route is dropped; it appears weeks later,
 * during the DNS change, on the pages nobody re-checks.
 *
 * When this check was written, nine prerendered routes were missing from both
 * tables: /changelog, /demo, /pricing, /pricing/investor, /privacy,
 * /risk-disclosures, /roadmap, /status and /terms. Three of those are the
 * legal pages.
 *
 * Prerendering is the signal used here on purpose: a route is prerendered
 * precisely so a crawler hitting the APEX gets real HTML with an OG block.
 * Prerendering a route and not routing it is self-contradictory.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(process.cwd());
const wrangler = readFileSync(resolve(root, 'wrangler.toml'), 'utf8');

const APEX = 'axal.vc/';
const TABLES = ['routes', 'env.production.routes'];

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
 * nests. Verified against `tomllib`: 84 patterns per table, both identical.
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

/**
 * Top-level segment of an apex pattern, or null when there isn't one.
 *
 * The wildcard is a distinct CASE, not a character to strip. The previous
 * `.replace('*', '')` turned `axal.vc/*` into an empty string that the caller
 * then skipped — right answer, reached by accident, and unreadable as intent.
 * Returning null says it.
 */
function apexSegment(pattern) {
  if (!pattern.startsWith(APEX)) return null;   // app.axal.vc custom domain
  const first = pattern.slice(APEX.length).split('/')[0].trim();
  if (!first || first === '*') return null;     // the apex wildcard itself
  return first;
}

function coveredSegments(table) {
  const out = new Set();
  for (const p of patterns(table)) {
    const seg = apexSegment(p);
    if (seg) out.add(seg);
  }
  return out;
}

/** Routes the build prerenders into docs/<route>/index.html. */
function prerenderedRoutes() {
  const docs = resolve(root, 'docs');
  const found = [];
  const walk = (dir, rel, depth) => {
    if (depth > 3) return;
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.') || name === 'assets') continue;
      const abs = join(dir, name);
      let st;
      try { st = statSync(abs); } catch { continue; }
      if (!st.isDirectory()) continue;
      const here = `${rel}/${name}`;
      if (existsSync(join(abs, 'index.html'))) found.push(here);
      walk(abs, here, depth + 1);
    }
  };
  walk(docs, '', 1);
  return found.sort();
}

test('the apex table has no wildcard — so coverage has to be explicit', () => {
  // If a future change adds `axal.vc/*`, this test's premise is gone and the
  // rest of it becomes noise. Fail loudly instead of passing vacuously.
  for (const t of TABLES) {
    assert.equal(
      patterns(t).includes('axal.vc/*'), false,
      `${t} gained an apex wildcard — delete this file's per-route checks and say so in documentation/architecture/CLOUDFLARE-CUTOVER.md`,
    );
  }
});

test('every prerendered route is routed to the Worker at the apex', () => {
  const routes = prerenderedRoutes();
  assert.ok(routes.length >= 25, `expected the prerender set, found ${routes.length}`);
  for (const table of TABLES) {
    const covered = coveredSegments(table);
    const missing = routes.filter((r) => !covered.has(r.split('/').filter(Boolean)[0]));
    assert.deepEqual(
      missing, [],
      `[[${table}]] does not serve these prerendered routes; they survive today only because GitHub Pages does`,
    );
  }
});

test('the two route tables are identical', () => {
  // CLAUDE.md: every binding goes into BOTH tables. `npm run deploy` passes
  // --env production, so a route added only to the top-level table is a route
  // that does not exist in production — and the top-level table is the one a
  // reader is most likely to edit.
  assert.deepEqual(
    patterns('env.production.routes'), patterns('routes'),
    'the production table has drifted from the top-level table',
  );
});

test('the legal pages are reachable at the apex', () => {
  // Named individually because these are the ones a regulator follows a link
  // to, and the ones least likely to be clicked internally before a cutover.
  for (const table of TABLES) {
    const covered = coveredSegments(table);
    for (const seg of ['terms', 'privacy', 'risk-disclosures']) {
      assert.ok(covered.has(seg), `${seg} must be served at the apex (${table})`);
    }
  }
});

test('each apex prefix is listed in both the bare and the subtree form', () => {
  // `axal.vc/pricing` does not match `/pricing/investor`, and `axal.vc/pricing/*`
  // does not match `/pricing`. Listing one without the other half-serves the
  // route, which reads as working until someone opens the other URL.
  // Three principled exceptions, listed rather than pattern-matched so adding a
  // fourth is a deliberate edit and not a widened regex:
  //
  //   /api, /assets  — subtree-only namespaces. Nothing is served AT `/api`;
  //                    a bare route would hand the SPA shell to a caller who
  //                    asked for the API root.
  //   security.txt   — one fixed document at one URL. `security.txt/*` is
  //                    meaningless.
  const SUBTREE_ONLY = new Set(['axal.vc/api/*', 'axal.vc/assets/*']);
  const BARE_ONLY = new Set(['axal.vc/.well-known/security.txt']);
  for (const table of TABLES) {
    const pats = new Set(patterns(table).filter((p) => p.startsWith('axal.vc/')));
    for (const p of pats) {
      if (SUBTREE_ONLY.has(p) || BARE_ONLY.has(p)) continue;
      if (p.endsWith('/*')) {
        const bare = p.slice(0, -2);
        assert.ok(pats.has(bare), `${p} has no bare counterpart ${bare} in ${table}`);
      } else {
        assert.ok(pats.has(`${p}/*`), `${p} has no subtree counterpart ${p}/* in ${table}`);
      }
    }
  }
});
