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
        const rowText = body(readFileSync(join(base, dir, rowName), 'utf8'));
        if (rowText.includes('\n') || !rowText.startsWith('| ')) {
          problems.push(`${rowFile}: a canvas file holds exactly one table row, one line starting "| "`);
        }
        out.push({ file: rowFile, line: 1, text: rowText, canvasRow: true });
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
