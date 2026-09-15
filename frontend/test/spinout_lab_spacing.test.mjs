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
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
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
  // THE PROPERTY IS UNCHANGED AND THE MECHANISM MOVED. This first asserted
  // `flushSurface = fullBleedSurface || startsWith('/spinout-lab/')`, which is
  // a second path test beside the derived list — and four other guards
  // (founder_shell, investor_shell, referrals_canvas, workspace_frame_contract)
  // pin `flushSurface` to exactly `fullBleedSurface;` to forbid precisely that.
  // They are not being pedantic: width and padding were once two hand-typed
  // arrays of the same sixteen paths, they drifted, and `/grow/focus` was the
  // route missing from one of them. So the prefix went into the shared list
  // instead, where BOTH flags read it.
  const sidebar = read('frontend/src/sidebarConfig.js');
  assert.match(sidebar, /export const SHARED_FULL_BLEED_PREFIXES = \[\s*'\/spinout-lab\/',/,
    'the Lab prefix is no longer in the shared full-bleed list');
  assert.match(app, /SHARED_FULL_BLEED_PREFIXES\.some\(\(prefix\) => location\.pathname\.startsWith\(prefix\)\)/,
    'fullBleedSurface does not read the shared prefix list');
  assert.match(app, /const flushSurface = fullBleedSurface;/,
    'flushSurface tests a path again instead of deriving from the one list');
  // And the prefix appears EXACTLY ONCE in App.jsx — inside the comment that
  // explains where it moved to, never again as a live test. Two tests of one
  // fact is the thing this whole arrangement exists to prevent.
  const live = codeOnly(app).match(/'\/spinout-lab\/'/g) || [];
  assert.deepEqual(live, [],
    'the Lab prefix is hand-typed in App.jsx again, beside the list that already holds it');
});

test('the workspace overview uses the same pad tokens as tool pages', () => {
  assert.match(workspace, /LAB_PAGE_PAD/);
  assert.match(workspace, /LAB_PAGE_PAD_LOOSE/);
  assert.match(workspace, /-mx-4 sm:-mx-6 px-4 sm:px-6/,
    'sticky header bleed must match LAB_PAGE_PAD horizontal gutters');
});

test('every authenticated tool page imports LabPageShell AND renders it', () => {
  // TWO ASSERTIONS, NOT ONE SUBSTRING. This was `src.includes('LabPageShell')`,
  // which a mutation walked straight through: the name inside a comment
  // satisfies it, and so does any longer identifier that merely contains it —
  // renaming the component to `LabPageShellOld` on one page left the guard
  // green while that page owned no gutters and was now flush. So the import is
  // matched at its own module path, and the element is matched as an opening
  // tag, which is the thing that actually puts the padding on screen.
  const noImport = [];
  const noRender = [];
  const unbalanced = [];
  for (const page of TOOL_PAGES) {
    const src = codeOnly(read(page));
    // Either quote style: `SpinoutLabApplyPage.jsx` uses double quotes, and an
    // assertion that only knew about single ones reported a correct page as
    // broken the first time it ran.
    if (!/import LabPageShell from ['"][^'"]*\/LabPageShell['"]/.test(src)) noImport.push(relative(root, page));
    const opens = (src.match(/<LabPageShell[\s>]/g) || []).length;
    const closes = (src.match(/<\/LabPageShell>/g) || []).length;
    if (opens === 0) noRender.push(relative(root, page));
    // EVERY OPENING IS CLOSED, which is what catches a wrapper removed from
    // ONE render branch. Several of these pages return early while loading and
    // wrap both branches; asserting "at least one opening" let a mutation
    // replace the main branch's wrapper with a plain <div> and stay green,
    // leaving the page flush with no gutters in its normal state. No page uses
    // the self-closing form, so a count is exact rather than approximate.
    if (opens !== closes) unbalanced.push(`${relative(root, page)} (${opens} open, ${closes} closed)`);
  }
  assert.deepEqual(noImport, [],
    `these tool pages do not import LabPageShell from the shared module: ${noImport.join(', ')}`);
  assert.deepEqual(noRender, [],
    `these tool pages import LabPageShell and never render it, so they own no gutters `
    + `while the shell has stopped providing any: ${noRender.join(', ')}`);
  assert.deepEqual(unbalanced, [],
    `these tool pages open and close LabPageShell a different number of times, so at least one `
    + `render branch is unwrapped: ${unbalanced.join(', ')}`);
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
