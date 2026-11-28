// D6996 (#6996): every indexable page has its own title, description and canonical — the Help Center home and
// its public guides, the trust center's tabs, /pricing/products and the Lab brief included — and the sitemap
// lists only pages that are prerendered, canonical to themselves and not noindex.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SITE_URL, ogTagsFor, prerenderedRoutes } from '../src/lib/ogRegistry.js';
import { SECTIONS, PUBLIC_HELP_ANCHORS } from '../src/pages/docs/sections/index.js';
import { HELP_DESCRIPTION_MAX, HELP_TITLE_SUFFIX, guideDescription, publicHelpRoutes } from '../src/pages/docs/helpMeta.js';
import { TABS } from '../src/pages/site/trustCenterModel.js';
import { helpOgRoutes } from '../../scripts/lib/helpGuides.mjs';
import { programOgRoutes } from '../../scripts/lib/programCatalog.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Run the real prerender, in plain Node, over the source shell in a scratch directory. */
const OUT = mkdtempSync(join(tmpdir(), 'route-meta-6996-'));
cpSync(join(ROOT, 'frontend/index.html'), join(OUT, 'index.html'));
execFileSync(process.execPath, [join(ROOT, 'scripts/prerender-og.mjs'), '--out', OUT], { stdio: 'pipe' });
test.after(() => rmSync(OUT, { recursive: true, force: true }));

const fileFor = (path) => join(OUT, path === '/' ? 'index.html' : `${path.replace(/^\//, '')}/index.html`);
/** What a crawler reads in a route's prerendered head. */
function head(path) {
  const doc = readFileSync(fileFor(path), 'utf8');
  const one = (re) => { const m = re.exec(doc); return m ? decode(m[1]) : null; };
  return {
    title: one(/<title>([^<]*)<\/title>/),
    description: one(/<meta name="description" content="([^"]*)"/),
    canonical: one(/<link rel="canonical" href="([^"]*)"/),
    ogUrl: one(/<meta property="og:url" content="([^"]*)"/),
    robots: one(/<meta name="robots" content="([^"]*)"/),
  };
}

// D9193: an entry marked `prerender: false` (the bare /authors) has no file.
const PRERENDERED = [...new Set([...prerenderedRoutes(), ...(await programOgRoutes()), ...helpOgRoutes()].map((r) => r.path))];
const isNoindex = (h) => /noindex/i.test(h.robots || '');
const INDEXABLE = PRERENDERED.filter((p) => !isNoindex(head(p)));
const HOME = `${SITE_URL}/`;
const SITEMAP = [...read('frontend/public/sitemap.xml').matchAll(/<loc>https:\/\/axal\.vc(\/[^<]*)?<\/loc>/g)].map((m) => m[1] || '/');

test('no two indexable routes share a title, and only / carries the homepage canonical', () => {
  assert.ok(INDEXABLE.length >= 45, `${INDEXABLE.length} indexable prerendered routes`);
  const byTitle = new Map();
  for (const path of INDEXABLE) {
    const h = head(path);
    assert.ok(h.title, `${path} has a title`);
    byTitle.set(h.title, [...(byTitle.get(h.title) || []), path]);
    assert.equal(h.canonical, `${SITE_URL}${path}`, `${path} is canonical to itself`);
    assert.equal(h.ogUrl, h.canonical, `${path} shares its own URL`);
    if (path !== '/') assert.notEqual(h.canonical, HOME, `${path} does not carry the homepage canonical`);
  }
  assert.deepEqual([...byTitle].filter(([, paths]) => paths.length > 1), [], 'no two indexable routes share a title');
  for (const path of ['/help', '/help/account/auth-recovery', '/pricing/products', '/spinout-lab/brief', '/trust/security']) {
    assert.ok(INDEXABLE.includes(path), `${path} is prerendered and indexable`);
  }
  assert.equal(head('/').canonical, HOME, 'the home page keeps its own canonical');
});

test('/help/account/auth-recovery previews as the account recovery guide, in the guide\'s own words', () => {
  const sub = SECTIONS.find((s) => s.id === 'account').subsections.find((s) => s.id === 'auth-recovery');
  const h = head('/help/account/auth-recovery');
  assert.equal(h.title, `Account recovery (lost device)${HELP_TITLE_SUFFIX} — Axal VC StudioOS`);
  assert.ok(h.description.startsWith('If you lose access to your authenticator app'), h.description);
  assert.ok(sub.overview.replace(/\s+/g, ' ').startsWith(h.description), 'the description is the guide\'s own overview');
  assert.notEqual(h.title, head('/').title);
  assert.equal(head('/help').title, 'Help Center — Axal VC StudioOS');
});

