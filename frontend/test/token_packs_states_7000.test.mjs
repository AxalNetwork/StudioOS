/**
 * #7000 (X18): /pricing/products' token packs end in a settled state.
 *
 *   1  A read maps to one state: a list of sellable packs is ready, an empty
 *      list with no custom amount is empty, anything else is unavailable
 *      (never an empty list, never zero).
 *   2  Each state draws its own words: a skeleton while loading (no
 *      "Loading token packs…" text), "Prices unavailable." with Try again on
 *      failure, "No token packs are offered yet." when nothing is offered.
 *      No settled state leaves the loading text or skeleton on screen.
 *   3  The read cannot stay loading: `/public/plans-and-packs` takes the 30 s
 *      default request deadline, so a read that never answers rejects, and the
 *      section's catch shows Prices unavailable.
 *   4  The page links to /pricing: "Looking for plans? Compare plans →".
 *
 * Mount flows (Try again re-reads, visitors get Sign in to buy) stay in
 * checkout_token_pack_d755.test.mjs.
 *
 * Mutation checked (each broke a test below, then was restored):
 *   · packsReading returns ready for a non-array read → test 1 fails.
 *   · packsReading drops the empty branch (empty list is ready) → test 1 fails.
 *   · a custom amount alone reads as empty → test 1 fails.
 *   · the unavailable body loses its Try again button → test 2 fails.
 *   · the loading state renders "Loading token packs…" text → test 2 fails.
 *   · plansAndPacks opts out of the deadline (`timeoutMs: null`) → test 3 fails.
 *   · the catch keeps loading instead of unavailable → test 3 fails.
 *   · the Compare plans link points elsewhere → test 4 fails.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/token_packs_states_7000.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PacksBody, packsReading, PACKS_EMPTY, PACKS_UNAVAILABLE } from '../src/components/products/TokenPacksSection.jsx';
import { deadlineFor, DEFAULT_TIMEOUT_MS } from '../src/lib/api.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const PACK = { uid: 'pack25', price_id: 'price_Fixture25', unit_amount: 2500, currency: 'usd', active: true };
const view = (reading, user = null) => renderToStaticMarkup(React.createElement(PacksBody, { reading, user, onRetry: () => {} }));

test('1: a read maps to ready, empty or unavailable, never a silent zero', () => {
  assert.equal(packsReading({ packs: [PACK] }).status, 'ready');
  assert.deepEqual(packsReading({ packs: [PACK] }).packs, [PACK]);
  assert.deepEqual(packsReading({ packs: [] }), { status: 'empty', packs: [], custom: null });
  for (const bad of [null, undefined, {}, { packs: 'none' }, { packs: [{ ...PACK, currency: 'eur' }] }]) {
    assert.equal(packsReading(bad).status, 'unavailable', JSON.stringify(bad));
  }
  const custom = packsReading({ packs: [], custom: { price_id: 'price_FixtureAny', unit_amount: 100, currency: 'usd', min_cents: 500, max_cents: 50000 } });
  assert.equal(custom.status, 'ready', 'a custom amount alone is offered, not empty');
  assert.equal(custom.custom, 'Any amount from $5 to $500');
});

test('2: each state draws its own words, and no settled state keeps the loading text', () => {
  const loading = view({ status: 'loading', packs: [], custom: null });
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /data-testid="token-packs-skeleton"/);
  assert.doesNotMatch(loading, /Loading token packs…/, 'a skeleton, not a sentence that can hang');

  const unavailable = view({ status: 'unavailable', packs: [], custom: null });
  assert.equal(PACKS_UNAVAILABLE, 'Prices unavailable.');
  assert.match(unavailable, /role="alert"/);
  assert.match(unavailable, /Prices unavailable\./);
  assert.match(unavailable, /<button type="button"[^>]*>Try again<\/button>/);
  assert.doesNotMatch(unavailable, /\$0|\b0 packs|<a /, 'a failed read never shows 0 or a buy link');

  const empty = view({ status: 'empty', packs: [], custom: null });
  assert.equal(PACKS_EMPTY, 'No token packs are offered yet.');
  assert.match(empty, /No token packs are offered yet\./);
  assert.doesNotMatch(empty, /<a /);

  const ready = view({ status: 'ready', packs: [PACK], custom: null });
  assert.match(ready, /\$25 of tokens/);
  assert.match(ready, /Sign in to buy/);
  for (const settled of [unavailable, empty, ready]) {
    assert.doesNotMatch(settled, /Loading token packs|aria-busy/);
  }
});

test('3: the read always settles: it keeps the default deadline, and a rejection shows unavailable', () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 30_000);
  assert.equal(deadlineFor('/public/plans-and-packs'), DEFAULT_TIMEOUT_MS);
  const client = read('../src/lib/api/publicPricing.js');
  assert.match(client, /plansAndPacks: \(\) => request\('\/public\/plans-and-packs'\),/, 'no timeoutMs override on the read');
  const section = read('../src/components/products/TokenPacksSection.jsx');
  assert.match(section, /\.catch\(\(\) => \{ if \(!stopped\) setReading\(\{ status: 'unavailable', packs: \[\], custom: null \}\); \}\);/);
});

test('4: the page points visitors who want plans at /pricing', () => {
  const page = read('../src/pages/ProductsPage.jsx');
  assert.match(page, /Looking for plans\? <Link to="\/pricing"[^>]*>Compare plans →<\/Link>/);
  assert.ok(page.indexOf('products-compare-plans') < page.indexOf('<TokenPacksSection'), 'at the top, before the packs');
});
