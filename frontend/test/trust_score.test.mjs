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
 * The function lives in `frontend/src/components/TrustScoreBadge.jsx`
 * alongside a React component that imports `lucide-react`. We slice
 * out the pure function with a regex+brace-balance walk so this test
 * needs zero React/JSX/Vite tooling.
 *
 * Run with:  node --test frontend/test/trust_score.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadComputeTrustScore() {
  const srcPath = resolve(__dirname, '../src/components/TrustScoreBadge.jsx');
  const src = await readFile(srcPath, 'utf8');
  const start = src.indexOf('export function computeTrustScore(');
  assert.notEqual(start, -1, 'computeTrustScore not found in TrustScoreBadge.jsx');

  // Skip past the `(...)` param list, then balance the function-body braces.
  let parenDepth = 0, j = src.indexOf('(', start);
  for (; j < src.length; j++) {
    if (src[j] === '(') parenDepth++;
    else if (src[j] === ')') { parenDepth--; if (parenDepth === 0) { j++; break; } }
  }
  let depth = 0, i = src.indexOf('{', j), end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.notEqual(end, -1, 'failed to balance braces around computeTrustScore');

  const body = src.slice(start, end).replace(/^export\s+/, '');
  // Pure JS already — no transpile needed. Wrap in IIFE so the function
  // declaration survives top-level evaluation under `new Function`.
  return new Function(`${body}; return computeTrustScore;`)();
}

test('zero required obligations → 100 (vacuously compliant)', async () => {
  const computeTrustScore = await loadComputeTrustScore();
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
  const computeTrustScore = await loadComputeTrustScore();
  const score = computeTrustScore([
    { obligation_key: 'tos_v1',          required: 1, status: 'satisfied' },
    { obligation_key: 'privacy_v1',      required: 1, status: 'satisfied' },
    { obligation_key: 'investor_nda_v1', required: 1, status: 'satisfied' },
    { obligation_key: 'kyc_v1',          required: 1, status: 'satisfied' },
  ]);
  assert.equal(score, 100);
});

test('mixed satisfied + pending → rounded percent of required satisfied', async () => {
  const computeTrustScore = await loadComputeTrustScore();
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
  const computeTrustScore = await loadComputeTrustScore();
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
  const computeTrustScore = await loadComputeTrustScore();
  // ToS satisfied + investor_nda waived → both count.
  assert.equal(
    computeTrustScore([
      { obligation_key: 'tos_v1',          required: 1, status: 'satisfied' },
      { obligation_key: 'investor_nda_v1', required: 1, status: 'waived'    },
    ]),
    100,
  );
});
