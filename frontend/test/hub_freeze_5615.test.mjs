/**
 * D5615 (#5615): the five hub files take no new entries.
 *
 * `scripts/lib/hubFreeze.mjs` reads the names each hub holds (api.js's exports
 * and object keys, App.jsx's and CycleRoute.jsx's import specifiers, index.ts's
 * static imports and app registrations, advisors.ts's method plus path
 * registrations), and `scripts/hub-freeze.json` lists the names each held on
 * `main` when the freeze landed. A name not on the list fails here, naming the
 * entry and the `documentation/architecture/HUBS.md` section that says where it
 * goes instead. The list is a set: removing an entry from a hub edits nothing.
 *
 * The mutations below are made to the text in memory, the way a PR would make
 * them, so each one proves the rule catches what it exists for.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hub_freeze_5615.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HUBS, HUBS_DOC, freezeProblems, hubNames, readFreeze, sortedNames,
} from '../../scripts/lib/hubFreeze.mjs';

const real = readFreeze();
const hub = (file) => HUBS.find((h) => h.file === file);
/** The problems after replacing one hub's text, everything else as it stands. */
const withSource = (file, text) => freezeProblems(real.lists, { ...real.sources, [file]: text }, real.hubsDoc);
/** `text` with `line` inserted after the first match of `anchor`. */
const after = (text, anchor, line) => {
  const at = text.indexOf(anchor);
  assert.ok(at >= 0, `anchor not found: ${anchor}`);
  const end = text.indexOf('\n', at) + 1;
  return `${text.slice(0, end)}${line}\n${text.slice(end)}`;
};

test('every name in the five hubs is on its list, and each hub has its HUBS.md section', () => {
  assert.deepEqual(freezeProblems(real.lists, real.sources, real.hubsDoc), []);
  for (const h of HUBS) {
    assert.ok(Array.isArray(real.lists[h.file]), `${h.file} has a list`);
    assert.ok(real.hubsDoc.includes(`\n## ${h.section}\n`), `${HUBS_DOC} has the section for ${h.file}`);
  }
});

test('the readers find what each hub holds: not an empty set that passes over nothing', () => {
  const names = (file) => hubNames(hub(file), real.sources[file]);
  const api = names('frontend/src/lib/api.js');
  for (const n of ['export api', 'export request', 'api.login', 'dd.listCases', 'export * from ./apiModules.generated.js']) assert.ok(api.has(n), n);
  const app = names('frontend/src/App.jsx');
  assert.ok(app.has('./pages/cycles/CycleRoute'), 'a lazy import is a specifier');
  assert.ok(app.has('react-router-dom'), 'a static import is a specifier');
  const cycle = names('frontend/src/pages/cycles/CycleRoute.jsx');
  for (const n of ['./defs/validate.jsx', './defs/raise.jsx', './defs/grow.jsx', './defs/build.jsx', './BuildPlan']) assert.ok(cycle.has(n), n);
  const worker = names('cloudflare-worker/src/index.ts');
  for (const n of ['import ./routes/advisors', 'ROUTE /api/advisors advisorsRoutes', 'ROUTE /api/mentors advisorsRoutes', 'USE * cors', 'GET /api/health']) assert.ok(worker.has(n), n);
  // A route named in a comment is not a registration.
  assert.ok(![...worker].some((n) => n.includes('...')), 'a comment was read as a registration');
  const advisors = names('cloudflare-worker/src/routes/advisors.ts');
  for (const n of ['GET /me', 'POST /:uid/book', 'ROUTE / advisorServicesRoutes', 'USE * (inline)']) assert.ok(advisors.has(n), n);
});

test('the list is sorted, has no duplicate, and holds every hub', () => {
  for (const h of HUBS) {
    const list = real.lists[h.file];
    assert.deepEqual(list, sortedNames(new Set(list)), `${h.file}: sorted and unique`);
  }
  const broken = { ...real.lists, 'frontend/src/App.jsx': [...real.lists['frontend/src/App.jsx']].reverse() };
  assert.match(freezeProblems(broken, real.sources, real.hubsDoc).join('\n'), /frontend\/src\/App\.jsx is not sorted and unique/);
  const missing = { ...real.lists };
  delete missing['cloudflare-worker/src/index.ts'];
  assert.match(freezeProblems(missing, real.sources, real.hubsDoc).join('\n'), /has no list for cloudflare-worker\/src\/index\.ts/);
});

test('a new key on `api` fails, naming the key and its HUBS.md section', () => {
  const file = 'frontend/src/lib/api.js';
  const text = after(real.sources[file], 'export const api = {', "  hubFreezeProbe: () => request('/hub-freeze-probe'),");
  const problems = withSource(file, text);
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], /^frontend\/src\/lib\/api\.js: "api\.hubFreezeProbe" is a new entry in a frozen hub \(D5615\)/);
  assert.match(problems[0], /documentation\/architecture\/HUBS\.md § `frontend\/src\/lib\/api\.js`/);
  // A new export fails the same way.
  assert.match(withSource(file, `${real.sources[file]}\nexport const hubFreezeProbe = 1;\n`).join('\n'), /"export hubFreezeProbe"/);
});

