// #4105 — route modules that mount themselves.
//
// A module under src/routes/ may export `mount` (src/util/routeRegistry.ts);
// scripts/build-route-registry.mjs lists every such module in
// src/routes/_registry.ts, and index.ts attaches that list before its first
// `app.route(...)`. This file holds four things:
//
//   1. the committed registry is exactly what the generator writes, and every
//      descriptor is sound (the staleness check `npm run test:drift` runs);
//   2. on the real Worker, the order-sensitive deck routers still mount just
//      above `decks`, and votes.ts still mounts last;
//   3. the earlier router's path wins on a real request through the whole
//      Worker: `GET /api/decks/stage-norms` is deck_stage_norms.ts's, never
//      decks.ts's `GET /:id`;
//   4. the mechanism itself, on synthetic routers, and the generator's checks
//      on fixture trees.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/route_registry_4105.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import {
  REGISTRY_REL, mountModules, parseMount, registeredMounts, registryProblems, renderRegistry,
} from '../../scripts/lib/routeRegistry.mjs';
import { attachRouteRegistry, planMounts } from '../src/util/routeRegistry.ts';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { memKV } from './_mem_kv.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Record every `route()` call while index.ts composes the Worker, so the test
// reads the order the app actually mounted, not the order of any source text.
const calls: Array<{ app: unknown; path: string; router: unknown }> = [];
const proto = Hono.prototype as any;
const realRoute = proto.route;
proto.route = function (this: unknown, path: string, sub: unknown) {
  calls.push({ app: this, path, router: sub });
  return realRoute.call(this, path, sub);
};
const { default: worker } = await import('../src/index.ts');
proto.route = realRoute;
const { ROUTE_MODULES } = await import('../src/routes/_registry.ts');
const decks = (await import('../src/routes/decks.ts')).default;
const deckQuotes = (await import('../src/routes/deck_quotes.ts')).default;
const { deckReports, hqDeckReports } = await import('../src/routes/deck_reports.ts');
const deckStageNorms = (await import('../src/routes/deck_stage_norms.ts')).default;
const votes = (await import('../src/routes/votes.ts')).default;
const deckUpdateReuse = (await import('../src/routes/deck_update_reuse.ts')).default;

