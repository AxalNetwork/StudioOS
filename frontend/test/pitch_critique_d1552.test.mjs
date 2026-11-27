/**
 * D1552 (#3799, deck v2 C4) — ⋯ › Whole deck · uses AI › Fix with critique.
 *
 *  · the item is live (its route is on main) and greys with AI paused;
 *  · the dialog shows the quote's hold before anything runs, then the run:
 *    the score, "What we fixed", the fixes waiting in Ask, and what is left
 *    with why; nothing is placed on a card;
 *  · AI off answers with its sentence and the run stays shut.
 * Synthetic records only.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_critique_d1552.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { deckCritiqueApi } from '../src/lib/api/deckCritique.js';
import { availability, critique } from '../src/pages/raise/pitch/deckV2Adapter.js';
import { MORE_MENU, moreState } from '../src/pages/raise/pitch/deckV2Model.js';
import { CRITIQUE_WAITING } from '../src/pages/raise/pitch/CritiqueDialog.jsx';
import { mountEditor } from './_pitch_editor_mount.mjs';

const QUOTE = {
  ai: true, cards: 2, score: 58, rubric: 70, findings: 3, fixes: { count: 2, per_microusd: 4000, microusd: 8000 },
  vision: { available: false, reason: 'The cards cannot be pictured here, so only the free checks run.', family: 'meta', writer_family: 'openai', cards: 2, per_card_microusd: null, microusd: 0 },
  hold_microusd: 8000,
};
const RUN = {
  score_before: 58, score: 58, score_if_accepted: 82, threshold: 75, rubric: 70,
  findings: [
    { card: 0, card_uid: 'c1', block_id: 'b2', check: 'density', detail: '400 characters where a paragraph should say at most 280.', fix: 'shorten' },
    { card: 1, card_uid: 'c2', block_id: null, check: 'vision', detail: 'Crowding: The chart touches the heading.', fix: null },
  ],
  fixes: [{ proposal_uid: 'p-1', card: 0, card_uid: 'c1', check: 'density', before: 'Long synthetic words', after: 'Short words' }],
  what_we_fixed: ['Card 1: shortened to read in seconds'],
  not_fixed: [{ card: -1, check: 'contrast', detail: "The theme's text on its background is below 4.5:1. Pick a theme with more contrast.", reason: 'Change it in Theme.' }],
  vision: { ran: true, family: 'meta', writer_family: 'openai', cards_read: 2, reason: null }, charged_microusd: 3100,
};

test('Fix with critique is live now its routes are on main, and greys with AI paused', async () => {
  assert.equal(availability('critique'), null, 'a swapped row');
  const on = moreState(MORE_MENU, { availability, aiOn: true }).sections.flatMap((s) => s.items).find((i) => i.id === 'critique');
  assert.deepEqual([on.disabled, Boolean(on.later)], [false, false]);
  const off = moreState(MORE_MENU, { availability, aiOn: false }).sections.flatMap((s) => s.items).find((i) => i.id === 'critique');
  assert.equal(off.disabled, true);
  const real = { ...deckCritiqueApi };
  const asked = [];
  deckCritiqueApi.quote = async (id) => { asked.push(['quote', id]); return QUOTE; };
  deckCritiqueApi.run = async (id, o) => { asked.push(['run', id, o]); return RUN; };
  try {
    assert.deepEqual(await critique(31), { available: true, value: QUOTE });
    assert.deepEqual(await critique(31, { run: true, vision: false }), { available: true, value: RUN });
    assert.deepEqual(asked, [['quote', 31], ['run', 31, { vision: false }]], 'no run without `run`');
  } finally { Object.assign(deckCritiqueApi, real); }
});

test('the dialog: the hold first, then the score, what was fixed, the fixes waiting in Ask, and what is left with why', async () => {
  const real = { ...deckCritiqueApi };
  const asked = [];
  deckCritiqueApi.quote = async (id) => { asked.push(['quote', id]); return QUOTE; };
  deckCritiqueApi.run = async (id, o) => { asked.push(['run', id, o]); return RUN; };
  const m = await mountEditor();
  try {
    await m.press(m.by('deck-more-open'));
    await m.press(m.by('deck-more-critique'));
    assert.ok(m.by('pitch-critique'), 'the dialog opens');
    assert.deepEqual(asked, [['quote', 31]], 'a quote, and nothing runs');
    assert.match(m.text(m.by('pitch-critique-hold')), /^Holds up to .+ · you pay what it uses$/);
    assert.match(m.text(m.by('pitch-critique-plan')), /Score now 58 of 100 · 2 blocks to shorten · vision check: The cards cannot be pictured here/);
    const before = m.calls.filter((c) => c[0] === 'proposals.list').length;

    await m.press(m.by('pitch-critique-run'));
    assert.deepEqual(asked.at(-1), ['run', 31, { vision: true }]);
    assert.equal(m.text(m.by('pitch-critique-score')), 'Score 58 of 100 · 82 once you accept the fixes');
    assert.equal(m.text(m.by('pitch-critique-fixed')), 'Card 1: shortened to read in seconds');
    assert.equal(m.text(m.by('pitch-critique-waiting')), CRITIQUE_WAITING(1));
    assert.equal(CRITIQUE_WAITING(1), '1 fix waiting for you in Ask. Nothing changes until you Accept.');
    assert.match(m.text(m.by('pitch-critique-left')), /below 4\.5:1.*Change it in Theme\./);
    assert.doesNotMatch(m.text(m.by('pitch-critique-left')), /Card 0/, 'a deck-wide finding names no card');
    assert.equal(m.text(m.by('pitch-critique-notes')), 'Card 2: Crowding: The chart touches the heading.');
    assert.ok(m.calls.filter((c) => c[0] === 'proposals.list').length > before, 'the Ask reads its waiting proposals again');
    assert.match(m.text(m.by('pitch-editor-save-state')), /Saved|All changes saved/i, 'nothing is placed on a card');
    await m.press(m.by('pitch-critique-close'));
    assert.equal(m.by('pitch-critique'), undefined);
  } finally { await m.close(); Object.assign(deckCritiqueApi, real); }
});

test('AI off: the quote\'s sentence, and the run stays shut; a failed run says so', async () => {
  const real = { ...deckCritiqueApi };
  let runs = 0;
  deckCritiqueApi.quote = async () => ({ ai: false, reason: 'assist_off', message: 'AI assistance is off on this page. The free checks still run.' });
  deckCritiqueApi.run = async () => { runs += 1; return RUN; };
  const m = await mountEditor();
  try {
    await m.press(m.by('deck-more-open'));
    await m.press(m.by('deck-more-critique'));
    assert.equal(m.text(m.by('pitch-critique-hold')), 'AI assistance is off on this page. The free checks still run.');
    assert.equal(m.pr(m.by('pitch-critique-run')).disabled, true);
    assert.equal(runs, 0);
  } finally { await m.close(); }
  deckCritiqueApi.quote = async () => QUOTE;
  deckCritiqueApi.run = async () => { throw Object.assign(new Error('The critique could not run.'), { status: 500 }); };
  const m2 = await mountEditor();
  try {
    await m2.press(m2.by('deck-more-open'));
    await m2.press(m2.by('deck-more-critique'));
    await m2.press(m2.by('pitch-critique-run'));
    assert.ok(m2.by('pitch-critique-error'), 'a failed run says so');
    assert.equal(m2.by('pitch-critique-result'), undefined);
  } finally { await m2.close(); Object.assign(deckCritiqueApi, real); }
});
