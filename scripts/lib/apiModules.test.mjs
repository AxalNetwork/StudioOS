/**
 * D527 — the API client's domain modules are read by the drift check exactly
 * as api.js is, and api.js's re-export block names exactly the modules on disk.
 *
 * Each fixture is a throwaway tree in the shape of the repo, so these tests
 * exercise the same file discovery check-api-drift.mjs uses, not a copy of it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  API_FILE_REL,
  API_MODULES_DIR_REL,
  REEXPORT_BEGIN,
  REEXPORT_END,
  classifyCalls,
  clientSources,
  extractClientCalls,
  listModules,
  reexportLine,
  reexportProblems,
} from './apiModules.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The Worker's resolved route table, reduced to what the fixtures call. */
const ROUTES = [
  ['GET', '/api/widgets'],
  ['POST', '/api/widgets'],
  ['GET', '/api/widgets/:id{[0-9]+}'],
];

const apiJs = (lines) => [
  "import { reportError } from './log';",
  '',
  REEXPORT_BEGIN,
  ...lines,
  REEXPORT_END,
  '',
  "export async function request(path, options = {}) { return fetch('/api' + path, options); }",
  "export const authApi = { me: () => request('/widgets') };",
  '',
].join('\n');

function fixture(modules, blockLines = Object.keys(modules).sort().map(reexportLine)) {
  const root = mkdtempSync(join(tmpdir(), 'api-modules-'));
  mkdirSync(join(root, API_MODULES_DIR_REL), { recursive: true });
  writeFileSync(join(root, API_FILE_REL), apiJs(blockLines));
  for (const [name, src] of Object.entries(modules)) writeFileSync(join(root, API_MODULES_DIR_REL, `${name}.js`), src);
  return root;
}

/** What check-api-drift.mjs computes, over a fixture tree. */
function drift(root) {
  const sources = clientSources(root);
  const calls = sources.flatMap(({ src }) => extractClientCalls(src));
  const { missingRoute, missingMethod } = classifyCalls(calls, ROUTES);
  return {
    files: sources.map((s) => s.file),
    calls: calls.length,
    missing: [...missingRoute, ...missingMethod].sort(),
    reexport: reexportProblems(sources[0].src, listModules(join(root, API_MODULES_DIR_REL))),
  };
}

const widgetModule = (path, method) => [
  "import { request } from '../api.js';",
  '',
  'export const widgetsApi = {',
  method
    ? `  save: (id) => request(\`${path}\`, { method: '${method}', body: '{}' }),`
    : `  get: (id) => request(\`${path}\`),`,
  '};',
  '',
].join('\n');

test('a module method with no Worker route fails the drift check', (t) => {
  const root = fixture({ widgets: widgetModule('/widgets/${id}/archive') });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const r = drift(root);
  assert.deepEqual(r.files, [API_FILE_REL, `${API_MODULES_DIR_REL}/widgets.js`], 'the module was not read');
  assert.deepEqual(r.missing, ['GET /api/widgets/:p/archive']);
  assert.deepEqual(r.reexport, []);
});

test('a module method whose verb the Worker does not answer fails as well', (t) => {
  const root = fixture({ widgets: widgetModule('/widgets/${id}', 'DELETE') });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(drift(root).missing, ['DELETE /api/widgets/:p']);
});

test('a module method with a Worker route passes', (t) => {
  const root = fixture({ widgets: widgetModule('/widgets/${id}') });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const r = drift(root);
  assert.equal(r.calls, 2, "both api.js's call and the module's were read");
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.reexport, []);
});

test('a module missing from the re-export block is reported', (t) => {
  const root = fixture(
    { gadgets: widgetModule('/widgets'), widgets: widgetModule('/widgets/${id}') },
    [reexportLine('widgets')],
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const r = drift(root);
  assert.equal(r.reexport.length, 1, r.reexport.join('\n'));
  assert.match(r.reexport[0], /lib\/api\/gadgets\.js is missing from the re-export block/);
  assert.ok(r.reexport[0].includes(reexportLine('gadgets')), 'the report says which line to add');
});

test('the re-export block must name only real modules, once each, in order', () => {
  assert.deepEqual(reexportProblems(apiJs([reexportLine('a'), reexportLine('b')]), ['a', 'b']), []);
  assert.match(reexportProblems(apiJs([reexportLine('a'), reexportLine('ghost')]), ['a']).join('\n'),
    /names lib\/api\/ghost\.js, which does not exist/);
  assert.match(reexportProblems(apiJs([reexportLine('b'), reexportLine('a')]), ['a', 'b']).join('\n'),
    /not in alphabetical order/);
  assert.match(reexportProblems(apiJs([reexportLine('a'), reexportLine('a')]), ['a']).join('\n'),
    /lists a module twice/);
  assert.match(reexportProblems(apiJs(["export { aApi } from './api/a.js';"]), ['a']).join('\n'),
    /malformed line/);
  assert.match(reexportProblems("export const x = 1;\n", []).join('\n'), /no re-export block/);
  assert.match(reexportProblems(apiJs([]), ['Bad_name']).join('\n'), /not camelCase/);
});

test('the real api.js carries the block, and it names exactly the modules on disk', () => {
  const src = readFileSync(join(REPO, API_FILE_REL), 'utf8');
  assert.deepEqual(reexportProblems(src, listModules(join(REPO, API_MODULES_DIR_REL))), []);
  const files = clientSources(REPO).map((s) => s.file);
  assert.equal(files[0], API_FILE_REL);
  assert.ok(extractClientCalls(src).length > 1000, 'api.js parsed to almost nothing — the harvest stopped matching');
});
