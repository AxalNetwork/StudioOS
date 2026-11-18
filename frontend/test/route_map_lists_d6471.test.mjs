/**
 * D6471 (#6471): a route-map canvas file writes its list cells one item per
 * line, sorted, under the row; scripts/lib/routeMap.mjs puts them back.
 *
 * These tests check the converter, what the joiner refuses (a duplicate item,
 * an item out of order, a list cell left inline), that the two projections do
 * not read a list's order, and that two branches each adding an item to the
 * same canvas merge cleanly with git's defaults and no merge attributes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readRouteMap, routeMapFragments, listItems, listifyCanvasFile, ROUTE_MAP_DIR,
} from '../../scripts/lib/routeMap.mjs';
import { build, outputs } from '../../scripts/build-profile-routing.mjs';

const HEAD = '| Canvas | Persona | Proposed route | Live route today | Backend it wires to | STATUS | Notes |';
const SEP = '| --- | --- | --- | --- | --- | --- | --- |';
const row = (backend) => `| Accounts | founder | \`/accounts\`, \`/accounts/:uid\` | same | ${backend} | CURRENT | Built in D1 (#1), then D2. |`;
const listed = (...items) => `${row('{backend}')}\n\nbackend:\n${items.map((x) => `- ${x}`).join('\n')}\n`;

/** A map in a temp root: { 'canvases/part-1/0010-x.md': '…' } over one section with one table. */
function mapAt(files) {
  const root = mkdtempSync(join(tmpdir(), 'route-map-lists-'));
  const all = {
    'sections/0000-intro.md': '# Map\n',
    'sections/0010-part-1.md': `## Part 1\n\n${HEAD}\n${SEP}\n<!-- route-map rows: canvases/part-1 -->\n`,
    ...files,
  };
  for (const [rel, text] of Object.entries(all)) {
    const p = join(root, ROUTE_MAP_DIR, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, text);
  }
  return root;
}

test('the converter moves a pure list cell out of the row, sorted, and leaves everything else as written', () => {
  const inline = `${row('`users.ts`, `accounts.ts` (the overview, one row per company), `admin.ts`')}\n`;
  const out = listifyCanvasFile(inline);
  assert.equal(out, listed('`accounts.ts` (the overview, one row per company)', '`admin.ts`', '`users.ts`'));
  assert.equal(listifyCanvasFile(out), out, 'running it again changes nothing');
  // A duplicate in the inline cell is written once.
  assert.equal(listifyCanvasFile(`${row('`b.ts`, `a.ts`, `b.ts`')}\n`), listed('`a.ts`', '`b.ts`'));
  // Cells that are not pure lists stay in the row: prose, `;`-groups, "and", a file's own sub-list.
  for (const cell of [
    '— (none) for tenancy; adjacent `admin.ts`, `admin_events.ts`',
    '`a.ts`, `b.ts`; `services/c.ts` (part 2); the record has no store yet',
    '`GET /api/a` (the plans) and `GET /api/b` (the models)',
    '`research_markets.ts` `GET /api/geographies`, `GET /api/geographies/:code`',
    '`ai.ts`: `GET /ai/me`, `GET /ai/pricing`',
    '—',
  ]) {
    assert.equal(listItems(cell), null, cell);
    assert.equal(listifyCanvasFile(`${row(cell)}\n`), `${row(cell)}\n`, cell);
  }
  // A ", " inside backticks or parentheses does not split an item.
  assert.deepEqual(listItems('`x.ts` (`/a`, `/b`, D1 (part 2), D3), `y, z.ts`'), ['`x.ts` (`/a`, `/b`, D1 (part 2), D3)', '`y, z.ts`']);
});

test('the joiner puts the list back into its cell, in the row the map has always had', () => {
  const root = mapAt({ 'canvases/part-1/0010-accounts.md': listed('`accounts.ts` (the overview)', '`admin.ts`', '`users.ts`') });
  try {
    assert.equal(readRouteMap(root), `# Map\n## Part 1\n\n${HEAD}\n${SEP}\n${row('`accounts.ts` (the overview), `admin.ts`, `users.ts`')}\n`);
    assert.deepEqual(routeMapFragments(root).filter((l) => l.canvasRow).map((l) => [l.file, l.line, l.listed]),
      [[`${ROUTE_MAP_DIR}/canvases/part-1/0010-accounts.md`, 1, true]]);
  } finally { rmSync(root, { recursive: true }); }
});

