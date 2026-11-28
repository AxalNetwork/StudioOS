/**
 * #9196 — three automated-accessibility failures on public pages.
 *
 *   1. Door accent contrast (/for-*): every door's `accentText` reaches 4.5:1
 *      (WCAG AA) against each background its words sit on, and under the white
 *      words of its coloured pills and buttons; doors.css colours no words with
 *      the light `--door-accent`. The site is light only (`SitePage` forces the
 *      light theme), so dark mode draws the same pairs: the test checks that the
 *      door page is framed that way and runs the same pairs for it.
 *   2. /team: the photo's LinkedIn link has a name when there is no photo, the
 *      member is unread, or the photo fails.
 *   3. /trust: each wide table's scroller is focusable and a named region.
 *
 * The logo link (UXP-14) is #9156's (#9037), not this file's.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/public_a11y_9196.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { register } from 'node:module';
import { installDocument } from './_contracts_dom.mjs';

// TeamPage reads `import.meta.env` at load; this hook gives it one (as account_regressions_4618).
register(new URL('./_airailRender-hook.mjs', import.meta.url));

const { DOORS, DOOR_ORDER } = await import('../src/lib/siteDoors.js');
const { default: DoorPage } = await import('../src/pages/site/DoorPage.jsx');
const { default: TeamPage } = await import('../src/pages/TeamPage.jsx');
const { default: TrustCenter } = await import('../src/pages/site/TrustCenter.jsx');

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/* ------------------------------------------------------------------ *
 * 1. Door accents
 * ------------------------------------------------------------------ */

