import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDeck,
  SAMPLE_DATA,
  SAMPLE_NOTES,
  THEME,
  fmt,
} from '../src/decks/spinout/buildDeck.js';

// A .pptx is a ZIP (OOXML) package: it must start with the local-file-header
// signature "PK\x03\x04" and contain the package marker entries.
function assertValidPptx(buf, label) {
  assert.ok(buf, `${label}: no output returned`);
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  assert.ok(u8.length > 2000, `${label}: output too small (${u8.length} bytes)`);
  assert.equal(u8[0], 0x50, `${label}: byte 0 should be 'P'`);
  assert.equal(u8[1], 0x4b, `${label}: byte 1 should be 'K'`);
  assert.equal(u8[2], 0x03, `${label}: byte 2 should be 0x03`);
  assert.equal(u8[3], 0x04, `${label}: byte 3 should be 0x04`);
  const text = Buffer.from(u8).toString('latin1');
  assert.ok(text.includes('[Content_Types].xml'), `${label}: missing [Content_Types].xml`);
  assert.ok(text.includes('ppt/presentation.xml'), `${label}: missing ppt/presentation.xml`);
}

test('buildDeck(SAMPLE_DATA) produces a valid non-empty .pptx (nodebuffer)', async () => {
  const buf = await buildDeck(SAMPLE_DATA, { outputType: 'nodebuffer' });
  assert.ok(Buffer.isBuffer(buf), 'nodebuffer output should be a Buffer');
  assertValidPptx(buf, 'sample-deck');
});

test('buildDeck() defaults to the bundled sample fixture', async () => {
  const buf = await buildDeck(undefined, { outputType: 'nodebuffer' });
  assertValidPptx(buf, 'default-deck');
});

test('buildDeck renders all 10 slides', async () => {
  const buf = await buildDeck(SAMPLE_DATA, { outputType: 'nodebuffer' });
  const text = Buffer.from(buf).toString('latin1');
  // One slideN.xml entry per slide in the package.
  const slideCount = (text.match(/ppt\/slides\/slide\d+\.xml/g) || [])
    .filter((v, i, a) => a.indexOf(v) === i).length;
  assert.equal(slideCount, 10, `expected 10 slides, found ${slideCount}`);
});

test('speaker notes are embedded in the package', async () => {
  const buf = await buildDeck(SAMPLE_DATA, { outputType: 'nodebuffer' });
  const text = Buffer.from(buf).toString('latin1');
  const noteParts = (text.match(/ppt\/notesSlides\/notesSlide\d+\.xml/g) || [])
    .filter((v, i, a) => a.indexOf(v) === i).length;
  assert.equal(noteParts, 10, `expected 10 notesSlide parts, found ${noteParts}`);
  // A stable, XML-safe slice of the cover speaker note must survive into the package.
  assert.ok(
    text.includes('Focal: thesis statement; area chart is the data hero'),
    'cover speaker note text not found in package',
  );
});

test('draft option still yields a valid package', async () => {
  const buf = await buildDeck(SAMPLE_DATA, { outputType: 'nodebuffer', draft: true });
  assertValidPptx(buf, 'draft-deck');
});

test('exported fixtures keep the 10-slide content contract', () => {
  for (const key of [
    'cover', 'problem', 'validation', 'market', 'solution',
    'roadmap', 'team', 'captable', 'ask', 'deal',
  ]) {
    assert.ok(SAMPLE_DATA[key], `SAMPLE_DATA missing section: ${key}`);
    assert.equal(typeof SAMPLE_NOTES[key], 'string', `SAMPLE_NOTES missing note: ${key}`);
  }
  assert.ok(SAMPLE_DATA.brand, 'SAMPLE_DATA missing brand');
});

test('THEME colours are bare hex (no leading #)', () => {
  for (const [k, v] of Object.entries(THEME.color)) {
    assert.match(v, /^[0-9A-Fa-f]{6}$/, `THEME.color.${k} should be 6-digit bare hex, got "${v}"`);
  }
});

test('fmt centralizes money/number formatting', () => {
  assert.equal(fmt.pct(86), '86%');
  assert.equal(fmt.int(2400), '2,400');
  assert.equal(fmt.money(750000), '$750,000');
  assert.equal(fmt.compactMoney(750000), '$750K');
  assert.equal(fmt.compactMoney(3_200_000_000), '$3.2B');
  assert.equal(fmt.compactMoney(180_000_000), '$180M');
  assert.equal(fmt.compactMoney(14_000_000_000), '$14B');
  assert.equal(fmt.pct(undefined), '');
  assert.equal(fmt.compactMoney(NaN), '');
});
