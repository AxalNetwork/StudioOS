/**
 * #4104 — the generated file list's pure half (`folderFiles.mjs`).
 *
 *   node --test scripts/lib/folderFiles.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { FILES_BEGIN, FILES_END, blockHoldsList, findBlock, headerLine, listedFile, renderList, withBlock } from './folderFiles.mjs';

test('headerLine: the first line of the header comment, in every shape the repo writes one', () => {
  // Mutation checked: the JSDoc fallback dropped → the component case reads null; pragmas kept → the eslint case reads them.
  assert.equal(headerLine('/**\n * D1150: investor deal progress.\n * More.\n */\nexport const x = 1;'), 'D1150: investor deal progress.');
  assert.equal(headerLine('/**\n * D1415 — the Portfolio reads: the switcher (companies with their projects,\n * each a row) and the counts. Then more.\n */'),
    'D1415 — the Portfolio reads: the switcher (companies with their projects, each a row) and the counts.', 'a sentence that wraps is read whole');
  assert.equal(headerLine('/**\n * Uses `a.ts` and v1.2 here.\n *\n * Second paragraph.\n */'), 'Uses `a.ts` and v1.2 here.', 'a dot inside a name is not a full stop');
  assert.equal(headerLine('/** One line. */'), 'One line.');
  assert.equal(headerLine('// The Hono app for /api/ai.\n// Second line.\nimport x from "y";'), 'The Hono app for /api/ai.');
  assert.equal(headerLine('-- 714: card uids.\nCREATE TABLE t (id INTEGER);'), '714: card uids.');
  assert.equal(headerLine('#!/usr/bin/env node\n/**\n * check-x — a guard.\n */'), 'check-x — a guard.');
  assert.equal(headerLine('/* eslint-disable no-console */\n/**\n * Real words.\n */'), 'Real words.', 'a pragma block is skipped for the JSDoc after it');
  assert.equal(headerLine('// eslint-disable-next-line\n// What it does.\n'), 'What it does.');
  assert.equal(headerLine('import React from "react";\n\n/**\n * The deal page notes.\n */\nexport default function N() {}'), 'The deal page notes.', 'a component documents itself after its imports');
  assert.equal(headerLine('/**\n * @param x\n * Then words.\n */'), 'Then words.', 'a tag line is not a description');
  assert.equal(headerLine("import { request } from '../api.js';\n\n// D1361 — the Lovable client.\nexport const a = 1;"), 'D1361 — the Lovable client.', 'a `//` header after the imports');
  assert.equal(headerLine("import a from 'a';\nimport {\n  b,\n} from 'b';\n// After a multi-line import.\n"), 'After a multi-line import.');
  assert.equal(headerLine("import a from 'a';\nexport const x = 1; // trailing, not a header\n"), null);
  assert.equal(headerLine('export const x = 1;\n'), null);
  assert.equal(headerLine(''), null);
  assert.equal(headerLine(`// ${'a'.repeat(300)}`).length, 160, 'clipped');
});

test('listedFile: source files only, never a README or a declaration file', () => {
  for (const f of ['a.ts', 'b.jsx', 'c.mjs', 'd.sql', 'e.js']) assert.equal(listedFile(f), true, f);
  for (const f of ['README.md', 'x.d.ts', 'y.json', 'z.css', 'w.png']) assert.equal(listedFile(f), false, f);
});

test('renderList: one row per file, sorted, a pipe escaped, a file with no header an empty description', () => {
  // Mutation checked: the sort dropped → the order assertion fails.
  const out = renderList([{ name: 'zeta.ts', text: '// Z | the last.' }, { name: 'alpha.ts', text: '/** A first. */' }, { name: 'mid.ts', text: 'export {}' }]);
  assert.equal(out, '\n| File | What it is |\n| --- | --- |\n| `alpha.ts` | A first. |\n| `mid.ts` |  |\n| `zeta.ts` | Z \\| the last. |\n');
});

test('the block: found, filled, emptied; a missing end or a second begin is broken', () => {
  // Mutation checked: withBlock writing outside the markers → the round trip fails.
  const readme = `# T\n\nWords.\n\n${FILES_BEGIN}\n${FILES_END}\n\nMore words.\n`;
  assert.deepEqual(findBlock(readme), { broken: false, content: '\n' });
  assert.equal(blockHoldsList(findBlock(readme).content), false);
  const filled = withBlock(readme, renderList([{ name: 'a.ts', text: '// A.' }]));
  assert.ok(blockHoldsList(findBlock(filled).content));
  assert.match(filled, /^# T\n\nWords\.\n\n<!-- files:begin -->\n\| File/);
  assert.match(filled, /<!-- files:end -->\n\nMore words\.\n$/);
  assert.equal(withBlock(filled, ''), readme, 'emptying restores the committed form exactly');
  assert.equal(findBlock('# T\nno block'), null);
  assert.deepEqual(findBlock(`${FILES_BEGIN}\nno end`), { broken: true });
  assert.deepEqual(findBlock(`${FILES_BEGIN}\n${FILES_BEGIN}\n${FILES_END}`), { broken: true });
});
