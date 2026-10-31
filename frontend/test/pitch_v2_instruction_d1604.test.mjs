/**
 * D1604 (#3716, plan §4.3, §11 step 9) — the editor's instruction box
 * (`InstructionBox.jsx`, `instructionModel.js`), the one place a founder types
 * to Eadwyn, scoped to the selection on The Grid.
 *
 *   · one filled text area: the quote first (assist, action `ask`), then Run
 *     under deck:rewrite, then a proposal placed only on Accept;
 *   · a figure in the instruction is refused before any quote;
 *   · several areas answer through the adapter (#3773), with no quote;
 *   · chips are removable; a bound figure or an area without words says why;
 *   · the phone docks the box at the bottom (pd9k);
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
import { SURFACES } from '../src/pages/raise/pitch/deckV2Adapter.js';
import { areasOf } from '../src/pages/raise/pitch/gridSelection.js';
import {
  FIGURE_REFUSAL, INSTRUCTION_OFF, NOT_WORDS, instructionField, instructionPlan, placeholderFor,
} from '../src/pages/raise/pitch/instructionModel.js';

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
    await m.type(node(m, 'pitch-instruction-field'), 'make it warmer');
    await m.press(node(m, 'pitch-instruction-send'));
    const q = m.calls.filter((c) => c[0] === 'assist.quote').at(-1);
    assert.deepEqual(q[3], { action: 'ask', block: { id: 'b2', kind: 'text' }, text: 'Synthetic body words', instruction: 'make it warmer' });
    assert.equal(m.text(node(m, 'pitch-instruction-hold')), 'Holds up to $0.0011 · you pay what it uses');
    assert.equal(m.calls.filter((c) => c[0] === 'assist.run').length, 0, 'Send quotes; it runs nothing');
    await m.press(node(m, 'pitch-instruction-run'));
    const run = m.calls.find((c) => c[0] === 'assist.run');
    assert.equal(decodeURIComponent(run[4]['X-Rail-Option']), 'deck:rewrite');
    assert.match(m.text(node(m, 'pitch-instruction-proposal-after')), /Synthetic warmer words/);
    assert.match(m.text(node(m, 'pitch-editor-save-state')), /Saved/, 'a proposal is not a change');
    await m.press(node(m, 'pitch-instruction-proposal-accept'));
    assert.deepEqual(m.calls.filter((c) => c[0] === 'proposals.decide').map((c) => c.slice(1)), [['i1', 'accept']]);
    assert.match(m.text(node(m, 'pitch-editor-block-b2')), /Synthetic warmer words/);
    assert.match(m.text(node(m, 'pitch-editor-save-state')), /Unsaved changes/);
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

test('several areas answer through the adapter; a chip comes out; a bound figure says why', async () => {
  const m = await mountEditor({ answers: { 'assist.quote': QUOTE } });
  try {
    await m.press(m.by('pitch-editor-block-b1'));
    await m.press(m.by('pitch-editor-block-b2'), { shiftKey: true });
    assert.equal(m.pr(node(m, 'pitch-instruction-field')).placeholder, 'Tell Eadwyn what to change in these 2 areas');
    await m.type(node(m, 'pitch-instruction-field'), 'make both warmer');
    await m.press(node(m, 'pitch-instruction-send'));
    assert.equal(m.text(node(m, 'pitch-instruction-later')), `Coming later: ${SURFACES.instruct.what}. Not switched on yet.`);
    assert.equal(m.calls.filter((c) => c[0] === 'assist.quote').length, 0, 'nothing is quoted for a route not on main');
    await m.press(node(m, 'pitch-instruction-chip-b1-remove'));
    assert.ok(!m.by('pitch-instruction-chip-b1'), 'the chip came out');
    assert.equal(m.pr(node(m, 'pitch-editor-block-b1'))['aria-pressed'], false, 'and so did the area');
    assert.equal(m.pr(node(m, 'pitch-instruction-field')).placeholder, 'Tell Eadwyn what to change in this area');
    await m.press(m.by('pitch-editor-block-b3'));
    assert.match(m.text(node(m, 'pitch-instruction-why')), /^Figures come from your records/);
    assert.equal(m.pr(node(m, 'pitch-instruction-field')).disabled, true);
  } finally { await m.close(); }
});

test('the phone docks the instruction box at the bottom for the tapped area', async () => {
  const before = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  const m = await mountEditor({ answers: { 'assist.quote': QUOTE } });
  try {
    assert.ok(m.by('pitch-editor-phone'));
    assert.ok(!m.by('pitch-instruction-dock'), 'nothing docked until an area is tapped');
    await m.press(node(m, 'pitch-editor-phone-area-b2'));
    const dock = node(m, 'pitch-instruction-dock');
    assert.match(m.pr(dock).className, /\bfixed\b.*\bbottom-0\b/);
    assert.match(m.pr(node(m, 'pitch-instruction-send')).className, /min-h-\[44px\]/, '44 px targets');
    await m.type(node(m, 'pitch-instruction-field'), 'shorter please');
    await m.press(node(m, 'pitch-instruction-send'));
    assert.equal(m.calls.filter((c) => c[0] === 'assist.quote').at(-1)[3].block.id, 'b2');
    await m.press(node(m, 'pitch-instruction-dock-close'));
    assert.ok(!m.by('pitch-instruction-dock'));
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
