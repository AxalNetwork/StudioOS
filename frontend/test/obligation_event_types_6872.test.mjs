// D6872 (#6872) — Grow stores a compliance obligation as event_type 'compliance',
// apart from 'other'. Calendar → Compliance names each type in its own word, on the
// deadline's pill and in New › Compliance deadline's Type list, so the two never
// read as one. The Worker side is cloudflare-worker/test/obligation_event_types_6872.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TYPE_WORDS } from '../src/pages/calendarComplianceModel.js';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('compliance and other are two types, each with its own word', () => {
  assert.equal(TYPE_WORDS.compliance, 'Compliance');
  assert.equal(TYPE_WORDS.other, 'Other');
  const words = Object.values(TYPE_WORDS);
  assert.equal(new Set(words).size, words.length, 'no two types share a word');
});

test('the pill and the Type list both read TYPE_WORDS, so a compliance deadline shows Compliance', () => {
  const sheet = read('frontend/src/pages/CalendarComplianceSheet.jsx');
  assert.match(sheet, /TYPE_WORDS\[c\.event_type\]/);
  assert.match(sheet, /Object\.entries\(TYPE_WORDS\)\.map/);
});

test('the Worker stores Grow\'s compliance kind under its own event type', () => {
  const writers = read('cloudflare-worker/src/services/growWriters.ts');
  assert.match(writers, /compliance: 'compliance'/);
  assert.match(writers, /other: 'other'/);
});
