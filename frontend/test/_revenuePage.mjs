/**
 * D5039 (#5039) — the HQ Revenue page's source, now that it is split by part.
 *
 * `pages/hq/RevenuePage.jsx` is the page root; the parts it renders and the
 * model they draw by live in `pages/hq/revenue/`. Tests that read the page as
 * text read this: the root first, then every part, each headed by its path so
 * a failure names where a string was expected. Moving code between these
 * files does not break them.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = 'frontend/src/pages/hq/revenue';

/** Repo-relative paths: the page root, then its part files in name order. */
export const REVENUE_PAGE_FILES = Object.freeze([
  'frontend/src/pages/hq/RevenuePage.jsx',
  ...readdirSync(resolve(root, DIR)).filter((f) => f.endsWith('.jsx') || f.endsWith('.js')).sort().map((f) => `${DIR}/${f}`),
]);

/** The whole page's source, root first. */
export function revenuePageSource() {
  return REVENUE_PAGE_FILES.map((rel) => `// ── ${rel}\n${readFileSync(resolve(root, rel), 'utf8')}`).join('\n');
}

/** One part's source, by file name (`'Promotions.jsx'`). */
export function revenuePart(name) {
  return readFileSync(resolve(root, `${DIR}/${name}`), 'utf8');
}
