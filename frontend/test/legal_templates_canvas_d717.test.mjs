/**
 * D717 (#1782), intake #1850 — the "Legal Documents · Templates" canvas lands
 * in design/incoming, triaged; #1854 moved it to design/canvases/integrated
 * when it closed #1782 (2026-10-19).
 *
 * Sixteen tasks across S07 to S14 build its boards, and a slot on another
 * account cannot open the artifact link, so the canvas has to be a file here
 * (the reason research_canvases_d546.test.mjs gives for the Research
 * canvases). These pins hold:
 *
 *   the file in the processed canvas format, with its two content scripts
 *     inlined in the template's order and one font link naming all six
 *     families;
 *   its boards, R0 to R2 and L0 to L12, with no L13;
 *   the README row and the ROUTE_MAP rows that tell a builder which route,
 *     grade and issue each board governs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const at = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const FILE = 'Legal Documents · Templates.dc.html';
const html = at(`design/canvases/integrated/${FILE}`);

test('D717 the canvas graduated: in integrated/, gone from incoming/, and both READMEs count the folder', () => {
  assert.ok(!existsSync(resolve(process.cwd(), `design/incoming/${FILE}`)), 'no longer in design/incoming/');
  const integrated = readdirSync(resolve(process.cwd(), 'design/canvases/integrated')).filter((f) => f.endsWith('.dc.html')).length;
  assert.ok(at('design/canvases/README.md').includes(`| \`integrated/\` | ${integrated} |`), `design/canvases/README.md says integrated/ holds ${integrated}`);
  assert.ok(at('design/incoming/README.md').includes(`| \`canvases/integrated/\` | ${integrated} — `), `design/incoming/README.md says integrated/ holds ${integrated}`);
});

test('D717 the canvas is committed in the processed format', () => {
  assert.equal(/<script src="([^"]*)"/.exec(html)?.[1], './support.js', 'the first script is the shared runtime');
  for (const banned of ['@font-face', '__claude_design_branding', 'sc-camel-', 'data-props']) {
    assert.ok(!html.includes(banned), `no ${banned}`);
  }
  assert.doesNotMatch(html, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, 'no asset uuid is left unplaced');
  assert.match(html, /<x-dc>/, 'a canvas body, not an artifact shell');
});

test('D717 one font link names all six families of the template', () => {
  const links = html.match(/<link[^>]+fonts\.googleapis\.com[^>]*>/g) || [];
  assert.equal(links.length, 1);
  for (const family of ['Jost', 'Inter', 'Bricolage+Grotesque', 'Public+Sans', 'Roboto+Mono', 'Space+Grotesk']) {
    assert.ok(links[0].includes(`family=${family}:`), family);
  }
});

test('D717 the two content scripts are inline, in the template\'s order, and LEGALDESK holds the 14 screens', () => {
  const count = (s) => html.split(s).length - 1;
  assert.equal(count('window.LEGAL = {'), 1);
  assert.equal(count('window.LEGALDESK = {'), 1);
  const legal = html.indexOf('window.LEGAL = {');
  const desk = html.indexOf('window.LEGALDESK = {');
  const body = html.indexOf('type="text/x-dc"');
  assert.ok(body > 0, 'the canvas body is there');
  assert.ok(legal < desk && desk < body, 'LEGAL, then LEGALDESK, both before the canvas body');

  const literal = html.slice(desk + 'window.LEGALDESK = '.length, html.indexOf('};', desk) + 1);
  const keys = literal.slice(1, -1).split(',').map((entry) => entry.split(':')[0].trim().replace(/^'|'$/g, ''));
  assert.deepEqual(keys, ['catalog', 'catalog-dark', 'editor', 'history', 'publish', 'push',
    'p-list', 'p-sheet', 'p-preview', 'p-read', 'p-check', 'p-adopt', 'p-done', 'p-call']);
});

test('D717 the boards are R0, R1, R2 and L0 to L12, with no L13', () => {
  const ids = [...html.matchAll(/\{ id: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['R0', 'R1', 'R2', ...Array.from({ length: 13 }, (_, i) => `L${i}`)]);
});

test('D717 the README row names the four routes, the grade and #1782, and says there is no L13', () => {
  const line = at('design/incoming/README.md').split('\n').find((l) => l.startsWith(`| \`${FILE}\``));
  const row = (line ?? '').replace(/\s+/g, ' ');
  assert.ok(row, 'the README has the row');
  for (const route of ['/admin/contracts?tab=templates', '/admin?tab=bank-accounts', '/esign/:token', '/spinout-lab/investor-workspace']) {
    assert.ok(row.includes(`\`${route}\``), route);
  }
  assert.match(row, /\| UPGRADE \|/);
  assert.ok(row.includes('#1782'));
  assert.ok(row.includes('there is no L13'));
});

test('D717 ROUTE_MAP triages L9 to L12: L9\'s editor and catalog, L10 and L11 are CURRENT; L9\'s other rows and L12 wait on their PRs', () => {
  const map = at('documentation/architecture/ROUTE_MAP.md');
  const start = map.indexOf('### Legal templates Worker contract (D717, #1782)');
  const end = map.indexOf('\n### ', start + 1);
  assert.ok(start > 0 && end > start);
  const section = map.slice(start, end);
  assert.ok(section.includes(`\`design/canvases/integrated/${FILE}\``), 'the section names the file where it lives');
  const rows = section.split('\n').filter((l) => l.startsWith('| L'));
  // L9's editor and publish frames shipped in #1918 (#1852) and its catalog in #1851; its Pages and History (#1853) have not.
  const editor = (l) => l.startsWith('| L9 `editor`');
  const catalog = (l) => l.startsWith('| L9 "The Templates tab · desktop"');
  const l9Catalog = rows.filter(catalog);
  assert.equal(l9Catalog.length, 1, 'a row for L9\'s catalog');
  assert.ok(/\| CURRENT \|/.test(l9Catalog[0]), 'L9\'s catalog is CURRENT: #1851 merged');
  const l9Editor = rows.filter(editor);
  assert.equal(l9Editor.length, 1, 'a row for L9\'s editor');
  assert.ok(/\| CURRENT \|/.test(l9Editor[0]), 'L9\'s editor is CURRENT: #1918 merged');
  for (const board of ['L9', 'L12']) {
    const own = rows.filter((l) => l.startsWith(`| ${board} `) && !editor(l) && !catalog(l));
    assert.ok(own.length, `a row for ${board}`);
    for (const l of own) assert.ok(!/\| CURRENT \|/.test(l), `${board} is not CURRENT`);
  }
  // L10's sheet (#1855) and its Bank accounts door (#1856) have both merged.
  const l10 = rows.filter((l) => l.startsWith('| L10 '));
  assert.equal(l10.length, 1, 'a row for L10');
  assert.ok(/\| CURRENT \|/.test(l10[0]), 'L10 is CURRENT: #1855 and #1856 merged');
  // L11 is the Bank accounts table's row, just above the section; #1856 built it.
  const bank = map.split('\n').filter((l) => l.startsWith(`| \`${FILE}\` · L11`));
  assert.equal(bank.length, 1, 'the Bank accounts table has the L11 row');
  assert.ok(/\| CURRENT \|/.test(bank[0]), 'L11 is CURRENT: #1856 merged');
  assert.ok(!map.includes('| None, by decision'), 'no Bank accounts row still says it has no canvas');
});
