import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planAssetRetention, seedFilesFor, SEED_COMMITTED_TREE_FLAG } from './assetRetention.mjs';

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

test('a rebuild of the same source replaces the newest entry instead of taking a slot', () => {
  // Content-hashed names mean an identical file set IS an identical build.
  // Rebuilding the same source locally, then again in CI, then again on a
  // docs-only branch is routine — and when each one took a slot, a
  // three-build window ended up holding one distinct build, deleting the very
  // assets it existed to keep. On 2026-09-03 that dropped 1202 hashes a
  // client on the previous shell would still have asked for.
  const OLD = ['index-OLD.js', 'chunk-OLD.js'];
  const CUR = ['index-CUR.js', 'chunk-CUR.js'];

  const plan = planAssetRetention({
    prevFiles: [...OLD, ...CUR],
    newFiles: [...CUR].reverse(), // same set, different order — still the same build
    ledgerBuilds: [
      { ts: 't2', files: CUR },
      { ts: 't1', files: OLD },
    ],
    retainBuilds: 2,
    now: 't3',
  });

  assert.equal(plan.nextLedger.builds.length, 2, 'the identical rebuild must not add a third entry');
  assert.equal(plan.nextLedger.builds[0].ts, 't3', 'the newest entry still records the latest build time');
  assert.deepEqual(new Set(plan.nextLedger.builds[0].files), new Set(CUR));
  assert.equal(plan.nextLedger.builds[1].ts, 't1', 'the older DISTINCT build must survive the rebuild');
  // The point of the whole exercise: the older build's hashes are still kept.
  assert.deepEqual(new Set(plan.keep), new Set([...OLD, ...CUR]));
  assert.deepEqual(new Set(plan.restore), new Set(OLD));
});

test('a rebuild that changes even one file is a new build and does take a slot', () => {
  const OLD = ['index-OLD.js'];
  const CUR = ['index-CUR.js', 'chunk-CUR.js'];
  const NEXT = ['index-CUR.js', 'chunk-NEXT.js']; // one hash differs

  const plan = planAssetRetention({
    prevFiles: [...OLD, ...CUR],
    newFiles: NEXT,
    ledgerBuilds: [
      { ts: 't2', files: CUR },
      { ts: 't1', files: OLD },
    ],
    retainBuilds: 2,
    now: 't3',
  });

  assert.equal(plan.nextLedger.builds.length, 2);
  assert.equal(plan.nextLedger.builds[0].ts, 't3');
  assert.equal(plan.nextLedger.builds[1].ts, 't2', 'the previous build stays; the oldest ages out normally');
  assert.deepEqual(new Set(plan.keep), new Set([...CUR, ...NEXT]));
});

// D252 (task 333). A ledger whose window is full of other rebuilds used to
// drop the generation the seed was computed to keep.
const STALE_LEDGER = [
  { ts: 't3', files: ['index-L3.js'] },
  { ts: 't2', files: ['index-L2.js'] },
  { ts: 't1', files: ['index-L1.js'] },
];

test('D252: a stale ledger plus seedFiles PREV keeps and restores all of PREV', () => {
  const PREV = ['index-PREV.js', 'chunk-PREV.js'];
  const plan = planAssetRetention({
    prevFiles: [...PREV, 'index-L3.js', 'index-DEAD.js'],
    seedFiles: PREV,
    newFiles: ['index-NEW.js'],
    ledgerBuilds: STALE_LEDGER,
    retainBuilds: 3,
    now: 't4',
  });
  for (const f of PREV) {
    assert.ok(plan.keep.includes(f), `${f} is kept`);
    assert.ok(plan.restore.includes(f), `${f} is restored`);
  }
  // The seed joins the kept set; it does not take a ledger slot.
  assert.deepEqual(plan.nextLedger.builds.map((b) => b.ts), ['t4', 't3', 't2']);
  // Nothing outside the window or the seed comes back.
  assert.ok(!plan.keep.includes('index-DEAD.js'));
  assert.ok(!plan.keep.includes('index-L1.js'));
});

test('D252: no seed plus a stale ledger behaves as before, keeping only the window', () => {
  const plan = planAssetRetention({
    prevFiles: ['index-PREV.js', 'index-L3.js', 'index-L2.js', 'index-L1.js'],
    newFiles: ['index-NEW.js'],
    ledgerBuilds: STALE_LEDGER,
    retainBuilds: 3,
    now: 't4',
  });
  // The prevFiles fallback never joins the kept set: that is D183's high-water mark.
  assert.deepEqual(new Set(plan.keep), new Set(['index-NEW.js', 'index-L3.js', 'index-L2.js']));
  assert.deepEqual(new Set(plan.restore), new Set(['index-L3.js', 'index-L2.js']));
});

test('D252: the deploy flag seeds the committed tree, and its absence does not', () => {
  const GEN = ['index-GEN.js'];
  const TREE = ['index-GEN.js', 'index-LAST-DEPLOY.js'];
  const savedCI = process.env.CI;
  try {
    // Without the flag, even under CI, the seed is the previous generation.
    process.env.CI = 'true';
    assert.deepEqual(seedFilesFor({ argv: [], prevGeneration: GEN }), GEN);
    // With the flag, and no CI, the seed falls back to the whole committed tree.
    delete process.env.CI;
    assert.equal(seedFilesFor({ argv: [SEED_COMMITTED_TREE_FLAG], prevGeneration: GEN }), null);
  } finally {
    if (savedCI === undefined) delete process.env.CI; else process.env.CI = savedCI;
  }

  const flagged = planAssetRetention({
    prevFiles: TREE,
    seedFiles: seedFilesFor({ argv: [SEED_COMMITTED_TREE_FLAG], prevGeneration: GEN }),
    newFiles: ['index-NEW.js'],
    now: 't1',
  });
  assert.ok(flagged.keep.includes('index-LAST-DEPLOY.js'), 'the flag keeps what the last deploy uploaded');

  const unflagged = planAssetRetention({
    prevFiles: TREE,
    seedFiles: seedFilesFor({ argv: [], prevGeneration: GEN }),
    newFiles: ['index-NEW.js'],
    now: 't1',
  });
  assert.ok(!unflagged.keep.includes('index-LAST-DEPLOY.js'), 'without the flag the seed is the generation only');
});

test('D252: only the production deploy workflow passes the flag', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (f) => readFileSync(new URL(`../../.github/workflows/${f}`, import.meta.url), 'utf8');
  assert.match(read('cloudflare-worker-deploy.yml'), /^\s+run: npm run build -- --seed-committed-tree$/m);
  for (const f of ['ci.yml', 'pr-preview.yml', 'branch-provision.yml']) {
    assert.doesNotMatch(read(f), /seed-committed-tree/, `${f} must not seed the committed tree`);
  }
});
