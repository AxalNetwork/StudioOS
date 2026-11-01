/**
 * D1553 (#3800, deck v2 C5) — the pd5 sheet, from ⋯ › This card › Remix this slide.
 *
 *  · the only way in is ⋯ › This card; the item is live (no "Coming later"),
 *    and stays live with AI paused (pd9e "Still works");
 *  · the sheet posts the card on screen and shows the Worker's four layouts,
 *    "Free · no AI charge";
 *  · Use this layout applies at once, one edit held until Save, with its own Undo;
 *  · Remove a block posts the block's id and applies the reflowed card.
 * Synthetic records only.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_remix_d1553.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deckRemixApi } from '../src/lib/api/deckRemix.js';
import { availability } from '../src/pages/raise/pitch/deckV2Adapter.js';
import { MORE_MENU, moreState } from '../src/pages/raise/pitch/deckV2Model.js';
import { REMIX_FREE, REMIX_TITLE, remixBlockName } from '../src/pages/raise/pitch/DeckSheets.jsx';
import { CARD, mountEditor } from './_pitch_editor_mount.mjs';

const G = (c1, c2, r1, r2) => ({ c1, c2, r1, r2 });
const OPTION = (structure, label, line, blocks) => ({
  structure, label, line,
  card: { ...CARD, structure, layout: undefined, areas: blocks.map((b, i) => ({ id: `a${i + 1}`, ...b.grid, order: i + 1, inset: 0, align: 'start' })), blocks },
});
const HALVES = OPTION('halves', 'Halves', 'Sets two blocks side by side', [
  { ...CARD.blocks[0], grid: G(1, 6, 1, 1) }, { ...CARD.blocks[1], grid: G(1, 6, 2, 6) }, { ...CARD.blocks[2], grid: G(7, 12, 1, 6) },
]);

test('Remix is reached only from ⋯ › This card, is live now its route is on main, and stays live with AI paused', () => {
  const item = MORE_MENU.find((s) => s.id === 'card').items.find((i) => i.id === 'remix');
  assert.deepEqual([item.label, item.note, item.adapter, item.ai], ['Remix this slide', 'Free', 'remix', undefined]);
  assert.equal(availability('remix'), null);
  for (const aiOn of [true, false]) {
    const st = moreState(MORE_MENU, { availability, aiOn });
    const r = st.sections.find((s) => s.id === 'card').items.find((i) => i.id === 'remix');
    assert.deepEqual([r.disabled, Boolean(r.later)], [false, false], `AI ${aiOn ? 'on' : 'paused'}: Remix still works`);
  }
  // Not a toolbar button and not a per-area chip.
  for (const f of ['DeckToolbar.jsx', 'BlockTools.jsx', 'GridStage.jsx']) {
    assert.doesNotMatch(readFileSync(new URL(`../src/pages/raise/pitch/${f}`, import.meta.url), 'utf8'), /remix/i, f);
  }
  assert.equal(remixBlockName(CARD.blocks[2]), 'MRR');
  assert.equal(remixBlockName(CARD.blocks[0]), 'Synthetic heading');
});

test('pd5: the sheet shows the four layouts for the card on screen; Use this layout applies one edit with its Undo; Remove a block reflows', async () => {
  const real = deckRemixApi.remix;
  const asked = [];
  deckRemixApi.remix = async (deckId, card, opts) => {
    asked.push([deckId, card, opts]);
    if (opts?.remove) {
      const blocks = card.blocks.filter((b) => b.id !== opts.remove).map((b) => ({ ...b, grid: b.id === 'b1' ? G(1, 12, 1, 1) : G(1, 12, 2, 6) }));
      return { deck_id: deckId, current: 'custom', card: { ...card, structure: 'custom', blocks }, options: [] };
    }
    return { deck_id: deckId, current: card.structure || 'custom', card, options: card.structure === 'halves' ? [] : [HALVES] };
  };
  const m = await mountEditor();
  try {
    await m.press(m.by('deck-more-open'));
    await m.press(m.by('deck-more-remix'));
    const sheet = m.by('pitch-sheet-remix');
    assert.ok(sheet, 'the pd5 sheet');
    assert.match(m.text(sheet), new RegExp(REMIX_TITLE.replace(/[·]/g, '.')));
    assert.equal(m.text(m.by('pitch-remix-free')), REMIX_FREE);
    assert.deepEqual([asked[0][0], asked[0][1].title, asked[0][2]], [31, CARD.title, undefined], 'it posts the card on screen');
    assert.match(m.text(m.by('pitch-remix-option-halves')), /Halves Sets two blocks side by side Use this layout/);
    assert.match(m.text(m.by('pitch-editor-save-state')), /Saved|All changes saved/i);

    await m.press(m.by('pitch-remix-use-halves'));
    assert.match(m.text(m.by('pitch-remix-applied')), /Now Halves ?\. Nothing is saved until you save a version\./);
    assert.match(m.text(m.by('pitch-editor-save-state')), /Unsaved changes/, 'one edit, held until Save');
    assert.equal(asked.at(-1)[1].structure, 'halves', 'the sheet asks again for the card as it now is');
    assert.ok(m.by('pitch-remix-none'), 'no other layout for the new card in this stub');

    await m.press(m.by('pitch-remix-undo'));
    assert.equal(m.by('pitch-remix-applied'), undefined);
    assert.equal(asked.at(-1)[1].structure, undefined, 'Undo puts the card back as it was');
    assert.ok(m.by('pitch-remix-option-halves'));

    await m.press(m.by('pitch-remix-remove-b3'));
    assert.deepEqual(asked.find((a) => a[2]?.remove)?.[2], { remove: 'b3' });
    assert.match(m.text(m.by('pitch-remix-applied')), /Removed MRR ?\./);
    assert.ok(!asked.at(-1)[1].blocks.some((b) => b.id === 'b3'), 'the reflowed card is the one on screen now');
  } finally { await m.close(); deckRemixApi.remix = real; }
});
