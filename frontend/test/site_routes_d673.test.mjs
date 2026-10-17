/**
 * D673 (#1546) — every page the owner's website canvas links is routed to the
 * page built for it, and the shell links every one of them.
 *
 * The page tasks (D675–D680) each built their pages without touching App.jsx;
 * S1 wired the routes. This pins that wiring:
 *   - each path renders the component built for it (not the page it replaced);
 *   - /team is the team page, no longer a redirect to /about;
 *   - the four doors render DoorPage, and ProductAudiencePage is gone;
 *   - the nav, the burger menu and the footer offer every canvas page;
 *   - each new public path is in the auth bounce's allowlist, the OG registry
 *     and the sitemap, so a logged-out visitor, a link preview and a crawler
 *     all reach it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const APP = read('frontend/src/App.jsx');
const route = (path) => {
  const m = [...APP.matchAll(/<Route\s+path="([^"]*)"\s+element=\{([^\n]+?)\}\s*\/>/g)].find((r) => r[1] === path);
  return m ? m[2] : null;
};

const PAGES = {
  '/about': '<FirmPage />',
  '/team': '<TeamPage />',
  '/platform': '<PlatformPage />',
  '/administrators': '<AdministratorsPage />',
  '/methodology': '<MethodologyPage />',
  '/intelligence': '<IntelligencePage />',
  '/resources': '<ResourcesPage />',
  '/for-founders': '<DoorPage door="founders" />',
  '/for-investors': '<DoorPage door="investors" />',
  '/for-service-partners': '<DoorPage door="partners" />',
  '/for-advisors': '<DoorPage door="advisors" />',
};

test('each canvas page is routed to the page built for it', () => {
  for (const [path, element] of Object.entries(PAGES)) {
    assert.equal(route(path), element, `${path} must render ${element}`);
  }
  assert.doesNotMatch(APP, /<Route\s+path="\/team"\s+element=\{<Navigate/, '/team is a page now, not a redirect to /about');
  assert.doesNotMatch(APP, /ProductAudiencePage/, 'the doors render DoorPage; the old component is gone');
  assert.ok(!existsSync(resolve(ROOT, 'frontend/src/pages/ProductAudiencePage.jsx')));
});

test('the shell links every page the canvas nav and footer link', async () => {
  const { NETWORK_LINKS, BUILD_LINKS, DOOR_LINKS } = await import('../src/lib/siteLinks.js');
  const paths = (list) => list.map((l) => l.to);
  assert.deepEqual(paths(DOOR_LINKS), ['/for-founders', '/for-investors', '/for-service-partners', '/for-advisors']);
  assert.deepEqual(paths(NETWORK_LINKS), ['/resources', '/articles', '/directory', '/events', '/circles', '/jobs']);
  assert.deepEqual(paths(BUILD_LINKS), ['/about', '/spinout-lab', '/intelligence', '/methodology', '/administrators']);
});

test('each new public path is reachable logged-out, previewable and in the sitemap', () => {
  const api = read('frontend/src/lib/api.js');
  const og = read('frontend/src/lib/ogRegistry.js');
  const sitemap = read('frontend/public/sitemap.xml');
  for (const path of ['/team', '/platform', '/administrators', '/methodology', '/intelligence', '/resources']) {
    assert.match(api, new RegExp(`currentPath === '${path}'`), `${path} must not bounce a logged-out visitor to /login`);
    assert.match(og, new RegExp(`path: '${path}',`), `${path} needs its link-preview entry`);
    assert.match(sitemap, new RegExp(`<loc>https://axal.vc${path}</loc>`), `${path} belongs in the sitemap`);
  }
});
