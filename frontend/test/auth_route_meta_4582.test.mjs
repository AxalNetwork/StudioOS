/**
 * D4582 (#4582) — a protected Grow route that redirects to sign-in no longer leaves the homepage's title, canonical and
 * social URL in the head. /login is noindex, follow, carried by the prerender, the client head and an X-Robots-Tag.
 * A cold load and a client apply of the same tags agree, and only the top-level <head> is read.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/auth_route_meta_4582.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyHeadTags, applyPageMeta } from '../src/lib/seo.js';
import { ogTagsFor, OG_ROUTES } from '../src/lib/ogRegistry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const homeTags = ogTagsFor('/');

/** The tags a head holds, read from the top-level document only (never an iframe). */
function readHead(html) {
  const head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html)[1];
  const meta = (attr, key) => new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]*)"`, 'i').exec(head)?.[1] ?? null;
  return {
    title: /<title>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? null,
    description: meta('name', 'description'),
    canonical: /<link\s+rel="canonical"\s+href="([^"]*)"/i.exec(head)?.[1] ?? null,
    robots: meta('name', 'robots'),
    ogUrl: meta('property', 'og:url'),
    ogTitle: meta('property', 'og:title'),
    twitterTitle: meta('name', 'twitter:title'),
  };
}

/** A document with a head you can query by the selectors seo.js uses. */
function fakeDocument(seed) {
  const nodes = [];
  const make = (tag, attrs = {}) => {
    const el = {
      tag, attrs: { ...attrs },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      remove() { const i = nodes.indexOf(this); if (i >= 0) nodes.splice(i, 1); },
    };
    return el;
  };
  const match = (el, selector) => {
    const m = selector.match(/^(meta|link)\[(name|property|rel)="([^"]+)"\]$/);
    return m && el.tag === m[1] && el.attrs[m[2]] === m[3];
  };
  const doc = {
    title: seed.title,
    head: {
      querySelector: (sel) => nodes.find((n) => match(n, sel)) || null,
      appendChild: (el) => { nodes.push(el); return el; },
    },
    createElement: (tag) => make(tag, {}),
    value(sel) { const n = nodes.find((x) => match(x, sel)); return n ? n.getAttribute(n.tag === 'link' ? 'href' : 'content') : null; },
  };
  for (const [sel, v] of Object.entries(seed.tags || {})) {
    const m = sel.match(/^(meta|link)\[(name|property|rel)="([^"]+)"\]$/);
    nodes.push(make(m[1], { [m[2]]: m[3], [m[1] === 'link' ? 'href' : 'content']: v }));
  }
  return doc;
}

const homeSeed = () => ({
  title: homeTags.title,
  tags: {
    'meta[name="description"]': homeTags.description,
    'meta[property="og:title"]': homeTags.title,
    'meta[property="og:url"]': homeTags.url,
    'meta[property="og:description"]': homeTags.description,
    'link[rel="canonical"]': homeTags.url,
  },
});

// The shell the build starts from: the homepage's head, with an embedded verification iframe in the body.
const SHELL = `<!doctype html><html><head>
<title>${homeTags.title}</title>
<meta name="description" content="Home description" />
<link rel="canonical" href="https://axal.vc/" />
<meta property="og:url" content="https://axal.vc/" />
<meta property="og:title" content="${homeTags.title}" />
</head><body><iframe src="https://challenges.example.invalid/widget"></iframe><div id="root"></div></body></html>`;

function prerendered() {
  const dir = mkdtempSync(path.join(tmpdir(), 'og4582-'));
  writeFileSync(path.join(dir, 'index.html'), SHELL);
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'prerender-og.mjs'), '--out', dir], { cwd: ROOT, stdio: 'pipe' });
  return dir;
}

test('the registry gives /login its own title, canonical, social URL and a noindex; /register and home are as they were', () => {
  const login = ogTagsFor('/login');
  assert.match(login.title, /^Sign in/);
  assert.equal(login.url, 'https://axal.vc/login');
  assert.equal(login.robots, 'noindex, follow');
  assert.notEqual(login.title, homeTags.title);
  assert.equal(ogTagsFor('/register').robots, null, 'registration stays indexable');
  assert.equal(ogTagsFor('/register').url, 'https://axal.vc/register');
  assert.equal(homeTags.robots, null);
  assert.equal(homeTags.url, 'https://axal.vc/');
});

