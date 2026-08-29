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

const OPS = resolve(process.cwd(), 'frontend/src/pages/partner/operations');
const pages = () => readdirSync(OPS).filter((f) => f.endsWith('.jsx'));
const src = (f) => readFileSync(join(OPS, f), 'utf8');

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
