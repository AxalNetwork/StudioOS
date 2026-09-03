/**
 * The pull-request preview Worker must stay what DECISIONS.md D36 says it is:
 * the PR's `docs/` build on workers.dev with NO bindings, deployed from
 * `wrangler.pr-preview.toml` by `.github/workflows/pr-preview.yml` and deleted
 * when the PR closes. Three things a future edit could quietly undo, each of
 * which would matter:
 *
 *   1. a binding appears in the preview config — a D1 id, a KV namespace, a
 *      queue — and pull-request code starts running against production data
 *      from a public workers.dev URL;
 *   2. the workflow starts deploying `wrangler.toml` (the production Worker)
 *      instead of the preview config, loses the close-time cleanup, or runs
 *      for forks that cannot have the secrets;
 *   3. the preview loses the one behaviour its script exists for — a missing
 *      hashed `/assets/*` file must be a real 404, never the SPA shell — or
 *      loses the SPA fallback that makes deep links work.
 *
 * The production apex guards (apex_route_coverage, apex_truth_doc) read only
 * `wrangler.toml`; this file is the preview's counterpart.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const at = (p) => readFileSync(resolve(root, p), 'utf8');

const CONFIG = 'wrangler.pr-preview.toml';
const WORKFLOW = '.github/workflows/pr-preview.yml';

/** Non-comment, non-blank lines of the preview config, trimmed. */
const configLines = () =>
  at(CONFIG)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

test('the preview config declares no bindings, no environments and no routes', () => {
  const lines = configLines();
  const headers = lines.filter((l) => l.startsWith('['));
  assert.deepEqual(
    headers,
    ['[assets]'],
    `only [assets] may appear in ${CONFIG}; found ${headers.join(', ') || 'nothing'} — a binding here would put pull-request code in front of production data`,
  );
  for (const forbidden of [/database_id/, /^id\s*=/, /bucket_name/, /^queue\s*=/, /class_name/, /custom_domain/, /^routes?\s*=/, /^pattern\s*=/]) {
    assert.equal(lines.some((l) => forbidden.test(l)), false, `${CONFIG} matches ${forbidden}`);
  }
});

test('the preview config serves docs/ with the SPA fallback and runs its script first for /assets/*', () => {
  const lines = configLines();
  assert.ok(lines.includes('directory = "./docs"'), 'the preview must serve the built docs/');
  assert.ok(lines.includes('not_found_handling = "single-page-application"'), 'deep links need the SPA fallback');
  const rwf = lines.find((l) => /^run_worker_first\s*=/.test(l)) || '';
  assert.match(rwf, /"\/assets\/\*"/, '/assets/* must run the script first so a missing hash is a 404, not the shell');
  assert.match(rwf, /"\/api\/\*"/, '/api/* must run the script first so a fetch gets a clean 404, not the shell');
  assert.ok(lines.includes('workers_dev = true'), 'the workers.dev URL is the preview');
  assert.ok(lines.includes('preview_urls = false'), 'the PR Worker is its own preview; no second URL');
});

test('the preview script serves real assets and turns a fallback shell for a missing asset into a 404', () => {
  const main = configLines().find((l) => l.startsWith('main = '));
  assert.ok(main, `${CONFIG} needs a main script — an assets-only Worker serves the shell for every unmatched path`);
  const script = /^main = "([^"]+)"/.exec(main)?.[1];
  assert.ok(script && existsSync(resolve(root, script)), `${script} does not exist`);
  const src = at(script);
  assert.match(src, /env\.ASSETS\.fetch\(/, 'the script must serve real assets from the binding');
  // The script tests the content type with a regex literal, so the source
  // reads `text\/html`; accept the escaped and the plain spelling.
  assert.match(src, /text\\?\/html/, 'the script must detect the fallback HTML');
  assert.match(src, /status:\s*404/, 'a missing hashed asset must be a 404');
  assert.match(src, /startsWith\('\/api\/'\)/, '/api/* must be answered with a 404, never the shell');
  for (const forbidden of [/env\.DB\b/, /env\.TOKENS\b/, /env\.RATE_LIMITS\b/, /fetch\(\s*['"`]https?:/]) {
    assert.doesNotMatch(src, forbidden, `the preview script must reach nothing but the assets binding (${forbidden})`);
  }
});

test('the workflow deploys the preview config under the per-PR name, never wrangler.toml, and cleans up on close', () => {
  const wf = at(WORKFLOW);
  assert.match(
    wf,
    /wrangler@[\d.]+ deploy --config wrangler\.pr-preview\.toml --name "\$PREVIEW_NAME"/,
    'the deploy must target the preview config under the per-PR name',
  );
  assert.doesNotMatch(wf, /--config (?:\.\.\/)?wrangler\.toml/, 'the preview workflow must never deploy the production config');
  assert.doesNotMatch(wf, /--env production/);
  assert.match(wf, /studioos-pr-\$\{\{ github\.event\.pull_request\.number \}\}/, 'the Worker is named after the PR number');
  assert.match(wf, /types: \[opened, synchronize, reopened, closed\]/);
  assert.match(wf, /wrangler@[\d.]+ delete "\$PREVIEW_NAME"/, 'a closed PR must delete its Worker');
  assert.match(wf, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/, 'forks have no secrets; same-repository PRs only');
  assert.match(wf, /pull-requests: write/, 'the sticky comment needs pull-requests: write');
  assert.doesNotMatch(wf, /migrate-d1|d1 execute|d1_databases/, 'a preview never migrates or touches D1');
});

test('the workflows README lists the preview workflow', () => {
  const readme = at('.github/workflows/README.md');
  assert.match(readme, /`pr-preview\.yml`/, 'add the pr-preview.yml row to .github/workflows/README.md');
  assert.match(readme, /studioos-pr-/);
});
