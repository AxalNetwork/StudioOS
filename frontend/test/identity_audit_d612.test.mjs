/**
 * D612 — Review opens the logged KYC record, not the queue row.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// D648 — the KYC queue and Partner Profiles are their own consoles now.
// D1233 — the queue decides nothing; the person's case reads the record.
const read = (f) => readFileSync(resolve(process.cwd(), f), 'utf8');
const page = read('frontend/src/pages/admin/kyc/KycCase.jsx');
const queue = read('frontend/src/pages/admin/consoles/KycConsole.jsx');
// D995 — a partner profile opens at its own address, read by reference.
const profiles = read('frontend/src/pages/admin/profiles/ProfileRecord.jsx');

test('the case fetches the KYC record instead of opening the queue row', () => {
  const load = page.slice(page.indexOf('const loadRecord'), page.indexOf('const loadCase'));
  assert.ok(load.length > 0);
  assert.match(load, /api\.kycAdminGet\(id\)/, 'the logged record read, by id');
  assert.doesNotMatch(queue, /kycAdminGet|setKycDetail/, 'the queue opens no record of its own');
});

test('Review fetches the partner profile, and a failed read draws no decision', () => {
  assert.match(profiles, /partnerProfilesApi\.get\(refId\)/, 'the logged read by reference (D612, D990)');
  const failed = profiles.slice(profiles.indexOf("else if (profile.status === 'error')"), profiles.indexOf('} else if (shape.draft)'));
  assert.ok(failed.includes('This profile could not be read.'), failed);
  assert.equal(failed.includes('DecisionCard'), false, 'a failed read opens the decision');
});
