/**
 * D176 — the chunk-closure guard over `docs/assets/`.
 *
 * The guard asserts every chunk->chunk reference in the built bundle resolves.
 * These tests assert the guard itself, because the thing it replaces —
 * `check-spa-live.mjs` — was green the whole time the graph it could not see
 * was the suspect. A guard bought to close a blind spot must not have one.
 *
 * The assertion that matters most is `assertBothFormsSeen`. This bundler emits
 * references in two shapes, `"assets/Name-hash.js"` and `"./Name-hash.js"`, and
 * an extractor that handles one of them scans a fraction of the tree and
 * reports a clean result. That is not hypothetical — it is the mistake that
 * produced "18 chunks reachable, 0 dangling" against a 1276-chunk tree while
 * the real figure was 557, and it read as a pass.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  referencesOf,
  assertBothFormsSeen,
} from '../../scripts/check-docs-assets-closure.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

// ---------------------------------------------------------------------------
// The extractor

test('both reference forms are extracted, and each is tallied on its own', () => {
  const tally = { bare: 0, dot: 0 };
  const refs = referencesOf(
    'import("assets/A-1111aaaa.js");import("./B-2222bbbb.js");x="assets/C-3333cccc.css"',
    tally,
  );
  assert.deepEqual([...refs].sort(), ['A-1111aaaa.js', 'B-2222bbbb.js', 'C-3333cccc.css']);
  assert.equal(tally.bare, 2, 'the bare `assets/…` form was not counted');
  assert.equal(tally.dot, 1, 'the `./…` form was not counted');
});

test('single quotes and a ../assets prefix are the same reference', () => {
  const refs = referencesOf("import('../assets/D-4444dddd.js')");
  assert.deepEqual([...refs], ['D-4444dddd.js']);
});

// ---------------------------------------------------------------------------
// The self-check — the reason this guard can be trusted to fail

test('seeing only one reference form is reported as a broken extractor', () => {
  assert.match(
    assertBothFormsSeen({ bare: 0, dot: 900 }, 1276) || '',
    /assets\/…/,
    'an extractor blind to the form the ENTRY chunk uses must not report a pass',
  );
  assert.match(
    assertBothFormsSeen({ bare: 55, dot: 0 }, 1276) || '',
    /\.\/…/,
    'an extractor blind to the form most chunks use must not report a pass',
  );
});

test('seeing both forms is a pass, and a trivial corpus is exempt', () => {
  assert.equal(assertBothFormsSeen({ bare: 55, dot: 1239 }, 1276), null);
  // A one-chunk build legitimately references nothing; the self-check must not
  // turn that into a failure, or it fires on the empty case instead of the bug.
  assert.equal(assertBothFormsSeen({ bare: 0, dot: 0 }, 1), null);
});

// ---------------------------------------------------------------------------
// Wiring — or it is a script nobody runs

test('the guard runs in test:guards and is documented', () => {
  const pkg = read('package.json');
  assert.match(pkg, /node scripts\/check-docs-assets-closure\.mjs/,
    'the guard is not in test:guards, so nothing runs it on a PR');
  const readme = read('scripts/README.md');
  const row = readme.split('\n').find((l) => l.includes('`check-docs-assets-closure.mjs`')) || '';
  assert.ok(row, 'add the check-docs-assets-closure.mjs row to scripts/README.md');
  assert.match(row, /never builds/, 'the README row dropped the never-builds constraint');
  assert.match(row, /self-check/, 'the README row dropped the self-check, which is why the guard is trustworthy');
});

test('it runs before the two checks that cost a bundle', () => {
  const chain = JSON.parse(read('package.json')).scripts['test:guards'].split(' && ');
  const at = (name) => chain.findIndex((c) => c.includes(name));
  const me = at('check-docs-assets-closure');
  assert.ok(me > 0, 'the guard is not in the chain');
  // `check-frontend-builds` runs the real bundler and `check-docs-fresh` hashes
  // the whole source tree. A one-line finding should fail before either.
  assert.ok(me < at('check-docs-fresh'), 'the guard must run before check-docs-fresh');
  assert.ok(me < at('check-frontend-builds'), 'the guard must run before check-frontend-builds');
});

test('importing the guard does not run the scan', () => {
  // It calls `process.exit(1)` on a finding, so a bare module body would kill
  // this very test process the moment the built graph went bad — which is
  // exactly when these tests most need to run. This file imports it above, so
  // the test existing at all is half the proof; the line is pinned so a later
  // edit cannot quietly move the scan back to the module body.
  const src = read('scripts/check-docs-assets-closure.mjs');
  assert.match(
    src,
    /if \(import\.meta\.url === pathToFileURL\(process\.argv\[1\] \|\| ''\)\.href\) main\(\);/,
    'the scan is no longer gated on being run directly',
  );
});

test('it reads docs/assets and never builds into it', () => {
  // The root build wipes docs/ and then restores a retention window, so a check
  // that built in order to check would rewrite every tracked file under it.
  const src = read('scripts/check-docs-assets-closure.mjs');
  assert.doesNotMatch(src, /spawnSync|execSync|mkdtemp|vite build/,
    'the guard must not build, spawn or write — it reads docs/assets/ only');
  assert.doesNotMatch(src, /writeFileSync|rmSync|unlinkSync/,
    'the guard must not write to the tree it is checking');
});
