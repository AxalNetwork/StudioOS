/**
 * D616 — five client methods that nothing calls are gone.
 * The methods still in use stay.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const api = readFileSync(resolve(process.cwd(), 'frontend/src/lib/api.js'), 'utf8');
const baseline = JSON.parse(readFileSync(resolve(process.cwd(), 'scripts/api-drift-baseline.json'), 'utf8'));

const GONE = ['emailSendDeal', 'adminVoidContract', 'fundLPs', 'fundsListByStatus', 'trustSanctions'];
const KEPT = ['adminVoidContractWithReason', 'fundsLpsList', 'fundsList', 'trustListSanctions', 'fundsGet'];

test('D616: the five dead client methods are gone, and the methods in use stay', () => {
  for (const name of GONE) {
    assert.equal(api.includes(`${name}:`), false, name);
  }
  for (const name of KEPT) {
    assert.equal(api.includes(`${name}:`), true, name);
  }
  assert.equal(baseline.missing_route.includes('POST /api/email/send-deal'), false);
});
