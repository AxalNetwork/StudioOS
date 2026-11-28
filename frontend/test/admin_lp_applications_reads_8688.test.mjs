// D8688 part 2 (#8688): the LP applications console calls methods that exist.
//
// The 390 px role qualification found the console saying "Could not load the
// queue" on HQ and on every branch: the page called `api.adminLpApplications`
// and `api.adminLpApplicationReview`, which live on `spinoutLab`, so every load
// threw a TypeError before any request left. A source-text test had pinned the
// wrong object. This one reads the page's imports from `lib/api` and checks that
// each `<object>.<method>(` it calls is a key of that object's literal in
// `lib/api.js`, so the console cannot call a method its object does not have.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const PAGE = read('../src/pages/admin/AdminLpApplications.jsx');
const API = read('../src/lib/api.js');

/** The names the page imports from `../../lib/api` (the file, not the `lib/api/` modules). */
function importedFromApi(src) {
  const m = /import\s*\{([^}]*)\}\s*from\s*'\.\.\/\.\.\/lib\/api';/.exec(src);
  return m ? m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop()).filter(Boolean) : [];
}

/** The top-level keys of `export const <name> = { ... };` in lib/api.js. */
function keysOf(name) {
  const start = API.indexOf(`\nexport const ${name} = {\n`);
  if (start < 0) return null;
  const end = API.indexOf('\n};', start);
  const body = API.slice(start, end);
  return new Set([...body.matchAll(/^ {2}([A-Za-z_$][\w$]*)\s*:/gm)].map((x) => x[1]));
}

test('every lib/api object the LP applications console calls has the method it calls', () => {
  const names = importedFromApi(PAGE);
  assert.ok(names.length, 'the console imports nothing from lib/api');
  const calls = [];
  for (const name of names) {
    const keys = keysOf(name);
    assert.ok(keys, `lib/api.js exports no object literal named ${name}`);
    for (const [, method] of PAGE.matchAll(new RegExp(`\\b${name}\\.([A-Za-z_$][\\w$]*)\\(`, 'g'))) {
      calls.push(`${name}.${method}`);
      assert.ok(keys.has(method), `${name}.${method} is not a method of ${name} in lib/api.js`);
    }
  }
  // Mutation checked: the import switched back to `api` (with both calls) fails both asserts above.
  assert.deepEqual(calls.sort(), ['spinoutLab.adminLpApplicationReview', 'spinoutLab.adminLpApplications']);
});
