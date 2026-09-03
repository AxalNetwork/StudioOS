/**
 * `CLAUDE.md` fact 4 must agree with `wrangler.toml` about who serves the apex.
 *
 * It did not, for two days. `e1de44c2f` (2026-08-31) cut the apex over to
 * Cloudflare Pages and #371 wrote fact 4 against that route table, correctly.
 * `1d320dda9` (2026-09-01, author "Replit Agent", message "Remove stale
 * documentation asset files") replaced the apex path routes with a whole-host
 * `axal.vc` Workers Custom Domain in both tables and touched no document — so
 * until 2026-09-03 the file that "wins every disagreement" described Pages as
 * the apex while the toml, both guard tests and every deploy log said the
 * Worker. Anyone "fixing" the toml to match the document would have taken the
 * apex down. documentation/architecture/DECISIONS.md D34 has the record.
 *
 * Who serves a host is settled by the deploy log's "Deployed studioos
 * triggers" lines, never by prose (until 2026-09-03 the Pages dashboard's
 * Domains line was the second check; the mirror is retired); this file only
 * makes sure the prose stops contradicting them. Four checks:
 *
 *   1. fact 4 names both `axal.vc` and `app.axal.vc` as Workers Custom Domains
 *      and never claims, in the present tense, that Pages or GitHub Pages
 *      serves the apex;
 *   2. `wrangler.toml` binds both hosts with `custom_domain = true` in both
 *      route tables (apex_route_coverage.test.mjs pins that nothing else is
 *      there, and that each entry is a custom domain rather than a zone route);
 *   3. no live document — CLAUDE.md, README.md, SECURITY.md,
 *      documentation/architecture/*.md, documentation/operations/*.md,
 *      .github/workflows/*.yml — reclaims the apex for Pages, except on a
 *      line that marks itself as history ("superseded", "historical", "was",
 *      "used to", or the one day it was true, 2026-08-31). Dated records
 *      stay; present-tense claims do not;
 *   4. the Cloudflare Pages mirror stays retired (2026-09-03, DECISIONS.md
 *      D36): no workflow runs `wrangler pages deploy`, the Pages Advanced Mode
 *      entry `frontend/public/_worker.js` does not come back, the build no
 *      longer writes a `.assetsignore` to hide it, and the static security
 *      headers live in `frontend/public/_headers` — read natively by Workers
 *      static assets — with the same values as `securityHeaders.ts`, so the
 *      two cannot drift apart again (GOTCHAS records that happening twice).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const at = (p) => readFileSync(resolve(root, p), 'utf8');

// ---------- 1. CLAUDE.md fact 4 ----------

const FACTS_HEADING = '## The four facts';
const NEXT_HEADING = '## File map';

/** The text of fact 4: from its list marker to the heading that follows the list. */
function factFour() {
  const claude = at('CLAUDE.md');
  const start = claude.indexOf(FACTS_HEADING);
  const end = claude.indexOf(NEXT_HEADING);
  assert.ok(start !== -1 && end > start, `CLAUDE.md must keep "${FACTS_HEADING}" ahead of "${NEXT_HEADING}"`);
  const facts = claude.slice(start, end);
  const item = facts.search(/^4\. /m);
  assert.notEqual(item, -1, 'CLAUDE.md must keep a numbered fact 4');
  return facts.slice(item);
}

/**
 * Present-tense claims that another host serves the apex. Narrating the past
 * ("Cloudflare Pages served the apex on 2026-08-31") is not a claim and passes.
 */
const ANOTHER_HOST_SERVES_THE_APEX = [
  /\bPages (?:owns|serves|hosts) the apex\b/i,
  /\bserved by (?:Cloudflare |GitHub )?Pages\b/i,
  /\bGitHub Pages frontend\b/i,
  /\bapex (?:is|remains|stays) on (?:Cloudflare |GitHub )?Pages\b/i,
];

test('CLAUDE.md fact 4 names both axal.vc and app.axal.vc as Workers Custom Domains', () => {
  const fact = factFour();
  assert.match(fact, /`axal\.vc`/, 'fact 4 must name `axal.vc`');
  assert.match(fact, /`app\.axal\.vc`/, 'fact 4 must name `app.axal.vc`');
  assert.match(fact, /Workers Custom Domains?/, 'fact 4 must call them Workers Custom Domains');
  assert.match(fact, /custom_domain = true/, 'fact 4 must cite the `custom_domain = true` binding');
});

