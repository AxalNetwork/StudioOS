/**
 * D4582 (#4582) — the sign-in and sign-up routes carry their own head, whether
 * the document was loaded directly or reached by a client-side redirect from a
 * protected route (/grow → /login). The direct load is the real prerendered
 * HTML (`scripts/prerender-og.mjs`); the redirect is `applyHeadTags` run on the
 * shell's homepage head. Both are read from the top-level document head.
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
import { applyHeadTags } from '../src/lib/seo.js';
import { ogTagsFor, OG_ROUTES } from '../src/lib/ogRegistry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The shell the build starts from: the homepage's head, with an embedded verification iframe in the body.
const SHELL = `<!doctype html><html><head>
<title>From idea to funded company — Axal VC StudioOS</title>
<meta name="description" content="Home description" />
<link rel="canonical" href="https://axal.vc/" />
<meta property="og:url" content="https://axal.vc/" />
<meta property="og:title" content="From idea to funded company — Axal VC StudioOS" />
</head><body><iframe src="https://challenges.example.invalid/widget"></iframe><div id="root"></div></body></html>`;

/** The tags a head holds, read from the top-level document only (never the iframe). */
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

/** A document just big enough for the head manager: title, head.querySelector, createElement, appendChild, remove. */
function fakeDocument(html) {
  const els = [];
  const make = (tag, attrs = {}) => {
    const el = {
      tag, attrs: { ...attrs },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      remove() { const i = els.indexOf(this); if (i >= 0) els.splice(i, 1); },
    };
    return el;
  };
  const head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html)[1];
  for (const m of head.matchAll(/<(meta|link)\s+([^>]*?)\/?>/gi)) {
    const attrs = {};
    for (const a of m[2].matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    els.push(make(m[1].toLowerCase(), attrs));
  }
  const doc = {
    title: /<title>([\s\S]*?)<\/title>/i.exec(head)[1],
    createElement: (tag) => make(tag),
    head: {
      appendChild(el) { els.push(el); },
      querySelector(sel) {
        const m = /^(meta|link)\[(\w+)="([^"]+)"\]$/.exec(sel);
        return els.find((e) => e.tag === m[1] && e.attrs[m[2]] === m[3]) || null;
      },
    },
  };
  doc.read = () => {
    const get = (attr, key, val = 'content') => els.find((e) => e.attrs[attr] === key)?.attrs[val] ?? null;
    return {
      title: doc.title, description: get('name', 'description'), canonical: get('rel', 'canonical', 'href'), robots: get('name', 'robots'),
      ogUrl: get('property', 'og:url'), ogTitle: get('property', 'og:title'), twitterTitle: get('name', 'twitter:title'),
    };
  };
  return doc;
}

function prerendered() {
  const dir = mkdtempSync(path.join(tmpdir(), 'og4582-'));
  writeFileSync(path.join(dir, 'index.html'), SHELL);
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'prerender-og.mjs'), '--out', dir], { cwd: ROOT, stdio: 'pipe' });
  return dir;
}

test('direct /login and /grow → /login carry the same sign-in head, not the homepage head', () => {
  const dir = prerendered();
  try {
    const direct = readHead(readFileSync(path.join(dir, 'login', 'index.html'), 'utf8'));
    const fromHome = fakeDocument(SHELL); // /grow is protected and carries the homepage head
    assert.equal(fromHome.read().canonical, 'https://axal.vc/');
    applyHeadTags(Object.assign(globalThis, { document: fromHome }).document, ogTagsFor('/login'));
    const redirected = fromHome.read();

    assert.equal(direct.title, 'Sign in — Axal VC StudioOS');
    assert.deepEqual(redirected, direct, 'client navigation and a cold load advertise identical values');
    assert.equal(redirected.canonical, 'https://axal.vc/login');
    assert.equal(redirected.ogUrl, 'https://axal.vc/login');
    assert.notEqual(redirected.title, 'From idea to funded company — Axal VC StudioOS');
    assert.notEqual(redirected.description, 'Home description');
  } finally { rmSync(dir, { recursive: true, force: true }); delete globalThis.document; }
});

test('the registration head is unchanged by the same path, and the homepage is untouched', () => {
  const dir = prerendered();
  try {
    const register = readHead(readFileSync(path.join(dir, 'register', 'index.html'), 'utf8'));
    assert.equal(register.title, 'Create your account — Axal VC StudioOS');
    assert.equal(register.canonical, 'https://axal.vc/register');
    const home = readHead(readFileSync(path.join(dir, 'index.html'), 'utf8'));
    assert.equal(home.canonical, 'https://axal.vc/');
    assert.equal(home.title, ogTagsFor('/').title);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the indexing policy of the auth routes is explicit in the top-level head and matches sitemap and robots.txt', () => {
  const dir = prerendered();
  try {
    const sitemap = readFileSync(path.join(ROOT, 'frontend', 'public', 'sitemap.xml'), 'utf8');
    const robotsTxt = readFileSync(path.join(ROOT, 'frontend', 'public', 'robots.txt'), 'utf8');
    for (const p of ['/login', '/register']) {
      const head = readHead(readFileSync(path.join(dir, p.slice(1), 'index.html'), 'utf8'));
      assert.equal(head.robots, 'index, follow', `${p} states its policy in the top-level head`);
      assert.match(sitemap, new RegExp(`<loc>https://axal\\.vc${p}</loc>`), `${p} is listed in the sitemap, so it must be indexable`);
      assert.doesNotMatch(robotsTxt, new RegExp(`^Disallow:\\s*${p}\\b`, 'm'), `${p} is not blocked by robots.txt`);
    }
    // The iframe's own document is never what is checked: only tags in the top-level <head> count.
    assert.equal(readHead(SHELL.replace('</body>', '<meta name="robots" content="noindex"></body>')).robots, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('every route states a robots policy, and leaving the page restores the head it came from', () => {
  for (const r of OG_ROUTES) assert.match(ogTagsFor(r.path).robots, /^(no)?index, (no)?follow$/, r.path);
  const doc = fakeDocument(SHELL);
  Object.assign(globalThis, { document: doc });
  try {
    const before = doc.read();
    const restore = applyHeadTags(doc, ogTagsFor('/login'));
    assert.notDeepEqual(doc.read(), before);
    restore();
    assert.deepEqual(doc.read(), before, 'the shell\'s own head is back; tags the route created are gone');
  } finally { delete globalThis.document; }
});

test('the Login and Register pages apply their own head on mount, without adding a pageview beacon', () => {
  for (const f of ['LoginPage.jsx', 'RegisterPage.jsx']) {
    const src = readFileSync(path.join(ROOT, 'frontend', 'src', 'pages', f), 'utf8');
    assert.match(src, /import \{ usePageMeta \} from '..\/lib\/seo';/, f);
    assert.match(src, /usePageMeta\(\{ analytics: false \}\);/, f);
  }
});
