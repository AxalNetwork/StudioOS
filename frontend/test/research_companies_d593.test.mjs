/**
 * D593 — the C0 board of "Pages · Founder Research Analysis", and the dark
 * pair of the current zone pill the Research canvases draw.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_companies_d593.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import ZoneNav from '../src/workspaces/ZoneNav.jsx';
import { ACCENT, bucketsFor } from '../src/workspaces/shellConfig.js';
import { directoryTabLabel } from '../src/pages/research/CompanyDirectoryZone.jsx';
import { companyHref } from '../src/lib/companyDirectoryView.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ZONE = read('frontend/src/pages/research/CompanyDirectoryZone.jsx');
const ANALYSIS = read('frontend/src/pages/research/CompanyAnalysis.jsx');
const CANDIDATE = read('frontend/src/pages/research/CompanyCandidate.jsx');
const CANVAS = read('design/canvases/integrated/Pages · Company analysis.dc.html');

const between = (src, from, to) => {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `missing: ${from}`);
  const b = src.indexOf(to, a + from.length);
  assert.ok(b > a, `missing after ${from}: ${to}`);
  return src.slice(a, b);
};

test('the canvas still says what this builds', () => {
  assert.ok(CANVAS.includes('Companies tab · Directory (300) is the default view'));
  assert.ok(CANVAS.includes('a competitor row links to its directory profile when one exists'));
});

test('the Directory tab carries the directory\'s size, and no number before one is read', () => {
  assert.equal(directoryTabLabel(300), 'Directory (300)');
  assert.equal(directoryTabLabel(2616), 'Directory (2,616)');
  assert.equal(directoryTabLabel(0), 'Directory (0)');
  assert.equal(directoryTabLabel(null), 'Directory');
  assert.equal(directoryTabLabel(undefined), 'Directory');
  assert.equal(directoryTabLabel(Number.NaN), 'Directory');
});

test('the size is the whole directory\'s, read from the API, never the filtered page', () => {
  const load = between(ZONE, 'const load = useCallback(async () => {', '}, [key, reads, onTotal]);');
  assert.match(load, /onTotal\?\.\(data\.coverage\?\.of \?\? null\)/);
  assert.doesNotMatch(load, /onTotal\?\.\(data\.total/);
  // On Saved analyses, where the directory is not mounted, one row is read for it.
  assert.match(ZONE, /researchCompaniesApi\.list\(\{ limit: 1 \}\)/);
  assert.match(ZONE, /if \(tab !== 'analyses' \|\| total != null\) return undefined;/);
  assert.match(ZONE, /\{t\.key === 'directory' \? directoryTabLabel\(total\) : t\.label\}/);
  assert.match(ZONE, /<Directory role=\{role\} zoneActions=\{zoneActions\} onTotal=\{onTotal\}/);
  // Directory stays the default tab.
  assert.match(ZONE, /const tab = params\.get\('tab'\) === 'analyses' \? 'analyses' : 'directory';/);
});

test('a competitor links to its directory profile only when the read names one', () => {
  assert.equal(companyHref('q1 x'), '/research/companies/company/q1%20x');
  const row = between(ANALYSIS, '{candidates.map((c) => (', '</tr>');
  assert.match(row, /\{c\.directory_uid \? \(\s*<Link to=\{companyHref\(c\.directory_uid\)\}/);
  assert.match(row, /Directory profile →/);
  // The name still opens the competitor's own page (D313).
  assert.match(row, /to=\{`\/research\/companies\/\$\{encodeURIComponent\(id\)\}\/\$\{encodeURIComponent\(c\.id\)\}`\}/);
  assert.match(CANDIDATE, /\{candidate\.directory_uid \? \(\s*<Link to=\{companyHref\(candidate\.directory_uid\)\}/);
});

test('a directory that could not be read says so, instead of reading as no profile', () => {
  assert.match(ANALYSIS, /analysis\?\.directory_match === 'unreadable' && candidates\.length \? \(/);
  assert.match(ANALYSIS, /Directory profiles: Unreadable\./);
});

function renderNav(role, path) {
  const bucket = bucketsFor(role).find((b) => path.startsWith(b.prefix));
  return renderToStaticMarkup(
    React.createElement(MemoryRouter, { initialEntries: [path] },
      React.createElement(ZoneNav, { bucket, role })),
  );
}

test('the current zone pill takes its role\'s dark pair; idle pills keep the neutrals', () => {
  for (const role of ['founder', 'partner', 'investor', 'advisor']) {
    const bucket = bucketsFor(role).find((b) => b.prefix === '/research') || bucketsFor(role)[0];
    const zone = bucket.zones[1] || bucket.zones[0];
    const html = renderNav(role, `${bucket.prefix}/${zone.slug}`);
    const current = (html.match(/<a[^>]*aria-current="page"[^>]*>/g) || [])[0] || '';
    assert.ok(current, `${role}: no current pill`);
    assert.ok(current.includes('dark:bg-[var(--zn-bg-dark)]'), `${role}: the current pill has no dark ground`);
    assert.ok(current.includes('dark:text-[color:var(--zn-ink-dark)]'), `${role}: the current pill has no dark ink`);
    assert.ok(current.includes(`--zn-bg-dark:${ACCENT[role].tintDark}`), `${role}: the dark ground is not the role's tintDark`);
    assert.ok(current.includes(`--zn-ink-dark:${ACCENT[role].deepDark}`), `${role}: the dark ink is not the role's deepDark`);
    const idle = (html.match(/<a[^>]*>/g) || []).filter((a) => !a.includes('aria-current'));
    assert.ok(idle.length > 0);
    for (const a of idle) {
      assert.ok(a.includes('dark:bg-transparent'), `${role}: an idle pill lost its dark neutrals`);
      assert.ok(!a.includes('--zn-bg-dark'), `${role}: an idle pill carries the current pill's dark pair`);
    }
  }
});
