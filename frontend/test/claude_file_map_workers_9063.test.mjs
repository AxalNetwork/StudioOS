/**
 * #9063: CLAUDE.md's file map names every Worker this repository holds.
 *
 * The map listed `cloudflare-worker/` and `meeting-bot/` and nothing else, so
 * a session could not tell from the canonical doc that Merge Control, the tail
 * consumer, the PR preview Worker and four staged candidates ship from here.
 * The folders are read from the wrangler configs, not from a list in this
 * file: a top-level folder holds a Worker when a root `wrangler*.toml` names
 * an entry inside it (`main`) or when it carries a wrangler config of its own
 * (the same rule `scripts/ci/coverage-matrix.mjs` uses). Each such folder needs
 * a file-map row that says how it ships: a workflow that exists, or plainly
 * that no workflow deploys it.
 *
 * The root documents also lost a link to a `docs/dev/` file that never
 * existed once `docs/` stopped being committed (D529), so every relative
 * link in CLAUDE.md, README.md and SECURITY.md must resolve.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileMapFolders } from '../../scripts/ci/coverage-matrix.mjs';

const root = resolve(process.cwd());
const at = (p) => readFileSync(join(root, p), 'utf8');
const WRANGLER = /^wrangler(?:\.[\w-]+)?\.(?:toml|json|jsonc)$/;

/** Top-level folders that hold a Worker entry or a Worker config. */
function workerFolders() {
  const isDir = (n) => !n.startsWith('.') && n !== 'node_modules' && statSync(join(root, n)).isDirectory();
  const top = readdirSync(root).filter(isDir);
  const found = new Set();
  for (const file of readdirSync(root).filter((f) => WRANGLER.test(f) && f.endsWith('.toml'))) {
    const head = /^main\s*=\s*"([^"]+)"/m.exec(at(file))?.[1]?.split('/')[0];
    if (head && top.includes(head)) found.add(head);
  }
  for (const dir of top) if (readdirSync(join(root, dir)).some((f) => WRANGLER.test(f))) found.add(dir);
  return [...found].sort();
}

/** The file map's rows: folder (no trailing slash) → the row's text. */
function fileMapRows() {
  const claude = at('CLAUDE.md');
  const section = claude.slice(claude.indexOf('## File map'));
  const rows = new Map();
  for (const line of section.split('\n').slice(1)) {
    if (line.startsWith('## ')) break;
    const m = /^\|\s*`([^`]+)\/`\s*\|(.*)$/.exec(line);
    if (m) rows.set(m[1], m[2]);
  }
  return rows;
}

test('the Worker folders are found from the wrangler configs', () => {
  const folders = workerFolders();
  // Anchors, not the list: if one of these stops being found the scan is broken.
  for (const anchor of ['cloudflare-worker', 'meeting-bot', 'merge-control', 'cloudflare-worker-tail']) {
    assert.ok(folders.includes(anchor), `${anchor} holds a Worker but the scan missed it`);
  }
});

test('CLAUDE.md file map has a row for every folder that holds a Worker', () => {
  const rows = fileMapRows();
  assert.deepEqual(fileMapFolders(at('CLAUDE.md')), [...rows.keys()], 'this test and coverage-matrix.mjs read the file map differently');
  const missing = workerFolders().filter((f) => !rows.has(f));
  assert.deepEqual(missing, [], `CLAUDE.md "## File map" has no row for: ${missing.join(', ')}`);
});

test('each Worker folder row says how it ships', () => {
  const rows = fileMapRows();
  const workflows = new Set(readdirSync(join(root, '.github/workflows')));
  for (const folder of workerFolders()) {
    const row = rows.get(folder) ?? '';
    const named = [...row.matchAll(/`([\w.-]+\.ya?ml)`/g)].map((m) => m[1]);
    assert.ok(
      named.length > 0 || /no workflow deploys/i.test(row),
      `CLAUDE.md file map row for ${folder}/ names no workflow and does not say that none deploys it`,
    );
    for (const wf of named) assert.ok(workflows.has(wf), `CLAUDE.md file map row for ${folder}/ names ${wf}, which is not in .github/workflows`);
  }
});

test('every relative link in CLAUDE.md, README.md and SECURITY.md resolves', () => {
  const dead = [];
  for (const file of ['CLAUDE.md', 'README.md', 'SECURITY.md']) {
    for (const m of at(file).matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1].split('#')[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      if (!existsSync(join(root, target))) dead.push(`${file} → ${m[1]}`);
    }
  }
  assert.deepEqual(dead, [], `dead links:\n  ${dead.join('\n  ')}`);
});
