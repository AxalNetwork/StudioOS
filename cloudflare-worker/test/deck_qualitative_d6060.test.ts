/**
 * D6066 / D6060 (#6060, Pitch Studio v2 build 6/9) — the founders'
 * "intentionally qualitative" mark on a card, in the version's saved slides.
 *
 *   1. `sanitizeSlides` keeps `qualitative: true` on the card and drops any
 *      other value, so an unmarked card hashes as it did before the mark.
 *   2. `publicDeckOf` leaves it out of every outside reader (the share link,
 *      the print page, a deal grant): the mark is the founders' note to
 *      Review, never an investor's.
 *
 * Every card is synthetic.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/deck_qualitative_d6060.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { publicDeckOf, sanitizeSlides } from '../src/routes/decks.ts';

test('D6066 1: a save keeps qualitative: true on its card and nothing else under that name', () => {
  const [marked, unmarked, other, text] = sanitizeSlides([
    { title: 'Synthetic team', qualitative: true },
    { title: 'Synthetic market' },
    { title: 'Synthetic vision', qualitative: false },
    { title: 'Synthetic story', qualitative: 'yes' },
  ]);
  assert.equal(marked.qualitative, true);
  assert.equal('qualitative' in unmarked, false, 'an unmarked card carries no field');
  assert.equal('qualitative' in other, false, 'false is the field absent');
  assert.equal('qualitative' in text, false, 'only true is the mark');
});

test('D6066 2: an outside reader never sees the mark; the card itself still reaches them', () => {
  const slides = [{ uid: 'c1', title: 'Synthetic team', qualitative: true }, { uid: 'c2', title: 'Synthetic market' }];
  const pub = publicDeckOf({ id: 1, project_id: 5, version: 1, title: 'Synthetic deck', slides: JSON.stringify(slides), is_current: 1 });
  assert.equal(pub.slides.length, 2);
  assert.equal(pub.slides[0].title, 'Synthetic team');
  assert.equal(pub.slides.some((s: any) => 'qualitative' in s), false);
});
