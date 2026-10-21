/**
 * THE SERVICE CATALOGUE WAS EMPTY ON BOTH OF ITS PARTNER-FACING TABS.
 *
 * `/services` is the product's only catalogue of productised partner
 * offerings, and the Partner canvas puts it on `/offers/catalog` as "the
 * record Pipeline · Leads scores against". Neither of its two reads worked:
 *
 *   Browse catalogue  read `r.offerings`; `GET /services/offerings` answers
 *                     `c.json({ items })` and always has. `undefined` fell
 *                     through a `|| []` and rendered "no offerings published
 *                     yet" however many were published.
 *   My offerings      called `GET /services/partners/:id/offerings`, a route
 *                     the worker has NEVER served — it sat in
 *                     `scripts/api-drift-baseline.json` as known-missing. The
 *                     404 was swallowed as an empty list, so a partner with a
 *                     full catalogue was told they had none.
 *
 * Same shape as the needs-board envelope bug in the commit before this one,
 * and as `agreed_price` for `price` before that: a plausible name resolving to
 * undefined, and a `||` turning the absence into a confident answer. The
 * second one is worse than a mistyped key — the read had no route at all, and
 * the catch that hid it was written to hide a *stale deployment*, not a
 * permanent absence.
 *
 * The zone card in front of it said "the catalog lives at /services today" and
 * declined to mount it, on the grounds that mounting would fork a second
 * catalog. It would not — Leads and Perk deals already mount `/needs` and
 * `/perks` — and the page it deferred to did not work.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

const PAGE = read('frontend/src/pages/ServiceCatalogPage.jsx');
const API = read('frontend/src/lib/api.js');
const ROUTES = read('frontend/src/workspaces/partner/PartnerBucketRoutes.jsx');
const SERVICES_ROUTE = read('cloudflare-worker/src/routes/services.ts');
const BASELINE = JSON.parse(read('scripts/api-drift-baseline.json'));

test('GET /services/offerings answers an `items` envelope — read from the worker, not remembered', () => {
  const at = SERVICES_ROUTE.indexOf("services.get('/offerings',");
  assert.ok(at > 0, 'the offerings list handler is gone — has it been renamed?');
  const body = SERVICES_ROUTE.slice(at, SERVICES_ROUTE.indexOf("services.get('/offerings/:id'", at));
  assert.match(body, /return c\.json\(\{ items \}\)/,
    'if this route ever changes its envelope, this test says so rather than pinning the old one');
});

test('the catalogue reads `.items` on both tabs, never `.offerings`', () => {
  const code = codeOnly(PAGE);
  assert.doesNotMatch(code, /\.offerings\b/,
    'no route in this product answers `{ offerings }` — the key resolves to undefined');
  const items = code.match(/r\.items \|\| \[\]/g) || [];
  assert.equal(items.length, 2, 'both the browse list and the owner list read the same envelope');
});

test('My offerings reads the route the worker actually serves', () => {
  const code = codeOnly(PAGE);
  assert.match(code, /api\.listServiceOfferings\(\{ mine: 1 \}\)/,
    '`?mine=1` scopes on owner_user_id and includes inactive drafts — the arm services.ts added for this view');
  assert.doesNotMatch(code, /listPartnerOfferings/,
    'that method called a route the worker has never served');
});

test('`?mine=1` is a real arm of the worker handler, not a query it ignores', () => {
  assert.match(SERVICES_ROUTE, /c\.req\.query\('mine'\) === '1'/);
  // The optional `o.` is the table alias the list SELECT gained to join each
  // offering's sold count; the column is what this assertion is about.
  assert.match(SERVICES_ROUTE, /mine \? '(?:o\.)?owner_user_id = \?' : '(?:o\.)?is_active = 1'/,
    'the owner arm must scope on the caller, or `mine=1` would return the whole marketplace');
});

test('the dead api.js method is gone and the drift ledger shrank with it', () => {
  assert.doesNotMatch(codeOnly(API), /listPartnerOfferings/);
  assert.ok(!BASELINE.missing_route.includes('GET /api/services/partners/:p/offerings'),
    'the baseline is a debt ledger that must only ever shrink — this entry is paid off');
});

test('My offerings is gated on role, not on a partner_id the store does not use', () => {
  const code = codeOnly(PAGE);
  assert.doesNotMatch(code, /if \(!user\?\.partner_id\) \{ setRows\(\[\]\); return; \}/,
    'an offering is owned by a user; a partner_id test could only hide a partner’s own rows from them');
  assert.match(code, /user\?\.role !== 'partner' && user\?\.role !== 'admin'/);
});

test('/offers/catalog mounts the catalogue rather than a card pointing at it', () => {
  const code = codeOnly(ROUTES);
  // The invariant is that the ROUTE MOUNTS THE CATALOGUE, not that the mount
  // expression has exactly two props. It grew a third (`zoneActions`, the zone
  // header's action row) and this assertion failed on correct code — which
  // means it was pinning the expression rather than the rule. Rewritten to the
  // rule: the component itself, embedded, at this key.
  const mount = code.slice(code.indexOf('catalog:'), code.indexOf("'perk-deals':"));
  assert.match(mount, /<ServiceCatalogPage\b/,
    'the same component at a second route is what Leads and Perk deals already do');
  assert.match(mount, /\buser=\{user\}/, 'the catalogue is mounted without its user');
  // #2338: the page has one body now, the zone's, so there is no `embedded`
  // flag to hand it; one handed here would be read by nothing.
  assert.doesNotMatch(mount, /\bembedded\b/, 'ServiceCatalogPage takes no embedded flag since #2338');
  const copyAt = code.indexOf('const COPY');
  const copyBlock = code.slice(copyAt, code.indexOf('const ZONE_LINES', copyAt));
  assert.doesNotMatch(copyBlock, /catalog:/,
    'a no-store card in front of a working page tells an operator a built feature is missing');
});

test('the catalogue is the LEDGER body alone — no tab row, no second heading', () => {
  const code = codeOnly(PAGE);
  // WHAT THIS TEST PINNED BEFORE #2338. The page had two bodies: the zone's,
  // returned early when `embedded`, and the standalone `/services` page with a
  // heading and a Browse catalogue / My offerings / Stripe Connect tab row.
  // The owner removed `/services` (#2297 §7), so the default export IS the
  // zone body: it returns `MineTab` and nothing that chooses a tab.
  const body = code.slice(code.indexOf('export default function ServiceCatalogPage'));
  assert.match(body.slice(0, 300),
    /^export default function ServiceCatalogPage\(\{[^}]*\buser\b[^}]*\}\) \{\s*return <MineTab\b/,
    'the catalogue must return the LEDGER body itself, not a shell that chooses a tab');
  assert.doesNotMatch(code, /<h1\b/, 'a second heading inside the shell that already drew one');
  assert.doesNotMatch(code, /label: 'Browse catalogue'/, 'the removed /services tab row is back');

  // The two subjects the tab row offered still live where a founder reaches
  // them: the founder marketplace imports both from this file.
  const founder = codeOnly(read('frontend/src/pages/FounderMarketplacePage.jsx'));
  assert.match(founder, /BrowseTab as ServicesBrowseTab/, 'the founder marketplace lost Browse catalogue');
  assert.match(founder, /\bStripeTab\b/, 'the founder marketplace lost Stripe Connect');
  assert.match(code, /export function BrowseTab\b/);
  assert.match(code, /export function StripeTab\b/);
});
