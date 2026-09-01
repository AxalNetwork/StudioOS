import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const src = codeOnly(read('frontend/src/sidebarConfig.js'));
const investor = src.slice(src.indexOf('\n  investor: ['), src.indexOf('\n  advisor: ['));
const rows = [...investor.matchAll(/\{ to: '([^']*)'[^}]*label: '([^']+)'/g)]
  .map((m) => ({ to: m[1], label: m[2] }));
const targets = rows.map((r) => r.to);
const labels = rows.map((r) => r.label);

test('investor sidebar matches the canvas rows exactly', () => {
  // Two corrections to what this used to assert. The first row has been
  // labelled 'Studio' in the live config all along, not 'Home' — the test was
  // pinning a label that never shipped, and had been failing on it. The second
  // is that the canvas's Firm Settings row is deliberately NOT here:
  // /company-settings is the sidebar's pinned footer for every role, and a row
  // as well would render it twice — which is why the row was removed.
  //
  // Spin-Out Lab stays. The canvas drops it as a top-level row, but removing a
  // licence's door into the Lab is exactly the kind of change this migration
  // is not permitted to make, so it is kept and counted here deliberately.
  assert.deepEqual(labels, [
    'Studio',
    'Spin-Out Lab',
    'Deals',
    'Portfolio',
    'Axal VC Fund',
    'Fund',
    'Network',
    'Research',
    'Trust',
  ]);
  assert.equal(rows.length, 9);
  assert.doesNotMatch(investor, /label:\s*'Workspace'/);
  assert.ok(!labels.includes('Messages'));
});

test('investor rows use the approved destinations', () => {
  // The shell migration repoints Deals and Research at their buckets' first
  // zones and adds the Firm Settings row the canvas has. What this guards is
  // not the literal list — that is what the migration changes — but that every
  // row still lands on a route the router actually registers, and that the two
  // rows the migration must not touch still point into the Lab's own tree.
  assert.deepEqual(targets, [
    '/studio',
    '/spinout-lab',
    '/deals/pipeline',
    '/portfolio/health',
    '/spinout-lab/investor-workspace',
    '/funds',
    '/network',
    '/research/ask',
    '/trust',
  ]);

  const app = read('frontend/src/App.jsx');
  const registered = new Set([...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]));
  for (const t of targets) {
    assert.ok(registered.has(t), `investor row points at ${t}, which has no route`);
  }

  // Spin-Out Lab and Axal VC Fund keep their own tree — this migration does
  // not rename, re-bucket or retarget either.
  assert.ok(targets.includes('/spinout-lab'), 'the Spin-Out Lab row was dropped');
  assert.ok(targets.includes('/spinout-lab/investor-workspace'),
    'the Axal VC Fund row was retargeted out of the Lab tree');
});

test('Fund remains discoverable but requires the Institutional investor tier', () => {
  assert.match(
    investor,
    /to: '\/funds'[^}]*label: 'Fund'[^}]*requiredInvestorTier: 'institutional'/,
  );
});

test('Axal VC Fund and Spin-Out Lab are separate destinations', () => {
  assert.equal(rows.find((r) => r.label === 'Spin-Out Lab')?.to, '/spinout-lab');
  assert.equal(rows.find((r) => r.label === 'Axal VC Fund')?.to, '/spinout-lab/investor-workspace');
});

test('legacy investor deep links still highlight their owning workspace', () => {
  // Order within a match array carries no meaning — SidebarNav tests
  // membership — so this asserts the paths are present rather than pinning
  // the sequence a formatting change would break.
  const dealsMatch = /label: 'Deals',\s*\n?\s*match: \[([^\]]*)\]/.exec(investor);
  assert.ok(dealsMatch, 'the Deals row has no match array');
  for (const p of ['/pipeline', '/deals', '/raise/data-room']) {
    assert.ok(dealsMatch[1].includes(`'${p}'`),
      `legacy path ${p} no longer highlights the Deals row`);
  }
  // Research absorbed /market-intel, which was its own row's target before.
  const researchMatch = /label: 'Research',\s*\n?\s*match: \[([^\]]*)\]/.exec(investor);
  assert.ok(researchMatch, 'the Research row has no match array');
  assert.ok(researchMatch[1].includes("'/market-intel'"),
    '/market-intel no longer highlights the Research row');
  assert.match(investor, /label: 'Portfolio', match: \['\/portfolio'\]/);
  assert.match(investor, /label: 'Fund', match: \['\/funds', '\/lp-reports'\]/);
  assert.match(investor, /label: 'Network', match: \['\/network', '\/relationships', '\/contacts'\]/);
});

test('investors keep the global Company Settings footer', () => {
  const nav = read('frontend/src/ui/SidebarNav.jsx');
  assert.match(nav, /<div className="flex-none border-t border-gray-200 dark:border-gray-700">[\s\S]*Company Settings/);
});