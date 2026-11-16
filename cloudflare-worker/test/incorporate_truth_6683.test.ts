/**
 * D6683 (#6683) — Incorporate's jurisdictions hold no tax, fee or time claim
 * without a source and a day (D4357), no Atlas, and the packet's boilerplate
 * states no capital amount and no chapter number.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/incorporate_truth_6683.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JURISDICTIONS } from '../src/routes/legal.ts';

/** Every founder-facing string of an entry: its words, not its ids or template keys. */
const words = (j: any): string[] => [j.label, j.country, j.entity_type, j.summary, j.tax_summary, ...(j.pros || []), ...(j.cons || [])]
  .filter((s) => typeof s === 'string');
const CURRENCY = /[$£€¥]|\b(?:S\$|USD|EUR|GBP|SGD)\b|\b\d[\d,.]*\s*(?:k|m)?\s*(?:dollars?|pounds?|euros?)\b/i;
const PERCENT = /%|\bper ?cent\b/i;
const TIME = /\b\d+\s*(?:[–-]\s*\d+\s*)?(?:days?|weeks?|months?|years?)\b|same-day/i;

test('no entry holds a currency amount, a percentage, a time claim or "Atlas" in a founder-facing string', () => {
  assert.equal(JURISDICTIONS.length, 6);
  for (const j of JURISDICTIONS as any[]) {
    for (const s of words(j)) {
      assert.doesNotMatch(s, CURRENCY, `${j.id}: ${s}`);
      assert.doesNotMatch(s, PERCENT, `${j.id}: ${s}`);
      assert.doesNotMatch(s, TIME, `${j.id}: ${s}`);
      assert.doesNotMatch(s, /atlas/i, `${j.id}: ${s}`);
    }
    assert.equal(j.atlas_supported, false, j.id);
    assert.equal(j.est_cost_usd, null, `${j.id}: no cost range without a source`);
    assert.equal(j.time_to_form_days, null, `${j.id}: no timeline without a source`);
    assert.equal(j.tax_summary, null, `${j.id}: no tax summary without a source`);
  }
});

test('ids, labels and structure are kept; the Estonian form reads OÜ', () => {
  assert.deepEqual((JURISDICTIONS as any[]).map((j) => j.id), ['us_de_ccorp', 'us_wy_ccorp', 'us_de_llc', 'uk_ltd', 'sg_pte', 'ee_oy']);
  const ee = (JURISDICTIONS as any[]).find((j) => j.id === 'ee_oy');
  assert.equal(ee.entity_type, 'OÜ');
  assert.match(ee.label, /OÜ/);
  for (const j of JURISDICTIONS as any[]) {
    for (const k of ['label', 'country', 'country_code', 'entity_type', 'summary', 'fundraising_friendly', 'pros', 'cons', 'templates']) assert.ok(k in j, `${j.id}.${k}`);
  }
});

test('the packet boilerplate states no capital amount and no chapter number; legal.ts has no Atlas handoff', () => {
  const packet = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/services/incorporationPacket.ts'), 'utf8');
  assert.doesNotMatch(packet, /EUR 2,500|share capital is EUR/);
  assert.doesNotMatch(packet, /Cap\. 50/);
  assert.match(packet, /private limited company \(O\\u00DC\)/);
  const legal = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/legal.ts'), 'utf8');
  assert.doesNotMatch(legal, /atlas\.stripe\.com|type: 'stripe_atlas'/);
});
