/**
 * D1604 (#3716, plan §4.3, §11 step 9) — the editor's instruction box
 * (`InstructionBox.jsx`, `instructionModel.js`), the one place a founder types
 * to Eadwyn, scoped to the selection on The Grid.
 *
 *   · one filled text area: the quote first (assist, action `ask`), then Run
 *     under deck:rewrite, then a proposal placed only on Accept, which says
 *     the run was already charged; Enter never sends twice;
 *   · v1's Change tone and Translate are typed: words that are only a tone
 *     or a language run `tone` / `translate` under their own options;
 *   · a figure in the instruction is refused before any quote;
 *   · several areas (D1527, #3795): one quote for the selection with its hold and
 *     variants, Run once, one proposal per area, Accept all as one undo step;
 *   · chips are removable; a bound figure or an area without words says why;
 *   · the phone: tap an area, then Ask opens the full-height sheet with the
 *     box at its foot (pd9k);
 *   · no typed field to Eadwyn outside the editor's selection: the header's
 *     Ask sheet and the lightbox take none.
 *
 * Every venture, card and figure is synthetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CARD, MODEL, mountEditor } from './_pitch_editor_mount.mjs';
import { areasOf } from '../src/pages/raise/pitch/gridSelection.js';
import {
  FIGURE_REFUSAL, INSTRUCTION_OFF, NOT_WORDS, instructionField, instructionPlan, placeholderFor, typedChange,
  labelResults, severalBody, severalHold, stillRunning,
} from '../src/pages/raise/pitch/instructionModel.js';
import { FOUNDER_OPTIONS } from '../src/lib/railOptions/founder.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => readFileSync(resolve(root, 'frontend/src/pages/raise/pitch', f), 'utf8');
const AREAS = areasOf(CARD, MODEL);
const area = (id) => AREAS.find((a) => a.id === id);
const node = (m, id) => { const n = m.by(id); assert.ok(n, `no ${id}`); return n; };

test('what the selection allows: one filled text area, several, off, or why not', () => {
  assert.equal(instructionPlan([area('b2')]).kind, 'one');
  assert.equal(instructionPlan([area('b2')]).block.id, 'b2');
  assert.equal(instructionPlan([area('b1'), area('b2')]).kind, 'several');
  assert.equal(instructionPlan([area('b2')], { aiOn: false }).kind, 'off');
  assert.match(instructionPlan([area('b3')], { items: [{ source_key: 'revenue.mrr', module: 'Grow › Revenue' }] }).why, /Figures come from your records\. Update Grow › Revenue/);
  assert.equal(instructionPlan([area('free:8-4')]).why, NOT_WORDS);
  assert.equal(instructionPlan([{ ...area('b2'), block: { ...area('b2').block, text: '  ' } }]).why, NOT_WORDS);
  assert.equal(instructionPlan([]).kind, 'none');
  assert.equal(placeholderFor(1), 'Tell Eadwyn what to change in this area');
  assert.equal(placeholderFor(3), 'Tell Eadwyn what to change in these 3 areas');
  assert.equal(instructionField('  make it warmer ').figure, null);
  assert.equal(instructionField('say we grew 3x').figure, '3');
  assert.equal(instructionField('double the growth').figure, 'double', 'the Worker\'s number words too');
});

const QUOTE = async () => ({ ai: true, hold_microusd: 1100 });

test('one text area: Send quotes first, Run proposes under deck:rewrite, Accept places the words', async () => {
  const m = await mountEditor({ answers: {
    'assist.quote': QUOTE,
    'assist.run': async (_id, _card, body) => ({ proposal: { uid: 'i1' }, before: body.text, after: 'Synthetic warmer words', cost: { charged_microusd: 600 } }),
    'proposals.decide': async () => ({ ok: true }),
  } });
  try {
    assert.ok(!m.by('pitch-instruction'), 'no field until an area is selected');
    await m.press(m.by('pitch-editor-block-b2'));
    assert.ok(m.by('pitch-instruction-chip-b2'));
    assert.equal(m.pr(node(m, 'pitch-instruction-field')).placeholder, 'Tell Eadwyn what to change in this area');
    assert.equal(m.pr(node(m, 'pitch-instruction-field')).maxLength, 300);
    await m.type(node(m, 'pitch-instruction-field'), 'make it warmer and shorter');
    await m.press(node(m, 'pitch-instruction-send'));
    const q = m.calls.filter((c) => c[0] === 'assist.quote').at(-1);
    assert.deepEqual(q[3], { action: 'ask', block: { id: 'b2', kind: 'text' }, text: 'Synthetic body words', instruction: 'make it warmer and shorter' });
    assert.equal(m.text(node(m, 'pitch-instruction-hold')), 'Holds up to $0.0011 · you pay what it uses');
    assert.equal(m.calls.filter((c) => c[0] === 'assist.run').length, 0, 'Send quotes; it runs nothing');
    await m.press(node(m, 'pitch-instruction-run'));
    const run = m.calls.find((c) => c[0] === 'assist.run');
    assert.equal(decodeURIComponent(run[4]['X-Rail-Option']), 'deck:rewrite');
    assert.match(m.text(node(m, 'pitch-instruction-proposal-after')), /Synthetic warmer words/);
    // D1515 (#3767): the interim line is gone now that undo says "Still charged"; the proposal's eyebrow keeps the cost.
    assert.equal(m.by('pitch-instruction-charged'), undefined, 'no interim charged line beside Accept');
    assert.match(m.text(node(m, 'pitch-instruction-proposal')), /\$0\.0006/);
    assert.match(m.text(node(m, 'pitch-editor-save-state')), /Saved/, 'a proposal is not a change');
    await m.press(node(m, 'pitch-instruction-proposal-accept'));
    assert.deepEqual(m.calls.filter((c) => c[0] === 'proposals.decide').map((c) => c.slice(1)), [['i1', 'accept']]);
    assert.match(m.text(node(m, 'pitch-editor-block-b2')), /Synthetic warmer words/);
    assert.match(m.text(node(m, 'pitch-editor-save-state')), /Unsaved changes/);
  } finally { await m.close(); }
});

test('Change tone and Translate are typed: a tone or a language alone runs under its own option', async () => {
  assert.deepEqual(typedChange('warmer'), { action: 'tone', tone: 'warm' });
  assert.deepEqual(typedChange('Make it more formal.'), { action: 'tone', tone: 'formal' });
  assert.deepEqual(typedChange('in French'), { action: 'translate', language: 'French' });
  assert.deepEqual(typedChange('translate it into chinese'), { action: 'translate', language: 'Chinese (Simplified)' });
  assert.deepEqual(typedChange('warmer, and drop the jargon'), { action: 'ask' }, 'anything more is an instruction');
  assert.deepEqual(typedChange('in Klingon'), { action: 'ask' }, 'a language the Worker does not take stays an instruction');
  for (const key of ['deck:tone', 'deck:translate']) {
    assert.deepEqual(FOUNDER_OPTIONS.find((o) => o.key === key).at, [['frontend/src/pages/raise/pitch/InstructionBox.jsx', 'deckAssistApi.run(']], `${key} lives in the instruction box`);
  }
  const m = await mountEditor({ answers: {
    'assist.quote': QUOTE,
    'assist.run': async (_id, _card, body) => ({ proposal: { uid: `t-${body.action}` }, before: body.text, after: 'Synthetic other words', cost: { charged_microusd: null } }),
  } });
  try {
    await m.press(m.by('pitch-editor-block-b2'));
    await m.type(node(m, 'pitch-instruction-field'), 'warmer');
    await m.press(node(m, 'pitch-instruction-send'));
    assert.deepEqual(m.calls.filter((c) => c[0] === 'assist.quote').at(-1)[3], { action: 'tone', block: { id: 'b2', kind: 'text' }, text: 'Synthetic body words', tone: 'warm' });
    await m.press(node(m, 'pitch-instruction-run'));
    assert.equal(decodeURIComponent(m.calls.filter((c) => c[0] === 'assist.run').at(-1)[4]['X-Rail-Option']), 'deck:tone');
    assert.equal(m.by('pitch-instruction-charged'), undefined, 'D1515: no interim charged line');
    assert.doesNotMatch(m.text(node(m, 'pitch-instruction-proposal')), /\$0\.00\b/, 'no $0 for an amount not recorded');
    await m.type(node(m, 'pitch-instruction-field'), 'in German');
    await m.press(node(m, 'pitch-instruction-send'));
    await m.press(node(m, 'pitch-instruction-run'));
    const run = m.calls.filter((c) => c[0] === 'assist.run').at(-1);
    assert.equal(run[3].language, 'German');
    assert.equal(run[3].action, 'translate');
    assert.equal(decodeURIComponent(run[4]['X-Rail-Option']), 'deck:translate');
  } finally { await m.close(); }
});

test('Enter never sends while a quote is read or a run is in flight: one run, one charge', async () => {
  let finish;
  const m = await mountEditor({ answers: {
    'assist.quote': QUOTE,
    'assist.run': () => new Promise((r) => { finish = r; }),
  } });
  try {
    await m.press(m.by('pitch-editor-block-b2'));
    await m.type(node(m, 'pitch-instruction-field'), 'make it sharper');
    await m.fire(node(m, 'pitch-instruction-field'), 'onKeyDown', { key: 'Enter' });
    assert.equal(m.calls.filter((c) => c[0] === 'assist.quote').length, 1, 'Enter is Send');
    await m.press(node(m, 'pitch-instruction-run'));
    await m.fire(node(m, 'pitch-instruction-field'), 'onKeyDown', { key: 'Enter' });
    assert.equal(m.calls.filter((c) => c[0] === 'assist.quote').length, 1, 'no second quote while the run is in flight');
    assert.ok(!m.by('pitch-instruction-run'), 'and no second Run to press');
    assert.equal(m.calls.filter((c) => c[0] === 'assist.run').length, 1);
    finish({ proposal: { uid: 'e1' }, before: 'Synthetic body words', after: 'Synthetic sharper words', cost: { charged_microusd: 500 } });
    await m.settle();
    assert.match(m.text(node(m, 'pitch-instruction-proposal-after')), /Synthetic sharper words/);
  } finally { await m.close(); }
});

test('a figure in the instruction is refused before any quote; nothing was charged', async () => {
  const m = await mountEditor({ answers: { 'assist.quote': QUOTE } });
  try {
    await m.press(m.by('pitch-editor-block-b2'));
    await m.type(node(m, 'pitch-instruction-field'), 'say we grew 3x this year');
    await m.press(node(m, 'pitch-instruction-send'));
    assert.equal(m.text(node(m, 'pitch-instruction-refused')), FIGURE_REFUSAL);
    assert.equal(m.calls.filter((c) => c[0] === 'assist.quote').length, 0, 'not even quoted');
  } finally { await m.close(); }
});

/** D1527 (#3795): the several-area run's answers, in the shape D1521 and D1512 send. */
const SEV_QUOTE = async () => ({
  class: 'areas', quote_uid: 'q-sev', expires_at: '2099-01-01', hold_microusd: 2400, runs: 2, refused: 1,
  areas: [
    { key: 'b1', area_id: 'b1', refusal: null, hold_microusd: 1200 },
    { key: 'b2', area_id: 'b2', refusal: null, hold_microusd: 1200 },
    { key: 'b3', area_id: 'b3', refusal: { code: 'not_text', message: 'A figure tile changes from its own tools.' }, hold_microusd: 0 },
  ],
});
const variant = (n, after) => ({ n, seed: n, model_label: 'Synthetic writer', cost_microusd: 600, seconds: 2, state: 'ready', error: null, payload: { kind: 'text', before: '', after }, critique: null });
const proposalFor = (area, before, afters) => ({
  uid: `p-${area}`, card_uid: 'c-1', area_id: area, element: 'text', kind: 'text', state: 'ready', outcome: null, accepted_variant: null, replaces_block: area,
  variants: afters.map((a, i) => ({ ...variant(i + 1, a), payload: { kind: 'text', before, after: a } })),
});
const SEV_RUN = async () => ({
  batch_uid: 'batch-1', class: 'areas', hold_microusd: 2400, replayed: false,
  proposals: [proposalFor('b1', 'Synthetic heading', ['Synthetic shorter heading']), proposalFor('b2', 'Synthetic body words', ['Synthetic shorter body'])],
  refused: [{ key: 'b3', refusal: { code: 'not_text', message: 'A figure tile changes from its own tools.' } }],
});