test('a new app.route( in index.ts fails, naming the mount and its section', () => {
  const file = 'cloudflare-worker/src/index.ts';
  const text = after(real.sources[file], "app.route('/api/advisors', advisorsRoutes);", "app.route('/api/hub-freeze-probe', advisorsRoutes);");
  const problems = withSource(file, text);
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], /"ROUTE \/api\/hub-freeze-probe advisorsRoutes" is a new entry in a frozen hub/);
  assert.match(problems[0], /HUBS\.md § `cloudflare-worker\/src\/index\.ts`/);
  // A second router on a path already listed is a new entry too: the router is part of the name.
  const again = after(real.sources[file], "app.route('/api/advisors', advisorsRoutes);", "app.route('/api/advisors', probeRoutes);");
  assert.match(withSource(file, again).join('\n'), /"ROUTE \/api\/advisors probeRoutes"/);
  // So is a new static import.
  assert.match(withSource(file, `import probe from './routes/hubFreezeProbe';\n${real.sources[file]}`).join('\n'), /"import \.\/routes\/hubFreezeProbe"/);
});

test('a dynamic import in scheduled() stays unfrozen; a registration in a comment or a string is not one', () => {
  const file = 'cloudflare-worker/src/index.ts';
  const text = after(real.sources[file], 'async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {',
    "    const { probe } = await import('./services/hubFreezeProbe');");
  assert.deepEqual(withSource(file, text), []);
  const quoted = `${real.sources[file]}\n// app.route('/api/in-a-comment', x);\nconst s = "app.route('/api/in-a-string', y)";\n`;
  assert.deepEqual(withSource(file, quoted), []);
});

test('a new import in App.jsx fails, naming the specifier and its section', () => {
  const file = 'frontend/src/App.jsx';
  const problems = withSource(file, `import Probe from './pages/HubFreezeProbe';\n${real.sources[file]}`);
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], /^frontend\/src\/App\.jsx: "\.\/pages\/HubFreezeProbe" is a new entry/);
  assert.match(problems[0], /HUBS\.md § `frontend\/src\/App\.jsx`/);
  // A lazy page is an import as well.
  assert.match(withSource(file, `${real.sources[file]}\nconst P = lazy(() => import('./pages/LazyProbe'));\n`).join('\n'), /"\.\/pages\/LazyProbe"/);
});

test('a new import in CycleRoute.jsx and a new registration in advisors.ts fail', () => {
  const cycle = 'frontend/src/pages/cycles/CycleRoute.jsx';
  assert.match(withSource(cycle, `import Probe from './HubFreezeProbe';\n${real.sources[cycle]}`).join('\n'),
    /CycleRoute\.jsx: "\.\/HubFreezeProbe" is a new entry[\s\S]*§ `frontend\/src\/pages\/cycles\/CycleRoute\.jsx`/);
  const advisors = 'cloudflare-worker/src/routes/advisors.ts';
  const text = `${real.sources[advisors]}\nadvisors.get('/me/hub-freeze-probe', (c) => c.json({}));\n`;
  assert.match(withSource(advisors, text).join('\n'), /advisors\.ts: "GET \/me\/hub-freeze-probe" is a new entry[\s\S]*§ `cloudflare-worker\/src\/routes\/advisors\.ts`/);
});

test('removing entries passes with no edit to the list', () => {
  const api = 'frontend/src/lib/api.js';
  const src = real.sources[api];
  const line = src.split('\n').find((l) => /^ {2}login: /.test(l));
  assert.ok(line, 'api.login is one line');
  assert.deepEqual(withSource(api, src.replace(`${line}\n`, '')), []);
  const worker = 'cloudflare-worker/src/index.ts';
  assert.deepEqual(withSource(worker, real.sources[worker].replace("app.route('/api/mentors', advisorsRoutes);\n", '')), []);
  const app = 'frontend/src/App.jsx';
  const lazyLine = real.sources[app].split('\n').find((l) => l.includes("lazy(() => import('./pages/cycles/CycleRoute'))"));
  assert.deepEqual(withSource(app, real.sources[app].replace(`${lazyLine}\n`, '')), []);
});

test('a hub with no section in HUBS.md fails by name', () => {
  const doc = real.hubsDoc.replace('\n## `cloudflare-worker/src/routes/advisors.ts`\n', '\n## advisors\n');
  assert.match(freezeProblems(real.lists, real.sources, doc).join('\n'), /HUBS\.md has no section "## `cloudflare-worker\/src\/routes\/advisors\.ts`"/);
});

test('CycleRoute.jsx holds no cycle entry: each is its own file under defs/, imported once', async () => {
  const route = real.sources['frontend/src/pages/cycles/CycleRoute.jsx'];
  assert.doesNotMatch(route, /^ {2}(validate|raise|grow|build): \{$/m, 'a cycle entry is written inline again');
  assert.match(route, /^const CYCLE_DEFS = \{ validate: validateDef, raise: raiseDef, grow: growDef, build: buildDef \};$/m);
  for (const cycle of ['validate', 'raise', 'grow', 'build']) {
    assert.match(route, new RegExp(`^import ${cycle}Def from '\\./defs/${cycle}\\.jsx';$`, 'm'));
    const def = (await import(`../src/pages/cycles/defs/${cycle}.jsx`)).default;
    assert.ok(Array.isArray(def.modules) && def.modules.length, `${cycle} has its modules`);
    assert.equal(typeof def.Mount, 'function', `${cycle} has its lightbox`);
    assert.equal(typeof def.path, 'string', `${cycle} has its action path`);
    const src = readFileSync(`frontend/src/pages/cycles/defs/${cycle}.jsx`, 'utf8');
    assert.match(src, new RegExp(`^const ${cycle} = \\{$[\\s\\S]*^export default ${cycle};$`, 'm'));
  }
});
