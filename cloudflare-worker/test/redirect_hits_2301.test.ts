// #2301 — the pageview beacon counts an old redirect address under its own
// `redirect:<pattern>` key, only for a pattern on the list, and stores the
// pattern and the day only.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/redirect_hits_2301.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeD1 } from './_d1_sqlite.mjs';
import publicRoutes from '../src/routes/public.ts';
import { ADMIN_TAB_REDIRECTS, REDIRECT_ROUTES, isRedirectKey, redirectKey } from '../src/services/redirectRoutes.ts';

const SCHEMA = `CREATE TABLE public_pageviews (day TEXT NOT NULL, path TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, path));`;
const beacon = (env: any, path: string) => publicRoutes.request('/analytics/pageview', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, referrer: 'https://elsewhere.example/', ts: 1 }),
}, env);
const rows = (env: any) => env.db.prepare('SELECT path, views FROM public_pageviews ORDER BY path').all().map((r: any) => [r.path, r.views]);

test('a listed redirect is counted under its key, once per beacon, by the day', async () => {
  const env = makeD1(SCHEMA);
  for (const p of ['redirect:/dashboard', 'redirect:/dashboard', 'redirect:/tickets/:id', '/pricing']) assert.equal((await beacon(env, p)).status, 204);
  assert.deepEqual(rows(env), [['/pricing', 1], ['redirect:/dashboard', 2], ['redirect:/tickets/:id', 1]]);
  const [{ day }] = env.db.prepare('SELECT DISTINCT day FROM public_pageviews').all() as any[];
  assert.match(day, /^\d{4}-\d{2}-\d{2}$/, 'the day, no time and nothing about the visitor');
});

test('anything else is not counted: an unlisted redirect key, a visited path with ids, a page', async () => {
  const env = makeD1(SCHEMA);
  for (const p of ['redirect:/studio', 'redirect:/tickets/42', 'redirect:', 'redirect:/dashboard/x', '/dashboard', '/studio'])
    assert.equal((await beacon(env, p)).status, 204);
  assert.deepEqual(rows(env), []);
  // The query and hash are dropped before the check, as for every pageview.
  await beacon(env, 'redirect:/signals?q=x#y');
  assert.deepEqual(rows(env), [['redirect:/signals', 1]]);
});

test('the list is closed and well formed', () => {
  const paths = REDIRECT_ROUTES.map((r) => r.path);
  assert.equal(new Set(paths).size, paths.length, 'no pattern twice');
  for (const p of paths) {
    assert.match(p, /^\/[a-z0-9\-/:*]+(?:\?tab=[a-z-]+)?$/i, p);
    assert.equal(isRedirectKey(redirectKey(p)), true);
  }
  assert.equal(isRedirectKey('/dashboard'), false, 'a bare path is not a redirect key');
  const keep = REDIRECT_ROUTES.filter((r) => r.keep).map((r) => r.path).sort();
  // D937: sent cohort notices keep the old Lab address working permanently.
  // D938: /admin forwards every old console tab, and #2375 keeps it for good.
  assert.deepEqual(keep, ['/admin', '/admin/spinout-lab', '/help/:id', '/integrations', '/notifications', '/notifications/*', '/plans-and-pricing', '/product-testing', '/settings', '/settings/:section', '/support', '/tickets/:id']);
});


test('each fixed admin tab has its own persisted counter; unknown or extra query/hash data is rejected', async () => {
  const env = makeD1(SCHEMA);
  for (const { path } of ADMIN_TAB_REDIRECTS) assert.equal((await beacon(env, redirectKey(path))).status, 204);
  assert.equal(rows(env).length, ADMIN_TAB_REDIRECTS.length);
  assert.ok(rows(env).some(([path]: any[]) => path === 'redirect:/admin?tab=kyc'));
  await beacon(env, 'redirect:/admin?tab=kyc');
  assert.equal(env.db.prepare("SELECT views FROM public_pageviews WHERE path = 'redirect:/admin?tab=kyc'").get()?.views, 2);
  for (const path of ['redirect:/admin?tab=unknown', 'redirect:/admin?tab=kyc&email=private@example.test', 'redirect:/admin?tab=kyc#secret', 'redirect:/admin?tab=private@example.test', '/admin?tab=kyc']) await beacon(env, path);
  assert.equal(rows(env).length, ADMIN_TAB_REDIRECTS.length);
  assert.equal(rows(env).reduce((n: number, [, views]: any[]) => n + views, 0), ADMIN_TAB_REDIRECTS.length + 1);
  // D938's bare redirect is kept in addition to D939's per-tab counters.
  assert.equal((await beacon(env, 'redirect:/admin')).status, 204);
  assert.equal(rows(env).length, ADMIN_TAB_REDIRECTS.length + 1);
  assert.equal(env.db.prepare("SELECT views FROM public_pageviews WHERE path = 'redirect:/admin'").get()?.views, 1);
});
