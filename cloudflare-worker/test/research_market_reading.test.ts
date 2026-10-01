/**
 * One market reading. Catalog cents stay out of the range, a stale run cannot
 * be attached, and the quote must belong to the caller's partner profile.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  catalogPriceCents,
  proposalName,
  readingAgeDays,
  readingIsStale,
} from '../src/services/marketReadingRead.ts';

const routes = readFileSync(new URL('../src/routes/research.ts', import.meta.url), 'utf8');

const NOW = Date.parse('2026-09-21T00:00:00Z');

test('catalog cents are the list price, and a missing price is not zero', () => {
  assert.equal(catalogPriceCents(4_500_000, 1), 4_500_000);
  assert.equal(catalogPriceCents(null, 45), 4500);
  assert.equal(catalogPriceCents(null, null), null);
  assert.equal(catalogPriceCents(undefined, undefined), null);
});

test('a proposal name is a need title, and a blank one stays blank', () => {
  assert.equal(proposalName('  Design system  '), 'Design system');
  assert.equal(proposalName(''), null);
  assert.equal(proposalName(null), null);
});

test('age is the run date, and ninety days blocks attachment', () => {
  assert.equal(readingAgeDays('2026-08-28', NOW), 24);
  assert.equal(readingIsStale('2026-08-28', NOW), false);
  assert.equal(readingAgeDays('2026-08-10', NOW), 42);
  assert.equal(readingIsStale('2026-08-10', NOW), false);
  assert.equal(readingAgeDays('2026-05-14', NOW), 130);
  assert.equal(readingIsStale('2026-05-14', NOW), true);
  assert.equal(readingIsStale('not-a-date', NOW), true);
});

test('GET /market-readings/:uid is the owner and keeps the catalog price beside the range', () => {
  const getAt = routes.indexOf("research.get('/market-readings/:uid'");
  assert.ok(getAt > 0);
  const handler = routes.slice(getAt, routes.indexOf("research.delete('/market-readings/:uid'"));
  assert.match(handler, /requireAuth\(c\)/);
  assert.match(handler, /r\.owner_user_id = \?/);
  assert.match(handler, /detail: 'not_found'/);
  assert.match(handler, /catalog_price_cents: catalogPriceCents/);
  assert.match(handler, /proposal_name: proposalName/);
  assert.doesNotMatch(handler, /range_low_cents \+ catalog|catalog_price_cents \+ row\.range/);
});

test('a reading attaches only to the caller’s quote, and a stale one is refused', () => {
  const post = routes.slice(
    routes.indexOf("research.post('/attachments'"),
    routes.indexOf("research.delete('/attachments/:uid'"),
  );
  assert.match(post, /SELECT id FROM quotes WHERE id = \? AND partner_id = \?/);
  assert.doesNotMatch(post, /AND provider_user_id/);
  assert.match(post, /readingIsStale\(reading\.ran_at\)/);
  assert.match(post, /detail: 'reading_stale'/);
});
