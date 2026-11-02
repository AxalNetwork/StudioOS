// D1562 (#3809, deck v2 D1, pd7) — the Brand kit sheet, Apply brand as one
// undo step, and the one-click run taking the brand kit's pick first.
//
//   · brandKitModel: five swatches or "No palette recorded", the font pair
//     line, the draft and the PUT body, the reference cap;
//   · Apply brand's answer is ONE op: on a 12-card deck the history gains one
//     step, and one Undo gives back the deck exactly;
//   · in the mounted editor: ⋯ › Brand kit shows pd7's fields, Apply brand
//     sends the deck on screen, the edit is held until Save, and the header's
//     Undo takes it back in one press; Edit and Save send the whole kit;
//   · themePick: the kit's pick first, with its reason; themeToWrite writes
//     the kit's fonts, logo corner and image style.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_brand_kit_d1562.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deckBrandKitApi } from '../src/lib/api/deckBrandKit.js';
import {
  NO_PALETTE, applyOps, appliedLine, draftOf, draftProblem, flipReference, fontPairLine, saveBody, swatchesOf,
} from '../src/pages/raise/pitch/brandKitModel.js';
import { editReducer } from '../src/pages/raise/pitch/PitchEditor.jsx';
import { emptyHistory, historyCounts } from '../src/pages/raise/pitch/gridOps.js';
import { themePick, themeToWrite } from '../src/pages/raise/pitch/oneClickModel.js';
import { DECK, mountEditor } from './_pitch_editor_mount.mjs';

const ROLES = [
  { role: 'ground', label: 'Background', hex: '#fbfaf7' }, { role: 'ink', label: 'Text', hex: '#14213d' },
  { role: 'accent', label: 'Accent', hex: '#5b21b6' }, { role: 'secondary', label: 'Secondary', hex: null }, { role: 'muted', label: 'Muted text', hex: null },
];
const PICK = { theme: { kind: 'brand', background: null, fonts: { heading: 'Fraunces', body: 'Inter' }, chrome: { page_number: false, footer_text: null, logo_corner: true, confidential: false }, art_direction: { style: 'scene' } }, reason: 'Brand, because your brand kit is recorded: Fraunces and Inter, 3 of 5 palette roles, the logo, Photo images.', adjustments: [] };
const KIT = {
  name: 'Synthetic Labs', palette: { bg: '#fbfaf7', ink: '#14213d', accent: '#5b21b6', secondary: null }, fonts: null, voice: [],
  logo: { light: 'https://cdn.example.com/logo.png', dark: null, inline: false }, updated_at: null, roles: ROLES,
  font_pair: { heading: { family: 'Fraunces', licence: 'OFL-1.1' }, body: { family: 'Inter', licence: 'OFL-1.1' } }, image_style: 'photo',
  references: [{ url: 'https://cdn.example.com/a.png', alt: 'A' }], library: [{ url: 'https://cdn.example.com/a.png', alt: 'A', reference: true }, { url: 'https://cdn.example.com/b.png', alt: null, reference: false }],
  deck_kit: { updated_at: null }, pick: PICK,
};
const CHOICES = {
  fonts: [{ family: 'Fraunces', kind: 'serif', licence: 'OFL-1.1' }, { family: 'Inter', kind: 'sans', licence: 'OFL-1.1' }],
  image_styles: [{ id: 'photo', label: 'Photo' }, { id: 'illustration', label: 'Illustration' }, { id: 'screenshot', label: 'Screenshot' }],
  palette_roles: ROLES.map(({ role, label }) => ({ role, label })), library_max: 24, references_max: 3,
};
const choices = { fonts: CHOICES.fonts, imageStyles: CHOICES.image_styles, roles: CHOICES.palette_roles, libraryMax: 24, referencesMax: 3 };

