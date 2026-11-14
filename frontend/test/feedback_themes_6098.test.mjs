/**
 * D6098 (#6098) — Product improvement's Feedback themes part: Rename on each
 * theme, a merge asked before it moves anything (saying how many rows move),
 * nothing drawn for a reader (no `parts.themes`), and the client method the
 * part calls. Every theme below is made up.
 *
 * Mutation checks (each made by hand, the suite run, and reverted; each
 * failed at least one test here):
 *   - FeedbackThemes.jsx: `themeChange` returns 'rename' when the target exists → "a name already in use is a merge"
 *   - FeedbackThemes.jsx: drop `!name` check in `themeChange`                  → "an empty name"
 *   - FeedbackThemes.jsx: `mergeQuestion` without the roadmap count           → "the merge question says how many rows move"
 *   - FeedbackThemes.jsx: render without the `onRename` guard                  → "a reader sees nothing"
 *   - cycleWrites.js: method PATCH → POST on feedbackTheme                     → "the client method"
 *
 * Run with:  node --import ./frontend/test/_deck-loader.mjs --test frontend/test/feedback_themes_6098.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import FeedbackThemes, { doneLine, mergeQuestion, themeChange } from '../src/pages/cycles/FeedbackThemes.jsx';
import { makeCycleWrites } from '../src/lib/api/cycleWrites.js';

const THEMES = [
  { theme: 'Export', feedback: 1, roadmap_items: 1 },
  { theme: 'Exprot', feedback: 2, roadmap_items: 1 },
  { theme: 'Onboarding', feedback: 1, roadmap_items: 0 },
];
const text = (el) => renderToStaticMarkup(el).replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('a new name is a rename; a name already in use is a merge', () => {
  assert.deepEqual(themeChange(THEMES, 'Exprot', ' Export speed '), { kind: 'rename', to: 'Export speed', feedback: 2, roadmapItems: 1 });
  assert.deepEqual(themeChange(THEMES, 'Exprot', 'Export'), { kind: 'merge', to: 'Export', feedback: 2, roadmapItems: 1 });
  assert.equal(themeChange(THEMES, 'Exprot', 'export').kind, 'rename', 'another case is another theme, as the Worker matches');
});

test('an empty name, or the same name, is refused before any request', () => {
  assert.equal(themeChange(THEMES, 'Exprot', '').kind, 'empty');
  assert.equal(themeChange(THEMES, 'Exprot', '   ').kind, 'empty');
  assert.equal(themeChange(THEMES, 'Exprot', '   ').sentence, 'A theme needs a name.');
  assert.equal(themeChange(THEMES, 'Exprot', ' Exprot ').kind, 'same');
});

test('the merge question says how many rows move', () => {
  assert.equal(mergeQuestion('Exprot', 'Export', 2, 1),
    'Merge “Exprot” into “Export”? This moves 2 feedback rows and 1 roadmap item to “Export”, and “Exprot” is gone.');
  assert.match(mergeQuestion('A', 'B', 1, 0), /moves 1 feedback row and 0 roadmap items/);
  assert.equal(doneLine({ merged: true, feedback: 2, roadmap_items: 1 }), 'Merged: 2 feedback rows and 1 roadmap item moved.');
  assert.equal(doneLine({ merged: false, feedback: 1, roadmap_items: 0 }), 'Renamed: 1 feedback row and 0 roadmap items updated.');
});

test('the part lists each theme with its counts and a Rename, and draws the merge question', () => {
  const t = text(h(FeedbackThemes, { themes: THEMES, onRename: async () => ({}) }));
  assert.match(t, /Feedback themes/);
  assert.match(t, /Exprot 2 feedback rows · 1 roadmap item Rename/);
  assert.match(t, /Onboarding 1 feedback row Rename/);
  const asked = text(h(FeedbackThemes, { themes: THEMES, onRename: async () => ({}), initialAsk: { from: 'Exprot', to: 'Export', feedback: 2, roadmapItems: 1 } }));
  assert.match(asked, /Merge “Exprot” into “Export”\? This moves 2 feedback rows and 1 roadmap item/);
  assert.match(asked, /Merge Cancel/);
});

test('a reader sees nothing: no themes part, or no writer', () => {
  assert.equal(renderToStaticMarkup(h(FeedbackThemes, { themes: undefined, onRename: async () => ({}) })), '');
  assert.equal(renderToStaticMarkup(h(FeedbackThemes, { themes: THEMES })), '');
  assert.equal(renderToStaticMarkup(h(FeedbackThemes, { themes: [], onRename: async () => ({}) })), '');
});

test('the client method sends PATCH /cycles/grow/feedback/themes with the venture in the body', async () => {
  const calls = [];
  const w = makeCycleWrites((path, opts) => { calls.push({ path, opts }); return Promise.resolve({}); });
  await w.grow.feedbackTheme(7, { from: 'Exprot', to: 'Export', merge: true });
  assert.equal(calls[0].path, '/cycles/grow/feedback/themes');
  assert.equal(calls[0].opts.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { from: 'Exprot', to: 'Export', merge: true, project: 7 });
});
