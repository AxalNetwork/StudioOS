/**
 * `_renderedText.mjs` is what the render tests read sentences through, and its
 * docblock makes a claim a regex could not keep: nothing it returns contains a
 * `<`. That claim is the fix for CodeQL alert 6146, so it is asserted here
 * directly rather than left to the render tests, none of which draws a tag the
 * old regex would have kept.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderedText } from './_renderedText.mjs';

test('markup is dropped and the text a reader sees is kept', () => {
  assert.equal(renderedText('<p class="a">Hello <b>there</b></p>'), 'Hello there');
});

// The regex this replaced returned both of these unchanged; the docblock of
// `_renderedText.mjs` says why. Writing that regex here to compare against
// would raise the same alert the helper exists to close.
test('a tag left open at the end does not survive', () => {
  for (const html of ['x<script', 'd<img src=x onerror=1']) {
    assert.ok(!renderedText(html).includes('<'), `${html} kept a tag: ${renderedText(html)}`);
  }
  assert.equal(renderedText('x<script'), 'x');
  assert.equal(renderedText('d<img src=x onerror=1'), 'd');
});

test('the two entities are decoded, and &amp; last so an escaped entity stays text', () => {
  assert.equal(renderedText('it&#x27;s &amp; that&#39;s'), "it's & that's");
  assert.equal(renderedText('<p>&amp;#39;</p>'), '&#39;');
});
