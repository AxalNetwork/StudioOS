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
