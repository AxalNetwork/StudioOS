// D767 (#2096) PR 1 — "Fill from project" is a proposal beside the current
// version, kept or discarded; the deck is not changed by a fill. D1604 (#3716) moved the
// review to `OneClickBuild.jsx`'s ProposalReview, which New deck mounts for a reopened proposal.
//
// D898 group E (#2676) retired the template builder that first drew it (its
// `DeckProposalPanel` and `lib/deckProposal.js` went with it). The studio's
// Fill from project now lands on New deck's step 4, which reviews the same
// proposal card by card, as it does a template start's and the fast path's.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deck_fill_proposal_d767.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the studio\'s fill proposes and never writes: it opens the proposal at New deck', () => {
  const src = codeOnly(read('src/pages/raise/pitch/StudioActions.jsx'));
  const fill = src.slice(src.indexOf('export function AskDraftFromProject'), src.indexOf('export function SpinoutReadiness'));
  assert.match(fill, /await api\.deckAutofill\(deck\.id, railPressHeaders\('form:deck'\)\)/);
  assert.match(fill, /navigate\(proposalHref\(NEW_PATH, q, r\.proposal\.id\)\)/);
  // Mutation checked: keep the proposal on arrival → this fails.
  assert.doesNotMatch(fill, /deckKeepProposal|deckUpdate|keepSlides/, 'a fill writes a version on arrival');
});

test('New deck reopens the proposal and keeps or discards it, Discard behind its dialog', () => {
  const src = codeOnly(read('src/pages/raise/pitch/NewDeck.jsx'));
  assert.match(src, /const wanted = params\.get\('proposal'\);/);
  assert.match(src, /const p = versions\.data\?\.proposal;/, 'the unkept proposal is read back from the versions read');
  assert.match(src, /<ProposalReview key=\{proposal\.id\}/, 'its cards land on the review shared with the one-click');
  // D1604 (#3716, §3.2 step 7): the review keeps the ticked cards as the version in one press, and
  // Discard is the one write behind a dialog.
  const review = codeOnly(read('src/pages/raise/pitch/OneClickBuild.jsx'));
  assert.match(review, /await newDeckApi\.keepSlides\(proposal\.id, body\)/);
  assert.match(review, /await api\.deckDiscardProposal\(proposal\.id\);/);
  assert.match(review, /onClick=\{\(\) => setDiscarding\(true\)\}/);
  assert.match(review, /data-testid="pitch-review-discard-confirm"/);
  const api = read('src/lib/api.js');
  assert.match(api, /deckDiscardProposal: \(proposalId\) => request\(`\/decks\/proposals\/\$\{proposalId\}`, \{ method: 'DELETE' \}\)/);
});

test('the builder\'s proposal panel is gone with the builder', () => {
  for (const f of ['src/components/DeckProposalPanel.jsx', 'src/lib/deckProposal.js', 'src/pages/PitchDeckPage.jsx']) {
    assert.ok(!existsSync(new URL(`../${f}`, import.meta.url)), `${f} is back`);
  }
});
