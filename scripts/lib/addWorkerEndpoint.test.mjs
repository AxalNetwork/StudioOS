/**
 * #6326 — the add-worker-endpoint preflight's rules, driven with in-memory files.
 *
 *   node --test scripts/lib/addWorkerEndpoint.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALWAYS_TESTS, GATES, GENERATED, GUARDS, GUARDS_IF, HUBS, endpointFindings, exportNames, gatesIn,
  mountPaths, planChecks, render, sentenceErrors, testsNaming, testsReaching,
} from './addWorkerEndpoint.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const rules = (findings, level) => findings.filter((f) => !level || f.level === level).map((f) => `${f.file} ${f.rule}`);

const GOOD_ROUTE = `/**
 * #9999 — GET /api/widgets: the caller's widgets.
 */
import { Hono } from 'hono';
import { requireAuth } from '../auth';
import type { RouteMount } from '../util/routeRegistry';
const widgets = new Hono();
widgets.get('/', async (c) => { const u = await requireAuth(c); return c.json({ widgets: [] }); });
export default widgets;
export const mount: RouteMount = { path: '/api/widgets', router: widgets };
`;

test('the lists name files and scripts that exist on this checkout', () => {
  for (const h of HUBS) assert.ok(existsSync(join(ROOT, h)), h);
  assert.deepEqual([...HUBS].sort(), Object.keys(JSON.parse(readFileSync(join(ROOT, 'scripts/hub-freeze.json'), 'utf8'))).sort());
  const ignored = readFileSync(join(ROOT, '.gitignore'), 'utf8');
  for (const g of GENERATED) assert.ok(ignored.includes(g), `${g} is gitignored`);
  for (const t of ALWAYS_TESTS) assert.ok(existsSync(join(ROOT, t)), t);
  const auth = readFileSync(join(ROOT, 'cloudflare-worker/src/auth.ts'), 'utf8');
  for (const [, names] of GATES) for (const n of names) assert.match(auth, new RegExp(`export async function ${n}\\b`), n);
  const guards = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts['test:guards'];
  for (const cmd of [...GUARDS, ...GUARDS_IF.flatMap((g) => g.cmds)]) {
    const script = /scripts\/[\w-]+\.mjs/.exec(cmd)[0];
    assert.ok(existsSync(join(ROOT, script)), script);
    if (!cmd.startsWith('node scripts/build-generated.mjs')) assert.ok(guards.includes(cmd.replace(/^node (?:--no-warnings )?/, '')) || guards.includes(cmd), `${cmd} is in test:guards`);
  }
});

test('a well-formed new route passes, with its gate reported', () => {
  const f = endpointFindings({ files: [{ path: 'cloudflare-worker/src/routes/widgets.ts', status: 'A', text: GOOD_ROUTE }] });
  assert.deepEqual(rules(f, 'fail'), []);
  assert.deepEqual(rules(f, 'warn'), []);
  assert.match(f.find((x) => x.level === 'info').message, /authenticated/);
});

test('a new route with no header, no mount and no gate fails on each', () => {
  const bare = "import { Hono } from 'hono';\nconst r = new Hono();\nr.get('/', (c) => c.json({}));\nexport default r;\n";
  const f = endpointFindings({ files: [{ path: 'cloudflare-worker/src/routes/widgets.ts', status: 'A', text: bare }] });
  assert.deepEqual(rules(f, 'fail').sort(), ['cloudflare-worker/src/routes/widgets.ts #4104', 'cloudflare-worker/src/routes/widgets.ts #4105']);
  assert.deepEqual(rules(f, 'warn'), ['cloudflare-worker/src/routes/widgets.ts #4570']);
  // A mount outside /api/ is named.
  const off = endpointFindings({ files: [{ path: 'cloudflare-worker/src/routes/widgets.ts', status: 'A', text: GOOD_ROUTE.replace("'/api/widgets'", "'/widgets'") }] });
  assert.match(off.find((x) => x.level === 'warn').message, /outside \/api\//);
});

test('an added app.route( line fails; one in a comment, or one already there, does not', () => {
  const p = 'cloudflare-worker/src/index.ts';
  assert.deepEqual(rules(endpointFindings({ files: [{ path: p, status: 'M', text: '', added: ["app.route('/api/widgets', widgets);"] }] }), 'fail'), [`${p} #4105`]);
  assert.deepEqual(rules(endpointFindings({ files: [{ path: p, status: 'M', text: "app.route('/api/x', x);", added: ['// never an app.route( line'] }] }), 'fail'), []);
});

