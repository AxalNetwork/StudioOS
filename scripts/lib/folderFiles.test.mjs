/**
 * #4104 — the generated file list's pure half (`folderFiles.mjs`).
 *
 * #6465 — the decisions index is generated, and a README can declare that it
 * takes no hand-written per-file rows (`<!-- index: generated -->`,
 * `<!-- index: none -->`), read by `../check-folder-docs.mjs` (its rule 6).
 * The end-to-end cases run the real guard in a throwaway git repository. It
 * fails there anyway (none of the documented folders exist), so each case
 * asserts on the lines about its own fixture README, never on the exit code.
 *
 *   node --test scripts/lib/folderFiles.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FILES_BEGIN, FILES_END, INDEX_GENERATED, INDEX_NONE, blockHoldsList, findBlock, folderListing, headerLine, headingLine,
  indexMode, listedFile, perFileRows, renderList, withBlock,
} from './folderFiles.mjs';

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

// ── #6465 ──────────────────────────────────────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const GUARD = join(REPO, 'scripts/check-folder-docs.mjs');

const README = `# Fixture decisions\n\nOne file per decision; this README takes no rows.\n\n${INDEX_GENERATED}\n\n${FILES_BEGIN}\n${FILES_END}\n`;
const decision = (n, title) => `## D${n} — ${title} (#${n})\n\nBody.\n`;

function tmp() { return mkdtempSync(join(tmpdir(), 'readme-index-6465-')); }
function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false',
    '-c', 'core.attributesFile=/dev/null', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function repo() {
  const dir = tmp();
  git(dir, 'init', '-q', '-b', 'main');
  // Merge attributes off: no .gitattributes is committed, the global file is /dev/null,
  // and info/attributes (which outranks every in-tree file) pins git's plain text merge,
  // so no `merge=union` can take part. GitHub's merge ignores union in the same way.
  mkdirSync(join(dir, '.git/info'), { recursive: true });
  writeFileSync(join(dir, '.git/info/attributes'), '* merge=text\n');
  return dir;
}
function put(root, rel, text) { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); }
function guard(cwd, ...args) {
  const r = spawnSync(process.execPath, [GUARD, ...args], { cwd, encoding: 'utf8' });
  return `${r.stdout}\n${r.stderr}`;
}
const about = (out, readme) => out.split('\n').filter((l) => l.includes(readme)).join('\n');

test('headingLine and indexMode: a decision is described by its heading; the README declares its own mode', () => {
  assert.equal(headingLine('## D6465 — The decisions index is generated (#6465)\n\nBody.'), 'D6465 — The decisions index is generated (#6465)');
  assert.equal(headingLine('\n# Title\n'), 'Title');
  assert.equal(headingLine('No heading here.\n## Later'), null, 'only the first line counts');
  assert.equal(indexMode(`# R\n${INDEX_GENERATED}\n`), 'generated');
  assert.equal(indexMode(`# R\n${INDEX_NONE}\n`), 'none');
  assert.equal(indexMode('# R\n| `a.ts` | a |\n'), null);
  assert.equal(indexMode(`${INDEX_GENERATED}${INDEX_NONE}`), 'both');
});

test('a fixture decision file added: the generated list contains it, and the committed README does not change', () => {
  // Mutation checked: folderListing dropping `.md` files under `index: generated` → the D7 row is missing.
  const dir = tmp();
  try {
    writeFileSync(join(dir, 'README.md'), README);
    writeFileSync(join(dir, 'D1000.md'), decision(1000, 'The first'));
    writeFileSync(join(dir, 'D999.md'), decision(999, 'The earlier'));
    const before = readFileSync(join(dir, 'README.md'), 'utf8');
    const list1 = renderList(folderListing(dir, indexMode(before)));
    assert.equal(list1, '\n| File | What it is |\n| --- | --- |\n| `D999.md` | D999 — The earlier (#999) |\n| `D1000.md` | D1000 — The first (#1000) |\n',
      'every decision, by number, described by its heading; the README is never a row');

    writeFileSync(join(dir, 'D7.md'), decision(7, 'A new decision'));
    writeFileSync(join(dir, 'D7-p2.md'), '## D7 part 2 — Its second part (#7)\n');
    const list2 = renderList(folderListing(dir, indexMode(before)));
    assert.match(list2, /\| `D7\.md` \| D7 — A new decision \(#7\) \|/);
    assert.match(list2, /\| `D7-p2\.md` \| D7 part 2 — Its second part \(#7\) \|/);
    assert.equal(readFileSync(join(dir, 'README.md'), 'utf8'), before, 'the README was not edited to add the decision');
    assert.equal(withBlock(withBlock(before, list2), ''), before, 'filled for reading, the committed form comes back exactly');
    assert.equal(folderListing(dir, null).length, 0, 'an unmarked README lists source files only, as before #6465');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('perFileRows: a row naming one of the folder\'s files, outside the block; not a subfolder, not another name', () => {
  // Mutation checked: perFileRows reading inside the block → the filled-block case reports rows.
  const names = ['D1.md', 'D2.md'];
  assert.deepEqual(perFileRows(`${README}\n| File | Purpose |\n| --- | --- |\n| \`D2.md\` | hand-written |\n`, names), [{ line: 12, name: 'D2.md' }]);
  assert.deepEqual(perFileRows(withBlock(README, '\n| File | What it is |\n| --- | --- |\n| `D1.md` | generated |\n'), names), [], 'the generated rows are not hand-written');
  assert.deepEqual(perFileRows('| `sub/` | a folder |\n| `D9.md` | not here |\n| D1.md | not a backticked name |\n', names), []);
});

test('the guard: a row committed between the markers fails', () => {
  // Mutation checked: the committed-block check skipped for a MARKED folder → no line about it.
  const dir = repo();
  try {
    put(dir, 'notes/README.md', README);
    put(dir, 'notes/D1.md', decision(1, 'One'));
    git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'base');
    assert.equal(about(guard(dir), 'notes/'), '', 'the clean, marked README passes');

    guard(dir, '--write');
    assert.match(readFileSync(join(dir, 'notes/README.md'), 'utf8'), /\| `D1\.md` \| D1 — One \(#1\) \|/, '--write fills the list');
    assert.equal(about(guard(dir), 'notes/'), '', 'filled in the working tree only, it passes');
    git(dir, 'add', 'notes/README.md');
    assert.match(about(guard(dir), 'notes/'), /notes\/README\.md carries its generated file list in the index/);
    guard(dir, '--clean');
    assert.equal(readFileSync(join(dir, 'notes/README.md'), 'utf8'), README, '--clean empties it');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the guard: a per-file row in an `index: none` README fails; an unmarked README behaves as today', () => {
  // Mutation checked: rule 6 skipped → no line about `plain-none/`; it run for unmarked READMEs → a line about `plain/`.
  const dir = repo();
  try {
    const table = '\n| File | Purpose |\n| --- | --- |\n| `a.mjs` | the one file |\n';
    put(dir, 'plain-none/README.md', `# None\n\nThe folder and its rule.\n\n${INDEX_NONE}\n`);
    put(dir, 'plain-none/a.mjs', '// A.\n');
    put(dir, 'plain/README.md', `# Plain\n\nAn unmarked README with its table.\n${table}`);
    put(dir, 'plain/a.mjs', '// A.\n');
    put(dir, 'both/README.md', `# Both\n\n${INDEX_GENERATED}\n${INDEX_NONE}\n`);
    git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'base');
    assert.equal(about(guard(dir), 'plain-none/'), '', 'no row, no error');
    writeFileSync(join(dir, 'plain-none/README.md'), `# None\n\nThe folder and its rule.\n\n${INDEX_NONE}\n${table}`);
    const out = guard(dir);
    assert.match(about(out, 'plain-none/'), /plain-none\/README\.md:9 has a hand-written row for `a\.mjs`, but the README says `<!-- index: none -->`/);
    assert.equal(about(out, 'plain/README'), '', 'an unmarked README with per-file rows passes, as before #6465');
    assert.match(about(out, 'both/'), /carries both/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('two branches that each add a decision merge cleanly with merge attributes off; hand-written rows did not', () => {
  // The control half is the mutation: the same two branches, each also appending its row
  // the old way, conflict on the README under the same settings.
  for (const rows of [false, true]) {
    const dir = repo();
    try {
      put(dir, 'decisions/README.md', rows ? '# Decisions\n\n| File | Purpose |\n| --- | --- |\n| `D1.md` | One. |\n' : README);
      put(dir, 'decisions/D1.md', decision(1, 'One'));
      git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'base');
      for (const [branch, n] of [['a', 2], ['b', 3]]) {
        git(dir, 'checkout', '-qb', branch, 'main');
        put(dir, `decisions/D${n}.md`, decision(n, `Branch ${branch}`));
        if (rows) put(dir, 'decisions/README.md', `${readFileSync(join(dir, 'decisions/README.md'), 'utf8')}| \`D${n}.md\` | Branch ${branch}. |\n`);
        git(dir, 'add', '.'); git(dir, 'commit', '-qm', `D${n}`);
      }
      const r = spawnSync('git', ['-c', 'core.attributesFile=/dev/null', 'merge-tree', '--write-tree', '--name-only', 'a', 'b'], { cwd: dir, encoding: 'utf8' });
      if (rows) {
        assert.equal(r.status, 1, 'hand-written rows appended at one spot conflict');
        assert.match(r.stdout, /decisions\/README\.md/);
      } else {
        assert.equal(r.status, 0, `the merge is clean: ${r.stdout}${r.stderr}`);
        const tree = r.stdout.split('\n')[0];
        const files = git(dir, 'ls-tree', '--name-only', `${tree}:decisions`).trim().split('\n');
        assert.deepEqual(files, ['D1.md', 'D2.md', 'D3.md', 'README.md']);
        assert.equal(git(dir, 'show', `${tree}:decisions/README.md`), README, 'neither branch touched the README');
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('the real decisions README: marked generated, its block empty in the commit, and no hand-written rows', () => {
  const text = readFileSync(join(REPO, 'documentation/architecture/decisions/README.md'), 'utf8');
  assert.equal(indexMode(text), 'generated');
  const block = findBlock(text);
  assert.ok(block && !block.broken, 'it holds one files block');
  const committed = (() => { try { return execFileSync('git', ['show', ':documentation/architecture/decisions/README.md'], { cwd: REPO, encoding: 'utf8' }); } catch { return text; } })();
  assert.equal(blockHoldsList(findBlock(committed).content), false, 'the list is never committed (D5612)');
  assert.doesNotMatch(withBlock(text, ''), /^\| `D\d+/m, 'no hand-written decision rows remain');
});