test('arriving at /login by client navigation replaces the homepage head, and leaving puts it back', () => {
  globalThis.document = fakeDocument(homeSeed());
  try {
    const doc = globalThis.document;
    const restore = applyPageMeta(ogTagsFor('/login'));
    assert.match(doc.title, /^Sign in/);
    assert.equal(doc.value('link[rel="canonical"]'), 'https://axal.vc/login');
    assert.equal(doc.value('meta[property="og:url"]'), 'https://axal.vc/login');
    assert.equal(doc.value('meta[property="og:title"]'), ogTagsFor('/login').title);
    assert.equal(doc.value('meta[name="description"]'), 'Sign in to Axal VC StudioOS.');
    assert.equal(doc.value('meta[name="robots"]'), 'noindex, follow');
    restore();
    assert.equal(doc.title, homeTags.title);
    assert.equal(doc.value('link[rel="canonical"]'), homeTags.url);
    assert.equal(doc.value('meta[property="og:url"]'), homeTags.url);
    assert.equal(doc.value('meta[name="robots"]'), null, 'the noindex it added goes with it');
  } finally { delete globalThis.document; }
});

test('a shell with no canonical gets one, and registration carries no robots directive', () => {
  const seed = homeSeed(); delete seed.tags['link[rel="canonical"]'];
  globalThis.document = fakeDocument(seed);
  try {
    const doc = globalThis.document;
    const restore = applyPageMeta(ogTagsFor('/register'));
    assert.equal(doc.value('link[rel="canonical"]'), 'https://axal.vc/register');
    assert.equal(doc.value('meta[name="robots"]'), null);
    restore();
    assert.equal(doc.value('link[rel="canonical"]'), null);
  } finally { delete globalThis.document; }
});

