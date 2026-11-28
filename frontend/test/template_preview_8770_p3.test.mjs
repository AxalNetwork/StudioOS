/**
 * D8770 part 3 (#8770, canvas PTP08, PTP16, PTP20 to PTP25) — template
 * previews: the template's own chrome and decor on every preview card, the
 * example falling back to the blank structure where it covers no card, Try
 * again on a preview whose cards could not be read (with Use this template off
 * until they read), and the phone: the preview as a sheet, one card, 44 px
 * controls, and full size titled "3 of 13 · Traction".
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LIBRARY } from '../../cloudflare-worker/src/services/decks/templateLibrary.ts';
import { toSlides } from '../../cloudflare-worker/src/services/decks/templates.ts';
import {
  EXAMPLE_UNAVAILABLE, EXAMPLE_UNAVAILABLE_LINE, KEYS_LINE, PHONE_HINT, RULE_PX, chromeLines, decorArt, decorArtSrc, decorIcons, decorPlan,
  exampleCoverage, needsDecorArt, phoneHeading, previewFace, previewSlides, sheetCard, templateChrome, toneColour, viewFor,
} from '../src/pages/raise/pitch/templatePreviewModel.js';
import { boxOf } from '../src/pages/raise/pitch/gridModel.js';
import TemplateSlide, { TemplateFullSize, ViewNote, ViewSwitch } from '../src/pages/raise/pitch/TemplateSlide.jsx';

const byName = (n) => LIBRARY.find((t) => t.name === n);
const KT = byName('Kitchen Table');
const HL = byName('Harbour Lights');
const NT = byName('Nib and Trace');
// `GET /decks/templates/:uid` serves the cards through `sanitizeSlides`, which keeps decor and drops `card`.
const served = (t) => toSlides(t).map(({ card, ...rest }) => rest);
const ktCards = served(KT);
const ktFace = previewFace(KT.theme);
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const at = (cards, title) => cards.findIndex((c) => c.title === title);

test('a template’s chrome comes from its theme; a theme with none keeps the plain chrome', () => {
  assert.deepEqual(templateChrome(KT.theme), { mark: 'top_left', number: true, rule: true, section: true, template: true });
  assert.deepEqual(templateChrome(HL.theme), { mark: 'bottom_left', number: true, rule: false, section: false, template: true });
  assert.deepEqual(templateChrome({ chrome: { page_number: true } }), { mark: 'top_left', number: true, rule: false, section: false, template: false }, 'the editor’s chrome is not a template’s');
  assert.deepEqual(templateChrome(null), templateChrome({}));
  assert.equal(templateChrome({ chrome: { venture_mark: 'centre<script>' } }).mark, null, 'an unknown corner draws no name');
  assert.deepEqual(ktFace.chrome, templateChrome(KT.theme), 'the chrome travels with the face');
  const traction = ktCards[at(ktCards, 'Traction')];
  assert.deepEqual(chromeLines(traction, templateChrome(KT.theme), '[Venture name]'), { top: '[Venture name] · Traction', bottom: null });
  const ex = previewSlides(ktCards, 'example', ktFace)[at(ktCards, 'Traction')];
  assert.deepEqual(chromeLines(ex, templateChrome(HL.theme), 'Larder Lane'), { top: null, bottom: 'Larder Lane · Source · Larder Lane billing export · sample, fictional · as of 30 Nov 2026' });
});

test('decor: a rule under each heading in the gutter below it, a vertical rule in a gutter column, and the library’s art in its area', () => {
  const traction = decorPlan(ktCards[at(ktCards, 'Traction')]);
  assert.equal(traction.length, 1);
  const [rule] = traction;
  const head = boxOf({ c1: 1, c2: 12, r1: 1, r2: 1 });
  assert.equal(rule.kind, 'divider');
  assert.equal(rule.style, 'double', 'Kitchen Table’s double rule');
  assert.equal(rule.tone, 'muted');
  assert.equal(rule.vertical, false);
  assert.equal(rule.box.w, RULE_PX);
  assert.ok(rule.box.y >= head.y + head.h && rule.box.y + rule.box.h <= head.y + head.h + 24, 'the rule sits in the gutter, never over the heading’s words');
  const why = decorPlan(ktCards[at(ktCards, 'Why now')]);
  assert.deepEqual(why.map((d) => `${d.kind}:${d.ref}:${d.tone}`), ['texture:noise:muted', 'icon:lightbulb:accent']);
  assert.deepEqual(decorIcons(ktCards), ['lightbulb']);
  assert.equal(needsDecorArt(ktCards), true);
  const nt = served(NT);
  const gutter = decorPlan(nt[at(nt, 'Solution')]).find((d) => d.kind === 'divider');
  assert.equal(gutter.vertical, true, 'Nib and Trace’s gutter rule stands between its columns');
  assert.equal(gutter.box.h, boxOf({ c1: 7, c2: 7, r1: 2, r2: 6 }).h);
  // Anything the preview cannot place is left out; at most 16 items.
  assert.deepEqual(decorPlan({ decor: [{ kind: 'divider', ref: 'line' }, { kind: 'icon', ref: 'x', grid: { c1: 0, c2: 3, r1: 1, r2: 1 } }, { kind: 'blob', ref: 'x', grid: { c1: 1, c2: 1, r1: 1, r2: 1 } }] }), []);
  assert.equal(decorPlan({ decor: Array.from({ length: 20 }, () => ({ kind: 'shape', ref: 'circle', grid: { c1: 1, c2: 1, r1: 1, r2: 1 } })) }).length, 16);
  assert.equal(decorPlan({ decor: [{ kind: 'divider', ref: '<script>', grid: { c1: 1, c2: 3, r1: 1, r2: 1 } }] })[0].style, 'line');
});

test('the library’s drawings are taken by kind and ref, and drawn in the item’s tone', () => {
  const read = { available: true, value: { shapes: [{ ref: 'circle', svg: '<svg><circle fill="var(--deck-ink)"/></svg>' }], textures: [{ ref: 'noise', svg: '<svg><circle fill="var(--deck-ink)"/></svg>' }], icons: { items: [{ ref: 'lightbulb', svg: '<svg><path stroke="var(--deck-ink)" fill="var(--deck-surface)"/></svg>' }, { ref: 'bad', svg: 'javascript:alert(1)' }] } } };
  const art = decorArt(read);
  assert.deepEqual(Object.keys(art).sort(), ['icon:lightbulb', 'shape:circle', 'texture:noise']);
  assert.equal(decorArt({ available: false, reason: 'Coming later' }), null);
  assert.equal(decorArt(null), null);
  const lit = decodeURIComponent(decorArtSrc(art['icon:lightbulb'], 'accent', ktFace));
  assert.match(lit, /stroke="#2F5D50"/, 'ink becomes the item’s tone, the accent');
  assert.match(lit, new RegExp(`fill="${ktFace.bg}"`), 'surface is the ground');
  assert.doesNotMatch(lit, /var\(--deck/);
  assert.equal(decorArtSrc('<img onerror=1>', 'ink', ktFace), null);
  assert.equal(toneColour('muted', ktFace), ktFace.muted);
  assert.equal(toneColour('nope', ktFace), ktFace.ink);
});

test('the card draws its template’s chrome and decor at export size', () => {
  const i = at(ktCards, 'Traction');
  const html = renderToStaticMarkup(createElement(TemplateSlide, { slide: ktCards[i], index: i, count: 13, face: ktFace, initialWidth: 480 }));
  assert.match(html, /data-testid="template-slide-chrome-top"[^>]*>\[Venture name\] · Traction</);
  assert.match(html, /data-testid="template-slide-footer-rule"/);
  assert.match(html, /data-testid="template-slide-number"[^>]*>03</);
  assert.match(html, /border-top:8px double #[0-9A-Fa-f]{6}[^"]*"[^>]*data-testid="template-slide-decor-d1" data-kind="divider" data-style="double"/);
  // The decor is under the areas: it comes first in the frame.
  assert.ok(html.indexOf('template-slide-decor') < html.indexOf('template-slide-grid'));
  const w = at(ktCards, 'Why now');
  const bare = renderToStaticMarkup(createElement(TemplateSlide, { slide: ktCards[w], index: w, count: 13, face: ktFace }));
  assert.doesNotMatch(bare, /<img[^>]*data-kind="(icon|texture)"/, 'without the library, the ornament is left out');
  const art = { 'texture:noise': '<svg><circle fill="var(--deck-ink)"/></svg>', 'icon:lightbulb': '<svg><path stroke="var(--deck-ink)"/></svg>' };
  const drawn = renderToStaticMarkup(createElement(TemplateSlide, { slide: ktCards[w], index: w, count: 13, face: ktFace, art }));
  assert.match(drawn, /<img alt="" src="data:image\/svg\+xml[^"]*"[^>]*data-kind="texture"/);
  assert.match(drawn, /<img alt="" src="data:image\/svg\+xml[^"]*%232F5D50[^"]*"[^>]*data-kind="icon"/);
  // Harbour Lights: the name bottom left, no footer rule, no section label.
  const hl = served(HL);
  const hlHtml = renderToStaticMarkup(createElement(TemplateSlide, { slide: hl[0], index: 0, count: hl.length, face: previewFace(HL.theme) }));
  assert.doesNotMatch(hlHtml, /chrome-top|footer-rule/);
  assert.match(hlHtml, /data-testid="template-slide-source"[^>]*>\[Venture name\]</);
});

test('a template the example covers none of shows its blank structure and says the example is unavailable (PTP16)', () => {
  assert.equal(exampleCoverage(ktCards), 13);
  assert.equal(viewFor('example', ktCards), 'example');
  assert.equal(viewFor('blank', ktCards), 'blank');
  const renamed = ktCards.map((c, k) => ({ ...c, title: `My card ${k + 1}` }));
  assert.equal(exampleCoverage(renamed), 0);
  assert.equal(viewFor('example', renamed), 'blank', 'never placeholders posing as the example');
  assert.equal(viewFor('example', []), 'blank');
  const sw = renderToStaticMarkup(createElement(ViewSwitch, { view: 'example', onChange: () => {}, exampleOff: true }));
  assert.match(sw, /aria-pressed="false"[^>]*disabled=""[^>]*data-testid="template-view-example"/);
  assert.match(sw, /aria-pressed="true"[^>]*data-testid="template-view-blank"/);
  const note = renderToStaticMarkup(createElement(ViewNote, { view: 'example', exampleOff: true }));
  assert.ok(note.includes(EXAMPLE_UNAVAILABLE) && note.includes(EXAMPLE_UNAVAILABLE_LINE));
  assert.match(note, /role="note"/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(ViewNote, { view: 'blank' })), /./);
});

test('on a phone, full size is titled “3 of 13 · Traction” and says it can be turned or pinched (PTP23)', () => {
  const i = sheetCard(ktCards);
  assert.equal(ktCards[i].title, 'Traction', 'the sheet shows the first card with a chart');
  assert.equal(sheetCard([{ blocks: [] }]), 0);
  assert.equal(phoneHeading(ktCards[i], i, 13), '3 of 13 · Traction');
  const props = { blank: ktCards, shown: ktCards, at: i, onMove: () => {}, onClose: () => {}, view: 'blank', onView: () => {}, face: ktFace };
  const phone = renderToStaticMarkup(createElement(TemplateFullSize, { ...props, phone: true }));
  assert.match(phone, /<h2[^>]*>3 of 13 · Traction<\/h2>/);
  assert.ok(phone.includes(PHONE_HINT));
  assert.match(phone, /max-sm:min-h-\[44px\][^"]*"[^>]*data-testid="template-full-prev"/);
  const desk = renderToStaticMarkup(createElement(TemplateFullSize, { ...props, phone: false }));
  assert.match(desk, /<h2[^>]*>Slide 3 of 13 · Traction<\/h2>/);
  assert.ok(desk.includes(KEYS_LINE) && !desk.includes(PHONE_HINT));
});

test('the gallery: Try again on unread cards, Use this template only once they read, the sheet below 1024 px, the library read once', () => {
  const g = src('../src/pages/raise/pitch/TemplatesGallery.jsx');
  assert.match(g, /\}, \[tile\?\.id, tries\]\);/, 'Try again reads the cards again');
  assert.match(g, /onClick=\{\(\) => setTries\(\(t\) => t \+ 1\)\} data-testid="pitch-templates-preview-retry"/);
  assert.match(g, /const useButton = canUse && preview\.status === 'ok'/, 'Use this template stays off until the cards read');
  assert.equal((g.match(/data-testid="pitch-templates-use"/g) || []).length, 1);
  assert.match(g, /<Lightbox phone="sheet"[^\n]*testId="pitch-templates-sheet"\s+footer=\{useButton/, 'the phone sheet pins Use this template to its foot');
  assert.match(g, /const phone = usePhoneWidth\(\);/);
  assert.match(g, /phone \? \[sheetCard\(shown\)\] : \[0, 1, 2\]/);
  assert.match(g, /`Preview all \$\{shown\.length\} slides`/);
  assert.equal((g.match(/elementsLibrary\(/g) || []).length, 1, 'one read of the library per preview');
  assert.match(g, /const shownView = viewFor\(view, blank\);/);
  // The example still never reaches a draft: only the uid and the venture are sent.
  assert.equal((g.match(/applyTemplate\(/g) || []).length, 1);
  assert.match(g, /deckTemplatesApi\.applyTemplate\(tile\.id, projectId\)/);
});
