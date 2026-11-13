/**
 * D1571 (#3818, deck v2 D10) — the Worker's half of a deck's language: the
 * theme keeps `lang` and `dir` (A8's `sanitizeTheme`), capacity is per script
 * (`designSystem.SCRIPT_EM`), the reflow and the fit read it, and the exports
 * (the offline HTML file and the editable PowerPoint) write the deck's words
 * in its direction. Synthetic words only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_language_d1571.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GLYPH_EM, SCRIPT_EM, capacityAt, dirOf, fitProblems, fitText, scriptOf, scriptOfTheme, textCapacity } from '../src/services/decks/designSystem.ts';
import { reflowSlides } from '../src/services/decks/reflow.ts';
import { sanitizeTheme } from '../src/services/decks/slideModel.ts';
import { rtlParagraph } from '../src/services/decks/pptxEditable.ts';
import { writeOfflineDeck } from '../src/services/decks/offlineHtml.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const LINE = { c1: 1, c2: 12, r1: 1, r2: 1 };

test('the script of a language and its direction: Arabic and Hebrew right to left, CJK per character, the rest Latin', () => {
  // Mutation checked: 'he' left out of SCRIPT_OF → the Hebrew row fails.
  assert.deepEqual(['ar', 'fa', 'ur', 'he', 'zh', 'zh-Hant', 'ja', 'ko', 'en', 'de', '', null].map((l) => scriptOf(l)),
    ['arabic', 'arabic', 'arabic', 'hebrew', 'cjk', 'cjk', 'cjk', 'cjk', 'latin', 'latin', 'latin', 'latin']);
  assert.deepEqual(['ar', 'he', 'ja', 'en'].map((l) => dirOf(l)), ['rtl', 'rtl', 'ltr', 'ltr']);
  assert.equal(dirOf('ar', 'ltr'), 'ltr', 'a theme\'s own dir wins');
  assert.equal(scriptOfTheme({ kind: 'brand', lang: 'ja' }), 'cjk');
  assert.equal(scriptOfTheme(null), 'latin');
  // A8: the theme keeps both, so the language travels with the version.
  assert.deepEqual(sanitizeTheme({ kind: 'brand', background: null, lang: 'ar', dir: 'rtl' }, () => null), { kind: 'brand', background: null, lang: 'ar', dir: 'rtl' });
  assert.equal(sanitizeTheme({ kind: 'brand', background: null, lang: '<script>' }, () => null)!.lang, undefined);
});

test('capacity per script: Latin unchanged (GLYPH_EM), CJK about half, and the fit and the reflow read it', () => {
  // Mutations checked: capacityAt ignoring its script, fitText not passing it on, reflowSlides not passing it on — each red.
  assert.equal(SCRIPT_EM.latin, GLYPH_EM);
  for (const role of ['display', 'heading', 'paragraph', 'list'] as const) {
    assert.deepEqual(textCapacity(LINE, role), textCapacity(LINE, role, '16:9', 'latin'), 'no script is Latin: decks saved before fit as they did');
    assert.ok(textCapacity(LINE, role, '16:9', 'cjk').perLine < textCapacity(LINE, role).perLine, role);
  }
  const latin = capacityAt(LINE, 'heading', 64).perLine;
  const cjk = capacityAt(LINE, 'heading', 64, '16:9', 'cjk').perLine;
  assert.ok(cjk <= Math.ceil(latin * 0.53) && cjk >= Math.floor(latin * 0.5), `${cjk} vs ${latin}`);
  // A Japanese heading that fits as Latin overflows as CJK, in the fit and in the 4:3 reflow.
  // (The fit steps the size down first, so it needs a longer line than the reflow, which measures at the role's size.)
  const long = '合成'.repeat(20);
  assert.equal(fitText(LINE, 'heading', long).fits, true);
  assert.equal(fitText(LINE, 'heading', long, '16:9', 'cjk').fits, false);
  const longSlides = [{ blocks: [{ id: 't', kind: 'text', style: 'heading', text: long, grid: LINE }] }];
  assert.equal(fitProblems(longSlides).some((p) => p.kind === 'overflow'), false);
  assert.equal(fitProblems(longSlides, '16:9', 'cjk').some((p) => p.kind === 'overflow'), true);
  const ja = '合成'.repeat(14);
  const slides = [{ blocks: [{ id: 't', kind: 'text', style: 'heading', text: ja, grid: LINE }] }];
  assert.equal(reflowSlides(slides, '4:3', '16:9').count, 0);
  assert.equal(reflowSlides(slides, '4:3', '16:9', 'cjk').count, 1);
});

test('the exports: the offline file and the editable PowerPoint write an Arabic deck right to left; English is untouched', async () => {
  // Mutations checked: the card face without `dir`, rtlParagraph not applied — each red.
  const slides = [{ title: 'عنوان', blocks: [{ id: 'b1', kind: 'text', style: 'paragraph', text: 'نص اصطناعي', grid: LINE }] }];
  const base = { title: 'Synthetic', version: 1, slides, images: new Map(), footer: null, watermark: null, notes: false, sources: false };
  const ar = await writeOfflineDeck({ ...base, lang: 'ar', dir: 'rtl' });
  assert.match(ar, /<div class="face" lang="ar" dir="rtl">/);
  assert.equal(/padding-left|border-left:|text-align:left/.test(ar), false, 'no hard-coded left in the file\'s styles');
  const en = await writeOfflineDeck(base);
  assert.match(en, /<div class="face">/, 'an English deck reads as before');
  assert.equal(rtlParagraph('<a:r>x</a:r>'), '<a:pPr rtl="1" algn="r"/><a:r>x</a:r>');
  assert.equal(rtlParagraph('<a:pPr marL="342900"><a:buChar char="•"/></a:pPr>x'), '<a:pPr rtl="1" algn="r" marL="342900"><a:buChar char="•"/></a:pPr>x');
  assert.equal(rtlParagraph('<a:pPr><a:buChar/></a:pPr>'), '<a:pPr rtl="1" algn="r"><a:buChar/></a:pPr>');
  assert.match(read('../src/services/decks/pptxEditable.ts'), /input\.dir === 'rtl' \? paras\.map\(rtlParagraph\) : paras/);
  const exp = read('../src/routes/deck_exports.ts');
  assert.equal((exp.match(/dir: dirOf\(themeOfRow\(row\)\?\.lang, themeOfRow\(row\)\?\.dir\)/g) || []).length, 2, 'the HTML file and the PowerPoint both read the theme');
  // The grid route names the deck's language, direction and script, and reflows at that script.
  const grid = read('../src/routes/deck_grid.ts');
  assert.match(grid, /dir: dirOf\(deck\.theme\?\.lang, deck\.theme\?\.dir\)/);
  assert.match(grid, /reflowSlides\(deck\.slides, target, aspect, scriptOfTheme\(deck\.theme\)\)/);
});