test('each public guide gets an entry from the guide index, and a new public guide gets one with no edit', () => {
  const fromIndex = [];
  for (const s of SECTIONS) for (const sub of s.subsections) if (PUBLIC_HELP_ANCHORS.has(`${s.id}/${sub.id}`)) fromIndex.push(`/help/${s.id}/${sub.id}`);
  assert.deepEqual(helpOgRoutes().map((r) => r.path), fromIndex);
  assert.equal(fromIndex.length, PUBLIC_HELP_ANCHORS.size, 'every public anchor names a guide in the index');
  const extra = { id: 'x-area', subsections: [{ id: 'x-guide', title: 'A new guide', overview: 'It does one thing. It says so.' }] };
  const routes = publicHelpRoutes([extra], new Set(['x-area/x-guide']));
  assert.deepEqual(routes, [{ path: '/help/x-area/x-guide', anchor: 'x-area/x-guide', overrides: { title: `A new guide${HELP_TITLE_SUFFIX}`, description: 'It does one thing. It says so.' } }]);
  assert.deepEqual(publicHelpRoutes([extra], new Set()), [], 'a member guide gets no public entry');
});

test('a guide description is whole sentences of its overview, within the limit when they fit', () => {
  assert.equal(guideDescription('One.  Two words.\nThree here.'), 'One. Two words. Three here.');
  const long = `${'a'.repeat(150)}. ${'b'.repeat(80)}.`;
  assert.equal(guideDescription(long), `${'a'.repeat(150)}.`, 'stops before the sentence that overflows');
  const first = `${'c'.repeat(250)}.`;
  assert.equal(guideDescription(first), first, 'never cuts the first sentence');
  assert.equal(guideDescription(''), '');
  for (const r of helpOgRoutes()) {
    const d = r.overrides.description;
    assert.ok(d && /[.!?]$/.test(d), `${r.path} ends on a whole sentence`);
    assert.ok(d.length <= HELP_DESCRIPTION_MAX, `${r.path}: ${d.length} chars`);
  }
});

test('each trust tab has its own title and description, before and after JavaScript', () => {
  const titles = new Set();
  const descriptions = new Set();
  for (const t of TABS) {
    const h = head(t.path);
    assert.equal(h.title, ogTagsFor(t.path).title, t.path);
    titles.add(h.title);
    descriptions.add(h.description);
  }
  assert.equal(titles.size, TABS.length, 'six distinct titles');
  assert.equal(descriptions.size, TABS.length, 'six distinct descriptions');
  // The page used to pass one "Trust center" title and description for every tab, over the registry's.
  const page = read('frontend/src/pages/site/TrustCenter.jsx');
  assert.match(page, /<SitePage path=\{pathname\} signup=\{false\}>/);
  assert.doesNotMatch(page, /<SitePage title=/);
  assert.match(page, /<Frame inShell=\{inShell\} pathname=\{pathname\}>/);
  assert.match(read('frontend/src/components/site/SitePage.jsx'), /usePageMeta\(\{ title, description, path \}\)/);
});

test('/pricing/products is "Products and token packs", not a second "Pricing"', () => {
  assert.equal(head('/pricing/products').title, 'Products and token packs — Axal VC StudioOS');
  assert.notEqual(head('/pricing/products').title, head('/pricing').title);
  assert.notEqual(head('/pricing/products').description, head('/pricing').description);
});

test('the Help Center page writes the same head on a client-side visit', () => {
  const layout = read('frontend/src/pages/docs/DocsLayout.jsx');
  assert.match(layout, /import \{ helpGuideMeta \} from '\.\/helpMeta';/);
  assert.match(layout, /const guideMeta = guideSub \? helpGuideMeta\(guideSection, guideSub\) : null;/);
  assert.match(layout, /robots: route && !guideMeta \? 'noindex' : undefined,/, 'an address with no readable guide names none');
  // The guide index loads in plain Node: the prerender and the validator read it.
  assert.doesNotMatch(read('frontend/src/pages/docs/sections/index.js'), /^import \w+ from '\.\/[a-z-]+';$/m);
});

test('the sitemap lists only prerendered, self-canonical, indexable routes; no noindex route is in it (D4582)', () => {
  assert.equal(new Set(SITEMAP).size, SITEMAP.length, 'no URL twice');
  for (const path of SITEMAP) {
    assert.ok(existsSync(fileFor(path)) && PRERENDERED.includes(path), `${path} is prerendered`);
    const h = head(path);
    assert.ok(!isNoindex(h), `${path} is not noindex`);
    assert.equal(h.canonical, `${SITE_URL}${path}`, `${path} is canonical to itself`);
  }
  for (const path of PRERENDERED.filter((p) => isNoindex(head(p)))) {
    assert.ok(!SITEMAP.includes(path), `${path} is noindex and absent from the sitemap`);
  }
  assert.ok(PRERENDERED.some((p) => isNoindex(head(p))), 'at least one noindex route is checked (/login)');
  for (const path of ['/help', '/pricing/products', '/trust/security', '/help/account/auth-recovery']) assert.ok(SITEMAP.includes(path), path);
});
