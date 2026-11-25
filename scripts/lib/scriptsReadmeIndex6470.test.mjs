/**
 * #6470: `scripts/README.md` and `scripts/lib/README.md` take no hand-written
 * per-file rows; their lists are generated from each file's header comment
 * (`folderFiles.mjs`, run by `../check-folder-docs.mjs`), and a shell or
 * Python file there is described by its `#` header or docstring.
 *
 * The end-to-end cases copy the real folder (its README and every file directly
 * in it) into a throwaway git repository and run the real guard there. The
 * guard fails in that repository anyway (the other documented folders are
 * missing), so each case asserts on the lines about its own fixture files.
 *
 *   node --test scripts/lib/scriptsReadmeIndex6470.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FILES_BEGIN, FILES_END, INDEX_GENERATED, blockHoldsList, describe, findBlock, folderListing, hashHeaderLine, headerComment,
  indexMode, listedFile, perFileRows, withBlock,
} from './folderFiles.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const GUARD = join(REPO, 'scripts/check-folder-docs.mjs');
// Merge attributes off: no system or global attributes file, and info/attributes (which
// outranks every in-tree file) pins git's plain text merge, so `README.md merge=union` cannot apply.
const ENV = { ...process.env, GIT_ATTR_NOSYSTEM: '1', GIT_CONFIG_NOSYSTEM: '1' };

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false',
    '-c', 'core.attributesFile=/dev/null', ...args], { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'scripts-readme-6470-'));
  git(dir, 'init', '-q', '-b', 'main');
  mkdirSync(join(dir, '.git/info'), { recursive: true });
  writeFileSync(join(dir, '.git/info/attributes'), '* merge=text\n');
  return dir;
}
/** The real folder's README and every tracked file directly in it, into `dir`. */
function copyFolder(dir, folder) {
  const files = git(REPO, 'ls-files', '--', folder).split('\n').filter((f) => f && dirname(f) === folder);
  mkdirSync(join(dir, folder), { recursive: true });
  for (const f of files) copyFileSync(join(REPO, f), join(dir, f));
  return files.length;
}
function guard(cwd, ...args) {
  const r = spawnSync(process.execPath, [GUARD, ...args], { cwd, env: ENV, encoding: 'utf8' });
  return `${r.stdout}\n${r.stderr}`;
}
const about = (out, needle) => out.split('\n').filter((l) => l.includes(needle)).join('\n');
const committedReadme = (folder) => {
  try { return execFileSync('git', ['show', `:${folder}/README.md`], { cwd: REPO, encoding: 'utf8' }); } catch { return readFileSync(join(REPO, folder, 'README.md'), 'utf8'); }
};

test('hashHeaderLine: a shell or Python file is described by its `#` header after the shebang, else its docstring', () => {
  // Mutation checked: the docstring fallback dropped → the Python case reads null; rules kept → the `----` case reads them.
  assert.equal(hashHeaderLine('#!/usr/bin/env bash\n# Upload the export.\n# More.\nset -e\n'), 'Upload the export.');
  assert.equal(hashHeaderLine('#!/usr/bin/env bash\n# ----------\n# scripts/x.sh\n#\n# Restore one backup. Then more.\n'), 'Restore one backup.',
    'a rule line and the bare path are not a description');
  assert.equal(hashHeaderLine('# shellcheck shell=bash\n# The one restore path.\n'), 'The one restore path.', 'a shellcheck pragma is skipped');
  assert.equal(hashHeaderLine('#!/usr/bin/env python3\n"""D6428: a recovery drill.\n\nMore.\n"""\nimport os\n'), 'D6428: a recovery drill.');
  assert.equal(hashHeaderLine("'''Single-quoted docstring.'''\n"), 'Single-quoted docstring.');
  assert.equal(hashHeaderLine('#!/usr/bin/env python3\n# #5526: audits the requirements.\n"""Run the audit."""\n'), '#5526: audits the requirements.',
    'a `#` block before the docstring wins');
  assert.equal(hashHeaderLine('#!/bin/bash\nset -e\n# not a header\n'), null);
  assert.equal(hashHeaderLine('import os\n"""late"""\n'), null);
  assert.equal(describe('a.sh', '# A shell file.\n'), 'A shell file.');
  assert.equal(describe('a.py', '"""A Python file."""\n'), 'A Python file.');
  assert.equal(describe('a.mjs', '# not a JS comment\n'), null, 'a module is still read as JavaScript');
});

