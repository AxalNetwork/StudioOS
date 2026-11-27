/**
 * D4102 (#4102): the route map is a folder of fragments, not one shared file.
 *
 * `documentation/architecture/route-map/` holds:
 *   - `sections/NNNN-<slug>.md` — one file per section of the map, in order;
 *   - `canvases/part-N/NNNN-<slug>.md` — one file per canvas row, exactly one
 *     table line each. A section that holds a canvas table carries the table's
 *     header and separator, then the marker
 *     `<!-- route-map rows: canvases/part-N -->`, which the rows replace.
 *
 * Adding a canvas is adding a file; changing one is editing its own file. Two
 * branches never append to the same file, so nothing needs `merge=union`, and
 * two branches that change the SAME canvas meet as an ordinary conflict on one
 * line instead of a silent second row.
 *
 * Every reader goes through `readRouteMap()`: the text it returns is the map as
 * one document, exactly as the single ROUTE_MAP.md read before the split.
 * `scripts/build-route-map.mjs` writes that text to a file for people; it is
 * never committed.
 *
 * D6471 (#6471): a canvas file's list cells are written one item per line.
 * The row keeps the slot `{backend}` in its "Backend it wires to" cell, and the
 * items follow under a `backend:` line, sorted, one `- ` line each:
 *
 *   | Accounts | founder | `/x` | `/x` | {backend} | CURRENT | Notes … |
 *
 *   backend:
 *   - `accounts.ts` (the overview)
 *   - `users.ts`
 *
 * The joiner puts the items back into the cell, joined by ", ". Two branches
 * that each add an item add a line each, so git merges them unless they land
 * between the same two neighbours. A cell that is not a pure list (prose,
 * `;`-groups, "—") stays in the row as it was.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ROUTE_MAP_DIR = 'documentation/architecture/route-map';
const MARKER = /^<!-- route-map rows: (canvases\/[a-z0-9-]+) -->$/;
const FRAGMENT = /^\d{4}-[a-z0-9-]+\.md$/;
const CANVAS_HEADER = /^\| Canvas \| Persona \| Proposed route \| Live route today \|/;

const mdFiles = (dir) => readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();
// One trailing newline belongs to the file, not to the map.
const body = (text) => (text.endsWith('\n') ? text.slice(0, -1) : text);

/**
 * D6471: the cells written as lists, by column (0 is Canvas). Only "Backend it
 * wires to" is one: its order reaches no projection. The route cells are not,
 * because PROFILE_ROUTING.md shows their routes in the order written and the
 * first one that matches a sidebar row places the canvas.
 */
export const LIST_CELLS = [{ name: 'backend', column: 4 }];
const slot = (name) => `{${name}}`;
const CONFLICT = /^(<{7}|={7}|>{7})(\s|$)/;

/** One list item: a `backticked` name, then at most one (parenthetical) that closes the item. */
export function isListItem(item) {
  const m = /^`[^`]+`/.exec(item);
  if (!m) return false;
  const rest = item.slice(m[0].length);
  if (rest === '') return true;
  if (!rest.startsWith(' (') || !rest.endsWith(')')) return false;
  let depth = 0;
  let tick = false;
  for (let i = 1; i < rest.length; i += 1) {
    const c = rest[i];
    if (c === '`') tick = !tick;
    else if (!tick && c === '(') depth += 1;
    else if (!tick && c === ')') {
      depth -= 1;
      if (depth === 0 && i !== rest.length - 1) return false;
    }
  }
  return depth === 0 && !tick;
}

/**
 * The items of a cell that is a pure list — items joined by ", ", each a
 * `isListItem` — in the order written; null for any other cell. A ", " inside
 * backticks or parentheses does not split.
 */
