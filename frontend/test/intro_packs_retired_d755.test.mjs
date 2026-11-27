// D755 (#1915, PR 1) — Introduction packs are no longer sold. Nothing in the
// SPA offers one: no section, no link to it, no "Buy credits", and no client
// method that would mint a pack's PaymentIntent. Credits already bought still
// spend, and Refer & earn stays.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../src/', import.meta.url).pathname;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(jsx?|tsx?|css|html)$/.test(name) ? [p] : [];
  });
}

test('D755: "Introduction packs", "introduction-packs" and "Buy credits" appear nowhere in frontend/src', () => {
  const all = files(SRC);
  assert.ok(all.length > 100, 'the walk found the source tree');
  for (const needle of ['Introduction packs', 'introduction-packs', 'Buy credits']) {
    const hits = all.filter((p) => readFileSync(p, 'utf8').includes(needle)).map((p) => p.slice(SRC.length));
    assert.deepEqual(hits, [], `"${needle}" is still in ${hits.join(', ')}`);
  }
});

test('D755: the client no longer mints a pack, and the page is titled Plans & Pricing', () => {
  const api = readFileSync(join(SRC, 'lib/api.js'), 'utf8');
  assert.doesNotMatch(api, /introPacks\s*:/);
  assert.doesNotMatch(api, /introCreditsIntent\s*:/);
  assert.doesNotMatch(api, /\/payments\/intro-credits\/intent/);
  const page = readFileSync(join(SRC, 'pages/ProductsPage.jsx'), 'utf8');
  assert.doesNotMatch(page, /IntroPacksSection/);
  assert.match(page, /Plans &amp; Pricing/);
  assert.match(page.replace(/\s+/g, ' '), /One clear catalog — plans, token packs, and add-ons\. Purchased in-app, or unlocked with a promo code\./);
});

test('D755: the Introductions panel keeps Refer & earn and says how credits come back', () => {
  const panel = readFileSync(join(SRC, 'pages/IntroductionsPanel.jsx'), 'utf8').replace(/\s+/g, ' ');
  assert.match(panel, /Refer &amp; earn \+1 each/);
  assert.match(panel, /You're out of introduction credits\. Your allowance of \{credits\.monthly_allowance\} replenishes next month — or earn one credit per referred member\./);
  assert.match(panel, /Your monthly allowance replenishes automatically\. To keep going now, earn one credit for every member you refer\./);
  assert.doesNotMatch(panel, /credit pack/);
  assert.doesNotMatch(panel, /outOfCredits\.packs/);
});
