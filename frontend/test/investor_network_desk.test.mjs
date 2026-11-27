/**
 * The investor Network desk's `Founders` and `Asked` chips are live.
 *
 * WHAT WAS HERE. Both sat disabled with one shared reason — "nothing records
 * who asked" / "the payload carries the counterpart’s name and email without
 * their role" — and both reasons were false:
 *
 *   · `/partnernet/relationships` joined `users` for the counterpart's name
 *     and email and simply did not select `role`. It does now, so `Founders`
 *     narrows the book on `other.role`.
 *   · An investor's own asks are stored in `investor_introductions` and served
 *     by `GET /api/introductions` (`api.listIntroductions`), so `Asked` has a
 *     collection to show. `Offered` keeps a reason of its own: an introduction
 *     you gave is value-add support, not a row on this desk.
 *
 * Pinned at the page (the narrowing and the load) and at the filter table
 * (the entries are live keys now), since a live key the page never uses is
 * the exact defect `profile_zone_filters.test.mjs` exists to catch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { INVESTOR_ZONE_FILTERS } from '../src/workspaces/investorZoneFilters.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const page = codeOnly(read('frontend/src/pages/investor/InvestorNetworkWorkspace.jsx'));

test('the filter table declares Founders and Asked as live keys', () => {
  const relationships = INVESTOR_ZONE_FILTERS['network/relationships'];
  const founders = relationships.find((r) => r.canvas === 'Founders');
  assert.equal(founders.key, 'founders', 'Founders must be a live chip');
  assert.ok(!founders.unbuilt, 'Founders still states an unbuilt reason');

  const introductions = INVESTOR_ZONE_FILTERS['network/introductions'];
  const asked = introductions.find((r) => r.canvas === 'Asked');
  assert.equal(asked.key, 'asked', 'Asked must be a live chip');
  assert.ok(!asked.unbuilt, 'Asked still states an unbuilt reason');

  // Offered stays unbuilt, but the reason can no longer claim nothing records
  // who asked — the asks store is exactly what the Asked chip reads.
  const offered = introductions.find((r) => r.canvas === 'Offered');
  assert.ok(offered.unbuilt, 'Offered must remain prose — nothing on this desk records an intro you gave');
  assert.ok(!/nothing records who asked/.test(offered.unbuilt),
    'Offered’s reason still denies the asks store the Asked chip reads');
});

test('the Founders chip narrows the book on the counterpart role', () => {
  assert.match(page, /bookView === 'founders'/,
    'the page never reads the founders view');
  assert.match(page, /item\.other\?\.role/,
    'the narrowing must read the counterpart role the route now returns');
});

test('the Asked view loads and renders the investor’s own asks', () => {
  assert.match(page, /api\.listIntroductions\(\)/,
    'the desk never loads investor_introductions');
  assert.match(page, /deskView === 'asked'/,
    'the page never reads the asked view');
  // A failed asks read is its own absence, not folded into the propositions
  // error and not an empty list.
  assert.match(page, /errors\.asks/, 'a failed asks read must be its own error');
  // And the export follows the view: the Asked chip exports the asks, not the
  // propositions the other views show.
  assert.match(page, /deskView === 'asked' \? \{ header: \['Target', 'Status', 'Quarter', 'Asked'\]/,
    'the export view must switch to the asks when the Asked chip is selected');
});
