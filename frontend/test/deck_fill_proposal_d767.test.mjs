// D767 (#2096) PR 1 — "Fill from project" shows a proposal beside the current
// version, with Keep and Discard; the editor's deck is not changed by a fill.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deck_fill_proposal_d767.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderedText } from './_renderedText.mjs';
import { PROPOSAL_COPY, changedCount, proposalRows } from '../src/lib/deckProposal.js';
import DeckProposalPanel from '../src/components/DeckProposalPanel.jsx';

const CURRENT = [
  { title: 'Problem', body: 'Founders cannot find the data.' },
  { title: 'Solution', bullets: ['One place', 'Live'] },
];
const PROPOSED = [
  { title: 'Problem', body: 'Founders cannot find the data.' },
  { title: 'Solution', bullets: ['One place', 'Live', 'Shared'] },
  { title: 'Ask', body: '$2M seed' },
];

test('proposalRows pairs each slide position and says which change', () => {
  const rows = proposalRows(CURRENT, PROPOSED);
  assert.deepEqual(rows.map((r) => [r.index, r.current?.title ?? null, r.proposed?.title ?? null, r.changed]), [
    [0, 'Problem', 'Problem', false],
    [1, 'Solution', 'Solution', true],
    [2, null, 'Ask', true],
  ]);
  assert.equal(rows[1].proposed.excerpt, 'One place · Live · Shared');
  assert.equal(changedCount(CURRENT, PROPOSED), 2);
  assert.equal(changedCount(CURRENT, CURRENT), 0);
  assert.deepEqual(proposalRows(null, undefined), []);
  const long = proposalRows([], [{ title: 'x', body: 'a'.repeat(400) }])[0].proposed.excerpt;
  assert.equal(long.length, 140);
  assert.ok(long.endsWith('…'));
});

test('the panel: the proposal beside the current version, Keep and Discard, and nothing without a proposal', () => {
  assert.equal(renderToStaticMarkup(createElement(DeckProposalPanel, { proposal: null, currentSlides: CURRENT, onKeep() {}, onDiscard() {} })), '');
  const html = renderToStaticMarkup(createElement(DeckProposalPanel, {
    proposal: { id: 7, slides: PROPOSED }, currentSlides: CURRENT, onKeep() {}, onDiscard() {},
  }));
  const t = renderedText(html);
  assert.ok(t.includes(PROPOSAL_COPY.title));
  assert.ok(t.includes('Your current version is unchanged.'));
  assert.ok(t.includes('2 slides change.'));
  assert.match(html, /data-testid="button-deck-proposal-keep"[^>]*>.*Keep as new version/);
  assert.match(html, /data-testid="button-deck-proposal-discard"[^>]*>.*Discard/);
  assert.equal((html.match(/data-changed="true"/g) || []).length, 2);
  assert.equal((html.match(/data-changed="false"/g) || []).length, 1);
  const one = renderedText(renderToStaticMarkup(createElement(DeckProposalPanel, {
    proposal: { id: 8, slides: [CURRENT[0], { title: 'New' }] }, currentSlides: CURRENT, onKeep() {}, onDiscard() {},
  })));
  assert.ok(one.includes('1 slide changes.'));
});

test('the editor: a fill sets the proposal, never the deck; Keep and Discard call their routes', () => {
  const page = readFileSync(new URL('../src/pages/PitchDeckPage.jsx', import.meta.url), 'utf8');
  const fill = page.slice(page.indexOf('const fillFromProject = async'), page.indexOf('const keepProposal = async'));
  assert.match(fill, /setProposal\(r\?\.proposal \|\| null\)/);
  assert.doesNotMatch(fill, /setDeck\(/, 'a fill does not replace the editor\'s deck');
  assert.match(page, /api\.deckKeepProposal\(p\.id\)/);
  assert.match(page, /api\.deckDiscardProposal\(p\.id\)/);
  assert.match(page, /<DeckProposalPanel proposal=\{proposal\} currentSlides=\{deck\?\.slides\}/);
  assert.match(page, /setProposal\(r\?\.proposal \|\| null\);\n/, 'the unkept proposal is read back on load');
  const api = readFileSync(new URL('../src/lib/api.js', import.meta.url), 'utf8');
  assert.match(api, /deckKeepProposal: \(proposalId\) => request\(`\/decks\/proposals\/\$\{proposalId\}\/keep`, \{ method: 'POST'/);
  assert.match(api, /deckDiscardProposal: \(proposalId\) => request\(`\/decks\/proposals\/\$\{proposalId\}`, \{ method: 'DELETE' \}\)/);
});
