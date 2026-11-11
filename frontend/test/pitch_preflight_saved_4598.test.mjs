// D4598 (#4598): the check before Share and Export reads the version that will be sent,
// and (part 2) the dialog that sends it checks the exact content it is about to send.
//
//   1. With unsaved edits that fix a defect, the gate still reports the defect the saved version holds, says
//      which version it read and that the edits are not in it, drops Show me, and offers to save a new version
//      first. Export anyway opens the dialog — which now runs its OWN check on the version it opens with (part
//      2): the same warning is still there, Export stays disabled until the dialog's own "Export anyway", and
//      picking another version invalidates that confirmation and runs the check again.
//   2. With unsaved edits that introduce a defect, the saved version is the one sent: it is clean at the
//      editor's own gate AND at the dialog's own check, so Export is enabled with nothing to confirm, and the
//      export that goes out is of the exact version that was checked (the zero-findings path).
//   3. With no unsaved edits the one check serves, as before.
//   4. A version with its own defect, picked in Export's version picker, is checked on its own content — never
//      flagged and left unchecked — and the export that goes out, once "Export anyway" confirms it, is of that
//      exact version (the warning/confirmation path).
//   5. A hidden card is in no export, so Export's own check numbers slides as the export will.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_preflight_saved_4598.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DIRTY_LINE, SAVE_FIRST, exportableCards, sentLine } from '../src/pages/raise/pitch/preflightUiModel.js';
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
/** D4598 part 2: `a.click()` in the dialog's own `download()`; the synthetic DOM draws no anchor behaviour. */
function allowDownloadClick() {
  const make = document.createElement.bind(document);
  document.createElement = (tag) => { const n = make(tag); n.focus = () => { document.activeElement = n; }; if (tag === 'a') { n.click = () => {}; n.remove = () => { n.parentNode?.removeChild?.(n); }; } return n; };
}
/** A PDF export that succeeds: `run()`'s `download()` needs a real blob, nothing else. */
const fakeExport = async () => ({ ok: true, blob: async () => new Blob(['pdf']) });

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

  // D4598 part 2: "Export anyway" opens the dialog, which now runs its OWN check on the
  // version it opens with — the same warning is still there, so Export stays disabled
  // until the DIALOG's own "Export anyway" confirms it (the editor's gate is not enough,
  // because the dialog may open without that gate ever having run at all).
  const w = await mountEditor({ answers: { deckGet: async () => SAMPLE, deckExport: fakeExport } });
  allowDownloadClick();
  try {
    await replaceAll(w, '[Your logo]', 'Acme');
    await pressExport(w);
    await w.press(w.by('pitch-preflight-gate-anyway'));
    assert.ok(w.by('pitch-export-dialog'), 'Export anyway opens the dialog');
    const dGate = w.by('pitch-export-gate');
    assert.ok(dGate, 'the dialog runs its own check on the version it opened with, and finds the same warning');
    assert.match(w.text(dGate), /\[Your logo\]/);
    assert.equal(w.pr(w.by('pitch-export-run')).disabled, true, 'Export stays disabled: not yet confirmed at THIS check');
    await w.press(w.by('pitch-export-gate-anyway'));
    assert.ok(w.by('pitch-export-confirmed'), 'the dialog\'s own confirm, not the editor\'s gate');
    assert.equal(w.pr(w.by('pitch-export-run')).disabled, false, 'confirmed: Export unblocks');
    await w.press(w.by('pitch-export-run'));
    assert.ok(w.by('pitch-export-done'), 'the artifact that goes out is of the version just confirmed');
    const exported = w.calls.filter(([n]) => n === 'deckExport');
    assert.equal(exported.length, 1);
    assert.equal(exported[0][1], 31, 'v3, id 31: the version the dialog\'s own check read, not a stale id');
  } finally { await w.close(); }
});

