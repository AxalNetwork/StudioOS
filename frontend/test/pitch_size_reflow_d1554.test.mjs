/**
 * D1554 (#3801, deck v2 C6) — ⋯ › Slide size reflows the draft.
 *
 * Switching to 4:3 moves what no longer fits to the card's speaker notes
 * (`deckReflow.js`, the Worker's reflow mirrored), shows pd3c's amber
 * "[N] blocks no longer fit and moved to the speaker notes." and one Undo,
 * which puts the cards and the size back. A deck that fits moves nothing and
 * shows no notice.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DECK, mountEditor } from './_pitch_editor_mount.mjs';
import { textCapacity } from '../src/pages/raise/pitch/deckReflow.js';

// Narrow enough that 4:3 holds fewer characters (columns 1–7 reach the paragraph's 280 cap at both).
const GRID = { c1: 1, c2: 4, r1: 2, r2: 3 };
const words = (n) => { let s = ''; for (let i = 0; s.length < n; i++) s += (s ? ' ' : '') + ['signal', 'pilot', 'buyer', 'cohort'][i % 4]; s = s.slice(0, n); return s.endsWith(' ') ? `${s.slice(0, -1)}x` : s; };
const LONG = words(textCapacity(GRID, 'paragraph', '16:9'));

function deckWith(text) {
  const card = { ...DECK.slides[0], layout: 'two_columns', blocks: DECK.slides[0].blocks.map((b) => (b.id === 'b2' ? { ...b, grid: GRID, text } : b)) };
  return { ...DECK, slides: [card, DECK.slides[1]] };
}

test('4:3 moves the words that no longer fit to the notes, says how many, and one Undo puts the cards and the size back', async () => {
  // Mutations checked: changeSize skipping the reflow → no notice, the notice assert fails; Undo restoring
  // only the theme → the text assert after Undo fails.
  assert.ok(LONG.length > textCapacity(GRID, 'paragraph', '4:3'), 'the fixture fits at 16:9 and not at 4:3');
  let saved = null;
  const m = await mountEditor({ answers: {
    deckGet: async () => deckWith(LONG),
    deckUpdate: async (id, body) => { saved = body; return { ...deckWith(LONG), version: 4, slides: body.slides, theme: body.theme }; },
  } });
  try {
    const textOf = () => m.text(m.by('pitch-editor-face-b2'));
    assert.equal(textOf(), LONG);
    await m.press(m.by('deck-more-open'));
    await m.press(m.by('deck-more-size'));
    assert.equal(m.by('pitch-size-moved'), undefined, 'no notice before a switch');
    await m.type(m.by('pitch-size-4x3'), true);
    assert.equal(m.pr(m.by('pitch-editor-card'))['data-aspect'], '4:3');
    assert.equal(m.text(m.by('pitch-size-moved')), '1 block no longer fits and moved to the speaker notes. Undo');
    assert.ok(textOf().length <= textCapacity(GRID, 'paragraph', '4:3') && LONG.startsWith(textOf()), 'the block keeps the words that fit');
    // Undo: the cards and the size as they were, and the notice goes.
    await m.press(m.by('pitch-size-undo'));
    assert.equal(m.pr(m.by('pitch-editor-card'))['data-aspect'], '16:9');
    assert.equal(textOf(), LONG);
    assert.equal(m.by('pitch-size-moved'), undefined);
    // Again, and save: the notes carry the moved words.
    await m.type(m.by('pitch-size-4x3'), true);
    await m.press(m.by('pitch-editor-save'));
    await m.press(m.by('pitch-editor-save-run'));
    assert.equal(saved?.theme?.aspect, '4:3');
    const card = saved.slides[0];
    assert.match(card.notes, /^Synthetic note\n\nMoved from the slide at 4:3:\n/);
    const kept = card.blocks.find((b) => b.id === 'b2').text;
    assert.equal(`${kept} ${card.notes.split('Moved from the slide at 4:3:\n')[1]}`, LONG, 'no word is lost');
  } finally { await m.close(); }
});

test('a deck that fits at 4:3 moves nothing and shows no notice', async () => {
  const m = await mountEditor();
  try {
    await m.press(m.by('deck-more-open'));
    await m.press(m.by('deck-more-size'));
    await m.type(m.by('pitch-size-4x3'), true);
    assert.equal(m.pr(m.by('pitch-editor-card'))['data-aspect'], '4:3');
    assert.equal(m.by('pitch-size-moved'), undefined);
    assert.equal(m.text(m.by('pitch-editor-face-b2')), 'Synthetic body words');
  } finally { await m.close(); }
});
