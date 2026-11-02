/**
 * D1615 (#4102): the route map is a folder of fragments — one file per
 * section, one file per canvas row — joined by scripts/lib/routeMap.mjs.
 *
 * These tests build small maps in a temporary folder and check what the
 * joiner refuses. The real map is checked by profile_routing_fresh (it parses)
 * and by `node scripts/build-route-map.mjs --check` in test:guards.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readRouteMap, routeMapFragments, ROUTE_MAP_DIR } from '../../scripts/lib/routeMap.mjs';

const HEAD = '| Canvas | Persona | Proposed route | Live route today | Backend it wires to | STATUS | Notes |';
const SEP = '| --- | --- | --- | --- | --- | --- | --- |';
const row = (canvas, status = 'CURRENT') => `| ${canvas} | founder | \`/x\` | \`/x\` | \`x.ts\` | ${status} | — |`;

/** A map in a temp root: { 'sections/0000-a.md': '…', 'canvases/part-1/0010-x.md': '…' }. */
function mapAt(files) {
  const root = mkdtempSync(join(tmpdir(), 'route-map-'));
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, ROUTE_MAP_DIR, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, text);
  }
  return root;
}
const base = (extra = {}) => ({
  'sections/0000-intro.md': '# Map\n\nIntro.\n',
  'sections/0010-part-1.md': `## Part 1\n\n${HEAD}\n${SEP}\n<!-- route-map rows: canvases/part-1 -->\n\nAfter the table.\n`,
  'canvases/part-1/0010-accounts.md': `${row('Accounts')}\n`,
  'canvases/part-1/0020-content-queue.md': `${row('Content queue')}\n`,
  ...extra,
});

test('the fragments join into one map: sections in order, rows placed at their marker', () => {
  const root = mapAt(base());
  try {
    assert.equal(readRouteMap(root), `# Map\n\nIntro.\n## Part 1\n\n${HEAD}\n${SEP}\n${row('Accounts')}\n${row('Content queue')}\n\nAfter the table.\n`);
  } finally { rmSync(root, { recursive: true }); }
});

test('a canvas in two fragments fails and names both files', () => {
  // Two branches each added a file for the same canvas.
  const root = mapAt(base({ 'canvases/part-1/0015-accounts-again.md': `${row('Accounts', 'UPGRADE')}\n` }));
  try {
    // Mutation checked: drop the `seen` check in checkRouteMap → no error, the map carries two Accounts rows.
    assert.throws(() => readRouteMap(root), (e) => {
      assert.match(e.message, /two rows for "Accounts"/);
      assert.match(e.message, /canvases\/part-1\/0010-accounts\.md/);
      assert.match(e.message, /canvases\/part-1\/0015-accounts-again\.md/);
      return true;
    });
  } finally { rmSync(root, { recursive: true }); }
});

test('the same canvas in two different tables is still two rows', () => {
  const root = mapAt(base({
    'sections/0020-part-2.md': `## Part 2\n\n${HEAD}\n${SEP}\n<!-- route-map rows: canvases/part-2 -->\n`,
    'canvases/part-2/0010-accounts.md': `${row('Accounts')}\n`,
  }));
  try {
    assert.throws(() => readRouteMap(root), /two rows for "Accounts": documentation\/architecture\/route-map\/canvases\/part-1\/0010-accounts\.md and documentation\/architecture\/route-map\/canvases\/part-2\/0010-accounts\.md/);
  } finally { rmSync(root, { recursive: true }); }
});

test('a canvas file holds exactly one row', () => {
  const root = mapAt(base({ 'canvases/part-1/0030-two.md': `${row('Insights')}\n${row('Usage')}\n` }));
  try {
    // Mutation checked: drop the one-line rule → two canvases ride in one file and the next edit of either conflicts.
    assert.throws(() => readRouteMap(root), /0030-two\.md: a canvas file holds exactly one table row/);
  } finally { rmSync(root, { recursive: true }); }
});

test('canvas rows written inline in a section are refused', () => {
  const root = mapAt({
    'sections/0000-intro.md': '# Map\n',
    'sections/0010-part-1.md': `## Part 1\n\n${HEAD}\n${SEP}\n${row('Accounts')}\n`,
  });
  try {
    // Mutation checked: drop the inline-rows check → a row lands back in a shared file.
    assert.throws(() => readRouteMap(root), /canvas rows go in canvases\/part-N\//);
  } finally { rmSync(root, { recursive: true }); }
});

test('a rows folder no section places, or a marker with no folder, is refused', () => {
  const orphan = mapAt(base({ 'canvases/part-9/0010-lost.md': `${row('Lost')}\n` }));
  const missing = mapAt(base({ 'sections/0020-part-2.md': `## Part 2\n\n${HEAD}\n${SEP}\n<!-- route-map rows: canvases/part-2 -->\n` }));
  try {
    assert.throws(() => readRouteMap(orphan), /canvases\/part-9: no section places these rows/);
    assert.throws(() => readRouteMap(missing), /canvases\/part-2 does not exist/);
  } finally { rmSync(orphan, { recursive: true }); rmSync(missing, { recursive: true }); }
});

test('a fragment name that does not sort is refused', () => {
  const root = mapAt(base({ 'canvases/part-1/Accounts Two.md': `${row('Accounts two')}\n` }));
  try {
    assert.throws(() => readRouteMap(root), /a fragment is named NNNN-<lowercase-slug>\.md/);
  } finally { rmSync(root, { recursive: true }); }
});

test('a conflict marker in a fragment fails rather than ending a table early', () => {
  const root = mapAt(base({ 'sections/0005-note.md': '<<<<<<< HEAD\nA note.\n=======\nAnother.\n>>>>>>> origin/main\n' }));
  try {
    assert.throws(() => readRouteMap(root), /0005-note\.md:1: a conflict marker/);
  } finally { rmSync(root, { recursive: true }); }
});

test('the real map: every canvas row is its own file, and the pointer page holds no rows', () => {
  const lines = routeMapFragments();
  const rows = lines.filter((l) => l.canvasRow);
  assert.ok(rows.length >= 195, `the map had 195 canvas rows when it was split; it has ${rows.length}`);
  assert.equal(new Set(rows.map((l) => l.file)).size, rows.length, 'one canvas per file');
  const pointer = readFileSync('documentation/architecture/ROUTE_MAP.md', 'utf8');
  assert.match(pointer, /route-map\/README\.md/);
  assert.doesNotMatch(pointer, /^\| Canvas \| Persona \|/m);
});
