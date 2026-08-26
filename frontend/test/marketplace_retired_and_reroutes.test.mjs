import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');
// Several assertions below say a dead path must not appear. The comments that
// explain WHY it is dead necessarily name it, so those checks read code only.
const code = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');

// DECISIONS.md D11.

test('/marketplace redirects to a surface that works, and its page is gone', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /path="\/marketplace" element=\{<Navigate to="\/services" replace \/>\}/);
  assert.doesNotMatch(app, /\bMarketplacePage\b(?!.*Founder)/);
  assert.equal(existsSync(resolve(root, 'frontend/src/pages/MarketplacePage.jsx')), false);
  // FounderMarketplacePage is a different, working page and must survive.
  assert.ok(existsSync(resolve(root, 'frontend/src/pages/FounderMarketplacePage.jsx')));
  assert.doesNotMatch(read('frontend/src/sidebarConfig.js'), /to: '\/marketplace'/);
});

test('no client method calls the unmounted /marketplace prefix', () => {
  // /networkfx/marketplace/* is a different, mounted prefix — scope to the bare one.
  assert.doesNotMatch(code('frontend/src/lib/api.js'), /request\([`']\/marketplace\//);
});

// The repairs. Each of these was a client pointing at a path the worker never
// mounted while the worker served the same operation elsewhere — deleting them
// would have removed a working feature rather than fixing a broken one.
test('document generation targets the endpoint the worker actually serves', () => {
  const api = read('frontend/src/lib/api.js');
  assert.doesNotMatch(code('frontend/src/lib/api.js'), /\/legal\/documents\/generate/);
  assert.match(api, /generateDocument: \(\{ doc_type, \.\.\.fields \}\)/,
    'doc_type must move into the path — it is the template key');
  assert.match(api, /\/legal\/templates\/\$\{encodeURIComponent\(doc_type\)\}\/generate/);
  // The worker names documents from the template, so an editable title would lie.
  assert.doesNotMatch(code('frontend/src/pages/LegalPage.jsx'), /genForm\.title/);
});

test('Stripe Connect targets needs.ts, where those handlers live', () => {
  const api = read('frontend/src/lib/api.js');
  for (const m of ['getMyStripeStatus', 'startStripeOnboarding', 'refreshStripeStatus']) {
    assert.match(api, new RegExp(`${m}: \\(\\) => request\\('/needs/providers/me/stripe`),
      `${m} must point at needs.ts, not the unmounted /marketplace prefix`);
  }
  // Guard the caller too: the repair is pointless if the Stripe tab is dropped.
  assert.match(read('frontend/src/pages/ServiceCatalogPage.jsx'), /api\.getMyStripeStatus/);
});

test('the drift ledger shrank again', () => {
  const baseline = JSON.parse(read('scripts/api-drift-baseline.json'));
  assert.doesNotMatch(baseline.missing_route.join('\n'), /\/api\/marketplace\//);
  assert.ok(baseline.missing_route.length <= 23,
    `ledger should be at most 23 entries, found ${baseline.missing_route.length}`);
});
