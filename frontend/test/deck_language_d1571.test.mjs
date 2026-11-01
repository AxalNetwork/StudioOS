// D1571 (#3818, deck v2 D10) — a deck's language: right to left and per-script
// capacity, on every surface that draws a card (The Grid, the cards strip,
// Present, print and the exports), with the language set under ⋯ › Theme.
//
// Synthetic words only. The RTL deck is Arabic, the CJK deck Japanese.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deck_language_d1571.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { LANGUAGES, dirOf, langAttrs, langOf, languageLine, scriptOf, withLanguage } from '../src/pages/raise/pitch/deckLanguage.js';
import { SCRIPT_EM, reflowCards, textCapacity } from '../src/pages/raise/pitch/deckReflow.js';
import { keepSettings } from '../src/pages/raise/pitch/complianceModel.js';
import { BlockGrid } from '../src/pages/raise/pitch/BlockGrid.jsx';
import { StudioPrintCard } from '../src/pages/raise/pitch/PrintExtras.jsx';
import { PresentCard } from '../src/pages/raise/pitch/PitchPresent.jsx';
import CardsStrip from '../src/pages/raise/pitch/CardsStrip.jsx';
import { CARD, MODEL, mountEditor } from './_pitch_editor_mount.mjs';
import { deckEditorApi } from '../src/lib/api/deckEditor.js';

const h = React.createElement;
const read = (rel) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');
const AR = { kind: 'brand', background: null, lang: 'ar' };
const JA = { kind: 'brand', background: null, lang: 'ja' };
const COLOURS = { bg: '#fff', ink: '#111', accent: '#6d28d9', muted: '#666' };
const BLOCKS = [
  { id: 'b1', kind: 'text', style: 'heading', text: 'عنوان اصطناعي', grid: { c1: 1, c2: 12, r1: 1, r2: 1 } },
  { id: 'b2', kind: 'text', style: 'paragraph', text: 'نص اصطناعي للاختبار', grid: { c1: 1, c2: 7, r1: 2, r2: 6 } },
];

test('the model: Arabic and Hebrew read right to left, CJK is its own script, and no language is English left to right', () => {
  // Mutations checked: Hebrew left out of the RTL scripts, a region tag ('ar-EG') read as Latin — each red.
  assert.deepEqual(['ar', 'he', 'fa', 'ar-EG', 'en', 'fr', 'ja', 'zh-Hant', 'ko'].map((l) => [scriptOf(l), dirOf(l)]), [
    ['arabic', 'rtl'], ['hebrew', 'rtl'], ['arabic', 'rtl'], ['arabic', 'rtl'], ['latin', 'ltr'], ['latin', 'ltr'], ['cjk', 'ltr'], ['cjk', 'ltr'], ['cjk', 'ltr'],
  ]);
  assert.equal(dirOf('ar', 'ltr'), 'ltr', 'the theme\'s own dir wins');
  assert.deepEqual(langAttrs(null), { lang: 'en', dir: 'ltr' });
  assert.deepEqual(langAttrs(AR), { lang: 'ar', dir: 'rtl' });
  assert.equal(langOf({ lang: 'not a tag!' }), 'en', 'a bad tag reads as none');
  // ⋯ › Theme: the language is written into the theme, and English leaves it out (a deck that only tried one saves as before).
  assert.deepEqual(withLanguage(null, 'ar'), { kind: 'brand', background: null, lang: 'ar' });
  assert.equal(withLanguage({ kind: 'brand', background: null, lang: 'ar', dir: 'rtl' }, 'en'), null);
  assert.deepEqual(withLanguage({ kind: 'neutral_dark', background: null, aspect: '4:3', lang: 'ar', dir: 'ltr' }, 'he'), { kind: 'neutral_dark', background: null, aspect: '4:3', lang: 'he' });
  // A theme change keeps the language, as it keeps the compliance settings.
  assert.deepEqual(keepSettings({ kind: 'sand', background: null }, AR), { kind: 'sand', background: null, lang: 'ar' });
  assert.equal(languageLine(AR), 'العربية · right to left');
  assert.equal(languageLine(JA), '日本語 · left to right · each area holds about half as many characters');
  assert.ok(LANGUAGES.some((l) => l.id === 'he') && LANGUAGES[0].id === 'en');
});

test('capacity is per script and equals the Worker\'s: a CJK area holds about half as many characters, Latin is unchanged', async () => {
  // Mutation checked: textCapacity ignoring its script → the CJK assert fails.
  const ds = await import('../../cloudflare-worker/src/services/decks/designSystem.ts');
  assert.deepEqual(SCRIPT_EM, ds.SCRIPT_EM, 'one table, mirrored');
  for (const l of ['ar', 'he', 'ja', 'zh', 'en', 'fr', 'ar-EG', null]) {
    assert.equal(scriptOf(l), ds.scriptOf(l), String(l));
    assert.equal(dirOf(l), ds.dirOf(l), String(l));
  }
  const g = { c1: 1, c2: 6, r1: 2, r2: 4 };
  for (const role of ['heading', 'paragraph', 'list']) {
    for (const script of ['latin', 'arabic', 'hebrew', 'cjk']) {
      assert.equal(textCapacity(g, role, '16:9', script), ds.textCapacity(g, role, '16:9', script).chars, `${role} ${script}`);
    }
    assert.equal(textCapacity(g, role, '16:9'), textCapacity(g, role, '16:9', 'latin'), 'no script is Latin');
  }
  const latin = textCapacity({ c1: 1, c2: 12, r1: 1, r2: 1 }, 'heading');
  const cjk = textCapacity({ c1: 1, c2: 12, r1: 1, r2: 1 }, 'heading', '16:9', 'cjk');
  assert.ok(cjk < latin && cjk >= Math.floor(latin * 0.45), `${cjk} vs ${latin}`);
  // The reflow at 4:3 reads the script: a Japanese line that fits as Latin moves to the notes.
  const ja = '合成'.repeat(14);
  const card = { blocks: [{ id: 't', kind: 'text', style: 'heading', text: ja, grid: { c1: 1, c2: 12, r1: 1, r2: 1 } }] };
  assert.equal(reflowCards([card], '4:3').count, 0);
  assert.equal(reflowCards([card], '4:3', 'cjk').count, 1);
});

