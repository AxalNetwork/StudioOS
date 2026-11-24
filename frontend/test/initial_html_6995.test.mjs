// D6995 (#6995): each indexable page ships its own heading, offer and links in its HTML before JavaScript runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { OG_ROUTES, staticBodyFor } from '../src/lib/ogRegistry.js';
import { HOME_HEADLINE, HOME_HEADLINE_TEXT, HOME_OFFER, HOME_PRIMARY } from '../src/lib/siteHome.js';
import { DOORS } from '../src/lib/siteDoors.js';
import { HERO } from '../src/lib/sitePricing.js';
import { CIRCLES_COPY, EVENTS_COPY, JOBS_COPY } from '../src/lib/siteNetwork2.js';
import { INDEX_LEDE, INDEX_TITLE } from '../src/pages/programs/ProgramsIndexPage.jsx';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const squash = (s) => s.replace(/\s+/g, ' ');
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Run the real prerender, in plain Node, over the source shell in a scratch directory. */
function prerender() {
  const out = mkdtempSync(join(tmpdir(), 'initial-html-6995-'));
  cpSync(join(ROOT, 'frontend/index.html'), join(out, 'index.html'));
  execFileSync(process.execPath, [join(ROOT, 'scripts/prerender-og.mjs'), '--out', out], { stdio: 'pipe' });
  return out;
}
const OUT = prerender();
test.after(() => rmSync(OUT, { recursive: true, force: true }));
const fileFor = (path) => join(OUT, path === '/' ? 'index.html' : `${path.replace(/^\//, '')}/index.html`);
const html = (path) => readFileSync(fileFor(path), 'utf8');

/** The block inside #root, between the static-body markers. */
function block(doc) {
  const m = /<div id="root">([\s\S]*?)<\/div>\s*<script/.exec(doc);
  assert.ok(m, 'the page has a #root element');
  const inner = /<!-- BEGIN static-body -->([\s\S]*?)<!-- END static-body -->/.exec(m[1]);
  assert.ok(inner, 'the static body sits inside #root');
  return inner[1];
}
const h1Of = (b) => [...b.matchAll(/<h1[^>]*>([^<]*)<\/h1>/g)].map((m) => decode(m[1]));
const internalLinks = (b) => [...b.matchAll(/<a href="(\/[^"]*)"/g)].map((m) => decode(m[1]));

/** Indexable: in the registry, in the sitemap, and not marked noindex. */
const SITEMAP = new Set([...read('frontend/public/sitemap.xml').matchAll(/<loc>https:\/\/axal\.vc(\/[^<]*)?<\/loc>/g)].map((m) => m[1] || '/'));
const INDEXABLE = OG_ROUTES.filter((r) => SITEMAP.has(r.path) && !/noindex/.test(r.robots || ''));

test('every indexable registry route ships its own h1 and at least five internal links before JavaScript', () => {
  assert.ok(INDEXABLE.length >= 25, `the sitemap and the registry share ${INDEXABLE.length} routes`);
  const seen = new Map();
  for (const r of INDEXABLE) {
    const b = block(html(r.path));
    const h1s = h1Of(b);
    assert.deepEqual(h1s, [staticBodyFor(r.path).heading], `${r.path} has exactly its own h1`);
    assert.notEqual(h1s[0], 'Axal VC', `${r.path} is not the shared fallback heading`);
    const links = internalLinks(b);
    assert.ok(links.length >= 5, `${r.path} has ${links.length} internal links`);
    for (const to of ['/for-founders', '/for-investors', '/for-service-partners', '/for-advisors', '/pricing']) {
      assert.ok(links.includes(to), `${r.path}'s header links ${to}`);
    }
    seen.set(h1s[0], [...(seen.get(h1s[0]) || []), r.path]);
  }
  const shared = [...seen].filter(([, paths]) => paths.length > 1);
  assert.deepEqual(shared, [], 'no two indexable pages share a heading');
});

test('with JavaScript off, / reads its headline, its offer and links to /for-founders; /for-founders reads its own', () => {
  const home = block(html('/'));
  assert.deepEqual(h1Of(home), [HOME_HEADLINE_TEXT]);
  assert.equal(HOME_HEADLINE_TEXT, 'Where we build the rails for the next generation of ventures');
  assert.ok(squash(decode(home)).includes(HOME_OFFER), 'the home offer');
  assert.ok(internalLinks(home).includes('/for-founders'));
  assert.ok(internalLinks(home).includes(HOME_PRIMARY.to));

  const founders = block(html('/for-founders'));
  assert.deepEqual(h1Of(founders), [DOORS.founders.h1]);
  assert.ok(decode(founders).includes(DOORS.founders.who), 'the founders offer');
  assert.ok(internalLinks(founders).includes(DOORS.founders.primary.to), 'the founders primary action');
});

test('the home page and the static block read one headline constant', () => {
  const page = squash(read('frontend/src/pages/LandingPage.jsx'));
  assert.match(page, /import \{ HOME_HEADLINE, HOME_OFFER, HOME_PRIMARY \} from '\.\.\/lib\/siteHome'/);
  assert.ok(page.includes('{HOME_HEADLINE.lead}<em>{HOME_HEADLINE.em}</em>{HOME_HEADLINE.tail}'), 'the hero draws the constant');
  assert.ok(page.includes('<p className="ax-hero-copy">{HOME_OFFER}</p>'));
  assert.ok(!page.includes('Where we <em>build</em> the rails'), 'no second copy of the headline in the page');
  assert.equal(HOME_HEADLINE.em, 'build');
  const reg = read('frontend/src/lib/ogRegistry.js');
  assert.match(reg, /import \{ HOME_HEADLINE_TEXT, HOME_OFFER, HOME_PRIMARY \} from '\.\/siteHome\.js'/);
  assert.match(reg, /import \{ DOORS \} from '\.\/siteDoors\.js'/);
});

