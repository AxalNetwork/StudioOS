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

test('investor sidebar matches the approved nine-row canvas exactly', () => {
  assert.deepEqual(labels, [
    'Home',
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
  assert.deepEqual(targets, [
    '/studio',
    '/spinout-lab',
    '/pipeline',
    '/portfolio/health',
    '/spinout-lab/investor-workspace',
    '/funds',
    '/network',
    '/market-intel',
    '/trust',
  ]);
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
  assert.match(investor, /label: 'Deals', match: \['\/pipeline', '\/deals', '\/raise\/data-room'\]/);
  assert.match(investor, /label: 'Portfolio', match: \['\/portfolio'\]/);
  assert.match(investor, /label: 'Fund', match: \['\/funds', '\/lp-reports'\]/);
  assert.match(investor, /label: 'Network', match: \['\/network', '\/relationships', '\/contacts'\]/);
});

test('investors keep the global Company Settings footer', () => {
  const nav = read('frontend/src/ui/SidebarNav.jsx');
  assert.match(nav, /<div className="flex-none border-t border-gray-200 dark:border-gray-700">[\s\S]*Company Settings/);
});