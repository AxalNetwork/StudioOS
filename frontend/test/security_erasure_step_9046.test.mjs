/**
 * D9046 (#9046): HQ › Security's close as fulfilled runs the platform's erasure first. When that step fails the
 * Worker answers 503 `erasure_step_failed` having recorded nothing, so the page says so in the Worker's words
 * rather than "whether it was recorded is not confirmed", which every other 5xx reads as. Sample data only.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/security_erasure_step_9046.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeResultOf } from '../src/pages/hq/security/privacyModel.js';

const refusal = (code, status, message) => Object.assign(new Error(message), { status, code });

test('a failed erasure step is a certain refusal: nothing was recorded, and the Worker’s sentence is shown', () => {
  const said = 'Nothing was recorded. The erasure did not complete, so the request is still open. Close it again.';
  // Mutation checked: the erasure_step_failed branch dropped → the 503 reads as unconfirmed.
  const out = closeResultOf(null, refusal('erasure_step_failed', 503, said));
  assert.equal(out.result, 'refused');
  assert.equal(out.message, said);
  assert.doesNotMatch(out.message, /not confirmed/);
  // Every other 5xx still reads as unconfirmed.
  assert.equal(closeResultOf(null, refusal('ledger_unavailable', 503, 'x')).result, 'unconfirmed');
});