test('CLAUDE.md fact 4 never claims Pages or GitHub Pages serves the apex', () => {
  const fact = factFour();
  for (const claim of ANOTHER_HOST_SERVES_THE_APEX) {
    assert.doesNotMatch(fact, claim, `fact 4 claims another host serves the apex (${claim})`);
  }
});

// ---------- 2. wrangler.toml ----------

const TABLES = ['routes', 'env.production.routes'];
const HOSTS = ['axal.vc', 'app.axal.vc'];

/**
 * Every `pattern` in the two route tables, mapped to whether a
 * `custom_domain = true` line follows it. The same line scanner as
 * apex_route_coverage.test.mjs: a `[[header]]` opens an array-of-tables
 * entry, a plain `[table]` header ends it.
 */
function routeBindings() {
  const bindings = new Map(TABLES.map((t) => [t, new Map()]));
  let current = null;
  let pending = null;
  for (const raw of at('wrangler.toml').split('\n')) {
    const line = raw.trim();
    const arrayHeader = /^\[\[([^\]]+)\]\]$/.exec(line);
    if (arrayHeader) { current = arrayHeader[1]; pending = null; continue; }
    if (line.startsWith('[')) { current = null; pending = null; continue; }
    if (!current || !TABLES.includes(current)) continue;
    const pat = /^pattern\s*=\s*"([^"]+)"/.exec(line);
    if (pat) { pending = pat[1]; bindings.get(current).set(pending, false); continue; }
    if (pending && /^custom_domain\s*=\s*true\b/.test(line)) bindings.get(current).set(pending, true);
  }
  return bindings;
}

test('wrangler.toml binds axal.vc and app.axal.vc as custom domains in both route tables', () => {
  const bindings = routeBindings();
  for (const table of TABLES) {
    for (const host of HOSTS) {
      assert.equal(
        bindings.get(table).get(host),
        true,
        `[[${table}]] must bind "${host}" with custom_domain = true — the Worker serves that whole host`,
      );
    }
  }
});

// ---------- 3. no live document reclaims the apex for Pages ----------

const RECLAIMS_THE_APEX = [
  'Pages owns the apex',
  'served by Cloudflare Pages',
  'GitHub Pages frontend',
];

/** A line that marks itself as history may quote the old claim. */
const MARKED_AS_HISTORY = /superseded|historical|\bwas\b|used to|2026-08-31/i;

const filesIn = (dir, ext) =>
  readdirSync(resolve(root, dir)).filter((f) => f.endsWith(ext)).sort().map((f) => `${dir}/${f}`);

const SCANNED = [
  'CLAUDE.md',
  'README.md',
  'SECURITY.md',
  ...filesIn('documentation/architecture', '.md'),
  ...filesIn('documentation/operations', '.md'),
  ...filesIn('.github/workflows', '.yml'),
];

test('the scan set still reaches the documents that carried the stale claim', () => {
  for (const anchor of [
    'documentation/architecture/GOTCHAS.md',
    'documentation/architecture/PRODUCTION.md',
    'documentation/operations/DEPLOY.md',
    '.github/workflows/cloudflare-worker-deploy.yml',
  ]) {
    assert.ok(SCANNED.includes(anchor), `${anchor} has moved; widen the scan rather than lose it`);
  }
});

