/**
 * D612 — Review opens the logged KYC record, not the queue row.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const page = readFileSync(resolve(process.cwd(), 'frontend/src/pages/AdminPage.jsx'), 'utf8');

test('Review fetches the KYC record instead of opening the queue row', () => {
  const review = page.slice(page.indexOf('KYC / AML Queue'), page.indexOf('kycDetail &&'));
  assert.ok(review.length > 0);
  assert.match(review, /api\.kycAdminGet\(k\.id\)/);
  assert.doesNotMatch(review, /setKycDetail\(k\)/);
});

test('Review fetches the partner profile, and a failed read does not open the window', () => {
  const block = page.slice(page.indexOf('const openPartnerProfile'), page.indexOf('const loadKyc'));
  assert.ok(block.includes('openPartnerProfile'), block);
  assert.match(block, /api\.adminGetProfile\(p\.email\)/);
  assert.match(block, /setOpenProfile\(await api\.adminGetProfile\(p\.email\)\)/);
  const failed = block.slice(block.indexOf('catch'));
  assert.ok(failed.includes('could not be read'));
  assert.equal(failed.includes('setOpenProfile'), false);
  const table = page.slice(page.indexOf('Partner Profiles'), page.indexOf("tab === 'kyc'"));
  assert.match(table, /openPartnerProfile\(p\)/);
  assert.equal(table.includes('setOpenProfile(p)'), false);
});
