/**
 * Send for Signature can only offer documents the platform can actually make.
 *
 * `POST /api/legal/esign/send` dropped requireAdmin in task #156. The UI never
 * followed: the only caller was the wizard inside AdminPage.jsx, whose picker
 * is behind `GET /admin/contracts/templates/legal` (requireAdmin). A founder
 * could sign a document and could not send one.
 *
 * The registry that fixes it is constrained by something narrower than taste.
 * `services/legalTemplates.ts` imports exactly nine bodies as `*.md?raw` and
 * puts them in TEMPLATES; forty-five more .md files sit unimported in
 * templates/legal/ and `getLegalTemplateBody` throws on every one. A doc type
 * may therefore appear in the registry only if `templateKeyForDocType` maps it
 * to one of the nine. These tests are that constraint, and they read all three
 * files as text — legalTemplates.ts cannot be imported outside the wrangler
 * bundler, which is why esignOriginators.ts imports nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const registry = read('cloudflare-worker/src/services/esignOriginators.ts');
const templates = read('cloudflare-worker/src/services/legalTemplates.ts');
const route = read('cloudflare-worker/src/routes/esign.ts');
const app = read('frontend/src/App.jsx');
const page = read('frontend/src/pages/legal/SendForSignaturePage.jsx');

/** Every doc_type the registry offers. */
const offered = [...new Set([...registry.matchAll(/doc_type: '([a-z0-9_]+)'/g)].map((m) => m[1]))];

/** The keys legalTemplates.ts actually has a body for. */
function wiredKeys() {
  const block = templates.slice(
    templates.indexOf('const TEMPLATES: Record<LegalTemplateKey, string> = {'),
    templates.indexOf('export function getLegalTemplateBody'),
  );
  return new Set([...block.matchAll(/^\s{2}([a-z0-9_]+):/gm)].map((m) => m[1]));
}

/** doc_type → template key, as the worker resolves it. */
function docTypeMap() {
  const block = templates.slice(
    templates.indexOf('const DOC_TYPE_TO_TEMPLATE_KEY'),
    templates.indexOf('export function templateKeyForDocType'),
  );
  return Object.fromEntries(
    [...block.matchAll(/^\s{2}([a-z0-9_]+):\s*'([a-z0-9_]+)',/gm)].map((m) => [m[1], m[2]]),
  );
}

test('the registry offers something at all, and the parse is live', () => {
  assert.ok(offered.length >= 6, `only parsed ${offered.length} doc types — the regex went stale`);
  assert.ok(wiredKeys().size >= 8, 'could not read TEMPLATES');
  assert.ok(Object.keys(docTypeMap()).length >= 10, 'could not read DOC_TYPE_TO_TEMPLATE_KEY');
});

test('every offered document resolves to a template that has a body', () => {
  // This is the whole point. Offering a doc type with no wired template
  // produces an envelope the platform throws on — unknown_legal_template.
  const map = docTypeMap();
  const wired = wiredKeys();
  const broken = offered.filter((d) => !map[d] || !wired.has(map[d]));
  assert.deepEqual(broken, [], 'offered for signature but no template body exists');
});

test('the four roles are covered, and admin is not one of them', () => {
  for (const role of ['founder', 'investor', 'advisor', 'partner']) {
    assert.match(registry, new RegExp(`^\\s{2}${role}: \\[`, 'm'), `${role} has no template list`);
  }
  // An admin keeps the full catalogue through the admin wizard; templatesFor
  // gives them the union so this page works for them too.
  assert.doesNotMatch(registry, /^\s{2}admin: \[/m);
  assert.match(registry, /if \(role === 'admin'\)/);
});

test('the picker is a convenience; the server re-checks', () => {
  assert.match(route, /esign\.get\('\/templates'/, 'no templates endpoint');
  assert.match(route, /templatesFor\(user\.role\)/);
  // POST /send must not trust the client's choice.
  assert.match(route, /if \(!mayOriginate\(sender\.role, documentType\)/,
    'POST /send does not re-check who may originate the document type');
});

test('the page is routed to non-admins, and is not a second root', () => {
  const line = app.split('\n').find((l) => l.includes('path="/legal/send"'));
  assert.ok(line, '/legal/send is not routed');
  for (const r of ['founder', 'partner', 'investor', 'advisor']) {
    assert.ok(line.includes(`'${r}'`), `${r} cannot reach /legal/send`);
  }
  assert.ok(!/path="\/founder\/send"|path="\/admin\/legal\/send"/.test(app));
});

test('the page reads the role-scoped picker, not the admin catalogue', () => {
  assert.match(page, /api\.esignTemplates\(\)/);
  assert.doesNotMatch(page, /adminListLegalTemplates/);
});

test('what the canvas asked for and did not get is stated, not silently dropped', () => {
  // SAFE and Term Sheet have no wired template; the Co-founder Agreement has
  // its own drafting flow. Both facts belong in the file, not in a commit
  // message nobody reads later.
  assert.match(registry, /SAFE/);
  assert.match(registry, /Term Sheet/);
  assert.match(page, /spinout-lab\/cofounder-agreement/,
    'the page should send founders to the real co-founder flow');
});

test('/legal is served by Cloudflare Pages, NOT carved out to the Worker', () => {
  // This assertion is INVERTED from what it originally said, and the inversion
  // is the point. It used to require `axal.vc/legal` + `axal.vc/legal/*` in
  // both wrangler tables, because the Worker served apex HTML and a page with
  // no route was a 404.
  //
  // Since 2026-08-31 Cloudflare Pages owns the apex frontend and the Worker
  // keeps only /api/*, /landing/* and /p/*. Re-adding a page route here does
  // not make /legal/send *more* reachable — it pairs Pages-served HTML with a
  // different Worker asset build, which is exactly what produced the blank
  // page and the `?__reboot=` loop on the apex. See GOTCHAS, "Apex hashed
  // assets / blank pages", and frontend/test/apex_route_coverage.test.mjs for
  // the same rule stated once for the whole table.
  const wrangler = read('wrangler.toml');
  for (const p of ['axal.vc/legal', 'axal.vc/legal/*']) {
    const n = wrangler.split(`pattern    = "${p}"`).length - 1;
    assert.equal(n, 0, `${p} must NOT be Worker-routed — Pages owns it, found ${n}`);
  }
});
