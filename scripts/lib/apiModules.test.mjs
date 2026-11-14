/**
 * D527 — the API client's domain modules are read by the drift check exactly
 * as api.js is, and the re-export block names exactly the modules on disk.
 * #4105 — the block is generated into `lib/apiModules.generated.js`, which
 * api.js re-exports with one line; both halves are checked here.
 *
 * Each fixture is a throwaway tree in the shape of the repo, so these tests
 * exercise the same file discovery check-api-drift.mjs uses, not a copy of it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  API_FILE_REL,
  API_INDEX_LINE,
  API_INDEX_REL,
  API_MODULES_DIR_REL,
  REEXPORT_BEGIN,
  REEXPORT_END,
  apiIndexProblems,
  apiJsProblems,
  buildApiIndex,
  classifyCalls,
  clientSources,
  extractClientCalls,
  listModules,
  readApiIndex,
  reexportLine,
  reexportProblems,
  renderApiIndex,
  renderIndexLines,
} from './apiModules.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The Worker's resolved route table, reduced to what the fixtures call. */
const ROUTES = [
  ['GET', '/api/widgets'],
  ['POST', '/api/widgets'],
  ['GET', '/api/widgets/:id{[0-9]+}'],
];

const apiJs = () => [
  "import { reportError } from './log';",
  '',
  API_INDEX_LINE,
  '',
  "export async function request(path, options = {}) { return fetch('/api' + path, options); }",
  "export const authApi = { me: () => request('/widgets') };",
  '',
].join('\n');

/** A generated index whose block holds exactly these lines. */
const indexJs = (lines) => renderIndexLines(lines);

function fixture(modules, blockLines = Object.keys(modules).sort().map(reexportLine)) {
  const root = mkdtempSync(join(tmpdir(), 'api-modules-'));
  mkdirSync(join(root, API_MODULES_DIR_REL), { recursive: true });
  writeFileSync(join(root, API_FILE_REL), apiJs());
  writeFileSync(join(root, API_INDEX_REL), indexJs(blockLines));
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
    reexport: [...apiJsProblems(sources[0].src), ...reexportProblems(readApiIndex(root), listModules(join(root, API_MODULES_DIR_REL)))],
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
  assert.deepEqual(reexportProblems(indexJs([reexportLine('a'), reexportLine('b')]), ['a', 'b']), []);
  assert.match(reexportProblems(indexJs([reexportLine('a'), reexportLine('ghost')]), ['a']).join('\n'),
    /names lib\/api\/ghost\.js, which does not exist/);
  assert.match(reexportProblems(indexJs([reexportLine('b'), reexportLine('a')]), ['a', 'b']).join('\n'),
    /not in alphabetical order/);
  assert.match(reexportProblems(indexJs([reexportLine('a'), reexportLine('a')]), ['a']).join('\n'),
    /lists a module twice/);
  assert.match(reexportProblems(indexJs(["export { aApi } from './api/a.js';"]), ['a']).join('\n'),
    /malformed line/);
  assert.match(reexportProblems("export const x = 1;\n", []).join('\n'), /no re-export block/);
  assert.match(reexportProblems(indexJs([]), ['Bad_name']).join('\n'), /not camelCase/);
  // #4105: an index that is not built, and one whose lines are right but whose
  // text is not what the generator writes (a hand edit), are both reported.
  // D5612: it is built before every build and test, never committed.
  assert.match(reexportProblems(null, ['a']).join('\n'), /is not built — run: node scripts\/build-generated\.mjs/);
  assert.match(reexportProblems(`// hand-written\n${renderApiIndex(['a'])}`, ['a']).join('\n'), /not exactly what build-api-index writes/);
  assert.deepEqual(reexportProblems(renderApiIndex(['b', 'a']), ['a', 'b']), [], 'the generator sorts');
});

test('api.js re-exports the generated index with its one line, and lists no module by hand (#4105)', () => {
  assert.deepEqual(apiJsProblems(apiJs()), []);
  assert.match(apiJsProblems("export const x = 1;\n").join('\n'), /does not re-export the generated index/);
  assert.match(apiJsProblems(`${API_INDEX_LINE}\n${API_INDEX_LINE}\n`).join('\n'), /more than once/);
  assert.match(apiJsProblems(`${API_INDEX_LINE}\n${reexportLine('widgets')}\n`).join('\n'), /re-exports a module by hand/);
  assert.match(apiJsProblems(`${API_INDEX_LINE}\n${REEXPORT_BEGIN}\n${REEXPORT_END}\n`).join('\n'), /carries an `api-modules` block/);
});

test('the real api.js re-exports the generated index, and the index names exactly the modules on disk', () => {
  const src = readFileSync(join(REPO, API_FILE_REL), 'utf8');
  assert.deepEqual(apiJsProblems(src), []);
  // D5612: the index is built, not committed, so this reads the generator's output rather than a file.
  assert.deepEqual(reexportProblems(buildApiIndex(REPO), listModules(join(REPO, API_MODULES_DIR_REL))), []);
  assert.equal(buildApiIndex(REPO, { reversed: true }), buildApiIndex(REPO), 'two renders of the same modules differ');
  const files = clientSources(REPO).map((s) => s.file);
  assert.equal(files[0], API_FILE_REL);
  assert.ok(extractClientCalls(src).length > 1000, 'api.js parsed to almost nothing — the harvest stopped matching');
});

test('D5612: the index is sound when built and untracked; a new module needs no other edit; a tracked index fails', (t) => {
  const root = fixture({ widgets: widgetModule('/widgets/${id}') });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(apiIndexProblems(root), []);
  // A new domain module is one new file: the generator's output names it, and nothing else changes.
  writeFileSync(join(root, API_MODULES_DIR_REL, 'gadgets.js'), widgetModule('/widgets/${id}').replace('widgetsApi', 'gadgetsApi'));
  writeFileSync(join(root, API_INDEX_REL), buildApiIndex(root));
  assert.deepEqual(apiIndexProblems(root), []);
  assert.match(readApiIndex(root), /export \* from '\.\/api\/gadgets\.js';\nexport \* from '\.\/api\/widgets\.js';/);
  // `git add -f` the index: the check says it is tracked.
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });
  assert.deepEqual(apiIndexProblems(root), []);
  execFileSync('git', ['add', '-f', API_INDEX_REL], { cwd: root, stdio: 'ignore' });
  assert.deepEqual(apiIndexProblems(root), [`${API_INDEX_REL} is tracked by git; it is generated and never committed (D5612) — run: git rm --cached ${API_INDEX_REL}`]);
});
