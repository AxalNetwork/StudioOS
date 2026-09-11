/**
 * Spin-Out Lab page gutters — one rail for overview and tool pages.
 *
 * Before LabPageShell, every tool page hand-rolled `px-2 sm:px-4 py-3` while
 * the workspace overview used different padding, and sub-routes still inherited
 * the app shell's `p-4 md:p-6` — double gutters on feature pages. These
 * assertions pin the shared tokens and the flush-surface rule so the rails
 * cannot drift apart again.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');

const labStyles = read('frontend/src/components/spinout/labStyles.js');
const labShell = read('frontend/src/components/spinout/LabPageShell.jsx');
const app = read('frontend/src/App.jsx');
const workspace = read('frontend/src/pages/SpinoutLabWorkspace.jsx');

/** Tool pages that must wrap in LabPageShell (not the overview or public surfaces). */
const TOOL_PAGES = readdirSync(resolve(root, 'frontend/src/pages'))
  .filter((f) => /^SpinoutLab.+Page\.jsx$/.test(f))
  .filter((f) => ![
    'SpinoutLabWorkspace.jsx',
    'SpinoutLabPage.jsx',
    'SpinoutLabMarketingPage.jsx',
    'SpinoutLabInvestorPage.jsx',
    'SpinoutLabLpWorkspacePage.jsx',
    'SpinoutLabBriefPage.jsx',
  ].includes(f))
  .map((f) => `frontend/src/pages/${f}`);

test('LAB_PAGE_PAD defines the canonical left / top / right gutters', () => {
  assert.match(labStyles, /export const LAB_PAGE_PAD = 'px-4 sm:px-6 py-6'/);
  assert.match(labStyles, /export const LAB_PAGE_PAD_LOOSE = 'pb-24'/);
  assert.match(labShell, /labPageShellClass/);
  assert.match(labShell, /LAB_PAGE_PAD/);
});

test('Spin-Out Lab sub-routes flush the app shell so pages own gutters once', () => {
  assert.match(app, /const flushSurface = fullBleedSurface\s*\|\|\s*location\.pathname\.startsWith\('\/spinout-lab\/'\)/);
});

test('the workspace overview uses the same pad tokens as tool pages', () => {
  assert.match(workspace, /LAB_PAGE_PAD/);
  assert.match(workspace, /LAB_PAGE_PAD_LOOSE/);
  assert.match(workspace, /-mx-4 sm:-mx-6 px-4 sm:px-6/,
    'sticky header bleed must match LAB_PAGE_PAD horizontal gutters');
});

test('every authenticated tool page wraps in LabPageShell', () => {
  const missing = [];
  for (const page of TOOL_PAGES) {
    const src = read(page);
    if (!src.includes('LabPageShell')) missing.push(relative(root, page));
  }
  assert.deepEqual(missing, [],
    `these tool pages do not import LabPageShell: ${missing.join(', ')}`);
});

test('no tool page reintroduces the old hand-rolled gutter string', () => {
  const offenders = [];
  for (const page of TOOL_PAGES) {
    const code = codeOnly(read(page));
    if (/px-2 sm:px-4 py-3/.test(code)) offenders.push(relative(root, page));
  }
  assert.deepEqual(offenders, [],
    `these pages still use px-2 sm:px-4 py-3: ${offenders.join(', ')}`);
});

test('LabPageShell openings are not malformed JSX', () => {
  const pages = readdirSync(resolve(root, 'frontend/src/pages'))
    .filter((f) => f.startsWith('SpinoutLab') && f.endsWith('.jsx'))
    .map((f) => `frontend/src/pages/${f}`);
  const offenders = pages.filter((p) => read(p).includes('<div <LabPageShell'));
  assert.deepEqual(offenders, [],
    `malformed LabPageShell JSX in: ${offenders.join(', ')}`);
});
