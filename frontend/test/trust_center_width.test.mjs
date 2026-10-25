// #2060 — the Trust Center takes the full width of the main column, and its
// tab strip draws no vertical scroll bar.
//
// The width is two facts: `/trust` is in `SHARED_FULL_BLEED`, so App's shell
// drops its 1280px column and its padding for every role, and the page's own
// desktop wrapper carries no `max-w-*` of its own. The scroll bar came from
// `-mb-px` on each tab pushing it 1px past a strip whose `overflow-x: auto`
// also makes `overflow-y` auto; the strip now draws its baseline as an inset
// shadow, so the tabs fit it and need no negative margin.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FOUNDER_FULL_BLEED, INVESTOR_FULL_BLEED, ADVISOR_FULL_BLEED, PARTNER_FULL_BLEED,
  SHARED_FULL_BLEED, SHARED_FULL_BLEED_PREFIXES,
} from '../src/sidebarConfig.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const app = read('frontend/src/App.jsx');
const page = read('frontend/src/pages/TrustCenterPage.jsx');

const BY_ROLE = { founder: FOUNDER_FULL_BLEED, investor: INVESTOR_FULL_BLEED, advisor: ADVISOR_FULL_BLEED, partner: PARTNER_FULL_BLEED };
/** App.jsx's width rule for a path that is not a fund child page or a cycle page. */
const fullWidth = (role, path) => (BY_ROLE[role] || []).includes(path)
  || SHARED_FULL_BLEED.includes(path)
  || SHARED_FULL_BLEED_PREFIXES.some((prefix) => path.startsWith(prefix))
  || role === 'advisor';

test('#2060 /trust is full width for every role, through the shell\'s own rule', () => {
  assert.ok(SHARED_FULL_BLEED.includes('/trust'));
  // The rule this test mirrors is the one App.jsx applies.
  assert.match(app, /\|\| SHARED_FULL_BLEED\.includes\(location\.pathname\)/);
  assert.match(app, /const fullWidthSurface = fullBleedSurface\b/);
  assert.match(app, /const flushSurface = fullBleedSurface;/);
  assert.match(app, /\$\{fullWidthSurface \? '' : 'max-w-7xl mx-auto w-full'\}/);
  for (const role of ['founder', 'partner', 'admin', 'exploring', 'investor', 'advisor']) {
    assert.equal(fullWidth(role, '/trust'), true, role);
  }
});

test('#2060 the desktop wrapper carries no width cap; the phone view is unchanged', () => {
  const desktop = page.match(/if \(phone\) \{\s*return \(\s*<TrustPhoneView[\s\S]*?\n  return \(\s*<div className="([^"]*)">/);
  assert.ok(desktop, 'the desktop return follows the phone branch');
  const classes = desktop[1].split(/\s+/);
  assert.ok(classes.includes('p-6'), 'the page keeps its own gutter');
  assert.ok(!classes.some((c) => /^max-w-/.test(c) || c === 'mx-auto'), `no cap on the page: ${desktop[1]}`);
  assert.match(page, /<TrustPhoneView status="ready" obligations=\{obligations\} reload=\{load\} onSelect=\{selectTab\}>/);
  // D1073 removes the sanctions form. The page/phone width assertions above
  // remain; admin links and absent screening controls are tested mounted.
});

test('#2060 the tab strip scrolls sideways and its tabs fit it, so no vertical scroll bar is drawn', () => {
  const strip = page.match(/<div id="trust-tabs" className="([^"]*)"/);
  assert.ok(strip);
  const s = strip[1].split(/\s+/);
  assert.ok(s.includes('overflow-x-auto'), 'it still scrolls sideways when narrow');
  assert.ok(!s.some((c) => /^border-b/.test(c)), 'the baseline is not a border the tabs must overlap');
  assert.ok(s.some((c) => /^shadow-\[inset_0_-1px_0_/.test(c)) && s.some((c) => /^dark:shadow-\[inset_0_-1px_0_/.test(c)), 'it draws its baseline as an inset shadow, in both themes');
  const tab = page.match(/data-testid=\{`trust-tab-\$\{t\.key\}`\}[\s\S]*?className=\{`([^`$]*)/);
  assert.ok(tab);
  const t = tab[1].split(/\s+/);
  assert.ok(t.includes('border-b-2'), 'the active tab keeps its 2px underline');
  assert.ok(!t.some((c) => /^-m[by]-/.test(c)), 'no negative margin pushes a tab past the strip');
});