test('the model: five swatches or "No palette recorded", the font pair, the draft and its PUT body, the reference cap', () => {
  // Mutations checked: `recorded` true for an empty palette → the none line never shows; saveBody sending
  // empty roles → palette carries ''; flipReference ignoring the cap → a fourth reference.
  assert.deepEqual(swatchesOf(KIT).swatches.map((s) => s.hex), ['#fbfaf7', '#14213d', '#5b21b6', null, null]);
  assert.equal(swatchesOf({ roles: ROLES.map((r) => ({ ...r, hex: null })) }).recorded, false);
  assert.equal(NO_PALETTE, 'No palette recorded');
  assert.equal(fontPairLine(KIT), 'Fraunces · Inter');
  const d = draftOf(KIT);
  assert.deepEqual(saveBody(d), {
    fonts: { heading: 'Fraunces', body: 'Inter' }, logo_url: 'https://cdn.example.com/logo.png',
    palette: { ground: '#fbfaf7', ink: '#14213d', accent: '#5b21b6' }, image_style: 'photo',
    library: [{ url: 'https://cdn.example.com/a.png', alt: 'A', reference: true }, { url: 'https://cdn.example.com/b.png', reference: false }],
  });
  assert.equal(draftProblem({ ...d, body: '' }, choices), 'Pick both fonts, or neither.');
  assert.equal(draftProblem({ ...d, palette: { ink: 'navy' } }, choices), 'Text must be a colour like #1a2b3c.');
  const three = { ...d, library: [0, 1, 2, 3].map((i) => ({ url: `https://cdn.example.com/${i}.png`, alt: '', reference: i < 3 })) };
  assert.equal(flipReference(three, 3, 3), three, 'a fourth reference is not taken');
  assert.equal(flipReference(three, 0, 3).library[0].reference, false);
  assert.equal(draftOf(null).heading, '', 'a venture with no kit starts from an empty draft');
});

test('THE ISSUE\'S TEST, in the editor\'s history: a 12-card deck restyles as one op, one undo step, and one Undo gives it back', () => {
  // Mutation checked (in the mounted test below): the editor applying the answer as two edits → one Undo leaves it unsaved.
  const cards = Array.from({ length: 12 }, (_, i) => ({ uid: `u${i}`, title: `Card ${i + 1}`, background: { color: '#111111', image_url: null }, blocks: [] }));
  const before = { doc: { cards, theme: { kind: 'neutral_dark', background: null }, audience: null }, history: emptyHistory(), undone: null };
  const reply = { cards: cards.map(({ background: _b, ...c }) => c), theme: PICK.theme, changed: 12 };
  const op = applyOps(reply);
  const after = editReducer(before, { type: 'perform', ops: op, meta: { label: 'Apply brand', at: 1 } });
  assert.equal(historyCounts(after.history).undo, 1, 'one undo step');
  assert.equal(after.doc.cards.length, 12);
  assert.equal(after.doc.theme.kind, 'brand');
  assert.ok(after.doc.cards.every((c) => !c.background));
  const back = editReducer(after, { type: 'undo' });
  assert.equal(back.doc.cards, cards, 'the same cards, not a copy');
  assert.deepEqual(back.doc.theme, before.doc.theme);
  assert.equal(historyCounts(back.history).undo, 0);
  assert.equal(applyOps({ cards: null }), null);
  assert.equal(appliedLine(reply), 'Apply brand: 12 cards restyled. One undo step: Undo puts it back.');
});

