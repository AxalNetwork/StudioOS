/**
 * D4582 — a protected Grow route that redirects to sign-in no longer leaves the homepage's title, canonical and
 * social URL in the head, and the indexing policy for /login is written down and checked three ways.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ogTagsFor } from '../src/lib/ogRegistry.js';
import { applyPageMeta } from '../src/lib/seo.js';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

/** A document with a head you can query by the selectors seo.js uses, seeded with the homepage's tags. */
function fakeDocument(seed) {
  const nodes = [];
  const make = (tag, attrs) => {
    const el = { tag, attrs: { ...attrs }, removed: false,
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      remove() { this.removed = true; const i = nodes.indexOf(this); if (i >= 0) nodes.splice(i, 1); } };
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
  for (const [sel, v] of Object.entries(seed.tags)) {
    const m = sel.match(/^(meta|link)\[(name|property|rel)="([^"]+)"\]$/);
    nodes.push(make(m[1], { [m[2]]: m[3], [m[1] === 'link' ? 'href' : 'content']: v }));
  }
  return doc;
}

const homeTags = ogTagsFor('/');
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
});
