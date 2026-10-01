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
 *   2. every job those tabs did is wired to the real API where it lives now;
 *   3. the fictional firm's strings cannot quietly return.
 *
 * D395 RETIRED THE FIVE TABS THEMSELVES. `/partner/operations/*` redirects to
 * the canvas-built pages that took each job, and the files are deleted. The
 * three properties above did not retire with them, so they are pinned on the
 * successors: the firm profile card, the service catalogue, the delivery
 * board's lifecycle, the proposals zone, Health's founder reviews and
 * Analytics. The fixture-firm scan now covers the whole partner tree, which is
 * wider than the five files it used to read.
 *
 * If a future change needs demo content, it must be served by the worker
 * behind an explicit flag, never compiled into the page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const PARTNER = resolve(process.cwd(), 'frontend/src/pages/partner');
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

/** Every .jsx/.js file under pages/partner, walked with typed directory entries. */
function partnerFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.jsx?$/.test(entry.name)) out.push(p);
    }
  };
  walk(PARTNER);
  return out;
}

test('the fixture module is deleted', () => {
  assert.ok(
    !existsSync(resolve(process.cwd(), 'frontend/src/data/partner/operations.js')),
    'data/partner/operations.js is back — the mock-firm fixture must not return',
  );
});

test('no partner page imports from a data/ fixture directory', () => {
  for (const f of partnerFiles()) {
    assert.ok(
      !/from\s+['"][^'"]*\/data\//.test(readFileSync(f, 'utf8')),
      `${f} imports from a data/ fixture directory`,
    );
  }
});

test('every job the five tabs did is wired to the real API where it lives now', () => {
  // [successor file, api calls it must make], one row per retired tab's job.
  const required = {
    // Overview — the firm profile, the intro switch, the agreement (D390).
    'frontend/src/pages/partner/PartnerFirmProfileCard.jsx':
      ['partnerPortal.getProfile', 'partnerPortal.updateProfile', 'partnerPortal.setAcceptingIntros', 'partnerPortal.myDeal'],
    // Capabilities — the firm's own catalogue, mounted on /offers/catalog.
    'frontend/src/pages/ServiceCatalogPage.jsx':
      ['listServiceOfferings', 'createServiceOffering', 'updateServiceOffering', 'deleteServiceOffering'],
    // Engagements — withdraw on Proposals; the lifecycle and ledger on Board (D395).
    'frontend/src/pages/partner/pipeline/ProposalsZone.jsx': ['listPartnerProposals', 'withdrawQuote'],
    'frontend/src/pages/partner/delivery/EngagementLifecycle.jsx': [],
    // Performance — the same analytics read.
    'frontend/src/pages/partner/pipeline/AnalyticsZone.jsx': ['quotesAnalytics'],
  };
  for (const [file, methods] of Object.entries(required)) {
    const s = read(file);
    assert.ok(/from '(\.\.\/)+lib\/api'/.test(s), `${file} does not import the api client`);
    for (const m of methods) {
      assert.ok(s.includes(`api.${m}(`), `${file} no longer calls api.${m}()`);
    }
  }
  // The lifecycle calls go through an injectable client (so a test can drive
  // them), defaulting to the api client — the same four methods the old page used.
  const life = codeOnly(read('frontend/src/pages/partner/delivery/EngagementLifecycle.jsx'));
  for (const m of ['startEngagement', 'deliverEngagement', 'invoiceEngagement', 'cancelEngagement']) {
    assert.ok(life.includes(`client.${m}(`), `the board lifecycle no longer calls ${m}`);
  }
  assert.match(life, /client = api\b/, 'the lifecycle client no longer defaults to the api client');
  // Portfolio and Performance — the founder reviews, on Health (D390).
  assert.ok(read('frontend/src/pages/partner/delivery/FounderReviews.jsx').includes('listEngagementReviews('),
    'Health no longer reads the founder reviews');
});

test('the fictional firm cannot quietly return', () => {
  // Names distinctive to the deleted fixture. A hit anywhere in the partner
  // tree means mock content is being shown to real partners again.
  const banned = ['BrightPath', 'Northwind Labs', 'Lumen Analytics', 'Ceres Bio', 'Vertex Mobility'];
  for (const f of partnerFiles()) {
    const s = readFileSync(f, 'utf8');
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
  // QUALIFIED OR NOT, THE PREDICATE IS THE POINT. The list SELECT aliases
  // `service_offerings` to `o` so it can join the sold count, so the branch now
  // reads `o.owner_user_id = ?`. The optional alias is what this pattern
  // tolerates; the column is what it requires.
  assert.match(
    services, /mine\s*\?\s*'(?:o\.)?owner_user_id = \?'/,
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
  // The engagements half of this test (`agreed_price`, the active-value sum
  // and the decided-quotes win rate) read `EngagementsPage`, which D395
  // retired. Its win-rate rule (decided is accepted plus rejected, never every
  // quote) is the proposals read's now, pinned by pipeline_proposals_lifecycle.
  const perks = codeOnly(read('frontend/src/pages/PerksPage.jsx'));

  assert.doesNotMatch(perks, /claims_count/,
    'routes/perks.ts aliases it `claim_count`, singular');
  // THE TOTAL MOVED AND THE PIN MOVED WITH IT. `Claims — total redemptions` was
  // the old strip's third tile and read `Number(i.claim_count)`; the `po2`
  // artboard's strip is `Live · Expiring · Expired · Grants revoked`, and the
  // fourth of those is the one that sums redemptions — of expired perks that
  // named what they granted. Same alias, same defect if it is ever mistyped.
  // D413 — REDEEMERS ARE `redeemed_count` NOW. The tile summed `claim_count`
  // under the word "redeemers" while nothing wrote `redeemed`; routes/perks.ts
  // serves both aliases on GET /partner, and each figure reads its own.
  assert.match(perks, /revoking\.reduce\(\(a, p\) => a \+ Number\(p\.redeemed_count\), 0\)/,
    'the redeemers-affected total must read the alias the route emits');
  assert.match(perks, /const claimed = Number\(p\.claim_count\);/,
    'the lifecycle row must read the claim alias the route emits');
  assert.match(perks, /const used = Number\(p\.redeemed_count\);/,
    'the lifecycle row must read the redeemed alias the route emits');
  const partnerRoute = read('cloudflare-worker/src/routes/perks.ts');
  assert.equal((partnerRoute.match(/AND x\.status = 'redeemed'\) AS redeemed_count/g) || []).length, 2,
    'GET /partner must emit `redeemed_count` on both its queries');
});
