#!/usr/bin/env node
/**
 * build-api-index — writes `frontend/src/lib/apiModules.generated.js`, the
 * re-export index of every client module under `frontend/src/lib/api/` (#4105).
 *
 * `api.js` re-exports that index with one fixed line, so a new API domain is
 * one new file in `lib/api/` and nothing else; nobody edits `api.js`. The
 * index is generated, not a Vite `import.meta.glob`, because the modules are
 * re-exported by name and ES named exports must be static (see
 * `lib/apiModules.mjs`). Since D5612 (#5612) it is gitignored, never
 * committed: `scripts/build-generated.mjs` writes it before every build,
 * typecheck and test.
 *
 *   node scripts/build-api-index.mjs           # write the index
 *   node scripts/build-api-index.mjs --check   # exit 1 when the generator is not
 *                                              # deterministic or git tracks the index
 *
 * `scripts/check-api-drift.mjs` (in `npm run test:drift`) runs the same checks
 * on the built index.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_INDEX_REL, buildApiIndex } from './lib/apiModules.mjs';
import { generatedOutputProblems } from './lib/generatedOutput.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = resolve(ROOT, API_INDEX_REL);
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

if (process.argv.includes('--check')) {
  const problems = generatedOutputProblems(ROOT, API_INDEX_REL, (o) => buildApiIndex(ROOT, o));
  if (problems.length) {
    for (const p of problems) console.error(p);
    process.exit(1);
  }
  console.log(`${API_INDEX_REL}: the generator is deterministic and git does not track its output.`);
} else {
  const want = buildApiIndex(ROOT);
  if (readIndex(file) === want) {
    console.log(`${API_INDEX_REL} is already current.`);
  } else {
    writeFileSync(file, want);
    console.log(`wrote ${API_INDEX_REL}`);
  }
}