test('D1527: an instruction on a 3-area selection quotes those areas, runs once, and proposes changes to exactly them', async () => {
  // Mutation checked: the selection built from every text block → the quote names b1, b2 (not b3) and the deepEqual fails;
  // Run without the quote's uid → the run body check fails; proposals drawn for any area → the b3 proposal check fails.
  const m = await mountEditor({ answers: { 'assist.quote': QUOTE, 'instruct.quote': SEV_QUOTE, 'instruct.run': SEV_RUN } });
  try {
    await m.press(m.by('pitch-editor-block-b1'));
    await m.press(m.by('pitch-editor-block-b2'), { shiftKey: true });
    await m.press(m.by('pitch-editor-block-b3'), { shiftKey: true });
    assert.equal(m.pr(node(m, 'pitch-instruction-field')).placeholder, 'Tell Eadwyn what to change in these 3 areas');
    await m.type(node(m, 'pitch-instruction-field'), 'shorter');
    await m.fire(node(m, 'pitch-instruction-variants'), 'onChange', { target: { value: '2' } });
    await m.press(node(m, 'pitch-instruction-send'));
    const asked = m.calls.filter((c) => c[0] === 'instruct.quote');
    assert.equal(asked.length, 1);
    assert.deepEqual(asked[0][2], { card: 0, selection: [{ area_id: 'b1' }, { area_id: 'b2' }, { area_id: 'b3' }], instruction: 'shorter', variants: 2 });
    assert.match(m.text(node(m, 'pitch-instruction-hold')), /^Holds up to .+ · you pay what it uses · 2 areas · 1 cannot run$/);
    assert.match(m.text(node(m, 'pitch-instruction-area-refused-b3')), /A figure tile changes from its own tools\./);
    assert.equal(m.calls.filter((c) => c[0] === 'instruct.run').length, 0, 'nothing runs until Run');
    assert.equal(m.calls.filter((c) => c[0] === 'assist.quote').length, 0, 'several areas never use the one-area quote');

    await m.press(node(m, 'pitch-instruction-run'));
    await m.settle();
    const ran = m.calls.filter((c) => c[0] === 'instruct.run');
    assert.equal(ran.length, 1, 'one run');
    assert.equal(ran[0][2].quote_uid, 'q-sev', 'the run is the quoted one');
    assert.ok(m.by('pitch-area-result-b1') && m.by('pitch-area-result-b2'), 'a proposal for each area that could run');
    assert.ok(!m.by('pitch-area-result-b3') || m.pr(m.by('pitch-area-result-b3'))['data-state'] === 'refused', 'b3 proposes nothing');
    assert.match(m.text(node(m, 'pitch-area-result-b2')), /Synthetic shorter body/);
    assert.match(m.text(node(m, 'pitch-area-result-b2')), /Synthetic writer/, 'the model label, read-only');
    assert.match(m.text(node(m, 'pitch-area-result-b1')), /c1–12 × r1/, 'named by its area');
    assert.ok(m.by('pitch-instruction-retry'));
  } finally { await m.close(); }
});

