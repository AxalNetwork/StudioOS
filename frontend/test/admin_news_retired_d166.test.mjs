/**
 * D166 — the `admin_news.ts` twin is retired, and what it alone kept alive
 * goes with it.
 *
 * WHY THIS IS NOT A TIDY-UP GUARD. `/api/admin/news` registered eleven
 * handlers over the SAME `articles` table as `/api/admin/articles`, on
 * identical paths, with matching transition tables — and one divergence that
 * was not cosmetic:
 *
 *   admin_news      if (!['approved', 'in_review'].includes(row.status))
 *   admin_articles  if (row.status !== 'approved')
 *
 * whose own comment reads "No skipping straight from in_review → published,
 * even by an admin." Both were `requireAdmin`, so no role boundary was
 * crossed and this was never privilege escalation. What the twin removed was
 * the RECORDED APPROVE STEP: an admin could take an article
 * in_review → published with nobody having called /approve.
 *
 * D156 looked at this item and concluded "There is no twin to retire", from
 * a handler count alone. It never quoted the publish handler. That the file
 * was alive is an argument that retiring it is not free; it is not an
 * argument that there is nothing to retire.
 *
 * THE HALF WORTH KEEPING A GUARD FOR is the one the blast-radius sweep
 * missed: the delete STRANDS two things no other check can see. An exported
 * function with no caller is invisible to `noUnusedLocals` (it is not a
 * local) and to `check-unused-imports` (nothing imports it to be unused);
 * an unreachable member of a string-literal union is invisible to both.
 * Neither had a test of its own before this file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const at = (p) => resolve(process.cwd(), p);
const raw = (p) => readFileSync(at(p), 'utf8');

const INDEX = raw('cloudflare-worker/src/index.ts');
const API = codeOnly(raw('frontend/src/lib/api.js'));
const APP = codeOnly(raw('frontend/src/App.jsx'));
const ARTICLES = raw('cloudflare-worker/src/routes/admin_articles.ts');
const RENDER = codeOnly(raw('cloudflare-worker/src/services/newsRender.ts'));
const NOTIFY = raw('cloudflare-worker/src/services/newsNotify.ts');

test('the module is gone, and so is the path it answered on', () => {
  assert.ok(!existsSync(at('cloudflare-worker/src/routes/admin_news.ts')),
    'routes/admin_news.ts is back');

  // Mount AND import. Leaving the import behind would typecheck-fail rather
  // than route anything, but the assertion is cheap and says which is which.
  assert.ok(!INDEX.includes("from './routes/admin_news'"),
    'index.ts still imports the retired router');
  assert.ok(!INDEX.includes("app.route('/api/admin/news'"),
    'index.ts still mounts /api/admin/news');

  // The path must 404 rather than fall through. `/api/admin` is a catch-all
  // mounted after the specific prefixes, so an unmounted /api/admin/news
  // reaches the generic admin router, which has no such route.
  const catchAll = INDEX.indexOf("app.route('/api/admin', admin)");
  assert.ok(catchAll > 0, 'the /api/admin catch-all moved; this test cannot reason about fall-through');
  assert.equal(INDEX.slice(0, catchAll).match(/app\.route\('\/api\/admin\/news'/g), null,
    'a /api/admin/news mount is registered before the catch-all');
});

test('the hole the retirement closes is still closed on the surviving route', () => {
  // The whole point. If `admin_articles` ever loosened to match what was
  // deleted, retiring the twin would have bought nothing.
  assert.match(ARTICLES, /if \(row\.status !== 'approved'\) \{/,
    "admin_articles' publish gate no longer requires `approved` exactly");
  assert.doesNotMatch(ARTICLES, /\[\s*'approved'\s*,\s*'in_review'\s*\]/,
    'admin_articles now accepts in_review at publish — the D166 hole, reopened');

  // The 409 names what it wanted, which the twin's did not.
  const pub = ARTICLES.indexOf("adminArticles.post('/:id/publish'");
  assert.ok(pub > 0, 'the publish handler is gone');
  const end = ARTICLES.indexOf("adminArticles.post('/:id/unpublish'", pub);
  assert.ok(end > pub, 'the unpublish handler no longer follows publish — this slice would overrun');
  assert.match(ARTICLES.slice(pub, end), /expected: 'approved'/,
    'the publish refusal stopped naming the status it wanted');
});

test('the SPA namespace went with the routes, in the same commit', () => {
  // check-api-drift harvests every request() call in api.js, not only
  // `api.*` properties, so leaving these behind fails the build. Asserting
  // it here as well means the reason is legible at the call site.
  assert.doesNotMatch(API, /export const adminNews/, 'the adminNews api namespace is back');
  assert.doesNotMatch(API, /'\/admin\/news/, 'an api.js method still issues an /admin/news request');
  assert.doesNotMatch(API, /`\/admin\/news/, 'an api.js method still issues an /admin/news request');
});

test('the SPA redirect STAYS — it is a different route from the worker one', () => {
  // `admin_route_reachability.test.mjs` pins REDIRECTS to exactly
  // ['/admin/news'], so deleting this would break a guard that has nothing
  // to do with the worker. An admin with the old URL bookmarked still lands
  // on the queue.
  assert.ok(APP.includes('path="/admin/news"'), 'the /admin/news SPA redirect was deleted');
  assert.match(APP, /path="\/admin\/news"\s+element=\{<Navigate to="\/admin\/articles"/,
    'the /admin/news route stopped redirecting to /admin/articles');
});

test('the two dependencies the delete strands go with it', () => {
  // FINDING 8, and the reason this file exists. `bustEdgeCache` had exactly
  // two callers and both lived in the retired module. Nothing was lost:
  // `bustArticleEdgeCache` is a strict superset — Task #3 made it bust the
  // deprecated /api/news* keys alongside the /api/articles* ones.
  assert.doesNotMatch(RENDER, /export async function bustEdgeCache\b/,
    'bustEdgeCache is back, and nothing calls it');
  assert.match(RENDER, /export async function bustArticleEdgeCache\b/,
    'the surviving cache buster is gone');
  for (const key of ['/api/news`', '/api/news/${slug}`', '/api/news/cover/${id}`']) {
    assert.ok(RENDER.includes(key),
      `bustArticleEdgeCache stopped busting ${key} — deleting its twin then DOES lose something`);
  }

  // Five of NewsNotifyKind's seven members were fired only from the retired
  // router. They are not lost behaviour: articleNotify.ts carries the full
  // seven for the queue that survives, and that is asserted rather than
  // assumed, because narrowing one union while the other silently lost a
  // kind would be a real regression.
  const kinds = [...NOTIFY.matchAll(/^ {2}\| '([a-z_]+)'/gm)].map((m) => m[1]);
  assert.deepEqual(kinds, ['author_submitted', 'admin_submitted'],
    'NewsNotifyKind is not the two kinds routes/news.ts actually fires');
  for (const dead of ['author_in_review', 'author_changes_requested', 'author_approved',
                      'author_published', 'author_rejected']) {
    assert.ok(!NOTIFY.includes(`${dead}:`), `${dead} still has a TITLES entry nothing can reach`);
  }
  const ARTICLE_NOTIFY = raw('cloudflare-worker/src/services/articleNotify.ts');
  const surviving = [...ARTICLE_NOTIFY.matchAll(/^ {2}\| '([a-z_]+)'/gm)].map((m) => m[1]);
  assert.equal(surviving.length, 7,
    'articleNotify no longer carries the seven transitions — the narrowing above lost real behaviour');

  // And every kind the narrowed union still declares must have a caller,
  // which is the rule the five broke.
  const NEWS_ROUTE = raw('cloudflare-worker/src/routes/news.ts');
  for (const k of kinds) {
    assert.ok(NEWS_ROUTE.includes(`notifyNews(c.env, '${k}'`),
      `NewsNotifyKind declares '${k}' and routes/news.ts never fires it`);
  }
});

test("the admin queue alert points at a route the SPA registers — a standalone fix", () => {
  // NOT a consequence of the delete, and the distinction is the point.
  // `admin_submitted` is fired from routes/news.ts, which D166 does not
  // touch, so this link would have gone on 404ing after the retirement:
  // /admin/news is an exact-path <Navigate> with no wildcard, so
  // /admin/news/<id> never matched a route at all.
  const fired = raw('cloudflare-worker/src/routes/news.ts').includes("notifyNews(c.env, 'admin_submitted'");
  assert.ok(fired, 'routes/news.ts no longer fires admin_submitted — re-check what owns this link');

  const branch = NOTIFY.indexOf("if (kind === 'admin_submitted')");
  assert.ok(branch > 0, 'the admin branch is gone');
  const end = NOTIFY.indexOf('return;', branch);
  assert.ok(end > branch, 'the admin branch no longer returns — this slice would overrun');
  const body = NOTIFY.slice(branch, end);
  assert.doesNotMatch(body, /\/admin\/news\/\$\{/, 'the admin alert still deep-links into /admin/news/<id>');

  const link = body.match(/const link = `([^`]+)`/);
  assert.ok(link, 'the admin alert no longer builds a link');
  assert.ok(APP.includes(`path="${link[1]}"`),
    `the admin alert links to ${link[1]}, which App.jsx does not register`);
});