test('hub problems pass through as failures, and a hub edit without one is a warning', () => {
  const problem = 'cloudflare-worker/src/routes/advisors.ts: "GET /me/profile-draft" is a new entry in a frozen hub (D5615).';
  const f = endpointFindings({ files: [{ path: 'cloudflare-worker/src/routes/advisors.ts', status: 'M', text: '', added: [] }], hubProblems: [problem] });
  assert.deepEqual(rules(f), ['cloudflare-worker/src/routes/advisors.ts D5615']);
  assert.equal(f[0].level, 'fail');
  const w = endpointFindings({ files: [{ path: 'frontend/src/lib/api.js', status: 'M', text: '', added: ['  // a comment'] }] });
  assert.deepEqual(rules(w, 'warn'), ['frontend/src/lib/api.js D5615']);
  // A hub named with --files but unchanged since the base adds nothing.
  assert.deepEqual(endpointFindings({ files: [{ path: 'frontend/src/lib/api.js', status: 'M', text: 'x', added: [] }] }), []);
});

test('a tracked generated module fails', () => {
  const f = endpointFindings({ files: [], tracked: ['README.md', 'cloudflare-worker/src/routes/_registry.ts'] });
  assert.deepEqual(rules(f, 'fail'), ['cloudflare-worker/src/routes/_registry.ts D5612']);
  assert.deepEqual(endpointFindings({ files: [], tracked: ['README.md'] }), []);
});

test('error carries a code: a sentence on an added line is named, a code or a template is not', () => {
  assert.deepEqual(sentenceErrors("return c.json({ error: 'Widget not found' }, 404);"), ['Widget not found']);
  assert.deepEqual(sentenceErrors("return c.json({ error: 'widget_not_found', message: 'No such widget.' }, 404);"), []);
  assert.deepEqual(sentenceErrors('return c.json({ error: `${code}` }, 400);'), []);
  assert.deepEqual(sentenceErrors("// { error: 'Not a code' }"), []);
  const p = 'cloudflare-worker/src/routes/widgets.ts';
  const f = endpointFindings({ files: [{ path: p, status: 'M', text: '', added: ["return c.json({ error: 'Forbidden' }, 403);"] }] });
  assert.deepEqual(rules(f, 'warn'), [`${p} D278`]);
});

test('a new client module: header comment, and no export api.js already declares', () => {
  const p = 'frontend/src/lib/api/widgets.js';
  const ok = "/**\n * #9999: the widgets client.\n */\nimport { request } from '../api.js';\nexport const widgetsApi = { list: () => request('/widgets') };\n";
  assert.deepEqual(endpointFindings({ files: [{ path: p, status: 'A', text: ok }], apiExports: new Set(['api', 'request']) }), []);
  const clash = ok.replace('widgetsApi', 'events');
  assert.deepEqual(rules(endpointFindings({ files: [{ path: p, status: 'A', text: clash }], apiExports: new Set(['events']) }), 'fail'), [`${p} D527`]);
  const noHeader = ok.replace(/^\/\*\*[\s\S]*?\*\/\n/, '');
  assert.deepEqual(rules(endpointFindings({ files: [{ path: p, status: 'A', text: noHeader }] }), 'fail'), [`${p} #4104`]);
});

test('the small readers', () => {
  assert.deepEqual([...exportNames('export const a = 1;\nexport async function b() {}\nexport { c, d as e };\nconst f = 2;')], ['a', 'b', 'c', 'e']);
  assert.deepEqual(gatesIn('const u = await requireSuperAdmin(c);'), ['super_admin']);
  assert.deepEqual(gatesIn('await gate(c, requireHqAdmin);'), ['hq_admin']);
  assert.deepEqual(gatesIn('// no gate here: requireAuthority'), []);
  // An imported but never called gate is not a gate; requireRole with 'admin' is one.
  assert.deepEqual(gatesIn("import { requireAuth, getCurrentUser } from '../auth';\nr.get('/x', (c) => c.json({}));"), []);
  assert.deepEqual(gatesIn("import {\n  requireAuth,\n} from '../auth';\nr.get('/x', async (c) => { await requireAuth(c); });"), ['authenticated']);
  assert.deepEqual(gatesIn("await requireRole(c, ['admin']);"), ['admin']);
  assert.deepEqual(gatesIn("await requireRole(c, ['founder']);"), []);
  assert.deepEqual(mountPaths("export const mount: RouteMount[] = [\n { path: '/api/a', router: r, before: [x] },\n { path: '/api/b', router: r },\n];"), ['/api/a', '/api/b']);
  assert.deepEqual(mountPaths("const x = { path: '/nope' };"), []);
});

