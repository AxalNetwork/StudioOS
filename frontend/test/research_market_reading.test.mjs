/**
 * One market reading. The list stays at `/research/markets`. Age gates
 * attachment, a save is a new row, and a catalog price is not the range.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  catalogLine,
  comparableCount,
  freshReadingForm,
  rangeReadsForward,
  readingDraft,
  staleAttachmentSentence,
} from '../src/pages/research/marketReadingRead.js';

const page = readFileSync(new URL('../src/pages/research/MarketReading.jsx', import.meta.url), 'utf8');
const list = readFileSync(new URL('../src/pages/research/MarketZone.jsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/lib/api.js', import.meta.url), 'utf8');

test('a catalog price is a line of its own, and a missing one is not zero', () => {
  assert.equal(catalogLine(4_500_000), 'Catalog lists $45,000');
  assert.equal(catalogLine(null), null);
  assert.equal(catalogLine(undefined), null);
});

test('high below low is refused before anything is saved', () => {
  assert.equal(rangeReadsForward('12000', '8000'), false);
  assert.equal(rangeReadsForward('12000', '18000'), true);
  assert.equal(rangeReadsForward('', '18000'), null);
  assert.equal(comparableCount('0').n, null);
  assert.equal(comparableCount('4').n, 4);
});

test('a fresh reading blanks the dollars and does not copy the range', () => {
  const next = freshReadingForm(
    { low: '38000', high: '62000', n: '11', ran_at: '2026-05-14' },
    '2026-09-21',
  );
  assert.equal(next.low, '');
  assert.equal(next.high, '');
  assert.equal(next.ran_at, '2026-09-21');
  assert.equal(next.n, '11');
  assert.doesNotMatch(JSON.stringify(next), /38000|62000/);
});

test('the draft reads this reading and does not invent a second range', () => {
  const enough = readingDraft({ days: 24, band: 'current', comparableCount: 11 });
  assert.match(enough, /24 days old and reads current/);
  assert.match(enough, /11 comparables is enough/);
  assert.match(enough, /none of them are named/);
  assert.doesNotMatch(enough, /\$\d/);

  const thin = readingDraft({ days: 22, band: 'current', comparableCount: 4 });
  assert.match(thin, /rests on 4 comparables/);
  assert.match(thin, /thin enough/);

  const stale = readingDraft({ days: 130, band: 'stale', comparableCount: 11 });
  assert.match(stale, /reads stale/);
  assert.match(stale, /Nothing can be attached until a fresh reading is recorded/);
});

test('the stale sentence names the run month, not a hardcoded September', () => {
  const sentence = staleAttachmentSentence('2026-05-14', new Date('2026-09-21T00:00:00Z'));
  assert.match(sentence, /from May/);
  assert.match(sentence, /September quote/);
  assert.match(sentence, /worse than a proposal with no market figure/);
});

test('the reading page is a route for the same licences as the list', () => {
  assert.match(app, /path="\/research\/markets\/:uid"/);
  assert.match(app, /guard\(labRoles\(\['admin', 'founder', 'partner', 'investor', 'advisor'\]\), <MarketReading/);
  assert.match(api, /marketReadingGet: \(uid\) => request\(`\/research\/market-readings\/\$\{encodeURIComponent\(uid\)\}`\)/);
  assert.match(list, /r\.uid \?/);
  assert.match(list, /\/research\/markets\/\$\{encodeURIComponent\(r\.uid\)\}/);
});

test('the page states the limits and does not stamp fixture data as SAMPLE', () => {
  assert.match(page, /A save writes a new run date\. It does not edit the old one\./);
  assert.match(page, /High is below low\. Nothing is saved until the range reads forward\./);
  assert.match(page, /The count has no names behind it/);
  assert.match(page, /The proposal is not named on the quote/);
  assert.match(page, /there is no control here that would pretend to save one/);
  assert.match(page, /Accept writes nothing/);
  assert.match(page, /does not call a model/);
  assert.match(page, /Where these numbers come from/);
  assert.match(page, /Sector signals live on/);
  assert.match(page, /Record a fresh reading/);
  assert.doesNotMatch(page, /SAMPLE/);
  assert.doesNotMatch(page, /Add an engagement/);
  assert.doesNotMatch(page, /zoneDraftRun/);
  assert.match(page, /hidden grid-cols-3/);
});