test('D1527: Accept all places every area as ONE undo step; undo takes both back', async () => {
  // Mutation checked: Accept all without its shared group → two steps, and one undo leaves b1 changed.
  const m = await mountEditor({ answers: { 'assist.quote': QUOTE, 'instruct.quote': SEV_QUOTE, 'instruct.run': SEV_RUN,
    'areas.accept': async (_d, _c, area, uid, n) => ({ proposal: { uid, outcome: 'accepted', accepted_variant: n }, variant: n }) } });
  try {
    await m.press(m.by('pitch-editor-block-b1'));
    await m.press(m.by('pitch-editor-block-b2'), { shiftKey: true });
    await m.type(node(m, 'pitch-instruction-field'), 'shorter');
    await m.press(node(m, 'pitch-instruction-send'));
    await m.press(node(m, 'pitch-instruction-run'));
    await m.settle();
    await m.press(node(m, 'pitch-instruction-areas-accept-all'));
    await m.settle();
    assert.deepEqual(m.calls.filter((c) => c[0] === 'areas.accept').map((c) => c[3]), ['b1', 'b2'], 'each area accepted by its own route');
    assert.match(m.text(node(m, 'pitch-editor-block-b1')), /Synthetic shorter heading/);
    assert.match(m.text(node(m, 'pitch-editor-block-b2')), /Synthetic shorter body/);
    await m.press(node(m, 'pitch-editor-undo'));
    await m.settle();
    assert.match(m.text(node(m, 'pitch-editor-block-b1')), /Synthetic heading/, 'one undo step takes back both areas');
    assert.match(m.text(node(m, 'pitch-editor-block-b2')), /Synthetic body words/);
  } finally { await m.close(); }
});