test('unsaved edits that add a defect leave the saved, clean version to go out', async () => {
  const m = await mountEditor({ answers: { deckGet: async () => CLEAN, deckExport: fakeExport } });
  allowDownloadClick();
  try {
    await replaceAll(m, 'synthetic', '[Your logo]');
    assert.match(m.text(m.by('pitch-editor-save-state')), /Unsaved changes/);
    await pressExport(m);
    assert.ok(m.by('pitch-export-dialog'), 'the version that will be sent is clean');
    assert.equal(m.by('pitch-preflight-gate'), undefined);
    // D4598 part 2: the dialog's own check on v3 is ALSO clean (its edits never reach it), so Export
    // is enabled with nothing to confirm — the zero-findings path, and the artifact is of v3.
    assert.equal(m.by('pitch-export-gate'), undefined, 'nothing for the dialog\'s own check to say');
    assert.equal(m.pr(m.by('pitch-export-run')).disabled, false);
    await m.press(m.by('pitch-export-run'));
    assert.ok(m.by('pitch-export-done'));
    const exported = m.calls.filter(([n]) => n === 'deckExport');
    assert.equal(exported.length, 1);
    assert.equal(exported[0][1], 31, 'the exported file is of v3, id 31: exactly the content that was checked');
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

test('Export\'s version picker checks the picked version itself, and a change invalidates what ran before', async () => {
  // v3 (id 31, current) has the sample; v2 (id 30) does not — a real difference by version, not a shared stub.
  const byVersion = async (id) => (Number(id) === 30 ? CLEAN : SAMPLE);
  const m = await mountEditor({ answers: { deckGet: byVersion, deckExport: fakeExport } });
  allowDownloadClick();
  try {
    await pressExport(m);
    // v3 also has the sample at the editor's own first-look gate (before the dialog is even open);
    // its own "anyway" only gets past THAT gate — the dialog runs its own check regardless.
    await m.press(m.by('pitch-preflight-gate-anyway'));
    assert.ok(m.by('pitch-export-dialog'));
    assert.ok(m.by('pitch-export-gate'), 'v3 is picked by default, and it has the sample');
    assert.equal(m.pr(m.by('pitch-export-run')).disabled, true);
    await m.press(m.by('pitch-export-gate-anyway'));
    assert.equal(m.pr(m.by('pitch-export-run')).disabled, false, 'confirmed for v3');

    // Picking v2 is a new combination: the confirmation for v3 does not carry over, and v2's own
    // (clean) content is read and checked fresh — not just said to be "not the one checked".
    await m.type(m.by('pitch-export-version'), '30');
    assert.equal(m.by('pitch-export-confirmed'), undefined, 'the earlier confirmation was for v3, not v2');
    assert.equal(m.by('pitch-export-gate'), undefined, 'v2 has no sample: nothing to confirm');
    assert.equal(m.pr(m.by('pitch-export-run')).disabled, false, 'v2 checked clean on its own content');
    await m.press(m.by('pitch-export-run'));
    const exported = m.calls.filter(([n]) => n === 'deckExport');
    assert.equal(exported.length, 1);
    assert.equal(exported[0][1], 30, 'the artifact is of v2: exactly the version the re-run check read');

    // Back to v3: the check runs again (the deckGet calls below the version switches prove it was re-read,
    // not remembered from the first visit), and the old warning is there again, unconfirmed.
    await m.type(m.by('pitch-export-version'), '31');
    assert.ok(m.by('pitch-export-gate'), 'back on v3, the sample is found again');
    assert.equal(m.pr(m.by('pitch-export-run')).disabled, true, 'a fresh combination: the earlier "anyway" does not apply here either');
    const reads = m.calls.filter(([n, id]) => n === 'deckGet' && [30, 31].includes(id)).map(([, id]) => id);
    assert.deepEqual([...new Set(reads)].sort(), [30, 31], 'each version\'s own content was read, not assumed');
  } finally { await m.close(); }
});

test('a hidden card is in no export: the dialog\'s own check numbers slides as the export will', () => {
  const hidden = { ...card('Hidden'), hidden: true };
  const shown1 = card('Shown one');
  const shown2 = card('Shown two');
  assert.deepEqual(exportableCards([shown1, hidden, shown2]), [shown1, shown2], 'the hidden card is dropped; the kept ones keep their order, so a finding\'s slide number is the export\'s');
  assert.deepEqual(exportableCards([shown1]), [shown1], 'nothing hidden: every card stays');
  assert.deepEqual(exportableCards(null), [], 'not an array: no cards, never a throw');
  assert.deepEqual(exportableCards(undefined), []);
});

test('the words', () => {
  assert.equal(sentLine(3), 'v3 · the saved version that will be sent');
  assert.equal(sentLine(null), 'The saved version that will be sent');
  assert.doesNotMatch(readFileSync(new URL('../src/pages/raise/pitch/preflightUiModel.js', import.meta.url), 'utf8').match(/export const DIRTY_LINE = '([^']*)'/)[1], /#\d{3,}/, 'no issue number in the UI');
});
