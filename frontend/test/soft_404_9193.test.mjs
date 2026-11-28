// D9193 (#9193): a URL that matches no page does not look like a real page. The SPA fallback answers an unknown
// path with the home page's HTML, so the catch-all NotFoundPage sets a not-found title and `noindex` and takes the
// home canonical out of the head while it is shown, and puts the head back when it goes. And no registry prefix is
// prerendered at a path the app has no route for (the bare /authors was: 'Authors' over a 404).
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/soft_404_9193.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { OG_ROUTES, SITE_NAME, ogTagsFor, prerenderedRoutes } from '../src/lib/ogRegistry.js';

const h = React.createElement;
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const UNKNOWN = '/this-page-does-not-exist-zz';
const HOME = ogTagsFor('/');

/** The whole App, mounted at `route` for a signed-out visitor under the home page's head: what the head held. */
async function appAt(route) {
  register(new URL('./_airailRender-hook.mjs', import.meta.url));
  const { installAppDom, select } = await import('./_appDom.mjs');
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const dom = installAppDom({ fetch: async (input) => (/\/api\/auth\/me(\?|$)/.test(String(input?.url || input)) ? json({ detail: 'Not authenticated' }, 401) : json({})) });
  const doc = dom.document;
  // The head the SPA fallback serves: the prerendered home page's.
  doc.title = HOME.title;
  const canonical = doc.createElement('link');
  canonical.setAttribute('rel', 'canonical'); canonical.setAttribute('href', HOME.url);
  doc.head.appendChild(canonical);
  const App = (await import('../src/App.jsx')).default;
  localStorage.clear(); sessionStorage.clear();
  const host = doc.createElement('div'); doc.body.appendChild(host);
  const root = createRoot(host);
  const headNow = () => ({
    title: doc.title,
    robots: select(doc.head, 'meta[name="robots"]').map((n) => n.getAttribute('content')),
    canonicals: select(doc.head, 'link[rel="canonical"]').map((n) => n.getAttribute('href')),
  });
  const { error, warn } = console; console.error = () => {}; console.warn = () => {};
  let shown; let left;
  try {
    await act(async () => { root.render(h(MemoryRouter, { initialEntries: [route] }, h(App))); });
    // The lazy route chunk loads on its own time. Give the app at least one short tick to settle its head, then
    // poll for the heading until a real deadline (D5614: a bounded poll, not a fixed sleep). Checking before that
    // first tick let the 404 unmount before the head had settled under CI load.
    const deadline = performance.now() + 15000;
    do {
      await act(() => new Promise((r) => setImmediate(() => setTimeout(r, 5))));
    } while (!select(doc, 'h1').length && performance.now() < deadline);
    assert.ok(select(doc, 'h1').length, `a heading at ${route} within 15 s`);
    shown = { ...headNow(), h1s: select(doc, 'h1').map((n) => n.textContent.trim()) };
  } finally {
    await act(async () => root.unmount());
    left = headNow();
    host.remove(); dom.timers.clear(); dom.restore?.();
    console.error = error; console.warn = warn;
  }
  return { shown, left };
}

test('an unknown URL renders Page not found with its own title, noindex and no home canonical, and leaving restores the head', async () => {
  const { shown, left } = await appAt(UNKNOWN);
  assert.deepEqual(shown.h1s, ['Page not found'], 'the catch-all route drew the 404');
  assert.equal(shown.title, `Page not found — ${SITE_NAME}`);
  assert.notEqual(shown.title, HOME.title, 'the home title is gone');
  assert.deepEqual(shown.robots, ['noindex']);
  assert.deepEqual(shown.canonicals, [], 'no canonical while the 404 is shown');
  assert.equal(left.title, HOME.title, 'unmounting puts the home title back');
  assert.deepEqual(left.canonicals, [HOME.url], 'and the shell\'s canonical, once');
  assert.deepEqual(left.robots, [], 'and drops the noindex it added');
});

/** Every `<Route path="…">` the app declares: App.jsx and the route areas its glob collects. */
function appRoutePaths() {
  const files = ['frontend/src/App.jsx', ...readdirSync(join(ROOT, 'frontend/src/routes')).filter((f) => f.endsWith('.jsx')).map((f) => `frontend/src/routes/${f}`)];
  return new Set(files.flatMap((f) => [...read(f).matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1])));
}

test('no registry prefix is prerendered at a path the app has no route for', () => {
  const routes = appRoutePaths();
  assert.ok(routes.has('/authors/:userId') && routes.has('/articles'), 'the route table was read');
  const prerendered = new Set(prerenderedRoutes().map((r) => r.path));
  const prefixes = OG_ROUTES.filter((r) => r.prefix);
  assert.ok(prefixes.length >= 5, `${prefixes.length} prefix entries`);
  const orphans = prefixes.filter((r) => prerendered.has(r.path) && !routes.has(r.path)).map((r) => r.path);
  assert.deepEqual(orphans, [], 'a prefix prerendered with no route of its own answers its title over a 404');
  // The bare /authors keeps lending its tags to each author's page, and is not prerendered itself.
  assert.equal(prerendered.has('/authors'), false);
  assert.equal(ogTagsFor('/authors/someone').image, ogTagsFor('/authors').image);
});

test('the prerender writes no /authors/index.html, and still writes the prefixes that are pages', () => {
  const out = mkdtempSync(join(tmpdir(), 'soft-404-9193-'));
  try {
    cpSync(join(ROOT, 'frontend/index.html'), join(out, 'index.html'));
    execFileSync(process.execPath, [join(ROOT, 'scripts/prerender-og.mjs'), '--out', out], { stdio: 'pipe' });
    assert.equal(existsSync(join(out, 'authors/index.html')), false);
    assert.equal(existsSync(join(out, 'articles/index.html')), true);
  } finally { rmSync(out, { recursive: true, force: true }); }
});