export function listItems(cell) {
  const items = [];
  let cur = '';
  let tick = false;
  let depth = 0;
  for (let i = 0; i < cell.length; i += 1) {
    const c = cell[i];
    if (c === '`') tick = !tick;
    else if (!tick && c === '(') depth += 1;
    else if (!tick && c === ')') depth -= 1;
    if (!tick && depth === 0 && c === ',' && cell[i + 1] === ' ') { items.push(cur); cur = ''; i += 1; continue; }
    cur += c;
  }
  items.push(cur);
  return !tick && depth === 0 && items.every(isListItem) ? items : null;
}

/** The order a list is kept in: by UTF-16 code unit, no locale. */
export const compareItems = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * D6471: a canvas file's text with every list cell written one item per line,
 * sorted, duplicates dropped. A file already in that form, or with no list
 * cell, comes back unchanged. Used by scripts/convert-route-map-lists.mjs.
 */
export function listifyCanvasFile(text) {
  const own = body(text);
  if (own.includes('\n')) return text;
  const cells = own.split(' | ');
  const blocks = [];
  for (const { name, column } of LIST_CELLS) {
    const items = column < cells.length - 1 ? listItems(cells[column]) : null;
    if (!items) continue;
    cells[column] = slot(name);
    blocks.push(`${name}:\n${[...new Set(items)].sort(compareItems).map((x) => `- ${x}`).join('\n')}`);
  }
  return blocks.length ? `${[cells.join(' | '), ...blocks].join('\n\n')}\n` : text;
}

/**
 * D6471: one canvas file → its table row, with each list put back in its cell.
 * Returns the row and the problems found, each naming the file (and line).
 */
export function canvasFileRow(text, file) {
  const problems = [];
  const lines = text.split('\n');
  const row = lines[0];
  if (!row.startsWith('| ') || lines.slice(1).some((l) => l.startsWith('| '))) {
    problems.push(`${file}: a canvas file holds exactly one table row, one line starting "| "`);
    return { row: text, problems };
  }
  const cells = row.split(' | ');
  let i = 1;
  for (const { name, column } of LIST_CELLS) {
    if (column >= cells.length - 1) continue;
    if (cells[column] !== slot(name)) {
      if (listItems(cells[column])) {
        problems.push(`${file}: the ${name} cell is a list; write it one item per line (node scripts/convert-route-map-lists.mjs)`);
      }
      continue;
    }
    if (lines[i] !== '' || lines[i + 1] !== `${name}:`) {
      problems.push(`${file}: the row has ${slot(name)}, so a blank line and "${name}:" follow it, then its items`);
      return { row, problems };
    }
    i += 2;
    const items = [];
    for (; i < lines.length && lines[i] !== ''; i += 1) {
      const where = `${file}:${i + 1}`;
      const line = lines[i];
      if (CONFLICT.test(line)) { problems.push(`${where}: a conflict marker; finish the merge`); continue; }
      const item = line.slice(2);
      if (!line.startsWith('- ') || !isListItem(item)) {
        problems.push(`${where}: a ${name} item is "- \`name\`", optionally followed by one (note)`);
        continue;
      }
      const prev = items[items.length - 1];
      if (items.includes(item)) problems.push(`${where}: ${item} is in the ${name} list twice; keep one`);
      else if (prev !== undefined && compareItems(prev, item) > 0) problems.push(`${where}: ${item} is out of order in the ${name} list; it sorts before ${prev}`);
      items.push(item);
    }
    if (!items.length) problems.push(`${file}: the ${name} list has no items`);
    cells[column] = items.join(', ');
  }
  if (i < lines.length) problems.push(`${file}:${i + 1}: nothing follows a canvas row but its lists`);
  return { row: cells.join(' | '), problems, listed: i > 1 };
}


