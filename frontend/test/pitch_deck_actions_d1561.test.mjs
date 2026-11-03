/**
 * D1561 (#3808): the ⋯ menu's Stage and Reorder for stage (pd13, pd23) and
 * the Check claims sheet's Wording section (pd25), mounted in the editor on
 * stubbed reads, and their client. Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_deck_actions_d1561.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deckActionsApi } from '../src/lib/api/deckActions.js';
import { deckStageApi } from '../src/lib/api/deckStage.js';
import { deckImagesApi } from '../src/lib/api/deckImages.js';
import { replaceLabel, replaceNote, reorderLabel, reorderNote, stageLabel, wordingLabel } from '../src/pages/raise/pitch/deckActionsModel.js';
import { DECK, mountEditor } from './_pitch_editor_mount.mjs';

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

const PLAN = {
  deck_id: 31, version: 3, stage: 'seed', stage_label: 'Seed', stage_source: 'audience', investor_type: 'seed_fund',
  order: [
    { card: 'title', title: 'Title', why: 'The venture and what it does, in a line.', in_deck: 0 },
    { card: 'traction', title: 'Traction', why: 'Seed investors expect early revenue or users.', in_deck: null },
  ],
  warnings: [{ card: 'traction', code: 'missing_card', message: 'Seed deck with no traction slide', action: 'Add a traction slide' }],
  extra: [],
};

test('the words: the hold only when quoted, the stage in the button, and what a reorder did', () => {
  assert.equal(wordingLabel({ ai: true, hold_microusd: 10000 }), 'Check wording · holds $0.0100');
  assert.equal(wordingLabel({ ai: true, hold_microusd: null }), 'Check wording', 'never a guessed price');
  assert.equal(wordingLabel({ ai: false }), 'Check wording');
  assert.equal(reorderLabel('seed'), 'Order for Seed · one undo step');
  assert.equal(stageLabel('series_b_plus'), 'Series B+');
  assert.equal(reorderNote({ moved: 3, stage_label: 'Seed' }), 'Ordered for Seed: 3 cards moved, saved as one version. Undo restores the old order.');
  assert.equal(reorderNote({ unchanged: true, stage_label: 'Seed', moved: 0 }), 'The cards are already in the Seed order. Nothing was saved.');
  assert.equal(reorderNote(null), null);
});

test('the client posts to the three routes; the rail option is registered and the index carries the module', async () => {
  const previous = globalThis.fetch;
  const previousStore = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const calls = [];
  globalThis.fetch = async (url, init = {}) => { calls.push([new URL(String(url), 'http://x').pathname.replace(/^\/api/, ''), init.method, init.body]); return new Response('{}', { headers: { 'Content-Type': 'application/json' } }); };
  try { await deckActionsApi.reorderForStage(7, { stage: 'seed' }); await deckActionsApi.wordingQuote(7); await deckActionsApi.wording(7); }
  finally { globalThis.fetch = previous; globalThis.localStorage = previousStore; }
  assert.deepEqual(calls.map((c) => c.slice(0, 2)), [['/decks/7/reorder-for-stage', 'POST'], ['/decks/7/check/wording/quote', 'POST'], ['/decks/7/check/wording', 'POST']]);
  assert.equal(calls[0][2], JSON.stringify({ stage: 'seed' }));
  assert.match(src('lib/railOptions/founder.js'), /key: 'deck:wording'[^\n]*kind: 'reason'/);
  assert.match(src('lib/apiModules.generated.js'), /export \* from '\.\/api\/deckActions\.js';/);
  assert.match(src('pages/raise/pitch/WordingSection.jsx'), /if \(readOnly \|\| !deck\?\.id\) return null;/, 'a reader never runs the charged pass');
});

test('⋯ › Reorder for stage opens the stage sheet; the press saves one version and the editor takes it', async () => {
  const before = { plan: deckStageApi.stagePlan, reorder: deckActionsApi.reorderForStage, quote: deckActionsApi.wordingQuote };
  const asked = [];
  deckStageApi.stagePlan = async (id, o) => { asked.push(['plan', id, o?.stage ?? null]); return { ...PLAN, stage: o?.stage || 'seed', stage_label: o?.stage === 'series_a' ? 'Series A' : 'Seed' }; };
  const REORDERED = { ...DECK, id: 32, version: 4, slides: [...DECK.slides].reverse() };
  deckActionsApi.reorderForStage = async (id, body) => { asked.push(['reorder', id, body.stage]); return { deck: REORDERED, stage: body.stage, stage_label: 'Series A', moved: 2, one_undo_step: true }; };
  const m = await mountEditor();
  try {
    await m.press(m.by('deck-more-open'));
    await m.press(m.by('deck-more-reorder'));
    assert.ok(m.by('pitch-sheet-stage'), 'the stage sheet opens');
    assert.match(m.text(m.by('pitch-stage-order')), /Traction · Not in this deck/);
    assert.match(m.text(m.by('pitch-stage-warnings')), /Seed deck with no traction slide/);
    assert.equal(m.text(m.by('pitch-stage-reorder')), 'Order for Seed · one undo step');
    await m.press(m.by('pitch-stage-series_a'));
    assert.equal(m.pr(m.by('pitch-stage-series_a'))['aria-pressed'], true);
    assert.equal(m.text(m.by('pitch-stage-reorder')), 'Order for Series A · one undo step');
    const reads = () => m.calls.filter((c) => c[0] === 'deckListVersions').length;
    const readsBefore = reads();
    await m.press(m.by('pitch-stage-reorder'));
    assert.deepEqual(asked.filter((a) => a[0] === 'reorder'), [['reorder', 31, 'series_a']], 'one press, for the stage chosen');
    assert.equal(m.by('pitch-sheet-stage'), undefined, 'the saved version replaces the editor\'s, and the sheet closes');
    assert.ok(reads() > readsBefore, 'the editor reads the versions again, so the new one is current');
  } finally {
    await m.close();
    Object.assign(deckStageApi, { stagePlan: before.plan });
    Object.assign(deckActionsApi, { reorderForStage: before.reorder, wordingQuote: before.quote });
  }
});

test('the stage sheet holds the reorder while there are unsaved edits, and says why', () => {
  const sheet = src('pages/raise/pitch/DeckSheets.jsx');
  assert.match(sheet, /disabled=\{busy \|\| dirty\} title=\{dirty \? STAGE_DIRTY : undefined\}/);
  assert.match(sheet, /\{readOnly \? null : \(/, 'a reader sees the order, never the button');
  assert.match(src('pages/raise/pitch/PitchEditor.jsx'), /if \(id === 'stage' \|\| id === 'reorder'\) \{ setSheet\('stage'\); return; \}/);
});

test('Check claims › Wording: the hold on the button, one press, each finding quoted with Go to card', async () => {
  const before = { quote: deckActionsApi.wordingQuote, run: deckActionsApi.wording };
  let runs = 0;
  deckActionsApi.wordingQuote = async () => ({ ai: true, hold_microusd: 10000, model: '@cf/synthetic/model' });
  deckActionsApi.wording = async () => {
    runs += 1;
    if (runs === 1) throw Object.assign(new Error('The wording check could not run. Nothing was charged.'), { status: 503, code: 'model_unavailable' });
    return { state: 'ok', findings: [{ key: 'wording:0', kind: 'guarantee', label: 'Guarantee language', card_index: 1, quote: 'guaranteed to double', message: 'A promise an investor will test.', action: 'Go to card' }], dropped: 0 };
  };
  const m = await mountEditor();
  try {
    await m.press(m.by('deck-more-open'));
    await m.press(m.by('deck-more-check'));
    assert.equal(m.text(m.by('pitch-wording-check')), 'Check wording · holds $0.0100');
    assert.equal(runs, 0, 'opening the sheet charges nothing');
    await m.press(m.by('pitch-wording-check'));
    assert.match(m.text(m.by('pitch-wording-failed')), /could not run/);
    await m.press(m.by('pitch-wording-retry'));
    assert.equal(runs, 2);
    assert.equal(m.by('pitch-wording-failed'), undefined);
    const row = m.by('pitch-wording-row');
    assert.match(m.text(row), /Guarantee language · Card 2/);
    assert.match(m.text(row), /“guaranteed to double”/);
    assert.ok(m.by('pitch-wording-go'));
  } finally {
    await m.close();
    Object.assign(deckActionsApi, { wordingQuote: before.quote, wording: before.run });
  }
});

test('the Replace all images words: the hold only when quoted; refused images say they were not charged', () => {
  assert.equal(replaceLabel({ ai: true, hold_microusd: 60000 }), 'Replace all images · holds up to $0.0600');
  assert.equal(replaceLabel({ ai: false }), 'Replace all images');
  assert.equal(replaceNote({ images: [{}, {}], refused: [{}] }), '2 images proposed. Keep them card by card. 1 not used after the image check; you were not charged for it.');
  assert.equal(replaceNote({ images: [], refused: [], stopped: { message: 'Eadwyn stopped.' } }), '0 images proposed. Keep them card by card. Eadwyn stopped.');
});

test('⋯ › Replace all images opens one quote for the deck; one press, with its own Idempotency-Key, draws them all', async () => {
  const before = { quote: deckImagesApi.replaceAllQuote, run: deckImagesApi.replaceAll };
  const pressed = [];
  deckImagesApi.replaceAllQuote = async () => ({ ai: true, count: 3, total_microusd: 30000, hold_microusd: 60000, areas: [], left_out: [{ card: 1, block: 'i9', code: 'not_illustrative', message: 'A chart is drawn from your figures.' }], balance: { ok: true } });
  deckImagesApi.replaceAll = async (id, body, headers) => { pressed.push([id, headers['Idempotency-Key']]); return { images: [{}, {}], refused: [{}, {}], left_out: [], hold_microusd: 60000, charged_microusd: 20000 }; };
  const m = await mountEditor();
  try {
    await m.press(m.by('deck-more-open'));
    await m.press(m.by('deck-more-replace_images'));
    assert.ok(m.by('pitch-sheet-replace-images'), 'an in-page sheet, never a browser pop-up');
    assert.equal(m.text(m.by('pitch-replace-quote')), '3 image areas · holds up to $0.0600');
    assert.match(m.text(m.by('pitch-replace-left-out')), /Card 2: left out\. A chart is drawn from your figures\./);
    assert.equal(pressed.length, 0, 'opening it charges nothing');
    await m.press(m.by('pitch-replace-press'));
    assert.equal(pressed.length, 1);
    assert.equal(pressed[0][0], 31);
    assert.equal(typeof pressed[0][1], 'string', 'the press carries its own key');
    assert.match(pressed[0][1], /^[A-Za-z0-9._:-]{8,64}$/);
    assert.notEqual(pressed[0][1], 'undefined');
    assert.match(m.text(m.by('pitch-replace-result')), /2 images proposed\. Keep them card by card\. 2 not used/);
    assert.equal(m.pr(m.by('pitch-replace-press')).disabled, true, 'one press per sheet');
  } finally {
    await m.close();
    Object.assign(deckImagesApi, { replaceAllQuote: before.quote, replaceAll: before.run });
  }
});