test('a test that reaches a file through a shared helper is named, with the helper', () => {
  const helpers = new Map([
    ['frontend/test/_advisorRoutesSource.mjs', "const ROUTES = resolve(process.cwd(), 'cloudflare-worker/src/routes');\nconst core = readFileSync(resolve(ROUTES, 'advisors.ts'), 'utf8');\nconst split = [...core.matchAll(/^import \\w+ from '\\.\\/(advisors_\\w+)';$/gm)];"],
    ['frontend/test/_wrap.mjs', "export * from './_advisorRoutesSource.mjs';"],
    ['frontend/test/_other.mjs', "read('cloudflare-worker/src/routes/widgets.ts')"],
  ]);
  const tests = new Map([
    ['frontend/test/a.test.mjs', "import { advisorRoutesSource } from './_advisorRoutesSource.mjs';"],
    ['frontend/test/b.test.mjs', "import { x } from './_wrap.mjs';"],
    ['frontend/test/c.test.mjs', "import { y } from './_other.mjs';"],
    ['frontend/test/d.test.mjs', "read('cloudflare-worker/src/routes/advisors.ts')"],
  ]);
  const p = 'cloudflare-worker/src/routes/advisors.ts';
  assert.deepEqual(testsReaching(p, tests, helpers), [
    { file: 'frontend/test/a.test.mjs', via: 'frontend/test/_advisorRoutesSource.mjs' },
    { file: 'frontend/test/b.test.mjs', via: 'frontend/test/_wrap.mjs' },
    { file: 'frontend/test/d.test.mjs' },
  ]);
  // A split module the helper collects from advisors.ts's imports is reached too; an unrelated file is not.
  assert.deepEqual(testsNaming('cloudflare-worker/src/routes/advisors_cohorts.ts', tests, helpers), ['frontend/test/a.test.mjs', 'frontend/test/b.test.mjs']);
  assert.deepEqual(testsNaming('cloudflare-worker/src/routes/events.ts', tests, helpers), []);
  // Without the helpers only the direct reader is found.
  assert.deepEqual(testsNaming(p, tests), ['frontend/test/d.test.mjs']);
  const plan = planChecks([p], tests, helpers);
  assert.deepEqual(plan.naming['frontend/test/a.test.mjs'], [`${p} (via _advisorRoutesSource.mjs)`]);
  // The real helper on this checkout still reads advisors.ts the way this test assumes.
  const real = readFileSync(join(ROOT, 'frontend/test/_advisorRoutesSource.mjs'), 'utf8');
  assert.deepEqual(testsNaming(p, new Map([['frontend/test/z.test.mjs', "from './_advisorRoutesSource.mjs'"]]), new Map([['frontend/test/_advisorRoutesSource.mjs', real]])), ['frontend/test/z.test.mjs']);
});

test('tests that name a changed file by path are planned with the right runner', () => {
  const sources = new Map([
    ['frontend/test/hq_x.test.mjs', "read('cloudflare-worker/src/routes/admin_hq_skills.ts')"],
    ['cloudflare-worker/test/expiry.test.ts', "src('routes/auth.ts')"],
    ['cloudflare-worker/test/imp.test.ts', "import w from '../src/routes/widgets';"],
    ['cloudflare-worker/test/other.test.ts', "import w from '../src/routes/widgets_more';"],
  ]);
  assert.deepEqual(testsNaming('cloudflare-worker/src/routes/widgets.ts', sources), ['cloudflare-worker/test/imp.test.ts']);
  const plan = planChecks(['cloudflare-worker/src/routes/admin_hq_skills.ts', 'cloudflare-worker/src/routes/auth.ts'], sources);
  assert.deepEqual(plan.tests, [...ALWAYS_TESTS, 'cloudflare-worker/test/expiry.test.ts', 'frontend/test/hq_x.test.mjs'].sort());
  assert.ok(plan.commands.some((c) => c.startsWith('node --import ./frontend/test/_deck-loader.mjs --test') && c.includes("'frontend/test/hq_x.test.mjs'")));
  assert.ok(plan.commands.some((c) => c.includes('_ts-loader.mjs --test') && c.includes("'cloudflare-worker/test/expiry.test.ts'")));
  assert.deepEqual(plan.guards, [...GUARDS]);
  // A migration brings the schema guards; an advisor service the bank guards.
  assert.ok(planChecks(['cloudflare-worker/sql/migrations/202611140000_9999_widgets.sql']).guards.includes('node scripts/check-sql-migrations.mjs'));
  assert.ok(planChecks(['cloudflare-worker/src/services/advisor/writeRouter.ts']).guards.includes('node scripts/check-advisor-bank-drift.mjs'));
  assert.match(render([], plan), /Findings: none\.[\s\S]*hq_x\.test\.mjs {2}<- cloudflare-worker\/src\/routes\/admin_hq_skills\.ts[\s\S]*Run, in order:/);
});
