/**
 * D612 — Review opens the logged KYC record, not the queue row.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// D648 — the KYC queue and Partner Profiles are their own consoles now.
const read = (f) => readFileSync(resolve(process.cwd(), f), 'utf8');
const page = read('frontend/src/pages/admin/consoles/KycConsole.jsx');
const profiles = read('frontend/src/pages/admin/consoles/PartnerProfilesConsole.jsx');

test('Review fetches the KYC record instead of opening the queue row', () => {
  const review = page.slice(page.indexOf('KYC / AML Queue'), page.indexOf('kycDetail &&'));
  assert.ok(review.length > 0);
  assert.match(review, /api\.kycAdminGet\(k\.id\)/);
  assert.doesNotMatch(review, /setKycDetail\(k\)/);
});

test('Review fetches the partner profile, and a failed read does not open the window', () => {
  const block = profiles.slice(profiles.indexOf('const openPartnerProfile'), profiles.indexOf('if (loading) return'));
  assert.ok(block.includes('openPartnerProfile'), block);
  assert.match(block, /api\.adminGetProfile\(p\.email\)/);
  assert.match(block, /setOpenProfile\(await api\.adminGetProfile\(p\.email\)\)/);
  const failed = block.slice(block.indexOf('catch'));
  assert.ok(failed.includes('could not be read'));
  assert.equal(failed.includes('setOpenProfile'), false);
  const table = profiles.slice(profiles.indexOf('Partner Profiles</h3>'), profiles.indexOf('{openProfile && ('));
  assert.match(table, /openPartnerProfile\(p\)/);
  assert.equal(table.includes('setOpenProfile(p)'), false);
});
