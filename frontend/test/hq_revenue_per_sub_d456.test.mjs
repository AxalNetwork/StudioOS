/**
 * D456 — per-subsidiary revenue honesty on HQ Home and Revenue.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeOnly } from './_codeOnly.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

test('HQ Home MTD revenue no longer blames U1 alone', () => {
  const home = codeOnly(read('frontend/src/pages/hq/HqHomePage.jsx'));
  assert.doesNotMatch(home, /no subsidiary attribution/);
  assert.match(home, /mtd_revenue_reason/);
  assert.match(home, /revenueAbsenceForLicence/);
});

test('Revenue page splits revenue per subsidiary from token P&L reasons', () => {
  const page = codeOnly(read('frontend/src/pages/hq/RevenuePage.jsx'));
  assert.match(page, /title="Revenue per subsidiary"/);
  assert.match(page, /token_pl_per_subsidiary_reason/);
  assert.doesNotMatch(page, /derived_metrics_reason/);
  assert.match(page, /hq-revenue-usage-coverage/);
});

test('revenue summary endpoint ships usage coverage and token P&L refusal', () => {
  const route = read('cloudflare-worker/src/routes/admin_revenue.ts');
  assert.match(route, /usage_coverage: usageCoverage/);
  assert.match(route, /TOKEN_PL_PER_SUBSIDIARY_UNAVAILABLE/);
  assert.match(route, /REVENUE_PER_SUBSIDIARY_UNAVAILABLE/);
  assert.doesNotMatch(route, /\.\.\.DERIVED_UNAVAILABLE/);
});

test('HQ overview includes usage coverage', () => {
  const route = read('cloudflare-worker/src/routes/admin_hq.ts');
  assert.match(route, /usage_coverage: usageCoverage/);
  assert.match(route, /subsidiaryUsageCoverage/);
});