test('listedFile and headerComment: shell and Python are listed; the whole header is readable', () => {
  // Mutation checked: `sh|py` dropped from LISTED_EXT → the first loop fails; headerComment reading only the first comment → the `//` case fails.
  for (const f of ['a.sh', 'b.py', 'c.mjs', 'd.jsx']) assert.equal(listedFile(f), true, f);
  for (const f of ['flaky-tests.json', 'test-clock-allowlist.txt', 'README.md', 'x.d.ts']) assert.equal(listedFile(f), false, f);
  assert.equal(headerComment('a.mjs', '#!/usr/bin/env node\n/**\n * First.\n *\n * Second.\n */\n// Third.\nimport x from "y";\n'), 'First.\n\nSecond.\n\nThird.');
  assert.equal(headerComment('a.py', '#!/usr/bin/env python3\n# Lead.\n"""Doc."""\nx = 1\n'), 'Lead.\n\nDoc.');
  assert.equal(headerComment('a.sh', '#!/bin/bash\nset -e\n'), '');
  assert.equal(headerComment('a.mjs', 'export const x = 1;\n'), '');
});

for (const folder of ['scripts', 'scripts/lib']) {
  test(`${folder}: a script with a header is listed with no README edit; one without fails the build`, () => {
    // Mutation checked: rule 5's "no header comment" error dropped → the headerless cases pass.
    const dir = repo();
    try {
      assert.ok(copyFolder(dir, folder) > 50, 'the real folder was copied');
      git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'base');
      const readme = readFileSync(join(dir, folder, 'README.md'), 'utf8');
      assert.equal(indexMode(readme), 'generated');
      assert.equal(about(guard(dir), 'has no header comment'), '', 'every real file has a header');
      assert.equal(about(guard(dir), 'hand-written row'), '', 'no hand-written per-file row is left');

      writeFileSync(join(dir, folder, 'zz-fixture-6470.mjs'), '#!/usr/bin/env node\n/**\n * Fixture 6470: a new script, described here.\n */\nexport const x = 1;\n');
      writeFileSync(join(dir, folder, 'zz-fixture-6470.sh'), '#!/usr/bin/env bash\n# Fixture 6470: a new shell script.\nset -euo pipefail\n');
      writeFileSync(join(dir, folder, 'zz-fixture-6470.py'), '#!/usr/bin/env python3\n"""Fixture 6470: a new Python script."""\n');
      let out = guard(dir);
      assert.equal(about(out, 'zz-fixture-6470'), '', 'a script with a header passes');
      assert.equal(readFileSync(join(dir, folder, 'README.md'), 'utf8'), readme, 'the README was not edited');
      guard(dir, '--write');
      const filled = readFileSync(join(dir, folder, 'README.md'), 'utf8');
      assert.match(filled, /\| `zz-fixture-6470\.mjs` \| Fixture 6470: a new script, described here\. \|/);
      assert.match(filled, /\| `zz-fixture-6470\.sh` \| Fixture 6470: a new shell script\. \|/);
      assert.match(filled, /\| `zz-fixture-6470\.py` \| Fixture 6470: a new Python script\. \|/);
      guard(dir, '--clean');
      assert.equal(readFileSync(join(dir, folder, 'README.md'), 'utf8'), readme, '--clean restores the committed README');

      writeFileSync(join(dir, folder, 'zz-nohdr-6470.mjs'), 'export const y = 2;\n');
      writeFileSync(join(dir, folder, 'zz-nohdr-6470.sh'), '#!/usr/bin/env bash\nset -e\necho hi\n');
      out = guard(dir);
      assert.match(about(out, 'zz-nohdr-6470.mjs'), new RegExp(`${folder}/zz-nohdr-6470\\.mjs has no header comment`));
      assert.match(about(out, 'zz-nohdr-6470.sh'), new RegExp(`${folder}/zz-nohdr-6470\\.sh has no header comment`));
      assert.notEqual(spawnSync(process.execPath, [GUARD], { cwd: dir, env: ENV }).status, 0);

      writeFileSync(join(dir, folder, 'README.md'), `${readme}\n| File | What it is |\n| --- | --- |\n| \`zz-fixture-6470.mjs\` | hand-written |\n`);
      assert.match(about(guard(dir), 'zz-fixture-6470.mjs'), /has a hand-written row for `zz-fixture-6470\.mjs`/, 'a row added by hand fails');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test('two branches that each add a script under scripts/ merge cleanly with merge attributes off; appended rows did not', () => {
  // The control half is the mutation: the same branches, each also appending its row the old way, conflict.
  for (const rows of [false, true]) {
    const dir = repo();
    try {
      copyFolder(dir, 'scripts');
      git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'base');
      assert.equal(git(dir, 'check-attr', 'merge', '--', 'scripts/README.md').trim(), 'scripts/README.md: merge: text', 'union is off');
      const base = readFileSync(join(dir, 'scripts/README.md'), 'utf8');
      for (const branch of ['a', 'b']) {
        git(dir, 'checkout', '-qb', branch, 'main');
        writeFileSync(join(dir, `scripts/fixture-${branch}-6470.mjs`), `/**\n * Fixture ${branch}: added on branch ${branch}.\n */\nexport const ${branch} = 1;\n`);
        if (rows) writeFileSync(join(dir, 'scripts/README.md'), `${base}| \`fixture-${branch}-6470.mjs\` | Fixture ${branch}. |\n`);
        git(dir, 'add', '.'); git(dir, 'commit', '-qm', branch);
      }
      const r = spawnSync('git', ['-c', 'core.attributesFile=/dev/null', 'merge-tree', '--write-tree', '--name-only', 'a', 'b'], { cwd: dir, env: ENV, encoding: 'utf8' });
      if (rows) {
        assert.equal(r.status, 1, 'hand-written rows appended at one spot conflict');
        assert.match(r.stdout, /scripts\/README\.md/);
      } else {
        assert.equal(r.status, 0, `the merge is clean: ${r.stdout}${r.stderr}`);
        const tree = r.stdout.split('\n')[0];
        const names = git(dir, 'ls-tree', '--name-only', `${tree}:scripts`).split('\n');
        assert.ok(names.includes('fixture-a-6470.mjs') && names.includes('fixture-b-6470.mjs'));
        assert.equal(git(dir, 'show', `${tree}:scripts/README.md`), base, 'neither branch touched the README');
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

for (const folder of ['scripts', 'scripts/lib']) {
  test(`the real ${folder}/README.md: marked generated, its block empty in the commit, no hand-written rows, every file described`, () => {
    const text = readFileSync(join(REPO, folder, 'README.md'), 'utf8');
    assert.equal(indexMode(text), 'generated');
    const block = findBlock(text);
    assert.ok(block && !block.broken, 'it holds one files block');
    assert.ok(text.indexOf(INDEX_GENERATED) < text.indexOf(FILES_BEGIN) && text.indexOf(FILES_BEGIN) < text.indexOf(FILES_END));
    assert.equal(blockHoldsList(findBlock(committedReadme(folder))?.content), false, 'the list is never committed (D5612)');
    const listing = folderListing(join(REPO, folder), 'generated');
    assert.deepEqual(perFileRows(withBlock(text, ''), listing.map((f) => f.name)), [], 'no hand-written per-file rows');
    assert.deepEqual(listing.filter((f) => !/\.md$/.test(f.name) && !describe(f.name, f.text)).map((f) => f.name), [], 'every listed file has a header');
  });
}
