/** #5218 — template previews use the real deck renderer and keep the choice metadata. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DeckTemplatePreview from '../src/decks/DeckTemplatePreview.tsx';
import { startOptions } from '../src/pages/raise/pitch/newDeckModel.js';

test('a template cover renders deck content and identifies the sample', () => {
  const html = renderToStaticMarkup(createElement(DeckTemplatePreview, { templateKey: 'yc_seed' }));
  assert.match(html, /Fictional sample/);
  assert.match(html, /1920px/);
  assert.match(html, /1080px/);
  assert.doesNotMatch(html, /Preview unavailable|Failed to render/);
});

test('unknown template keys render an explicit fallback', () => {
  const html = renderToStaticMarkup(createElement(DeckTemplatePreview, { templateKey: 'constructor' }));
  assert.match(html, /Preview unavailable/);
  assert.doesNotMatch(html, /Fictional sample/);
});

test('a locked option keeps its renderer key, count, category and audience', () => {
  const [, option] = startOptions([], [{
    id: 'method', key: 'yc_seed', locked: true, slide_count: 10, best_for: 'Seed investors', category: 'investor',
  }]);
  assert.deepEqual(option, {
    kind: 'template', id: 'method', label: 'method', templateKey: 'yc_seed', locked: true,
    slide_count: 10, best_for: 'Seed investors', category: 'investor',
  });
});
