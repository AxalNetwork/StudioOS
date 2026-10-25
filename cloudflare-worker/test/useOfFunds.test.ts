// Task #2 — Use of Funds allocator helpers (THE ASK).
//
// Pins the JSON-first parse, the storage normalize/validate contract, and the
// human-readable formatter — including the colon-in-label case that motivated
// storing JSON rather than a delimited string.
//
// Pure node:test — runs under `npm run test:drift` via the --strip-types list.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseUseOfFundsValue,
  normalizeUseOfFunds,
  formatUseOfFundsText,
} from '../src/util/useOfFunds.ts';

const CANON = JSON.stringify([
  { label: 'Product & engineering', pct: 45 },
  { label: 'GTM: sales and marketing', pct: 30 },
  { label: 'Infrastructure & data', pct: 25 },
]);

test('parseUseOfFundsValue: JSON-first with colon labels and drop-zero', () => {
  const parsed = parseUseOfFundsValue(JSON.stringify([
    { label: 'Product & engineering', pct: 50 },
    { label: 'GTM: sales and marketing', pct: 50 },
    { label: 'Infrastructure & data', pct: 0 },
  ]));
  assert.deepEqual(parsed, [
    { label: 'Product & engineering', pct: 50 },
    { label: 'GTM: sales and marketing', pct: 50 },
  ]);
});

test('D1174: unknown sections are not a recorded split', () => {
  const six = Array.from({ length: 6 }, (_, i) => ({ label: `S${i}`, pct: 10 }));
  assert.deepEqual(parseUseOfFundsValue(JSON.stringify(six)), []);
});

test('D1174: legacy text needs canonical labels; unknown labels stay unrecorded', () => {
  assert.deepEqual(parseUseOfFundsValue('Eng 55%, GTM 30%, Ops 15%'), []);
  for (const text of ['Product & engineering 150%', 'Product & engineering 100%; unreadable row']) assert.deepEqual(parseUseOfFundsValue(text), []);
  assert.deepEqual(parseUseOfFundsValue('Product & engineering 60%; GTM: sales and marketing 40%'), [
    { label: 'Product & engineering', pct: 60 }, { label: 'GTM: sales and marketing', pct: 40 },
  ]);
});

 test('D1174: one canonical key reader rejects malformed, duplicate, unknown and incomplete splits', () => {
  for (const value of ['[', '[]', '[null]', '[{"label":"Other","pct":100}]',
    '[{"key":"other","label":"Product & engineering","pct":100}]',
    '[{"key":"product","pct":50}]', '[{"key":"product","pct":50},{"key":"product","pct":50}]',
    '[{"key":"product","pct":0},{"key":"product","pct":100}]',
    '[{"key":"product","pct":[100]}]', '[{"key":"product","pct":null}]', '[{"key":"product","pct":true}]', '[{"key":"product","pct":""}]']) {
    assert.deepEqual(parseUseOfFundsValue(value), [], value);
  }
  assert.deepEqual(parseUseOfFundsValue('[{"key":"reserve","pct":30},{"key":"product","pct":70}]'), [
    { label: 'Product & engineering', pct: 70 }, { label: 'Hiring / runway reserve', pct: 30 },
  ]);
});

test('parseUseOfFundsValue: empty / null → []', () => {
  assert.deepEqual(parseUseOfFundsValue(''), []);
  assert.deepEqual(parseUseOfFundsValue(null), []);
  assert.deepEqual(parseUseOfFundsValue(undefined), []);
});

test('normalizeUseOfFunds: valid 100% → canonical JSON (colons preserved)', () => {
  const { value, error } = normalizeUseOfFunds(CANON);
  assert.equal(error, undefined);
  assert.equal(value, CANON);
  // colon label survives a round-trip through normalize → parse
  assert.equal(parseUseOfFundsValue(value)[1].label, 'GTM: sales and marketing');
});

test('normalizeUseOfFunds: empty / whitespace / all-zero → null, no error', () => {
  assert.deepEqual(normalizeUseOfFunds(''), { value: null });
  assert.deepEqual(normalizeUseOfFunds('   '), { value: null });
  assert.deepEqual(
    normalizeUseOfFunds(JSON.stringify([{ label: 'A', pct: 0 }, { label: 'B', pct: 0 }])),
    { value: null },
  );
});

test('normalizeUseOfFunds: sum !== 100 → error', () => {
  const { value, error } = normalizeUseOfFunds(JSON.stringify([
    { label: 'A', pct: 40 }, { label: 'B', pct: 40 },
  ]));
  assert.equal(value, null);
  assert.match(error ?? '', /100%/);
});

test('normalizeUseOfFunds: out-of-range pct → error', () => {
  const { error } = normalizeUseOfFunds(JSON.stringify([{ label: 'A', pct: 150 }]));
  assert.match(error ?? '', /between 0 and 100/);
});

test('normalizeUseOfFunds: malformed JSON array → error', () => {
  const { error } = normalizeUseOfFunds('[not json');
  assert.match(error ?? '', /not valid JSON/);
});

test('normalizeUseOfFunds: legacy free-text passes through unchanged', () => {
  assert.deepEqual(normalizeUseOfFunds('Hire two engineers and run ads'), {
    value: 'Hire two engineers and run ads',
  });
});

test('formatUseOfFundsText: canonical JSON → readable; unknown text and empty → ""', () => {
  assert.equal(
    formatUseOfFundsText(CANON),
    'Product & engineering 45%; GTM: sales and marketing 30%; Infrastructure & data 25%',
  );
  assert.equal(formatUseOfFundsText('Eng 60%, GTM 40%'), '');
  assert.equal(formatUseOfFundsText(''), '');
  assert.equal(formatUseOfFundsText(null), '');
});
