/**
 * The no-ledger seed keeps the PREVIOUS GENERATION, not the whole tree.
 *
 * WHY THIS IS THE TEST THAT MATTERS. The ledger is gitignored, so CI takes the
 * no-ledger path on EVERY run — and that path used to seed every asset on disk
 * as one synthetic prior build. `.gitignore` called it "the safe direction (it
 * prunes less, never more)", and pruning less, never more, is exactly how the
 * committed set became a high-water mark: 964 files on `main` against a clean
 * build's 597. These assertions exercise that path directly, because it is the
 * one production actually runs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { generationFrom } from './assetGeneration.mjs';
import { planAssetRetention } from './assetRetention.mjs';

// Three generations on disk. Each is a shell entry plus one chunk it imports;
// `old` is unreachable from any shell that survives, `prev` is the one a client
// may still be holding, and `fresh` is what this build produced.
const OLD = ['index-old.js', 'lazy-old.js'];
const PREV = ['index-prev.js', 'lazy-prev.js'];
const FRESH = ['index-fresh.js', 'lazy-fresh.js'];
const ON_DISK = [...OLD, ...PREV];

const SOURCES = {
  'index-old.js': 'import("./lazy-old.js")',
  'lazy-old.js': '',
  'index-prev.js': 'import(`./lazy-prev.js`)',   // backticks on purpose — see below
  'lazy-prev.js': '',
};
const PREV_SHELL = '<script type="module" src="/assets/index-prev.js"></script>';

const walk = () => generationFrom({
  indexHtml: PREV_SHELL,
  assetsDir: '',
  availableFiles: ON_DISK,
  readFile: (f) => SOURCES[f] ?? '',
});

test('the walk reaches the shell entry and what it imports, and nothing older', () => {
  const { reachable, danglingFrom } = walk();
  assert.deepEqual([...reachable].sort(), [...PREV].sort(),
    'the generation is not the closure of the shell it was read from');
  assert.deepEqual(danglingFrom, [],
    'the walk reported a reference it could not resolve against a complete fixture');
});

test('a backtick import is followed — the form Rollup emits for a lazy chunk', () => {
  // `import(`./purify.es-<hash>.js`)` is a template literal, and an extractor
  // whose quote class is ["'] reads straight past it. Measured on the committed
  // tree: that was the one file of 601 no walk could reach.
  const { reachable } = walk();
  assert.ok(reachable.includes('lazy-prev.js'),
    'the lazy chunk imported with backticks was not reached, so a whole class of edge '
    + 'is invisible and its chunks would be pruned as unreferenced');
});

test('the no-ledger seed keeps the previous generation and drops the one before it', () => {
  const { reachable } = walk();
  const plan = planAssetRetention({
    prevFiles: ON_DISK,
    seedFiles: reachable,
    newFiles: FRESH,
    ledgerBuilds: [],
    retainBuilds: 3,
  });
  const keep = new Set(plan.keep);

  for (const f of FRESH) assert.ok(keep.has(f), `${f} is this build's own output and must be kept`);
  for (const f of PREV) {
    assert.ok(keep.has(f),
      `${f} belongs to the previous generation — a client still holding that shell asks for it, `
      + 'which is the whole reason the retention window exists');
  }
  for (const f of OLD) {
    assert.ok(!keep.has(f),
      `${f} belongs to a generation no committed shell references, so keeping it is the `
      + 'accumulation this seed was narrowed to stop');
  }
});

test('without the narrowed seed the older generation survives — the defect, reproduced', () => {
  // The same inputs with the OLD behaviour (seed = everything on disk). If this
  // ever stops keeping the dead generation, the test above has stopped proving
  // anything, because the two paths would no longer differ.
  const plan = planAssetRetention({
    prevFiles: ON_DISK,
    newFiles: FRESH,
    ledgerBuilds: [],
    retainBuilds: 3,
  });
  const keep = new Set(plan.keep);
  for (const f of OLD) {
    assert.ok(keep.has(f),
      'the unnarrowed seed no longer keeps a dead generation, so the narrowed one is not '
      + 'being compared against the behaviour it replaced');
  }
});

test('an unreadable or absent shell falls back to the old behaviour, not to nothing', () => {
  // Seeding NOTHING would drop the previous generation outright and blank the
  // page for every client mid-deploy. An empty seed must read as "no
  // generation could be computed", which the planner answers with prevFiles.
  const plan = planAssetRetention({
    prevFiles: ON_DISK,
    seedFiles: [],
    newFiles: FRESH,
    ledgerBuilds: [],
    retainBuilds: 3,
  });
  const keep = new Set(plan.keep);
  for (const f of PREV) assert.ok(keep.has(f), `${f} was dropped when no generation could be read`);
});

test('a shell that names its entry inside an inline script is read too', () => {
  // The prerendered shells reference their entry from a `src="/assets/…"`
  // attribute, which never uses backticks — but a shell may also carry an
  // inline module that names a chunk in a template literal, and a reference the
  // seed cannot see is a chunk the next build prunes as unreferenced. Without
  // this fixture the backtick half of SHELL_REF is decoration: narrowing it
  // back to ["'] passed every other assertion in this file.
  const { reachable } = generationFrom({
    indexHtml: '<script type="module">import(`/assets/index-prev.js`)</script>',
    assetsDir: '',
    availableFiles: ON_DISK,
    readFile: (f) => SOURCES[f] ?? '',
  });
  assert.deepEqual([...reachable].sort(), [...PREV].sort(),
    'a backtick reference in the shell was not read, so its whole generation would be pruned');
});
