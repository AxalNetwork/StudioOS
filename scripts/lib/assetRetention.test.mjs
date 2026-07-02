import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planAssetRetention } from './assetRetention.mjs';

test('first run seeds pre-existing assets so the live build is not dropped', () => {
  const prevFiles = ['index-OLD.js', 'vendor-OLD.js', 'style-OLD.css'];
  const newFiles = ['index-NEW.js', 'vendor-NEW.js', 'style-NEW.css'];
  const plan = planAssetRetention({ prevFiles, newFiles, ledgerBuilds: [], retainBuilds: 3, now: 't1' });

  // Keep is the union of the new build + the seeded pre-existing build.
  assert.deepEqual(new Set(plan.keep), new Set([...prevFiles, ...newFiles]));
  // Old hashes must be restored from the backup (they survive the emptyOutDir wipe).
  assert.deepEqual(new Set(plan.restore), new Set(prevFiles));
  assert.deepEqual(plan.missing, []);
  // Ledger records the new build first, then the seeded pre-existing snapshot.
  assert.equal(plan.nextLedger.builds.length, 2);
  assert.equal(plan.nextLedger.builds[0].ts, 't1');
  assert.equal(plan.nextLedger.builds[1].ts, 'pre-retention');
});

test('steady state keeps the union of the last N builds', () => {
  const N1 = ['index-N1.js', 'chunk-N1.js'];
  const N2 = ['index-N2.js', 'chunk-N2.js'];
  const N3 = ['index-N3.js', 'chunk-N3.js'];
  // prevFiles before build 3 = everything retained from builds 1 & 2.
  const prevFiles = [...N1, ...N2];
  const plan = planAssetRetention({
    prevFiles,
    newFiles: N3,
    ledgerBuilds: [
      { ts: 't2', files: N2 },
      { ts: 't1', files: N1 },
    ],
    retainBuilds: 3,
    now: 't3',
  });

  assert.deepEqual(new Set(plan.keep), new Set([...N1, ...N2, ...N3]));
  assert.deepEqual(new Set(plan.restore), new Set([...N1, ...N2]));
  assert.deepEqual(plan.missing, []);
  assert.deepEqual(plan.nextLedger.builds.map((b) => b.ts), ['t3', 't2', 't1']);
});

test('builds older than the retention window are aged out (pruned)', () => {
  const P0 = ['index-P0.js']; // oldest, should be dropped
  const N1 = ['index-N1.js'];
  const N2 = ['index-N2.js'];
  const N3 = ['index-N3.js'];
  const prevFiles = [...P0, ...N1, ...N2]; // on disk before build 3
  const plan = planAssetRetention({
    prevFiles,
    newFiles: N3,
    ledgerBuilds: [
      { ts: 't2', files: N2 },
      { ts: 't1', files: N1 },
      { ts: 'pre-retention', files: P0 },
    ],
    retainBuilds: 3,
    now: 't3',
  });

  // P0 falls outside the 3-build window and must NOT be kept or restored.
  assert.ok(!plan.keep.includes('index-P0.js'));
  assert.ok(!plan.restore.includes('index-P0.js'));
  assert.deepEqual(new Set(plan.keep), new Set([...N1, ...N2, ...N3]));
  assert.deepEqual(plan.nextLedger.builds.map((b) => b.ts), ['t3', 't2', 't1']);
});

test('a hash reused across consecutive builds is not treated as missing', () => {
  const shared = 'vendor-STABLE.js';
  const N1 = ['index-N1.js', shared];
  const N2 = ['index-N2.js', shared];
  const plan = planAssetRetention({
    prevFiles: N1,
    newFiles: N2,
    ledgerBuilds: [{ ts: 't1', files: N1 }],
    retainBuilds: 3,
    now: 't2',
  });

  // shared is freshly built (in newFiles) so it is neither restored nor missing.
  assert.ok(!plan.restore.includes(shared));
  assert.deepEqual(plan.missing, []);
  assert.deepEqual(new Set(plan.restore), new Set(['index-N1.js']));
});

test('retainBuilds=1 keeps only the fresh build (no retention)', () => {
  const plan = planAssetRetention({
    prevFiles: ['old.js'],
    newFiles: ['new.js'],
    ledgerBuilds: [{ ts: 't1', files: ['old.js'] }],
    retainBuilds: 1,
    now: 't2',
  });
  assert.deepEqual(plan.keep, ['new.js']);
  assert.deepEqual(plan.restore, []);
  assert.equal(plan.nextLedger.builds.length, 1);
});
