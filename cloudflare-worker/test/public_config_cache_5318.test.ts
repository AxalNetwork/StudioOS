/**
 * #5318 H10 (D5318) — the three configuration reads every page makes on load:
 * `GET /api/settings/appearance`, `GET /api/settings/explainers` and
 * `GET /api/public/plans-and-packs`, measured through the whole Worker with the
 * #4573 harness (`_perf_harness.ts`).
 *
 * What CI holds here, since a header does not lower a server-side count:
 *   - each read's D1 statement budget, by category, as `perf_budgets_4573` does
 *     (these three have no row there; the numbers are the ones measured on main);
 *   - the cache policy: the member's own settings are `private, no-cache`, never
 *     shared; the plans read is `public` with a 60 s window, and the same bytes
 *     whoever asks, so a shared cache can never hand one member another's data;
 *   - the revalidation path: `If-None-Match` with the current ETag answers 304
 *     with no body and no more statements than the 200, and a changed value
 *     changes the ETag, so a save is never answered "not modified".
 * The fewer requests per anonymous load are held in frontend/test
 * (settings_context_anonymous_5318.test.mjs).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/public_config_cache_5318.test.ts
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { categoryOf, harness } from './_perf_harness.ts';
import { etagMatches, jsonWithEtag } from '../src/util/httpCache.ts';

const FLOWS = Object.freeze([
  { name: 'appearance.anonymous', who: null, path: '/api/settings/appearance' },
  { name: 'explainers.anonymous', who: null, path: '/api/settings/explainers' },
  { name: 'plans.anonymous', who: null, path: '/api/public/plans-and-packs' },
  { name: 'appearance.member', who: 2, path: '/api/settings/appearance' },
  { name: 'explainers.member', who: 2, path: '/api/settings/explainers' },
  { name: 'plans.member', who: 2, path: '/api/public/plans-and-packs' },
]);
/** flow → [status, auth, telemetry, route], measured on main at d16c59081c. */
const BUDGETS: Record<string, [number, number, number, number]> = {
  'appearance.anonymous': [401, 0, 2, 0],
  'explainers.anonymous': [401, 0, 2, 0],
  'plans.anonymous': [200, 0, 2, 3],
  'appearance.member': [200, 4, 2, 1],
  'explainers.member': [200, 4, 2, 1],
  'plans.member': [200, 4, 2, 3],
};
const PLANS = 'public, max-age=60, s-maxage=60, stale-while-revalidate=60';
const MEMBER = 'private, no-cache';

let h: Awaited<ReturnType<typeof harness>>;
before(async () => { h = await harness(); });
after(() => h?.close());

test('each read answers as before and stays within its D1 statement budget', async () => {
  // Each count is the one measured on main; a change that adds a statement to one of these reads fails here.
  for (const flow of FLOWS) {
    await h.request(flow); // the first request creates lazily-made tables
    const r = await h.request(flow);
    const [status, auth, telemetry, route] = BUDGETS[flow.name];
    assert.equal(r.status, status, `${flow.name}: status`);
    assert.ok(r.auth <= auth, `${flow.name}: ${r.auth} auth statements, budget ${auth}`);
    assert.ok(r.telemetry <= telemetry, `${flow.name}: ${r.telemetry} telemetry statements, budget ${telemetry}`);
    assert.ok(r.route <= route, `${flow.name}: ${r.route} route statements, budget ${route}\n${r.statements.filter((s) => categoryOf(s) === 'route').join('\n')}`);
  }
});

test('the plans read is public for 60 s, with the same bytes and ETag whoever asks', async () => {
  // Mutation checked: the policy back at max-age=300 → fails; a caller-dependent body → the ETags differ.
  const anon = await h.request({ who: null, path: '/api/public/plans-and-packs' });
  const member = await h.request({ who: 2, path: '/api/public/plans-and-packs' });
  for (const r of [anon, member]) {
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), PLANS);
    assert.match(r.headers.get('etag') ?? '', /^"[0-9a-f]{32}"$/);
    assert.match(r.headers.get('content-type') ?? '', /^application\/json/);
  }
  assert.equal(member.headers.get('etag'), anon.headers.get('etag'), 'a signed-in caller must get the shared body');
  assert.equal(member.bytes, anon.bytes);
});

test('the member settings reads are private and revalidated on every use', async () => {
  // Mutation checked: `public` in MEMBER_SETTINGS_CACHE → fails here.
  for (const path of ['/api/settings/appearance', '/api/settings/explainers']) {
    const r = await h.request({ who: 2, path });
    assert.equal(r.status, 200, path);
    assert.equal(r.headers.get('cache-control'), MEMBER, path);
    assert.match(r.headers.get('etag') ?? '', /^"[0-9a-f]{32}"$/, path);
  }
});

test('If-None-Match with the current ETag answers 304, no body, and no more statements than the 200', async () => {
  // Mutation checked: the etagMatches branch removed from jsonWithEtag → every 304 here is a 200 and fails.
  for (const flow of FLOWS.filter((f) => BUDGETS[f.name][0] === 200)) {
    const full = await h.request(flow);
    const etag = full.headers.get('etag')!;
    const revalidated = await h.request({ ...flow, headers: { 'If-None-Match': etag } });
    assert.equal(revalidated.status, 304, `${flow.name}: revalidation`);
    assert.equal(revalidated.bytes, 0, `${flow.name}: a 304 carries no body`);
    assert.equal(revalidated.headers.get('etag'), etag);
    assert.ok(revalidated.total <= full.total, `${flow.name}: ${revalidated.total} statements on 304, ${full.total} on 200`);
    const stale = await h.request({ ...flow, headers: { 'If-None-Match': '"0000"' } });
    assert.equal(stale.status, 200, `${flow.name}: an old ETag gets the body`);
    assert.ok(stale.bytes > 0);
  }
});

test('a saved change moves the ETag, so it is never answered "not modified"', async () => {
  const flow = { who: 2, path: '/api/settings/appearance' };
  const first = await h.request(flow);
  h.db.prepare("INSERT INTO user_settings (user_id, theme) VALUES (2, 'dark') ON CONFLICT(user_id) DO UPDATE SET theme = 'dark'").run();
  const after = await h.request({ ...flow, headers: { 'If-None-Match': first.headers.get('etag')! } });
  assert.equal(after.status, 200, 'the old ETag no longer matches');
  assert.notEqual(after.headers.get('etag'), first.headers.get('etag'));
  // Another member's ETag never revalidates this member's body when the bodies differ.
  const other = await h.request({ who: 5, path: '/api/settings/appearance' });
  const crossed = await h.request({ ...flow, headers: { 'If-None-Match': other.headers.get('etag')! } });
  assert.equal(crossed.status, 200);
});

test('jsonWithEtag: a different payload is a different ETag; If-None-Match lists, weak forms and * match', async () => {
  const app = new Hono();
  app.get('/:v', (c) => jsonWithEtag(c, { price: Number(c.req.param('v')) }, PLANS));
  const a = await app.request('/100');
  const b = await app.request('/101');
  assert.notEqual(a.headers.get('etag'), b.headers.get('etag'));
  assert.deepEqual(await a.json(), { price: 100 });
  const e = a.headers.get('etag')!;
  assert.equal((await app.request('/100', { headers: { 'If-None-Match': `"x", W/${e}` } })).status, 304);
  assert.equal((await app.request('/101', { headers: { 'If-None-Match': e } })).status, 200);
  assert.equal(etagMatches('*', e), true);
  assert.equal(etagMatches(undefined, e), false);
  assert.equal(etagMatches('"other"', e), false);
});
