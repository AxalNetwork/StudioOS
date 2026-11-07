/**
 * #4573 (Performance P1) — the bundle baseline's parsers and the shell budget.
 * Synthetic chunks only; the real build is measured by
 * `scripts/check-bundle-budget.mjs` in test:guards.
 *
 *   node --test frontend/test/bundle_budget_4573.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyse, criticalOf, importsOf, stem } from '../../scripts/perf/bundle-baseline.mjs';
import { BUDGET, overBudget } from '../../scripts/check-bundle-budget.mjs';

test('imports: static (quoted or template) and lazy (template literal, as Rolldown writes them)', () => {
  // Mutation checked: the backtick dropped from the lazy pattern → the lazy page is missed, as on the first run (0 lazy edges).
  const code = 'import{a as b}from"./react-vendor-AAAAAAAA.js";import"./side-DDDDDDDD.js";export{c}from`./c-CCCCCCCC.js`;const x=()=>import(`./Page-BBBBBBBB.js`);';
  assert.deepEqual(importsOf(code), { static: ['c-CCCCCCCC.js', 'react-vendor-AAAAAAAA.js', 'side-DDDDDDDD.js'], dynamic: ['Page-BBBBBBBB.js'] });
});

test('the critical path: entry, modulepreloads, local stylesheets; a <noscript> link is not reached', () => {
  const html = `<link rel="stylesheet" href="https://fonts.example/css" media="print" onload="x"><noscript><link rel="stylesheet" href="https://hidden.example/css"></noscript>
    <script type="module" crossorigin src="/assets/index-AAAAAAAA.js"></script><link rel="modulepreload" crossorigin href="/assets/vendor-BBBBBBBB.js"><link rel="stylesheet" crossorigin href="/assets/index-CCCCCCCC.css">`;
  assert.deepEqual(criticalOf(html), { entry: 'index-AAAAAAAA.js', preload: ['vendor-BBBBBBBB.js'], css: ['index-CCCCCCCC.css'], external: ['https://fonts.example'] });
  assert.equal(stem('index-AAAAAAAA.js'), 'index.js');
});

test('a lazy page costs only what the shell does not already hold', () => {
  // Mutation checked: the shell's files not subtracted → the page's cost includes the vendor chunk and the check fails.
  const dir = mkdtempSync(join(tmpdir(), 'bundle-4573-'));
  try {
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<script type="module" src="/assets/index-AAAAAAAA.js"></script><link rel="modulepreload" href="/assets/vendor-BBBBBBBB.js">');
    writeFileSync(join(dir, 'assets/index-AAAAAAAA.js'), 'import"./vendor-BBBBBBBB.js";const p=()=>import(`./Page-CCCCCCCC.js`);');
    writeFileSync(join(dir, 'assets/vendor-BBBBBBBB.js'), 'export const v=1;'.repeat(50));
    writeFileSync(join(dir, 'assets/Page-CCCCCCCC.js'), 'import"./vendor-BBBBBBBB.js";import"./chart-DDDDDDDD.js";export default 1;');
    writeFileSync(join(dir, 'assets/chart-DDDDDDDD.js'), 'export const c=2;'.repeat(80));
    const r = analyse(dir);
    assert.equal(r.critical.files, 2);
    const page = r.lazy_heaviest.find((l) => l.file === 'Page-CCCCCCCC.js');
    assert.equal(page.beyond_shell_chunks, 2, 'the page and its chart, not the vendor chunk the shell holds');
    assert.equal(r.dynamic_edges, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the budget: under passes; each limit fails on its own, with a sentence', () => {
  // Mutation checked: the brotli comparison inverted → the passing shell fails.
  const shell = (brotli, files, entryRaw) => ({ entry: 'index-A.js', files, size: { raw: 0, gzip: 0, brotli }, largest: [{ file: 'index-A.js', raw: entryRaw, gzip: 0, brotli: 0 }] });
  assert.deepEqual(overBudget(shell(BUDGET.criticalBrotli, BUDGET.criticalFiles, BUDGET.entryRaw)), []);
  assert.match(overBudget(shell(BUDGET.criticalBrotli + 1, 1, 1))[0], /critical path is .* brotli, over/);
  assert.match(overBudget(shell(1, BUDGET.criticalFiles + 1, 1))[0], /files, over its budget/);
  assert.match(overBudget(shell(1, 1, BUDGET.entryRaw + 1))[0], /entry chunk is .* raw, over/);
});