function luminance(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  assert.ok(m, `${hex} is a #rrggbb colour`);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const CSS = noComments(read('frontend/src/pages/site/doors.css'));
const SITE_CSS = noComments(read('frontend/src/components/site/site.css'));
/** The plans band's wash, read from doors.css so a change there is checked too. */
const PLANS_BG = /\.ax-door-plans\s*\{[^}]*background:\s*(#[0-9a-f]{6})/i.exec(CSS)?.[1];
const PAGE_BG = /\.ax-site\s*\{[^}]*background:\s*(#[0-9a-f]{6}|#fff)\b/i.exec(SITE_CSS)?.[1];
const hex6 = (c) => (c === '#fff' ? '#ffffff' : c);

test('contrast() is WCAG\'s: black on white is 21:1, and the canvas accents the issue measured fail', () => {
  assert.equal(contrast('#000000', '#ffffff').toFixed(1), '21.0');
  assert.equal(contrast('#ffffff', '#ffffff'), 1);
  assert.ok(contrast('#059669', '#ffffff') < 4.5, 'emerald-600 on white is about 3.8:1');
  assert.ok(contrast('#d97706', '#ffffff') < 4.5, 'amber-600 on white is about 3.2:1');
});

test('the door page is light in both themes, so dark mode draws the same colour pairs', () => {
  assert.match(read('frontend/src/components/site/SitePage.jsx'), /\n\s*useForcedLightTheme\(\);/, 'SitePage forces the light theme');
  assert.match(read('frontend/src/pages/site/DoorPage.jsx'), /<SitePage\b/, 'DoorPage renders inside SitePage');
  assert.ok(!/prefers-color-scheme|\.dark\b/.test(CSS), 'doors.css has no dark variant that could pair other colours');
  assert.equal(hex6(PAGE_BG), '#ffffff', 'the site page is white');
  assert.ok(PLANS_BG, 'the plans band sets its wash');
});

for (const theme of ['light', 'dark']) {
  test(`every door's text accent reaches 4.5:1 on each background it sits on (${theme})`, () => {
    for (const k of DOOR_ORDER) {
      const d = DOORS[k];
      assert.ok(d.accentText, `${k} has a text accent`);
      const pairs = [
        ['words on the page', d.accentText, hex6(PAGE_BG)],
        ['words on the door\'s soft tint (the pills, tokens, aside)', d.accentText, d.soft],
        ['words on the plans band', d.accentText, PLANS_BG],
        ['white words on the badge, last chip, plan tag and plan button', '#ffffff', d.accentText],
      ];
      for (const [what, fg, bg] of pairs) {
        const r = contrast(fg, bg);
        assert.ok(r >= 4.5, `${k} (${theme}): ${what}, ${fg} on ${bg}, is ${r.toFixed(2)}:1, under 4.5:1`);
      }
    }
  });
}

test('doors.css colours no words with the light accent, and fills under white words with the text accent', () => {
  const rules = [...CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, sel, body]) => ({ sel: sel.trim(), body }));
  const words = [];
  const whiteOnAccent = [];
  for (const r of rules) {
    if (/(^|[\s;])color:\s*var\(--door-accent\)/.test(r.body)) words.push(r.sel);
    if (/color:\s*#fff\b/.test(r.body) && /background:\s*var\(--door-accent\)/.test(r.body)) whiteOnAccent.push(r.sel);
  }
  assert.deepEqual(words, [], 'no rule colours words with --door-accent');
  assert.deepEqual(whiteOnAccent, [], 'no rule sets white words on --door-accent');
  // The rules the issue names read --door-text.
  for (const sel of ['.ax-door .ax-door-lbl', '.ax-door-fact-n', '.ax-door-chap-n', '.ax-door-pill', '.ax-door-faq-n', '.ax-door-plan-step', '.ax-door-tick', '.ax-door .ax-door-tokens-link']) {
    const r = rules.find((x) => x.sel === sel);
    assert.ok(r, `${sel} is in doors.css`);
    assert.match(r.body, /(^|[\s;])color:\s*var\(--door-text\)/, `${sel} colours its words with --door-text`);
  }
  for (const sel of ['.ax-door-badge', '.ax-door-chip.is-last', '.ax-door-plan-tag', '.ax-door-plan.is-hi .ax-door-plan-cta']) {
    const r = rules.find((x) => x.sel === sel);
    assert.ok(r, `${sel} is in doors.css`);
    assert.match(r.body, /background:\s*var\(--door-text\)/, `${sel} fills with --door-text under white words`);
  }
  assert.match(rules.find((x) => x.sel === '.ax-door').body, /--door-text:\s*var\(--ax-violet\)/, 'the default door text is the site violet');
});

test('each door page sets --door-text to its text accent', () => {
  for (const k of DOOR_ORDER) {
    const html = renderToStaticMarkup(h(MemoryRouter, { initialEntries: [DOORS[k].path] }, h(DoorPage, { door: k })));
    assert.ok(html.includes(`--door-text:${DOORS[k].accentText}`), `${k} sets --door-text:${DOORS[k].accentText}`);
    assert.ok(html.includes(`--door-accent:${DOORS[k].accent}`), `${k} keeps its decoration accent`);
  }
});

/* ------------------------------------------------------------------ *
 * The mounted pages (team, trust)
 * ------------------------------------------------------------------ */

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function mount(url, Page, handle) {
  const restore = installDocument();
  const meta = { getAttribute: () => '', setAttribute() {}, remove() {} };
  document.head = { querySelector: () => meta, appendChild() {} };
  document.getElementById = () => null;
  const classes = new Set();
  document.documentElement = { dataset: {}, classList: { contains: (c) => classes.has(c), add: (c) => classes.add(c), remove: (c) => classes.delete(c) } };
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  globalThis.fetch = async (u, init = {}) => handle(String(u), init);
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  if (globalThis.window) { window.matchMedia = globalThis.matchMedia; window.innerWidth = 1440; }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(Page))); });
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  return {
    flush, props, container,
    nodes: () => walk(container),
    async close() {
      await act(async () => root.unmount());
      globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia;
      restore();
    },
  };
}

/* ------------------------------------------------------------------ *
 * 2. /team
 * ------------------------------------------------------------------ */

const LINKEDIN = /linkedin\.com\/in\//;
const tag = (n) => String(n.tagName || '').toUpperCase();
/** The photo link: the LinkedIn link that holds no text, only a box or an image. */
function photoLink(v) {
  const links = v.nodes().filter((n) => tag(n) === 'A' && LINKEDIN.test(v.props(n).href || ''));
  assert.ok(links.length >= 1, 'the LinkedIn link renders');
  return links[0];
}
const imgIn = (v, n) => [n, ...(n.childNodes || [])].flatMap(function all(x) { return [x, ...(x.childNodes || []).flatMap(all)]; }).find((x) => tag(x) === 'IMG');
const team = (body) => (u) => (/\/public\/team$/.test(new URL(u, 'http://x').pathname) ? (typeof body === 'function' ? body() : json(body)) : json({}, 404));