/** Every fragment, in map order, with the text the map takes from it. */
export function routeMapFragments(root = REPO_ROOT) {
  const base = join(root, ROUTE_MAP_DIR);
  const sectionsDir = join(base, 'sections');
  const canvasesDir = join(base, 'canvases');
  const problems = [];
  const sections = mdFiles(sectionsDir);
  const referenced = new Set();
  const out = [];
  for (const name of sections) {
    const file = `${ROUTE_MAP_DIR}/sections/${name}`;
    if (!FRAGMENT.test(name)) problems.push(`${file}: a fragment is named NNNN-<lowercase-slug>.md`);
    const text = body(readFileSync(join(sectionsDir, name), 'utf8'));
    const lines = text.split('\n');
    for (const [i, line] of lines.entries()) {
      const m = line.match(MARKER);
      if (!m) { out.push({ file, line: i + 1, text: line }); continue; }
      const dir = m[1];
      if (referenced.has(dir)) problems.push(`${file}:${i + 1}: ${dir} is placed twice`);
      referenced.add(dir);
      if (!existsSync(join(base, dir))) { problems.push(`${file}:${i + 1}: ${dir} does not exist`); continue; }
      for (const rowName of mdFiles(join(base, dir))) {
        const rowFile = `${ROUTE_MAP_DIR}/${dir}/${rowName}`;
        if (!FRAGMENT.test(rowName)) problems.push(`${rowFile}: a fragment is named NNNN-<lowercase-slug>.md`);
        const { row, problems: rowProblems, listed } = canvasFileRow(body(readFileSync(join(base, dir, rowName), 'utf8')), rowFile);
        problems.push(...rowProblems);
        out.push({ file: rowFile, line: 1, text: row, canvasRow: true, listed: Boolean(listed) });
      }
    }
  }
  if (existsSync(canvasesDir)) {
    for (const part of readdirSync(canvasesDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      if (!referenced.has(`canvases/${part.name}`)) problems.push(`${ROUTE_MAP_DIR}/canvases/${part.name}: no section places these rows`);
    }
  }
  if (problems.length) throw new Error(`route map fragments:\n  ${problems.join('\n  ')}`);
  return out;
}

/**
 * One row per canvas across every fragment. A second file for the same canvas
 * names both files, so the fix is obvious: keep one.
 */
export function checkRouteMap(lines) {
  const seen = new Map();
  const problems = [];
  for (const l of lines) {
    if (!l.canvasRow) continue;
    if (/^(<{7}|={7}|>{7})(\s|$)/.test(l.text)) problems.push(`${l.file}: a conflict marker; finish the merge`);
    const canvas = l.text.replace(/^\|\s?/, '').split(' | ')[0].trim();
    if (seen.has(canvas)) {
      problems.push(`two rows for "${canvas}": ${seen.get(canvas)} and ${l.file}. Keep one, in one file.`);
    } else {
      seen.set(canvas, l.file);
    }
  }
  for (const l of lines) {
    if (!l.canvasRow && /^(<{7}|={7}|>{7})(\s|$)/.test(l.text)) problems.push(`${l.file}:${l.line}: a conflict marker; finish the merge`);
    if (!l.canvasRow && CANVAS_HEADER.test(l.text)) {
      // A canvas table header must be followed by its separator and the rows marker, never by inline rows.
      const i = lines.indexOf(l);
      const next = lines[i + 2];
      if (lines[i + 1]?.text?.startsWith('|') && next && !next.canvasRow && next.text.startsWith('| ')) {
        problems.push(`${l.file}:${l.line}: canvas rows go in canvases/part-N/, one file each, not inline`);
      }
    }
  }
  if (problems.length) throw new Error(`route map:\n  ${problems.join('\n  ')}`);
  return lines;
}

/** The whole map as one document, as ROUTE_MAP.md read before D4102. */
export function readRouteMap(root = REPO_ROOT) {
  return `${checkRouteMap(routeMapFragments(root)).map((l) => l.text).join('\n')}\n`;
}

/** Where line `n` (1-based) of `readRouteMap()`'s text comes from: "file:line". */
export function routeMapOrigin(n, root = REPO_ROOT) {
  const l = routeMapFragments(root)[n - 1];
  return l ? `${l.file}:${l.line}` : `line ${n}`;
}
