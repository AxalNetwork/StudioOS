/**
 * Partner Operations is live data, not fixtures (Wave 1a).
 *
 * Until 2026-08-29 all five /partner/operations/* tabs rendered
 * data/partner/operations.js — an entire fictional firm ("BrightPath
 * Advisory") with fabricated clients, contracts, a fake $8M raise and a fake
 * 4.8 rating, shown to real signed-in partners. The delivery audit
 * (documentation/audits/PLATFORM-DELIVERY-AUDIT.md §6) called it the worst standing defect on the
 * platform: a task had claimed this surface complete while no tab made a
 * single API call.
 *
 * These tests pin the repair at the source level:
 *   1. the fixture module is gone and nothing imports a replacement;
 *   2. every tab talks to the real API;
 *   3. the fictional firm's strings cannot quietly return.
 *
 * If a future change needs demo content, it must be served by the worker
 * behind an explicit flag, never compiled into the page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const OPS = resolve(process.cwd(), 'frontend/src/pages/partner/operations');
const pages = () => readdirSync(OPS).filter((f) => f.endsWith('.jsx'));
const src = (f) => readFileSync(join(OPS, f), 'utf8');
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

test('the fixture module is deleted', () => {
  assert.ok(
    !existsSync(resolve(process.cwd(), 'frontend/src/data/partner/operations.js')),
    'data/partner/operations.js is back — the mock-firm fixture must not return',
  );
});

test('no operations page imports from a data/ fixture directory', () => {
  for (const f of pages()) {
    assert.ok(
      !/from\s+['"][^'"]*\/data\//.test(src(f)),
      `${f} imports from a data/ fixture directory`,
    );
  }
});

test('every tab is wired to the real API', () => {
  const required = {
    'OverviewPage.jsx': ['partnerPortal.getProfile', 'partnerPortal.myDeal', 'quotesAnalytics'],
    'CapabilitiesPage.jsx': ['listServiceOfferings', 'createServiceOffering', 'updateServiceOffering'],
    'PortfolioPage.jsx': ['listEngagements', 'listEngagementReviews'],
    'EngagementsPage.jsx': ['listNeeds', 'myQuotes', 'submitQuote', 'listEngagements', 'invoiceEngagement'],
    'PerformancePage.jsx': ['quotesAnalytics', 'listEngagementReviews'],
  };
  for (const [file, methods] of Object.entries(required)) {
    const s = src(file);
    assert.ok(s.includes("from '../../../lib/api'"), `${file} does not import the api client`);
    for (const m of methods) {
      assert.ok(s.includes(`api.${m}(`), `${file} no longer calls api.${m}()`);
    }
  }
});

test('the fictional firm cannot quietly return', () => {
  // Names distinctive to the deleted fixture. A hit in any operations page
  // means mock content is being shown to real partners again.
  const banned = ['BrightPath', 'Northwind Labs', 'Lumen Analytics', 'Ceres Bio', 'Vertex Mobility'];
  for (const f of pages()) {
    const s = src(f);
    for (const b of banned) {
      assert.ok(!s.includes(b), `${f} contains fixture-firm string "${b}"`);
    }
  }
});

test('the new profile endpoints exist on BOTH sides of the drift boundary', () => {
  const apiJs = readFileSync(resolve(process.cwd(), 'frontend/src/lib/api.js'), 'utf8');
  assert.match(apiJs, /request\('\/partner-portal\/profile'\)/, 'api.js lacks getProfile');
  assert.match(apiJs, /request\('\/partner-portal\/profile',\s*\{\s*method:\s*'PATCH'/, 'api.js lacks updateProfile');
  const worker = readFileSync(
    resolve(process.cwd(), 'cloudflare-worker/src/routes/partner_portal.ts'), 'utf8',
  );
  assert.match(worker, /portal\.get\('\/profile'/, 'worker lacks GET /partner-portal/profile');
  assert.match(worker, /portal\.patch\('\/profile'/, 'worker lacks PATCH /partner-portal/profile');
});

test('offerings ?mine=1 is scoped to the caller in the worker', () => {
  const services = readFileSync(
    resolve(process.cwd(), 'cloudflare-worker/src/routes/services.ts'), 'utf8',
  );
  assert.match(
    services, /mine\s*\?\s*'owner_user_id = \?'/,
    'the mine=1 branch must filter by owner_user_id — without it every partner sees every draft',
  );
});

test('the partner stat strips read fields the worker actually emits', () => {
  // THIS IS THE THIRD PR IN A ROW WITH THE SAME DEFECT, so it is pinned rather
  // than fixed again. A canvas stat strip invents a DTO field name, `|| 0`
  // coerces the resulting `undefined` to zero, and the page renders a confident
  // number instead of an obvious blank. Nothing else catches it: the field is
  // read, not imported, so `check-unused-imports` is silent; the bundle
  // compiles; and no test renders these pages.
  //
  // The three that shipped here:
  //   `e.agreed_price`  — engagements emit `price` (REAL NOT NULL), and this
  //                       same file reads `e.price` for every individual row.
  //                       The total was always 0, so "Active value $0" sat
  //                       beside a live engagement count on the same card.
  //   `i.claims_count`  — routes/perks.ts aliases the subquery `claim_count`,
  //                       singular. Every listing counted 0 redemptions.
  //   win rate over all quotes — statuses are submitted|accepted|rejected|
  //                       withdrawn, so pending proposals counted as losses and
  //                       the note said "N decided" about quotes that were not.
  //
  // Comment-stripped: the fixes name the wrong fields on purpose to explain
  // themselves, and a raw scan would read that prose as the defect.
  const eng = codeOnly(read('frontend/src/pages/partner/operations/EngagementsPage.jsx'));
  const perks = codeOnly(read('frontend/src/pages/PerksPage.jsx'));

  assert.doesNotMatch(eng, /agreed_price/,
    'engagements emit `price`, not `agreed_price` — nothing in the product defines that field');
  assert.match(eng, /active\.reduce\(\(a, e\) => a \+ \(Number\(e\.price\) \|\| 0\), 0\)/,
    'the active-value total must sum the column that exists');

  assert.doesNotMatch(perks, /claims_count/,
    'routes/perks.ts aliases it `claim_count`, singular');
  assert.match(perks, /Number\(i\.claim_count\)/,
    'the claims total must read the alias the route emits');

  // A win rate divides by decisions, not by submissions, and the sentence under
  // it must count the same set the percentage does.
  assert.match(eng, /const decidedQuotes = acceptedQuotes \+ rejectedQuotes;/,
    'the denominator must be accepted + rejected');
  assert.doesNotMatch(eng, /acceptedQuotes \/ myQuotes/,
    'dividing by every quote counts pending proposals as losses');
  assert.match(eng, /\$\{acceptedQuotes\} of \$\{decidedQuotes\} decided/,
    'the note must count the same set as the percentage');
});
