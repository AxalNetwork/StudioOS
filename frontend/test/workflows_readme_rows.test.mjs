/**
 * task 425 — .github/workflows/README.md must have exactly one table row per
 * `*.yml` file in the folder, keyed on the row's FIRST cell (the file name in
 * backticks), never on "the file name appears somewhere in the file". Several
 * workflow files are named in OTHER rows' prose — `backup-d1.yml` three
 * times, `ci.yml`, `dr-drill.yml` and `magic-link-probe.yml` twice each — so
 * a substring search over the whole README would pass even if a file's own
 * row were deleted.
 *
 * This is the guard that makes deleting the stale `pages-build-deployment`
 * row (task 425) mean something: without it, a future workflow could be
 * added with no row and nothing would notice, the exact drift this file's
 * own intro paragraph asks contributors to avoid.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const WORKFLOWS_DIR = resolve(root, '.github/workflows');
const README = resolve(WORKFLOWS_DIR, 'README.md');

const yamlFiles = () =>
  readdirSync(WORKFLOWS_DIR).filter((n) => n.endsWith('.yml')).sort();

/** Every table row's first cell, e.g. `ci.yml` from `| \`ci.yml\` | ... |`. */
function firstCells(markdown) {
  const cells = [];
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) continue;
    if (/^\|\s*-+\s*\|/.test(line)) continue; // the `|---|---|` separator row
    const m = /^\|\s*`([^`]+)`\s*\|/.exec(line);
    if (m) cells.push(m[1]);
  }
  return cells;
}

test('the workflows folder holds at least 18 files — the floor this guard leans on', () => {
  const files = yamlFiles();
  assert.ok(files.length >= 18,
    `expected at least 18 *.yml files under .github/workflows, found ${files.length}. `
    + 'A directory read that returned nothing would otherwise let every assertion below '
    + 'pass vacuously.');
});

test('every *.yml file has exactly one README row keyed on its own first cell', () => {
  const markdown = readFileSync(README, 'utf8');
  const cells = firstCells(markdown);
  for (const file of yamlFiles()) {
    const matches = cells.filter((c) => c === file);
    assert.equal(matches.length, 1,
      `${file} has ${matches.length} README row(s) whose first cell is exactly `
      + `\`${file}\` — expected exactly 1. Mentioning the file name in another row's `
      + 'prose does not count: this guard keys on the row\'s own first cell.');
  }
});

test('every first-cell entry names a *.yml file that actually exists', () => {
  const markdown = readFileSync(README, 'utf8');
  const files = new Set(yamlFiles());
  for (const cell of firstCells(markdown)) {
    if (cell === 'pages-build-deployment') continue; // not a file in this repo; see below
    assert.ok(files.has(cell),
      `README row's first cell names \`${cell}\`, which is not a *.yml file under `
      + '.github/workflows. Either the file was renamed/removed and the row was not, '
      + 'or the cell is stale.');
  }
});

test('the stale pages-build-deployment row is gone', () => {
  const markdown = readFileSync(README, 'utf8');
  assert.ok(!firstCells(markdown).includes('pages-build-deployment'),
    'a `pages-build-deployment` row is present. Measured through the Actions API on '
    + '26 September, the workflow has not run since 2026-09-03 15:49Z — GitHub Pages is '
    + 'decommissioned (CLAUDE.md) and no push to main since has started one. If a later '
    + 'run is found, the row should come back with a note saying why rather than silently.');
});
