/**
 * D6966 (#6966) — the program presentation map, read in Node.
 *
 * The SPA collects `frontend/src/programs/catalog/*.js` with a Vite glob; Node has no glob, so
 * this reads the same folder from disk and hands the modules to the same `collectPrograms`
 * (`frontend/src/programs/collect.js`), which checks every entry the way the SPA does. The
 * entries are plain data with no imports, so no loader is needed.
 *
 * Readers: `scripts/prerender-og.mjs` and `scripts/validate-og-tags.mjs` (each program's own
 * page gets its own link preview, so adding a program edits no route list), and
 * `scripts/build-program-briefs.mjs` (the PDFs).
 */
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { collectPrograms } from '../../frontend/src/programs/collect.js';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const CATALOG_DIR = join(ROOT, 'frontend/src/programs/catalog');
export const PUBLIC_DIR = join(ROOT, 'frontend/public');

/** Every map entry, checked, in the index's order. */
export async function loadProgramCatalog(dir = CATALOG_DIR) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
  const globbed = {};
  for (const f of files) globbed[`./catalog/${f}`] = await import(pathToFileURL(join(dir, f)).href);
  return collectPrograms(globbed);
}

/** The routes whose link preview a program's map entry writes: its canonical page, with its own title and description. */
export async function programOgRoutes(dir = CATALOG_DIR) {
  const programs = await loadProgramCatalog(dir);
  return programs.map((p) => ({ path: p.canonical, overrides: { title: p.og.title, description: p.og.description }, program: p.key }));
}

/** The committed file a map entry's `pdf` serves from. */
export const pdfFileOf = (program) => join(PUBLIC_DIR, program.pdf.replace(/^\//, ''));
