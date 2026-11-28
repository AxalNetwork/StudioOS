/**
 * #6472 — the test READMEs and the per-part paragraphs: an `<!-- index: none -->`
 * README takes no per-file note and no per-decision paragraph (`perFileNotes`,
 * `partNotes` in `folderFiles.mjs`, read by `../check-folder-docs.mjs` rule 6).
 *
 * The end-to-end cases copy the five real READMEs (frontend/test,
 * cloudflare-worker/test, frontend/tests/visual, the portfolio and contracts
 * pages) into a throwaway git repository and run the real guard there. The
 * guard fails there anyway (none of the documented folders exist, and the
 * READMEs cite files that are not copied), so each case reads only the
 * #6465/#6472 lines about its own README, never the exit code.
 *
 *   node --test scripts/lib/readmeNotes.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDEX_GENERATED, INDEX_NONE, indexMode, partNotes, perFileNotes } from './folderFiles.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const GUARD = join(REPO, 'scripts/check-folder-docs.mjs');

/** The five READMEs #6472 marked, and a file each folder could gain. */
const FOLDERS = [
  ['frontend/test', 'fixture_6472.test.mjs', '// D6472: a fixture test that explains itself here.\n'],
  ['cloudflare-worker/test', 'fixture_6472.test.ts', '// D6472: a fixture test that explains itself here.\n'],
  ['frontend/tests/visual', 'fixture_6472.spec.mjs', '// D6472: a fixture spec that explains itself here.\n'],
  ['frontend/src/pages/portfolio', 'Fixture6472.jsx', '/** D6472: a fixture component that explains itself here. */\n'],
  ['frontend/src/pages/admin/contracts', 'Fixture6472.jsx', '/** D6472: a fixture component that explains itself here. */\n'],
];

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false',
    '-c', 'core.attributesFile=/dev/null', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'readme-notes-6472-'));
  git(dir, 'init', '-q', '-b', 'main');
  // Merge attributes off, as on GitHub's server-side merge: no union driver can take part.
  mkdirSync(join(dir, '.git/info'), { recursive: true });
  writeFileSync(join(dir, '.git/info/attributes'), '* merge=text\n');
  return dir;
}
function put(root, rel, text) { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); }
function append(root, rel, text) { put(root, rel, `${readFileSync(join(root, rel), 'utf8')}${text}`); }
function guard(cwd) {
  const r = spawnSync(process.execPath, [GUARD], { cwd, encoding: 'utf8' });
  return `${r.stdout}\n${r.stderr}`;
}
/** The rule-6 lines (#6465 rows, #6472 notes) about one README. */
const notesAbout = (out, readme) => out.split('\n').filter((l) => l.includes(readme) && /\(#64(65|72)\)/.test(l)).join('\n');

test('perFileNotes: a row, a list item or a paragraph that opens with one of the folder\'s files; not a mention inside a sentence', () => {
  // Mutation checked: the `opens` test dropped → the wrapped rule line is reported; the item pattern dropped → no `item`.
  const names = ['a.test.mjs', '_helper.mjs'];
  const readme = [
    '# T', '', INDEX_NONE, '',
    '| `a.test.mjs` | a row |',
    '- `a.test.mjs` — an item',
    '',
    '`_helper.mjs` builds the world. Each test calls it.',
    '`a.test.mjs` checks one more thing.',
    '',
    'A rule that names a helper in passing, imported from',
    '`_helper.mjs` on a wrapped line, is not a note.',
    '- Every run imports `_helper.mjs`.',
    '- `b.test.mjs` is not one of the folder\'s files.',
    '```', '', '`a.test.mjs` inside fenced code.', '```',
  ].join('\n');
  assert.deepEqual(perFileNotes(readme, names), [
    { line: 5, name: 'a.test.mjs', kind: 'row' },
    { line: 6, name: 'a.test.mjs', kind: 'item' },
    { line: 8, name: '_helper.mjs', kind: 'paragraph' },
    { line: 9, name: 'a.test.mjs', kind: 'paragraph' },
  ]);
});

test('partNotes: a paragraph or item that opens with a decision and its part, issue or colon; not a decision inside a sentence', () => {
  // Mutation checked: the "part, issue or colon" requirement dropped → "D5504.md says" is reported.
  const readme = [
    'D4817 part 9 (addendum PFA03) rebuilds the Reports.', '',
    'D4811 (#4811) part 7: the desk\'s tab row.',
    'D6208 (#6208) adds the filters.',
    'D717: the first desk.',
    '- D4833-p4 draws Delivery.',
    '#4568 (D4568): the indexes.', '',
    'D5504.md says how to wait, and the rule cites',
    'D4817 part 2 on a wrapped line.',
    'Built for D1511 (#3762): a sentence that cites a decision.',
  ].join('\n');
  assert.deepEqual(partNotes(readme), [
    { line: 1, id: 4817, part: 9 },
    { line: 3, id: 4811, part: 7 },
    { line: 4, id: 6208, part: null },
    { line: 5, id: 717, part: null },
    { line: 6, id: 4833, part: 4 },
    { line: 7, id: 4568, part: null },
  ]);
});

test('the five marked READMEs: index: none, and no per-file note or per-decision paragraph left in them', () => {
  const out = guard(REPO);
  for (const [dir] of FOLDERS) {
    const text = readFileSync(join(REPO, dir, 'README.md'), 'utf8');
    assert.equal(indexMode(text), 'none', `${dir}/README.md is marked index: none`);
    assert.equal(notesAbout(out, `${dir}/README.md`), '', `${dir}/README.md passes rule 6 on this checkout`);
    assert.deepEqual(partNotes(text), [], `${dir}/README.md holds no per-decision paragraph`);
  }
});

test('each folder gains a file with no README edit and passes; a hand-added row, paragraph or part note fails', () => {
  // Mutation checked: rule 6's #6472 branch skipped → the paragraph and part-note cases pass; run for `generated` → scripts/README.md lines appear.
  const dir = repo();
  try {
    for (const [folder] of FOLDERS) put(dir, `${folder}/README.md`, readFileSync(join(REPO, folder, 'README.md'), 'utf8'));
    git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'base');
    for (const [folder, name, body] of FOLDERS) put(dir, `${folder}/${name}`, body);
    let out = guard(dir);
    for (const [folder] of FOLDERS) {
      assert.equal(notesAbout(out, `${folder}/README.md`), '', `${folder}: a new file needs no README edit`);
      assert.equal(readFileSync(join(dir, folder, 'README.md'), 'utf8'), readFileSync(join(REPO, folder, 'README.md'), 'utf8'));
    }
    for (const [folder, name] of FOLDERS) {
      append(dir, `${folder}/README.md`, `\n| File | Guarantee |\n| --- | --- |\n| \`${name}\` | a hand-added row |\n`);
    }
    out = guard(dir);
    for (const [folder, name] of FOLDERS) {
      assert.match(notesAbout(out, `${folder}/README.md`), new RegExp(`has a hand-written row for \`${name.replace('.', '\\.')}\``), `${folder}: the row fails`);
    }
    for (const [folder, name] of FOLDERS) put(dir, `${folder}/README.md`, readFileSync(join(REPO, folder, 'README.md'), 'utf8'));
    append(dir, 'frontend/test/README.md', `\n\`${FOLDERS[0][1]}\` checks one more thing (D6472).\n`);
    append(dir, 'cloudflare-worker/test/README.md', `\n- \`${FOLDERS[1][1]}\` — one more thing.\n`);
    append(dir, 'frontend/src/pages/portfolio/README.md', '\nD4817 part 11 (canvas PF-11) draws one more board.\n');
    append(dir, 'frontend/src/pages/admin/contracts/README.md', '\nD4811 (#4811) part 22: one more part.\n');
    out = guard(dir);
    assert.match(notesAbout(out, 'frontend/test/README.md'), /opens a paragraph with `fixture_6472\.test\.mjs`/);
    assert.match(notesAbout(out, 'cloudflare-worker/test/README.md'), /opens a list item with `fixture_6472\.test\.ts`/);
    assert.match(notesAbout(out, 'frontend/src/pages/portfolio/README.md'), /per-decision note \(D4817 part 11\).*decisions\/D4817-p11\.md/);
    assert.match(notesAbout(out, 'frontend/src/pages/admin/contracts/README.md'), /per-decision note \(D4811 part 22\).*decisions\/D4811-p22\.md/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an `index: generated` README keeps its prose; only its rows fail (scripts/ is #6470\'s)', () => {
  const dir = repo();
  try {
    put(dir, 'gen/README.md', `# Gen\n\nThe folder.\n\n${INDEX_GENERATED}\n\n<!-- files:begin -->\n<!-- files:end -->\n\n\`a.mjs\` is described here too.\n\nD9 (#9): a note.\n`);
    put(dir, 'gen/a.mjs', '// A.\n');
    git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'base');
    assert.equal(notesAbout(guard(dir), 'gen/README.md'), '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('two branches that each add a test and a part note merge cleanly with merge attributes off; README appends did not', () => {
  // The control half is the mutation: the same branches, each also appending a row and a
  // part paragraph to the README the old way, conflict under the same settings.
  for (const appendToReadme of [false, true]) {
    const dir = repo();
    try {
      const readme = readFileSync(join(REPO, 'frontend/test/README.md'), 'utf8');
      put(dir, 'frontend/test/README.md', readme);
      put(dir, 'documentation/architecture/decisions/D9.md', '## D9 — A decision (#9)\n\nBody.\n');
      git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'base');
      for (const [branch, k] of [['a', 2], ['b', 3]]) {
        git(dir, 'checkout', '-qb', branch, 'main');
        put(dir, `frontend/test/branch_${branch}.test.mjs`, `// D9 part ${k}: branch ${branch}'s test explains itself here.\n`);
        put(dir, `documentation/architecture/decisions/D9-p${k}.md`, `## D9 part ${k} — Branch ${branch} (#9)\n\nWhat part ${k} built.\n`);
        if (appendToReadme) append(dir, 'frontend/test/README.md', `| \`branch_${branch}.test.mjs\` | Branch ${branch}. |\n\nD9 part ${k}: what part ${k} built.\n`);
        git(dir, 'add', '.'); git(dir, 'commit', '-qm', `part ${k}`);
      }
      const r = spawnSync('git', ['-c', 'core.attributesFile=/dev/null', 'merge-tree', '--write-tree', '--name-only', 'a', 'b'], { cwd: dir, encoding: 'utf8' });
      if (appendToReadme) {
        assert.equal(r.status, 1, 'two appends at the README\'s end conflict');
        assert.match(r.stdout, /frontend\/test\/README\.md/);
      } else {
        assert.equal(r.status, 0, `the merge is clean: ${r.stdout}${r.stderr}`);
        const tree = r.stdout.split('\n')[0];
        assert.deepEqual(git(dir, 'ls-tree', '--name-only', `${tree}:frontend/test`).trim().split('\n'), ['README.md', 'branch_a.test.mjs', 'branch_b.test.mjs']);
        assert.deepEqual(git(dir, 'ls-tree', '--name-only', `${tree}:documentation/architecture/decisions`).trim().split('\n'), ['D9-p2.md', 'D9-p3.md', 'D9.md']);
        assert.equal(git(dir, 'show', `${tree}:frontend/test/README.md`), readme, 'neither branch touched the README');
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});
