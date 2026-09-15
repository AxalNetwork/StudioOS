/**
 * Trust Center — `computeTrustScore` unit tests.
 *
 * Covers the four cases the Task #17 spec calls out:
 *
 *   1. zero required obligations         → 100   (vacuously compliant)
 *   2. all required satisfied            → 100
 *   3. mixed satisfied + pending         → rounded percent
 *   4. expired counts as NOT satisfied   → percent reflects the gap
 *
 * Plus a couple of guard-rail cases (waived counts as satisfied,
 * non-required rows are ignored, empty input is safe).
 *
 * The function USED TO live in `frontend/src/components/TrustScoreBadge.jsx`,
 * beside a React component importing `lucide-react`, so this file sliced it
 * out of the source with a regex and a brace-balance walk to avoid pulling
 * React in. It now lives in the pure `frontend/src/lib/trustCenter.js` and is
 * simply imported — the surgery is gone, and with it the class of failure
 * where a reformat of the source breaks the extractor rather than the rule.
 *
 * The move happened because the WORKER needs the same rule (it writes the
 * monthly snapshot in migration 243) and the two copies have to be runnable
 * side by side; `cloudflare-worker/test/trust_score_parity.test.ts` does that.
 * `TrustScoreBadge.jsx` still re-exports it, so no caller changed.
 *
 * Run with:  node --test frontend/test/trust_score.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTrustScore } from '../src/lib/trustCenter.js';

test('zero required obligations → 100 (vacuously compliant)', async () => {
  // Empty list.
  assert.equal(computeTrustScore([]), 100);
  // No-args defaults to [].
  assert.equal(computeTrustScore(), 100);
  // Only optional rows present (required: false / 0).
  assert.equal(computeTrustScore([
    { obligation_key: 'kyb_v1', required: 0, status: 'pending' },
    { obligation_key: 'optional_x', required: false, status: 'pending' },
  ]), 100);
});

test('all required obligations satisfied → 100', async () => {
  const score = computeTrustScore([
    { obligation_key: 'tos_v1',          required: 1, status: 'satisfied' },
    { obligation_key: 'privacy_v1',      required: 1, status: 'satisfied' },
    { obligation_key: 'investor_nda_v1', required: 1, status: 'satisfied' },
    { obligation_key: 'kyc_v1',          required: 1, status: 'satisfied' },
  ]);
  assert.equal(score, 100);
});

test('mixed satisfied + pending → rounded percent of required satisfied', async () => {
  // 2 of 4 required satisfied → 50.
  assert.equal(
    computeTrustScore([
      { obligation_key: 'tos_v1',          required: 1, status: 'satisfied' },
      { obligation_key: 'privacy_v1',      required: 1, status: 'satisfied' },
      { obligation_key: 'investor_nda_v1', required: 1, status: 'pending'   },
      { obligation_key: 'kyc_v1',          required: 1, status: 'in_review' },
    ]),
    50,
  );
  // 1 of 3 required satisfied → 33 (rounded).
  assert.equal(
    computeTrustScore([
      { obligation_key: 'tos_v1',          required: 1, status: 'satisfied' },
      { obligation_key: 'privacy_v1',      required: 1, status: 'pending'   },
      { obligation_key: 'investor_nda_v1', required: 1, status: 'pending'   },
    ]),
    33,
  );
  // 2 of 3 required satisfied → 67 (rounded up).
  assert.equal(
    computeTrustScore([
      { obligation_key: 'tos_v1',          required: 1, status: 'satisfied' },
      { obligation_key: 'privacy_v1',      required: 1, status: 'satisfied' },
      { obligation_key: 'investor_nda_v1', required: 1, status: 'pending'   },
    ]),
    67,
  );
  // Non-required rows must NOT pad the denominator.
  assert.equal(
    computeTrustScore([
      { obligation_key: 'tos_v1',          required: 1, status: 'satisfied' },
      { obligation_key: 'privacy_v1',      required: 1, status: 'satisfied' },
      { obligation_key: 'kyb_v1',          required: 0, status: 'pending'   },
    ]),
    100,
  );
});

test('expired counts as NOT satisfied (must re-prove the obligation)', async () => {
  // 1 of 2 required actually satisfied — the expired row drops out.
  assert.equal(
    computeTrustScore([
      { obligation_key: 'tos_v1',          required: 1, status: 'satisfied' },
      { obligation_key: 'investor_nda_v1', required: 1, status: 'expired'   },
    ]),
    50,
  );
  // All required expired → 0.
  assert.equal(
    computeTrustScore([
      { obligation_key: 'tos_v1',          required: 1, status: 'expired' },
      { obligation_key: 'privacy_v1',      required: 1, status: 'expired' },
    ]),
    0,
  );
  // Mix of expired + pending + satisfied: only satisfied counts.
  assert.equal(
    computeTrustScore([
      { obligation_key: 'tos_v1',          required: 1, status: 'satisfied' },
      { obligation_key: 'privacy_v1',      required: 1, status: 'expired'   },
      { obligation_key: 'investor_nda_v1', required: 1, status: 'pending'   },
      { obligation_key: 'kyc_v1',          required: 1, status: 'in_review' },
    ]),
    25,
  );
});

test('waived counts as satisfied (admin-cleared obligations)', async () => {
  // ToS satisfied + investor_nda waived → both count.
  assert.equal(
    computeTrustScore([
      { obligation_key: 'tos_v1',          required: 1, status: 'satisfied' },
      { obligation_key: 'investor_nda_v1', required: 1, status: 'waived'    },
    ]),
    100,
  );
});
