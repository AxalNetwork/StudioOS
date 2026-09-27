/**
 * D403 — detail-layer navigation: "View more · N" only where a count is
 * sourced, a crumb that returns to the zone's section on the root, and zone
 * pills that answer hover and focus.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/detail_layer_nav_d403.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { total, top } from '../src/workspaces/boards/format.js';
import BOARDS, { boardFor } from '../src/workspaces/boards/index.js';
import ZoneNav from '../src/workspaces/ZoneNav.jsx';
import { bucketsFor, SHELLS } from '../src/workspaces/shellConfig.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BOARD = 'frontend/src/workspaces/BucketBoard.jsx';
const SHELL = 'frontend/src/workspaces/WorkspaceShell.jsx';

const rowsOf = (n) => Array.from({ length: n }, (_, i) => ({ id: i }));

// ── The count ───────────────────────────────────────────────────────────

test('total is the length of a list the read returned in full', () => {
  assert.equal(total(rowsOf(7)), 7);
  assert.equal(total(rowsOf(0)), 0);
  assert.equal(total(rowsOf(199), 200), 199);
});

test('a list at its read\'s LIMIT has no total: it may be a longer list cut short', () => {
  assert.equal(total(rowsOf(200), 200), null);
  assert.equal(total(rowsOf(250), 200), null);
});

test('no list, no total', () => {
  assert.equal(total(null), null);
  assert.equal(total(undefined, 200), null);
  assert.equal(total({ items: [] }), null);
});

/** The four sections that declare a total, and a payload shape for each. */
const DECLARED = [
  ['advisor', '/practice', 'sessions', (items) => ({ items }), 200],
  ['investor', '/deals', 'closing', (items) => ({ items }), 200],
  ['partner', '/offers', 'catalog', (items) => ({ items }), 200],
];

test('each declared total counts the list its rows are drawn from, and stops at the cap', () => {
  for (const [role, prefix, slug, shape, cap] of DECLARED) {
    const section = boardFor(role, prefix, null).sections.find((s) => s.slug === slug);
    assert.ok(section?.total, `${role} ${prefix} ${slug} declares no total`);
    const seven = shape(rowsOf(7).map((r) => ({ ...r, title: `t${r.id}`, is_active: true })));
    assert.equal(section.total(seven), 7, `${slug}: total is not the list's length`);
    assert.equal(section.rows(seven).length, top(seven.items).length);
    assert.equal(section.total(shape(rowsOf(cap))), null, `${slug}: a list at its cap claimed a total`);
  }
});

test('the investor pipeline counts only the rows it would show (live deals), with no cap', () => {
  const section = boardFor('investor', '/deals', null).sections.find((s) => s.slug === 'pipeline');
  assert.ok(section?.total, 'the pipeline declares no total');
  // deals.ts's list read has no LIMIT, so a long list still has a count, and
  // a rejected deal (dealStage → null) is neither counted nor shown.
  const deals = [
    ...rowsOf(240).map((r) => ({ ...r, status: 'applied' })),
    ...rowsOf(60).map((r) => ({ ...r, id: 1000 + r.id, status: 'rejected' })),
  ];
  assert.equal(section.total(deals), 240, 'the total counts rejected deals, or stops at a cap the read does not have');
  assert.equal(section.rows(deals).length, 5);
  assert.equal(section.total([]), 0);
});

test('no registry declares a total on a section with no source', () => {
  for (const key of Object.keys(BOARDS)) {
    const [role, prefix] = key.split(':');
    for (const s of boardFor(role, prefix, null).sections) {
      if (s.total) assert.ok(s.source, `${key} ${s.slug} counts rows it has no source for`);
    }
  }
});

// ── The board ───────────────────────────────────────────────────────────