test('no live document says Pages or GitHub Pages serves the apex, except as dated history', () => {
  const offenders = [];
  for (const file of SCANNED) {
    at(file).split('\n').forEach((line, i) => {
      const lower = line.toLowerCase();
      const hit = RECLAIMS_THE_APEX.find((phrase) => lower.includes(phrase.toLowerCase()));
      if (hit && !MARKED_AS_HISTORY.test(line)) offenders.push(`${file}:${i + 1} — "${hit}"`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `these lines reclaim the apex for Pages without marking themselves as history:\n  ${offenders.join('\n  ')}`,
  );
});

// ---------- 4. the Pages mirror stays retired; the headers live in _headers ----------

const HEADERS_FILE = 'frontend/public/_headers';
const WORKER_HEADERS = 'cloudflare-worker/src/middleware/securityHeaders.ts';

test('no workflow deploys to Cloudflare Pages', () => {
  assert.ok(
    !existsSync(resolve(root, '.github/workflows/cloudflare-pages-deploy.yml')),
    'cloudflare-pages-deploy.yml is back — the Pages mirror was retired on 2026-09-03 (DECISIONS.md D36)',
  );
  for (const file of filesIn('.github/workflows', '.yml')) {
    assert.doesNotMatch(
      at(file),
      /wrangler(?:@[\w.-]+)?\s+pages\s+deploy/,
      `${file} runs \`wrangler pages deploy\` — nothing ships a build anywhere but the Worker`,
    );
  }
});

test('the Pages Advanced Mode entry script and the .assetsignore that hid it stay gone', () => {
  assert.ok(
    !existsSync(resolve(root, 'frontend/public/_worker.js')),
    'frontend/public/_worker.js is back — it only ever ran on the retired Pages mirror, and on Pages a `_worker.js` beside `_headers` makes `_headers` inert',
  );
  assert.doesNotMatch(
    at('scripts/build-frontend.mjs'),
    /writeFileSync\([^)]*assetsignore/i,
    'build-frontend.mjs writes .assetsignore again — nothing in docs/ needs hiding from the Worker upload',
  );
});

/** The header rules under the `/*` block of _headers: lower-cased name → value. */
function staticHeaderRules() {
  const lines = at(HEADERS_FILE).split('\n');
  const start = lines.findIndex((l) => l.trim() === '/*');
  assert.notEqual(start, -1, `${HEADERS_FILE} must carry a \`/*\` rule block`);
  const rules = new Map();
  for (const line of lines.slice(start + 1)) {
    if (!/^\s+\S/.test(line)) break;
    const m = /^\s+([^:]+):\s*(.+)$/.exec(line);
    if (m) rules.set(m[1].trim().toLowerCase(), m[2].trim());
  }
  return rules;
}

/** What securityHeaders.ts sets with a literal value, lower-cased name → value. */
function workerHeaderValues() {
  const values = new Map();
  for (const m of at(WORKER_HEADERS).matchAll(/h\.set\(\s*'([^']+)'\s*,\s*'([^']+)'/g)) {
    values.set(m[1].toLowerCase(), m[2]);
  }
  return values;
}

test('frontend/public/_headers sets the static security headers on every path', () => {
  const rules = staticHeaderRules();
  for (const name of [
    'strict-transport-security',
    'x-content-type-options',
    'x-frame-options',
    'referrer-policy',
    'permissions-policy',
  ]) {
    assert.ok(rules.has(name), `${HEADERS_FILE} must set ${name} under /*`);
  }
  assert.equal(rules.get('x-frame-options'), 'DENY');
  assert.equal(
    rules.get('referrer-policy'),
    'strict-origin-when-cross-origin',
    'the public static surface keeps the laxer Referrer-Policy (GOTCHAS, "Referrer-Policy is two-tier")',
  );
});

test('the static headers match the Worker middleware, except the deliberate Referrer-Policy split', () => {
  const rules = staticHeaderRules();
  const worker = workerHeaderValues();
  for (const name of ['strict-transport-security', 'x-content-type-options', 'permissions-policy']) {
    assert.ok(worker.has(name), `${WORKER_HEADERS} no longer sets ${name} with a literal value; update this test with it`);
    assert.equal(rules.get(name), worker.get(name), `${name}: ${HEADERS_FILE} and ${WORKER_HEADERS} have drifted apart`);
  }
  assert.equal(worker.get('referrer-policy'), 'no-referrer', 'the Worker keeps no-referrer for the API surface (NICE-SEC-01)');
});

test('the committed docs/ build ships _headers and no Pages entry script', () => {
  assert.ok(existsSync(resolve(root, 'docs/_headers')), 'docs/_headers is missing — rebuild docs/ with `npm run build`');
  for (const gone of ['docs/_worker.js', 'docs/.assetsignore', 'docs/404.html']) {
    assert.ok(!existsSync(resolve(root, gone)), `${gone} is back in the committed build`);
  }
});
