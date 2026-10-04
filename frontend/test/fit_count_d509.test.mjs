/**
 * D509 — a best-fit type whose count was not sent shows no badge, never "0".
 *
 * MatchSummaryCard fetches its own data, so this pins the two halves that
 * decide the badge: `fitCount` (the value, or null when absent) and the
 * badge's own markup (drawn only when that value is not null).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fitCount } from '../src/components/profile/ProfileFitSection.jsx';

const SRC = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../src/components/profile/ProfileFitSection.jsx'),
  'utf8',
);

test('an absent count is null, never 0', () => {
  for (const absent of [undefined, null, '', '   ', 'n/a', NaN, Infinity, [], {}, true]) {
    assert.equal(fitCount(absent), null, `${String(absent)} read as a count`);
  }
});

test('a measured count, including a real zero, is kept', () => {
  assert.equal(fitCount(0), 0, 'a measured zero is a number, not an absence');
  assert.equal(fitCount(7), 7);
  assert.equal(fitCount('12'), 12);
  assert.equal(fitCount('0'), 0);
});

test('the badge is drawn only when fitCount has a value, and never falls back to 0', () => {
  // Comments are stripped: fitCount's own doc comment quotes the old fallback.
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /Number\(t\.count\)\s*\|\|\s*0/, 'the zero fallback came back');
  assert.match(SRC, /\{fitCount\(t\.count\) !== null \? \(\s*<span[^>]*>\{fitCount\(t\.count\)\}<\/span>\s*\) : null\}/,
    'the badge is no longer gated on fitCount');
});
