/** #5218 — template previews use the real deck renderer and keep the choice metadata. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DeckTemplatePreview from '../src/decks/DeckTemplatePreview.tsx';
import { previewRead } from '../src/pages/raise/pitch/DeckPreview.jsx';
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
    slide_count: 10, best_for: 'Seed investors', category: 'investor', slides: [],
  });
});


test('the selected template preserves the actual ordered structure', () => {
  const [, option] = startOptions([], [{ id: 'yc_seed', slides: [{ id: 'a', title: 'Cover', fields: [] }, { id: 'b', title: 'Problem' }] }]);
  assert.deepEqual(option.slides, [{ id: 'a', title: 'Cover' }, { id: 'b', title: 'Problem' }]);
});

test('a chooser shares a visible tile read with its selected preview', async () => {
  const cache = new Map();
  let calls = 0;
  const load = async () => { calls++; return { cards: [{ title: 'Saved cover' }] }; };
  const first = previewRead(cache, 'saved:1', load);
  const second = previewRead(cache, 'saved:1', load);
  assert.equal(first, second);
  assert.deepEqual(await second, { cards: [{ title: 'Saved cover' }] });
  assert.equal(calls, 1);
  await previewRead(new Map(), 'saved:1', load);
  assert.equal(calls, 2, 'another chooser has its own read');
});

test('a failed preview read can be retried rather than cached forever', async () => {
  const cache = new Map();
  await assert.rejects(previewRead(cache, 'failed', async () => { throw new Error('synthetic unavailable'); }));
  assert.equal(cache.has('failed'), false);
  const recovered = await previewRead(cache, 'failed', async () => ({ cards: [{ title: 'Recovered cover' }] }));
  assert.equal(recovered.cards[0].title, 'Recovered cover');
});
