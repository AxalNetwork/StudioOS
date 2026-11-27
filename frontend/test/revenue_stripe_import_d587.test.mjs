/**
 * D587 (#1214) — the ledger's "Import charges from Stripe" control and the
 * sentence it shows for the Worker's answer.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/revenue_stripe_import_d587.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripeImportLine, summarizeLedger } from '../src/lib/revenueLedger.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const LEDGER = read('frontend/src/components/spinout/RevenueLedger.jsx');

test('the answer names every count the Worker returned, and only those', () => {
  assert.equal(stripeImportLine({ charges: 5, inserted: 3, already_imported: 0, refunded: 1, rejected: [{ charge_id: 'ch_4' }] }),
    '3 charges imported as verified · 1 fully refunded charge not recorded · 1 refused');
  assert.equal(stripeImportLine({ charges: 3, inserted: 0, already_imported: 3, refunded: 0, rejected: [] }),
    '0 charges imported as verified · 3 already on the ledger');
  assert.equal(stripeImportLine({ charges: 1, inserted: 1, already_imported: 0, refunded: 0, rejected: [] }),
    '1 charge imported as verified');
  assert.equal(stripeImportLine({ charges: 0, inserted: 0, rejected: [] }), 'Your Stripe account has no succeeded charges to import.');
  assert.match(stripeImportLine({ charges: 1000, inserted: 1000, rejected: [], capped: true }), /Only the newest 1,000 charges were read/);
  // A count the Worker did not return is not printed as 0.
  assert.equal(stripeImportLine({ charges: 2, rejected: [] }), '');
  assert.equal(stripeImportLine(null), '');
});

test('Verified reads a real share once a Stripe entry exists, and Not recorded before', () => {
  const E = (o) => ({ amount_cents: 1000, verification: 'manual', source: 'manual', revenue_type: 'one_time', customer: 'c', ...o });
  assert.equal(summarizeLedger([E({})]).verifiedShare, null);
  assert.equal(summarizeLedger([E({ amount_cents: 3000, source: 'stripe', verification: 'verified' }), E({})]).verifiedShare, 0.75);
});

test('the ledger offers the import to an editor, calls the Worker, and shows its answer', () => {
  const api = read('frontend/src/lib/api.js');
  assert.match(api, /revenueEntriesImportStripe: \(projectId\) =>\s*request\(`\/revenue\/projects\/\$\{encodeURIComponent\(projectId\)\}\/entries\/import-stripe`, \{ method: 'POST' \}\)/);
  assert.match(LEDGER, /const res = await api\.revenueEntriesImportStripe\(project\.id\);/);
  assert.match(LEDGER, /onClick=\{runStripeImport\}[^>]*data-testid="ledger-import-stripe"/);
  assert.match(LEDGER, /Import charges from Stripe/);
  assert.match(LEDGER, /\{canEdit && stripeResult && \(/, 'the import result is not shown');
  assert.match(LEDGER, /stripeImportLine\(stripeResult\)/);
  // A refusal (not connected, a failed read) is said, not swallowed.
  assert.match(LEDGER, /setErr\(e\?\.message \|\| 'Your Stripe charges could not be imported\.'\)/);
  assert.match(LEDGER, /\{canEdit && !modal && err && <p[^>]*data-testid="ledger-error">\{err\}<\/p>\}/);
  // The "no sync exists" copy is gone now that one does.
  assert.doesNotMatch(LEDGER, /no (Stripe )?charge sync exists/i);
});

test('the Verified KPI says Unreadable when the ledger could not be read, not Not recorded', () => {
  assert.match(LEDGER, /k: 'verified', label: 'Verified revenue', value: read\.status === 'failed' \? null : summary\.verifiedShare === null \? 'unrecorded'/);
});