test('a duplicate item fails and names the file, the line and the item', () => {
  // What a merge of two branches that each added `billing.ts` leaves behind.
  const root = mapAt({ 'canvases/part-1/0010-accounts.md': listed('`accounts.ts`', '`billing.ts`', '`billing.ts`', '`users.ts`') });
  try {
    // Mutation checked: drop the `items.includes(item)` duplicate check → the map reads `billing.ts` twice and nothing fails.
    assert.throws(() => readRouteMap(root), /0010-accounts\.md:6: `billing\.ts` is in the backend list twice; keep one/);
  } finally { rmSync(root, { recursive: true }); }
});

test('an item out of order fails and names the file, the line and the item', () => {
  const root = mapAt({ 'canvases/part-1/0010-accounts.md': listed('`accounts.ts`', '`users.ts`', '`billing.ts`') });
  try {
    // Mutation checked: drop the compareItems order check → the list is read in any order and the next insert has no fixed place.
    assert.throws(() => readRouteMap(root), /0010-accounts\.md:6: `billing\.ts` is out of order in the backend list; it sorts before `users\.ts`/);
  } finally { rmSync(root, { recursive: true }); }
});

test('a list cell written inline, a slot with no list, a malformed item and a conflict marker are refused', () => {
  const cases = [
    [`${row('`users.ts`, `accounts.ts`')}\n`, /0010-accounts\.md: the backend cell is a list; write it one item per line \(node scripts\/convert-route-map-lists\.mjs\)/],
    [`${row('{backend}')}\n`, /0010-accounts\.md: the row has \{backend\}, so a blank line and "backend:" follow it/],
    [`${row('{backend}')}\n\nbackend:\n`, /0010-accounts\.md: the backend list has no items/],
    [listed('`accounts.ts`', 'users.ts'), /0010-accounts\.md:5: a backend item is "- `name`"/],
    [`${listed('`accounts.ts`').slice(0, -1)}\n<<<<<<< HEAD\n- \`b.ts\`\n=======\n`, /0010-accounts\.md:5: a conflict marker; finish the merge/],
    [`${listed('`accounts.ts`')}\nA note.\n`, /0010-accounts\.md:5: nothing follows a canvas row but its lists/],
  ];
  for (const [text, message] of cases) {
    const root = mapAt({ 'canvases/part-1/0010-accounts.md': text });
    try {
      // Mutation checked: drop the inline-list refusal in canvasFileRow → a new row can keep its list on the one line.
      assert.throws(() => readRouteMap(root), message);
    } finally { rmSync(root, { recursive: true }); }
  }
});

test('the two projections do not read a list\'s order, so sorting the lists left them byte-identical', () => {
  // On the conversion commit both documents hashed the same before and after
  // (the PR shows the sha256 of each). Here: reverse every list in the real
  // map, the order a branch could have written, and build both documents again.
  const map = readRouteMap();
  const lists = new Set(routeMapFragments().filter((l) => l.listed).map((l) => l.text));
  assert.ok(lists.size >= 100, `${lists.size} rows have a list`);
  let reversed = 0;
  const other = map.split('\n').map((line) => {
    if (!lists.has(line)) return line;
    const cells = line.split(' | ');
    const items = listItems(cells[4]);
    if (items.length < 2) return line;
    reversed += 1;
    cells[4] = items.reverse().join(', ');
    return cells.join(' | ');
  }).join('\n');
  assert.ok(reversed >= 50, `${reversed} lists reversed`);
  assert.notEqual(other, map);
  // Mutation checked: make the Route column read `rec.backend` instead of the live route → the documents differ.
  assert.deepEqual(outputs(build(other)), outputs(build(map)));
});

