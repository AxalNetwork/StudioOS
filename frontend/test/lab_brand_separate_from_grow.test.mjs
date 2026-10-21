import { actual, checks } from './_founder_tool_checks.mjs';
/**
 * Two brand pages, kept apart: the Spin-Out Lab tool at `/spinout-lab/brand`
 * and Grow's own Brand page, the brand builder at `/build/brand`. #2343 folded
 * Grow's second brand page (`/grow/brand`) into the builder: the old address
 * forwards there, and what it read (`BrandPagesSection`) renders on it.
 *
 * THE REPORT. The Lab tool rendered inside the Grow workspace — the
 * "FOUNDER / GROW · Get customers, people, reach" header, the Grow tab bar
 * (Talent · Brand · Launch · Perks · Network effects) and the Eadwyn "Brand
 * builder assist" rail — and every Grow door to "Brand" (the tab, the
 * sidebar's highlight, the zone's New page action, the page's closing link)
 * led into the Lab tool. So the two pages were one page wearing two names.
 *
 * WHAT THIS PINS, both directions:
 *   - the Lab route renders the Lab page bare: no Grow shell, no Grow tab bar,
 *     and the page itself mounts no assist rail;
 *   - nothing on the Grow side links the Lab tool: the tab and the zone action
 *     open the brand builder (/build/brand),
 *     the sidebar's Grow row does not claim the Lab URL, and the shell does
 *     not record /grow/brand as the Lab tool's successor.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/lab_brand_separate_from_grow.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { routeBlock } from './_routes.mjs';
import { legacyRedirects } from '../src/workspaces/shellConfig.js';

const read = (p) => codeOnly(readFileSync(resolve(process.cwd(), p), 'utf8'));
const APP = read('frontend/src/App.jsx');

test('the Lab brand route renders the Lab page bare — no Grow shell, no Grow tab bar', () => {
  const block = routeBlock(APP, '/spinout-lab/brand');
  assert.ok(block, 'the Lab brand route is gone');
  assert.match(block, /guard\(labRoles\(\['admin', 'founder'\]\), <SpinoutLabBrandPage \/>\)/);
  assert.doesNotMatch(block, /founderWorkspace\(/, 'the Lab tool is wrapped in a founder workspace shell');
  assert.doesNotMatch(block, /FounderWorkspaceTabs/, 'the Lab tool renders a founder tab bar');
});

test('the Lab brand page mounts no Eadwyn rail', () => {
  const page = read('frontend/src/pages/SpinoutLabBrandPage.jsx');
  assert.doesNotMatch(page, /AssistLayout/, 'the Lab brand page draws the Brand builder assist rail');
  assert.match(page, /\n  return page;\n\}\s*$/, 'the page no longer returns its own markup unwrapped');
});

test('Grow\'s own Brand page stays Grow\'s, and is its tab', () => {
  // #2343: one brand page. The builder renders in Grow's shell and carries
  // what Grow's Brand page read; the old address forwards, query and hash kept.
  assert.match(routeBlock(APP, '/build/brand'), /guard\(labRoles\(\['admin', 'founder'\]\), founderWorkspace\('grow', <BrandBuilderPage \/>\)\)/);
  const forward = routeBlock(APP, '/grow/brand');
  assert.match(forward, /<Navigate replace to=\{\{ pathname: '\/build\/brand', search: location\.search, hash: location\.hash \}\} \/>/);
  assert.doesNotMatch(forward, /FounderGrowBrand/, '/grow/brand renders a page again');
  assert.match(read('frontend/src/pages/BrandBuilderPage.jsx'), /<BrandPagesSection projectId=\{projectId\} projectName=\{project\?\.name\} \/>/,
    "the builder dropped Grow's pages, leads and conversion");
  for (const zone of ['Focus', 'Talent', 'Customers', 'Partnerships', 'Launch']) {
    assert.ok(read(`frontend/src/pages/founder/FounderGrow${zone}.jsx`).includes("['Brand', `/build/brand${query}`]"), `Grow · ${zone}'s Brand tab left the builder`);
  }
  checks.doors(actual);
});

test('nothing on the Grow side links or claims the Lab tool', () => {
  const brand = read('frontend/src/pages/founder/BrandPagesSection.jsx');
  assert.ok(!brand.includes('/spinout-lab/brand'), 'the Grow Brand section links the Lab tool');

  const actions = read('frontend/src/workspaces/founderZoneActions.js');
  const zone = actions.slice(actions.indexOf("'grow/brand': ["), actions.indexOf('],', actions.indexOf("'grow/brand': [")));
  assert.match(zone, /\{ label: 'New page', to: '\/build\/brand' \}/);
  assert.ok(!zone.includes('/spinout-lab/brand'), "Grow's New page action opens the Lab tool");

  const sidebar = read('frontend/src/sidebarConfig.js');
  const growRow = sidebar.slice(sidebar.indexOf("{ to: '/grow', icon: TrendingUp"), sidebar.indexOf('] },', sidebar.indexOf("{ to: '/grow', icon: TrendingUp")));
  assert.ok(growRow.includes("'/build/brand'"), 'the Grow row no longer claims the brand builder');
  assert.ok(!growRow.includes('/spinout-lab/brand'), 'the Grow sidebar row lights up on the Lab tool');

  assert.ok(!legacyRedirects('founder').some((r) => r.from === '/spinout-lab/brand'),
    'the shell records /grow/brand as the Lab tool\'s successor');
});