test('"View more · N" appears only when a sourced total exceeds the rows shown', () => {
  const src = codeOnly(read(BOARD));
  assert.match(src, /const n = section\.total \? section\.total\(payload\) : null;/,
    'the footer count must come from the section\'s own total');
  assert.match(src, /const more = Number\.isInteger\(n\) && n > rows\.length \? n : null;/,
    'a total that is absent, non-integer or no larger than the rows shown must not print');
  assert.match(src, /\{more !== null \? \([\s\S]{0,300}?`View more · \$\{more\}`[\s\S]{0,300}?\) : \([\s\S]{0,200}?Open \{section\.title/,
    'without a count the footer must stay the plain link');
});

test('the board scrolls to the section the crumb named', () => {
  const src = codeOnly(read(BOARD));
  assert.match(src, /const \{ hash \} = useLocation\(\);/);
  assert.match(src, /document\.getElementById\(id\)\?\.scrollIntoView\(/);
  assert.match(src, /\}, \[hash\]\);/, 'the scroll does not re-run when the hash changes');
  // The sections carry the ids the crumb points at from the first paint.
  assert.match(src, /id=\{section\.anchor\}/);
});

// ── The crumb ───────────────────────────────────────────────────────────

test('the crumb returns to the zone\'s section on a board root', () => {
  const src = codeOnly(read(SHELL));
  assert.match(src, /boardFor\(role, bucket\.prefix, null\)\?\.sections \|\| \[\]\)\.find\(\(s\) => s\.slug === zone\.slug\)\?\.anchor/,
    'the crumb does not look up the zone\'s section anchor');
  assert.match(src, /<Link to=\{crumbTo\}/);
});

test('every board section a crumb can name has an anchor, and a card has none', () => {
  let anchors = 0;
  for (const key of Object.keys(BOARDS)) {
    const [role, prefix] = key.split(':');
    const bucket = bucketsFor(role).find((b) => b.prefix === prefix);
    assert.ok(bucket, `${key} names a bucket the ${role} shell does not have`);
    for (const s of boardFor(role, prefix, null).sections) {
      assert.ok(bucket.zones.some((z) => z.slug === s.slug), `${key} ${s.slug} is not a zone`);
      if (s.kind === 'card') continue;              // a link card renders no id
      assert.match(String(s.anchor || ''), /^[a-z][a-z0-9-]*$/, `${key} ${s.slug} has no usable anchor`);
      anchors += 1;
    }
  }
  assert.ok(anchors > 30, `only ${anchors} anchors — the registry was not read`);
});

// ── The pills ───────────────────────────────────────────────────────────

function renderNav(role, path) {
  const bucket = bucketsFor(role).find((b) => path.startsWith(b.prefix));
  return renderToStaticMarkup(
    React.createElement(MemoryRouter, { initialEntries: [path] },
      React.createElement(ZoneNav, { bucket, role })),
  );
}

test('a zone pill paints through CSS variables, so hover can win', () => {
  // An inline `color`/`background`/`border-color` beats every hover class,
  // which is why the idle pills never answered the pointer.
  for (const role of Object.keys(SHELLS)) {
    const bucket = bucketsFor(role)[0];
    const html = renderNav(role, `${bucket.prefix}/${bucket.zones[1]?.slug || bucket.zones[0].slug}`);
    for (const style of html.match(/style="[^"]*"/g) || []) {
      assert.doesNotMatch(style, /(?:^|[;"])\s*(?:color|background|border-color)\s*:/,
        `${role}: an inline paint property beats the hover class: ${style}`);
      assert.match(style, /--zn-hover-ink:/, `${role}: no hover colour is set`);
    }
    assert.match(html, /hover:text-\[color:var\(--zn-hover-ink\)\]/, `${role}: no hover class`);
    assert.match(html, /focus-visible:outline/, `${role}: no focus outline`);
  }
});

test('the hover colour is the role\'s accent, and the current pill stays marked by the URL', async () => {
  const { ACCENT } = await import('../src/workspaces/shellConfig.js');
  const bucket = bucketsFor('partner')[0];
  const zone = bucket.zones[1];
  const html = renderNav('partner', `${bucket.prefix}/${zone.slug}`);
  assert.ok(html.includes(`--zn-hover-ink:${ACCENT.partner.deep}`), 'hover is not the partner accent');
  const current = html.match(/<a[^>]*aria-current="page"[^>]*>/g) || [];
  assert.equal(current.length, 1, 'exactly one pill is current');
  assert.ok(current[0].includes(`link-zone-${zone.slug}`), 'the current pill is not the one the URL names');
  // An idle pill carries the dark-mode neutrals; the current one keeps its tint.
  assert.doesNotMatch(current[0], /dark:bg-transparent/);
  const idle = (html.match(/<a[^>]*>/g) || []).filter((a) => !a.includes('aria-current'));
  assert.ok(idle.length > 0 && idle.every((a) => a.includes('dark:bg-transparent')));
});
