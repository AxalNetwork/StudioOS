// D4598 (#4598): the check before Share and Export reads the version that will be sent.
//
//   1. With unsaved edits that fix a defect, the gate still reports the defect the saved version holds, says
//      which version it read and that the edits are not in it, drops Show me (its card places are the saved
//      version's), and offers to save a new version first. Export anyway is the founder's explicit choice.
//   2. With unsaved edits that introduce a defect, the saved version is the one sent: it is clean, so the
//      dialog opens, and the edits are not part of what was cleared.
//   3. With no unsaved edits the one check serves, as before.
//   4. Export's version picker: a version other than the one the check read says it was not checked.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_preflight_saved_4598.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DIRTY_LINE, SAVE_FIRST, notCheckedLine, sentLine } from '../src/pages/raise/pitch/preflightUiModel.js';
import { DECK, mountEditor } from './_pitch_editor_mount.mjs';

const g = (c1, c2, r1, r2) => ({ c1, c2, r1, r2 });
const card = (text) => ({ title: 'Synthetic traction', layout: 'title', blocks: [{ id: 'b1', kind: 'text', style: 'paragraph', grid: g(1, 12, 1, 2), text }] });
/** The saved version holds a bracketed sample; the same version without it. */
const SAMPLE = { ...DECK, slides: [card('Add [Your logo] here')] };
const CLEAN = { ...DECK, slides: [card('Our synthetic logo is here')] };

async function replaceAll(m, find, replace) {
  await m.press(m.by('deck-more-open'));
  await m.press(m.by('deck-more-find'));
  await m.type(m.by('pitch-find-field'), find);
  await m.type(m.by('pitch-find-replace'), replace);
  await m.press(m.by('pitch-find-run'));
}
async function pressExport(m) {
  await m.press(m.by('deck-toolbar-share'));
  await m.press(m.by('deck-toolbar-item-export'));
  for (let i = 0; i < 8 && !m.by('pitch-preflight-gate-nothing') && !m.by('pitch-export-dialog') && !m.by('pitch-preflight-gate-fix-list'); i += 1) await m.settle();
}

test('unsaved edits that fix a defect do not clear the saved version that has it', async () => {
  const m = await mountEditor({ answers: { deckGet: async () => SAMPLE } });
  try {
    await replaceAll(m, '[Your logo]', 'Acme');
    assert.match(m.text(m.by('pitch-editor-save-state')), /Unsaved changes/);
    await pressExport(m);
    assert.equal(m.by('pitch-export-dialog'), undefined, 'the edited deck is clean, the saved one is not: not straight to the dialog');
    const gate = m.by('pitch-preflight-gate');
    assert.ok(gate, 'the gate is open');
    assert.match(m.text(gate), /Before you export/);
    assert.match(m.text(gate), /v3 · the saved version that will be sent/);
    assert.match(m.text(m.by('pitch-preflight-gate-look')), /\[Your logo\]/, 'the saved version\'s sample is listed');
    assert.equal(m.text(m.by('pitch-preflight-gate-dirty')), DIRTY_LINE);
    assert.equal(m.text(m.by('pitch-preflight-gate-save')), SAVE_FIRST);
    const ids = m.walk(gate).map((n) => String(m.pr(n)['data-testid'] || ''));
    assert.ok(!ids.some((id) => id.endsWith('-show')), 'no Show me: its card places are the saved version\'s');
    // Saving first is the founder's own step: it closes the gate and opens the save dialog.
    await m.press(m.by('pitch-preflight-gate-save'));
    assert.equal(m.by('pitch-preflight-gate'), undefined);
    assert.ok(m.by('pitch-editor-save-dialog'), 'the save dialog');
    assert.equal(m.by('pitch-export-dialog'), undefined, 'nothing is exported');
    assert.equal(m.calls.filter(([n]) => n === 'preflight.dismissals').length, 1, 'the version\'s dismissals are read once: the gate\'s run borrows the panel\'s set');
  } finally { await m.close(); }
  // Export anyway is explicit, and the dialog is told which version the check read.
  const w = await mountEditor({ answers: { deckGet: async () => SAMPLE } });
  try {
    await replaceAll(w, '[Your logo]', 'Acme');
    await pressExport(w);
    await w.press(w.by('pitch-preflight-gate-anyway'));
    assert.ok(w.by('pitch-export-dialog'), 'Export anyway opens the dialog');
    assert.equal(w.by('pitch-export-not-checked'), undefined, 'the checked version is the one shown');
    await w.type(w.by('pitch-export-version'), '30');
    assert.equal(w.text(w.by('pitch-export-not-checked')), notCheckedLine(2, 3), 'Export anyway hands the dialog the version the check read');
  } finally { await w.close(); }
});

test('unsaved edits that add a defect leave the saved, clean version to go out', async () => {
  const m = await mountEditor({ answers: { deckGet: async () => CLEAN } });
  try {
    await replaceAll(m, 'synthetic', '[Your logo]');
    assert.match(m.text(m.by('pitch-editor-save-state')), /Unsaved changes/);
    await pressExport(m);
    assert.ok(m.by('pitch-export-dialog'), 'the version that will be sent is clean');
    assert.equal(m.by('pitch-preflight-gate'), undefined);
  } finally { await m.close(); }
});

test('with no unsaved edits the one check serves, and the gate names the version', async () => {
  const m = await mountEditor({ answers: { deckGet: async () => SAMPLE } });
  try {
    await pressExport(m);
    const gate = m.by('pitch-preflight-gate');
    assert.match(m.text(gate), /v3 · the saved version that will be sent/);
    assert.equal(m.by('pitch-preflight-gate-dirty'), undefined, 'nothing to say about edits');
    assert.equal(m.by('pitch-preflight-gate-save'), undefined);
    assert.ok(m.walk(gate).some((n) => String(m.pr(n)['data-testid'] || '').endsWith('-show')), 'Show me stays');
  } finally { await m.close(); }
});

test('Export\'s version picker says when a version was not the one checked', async () => {
  const m = await mountEditor({ answers: { deckGet: async () => CLEAN } });
  try {
    await pressExport(m);
    assert.ok(m.by('pitch-export-dialog'));
    assert.equal(m.by('pitch-export-not-checked'), undefined);
    await m.type(m.by('pitch-export-version'), '30');
    assert.equal(m.text(m.by('pitch-export-not-checked')), notCheckedLine(2, 3));
    await m.type(m.by('pitch-export-version'), '31');
    assert.equal(m.by('pitch-export-not-checked'), undefined, 'back on the checked version');
  } finally { await m.close(); }
});

test('the words', () => {
  assert.equal(sentLine(3), 'v3 · the saved version that will be sent');
  assert.equal(sentLine(null), 'The saved version that will be sent');
  assert.equal(notCheckedLine(2, 3), 'v2 was not checked. The check before you export read v3.');
  assert.doesNotMatch(readFileSync(new URL('../src/pages/raise/pitch/preflightUiModel.js', import.meta.url), 'utf8').match(/export const DIRTY_LINE = '([^']*)'/)[1], /#\d{3,}/, 'no issue number in the UI');
});