test('the mounted editor: ⋯ › Brand kit draws pd7, Apply brand sends the deck on screen, held until Save, one Undo', async () => {
  const was = { ...deckBrandKitApi };
  const asked = [];
  deckBrandKitApi.apply = async (id, body) => {
    asked.push([id, body]);
    return { deck_id: id, theme: PICK.theme, cards: body.cards.map((c) => ({ ...c, title: `${c.title}` })), changed: 2, tokens: {}, problems: [], reason: PICK.reason, adjustments: [] };
  };
  deckBrandKitApi.save = async (pid, body) => { asked.push(['save', pid, body]); return { project_id: pid, kit: KIT, choices: CHOICES }; };
  const m = await mountEditor({ answers: { 'editor.brandKit': async () => ({ project_id: 7, kit: KIT, choices: CHOICES }) } });
  try {
    await m.press(m.by('deck-more-open'));
    await m.press(m.by('deck-more-brand'));
    assert.ok(m.by('pitch-brand-logo'));
    assert.equal(m.walk(m.by('pitch-brand-palette')).filter((n) => m.pr(n)['aria-hidden'] === 'true').length, 5, 'five swatches');
    assert.match(m.text(m.by('pitch-brand-fonts')), /Fraunces · Inter · Google Fonts under the Open Font Licence/);
    assert.equal(m.text(m.by('pitch-brand-style')), 'Photo');
    assert.match(m.text(m.by('pitch-sheet-brand')), /Apply brand One undo step/);
    assert.doesNotMatch(m.text(m.by('pitch-editor-save-state')), /Unsaved changes/);
    await m.press(m.by('pitch-brand-apply'));
    assert.equal(asked.length, 1);
    assert.equal(asked[0][0], DECK.id);
    assert.equal(asked[0][1].cards.length, DECK.slides.length, 'the deck as it is on screen');
    assert.match(m.text(m.by('pitch-brand-line')), /One undo step/);
    assert.match(m.text(m.by('pitch-editor-save-state')), /Unsaved changes/, 'held until Save: nothing is written');
    await m.press(m.by('pitch-editor-undo'));
    assert.doesNotMatch(m.text(m.by('pitch-editor-save-state')), /Unsaved changes/, 'one Undo takes the whole restyle back');
    // Edit, then Save: the whole kit, once.
    await m.press(m.by('pitch-brand-edit'));
    await m.type(m.by('pitch-brand-form-secondary'), '#0f766e');
    await m.press(m.by('pitch-brand-save'));
    const save = asked.find((a) => a[0] === 'save');
    assert.equal(save[1], 7);
    assert.deepEqual(save[2].palette, { ground: '#fbfaf7', ink: '#14213d', accent: '#5b21b6', secondary: '#0f766e' });
    assert.deepEqual(save[2].fonts, { heading: 'Fraunces', body: 'Inter' });
  } finally { await m.close(); Object.assign(deckBrandKitApi, was); }
});

test('a reader sees the kit but no Apply brand and no Edit', async () => {
  const m = await mountEditor({ user: { id: 21, role: 'admin', name: 'Synthetic Admin' }, answers: { 'editor.brandKit': async () => ({ project_id: 7, kit: { ...KIT, roles: ROLES.map((r) => ({ ...r, hex: null })) }, choices: CHOICES }) } });
  try {
    await m.press(m.by('deck-more-open'));
    await m.press(m.by('deck-more-brand'));
    assert.ok(m.by('pitch-sheet-brand'));
    assert.equal(m.text(m.by('pitch-brand-palette-none')), 'No palette recorded');
    assert.equal(m.by('pitch-brand-apply'), undefined, 'no Apply brand for a reader');
    assert.equal(m.by('pitch-brand-edit'), undefined, 'no Edit for a reader');
  } finally { await m.close(); }
});

test('the one-click run takes the brand kit\'s pick first, records its reason, and writes its fonts, logo corner and style', () => {
  // Mutation checked: the version's theme first again → `from` reads 'version'.
  const p = themePick({ kind: 'neutral_dark', background: null, aspect: '4:3' }, { status: 'ok', data: { kit: KIT } });
  assert.equal(p.from, 'kit');
  assert.equal(p.reason, PICK.reason);
  assert.equal(p.theme.aspect, '4:3', 'the deck\'s own size rides along');
  assert.deepEqual(p.theme.fonts, { heading: 'Fraunces', body: 'Inter' });
  const w = themeToWrite(p.theme, { kind: 'brand', background: null });
  assert.deepEqual(w.fonts, { heading: 'Fraunces', body: 'Inter' }, 'a Brand version gains the kit\'s fonts');
  assert.equal(w.chrome.logo_corner, true);
  assert.equal(themeToWrite(p.theme, p.theme), null, 'the same theme is not written again');
  // A kit read without a pick keeps D1604's order.
  assert.equal(themePick({ kind: 'neutral_dark' }, { status: 'ok', data: { kit: { palette: {} } } }).from, 'version');
  const src = readFileSync(new URL('../src/pages/raise/pitch/OneClickBuild.jsx', import.meta.url), 'utf8');
  assert.match(src, /data-testid="pitch-review-kit-reason"/, 'the review says why');
});
