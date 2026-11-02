/**
 * #4105 — the API client's module re-export block, for tests that pin a
 * module's line in it.
 *
 * Until #4105 the block (`// api-modules:begin` … `// api-modules:end`) sat in
 * `frontend/src/lib/api.js` and was edited by hand; it is now generated into
 * `frontend/src/lib/apiModules.generated.js` by `scripts/build-api-index.mjs`,
 * which `api.js` re-exports with one line. The lines are unchanged
 * (`export * from './api/<name>.js';`, alphabetical), so a test that read the
 * block from `api.js` reads it here instead and asserts the same thing.
 * Returns the block from its begin marker up to (not including) its end
 * marker, exactly as the old slice of `api.js` did.
 */
import { readFileSync } from 'node:fs';

export const API_INDEX_URL = new URL('../src/lib/apiModules.generated.js', import.meta.url);

export function apiModulesBlock() {
  const src = readFileSync(API_INDEX_URL, 'utf8');
  return src.slice(src.indexOf('// api-modules:begin'), src.indexOf('// api-modules:end'));
}