/** The Worker's own app: the instance `route()` was called on most. */
function workerMounts() {
  const byApp = new Map<unknown, number>();
  for (const c of calls) byApp.set(c.app, (byApp.get(c.app) ?? 0) + 1);
  const app = [...byApp.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return calls.filter((c) => c.app === app);
}

test('the committed registry is exactly what the generator writes, and every descriptor is sound', () => {
  assert.deepEqual(registryProblems(ROOT), [], 'run: node scripts/build-route-registry.mjs');
  const mods = mountModules(ROOT);
  assert.equal(readFileSync(resolve(ROOT, REGISTRY_REL), 'utf8'), renderRegistry(mods.map((m: any) => m.file)));
  // The proof modules this issue migrated are registered, and the runtime list matches the files.
  for (const f of ['deck_quotes', 'deck_reports', 'deck_stage_norms', 'votes']) {
    assert.ok(mods.some((m: any) => m.file === f), `${f}.ts is not registered`);
  }
  assert.deepEqual(ROUTE_MODULES.map((m) => m.file), mods.map((m: any) => m.file));
  // And index.ts no longer mounts them by hand (a router mounted twice would answer twice).
  const index = readFileSync(resolve(ROOT, 'cloudflare-worker/src/index.ts'), 'utf8');
  for (const id of ['deckQuotes', 'deckReports', 'hqDeckReports', 'deckStageNorms', 'votesRoutes']) {
    assert.doesNotMatch(index, new RegExp(`app\\.route\\([^)]*\\b${id}\\)`), `index.ts still mounts ${id}`);
  }
  // index.ts attaches the registry before its first mount and empties it before the 404.
  const attach = index.indexOf('\nconst routeRegistry = attachRouteRegistry(app, ROUTE_MODULES);\n');
  const remaining = index.indexOf('\nrouteRegistry.mountRemaining();\n');
  const mountLines = [...index.matchAll(/^app\.route\(/gm)].map((m) => m.index!);
  assert.ok(mountLines.length > 300, 'index.ts parsed to almost no mounts');
  assert.ok(attach > 0 && attach < mountLines[0], 'the registry is not attached before the first app.route');
  assert.ok(remaining > mountLines[mountLines.length - 1], 'mountRemaining() is not after the last app.route');
  assert.ok(remaining < index.indexOf('\napp.notFound('), 'mountRemaining() is not before app.notFound');
  // The static readers see the registered paths.
  const paths = registeredMounts(ROOT).map((r: any) => `${r.path} ${r.router}`);
  assert.ok(paths.includes('/api/decks deckStageNorms'));
  assert.ok(paths.includes('/api/pipeline/vote votes'));
});

test('on the real Worker, the order-sensitive deck routers mount just above `decks`, and votes.ts mounts last', () => {
  const mounts = workerMounts();
  // No pinned total (#4134): every PR that adds a router used to bump one
  // number here, so any two of them conflicted. The total is derived instead —
  // each `app.route(` line in index.ts, plus each registered descriptor — and
  // no router answers twice on the same path. D1541's deckElements is one of those lines.
  const index = readFileSync(resolve(ROOT, 'cloudflare-worker/src/index.ts'), 'utf8');
  const handLines = [...index.matchAll(/^app\.route\(/gm)].length;
  const planned = planMounts(ROUTE_MODULES);
  assert.equal(mounts.length, handLines + planned.length, 'a mount the Worker makes is neither an index.ts line nor a descriptor');
  const ids = new Map<unknown, number>();
  const pairs = mounts.map((m) => `${m.path} #${ids.get(m.router) ?? ids.set(m.router, ids.size).get(m.router)}`);
  assert.equal(new Set(pairs).size, pairs.length, 'a router is mounted twice on the same path');
  const at = mounts.findIndex((m) => m.router === decks);
  assert.ok(at > 0, '`decks` is not mounted');
  // The hand-written line above `decks` used to be deckReports + hqDeckReports,
  // with deckQuotes and deckStageNorms above them. Each now mounts through its
  // `before: [decks]`, in file-name order, directly above `decks`. The line
  // above them is whatever index.ts mounts there; it is not pinned (#4134).
  assert.deepEqual(mounts.slice(at - 4, at + 1).map((m) => [m.path, m.router]), [
    ['/api/decks', deckQuotes],
    ['/api/decks', deckReports],
    ['/api/admin/deck-reports', hqDeckReports],
    ['/api/decks', deckStageNorms],
    ['/api/decks', decks],
  ]);
  // No other mount of these routers anywhere.
  for (const r of [deckQuotes, deckReports, hqDeckReports, deckStageNorms]) {
    assert.equal(mounts.filter((m) => m.router === r).length, 1);
  }
  // votes.ts has no `before`: the registry's slot, after index.ts's last line,
  // which is exactly where the two hand-written lines sat. D1584 (#3831):
  // deck_update_reuse.ts has no `before` either, so the slot holds every
  // descriptor without one, in file-name order, and index.ts's last line sits
  // just above them.
  const registeredRouters = new Set(planned.map((d) => d.router));
  const slot = planned.filter((d) => !d.before.length);
  assert.deepEqual(mounts.slice(-slot.length).map((m) => [m.path, m.router]), slot.map((d) => [d.path, d.router]), 'the registry slot is every descriptor without a `before`, in order');
  assert.equal(registeredRouters.has(mounts[mounts.length - slot.length - 1].router), false, 'the mount above the slot is index.ts\'s last line');
  assert.deepEqual(mounts.slice(-3).map((m) => [m.path, m.router]), [
    ['/api/decks', deckUpdateReuse],
    ['/api/pipeline/votes', votes],
    ['/api/pipeline/vote', votes],
  ]);
});

const JWT_SECRET = randomBytes(32).toString('hex');
const ctx: any = { waitUntil() {}, passThroughOnException() {} };
async function get(path: string) {
  const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
  const fx = makeD1(stripForeignKeys(tableFromBaseline(baseline, 'users')));
  fx.db.prepare("INSERT INTO users(id,name,email,role,is_active,subscription_tier) VALUES(1,'Synthetic','s1@example.test','founder',1,'free')").run();
  const env = { DB: fx.DB, JWT_SECRET, ENVIRONMENT: 'development', RATE_LIMITS: memKV(), TOKENS: memKV() } as any;
  const auth = `Bearer ${await new SignJWT({ user_id: 1 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  const s = [console.warn, console.error, console.log]; console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try {
    const res = await worker.fetch(new Request(`https://axal.vc${path}`, { headers: { authorization: auth } }), env, ctx);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error, console.log] = s; }
}

test('a real request: `GET /api/decks/stage-norms` is answered by deck_stage_norms.ts, never by decks.ts `GET /:id`', async () => {
  // deck_stage_norms.ts asks for the venture; decks.ts would have read
  // "stage-norms" as a deck id.
  const norms = await get('/api/decks/stage-norms');
  assert.equal(norms.status, 400, JSON.stringify(norms));
  assert.equal(norms.body?.error, 'project_id_required', JSON.stringify(norms.body));
  // The control: a single segment that is not a registered path is still decks.ts's `GET /:id`.
  const deck = await get('/api/decks/999999');
  assert.notEqual(deck.body?.error, 'project_id_required', JSON.stringify(deck));
  assert.ok([403, 404, 500].includes(deck.status), JSON.stringify(deck));
});

// ── The mechanism, on synthetic routers ─────────────────────────────────────

const routerSaying = (path: string, word: string) => {
  const r = new Hono();
  r.get(path, (c) => c.text(word));
  return r;
};

test('`before` a hand-mounted router mounts just above that line; no `before` mounts in the slot; the first matching path wins', async () => {
  const legacyId = routerSaying('/:id', 'legacy /:id');
  const early = routerSaying('/special', 'registered, before legacy');
  const chained = routerSaying('/chained', 'registered, before early');
  const slot = routerSaying('/late', 'registered, in the slot');
  const other = routerSaying('/other', 'legacy other');
  const app = new Hono();
  const reg = attachRouteRegistry(app, [
    { file: 'b_early', mount: { path: '/api/x', router: early, before: [legacyId] } },
    { file: 'c_chained', mount: { path: '/api/x', router: chained, before: [early] } },
    { file: 'a_slot', mount: { path: '/api/x', router: slot } },
  ]);
  assert.ok(Object.prototype.hasOwnProperty.call(app, 'route'), 'app.route is not hooked while index.ts mounts');
  app.route('/api/y', other);
  app.route('/api/x', legacyId);
  reg.mountRemaining();
  assert.ok(!Object.prototype.hasOwnProperty.call(app, 'route'), 'app.route is still hooked after mountRemaining()');
  assert.deepEqual(reg.mounted.map((m) => m.file ?? `legacy ${m.path}`), [
    'legacy /api/y', 'c_chained', 'b_early', 'legacy /api/x', 'a_slot',
  ]);
  const say = async (p: string) => (await app.request(p)).text();
  assert.equal(await say('/api/x/special'), 'registered, before legacy');
  assert.equal(await say('/api/x/chained'), 'registered, before early');
  // In the slot, after every hand-written mount: a covering `/:id` above wins,
  // which is why a router that must win says so with `before`.
  assert.equal(await say('/api/x/late'), 'legacy /:id');
  assert.equal(await say('/api/x/7'), 'legacy /:id');
});

test('planMounts: file-name order, then each module\'s array order, unless `before` says otherwise; a cycle throws', () => {
  const [a, b, c] = [new Hono(), new Hono(), new Hono()];
  const plan = planMounts([
    { file: 'zeta', mount: { path: '/z', router: c, before: [a] } },
    { file: 'alpha', mount: [{ path: '/a', router: a }, { path: '/b', router: b }] },
  ]);
  assert.deepEqual(plan.map((p) => `${p.file}[${p.index}] ${p.path}`), ['zeta[0] /z', 'alpha[0] /a', 'alpha[1] /b']);
  assert.deepEqual(planMounts([
    { file: 'b', mount: { path: '/b', router: b } },
    { file: 'a', mount: { path: '/a', router: a } },
  ]).map((p) => p.file), ['a', 'b']);
  assert.throws(() => planMounts([
    { file: 'a', mount: { path: '/a', router: a, before: [b] } },
    { file: 'b', mount: { path: '/b', router: b, before: [a] } },
  ]), /cycle/);
});

// ── The generator's checks, on fixture trees ───────────────────────────────

function tree(files: Record<string, string>, registry?: string) {
  const root = mkdtempSync(join(tmpdir(), 'route-registry-4105-'));
  for (const [rel, src] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), src);
  }
  if (registry !== undefined) writeFileSync(join(root, REGISTRY_REL), registry);
  return root;
}
const R = 'cloudflare-worker/src/routes';
const INDEX = "import legacy from './routes/legacy';\nconst app = new Hono();\napp.route('/api/l', legacy);\n";
const LEGACY = "import { Hono } from 'hono';\nconst legacy = new Hono();\nexport default legacy;\n";

test('the generator refuses a stale registry, an unknown `before`, a router mounted twice, a cycle and an unreadable descriptor', (t) => {
  const good = {
    'cloudflare-worker/src/index.ts': INDEX,
    [`${R}/legacy.ts`]: LEGACY,
    [`${R}/widgets.ts`]: "import { Hono } from 'hono';\nimport legacy from './legacy';\nconst widgets = new Hono();\nexport default widgets;\nexport const mount: RouteMount = { path: '/api/l', router: widgets, before: [legacy] };\n",
  };
  const ok = tree(good, renderRegistry(['widgets']));
  t.after(() => rmSync(ok, { recursive: true, force: true }));
  assert.deepEqual(registryProblems(ok), []);

  const stale = tree(good, renderRegistry([]));
  t.after(() => rmSync(stale, { recursive: true, force: true }));
  assert.deepEqual(registryProblems(stale), [`${REGISTRY_REL} is stale — run: node scripts/build-route-registry.mjs`]);

  const unknown = tree({ ...good, [`${R}/widgets.ts`]: good[`${R}/widgets.ts`].replace("import legacy from './legacy';\n", "import ghost from './ghost';\n").replace('before: [legacy]', 'before: [ghost]') }, renderRegistry(['widgets']));
  t.after(() => rmSync(unknown, { recursive: true, force: true }));
  assert.match(registryProblems(unknown).join('\n'), /names a router that is neither registered nor mounted by index\.ts/);

  const twice = tree({ ...good, 'cloudflare-worker/src/index.ts': `${INDEX}import widgets from './routes/widgets';\napp.route('/api/w', widgets);\n` }, renderRegistry(['widgets']));
  t.after(() => rmSync(twice, { recursive: true, force: true }));
  assert.match(registryProblems(twice).join('\n'), /registered by its `mount` export AND mounted by hand in index\.ts/);

  const cycle = tree({
    'cloudflare-worker/src/index.ts': INDEX,
    [`${R}/legacy.ts`]: LEGACY,
    [`${R}/one.ts`]: "import two from './two';\nconst one = new Hono();\nexport default one;\nexport const mount = { path: '/api/1', router: one, before: [two] };\n",
    [`${R}/two.ts`]: "import one from './one';\nconst two = new Hono();\nexport default two;\nexport const mount = { path: '/api/2', router: two, before: [one] };\n",
  }, renderRegistry(['one', 'two']));
  t.after(() => rmSync(cycle, { recursive: true, force: true }));
  assert.match(registryProblems(cycle).join('\n'), /`before` forms a cycle/);

  assert.match(parseMount("export const mount = { path: PATH, router: r };\n").error, /string literal/);
  assert.match(parseMount("export const mount = { path: '/a', router: r, before: ['decks'] };\n").error, /by identifier/);
  assert.match(parseMount("export const mount = { path: '/a', router: r, extra: 1 };\n").error, /unknown key/);
  assert.deepEqual(parseMount("export const mount: RouteMount[] = [\n  // first\n  { path: '/a', router: a, before: [b, c] },\n  { path: '/b', router: b },\n];\n"), {
    entries: [{ path: '/a', router: 'a', before: ['b', 'c'] }, { path: '/b', router: 'b', before: [] }],
  });
  assert.equal(parseMount('export const notMount = 1;\n'), null);
});
