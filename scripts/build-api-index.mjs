#!/usr/bin/env node
/**
 * build-api-index — writes `frontend/src/lib/apiModules.generated.js`, the
 * re-export index of every client module under `frontend/src/lib/api/` (#4105).
 *
 * `api.js` re-exports that index with one fixed line, so a new API domain is
 * one new file in `lib/api/` plus this script's output; nobody edits `api.js`.
 * The index is generated, not a Vite `import.meta.glob`, because the modules
 * are re-exported by name and ES named exports must be static (see
 * `lib/apiModules.mjs`).
 *
 *   node scripts/build-api-index.mjs           # write the index
 *   node scripts/build-api-index.mjs --check   # exit 1 when it is stale
 *
 * `scripts/check-api-drift.mjs` (in `npm run test:drift`) fails on a stale
 * index too, with the same remedy.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_INDEX_REL, API_MODULES_DIR_REL, listModules, renderApiIndex } from './lib/apiModules.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = resolve(ROOT, API_INDEX_REL);
const want = renderApiIndex(listModules(resolve(ROOT, API_MODULES_DIR_REL)));
// Read without an existence check first: a check-then-read-then-write is a
// file-system race (CodeQL js/file-system-race). A missing index reads as null.
function readIndex(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
}
const have = readIndex(file);

if (process.argv.includes('--check')) {
  if (have !== want) {
    console.error(`${API_INDEX_REL} is stale — run: node scripts/build-api-index.mjs`);
    process.exit(1);
  }
  console.log(`${API_INDEX_REL} is current.`);
} else if (have === want) {
  console.log(`${API_INDEX_REL} is already current.`);
} else {
  writeFileSync(file, want);
  console.log(`wrote ${API_INDEX_REL}`);
}
