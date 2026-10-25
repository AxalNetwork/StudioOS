/**
 * D900 (#2679, part 6 of #2434) — the studio's Review tab (PD14): the current
 * version's review with each point pointing to a card, the score only when the
 * review returned one, the run's cost, the reviews per version with "Score not
 * returned", "Review this version" behind a dialog, and the reviewer for an
 * upload or pasted text still below. The Worker half is
 * `cloudflare-worker/test/deck_review_d900.test.ts`.
 *
 * Every name and figure is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_review_d900.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import { cyclesApi } from '../src/lib/api/cycles.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import PitchStudio from '../src/pages/raise/pitch/PitchStudio.jsx';
import {
  COST_NOT_RECORDED, NO_CARD, SCORE_NOT_RETURNED,
  costLabel, estimateOf, historyRows, latestReview, money, pointerLabel, reviewSentence, scoreLabel,
} from '../src/pages/raise/pitch/reviewModel.js';

const h = React.createElement;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

const versions = { versions: [
  { id: 41, version: 4, title: 'Synthetic seed', is_current: 1, created_at: '2026-10-21 09:00:00' },
  { id: 40, version: 3, title: 'Synthetic seed', is_current: 0, created_at: '2026-10-02 09:00:00' },
] };
const deck = { id: 41, version: 4, title: 'Synthetic seed', slides: [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }] };
const cards = (o) => ({ shape: 'cards', overall_score: 72, summary: 'Synthetic summary of v4.', strengths: [{ text: 'Synthetic strength', card: 2 }], weaknesses: [{ text: 'Synthetic weakness', card: null }], red_flags: [], fixes: [{ text: 'Synthetic fix', card: 3 }], ...o });
const reviews = { viewer: 'founder', capped: false, reviews: [
  { id: 'r4', run_id: 'h4', deck_id: 41, deck_version: 4, created_at: '2026-10-21T09:12:00.000Z', overall_score: 72, cost: { charged_microusd: 18000, est_cost_usd: 0.018, runs: 1 }, review: cards() },
  { id: 'r3', run_id: 'h3', deck_id: 40, deck_version: 3, created_at: '2026-10-02T08:00:00.000Z', overall_score: null, cost: { charged_microusd: null, est_cost_usd: null, runs: 0 }, review: cards({ overall_score: null }) },
] };

const ORIGINAL = { api: { ...api }, deckReviewer: { ...api.deckReviewer }, cycles: { ...cyclesApi } };

async function mount(answers, user = null) {
  const calls = [];
  const stub = (name, fn) => (...a) => { calls.push([name, ...a]); return fn(...a); };
  const base = {
    listProjects: async () => [{ id: 7, name: 'Synthetic venture' }],
    deckListVersions: async () => versions,
    deckGet: async () => deck,
    deckEngagement: async () => ({ deck_id: 41, views: [], shares: [] }),
    'cycles.module': async () => ({ card: null, records: null }),
    deckReviews: async () => reviews,
    ...answers,
  };
  for (const [name, fn] of Object.entries(base)) {
    if (name.startsWith('cycles.')) cyclesApi[name.slice(7)] = stub(name, fn);
    else api[name] = stub(name, fn);
  }
  api.deckReviewer = { ...api.deckReviewer, list: async () => ({ reviews: [] }) };
  api.getMe = async () => user;
  const restore = installDocument();
  if (user) localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootEl = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const element = h(PitchStudio, { tab: 'review' });
  await act(async () => { rootEl.render(h(MemoryRouter, { initialEntries: ['/raise/pitch/review?project_id=7'] }, user ? h(AuthProvider, null, element) : element)); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const all = (id) => walk(container).filter((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    calls, by, all, pr, settle,
    text: (n = container) => text(n).replace(/\s+/g, ' '),
    async press(node) { await act(async () => { await pr(node).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async unmount() {
      await act(async () => rootEl.unmount()); restore();
      Object.assign(api, ORIGINAL.api); api.deckReviewer = ORIGINAL.deckReviewer; Object.assign(cyclesApi, ORIGINAL.cycles);
    },
  };
}

test('D900: the words — money to the hundredth of a cent, Not recorded, Score not returned, a card or none', () => {
  // Mutations checked: show a missing charge as $0.0000; show a missing score as 0; guess "Card 1" for none.
  assert.equal(money(18000), '$0.0180');
  assert.equal(money(0), '$0.0000', 'a recorded zero is a zero');
  assert.equal(money(null), null);
  assert.equal(costLabel({ charged_microusd: null, est_cost_usd: 0.01 }), COST_NOT_RECORDED);
  assert.equal(costLabel(undefined), COST_NOT_RECORDED);
  assert.equal(scoreLabel(71.6), '72');
  assert.equal(scoreLabel(null), SCORE_NOT_RETURNED);
  assert.equal(scoreLabel(undefined), SCORE_NOT_RETURNED);
  assert.equal(pointerLabel(5), 'Card 5');
  assert.equal(pointerLabel(null), NO_CARD);
  assert.equal(pointerLabel(0), NO_CARD);
  assert.deepEqual(historyRows(reviews.reviews).map((r) => [r.version, r.score, r.cost, r.scored]),
    [['v4', '72', '$0.0180', true], ['v3', SCORE_NOT_RETURNED, COST_NOT_RECORDED, false]]);
  // The estimate is the last review that recorded its charge, never a run with none.
  assert.equal(estimateOf([reviews.reviews[1], reviews.reviews[0]]), '$0.0180');
  assert.equal(estimateOf([reviews.reviews[1]]), null);
  assert.equal(latestReview(reviews.reviews, 40).id, 'r3');
  assert.equal(latestReview(reviews.reviews, 99), null);
  assert.match(reviewSentence('v4', 3, '$0.0180'), /reads the 3 cards of v4 .* last review cost \$0\.0180\. .*Nothing on the deck changes\./);
  assert.match(reviewSentence('v4', 1, null), /reads the 1 card of v4 .*the cost is shown when it is done\./);
});

test('D900: a founder reads the current version\'s review: score, cost, four columns pointing to cards, and the reviews per version', async () => {
  // Mutations checked: drop the card pill (no "Card 2"); draw the score when none was returned (v3 row reads 0);
  // read the newest review of any version (v3's review would show for v4).
  const m = await mount({}, { id: 1, role: 'founder' });
  try {
    assert.deepEqual(m.calls.filter((c) => c[0] === 'deckReviews'), [['deckReviews', 41]], 'the history is read for the current version');
    const current = m.text(m.by('pitch-review-current'));
    assert.match(current, /Review v4 · Synthetic seed/);
    assert.match(current, /Proposed by Eadwyn · ran .* · cost \$0\.0180/);
    assert.match(m.text(m.by('pitch-review-score')), /72 of 100 · returned by the review/);
    assert.match(m.text(m.by('pitch-review-summary')), /Synthetic summary of v4\./);
    assert.match(m.text(m.by('pitch-review-col-strengths')), /Synthetic strength Card 2/);
    assert.match(m.text(m.by('pitch-review-col-weaknesses')), new RegExp(`Synthetic weakness ${NO_CARD}`));
    assert.match(m.text(m.by('pitch-review-col-red_flags')), /None returned\./);
    assert.match(m.text(m.by('pitch-review-col-fixes')), /Synthetic fix Card 3/);
    const rows = m.all('pitch-review-history-row').map((n) => m.text(n));
    assert.equal(rows.length, 2);
    assert.match(rows[0], /^v4 72 .* \$0\.0180$/);
    assert.match(rows[1], new RegExp(`^v3 ${SCORE_NOT_RETURNED} .* ${COST_NOT_RECORDED}$`));
    assert.match(m.text(m.by('pitch-review-run')), /Review this version · \$0\.0180/);
    // Uploads and pasted text stay available below.
    assert.match(m.text(m.by('pitch-review-uploads')), /Drop your deck here or click to browse/);
  } finally { await m.unmount(); }
});

test('D900: Review this version opens a dialog that says what it changes, then runs on the current version and reads again', async () => {
  // Mutations checked: run without the dialog; send no rail option; do not read the history again.
  let ran = 0;
  const m = await mount({ deckReviewVersion: async () => { ran += 1; return { review: {}, cost: {} }; } }, { id: 1, role: 'founder' });
  try {
    await m.press(m.by('pitch-review-run'));
    assert.equal(ran, 0, 'the press opens the dialog; nothing runs yet');
    assert.match(m.text(m.by('pitch-review-sentence')), /Eadwyn reads the 3 cards of v4 .*last review cost \$0\.0180\. The review is added to this version's history\. Nothing on the deck changes\./);
    await m.press(m.by('pitch-review-confirm'));
    const run = m.calls.find((c) => c[0] === 'deckReviewVersion');
    assert.equal(run[1], 41);
    assert.equal(run[2]['X-Rail-Option'], encodeURIComponent('review:deck-version'));
    assert.equal(m.calls.filter((c) => c[0] === 'deckReviews').length, 2, 'the history is read again');
    assert.equal(m.by('pitch-review-dialog'), undefined, 'the dialog closes');
  } finally { await m.unmount(); }
});

test('D900: a run that returned nothing says so in the dialog and stays open', async () => {
  // Mutation checked: swallow the error → no alert.
  const err = Object.assign(new Error('The review came back with nothing to show, so nothing was saved. Try again.'), { status: 502 });
  const m = await mount({ deckReviewVersion: async () => { throw err; } }, { id: 1, role: 'founder' });
  try {
    await m.press(m.by('pitch-review-run'));
    await m.press(m.by('pitch-review-confirm'));
    assert.match(m.text(m.by('pitch-review-failed')), /nothing was saved/);
    assert.ok(m.by('pitch-review-dialog'), 'the dialog stays open');
    assert.equal(m.calls.filter((c) => c[0] === 'deckReviews').length, 1);
  } finally { await m.unmount(); }
});

test('D900: an admin reads the reviews and is offered no run; a version never reviewed says so; a failed read says so', async () => {
  // Mutations checked: offer the button to an admin; read the history failure as "no reviews".
  const admin = await mount({ deckReviews: async () => ({ ...reviews, viewer: 'admin' }) }, { id: 9, role: 'admin' });
  try {
    assert.equal(admin.by('pitch-review-run'), undefined);
    assert.match(admin.text(admin.by('pitch-review-readonly')), /Only the venture's founders run a review/);
    assert.equal(admin.all('pitch-review-history-row').length, 2);
  } finally { await admin.unmount(); }

  const fresh = await mount({ deckReviews: async () => ({ viewer: 'founder', reviews: [], capped: false }) }, { id: 1, role: 'founder' });
  try {
    assert.match(fresh.text(fresh.by('pitch-review-current')), /This version has not been reviewed yet\./);
    assert.match(fresh.text(fresh.by('pitch-review-history-empty')), /No version of this deck has been reviewed yet\./);
    assert.equal(fresh.by('pitch-review-score'), undefined, 'no score is drawn without a review');
    assert.doesNotMatch(fresh.text(fresh.by('pitch-review-run')), /\$/, 'no estimate without a recorded charge');
  } finally { await fresh.unmount(); }

  const failed = await mount({ deckReviews: async () => { throw new Error('read failed'); } }, { id: 1, role: 'founder' });
  try {
    assert.ok(failed.by('pitch-review-history-error'));
    assert.equal(failed.by('pitch-review-history-empty'), undefined);
    assert.equal(failed.pr(failed.by('pitch-review-run')).disabled, true, 'no run while the history cannot be read');
  } finally { await failed.unmount(); }
});

test('D900: the studio mounts PitchReview; the reviewer keeps its own wrap', () => {
  const studio = read('frontend/src/pages/raise/pitch/PitchStudio.jsx');
  assert.match(studio, /<PitchReview reads=\{reads\} readOnly=\{readOnly\} \/>/);
  assert.doesNotMatch(studio, /import DeckReviewerPage/);
  const review = read('frontend/src/pages/raise/pitch/PitchReview.jsx');
  assert.match(review, /<DeckReviewerPage embedded \/>/);
  assert.match(review, /api\.deckReviewVersion\(deckId, railPressHeaders\('review:deck-version'\)\)/);
  const api = read('frontend/src/lib/api.js');
  assert.match(api, /deckReviewVersion: \(id, headers\) => request\(`\/decks\/\$\{id\}\/review`/);
  assert.match(api, /deckReviews: \(id\) => request\(`\/decks\/\$\{id\}\/reviews`\)/);
});
