/**
 * #4707 — the HQ licence page's source, now that it is split by domain.
 *
 * `pages/admin/AdminLicences.jsx` is the page root; the parts it renders live
 * in `pages/admin/licences/`. Tests that read the page as text read this: the
 * root first (so a slice from `export default function AdminLicences(` still
 * starts there), then every domain file, each headed by its path so a failure
 * names where a string was expected.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = 'frontend/src/pages/admin/licences';

/** Repo-relative paths: the page root, then its domain files in name order. */
export const LICENCE_PAGE_FILES = Object.freeze([
  'frontend/src/pages/admin/AdminLicences.jsx',
  ...readdirSync(resolve(root, DIR)).filter((f) => f.endsWith('.jsx') || f.endsWith('.js')).sort().map((f) => `${DIR}/${f}`),
]);

/** The whole page's source, root first. */
export function licencePageSource() {
  return LICENCE_PAGE_FILES.map((rel) => `// ── ${rel}\n${readFileSync(resolve(root, rel), 'utf8')}`).join('\n');
}

/** One domain file's source, by name (`'DeployStep'`). */
export function licencePart(name) {
  return readFileSync(resolve(root, `${DIR}/${name}.jsx`), 'utf8');
}
