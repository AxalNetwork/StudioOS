/**
 * D546 (#1077) — the Research rebuild's seven canvases land in
 * design/incoming, and the raw Founder Research twin leaves.
 *
 * The slots that build #1079 to #1082 run on other accounts and cannot open
 * the artifact those issues link, so the canvas has to be a file here. These
 * pins hold three things in place:
 *
 *   the seven page files, each in the processed canvas format (the shared
 *     `./support.js` runtime and no inlined fonts), which is the only form a
 *     reviewer can diff;
 *   every canvas in the intake queue in that format. The raw twin of
 *     `Pages · Founder Research` failed it: an artifact runtime uuid and 35
 *     inlined @font-face rules around a design the processed copy in
 *     `canvases/integrated/` already holds;
 *   the README row that tells a builder which route and issue each canvas
 *     governs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { readDecision } from './_decisions.mjs';

const root = resolve(process.cwd());
const INCOMING = 'design/incoming';
const at = (p) => readFileSync(resolve(root, p), 'utf8');

const PAGES = [
  { page: 'Main', title: 'Research overview', route: '/research', issue: '#1082' },
  { page: 'Companies', title: 'Companies directory', route: '/research/companies', issue: '#1079' },
  { page: 'Company', title: 'Company page', route: '/research/companies/company/:uid', issue: '#1079' },
  { page: 'Markets', title: 'Markets', route: '/research/markets', issue: '#1080' },
  { page: 'Sector', title: 'Sector page', route: '/research/markets/sector/:slug', issue: '#1080' },
  { page: 'Geography', title: 'Geography page', route: '/research/geographies/:code', issue: '#1080' },
  { page: 'Funds', title: 'Funds directory', route: '/research/funds', issue: '#1081' },
];

/** Why a canvas is not in the processed format, or null when it is. */
function rawness(html) {
  const runtime = /<script src="([^"]*)"/.exec(html)?.[1];
  if (runtime !== './support.js') return `runtime is ${JSON.stringify(runtime)}, not ./support.js`;
  if (/@font-face/.test(html)) return 'it inlines @font-face rules';
  return null;
}

/** The README row for one canvas, whitespace collapsed; '' when absent. */
function readmeRow(file) {
  const line = at(`${INCOMING}/README.md`).split('\n').find((l) => l.startsWith(`| \`${file}\``));
  return (line ?? '').replace(/\s+/g, ' ');
}

for (const { page, title } of PAGES) {
  test(`Research · ${page} is committed, processed, and is the ${title} canvas`, () => {
    const html = at(`${INCOMING}/Research · ${page}.dc.html`);
    assert.equal(rawness(html), null);
    assert.match(html, new RegExp(`<title>${title}</title>`));
    assert.match(html, /<x-dc>/, 'a canvas body, not an artifact shell');
  });
}

test('every canvas in the intake queue is processed', () => {
  const canvases = readdirSync(resolve(root, INCOMING)).filter((f) => f.endsWith('.dc.html'));
  assert.ok(canvases.length >= PAGES.length);
  const raw = canvases
    .map((f) => [f, rawness(at(`${INCOMING}/${f}`))])
    .filter(([, why]) => why)
    .map(([f, why]) => `${f}: ${why}`);
  assert.deepEqual(raw, []);
});

test('the raw Founder Research twin is gone, and its README row says so', () => {
  const canvases = readdirSync(resolve(root, INCOMING));
  assert.ok(!canvases.includes('Pages · Founder Research.dc.html'));
  assert.match(readmeRow('Pages · Founder Research.dc.html'), /deleted 2026-10-05 — raw twin, D546/);
});

for (const { page, route, issue } of PAGES) {
  test(`the README names Research · ${page}'s route and issue`, () => {
    const row = readmeRow(`Research · ${page}.dc.html`);
    assert.ok(row.includes(route), `row for ${page} names ${route}: ${row}`);
    assert.ok(row.includes(issue), `row for ${page} names ${issue}: ${row}`);
  });
}

test('D546 records the landing', () => {
  assert.match(readDecision(546, root), /^## D546 — The Research rebuild's seven canvases land in design\/incoming/);
});
