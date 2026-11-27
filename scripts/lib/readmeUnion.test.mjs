// The README union-merge leftovers check-folder-docs refuses (scripts/lib/readmeUnion.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WINDOW, unionArtifacts } from './readmeUnion.mjs';

const LONG = 'Back/Forward, without selecting the first of multiple ventures. An unsaved model';

test('two rows for one file in one table are caught; rows appended side by side are not', () => {
  const two = '| File | What |\n|---|---|\n| `a.js` | D1: the first version of this row |\n| `b.js` | another file |\n| `a.js` | D2: the second version of this row |\n';
  assert.deepEqual(unionArtifacts(two).map((f) => [f.line, f.kind, f.text]), [[5, 'row', '`a.js`']]);
  assert.deepEqual(unionArtifacts('| `a.js` | one |\n| `b.js` | two |\n'), []);
  assert.deepEqual(unionArtifacts('| `a.js` | in the first table |\n\n| `a.js` | in another table |\n'), [], 'two tables may each name a file');
  assert.deepEqual(unionArtifacts('| D690 | S18 | #1690 | one |\n| D690 | S18 | #1691 | two |\n'), [], 'a table keyed by a decision may repeat it');
});

test('a line union kept twice nearby is a repeat; a template line in separate sections is not', () => {
  assert.deepEqual(unionArtifacts(`# T\n\n${LONG}\nmain's version\n${LONG}\n`).map((f) => [f.line, f.kind]), [[5, 'repeat']]);
  assert.deepEqual(unionArtifacts([LONG, ...Array(WINDOW).fill('x'), LONG].join('\n')), []);
  assert.equal(unionArtifacts([LONG, ...Array(WINDOW - 1).fill('x'), LONG].join('\n')).length, 1);
});

test('table rules and short lines never count; conflict markers always do', () => {
  assert.deepEqual(unionArtifacts('|---|---|\n|---|---|\n'), []);
  assert.deepEqual(unionArtifacts('Not recorded.\nNot recorded.\n'), []);
  assert.deepEqual(unionArtifacts('a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> origin/main\n').map((f) => f.kind), ['marker', 'marker', 'marker']);
});

test('.gitattributes merges every README.md with union', () => {
  const attrs = readFileSync(new URL('../../.gitattributes', import.meta.url), 'utf8');
  assert.match(attrs, /^README\.md\s+merge=union\s*$/m);
});