test('D1527: a figure in a several-area instruction is refused before any quote; a chip comes out; a bound figure says why', async () => {
  const m = await mountEditor({ answers: { 'assist.quote': QUOTE, 'instruct.quote': SEV_QUOTE } });
  try {
    await m.press(m.by('pitch-editor-block-b1'));
    await m.press(m.by('pitch-editor-block-b2'), { shiftKey: true });
    await m.type(node(m, 'pitch-instruction-field'), 'say we reached $2.4M ARR');
    await m.press(node(m, 'pitch-instruction-send'));
    assert.equal(m.text(node(m, 'pitch-instruction-refused')), FIGURE_REFUSAL);
    assert.equal(m.calls.filter((c) => c[0] === 'instruct.quote').length, 0, 'not even quoted');
    await m.press(node(m, 'pitch-instruction-chip-b1-remove'));
    assert.ok(!m.by('pitch-instruction-chip-b1'), 'the chip came out');
    assert.equal(m.pr(node(m, 'pitch-editor-block-b1'))['aria-pressed'], false, 'and so did the area');
    assert.equal(m.pr(node(m, 'pitch-instruction-field')).placeholder, 'Tell Eadwyn what to change in this area');
    await m.press(m.by('pitch-editor-block-b3'));
    assert.match(m.text(node(m, 'pitch-instruction-why')), /^Figures come from your records/);
    assert.equal(m.pr(node(m, 'pitch-instruction-field')).disabled, true);
  } finally { await m.close(); }
});

