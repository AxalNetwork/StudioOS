/**
 * `sourceTreeHash` — what `docs/.build-source` records, and what
 * `check-docs-fresh` compares against.
 *
 * The properties that matter are not "it hashes bytes" but the ways a naive
 * implementation goes wrong: `readdirSync` order is unspecified so two machines
 * can disagree about an unchanged tree; a rename or a move with no edit is a
 * real change to what the build consumes and must not hash the same; an empty
 * file must still count; and a missing directory must be an error rather than a
 * hash, because a hash for "nothing here" would eventually equal some real
 * tree's answer and read as a match.
 *
 * TWO OF THESE TESTS WERE WRITTEN WRONG FIRST, and both passed against code
 * with the property deleted. Each now says in its own body what the fixture has
 * to control and why the obvious version could not fail — that reasoning is the
 * part worth keeping, because the obvious version is what anyone writes first.
 *
 * Run with:
 *   node --test scripts/lib/sourceTreeHash.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sourceTreeHash, sourceFiles } from './sourceTreeHash.mjs';

/** A throwaway tree; `files` maps relative path → contents. */
function tree(files) {
  const dir = mkdtempSync(join(tmpdir(), 'sth-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
}

test('the walk sorts, even when the filesystem hands entries back in another order', () => {
  // TWO EARLIER VERSIONS OF THIS TEST COULD NOT FAIL, and both looked fine.
  // Building the same tree twice in different creation orders and comparing
  // digests does not work: ext4 enumerates a directory by filename hash rather
  // than creation order, so both walks return the same sequence whether or not
  // the code sorts. Asserting `sourceFiles(dir)` is sorted does not work
  // either, for the same reason — the raw walk is already sorted here. Deleting
  // `.sort()` survived both.
  //
  // `readdirSync`'s order is unspecified, so the sort is real defence on
  // filesystems that return creation order; the only way to pin it on this one
  // is to hand the walk a reader that does.
  const reversed = (d, opts) => readdirSync(d, opts).reverse();

  const dir = tree({ 'a.js': '1', 'm/a.js': '2', 'm/b.js': '3', 'z.js': '4' });
  const files = sourceFiles(dir, reversed);
  assert.deepEqual(files, [...files].sort(),
    'the walk returned the filesystem\'s order — the hash would depend on the filesystem');
  assert.equal(files.length, 4, 'nested files must be walked, not just the top level');

  // And the digest must be the same one the default reader produces.
  assert.equal(sourceTreeHash(dir, reversed), sourceTreeHash(dir),
    'two enumeration orders of one tree produced two hashes');
  rmSync(dir, { recursive: true });
});

test('the same content hashes the same across two separate trees', () => {
  const a = tree({ 'a.js': '1', 'b/c.js': '2', 'b/d.js': '3' });
  const b = tree({ 'b/d.js': '3', 'a.js': '1', 'b/c.js': '2' });
  assert.equal(sourceTreeHash(a), sourceTreeHash(b),
    'two identical trees disagreed — the absolute path or the walk order leaked in');
  rmSync(a, { recursive: true }); rmSync(b, { recursive: true });
});

test('a one-byte edit changes the hash, including inside a nested directory', () => {
  const base = tree({ 'a.js': '1', 'b/c.js': '2' });
  const before = sourceTreeHash(base);
  writeFileSync(join(base, 'b', 'c.js'), '2 ');
  assert.notEqual(sourceTreeHash(base), before, 'a nested edit did not reach the hash');
  rmSync(base, { recursive: true });
});

test('a comment-only edit still changes the hash — that is the point', () => {
  // THE CASE THAT MADE THIS FILE EXIST (#207, D103). The emitted bundle is
  // byte-identical for a comment-only change, so nothing in docs/ moves and the
  // old commit-timestamp gate could not be satisfied. The stamp has to notice
  // what the bundle does not, or the gate has nothing to compare.
  const base = tree({ 'a.js': 'export const x = 1;\n' });
  const before = sourceTreeHash(base);
  writeFileSync(join(base, 'a.js'), '// why x is 1\nexport const x = 1;\n');
  assert.notEqual(sourceTreeHash(base), before);
  rmSync(base, { recursive: true });
});

test('a rename that keeps its sort position still changes the hash', () => {
  // THE FIXTURE IS THE ASSERTION HERE. The obvious version — rename `a.js` to
  // `renamed.js` — passes even when the path is NOT hashed at all, because the
  // rename moves the file past `b.js` in sort order and the CONTENT sequence
  // changes from [1,2] to [2,1]. It was testing ordering while claiming to test
  // paths, and deleting the path from the digest left it green.
  //
  // `a.js` → `b.js` in a tree whose other file is `z.js` keeps the sorted
  // content sequence at [1,2] and changes only the name. Nothing but hashing
  // the path can see it.
  const base = tree({ 'a.js': '1', 'z.js': '2' });
  const before = sourceTreeHash(base);
  renameSync(join(base, 'a.js'), join(base, 'b.js'));
  assert.deepEqual(sourceFiles(base).map((p) => p.split('/').pop()), ['b.js', 'z.js'],
    'fixture check: the renamed file must still sort first, or this tests ordering again');
  assert.notEqual(sourceTreeHash(base), before,
    'the path is hashed alongside the content, or moving a module reads as no change');
  rmSync(base, { recursive: true });
});

test('moving a file between directories changes the hash', () => {
  // Same trap, one level up: `src/a.js` → `lib/a.js` with identical content is
  // only visible if the RELATIVE path is part of the digest.
  const a = tree({ 'src/a.js': '1', 'z.js': '2' });
  const b = tree({ 'lib/a.js': '1', 'z.js': '2' });
  assert.notEqual(sourceTreeHash(a), sourceTreeHash(b));
  rmSync(a, { recursive: true }); rmSync(b, { recursive: true });
});

test('adding an empty file changes the hash', () => {
  // An empty file contributes no content bytes, so a separator-free encoding
  // would hash it the same as its absence.
  const base = tree({ 'a.js': '1' });
  const before = sourceTreeHash(base);
  writeFileSync(join(base, 'b.js'), '');
  assert.notEqual(sourceTreeHash(base), before);
  rmSync(base, { recursive: true });
});

test('a missing directory throws rather than returning a hash', () => {
  assert.throws(() => sourceTreeHash(join(tmpdir(), 'sth-does-not-exist-9e3f')),
    'a hash for a missing tree would eventually equal a real one and read as a match');
});