test('each door page heading, offer and action come from the page\'s own constant', () => {
  for (const [path, key] of [['/for-founders', 'founders'], ['/for-investors', 'investors'], ['/for-service-partners', 'partners'], ['/for-advisors', 'advisors']]) {
    const body = staticBodyFor(path);
    assert.equal(body.heading, DOORS[key].h1, path);
    assert.equal(body.summary, DOORS[key].who, path);
    assert.deepEqual(body.primaryLink, { label: DOORS[key].primary.t, to: DOORS[key].primary.to }, path);
  }
});

test('inlined page words match the page constants that plain Node cannot load', () => {
  // sitePricing.js and siteNetwork2.js import without a `.js` specifier, and ProgramsIndexPage is a React page,
  // so the registry holds a copy; this test holds the copy to the source.
  assert.deepEqual([staticBodyFor('/pricing').heading, staticBodyFor('/pricing').summary], [HERO.title, HERO.line]);
  for (const [path, copy] of [['/jobs', JOBS_COPY], ['/events', EVENTS_COPY], ['/circles', CIRCLES_COPY]]) {
    assert.deepEqual([staticBodyFor(path).heading, staticBodyFor(path).summary], [copy.title, copy.lede], path);
  }
  assert.deepEqual([staticBodyFor('/programs').heading, staticBodyFor('/programs').summary], [INDEX_TITLE, INDEX_LEDE]);
});

test('every other written heading and offer is the page\'s own text', () => {
  const PAGES = {
    '/demo': 'frontend/src/pages/DemoPage.jsx', '/about': 'frontend/src/pages/site/FirmPage.jsx',
    '/team': 'frontend/src/pages/TeamPage.jsx', '/methodology': 'frontend/src/pages/site/MethodologyPage.jsx',
    '/platform': 'frontend/src/pages/site/PlatformPage.jsx', '/administrators': 'frontend/src/pages/site/AdministratorsPage.jsx',
    '/intelligence': 'frontend/src/pages/site/IntelligencePage.jsx', '/contact': 'frontend/src/pages/ContactPage.jsx',
    '/newsletter': 'frontend/src/pages/site/NewsletterPage.jsx', '/articles': 'frontend/src/pages/ArticlesPage.jsx',
    '/directory': 'frontend/src/pages/PublicDirectoryPage.jsx', '/resources': 'frontend/src/pages/site/ResourcesPage.jsx',
    '/changelog': 'frontend/src/pages/ChangelogPage.jsx', '/status': 'frontend/src/pages/StatusPage.jsx',
  };
  for (const [path, file] of Object.entries(PAGES)) {
    const src = squash(read(file));
    const body = staticBodyFor(path);
    assert.ok(src.includes(body.heading), `${path}: the heading is in ${file}`);
    assert.ok(src.includes(body.summary), `${path}: the offer is in ${file}`);
    const entry = OG_ROUTES.find((r) => r.path === path);
    if (entry.primaryLink) assert.ok(src.includes(entry.primaryLink.label), `${path}: the action is in ${file}`);
  }
  // #6994 retired the Spin-Out Demo Day page: its address forwards to /events and has no social card or words.
  assert.equal(OG_ROUTES.find((r) => r.path === '/lp/spinout-demo-day'), undefined);
});

test('a route with no words of its own falls back to its title and description, never another page\'s', () => {
  const terms = OG_ROUTES.find((r) => r.path === '/terms');
  assert.equal(terms.heading, undefined);
  assert.deepEqual(staticBodyFor('/terms'), { heading: terms.title, summary: terms.description, primaryLink: { label: 'Join Axal VC', to: '/register' } });
  assert.equal(staticBodyFor('/programs/wellness', { title: 'A program', description: 'Its line.' }).heading, 'A program');
});

test('the block replaces the shell\'s fallback once, and a second run changes nothing', () => {
  const doc = html('/about');
  assert.equal(doc.match(/<!-- BEGIN static-body -->/g).length, 1);
  assert.equal(doc.match(/data-static-body/g).length, 1, 'replaced, not appended');
  assert.ok(!doc.includes('>Axal VC</h1>'), 'the shared fallback heading is gone');
  assert.ok(!/<h1[^>]*>[\s\S]*<h1/.test(block(doc)), 'one h1');
  const before = html('/');
  execFileSync(process.execPath, [join(ROOT, 'scripts/prerender-og.mjs'), '--out', OUT], { stdio: 'pipe' });
  assert.equal(html('/'), before, 'idempotent');
  execFileSync(process.execPath, [join(ROOT, 'scripts/prerender-og.mjs'), '--out', OUT, '--check'], { stdio: 'pipe' });
});

test('text is escaped and React still mounts into #root', () => {
  const doc = html('/newsletter');
  assert.ok(!/<h1[^>]*>[^<]*&[^a#][^<]*<\/h1>/.test(doc), 'no raw ampersand in a heading');
  assert.ok(html('/events').includes('Programs &amp; Events</h1>'));
  assert.match(read('frontend/src/main.jsx'), /ReactDOM\.createRoot\(document\.getElementById\('root'\)\)\.render\(/);
});