test('D1527: the several-area body, the hold line, the area names and whether a run is still going', () => {
  // Mutation checked: variants not clamped → 7 is sent; the refused count dropped → "1 cannot run" missing.
  assert.deepEqual(severalBody({ cardIndex: 2, areas: [{ id: 'a' }, { id: 'b' }], instruction: ' shorter ', variants: 7 }),
    { card: 2, selection: [{ area_id: 'a' }, { area_id: 'b' }], instruction: 'shorter', variants: 1 });
  const tokens = (m) => `$${(m / 1e6).toFixed(4)}`;
  assert.equal(severalHold(null, tokens), 'Reading the cost…');
  assert.equal(severalHold({ hold_microusd: 2400, areas: [{ refusal: null }, { refusal: null }, { refusal: { message: 'x' } }] }, tokens), 'Holds up to $0.0024 · you pay what it uses · 2 areas · 1 cannot run');
  assert.equal(severalHold({ hold_microusd: 0, areas: [{ refusal: { message: 'x' } }] }, tokens), 'None of the selected areas can run. Nothing is held.');
  const named = labelResults([{ key: 'b2', areaKey: 'b2' }, { key: 'b1', areaKey: 'b1' }], [area('b1'), area('b2')], () => 'Body');
  assert.deepEqual(named.map((r) => [r.areaKey, r.label, r.area?.id]), [['b1', 'c1–12 × r1 · Body', 'b1'], ['b2', 'c1–7 × r2–6 · Body', 'b2']]);
  assert.equal(stillRunning([{ state: 'running', variants: [] }]), true);
  assert.equal(stillRunning([{ state: 'ready', variants: [{ n: 1 }] }]), false);
});

test('D1527: an area still generating when Run answers is read again until it settles', async () => {
  // Mutation checked: no re-read → the b2 proposal is never drawn.
  const running = { ...proposalFor('b2', 'Synthetic body words', []), state: 'running', variants: [] };
  const m = await mountEditor({ answers: { 'assist.quote': QUOTE, 'instruct.quote': SEV_QUOTE,
    'instruct.run': async () => ({ batch_uid: 'batch-2', proposals: [proposalFor('b1', 'Synthetic heading', ['Synthetic shorter heading']), running], refused: [] }),
    'areas.proposals': async () => ({ batch: { uid: 'batch-2', state: 'done' }, done: true, proposals: [proposalFor('b1', 'Synthetic heading', ['Synthetic shorter heading']), proposalFor('b2', 'Synthetic body words', ['Synthetic shorter body'])] }) } });
  try {
    await m.press(m.by('pitch-editor-block-b1'));
    await m.press(m.by('pitch-editor-block-b2'), { shiftKey: true });
    await m.type(node(m, 'pitch-instruction-field'), 'shorter');
    await m.press(node(m, 'pitch-instruction-send'));
    await m.press(node(m, 'pitch-instruction-run'));
    for (let i = 0; i < 40 && !m.by('pitch-area-result-b2'); i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 100)); await m.settle();
    }
    assert.deepEqual(m.calls.filter((c) => c[0] === 'areas.proposals').map((c) => c[2]), ['batch-2'], 'the batch is read again by its uid');
    assert.match(m.text(node(m, 'pitch-area-result-b2')), /Synthetic shorter body/);
  } finally { await m.close(); }
});