const snap = (el) => renderToStaticMarkup(el);
const noLeft = (html) => !/\btext-left\b|text-align:\s*left|padding-left/.test(html);

test('snapshot: BlockGrid, Present and print carry the deck\'s lang and dir, and align their text to the start', () => {
  // Mutations checked: Present dropping {...words}, print dropping {...words}, BlockGrid back to text-left — each red.
  const grid = snap(h(BlockGrid, { blocks: BLOCKS, colours: COLOURS, onSelect: () => {}, lang: 'ar', dir: 'rtl' }));
  assert.match(grid, /lang="ar" dir="rtl"/);
  assert.ok(noLeft(grid) && /text-start/.test(grid), grid);
  const present = snap(h(PresentCard, { card: { blocks: BLOCKS, n: '01', title: 'x', lines: [], bullets: [], figures: [] }, sources: false, theme: AR }));
  assert.match(present, /data-testid="pitch-present-card"/);
  assert.equal((present.match(/lang="ar" dir="rtl"/g) || []).length, 2, 'the face and its blocks');
  const fielded = snap(h(PresentCard, { card: { n: '01', title: 'عنوان', sub: 'نص', lines: ['سطر'], bullets: ['أ', 'ب'], figures: [] }, sources: false, theme: AR }));
  assert.match(fielded, /lang="ar" dir="rtl"/); assert.match(fielded, /text-start/); assert.match(fielded, /\bps-5\b/); assert.ok(noLeft(fielded));
  const print = snap(h(StudioPrintCard, { slide: { blocks: BLOCKS }, index: 0, theme: AR }));
  assert.match(print, /data-testid="print-card-0" lang="ar" dir="rtl"|lang="ar" dir="rtl"[^>]*data-testid="print-card-0"/);
  const printFields = snap(h(StudioPrintCard, { slide: { title: 'عنوان', fields: [{ kind: 'bullets', key: 'b', value: ['أ', 'ب'] }] }, index: 1, theme: AR }));
  assert.match(printFields, /text-align:start/); assert.match(printFields, /padding-inline-start:40px/); assert.ok(noLeft(printFields));
  // CJK keeps left to right, with its language named for font fallback.
  assert.match(snap(h(PresentCard, { card: { blocks: BLOCKS, n: '01', title: 'x', lines: [], bullets: [], figures: [] }, sources: false, theme: JA })), /lang="ja" dir="ltr"/);
  // An English deck is named English, left to right, as before.
  assert.match(snap(h(StudioPrintCard, { slide: { blocks: BLOCKS }, index: 0 })), /lang="en" dir="ltr"/);
});

test('snapshot: the cards strip draws each card\'s title in the deck\'s direction', () => {
  // Mutation checked: CardsStrip without lang/dir on the card button → red.
  const html = snap(h(MemoryRouter, null, h(CardsStrip, { cards: [{ title: 'عنوان اصطناعي', blocks: BLOCKS }], sel: 0, stale: new Set(), readOnly: true, onSelect: () => {}, move: () => {}, theme: AR })));
  assert.match(html, /lang="ar" dir="rtl"/);
  assert.ok(noLeft(html), 'no hard-coded left');
});

test('snapshot: The Grid (GridStage) mounts an Arabic deck right to left, and ⋯ › Theme sets the language', async () => {
  const deck = { id: 31, project_id: 7, version: 3, title: 'Synthetic deck', created_at: '2026-10-24 10:00:00', audience: 'seed_fund', theme: AR, slides: [CARD] };
  const m = await mountEditor({ answers: { deckGet: async () => deck } });
  try {
    const face = m.pr(m.by('pitch-editor-card'));
    assert.deepEqual([face.lang, face.dir], ['ar', 'rtl']);
    assert.match(m.pr(m.by('pitch-editor-block-b2')).className, /\btext-start\b/);
    await m.press(m.by('deck-more-open'));
    await m.press(m.by('deck-more-theme'));
    assert.equal(m.pr(m.by('pitch-theme-language')).value, 'ar');
    assert.equal(m.text(m.by('pitch-theme-language-line')), 'العربية · right to left');
    await m.type(m.by('pitch-theme-language'), 'ja');
    assert.equal(m.pr(m.by('pitch-editor-card')).lang, 'ja');
    assert.equal(m.pr(m.by('pitch-editor-card')).dir, 'ltr');
    assert.match(m.text(m.by('pitch-editor-save-state')), /Unsaved changes/);
  } finally { await m.close(); }
});

test('the source: no hard-coded left on the surfaces that draw a card, and no language control in the header', () => {
  for (const f of ['BlockGrid.jsx', 'GridStage.jsx', 'CardsStrip.jsx', 'AreaLightbox.jsx', 'PitchPresent.jsx', 'PrintExtras.jsx']) {
    assert.equal(/\btext-left\b|paddingLeft|\bpl-5\b/.test(read(`pages/raise/pitch/${f}`)), false, f);
  }
  assert.equal(/pitch-theme-language|LANGUAGES/.test(read('pages/raise/pitch/DeckToolbar.jsx')), false, 'the header row has no language control');
  assert.match(read('pages/raise/pitch/DeckSheets.jsx'), /data-testid="pitch-theme-language"/);
  assert.ok(MODEL && deckEditorApi);
});
