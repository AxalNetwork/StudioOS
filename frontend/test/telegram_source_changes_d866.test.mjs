/** D866 §4 (#2618): the existing citation slot explains a deleted source. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformWithOxc } from 'vite';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlacementCard } from '../src/pages/founder/InterviewReview.jsx';

const note = 'The source message was deleted in Telegram.';
const row = { id: 1, kind: 'competitor_mention', payload: { name: 'Synthetic tool' }, status: 'accepted', can_accept: true };
const render = (cite, Card = PlacementCard) => renderToStaticMarkup(React.createElement(Card, { p: { ...row, cite } }));
test('a decided deleted passage shows its authored note and never an old quote', () => {
  const html = render({ from: 0, to: 1000, quote: 'Synthetic old quote', source_deleted: true, source_note: note });
  assert.ok(html.includes(note));
  assert.ok(html.includes('Accepted'));
  assert.equal(html.includes('Synthetic old quote'), false);
  assert.equal(html.includes('Quote not recorded'), false);
});
test('normal and unrecorded citations keep their existing copy; a flagged missing note has a neutral fallback', () => {
  assert.ok(render({ quote: 'Synthetic current quote' }).includes('Synthetic current quote'));
  assert.ok(render({ quote: null }).includes('Quote not recorded'));
  assert.ok(render({ source_deleted: true }).includes('Deleted at the source.'));
});

let variantId = 0;
async function changedCard(before, after) {
  const url = new URL('../src/pages/founder/InterviewReview.jsx', import.meta.url);
  const source = readFileSync(url, 'utf8');
  assert.ok(source.includes(before));
  let { code } = await transformWithOxc(source.replace(before, after), fileURLToPath(url), { jsx: { runtime: 'automatic' } });
  code = code.replace(/^((?:import\s+[^'";]+|export\s*\{[^}]*\})\s+from\s*['"])([^'"]+)(['"])/gm,
    (_m, prefix, spec, quote) => prefix + (spec.startsWith('.') ? new URL(spec, url).href : import.meta.resolve(spec)) + quote);
  const module = await import('data:text/javascript;base64,' + Buffer.from(code + '\n// D866 variant ' + ++variantId).toString('base64'));
  return module.PlacementCard;
}
for (const [name, before, after, verify] of [
  ['deleted flag ignored', 'p.cite?.source_deleted ?', 'false ?', (Card) => {
    const html = render({ quote: 'Synthetic old quote', source_deleted: true, source_note: note }, Card);
    assert.ok(html.includes(note)); assert.equal(html.includes('Synthetic old quote'), false);
  }],
  ['normal quote lost', "p.cite?.quote || 'Quote not recorded'", "'Quote not recorded'", (Card) => {
    assert.ok(render({ quote: 'Synthetic current quote' }, Card).includes('Synthetic current quote'));
  }],
]) test('D866 citation mutation: ' + name, async () => {
  verify(PlacementCard);
  const Card = await changedCard(before, after);
  assert.throws(() => verify(Card), { name: 'AssertionError' });
  verify(PlacementCard);
});