test('the prerender writes /login with its robots tag, and no other route gets one', () => {
  const src = read('scripts/prerender-og.mjs');
  assert.match(src, /tags\.robots \? \[`<meta name="robots"/, 'emitted only when the route has a directive');
  assert.ok(src.includes("name=[\"']robots[\"']"), 'a shell\'s own robots tag is stripped first, so a re-run converges');
});

test('the header policy is on the static shell and the live smoke names it', () => {
  const headers = read('frontend/public/_headers');
  assert.match(headers, /^\/login\n  X-Robots-Tag: noindex, follow$/m, 'a path rule, not the /* block that every route gets');
  assert.doesNotMatch(headers.split('/login')[0].split('/*')[1] || '', /X-Robots-Tag/, 'not sitewide');
  assert.match(read('scripts/check-spa-live.mjs'), /x-robots-tag/i, 'the post-deploy smoke reads it');
});

test('the sign-in and registration screen applies its head on arrival, without a pageview beacon', () => {
  const app = read('frontend/src/App.jsx');
  const screen = app.slice(app.indexOf('function AuthScreen'), app.indexOf('function AppInner'));
  assert.match(screen, /usePageMeta\(\{ path: useLocation\(\)\.pathname, analytics: false \}\);/);
  assert.match(app, /import \{ usePageMeta \} from '\.\/lib\/seo';/);
  for (const f of ['LoginPage.jsx', 'RegisterPage.jsx']) {
    assert.doesNotMatch(read(`frontend/src/pages/${f}`), /usePageMeta\(/, `${f} does not apply the head a second time`);
  }
});

test('direct /login and /grow → /login carry the same sign-in head, not the homepage head', () => {
  const dir = prerendered();
  try {
    const direct = readHead(readFileSync(path.join(dir, 'login', 'index.html'), 'utf8'));
    const fromHome = fakeDocument({
      title: homeTags.title,
      tags: {
        'meta[name="description"]': 'Home description',
        'link[rel="canonical"]': 'https://axal.vc/',
        'meta[property="og:url"]': 'https://axal.vc/',
        'meta[property="og:title"]': homeTags.title,
      },
    });
    assert.equal(fromHome.value('link[rel="canonical"]'), 'https://axal.vc/');
    applyHeadTags(fromHome, ogTagsFor('/login'));
    const redirected = {
      title: fromHome.title,
      description: fromHome.value('meta[name="description"]'),
      canonical: fromHome.value('link[rel="canonical"]'),
      robots: fromHome.value('meta[name="robots"]'),
      ogUrl: fromHome.value('meta[property="og:url"]'),
      ogTitle: fromHome.value('meta[property="og:title"]'),
      twitterTitle: fromHome.value('meta[name="twitter:title"]'),
    };
    assert.equal(direct.title, 'Sign in — Axal VC StudioOS');
    assert.equal(direct.robots, 'noindex, follow');
    assert.deepEqual(redirected, direct, 'client navigation and a cold load advertise identical values');
    assert.equal(redirected.canonical, 'https://axal.vc/login');
    assert.equal(redirected.ogUrl, 'https://axal.vc/login');
    assert.notEqual(redirected.title, homeTags.title);
    assert.notEqual(redirected.description, 'Home description');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the registration head is unchanged by the same path, and the homepage is untouched', () => {
  const dir = prerendered();
  try {
    const register = readHead(readFileSync(path.join(dir, 'register', 'index.html'), 'utf8'));
    assert.equal(register.title, 'Create your account — Axal VC StudioOS');
    assert.equal(register.canonical, 'https://axal.vc/register');
    assert.equal(register.robots, null, 'registration carries no robots directive');
    const home = readHead(readFileSync(path.join(dir, 'index.html'), 'utf8'));
    assert.equal(home.canonical, 'https://axal.vc/');
    assert.equal(home.title, ogTagsFor('/').title);
    assert.equal(home.robots, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the indexing policy is in the top-level head: /login is noindex, both paths stay in the sitemap, and an iframe is not read', () => {
  const dir = prerendered();
  try {
    const sitemap = read('frontend/public/sitemap.xml');
    const robotsTxt = read('frontend/public/robots.txt');
    for (const p of ['/login', '/register']) {
      assert.match(sitemap, new RegExp(`<loc>https://axal\\.vc${p}</loc>`), `${p} stays listed in the sitemap`);
      assert.doesNotMatch(robotsTxt, new RegExp(`^Disallow:\\s*${p}\\b`, 'm'), `${p} is not blocked by robots.txt`);
    }
    assert.equal(readHead(readFileSync(path.join(dir, 'login', 'index.html'), 'utf8')).robots, 'noindex, follow');
    assert.equal(readHead(readFileSync(path.join(dir, 'register', 'index.html'), 'utf8')).robots, null);
    // The iframe's own document is never what is checked: only tags in the top-level <head> count.
    assert.equal(readHead(SHELL.replace('</body>', '<meta name="robots" content="noindex"></body>')).robots, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('only a route that declares a robots directive has one, and leaving the page restores the head it came from', () => {
  for (const r of OG_ROUTES) {
    const robots = ogTagsFor(r.path).robots;
    assert.ok(robots === null || /^(no)?index, (no)?follow$/.test(robots), r.path);
  }
  assert.equal(OG_ROUTES.filter((r) => ogTagsFor(r.path).robots).map((r) => r.path).join(','), '/login');
  const doc = fakeDocument(homeSeed());
  const before = {
    title: doc.title,
    canonical: doc.value('link[rel="canonical"]'),
    robots: doc.value('meta[name="robots"]'),
    ogUrl: doc.value('meta[property="og:url"]'),
  };
  const restore = applyHeadTags(doc, ogTagsFor('/login'));
  assert.equal(doc.value('meta[name="robots"]'), 'noindex, follow');
  restore();
  assert.deepEqual({
    title: doc.title,
    canonical: doc.value('link[rel="canonical"]'),
    robots: doc.value('meta[name="robots"]'),
    ogUrl: doc.value('meta[property="og:url"]'),
  }, before, 'the shell\'s own head is back; tags the route created are gone');
});