test('/team: with no photo recorded, the photo link is named for the person and LinkedIn', async () => {
  const v = await mount('/team', TeamPage, team({ members: [{ name: 'Ada Lovelace', photo_url: null }] }));
  try {
    const a = photoLink(v);
    assert.equal(imgIn(v, a), undefined, 'no image is drawn');
    assert.equal(v.props(a)['aria-label'], 'Ada Lovelace on LinkedIn');
  } finally { await v.close(); }
});

test('/team: when the photo fails, the link is named; while it shows, its alt names it', async () => {
  const v = await mount('/team', TeamPage, team({ members: [{ name: 'Ada Lovelace', photo_url: '/p.jpg' }] }));
  try {
    let a = photoLink(v);
    const img = imgIn(v, a);
    assert.ok(img, 'the photo is drawn');
    assert.equal(v.props(img).alt, 'Ada Lovelace', 'the image names the link');
    assert.equal(v.props(a)['aria-label'], undefined, 'no label overrides the alt');
    await act(async () => { v.props(img).onError(); });
    await v.flush();
    a = photoLink(v);
    assert.equal(imgIn(v, a), undefined, 'the failed image is gone');
    assert.equal(v.props(a)['aria-label'], 'Ada Lovelace on LinkedIn');
  } finally { await v.close(); }
});

test('/team: when the member cannot be read, the photo link is still named', async () => {
  const v = await mount('/team', TeamPage, team(() => json({ error: 'down' }, 503)));
  try {
    assert.equal(v.props(photoLink(v))['aria-label'], 'Managing Partner on LinkedIn');
  } finally { await v.close(); }
});

/* ------------------------------------------------------------------ *
 * 3. /trust
 * ------------------------------------------------------------------ */

const TRUST = {
  blocks: { glance: null, security: null, data: null, subprocessors: null, certifications: null, documents: null, disclosure: null },
  subprocessors: { items: [{ uid: 's1', name: 'Vendor A', purpose: 'Hosting', data: 'Account data', location: 'United States', starts_at: '2025-01-10', active: true }], last_change: '2026-09-02T10:00:00Z' },
  changes: { items: [], complete: true },
  read_at: '2026-10-25T10:00:00Z',
};
const MATRIX = {
  profiles: [{ key: 'founder', label: 'Founder' }],
  rows: [{ key: 'tos', label: 'Terms of Service', cells: { founder: { asked: 'always', renews_months: null } } }],
};
function worker(u) {
  const p = new URL(u, 'http://x').pathname.replace(/^\/api/, '');
  if (p === '/public/trust') return json(TRUST);
  if (p === '/public/trust/matrix') return json(MATRIX);
  if (p === '/public/trust/changes') return json(TRUST.changes);
  if (p === '/public/status') return json({ services: [] });
  return json({}, 404);
}

for (const [url, label] of [
  ['/trust', 'What we check, and for whom'],
  ['/trust/subprocessors', 'Subprocessors'],
  ['/trust/documents', 'Documents'],
  ['/trust/disclosure', 'How fast we answer'],
]) {
  test(`${url}: the wide table's scroller is focusable and a named region`, async () => {
    const v = await mount(url, TrustCenter, worker);
    try {
      const tables = v.nodes().filter((n) => tag(n) === 'TABLE');
      assert.ok(tables.length >= 1, `${url} draws its table`);
      for (const t of tables) {
        const scroller = t.parentNode;
        const p = v.props(scroller);
        assert.match(String(p.className || ''), /\boverflow-x-auto\b/, 'the table sits in its sideways scroller');
        assert.equal(p.tabIndex, 0, 'the scroller takes keyboard focus');
        assert.equal(p.role, 'region', 'the scroller is a region');
        assert.equal(p['aria-label'], label, 'the region is named for its table');
      }
    } finally { await v.close(); }
  });
}

test('TrustCenter.jsx wraps every table in TableScroll, never a bare scroller', () => {
  const src = read('frontend/src/pages/site/TrustCenter.jsx');
  const tables = (src.match(/<table\b/g) || []).length;
  const wrapped = (src.match(/<TableScroll label="[^"]+">\s*<table\b/g) || []).length;
  assert.ok(tables >= 4, 'the four tables the issue names');
  assert.equal(wrapped, tables, 'each <table> opens inside a named TableScroll');
});
