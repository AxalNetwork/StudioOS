// #4574 part 8 (D4574-p8) — market readings, brief notes and proposal
// attachments moved out of routes/research.ts into routes/research_client_prep.ts,
// which mounts itself through the route registry (#4105).
//
// What has to stay true, read off the real Worker as index.ts composes it:
//
//   1. the new router mounts at `/api/research` immediately ahead of
//      research.ts's router, so every middleware that ran ahead of these routes
//      still does;
//   2. the eleven routes live in exactly one router: research.ts no longer
//      registers any of them, and the new file registers nothing else;
//   3. no other route the Worker serves matches a request for one of them, so
//      mounting them ahead of the rest of research.ts changed no precedence:
//      each request's handler chain is the global middleware, then its own route.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/research_client_prep_4574.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

const calls: Array<{ app: unknown; path: string; router: unknown }> = [];
const proto = Hono.prototype as any;
const realRoute = proto.route;
proto.route = function (this: unknown, path: string, sub: unknown) {
  calls.push({ app: this, path, router: sub });
  return realRoute.call(this, path, sub);
};
await import('../src/index.ts');
proto.route = realRoute;

const research = (await import('../src/routes/research.ts')).default as any;
const clientPrep = (await import('../src/routes/research_client_prep.ts')).default as any;
const { mount } = await import('../src/routes/research_client_prep.ts');

// The Worker's app is the one that mounted research.ts's router.
const app = calls.find((c) => c.router === research)!.app as any;
const mounts = calls.filter((c) => c.app === app);

const MOVED = [
  'GET /market-readings', 'POST /market-readings', 'GET /market-readings/:uid', 'DELETE /market-readings/:uid',
  'GET /brief-notes', 'POST /brief-notes', 'PATCH /brief-notes/:uid', 'DELETE /brief-notes/:uid',
  'GET /attachments', 'POST /attachments', 'DELETE /attachments/:uid',
];
// D7651 (#7651): the routes this router has gained since the move, the summary
// of one reading and (part 2) of all of them. They are held to the same rules
// as the moved ones. The all-readings summary is registered ahead of
// `GET /market-readings/:uid`, which also matches its path.
const ADDED = ['GET /market-readings/:uid/summary'];
const OWN = [
  ...MOVED.slice(0, 2), 'GET /market-readings/summary', ...MOVED.slice(2, 4), ...ADDED, ...MOVED.slice(4),
];
// D7651 part 2: the one path two routes of this router match. The summary
// answers first and returns, so `/:uid` never reads "summary" as a uid.
const SHADOWS: Record<string, string[]> = {
  'GET /market-readings/summary': ['GET /api/research/market-readings/summary', 'GET /api/research/market-readings/:uid'],
};
const own = (r: any) => (r.routes as Array<{ method: string; path: string }>)
  .filter((x) => x.method !== 'ALL').map((x) => `${x.method} ${x.path}`);

test('the router mounts at /api/research immediately ahead of research.ts', () => {
  assert.deepEqual({ path: mount.path, router: mount.router, before: mount.before },
    { path: '/api/research', router: clientPrep, before: [research] });
  const at = mounts.findIndex((c) => c.router === clientPrep);
  const main = mounts.findIndex((c) => c.router === research);
  assert.ok(at >= 0, 'research_client_prep.ts is not mounted on the Worker');
  assert.equal(mounts.filter((c) => c.router === clientPrep).length, 1, 'mounted twice');
  assert.equal(mounts[at].path, '/api/research');
  assert.equal(at, main - 1, 'not mounted immediately ahead of research.ts');
});

test('each moved route is registered once, by the new router only', () => {
  assert.deepEqual(own(clientPrep), OWN);
  const left = own(research).filter((r) => MOVED.includes(r));
  assert.deepEqual(left, [], 'research.ts still registers a moved route');
});

test('no other route the Worker serves answers a request for a moved route', () => {
  const sample = (p: string) => p.replace(/:[A-Za-z]+/g, 'x1');
  for (const r of OWN) {
    const [method, path] = r.split(' ');
    const url = `/api/research${sample(path)}`;
    const matched = (app.router.match(method, url)[0] as any[]).map((e) => e[0][1]);
    const routes = matched.filter((m) => m.method !== 'ALL').map((m) => `${m.method} ${m.path}`);
    assert.deepEqual(routes, SHADOWS[r] || [`${method} /api/research${path}`], `${method} ${url} matches ${routes.join(', ')}`);
    // Middleware first, and the route next: no middleware is chained after it.
    const first = matched.findIndex((m) => m.method !== 'ALL');
    assert.equal(`${matched[first].method} ${matched[first].path}`, `${method} /api/research${path}`, `${method} ${url}: another route answers first`);
    assert.ok(matched.slice(first).every((m) => m.method === method), `${method} ${url}: a handler runs after the route`);
  }
});
