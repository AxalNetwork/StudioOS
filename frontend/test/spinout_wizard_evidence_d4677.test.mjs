/**
 * D4677 (#4677) — the Spin-Out Wizard records signing and incorporation from
 * their evidence and no longer sends a bare `force`. The Worker half is
 * cloudflare-worker/test/pipeline_atomic_d4677.test.ts.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/spinout_wizard_evidence_d4677.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wizard = readFileSync(new URL('../src/components/SpinoutWizard.jsx', import.meta.url), 'utf8');

test('Initialize sends no force; an override is a Worker-side admin act with a reason, not a button', () => {
  assert.doesNotMatch(wizard, /force:\s*true/);
  assert.match(wizard, /api\.spinoutExecute\(\{ deal_id: deal\.id \}\)/);
});

test('the IP step generates a draft, then records who signed and when', () => {
  assert.match(wizard, /Generate IP licence draft/);
  assert.match(wizard, /api\.spinoutIpTransfer\(\{ deal_id: deal\.id, signed: sig \}\)/);
  assert.match(wizard, /data-testid="spinout-ip-signature"/);
  assert.doesNotMatch(wizard, /generated and signed/, 'it no longer says a generated licence is signed');
});

test('incorporation is recorded from the Atlas id, EIN and date, and an absent EIN reads "Not recorded"', () => {
  assert.match(wizard, /api\.spinoutAtlas\(\{ deal_id: deal\.id, confirmation: inc \}\)/);
  assert.match(wizard, /data-testid="spinout-atlas-evidence"/);
  assert.match(wizard, /Record incorporation/);
  assert.match(wizard, /sub\.ein \|\| 'Not recorded'/);
  assert.doesNotMatch(wizard, /Returns Atlas ID and assigns EIN/);
});