test('the phone: tap any area, then Ask opens the full-height sheet with the instruction field at its foot', async () => {
  const before = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  const m = await mountEditor({ answers: {
    'assist.quote': QUOTE,
    'prefs.page': async () => ({ models: [{ id: 'synthetic/m', name: 'Synthetic phone model' }], pick: 'synthetic/m' }),
  } });
  try {
    assert.ok(m.by('pitch-editor-phone'));
    assert.doesNotMatch(m.text(node(m, 'pitch-editor-phone-areas')), /Ask Eadwyn/, 'the list is not named as if it were the control');
    for (const id of ['b1', 'b2', 'b3', 'free:11-2', 'free:8-4']) assert.ok(m.by(`pitch-editor-phone-area-${id}`), `${id} can be tapped`);
    assert.ok(!m.by('pitch-editor-phone-ask'), 'no Ask until an area is tapped');
    await m.press(node(m, 'pitch-editor-phone-area-b2'));
    const ask = node(m, 'pitch-editor-phone-ask');
    assert.equal(m.pr(ask)['aria-label'], 'Ask Eadwyn about this area');
    assert.match(m.pr(ask).className, /min-h-\[44px\]/, '44 px');
    assert.ok(!m.by('pitch-areas'), 'tapping only selects');
    await m.press(ask);
    assert.match(m.text(node(m, 'pitch-areas')), /Generate into 1 area/);
    const sheet = node(m, 'pitch-instruction-sheet');
    assert.ok(m.walk(node(m, 'pitch-areas')).includes(sheet), 'the instruction field is inside the sheet');
    assert.match(m.pr(sheet).className, /\bsticky\b.*\bbottom-0\b/);
    assert.match(m.pr(node(m, 'pitch-instruction-send')).className, /min-h-\[44px\]/, '44 px targets');
    await m.type(node(m, 'pitch-instruction-field'), 'shorter please');
    await m.press(node(m, 'pitch-instruction-send'));
    assert.equal(m.calls.filter((c) => c[0] === 'assist.quote').at(-1)[3].block.id, 'b2');
    await m.press(node(m, 'pitch-areas-close'));
    assert.ok(!m.by('pitch-areas'));
    // An empty area is reachable too: its Ask opens Generate, with no instruction field (it has no words).
    await m.press(node(m, 'pitch-editor-phone-area-free:8-4'));
    await m.press(node(m, 'pitch-editor-phone-ask'));
    assert.ok(m.by('pitch-areas-row-free:8-4'));
    assert.ok(!m.by('pitch-instruction-sheet'));
    await m.press(node(m, 'pitch-areas-close'));
    // A bound figure says why, as the desktop's Ask does.
    await m.press(node(m, 'pitch-editor-phone-area-b3'));
    assert.equal(m.pr(node(m, 'pitch-editor-phone-ask')).disabled, true);
    assert.match(m.text(node(m, 'pitch-editor-phone-ask-why')), /^Figures come from your records/);
  } finally { await m.close(); globalThis.matchMedia = before; }
});

test('AI paused: the field is off and says so', async () => {
  const plan = instructionPlan([area('b2')], { aiOn: false });
  assert.equal(plan.kind, 'off');
  const src = read('InstructionBox.jsx');
  assert.ok(src.includes('{INSTRUCTION_OFF}'), 'the off line is drawn');
  assert.match(INSTRUCTION_OFF, /AI is paused/);
});

test('typed instructions live only in the editor, scoped to the selection: Ask and the lightbox take none', () => {
  for (const f of ['DeckAsk.jsx', 'AreaLightbox.jsx', 'AreaResults.jsx']) {
    const src = read(f);
    assert.ok(!/<textarea/.test(src), `${f} has no textarea`);
    assert.ok(!/instruction:/.test(src), `${f} sends no instruction`);
  }
  assert.ok(!/<input/.test(read('DeckAsk.jsx')), 'the Ask sheet has no input');
  // The one text input in the lightbox is the upload's alt text, never sent to a model.
  const lightbox = read('AreaLightbox.jsx');
  assert.deepEqual([...lightbox.matchAll(/<input className=\{FIELD\}[^>]*aria-label="([^"]+)"/g)].map((x) => x[1]), ['Alt text']);
  const editor = read('PitchEditor.jsx');
  assert.ok(editor.includes('areas={chosen}'), 'the box takes the selection');
});