test('two branches that each add a different route file to the same canvas merge cleanly, with no merge attributes', () => {
  const repo = mkdtempSync(join(tmpdir(), 'route-map-merge-'));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'core.attributesFile=/dev/null', '-c', 'init.defaultBranch=main', ...args], { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const file = join(repo, ROUTE_MAP_DIR, 'canvases/part-1/0010-accounts.md');
  const write = (text) => writeFileSync(file, text);
  const commit = (msg) => { git('add', '-A'); git('commit', '-q', '-m', msg); };
  try {
    git('init', '-q');
    for (const [rel, text] of Object.entries({
      'sections/0000-intro.md': '# Map\n',
      'sections/0010-part-1.md': `## Part 1\n\n${HEAD}\n${SEP}\n<!-- route-map rows: canvases/part-1 -->\n`,
    })) {
      mkdirSync(join(repo, ROUTE_MAP_DIR, rel, '..'), { recursive: true });
      writeFileSync(join(repo, ROUTE_MAP_DIR, rel), text);
    }
    mkdirSync(join(file, '..'), { recursive: true });
    write(listed('`accounts.ts`', '`kyc.ts`', '`users.ts`'));
    commit('base');
    git('checkout', '-q', '-b', 'billing');
    write(listed('`accounts.ts`', '`billing.ts`', '`kyc.ts`', '`users.ts`'));
    commit('billing adds billing.ts');
    git('checkout', '-q', 'main');
    git('checkout', '-q', '-b', 'trust');
    write(listed('`accounts.ts`', '`kyc.ts`', '`trust.ts`', '`users.ts`'));
    commit('trust adds trust.ts');
    assert.equal(git('check-attr', '-a', '--', `${ROUTE_MAP_DIR}/canvases/part-1/0010-accounts.md`).trim(), '', 'no merge attributes');
    // Mutation checked: join the list back with "," in canvasFileRow → the merged map reads wrong here.
    git('merge', '-q', '--no-edit', 'billing');
    assert.equal(readFileSync(file, 'utf8'), listed('`accounts.ts`', '`billing.ts`', '`kyc.ts`', '`trust.ts`', '`users.ts`'));
    assert.match(readRouteMap(repo), /\| `accounts\.ts`, `billing\.ts`, `kyc\.ts`, `trust\.ts`, `users\.ts` \|/);

    // The same two additions in the old one-line form conflict: what D6471 removes.
    git('checkout', '-q', 'main');
    write(`${row('`accounts.ts`, `kyc.ts`, `users.ts`')}\n`);
    commit('inline base');
    git('checkout', '-q', '-b', 'inline-billing');
    write(`${row('`accounts.ts`, `billing.ts`, `kyc.ts`, `users.ts`')}\n`);
    commit('inline billing');
    git('checkout', '-q', 'main');
    write(`${row('`accounts.ts`, `kyc.ts`, `trust.ts`, `users.ts`')}\n`);
    commit('inline trust');
    assert.throws(() => git('merge', '-q', '--no-edit', 'inline-billing'));
    assert.match(readFileSync(file, 'utf8'), /^<{7} /m);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('the limit: two branches adding between the same two neighbours still meet as a conflict', () => {
  // D6471 records this: git cannot order two insertions into one gap. The fix is to keep both lines, sorted.
  const repo = mkdtempSync(join(tmpdir(), 'route-map-merge-'));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'core.attributesFile=/dev/null', ...args], { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const file = join(repo, '0010-accounts.md');
  try {
    git('init', '-q', '-b', 'main');
    writeFileSync(file, listed('`accounts.ts`', '`users.ts`'));
    git('add', '-A'); git('commit', '-q', '-m', 'base');
    git('checkout', '-q', '-b', 'side');
    writeFileSync(file, listed('`accounts.ts`', '`billing.ts`', '`users.ts`'));
    git('commit', '-q', '-am', 'billing');
    git('checkout', '-q', 'main');
    writeFileSync(file, listed('`accounts.ts`', '`trust.ts`', '`users.ts`'));
    git('commit', '-q', '-am', 'trust');
    assert.throws(() => git('merge', '-q', '--no-edit', 'side'));
    assert.match(readFileSync(file, 'utf8'), /^<{7} /m);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
